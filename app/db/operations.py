from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON, cast, String, func, ForeignKey, Table, Text
from sqlalchemy.orm import Session, relationship
from sqlalchemy.dialects.postgresql import JSONB
from app.db.database import Base, get_db
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import logging
from app.utils.config import Config
from sqlalchemy import Index

class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True)
    email = Column(String)
    first_name = Column(String)
    last_name = Column(String)
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    date_joined = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime)
    attributes = Column(JSON)
    authentik_id = Column(String)  # Link with Authentik user ID

    def __init__(self, **kwargs):
        if 'full_name' in kwargs:
            full_name = kwargs.pop('full_name')
            if full_name:
                names = full_name.split(' ', 1)
                kwargs['first_name'] = names[0]
                kwargs['last_name'] = names[1] if len(names) > 1 else ''
        super().__init__(**kwargs)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'name': f"{self.first_name} {self.last_name}",
            'email': self.email,
            'is_active': self.is_active,
            'is_admin': self.is_admin,
            'date_joined': self.date_joined.isoformat() if self.date_joined else None,
            'last_login': self.last_login.isoformat() if self.last_login else None,
            'attributes': self.attributes,
            'authentik_id': self.authentik_id,
        }

class AdminEvent(Base):
    __tablename__ = 'admin_events'

    id = Column(Integer, primary_key=True)
    event_type = Column(String)
    username = Column(String)
    details = Column(String)
    timestamp = Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'event_type': self.event_type,
            'username': self.username,
            'details': self.details,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None
        }

class VerificationCode(Base):
    """Model for storing email verification codes."""
    __tablename__ = 'verification_codes'

    id = Column(Integer, primary_key=True)
    user_id = Column(String, nullable=False)  # Using string since we're storing username
    code = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)

class MatrixRoomMember(Base):
    """Model for storing Matrix room member information"""
    __tablename__ = 'matrix_room_members'

    id = Column(Integer, primary_key=True)
    room_id = Column(String, nullable=False)
    user_id = Column(String, nullable=False)
    display_name = Column(String)
    avatar_url = Column(String)
    membership = Column(String)  # join, leave, invite, etc.
    last_updated = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Index for faster lookups
    __table_args__ = (
        Index('idx_matrix_room_member_room_user', 'room_id', 'user_id', unique=True),
    )

    def __repr__(self):
        return f"<MatrixRoomMember(room_id='{self.room_id}', user_id='{self.user_id}')>"

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

def search_users(db: Session, search_term: str) -> List[User]:
    """Search users in the database"""
    if not search_term:
        return db.query(User).all()
    
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

    # Build the query
    query = db.query(User)
    
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

    return query.all()

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
    Create a new admin event in the database.
    Alias for add_admin_event for backward compatibility.
    
    Args:
        db (Session): Database session
        event_type (str): Type of admin event
        username (str): Username associated with the event
        details (str, optional): Event details
        description (str, optional): Alternative to details parameter for backward compatibility
        
    Returns:
        AdminEvent: The created admin event
    """
    return add_admin_event(db, event_type, username, description or details or "", datetime.now())

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
                
                # Update existing user
                if existing_user:
                    # Check if user data has changed before updating
                    first_name = authentik_user.get('first_name', '')
                    last_name = authentik_user.get('last_name', '')
                    email = authentik_user.get('email', '')
                    is_active = authentik_user.get('is_active', True)
                    last_login = authentik_user.get('last_login')
                    attributes = authentik_user.get('attributes', {})
                    
                    # Convert last_login to datetime if it's a string
                    if isinstance(last_login, str):
                        try:
                            last_login = datetime.fromisoformat(last_login.replace('Z', '+00:00'))
                        except (ValueError, TypeError):
                            last_login = None
                    
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
                    new_user = User(
                        username=username,
                        first_name=authentik_user.get('first_name', ''),
                        last_name=authentik_user.get('last_name', ''),
                        email=authentik_user.get('email', ''),
                        is_active=authentik_user.get('is_active', True),
                        last_login=authentik_user.get('last_login'),
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
        return db.query(MatrixRoomMember).filter(MatrixRoomMember.room_id == room_id).count()
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
        return db.query(MatrixRoomMember).filter(
            MatrixRoomMember.room_id == room_id,
            MatrixRoomMember.user_id == user_id,
            MatrixRoomMember.membership == 'join'
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