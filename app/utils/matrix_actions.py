# app/utils/matrix_actions.py
"""
This module provides functions for interacting with Matrix messaging.
It includes functions for sending messages, creating direct chats, inviting users to rooms,
and getting room details. This module provides a synchronous wrapper for the matrix-nio library used in the streamlit app.
"""
import os
import logging
import asyncio
import nest_asyncio
from typing import List, Dict, Optional, Union, Set, Any
from urllib.parse import urlparse
import json
from nio import AsyncClient, AsyncClientConfig

from app.utils.config import Config

# Import get_db conditionally to avoid import errors
try:
    from app.db.session import get_db
except ImportError:
    logger.warning("Could not import get_db - DB caching for matrix room members will not be available")
    # Create a dummy function to avoid errors
    def get_db():
        yield None

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
MATRIX_HOMESERVER_URL = Config.MATRIX_HOMESERVER_URL or "https://matrix.org"
MATRIX_ACCESS_TOKEN = Config.MATRIX_ACCESS_TOKEN or ""
MATRIX_BOT_USERNAME = Config.MATRIX_BOT_USERNAME or "@bot:matrix.org"
MATRIX_BOT_DISPLAY_NAME = Config.MATRIX_BOT_DISPLAY_NAME or "Service Bot"
MATRIX_DEFAULT_ROOM_ID = Config.MATRIX_DEFAULT_ROOM_ID or ""
MATRIX_WELCOME_ROOM_ID = Config.MATRIX_WELCOME_ROOM_ID or ""

# Parse the homeserver URL from MATRIX_HOMESERVER_URL
parsed_url = urlparse(MATRIX_HOMESERVER_URL)
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
                try:
                    response = await client.room_send(
                        room_id=room_id,
                        message_type="m.room.message",
                        content={
                            "msgtype": "m.text",
                            "body": message
                        }
                    )
                    results[room_id] = isinstance(response, RoomSendResponse) and response.event_id is not None
                except Exception as e:
                    logger.error(f"Error sending message to room {room_id}: {e}")
                    results[room_id] = False
        finally:
            await client.close()
            
        return results

# Synchronous wrapper functions for easier integration with Streamlit

async def get_matrix_client() -> Optional[AsyncClient]:
    """Get Matrix client instance"""
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active")
        return None

    client = None
    try:
        client_config = AsyncClientConfig(
            max_limit_exceeded=0,
            max_timeouts=0,
            store_sync_tokens=False,
            encryption_enabled=False,
        )

        client = AsyncClient(
            homeserver=MATRIX_HOMESERVER_URL,
            config=client_config,
        )
        client.access_token = MATRIX_ACCESS_TOKEN
        client.user_id = MATRIX_BOT_USERNAME

        # Skip sync for initial connection - some servers have issues with the next_batch property
        # Just return the client as it's authenticated with the access token
        logger.info(f"Matrix client created with user_id: {MATRIX_BOT_USERNAME}")
        return client
    except Exception as e:
        logger.error(f"Error creating Matrix client: {e}")
        if client:
            try:
                await client.close()
            except Exception as close_error:
                logger.error(f"Error closing Matrix client: {close_error}")
        return None

async def send_matrix_message(room_id, message, client=None):
    """Send a message to a Matrix room."""
    should_close = client is None  # Track if we created the client
    try:
        if client is None:
            client = await get_matrix_client()
            
        if not client:
            logging.error("Failed to get Matrix client")
            return False
            
        # Send the message
        await client.room_send(
            room_id=room_id,
            message_type="m.room.message",
            content={"msgtype": "m.text", "body": message}
        )
        
        # Only close if we created the client
        if should_close:
            await client.close()
            
        return True
    except Exception as e:
        logging.error(f"Error sending Matrix message: {e}")
        # Make sure to close client even on error if we created it
        if should_close and client:
            try:
                await client.close()
            except Exception as close_error:
                logging.error(f"Error closing Matrix client: {close_error}")
        return False

async def create_matrix_direct_chat(user_id: str) -> Optional[str]:
    """Create a direct chat with a user"""
    if not MATRIX_ACTIVE:
        logging.warning("Matrix integration is disabled")
        return None

    try:
        client = await get_matrix_client()
        if not client:
            return None

        response = await client.room_create(
            visibility="private",
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

async def send_matrix_message_to_multiple_rooms(room_ids: List[str], message: str) -> Dict[str, bool]:
    """
    Send a message to multiple Matrix rooms.
    
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
    client = await get_matrix_client()
    
    try:
        for room_id in room_ids:
            try:
                response = await client.room_send(
                    room_id=room_id,
                    message_type="m.room.message",
                    content={
                        "msgtype": "m.text",
                        "body": message
                    }
                )
                results[room_id] = isinstance(response, RoomSendResponse) and response.event_id is not None
            except Exception as e:
                logger.error(f"Error sending message to room {room_id}: {e}")
                results[room_id] = False
    finally:
        await client.close()
    
    return results

async def send_welcome_message_async(user_id: str, username: str, full_name: str = None) -> bool:
    """
    Send a welcome message to a new user asynchronously.
    
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
        
    try:
        # Create a direct chat with the user
        room_id = await create_matrix_direct_chat(user_id)
        if not room_id:
            logger.error(f"Failed to create direct chat with {user_id}")
            return False
        
        # Prepare the welcome message
        name_to_use = full_name if full_name else username
        message = f"Welcome to our community, {name_to_use}! 👋\n\n"
        message += "I'm the community bot, here to help you get started. "
        message += "Feel free to explore our community rooms and reach out if you have any questions."
        
        # Send the welcome message
        return await send_matrix_message(room_id, message)
    except Exception as e:
        logger.error(f"Error sending welcome message: {e}")
        return False

def send_welcome_message(user_id: str, username: str, full_name: str = None) -> bool:
    """
    Synchronous wrapper for sending a welcome message to a new user.
    
    Args:
        user_id: The Matrix ID of the user
        username: The username of the user
        full_name: The full name of the user (optional)
        
    Returns:
        bool: True if the message was sent successfully, False otherwise
    """
    try:
        # Create a new event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        # Send the welcome message
        result = loop.run_until_complete(send_welcome_message_async(user_id, username, full_name))
        return result
    except Exception as e:
        logger.error(f"Error sending welcome message: {e}")
        return False
    finally:
        # Clean up the loop
        if loop.is_running():
            loop.stop()
        if not loop.is_closed():
            loop.close()

async def announce_new_user_async(username: str, full_name: str = None, intro: str = None) -> bool:
    """
    Announce a new user in the welcome room asynchronously.
    
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
    
    try:
        # Prepare the announcement message
        name_to_use = full_name if full_name else username
        message = f"🎉 Please welcome our new community member: **{name_to_use}** (@{username})!"
        
        if intro:
            message += f"\n\nThey introduce themselves as:\n> {intro}"
        
        # Send the announcement
        return await send_matrix_message(MATRIX_WELCOME_ROOM_ID, message)
    except Exception as e:
        logger.error(f"Error announcing new user: {e}")
        return False

def announce_new_user(username: str, full_name: str = None, intro: str = None) -> bool:
    """
    Synchronous wrapper for announcing a new user in the welcome room.
    
    Args:
        username: The username of the new user
        full_name: The full name of the new user (optional)
        intro: The user's introduction (optional)
        
    Returns:
        bool: True if the announcement was sent successfully, False otherwise
    """
    try:
        # Create a new event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        # Send the announcement
        result = loop.run_until_complete(announce_new_user_async(username, full_name, intro))
        return result
    except Exception as e:
        logger.error(f"Error announcing new user: {e}")
        return False
    finally:
        # Clean up the loop
        if loop.is_running():
            loop.stop()
        if not loop.is_closed():
            loop.close()

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
    
    try:
        # Normalize user ID format if needed
        if not user_id.startswith("@"):
            user_id = f"@{user_id}"
        
        if ":" not in user_id:
            domain = Config.BASE_DOMAIN or os.getenv("BASE_DOMAIN", "example.com")
            user_id = f"{user_id}:{domain}"
        
        # Extract username from user_id if not provided
        if username is None:
            username = user_id.split(":")[0].lstrip("@")
        
        # Get all rooms from configuration
        all_rooms = Config.get_matrix_rooms()
        logger.info(f"Got {len(all_rooms)} rooms from configuration")
        
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
        
        logger.info(f"Found {len(matching_rooms)} matching rooms for interests: {interests}")
        
        # Create a new event loop for the async calls
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        # Invite user to each matching room
        for room_name, room_id in matching_rooms:
            if not room_id:
                logger.warning(f"Skipping invitation to room with no ID: {room_name}")
                continue
                
            try:
                # Use the async version directly with the event loop
                success = loop.run_until_complete(invite_to_matrix_room(room_id, user_id))
                results[room_id] = success
                
                if success:
                    logger.info(f"Invited {user_id} to {room_name} ({room_id})")
                else:
                    logger.warning(f"Failed to invite {user_id} to {room_name} ({room_id})")
            except Exception as e:
                logger.error(f"Error inviting {user_id} to {room_name} ({room_id}): {e}")
                results[room_id] = False
        
        # Clean up the loop
        loop.close()
        
    except Exception as e:
        logger.error(f"Error in invite_user_to_rooms_by_interests: {e}")
    
    return results

async def get_joined_rooms_async(client: AsyncClient = None) -> List[str]:
    """
    Get a list of all joined rooms asynchronously.
    
    Args:
        client: Optional AsyncClient instance. If not provided, a new one will be created.
        
    Returns:
        List[str]: List of room IDs the bot has joined
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping get_joined_rooms_async.")
        return []
    
    # If no client provided, create a temporary one
    close_client = False
    try:
        if client is None:
            client = AsyncClient(
                homeserver=HOMESERVER,
                device_id=f"Dashboard_Bot_{os.getpid()}"
            )
            client.access_token = MATRIX_ACCESS_TOKEN
            client.user_id = MATRIX_BOT_USERNAME
            close_client = True
            
        logger.info(f"Matrix client created with user_id: {client.user_id}")
        
        # Check if the client has a valid access token
        if not client.access_token:
            logger.warning("No access token provided for Matrix client.")
            return []
            
        try:
            # Get joined rooms
            response = await client.joined_rooms()
            
            # Check if response is valid
            if hasattr(response, 'rooms'):
                rooms = response.rooms
                return rooms
            else:
                error_msg = getattr(response, 'message', str(response))
                # Only log detailed warning if it's not the common M_UNKNOWN_TOKEN error
                if "M_UNKNOWN_TOKEN" not in error_msg:
                    logger.warning(f"Unexpected response format from joined_rooms(): {error_msg}")
                return []
                
        except Exception as e:
            # Only log detailed error if it's not the common M_UNKNOWN_TOKEN error
            if "M_UNKNOWN_TOKEN" not in str(e):
                logger.warning(f"Error getting joined rooms: {e}")
            return []
    except Exception as e:
        # Only log detailed error if it's not the common M_UNKNOWN_TOKEN error
        if "M_UNKNOWN_TOKEN" not in str(e):
            logger.error(f"Error in get_joined_rooms_async: {e}")
        return []
    finally:
        # Close the client if we created it here
        if close_client and client:
            await client.close()

def get_joined_rooms() -> List[str]:
    """
    Get a list of all joined rooms.
    
    Returns:
        List[str]: List of room IDs
    """
    global MATRIX_ACTIVE
    
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping get_joined_rooms.")
        return []
    
    # If token is empty or invalid, return empty list
    if not MATRIX_ACCESS_TOKEN:
        logger.warning("Matrix access token is empty. Skipping get_joined_rooms.")
        return []
    
    try:
        # Run the async function in a new event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        client = AsyncClient(
            homeserver=HOMESERVER,
            device_id=f"Dashboard_Bot_{os.getpid()}"
        )
        client.access_token = MATRIX_ACCESS_TOKEN
        client.user_id = MATRIX_BOT_USERNAME
        
        try:
            rooms = loop.run_until_complete(get_joined_rooms_async(client))
            loop.close()
            return rooms
        except Exception as e:
            logger.warning(f"Unexpected response format from joined_rooms(): {e}")
            # If it's an M_UNKNOWN_TOKEN error, flag Matrix as inactive
            if "M_UNKNOWN_TOKEN" in str(e):
                logger.error("Invalid Matrix access token. Disabling Matrix integration.")
                # Mark Matrix as inactive to prevent further attempts
                MATRIX_ACTIVE = False
            return []
    except Exception as e:
        logger.error(f"Error in get_joined_rooms: {e}")
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

async def get_all_accessible_rooms() -> List[Dict]:
    """
    Get all rooms that the bot has access to.
    
    Returns:
        List[Dict]: List of room dictionaries with details
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping get_all_accessible_rooms.")
        return []
        
    try:
        # Get a Matrix client
        client = await get_matrix_client()
        if not client:
            logger.error("Failed to get Matrix client")
            return []
            
        try:
            # Get joined rooms
            joined_rooms = await get_joined_rooms_async(client)
            
            # Get details for each room
            rooms = []
            for room_id in joined_rooms:
                room_details = await get_room_details_async(client, room_id)
                if room_details:
                    rooms.append(room_details)
                    
            return rooms
            
        finally:
            # Always close the client if we have one
            if client:
                await client.close()
            
    except Exception as e:
        logger.error(f"Error getting accessible rooms: {e}")
        return []

# Non-async wrapper that creates its own event loop
def get_all_accessible_rooms_sync() -> List[Dict]:
    """
    Synchronous wrapper for get_all_accessible_rooms.
    
    Returns:
        List[Dict]: List of room dictionaries with details
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping get_all_accessible_rooms_sync.")
        return []
    
    try:
        # Try to get the current event loop, if it's already running, use nest_asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Import nest_asyncio at runtime to avoid dependency issues
                import nest_asyncio
                nest_asyncio.apply()
        except RuntimeError:
            # No event loop exists in this thread
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        # Run the async function and return the result
        return asyncio.run(get_all_accessible_rooms())
    except Exception as e:
        logger.error(f"Error in get_all_accessible_rooms_sync: {e}")
        return []

def merge_room_data() -> List[Dict]:
    """
    Merge room data from Matrix API with configured room data.
    
    Returns:
        List[Dict]: Combined list of rooms with configuration data when available
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Returning configured rooms only.")
        return Config.get_matrix_rooms()
        
    try:
        # Get rooms from Matrix API - use the sync version
        matrix_rooms = get_all_accessible_rooms_sync()
        
        # Get configured rooms
        configured_rooms = Config.get_matrix_rooms()
        
        # Create a mapping of room IDs to configured data
        room_config = {room.get('room_id'): room for room in configured_rooms if room.get('room_id')}
        
        # Merge the data
        merged_rooms = []
        for room in matrix_rooms:
            room_id = room.get('room_id')
            if room_id in room_config:
                # Update Matrix room data with configured data
                room.update(room_config[room_id])
            merged_rooms.append(room)
            
        # Add any configured rooms that weren't found in Matrix
        for room_id, config in room_config.items():
            if not any(r.get('room_id') == room_id for r in merged_rooms):
                merged_rooms.append(config)
                
        return merged_rooms
        
    except Exception as e:
        logger.error(f"Error merging room data: {e}")
        # Fall back to configured rooms on error
        return Config.get_matrix_rooms()

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

async def get_room_members_async(client, room_id: str) -> Dict[str, Any]:
    """
    Get all members of a Matrix room asynchronously.
    
    Args:
        client: Matrix client
        room_id: Matrix room ID
        
    Returns:
        Dict[str, Any]: Dictionary mapping user IDs to member details
    """
    try:
        # Get database connection - wrap in try/except to avoid issues
        try:
            db = next(get_db())
            # Try to get from cache first
            cached_members = get_matrix_room_members(db, room_id)
            if cached_members:
                logging.info(f"Using cached members for room {room_id}")
                return cached_members
        except Exception as db_error:
            logging.warning(f"Error accessing database for room member cache: {db_error}")
        
        # If not in cache, fetch from Matrix
        logging.info(f"Fetching members for room {room_id}")
        members_dict = {}
        
        # Try room_get_state first
        try:
            state_response = await client.room_get_state(room_id)
            
            # Check for members in different formats
            if hasattr(state_response, 'members') and state_response.members:
                # Format: Object with members attribute (dictionary)
                members_dict = state_response.members
                logging.info(f"Found {len(members_dict)} members in room {room_id} using room_get_state.members")
            
            elif hasattr(state_response, 'events'):
                # Format: Object with events list
                for event in state_response.events:
                    if isinstance(event, dict) and event.get('type') == 'm.room.member':
                        user_id = event.get('state_key')
                        if user_id and event.get('content', {}).get('membership') == 'join':
                            members_dict[user_id] = {
                                'display_name': event.get('content', {}).get('displayname', user_id),
                                'avatar_url': event.get('content', {}).get('avatar_url', '')
                            }
                logging.info(f"Found {len(members_dict)} members in room {room_id} using room_get_state.events")
        
        except Exception as e:
            logging.warning(f"Failed to get members using room_get_state: {str(e)}")
        
        # If we didn't get any members, try room_get_joined_members
        if not members_dict:
            try:
                members_response = await client.room_get_joined_members(room_id)
                
                # Check for different response formats
                if hasattr(members_response, 'members') and members_response.members:
                    members_dict = members_response.members
                elif hasattr(members_response, 'joined') and members_response.joined:
                    members_dict = members_response.joined
                elif isinstance(members_response, dict) and 'joined' in members_response:
                    members_dict = members_response['joined']
                
                logging.info(f"Found {len(members_dict)} members in room {room_id} using room_get_joined_members")
            
            except Exception as e:
                logging.error(f"Failed to get members using room_get_joined_members: {str(e)}")
        
        # Cache the results if we got some
        if members_dict and db:
            try:
                update_matrix_room_members(db, room_id, members_dict)
            except Exception as cache_error:
                logging.warning(f"Failed to cache room members: {cache_error}")
        
        return members_dict
        
    except Exception as e:
        logging.error(f"Error getting room members for {room_id}: {str(e)}")
        return {}

async def get_all_accessible_users() -> List[Dict]:
    """
    Get all users that the bot can interact with from Matrix.
    
    Returns:
        List[Dict]: List of user dictionaries with details
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping get_all_accessible_users.")
        return []
        
    try:
        # Get a Matrix client
        client = await get_matrix_client()
        if not client:
            logger.error("Failed to get Matrix client")
            return []
            
        try:
            # Get joined rooms
            joined_rooms = await get_joined_rooms_async(client)
            
            # Get all users across all rooms
            all_users = {}
            for room_id in joined_rooms:
                room_members = await get_room_members_async(client, room_id)
                for user_id, details in room_members.items():
                    if user_id != MATRIX_BOT_USERNAME:  # Skip the bot itself
                        all_users[user_id] = details
                        
            # Convert dictionary to list
            users = []
            for user_id, details in all_users.items():
                user_dict = {
                    "user_id": user_id,
                    "display_name": details.get('display_name', user_id.split(':')[0].lstrip('@'))
                }
                users.append(user_dict)
                
            return users
            
        finally:
            # Always close the client if we have one
            if client:
                await client.close()
            
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
        rooms_response = await client.joined_rooms()
        
        # Get rooms list from response, handling different response formats
        if hasattr(rooms_response, 'rooms'):
            room_ids = rooms_response.rooms
        elif hasattr(rooms_response, 'joined_rooms'):
            room_ids = rooms_response.joined_rooms
        elif isinstance(rooms_response, dict) and 'joined_rooms' in rooms_response:
            room_ids = rooms_response['joined_rooms']
        elif isinstance(rooms_response, dict) and 'rooms' in rooms_response:
            room_ids = rooms_response['rooms']
        else:
            logger.warning(f"Unexpected response format from joined_rooms(): {rooms_response}")
            room_ids = []
        
        for room_id in room_ids:
            # Get room members
            members = await get_room_members_async(client, room_id)
            
            # Check if this is a direct chat with the target user
            if members and len(members) == 2:  # Just us and the target user
                for member_id in members:
                    if member_id == user_id:
                        direct_room_id = room_id
                        break
                
                if direct_room_id:
                    break
        
        # If no direct chat exists, create one
        if not direct_room_id:
            logger.info(f"Creating new direct chat with {user_id}")
            response = await client.room_create(
                visibility="private",  # Use string instead of int
                name=f"Direct chat with {user_id}",
                is_direct=True,
                invite=[user_id]
            )
            
            if hasattr(response, 'room_id'):
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
        
        if hasattr(response, 'event_id'):
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
        user_id: The Matrix ID of the user to message
        message: The message content
        
    Returns:
        bool: True if the message was sent successfully, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping send_direct_message.")
        return False
        
    try:
        # Create a new event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        # Send the message
        result = loop.run_until_complete(_send_direct_message_async(user_id, message))
        return result
        
    except Exception as e:
        logger.error(f"Error sending direct message to {user_id}: {e}")
        return False
    finally:
        loop.close()

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
        room_id: The ID of the room to send the message to
        message: The message content
        
    Returns:
        bool: True if the message was sent successfully, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping send_room_message.")
        return False
        
    try:
        # Create a new event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        # Send the message
        result = loop.run_until_complete(_send_room_message_async(room_id, message))
        return result
        
    except Exception as e:
        logger.error(f"Error sending message to room {room_id}: {e}")
        return False
    finally:
        loop.close()

async def send_matrix_message_async(user_id: str, message: str) -> bool:
    """
    Send a message to a Matrix user asynchronously.
    If a direct chat doesn't exist, creates one first.
    
    Args:
        user_id: The Matrix ID of the user to send the message to
        message: The message content
        
    Returns:
        bool: True if the message was sent successfully, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping send_matrix_message_async.")
        return False
        
    try:
        # Create a direct chat with the user if needed
        room_id = await create_matrix_direct_chat(user_id)
        if not room_id:
            logger.error(f"Failed to create direct chat with {user_id}")
            return False
            
        # Send the message
        return await send_matrix_message(room_id, message)
    except Exception as e:
        logger.error(f"Error sending message to {user_id}: {e}")
        return False

# Stub implementations for matrix room member functions
def get_matrix_room_members(db, room_id):
    """
    Get matrix room members from cache (stub implementation).
    In the future, this will retrieve room members from the database.
    """
    return None  # Always return None to force fetching from matrix API
    
def update_matrix_room_members(db, room_id, members):
    """
    Update matrix room members in cache (stub implementation).
    In the future, this will store room members in the database.
    """
    pass  # No-op

async def create_user(username, password, display_name=None, admin=False):
    """Create a new user in Matrix."""
    try:
        client = await get_matrix_client()
        if not client:
            return False
            
        # Create the user
        user_id = f"@{username}:{Config.MATRIX_DOMAIN}"
        response = await client.register_user(username, password)
        
        if response and 'user_id' in response:
            # Set display name if provided
            if display_name:
                await client.set_displayname(user_id, display_name)
            
            # Send welcome message
            await send_welcome_message_async(user_id, username)
            
            return True
    except Exception as e:
        logging.error(f"Error creating Matrix user: {e}")
        return False
