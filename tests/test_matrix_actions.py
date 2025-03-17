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
from app.config import Config

def test_send_matrix_message():
    """Test sending a Matrix message"""
    # Create a mock client that validates initialization parameters
    class ValidatingAsyncClient(AsyncMock):
        def __init__(self, homeserver, token, config=None, **kwargs):
            if not homeserver:
                raise ValueError("homeserver is required")
            if not token:
                raise ValueError("token is required")
            super().__init__()
            self.homeserver = homeserver
            self.token = token
            self.config = config
    
    mock_client = ValidatingAsyncClient(
        homeserver="https://matrix.org",
        token="test_token",
        config=AsyncClientConfig()
    )
    mock_client.room_send = AsyncMock(return_value=RoomSendResponse(event_id="test_event_id"))
    
    # Mock the get_matrix_client function to return our validating mock
    with patch("app.utils.matrix_actions.get_matrix_client", return_value=mock_client):
        result = send_matrix_message("test_room", "test message")
        assert result is True
        mock_client.room_send.assert_called_once()
        mock_client.close.assert_called_once()

def test_send_matrix_message_failure():
    """Test sending a Matrix message when it fails"""
    # Create a mock client that validates initialization parameters
    class ValidatingAsyncClient(AsyncMock):
        def __init__(self, homeserver, token, config=None, **kwargs):
            if not homeserver:
                raise ValueError("homeserver is required")
            if not token:
                raise ValueError("token is required")
            super().__init__()
            self.homeserver = homeserver
            self.token = token
            self.config = config
    
    mock_client = ValidatingAsyncClient(
        homeserver="https://matrix.org",
        token="test_token",
        config=AsyncClientConfig()
    )
    mock_client.room_send = AsyncMock(side_effect=Exception("Test error"))
    
    # Mock the get_matrix_client function to return our validating mock
    with patch("app.utils.matrix_actions.get_matrix_client", return_value=mock_client):
        result = send_matrix_message("test_room", "test message")
        assert result is False
        mock_client.close.assert_called_once()

def test_create_matrix_direct_chat():
    """Test creating a Matrix direct chat"""
    # Create a mock client that validates initialization parameters
    class ValidatingAsyncClient(AsyncMock):
        def __init__(self, homeserver, token, config=None, **kwargs):
            if not homeserver:
                raise ValueError("homeserver is required")
            if not token:
                raise ValueError("token is required")
            super().__init__()
            self.homeserver = homeserver
            self.token = token
            self.config = config
    
    mock_client = ValidatingAsyncClient(
        homeserver="https://matrix.org",
        token="test_token",
        config=AsyncClientConfig()
    )
    mock_client.room_create = AsyncMock(return_value=RoomCreateResponse(room_id="test_room_id"))
    
    # Mock the get_matrix_client function to return our validating mock
    with patch("app.utils.matrix_actions.get_matrix_client", return_value=mock_client):
        result = create_matrix_direct_chat("test_user")
        assert result == "test_room_id"
        mock_client.room_create.assert_called_once()
        mock_client.close.assert_called_once()

def test_create_matrix_direct_chat_failure():
    """Test creating a Matrix direct chat when it fails"""
    # Create a mock client that validates initialization parameters
    class ValidatingAsyncClient(AsyncMock):
        def __init__(self, homeserver, token, config=None, **kwargs):
            if not homeserver:
                raise ValueError("homeserver is required")
            if not token:
                raise ValueError("token is required")
            super().__init__()
            self.homeserver = homeserver
            self.token = token
            self.config = config
    
    mock_client = ValidatingAsyncClient(
        homeserver="https://matrix.org",
        token="test_token",
        config=AsyncClientConfig()
    )
    mock_client.room_create = AsyncMock(side_effect=Exception("Test error"))
    
    # Mock the get_matrix_client function to return our validating mock
    with patch("app.utils.matrix_actions.get_matrix_client", return_value=mock_client):
        result = create_matrix_direct_chat("test_user")
        assert result is None
        mock_client.close.assert_called_once()

def test_invite_to_matrix_room():
    """Test inviting a user to a Matrix room"""
    # Create a mock client that validates initialization parameters
    class ValidatingAsyncClient(AsyncMock):
        def __init__(self, homeserver, token, config=None, **kwargs):
            if not homeserver:
                raise ValueError("homeserver is required")
            if not token:
                raise ValueError("token is required")
            super().__init__()
            self.homeserver = homeserver
            self.token = token
            self.config = config
    
    mock_client = ValidatingAsyncClient(
        homeserver="https://matrix.org",
        token="test_token",
        config=AsyncClientConfig()
    )
    mock_client.room_invite = AsyncMock(return_value=RoomInviteResponse())
    
    # Mock the get_matrix_client function to return our validating mock
    with patch("app.utils.matrix_actions.get_matrix_client", return_value=mock_client):
        result = invite_to_matrix_room("test_room", "test_user")
        assert result is True
        mock_client.room_invite.assert_called_once()
        mock_client.close.assert_called_once()

def test_invite_to_matrix_room_failure():
    """Test inviting a user to a Matrix room when it fails"""
    # Create a mock client that validates initialization parameters
    class ValidatingAsyncClient(AsyncMock):
        def __init__(self, homeserver, token, config=None, **kwargs):
            if not homeserver:
                raise ValueError("homeserver is required")
            if not token:
                raise ValueError("token is required")
            super().__init__()
            self.homeserver = homeserver
            self.token = token
            self.config = config
    
    mock_client = ValidatingAsyncClient(
        homeserver="https://matrix.org",
        token="test_token",
        config=AsyncClientConfig()
    )
    mock_client.room_invite = AsyncMock(side_effect=Exception("Test error"))
    
    # Mock the get_matrix_client function to return our validating mock
    with patch("app.utils.matrix_actions.get_matrix_client", return_value=mock_client):
        result = invite_to_matrix_room("test_room", "test_user")
        assert result is False
        mock_client.close.assert_called_once()

def test_send_matrix_message_to_multiple_rooms():
    """Test sending a message to multiple Matrix rooms"""
    # Create a mock client that validates initialization parameters
    class ValidatingAsyncClient(AsyncMock):
        def __init__(self, homeserver, token, config=None, **kwargs):
            if not homeserver:
                raise ValueError("homeserver is required")
            if not token:
                raise ValueError("token is required")
            super().__init__()
            self.homeserver = homeserver
            self.token = token
            self.config = config
    
    mock_client = ValidatingAsyncClient(
        homeserver="https://matrix.org",
        token="test_token",
        config=AsyncClientConfig()
    )
    mock_client.room_send = AsyncMock(return_value=RoomSendResponse(event_id="test_event_id"))
    
    # Mock the get_matrix_client function to return our validating mock
    with patch("app.utils.matrix_actions.get_matrix_client", return_value=mock_client):
        result = send_matrix_message_to_multiple_rooms(["room1", "room2"], "test message")
        assert result == {"room1": True, "room2": True}
        assert mock_client.room_send.call_count == 2
        mock_client.close.assert_called_once()

def test_send_matrix_message_to_multiple_rooms_failure():
    """Test sending a message to multiple Matrix rooms when some fail"""
    # Create a mock client that validates initialization parameters
    class ValidatingAsyncClient(AsyncMock):
        def __init__(self, homeserver, token, config=None, **kwargs):
            if not homeserver:
                raise ValueError("homeserver is required")
            if not token:
                raise ValueError("token is required")
            super().__init__()
            self.homeserver = homeserver
            self.token = token
            self.config = config
    
    mock_client = ValidatingAsyncClient(
        homeserver="https://matrix.org",
        token="test_token",
        config=AsyncClientConfig()
    )
    mock_client.room_send = AsyncMock(side_effect=[RoomSendResponse(event_id="test_event_id"), Exception("Test error")])
    
    # Mock the get_matrix_client function to return our validating mock
    with patch("app.utils.matrix_actions.get_matrix_client", return_value=mock_client):
        result = send_matrix_message_to_multiple_rooms(["room1", "room2"], "test message")
        assert result == {"room1": True, "room2": False}
        assert mock_client.room_send.call_count == 2
        mock_client.close.assert_called_once()

def test_get_matrix_client():
    """Test creating a Matrix client"""
    client = get_matrix_client()
    assert client is not None
    assert client.homeserver == Config.MATRIX_URL
    assert client.token == Config.MATRIX_ACCESS_TOKEN
    assert isinstance(client.config, AsyncClientConfig) 