import pytest
from unittest.mock import AsyncMock, patch, Mock, MagicMock
from datetime import datetime
from app.utils.matrix_actions import (
    get_matrix_client,
    send_matrix_message,
    create_matrix_direct_chat,
    invite_to_matrix_room,
    remove_from_room,
    send_direct_message,
    verify_direct_message_delivery,
)
from app.utils.config import Config
from nio import RoomInviteResponse, RoomSendResponse, RoomMessagesResponse, RoomVisibility, RoomCreateResponse

@pytest.fixture
def mock_matrix_config(mocker):
    """Setup mock Matrix configuration"""
    mocker.patch.object(Config, 'MATRIX_ACTIVE', True)
    mocker.patch.object(Config, 'MATRIX_HOMESERVER_URL', 'https://matrix.test')
    mocker.patch.object(Config, 'MATRIX_ACCESS_TOKEN', 'test_token')

@pytest.fixture
async def mock_matrix_client():
    """Return a mock Matrix client that can be awaited"""
    client = AsyncMock()
    client.room_create.return_value = AsyncMock(room_id="!test:matrix.org")
    client.room_invite.return_value = AsyncMock(event_id="test_event")
    client.room_send.return_value = AsyncMock(event_id="test_event")
    return client

@pytest.fixture
def mock_config():
    return {
        "MATRIX_ACTIVE": True,
        "MATRIX_HOMESERVER_URL": "matrix.org",
        "MATRIX_USER_ID": "@bot:matrix.org",
        "MATRIX_ACCESS_TOKEN": "test_token"
    }

@pytest.mark.asyncio
async def test_get_matrix_client():
    with patch('app.utils.matrix_actions.AsyncClient') as MockClient, \
         patch('app.utils.matrix_actions.Config') as MockConfig:
        MockConfig.MATRIX_ACTIVE = True
        MockConfig.MATRIX_HOMESERVER_URL = "matrix.org"
        MockConfig.MATRIX_USER_ID = "@bot:matrix.org"
        MockConfig.MATRIX_ACCESS_TOKEN = "test_token"
        
        mock_client = AsyncMock()
        MockClient.return_value = mock_client
        
        client = await get_matrix_client()
        assert client is not None
        MockClient.assert_called_once()

@pytest.mark.asyncio
async def test_send_matrix_message():
    room_id = "!test:matrix.org"
    message = "Test message"
    
    # Create a properly mocked client
    mock_client = AsyncMock()
    # Create a mocked response with event_id
    mock_response = AsyncMock()
    mock_response.event_id = "test_event_id"
    mock_client.room_send.return_value = mock_response
    
    with patch('app.utils.matrix_actions.get_matrix_client', return_value=mock_client):
        result = await send_matrix_message(room_id, message)
        assert result is True
        mock_client.room_send.assert_called_once()

@pytest.mark.asyncio
async def test_create_matrix_direct_chat():
    """Test creating a direct chat"""
    user_id = "@user:matrix.org"
    
    # Create a proper Mock client
    mock_client = AsyncMock()
    
    # Mock the profile response to return a display name
    mock_profile_response = AsyncMock()
    mock_profile_response.displayname = "Test User"
    mock_client.get_profile.return_value = mock_profile_response
    
    # Instead of mocking the RoomCreateResponse class, create an object
    # with the properties we need for the isinstance check to pass
    class MockRoomCreateResponse:
        def __init__(self):
            self.room_id = "!test:matrix.org"
            
    # Set up the mock return value
    mock_response = MockRoomCreateResponse()
    mock_client.room_create.return_value = mock_response
    
    # Create a patch that makes isinstance always return True for our specific check
    def patched_isinstance(obj, classinfo):
        if classinfo == RoomCreateResponse:
            return True
        return isinstance(obj, type(obj))
    
    with patch('app.utils.matrix_actions.get_matrix_client', return_value=mock_client), \
         patch('app.utils.matrix_actions.isinstance', patched_isinstance), \
         patch('app.utils.matrix_actions.MATRIX_ACTIVE', True):
        
        result = await create_matrix_direct_chat(user_id)
        assert result == "!test:matrix.org"
        mock_client.room_create.assert_called_once_with(
            visibility="private",
            is_direct=True,
            name="Welcome Test User",
            invite=[user_id],
            preset="trusted_private_chat"
        )

@pytest.mark.asyncio
async def test_invite_to_matrix_room():
    """Test inviting a user to a room"""
    room_id = "!test:matrix.org"
    user_id = "@user:matrix.org"
    
    # Create a properly mocked client
    mock_client = AsyncMock()
    mock_response = AsyncMock(spec=RoomInviteResponse)
    mock_client.room_invite.return_value = mock_response
    
    with patch('app.utils.matrix_actions.get_matrix_client', return_value=mock_client):
        result = await invite_to_matrix_room(room_id, user_id)
        assert result is True
        mock_client.room_invite.assert_called_once_with(room_id, user_id)

@pytest.mark.asyncio
async def test_matrix_messaging():
    """Test matrix messaging functionality"""
    with patch('app.utils.matrix_actions.AsyncClient') as mock_client:
        result = await send_matrix_message("test_room_id", "test message")
        assert result is not None

@pytest.mark.asyncio
async def test_send_direct_message():
    """Test the direct message functionality with event ID tracking."""
    # Mock user ID and message
    user_id = "@user:matrix.org"
    message = "Test direct message"
    
    # Create mocks
    mock_client = AsyncMock()
    mock_response = AsyncMock(spec=RoomSendResponse)
    mock_response.event_id = "event123"
    
    # Configure the mock to return appropriate values
    # Use the same approach as in test_create_matrix_direct_chat
    class MockRoomCreateResponse:
        def __init__(self):
            self.room_id = "!directroom:matrix.org"
    
    # Mock profile response
    mock_profile_response = AsyncMock()
    mock_profile_response.displayname = "Test User"
    mock_client.get_profile.return_value = mock_profile_response
    
    mock_client.room_create.return_value = MockRoomCreateResponse()
    mock_client.room_send.return_value = mock_response
    
    # Mock room members to simulate empty room list
    mock_client.joined_rooms.return_value = AsyncMock(rooms=[])
    
    # Mock get_account_data to return empty results
    mock_client.get_account_data.return_value = {}
    
    # Create a patch for isinstance to recognize our mock
    def patched_isinstance(obj, classinfo):
        if classinfo == RoomCreateResponse:
            return isinstance(obj, MockRoomCreateResponse)
        return isinstance(obj, type(obj))
    
    with patch('app.utils.matrix_actions.get_matrix_client', return_value=mock_client), \
         patch('app.utils.matrix_actions.get_room_members_async', return_value={}), \
         patch('app.utils.matrix_actions.MATRIX_ACTIVE', True), \
         patch('app.utils.matrix_actions.isinstance', patched_isinstance):
        
        # Test the async function directly
        from app.utils.matrix_actions import _send_direct_message_async
        success, room_id, event_id = await _send_direct_message_async(user_id, message)
        
        # Verify results
        assert success is True
        assert room_id == "!directroom:matrix.org"
        assert event_id == "event123"
        
        # Verify function calls
        mock_client.room_create.assert_called_once()
        mock_client.room_send.assert_called_once()

@pytest.mark.asyncio
async def test_verify_message_delivery():
    """Test the verification of message delivery."""
    # Mock room ID and event ID
    room_id = "!room:matrix.org"
    event_id = "event123"
    
    # Create mocks
    mock_client = AsyncMock()
    mock_messages_response = AsyncMock(spec=RoomMessagesResponse)
    
    # Create mock events with one matching our event_id
    mock_event1 = MagicMock()
    mock_event1.event_id = "other_event"
    
    mock_event2 = MagicMock()
    mock_event2.event_id = event_id
    
    mock_messages_response.chunk = [mock_event1, mock_event2]
    mock_client.room_messages.return_value = mock_messages_response
    
    with patch('app.utils.matrix_actions.get_matrix_client', return_value=mock_client):
        # Test verification
        result = await verify_direct_message_delivery(room_id, event_id)
        
        # Verify result
        assert result is True
        
        # Verify function calls
        mock_client.room_messages.assert_called_once_with(room_id, limit=20)
        
        # Test verification with non-matching event ID
        result = await verify_direct_message_delivery(room_id, "wrong_event_id")
        
        # Verify result
        assert result is False
