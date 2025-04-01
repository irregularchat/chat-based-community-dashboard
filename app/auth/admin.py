import logging
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from app.db.database import SessionLocal
from app.db.models import User
from app.db.operations import create_admin_event, is_admin, update_admin_status
from app.utils.config import Config
import requests
import json

def check_admin_permission(username: str) -> bool:
    """
    Check if a user has admin permissions.
    
    Args:
        username (str): Username to check
        
    Returns:
        bool: True if the user has admin permissions, False otherwise
    """
    # First check if the user is in the admin list in the configuration
    if Config.is_admin(username):
        return True
        
    # Then check the database
    with SessionLocal() as db:
        return is_admin(db, username)

def require_admin(func):
    """
    Decorator to require admin permissions for a function.
    
    Args:
        func: The function to decorate
        
    Returns:
        The decorated function
    """
    def wrapper(username, *args, **kwargs):
        if not check_admin_permission(username):
            logging.warning(f"Unauthorized admin access attempt by {username}")
            return {
                "success": False,
                "error": "Unauthorized: Admin permissions required"
            }
        return func(username, *args, **kwargs)
    return wrapper

def get_authentik_groups(search_term: str = None) -> List[Dict[str, Any]]:
    """
    Get all groups from Authentik with optional filtering.
    
    Args:
        search_term (str, optional): Term to filter groups by name
        
    Returns:
        List[Dict[str, Any]]: List of groups
    """
    try:
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        
        params = {}
        if search_term:
            params['search'] = search_term
        
        url = f"{Config.AUTHENTIK_API_URL}/core/groups/"
        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()
        
        groups = response.json().get('results', [])
        
        # Sort groups by name
        groups.sort(key=lambda g: g.get('name', '').lower())
        
        return groups
    except Exception as e:
        logging.error(f"Error getting Authentik groups: {e}")
        return []

def get_user_groups(user_id: str):
    """
    Get groups for a specific user from Authentik.
    
    Args:
        user_id (str): Authentik user ID
        
    Returns:
        List[Dict[str, Any]]: List of groups the user belongs to
    """
    try:
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        
        url = f"{Config.AUTHENTIK_API_URL}/core/users/{user_id}/groups/"
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        
        return response.json()
    except Exception as e:
        logging.error(f"Error getting user groups for {user_id}: {e}")
        return []

def get_user_details(user_id: str) -> Optional[Dict[str, Any]]:
    """
    Get detailed information about a user from Authentik.
    
    Args:
        user_id (str): Authentik user ID
        
    Returns:
        Optional[Dict[str, Any]]: User details or None if not found
    """
    try:
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        
        url = f"{Config.AUTHENTIK_API_URL}/core/users/{user_id}/"
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        
        return response.json()
    except Exception as e:
        logging.error(f"Error getting user details for {user_id}: {e}")
        return None

def search_users_by_criteria(criteria: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Search for users in Authentik based on various criteria.
    
    Args:
        criteria (Dict[str, Any]): Search criteria (e.g., {'username': 'john', 'is_active': True})
        
    Returns:
        List[Dict[str, Any]]: List of matching users
    """
    try:
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        
        # Build query parameters
        params = {}
        for key, value in criteria.items():
            if key == 'username':
                params['username__icontains'] = value
            elif key == 'name':
                params['name__icontains'] = value
            elif key == 'email':
                params['email__icontains'] = value
            elif key == 'is_active':
                params['is_active'] = value
            elif key == 'group':
                # This requires a different approach - we'll filter results later
                pass
        
        url = f"{Config.AUTHENTIK_API_URL}/core/users/"
        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()
        
        users = response.json().get('results', [])
        
        # Filter by group if specified
        if 'group' in criteria and criteria['group']:
            group_id = criteria['group']
            filtered_users = []
            
            for user in users:
                user_id = user.get('pk')
                user_groups = get_user_groups(user_id)
                
                if any(g.get('pk') == group_id for g in user_groups):
                    filtered_users.append(user)
            
            return filtered_users
        
        return users
    except Exception as e:
        logging.error(f"Error searching users by criteria: {e}")
        return []

def get_group_members(group_id: str) -> List[Dict[str, Any]]:
    """
    Get all members of a specific group.
    
    Args:
        group_id (str): Authentik group ID
        
    Returns:
        List[Dict[str, Any]]: List of users in the group
    """
    try:
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        
        url = f"{Config.AUTHENTIK_API_URL}/core/groups/{group_id}/users/"
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        
        return response.json().get('results', [])
    except Exception as e:
        logging.error(f"Error getting members for group {group_id}: {e}")
        return []

def add_user_to_group(user_id: str, group_id: str):
    """
    Add a user to a group in Authentik.
    
    Args:
        user_id (str): Authentik user ID
        group_id (str): Authentik group ID
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        
        url = f"{Config.AUTHENTIK_API_URL}/core/users/{user_id}/groups/"
        data = {"group": group_id}
        
        response = requests.post(url, headers=headers, json=data)
        response.raise_for_status()
        
        return True
    except Exception as e:
        logging.error(f"Error adding user {user_id} to group {group_id}: {e}")
        return False

def remove_user_from_group(user_id: str, group_id: str):
    """
    Remove a user from a group in Authentik.
    
    Args:
        user_id (str): Authentik user ID
        group_id (str): Authentik group ID
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        
        url = f"{Config.AUTHENTIK_API_URL}/core/users/{user_id}/groups/{group_id}/"
        
        response = requests.delete(url, headers=headers)
        response.raise_for_status()
        
        return True
    except Exception as e:
        logging.error(f"Error removing user {user_id} from group {group_id}: {e}")
        return False

@require_admin
def create_group(admin_username: str, group_name: str, group_description: str = None):
    """
    Create a new group in Authentik.
    
    Args:
        admin_username (str): Username of the admin creating the group
        group_name (str): Name for the new group
        group_description (str, optional): Description for the new group
        
    Returns:
        dict: Response containing success status and group details
    """
    try:
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        
        data = {
            "name": group_name,
            "is_superuser": False
        }
        
        if group_description:
            data["attributes"] = {"description": group_description}
        
        url = f"{Config.AUTHENTIK_API_URL}/core/groups/"
        response = requests.post(url, headers=headers, json=data)
        response.raise_for_status()
        
        group_data = response.json()
        
        # Log the group creation
        with SessionLocal() as db:
            create_admin_event(
                db,
                "group_created",
                admin_username,
                f"Group '{group_name}' created"
            )
        
        return {
            "success": True,
            "group": group_data
        }
    except Exception as e:
        logging.error(f"Error creating group {group_name}: {e}")
        return {
            "success": False,
            "error": str(e)
        }

@require_admin
def delete_group(admin_username: str, group_id: str):
    """
    Delete a group from Authentik.
    
    Args:
        admin_username (str): Username of the admin deleting the group
        group_id (str): ID of the group to delete
        
    Returns:
        dict: Response containing success status
    """
    try:
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        
        # First get the group name for logging
        url = f"{Config.AUTHENTIK_API_URL}/core/groups/{group_id}/"
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        group_name = response.json().get('name', 'Unknown group')
        
        # Now delete the group
        response = requests.delete(url, headers=headers)
        response.raise_for_status()
        
        # Log the group deletion
        with SessionLocal() as db:
            create_admin_event(
                db,
                "group_deleted",
                admin_username,
                f"Group '{group_name}' deleted"
            )
        
        return {
            "success": True
        }
    except Exception as e:
        logging.error(f"Error deleting group {group_id}: {e}")
        return {
            "success": False,
            "error": str(e)
        }

@require_admin
def manage_user_groups(admin_username: str, user_id: str, groups_to_add: List[str] = None, groups_to_remove: List[str] = None):
    """
    Manage a user's group memberships.
    
    Args:
        admin_username (str): Username of the admin managing the groups
        user_id (str): Authentik user ID
        groups_to_add (List[str], optional): List of group IDs to add the user to
        groups_to_remove (List[str], optional): List of group IDs to remove the user from
        
    Returns:
        dict: Response containing success status
    """
    try:
        success = True
        errors = []
        added_groups = []
        removed_groups = []
        
        # Get user details for logging
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        
        user_url = f"{Config.AUTHENTIK_API_URL}/core/users/{user_id}/"
        response = requests.get(user_url, headers=headers)
        response.raise_for_status()
        username = response.json().get('username', 'Unknown user')
        
        # Add user to groups
        if groups_to_add:
            for group_id in groups_to_add:
                # Get group name for logging
                group_url = f"{Config.AUTHENTIK_API_URL}/core/groups/{group_id}/"
                group_response = requests.get(group_url, headers=headers)
                
                if group_response.status_code != 200:
                    errors.append(f"Group {group_id} not found")
                    success = False
                    continue
                    
                group_name = group_response.json().get('name', f"Group {group_id}")
                
                # Check if user is already in the group
                user_groups = get_user_groups(user_id)
                if any(g.get('pk') == group_id for g in user_groups):
                    logging.info(f"User {username} is already a member of group {group_name}")
                    continue
                
                # Add user to group
                if add_user_to_group(user_id, group_id):
                    added_groups.append(group_name)
                    
                    # Log the group addition
                    with SessionLocal() as db:
                        create_admin_event(
                            db,
                            "user_added_to_group",
                            admin_username,
                            f"User '{username}' added to group '{group_name}'"
                        )
                else:
                    errors.append(f"Failed to add user to group {group_name}")
                    success = False
        
        # Remove user from groups
        if groups_to_remove:
            for group_id in groups_to_remove:
                # Get group name for logging
                group_url = f"{Config.AUTHENTIK_API_URL}/core/groups/{group_id}/"
                group_response = requests.get(group_url, headers=headers)
                
                if group_response.status_code != 200:
                    errors.append(f"Group {group_id} not found")
                    success = False
                    continue
                    
                group_name = group_response.json().get('name', f"Group {group_id}")
                
                # Check if user is in the group
                user_groups = get_user_groups(user_id)
                if not any(g.get('pk') == group_id for g in user_groups):
                    logging.info(f"User {username} is not a member of group {group_name}")
                    continue
                
                # Remove user from group
                if remove_user_from_group(user_id, group_id):
                    removed_groups.append(group_name)
                    
                    # Log the group removal
                    with SessionLocal() as db:
                        create_admin_event(
                            db,
                            "user_removed_from_group",
                            admin_username,
                            f"User '{username}' removed from group '{group_name}'"
                        )
                else:
                    errors.append(f"Failed to remove user from group {group_name}")
                    success = False
        
        return {
            "success": success,
            "errors": errors if errors else None,
            "added_groups": added_groups,
            "removed_groups": removed_groups
        }
    except Exception as e:
        logging.error(f"Error managing groups for user {user_id}: {e}")
        return {
            "success": False,
            "error": str(e)
        }

@require_admin
def grant_admin_privileges(admin_username: str, target_username: str):
    """
    Grant admin privileges to a user.
    
    Args:
        admin_username (str): Username of the admin granting privileges
        target_username (str): Username to grant admin privileges to
        
    Returns:
        dict: Response containing success status
    """
    try:
        with SessionLocal() as db:
            if update_admin_status(db, target_username, True):
                create_admin_event(
                    db,
                    "admin_granted",
                    admin_username,
                    f"Admin privileges granted to {target_username} by {admin_username}"
                )
                return {
                    "success": True
                }
            else:
                return {
                    "success": False,
                    "error": f"Failed to grant admin privileges to {target_username}"
                }
    except Exception as e:
        logging.error(f"Error granting admin privileges to {target_username}: {e}")
        return {
            "success": False,
            "error": str(e)
        }

@require_admin
def revoke_admin_privileges(admin_username: str, target_username: str):
    """
    Revoke admin privileges from a user.
    
    Args:
        admin_username (str): Username of the admin revoking privileges
        target_username (str): Username to revoke admin privileges from
        
    Returns:
        dict: Response containing success status
    """
    try:
        # Don't allow revoking privileges from users in the config
        if Config.is_admin(target_username):
            return {
                "success": False,
                "error": f"Cannot revoke admin privileges from {target_username} as they are defined as admin in configuration"
            }
        
        with SessionLocal() as db:
            if update_admin_status(db, target_username, False):
                create_admin_event(
                    db,
                    "admin_revoked",
                    admin_username,
                    f"Admin privileges revoked from {target_username} by {admin_username}"
                )
                return {
                    "success": True
                }
            else:
                return {
                    "success": False,
                    "error": f"Failed to revoke admin privileges from {target_username}"
                }
    except Exception as e:
        logging.error(f"Error revoking admin privileges from {target_username}: {e}")
        return {
            "success": False,
            "error": str(e)
        }

def init_admin_users():
    """
    Initialize admin users from configuration.
    This should be called during application startup.
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        with SessionLocal() as db:
            # Get all users from the database
            users = db.query(User).all()
            
            # Get admin usernames from configuration
            admin_usernames = Config.ADMIN_USERNAMES
            
            # Update admin status based on configuration
            for user in users:
                should_be_admin = user.username in admin_usernames
                
                # Only update if the status needs to change
                if user.is_admin != should_be_admin:
                    user.is_admin = should_be_admin
                    
                    # Log the admin status change
                    event_type = "admin_granted" if should_be_admin else "admin_revoked"
                    create_admin_event(
                        db, 
                        event_type, 
                        user.username, 
                        f"Admin status {'granted to' if should_be_admin else 'revoked from'} {user.username} during initialization"
                    )
            
            db.commit()
            return True
    except Exception as e:
        logging.error(f"Error initializing admin users: {e}")
        return False