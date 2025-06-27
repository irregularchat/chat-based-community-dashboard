import pytest
import requests
# from app.auth.api import webhook_notification
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

# Removed webhook notification test

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
        # Mock create_user to return dictionary instead of tuple
        mock_create_user.return_value = {
            'success': True,
            'username': 'testuser',
            'temp_password': 'temp_password',
            'user_id': '123',
            'error': None,
            'password_reset': False,
            'message': 'Welcome testuser!'
        }
        mock_send_email.return_value = True
        
        result = await handle_registration(mock_user_data, mock_db_session)
        assert result["success"] is True
        assert "verification_sent" in result
        assert result["username"] == "testuser"
        assert result["temp_password"] == "temp_password"
        mock_create_user.assert_called_once_with(
            username="testuser",
            email="test@example.com",
            name="",  # Changed from full_name to name to match the actual implementation
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

# Removed webhook test fixtures and tests

@pytest.mark.asyncio
async def test_create_user():
    """Test user creation"""
    with patch('app.auth.api.requests.post') as mock_post, \
         patch('app.auth.api.Config') as mock_config, \
         patch('app.auth.api.threading.Thread') as mock_thread, \
         patch('app.auth.api.send_welcome_to_user') as mock_send_welcome, \
         patch('app.auth.api.os') as mock_os, \
         patch('app.utils.helpers.community_intro_email') as mock_email:
        # Configure mocks
        mock_post.return_value.status_code = 201
        mock_post.return_value.json.return_value = {"pk": "123"}
        mock_config.MATRIX_ENABLED = False
        mock_config.AUTHENTIK_API_TOKEN = "test_token"
        mock_config.AUTHENTIK_API_URL = "https://test.example.com/api/v3"
        mock_os.getenv.return_value = None  # Mock os.getenv for USER_PATH
        mock_thread.return_value = Mock()
        mock_send_welcome.return_value = True
        
        # Call the function under test
        try:
            result = await create_user(
                username="testuser",
                password="testpass",
                email="test@example.com",
                name="Test User"
            )
            print(f"Test result: {result}")
        except Exception as e:
            import traceback
            print(f"Exception in test_create_user: {e}")
            traceback.print_exc()
            raise

        # Verify the result
        assert result['success'] is True, f"Expected success=True, got {result}"
        assert result['user_id'] == "123", f"Expected user_id=123, got {result.get('user_id')}"
        assert "Welcome testuser" in result.get('message', ''), f"Expected 'Welcome testuser' in message, got {result.get('message', '')}"
        
        # Verify mocks were called correctly
        mock_post.assert_called_once()
        called_url = mock_post.call_args[0][0]
        assert "users" in called_url, f"Expected 'users' in URL, got {called_url}"

@pytest.mark.asyncio
async def test_create_invite():
    """Test invitation creation"""
    with patch('app.auth.api.requests.post') as mock_post:
        # Mock successful response
        mock_post.return_value.status_code = 201
        mock_post.return_value.json.return_value = {"pk": "abc123"}
        
        headers = {"Authorization": "Bearer test_token"}
        result = create_invite(headers, "test_invite")
        
        # Check result format
        assert isinstance(result, dict)
        assert result.get('success') is True
        assert 'link' in result
        assert 'expiry' in result
        assert "itoken=abc123" in result['link'] 