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
from typing import List, Dict, Optional, Union, Set, Any, Tuple
from urllib.parse import urlparse
import json
from nio import AsyncClient, AsyncClientConfig
import traceback
import uuid
import threading
from contextlib import asynccontextmanager
import re

# Import Config first
from app.utils.config import Config

# Apply nest_asyncio to allow nested event loops
nest_asyncio.apply()

# Set up logging
logger = logging.getLogger(__name__)

async def close_matrix_client_properly(client: Optional[AsyncClient]) -> None:
    """
    Properly close a Matrix client, ensuring all resources are cleaned up.
    
    Args:
        client: The AsyncClient instance to close
    """
    if not client:
        return
        
    try:
        # Close the custom aiohttp session if it exists
        if hasattr(client, '_http_client') and client._http_client:
            try:
                await client._http_client.close()
                logger.debug("Closed custom aiohttp session")
            except Exception as session_error:
                logger.warning(f"Error closing aiohttp session: {session_error}")
        
        # Close the connector if it exists
        if hasattr(client, '_connector') and client._connector:
            try:
                await client._connector.close()
                logger.debug("Closed aiohttp connector")
            except Exception as connector_error:
                logger.warning(f"Error closing aiohttp connector: {connector_error}")
        
        # Close the main client
        await client.close()
        logger.debug("Matrix client closed properly")
        
    except Exception as e:
        logger.warning(f"Error during Matrix client cleanup: {e}")

# Import get_db conditionally to avoid import errors
try:
    from app.db.session import get_db
    from app.db.models import MatrixRoom, MatrixRoomMembership
except ImportError:
    logger.warning("Could not import get_db or models - DB caching for matrix room members will not be available")
    # Create a dummy function to avoid errors
    def get_db():
        yield None
    # Create dummy classes to avoid errors
    class MatrixRoom:
        pass
    class MatrixRoomMembership:
        pass

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
            RoomMessageText,
            JoinedRoomsResponse,
            RoomGetStateResponse,
            RoomPreset
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
    class JoinedRoomsResponse: pass
    class RoomGetStateResponse: pass
    class RoomPreset: 
        trusted_private_chat = "trusted_private_chat"

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

# Add after the imports and before the existing classes
@asynccontextmanager
async def matrix_client_context():
    """Context manager for Matrix client connections to ensure proper cleanup."""
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active")
        yield None
        return

    client = None
    client_created = False
    
    try:
        client_config = AsyncClientConfig(
            max_limit_exceeded=0,
            max_timeouts=0,
            store_sync_tokens=False,
            encryption_enabled=False,  # Disable encryption due to missing dependencies
        )

        client = AsyncClient(
            homeserver=MATRIX_HOMESERVER_URL,
            config=client_config,
        )
        client.access_token = MATRIX_ACCESS_TOKEN
        client.user_id = MATRIX_BOT_USERNAME
        client_created = True

        logger.info(f"Matrix client created with user_id: {MATRIX_BOT_USERNAME}")
        yield client
        
    except GeneratorExit:
        # Handle generator exit gracefully
        logger.debug("Matrix client context manager exiting")
        raise
    except Exception as e:
        logger.error(f"Error in matrix_client_context: {e}")
        yield None
    finally:
        if client_created and client:
            try:
                await client.close()
                logger.debug("Matrix client connection closed properly")
            except Exception as close_error:
                logger.warning(f"Error closing Matrix client: {close_error}")
            finally:
                client = None

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
            try:
                # Create a new client
                self.client = AsyncClient(
                    homeserver=self.homeserver,
                    device_id=f"Dashboard_Bot_{os.getpid()}"
                )
                
                # Set the access token and user_id
                self.client.access_token = self.access_token
                self.client.user_id = self.user_id
                
                # Verify the client is properly initialized
                if not self.client.access_token or not self.client.user_id:
                    raise ValueError("Failed to initialize Matrix client: missing access token or user_id")
                    
            except Exception as e:
                logger.error(f"Error creating Matrix client: {str(e)}")
                logger.error(traceback.format_exc())
                raise
            
        return self.client
    
    async def close(self):
        """Close the Matrix client connection."""
        if self.client:
            try:
                await self.client.close()
            except Exception as e:
                logger.error(f"Error closing Matrix client: {str(e)}")
            finally:
                self.client = None
    
    def run_async(self, coro):
        """Run an async coroutine in a new event loop."""
        try:
            # Create a new event loop for this operation
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            try:
                # Run the coroutine
                result = loop.run_until_complete(coro)
                return result
            finally:
                # Clean up the loop
                if not loop.is_closed():
                    loop.close()
        except Exception as e:
            logger.error(f"Error running async operation: {str(e)}")
            logger.error(traceback.format_exc())
            raise

    def get_matrix_users(self) -> List[Dict[str, str]]:
        """
        Get a list of Matrix users that the bot can interact with.
        
        Returns:
            List[Dict[str, str]]: A list of dictionaries containing user information
        """
        if not MATRIX_ACTIVE:
            logger.warning("Matrix integration is not active. Cannot get Matrix users.")
            return []
            
        try:
            # Get the default room ID
            room_id = MATRIX_DEFAULT_ROOM_ID
            if not room_id:
                logger.warning("No default room ID configured. Cannot get Matrix users.")
                return []
                
            # Get the client
            client = self.run_async(self._get_client())
            
            # Get room members
            response = self.run_async(client.joined_members(room_id))
            if not response or not hasattr(response, 'members'):
                logger.warning(f"Failed to get members for room {room_id}")
                return []
                
            # Filter out the bot itself and format the response
            users = []
            for user_id, member_info in response.members.items():
                if user_id != self.user_id:  # Skip the bot itself using instance user_id
                    users.append({
                        'user_id': user_id,
                        'display_name': member_info.display_name or user_id.split(':')[0][1:],  # Remove @ symbol
                        'avatar_url': member_info.avatar_url if hasattr(member_info, 'avatar_url') else None
                    })
                    
            return users
            
        except Exception as e:
            logger.error(f"Error getting Matrix users: {str(e)}")
            logger.error(traceback.format_exc())
            return []
        finally:
            # Ensure client is closed
            if hasattr(self, 'client') and self.client:
                self.run_async(self.close())
    
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
            if not client:
                logger.error("Failed to create Matrix client")
                return None

            # Try to get display name from user profile
            display_name = user_id.split(":")[0].lstrip("@")  # Default fallback
            try:
                profile_response = await client.get_profile(user_id)
                if hasattr(profile_response, "displayname") and profile_response.displayname:
                    display_name = profile_response.displayname
                    logger.info(f"Retrieved display name for {user_id}: {display_name}")
            except Exception as e:
                logger.warning(f"Could not get display name for {user_id}: {str(e)}")

            # Create a direct message room - without encryption for now
            response = await client.room_create(
                is_direct=True,
                invite=[user_id],
                preset=RoomPreset.trusted_private_chat
            )
            
            if isinstance(response, RoomCreateResponse) and response.room_id:
                logger.info(f"Created direct chat room with {user_id}: {response.room_id}")
                return response.room_id
            else:
                logger.error(f"Failed to create direct chat with {user_id}: {response}")
                return None
                
        except Exception as e:
            logger.error(f"Failed to create Matrix direct chat: {e}")
            return None
        finally:
            if client:
                await client.close()
    
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
    """Get Matrix client instance (encryption disabled for simplicity)"""
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active")
        return None

    client = None
    try:
        import ssl
        import aiohttp
        
        # Create SSL context with TLS 1.2 for compatibility with older LibreSSL
        ssl_context = ssl.create_default_context()
        ssl_context.minimum_version = ssl.TLSVersion.TLSv1_2
        ssl_context.maximum_version = ssl.TLSVersion.TLSv1_2
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        
        # Create aiohttp connector with TLS 1.2
        connector = aiohttp.TCPConnector(ssl=ssl_context)
        
        client_config = AsyncClientConfig(
            max_limit_exceeded=0,
            max_timeouts=0,
            store_sync_tokens=False,  # Disable sync tokens (no encryption)
            encryption_enabled=False,  # Disable encryption for simplicity
        )

        # Create client with TLS 1.2 SSL handling
        client = AsyncClient(
            homeserver=MATRIX_HOMESERVER_URL,
            config=client_config,
        )
        
        # Set the connector for TLS 1.2 handling
        if hasattr(client, '_http_client') and client._http_client:
            # Properly close the existing session before replacing it
            try:
                await client._http_client.close()
            except Exception as close_error:
                logger.warning(f"Error closing existing http client: {close_error}")
        
        # Create new session with proper connector
        client._http_client = aiohttp.ClientSession(connector=connector)
        
        # Store reference to connector for cleanup
        client._connector = connector
        
        client.access_token = MATRIX_ACCESS_TOKEN
        client.user_id = MATRIX_BOT_USERNAME

        logger.info(f"Matrix client created with TLS 1.2 (encryption disabled for simplicity)")
        
        return client
    except Exception as e:
        logger.error(f"Error creating Matrix client: {e}")
        if client:
            try:
                await close_matrix_client_properly(client)
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
            await close_matrix_client_properly(client)
            
        return True
    except Exception as e:
        logging.error(f"Error sending Matrix message: {e}")
        # Make sure to close client even on error if we created it
        if should_close and client:
            try:
                await close_matrix_client_properly(client)
            except Exception as close_error:
                logging.error(f"Error closing Matrix client: {close_error}")
        return False

async def create_matrix_direct_chat(user_id: str) -> Optional[str]:
    """
    Create or find an existing direct chat with another user.
    Prioritizes cache, then m.direct account data, then creation.
    For Signal bridge users, uses the known Signal bridge bot command flow.
    
    Args:
        user_id: The Matrix ID of the user to chat with
        
    Returns:
        Optional[str]: The room ID of the direct chat, or None if creation/finding failed
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping create_direct_chat.")
        return None
        
    # Handle Signal users separately
    if user_id.startswith("@signal_"):
        # ... (existing Signal user logic from lines 513-640 remains unchanged here) ...
        # For brevity, I'm not repeating the entire Signal logic. Assume it's correctly placed.
        logger.info(f"Detected Signal bridge user: {user_id}")
        try:
            client_signal = await get_matrix_client()
            if not client_signal:
                logger.error("Failed to create Matrix client for Signal bridge user")
                return None
            try:
                signal_bridge_room_id = Config.MATRIX_SIGNAL_BRIDGE_ROOM_ID
                if not signal_bridge_room_id:
                    logger.error("MATRIX_SIGNAL_BRIDGE_ROOM_ID not configured")
                    return None
                try:
                    signal_uuid = user_id.split("_")[1].split(":")[0]
                except IndexError:
                    logger.error(f"Failed to extract Signal UUID from {user_id}")
                    return None
                
                start_chat_command = f"start-chat {signal_uuid}"
                logger.info(f"Sending Signal bridge command: {start_chat_command} to {signal_bridge_room_id}")
                
                response = await client_signal.room_send(
                    room_id=signal_bridge_room_id,
                    message_type="m.room.message",
                    content={"msgtype": "m.text", "body": start_chat_command}
                )
                
                if not isinstance(response, RoomSendResponse):
                    logger.error(f"Failed to send Signal bridge command: {response}")
                    return None

                logger.info(f"Signal bridge command sent. Event ID: {response.event_id}. Waiting for bot...")
                # Use a default delay of 2 seconds if not configured
                delay = getattr(Config, 'SIGNAL_BRIDGE_BOT_RESPONSE_DELAY', 2.0)
                await asyncio.sleep(delay)

                logger.info(f"Searching for Signal chat room with {user_id} after bot command.")
                joined_rooms_resp = await client_signal.joined_rooms()
                if not (isinstance(joined_rooms_resp, JoinedRoomsResponse) and joined_rooms_resp.rooms):
                    logger.warning("Bot is in no rooms or failed to get joined rooms after Signal command.")
                    return None

                for room_id_iter in joined_rooms_resp.rooms:
                    try:
                        state_events = await client_signal.room_get_state(room_id_iter)
                        members_in_room = []
                        room_name_iter = room_id_iter # Fallback name
                        is_direct_flag = False
                        topic_iter = ""

                        for event in state_events.events:
                            if event.get('type') == 'm.room.member' and event.get('state_key') and event.get('content', {}).get('membership') == 'join':
                                members_in_room.append(event.get('state_key'))
                            elif event.get('type') == 'm.room.name':
                                room_name_iter = event.get('content', {}).get('name', room_name_iter)
                            elif event.get('type') == 'm.room.topic':
                                topic_iter = event.get('content', {}).get('topic', "")
                            elif event.get('type') == 'm.room.dm_prompt' and event.get('state_key') == user_id: # Custom event for prompt
                                is_direct_flag = True # A way to mark DMs created by the bot
                        
                        # Check if this room is the DM with the target Signal user
                        # Criteria: bot is a member, target signal user is a member, and it's likely a DM (e.g., 2-3 members or specific name/topic)
                        if MATRIX_BOT_USERNAME in members_in_room and user_id in members_in_room:
                            if len(members_in_room) <= 3 or "signal" in room_name_iter.lower() or "signal" in topic_iter.lower() or is_direct_flag:
                                logger.info(f"Found likely Signal DM room: {room_id_iter} (Name: {room_name_iter}, Members: {len(members_in_room)})")
                                return room_id_iter
                    except Exception as room_check_err:
                        logger.warning(f"Error checking room {room_id_iter} for Signal DM: {room_check_err}")
                        continue
                logger.warning(f"Could not find Signal DM room for {user_id} after command and search.")
                return None
            finally:
                if client_signal:
                    await client_signal.close()
        except Exception as e_signal:
            logger.error(f"Error in Signal DM creation for {user_id}: {e_signal}", exc_info=True)
            return None

    # For non-Signal users, use cache-aware logic
    client = None # Define client here to ensure it's closed in finally
    db = next(get_db())
    try:
        logger.debug(f"Creating/finding non-Signal DM for {user_id}")
        # 1. Check DB Cache first
        # Look for rooms with exactly two members: bot and the target user.
        # This query assumes MatrixRoomMembership is populated correctly.
        # We also need to ensure that the room is intended as a DM (e.g., no specific topic, or a naming convention)
        # A more robust way would be to have an `is_direct` flag on the MatrixRoom table itself, populated by m.direct or creation.
        
        # Simplified cache check: Find rooms where bot and user are the *only* members.
        # This requires joining MatrixRoom and MatrixRoomMembership and grouping.
        # For now, let's query memberships and then check room details from cache.
        
        # Get all rooms the user is in (according to cache)
        user_memberships = db.query(MatrixRoomMembership.room_id).filter(MatrixRoomMembership.user_id == user_id).all()
        user_room_ids = {r.room_id for r in user_memberships}

        if user_room_ids:
            candidate_rooms = db.query(MatrixRoom).filter(MatrixRoom.room_id.in_(user_room_ids)).all()
            for room_from_cache in candidate_rooms:
                # Check if this room from cache is a DM with the bot and the target user
                # We need the member list for this room from cache
                members_in_cached_room = db.query(MatrixRoomMembership.user_id).filter(MatrixRoomMembership.room_id == room_from_cache.room_id).all()
                member_ids_in_cached_room = {m.user_id for m in members_in_cached_room}
                
                if len(member_ids_in_cached_room) == 2 and MATRIX_BOT_USERNAME in member_ids_in_cached_room and user_id in member_ids_in_cached_room:
                    logger.info(f"Found existing DM room in DB cache for {user_id}: {room_from_cache.room_id}")
                    return room_from_cache.room_id

        logger.debug(f"DM for {user_id} not found in DB cache. Proceeding to Matrix API.")

        client = await get_matrix_client()
        if not client:
            logger.error(f"Failed to create Matrix client for {user_id}")
            return None

        # 2. Check m.direct account data (Matrix standard for DMs)
        try:
            direct_room_data = await client.get_account_data("m.direct")
            if direct_room_data and user_id in direct_room_data:
                room_ids = direct_room_data[user_id]
                if room_ids and isinstance(room_ids, list) and len(room_ids) > 0:
                    dm_room_id = room_ids[0]
                    logger.info(f"Found DM room for {user_id} via m.direct account data: {dm_room_id}")
                    # Optionally, verify bot is in this room, or just trust m.direct
                    return dm_room_id
        except Exception as e_mdirect:
            logger.warning(f"Could not fetch or parse m.direct account data for {user_id}: {e_mdirect}")

        # 3. If no DM found via cache or m.direct, attempt to create one
        logger.info(f"No existing DM found for {user_id} via cache or m.direct. Attempting to create new DM room.")
        try:
            creation_response = await client.room_create(
                is_direct=True,
                invite=[user_id],
                preset=RoomPreset.trusted_private_chat # nio.schemas.rooms.RoomPreset
            )
            if isinstance(creation_response, RoomCreateResponse) and creation_response.room_id:
                new_room_id = creation_response.room_id
                logger.info(f"Successfully created new DM room with {user_id}: {new_room_id}")
                
                # Update m.direct account data after creating DM
                try:
                    current_directs = await client.get_account_data("m.direct") or {}
                    if user_id in current_directs:
                        if new_room_id not in current_directs[user_id]:
                            current_directs[user_id].append(new_room_id)
                    else:
                        current_directs[user_id] = [new_room_id]
                    await client.update_account_data("m.direct", current_directs)
                    logger.info(f"Updated m.direct account data for {user_id} with new room {new_room_id}")
                except Exception as e_update_mdirect:
                    logger.warning(f"Failed to update m.direct account data for {user_id} after DM creation: {e_update_mdirect}")
                return new_room_id
            else:
                logger.error(f"Failed to create DM room with {user_id}. Response: {creation_response}")
                return None
        except Exception as e_create:
            logger.error(f"Exception during DM room creation for {user_id}: {e_create}", exc_info=True)
            return None
            
    except Exception as e_main:
        logger.error(f"Overall error in create_matrix_direct_chat for {user_id}: {e_main}", exc_info=True)
        return None
    finally:
        if db:
            db.close()
        if client:
            await client.close()
            logger.debug(f"Closed Matrix client for non-Signal DM operation with {user_id}.")

def create_matrix_direct_chat_sync(user_id: str) -> Optional[str]:
    """
    Synchronous wrapper for create_matrix_direct_chat.
    
    Args:
        user_id: The Matrix ID of the user to chat with
        
    Returns:
        Optional[str]: The room ID of the created chat, or None if creation failed
    """
    import asyncio
    import threading
    import logging
    
    # Define a thread-local event loop storage
    thread_local = threading.local()
    
    try:
        # Get or create a new event loop for this thread
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            setattr(thread_local, 'loop', loop)
        
        # Apply nest_asyncio to allow nested event loops
        import nest_asyncio
        nest_asyncio.apply()
        
        # Run the async function in the loop
        return loop.run_until_complete(create_matrix_direct_chat(user_id))
    except Exception as e:
        logging.error(f"Error in create_matrix_direct_chat_sync: {str(e)}")
        return None

async def invite_to_matrix_room(room_id: str, user_id: str) -> bool:
    """
    Invite a user to a Matrix room.
    
    Args:
        room_id: The Matrix room ID
        user_id: The Matrix user ID to invite
        
    Returns:
        bool: Success status
    """
    # Defensive checks for None values or empty strings
    if not room_id:
        logger.error("Cannot invite to room: room_id is None or empty")
        return False
        
    if not user_id:
        logger.error("Cannot invite user: user_id is None or empty")
        return False
    
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping invite_to_matrix_room.")
        return False
    
    try:
        # Get Matrix client
        client = await get_matrix_client()
        if not client:
            logger.error("Failed to get Matrix client")
            return False
        
        try:
            # Invite the user to the room
            await client.room_invite(room_id, user_id)
            logger.info(f"Invited {user_id} to room {room_id}")
            return True
        except Exception as e:
            # Check if the error is because the user is already in the room
            error_str = str(e)
            if "403" in error_str and "is already in the room" in error_str:
                logger.info(f"User {user_id} is already in room {room_id}")
                return True  # Consider this success
            elif "403" in error_str and "not in room" in error_str:
                # Bot is not in room, try to join first
                logger.info(f"Bot is not in room {room_id}, trying to join first")
                try:
                    await client.join_room(room_id)
                    # Try invite again
                    await client.room_invite(room_id, user_id)
                    logger.info(f"Successfully joined room and invited {user_id} to {room_id}")
                    return True
                except Exception as join_error:
                    logger.error(f"Failed to join room {room_id}: {join_error}")
                    return False
            else:
                logger.error(f"Error inviting {user_id} to room {room_id}: {e}")
                return False
        except Exception as e:
            logger.error(f"Error inviting {user_id} to room {room_id}: {e}")
            return False
        finally:
            # Close the client
            await client.close()
    except Exception as e:
        logger.error(f"Error in invite_to_matrix_room: {e}")
        return False

# Add a synchronous wrapper for the invite function with safe parameter handling
def invite_to_matrix_room_sync(room_id: str, user_id: str) -> bool:
    """
    Synchronous wrapper for inviting a user to a Matrix room with defensive parameter handling.
    
    Args:
        room_id: The Matrix room ID
        user_id: The Matrix user ID to invite
        
    Returns:
        bool: Success status
    """
    # Defensive checks for None values or empty strings
    if room_id is None or user_id is None:
        logger.error(f"Cannot invite: room_id={room_id}, user_id={user_id}")
        return False
        
    try:
        # Set up event loop
        try:
            loop = asyncio.get_event_loop()
            if loop.is_closed():
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        # Run the async function
        result = loop.run_until_complete(invite_to_matrix_room(room_id, user_id))
        return result
    except Exception as e:
        logger.error(f"Error in invite_to_matrix_room_sync: {e}")
        return False
    finally:
        # Clean up the loop to prevent resource leaks
        if 'loop' in locals() and not loop.is_closed():
            loop.close()

async def send_matrix_message_to_multiple_rooms(room_ids: List[str], message: str) -> Dict[str, bool]:
    """
    Send a message to multiple Matrix rooms with automatic notice footer.
    
    Args:
        room_ids: List of room IDs to send the message to
        message: The message content
        
    Returns:
        Dict[str, bool]: A dictionary mapping room IDs to success status
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping send_message_to_multiple_rooms.")
        return {room_id: False for room_id in room_ids}

    logger.info(f"Attempting to send message to {len(room_ids)} rooms: {room_ids}")

    # Automatically append the MATRIX_MESSAGE_NOTICE to the message
    from app.utils.config import Config
    notice = Config.MATRIX_MESSAGE_NOTICE
    if notice and not message.endswith(notice):
        message_with_notice = f"{message}\n\n{notice}"
    else:
        message_with_notice = message
        
    logger.info(f"Message with notice: {message_with_notice[:100]}...")
        
    results = {}
    client = await get_matrix_client()
    
    if not client:
        logger.error("Failed to get Matrix client")
        return {room_id: False for room_id in room_ids}
    
    logger.info(f"Matrix client created successfully. Bot user: {client.user_id}")
    
    try:
        for room_id in room_ids:
            logger.info(f"Sending message to room: {room_id}")
            try:
                response = await client.room_send(
                    room_id=room_id,
                    message_type="m.room.message",
                    content={
                        "msgtype": "m.text",
                        "body": message_with_notice
                    }
                )
                success = isinstance(response, RoomSendResponse) and response.event_id is not None
                logger.info(f"Room {room_id} - Response type: {type(response)}, Success: {success}")
                if success:
                    logger.info(f"Message sent successfully to {room_id}, event_id: {response.event_id}")
                else:
                    logger.error(f"Failed to send message to {room_id} - Invalid response: {response}")
                results[room_id] = success
            except Exception as e:
                # Check for SSL/TLS errors and provide helpful error messages
                if "tlsv1 alert protocol version" in str(e).lower() or "ssl" in str(e).lower():
                    logger.error(f"SSL/TLS connection error for room {room_id}: {e}")
                    logger.error("This is likely due to SSL/TLS compatibility issues between the client and Matrix server.")
                    logger.error("Consider updating Python SSL libraries or checking Matrix server SSL configuration.")
                else:
                    logger.error(f"Error sending message to room {room_id}: {e}")
                    logger.error(f"Exception type: {type(e)}, Details: {str(e)}")
                results[room_id] = False
    finally:
        await client.close()
        logger.info("Matrix client closed")
    
    logger.info(f"Final results: {results}")
    
    # Check if all failed due to SSL issues and log a helpful message
    if all(not success for success in results.values()) and len(results) > 0:
        logger.error("All message sends failed. This may be due to SSL/TLS compatibility issues.")
        logger.error("The Matrix server may require newer TLS versions than what's available in the current environment.")
    
    return results

async def send_welcome_message_async(user_id: str, username: str, full_name: str = None) -> bool:
    """
    Send a 2-stage welcome message to a new user to handle encryption establishment.
    
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
        
        name_to_use = full_name if full_name else username
        
        # Stage 1: Send a simple greeting first to establish encryption
        simple_message = f"Welcome to the community, {name_to_use}! 👋"
        stage1_success = await send_matrix_message(room_id, simple_message)
        
        if not stage1_success:
            logger.error(f"Failed to send stage 1 welcome message to {user_id}")
            return False
        
        # Stage 2: Wait 2 seconds, then send the full welcome message
        await asyncio.sleep(2)
        
        full_message = f"I'm the community bot, here to help you get started! 🤖\n\n"
        full_message += "Here's what you can do:\n"
        full_message += "• Explore our community rooms based on your interests\n"
        full_message += "• Join conversations and meet other members\n"
        full_message += "• Reach out if you have any questions\n\n"
        full_message += "Looking forward to having you in our community! 🎉"
        
        stage2_success = await send_matrix_message(room_id, full_message)
        
        logger.info(f"2-stage welcome message sent to {user_id}: Stage 1: {stage1_success}, Stage 2: {stage2_success}")
        return stage1_success and stage2_success
        
    except Exception as e:
        logger.error(f"Error sending 2-stage welcome message: {e}")
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

async def get_room_details_async(client: AsyncClient, room_id: str, skip_member_count: bool = False) -> Dict:
    """
    Get details about a specific room.
    
    Args:
        client: The Matrix client
        room_id: The ID of the room
        skip_member_count: If True, skip the expensive member count API call
        
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
        
        # Only get member count if not skipping (this is the expensive operation)
        if not skip_member_count:
            # Try to get member count from database cache first
            try:
                from app.db.session import get_db
                from app.db.operations import get_matrix_room_member_count
                db = next(get_db())
                cached_count = get_matrix_room_member_count(db, room_id)
                if cached_count > 0:
                    room_details['member_count'] = cached_count
                    logger.debug(f"Using cached member count for {room_id}: {cached_count}")
                    db.close()
                else:
                    db.close()
                    # Fall back to API call only if no cached data
                    members = await get_room_members_async(client, room_id)
                    room_details['member_count'] = len(members)
            except Exception as cache_error:
                logger.warning(f"Error getting cached member count for {room_id}: {cache_error}")
                # Fall back to API call
                members = await get_room_members_async(client, room_id)
                room_details['member_count'] = len(members)
        else:
            # Skip member count to avoid expensive API calls during sync
            logger.debug(f"Skipping member count for {room_id} to avoid expensive API calls")
        
        return room_details
    except Exception as e:
        logger.error(f"Error getting details for room {room_id}: {e}")
        return {
            "room_id": room_id,
            "name": None,
            "display_name": room_id.split(':')[0].lstrip('!'),  # Fallback to formatted room ID
            "member_count": 0,
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
            
            # Get details for each room (skip expensive member count API calls)
            rooms = []
            for room_id in joined_rooms:
                room_details = await get_room_details_async(client, room_id, skip_member_count=True)
                if room_details:
                    # Try to get member count from database cache
                    try:
                        from app.db.session import get_db
                        from app.db.operations import get_matrix_room_member_count
                        db = next(get_db())
                        cached_count = get_matrix_room_member_count(db, room_id)
                        if cached_count > 0:
                            room_details['member_count'] = cached_count
                        db.close()
                    except Exception as cache_error:
                        logger.debug(f"No cached member count for {room_id}: {cache_error}")
                        # Don't make expensive API calls here - leave member_count as 0
                        room_details['member_count'] = 0
                    
                    rooms.append(room_details)
                    
            return rooms
            
        finally:
            # Always close the client if we have one
            if client:
                await close_matrix_client_properly(client)
            
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

async def remove_from_room(client: AsyncClient, room_id: str, user_id: str, reason: str = "Removed via dashboard") -> bool:
    """
    Remove a user from a Matrix room with enhanced error handling and multiple methods.
    
    Args:
        client: The Matrix client
        room_id: The ID of the room
        user_id: The Matrix ID of the user to remove
        reason: Reason for removal
        
    Returns:
        bool: True if the user was removed successfully or was not in the room, False for other errors
    """
    # Enhanced logging for debugging Signal user removal
    logger.info(f"🔍 REMOVE_FROM_ROOM DEBUG: Attempting to remove user_id='{user_id}' from room_id='{room_id}'")
    logger.info(f"🔍 User ID validation: starts_with_@={user_id.startswith('@')}, has_domain={':' in user_id}, is_signal={user_id.startswith('@signal_')}")
    
    # Method 1: Try standard kick
    try:
        logger.info(f"🔄 Attempting room_kick for {user_id} from {room_id}")
        response = await client.room_kick(room_id, user_id, reason=reason)
        
        # Enhanced logging for response analysis
        logger.info(f"🔍 KICK RESPONSE DEBUG: response_type={type(response).__name__}, response={response}")
        if hasattr(response, 'transport_response'):
            logger.info(f"🔍 Transport response: status={response.transport_response.status if response.transport_response else 'None'}")
        
        # Check if the response indicates success
        # For RoomKickResponse, success is indicated by HTTP 200 status in transport_response
        if hasattr(response, 'transport_response') and response.transport_response:
            if response.transport_response.status == 200:
                logger.info(f"✅ Successfully kicked {user_id} from room {room_id} (HTTP 200)")
                return True
            else:
                logger.warning(f"❌ Kick failed for {user_id} from room {room_id} with status {response.transport_response.status}: {response}")
        elif hasattr(response, 'event_id'):
            # Fallback for other response types that might have event_id
            logger.info(f"✅ Successfully kicked {user_id} from room {room_id} (event_id present)")
            return True
        else:
            logger.warning(f"❌ Kick failed for {user_id} from room {room_id}: {response}")
    except Exception as e:
        error_str = str(e)
        
        # Handle specific Matrix errors
        if "M_FORBIDDEN" in error_str and "target user is not in the room" in error_str.lower():
            logger.info(f"User {user_id} is not in room {room_id}, skipping removal")
            return True  # Consider this success since the user is already not in the room
        elif "M_FORBIDDEN" in error_str and "cannot kick user" in error_str.lower():
            logger.warning(f"⚠️ Permission denied kicking {user_id} from room {room_id}, trying ban+unban method")
            
            # Method 2: Try ban + unban (this sometimes works when kick doesn't)
            try:
                logger.info(f"🔄 Attempting ban+unban method for {user_id} in room {room_id}")
                
                # First ban the user
                logger.info(f"🔄 Step 1: Banning {user_id} from {room_id}")
                ban_response = await client.room_ban(room_id, user_id, reason=reason)
                ban_success = False
                
                # Enhanced logging for ban response
                logger.info(f"🔍 BAN RESPONSE DEBUG: response_type={type(ban_response).__name__}, response={ban_response}")
                
                # Check ban response success
                if hasattr(ban_response, 'transport_response') and ban_response.transport_response:
                    ban_success = ban_response.transport_response.status == 200
                    logger.info(f"🔍 Ban transport response: status={ban_response.transport_response.status}")
                elif hasattr(ban_response, 'event_id'):
                    ban_success = True
                    logger.info(f"🔍 Ban response has event_id: {ban_response.event_id}")
                
                if ban_success:
                    logger.info(f"✅ Successfully banned {user_id} from room {room_id}")
                    
                    # Then unban them (this removes them from the room)
                    logger.info(f"🔄 Step 2: Unbanning {user_id} from {room_id}")
                    unban_response = await client.room_unban(room_id, user_id)
                    unban_success = False
                    
                    # Enhanced logging for unban response
                    logger.info(f"🔍 UNBAN RESPONSE DEBUG: response_type={type(unban_response).__name__}, response={unban_response}")
                    
                    # Check unban response success
                    if hasattr(unban_response, 'transport_response') and unban_response.transport_response:
                        unban_success = unban_response.transport_response.status == 200
                        logger.info(f"🔍 Unban transport response: status={unban_response.transport_response.status}")
                    elif hasattr(unban_response, 'event_id'):
                        unban_success = True
                        logger.info(f"🔍 Unban response has event_id: {unban_response.event_id}")
                    
                    if unban_success:
                        logger.info(f"✅ Successfully unbanned {user_id} from room {room_id} - user removed via ban+unban")
                        return True
                    else:
                        logger.error(f"❌ Failed to unban {user_id} from room {room_id}: {unban_response}")
                        return False
                else:
                    logger.error(f"❌ Failed to ban {user_id} from room {room_id}: {ban_response}")
                    return False
                    
            except Exception as ban_error:
                logger.error(f"Ban+unban method also failed for {user_id} in room {room_id}: {ban_error}")
                return False
        elif "M_FORBIDDEN" in error_str:
            logger.warning(f"Permission denied removing {user_id} from room {room_id}: {e}")
            return False
        elif "M_NOT_FOUND" in error_str:
            logger.warning(f"Room {room_id} not found when removing {user_id}: {e}")
            return False
        else:
            logger.error(f"Error removing {user_id} from room {room_id}: {e}")
            return False

async def remove_from_matrix_room_async(room_id: str, user_id: str, reason: str = "Removed via dashboard") -> bool:
    """
    Asynchronous function for removing a user from a Matrix room.
    
    Args:
        room_id: The ID of the room to remove the user from
        user_id: The Matrix user ID to remove
        reason: Reason for removal
        
    Returns:
        bool: True if successful or user not in room, False for other errors
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping remove_from_matrix_room_async.")
        return False
    
    # Enhanced logging for INDOC user removal
    logger.info(f"=== REMOVING USER FROM MATRIX ROOM ===")
    logger.info(f"Room ID: {room_id}")
    logger.info(f"User ID: {user_id}")
    logger.info(f"Reason: {reason}")
        
    try:
        logger.info(f"Creating Matrix client for user removal...")
        client = await get_matrix_client()
        if not client:
            logger.error("❌ Failed to get Matrix client for user removal")
            return False
        
        logger.info(f"✅ Matrix client created successfully for removal")
            
        try:
            logger.info(f"Calling remove_from_room function...")
            result = await remove_from_room(client, room_id, user_id, reason)
            
            if result:
                logger.info(f"✅ SUCCESS: User {user_id} removed from room {room_id}")
            else:
                logger.error(f"❌ FAILED: Could not remove user {user_id} from room {room_id}")
            
            return result
        finally:
            logger.info(f"Properly closing Matrix client after removal attempt...")
            await close_matrix_client_properly(client)
            logger.info(f"✅ Matrix client closed properly after removal")
            
    except Exception as e:
        logger.error(f"❌ EXCEPTION: Error in remove_from_matrix_room_async: {e}")
        logger.error(f"Exception type: {type(e).__name__}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return False

def remove_from_matrix_room(room_id: str, user_id: str, reason: str = "Removed via dashboard") -> bool:
    """
    Synchronous wrapper for removing a user from a Matrix room.
    
    Args:
        room_id: The ID of the room to remove the user from
        user_id: The Matrix user ID to remove
        reason: Reason for removal
        
    Returns:
        bool: True if successful or user not in room, False for other errors
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
        result = loop.run_until_complete(remove_from_room(async_client, room_id, user_id, reason))
        
        # Close the client properly
        loop.run_until_complete(client.close())
        
        return result
    except Exception as e:
        logger.error(f"Error removing user {user_id} from room {room_id}: {e}")
        return False

async def get_room_members_async(client, room_id: str) -> Dict[str, Any]:
    """
    Get all members of a Matrix room asynchronously.
    Prioritizes database cache to avoid expensive API calls.
    
    Args:
        client: Matrix client
        room_id: Matrix room ID
        
    Returns:
        Dict[str, Any]: Dictionary mapping user IDs to member details
    """
    try:
        # Always try to get from cache first to avoid expensive API calls
        try:
            db = next(get_db())
            cached_members = get_matrix_room_members(db, room_id)
            db.close()
            if cached_members:
                logger.debug(f"Using cached members for room {room_id}: {len(cached_members)} members")
                # Convert list format to dict format expected by callers
                members_dict = {}
                for member in cached_members:
                    if isinstance(member, dict) and member.get('user_id'):
                        members_dict[member['user_id']] = {
                            'display_name': member.get('display_name', ''),
                            'avatar_url': member.get('avatar_url', '')
                        }
                return members_dict
        except Exception as db_error:
            logger.debug(f"Error accessing database for room member cache: {db_error}")
        
        # Only make expensive API calls if absolutely no cached data and this is critical
        logger.warning(f"No cached members found for room {room_id}, making expensive API call")
        members_dict = {}
        
        # Try room_get_state first (this is the expensive call we want to avoid)
        try:
            state_response = await client.room_get_state(room_id)
            
            # Check for members in different formats
            if hasattr(state_response, 'members') and state_response.members:
                # Format: Object with members attribute (dictionary)
                members_dict = state_response.members
                logger.info(f"Found {len(members_dict)} members in room {room_id} using room_get_state.members")
            
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
                logger.info(f"Found {len(members_dict)} members in room {room_id} using room_get_state.events")
        
        except Exception as e:
            logger.warning(f"Failed to get members using room_get_state: {str(e)}")
        
        # If we didn't get any members, try room_get_joined_members as fallback
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
                
                logger.info(f"Found {len(members_dict)} members in room {room_id} using room_get_joined_members")
            
            except Exception as e:
                logger.error(f"Failed to get members using room_get_joined_members: {str(e)}")
        
        # Cache the results if we got some (but don't fail if caching fails)
        if members_dict:
            try:
                db = next(get_db())
                # Convert dict format to list format for database storage
                members_list = []
                for user_id, details in members_dict.items():
                    members_list.append({
                        'user_id': user_id,
                        'display_name': details.get('display_name', ''),
                        'avatar_url': details.get('avatar_url', ''),
                        'membership': 'join'
                    })
                update_matrix_room_members(db, room_id, members_list)
                db.close()
                logger.debug(f"Cached {len(members_list)} members for room {room_id}")
            except Exception as cache_error:
                logger.warning(f"Failed to cache room members: {cache_error}")
        
        return members_dict
        
    except Exception as e:
        logger.error(f"Error getting room members for {room_id}: {str(e)}")
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

async def _send_direct_message_async(user_id: str, message: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Send a direct message to a Matrix user asynchronously.
    
    Args:
        user_id (str): The Matrix user ID to send the message to
        message (str): The message content
        
    Returns:
        Tuple[bool, Optional[str], Optional[str]]: Tuple containing:
            - Success status (bool)
            - Room ID where message was sent (str or None)
            - Event ID of the sent message (str or None)
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Cannot send direct message.")
        return False, None, None
    
    client = None
    try:
        # Log Matrix configuration for debugging (only on first call or errors)
        logger.debug(f"Matrix configuration: MATRIX_ACTIVE={MATRIX_ACTIVE}, HOMESERVER={HOMESERVER}, BOT_USERNAME={MATRIX_BOT_USERNAME}")
        
        # Log the attempt
        logger.info(f"Attempting to send direct message to user_id: {user_id}")
        logger.info(f"Attempting to send direct message to Matrix user: {user_id}")
        
        # Create Matrix client
        client = await get_matrix_client()
        if not client:
            logger.error("Failed to create Matrix client for direct message")
            return False, None, None
        
        # Get joined rooms
        joined_rooms = await client.joined_rooms()
        if isinstance(joined_rooms, JoinedRoomsResponse) and joined_rooms.rooms:
            logger.info(f"Bot is in {len(joined_rooms.rooms)} rooms")
        
        # Try to find existing direct chat room with this user
        room_id = None
        
        # Skip account data method since get_account_data() doesn't exist in current client version
        logger.info("Skipping account data check for direct chats (method not available)")
        
        # Check joined rooms for direct chats
        if not room_id:
            for joined_room in joined_rooms.rooms:
                try:
                    # Get room members
                    members_response = await client.room_get_state(joined_room)
                    if isinstance(members_response, RoomGetStateResponse):
                        members = []
                        for event in members_response.events:
                            if event.get("type") == "m.room.member" and event.get("state_key"):
                                member_id = event.get("state_key")
                                content = event.get("content", {})
                                if content.get("membership") == "join":
                                    members.append(member_id)
                        
                        # If this is a direct chat (only 2 members: bot and user)
                        if len(members) == 2 and user_id in members and MATRIX_BOT_USERNAME in members:
                            room_id = joined_room
                            logger.info(f"Found existing direct chat room with {user_id} by member check: {room_id}")
                            break
                except Exception as room_err:
                    logger.warning(f"Error checking room {joined_room} for direct chat: {str(room_err)}")
        
        # Extract display name from user_id if possible
        display_name = user_id.split(":")[0].lstrip("@")
        
        # Try to get actual display name from user profile
        try:
            profile_response = await client.get_profile(user_id)
            if hasattr(profile_response, "displayname") and profile_response.displayname:
                display_name = profile_response.displayname
                logger.info(f"Retrieved display name for {user_id}: {display_name}")
        except Exception as e:
            logger.warning(f"Could not get display name for {user_id}: {str(e)}")
        
        # If no direct chat room found, create one
        if not room_id:
            logger.info(f"Creating new direct chat with {user_id}")
            try:
                # Create a direct chat room with simplified parameters
                response = await client.room_create(
                    is_direct=True,
                    invite=[user_id],
                    preset=RoomPreset.trusted_private_chat
                )
                
                # Check if room creation was successful
                if isinstance(response, RoomCreateResponse):
                    room_id = response.room_id
                    logger.info(f"Created new direct chat room with {user_id}: {room_id}")
                else:
                    logger.error(f"Failed to create direct chat room. Response: {response}")
                    return False, None, None
            except Exception as e:
                logger.error(f"Error creating direct chat room: {str(e)}")
                return False, None, None
        
        # Send message to the room
        if room_id:
            logger.info(f"Sending message to room {room_id}")
            text_content = {
                "msgtype": "m.text",
                "body": message
            }
            
            try:
                # Send the message
                response = await client.room_send(
                    room_id=room_id,
                    message_type="m.room.message",
                    content=text_content
                )
                
                # Check if message was sent successfully
                if isinstance(response, RoomSendResponse):
                    logger.info(f"Message sent successfully to {user_id} in room {room_id}. Event ID: {response.event_id}")
                    return True, room_id, response.event_id
                else:
                    logger.error(f"Failed to send message. Response: {response}")
                    return False, room_id, None
            except Exception as e:
                logger.error(f"Error sending message to room {room_id}: {str(e)}")
                return False, room_id, None
        
        return False, None, None
    except Exception as e:
        logger.error(f"Error in _send_direct_message_async: {str(e)}")
        return False, None, None
    finally:
        # Ensure client is properly closed even on exceptions
        if client:
            try:
                logger.debug(f"Properly closing Matrix client for direct message...")
                await close_matrix_client_properly(client)
                logger.debug(f"✅ Matrix client closed properly for direct message")
            except Exception as close_error:
                logger.warning(f"⚠️ Error closing Matrix client for direct message: {close_error}")

def send_direct_message(user_id: str, message: str) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Send a direct message to a Matrix user.
    
    This is a synchronous wrapper around the async implementation.
    Creates a new event loop for each call - this is appropriate for infrequent
    Matrix operations. For high-frequency usage, consider implementing a shared
    event loop in a background thread.
    
    Args:
        user_id: The Matrix ID of the user to message
        message: The message content
        
    Returns:
        Tuple[bool, Optional[str], Optional[str]]: Tuple containing:
            - Success status (bool)
            - Room ID where message was sent (str or None)
            - Event ID of the sent message (str or None)
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping send_direct_message.")
        return False, None, None
    
    # Log call details at DEBUG level to reduce noise (config logging is in async function)
    logger.debug(f"Matrix direct message function called for user_id: {user_id}")
    logger.debug(f"Message length: {len(message)} characters")
        
    try:
        # Create a new event loop for this operation
        # NOTE: This approach is suitable for infrequent Matrix calls.
        # For high-frequency usage, consider a shared background event loop.
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            # Call the async function with the new event loop
            logger.debug(f"Creating new event loop for direct message to {user_id}")
            result = loop.run_until_complete(_send_direct_message_async(user_id, message))
            
            # Log result at INFO level for important success/failure tracking
            if result[0]:
                logger.info(f"✅ Direct message sent to {user_id}: room_id={result[1]}, event_id={result[2]}")
            else:
                logger.warning(f"❌ Failed to send direct message to {user_id}")
            
            return result
        finally:
            # Always close the event loop to prevent resource leaks
            loop.close()
            logger.debug(f"Event loop closed for direct message to {user_id}")
            
    except Exception as e:
        logger.error(f"Error in send_direct_message: {str(e)}")
        return False, None, None

async def _send_room_message_async(room_id: str, message: str) -> bool:
    """
    Send a message to a Matrix room asynchronously with automatic notice footer.
    
    Args:
        room_id (str): The Matrix room ID to send the message to
        message (str): The message content
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Cannot send room message.")
        return False
    
    # Automatically append the MATRIX_MESSAGE_NOTICE to the message
    from app.utils.config import Config
    notice = Config.MATRIX_MESSAGE_NOTICE
    if notice and not message.endswith(notice):
        message_with_notice = f"{message}\n\n{notice}"
    else:
        message_with_notice = message
    
    client = None
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
                "body": message_with_notice
            }
        )
        
        if isinstance(response, RoomSendResponse):
            logger.info(f"Message sent to room {room_id} successfully")
            return True
        else:
            logger.error(f"Failed to send message to room: {response}")
            return False
    except Exception as e:
        logger.error(f"Error sending room message: {e}")
        return False
    finally:
        # Ensure client is closed
        if client:
            try:
                await client.close()
            except Exception as close_error:
                logger.warning(f"Error closing Matrix client: {close_error}")

def send_room_message(room_id: str, message: str) -> bool:
    """
    Send a message to a Matrix room.
    
    This is a synchronous wrapper around the async implementation.
    Creates a new event loop for each call - appropriate for infrequent operations.
    
    Args:
        room_id: The ID of the room to send the message to
        message: The message content
        
    Returns:
        bool: True if the message was sent successfully, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping send_room_message.")
        return False
        
    logger.debug(f"Sending room message to {room_id}, length: {len(message)} chars")
        
    try:
        # Create a new event loop for this operation
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            # Send the message
            result = loop.run_until_complete(_send_room_message_async(room_id, message))
            
            # Log result
            if result:
                logger.info(f"✅ Room message sent to {room_id}")
            else:
                logger.warning(f"❌ Failed to send room message to {room_id}")
                
            return result
        finally:
            # Always close the event loop
            loop.close()
            
    except Exception as e:
        logger.error(f"Error sending message to room {room_id}: {e}")
        return False

async def _send_room_message_with_content_async(room_id: str, content: dict) -> bool:
    """
    Send a message with custom content to a Matrix room asynchronously.
    
    Args:
        room_id (str): The Matrix room ID to send the message to
        content (dict): The message content dictionary
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Cannot send room message.")
        return False
    
    # Enhanced logging for INDOC message sending
    logger.info(f"=== SENDING ROOM MESSAGE WITH CONTENT ===")
    logger.info(f"Target room: {room_id}")
    logger.info(f"Message content keys: {list(content.keys())}")
    logger.info(f"Message type: {content.get('msgtype', 'unknown')}")
    logger.info(f"Plain text body: {content.get('body', 'N/A')}")
    logger.info(f"HTML formatted body: {content.get('formatted_body', 'N/A')}")
    
    client = None
    try:
        # Create Matrix client
        logger.info(f"Creating Matrix client for room message...")
        client = await get_matrix_client()
        if not client:
            logger.error("❌ Failed to create Matrix client for room message")
            return False
        
        logger.info(f"✅ Matrix client created successfully")
        
        # Send the message with custom content
        logger.info(f"Sending message to room {room_id}...")
        response = await client.room_send(
            room_id=room_id,
            message_type="m.room.message",
            content=content
        )
        
        logger.info(f"Room send response type: {type(response).__name__}")
        logger.info(f"Room send response: {response}")
        
        if isinstance(response, RoomSendResponse):
            logger.info(f"✅ SUCCESS: Message with custom content sent to room {room_id}")
            logger.info(f"Event ID: {response.event_id}")
            return True
        else:
            logger.error(f"❌ FAILED: Unexpected response type when sending to room {room_id}: {response}")
            return False
    except Exception as e:
        logger.error(f"❌ EXCEPTION: Error sending room message with content to {room_id}: {e}")
        logger.error(f"Exception type: {type(e).__name__}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return False
    finally:
        # Ensure client is closed properly with custom aiohttp cleanup
        if client:
            try:
                logger.info(f"Properly closing Matrix client with custom aiohttp cleanup...")
                await close_matrix_client_properly(client)
                logger.info(f"✅ Matrix client closed successfully")
            except Exception as close_error:
                logger.warning(f"⚠️ Error closing Matrix client: {close_error}")

async def send_matrix_message_async(target: str, message, is_formatted: bool = False) -> bool:
    """
    Send a message to a Matrix user or room asynchronously.
    
    Args:
        target: The Matrix ID (user or room) to send the message to
        message: The message content (str for simple text, dict for structured content)
        is_formatted: Whether the message is structured content (dict) or simple text (str)
        
    Returns:
        bool: True if the message was sent successfully, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping send_matrix_message_async.")
        return False
        
    try:
        # Determine if target is a room ID or user ID
        if target.startswith('!'):
            # It's a room ID - send directly to the room
            room_id = target
            logger.info(f"Sending message to room: {room_id}")
        elif target.startswith('@'):
            # It's a user ID, create a direct chat
            logger.info(f"Creating direct chat with user: {target}")
            room_id = await create_matrix_direct_chat(target)
            if not room_id:
                logger.error(f"Failed to create direct chat with {target}")
                return False
        else:
            logger.error(f"Invalid target format: {target}. Must start with '!' (room) or '@' (user)")
            return False
        
        # Send the message based on format
        if is_formatted and isinstance(message, dict):
            # Send structured content (for intentional mentions)
            logger.info(f"Sending structured message with intentional mentions to {room_id}")
            return await _send_room_message_with_content_async(room_id, message)
        else:
            # Send simple text message
            message_text = str(message)
            logger.info(f"Sending text message to {room_id}: {message_text[:100]}...")
            return await _send_room_message_async(room_id, message_text)
            
    except Exception as e:
        logger.error(f"Error sending message to {target}: {e}")
        return False

# Database operations for matrix room member functions
def get_matrix_room_members(db, room_id):
    """
    Get matrix room members from cache using the database operations.
    """
    try:
        from app.db.operations import get_matrix_room_members as db_get_members
        return db_get_members(db, room_id)
    except Exception as e:
        logger.debug(f"Error getting cached room members: {e}")
        return []
    
def update_matrix_room_members(db, room_id, members):
    """
    Update matrix room members in cache using the database operations.
    """
    try:
        from app.db.operations import update_matrix_room_members as db_update_members
        return db_update_members(db, room_id, members)
    except Exception as e:
        logger.warning(f"Error updating cached room members: {e}")
        pass

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

async def send_signal_message_async(user_id: str, message: str) -> bool:
    """
    Special function to send a message to a Signal bridge user.
    Uses the temp room approach for Signal bridge users.
    
    Args:
        user_id: The Matrix ID of the Signal bridge user
        message: The message content
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Cannot send Signal message.")
        return False
    
    logger.info(f"Using temp room approach for Signal bridge user: {user_id}")
    
    try:
        # Create Matrix client
        client = await get_matrix_client()
        if not client:
            logger.error("Failed to create Matrix client")
            return False
        
        try:
            # Create a temporary room with a specific name
            unique_id = str(uuid.uuid4())[:8]  # Generate a short unique ID
            temp_room_name = f"Signal Message {unique_id}"
            
            logger.info(f"Creating temporary room '{temp_room_name}' for Signal message")
            
            try:
                # Create the room first with a name
                response = await client.room_create(
                    visibility="private",  # Use string instead of enum
                    name=temp_room_name,
                    topic="Temporary room for Signal message"
                )
                
                if not hasattr(response, 'room_id'):
                    logger.error(f"Failed to create temporary room: {response}")
                    return False
                
                room_id = response.room_id
                logger.info(f"Created temporary room: {room_id}")
                
                # Now invite the Signal user
                logger.info(f"Inviting Signal user to room: {user_id}")
                invite_response = await client.room_invite(room_id, user_id)
                
                if not isinstance(invite_response, RoomInviteResponse):
                    logger.error(f"Failed to invite Signal user: {invite_response}")
                    return False
                
                logger.info(f"Successfully invited Signal user to room")
                
                # Wait a moment for the bridge to process the invitation
                await asyncio.sleep(2)
                
                # Send the message
                logger.info(f"Sending message to Signal user via room {room_id}")
                send_response = await client.room_send(
                    room_id=room_id,
                    message_type="m.room.message",
                    content={
                        "msgtype": "m.text",
                        "body": message
                    }
                )
                
                if hasattr(send_response, 'event_id'):
                    logger.info(f"Message sent to Signal user via temp room {room_id}")
                    
                    # Now mark the room as direct chat
                    # This helps with Matrix client UI organization
                    try:
                        # Set the room as a direct chat
                        await client.room_put_state(
                            room_id=room_id,
                            event_type="m.room.direct",
                            content={user_id: [room_id]}
                        )
                        logger.info("Room marked as direct chat")
                    except Exception as e:
                        # Non-critical error, just log it
                        logger.warning(f"Could not mark room as direct chat: {e}")
                    
                    return True
                else:
                    logger.error(f"Failed to send message: {send_response}")
                    return False
                
            except Exception as e:
                logger.error(f"Error in temp room workflow: {e}")
                logger.error(f"Traceback: {traceback.format_exc()}")
                return False
                
        finally:
            # Ensure client is closed
            await client.close()
            
    except Exception as e:
        logger.error(f"Error in send_signal_message_async: {e}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        return False

def send_signal_message(user_id: str, message: str) -> bool:
    """
    Synchronous wrapper for sending a message to a Signal bridge user.
    
    Args:
        user_id: The Matrix ID of the Signal bridge user
        message: The message content
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Create a new event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        # Send the message
        result = loop.run_until_complete(send_signal_message_async(user_id, message))
        return result
    except Exception as e:
        logger.error(f"Error sending Signal message: {e}")
        return False
    finally:
        # Clean up
        if not loop.is_closed():
            loop.close()

def invite_user_to_recommended_rooms_sync(user_id: str, room_ids: List[str]) -> Dict[str, Union[bool, List[str], List[Tuple[str, str]]]]:
    """
    Synchronous wrapper for inviting a user to recommended rooms.
    
    Args:
        user_id: Matrix user ID
        room_ids: List of room IDs to invite the user to
        
    Returns:
        Dict with status and results
    """
    import asyncio
    import threading
    import logging
    import traceback
    import time
    
    async def invite_to_rooms_async():
        """Async function that properly manages client connections."""
        results = []
        failed_rooms = []
        
        # Use a single client for all operations
        async with matrix_client_context() as client:
            if not client:
                logger.error("Failed to create Matrix client")
                return {
                    "success": False,
                    "error": "Failed to create Matrix client",
                    "invited_rooms": [],
                    "failed_rooms": room_ids
                }
            
            for room_id in room_ids:
                try:
                    # Invite to room using the shared client
                    await client.room_invite(room_id, user_id)
                    
                    # Get room name using the shared client
                    try:
                        room_name = await get_room_name_by_id(client, room_id)
                    except:
                        room_name = room_id  # Fallback to room ID
                    
                    results.append((room_id, room_name))
                    logger.info(f"Successfully invited {user_id} to room {room_id}")
                    
                except Exception as e:
                    logger.error(f"Error inviting {user_id} to room {room_id}: {str(e)}")
                    failed_rooms.append(room_id)
                
        return {
            "success": len(results) > 0,
            "invited_rooms": results,
            "failed_rooms": failed_rooms
        }
    
    try:
        # Create a new event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        # Apply nest_asyncio to allow nested event loops 
        import nest_asyncio
        nest_asyncio.apply()
            
        # Run the async function
        result = loop.run_until_complete(invite_to_rooms_async())
        return result
        
    except Exception as e:
        logging.error(f"Error in invite_user_to_recommended_rooms_sync: {str(e)}")
        logging.error(traceback.format_exc())
        return {
            "success": False,
            "error": str(e),
            "invited_rooms": [],
            "failed_rooms": room_ids
        }
    finally:
        # Clean up the event loop
        try:
            loop.close()
        except:
            pass

async def verify_direct_message_delivery(room_id: str, event_id: str) -> bool:
    """
    Verify if a direct message was delivered successfully.
    
    Args:
        room_id: The Matrix room ID where the message was sent
        event_id: The event ID of the sent message
        
    Returns:
        bool: True if the message was delivered, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Cannot verify message delivery.")
        return False
        
    try:
        # Create Matrix client
        client = await get_matrix_client()
        if not client:
            logger.error("Failed to create Matrix client")
            return False
        
        try:
            # Get the room messages to check if our event appears
            response = await client.room_messages(room_id, limit=20)
            
            if hasattr(response, 'chunk'):
                # Check if our event ID is in the recent messages
                for event in response.chunk:
                    if hasattr(event, 'event_id') and event.event_id == event_id:
                        logger.info(f"Message with event_id {event_id} found in room {room_id}")
                        return True
            
            logger.warning(f"Message with event_id {event_id} not found in room {room_id}")
            return False
            
        finally:
            # Close the client
            await client.close()
            
    except Exception as e:
        logger.error(f"Error verifying message delivery: {e}")
        return False

async def get_direct_message_history(user_id: str, limit: int = 20) -> List[Dict]:
    """
    Get the message history for a direct message conversation with a user.
    Enhanced with encryption support for Signal bridge messages.
    
    Args:
        user_id: The Matrix user ID to get conversation history with
        limit: Maximum number of messages to retrieve (default: 20)
        
    Returns:
        List[Dict]: List of message dictionaries with sender, content, timestamp, etc.
                   Returns empty list if no messages or on error.
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Cannot get message history.")
        return []
        
    try:
        # First, get or create the direct chat room
        room_id = await create_matrix_direct_chat(user_id)
        if not room_id:
            logger.warning(f"Could not find or create direct chat room with {user_id}")
            return []
        
        # Create Matrix client with encryption support
        client = await get_matrix_client()
        if not client:
            logger.error("Failed to create Matrix client")
            return []
        
        try:
            # Perform initial sync to get encryption keys if needed
            logger.debug("Performing initial sync for encryption keys...")
            sync_response = await client.sync(timeout=10000, full_state=True)
            logger.debug(f"Sync completed: {type(sync_response).__name__}")
            
            # Get the room messages
            response = await client.room_messages(room_id, limit=limit)
            
            messages = []
            if hasattr(response, 'chunk'):
                logger.info(f"Processing {len(response.chunk)} events from room {room_id}")
                
                # Process messages in reverse order (oldest first)
                for event in reversed(response.chunk):
                    try:
                        # Get event type from source data if available, otherwise use class name
                        event_type = 'Unknown'
                        if hasattr(event, 'source') and isinstance(event.source, dict):
                            event_type = event.source.get('type', 'Unknown')
                        
                        sender = getattr(event, 'sender', 'Unknown')
                        event_id = getattr(event, 'event_id', 'Unknown')
                        timestamp = getattr(event, 'server_timestamp', 0)
                        
                        # Format timestamp
                        formatted_time = ''
                        if timestamp:
                            import datetime
                            dt = datetime.datetime.fromtimestamp(timestamp / 1000)
                            formatted_time = dt.strftime('%Y-%m-%d %H:%M:%S')
                        
                        message_content = None
                        decryption_status = "unknown"
                        
                        # Handle different event types based on class name and event type
                        event_class = type(event).__name__
                        
                        if event_class == 'RoomMessageText' or event_type == 'm.room.message':
                            # Already decrypted message
                            if hasattr(event, 'body'):
                                message_content = event.body
                                decryption_status = "plaintext"
                                logger.debug(f"Plaintext message from {sender}: {message_content[:50]}...")
                        
                        elif event_class == 'MegolmEvent' or event_type == 'm.room.encrypted':
                            # Encrypted message - attempt decryption
                            logger.debug(f"Encrypted message from {sender}, attempting decryption...")
                            
                            # Method 1: Check if already decrypted by client
                            if hasattr(event, 'decrypted') and event.decrypted:
                                if hasattr(event.decrypted, 'body'):
                                    message_content = event.decrypted.body
                                    decryption_status = "auto_decrypted"
                                    logger.debug(f"Auto-decrypted message: {message_content[:50]}...")
                            
                            # Method 2: Try manual decryption
                            elif hasattr(client, 'decrypt_event'):
                                try:
                                    decrypted_event = await client.decrypt_event(event)
                                    if decrypted_event and hasattr(decrypted_event, 'body'):
                                        message_content = decrypted_event.body
                                        decryption_status = "manual_decrypted"
                                        logger.debug(f"Manual-decrypted message: {message_content[:50]}...")
                                except Exception as decrypt_error:
                                    logger.debug(f"Manual decryption failed: {decrypt_error}")
                                    decryption_status = "decryption_failed"
                            
                            # If still no content, mark as encrypted with helpful context
                            if not message_content:
                                # Provide specific guidance based on sender type
                                if sender.startswith("@signal_"):
                                    message_content = "[🔐 Historical Signal message - sent before bot joined conversation]"
                                    decryption_status = "encrypted_historical_signal"
                                else:
                                    message_content = "[🔐 Historical encrypted message - sent before bot joined conversation]"
                                    decryption_status = "encrypted_historical"
                                logger.debug(f"Unable to decrypt historical message from {sender}")
                        
                        # Include all events that have timestamps (both decrypted and encrypted)
                        if timestamp > 0:  # Only include events with valid timestamps
                            # If no message content, check if it's an encrypted event we should show
                            if not message_content:
                                if event_class == 'MegolmEvent' or event_type == 'm.room.encrypted':
                                    message_content = "[🔐 Encrypted message - decryption pending]"
                                    decryption_status = "encrypted_pending"
                                else:
                                    # Skip non-message events like reactions, etc.
                                    continue
                            
                            message_data = {
                                'event_id': event_id,
                                'sender': sender,
                                'content': message_content,
                                'timestamp': timestamp,
                                'formatted_time': formatted_time,
                                'is_bot_message': sender == MATRIX_BOT_USERNAME,
                                'event_type': event_type,
                                'decryption_status': decryption_status
                            }
                            
                            messages.append(message_data)
                            
                            # Log if this is from the target user and looks like a 4-digit number
                            if sender == user_id and message_content.strip().isdigit() and len(message_content.strip()) == 4:
                                logger.info(f"🎯 Found 4-digit number from {user_id}: {message_content}")
                            
                    except Exception as e:
                        logger.warning(f"Error processing message event {event_id}: {e}")
                        continue
            
            logger.info(f"Retrieved {len(messages)} messages from room {room_id}")
            
            # Log decryption statistics
            decryption_stats = {}
            for msg in messages:
                status = msg.get('decryption_status', 'unknown')
                decryption_stats[status] = decryption_stats.get(status, 0) + 1
            
            if decryption_stats:
                logger.info(f"Decryption statistics: {decryption_stats}")
            
            return messages
            
        finally:
            # Close the client
            await client.close()
            
    except Exception as e:
        logger.error(f"Error getting message history for {user_id}: {e}")
        return []

def get_direct_message_history_sync(user_id: str, limit: int = 20) -> List[Dict]:
    """
    Synchronous wrapper for getting direct message history.
    
    Args:
        user_id: The Matrix user ID to get conversation history with
        limit: Maximum number of messages to retrieve (default: 20)
        
    Returns:
        List[Dict]: List of message dictionaries with sender, content, timestamp, etc.
                   Returns empty list if no messages or on error.
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Cannot get message history.")
        return []
        
    try:
        # Create a new event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        # Get message history
        result = loop.run_until_complete(get_direct_message_history(user_id, limit))
        return result
        
    except Exception as e:
        logger.error(f"Error getting message history: {e}")
        return []
    finally:
        loop.close()

def verify_direct_message_delivery_sync(room_id: str, event_id: str) -> bool:
    """
    Synchronous wrapper for verifying if a direct message was delivered.
    
    Args:
        room_id: The Matrix room ID where the message was sent
        event_id: The event ID of the sent message
        
    Returns:
        bool: True if the message was delivered, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Cannot verify message delivery.")
        return False
        
    try:
        # Create a new event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        # Verify message delivery
        result = loop.run_until_complete(verify_direct_message_delivery(room_id, event_id))
        return result
        
    except Exception as e:
        logger.error(f"Error verifying message delivery: {e}")
        return False
    finally:
        loop.close()

async def send_signal_bridge_message(user_id: str, message: str) -> bool:
    """
    Send a message to a Signal bridge user by first getting the correct chat room.
    
    Args:
        user_id: The Matrix ID of the Signal bridge user (e.g., @signal_xxx:domain.com)
        message: The message content
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Cannot send Signal bridge message.")
        return False
    
    try:
        # First, get the correct chat room for this Signal user
        chat_room_id = await create_matrix_direct_chat(user_id)
        if not chat_room_id:
            logger.error(f"Failed to get Signal chat room for {user_id}")
            return False
        
        # Now send the message to the actual chat room
        client = await get_matrix_client()
        if not client:
            logger.error("Failed to create Matrix client")
            return False
        
        try:
            logger.info(f"Sending message to Signal chat room {chat_room_id}: {message}")
            
            response = await client.room_send(
                room_id=chat_room_id,
                message_type="m.room.message",
                content={
                    "msgtype": "m.text",
                    "body": message
                }
            )
            
            if hasattr(response, 'event_id'):
                logger.info(f"Successfully sent Signal message: {response.event_id}")
                return True
            else:
                logger.error(f"Failed to send Signal message, response: {response}")
                return False
                
        finally:
            await client.close()
            
    except Exception as e:
        logger.error(f"Error sending Signal bridge message: {e}")
        return False

async def send_welcome_message_with_encryption_delay(user_id: str, welcome_message: str, delay_seconds: int = 5) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Send a welcome message to a Matrix user with encryption establishment delay.
    
    This function addresses the common issue where messages sent immediately after
    creating a direct chat room are encrypted but can't be decrypted by the recipient
    because encryption keys haven't been established yet.
    
    The solution:
    1. Create/find the direct chat room
    2. Send a simple "hello" message to establish encryption
    3. Wait for encryption keys to be exchanged
    4. Send the actual welcome message
    
    Args:
        user_id (str): The Matrix user ID to send the message to
        welcome_message (str): The actual welcome message content
        delay_seconds (int): Seconds to wait between hello and welcome message (default: 5)
        
    Returns:
        Tuple[bool, Optional[str], Optional[str]]: Tuple containing:
            - Success status (bool)
            - Room ID where message was sent (str or None)
            - Event ID of the welcome message (str or None)
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Cannot send welcome message.")
        return False, None, None
    
    try:
        logger.info(f"Starting welcome message sequence for {user_id} with {delay_seconds}s encryption delay")
        
        # Step 1: Send a simple hello message to establish encryption
        hello_message = "👋 Hello! Setting up our secure chat..."
        hello_success, room_id, hello_event_id = await _send_direct_message_async(user_id, hello_message)
        
        if not hello_success or not room_id:
            logger.error(f"Failed to send initial hello message to {user_id}")
            return False, None, None
        
        logger.info(f"✅ Hello message sent to {user_id} in room {room_id}, waiting {delay_seconds}s for encryption...")
        
        # Step 2: Wait for encryption keys to be established
        await asyncio.sleep(delay_seconds)
        
        # Step 3: Send the actual welcome message
        logger.info(f"Sending welcome message to {user_id} after encryption delay")
        welcome_success, _, welcome_event_id = await _send_direct_message_async(user_id, welcome_message)
        
        if welcome_success:
            logger.info(f"✅ Welcome message sequence completed for {user_id}")
            return True, room_id, welcome_event_id
        else:
            logger.warning(f"⚠️ Hello message sent but welcome message failed for {user_id}")
            return False, room_id, hello_event_id
            
    except Exception as e:
        logger.error(f"Error in welcome message sequence for {user_id}: {str(e)}")
        return False, None, None

def send_welcome_message_with_encryption_delay_sync(user_id: str, welcome_message: str, delay_seconds: int = 5) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Synchronous wrapper for sending welcome messages with encryption delay.
    
    Args:
        user_id (str): The Matrix user ID to send the message to
        welcome_message (str): The actual welcome message content
        delay_seconds (int): Seconds to wait between hello and welcome message (default: 5)
        
    Returns:
        Tuple[bool, Optional[str], Optional[str]]: Tuple containing:
            - Success status (bool)
            - Room ID where message was sent (str or None)
            - Event ID of the welcome message (str or None)
    """
    if not MATRIX_ACTIVE:
        logger.warning("Matrix integration is not active. Skipping welcome message.")
        return False, None, None
    
    try:
        # Create a new event loop for this operation
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        
        try:
            result = loop.run_until_complete(
                send_welcome_message_with_encryption_delay(user_id, welcome_message, delay_seconds)
            )
            
            if result[0]:
                logger.info(f"✅ Welcome message sequence completed for {user_id}")
            else:
                logger.warning(f"❌ Welcome message sequence failed for {user_id}")
            
            return result
        finally:
            loop.close()
            
    except Exception as e:
        logger.error(f"Error in welcome message sequence: {str(e)}")
        return False, None, None
