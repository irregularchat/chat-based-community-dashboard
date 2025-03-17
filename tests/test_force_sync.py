import pytest
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime, timedelta
from app.force_sync import force_sync
from app.db.operations import User, AdminEvent

@pytest.fixture
def mock_db_session():
    return Mock()

@pytest.fixture
def mock_config():
    with patch('app.force_sync.Config') as mock_config:
        mock_config.AUTHENTIK_API_URL = 'http://test.com'
        mock_config.AUTHENTIK_API_TOKEN = 'test-token'
        yield mock_config

@pytest.mark.asyncio
async def test_force_sync_full(mock_db_session, mock_config):
    """Test full sync functionality"""
    with patch('app.force_sync.SessionLocal') as mock_session_local, \
         patch('app.force_sync.list_users') as mock_list_users, \
         patch('app.force_sync.sync_user_data_incremental') as mock_sync, \
         patch('app.force_sync.AdminEvent') as MockAdminEvent:
        
        # Mock database session
        mock_session_local.return_value = mock_db_session
        
        # Mock user data
        mock_users = [
            {"pk": "1", "username": "user1"},
            {"pk": "2", "username": "user2"}
        ]
        mock_list_users.return_value = mock_users
        mock_sync.return_value = True
        
        # Mock AdminEvent
        mock_event = Mock()
        MockAdminEvent.return_value = mock_event
        
        # Test full sync
        force_sync(incremental=False)
        
        # Verify calls
        mock_list_users.assert_called_once()
        mock_sync.assert_called_once_with(mock_db_session, mock_users, full_sync=True)
        MockAdminEvent.assert_called_once()
        mock_db_session.add.assert_called_once_with(mock_event)
        mock_db_session.commit.assert_called_once()

@pytest.mark.asyncio
async def test_force_sync_incremental(mock_db_session, mock_config):
    """Test incremental sync functionality"""
    with patch('app.force_sync.SessionLocal') as mock_session_local, \
         patch('app.force_sync.get_users_modified_since') as mock_get_modified, \
         patch('app.force_sync.sync_user_data_incremental') as mock_sync, \
         patch('app.force_sync.AdminEvent') as MockAdminEvent:
        
        # Mock database session
        mock_session_local.return_value = mock_db_session
        
        # Mock last sync event
        last_sync = Mock(timestamp=datetime.now() - timedelta(hours=1))
        mock_db_session.query.return_value.filter.return_value.order_by.return_value.first.return_value = last_sync
        
        # Mock modified users
        mock_users = [{"pk": "1", "username": "modified_user"}]
        mock_get_modified.return_value = mock_users
        mock_sync.return_value = True
        
        # Mock AdminEvent
        mock_event = Mock()
        MockAdminEvent.return_value = mock_event
        
        # Test incremental sync
        force_sync(incremental=True)
        
        # Verify calls
        mock_get_modified.assert_called_once_with(mock_config.AUTHENTIK_API_URL, 
                                                {'Authorization': f'Bearer {mock_config.AUTHENTIK_API_TOKEN}',
                                                 'Content-Type': 'application/json'}, 
                                                last_sync.timestamp)
        mock_sync.assert_called_once_with(mock_db_session, mock_users, full_sync=False)
        MockAdminEvent.assert_called_once()
        mock_db_session.add.assert_called_once_with(mock_event)
        mock_db_session.commit.assert_called_once()

@pytest.mark.asyncio
async def test_force_sync_error_handling(mock_db_session, mock_config):
    """Test error handling in force sync"""
    with patch('app.force_sync.SessionLocal') as mock_session_local, \
         patch('app.force_sync.list_users') as mock_list_users:
        
        # Mock database session
        mock_session_local.return_value = mock_db_session
        
        # Mock error in list_users
        mock_list_users.side_effect = Exception("API Error")
        
        # Test error handling
        force_sync(incremental=False)
        
        # Verify error handling
        mock_db_session.rollback.assert_called_once()
        mock_db_session.close.assert_called_once() 