from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON, ForeignKey, Table, Text, Index, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
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
    is_moderator = Column(Boolean, default=False)  # New field for moderator role
    date_joined = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime)
    attributes = Column(JSON)
    authentik_id = Column(String)  # Link with Authentik user ID
    signal_identity = Column(String)  # Store Signal name or phone number
    matrix_username = Column(String, nullable=True)  # Store Matrix username from INDOC room
    
    # Relationship to UserNote model
    notes = relationship("UserNote", back_populates="user", cascade="all, delete-orphan")
    # Relationship to Group model for Authentik groups
    groups = relationship("Group", secondary="user_groups", back_populates="users")

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
            'is_moderator': self.is_moderator,
            'date_joined': self.date_joined.isoformat() if self.date_joined else None,
            'last_login': self.last_login.isoformat() if self.last_login else None,
            'attributes': self.attributes,
            'authentik_id': self.authentik_id,
            'signal_identity': self.signal_identity,
            'matrix_username': self.matrix_username,
            'note_count': len(self.notes) if hasattr(self, 'notes') else 0,
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

class UserNote(Base):
    """Model for storing moderator notes about users"""
    __tablename__ = 'user_notes'

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    created_by = Column(String, nullable=False)  # Username of the moderator who created the note
    last_edited_by = Column(String, nullable=True)  # Username of the moderator who last edited the note

    # Relationship to User model
    user = relationship("User", back_populates="notes")

    def __repr__(self):
        return f"<UserNote(id={self.id}, user_id={self.user_id}, created_by='{self.created_by}')>"
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'content': self.content,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'created_by': self.created_by,
            'last_edited_by': self.last_edited_by
        }

class Invite(Base):
    """Model for storing invitation information"""
    __tablename__ = 'invites'

    id = Column(Integer, primary_key=True)
    token = Column(String, nullable=False, unique=True)
    label = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_by = Column(String)  # Username of the person who created the invite
    is_used = Column(Boolean, default=False)
    used_by = Column(String)  # Username of the person who used the invite
    used_at = Column(DateTime)
    
    def __repr__(self):
        return f"<Invite(label='{self.label}', token='{self.token[:8]}...', expires='{self.expires_at}')>"
    
    def to_dict(self):
        return {
            'id': self.id,
            'token': self.token,
            'label': self.label,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
            'created_by': self.created_by,
            'is_used': self.is_used,
            'used_by': self.used_by,
            'used_at': self.used_at.isoformat() if self.used_at else None
        }

class Group(Base):
    """Group model for Authentik group management"""
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    description = Column(Text, nullable=True)
    authentik_group_id = Column(String, nullable=True)  # Link with Authentik group ID
    
    # Relationship to User model
    users = relationship("User", secondary="user_groups", back_populates="groups")

# User-Group association table for Authentik group membership
user_groups = Table('user_groups', Base.metadata,
    Column('user_id', Integer, ForeignKey('users.id'), primary_key=True),
    Column('group_id', Integer, ForeignKey('groups.id'), primary_key=True)
)

class ModeratorPermission(Base):
    """Model for storing moderator permissions"""
    __tablename__ = 'moderator_permissions'

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    permission_type = Column(String, nullable=False)  # 'section', 'room', 'global'
    permission_value = Column(String, nullable=True)  # Section name, room ID, or null for global
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by = Column(String, nullable=False)  # Username of admin who granted permission
    
    # Relationship to User model
    user = relationship("User", backref="moderator_permissions")
    
    # Index for faster lookups
    __table_args__ = (
        Index('idx_moderator_permission_user', 'user_id'),
        Index('idx_moderator_permission_type_value', 'permission_type', 'permission_value'),
    )
    
    def __repr__(self):
        return f"<ModeratorPermission(user_id={self.user_id}, type='{self.permission_type}', value='{self.permission_value}')>"
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'permission_type': self.permission_type,
            'permission_value': self.permission_value,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'created_by': self.created_by
        }

# Matrix Cache Models for improved performance
class MatrixUser(Base):
    """
    Model for caching Matrix users.
    Stores user information from all accessible rooms.
    """
    __tablename__ = "matrix_users"
    
    user_id = Column(String(255), primary_key=True, index=True)  # @username:domain.com
    display_name = Column(String(255), nullable=True)
    avatar_url = Column(String(500), nullable=True)  # mxc:// URLs can be long
    is_signal_user = Column(Boolean, default=False, index=True)  # For quick Signal user filtering
    last_seen = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationships
    memberships = relationship("MatrixRoomMembership", back_populates="user", cascade="all, delete-orphan")
    
    def __repr__(self):
        return f"<MatrixUser(user_id='{self.user_id}', display_name='{self.display_name}')>"

class MatrixRoom(Base):
    """
    Model for caching Matrix rooms.
    Stores room information and metadata.
    """
    __tablename__ = "matrix_rooms"
    
    room_id = Column(String(255), primary_key=True, index=True)  # !roomid:domain.com
    name = Column(String(500), nullable=True)
    display_name = Column(String(500), nullable=True)
    topic = Column(Text, nullable=True)
    canonical_alias = Column(String(255), nullable=True)
    member_count = Column(Integer, default=0, index=True)  # For sorting by size
    room_type = Column(String(50), nullable=True)  # direct, public, private, etc.
    is_direct = Column(Boolean, default=False, index=True)
    is_encrypted = Column(Boolean, default=False)
    last_synced = Column(DateTime, nullable=True)  # Track when room was last synced
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationships
    memberships = relationship("MatrixRoomMembership", back_populates="room", cascade="all, delete-orphan")
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_room_member_count', 'member_count'),
        Index('idx_room_type', 'room_type'),
        Index('idx_room_updated', 'updated_at'),
    )
    
    def __repr__(self):
        return f"<MatrixRoom(room_id='{self.room_id}', name='{self.name}', members={self.member_count})>"

class MatrixRoomMembership(Base):
    """
    Model for caching Matrix room memberships.
    Links users to rooms with membership status.
    """
    __tablename__ = "matrix_cache_memberships"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    room_id = Column(String(255), ForeignKey('matrix_rooms.room_id', ondelete='CASCADE'), nullable=False)
    user_id = Column(String(255), ForeignKey('matrix_users.user_id', ondelete='CASCADE'), nullable=False)
    membership_status = Column(String(20), default='join')  # join, leave, invite, ban
    joined_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationships
    user = relationship("MatrixUser", back_populates="memberships")
    room = relationship("MatrixRoom", back_populates="memberships")
    
    # Constraints and indexes
    __table_args__ = (
        UniqueConstraint('room_id', 'user_id', name='uq_cache_room_user_membership'),
        Index('idx_cache_membership_room', 'room_id'),
        Index('idx_cache_membership_user', 'user_id'),
        Index('idx_cache_membership_status', 'membership_status'),
        Index('idx_cache_membership_updated', 'updated_at'),
    )
    
    def __repr__(self):
        return f"<MatrixRoomMembership(room='{self.room_id}', user='{self.user_id}', status='{self.membership_status}')>"

class MatrixSyncStatus(Base):
    """
    Model for tracking Matrix sync operations.
    Helps manage background sync processes and cache freshness.
    """
    __tablename__ = "matrix_sync_status"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    sync_type = Column(String(50), nullable=False, index=True)  # 'users', 'rooms', 'memberships', 'full'
    status = Column(String(20), default='pending')  # pending, running, completed, failed
    last_sync = Column(DateTime, nullable=True)
    total_items = Column(Integer, default=0)
    processed_items = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    sync_duration_seconds = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Indexes for performance
    __table_args__ = (
        Index('idx_sync_type_status', 'sync_type', 'status'),
        Index('idx_sync_last_sync', 'last_sync'),
    )
    
    @property
    def progress_percentage(self):
        """Calculate sync progress percentage."""
        if self.total_items == 0:
            return 0
        return min(100, (self.processed_items / self.total_items) * 100)
    
    def __repr__(self):
        return f"<MatrixSyncStatus(type='{self.sync_type}', status='{self.status}', progress={self.progress_percentage:.1f}%)>"

class MatrixUserCache(Base):
    """
    Model for caching aggregated user data for quick access.
    This is a denormalized table for fast user lookups in the UI.
    """
    __tablename__ = "matrix_user_cache"
    
    user_id = Column(String(255), primary_key=True, index=True)
    display_name = Column(String(255), nullable=True)
    avatar_url = Column(String(500), nullable=True)
    is_signal_user = Column(Boolean, default=False, index=True)
    room_count = Column(Integer, default=0)  # Number of rooms user is in
    last_activity = Column(DateTime, nullable=True)
    cache_updated = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Indexes for fast filtering and sorting
    __table_args__ = (
        Index('idx_user_cache_signal', 'is_signal_user'),
        Index('idx_user_cache_display_name', 'display_name'),
        Index('idx_user_cache_updated', 'cache_updated'),
    )
    
    def __repr__(self):
        return f"<MatrixUserCache(user_id='{self.user_id}', display_name='{self.display_name}', rooms={self.room_count})>"