import pytest
from unittest.mock import AsyncMock, patch, Mock
from datetime import datetime
from app.utils.matrix_actions import (
    get_matrix_client,
    send_matrix_message,
    create_matrix_direct_chat,
    invite_to_matrix_room,
    remove_from_room,
)
from app.utils.config import Config
from nio import RoomInviteResponse

@pytest.fixture
def mock_matrix_config(mocker):
    """Setup mock Matrix configuration"""
    mocker.patch.object(Config, 'MATRIX_ACTIVE', True)
    mocker.patch.object(Config, 'MATRIX_HOMESERVER_URL', 'https://matrix.test')
    mocker.patch.object(Config, 'MATRIX_ACCESS_TOKEN', 'test_token')

@pytest.fixture
async def mock_matrix_client():
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
async def test_send_matrix_message(mock_matrix_client):
    room_id = "!test:matrix.org"
    message = "Test message"
    
    with patch('app.utils.matrix_actions.get_matrix_client', return_value=mock_matrix_client):
        result = await send_matrix_message(room_id, message)
        assert result is not None
        mock_matrix_client.room_send.assert_called_once()

@pytest.mark.asyncio
async def test_create_matrix_direct_chat(mock_matrix_client):
    """Test creating a direct chat"""
    user_id = "@user:matrix.org"
    
    with patch('app.utils.matrix_actions.get_matrix_client', return_value=mock_matrix_client):
        result = await create_matrix_direct_chat(user_id)
        assert result is not None
        mock_matrix_client.room_create.assert_called_once_with(
            visibility="private",
            is_direct=True,
            invite=[user_id],
            preset="trusted_private_chat"
        )

@pytest.mark.asyncio
async def test_invite_to_matrix_room(mock_matrix_client):
    """Test inviting a user to a room"""
    room_id = "!test:matrix.org"
    user_id = "@user:matrix.org"
    
    # Create a mock RoomInviteResponse
    mock_response = Mock(spec=RoomInviteResponse)
    mock_matrix_client.room_invite.return_value = mock_response
    
    with patch('app.utils.matrix_actions.get_matrix_client', return_value=mock_matrix_client):
        result = await invite_to_matrix_room(room_id, user_id)
        assert result is True
        mock_matrix_client.room_invite.assert_called_once_with(room_id, user_id)

@pytest.mark.asyncio
async def test_matrix_messaging():
    """Test matrix messaging functionality"""
    with patch('app.utils.matrix_actions.AsyncClient') as mock_client:
        result = await send_matrix_message("test_room_id", "test message")
        assert result is not None
