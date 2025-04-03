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

# Removed webhook test fixtures and tests

@pytest.mark.asyncio
async def test_create_user():
    """Test user creation"""
    with patch('app.auth.api.requests.post') as mock_post, \
         patch('app.auth.api.Config') as mock_config:
        mock_post.return_value.status_code = 201
        mock_post.return_value.json.return_value = {"pk": "123"}
        mock_config.MATRIX_ENABLED = False

        result = await create_user(
            username="testuser",
            password="testpass",
            email="test@example.com",
            name="Test User"
        )

        assert result['success'] is True
        assert result['user_id'] == "123"
        assert "Welcome testuser" in result['message']

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