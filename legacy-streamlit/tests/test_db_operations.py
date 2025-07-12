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
    user = User(
        username="newuser",
        email="new@example.com",
        first_name="New",
        last_name="User",
        is_active=True,
        is_admin=False
    )
    test_db.add(user)
    test_db.commit()
    
    assert user is not None
    assert user.username == "newuser"
    assert user.email == "new@example.com"
    assert user.first_name == "New"
    assert user.last_name == "User"
    assert user.is_active is True
    assert user.is_admin is False

def test_create_admin_event(test_db):
    """Test creating an admin event"""
    event = AdminEvent(
        event_type="test_event",
        username="admin",
        details="Test event description",
        timestamp=datetime.now()
    )
    test_db.add(event)
    test_db.commit()
    
    assert event is not None
    assert event.event_type == "test_event"
    assert event.username == "admin"
    assert event.details == "Test event description"

def test_sync_user_data(test_db, test_user):
    """Test syncing user data"""
    user_data = {
        "username": test_user.username,
        "email": test_user.email,
        "first_name": "Updated",
        "last_name": "Name",
        "is_active": True,
        "is_admin": False
    }
    success = sync_user_data(test_db, [user_data])
    assert success is True
    
    updated_user = test_db.query(User).filter_by(username=test_user.username).first()
    assert updated_user.first_name == "Updated"
    assert updated_user.last_name == "Name"

def test_add_admin_event(test_db, test_admin):
    """Test adding an admin event"""
    event = add_admin_event(
        test_db,
        event_type="test_event",
        username=test_admin.username,
        details="Test event description",
        timestamp=datetime.now()
    )
    assert event is not None
    
    events = test_db.query(AdminEvent).all()
    assert len(events) == 1
    assert events[0].event_type == "test_event"
    assert events[0].username == test_admin.username
    assert events[0].details == "Test event description"

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