import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.database import Base
from app.db.operations import (
    User,
    AdminEvent,
    add_admin_event,
    search_users,
    sync_user_data
)
from datetime import datetime, timedelta
from unittest.mock import Mock, patch
from app.db.operations import (
    get_verification_code,
    update_status,
    create_admin_event,
    get_user
)

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
    """Test user creation in database"""
    user = User(
        username="testuser",
        email="test@example.com",
        first_name="Test",
        last_name="User"
    )
    test_db.add(user)
    test_db.commit()
    
    saved_user = test_db.query(User).filter_by(username="testuser").first()
    assert saved_user is not None
    assert saved_user.email == "test@example.com"
    assert saved_user.first_name == "Test"
    assert saved_user.last_name == "User"

def test_create_admin_event(test_db):
    """Test admin event creation"""
    event = AdminEvent(
        event_type="test_event",
        username="testuser",
        details="Test event details"
    )
    test_db.add(event)
    test_db.commit()
    
    saved_event = test_db.query(AdminEvent).filter_by(username="testuser").first()
    assert saved_event is not None
    assert saved_event.event_type == "test_event"
    assert saved_event.details == "Test event details"

@pytest.mark.asyncio
async def test_sync_user_data(test_db):
    """Test syncing user data"""
    test_data = {
        "username": "testuser",
        "email": "test@example.com",
        "is_active": True
    }
    result = sync_user_data(test_db, [test_data])
    assert result is True

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

@pytest.mark.asyncio
async def test_add_admin_event(test_db):
    """Test adding an admin event"""
    timestamp = datetime.now()
    event = add_admin_event(
        db=test_db,
        event_type="test_event",
        username="testuser",
        details="Test details",
        timestamp=timestamp
    )
    assert isinstance(event, AdminEvent)
    assert event.event_type == "test_event"
    assert event.username == "testuser" 