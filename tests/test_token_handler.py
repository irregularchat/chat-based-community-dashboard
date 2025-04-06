import pytest
from unittest.mock import patch, MagicMock
import streamlit as st
from app.auth.token_handler import token_handler_page
from app.utils.config import Config
import requests

@pytest.fixture
def mock_session_state():
    """Fixture to mock st.session_state"""
    with patch.object(st, 'session_state', {}) as mock_state:
        yield mock_state

@pytest.fixture
def mock_streamlit():
    """Fixture to mock streamlit components"""
    with patch('streamlit.title') as mock_title, \
         patch('streamlit.markdown') as mock_markdown, \
         patch('streamlit.info') as mock_info, \
         patch('streamlit.error') as mock_error, \
         patch('streamlit.success') as mock_success, \
         patch('streamlit.spinner') as mock_spinner, \
         patch('streamlit.button', return_value=False) as mock_button, \
         patch('streamlit.query_params', {}) as mock_query_params, \
         patch('streamlit.radio', return_value="Restart login process") as mock_radio, \
         patch('streamlit.write') as mock_write, \
         patch('streamlit.text_input', return_value="") as mock_text_input, \
         patch('streamlit.expander') as mock_expander, \
         patch('streamlit.json') as mock_json:
        
        # Mock spinner context manager
        mock_spinner_cm = MagicMock()
        mock_spinner.return_value = mock_spinner_cm
        mock_spinner_cm.__enter__.return_value = None
        mock_spinner_cm.__exit__.return_value = None
        
        yield {
            'title': mock_title,
            'markdown': mock_markdown,
            'info': mock_info,
            'error': mock_error,
            'success': mock_success,
            'spinner': mock_spinner,
            'button': mock_button,
            'query_params': mock_query_params,
            'radio': mock_radio,
            'write': mock_write,
            'text_input': mock_text_input,
            'expander': mock_expander,
            'json': mock_json
        }

@pytest.fixture
def mock_requests():
    """Fixture to mock requests for API calls"""
    with patch('requests.post') as mock_post, patch('requests.get') as mock_get:
        yield {'post': mock_post, 'get': mock_get}

@pytest.fixture
def mock_config():
    """Fixture to mock Config class attributes"""
    with patch.object(Config, 'OIDC_CLIENT_ID', 'test_client_id'), \
         patch.object(Config, 'OIDC_CLIENT_SECRET', 'test_client_secret'), \
         patch.object(Config, 'OIDC_REDIRECT_URI', 'http://localhost:8503/auth/callback'), \
         patch.object(Config, 'OIDC_AUTHORIZATION_ENDPOINT', 'https://sso.test.com/authorize'), \
         patch.object(Config, 'OIDC_TOKEN_ENDPOINT', 'https://sso.test.com/token'), \
         patch.object(Config, 'OIDC_USERINFO_ENDPOINT', 'https://sso.test.com/userinfo'), \
         patch.object(Config, 'OIDC_SCOPES', ['openid', 'profile', 'email']), \
         patch.object(Config, 'ADMIN_USERNAMES', ['adminuser']):
        yield

def test_token_handler_page_no_code(mock_session_state, mock_streamlit, mock_config):
    """Test the token handler page when no code is provided"""
    # Set up
    mock_streamlit['query_params'] = {}
    
    # Execute
    token_handler_page()
    
    # Verify
    mock_streamlit['title'].assert_called_once()
    mock_streamlit['info'].assert_called_once()
    mock_streamlit['radio'].assert_called_once()
    # Should not attempt authentication without code
    assert 'is_authenticated' not in st.session_state

def test_token_handler_page_with_code_success(mock_session_state, mock_streamlit, mock_requests, mock_config):
    """Test the token handler page with a valid code"""
    # Set up
    mock_streamlit['query_params'] = {'code': 'test_code', 'state': 'test_state'}
    
    # Mock token response
    mock_token_response = MagicMock()
    mock_token_response.status_code = 200
    mock_token_response.json.return_value = {
        'access_token': 'test_access_token',
        'id_token': 'test_id_token',
        'refresh_token': 'test_refresh_token',
        'expires_in': 3600
    }
    mock_requests['post'].return_value = mock_token_response
    
    # Mock userinfo response
    mock_userinfo_response = MagicMock()
    mock_userinfo_response.status_code = 200
    mock_userinfo_response.json.return_value = {
        'preferred_username': 'testuser',
        'email': 'test@example.com'
    }
    mock_requests['get'].return_value = mock_userinfo_response
    
    # Execute
    token_handler_page()
    
    # Verify
    mock_streamlit['title'].assert_called_once()
    mock_streamlit['success'].assert_called_once()
    assert mock_requests['post'].call_count == 1
    assert mock_requests['get'].call_count == 1
    
    # Verify session state updated correctly
    assert st.session_state['is_authenticated'] is True
    assert st.session_state['access_token'] == 'test_access_token'
    assert st.session_state['user_info']['preferred_username'] == 'testuser'

def test_token_handler_page_with_code_failure(mock_session_state, mock_streamlit, mock_requests, mock_config):
    """Test the token handler page with an invalid code"""
    # Set up
    mock_streamlit['query_params'] = {'code': 'invalid_code', 'state': 'test_state'}
    
    # Mock token response for failure
    mock_token_response = MagicMock()
    mock_token_response.status_code = 400
    mock_token_response.text = '{"error":"invalid_grant","error_description":"Invalid authorization code"}'
    mock_token_response.json.return_value = {
        'error': 'invalid_grant',
        'error_description': 'Invalid authorization code'
    }
    mock_requests['post'].return_value = mock_token_response
    
    # Execute
    token_handler_page()
    
    # Verify
    mock_streamlit['title'].assert_called_once()
    mock_streamlit['error'].assert_called()
    assert mock_requests['post'].call_count >= 1
    assert mock_requests['get'].call_count == 0
    
    # Verify session state not updated
    assert 'is_authenticated' not in st.session_state

def test_token_handler_page_with_client_authentication_error(mock_session_state, mock_streamlit, mock_requests, mock_config):
    """Test the token handler page with a client authentication error"""
    # Set up
    mock_streamlit['query_params'] = {'code': 'test_code', 'state': 'test_state'}
    
    # Mock token response for client auth error
    mock_token_response = MagicMock()
    mock_token_response.status_code = 401
    mock_token_response.text = '{"error":"invalid_client","error_description":"Client authentication failed"}'
    mock_token_response.json.return_value = {
        'error': 'invalid_client',
        'error_description': 'Client authentication failed'
    }
    
    # First authentication method fails, second succeeds
    mock_success_response = MagicMock()
    mock_success_response.status_code = 200
    mock_success_response.json.return_value = {
        'access_token': 'test_access_token',
        'id_token': 'test_id_token',
        'refresh_token': 'test_refresh_token',
        'expires_in': 3600
    }
    
    # Configure mock to return failure first, then success
    mock_requests['post'].side_effect = [mock_token_response, mock_success_response]
    
    # Mock userinfo response
    mock_userinfo_response = MagicMock()
    mock_userinfo_response.status_code = 200
    mock_userinfo_response.json.return_value = {
        'preferred_username': 'testuser',
        'email': 'test@example.com'
    }
    mock_requests['get'].return_value = mock_userinfo_response
    
    # Execute
    token_handler_page()
    
    # Verify
    mock_streamlit['title'].assert_called_once()
    mock_streamlit['info'].assert_called() # Should show info about trying alternative method
    assert mock_requests['post'].call_count == 2
    assert mock_requests['get'].call_count == 1
    
    # Should succeed with the second authentication method
    assert st.session_state['is_authenticated'] is True
    assert st.session_state['access_token'] == 'test_access_token'

def test_token_handler_page_with_manual_code_entry(mock_session_state, mock_streamlit, mock_requests, mock_config):
    """Test manual code entry in the token handler page"""
    # Setup for initial page with no code, user selects "Enter code manually"
    mock_streamlit['query_params'] = {}
    mock_streamlit['radio'].return_value = "Enter code manually"
    mock_streamlit['text_input'].side_effect = ["manual_code", "manual_state"]
    
    # Mock button click for manual authentication
    with patch('streamlit.button', side_effect=[False, True]):
        # Mock rerun functionality
        with patch('streamlit.rerun'):
            # Execute with manual code page shown
            token_handler_page()
    
    # Verify manual code entry UI was displayed
    mock_streamlit['text_input'].assert_called()
    mock_streamlit['radio'].assert_called_once()
    
    # Now simulate a rerun with the new query parameters
    mock_streamlit['query_params'] = {'code': 'manual_code', 'state': 'manual_state'}
    
    # Mock token response
    mock_token_response = MagicMock()
    mock_token_response.status_code = 200
    mock_token_response.json.return_value = {
        'access_token': 'test_access_token',
        'id_token': 'test_id_token',
        'refresh_token': 'test_refresh_token',
        'expires_in': 3600
    }
    mock_requests['post'].return_value = mock_token_response
    
    # Mock userinfo response
    mock_userinfo_response = MagicMock()
    mock_userinfo_response.status_code = 200
    mock_userinfo_response.json.return_value = {
        'preferred_username': 'testuser',
        'email': 'test@example.com'
    }
    mock_requests['get'].return_value = mock_userinfo_response
    
    # Execute again with the mock query params
    token_handler_page()
    
    # Verify the token exchange process was attempted
    assert mock_requests['post'].call_count == 1
    assert mock_requests['get'].call_count == 1 