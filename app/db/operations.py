from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON
from sqlalchemy.orm import Session
from sqlalchemy.ext.declarative import declarative_base
from models.user import User
from typing import List, Dict, Any

Base = declarative_base()

class User(Base):
    __tablename__ = 'users'

    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, nullable=False)
    name = Column(String)
    email = Column(String)
    is_active = Column(Boolean, default=True)
    last_login = Column(DateTime)
    attributes = Column(JSON)
    authentik_id = Column(String)  # To link with Authentik user ID
    
    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'name': self.name,
            'email': self.email,
            'is_active': self.is_active,
            'last_login': self.last_login,
            'attributes': self.attributes,
            'authentik_id': self.authentik_id
        }

def sync_user_data(db: Session, authentik_users: List[Dict[str, Any]]):
    """Sync users from Authentik to local database"""
    for auth_user in authentik_users:
        existing_user = db.query(User).filter_by(authentik_id=auth_user['id']).first()
        
        if existing_user:
            # Update existing user
            for key, value in auth_user.items():
                setattr(existing_user, key, value)
        else:
            # Create new user
            new_user = User(
                username=auth_user['username'],
                name=auth_user.get('name'),
                email=auth_user.get('email'),
                is_active=auth_user.get('is_active', True),
                last_login=auth_user.get('last_login'),
                attributes=auth_user.get('attributes', {}),
                authentik_id=auth_user['id']
            )
            db.add(new_user)
    
    db.commit()

def search_users(db: Session, search_term: str) -> List[User]:
    """Search users in the database"""
    if not search_term:
        return db.query(User).all()
    
    return db.query(User).filter(
        (User.username.ilike(f'%{search_term}%')) |
        (User.name.ilike(f'%{search_term}%')) |
        (User.email.ilike(f'%{search_term}%')) |
        (User.attributes.cast(String).ilike(f'%{search_term}%'))
    ).all() 