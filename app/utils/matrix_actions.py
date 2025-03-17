# app/utils/matrix_actions.py
"""
This module provides functions for interacting with Matrix messaging.
It includes functions for sending messages, creating direct chats, inviting users to rooms,
and getting room details. This module provides a synchronous wrapper for the matrix-nio library used in the streamlit app.
"""
import os
import logging
import asyncio
from typing import List, Dict, Optional, Union, Set, Any
from urllib.parse import urlparse
import json
from nio import AsyncClient, AsyncClientConfig

from app.utils.config import Config
from app.utils.helpers import get_eastern_time

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

async def get_matrix_client() -> Optional[AsyncClient]:
    """Get Matrix client instance"""
    if not Config.MATRIX_ACTIVE:
        return None
    
    client_config = AsyncClientConfig(
        max_limit_exceeded=0,
        max_timeouts=0,
        store_sync_tokens=False,
        encryption_enabled=False,
    )
    
    client = AsyncClient(
        homeserver=Config.MATRIX_URL,
        token=Config.MATRIX_ACCESS_TOKEN,
        config=client_config,
    )
    
    return client

async def send_matrix_message(room_id: str, message: str) -> bool:
    """Send a message to a Matrix room"""
    if not Config.MATRIX_ACTIVE:
        logging.warning("Matrix integration is disabled")
        return False

    try:
        client = await get_matrix_client()
        if not client:
            return False

        response = await client.room_send(
            room_id=room_id,
            message_type="m.room.message",
            content={"msgtype": "m.text", "body": message}
        )
        await client.close()
        return True
    except Exception as e:
        logging.error(f"Failed to send Matrix message: {e}")
        return False

async def create_matrix_direct_chat(user_id: str) -> Optional[str]:
    """Create a direct chat with a user"""
    if not Config.MATRIX_ACTIVE:
        logging.warning("Matrix integration is disabled")
        return None

    try:
        client = await get_matrix_client()
        if not client:
            return None

        response = await client.room_create(
            visibility=0,
            is_direct=True,
            invite=[user_id],
            preset="trusted_private_chat"
        )
        await client.close()
        
        if hasattr(response, 'room_id'):
            return response.room_id
        return None
    except Exception as e:
        logging.error(f"Failed to create Matrix direct chat: {e}")
        return None

async def invite_to_matrix_room(room_id: str, user_id: str) -> bool:
    """
    Invite a user to a Matrix room.
    
    Args:
        room_id (str): The ID of the room to invite the user to
        user_id (str): The Matrix ID of the user to invite
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Cannot invite user.")
        return False
    
    try:
        client = await get_matrix_client()
        if not client:
            logger.error("Failed to create Matrix client")
            return False
            
        response = await client.room_invite(room_id, user_id)
        
        # Check if response is RoomInviteResponse
        if isinstance(response, RoomInviteResponse):
            logger.info(f"Successfully invited {user_id} to room {room_id}")
            return True
            
        logger.error(f"Failed to invite {user_id} to room {room_id}: {response}")
        return False
            
    except Exception as e:
        logger.error(f"Error inviting user to room: {e}")
        return False
    finally:
        if client:
            await client.close()

def send_matrix_message_to_multiple_rooms(room_ids: List[str], message: str) -> Dict[str, bool]:
    """
    Synchronous wrapper for sending a message to multiple Matrix rooms.
    
    Args:
        room_ids: List of room IDs to send the message to
        message: The message content
        
    Returns:
        Dict[str, bool]: Dictionary mapping room IDs to success status
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping send_matrix_message_to_multiple_rooms.")
        return {room_id: False for room_id in room_ids}
        
    client = MatrixClient()
    try:
        # Check if there's an existing event loop
        try:
            loop = asyncio.get_event_loop()
            if loop.is_closed():
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
        except RuntimeError:
            # No event loop exists in this thread
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
        # Get the client and send the messages
        async_client = loop.run_until_complete(client._get_client())
        result = loop.run_until_complete(client.send_message_to_multiple_rooms(room_ids, message))
        
        # Close the client properly
        loop.run_until_complete(client.close())
        
        return result
    except Exception as e:
        logger.error(f"Error sending message to multiple rooms: {e}")
        return {room_id: False for room_id in room_ids}

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

def invite_user_to_rooms_by_interests(user_id: str, interests: List[str], username: str = None) -> Dict[str, bool]:
    """
    Invite a user to multiple rooms based on their interests.
    
    Args:
        user_id: The Matrix ID of the user
        interests: List of interest categories
        username: The username of the user (for welcome message)
        
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
    
    # Extract username from user_id if not provided
    if username is None:
        username = user_id.split(":")[0].lstrip("@")
    
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
            
        success = invite_to_matrix_room(room_id, user_id, username=username)
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
        # Check if there's an existing event loop
        try:
            loop = asyncio.get_event_loop()
            if loop.is_closed():
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
        except RuntimeError:
            # No event loop exists in this thread
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
        # Get the client and get joined rooms
        async_client = loop.run_until_complete(client._get_client())
        result = loop.run_until_complete(get_joined_rooms_async(async_client))
        
        # Close the client properly
        loop.run_until_complete(client.close())
        
        return result
    except Exception as e:
        logger.error(f"Error getting joined rooms: {e}")
        return []

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
            "member_count": 0,
            "display_name": None  # Added for better room identification
        }
        
        if hasattr(response, 'events'):
            for event in response.events:
                if event.get('type') == 'm.room.name':
                    room_details['name'] = event.get('content', {}).get('name')
                    room_details['display_name'] = event.get('content', {}).get('name')
                elif event.get('type') == 'm.room.topic':
                    room_details['topic'] = event.get('content', {}).get('topic')
                elif event.get('type') == 'm.room.canonical_alias':
                    room_details['canonical_alias'] = event.get('content', {}).get('alias')
                elif event.get('type') == 'm.room.aliases':
                    room_details['aliases'].extend(event.get('content', {}).get('aliases', []))
        
        # If no name was found, try to get it from canonical alias
        if not room_details['display_name'] and room_details['canonical_alias']:
            room_details['display_name'] = room_details['canonical_alias'].split(':')[0].lstrip('#')
        
        # If still no name, use a formatted version of the room ID
        if not room_details['display_name']:
            room_details['display_name'] = room_details['room_id'].split(':')[0].lstrip('!')
        
        # Get member count using our get_room_members_async function
        members = await get_room_members_async(client, room_id)
        room_details['member_count'] = len(members)
        
        return room_details
    except Exception as e:
        logger.error(f"Error getting details for room {room_id}: {e}")
        return {
            "room_id": room_id,
            "name": None,
            "display_name": room_id.split(':')[0].lstrip('!'),  # Fallback to formatted room ID
            "error": str(e)
        }

async def get_room_name_by_id(client: AsyncClient, room_id: str) -> str:
    """
    Get a human-readable name for a room by its ID.
    
    Args:
        client: The Matrix client
        room_id: The ID of the room
        
    Returns:
        str: The room's display name or a formatted version of its ID
    """
    try:
        room_details = await get_room_details_async(client, room_id)
        return room_details.get('display_name', room_id.split(':')[0].lstrip('!'))
    except Exception as e:
        logger.error(f"Error getting room name for {room_id}: {e}")
        return room_id.split(':')[0].lstrip('!')

def get_room_name(room_id: str) -> str:
    """
    Synchronous wrapper to get a room's display name.
    
    Args:
        room_id: The ID of the room
        
    Returns:
        str: The room's display name or a formatted version of its ID
    """
    if not MATRIX_ACTIVE:
        return room_id.split(':')[0].lstrip('!')
        
    client = MatrixClient()
    try:
        # Check if there's an existing event loop
        try:
            loop = asyncio.get_event_loop()
            if loop.is_closed():
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
        except RuntimeError:
            # No event loop exists in this thread
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
        # Get the client and get room name
        async_client = loop.run_until_complete(client._get_client())
        result = loop.run_until_complete(get_room_name_by_id(async_client, room_id))
        
        # Close the client properly
        loop.run_until_complete(client.close())
        
        return result
    except Exception as e:
        logger.error(f"Error getting room name for {room_id}: {e}")
        return room_id.split(':')[0].lstrip('!')

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
        # Check if there's an existing event loop
        try:
            loop = asyncio.get_event_loop()
            if loop.is_closed():
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
        except RuntimeError:
            # No event loop exists in this thread
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        # Get all joined room IDs
        async_client = loop.run_until_complete(client._get_client())
        room_ids = loop.run_until_complete(get_joined_rooms_async(async_client))
        
        # Get details for each room
        rooms = []
        for room_id in room_ids:
            try:
                room_details = loop.run_until_complete(get_room_details_async(async_client, room_id))
                rooms.append(room_details)
            except Exception as e:
                logger.error(f"Error getting details for room {room_id}: {e}")
                rooms.append({"room_id": room_id, "name": f"Error: {str(e)[:30]}...", "error": str(e)})
        
        # Close the client properly
        loop.run_until_complete(client.close())
        
        # Don't close the loop if we didn't create it
        # This prevents issues with other async code in the application
        
        return rooms
    except Exception as e:
        logger.error(f"Error getting accessible rooms: {e}")
        return []

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
    
    # Create a mapping of room names to room IDs for easier lookup
    room_name_to_id = {}
    for room in matrix_rooms:
        if 'room_id' in room and 'display_name' in room:
            room_name_to_id[room['display_name']] = room['room_id']
    
    # Merge the data
    merged_rooms = []
    
    # First, add all configured rooms with additional details from Matrix
    for config_room in config_rooms:
        room_id = config_room.get('room_id')
        room_name = config_room.get('name')
        
        # Try to find the room by ID first
        if room_id and room_id in matrix_rooms_map:
            # Merge configuration with Matrix data
            merged_room = {**matrix_rooms_map[room_id], **config_room}
            merged_room['configured'] = True
            merged_room['accessible'] = True
            merged_rooms.append(merged_room)
        # If not found by ID, try to find by name
        elif room_name and room_name in room_name_to_id:
            matrix_room = matrix_rooms_map.get(room_name_to_id[room_name])
            if matrix_room:
                # Merge configuration with Matrix data
                merged_room = {**matrix_room, **config_room}
                merged_room['configured'] = True
                merged_room['accessible'] = True
                merged_rooms.append(merged_room)
        else:
            # Room is in config but not accessible
            config_room['configured'] = True
            config_room['accessible'] = False
            config_room['display_name'] = config_room.get('name', config_room.get('room_id', 'Unknown Room'))
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
    
    # Sort rooms by name for better organization
    merged_rooms.sort(key=lambda x: x.get('display_name', '').lower())
    
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
        room_id: The ID of the room to remove the user from
        user_id: The Matrix user ID to remove
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping remove_from_matrix_room.")
        return False
        
    client = MatrixClient()
    try:
        # Check if there's an existing event loop
        try:
            loop = asyncio.get_event_loop()
            if loop.is_closed():
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
        except RuntimeError:
            # No event loop exists in this thread
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
        # Get the client and remove the user
        async_client = loop.run_until_complete(client._get_client())
        result = loop.run_until_complete(remove_from_room(async_client, room_id, user_id))
        
        # Close the client properly
        loop.run_until_complete(client.close())
        
        return result
    except Exception as e:
        logger.error(f"Error removing user {user_id} from room {room_id}: {e}")
        return False

async def get_room_members_async(client, room_id: str) -> List[Dict[str, Any]]:
    """
    Get all members of a Matrix room asynchronously.
    First tries to get from cache, then falls back to Matrix API.
    
    Args:
        client: Matrix client
        room_id: Matrix room ID
        
    Returns:
        List of member dictionaries
    """
    try:
        # Get database connection
        db = next(get_db())
        
        # Try to get from cache first
        cached_members = get_matrix_room_members(db, room_id)
        if cached_members:
            logging.info(f"Using cached members for room {room_id}")
            return cached_members
            
        # If not in cache, fetch from Matrix
        logging.info(f"Fetching members for room {room_id}")
        
        # Try room_get_state first
        try:
            state_response = await client.room_get_state(room_id)
            if state_response and hasattr(state_response, 'members'):
                members = state_response.members
                logging.info(f"Found {len(members)} members in room {room_id} using room_get_state")
                
                # Cache the results
                update_matrix_room_members(db, room_id, members)
                return members
        except Exception as e:
            logging.warning(f"Failed to get members using room_get_state: {str(e)}")
        
        # Fallback to room_get_joined_members
        try:
            members_response = await client.room_get_joined_members(room_id)
            if members_response and hasattr(members_response, 'members'):
                members = members_response.members
                logging.info(f"Found {len(members)} members in room {room_id} using room_get_joined_members")
                
                # Cache the results
                update_matrix_room_members(db, room_id, members)
                return members
        except Exception as e:
            logging.error(f"Failed to get members using room_get_joined_members: {str(e)}")
        
        return []
    except Exception as e:
        logging.error(f"Error getting room members for {room_id}: {str(e)}")
        return []

def get_all_accessible_users() -> List[Dict]:
    """
    Get all users accessible to the bot across all rooms.
    
    Returns:
        List[Dict]: List of user details including user_id and display_name
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping get_all_accessible_users.")
        return []
        
    logger.info("Fetching all accessible users from Matrix")
    client = MatrixClient()
    try:
        # Check if there's an existing event loop
        try:
            loop = asyncio.get_event_loop()
            if loop.is_closed():
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
        except RuntimeError:
            # No event loop exists in this thread
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
        # Get all joined room IDs
        async_client = loop.run_until_complete(client._get_client())
        room_ids = loop.run_until_complete(get_joined_rooms_async(async_client))
        
        logger.info(f"Found {len(room_ids)} rooms to check for users")
        
        # Get members for each room
        all_users = {}
        for room_id in room_ids:
            try:
                room_members = loop.run_until_complete(get_room_members_async(async_client, room_id))
                for member in room_members:
                    user_id = member["user_id"]
                    if user_id != MATRIX_BOT_USERNAME and user_id not in all_users:
                        all_users[user_id] = member
                        logger.debug(f"Added user {user_id} from room {room_id}")
            except Exception as e:
                logger.error(f"Error getting members for room {room_id}: {e}")
        
        # Close the client properly
        loop.run_until_complete(client.close())
        
        logger.info(f"Found {len(all_users)} unique users across all rooms")
        
        # If no users were found, add some dummy users for testing
        if not all_users and os.environ.get("ENVIRONMENT") == "development":
            logger.warning("No users found, adding dummy users for development")
            all_users = {
                "@user1:matrix.org": {
                    "user_id": "@user1:matrix.org",
                    "display_name": "User One",
                    "membership": "join"
                },
                "@user2:matrix.org": {
                    "user_id": "@user2:matrix.org",
                    "display_name": "User Two",
                    "membership": "join"
                }
            }
        
        return list(all_users.values())
    except Exception as e:
        logger.error(f"Error getting accessible users: {e}")
        return []

async def _send_direct_message_async(user_id: str, message: str) -> bool:
    """
    Send a direct message to a Matrix user asynchronously.
    
    Args:
        user_id (str): The Matrix user ID to send the message to
        message (str): The message content
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Cannot send direct message.")
        return False
    
    try:
        # Create Matrix client
        client = await get_matrix_client()
        if not client:
            logger.error("Failed to create Matrix client")
            return False
        
        # Check if we already have a direct chat with this user
        direct_room_id = None
        rooms = await client.joined_rooms()
        
        for room_id in rooms.rooms:
            # Get room members
            members = await get_room_members_async(client, room_id)
            
            # Check if this is a direct chat with the target user
            if members and len(members) == 2:  # Just us and the target user
                for member in members:
                    if member["user_id"] == user_id:
                        direct_room_id = room_id
                        break
                
                if direct_room_id:
                    break
        
        # If no direct chat exists, create one
        if not direct_room_id:
            logger.info(f"Creating new direct chat with {user_id}")
            response = await client.room_create(
                visibility=0,  # Private
                name=f"Direct chat with {user_id}",
                is_direct=True,
                invite=[user_id]
            )
            
            if isinstance(response, RoomCreateResponse):
                direct_room_id = response.room_id
                logger.info(f"Created direct chat room: {direct_room_id}")
            else:
                logger.error(f"Failed to create direct chat room: {response}")
                await client.close()
                return False
        
        # Send the message
        response = await client.room_send(
            room_id=direct_room_id,
            message_type="m.room.message",
            content={
                "msgtype": "m.text",
                "body": message
            }
        )
        
        # Close the client
        await client.close()
        
        if isinstance(response, RoomSendResponse):
            logger.info(f"Message sent to {user_id} successfully")
            return True
        else:
            logger.error(f"Failed to send message: {response}")
            return False
    except Exception as e:
        logger.error(f"Error sending direct message: {e}")
        return False

def send_direct_message(user_id: str, message: str) -> bool:
    """
    Send a direct message to a Matrix user.
    
    Args:
        user_id (str): The Matrix user ID to send the message to
        message (str): The message content
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Cannot send direct message.")
        return False
    
    try:
        # Create and manage the event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(_send_direct_message_async(user_id, message))
        loop.close()
        return result
    except Exception as e:
        logger.error(f"Error in send_direct_message: {e}")
        return False

async def _send_room_message_async(room_id: str, message: str) -> bool:
    """
    Send a message to a Matrix room asynchronously.
    
    Args:
        room_id (str): The Matrix room ID to send the message to
        message (str): The message content
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Cannot send room message.")
        return False
    
    try:
        # Create Matrix client
        client = await get_matrix_client()
        if not client:
            logger.error("Failed to create Matrix client")
            return False
        
        # Send the message
        response = await client.room_send(
            room_id=room_id,
            message_type="m.room.message",
            content={
                "msgtype": "m.text",
                "body": message
            }
        )
        
        # Close the client
        await client.close()
        
        if isinstance(response, RoomSendResponse):
            logger.info(f"Message sent to room {room_id} successfully")
            return True
        else:
            logger.error(f"Failed to send message to room: {response}")
            return False
    except Exception as e:
        logger.error(f"Error sending room message: {e}")
        return False

def send_room_message(room_id: str, message: str) -> bool:
    """
    Send a message to a Matrix room.
    
    Args:
        room_id (str): The Matrix room ID to send the message to
        message (str): The message content
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Cannot send room message.")
        return False
    
    try:
        # Create and manage the event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(_send_room_message_async(room_id, message))
        loop.close()
        return result
    except Exception as e:
        logger.error(f"Error in send_room_message: {e}")
        return False
