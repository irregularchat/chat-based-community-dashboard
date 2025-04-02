import pytest
from unittest.mock import patch, AsyncMock
from nio import AsyncClient, AsyncClientConfig, RoomSendResponse, RoomCreateResponse, RoomInviteResponse
from app.utils.matrix_actions import (
    send_matrix_message,
    create_matrix_direct_chat,
    invite_to_matrix_room,
    send_matrix_message_to_multiple_rooms,
    get_matrix_client
)
from app.utils.config import Config

@pytest.mark.asyncio
async def test_send_matrix_message():
    """Test sending a Matrix message"""
    mock_client = AsyncMock()
    mock_client.room_send = AsyncMock(return_value=RoomSendResponse(room_id="test_room", event_id="test_event_id"))
    
    with patch("app.utils.matrix_actions.get_matrix_client", return_value=mock_client):
        result = await send_matrix_message("test_room", "test message")
        assert result is True
        mock_client.room_send.assert_called_once()
        mock_client.close.assert_called_once()

@pytest.mark.asyncio
async def test_send_matrix_message_failure():
    """Test sending a Matrix message when it fails"""
    mock_client = AsyncMock()
    mock_client.room_send = AsyncMock(side_effect=Exception("Test error"))
    mock_client.close = AsyncMock()
    
    with patch("app.utils.matrix_actions.get_matrix_client", return_value=mock_client):
        result = await send_matrix_message("test_room", "test message")
        assert result is False
        mock_client.close.assert_called_once()

@pytest.mark.asyncio
async def test_create_matrix_direct_chat():
    """Test creating a Matrix direct chat"""
    mock_client = AsyncMock()
    mock_client.room_create = AsyncMock(return_value=RoomCreateResponse(room_id="test_room_id"))
    
    with patch("app.utils.matrix_actions.get_matrix_client", return_value=mock_client):
        result = await create_matrix_direct_chat("test_user")
        assert result == "test_room_id"
        mock_client.room_create.assert_called_once()
        mock_client.close.assert_called_once()

@pytest.mark.asyncio
async def test_create_matrix_direct_chat_failure():
    """Test creating a Matrix direct chat when it fails"""
    mock_client = AsyncMock()
    mock_client.room_create = AsyncMock(side_effect=Exception("Test error"))
    mock_client.close = AsyncMock()
    
    with patch("app.utils.matrix_actions.get_matrix_client", return_value=mock_client):
        result = await create_matrix_direct_chat("test_user")
        assert result is None
        await mock_client.close()
        mock_client.close.assert_called_once()

@pytest.mark.asyncio
async def test_invite_to_matrix_room():
    """Test inviting a user to a Matrix room"""
    mock_client = AsyncMock()
    mock_client.room_invite = AsyncMock(return_value=RoomInviteResponse())
    
    with patch("app.utils.matrix_actions.get_matrix_client", return_value=mock_client):
        result = await invite_to_matrix_room("test_room", "test_user")
        assert result is True
        mock_client.room_invite.assert_called_once()
        mock_client.close.assert_called_once()

@pytest.mark.asyncio
async def test_invite_to_matrix_room_failure():
    """Test inviting a user to a Matrix room when it fails"""
    mock_client = AsyncMock()
    mock_client.room_invite = AsyncMock(side_effect=Exception("Test error"))
    
    with patch("app.utils.matrix_actions.get_matrix_client", return_value=mock_client):
        result = await invite_to_matrix_room("test_room", "test_user")
        assert result is False
        mock_client.close.assert_called_once()

@pytest.mark.asyncio
async def test_send_matrix_message_to_multiple_rooms():
    """Test sending a message to multiple Matrix rooms"""
    mock_client = AsyncMock()
    mock_client.room_send = AsyncMock(return_value=RoomSendResponse(room_id="test_room", event_id="test_event_id"))
    mock_client.close = AsyncMock()
    
    with patch("app.utils.matrix_actions.get_matrix_client", return_value=mock_client):
        result = await send_matrix_message_to_multiple_rooms(["room1", "room2"], "test message")
        assert result == {"room1": True, "room2": True}
        assert mock_client.room_send.call_count == 2
        mock_client.close.assert_called_once()

@pytest.mark.asyncio
async def test_send_matrix_message_to_multiple_rooms_failure():
    """Test sending a message to multiple Matrix rooms when some fail"""
    mock_client = AsyncMock()
    mock_client.room_send = AsyncMock(side_effect=[
        RoomSendResponse(room_id="room1", event_id="test_event_id"),
        Exception("Test error")
    ])
    mock_client.close = AsyncMock()
    
    with patch("app.utils.matrix_actions.get_matrix_client", return_value=mock_client):
        result = await send_matrix_message_to_multiple_rooms(["room1", "room2"], "test message")
        assert result == {"room1": True, "room2": False}
        assert mock_client.room_send.call_count == 2
        mock_client.close.assert_called_once()

@pytest.mark.asyncio
async def test_get_matrix_client():
    """Test creating a Matrix client"""
    mock_client = AsyncMock()
    mock_client.homeserver = "https://matrix.org"  # Set the homeserver attribute
    mock_client.access_token = "test_token"  # Set the access token attribute
    mock_client.user_id = "@bot:matrix.org"  # Set the user_id attribute
    
    with patch("app.utils.matrix_actions.AsyncClient", return_value=mock_client), \
         patch("app.utils.matrix_actions.MATRIX_ACTIVE", True), \
         patch("app.utils.matrix_actions.MATRIX_HOMESERVER_URL", "https://matrix.org"), \
         patch("app.utils.matrix_actions.MATRIX_ACCESS_TOKEN", "test_token"), \
         patch("app.utils.matrix_actions.MATRIX_BOT_USERNAME", "@bot:matrix.org"):
        
        client = await get_matrix_client()
        assert client is not None
        assert client.homeserver == "https://matrix.org"
        assert client.access_token == "test_token"
        assert client.user_id == "@bot:matrix.org"
        
        # Verify sync was NOT called (we skip sync now)
        client.sync.assert_not_called()
        
        # Verify client was not closed
        client.close.assert_not_called()