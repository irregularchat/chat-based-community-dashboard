import pytest
import unittest
from unittest.mock import patch, AsyncMock, MagicMock
from nio import AsyncClient, AsyncClientConfig, RoomSendResponse, RoomCreateResponse, RoomInviteResponse
from app.utils.matrix_actions import (
    send_matrix_message,
    create_matrix_direct_chat,
    invite_to_matrix_room,
    send_matrix_message_to_multiple_rooms,
    get_matrix_client,
    get_all_accessible_users
)
from app.utils.recommendation import get_room_recommendations_sync, invite_user_to_recommended_rooms_sync
from app.utils.config import Config
from app.db.models import User, Group
from app.db.session import get_db

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

class TestMatrixActions(unittest.TestCase):
    def setUp(self):
        # Mock the database session
        self.mock_db = MagicMock()
        self.mock_db.query.return_value = self.mock_db
        self.mock_db.filter.return_value = self.mock_db
        self.mock_db.first.return_value = None
        self.mock_db.all.return_value = []

    @patch('app.utils.matrix_actions.get_matrix_client')
    async def test_get_all_accessible_users(self, mock_get_client):
        # Mock the Matrix client and its responses
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        
        # Mock joined rooms response
        mock_client.joined_rooms.return_value = MagicMock(rooms=['!room1:example.com'])
        
        # Mock room members response
        mock_client.room_get_joined_members.return_value = MagicMock(
            members={
                '@user1:example.com': {'display_name': 'User One'},
                '@user2:example.com': {'display_name': 'User Two'}
            }
        )
        
        # Test the function
        users = await get_all_accessible_users()
        
        # Verify results
        self.assertEqual(len(users), 2)
        self.assertEqual(users[0]['user_id'], '@user1:example.com')
        self.assertEqual(users[0]['display_name'], 'User One')

    @patch('app.utils.matrix_actions.get_matrix_client')
    async def test_invite_to_matrix_room(self, mock_get_client):
        # Mock the Matrix client and its responses
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        
        # Mock successful room invite
        mock_client.room_invite.return_value = MagicMock(event_id='event123')
        
        # Test the function
        result = await invite_to_matrix_room('!room1:example.com', '@user1:example.com')
        
        # Verify results
        self.assertTrue(result)
        mock_client.room_invite.assert_called_once_with('!room1:example.com', '@user1:example.com')

    def test_get_room_recommendations_sync(self):
        # Mock user interests
        user_interests = 'python, machine learning'
        
        # Mock room data
        mock_rooms = [
            {'name': 'Python Room', 'room_id': '!python:example.com', 'categories': ['python']},
            {'name': 'ML Room', 'room_id': '!ml:example.com', 'categories': ['machine learning']},
            {'name': 'Other Room', 'room_id': '!other:example.com', 'categories': ['other']}
        ]
        
        # Mock the match_interests_with_rooms function
        async def mock_match_interests(*args, **kwargs):
            return [mock_rooms[0], mock_rooms[1]]  # Return only matching rooms
            
        with patch('app.utils.recommendation.match_interests_with_rooms', side_effect=mock_match_interests):
            # Test the function
            recommendations = get_room_recommendations_sync('@user1:example.com', user_interests)
            
            # Verify results
            self.assertEqual(len(recommendations), 2)
            self.assertEqual(recommendations[0]['name'], 'Python Room')
            self.assertEqual(recommendations[1]['name'], 'ML Room')

    def test_invite_user_to_recommended_rooms_sync(self):
        # Mock user data
        user_id = '@user1:example.com'
        interests = 'python, machine learning'
        
        # Mock room data
        mock_rooms = [
            {'name': 'Python Room', 'room_id': '!python:example.com', 'categories': ['python']},
            {'name': 'ML Room', 'room_id': '!ml:example.com', 'categories': ['machine learning']}
        ]
        
        # Test the function
        with patch('app.utils.recommendation.get_room_recommendations_sync') as mock_get_rooms:
            with patch('app.utils.matrix_actions.invite_to_matrix_room') as mock_invite:
                # Set up mock returns
                mock_get_rooms.return_value = mock_rooms
                mock_invite.return_value = True
                
                # Call the function
                result = invite_user_to_recommended_rooms_sync(user_id, interests)
                
                # Verify results
                self.assertTrue(result)  # Should return True if all invites succeeded
                mock_get_rooms.assert_called_once_with(user_id, interests)
                self.assertEqual(mock_invite.call_count, 2)  # Should be called for each room
                mock_invite.assert_any_call('!python:example.com', user_id)
                mock_invite.assert_any_call('!ml:example.com', user_id)

if __name__ == '__main__':
    unittest.main()