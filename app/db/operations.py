from sqlalchemy import cast, String, func
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import logging
from app.utils.config import Config
from app.db.models import User, AdminEvent, MatrixRoomMember, MatrixRoomMembership, VerificationCode, UserNote, ModeratorPermission
from app.db.database import get_db

def sync_user_data(db: Session, authentik_users: List[Dict[str, Any]]):
    """
    Sync users from Authentik to local database.
    """
    try:
        if not isinstance(authentik_users, list):
            raise ValueError("authentik_users must be a list")

        for auth_user in authentik_users:
            if not isinstance(auth_user, dict):
                logging.warning(f"Skipping invalid user data: {auth_user}")
                continue
                
            username = auth_user.get('username')
            if not username:
                continue

            # Try to find existing user by username
            existing_user = None
            try:
                existing_user = db.query(User).filter_by(username=username).first()
            except Exception as e:
                logging.warning(f"Error querying for existing user: {e}")

            if existing_user:
                # Update existing user
                existing_user.email = auth_user.get('email', existing_user.email)
                existing_user.first_name = auth_user.get('first_name', existing_user.first_name)
                existing_user.last_name = auth_user.get('last_name', existing_user.last_name)
                existing_user.is_active = auth_user.get('is_active', existing_user.is_active)
                existing_user.authentik_id = str(auth_user.get('pk', existing_user.authentik_id))
            else:
                # Create new user
                new_user = User(
                    username=username,
                    email=auth_user.get('email', ''),
                    first_name=auth_user.get('first_name', ''),
                    last_name=auth_user.get('last_name', ''),
                    is_active=auth_user.get('is_active', True),
                    authentik_id=str(auth_user.get('pk', ''))
                )
                try:
                    db.add(new_user)
                except Exception as e:
                    logging.error(f"Error adding new user: {e}")
                    raise

        try:
            db.commit()
        except Exception as e:
            logging.error(f"Error committing changes: {e}")
            if hasattr(db, 'rollback'):
                db.rollback()
            raise

        return True

    except Exception as e:
        logging.error(f"Error syncing users: {e}")
        if hasattr(db, 'rollback'):
            db.rollback()
        return False

def search_users(db: Session, search_term: str, filters: Dict[str, Any] = None) -> List[User]:
    """
    Search users in the database with enhanced filtering options.
    
    Args:
        db (Session): Database session
        search_term (str): Text to search for in user fields
        filters (Dict[str, Any], optional): Additional filters to apply
            - status: 'active', 'inactive', or None for all
            - group_id: Filter by group membership
            - admin_only: True to only return admin users
            - sort_by: Field to sort by
            - sort_order: 'asc' or 'desc'
    
    Returns:
        List[User]: List of matching users
    """
    # Initialize filters if not provided
    if filters is None:
        filters = {}
    
    # Build the query
    query = db.query(User)
    
    # Apply search term if provided
    if search_term:
        # Parse search terms
        search_filters = {}
        terms = search_term.split()
        general_terms = []
        
        for term in terms:
            if ':' in term:
                column, value = term.split(':', 1)
                search_filters[column.lower()] = value.lower()
            else:
                general_terms.append(term.lower())

        # Apply column-specific filters
        for column, value in search_filters.items():
            if column == 'username':
                query = query.filter(User.username.ilike(f'%{value}%'))
            elif column == 'name':
                query = query.filter(User.first_name.ilike(f'%{value}%') | User.last_name.ilike(f'%{value}%'))
            elif column == 'email':
                query = query.filter(User.email.ilike(f'%{value}%'))
            elif column in ['intro', 'invited_by']:
                # Cast JSON to string before searching
                query = query.filter(
                    cast(User.attributes[column], String).ilike(f'%{value}%')
                )

        # Apply general search terms across all fields
        for term in general_terms:
            query = query.filter(
                (User.username.ilike(f'%{term}%')) |
                (User.first_name.ilike(f'%{term}%')) |
                (User.last_name.ilike(f'%{term}%')) |
                (User.email.ilike(f'%{term}%')) |
                # Cast JSON to string before searching
                (cast(User.attributes['intro'], String).ilike(f'%{term}%')) |
                (cast(User.attributes['invited_by'], String).ilike(f'%{term}%'))
            )
    
    # Apply status filter
    if 'status' in filters:
        if filters['status'] == 'active':
            query = query.filter(User.is_active == True)
        elif filters['status'] == 'inactive':
            query = query.filter(User.is_active == False)
    
    # Apply admin filter
    if filters.get('admin_only'):
        query = query.filter(User.is_admin == True)
    
    # Apply sorting
    sort_by = filters.get('sort_by', 'username')
    sort_order = filters.get('sort_order', 'asc')
    
    if sort_by == 'username':
        query = query.order_by(User.username.asc() if sort_order == 'asc' else User.username.desc())
    elif sort_by == 'name':
        query = query.order_by(User.first_name.asc() if sort_order == 'asc' else User.first_name.desc())
    elif sort_by == 'email':
        query = query.order_by(User.email.asc() if sort_order == 'asc' else User.email.desc())
    elif sort_by == 'date_joined':
        query = query.order_by(User.date_joined.asc() if sort_order == 'asc' else User.date_joined.desc())
    elif sort_by == 'last_login':
        query = query.order_by(User.last_login.asc() if sort_order == 'asc' else User.last_login.desc())
    
    # Execute the query
    users = query.all()
    
    # Apply group filter if provided (this can't be done directly in the query)
    if 'group_id' in filters and filters['group_id']:
        # This would require integration with Authentik API to check group membership
        # For now, we'll return all users and let the caller filter by group
        pass
    
    return users

def add_admin_event(db: Session, event_type: str, username: str, details: str, timestamp: datetime) -> AdminEvent:
    """Add a new admin event to the database"""
    event = AdminEvent(
        event_type=event_type,
        username=username,
        details=details,
        timestamp=timestamp
    )
    db.add(event)
    db.commit()
    return event

def create_admin_event(db: Session, event_type: str, username: str, details: str = None, description: str = None) -> AdminEvent:
    """
    Create a new admin event in the database with enhanced formatting and emoji support.
    Alias for add_admin_event for backward compatibility.
    
    Args:
        db (Session): Database session
        event_type (str): Type of admin event
        username (str): Username associated with the event
        details (str, optional): Event details
        description (str, optional): Alternative to details parameter for backward compatibility
        
    Returns:
        AdminEvent: The created admin event, or None if event should be skipped
    """
    # Use details if provided, otherwise use description, or empty string as fallback
    event_details = details if details is not None else (description or "")
    
    # Enhanced formatting with emojis and display name resolution
    formatted_details = _format_admin_event_details(db, event_type, event_details)
    
    # If formatting returns None, skip this event
    if formatted_details is None:
        return None
    
    return add_admin_event(db, event_type, username, formatted_details, datetime.now())

def _format_admin_event_details(db: Session, event_type: str, details: str) -> str:
    """
    Format admin event details with emojis and improved readability.
    
    Args:
        db (Session): Database session for display name lookups
        event_type (str): Type of admin event
        details (str): Original event details
        
    Returns:
        str: Formatted details with emojis and display names
    """
    # Event type to emoji mapping
    event_emojis = {
        'user_removal': '🚫',
        'direct_message': '💬',
        'system_sync': '🔄',
        'admin_granted': '👑',
        'admin_promoted': '⬆️',
        'admin_demoted': '⬇️',
        'moderator_promoted': '🛡️',
        'moderator_demoted': '📉',
        'user_created': '👤',
        'user_updated': '✏️',
        'signal_identity_updated': '📱',
        'matrix_user_connected': '🔗',
        'room_invitation': '📨',
        'room_creation': '🏠',
        'permission_granted': '✅',
        'permission_revoked': '❌',
        'login': '🔐',
        'logout': '🚪',
        'password_changed': '🔑',
        'email_verified': '📧',
        'account_activated': '🟢',
        'account_deactivated': '🔴',
        'bulk_operation': '📦',
        'data_export': '📤',
        'data_import': '📥',
        'backup_created': '💾',
        'system_maintenance': '🔧',
        'security_alert': '🚨',
        'configuration_changed': '⚙️'
    }
    
    # Get emoji for event type
    emoji = event_emojis.get(event_type, '📝')
    
    # Skip formatting for certain event types that should be filtered out
    if event_type == 'system_sync' and 'Incremental sync of' in details and 'users from Authentik' in details:
        return None  # Signal to skip this event
    
    # Check if formatting has already been applied (starts with an emoji)
    if details and len(details) > 0 and ord(details[0]) > 127:  # Unicode emoji range
        return details  # Already formatted, return as-is
    
    # Resolve signal UUIDs to display names
    formatted_details = _resolve_signal_display_names(db, details)
    
    # Add emoji prefix
    formatted_details = f"{emoji} {formatted_details}"
    
    # Apply specific formatting rules based on event type
    if event_type == 'user_removal':
        # Extract reason if present
        if 'Reason:' in formatted_details:
            parts = formatted_details.split('Reason:')
            if len(parts) == 2:
                action_part = parts[0].strip()
                reason_part = parts[1].strip()
                formatted_details = f"{action_part} • Reason: {reason_part}"
    
    elif event_type == 'direct_message':
        # Make direct message events more readable
        if 'Direct messaged' in formatted_details:
            formatted_details = formatted_details.replace('Direct messaged', 'Sent direct message to')
    
    elif event_type == 'system_sync':
        # Improve system sync messages
        if 'Full sync' in formatted_details:
            formatted_details = formatted_details.replace('Full sync', 'Complete user synchronization')
        elif 'Incremental sync' in formatted_details:
            formatted_details = formatted_details.replace('Incremental sync', 'User data update')
    
    return formatted_details

def _resolve_signal_display_names(db: Session, details: str) -> str:
    """
    Resolve signal UUIDs in event details to display names.
    
    Args:
        db (Session): Database session
        details (str): Event details that may contain signal UUIDs
        
    Returns:
        str: Details with UUIDs replaced by display names where possible
    """
    import re
    
    # Pattern to match signal UUIDs (with or without @ prefix and domain)
    uuid_pattern = r'@?signal_([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?::[a-zA-Z0-9.-]+)?'
    
    def replace_uuid_with_display_name(match):
        full_match = match.group(0)
        uuid_part = match.group(1)
        
        try:
            # Try to find display name in Matrix cache
            from app.db.models import MatrixUser
            
            # Try exact match first
            matrix_user = db.query(MatrixUser).filter(
                MatrixUser.user_id.like(f'%signal_{uuid_part}%')
            ).first()
            
            if matrix_user and matrix_user.display_name:
                return matrix_user.display_name
            
            # Fallback: try to find in MatrixUserCache
            from app.db.models import MatrixUserCache
            cached_user = db.query(MatrixUserCache).filter(
                MatrixUserCache.user_id.like(f'%signal_{uuid_part}%')
            ).first()
            
            if cached_user and cached_user.display_name:
                return cached_user.display_name
            
            # If no display name found, return a cleaner format
            return f"signal_{uuid_part[:8]}..."  # Show first 8 chars of UUID
            
        except Exception as e:
            # If any error occurs, return the original match
            return full_match
    
    # Replace all UUID matches with display names
    formatted_details = re.sub(uuid_pattern, replace_uuid_with_display_name, details)
    
    return formatted_details

def sync_user_data_incremental(db: Session, authentik_users: List[Dict[str, Any]], full_sync=False):
    """
    Sync users from Authentik to the local database incrementally.
    
    This function is optimized for large user bases by:
    1. Only updating users that have changed
    2. Using bulk operations where possible
    3. Processing in batches to avoid memory issues
    
    Args:
        db: Database session
        authentik_users: List of user data from Authentik API
        full_sync: If True, perform a full sync including deletion of users not in Authentik
    """
    try:
        start_time = datetime.now()
        total_users = len(authentik_users)
        new_count = 0
        updated_count = 0
        unchanged_count = 0
        deleted_count = 0
        
        # Create a dictionary of Authentik users by ID for faster lookups
        authentik_users_by_id = {str(user.get('pk')): user for user in authentik_users}
        authentik_users_by_username = {user.get('username'): user for user in authentik_users}
        
        # Get all existing users from the database
        existing_users = db.query(User).all()
        existing_user_map = {user.authentik_id: user for user in existing_users if user.authentik_id}
        existing_username_map = {user.username: user for user in existing_users}
        
        # Process users in batches
        batch_size = 100
        processed = 0
        
        # First pass: Update existing users and add new ones
        for i in range(0, total_users, batch_size):
            batch = authentik_users[i:min(i+batch_size, total_users)]
            batch_updates = []
            batch_new = []
            
            for authentik_user in batch:
                authentik_id = str(authentik_user.get('pk'))
                username = authentik_user.get('username')
                
                # Skip if no username or ID
                if not username or not authentik_id:
                    continue
                
                # Check if user exists by Authentik ID
                existing_user = existing_user_map.get(authentik_id)
                
                # If not found by ID, try by username
                if not existing_user and username in existing_username_map:
                    existing_user = existing_username_map[username]
                    # Update the Authentik ID if found by username
                    existing_user.authentik_id = authentik_id
                
                # Handle last_login conversion for both update and create cases
                last_login = authentik_user.get('last_login')
                if isinstance(last_login, str):
                    try:
                        last_login = datetime.fromisoformat(last_login.replace('Z', '+00:00'))
                    except (ValueError, TypeError):
                        last_login = None
                
                # Update existing user
                if existing_user:
                    # Check if user data has changed before updating
                    first_name = authentik_user.get('first_name', '')
                    last_name = authentik_user.get('last_name', '')
                    email = authentik_user.get('email', '')
                    is_active = authentik_user.get('is_active', True)
                    attributes = authentik_user.get('attributes', {})
                    
                    # Check if any field has changed
                    if (existing_user.first_name != first_name or 
                        existing_user.last_name != last_name or 
                        existing_user.email != email or 
                        existing_user.is_active != is_active or 
                        existing_user.last_login != last_login or 
                        existing_user.attributes != attributes):
                        
                        # Update the user
                        existing_user.first_name = first_name
                        existing_user.last_name = last_name
                        existing_user.email = email
                        existing_user.is_active = is_active
                        existing_user.last_login = last_login
                        existing_user.attributes = attributes
                        batch_updates.append(existing_user)
                        updated_count += 1
                    else:
                        unchanged_count += 1
                
                # Create new user
                else:
                    # For new users, ensure a proper datetime object for last_login
                    new_user = User(
                        username=username,
                        first_name=authentik_user.get('first_name', ''),
                        last_name=authentik_user.get('last_name', ''),
                        email=authentik_user.get('email', ''),
                        is_active=authentik_user.get('is_active', True),
                        last_login=last_login,  # Already converted to datetime above
                        attributes=authentik_user.get('attributes', {}),
                        authentik_id=authentik_id
                    )
                    batch_new.append(new_user)
                    new_count += 1
            
            # Commit updates in batches
            if batch_updates:
                db.bulk_save_objects(batch_updates, update_changed_only=True)
            
            # Add new users in batches
            if batch_new:
                db.bulk_save_objects(batch_new)
            
            # Commit after each batch
            db.commit()
            
            processed += len(batch)
            logging.info(f"Processed {processed}/{total_users} users ({new_count} new, {updated_count} updated)")
        
        # Second pass: Delete users not in Authentik (only if full_sync is True)
        if full_sync:
            # Get all users from the database again (to include newly added ones)
            all_db_users = db.query(User).all()
            
            # Find users in the database that are not in Authentik
            users_to_delete = []
            for db_user in all_db_users:
                # Skip users without an Authentik ID (they might be local-only users)
                if not db_user.authentik_id:
                    continue
                
                # If the user is not in Authentik, mark for deletion
                if db_user.authentik_id not in authentik_users_by_id and db_user.username not in authentik_users_by_username:
                    users_to_delete.append(db_user)
            
            # Delete users in batches
            for i in range(0, len(users_to_delete), batch_size):
                batch = users_to_delete[i:min(i+batch_size, len(users_to_delete))]
                for user in batch:
                    db.delete(user)
                
                db.commit()
                deleted_count += len(batch)
                logging.info(f"Deleted {deleted_count} users not found in Authentik")
        
        # Log summary
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        logging.info(f"Incremental sync completed in {duration:.2f} seconds:")
        logging.info(f"- {new_count} new users added")
        logging.info(f"- {updated_count} users updated")
        logging.info(f"- {unchanged_count} users unchanged")
        if full_sync:
            logging.info(f"- {deleted_count} users deleted")
        
        return True
    except Exception as e:
        logging.error(f"Error in incremental sync: {e}")
        db.rollback()
        return False 

def get_user_metrics(db_session):
    """Get user metrics from the database"""
    now = datetime.now().astimezone()
    thirty_days_ago = now - timedelta(days=30)
    one_year_ago = now - timedelta(days=365)

    # Get all users
    users = db_session.query(User).all()
    
    # Convert to dict format expected by calculate_metrics
    user_dicts = [{
        'is_active': user.is_active,
        'date_joined': user.date_joined.isoformat() if user.date_joined else None,
        'last_login': user.last_login.isoformat() if user.last_login else None
    } for user in users]
    
    return user_dicts 

async def get_verification_code(code: str, db: Session) -> Optional[dict]:
    """Get verification code details."""
    try:
        verification = db.query(VerificationCode).filter(
            VerificationCode.code == code
        ).first()
        
        if not verification:
            return None
            
        now = datetime.utcnow()
        return {
            "user_id": verification.user_id,
            "code": verification.code,
            "expired": verification.expires_at < now
        }
    except Exception as e:
        logging.error(f"Error getting verification code: {e}")
        return None

async def mark_email_verified(user_id: int, db: Session) -> bool:
    """
    Mark a user's email as verified.
    
    Args:
        user_id (int): The ID of the user to mark as verified
        db (Session): Database session
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            user.email_verified = True
            user.email_verified_at = datetime.now()
            db.commit()
            return True
        return False
        
    except Exception as e:
        logging.error(f"Error marking email as verified: {e}")
        db.rollback()
        return False 

async def update_status(user_id: int, is_active: bool, db: Session) -> bool:
    """
    Update a user's active status.
    
    Args:
        user_id (int): The ID of the user to update
        is_active (bool): The new active status
        db (Session): Database session
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            user.is_active = is_active
            if not is_active:
                user.deactivated_at = datetime.now()
            db.commit()
            return True
        return False
        
    except Exception as e:
        logging.error(f"Error updating user status: {e}")
        db.rollback()
        return False 

def get_user(db: Session, user_id: int = None, username: str = None) -> Optional[User]:
    """
    Get a user by ID or username.
    
    Args:
        db (Session): Database session
        user_id (int, optional): User ID to search for
        username (str, optional): Username to search for
        
    Returns:
        Optional[User]: User object if found, None otherwise
    """
    try:
        if user_id:
            return db.query(User).filter(User.id == user_id).first()
        elif username:
            return db.query(User).filter(User.username == username).first()
        return None
        
    except Exception as e:
        logging.error(f"Error getting user: {e}")
        return None 

def get_user_by_criteria(db: Session, **criteria) -> Optional[User]:
    """
    Get a user by various criteria.
    
    Args:
        db (Session): Database session
        **criteria: Criteria to filter by (e.g., username, email, authentik_id)
        
    Returns:
        Optional[User]: User object if found, None otherwise
    """
    try:
        query = db.query(User)
        
        for key, value in criteria.items():
            if hasattr(User, key):
                query = query.filter(getattr(User, key) == value)
        
        return query.first()
    except Exception as e:
        logging.error(f"Error getting user by criteria {criteria}: {e}")
        return None

def update_user(db: Session, user_id: int, **updates) -> bool:
    """
    Update a user's details in the database.
    
    Args:
        db (Session): Database session
        user_id (int): User ID
        **updates: Fields to update
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return False
        
        for key, value in updates.items():
            if hasattr(user, key):
                setattr(user, key, value)
        
        db.commit()
        return True
    except Exception as e:
        logging.error(f"Error updating user {user_id}: {e}")
        db.rollback()
        return False

def update_matrix_room_members(db: Session, room_id: str, members: List[Dict[str, Any]]):
    """
    Update the cached members for a Matrix room.
    
    Args:
        db: Database session
        room_id: Matrix room ID
        members: List of member dictionaries from Matrix API
    """
    try:
        # Delete existing members for this room
        db.query(MatrixRoomMember).filter(MatrixRoomMember.room_id == room_id).delete()
        
        # Add new members
        for member in members:
            db_member = MatrixRoomMember(
                room_id=room_id,
                user_id=member.get('user_id'),
                display_name=member.get('display_name'),
                avatar_url=member.get('avatar_url'),
                membership=member.get('membership')
            )
            db.add(db_member)
        
        db.commit()
        logging.info(f"Updated {len(members)} members for room {room_id}")
    except Exception as e:
        db.rollback()
        logging.error(f"Error updating room members for {room_id}: {str(e)}")
        raise

def get_matrix_room_members(db: Session, room_id: str) -> List[Dict[str, Any]]:
    """
    Get cached members for a Matrix room.
    
    Args:
        db: Database session
        room_id: Matrix room ID
        
    Returns:
        List of member dictionaries
    """
    try:
        members = db.query(MatrixRoomMember).filter(MatrixRoomMember.room_id == room_id).all()
        return [
            {
                'user_id': member.user_id,
                'display_name': member.display_name,
                'avatar_url': member.avatar_url,
                'membership': member.membership
            }
            for member in members
        ]
    except Exception as e:
        logging.error(f"Error getting room members for {room_id}: {str(e)}")
        return []

def get_matrix_room_member_count(db: Session, room_id: str) -> int:
    """
    Get the count of members in a Matrix room from cache.
    
    Args:
        db: Database session
        room_id: Matrix room ID
        
    Returns:
        Number of members in the room
    """
    try:
        # Use the new MatrixRoomMembership table (matrix_cache_memberships)
        # instead of the old MatrixRoomMember table
        return db.query(MatrixRoomMembership).filter(
            MatrixRoomMembership.room_id == room_id,
            MatrixRoomMembership.membership_status == 'join'
        ).count()
    except Exception as e:
        logging.error(f"Error getting member count for room {room_id}: {str(e)}")
        return 0

def is_matrix_room_member(db: Session, room_id: str, user_id: str) -> bool:
    """
    Check if a user is a member of a Matrix room.
    
    Args:
        db: Database session
        room_id: Matrix room ID
        user_id: Matrix user ID
        
    Returns:
        True if the user is a member, False otherwise
    """
    try:
        # Use the new MatrixRoomMembership table (matrix_cache_memberships)
        # instead of the old MatrixRoomMember table
        return db.query(MatrixRoomMembership).filter(
            MatrixRoomMembership.room_id == room_id,
            MatrixRoomMembership.user_id == user_id,
            MatrixRoomMembership.membership_status == 'join'
        ).count() > 0
    except Exception as e:
        logging.error(f"Error checking room membership for {user_id} in {room_id}: {str(e)}")
        return False 

def create_user(db: Session, username: str, email: str = None, first_name: str = None, last_name: str = None, attributes: Dict = None) -> User:
    """
    Create a new user in the database.
    
    Args:
        db (Session): Database session
        username (str): Username for the new user
        email (str, optional): Email address
        first_name (str, optional): First name
        last_name (str, optional): Last name
        attributes (Dict, optional): Additional user attributes
        
    Returns:
        User: The created user object
    """
    user = User(
        username=username,
        email=email,
        first_name=first_name,
        last_name=last_name,
        attributes=attributes or {},
        date_joined=datetime.utcnow()
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user 

def get_user_by_username(db: Session, username: str) -> Optional[User]:
    """
    Get a user by their username.
    
    Args:
        db (Session): Database session
        username (str): Username to look up
        
    Returns:
        Optional[User]: The user if found, None otherwise
    """
    try:
        return db.query(User).filter(User.username == username).first()
    except Exception as e:
        logging.error(f"Error getting user by username {username}: {e}")
        return None 

def get_user_by_email(db: Session, email: str) -> Optional[User]:
    """
    Get a user by their email address.
    
    Args:
        db (Session): Database session
        email (str): Email address to look up
        
    Returns:
        Optional[User]: The user if found, None otherwise
    """
    try:
        return db.query(User).filter(User.email == email).first()
    except Exception as e:
        logging.error(f"Error getting user by email {email}: {e}")
        return None 

def get_admin_events(db: Session, limit: int = None, offset: int = None) -> List[AdminEvent]:
    """
    Get admin events from the database, optionally with pagination.
    
    Args:
        db (Session): Database session
        limit (int, optional): Maximum number of events to return
        offset (int, optional): Number of events to skip
        
    Returns:
        List[AdminEvent]: List of admin events
    """
    try:
        query = db.query(AdminEvent).order_by(AdminEvent.timestamp.desc())
        if limit is not None:
            query = query.limit(limit)
        if offset is not None:
            query = query.offset(offset)
        return query.all()
    except Exception as e:
        logging.error(f"Error getting admin events: {e}")
        return []

def get_admin_events_filtered(db: Session, event_type: str = None, username: str = None, limit: int = None, offset: int = None) -> List[AdminEvent]:
    """
    Get admin events from the database with filtering options.
    
    Args:
        db (Session): Database session
        event_type (str, optional): Filter by event type
        username (str, optional): Filter by username
        limit (int, optional): Maximum number of events to return
        offset (int, optional): Number of events to skip
        
    Returns:
        List[AdminEvent]: List of admin events
    """
    try:
        query = db.query(AdminEvent).order_by(AdminEvent.timestamp.desc())
        
        if event_type:
            query = query.filter(AdminEvent.event_type == event_type)
        
        if username:
            query = query.filter(AdminEvent.username.ilike(f'%{username}%'))
        
        if limit is not None:
            query = query.limit(limit)
        
        if offset is not None:
            query = query.offset(offset)
        
        return query.all()
    except Exception as e:
        logging.error(f"Error getting filtered admin events: {e}")
        return []

def is_admin(db: Session, username: str) -> bool:
    """
    Check if a user is an admin.
    
    Args:
        db (Session): Database session
        username (str): Username to check
        
    Returns:
        bool: True if the user is an admin, False otherwise
    """
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            return False
        return user.is_admin
    except Exception as e:
        logging.error(f"Error checking admin status for {username}: {e}")
        return False

def update_admin_status(db: Session, username: str, is_admin: bool) -> bool:
    """
    Update a user's admin status.
    
    Args:
        db (Session): Database session
        username (str): Username to update
        is_admin (bool): New admin status
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            return False
            
        user.is_admin = is_admin
        db.commit()
        
        # Log the admin status change
        event_type = "admin_granted" if is_admin else "admin_revoked"
        create_admin_event(
            db, 
            event_type, 
            username, 
            f"Admin status {'granted to' if is_admin else 'revoked from'} {username}"
        )
        
        return True
    except Exception as e:
        logging.error(f"Error updating admin status for {username}: {e}")
        db.rollback()
        return False

def get_admin_users(db: Session) -> List[User]:
    """
    Get all admin users.
    
    Args:
        db (Session): Database session
        
    Returns:
        List[User]: List of admin users
    """
    try:
        return db.query(User).filter(User.is_admin == True).all()
    except Exception as e:
        logging.error(f"Error getting admin users: {e}")
        return []

def get_users_by_group(db: Session, group_id: str) -> List[User]:
    """
    Get all users in a specific group.
    
    Args:
        db (Session): Database session
        group_id (str): Authentik group ID
        
    Returns:
        List[User]: List of users in the group
    """
    try:
        # This requires integration with Authentik API to get group members
        # For now, we'll return an empty list
        return []
    except Exception as e:
        logging.error(f"Error getting users by group {group_id}: {e}")
        return []

def sync_admin_status(db: Session) -> bool:
    """
    Sync admin status from configuration to database.
    This ensures that users listed in ADMIN_USERNAMES are marked as admins in the database.
    
    Args:
        db (Session): Database session
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        from app.utils.config import Config
        
        # Get all users from the database
        users = db.query(User).all()
        
        # Update admin status based on configuration
        for user in users:
            should_be_admin = user.username in Config.ADMIN_USERNAMES
            
            # Only update if the status needs to change
            if user.is_admin != should_be_admin:
                user.is_admin = should_be_admin
                
                # Log the admin status change
                event_type = "admin_granted" if should_be_admin else "admin_revoked"
                create_admin_event(
                    db, 
                    event_type, 
                    user.username, 
                    f"Admin status {'granted to' if should_be_admin else 'revoked from'} {user.username} during sync"
                )
        
        db.commit()
        return True
    except Exception as e:
        logging.error(f"Error syncing admin status: {e}")
        db.rollback()
        return False

def update_signal_identity(db: Session, username: str, signal_identity: str) -> bool:
    """
    Update a user's Signal identity.
    
    Args:
        db (Session): Database session
        username (str): Username of the user to update
        signal_identity (str): Signal name or phone number to associate with the user
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            logging.error(f"User {username} not found")
            return False
            
        # Check if this is the first time setting signal_identity
        is_new_association = user.signal_identity is None or user.signal_identity == ""
        
        # Update the signal identity
        user.signal_identity = signal_identity
        db.commit()
        
        # Log the update
        create_admin_event(
            db, 
            "signal_identity_updated", 
            username, 
            f"Signal identity updated to: {signal_identity}"
        )
        
        return True, is_new_association
    except Exception as e:
        logging.error(f"Error updating Signal identity for {username}: {e}")
        db.rollback()
        return False, False

def get_signal_identity(db: Session, username: str) -> Optional[str]:
    """
    Get a user's Signal identity.
    
    Args:
        db (Session): Database session
        username (str): Username of the user
        
    Returns:
        Optional[str]: The user's Signal identity if found, None otherwise
    """
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            return None
        return user.signal_identity
    except Exception as e:
        logging.error(f"Error getting Signal identity for {username}: {e}")
        return None

def get_user_by_signal_identity(db: Session, signal_identity: str) -> Optional[User]:
    """
    Get a user by their Signal identity.
    
    Args:
        db (Session): Database session
        signal_identity (str): Signal identity to look up
        
    Returns:
        Optional[User]: The user if found, None otherwise
    """
    try:
        return db.query(User).filter(User.signal_identity == signal_identity).first()
    except Exception as e:
        logging.error(f"Error getting user by Signal identity {signal_identity}: {e}")
        return None

def create_user_note(db: Session, user_id: int, content: str, created_by: str) -> Optional[UserNote]:
    """
    Create a new note for a user.
    
    Args:
        db (Session): Database session
        user_id (int): ID of the user the note is about
        content (str): Content of the note
        created_by (str): Username of the moderator creating the note
        
    Returns:
        Optional[UserNote]: The created note if successful, None otherwise
    """
    try:
        # Check if user exists
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            logging.error(f"Cannot create note: User with ID {user_id} not found")
            return None
            
        # Create the note
        note = UserNote(
            user_id=user_id,
            content=content,
            created_by=created_by,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        
        db.add(note)
        db.commit()
        db.refresh(note)
        
        # Log the note creation
        create_admin_event(
            db,
            "user_note_created",
            created_by,
            f"Note created for user {user.username}"
        )
        
        return note
    except Exception as e:
        logging.error(f"Error creating user note: {e}")
        db.rollback()
        return None

def get_user_notes(db: Session, user_id: int) -> List[UserNote]:
    """
    Get all notes for a specific user.
    
    Args:
        db (Session): Database session
        user_id (int): ID of the user to get notes for
        
    Returns:
        List[UserNote]: List of notes for the user
    """
    try:
        return db.query(UserNote).filter(UserNote.user_id == user_id).order_by(UserNote.created_at.desc()).all()
    except Exception as e:
        logging.error(f"Error getting notes for user {user_id}: {e}")
        return []

def get_note_by_id(db: Session, note_id: int) -> Optional[UserNote]:
    """
    Get a specific note by ID.
    
    Args:
        db (Session): Database session
        note_id (int): ID of the note to get
        
    Returns:
        Optional[UserNote]: The note if found, None otherwise
    """
    try:
        return db.query(UserNote).filter(UserNote.id == note_id).first()
    except Exception as e:
        logging.error(f"Error getting note {note_id}: {e}")
        return None

def update_user_note(db: Session, note_id: int, content: str, edited_by: str) -> Optional[UserNote]:
    """
    Update an existing user note.
    
    Args:
        db (Session): Database session
        note_id (int): ID of the note to update
        content (str): New content for the note
        edited_by (str): Username of the moderator editing the note
        
    Returns:
        Optional[UserNote]: The updated note if successful, None otherwise
    """
    try:
        note = db.query(UserNote).filter(UserNote.id == note_id).first()
        if not note:
            logging.error(f"Cannot update note: Note with ID {note_id} not found")
            return None
            
        # Get the user for logging
        user = db.query(User).filter(User.id == note.user_id).first()
        
        # Update the note
        note.content = content
        note.last_edited_by = edited_by
        note.updated_at = datetime.utcnow()
        
        db.commit()
        db.refresh(note)
        
        # Log the note update
        create_admin_event(
            db,
            "user_note_updated",
            edited_by,
            f"Note updated for user {user.username if user else 'unknown'}"
        )
        
        return note
    except Exception as e:
        logging.error(f"Error updating note {note_id}: {e}")
        db.rollback()
        return None

def delete_user_note(db: Session, note_id: int, deleted_by: str) -> bool:
    """
    Delete a user note.
    
    Args:
        db (Session): Database session
        note_id (int): ID of the note to delete
        deleted_by (str): Username of the moderator deleting the note
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        note = db.query(UserNote).filter(UserNote.id == note_id).first()
        if not note:
            logging.error(f"Cannot delete note: Note with ID {note_id} not found")
            return False
            
        # Get the user for logging
        user = db.query(User).filter(User.id == note.user_id).first()
        
        # Delete the note
        db.delete(note)
        db.commit()
        
        # Log the note deletion
        create_admin_event(
            db,
            "user_note_deleted",
            deleted_by,
            f"Note deleted for user {user.username if user else 'unknown'}"
        )
        
        return True
    except Exception as e:
        logging.error(f"Error deleting note {note_id}: {e}")
        db.rollback()
        return False

def get_user_note_count(db: Session, user_id: int) -> int:
    """
    Get the count of notes for a specific user.
    
    Args:
        db (Session): Database session
        user_id (int): ID of the user
        
    Returns:
        int: Number of notes for the user
    """
    try:
        return db.query(UserNote).filter(UserNote.user_id == user_id).count()
        
    except Exception as e:
        logging.error(f"Error getting user note count: {e}")
        return 0


# Moderator Management Functions
def is_moderator(db: Session, username: str) -> bool:
    """
    Check if a user is a moderator.
    
    Args:
        db (Session): Database session
        username (str): Username to check
        
    Returns:
        bool: True if user is a moderator, False otherwise
    """
    try:
        user = db.query(User).filter(User.username == username).first()
        return user.is_moderator if user else False
        
    except Exception as e:
        logging.error(f"Error checking moderator status: {e}")
        return False


def update_moderator_status(db: Session, username: str, is_moderator: bool) -> bool:
    """
    Update a user's moderator status.
    
    Args:
        db (Session): Database session
        username (str): Username to update
        is_moderator (bool): New moderator status
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        user = db.query(User).filter(User.username == username).first()
        if user:
            user.is_moderator = is_moderator
            db.commit()
            logging.info(f"Updated moderator status for user {username} to {is_moderator}")
            return True
        else:
            logging.warning(f"User {username} not found when updating moderator status")
            return False
            
    except Exception as e:
        logging.error(f"Error updating moderator status: {e}")
        db.rollback()
        return False


def get_moderator_users(db: Session) -> List[User]:
    """
    Get all users who are moderators.
    
    Args:
        db (Session): Database session
        
    Returns:
        List[User]: List of moderator users
    """
    try:
        return db.query(User).filter(User.is_moderator == True).all()
        
    except Exception as e:
        logging.error(f"Error getting moderator users: {e}")
        return []


def get_moderator_count(db: Session) -> int:
    """
    Get the count of moderator users.
    
    Args:
        db (Session): Database session
        
    Returns:
        int: Number of moderator users
    """
    try:
        return db.query(User).filter(User.is_moderator == True).count()
        
    except Exception as e:
        logging.error(f"Error getting moderator count: {e}")
        return 0


def get_users_with_roles(db: Session, include_admins: bool = True, include_moderators: bool = True) -> List[User]:
    """
    Get all users with admin and/or moderator roles.
    
    Args:
        db (Session): Database session
        include_admins (bool): Include admin users
        include_moderators (bool): Include moderator users
        
    Returns:
        List[User]: List of users with specified roles
    """
    try:
        query = db.query(User)
        
        if include_admins and include_moderators:
            query = query.filter((User.is_admin == True) | (User.is_moderator == True))
        elif include_admins:
            query = query.filter(User.is_admin == True)
        elif include_moderators:
            query = query.filter(User.is_moderator == True)
        else:
            return []
            
        return query.all()
        
    except Exception as e:
        logging.error(f"Error getting users with roles: {e}")
        return []


def promote_to_moderator(db: Session, username: str, promoted_by: str) -> bool:
    """
    Promote a user to moderator and log the event.
    
    Args:
        db (Session): Database session
        username (str): Username to promote
        promoted_by (str): Username of the admin who promoted the user
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Update moderator status
        if update_moderator_status(db, username, True):
            # Log the admin event
            create_admin_event(
                db,
                event_type="MODERATOR_PROMOTED",
                username=promoted_by,
                details=f"Promoted user {username} to moderator"
            )
            return True
        return False
        
    except Exception as e:
        logging.error(f"Error promoting user to moderator: {e}")
        return False


def demote_from_moderator(db: Session, username: str, demoted_by: str) -> bool:
    """
    Demote a user from moderator and log the event.
    
    Args:
        db (Session): Database session
        username (str): Username to demote
        demoted_by (str): Username of the admin who demoted the user
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Update moderator status
        if update_moderator_status(db, username, False):
            # Log the admin event
            create_admin_event(
                db,
                event_type="MODERATOR_DEMOTED",
                username=demoted_by,
                details=f"Demoted user {username} from moderator"
            )
            return True
        return False
        
    except Exception as e:
        logging.error(f"Error demoting user from moderator: {e}")
        return False


# Moderator Permission Management Functions
def grant_moderator_permission(db: Session, user_id: int, permission_type: str, permission_value: Optional[str], granted_by: str) -> Optional[ModeratorPermission]:
    """
    Grant a specific permission to a moderator.
    
    Args:
        db (Session): Database session
        user_id (int): ID of the user to grant permission to
        permission_type (str): Type of permission ('section', 'room', 'global')
        permission_value (Optional[str]): Value of permission (section name, room ID, or None for global)
        granted_by (str): Username of admin who granted the permission
        
    Returns:
        Optional[ModeratorPermission]: The created permission object if successful
    """
    try:
        # Check if permission already exists
        existing = db.query(ModeratorPermission).filter(
            ModeratorPermission.user_id == user_id,
            ModeratorPermission.permission_type == permission_type,
            ModeratorPermission.permission_value == permission_value
        ).first()
        
        if existing:
            logging.warning(f"Permission already exists for user {user_id}")
            return existing
        
        # Create new permission
        permission = ModeratorPermission(
            user_id=user_id,
            permission_type=permission_type,
            permission_value=permission_value,
            created_by=granted_by
        )
        
        db.add(permission)
        db.commit()
        
        # Log the event
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            create_admin_event(
                db,
                event_type="MODERATOR_PERMISSION_GRANTED",
                username=granted_by,
                details=f"Granted {permission_type} permission '{permission_value}' to moderator {user.username}"
            )
        
        return permission
        
    except Exception as e:
        logging.error(f"Error granting moderator permission: {e}")
        db.rollback()
        return None


def revoke_moderator_permission(db: Session, permission_id: int, revoked_by: str) -> bool:
    """
    Revoke a specific permission from a moderator.
    
    Args:
        db (Session): Database session
        permission_id (int): ID of the permission to revoke
        revoked_by (str): Username of admin who revoked the permission
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        permission = db.query(ModeratorPermission).filter(ModeratorPermission.id == permission_id).first()
        
        if not permission:
            logging.warning(f"Permission {permission_id} not found")
            return False
        
        # Get user for logging
        user = db.query(User).filter(User.id == permission.user_id).first()
        
        # Delete the permission
        db.delete(permission)
        db.commit()
        
        # Log the event
        if user:
            create_admin_event(
                db,
                event_type="MODERATOR_PERMISSION_REVOKED",
                username=revoked_by,
                details=f"Revoked {permission.permission_type} permission '{permission.permission_value}' from moderator {user.username}"
            )
        
        return True
        
    except Exception as e:
        logging.error(f"Error revoking moderator permission: {e}")
        db.rollback()
        return False


def get_moderator_permissions(db: Session, user_id: int) -> List[ModeratorPermission]:
    """
    Get all permissions for a specific moderator.
    
    Args:
        db (Session): Database session
        user_id (int): ID of the moderator user
        
    Returns:
        List[ModeratorPermission]: List of permissions for the user
    """
    try:
        return db.query(ModeratorPermission).filter(ModeratorPermission.user_id == user_id).all()
        
    except Exception as e:
        logging.error(f"Error getting moderator permissions: {e}")
        return []


def has_moderator_permission(db: Session, user_id: int, permission_type: str, permission_value: Optional[str]) -> bool:
    """
    Check if a moderator has a specific permission.
    
    Args:
        db (Session): Database session
        user_id (int): ID of the moderator user
        permission_type (str): Type of permission to check
        permission_value (Optional[str]): Value of permission to check
        
    Returns:
        bool: True if user has the permission, False otherwise
    """
    try:
        # Check for global permission first
        if permission_type != 'global':
            global_perm = db.query(ModeratorPermission).filter(
                ModeratorPermission.user_id == user_id,
                ModeratorPermission.permission_type == 'global'
            ).first()
            
            if global_perm:
                return True
        
        # Check for specific permission
        query = db.query(ModeratorPermission).filter(
            ModeratorPermission.user_id == user_id,
            ModeratorPermission.permission_type == permission_type
        )
        
        if permission_value is not None:
            query = query.filter(ModeratorPermission.permission_value == permission_value)
        
        return query.first() is not None
        
    except Exception as e:
        logging.error(f"Error checking moderator permission: {e}")
        return False


def clear_moderator_permissions(db: Session, user_id: int, cleared_by: str) -> bool:
    """
    Clear all permissions for a moderator.
    
    Args:
        db (Session): Database session
        user_id (int): ID of the moderator user
        cleared_by (str): Username of admin who cleared the permissions
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Get user for logging
        user = db.query(User).filter(User.id == user_id).first()
        
        # Delete all permissions for the user
        db.query(ModeratorPermission).filter(ModeratorPermission.user_id == user_id).delete()
        db.commit()
        
        # Log the event
        if user:
            create_admin_event(
                db,
                event_type="MODERATOR_PERMISSIONS_CLEARED",
                username=cleared_by,
                details=f"Cleared all permissions for moderator {user.username}"
            )
        
        return True
        
    except Exception as e:
        logging.error(f"Error clearing moderator permissions: {e}")
        db.rollback()
        return False