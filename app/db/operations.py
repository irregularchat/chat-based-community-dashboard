from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON, cast, String
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import JSONB
from db.database import Base  # Make sure we're using the same Base
from typing import List, Dict, Any
from datetime import datetime
import logging

class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, nullable=False)
    name = Column(String)
    email = Column(String)
    is_active = Column(Boolean, default=True)
    last_login = Column(DateTime)
    attributes = Column(JSON)
    authentik_id = Column(String)  # Link with Authentik user ID

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