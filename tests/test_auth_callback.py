import pytest
from unittest.mock import patch, MagicMock
import streamlit as st
from app.auth.callback import auth_callback
from app.auth.authentication import handle_auth_callback

@pytest.fixture
def mock_session_state():
    """Mock session state for testing"""
    with patch('streamlit.session_state', {}) as mock_state:
        yield mock_state

@pytest.fixture
def mock_query_params():
    """Mock query parameters for auth callback"""
    with patch('streamlit.query_params', {'code': 'test_auth_code', 'state': 'test_state'}) as mock_params:
        yield mock_params

def test_auth_callback(mock_session_state, mock_query_params):
    """Test auth callback handler"""
    # Set up session state for callback validation
    mock_session_state['auth_state'] = 'test_state'
    
    # Mock the handle_auth_callback function
    with patch('app.auth.callback.handle_auth_callback', return_value=True) as mock_handler, \
         patch('streamlit.success') as mock_success, \
         patch('streamlit.rerun') as mock_rerun:
        
        # Execute the callback function
        auth_callback()
        
        # Verify the auth handler was called with the right parameters
        mock_handler.assert_called_once_with('test_auth_code', 'test_state')
        
        # Verify success message was displayed
        mock_success.assert_called_once()
        
        # Verify page was rerun
        mock_rerun.assert_called_once()

def test_auth_callback_failure(mock_session_state, mock_query_params):
    """Test auth callback failure handling"""
    # Set up session state for callback validation
    mock_session_state['auth_state'] = 'test_state'
    
    # Mock the handle_auth_callback function to return False (failure)
    with patch('app.auth.callback.handle_auth_callback', return_value=False) as mock_handler, \
         patch('streamlit.error') as mock_error:
        
        # Execute the callback function
        auth_callback()
        
        # Verify the auth handler was called
        mock_handler.assert_called_once_with('test_auth_code', 'test_state')
        
        # Verify error message was displayed
        mock_error.assert_called_once()

def test_handle_auth_callback_invalid_state(mock_session_state):
    """Test handling auth callback with invalid state parameter"""
    # Set up different state in session vs. callback
    mock_session_state['auth_state'] = 'expected_state'
    
    # Call the handler directly
    result = handle_auth_callback('test_code', 'invalid_state')
    
    # Verify the result
    assert result is False

@pytest.mark.parametrize("token_status,userinfo_status", [
    (400, 200),  # Token endpoint failure
    (200, 400),  # UserInfo endpoint failure
])
def test_handle_auth_callback_api_errors(mock_session_state, token_status, userinfo_status):
    """Test handling auth callback with various API errors"""
    # Set up session state
    mock_session_state['auth_state'] = 'test_state'
    
    # Mock the requests calls
    with patch('app.auth.authentication.requests.post') as mock_post, \
         patch('app.auth.authentication.requests.get') as mock_get, \
         patch('app.auth.authentication.logging') as mock_logging:
        
        # Set up token response
        mock_token_response = MagicMock()
        mock_token_response.status_code = token_status
        if token_status == 200:
            mock_token_response.json.return_value = {'access_token': 'test_token'}
        else:
            mock_token_response.text = "Error response"
        
        # Set up userinfo response
        mock_userinfo_response = MagicMock()
        mock_userinfo_response.status_code = userinfo_status
        if userinfo_status == 200:
            mock_userinfo_response.json.return_value = {
                'preferred_username': 'test_user',
                'email': 'test@example.com',
                'name': 'Test User'
            }
        else:
            mock_userinfo_response.text = "Error response"
        
        # Configure mocks
        mock_post.return_value = mock_token_response
        mock_get.return_value = mock_userinfo_response
        
        # Set up Config mock
        with patch('app.auth.authentication.Config') as mock_config, \
             patch('app.auth.admin.check_admin_permission', return_value=False):
            mock_config.OIDC_TOKEN_ENDPOINT = "https://example.com/token"
            mock_config.OIDC_USERINFO_ENDPOINT = "https://example.com/userinfo"
            mock_config.OIDC_CLIENT_ID = "test_client_id"
            mock_config.OIDC_CLIENT_SECRET = "test_client_secret"
            mock_config.OIDC_REDIRECT_URI = "https://example.com/callback"
            
            # Call the function
            result = handle_auth_callback('test_code', 'test_state')
            
            # Verify the result
            assert result is False
            
            # Verify logging calls
            if token_status != 200:
                mock_logging.error.assert_any_call(f"Token response error: Status {token_status}")
            elif userinfo_status != 200:
                mock_logging.error.assert_any_call(f"User info response error: Status {userinfo_status}")

def test_handle_auth_callback_success(mock_session_state):
    """Test successful authentication callback handling"""
    # Set up session state
    mock_session_state['auth_state'] = 'test_state'
    
    # Mock the requests calls
    with patch('app.auth.authentication.requests.post') as mock_post, \
         patch('app.auth.authentication.requests.get') as mock_get:
        
        # Set up token response
        mock_token_response = MagicMock()
        mock_token_response.status_code = 200
        mock_token_response.json.return_value = {'access_token': 'test_token'}
        
        # Set up userinfo response
        mock_userinfo_response = MagicMock()
        mock_userinfo_response.status_code = 200
        mock_userinfo_response.json.return_value = {
            'preferred_username': 'test_user',
            'email': 'test@example.com',
            'name': 'Test User'
        }
        
        # Configure mocks
        mock_post.return_value = mock_token_response
        mock_get.return_value = mock_userinfo_response
        
        # Set up Config mock
        with patch('app.auth.authentication.Config') as mock_config, \
             patch('app.auth.admin.check_admin_permission', return_value=True):
            mock_config.OIDC_TOKEN_ENDPOINT = "https://example.com/token"
            mock_config.OIDC_USERINFO_ENDPOINT = "https://example.com/userinfo"
            mock_config.OIDC_CLIENT_ID = "test_client_id"
            mock_config.OIDC_CLIENT_SECRET = "test_client_secret"
            mock_config.OIDC_REDIRECT_URI = "https://example.com/callback"
            
            # Call the function
            result = handle_auth_callback('test_code', 'test_state')
            
            # Verify the result
            assert result is True
            
            # Verify session state
            assert mock_session_state['is_authenticated'] is True
            assert mock_session_state['auth_method'] == 'sso'
            assert mock_session_state['is_admin'] is True
            assert 'access_token' in mock_session_state
            assert 'session_start_time' in mock_session_state
            assert mock_session_state['user_info'] == {
                'preferred_username': 'test_user',
                'email': 'test@example.com',
                'name': 'Test User'
            } 