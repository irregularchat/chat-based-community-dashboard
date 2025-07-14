import pytest
from unittest.mock import patch, MagicMock
import streamlit as st
from app.auth.callback import auth_callback
from app.auth.authentication import handle_auth_callback
import os

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

@pytest.fixture
def test_mode():
    """Set test mode environment variable"""
    with patch.dict(os.environ, {'TEST_MODE': 'true'}):
        yield

@pytest.fixture
def mock_config():
    """Mock the Config class"""
    with patch('app.auth.authentication.Config') as mock:
        mock.OIDC_TOKEN_ENDPOINT = "https://example.com/token"
        mock.OIDC_USERINFO_ENDPOINT = "https://example.com/userinfo"
        mock.OIDC_CLIENT_ID = "test_client_id"
        mock.OIDC_CLIENT_SECRET = "test_client_secret"
        mock.OIDC_REDIRECT_URI = "https://example.com/callback"
        yield mock

def test_auth_callback(mock_session_state, mock_query_params, test_mode, mock_config):
    """Test auth callback handler"""
    # Set up session state for callback validation
    mock_session_state['auth_state'] = 'test_state'
    
    # Mock the handle_auth_callback function
    with patch('app.auth.callback.handle_auth_callback', return_value=True) as mock_handler, \
         patch('streamlit.success') as mock_success, \
         patch('streamlit.rerun') as mock_rerun:
        
        # Execute the callback function
        result = auth_callback()
        
        # Verify the auth handler was called with the right parameters
        mock_handler.assert_called_once_with('test_auth_code', 'test_state')
        
        # Verify success message was displayed
        mock_success.assert_called_once()
        
        # Verify page was rerun
        mock_rerun.assert_called_once()
        
        # Verify return value
        assert result is True

def test_auth_callback_failure(mock_session_state, mock_query_params, test_mode, mock_config):
    """Test auth callback failure handling"""
    # Set up session state for callback validation
    mock_session_state['auth_state'] = 'test_state'
    
    # Mock the handle_auth_callback function to return False (failure)
    with patch('app.auth.callback.handle_auth_callback', return_value=False) as mock_handler, \
         patch('streamlit.error') as mock_error:
        
        # Execute the callback function
        result = auth_callback()
        
        # Verify the auth handler was called
        mock_handler.assert_called_once_with('test_auth_code', 'test_state')
        
        # Verify error message was displayed
        mock_error.assert_called_once()
        
        # Verify return value
        assert result is False

def test_handle_auth_callback_invalid_state(mock_session_state, mock_config):
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
def test_handle_auth_callback_api_errors(mock_session_state, token_status, userinfo_status, mock_config):
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
        
        # Set up the mock responses
        mock_post.return_value = mock_token_response
        mock_get.return_value = mock_userinfo_response
        
        # Call the handler
        result = handle_auth_callback('test_code', 'test_state')
        
        # Verify the result
        assert result is False
        
        # Verify the requests were made
        mock_post.assert_called_once()
        if token_status == 200:
            mock_get.assert_called_once()
        else:
            mock_get.assert_not_called()

def test_handle_auth_callback_success(mock_session_state, mock_config):
    """Test successful auth callback handling"""
    # Set up session state
    mock_session_state['auth_state'] = 'test_state'
    
    # Mock the requests calls
    with patch('app.auth.authentication.requests.post') as mock_post, \
         patch('app.auth.authentication.requests.get') as mock_get:
        
        # Set up successful responses
        mock_token_response = MagicMock()
        mock_token_response.status_code = 200
        mock_token_response.json.return_value = {'access_token': 'test_token'}
        
        mock_userinfo_response = MagicMock()
        mock_userinfo_response.status_code = 200
        mock_userinfo_response.json.return_value = {
            'preferred_username': 'test_user',
            'email': 'test@example.com',
            'name': 'Test User'
        }
        
        # Set up the mock responses
        mock_post.return_value = mock_token_response
        mock_get.return_value = mock_userinfo_response
        
        # Call the handler
        result = handle_auth_callback('test_code', 'test_state')
        
        # Verify the result
        assert result is True
        
        # Verify the requests were made
        mock_post.assert_called_once()
        mock_get.assert_called_once()
        
        # Verify session state was updated
        assert 'user_info' in mock_session_state
        assert 'access_token' in mock_session_state
        assert mock_session_state['user_info']['preferred_username'] == 'test_user' 