import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.database import Base
from app.db.operations import (
    User,
    AdminEvent,
    add_admin_event,
    search_users,
    sync_user_data,
    create_user,
    get_user_by_username,
    get_user_by_email,
    create_admin_event,
    get_admin_events
)
from datetime import datetime, timedelta
from unittest.mock import Mock, patch
from app.db.operations import (
    get_verification_code,
    update_status,
    get_user
)
from app.db.database import SessionLocal

@pytest.fixture
def test_db():
    """Create a test database"""
    engine = create_engine('sqlite:///:memory:')
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(engine)

@pytest.fixture
def mock_db_session():
    return Mock()

@pytest.fixture
def sample_user_data():
    return {
        "user_id": "test123",
        "username": "testuser",
        "email": "test@example.com",
        "organization": "TestOrg",
        "is_active": True
    }

def test_create_user(test_db):
    """Test creating a user"""
    user = create_user(
        test_db,
        username="newuser",
        email="new@example.com",
        full_name="New User",
        is_active=True,
        is_admin=False
    )
    assert user is not None
    assert user.username == "newuser"
    assert user.email == "new@example.com"
    assert user.full_name == "New User"
    assert user.is_active is True
    assert user.is_admin is False

def test_create_admin_event(test_db):
    """Test creating an admin event"""
    event = create_admin_event(
        test_db,
        event_type="test_event",
        description="Test event description",
        admin_username="admin"
    )
    assert event is not None
    assert event.event_type == "test_event"
    assert event.description == "Test event description"
    assert event.admin_username == "admin"

def test_sync_user_data(test_db, test_user):
    """Test syncing user data"""
    user_data = {
        "username": test_user.username,
        "email": test_user.email,
        "full_name": "Updated Name",
        "is_active": True,
        "is_admin": False
    }
    success = sync_user_data(test_db, user_data)
    assert success is True
    
    updated_user = get_user_by_username(test_db, test_user.username)
    assert updated_user.full_name == "Updated Name"

def test_add_admin_event(test_db, test_admin):
    """Test adding an admin event"""
    success = add_admin_event(
        test_db,
        event_type="test_event",
        description="Test event description",
        admin_username=test_admin.username
    )
    assert success is True
    
    events = get_admin_events(test_db)
    assert len(events) == 1
    assert events[0].event_type == "test_event"
    assert events[0].description == "Test event description"
    assert events[0].admin_username == test_admin.username

@pytest.mark.asyncio
async def test_get_verification_code(mock_db_session):
    mock_code = Mock(user_id=1, code="123456", expires_at=datetime.utcnow() + timedelta(hours=24))
    mock_db_session.query().filter().first.return_value = mock_code
    
    result = await get_verification_code("123456", mock_db_session)
    assert result["user_id"] == 1
    assert result["code"] == "123456"
    assert not result["expired"]

@pytest.mark.asyncio
async def test_create_or_update_user(mock_db_session, sample_user_data):
    """Test creating or updating a user"""
    with patch('app.db.operations.User') as MockUser:
        mock_user = Mock()
        MockUser.return_value = mock_user
        
        # Mock the query functionality
        mock_query = Mock()
        mock_db_session.query.return_value = mock_query
        mock_query.filter_by.return_value = mock_query
        mock_query.first.return_value = None  # No existing user found
        
        # Create a list of user data for sync_user_data
        users_to_sync = [{
            "pk": "123",
            "username": sample_user_data['username'],
            "email": sample_user_data['email'],
            "is_active": sample_user_data['is_active']
        }]
        
        # Call sync_user_data with the list
        result = sync_user_data(mock_db_session, users_to_sync)
        
        assert result is True
        mock_db_session.add.assert_called_once_with(mock_user)
        mock_db_session.commit.assert_called_once() 