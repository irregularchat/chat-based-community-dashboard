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
                
                # Sync rooms first using concurrent processing for speed
                room_result = await self._sync_rooms_concurrent(db, client, is_rapid_manual_sync)
                
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
        Sync Matrix rooms with smart prioritization for configured and important rooms.
        
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
            
            # Check if this is an initial sync (no rooms in database yet)
            total_rooms_in_db = db.query(MatrixRoom).count()
            is_initial_sync = total_rooms_in_db == 0
            
            if is_initial_sync:
                logger.info("Detected initial sync - will populate cache with fresh data from Matrix")
            
            # Prioritize rooms for more efficient syncing
            priority_room_ids = self._get_priority_rooms()
            configured_room_ids = self._get_configured_room_ids()
            
            # Create prioritized room list
            prioritized_rooms = []
            
            # 1. First priority: Critical functional rooms (welcome, moderation)
            for room_id in priority_room_ids:
                if room_id in room_ids:
                    prioritized_rooms.append((room_id, "critical"))
                    room_ids.remove(room_id)
            
            # 2. Second priority: Configured rooms from .env
            for room_id in configured_room_ids:
                if room_id in room_ids:
                    prioritized_rooms.append((room_id, "configured"))
                    room_ids.remove(room_id)
            
            # 3. Third priority: Remaining rooms (sorted by likely member count - larger rooms first)
            # Get existing rooms to prioritize by cached member count
            existing_rooms = {room.room_id: room.member_count for room in db.query(MatrixRoom).all()}
            remaining_rooms = sorted(room_ids, key=lambda r: existing_rooms.get(r, 0), reverse=True)
            
            for room_id in remaining_rooms:
                prioritized_rooms.append((room_id, "standard"))
            
            logger.info(f"Prioritized sync order: {len([r for r in prioritized_rooms if r[1] == 'critical'])} critical, "
                       f"{len([r for r in prioritized_rooms if r[1] == 'configured'])} configured, "
                       f"{len([r for r in prioritized_rooms if r[1] == 'standard'])} standard rooms")
            
            # Set time limits for different priority levels during manual sync
            sync_start_time = datetime.utcnow()
            max_sync_time_minutes = 10 if is_rapid_manual_sync else 30  # Limit sync time
            
            for room_id, priority_type in prioritized_rooms:
                # Check time limits for non-critical rooms
                elapsed_minutes = (datetime.utcnow() - sync_start_time).total_seconds() / 60
                if priority_type == "standard" and elapsed_minutes > max_sync_time_minutes:
                    logger.info(f"Time limit reached ({max_sync_time_minutes}min), skipping remaining {len(prioritized_rooms) - prioritized_rooms.index((room_id, priority_type))} standard rooms")
                    break
                elif priority_type == "configured" and elapsed_minutes > (max_sync_time_minutes * 0.8):
                    logger.info(f"Time limit approaching ({elapsed_minutes:.1f}min), skipping remaining standard rooms after configured rooms")
                    # Continue with configured rooms but skip standard rooms
                    prioritized_rooms = [r for r in prioritized_rooms if r[1] in ["critical", "configured"] or prioritized_rooms.index(r) <= prioritized_rooms.index((room_id, priority_type))]
                try:
                    # Get room details from Matrix (skip member count only for efficiency syncs)
                    skip_expensive_calls = not (is_initial_sync or is_rapid_manual_sync)
                    room_details = await get_room_details_async(client, room_id, skip_member_count=skip_expensive_calls)
                    
                    # Get current room from database
                    existing_room = db.query(MatrixRoom).filter(
                        MatrixRoom.room_id == room_id
                    ).first()
                    
                    # Handle member count logic based on sync type
                    if is_initial_sync or is_rapid_manual_sync:
                        # During initial sync or manual sync, always get fresh data
                        current_member_count = room_details.get("member_count", 0)
                        logger.debug(f"Using fresh member count for {room_id}: {current_member_count}")
                    else:
                        # For subsequent automatic syncs, try to use cached data for efficiency
                        try:
                            from app.db.operations import get_matrix_room_member_count
                            cached_member_count = get_matrix_room_member_count(db, room_id)
                            if cached_member_count > 0 and existing_room:
                                # Use cached count if it's reliable and room hasn't changed much
                                if abs(existing_room.member_count - cached_member_count) < 2:
                                    logger.debug(f"Skipping room {room_id} - cached count stable ({cached_member_count})")
                                    rooms_skipped += 1
                                    continue
                                else:
                                    # Use the existing room's member count (from previous sync)
                                    current_member_count = existing_room.member_count
                                    logger.debug(f"Using existing room member count for {room_id}: {current_member_count}")
                            else:
                                # No reliable cached data, need to get fresh member count
                                if skip_expensive_calls:
                                    # We skipped the expensive call but need member count
                                    room_details = await get_room_details_async(client, room_id, skip_member_count=False)
                                current_member_count = room_details.get("member_count", 0)
                                logger.debug(f"Using fresh member count for {room_id}: {current_member_count}")
                        except Exception as cache_error:
                            logger.debug(f"Error with cached data for {room_id}: {cache_error}, using existing or fresh data")
                            if existing_room:
                                current_member_count = existing_room.member_count
                            else:
                                if skip_expensive_calls:
                                    room_details = await get_room_details_async(client, room_id, skip_member_count=False)
                                current_member_count = room_details.get("member_count", 0)
                    
                    # Skip rooms with fewer than minimum members (but not critical/configured rooms)
                    if current_member_count <= Config.MATRIX_MIN_ROOM_MEMBERS and priority_type == "standard":
                        logger.info(f"Skipping room {room_id} - only {current_member_count} members (minimum: {Config.MATRIX_MIN_ROOM_MEMBERS})")
                        rooms_skipped += 1
                        continue
                    elif current_member_count <= Config.MATRIX_MIN_ROOM_MEMBERS and priority_type in ["critical", "configured"]:
                        logger.info(f"Syncing {priority_type} room {room_id} despite low member count ({current_member_count})")
                    
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

    async def _sync_single_room(self, client, room_id: str, priority_type: str, db: Session, is_initial_sync: bool, is_rapid_manual_sync: bool) -> Dict:
        """
        Sync a single room concurrently.
        
        Args:
            client: Matrix client
            room_id: Room ID to sync
            priority_type: Priority type (critical, configured, standard)
            db: Database session
            is_initial_sync: Whether this is an initial sync
            is_rapid_manual_sync: Whether this is a rapid manual sync
            
        Returns:
            Dict with sync results for this room
        """
        try:
            from app.utils.matrix_actions import get_room_details_async
            
            # Get room details from Matrix (skip member count only for efficiency syncs)
            skip_expensive_calls = not (is_initial_sync or is_rapid_manual_sync)
            room_details = await get_room_details_async(client, room_id, skip_member_count=skip_expensive_calls)
            
            # Get current room from database
            existing_room = db.query(MatrixRoom).filter(
                MatrixRoom.room_id == room_id
            ).first()
            
            # Handle member count logic based on sync type
            if is_initial_sync or is_rapid_manual_sync:
                # During initial sync or manual sync, always get fresh data
                current_member_count = room_details.get("member_count", 0)
            else:
                # For subsequent automatic syncs, try to use cached data for efficiency
                try:
                    from app.db.operations import get_matrix_room_member_count
                    cached_member_count = get_matrix_room_member_count(db, room_id)
                    if cached_member_count > 0 and existing_room:
                        # Use cached count if it's reliable and room hasn't changed much
                        if abs(existing_room.member_count - cached_member_count) < 2:
                            return {"room_id": room_id, "status": "skipped", "reason": "stable_count"}
                        else:
                            # Use the existing room's member count (from previous sync)
                            current_member_count = existing_room.member_count
                    else:
                        # No reliable cached data, need to get fresh member count
                        if skip_expensive_calls:
                            # We skipped the expensive call but need member count
                            room_details = await get_room_details_async(client, room_id, skip_member_count=False)
                        current_member_count = room_details.get("member_count", 0)
                except Exception as cache_error:
                    if existing_room:
                        current_member_count = existing_room.member_count
                    else:
                        if skip_expensive_calls:
                            room_details = await get_room_details_async(client, room_id, skip_member_count=False)
                        current_member_count = room_details.get("member_count", 0)
            
            # Skip rooms with fewer than minimum members (but not critical/configured rooms)
            if current_member_count <= Config.MATRIX_MIN_ROOM_MEMBERS and priority_type == "standard":
                return {"room_id": room_id, "status": "skipped", "reason": "low_member_count", "member_count": current_member_count}
            elif current_member_count <= Config.MATRIX_MIN_ROOM_MEMBERS and priority_type in ["critical", "configured"]:
                logger.info(f"Syncing {priority_type} room {room_id} despite low member count ({current_member_count})")
            
            # Smart sync logic: skip if member count hasn't changed (unless rapid manual sync)
            if existing_room and not is_rapid_manual_sync:
                if existing_room.member_count == current_member_count:
                    return {"room_id": room_id, "status": "skipped", "reason": "unchanged_count"}
            
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
                    last_synced=datetime.utcnow()
                )
                db.add(new_room)
            
            return {"room_id": room_id, "status": "synced", "member_count": current_member_count, "priority": priority_type}
            
        except Exception as e:
            logger.error(f"Error syncing room {room_id}: {str(e)}")
            return {"room_id": room_id, "status": "error", "error": str(e)}

    async def _sync_rooms_concurrent(self, db: Session, client, is_rapid_manual_sync: bool = False) -> Dict:
        """
        Sync Matrix rooms with concurrent processing for speed.
        
        Args:
            db: Database session
            client: Matrix client
            is_rapid_manual_sync: Whether this is a rapid manual sync
            
        Returns:
            Dict with sync results
        """
        try:
            from app.utils.matrix_actions import get_joined_rooms_async
            
            # Get joined rooms from Matrix
            room_ids = await get_joined_rooms_async(client)
            if not room_ids:
                return {"rooms_synced": 0}
            
            # Check if this is an initial sync (no rooms in database yet)
            total_rooms_in_db = db.query(MatrixRoom).count()
            is_initial_sync = total_rooms_in_db == 0
            
            if is_initial_sync:
                logger.info("Detected initial sync - will populate cache with fresh data from Matrix")
            
            # Prioritize rooms for more efficient syncing
            priority_room_ids = self._get_priority_rooms()
            configured_room_ids = self._get_configured_room_ids()
            
            # Create prioritized room list
            critical_rooms = [(room_id, "critical") for room_id in priority_room_ids if room_id in room_ids]
            configured_rooms = [(room_id, "configured") for room_id in configured_room_ids if room_id in room_ids and room_id not in priority_room_ids]
            
            # For standard rooms, only process a limited number concurrently to avoid overwhelming the server
            remaining_room_ids = [rid for rid in room_ids if rid not in priority_room_ids and rid not in configured_room_ids]
            existing_rooms = {room.room_id: room.member_count for room in db.query(MatrixRoom).all()}
            
            # Sort remaining rooms by cached member count and take only top N for concurrent processing
            max_standard_rooms = 20 if is_rapid_manual_sync else 50  # Limit concurrent standard rooms
            sorted_remaining = sorted(remaining_room_ids, key=lambda r: existing_rooms.get(r, 0), reverse=True)[:max_standard_rooms]
            standard_rooms = [(room_id, "standard") for room_id in sorted_remaining]
            
            logger.info(f"Concurrent sync: {len(critical_rooms)} critical, {len(configured_rooms)} configured, "
                       f"{len(standard_rooms)} standard rooms (limited from {len(remaining_room_ids)} total)")
            
            # Process rooms in batches with concurrency limits
            semaphore = asyncio.Semaphore(10)  # Limit concurrent requests to Matrix server
            
            async def sync_room_with_limit(room_id, priority_type):
                async with semaphore:
                    return await self._sync_single_room(client, room_id, priority_type, db, is_initial_sync, is_rapid_manual_sync)
            
            # Process critical rooms first (small batch, high priority)
            critical_results = []
            if critical_rooms:
                critical_tasks = [sync_room_with_limit(room_id, priority) for room_id, priority in critical_rooms]
                critical_results = await asyncio.gather(*critical_tasks, return_exceptions=True)
                # Commit critical rooms immediately
                db.commit()
                logger.info(f"Critical rooms synced: {len([r for r in critical_results if isinstance(r, dict) and r.get('status') == 'synced'])}")
            
            # Process configured rooms second (medium batch)
            configured_results = []
            if configured_rooms:
                configured_tasks = [sync_room_with_limit(room_id, priority) for room_id, priority in configured_rooms]
                configured_results = await asyncio.gather(*configured_tasks, return_exceptions=True)
                # Commit configured rooms
                db.commit()
                logger.info(f"Configured rooms synced: {len([r for r in configured_results if isinstance(r, dict) and r.get('status') == 'synced'])}")
            
            # Process standard rooms last (larger batch, lower priority)
            standard_results = []
            if standard_rooms:
                standard_tasks = [sync_room_with_limit(room_id, priority) for room_id, priority in standard_rooms]
                standard_results = await asyncio.gather(*standard_tasks, return_exceptions=True)
                # Commit standard rooms
                db.commit()
                logger.info(f"Standard rooms synced: {len([r for r in standard_results if isinstance(r, dict) and r.get('status') == 'synced'])}")
            
            # Count results
            all_results = critical_results + configured_results + standard_results
            rooms_synced = len([r for r in all_results if isinstance(r, dict) and r.get('status') == 'synced'])
            rooms_skipped = len([r for r in all_results if isinstance(r, dict) and r.get('status') == 'skipped'])
            rooms_error = len([r for r in all_results if isinstance(r, dict) and r.get('status') == 'error'])
            
            logger.info(f"Concurrent room sync completed: {rooms_synced} synced, {rooms_skipped} skipped, {rooms_error} errors")
            
            return {
                "rooms_synced": rooms_synced,
                "rooms_skipped": rooms_skipped,
                "rooms_error": rooms_error,
                "critical_synced": len([r for r in critical_results if isinstance(r, dict) and r.get('status') == 'synced']),
                "configured_synced": len([r for r in configured_results if isinstance(r, dict) and r.get('status') == 'synced']),
                "standard_synced": len([r for r in standard_results if isinstance(r, dict) and r.get('status') == 'synced'])
            }
            
        except Exception as e:
            logger.error(f"Error in _sync_rooms_concurrent: {str(e)}")
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
            # Get all rooms to sync memberships for, with prioritization
            all_rooms = db.query(MatrixRoom).all()
            
            # Prioritize rooms for membership sync too
            priority_room_ids = self._get_priority_rooms()
            configured_room_ids = self._get_configured_room_ids()
            
            # Create prioritized room list for memberships
            prioritized_rooms = []
            
            # Group rooms by priority
            rooms_by_id = {room.room_id: room for room in all_rooms}
            
            # 1. Critical rooms first
            for room_id in priority_room_ids:
                if room_id in rooms_by_id:
                    prioritized_rooms.append((rooms_by_id[room_id], "critical"))
                    del rooms_by_id[room_id]
            
            # 2. Configured rooms second
            for room_id in configured_room_ids:
                if room_id in rooms_by_id:
                    prioritized_rooms.append((rooms_by_id[room_id], "configured"))
                    del rooms_by_id[room_id]
            
            # 3. Remaining rooms ordered by member count (largest first)
            remaining_rooms = sorted(rooms_by_id.values(), key=lambda r: r.member_count, reverse=True)
            for room in remaining_rooms:
                prioritized_rooms.append((room, "standard"))
            
            logger.info(f"Membership sync prioritized: {len([r for r in prioritized_rooms if r[1] == 'critical'])} critical, "
                       f"{len([r for r in prioritized_rooms if r[1] == 'configured'])} configured, "
                       f"{len([r for r in prioritized_rooms if r[1] == 'standard'])} standard rooms")
            
            users_synced = 0
            memberships_synced = 0
            rooms_skipped = 0
            
            for room, priority_type in prioritized_rooms:
                try:
                    # Skip rooms with fewer than minimum members (but not critical/configured rooms)
                    if room.member_count <= Config.MATRIX_MIN_ROOM_MEMBERS and priority_type == "standard":
                        logger.info(f"Skipping membership sync for {room.room_id} - only {room.member_count} members (minimum: {Config.MATRIX_MIN_ROOM_MEMBERS})")
                        rooms_skipped += 1
                        continue
                    elif room.member_count <= Config.MATRIX_MIN_ROOM_MEMBERS and priority_type in ["critical", "configured"]:
                        logger.info(f"Syncing {priority_type} room {room.room_id} membership despite low member count ({room.member_count})")
                    
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
    
    async def sync_indoc_room_only(self, db: Session) -> Dict:
        """
        Sync only the INDOC/Entry room for immediate user creation needs.
        This is the fastest possible sync focused on the entry room where new users appear.
        
        Args:
            db: Database session
            
        Returns:
            Dict with sync results
        """
        try:
            from app.utils.matrix_actions import get_matrix_client, get_room_members_async
            
            if not Config.MATRIX_ACTIVE:
                return {"status": "error", "error": "Matrix not active"}
            
            # Use the welcome room as the INDOC room
            indoc_room_id = Config.MATRIX_WELCOME_ROOM_ID
            if not indoc_room_id:
                return {"status": "error", "error": "INDOC room (MATRIX_WELCOME_ROOM_ID) not configured"}
            
            client = await get_matrix_client()
            if not client:
                return {"status": "error", "error": "Failed to get Matrix client"}
            
            try:
                logger.info(f"Fast INDOC room sync: {indoc_room_id}")
                
                # Get room members with short timeout for speed
                try:
                    members_data = await asyncio.wait_for(
                        get_room_members_async(client, indoc_room_id), 
                        timeout=3.0  # Very short timeout for user creation workflow
                    )
                except asyncio.TimeoutError:
                    logger.warning("INDOC room sync timeout - using cached data")
                    return {"status": "timeout", "room_id": indoc_room_id}
                
                if not members_data:
                    return {"status": "no_members", "room_id": indoc_room_id}
                
                # Convert to list format
                members = []
                for user_id, details in members_data.items():
                    members.append({
                        "user_id": user_id,
                        "display_name": details.get("display_name", ""),
                        "avatar_url": details.get("avatar_url", "")
                    })
                
                users_synced = 0
                
                # Quick batch update of users and memberships
                for member in members:
                    user_id = member.get("user_id")
                    if not user_id:
                        continue
                    
                    # Use merge for atomic upsert
                    user = MatrixUser(
                        user_id=user_id,
                        display_name=member.get("display_name", user_id.split(':')[0].lstrip('@')),
                        last_seen=datetime.utcnow()
                    )
                    db.merge(user)
                    
                    # Update membership
                    membership = MatrixRoomMembership(
                        user_id=user_id,
                        room_id=indoc_room_id,
                        membership_status='join',
                        joined_at=datetime.utcnow()
                    )
                    db.merge(membership)
                    users_synced += 1
                
                # Update room info
                room = MatrixRoom(
                    room_id=indoc_room_id,
                    name="INDOC Entry Room",
                    display_name="IrregularChat Entry/INDOC",
                    topic="Entry room for new user verification and processing",
                    member_count=len(members),
                    room_type="public",
                    is_direct=False,
                    last_synced=datetime.utcnow()
                )
                db.merge(room)
                
                db.commit()
                
                logger.info(f"INDOC room sync completed: {users_synced} users updated in {indoc_room_id}")
                return {
                    "status": "completed",
                    "sync_type": "indoc_only", 
                    "users_synced": users_synced,
                    "room_id": indoc_room_id
                }
                
            finally:
                await client.close()
                
        except Exception as e:
            logger.error(f"Error in sync_indoc_room_only: {str(e)}")
            return {"status": "error", "error": str(e)}

    async def lightweight_sync(self, db: Session, max_age_minutes: int = 30) -> Dict:
        """
        Perform a lightweight sync that focuses on the INDOC room for user creation.
        This is now a wrapper around sync_indoc_room_only for faster user processing.
        
        Args:
            db: Database session
            max_age_minutes: Maximum age in minutes before triggering sync
            
        Returns:
            Dict with sync results
        """
        try:
            # For user creation workflow, we only need the INDOC room
            # Skip cache freshness check since user creation is immediate
            logger.info("Lightweight sync: focusing on INDOC room only")
            return await self.sync_indoc_room_only(db)
            
        except Exception as e:
            logger.error(f"Error in lightweight_sync: {str(e)}")
            return {"status": "error", "error": str(e)}

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

    async def background_concurrent_sync(self, db_session: Optional[Session] = None):
        """
        Run a fast concurrent background sync of configured and important rooms.
        This runs after INDOC room sync to populate fallback data without blocking user creation.
        """
        db = None
        try:
            if db_session:
                db = db_session
            else:
                from app.db.session import get_db
                db = next(get_db())

            from app.utils.matrix_actions import get_matrix_client
            
            if not Config.MATRIX_ACTIVE:
                return {"status": "error", "error": "Matrix not active"}
            
            client = await get_matrix_client()
            if not client:
                return {"status": "error", "error": "Failed to get Matrix client"}
            
            try:
                logger.info("Starting background concurrent sync for configured rooms")
                
                # Only sync configured rooms in background for faster fallback data
                configured_room_ids = self._get_configured_room_ids()
                
                if not configured_room_ids:
                    logger.info("No configured rooms to sync in background")
                    return {"status": "skipped", "reason": "no_configured_rooms"}
                
                # Limit to configured rooms only for background sync
                semaphore = asyncio.Semaphore(5)  # Lower concurrency for background
                
                async def sync_room_with_limit(room_id):
                    async with semaphore:
                        return await self._sync_single_room(client, room_id, "configured", db, False, False)
                
                # Process configured rooms concurrently in background
                tasks = [sync_room_with_limit(room_id) for room_id in configured_room_ids[:10]]  # Limit to first 10 for speed
                results = await asyncio.gather(*tasks, return_exceptions=True)
                
                # Commit results
                db.commit()
                
                synced_count = len([r for r in results if isinstance(r, dict) and r.get('status') == 'synced'])
                logger.info(f"Background concurrent sync completed: {synced_count} configured rooms synced")
                
                return {
                    "status": "completed",
                    "sync_type": "background_concurrent",
                    "rooms_synced": synced_count
                }
                
            finally:
                await client.close()
                
        except Exception as e:
            logger.error(f"Error in background concurrent sync: {str(e)}")
            return {"status": "error", "error": str(e)}
        finally:
            # Only close the session if we created it in this function
            if not db_session and db:
                db.close()

    async def startup_sync(self, db: Session) -> Dict:
        """
        Perform startup sync with smart logic.
        Only syncs if cache is older than 10 minutes or doesn't exist.
        """
        from app.utils.matrix_actions import get_matrix_client, close_matrix_client_properly
        client = None
        
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
            result = await self.full_sync(db, force=False)
            return result
            
        except Exception as e:
            logger.error(f"Error in startup sync: {str(e)}")
            return {"status": "error", "error": str(e)}
        finally:
            # Make sure to close any client sessions
            if hasattr(self, 'session') and self.session is not None:
                try:
                    await self.session.close()
                    logger.info("Closed matrix cache client session")
                except Exception as e:
                    logger.error(f"Error closing matrix cache client session: {e}")
                self.session = None

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

    def _get_priority_rooms(self) -> List[str]:
        """Get list of critical/priority room IDs that should be synced first."""
        priority_rooms = []
        
        # Welcome room (critical for user creation)
        if hasattr(Config, 'MATRIX_WELCOME_ROOM_ID') and Config.MATRIX_WELCOME_ROOM_ID:
            priority_rooms.append(Config.MATRIX_WELCOME_ROOM_ID)
        
        # Default room (often used for general communications)
        if hasattr(Config, 'MATRIX_DEFAULT_ROOM_ID') and Config.MATRIX_DEFAULT_ROOM_ID:
            priority_rooms.append(Config.MATRIX_DEFAULT_ROOM_ID)
        
        # Signal bridge room (important for Signal integration)
        if hasattr(Config, 'MATRIX_SIGNAL_BRIDGE_ROOM_ID') and Config.MATRIX_SIGNAL_BRIDGE_ROOM_ID:
            priority_rooms.append(Config.MATRIX_SIGNAL_BRIDGE_ROOM_ID)
        
        return list(set(priority_rooms))  # Remove duplicates
    
    def _get_configured_room_ids(self) -> List[str]:
        """Get list of configured room IDs from environment variables."""
        try:
            configured_rooms = Config.get_configured_rooms()
            return [room.get('room_id') for room in configured_rooms if room.get('room_id')]
        except Exception as e:
            logger.error(f"Error getting configured room IDs: {e}")
            return []

# Create a global instance
matrix_cache = MatrixCacheService() 