"""
Authentication helper functions for checking user permissions
"""
import logging
from typing import Optional, List, Dict
from sqlalchemy.orm import Session
from app.db.models import User, ModeratorPermission
from app.db.operations import is_moderator, has_moderator_permission, get_moderator_permissions


def check_moderator_access(db: Session, username: str, section: Optional[str] = None, room_id: Optional[str] = None) -> bool:
    """
    Check if a user has moderator access to a specific section or room.
    
    Args:
        db: Database session
        username: Username to check
        section: Section name to check access for (e.g., 'Onboarding', 'Messaging')
        room_id: Matrix room ID to check access for
        
    Returns:
        bool: True if user has access, False otherwise
    """
    try:
        # Get user
        user = db.query(User).filter(User.username == username).first()
        if not user:
            return False
        
        # Admins always have access
        if user.is_admin:
            return True
        
        # Check if user is a moderator
        if not user.is_moderator:
            return False
        
        # If no specific section or room requested, return True for any moderator
        if not section and not room_id:
            return True
        
        # Check for global permission
        if has_moderator_permission(db, user.id, 'global', None):
            return True
        
        # Check for specific section permission
        if section and has_moderator_permission(db, user.id, 'section', section):
            return True
        
        # Check for specific room permission
        if room_id and has_moderator_permission(db, user.id, 'room', room_id):
            return True
        
        return False
        
    except Exception as e:
        logging.error(f"Error checking moderator access: {e}")
        return False


def get_user_accessible_sections(db: Session, username: str) -> List[str]:
    """
    Get list of sections a user has access to.
    
    Args:
        db: Database session
        username: Username to check
        
    Returns:
        List[str]: List of section names the user has access to
    """
    try:
        # Get user
        user = db.query(User).filter(User.username == username).first()
        if not user:
            return []
        
        # Admins have access to all sections
        all_sections = ['Onboarding', 'Messaging', 'User Reports', 'Prompt Editor', 'Settings']
        if user.is_admin:
            return all_sections
        
        # Non-moderators have no special access
        if not user.is_moderator:
            return []
        
        # Check for global permission
        if has_moderator_permission(db, user.id, 'global', None):
            # Global moderators have access to all sections except Settings
            return ['Onboarding', 'Messaging', 'User Reports', 'Prompt Editor']
        
        # Get specific section permissions
        permissions = get_moderator_permissions(db, user.id)
        accessible_sections = []
        
        for perm in permissions:
            if perm.permission_type == 'section' and perm.permission_value:
                accessible_sections.append(perm.permission_value)
        
        return accessible_sections
        
    except Exception as e:
        logging.error(f"Error getting user accessible sections: {e}")
        return []


def get_user_accessible_rooms(db: Session, username: str) -> List[str]:
    """
    Get list of Matrix room IDs a user has moderator access to.
    
    Args:
        db: Database session
        username: Username to check
        
    Returns:
        List[str]: List of room IDs the user has access to
    """
    try:
        # Get user
        user = db.query(User).filter(User.username == username).first()
        if not user:
            return []
        
        # Admins have access to all rooms (return empty list to indicate all)
        if user.is_admin:
            return []  # Empty list means all rooms
        
        # Non-moderators have no special access
        if not user.is_moderator:
            return []
        
        # Check for global permission
        if has_moderator_permission(db, user.id, 'global', None):
            return []  # Empty list means all rooms
        
        # Get specific room permissions
        permissions = get_moderator_permissions(db, user.id)
        accessible_rooms = []
        
        for perm in permissions:
            if perm.permission_type == 'room' and perm.permission_value:
                accessible_rooms.append(perm.permission_value)
        
        return accessible_rooms
        
    except Exception as e:
        logging.error(f"Error getting user accessible rooms: {e}")
        return []


def is_admin_or_moderator(db: Session, username: str) -> bool:
    """
    Check if a user is either an admin or a moderator.
    
    Args:
        db: Database session
        username: Username to check
        
    Returns:
        bool: True if user is admin or moderator, False otherwise
    """
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            return False
        
        return user.is_admin or user.is_moderator
        
    except Exception as e:
        logging.error(f"Error checking admin/moderator status: {e}")
        return False


def format_permission_display(permission: ModeratorPermission) -> str:
    """
    Format a permission for display in the UI.
    
    Args:
        permission: ModeratorPermission object
        
    Returns:
        str: Formatted permission string
    """
    if permission.permission_type == 'global':
        return "🌐 Global Access"
    elif permission.permission_type == 'section':
        return f"📑 Section: {permission.permission_value}"
    elif permission.permission_type == 'room':
        return f"🏠 Room: {permission.permission_value}"
    else:
        return f"❓ {permission.permission_type}: {permission.permission_value}"


def should_auto_promote_to_moderator(user_attributes: dict) -> bool:
    """
    Check if a user should be automatically promoted to moderator based on their attributes.
    
    Args:
        user_attributes: User attributes from SSO or local account
        
    Returns:
        bool: True if user should be auto-promoted to moderator
    """
    if not user_attributes or not isinstance(user_attributes, dict):
        return False
    
    # Check organization-based auto-promotion
    organization = user_attributes.get('organization', '').lower()
    
    # Define organizations that should get automatic moderator status
    # This could be moved to Config for easier management
    auto_moderator_organizations = [
        'admin team',
        'core team', 
        'leadership',
        'board of directors',
        'steering committee'
    ]
    
    return any(org in organization for org in auto_moderator_organizations)


def get_suggested_permissions_for_user(user_attributes: dict) -> List[Dict[str, str]]:
    """
    Get suggested permissions for a user based on their attributes.
    
    Args:
        user_attributes: User attributes from SSO or local account
        
    Returns:
        List[Dict[str, str]]: List of suggested permissions
    """
    suggestions = []
    
    if not user_attributes or not isinstance(user_attributes, dict):
        return suggestions
    
    organization = user_attributes.get('organization', '').lower()
    interests = user_attributes.get('interests', '').lower()
    
    # Organization-based suggestions
    if 'hr' in organization or 'human resources' in organization:
        suggestions.append({
            'type': 'section',
            'value': 'Onboarding',
            'reason': 'HR background suggests onboarding expertise'
        })
    
    if 'tech' in organization or 'engineering' in organization or 'it' in organization:
        suggestions.append({
            'type': 'section', 
            'value': 'Messaging',
            'reason': 'Technical background for messaging/Matrix management'
        })
    
    if 'community' in organization or 'outreach' in organization:
        suggestions.append({
            'type': 'global',
            'value': None,
            'reason': 'Community management experience'
        })
    
    # Interest-based suggestions
    if 'moderation' in interests or 'community management' in interests:
        suggestions.append({
            'type': 'global',
            'value': None,
            'reason': 'Expressed interest in moderation'
        })
    
    return suggestions 