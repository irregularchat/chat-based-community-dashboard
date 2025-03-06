# app/utils/matrix_actions.py
"""
This module provides functions for interacting with Matrix messaging.
It includes functions for sending messages, creating direct chats, inviting users to rooms,
and getting room details. This module provides a synchronous wrapper for the matrix-nio library used in the streamlit app.
"""
import os
import logging
import asyncio
from typing import List, Dict, Optional, Union, Set
from urllib.parse import urlparse

from utils.config import Config

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Check if Matrix integration is active
MATRIX_ACTIVE = Config.MATRIX_ACTIVE
if not MATRIX_ACTIVE:
    logger.warning("Matrix integration is not active. Matrix functionality will be disabled.")
    logger.info("To enable Matrix integration, set MATRIX_ACTIVE=True in your .env file.")

# Matrix client imports - only import if Matrix is active
if MATRIX_ACTIVE:
    try:
        from nio import (
            AsyncClient, 
            LoginResponse, 
            RoomCreateResponse, 
            RoomInviteResponse,
            RoomSendResponse,
            RoomMessagesResponse,
            RoomMessageText
        )
    except ImportError:
        logger.error("Failed to import matrix-nio. Make sure it's installed from the requirements.txt: pip install matrix-nio")
        MATRIX_ACTIVE = False
else:
    # Define dummy classes to avoid errors when Matrix is not active
    class AsyncClient: pass
    class LoginResponse: pass
    class RoomCreateResponse: pass
    class RoomInviteResponse: pass
    class RoomSendResponse: pass
    class RoomMessagesResponse: pass
    class RoomMessageText: pass

# Get Matrix configuration from environment variables
MATRIX_URL = Config.MATRIX_URL or "https://matrix.org"
MATRIX_ACCESS_TOKEN = Config.MATRIX_ACCESS_TOKEN or ""
MATRIX_BOT_USERNAME = Config.MATRIX_BOT_USERNAME or "@bot:matrix.org"
MATRIX_BOT_DISPLAY_NAME = Config.MATRIX_BOT_DISPLAY_NAME or "Service Bot"
MATRIX_DEFAULT_ROOM_ID = Config.MATRIX_DEFAULT_ROOM_ID or ""
MATRIX_WELCOME_ROOM_ID = Config.MATRIX_WELCOME_ROOM_ID or ""

# Parse the homeserver URL from MATRIX_URL
parsed_url = urlparse(MATRIX_URL)
HOMESERVER = f"{parsed_url.scheme}://{parsed_url.netloc}"

class MatrixClient:
    """
    A client for interacting with Matrix servers using matrix-nio. This is a synchronous wrapper for the matrix-nio library used in the streamlit app.
    """
    def __init__(self, homeserver=HOMESERVER, access_token=MATRIX_ACCESS_TOKEN, user_id=MATRIX_BOT_USERNAME):
        """
        Initialize the Matrix client.
        
        Args:
            homeserver: The URL of the Matrix homeserver
            access_token: The access token for authentication
            user_id: The Matrix user ID to use
        """
        self.homeserver = homeserver
        self.access_token = access_token
        self.user_id = user_id
        self.client = None
        
    async def _get_client(self) -> AsyncClient:
        """
        Get or create an AsyncClient instance.
        
        Returns:
            AsyncClient: The Matrix client
        """
        if self.client is None:
            # Create a new client
            self.client = AsyncClient(
                homeserver=self.homeserver,
                device_id=f"Dashboard_Bot_{os.getpid()}"
            )
            
            # Set the access token and user_id
            self.client.access_token = self.access_token
            self.client.user_id = self.user_id
            
            # We don't need to set logged_in flag manually as it's a property
            # that's determined by whether access_token is set
            
        return self.client
    
    async def close(self):
        """Close the Matrix client connection."""
        if self.client:
            await self.client.close()
            self.client = None
    
    async def send_message(self, room_id: str, message: str) -> bool:
        """
        Send a message to a Matrix room.
        
        Args:
            room_id: The ID of the room to send the message to
            message: The message content
            
        Returns:
            bool: True if the message was sent successfully, False otherwise
        """
        if not MATRIX_ACTIVE:
            logger.warning("Matrix integration is not active. Skipping send_message.")
            return False
            
        try:
            client = await self._get_client()
            response = await client.room_send(
                room_id=room_id,
                message_type="m.room.message",
                content={
                    "msgtype": "m.text",
                    "body": message
                }
            )
            
            if isinstance(response, RoomSendResponse) and response.event_id:
                logger.info(f"Message sent to room {room_id} with event_id {response.event_id}")
                return True
            else:
                logger.error(f"Failed to send message to room {room_id}: {response}")
                return False
                
        except Exception as e:
            logger.error(f"Error sending message to room {room_id}: {e}")
            return False
        finally:
            await self.close()
    
    async def create_direct_chat(self, user_id: str) -> Optional[str]:
        """
        Create a direct chat with another user.
        
        Args:
            user_id: The Matrix ID of the user to chat with
            
        Returns:
            Optional[str]: The room ID of the created chat, or None if creation failed
        """
        if not MATRIX_ACTIVE:
            logger.warning("Matrix integration is not active. Skipping create_direct_chat.")
            return None
            
        try:
            client = await self._get_client()
            
            # Create a direct message room
            response = await client.room_create(
                visibility="private",
                is_direct=True,
                invite=[user_id],
                preset="trusted_private_chat",
                initial_state=[]
            )
            
            if isinstance(response, RoomCreateResponse):
                room_id = response.room_id
                logger.info(f"Created direct chat room with {user_id}: {room_id}")
                return room_id
            else:
                logger.error(f"Failed to create direct chat with {user_id}: {response}")
                return None
                
        except Exception as e:
            logger.error(f"Error creating direct chat with {user_id}: {e}")
            return None
        finally:
            await self.close()
    
    async def invite_to_room(self, room_id: str, user_id: str) -> bool:
        """
        Invite a user to a Matrix room.
        
        Args:
            room_id: The ID of the room to invite the user to
            user_id: The Matrix ID of the user to invite
            
        Returns:
            bool: True if the invitation was sent successfully, False otherwise
        """
        if not MATRIX_ACTIVE:
            logger.warning("Matrix integration is not active. Skipping invite_to_room.")
            return False
            
        try:
            client = await self._get_client()
            response = await client.room_invite(room_id, user_id)
            
            if isinstance(response, RoomInviteResponse):
                logger.info(f"Invited {user_id} to room {room_id}")
                return True
            else:
                logger.error(f"Failed to invite {user_id} to room {room_id}: {response}")
                return False
                
        except Exception as e:
            logger.error(f"Error inviting {user_id} to room {room_id}: {e}")
            return False
        finally:
            await self.close()
    
    async def send_message_to_multiple_rooms(self, room_ids: List[str], message: str) -> Dict[str, bool]:
        """
        Send a message to multiple rooms.
        
        Args:
            room_ids: List of room IDs to send the message to
            message: The message content
            
        Returns:
            Dict[str, bool]: A dictionary mapping room IDs to success status
        """
        if not MATRIX_ACTIVE:
            logger.warning("Matrix integration is not active. Skipping send_message_to_multiple_rooms.")
            return {room_id: False for room_id in room_ids}
            
        results = {}
        client = await self._get_client()
        
        try:
            for room_id in room_ids:
                response = await client.room_send(
                    room_id=room_id,
                    message_type="m.room.message",
                    content={
                        "msgtype": "m.text",
                        "body": message
                    }
                )
                
                if isinstance(response, RoomSendResponse) and response.event_id:
                    logger.info(f"Message sent to room {room_id} with event_id {response.event_id}")
                    results[room_id] = True
                else:
                    logger.error(f"Failed to send message to room {room_id}: {response}")
                    results[room_id] = False
                    
        except Exception as e:
            logger.error(f"Error in send_message_to_multiple_rooms: {e}")
            # Mark remaining rooms as failed
            for room_id in room_ids:
                if room_id not in results:
                    results[room_id] = False
        finally:
            await self.close()
            
        return results

# Synchronous wrapper functions for easier integration with Streamlit

def send_matrix_message(room_id: str, message: str) -> bool:
    """
    Synchronous wrapper for sending a message to a Matrix room.
    
    Args:
        room_id: The ID of the room to send the message to
        message: The message content
        
    Returns:
        bool: True if the message was sent successfully, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping send_matrix_message.")
        return False
        
    client = MatrixClient()
    return asyncio.run(client.send_message(room_id, message))

def create_matrix_direct_chat(user_id: str) -> Optional[str]:
    """
    Synchronous wrapper for creating a direct chat with another user.
    
    Args:
        user_id: The Matrix ID of the user to chat with
        
    Returns:
        Optional[str]: The room ID of the created chat, or None if creation failed
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping create_matrix_direct_chat.")
        return None
        
    client = MatrixClient()
    return asyncio.run(client.create_direct_chat(user_id))

def invite_to_matrix_room(room_id: str, user_id: str) -> bool:
    """
    Synchronous wrapper for inviting a user to a Matrix room.
    
    Args:
        room_id: The ID of the room to invite the user to
        user_id: The Matrix ID of the user to invite
        
    Returns:
        bool: True if the invitation was sent successfully, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping invite_to_matrix_room.")
        return False
        
    client = MatrixClient()
    return asyncio.run(client.invite_to_room(room_id, user_id))

def send_matrix_message_to_multiple_rooms(room_ids: List[str], message: str) -> Dict[str, bool]:
    """
    Synchronous wrapper for sending a message to multiple Matrix rooms.
    
    Args:
        room_ids: List of room IDs to send the message to
        message: The message content
        
    Returns:
        Dict[str, bool]: A dictionary mapping room IDs to success status
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping send_matrix_message_to_multiple_rooms.")
        return {room_id: False for room_id in room_ids}
        
    client = MatrixClient()
    return asyncio.run(client.send_message_to_multiple_rooms(room_ids, message))

def send_welcome_message(user_id: str, username: str, full_name: str = None) -> bool:
    """
    Send a welcome message to a new user.
    
    Args:
        user_id: The Matrix ID of the user
        username: The username of the user
        full_name: The full name of the user (optional)
        
    Returns:
        bool: True if the message was sent successfully, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping send_welcome_message.")
        return False
        
    # Create a direct chat with the user
    room_id = create_matrix_direct_chat(user_id)
    if not room_id:
        logger.error(f"Failed to create direct chat with {user_id}")
        return False
    
    # Prepare the welcome message
    name_to_use = full_name if full_name else username
    message = f"Welcome to our community, {name_to_use}! 👋\n\n"
    message += "I'm the community bot, here to help you get started. "
    message += "Feel free to explore our community rooms and reach out if you have any questions."
    
    # Send the welcome message
    return send_matrix_message(room_id, message)

def announce_new_user(username: str, full_name: str = None, intro: str = None) -> bool:
    """
    Announce a new user in the welcome room.
    
    Args:
        username: The username of the new user
        full_name: The full name of the new user (optional)
        intro: The user's introduction (optional)
        
    Returns:
        bool: True if the announcement was sent successfully, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping announce_new_user.")
        return False
        
    if not MATRIX_WELCOME_ROOM_ID:
        logger.warning("No welcome room ID configured, skipping announcement")
        return False
    
    # Prepare the announcement message
    name_to_use = full_name if full_name else username
    message = f"🎉 Please welcome our new community member: **{name_to_use}** (@{username})!"
    
    if intro:
        message += f"\n\nThey introduce themselves as:\n> {intro}"
    
    # Send the announcement
    return send_matrix_message(MATRIX_WELCOME_ROOM_ID, message)

def get_room_ids_by_category(category: str) -> List[str]:
    """
    Get room IDs for a specific category from the configuration.
    
    Args:
        category: The category name
        
    Returns:
        List[str]: List of room IDs for the category
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping get_room_ids_by_category.")
        return []
        
    rooms = Config.get_matrix_rooms_by_category(category)
    return [room["room_id"] for room in rooms if "room_id" in room]

def invite_user_to_rooms_by_interests(user_id: str, interests: List[str]) -> Dict[str, bool]:
    """
    Invite a user to multiple rooms based on their interests.
    
    Args:
        user_id: The Matrix ID of the user
        interests: List of interest categories
        
    Returns:
        Dict[str, bool]: A dictionary mapping room IDs to success status
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping invite_user_to_rooms_by_interests.")
        return {}
        
    results = {}
    
    # Normalize user ID format if needed
    if not user_id.startswith("@"):
        user_id = f"@{user_id}"
    
    if ":" not in user_id:
        domain = os.getenv("BASE_DOMAIN", "example.com")
        user_id = f"{user_id}:{domain}"
    
    # Get all rooms from configuration
    all_rooms = Config.get_matrix_rooms()
    
    # Filter rooms by user interests
    matching_rooms = []
    for room in all_rooms:
        # Check if any interest matches any of the room's categories
        if "categories" in room and isinstance(room["categories"], list):
            room_categories = [cat.lower() for cat in room["categories"]]
            if any(interest.lower() in room_categories for interest in interests):
                matching_rooms.append((room.get("name", "Unknown Room"), room.get("room_id")))
        else:
            # Fallback to the original category string
            room_category = room.get("category", "").lower()
            if any(interest.lower() in room_category for interest in interests):
                matching_rooms.append((room.get("name", "Unknown Room"), room.get("room_id")))
    
    # Invite user to each matching room
    for room_name, room_id in matching_rooms:
        if not room_id:
            continue
            
        success = invite_to_matrix_room(room_id, user_id)
        results[room_id] = success
        
        if success:
            logger.info(f"Invited {user_id} to {room_name} ({room_id})")
        else:
            logger.error(f"Failed to invite {user_id} to {room_name} ({room_id})")
    
    return results

async def get_joined_rooms_async(client: AsyncClient) -> List[str]:
    """
    Get all room IDs that the bot has joined.
    
    Args:
        client: The Matrix client
        
    Returns:
        List[str]: List of room IDs
    """
    try:
        response = await client.joined_rooms()
        if hasattr(response, 'rooms'):
            return response.rooms
        return []
    except Exception as e:
        logger.error(f"Error getting joined rooms: {e}")
        return []

def get_joined_rooms() -> List[str]:
    """
    Synchronous wrapper to get all rooms the bot has joined.
    
    Returns:
        List[str]: List of room IDs
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping get_joined_rooms.")
        return []
        
    client = MatrixClient()
    try:
        return asyncio.run(get_joined_rooms_async(client._get_client()))
    finally:
        asyncio.run(client.close())

async def get_room_details_async(client: AsyncClient, room_id: str) -> Dict:
    """
    Get details about a specific room.
    
    Args:
        client: The Matrix client
        room_id: The ID of the room
        
    Returns:
        Dict: Room details including name and aliases
    """
    try:
        # Get room state to extract name and other details
        response = await client.room_get_state(room_id)
        
        room_details = {
            "room_id": room_id,
            "name": None,
            "aliases": [],
            "topic": None,
            "canonical_alias": None,
            "member_count": 0
        }
        
        if hasattr(response, 'events'):
            for event in response.events:
                if event.get('type') == 'm.room.name':
                    room_details['name'] = event.get('content', {}).get('name')
                elif event.get('type') == 'm.room.topic':
                    room_details['topic'] = event.get('content', {}).get('topic')
                elif event.get('type') == 'm.room.canonical_alias':
                    room_details['canonical_alias'] = event.get('content', {}).get('alias')
                elif event.get('type') == 'm.room.aliases':
                    room_details['aliases'].extend(event.get('content', {}).get('aliases', []))
        
        # Get member count
        members_response = await client.get_room_members(room_id)
        if hasattr(members_response, 'members'):
            room_details['member_count'] = len(members_response.members)
        
        return room_details
    except Exception as e:
        logger.error(f"Error getting details for room {room_id}: {e}")
        return {"room_id": room_id, "name": None, "error": str(e)}

def get_all_accessible_rooms() -> List[Dict]:
    """
    Get all rooms the bot has access to, with details.
    
    Returns:
        List[Dict]: List of room details
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping get_all_accessible_rooms.")
        return []
        
    client = MatrixClient()
    try:
        # Get all joined room IDs
        async_client = asyncio.run(client._get_client())
        room_ids = asyncio.run(get_joined_rooms_async(async_client))
        
        # Get details for each room
        rooms = []
        for room_id in room_ids:
            room_details = asyncio.run(get_room_details_async(async_client, room_id))
            rooms.append(room_details)
        
        return rooms
    except Exception as e:
        logger.error(f"Error getting accessible rooms: {e}")
        return []
    finally:
        asyncio.run(client.close())

def merge_room_data() -> List[Dict]:
    """
    Merge room data from configuration and actual joined rooms.
    
    Returns:
        List[Dict]: Combined list of rooms with configuration data when available
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping merge_room_data.")
        return Config.get_matrix_rooms()  # Return config rooms even if Matrix is inactive
        
    # Get rooms from configuration
    config_rooms = Config.get_matrix_rooms()
    config_room_ids = {room.get('room_id') for room in config_rooms if 'room_id' in room}
    
    # Get rooms from Matrix server
    matrix_rooms = get_all_accessible_rooms()
    
    # Create a mapping of room_id to room details from Matrix
    matrix_rooms_map = {room.get('room_id'): room for room in matrix_rooms if 'room_id' in room}
    
    # Merge the data
    merged_rooms = []
    
    # First, add all configured rooms with additional details from Matrix
    for config_room in config_rooms:
        room_id = config_room.get('room_id')
        if room_id and room_id in matrix_rooms_map:
            # Merge configuration with Matrix data
            merged_room = {**matrix_rooms_map[room_id], **config_room}
            merged_room['configured'] = True
            merged_rooms.append(merged_room)
        else:
            # Room is in config but not accessible
            config_room['configured'] = True
            config_room['accessible'] = False
            merged_rooms.append(config_room)
    
    # Then, add any Matrix rooms not in configuration
    for room_id, matrix_room in matrix_rooms_map.items():
        if room_id not in config_room_ids:
            # Room is accessible but not configured
            matrix_room['configured'] = False
            matrix_room['accessible'] = True
            matrix_room['category'] = 'Uncategorized'
            matrix_room['categories'] = ['Uncategorized']
            merged_rooms.append(matrix_room)
    
    return merged_rooms

async def remove_from_room(client: AsyncClient, room_id: str, user_id: str) -> bool:
    """
    Remove a user from a Matrix room.
    
    Args:
        client: The Matrix client
        room_id: The ID of the room
        user_id: The Matrix ID of the user to remove
        
    Returns:
        bool: True if the user was removed successfully, False otherwise
    """
    try:
        response = await client.room_kick(room_id, user_id, reason="Removed via dashboard")
        
        if hasattr(response, 'event_id'):
            logger.info(f"Removed {user_id} from room {room_id}")
            return True
        else:
            logger.error(f"Failed to remove {user_id} from room {room_id}: {response}")
            return False
    except Exception as e:
        logger.error(f"Error removing {user_id} from room {room_id}: {e}")
        return False

def remove_from_matrix_room(room_id: str, user_id: str) -> bool:
    """
    Synchronous wrapper for removing a user from a Matrix room.
    
    Args:
        room_id: The ID of the room
        user_id: The Matrix ID of the user to remove
        
    Returns:
        bool: True if the user was removed successfully, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping remove_from_matrix_room.")
        return False
        
    client = MatrixClient()
    try:
        return asyncio.run(remove_from_room(client._get_client(), room_id, user_id))
    finally:
        asyncio.run(client.close())
