import pytest
import asyncio
from unittest.mock import Mock, patch
from app.utils.matrix_actions import MatrixClient, MATRIX_ACTIVE, MATRIX_DEFAULT_ROOM_ID
from nio import AsyncClient

@pytest.fixture
def mock_config():
    """Mock configuration for Matrix client"""
    with patch('app.utils.matrix_actions.Config') as mock:
        mock.MATRIX_ACTIVE = True
        mock.MATRIX_HOMESERVER_URL = "https://matrix.org"
        mock.MATRIX_ACCESS_TOKEN = "test_token"
        mock.MATRIX_BOT_USERNAME = "@test:matrix.org"
        mock.MATRIX_DEFAULT_ROOM_ID = "!test:matrix.org"
        yield mock

@pytest.fixture
def matrix_client(mock_config):
    """Create a MatrixClient instance for testing"""
    with patch('app.utils.matrix_actions.MATRIX_ACCESS_TOKEN', "test_token"), \
         patch('app.utils.matrix_actions.MATRIX_BOT_USERNAME', "@test:matrix.org"):
        client = MatrixClient()
        client.access_token = "test_token"
        client.user_id = "@test:matrix.org"
        return client

@pytest.mark.asyncio
async def test_get_client(matrix_client):
    """Test client initialization"""
    with patch('nio.AsyncClient') as mock_client:
        mock_client.return_value.access_token = "test_token"
        mock_client.return_value.user_id = "@test:matrix.org"
        
        client = await matrix_client._get_client()
        assert client is not None
        assert client.access_token == "test_token"
        assert client.user_id == "@test:matrix.org"

@pytest.mark.asyncio
async def test_get_matrix_users(matrix_client):
    """Test getting Matrix users"""
    # Mock the client and its methods
    mock_client = Mock(spec=AsyncClient)
    mock_response = Mock()
    mock_response.members = {
        "@user1:matrix.org": Mock(display_name="User 1", avatar_url="url1"),
        "@user2:matrix.org": Mock(display_name="User 2", avatar_url="url2"),
        "@test:matrix.org": Mock(display_name="Bot", avatar_url="bot_url")  # Bot user
    }
    mock_client.joined_members.return_value = mock_response
    
    with patch.object(matrix_client, '_get_client', return_value=mock_client):
        users = matrix_client.get_matrix_users()
        
        # Should have 2 users (excluding the bot)
        assert len(users) == 2
        assert all(user['user_id'] != matrix_client.user_id for user in users)
        assert all('display_name' in user for user in users)
        assert all('avatar_url' in user for user in users)

def test_run_async(matrix_client):
    """Test running async operations"""
    async def test_coro():
        return "test_result"
    
    result = matrix_client.run_async(test_coro())
    assert result == "test_result"

@pytest.mark.asyncio
async def test_close(matrix_client):
    """Test closing the client"""
    mock_client = Mock(spec=AsyncClient)
    matrix_client.client = mock_client
    
    await matrix_client.close()
    mock_client.close.assert_called_once()
    assert matrix_client.client is None

def test_get_matrix_users_inactive():
    """Test getting Matrix users when Matrix is inactive"""
    with patch('app.utils.matrix_actions.MATRIX_ACTIVE', False):
        client = MatrixClient()
        users = client.get_matrix_users()
        assert users == []

def test_get_matrix_users_no_room():
    """Test getting Matrix users when no default room is configured"""
    with patch('app.utils.matrix_actions.MATRIX_DEFAULT_ROOM_ID', ""):
        client = MatrixClient()
        users = client.get_matrix_users()
        assert users == []

@pytest.mark.asyncio
async def test_get_matrix_users_error_handling(matrix_client):
    """Test error handling in get_matrix_users"""
    with patch.object(matrix_client, '_get_client', side_effect=Exception("Test error")):
        users = matrix_client.get_matrix_users()
        assert users == []