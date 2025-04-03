from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON, cast, String
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import JSONB
from app.db.database import Base  # Make sure we're using the same Base
from typing import List, Dict, Any
from datetime import datetime
import logging

class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    name = Column(String)
    email = Column(String, unique=True, index=True)
    is_active = Column(Boolean, default=True)
    last_login = Column(DateTime)
    attributes = Column(JSON)
    authentik_id = Column(String)  # Link with Authentik user ID
    verification_code = Column(String, nullable=True)
    verification_code_expires = Column(DateTime, nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'name': self.name,
            'email': self.email,
            'is_active': self.is_active,
            'last_login': self.last_login,
            'attributes': self.attributes,
            'authentik_id': self.authentik_id,
        }

class AdminEvent(Base):
    __tablename__ = 'admin_events'

    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, nullable=False)
    event_type = Column(String, nullable=False)
    username = Column(String, nullable=False)
    description = Column(String)

    def to_dict(self):
        return {
            'id': self.id,
            'timestamp': self.timestamp,
            'event_type': self.event_type,
            'username': self.username,
            'description': self.description
        }

def sync_user_data(db: Session, authentik_users: List[Dict[str, Any]]):
    """
    Sync users from Authentik to local database.
    Checks both authentik_id and username to prevent duplicates.
    Updates existing users or creates new ones as needed.
    """
    for auth_user in authentik_users:
        # First try to find by authentik_id
        existing_user = db.query(User).filter_by(authentik_id=str(auth_user['pk'])).first()
        
        # If not found by authentik_id, try by username
        if not existing_user:
            existing_user = db.query(User).filter_by(username=auth_user['username']).first()
            if existing_user and not existing_user.authentik_id:
                # If found by username but no authentik_id, link them
                existing_user.authentik_id = str(auth_user['pk'])
        
        if existing_user:
            # Update existing user's fields
            existing_user.username = auth_user['username']
            existing_user.name = auth_user.get('name')
            existing_user.email = auth_user.get('email')
            existing_user.is_active = auth_user.get('is_active', True)
            existing_user.last_login = auth_user.get('last_login')
            existing_user.attributes = auth_user.get('attributes', {})
            existing_user.authentik_id = str(auth_user['pk'])
            logging.info(f"Updated existing user: {existing_user.username}")
        else:
            # Create new user
            new_user = User(
                username=auth_user['username'],
                name=auth_user.get('name'),
                email=auth_user.get('email'),
                is_active=auth_user.get('is_active', True),
                last_login=auth_user.get('last_login'),
                attributes=auth_user.get('attributes', {}),
                authentik_id=str(auth_user['pk'])
            )
            db.add(new_user)
            logging.info(f"Created new user: {new_user.username}")
    
    try:
        db.commit()
        logging.info("Successfully synced users with Authentik")
    except Exception as e:
        db.rollback()
        logging.error(f"Error syncing users with Authentik: {e}")
        raise

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
            query = query.filter(User.name.ilike(f'%{value}%'))
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
            (User.name.ilike(f'%{term}%')) |
            (User.email.ilike(f'%{term}%')) |
            # Cast JSON to string before searching
            (cast(User.attributes['intro'], String).ilike(f'%{term}%')) |
            (cast(User.attributes['invited_by'], String).ilike(f'%{term}%'))
        )

    return query.all()

def add_admin_event(db: Session, event_type: str, username: str, description: str, timestamp: datetime) -> AdminEvent:
    """Add a new admin event to the database"""
    event = AdminEvent(
        timestamp=timestamp,
        event_type=event_type,
        username=username,
        description=description
    )
    db.add(event)
    db.commit()
    return event

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
                    name = authentik_user.get('name', '')
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
                    if (existing_user.name != name or 
                        existing_user.email != email or 
                        existing_user.is_active != is_active or 
                        existing_user.last_login != last_login or 
                        existing_user.attributes != attributes):
                        
                        # Update the user
                        existing_user.name = name
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
                        name=authentik_user.get('name', ''),
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

def get_verification_code(db: Session, username: str) -> str:
    """Get the verification code for a user.
    
    Args:
        db (Session): The database session
        username (str): The username to get the verification code for
        
    Returns:
        str: The verification code if found, None otherwise
    """
    user = db.query(User).filter(User.username == username).first()
    if user and user.verification_code and user.verification_code_expires > datetime.now():
        return user.verification_code
    return None 