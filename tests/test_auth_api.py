import pytest
import requests
from app.auth.api import webhook_notification
from app.utils.config import Config
from unittest.mock import Mock, patch
from app.auth.api import (
    create_user,
    verify_email,
    reset_password,
    process_auth_webhook,
    validate_webhook_signature,
    handle_webhook,
    process_webhook,
    handle_registration,
    force_password_reset,
    generate_secure_passphrase,
    list_users_cached,
    update_user_status,
    delete_user,
    reset_user_password,
    update_user_intro,
    update_user_invited_by,
    create_invite,
)

@pytest.mark.asyncio
async def test_webhook_notification(mocker):
    # Mock Config
    mocker.patch.object(Config, 'WEBHOOK_URL', 'http://test.com')
    mocker.patch.object(Config, 'WEBHOOK_SECRET', 'test-secret')
    mocker.patch.object(Config, 'WEBHOOK_ACTIVE', True)
    
    # Mock the requests.post method
    mock_post = mocker.patch('app.auth.api.requests.post')
    mock_post.return_value.status_code = 200
    mock_post.return_value.raise_for_status.return_value = None
    
    # Test successful webhook notification
    result = await webhook_notification(
        event_type="test_event",
        username="testuser"
    )
    
    # Verify the post request was made with correct data
    mock_post.assert_called_once()
    assert result["success"] is True

@pytest.fixture
def mock_db_session():
    return Mock()

@pytest.fixture
def mock_user_data():
    return {
        "username": "testuser",
        "email": "test@example.com",
        "password": "SecurePass123!",
        "organization": "TestOrg"
    }

@pytest.mark.asyncio
async def test_handle_registration_success(mock_db_session, mock_user_data):
    with patch('app.auth.api.create_user') as mock_create_user, \
         patch('app.auth.api.send_verification_email') as mock_send_email:
        # Mock create_user to return success tuple
        mock_create_user.return_value = (True, "testuser", "temp_password", None)
        mock_send_email.return_value = True
        
        result = await handle_registration(mock_user_data, mock_db_session)
        assert result["success"] is True
        assert "verification_sent" in result
        assert result["username"] == "testuser"
        assert result["temp_password"] == "temp_password"
        mock_create_user.assert_called_once_with(
            username="testuser",
            full_name="",
            email="test@example.com",
            invited_by=None,
            intro="TestOrg"
        )
        mock_send_email.assert_called_once()

@pytest.mark.asyncio
async def test_verify_email_success(mock_db_session):
    with patch('app.auth.api.get_verification_code') as mock_get_code, \
         patch('app.auth.api.mark_email_verified') as mock_mark_verified:
        mock_get_code.return_value = {"user_id": 1, "code": "123456"}
        mock_mark_verified.return_value = True
        
        result = await verify_email("123456", mock_db_session)
        assert result["success"] is True
        mock_mark_verified.assert_called_once_with(1, mock_db_session)

@pytest.mark.asyncio
async def test_reset_password_success(mock_db_session):
    with patch('app.auth.api.get_user_by_email') as mock_get_user, \
         patch('app.auth.api.send_reset_code') as mock_send_reset:
        mock_get_user.return_value = {"id": 1, "email": "test@example.com"}
        mock_send_reset.return_value = True
        
        result = await reset_password("test@example.com", mock_db_session)
        assert result["success"] is True
        assert "reset_code_sent" in result 

@pytest.fixture
def mock_webhook_data():
    return {
        "event": "user.created",
        "data": {
            "user_id": "test123",
            "username": "testuser",
            "email": "test@example.com",
            "organization": "TestOrg"
        },
        "timestamp": "2024-03-20T12:00:00Z"
    }

@pytest.mark.asyncio
async def test_process_auth_webhook(mock_webhook_data):
    with patch('app.auth.api.update_user_data') as mock_update_user:
        mock_update_user.return_value = True
        
        result = await process_auth_webhook(mock_webhook_data)
        assert result["success"] is True
        mock_update_user.assert_called_once()

@pytest.mark.asyncio
async def test_validate_webhook_signature():
    mock_signature = "test_signature"
    mock_body = b'{"test": "data"}'
    
    with patch('app.auth.api.Config') as MockConfig:
        MockConfig.WEBHOOK_SECRET = "test_secret"
        result = validate_webhook_signature(mock_signature, mock_body)
        assert isinstance(result, bool)

@pytest.mark.asyncio
async def test_handle_webhook():
    mock_request = Mock()
    mock_request.headers = {"X-Webhook-Signature": "test_signature"}
    mock_request.get_data.return_value = b'{"test": "data"}'
    
    with patch('app.auth.api.validate_webhook_signature') as mock_validate, \
         patch('app.auth.api.process_auth_webhook') as mock_process:
        mock_validate.return_value = True
        mock_process.return_value = {"success": True}
        
        result = await handle_webhook(mock_request)
        assert result["success"] is True 

@pytest.mark.asyncio
async def test_webhook_notification_success(mock_webhook_data):
    with patch('app.auth.api.requests.post') as mock_post, \
         patch.object(Config, 'WEBHOOK_URL', 'http://test.com'), \
         patch.object(Config, 'WEBHOOK_SECRET', 'test-secret'), \
         patch.object(Config, 'WEBHOOK_ACTIVE', True):
        
        mock_post.return_value.status_code = 200
        mock_post.return_value.raise_for_status.return_value = None
        
        # Extract just the event type without the full webhook data
        result = await webhook_notification(
            event_type="user.created",  # Use the string directly instead of the full webhook data
            username=mock_webhook_data["data"]["username"],
            email=mock_webhook_data["data"]["email"],
            organization=mock_webhook_data["data"]["organization"]
        )
        
        assert result["success"] is True
        mock_post.assert_called_once()
        
        # Verify the payload format
        call_args = mock_post.call_args
        assert call_args is not None
        _, kwargs = call_args
        payload = kwargs['json']
        assert payload["event_type"] == "user.created"
        assert payload["username"] == mock_webhook_data["data"]["username"]

@pytest.mark.asyncio
async def test_webhook_notification_invalid_data():
    with patch('app.auth.api.requests.post') as mock_post:
        mock_post.return_value.status_code = 400
        mock_post.return_value.raise_for_status.side_effect = requests.HTTPError()
        
        result = await webhook_notification(
            event_type="invalid",
            username=None
        )
        assert result["success"] is False

@pytest.mark.asyncio
async def test_process_webhook_success(mock_webhook_data):
    result = await process_webhook(mock_webhook_data)
    assert result is not None

@pytest.mark.asyncio
async def test_process_webhook_invalid_data():
    invalid_data = {"event": "invalid"}
    result = await process_webhook(invalid_data)
    assert "error" in result 

@pytest.mark.asyncio
async def test_create_user():
    """Test user creation"""
    with patch('app.auth.api.requests.post') as mock_post, \
         patch('app.auth.api.reset_user_password') as mock_reset, \
         patch('app.auth.api.webhook_notification') as mock_webhook:
        
        mock_post.return_value.status_code = 201
        mock_post.return_value.json.return_value = {"pk": "123", "username": "testuser"}
        mock_reset.return_value = True
        mock_webhook.return_value = {"success": True}
        
        success, username, password, error = await create_user(
            username="testuser",
            full_name="Test User",
            email="test@example.com"
        )
        assert success is True
        assert username == "testuser"
        assert password is not None
        assert error is None 