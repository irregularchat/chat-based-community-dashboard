"""
Matrix moderator power level management utilities
"""
import logging
import asyncio
from typing import Dict, Optional, List
from nio import AsyncClient, RoomPutStateError
from app.utils.matrix_bot import get_matrix_client
from app.utils.config import Config
from app.db.models import User
from sqlalchemy.orm import Session


async def set_user_power_level(room_id: str, user_id: str, power_level: int) -> bool:
    """
    Set a user's power level in a Matrix room.
    
    Args:
        room_id: The Matrix room ID
        user_id: The Matrix user ID (e.g., @user:matrix.org)
        power_level: The power level to set (0-100, where 50 is moderator, 100 is admin)
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        client = await get_matrix_client()
        if not client:
            logging.error("Failed to get Matrix client")
            return False
        
        # Get current power levels
        response = await client.room_get_state_event(room_id, "m.room.power_levels")
        if hasattr(response, 'content'):
            power_levels = response.content
        else:
            logging.error(f"Failed to get power levels for room {room_id}")
            return False
        
        # Update the user's power level
        if 'users' not in power_levels:
            power_levels['users'] = {}
        
        power_levels['users'][user_id] = power_level
        
        # Send the updated power levels
        response = await client.room_put_state(
            room_id=room_id,
            event_type="m.room.power_levels",
            content=power_levels
        )
        
        if isinstance(response, RoomPutStateError):
            logging.error(f"Failed to set power level: {response.message}")
            return False
        
        logging.info(f"Set power level for {user_id} in {room_id} to {power_level}")
        return True
        
    except Exception as e:
        logging.error(f"Error setting power level: {e}")
        return False


async def promote_user_in_room(room_id: str, user_id: str, as_admin: bool = False) -> bool:
    """
    Promote a user to moderator or admin in a Matrix room.
    
    Args:
        room_id: The Matrix room ID
        user_id: The Matrix user ID
        as_admin: If True, promote to admin (100), otherwise moderator (50)
        
    Returns:
        bool: True if successful, False otherwise
    """
    power_level = 100 if as_admin else 50
    return await set_user_power_level(room_id, user_id, power_level)


async def demote_user_in_room(room_id: str, user_id: str) -> bool:
    """
    Demote a user to regular member in a Matrix room.
    
    Args:
        room_id: The Matrix room ID
        user_id: The Matrix user ID
        
    Returns:
        bool: True if successful, False otherwise
    """
    return await set_user_power_level(room_id, user_id, 0)


async def sync_moderator_to_matrix_rooms(db: Session, username: str, room_ids: List[str], promote: bool = True) -> Dict[str, bool]:
    """
    Sync a moderator's status to multiple Matrix rooms.
    
    Args:
        db: Database session
        username: Username of the moderator
        room_ids: List of Matrix room IDs to sync
        promote: If True, promote the user; if False, demote
        
    Returns:
        Dict[str, bool]: Dictionary mapping room_id to success status
    """
    results = {}
    
    try:
        # Get user's Matrix ID
        user = db.query(User).filter(User.username == username).first()
        if not user or not user.matrix_username:
            logging.error(f"User {username} not found or no Matrix username")
            return {room_id: False for room_id in room_ids}
        
        matrix_user_id = user.matrix_username
        if not matrix_user_id.startswith('@'):
            # Construct full Matrix ID if needed
            matrix_domain = Config.MATRIX_HOMESERVER_URL.replace('https://', '').replace('http://', '')
            matrix_user_id = f"@{matrix_user_id}:{matrix_domain}"
        
        # Process each room
        for room_id in room_ids:
            if promote:
                success = await promote_user_in_room(room_id, matrix_user_id, as_admin=False)
            else:
                success = await demote_user_in_room(room_id, matrix_user_id)
            
            results[room_id] = success
            
            # Small delay to avoid rate limiting
            await asyncio.sleep(0.5)
        
        return results
        
    except Exception as e:
        logging.error(f"Error syncing moderator to Matrix rooms: {e}")
        return {room_id: False for room_id in room_ids}


async def get_user_power_level(room_id: str, user_id: str) -> Optional[int]:
    """
    Get a user's current power level in a Matrix room.
    
    Args:
        room_id: The Matrix room ID
        user_id: The Matrix user ID
        
    Returns:
        Optional[int]: The user's power level, or None if error
    """
    try:
        client = await get_matrix_client()
        if not client:
            return None
        
        # Get current power levels
        response = await client.room_get_state_event(room_id, "m.room.power_levels")
        if hasattr(response, 'content'):
            power_levels = response.content
            users = power_levels.get('users', {})
            
            # Check if user has explicit power level
            if user_id in users:
                return users[user_id]
            
            # Return default user level
            return power_levels.get('users_default', 0)
        else:
            logging.error(f"Failed to get power levels for room {room_id}")
            return None
            
    except Exception as e:
        logging.error(f"Error getting user power level: {e}")
        return None


async def auto_sync_all_moderator_rooms(db: Session, username: str, promote: bool = True) -> int:
    """
    Automatically sync a moderator's status to all rooms they have permission for.
    
    Args:
        db: Database session
        username: Username of the moderator
        promote: If True, promote the user; if False, demote
        
    Returns:
        int: Number of rooms successfully synced
    """
    try:
        from app.db.operations import get_user_by_username, get_moderator_permissions
        from app.utils.auth_helpers import get_user_accessible_rooms
        
        user = get_user_by_username(db, username)
        if not user:
            return 0
        
        # Get rooms the user has access to
        accessible_rooms = get_user_accessible_rooms(db, username)
        
        # If empty list returned, it means all rooms (for admins/global mods)
        if not accessible_rooms:
            # Get all configured rooms
            from app.utils.matrix_actions import merge_room_data
            all_rooms = merge_room_data()
            accessible_rooms = [room['room_id'] for room in all_rooms if room.get('room_id')]
        
        # Sync to all accessible rooms
        results = await sync_moderator_to_matrix_rooms(db, username, accessible_rooms, promote)
        
        # Count successful syncs
        success_count = sum(1 for success in results.values() if success)
        
        logging.info(f"Synced moderator {username} to {success_count}/{len(accessible_rooms)} rooms")
        return success_count
        
    except Exception as e:
        logging.error(f"Error in auto sync: {e}")
        return 0 