import pytest
from unittest.mock import Mock, patch, MagicMock
from sqlalchemy import inspect
from app.db.init_db import init_db, should_sync_users, sync_user_data, sync_user_data_incremental
from app.db.operations import User, AdminEvent
from datetime import datetime, timedelta
from app.db.database import Base

@pytest.fixture
def mock_db_session():
    return Mock()

@pytest.fixture
def mock_engine():
    return Mock()

@pytest.fixture
def mock_streamlit():
    with patch('app.db.init_db.st') as mock_st:
        mock_st.session_state = {}
        yield mock_st

def test_should_sync_users(mock_db_session, mock_streamlit):
    """Test the should_sync_users function with various scenarios"""
    
    fixed_current_time = datetime(2024, 1, 1, 12, 0)  # Fixed time for consistent testing
    
    with patch('app.db.init_db.datetime') as mock_datetime:
        mock_datetime.now.return_value = fixed_current_time
        
        # Test when sync is in progress
        mock_streamlit.session_state['sync_in_progress'] = True
        assert should_sync_users(mock_db_session) is False
        
        # Test when last change check is recent
        mock_streamlit.session_state['sync_in_progress'] = False
        mock_streamlit.session_state['last_change_check'] = fixed_current_time - timedelta(minutes=30)
        assert should_sync_users(mock_db_session) is False
        
        # Test when no sync events exist
        mock_streamlit.session_state.clear()
        mock_db_session.query.return_value.filter.return_value.order_by.return_value.first.return_value = None
        assert should_sync_users(mock_db_session) is True
        
        # Test when last sync is too old (more than 6 hours ago)
        old_sync = Mock(spec=AdminEvent)
        old_sync.timestamp = fixed_current_time - timedelta(hours=7)
        mock_db_session.query.return_value.filter.return_value.order_by.return_value.first.return_value = old_sync
        mock_streamlit.session_state.clear()
        assert should_sync_users(mock_db_session) is True
        
        # Test when last sync is recent
        recent_sync = Mock(spec=AdminEvent)
        recent_sync.timestamp = fixed_current_time - timedelta(minutes=30)
        mock_db_session.query.return_value.filter.return_value.order_by.return_value.first.return_value = recent_sync
        mock_streamlit.session_state.clear()
        assert should_sync_users(mock_db_session) is False

def test_init_db():
    """Test database initialization"""
    with patch.object(Base.metadata, 'create_all') as mock_create_all, \
         patch('app.db.init_db.inspect') as mock_inspect, \
         patch('app.db.migrations.add_signal_identity.migrate') as mock_migration, \
         patch('app.db.init_db.should_sync_users', return_value=False) as mock_should_sync, \
         patch('app.db.init_db.SessionLocal') as mock_session_local, \
         patch('app.db.init_db.create_default_admin_user') as mock_create_admin:
        
        # Mock inspector to simulate missing tables
        mock_inspector = Mock()
        mock_inspect.return_value = mock_inspector
        mock_inspector.get_table_names.return_value = []  # No tables exist
        
        # Mock session
        mock_db = Mock()
        mock_session_local.return_value = mock_db
        
        init_db()
        
        # Verify create_all was called
        mock_create_all.assert_called_once()
        
        # Verify other functions were called
        mock_migration.assert_called_once()
        mock_create_admin.assert_called_once()

@pytest.mark.asyncio
async def test_sync_user_data_incremental(mock_db_session):
    """Test incremental user data synchronization"""
    users_to_sync = [
        {
            "pk": "123",
            "username": "testuser",
            "email": "test@example.com",
            "is_active": True
        }
    ]
    
    with patch('app.db.operations.User') as MockUser:
        # Mock existing users query
        mock_existing_users = []
        mock_db_session.query.return_value.all.return_value = mock_existing_users
        
        # Mock user creation
        mock_user = Mock()
        mock_user.authentik_id = "123"
        mock_user.username = "testuser"
        MockUser.return_value = mock_user
        
        # Mock bulk operations
        mock_db_session.bulk_save_objects = Mock()
        mock_db_session.commit = Mock()
        
        # Mock query chain for user lookup
        mock_query = Mock()
        mock_db_session.query.return_value = mock_query
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = None
        mock_query.all.return_value = []  # For the initial query and subsequent queries
        
        result = sync_user_data_incremental(mock_db_session, users_to_sync, full_sync=False)
        assert result is True
        
        # Verify bulk operations were called
        mock_db_session.bulk_save_objects.assert_called()
        mock_db_session.commit.assert_called()

@pytest.mark.asyncio
async def test_sync_user_data(mock_db_session):
    users_to_sync = [
        {
            "pk": "123",
            "username": "testuser",
            "email": "test@example.com",
            "is_active": True
        }
    ]
    
    with patch('app.db.operations.User') as MockUser:
        mock_user = Mock()
        MockUser.return_value = mock_user
        
        # Mock query functionality
        mock_query = Mock()
        mock_db_session.query.return_value = mock_query
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = None
        
        result = sync_user_data(mock_db_session, users_to_sync)
        assert result is True
        mock_db_session.add.assert_called_once_with(mock_user)
        mock_db_session.commit.assert_called_once() 