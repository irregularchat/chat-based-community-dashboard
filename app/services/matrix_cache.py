"""
Matrix Cache Service for fast database-backed Matrix operations.
Provides caching for Matrix users, rooms, and memberships to avoid slow API calls.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from sqlalchemy.orm import Session
from sqlalchemy import func, and_

from app.db.models import (
    MatrixUser, MatrixRoom, MatrixRoomMembership, 
    MatrixSyncStatus, MatrixUserCache
)
from app.utils.config import Config

logger = logging.getLogger(__name__)

class MatrixCacheService:
    """Service for managing Matrix data cache with smart syncing."""
    
    def __init__(self):
        self.last_manual_sync = None
        self.sync_in_progress = False
        
    async def full_sync(self, db: Session, force: bool = False) -> Dict:
        """
        Perform a full sync of Matrix data with smart logic.
        
        Args:
            db: Database session
            force: Force sync even if cache is fresh
            
        Returns:
            Dict with sync results
        """
        if self.sync_in_progress and not force:
            return {"status": "skipped", "reason": "sync_in_progress"}
            
        try:
            self.sync_in_progress = True
            
            # Check if this is a manual sync within 30 seconds of the last one
            now = datetime.utcnow()
            is_rapid_manual_sync = (
                self.last_manual_sync and 
                (now - self.last_manual_sync).total_seconds() < 30
            )
            
            if force and not is_rapid_manual_sync:
                self.last_manual_sync = now
            
            # Check cache freshness unless forced or rapid manual sync
            if not force and not is_rapid_manual_sync:
                if self.is_cache_fresh(db, max_age_minutes=30):
                    return {"status": "skipped", "reason": "cache_fresh"}
            
            # Import Matrix client here to avoid circular imports
            from app.utils.matrix_actions import get_matrix_client
            
            if not Config.MATRIX_ACTIVE:
                return {"status": "error", "error": "Matrix not active"}
            
            client = await get_matrix_client()
            if not client:
                return {"status": "error", "error": "Failed to get Matrix client"}
            
            try:
                # Start sync operation
                sync_status = MatrixSyncStatus(
                    sync_type="full",
                    status="running"
                )
                db.add(sync_status)
                db.commit()
                
                # Sync rooms first
                room_result = await self._sync_rooms(db, client, is_rapid_manual_sync)
                
                # Sync users and memberships
                user_result = await self._sync_users_and_memberships(db, client, is_rapid_manual_sync)
                
                # Update denormalized user cache
                cache_result = await self._update_user_cache(db)
                
                # Update sync status
                sync_status.last_sync = datetime.utcnow()
                sync_status.status = "completed"
                sync_status.processed_items = user_result.get("users_synced", 0) + room_result.get("rooms_synced", 0)
                db.commit()
                
                return {
                    "status": "completed",
                    "users_synced": user_result.get("users_synced", 0),
                    "rooms_synced": room_result.get("rooms_synced", 0),
                    "memberships_synced": user_result.get("memberships_synced", 0),
                    "cache_updated": cache_result.get("cache_updated", 0),
                    "sync_id": sync_status.id
                }
                
            finally:
                await client.close()
                
        except Exception as e:
            logger.error(f"Error in full_sync: {str(e)}")
            # Update sync status to failed
            try:
                if 'sync_status' in locals():
                    sync_status.status = "failed"
                    sync_status.error_message = str(e)
                    db.commit()
            except:
                pass
            return {"status": "error", "error": str(e)}
        finally:
            self.sync_in_progress = False

    async def _sync_rooms(self, db: Session, client, is_rapid_manual_sync: bool = False) -> Dict:
        """
        Sync Matrix rooms with smart user count comparison.
        
        Args:
            db: Database session
            client: Matrix client
            is_rapid_manual_sync: Whether this is a rapid manual sync
            
        Returns:
            Dict with sync results
        """
        try:
            from app.utils.matrix_actions import get_joined_rooms_async, get_room_details_async
            
            # Get joined rooms from Matrix
            room_ids = await get_joined_rooms_async(client)
            if not room_ids:
                return {"rooms_synced": 0}
            
            rooms_synced = 0
            rooms_skipped = 0
            
            for room_id in room_ids:
                try:
                    # Get current room from database
                    existing_room = db.query(MatrixRoom).filter(
                        MatrixRoom.room_id == room_id
                    ).first()
                    
                    # Get room details from Matrix (this includes member_count)
                    room_details = await get_room_details_async(client, room_id)
                    current_member_count = room_details.get("member_count", 0)
                    
                    # Skip rooms with fewer than minimum members
                    if current_member_count <= Config.MATRIX_MIN_ROOM_MEMBERS:
                        logger.info(f"Skipping room {room_id} - only {current_member_count} members (minimum: {Config.MATRIX_MIN_ROOM_MEMBERS})")
                        rooms_skipped += 1
                        continue
                    
                    # Smart sync logic: skip if member count hasn't changed (unless rapid manual sync)
                    if existing_room and not is_rapid_manual_sync:
                        if existing_room.member_count == current_member_count:
                            logger.debug(f"Skipping room {room_id} - member count unchanged ({current_member_count})")
                            rooms_skipped += 1
                            continue
                    
                    # Update or create room
                    if existing_room:
                        existing_room.name = room_details.get("name", "")
                        existing_room.topic = room_details.get("topic", "")
                        existing_room.member_count = current_member_count
                        existing_room.last_synced = datetime.utcnow()
                    else:
                        new_room = MatrixRoom(
                            room_id=room_id,
                            name=room_details.get("name", ""),
                            topic=room_details.get("topic", ""),
                            member_count=current_member_count,
                            last_synced = datetime.utcnow()
                        )
                        db.add(new_room)
                    
                    rooms_synced += 1
                    
                    # Commit every 10 rooms to avoid large transactions
                    if rooms_synced % 10 == 0:
                        db.commit()
                        
                except Exception as e:
                    logger.error(f"Error syncing room {room_id}: {str(e)}")
                    continue
            
            db.commit()
            logger.info(f"Room sync completed: {rooms_synced} synced, {rooms_skipped} skipped")
            
            return {
                "rooms_synced": rooms_synced,
                "rooms_skipped": rooms_skipped
            }
            
        except Exception as e:
            logger.error(f"Error in _sync_rooms: {str(e)}")
            return {"rooms_synced": 0, "error": str(e)}

    async def _sync_users_and_memberships(self, db: Session, client, is_rapid_manual_sync: bool = False) -> Dict:
        """
        Sync Matrix users and room memberships with smart logic.
        
        Args:
            db: Database session
            client: Matrix client
            is_rapid_manual_sync: Whether this is a rapid manual sync
            
        Returns:
            Dict with sync results
        """
        try:
            # Get all rooms to sync memberships for
            rooms = db.query(MatrixRoom).all()
            
            users_synced = 0
            memberships_synced = 0
            rooms_skipped = 0
            
            for room in rooms:
                try:
                    # Skip rooms with fewer than minimum members
                    if room.member_count <= Config.MATRIX_MIN_ROOM_MEMBERS:
                        logger.info(f"Skipping membership sync for {room.room_id} - only {room.member_count} members (minimum: {Config.MATRIX_MIN_ROOM_MEMBERS})")
                        rooms_skipped += 1
                        continue
                    
                    # Get current membership count from database
                    current_db_count = db.query(MatrixRoomMembership).filter(
                        MatrixRoomMembership.room_id == room.room_id
                    ).count()
                    
                    # Smart sync logic: skip if member count matches and not rapid manual sync
                    if not is_rapid_manual_sync and room.member_count == current_db_count:
                        logger.debug(f"Skipping membership sync for {room.room_id} - count unchanged ({current_db_count})")
                        rooms_skipped += 1
                        continue
                    
                    # Get room members from Matrix
                    from app.utils.matrix_actions import get_room_members_async
                    members_data = await get_room_members_async(client, room.room_id)
                    # Convert members dict to list of member objects
                    members = []
                    if members_data:
                        for user_id, details in members_data.items():
                            members.append({
                                "user_id": user_id,
                                "display_name": details.get("display_name", ""),
                                "avatar_url": details.get("avatar_url", "")
                            })
                    
                    # Clear existing memberships for this room
                    db.query(MatrixRoomMembership).filter(
                        MatrixRoomMembership.room_id == room.room_id
                    ).delete()
                    
                    # Process each member
                    for member in members:
                        user_id = member.get("user_id")
                        if not user_id:
                            continue
                        
                        # Update or create user using merge to avoid duplicates
                        existing_user = db.query(MatrixUser).filter(
                            MatrixUser.user_id == user_id
                        ).first()
                        
                        if existing_user:
                            existing_user.display_name = member.get("display_name", "")
                            existing_user.last_seen = datetime.utcnow()
                        else:
                            # Check if user was already added in this transaction
                            new_user = MatrixUser(
                                user_id=user_id,
                                display_name=member.get("display_name", ""),
                                last_seen=datetime.utcnow()
                            )
                            # Use merge to handle potential duplicates gracefully
                            db.merge(new_user)
                            users_synced += 1
                        
                        # Create membership record
                        membership = MatrixRoomMembership(
                            room_id=room.room_id,
                            user_id=user_id,
                            membership_status="join",
                            joined_at=datetime.utcnow()
                        )
                        db.add(membership)
                        memberships_synced += 1
                    
                    # Update room member count
                    room.member_count = len(members)
                    room.last_synced = datetime.utcnow()
                    
                    # Commit after each room to avoid transaction conflicts
                    db.commit()
                        
                except Exception as e:
                    logger.error(f"Error syncing memberships for room {room.room_id}: {str(e)}")
                    continue
            
            db.commit()
            logger.info(f"User/membership sync completed: {users_synced} users, {memberships_synced} memberships, {rooms_skipped} rooms skipped")
            
            return {
                "users_synced": users_synced,
                "memberships_synced": memberships_synced,
                "rooms_skipped": rooms_skipped
            }
            
        except Exception as e:
            logger.error(f"Error in _sync_users_and_memberships: {str(e)}")
            return {"users_synced": 0, "memberships_synced": 0, "error": str(e)}

    async def _update_user_cache(self, db: Session) -> Dict:
        """Update the denormalized user cache table for fast queries."""
        try:
            # Clear existing cache
            db.query(MatrixUserCache).delete()
            
            # Get all users with their room memberships
            users_with_rooms = db.query(
                MatrixUser.user_id,
                MatrixUser.display_name,
                func.count(MatrixRoomMembership.room_id).label('room_count'),
                func.string_agg(MatrixRoom.name, ', ').label('room_names')
            ).outerjoin(
                MatrixRoomMembership, MatrixUser.user_id == MatrixRoomMembership.user_id
            ).outerjoin(
                MatrixRoom, MatrixRoomMembership.room_id == MatrixRoom.room_id
            ).group_by(
                MatrixUser.user_id, MatrixUser.display_name
            ).all()
            
            cache_updated = 0
            for user_data in users_with_rooms:
                cache_entry = MatrixUserCache(
                    user_id=user_data.user_id,
                    display_name=user_data.display_name or "",
                    room_count=user_data.room_count or 0,
                    is_signal_user=user_data.user_id.startswith("@signal_")
                )
                db.add(cache_entry)
                cache_updated += 1
            
            db.commit()
            logger.info(f"User cache updated: {cache_updated} entries")
            
            return {"cache_updated": cache_updated}
            
        except Exception as e:
            logger.error(f"Error updating user cache: {str(e)}")
            return {"cache_updated": 0, "error": str(e)}

    def get_cached_users(self, db: Session, signal_only: bool = False) -> List[Dict]:
        """
        Get cached Matrix users with fast database query.
        
        Args:
            db: Database session
            signal_only: If True, return only Signal bridge users
            
        Returns:
            List of user dictionaries
        """
        try:
            query = db.query(MatrixUserCache)
            
            if signal_only:
                query = query.filter(MatrixUserCache.is_signal_user == True)
            
            users = query.order_by(MatrixUserCache.display_name).all()
            
            return [
                {
                    "user_id": user.user_id,
                    "display_name": user.display_name,
                    "room_count": user.room_count,
                    "is_signal_user": user.is_signal_user
                }
                for user in users
            ]
            
        except Exception as e:
            logger.error(f"Error getting cached users: {str(e)}")
            return []

    def get_cached_rooms(self, db: Session) -> List[Dict]:
        """
        Get cached Matrix rooms with fast database query.
        
        Args:
            db: Database session
            
        Returns:
            List of room dictionaries
        """
        try:
            rooms = db.query(MatrixRoom).order_by(MatrixRoom.member_count.desc()).all()
            
            return [
                {
                    "room_id": room.room_id,
                    "name": room.name,
                    "display_name": room.display_name,
                    "topic": room.topic,
                    "member_count": room.member_count,
                    "is_direct": room.is_direct,
                    "room_type": room.room_type
                }
                for room in rooms
            ]
            
        except Exception as e:
            logger.error(f"Error getting cached rooms: {str(e)}")
            return []

    def get_users_in_room(self, db: Session, room_id: str) -> List[Dict[str, str]]:
        """
        Get all users in a specific room from cache.
        
        Args:
            db: Database session
            room_id: Matrix room ID
            
        Returns:
            List of user dictionaries with user_id and display_name
        """
        try:
            from app.db.models import MatrixRoomMembership, MatrixUser
            
            # Query users who are members of the specified room
            users_in_room = db.query(MatrixUser).join(
                MatrixRoomMembership, 
                MatrixUser.user_id == MatrixRoomMembership.user_id
            ).filter(
                MatrixRoomMembership.room_id == room_id,
                MatrixRoomMembership.membership_status == 'join'
            ).all()
            
            return [
                {
                    'user_id': user.user_id,
                    'display_name': user.display_name or user.user_id.split(':')[0].lstrip('@')
                }
                for user in users_in_room
            ]
            
        except Exception as e:
            logging.error(f"Error getting users in room {room_id}: {str(e)}")
            return []

    def get_sync_status(self, db: Session) -> Optional[Dict]:
        """Get the latest sync status."""
        try:
            latest_sync = db.query(MatrixSyncStatus).order_by(
                MatrixSyncStatus.created_at.desc()
            ).first()
            
            if not latest_sync:
                return None
            
            return {
                "status": latest_sync.status,
                "last_sync": latest_sync.last_sync,
                "progress": latest_sync.progress_percentage,
                "total_items": latest_sync.total_items,
                "processed_items": latest_sync.processed_items,
                "duration_seconds": latest_sync.sync_duration_seconds,
                "error_message": latest_sync.error_message
            }
            
        except Exception as e:
            logger.error(f"Error getting sync status: {str(e)}")
            return None

    def is_cache_fresh(self, db: Session, max_age_minutes: int = 60) -> bool:
        """Check if the cache is fresh enough to skip syncing."""
        try:
            cutoff_time = datetime.utcnow() - timedelta(minutes=max_age_minutes)
            
            recent_sync = db.query(MatrixSyncStatus).filter(
                and_(
                    MatrixSyncStatus.status == "completed",
                    MatrixSyncStatus.last_sync >= cutoff_time
                )
            ).first()
            
            return recent_sync is not None
            
        except Exception as e:
            logger.error(f"Error checking cache freshness: {str(e)}")
            return False

    async def background_sync(self, db_session: Optional[Session] = None, max_age_minutes: int = 30):
        """Run background sync if cache is stale."""
        db = None
        try:
            if db_session:
                db = db_session
                logger.debug("Using provided db_session for background_sync.")
            else:
                from app.db.session import get_db
                db = next(get_db())
                logger.debug("Created new db_session for background_sync.")

            if not self.is_cache_fresh(db, max_age_minutes):
                logger.info("Cache is stale, starting background sync")
                result = await self.full_sync(db, force=False)
                logger.info(f"Background sync completed: {result}")
            else:
                logger.debug("Cache is fresh, skipping background sync")
        except Exception as e:
            logger.error(f"Error in background sync: {str(e)}", exc_info=True)
        finally:
            # Only close the session if we created it in this function
            if not db_session and db:
                db.close()
                logger.debug("Closed new db_session in background_sync.")

    async def startup_sync(self, db: Session) -> Dict:
        """
        Perform startup sync with smart logic.
        Only syncs if cache is older than 10 minutes or doesn't exist.
        """
        try:
            # Check if we need to sync at startup
            if self.is_cache_fresh(db, max_age_minutes=10):
                logger.info("Cache is fresh at startup, skipping sync")
                return {"status": "skipped", "reason": "cache_fresh_at_startup"}
            
            # Check if we have any cached data at all
            user_count = db.query(MatrixUserCache).count()
            if user_count == 0:
                logger.info("No cached data found, performing initial sync")
                return await self.full_sync(db, force=True)
            
            # Cache exists but is stale, perform background sync
            logger.info("Cache is stale at startup, performing background sync")
            return await self.full_sync(db, force=False)
            
        except Exception as e:
            logger.error(f"Error in startup sync: {str(e)}")
            return {"status": "error", "error": str(e)}

    def get_user_count_by_room(self, db: Session, room_id: str) -> int:
        """Get cached user count for a specific room."""
        try:
            room = db.query(MatrixRoom).filter(MatrixRoom.room_id == room_id).first()
            return room.member_count if room else 0
        except Exception as e:
            logger.error(f"Error getting user count for room {room_id}: {str(e)}")
            return 0

    def compare_room_user_counts(self, db: Session) -> Dict[str, Dict]:
        """
        Compare cached user counts with actual Matrix counts for all rooms.
        Returns rooms that need syncing.
        """
        try:
            rooms = db.query(MatrixRoom).all()
            comparison_results = {}
            
            for room in rooms:
                db_count = db.query(MatrixRoomMembership).filter(
                    MatrixRoomMembership.room_id == room.room_id
                ).count()
                
                comparison_results[room.room_id] = {
                    "room_name": room.name,
                    "cached_count": room.member_count,
                    "db_membership_count": db_count,
                    "needs_sync": room.member_count != db_count,
                    "last_synced": room.last_synced
                }
            
            return comparison_results
            
        except Exception as e:
            logger.error(f"Error comparing room user counts: {str(e)}")
            return {}

# Create a global instance
matrix_cache = MatrixCacheService() 