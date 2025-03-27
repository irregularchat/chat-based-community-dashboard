from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON, ForeignKey, Table, Text, Index
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB
from app.db.database import Base
from datetime import datetime

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