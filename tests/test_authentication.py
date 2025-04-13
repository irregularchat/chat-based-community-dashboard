import pytest
import os
import streamlit as st
import requests
import traceback
import logging
from unittest.mock import patch, MagicMock
import urllib.parse
from app.auth.authentication import handle_auth_callback, get_login_url, is_authenticated, logout, require_authentication
from app.utils.config import Config

# ------ Test Fixtures ------

@pytest.fixture
def mock_session_state():
    """Fixture to mock st.session_state"""
    with patch.object(st, 'session_state', {}) as mock_state:
        yield mock_state

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

# ------ Test Auth URL Generation ------

def test_get_login_url_generates_correct_url(mock_session_state, mock_config):
    """Test that get_login_url generates a properly formatted URL with correct parameters"""
    url = get_login_url()
    
    # Parse URL and query params
    parsed = urllib.parse.urlparse(url)
    query_params = urllib.parse.parse_qs(parsed.query)
    
    # Check URL structure
    assert parsed.scheme == 'https'
    assert parsed.netloc == 'sso.test.com'
    assert parsed.path == '/authorize'
    
    # Check query parameters
    assert 'client_id' in query_params
    assert query_params['client_id'][0] == 'test_client_id'
    assert 'response_type' in query_params
    assert query_params['response_type'][0] == 'code'
    assert 'scope' in query_params
    assert 'state' in query_params
    assert 'redirect_uri' in query_params
    assert query_params['redirect_uri'][0] == 'http://localhost:8503/auth/callback'
    
    # Verify state was saved to session state
    assert 'auth_state' in st.session_state
    assert st.session_state['auth_state'] == query_params['state'][0]

# ------ Test Client Authentication Methods ------

def test_client_authentication_post_method(mock_session_state, mock_requests, mock_config):
    """Test client_secret_post authentication method"""
    # Setup
    code = 'test_auth_code'
    state = 'test_state'
    st.session_state['auth_state'] = state
    st.session_state['auth_method_preference'] = 'post'
    
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
    result = handle_auth_callback(code, state)
    
    # Verify
    assert result is True
    assert mock_requests['post'].call_count == 1
    
    # Verify request to token endpoint used client_secret_post method
    call_args = mock_requests['post'].call_args[1]
    assert 'auth' not in call_args  # Should not use HTTP Basic Auth
    assert 'client_id' in call_args['data']
    assert 'client_secret' in call_args['data']
    
    # Verify tokens were stored in session state
    assert st.session_state['access_token'] == 'test_access_token'
    assert st.session_state['id_token'] == 'test_id_token'
    assert st.session_state['is_authenticated'] is True

def test_client_authentication_basic_method(mock_session_state, mock_requests, mock_config):
    """Test client_secret_basic authentication method"""
    # Setup
    code = 'test_auth_code'
    state = 'test_state'
    st.session_state['auth_state'] = state
    st.session_state['auth_method_preference'] = 'basic'
    
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
    result = handle_auth_callback(code, state)
    
    # Verify
    assert result is True
    assert mock_requests['post'].call_count == 1
    
    # Verify request to token endpoint used client_secret_basic method
    call_args = mock_requests['post'].call_args[1]
    assert 'auth' in call_args  # Should use HTTP Basic Auth
    assert 'client_id' not in call_args['data']  # Should not include credentials in body
    assert 'client_secret' not in call_args['data']
    
    # Verify tokens were stored in session state
    assert st.session_state['access_token'] == 'test_access_token'
    assert st.session_state['is_authenticated'] is True

def test_client_authentication_fallback(mock_session_state, mock_requests, mock_config):
    """Test authentication method fallback when first method fails"""
    # Setup
    code = 'test_auth_code'
    state = 'test_state'
    st.session_state['auth_state'] = state
    st.session_state['auth_method_preference'] = 'all'  # Try all methods
    
    # Mock token responses - first method fails, second succeeds
    mock_failed_response = MagicMock()
    mock_failed_response.status_code = 401
    mock_failed_response.text = '{"error":"invalid_client"}'
    
    mock_success_response = MagicMock()
    mock_success_response.status_code = 200
    mock_success_response.json.return_value = {
        'access_token': 'test_access_token',
        'id_token': 'test_id_token',
        'refresh_token': 'test_refresh_token',
        'expires_in': 3600
    }
    
    # First call fails, second call succeeds
    mock_requests['post'].side_effect = [mock_failed_response, mock_success_response]
    
    # Mock userinfo response
    mock_userinfo_response = MagicMock()
    mock_userinfo_response.status_code = 200
    mock_userinfo_response.json.return_value = {
        'preferred_username': 'testuser',
        'email': 'test@example.com'
    }
    mock_requests['get'].return_value = mock_userinfo_response
    
    # Execute
    result = handle_auth_callback(code, state)
    
    # Verify
    assert result is True
    assert mock_requests['post'].call_count == 2  # Should try twice
    
    # Verify successful method was stored
    assert st.session_state['successful_auth_method'] in ['post', 'basic', 'none']
    assert st.session_state['is_authenticated'] is True

# ------ Test Redirect URI Handling ------

def test_redirect_uri_mismatch(mock_session_state, mock_requests, mock_config):
    """Test error handling for redirect URI mismatch"""
    # Setup
    code = 'test_auth_code'
    state = 'test_state'
    st.session_state['auth_state'] = state
    
    # Mock token response with redirect_uri mismatch error
    mock_token_response = MagicMock()
    mock_token_response.status_code = 400
    mock_token_response.text = '{"error":"invalid_grant","error_description":"Invalid redirect URI used by provider"}'
    mock_token_response.json.return_value = {
        'error': 'invalid_grant',
        'error_description': 'Invalid redirect URI used by provider'
    }
    
    # All authentication methods fail
    mock_requests['post'].return_value = mock_token_response
    
    # Execute
    result = handle_auth_callback(code, state)
    
    # Verify
    assert result is False
    assert mock_requests['post'].call_count >= 1  # Should try at least once

# ------ Test State Parameter Validation ------

def test_state_validation_enforced(mock_session_state, mock_config):
    """Test that state validation rejects mismatched states"""
    # Setup without bypass flags
    with patch.dict(os.environ, {}, clear=True):  # Ensure no bypass env vars
        code = 'test_auth_code'
        expected_state = 'correct_state'
        received_state = 'wrong_state'
        st.session_state['auth_state'] = expected_state
        
        # Execute
        result = handle_auth_callback(code, received_state)
        
        # Verify
        assert result is False

def test_state_validation_bypass(mock_session_state, mock_requests, mock_config):
    """Test that state validation can be bypassed with environment variable"""
    # Setup with bypass flag
    with patch.dict(os.environ, {'BYPASS_STATE_CHECK': 'true'}):
        code = 'test_auth_code'
        expected_state = 'correct_state'
        received_state = 'wrong_state'
        st.session_state['auth_state'] = expected_state
        
        # Mock successful token and userinfo responses
        mock_token_response = MagicMock()
        mock_token_response.status_code = 200
        mock_token_response.json.return_value = {
            'access_token': 'test_access_token',
            'id_token': 'test_id_token',
            'expires_in': 3600
        }
        mock_requests['post'].return_value = mock_token_response
        
        mock_userinfo_response = MagicMock()
        mock_userinfo_response.status_code = 200
        mock_userinfo_response.json.return_value = {
            'preferred_username': 'testuser',
            'email': 'test@example.com'
        }
        mock_requests['get'].return_value = mock_userinfo_response
        
        # Execute
        result = handle_auth_callback(code, received_state)
        
        # Verify - should succeed despite state mismatch
        assert result is True

def test_direct_auth_mode_bypasses_state(mock_session_state, mock_requests, mock_config):
    """Test that direct auth mode bypasses state validation"""
    # Setup with direct auth flag
    with patch.dict(os.environ, {'USE_DIRECT_AUTH': 'true'}):
        code = 'test_auth_code'
        expected_state = 'correct_state'
        received_state = 'wrong_state'
        st.session_state['auth_state'] = expected_state
        
        # Mock successful token and userinfo responses
        mock_token_response = MagicMock()
        mock_token_response.status_code = 200
        mock_token_response.json.return_value = {
            'access_token': 'test_access_token',
            'id_token': 'test_id_token',
            'expires_in': 3600
        }
        mock_requests['post'].return_value = mock_token_response
        
        mock_userinfo_response = MagicMock()
        mock_userinfo_response.status_code = 200
        mock_userinfo_response.json.return_value = {
            'preferred_username': 'testuser',
            'email': 'test@example.com'
        }
        mock_requests['get'].return_value = mock_userinfo_response
        
        # Execute
        result = handle_auth_callback(code, received_state)
        
        # Verify - should succeed despite state mismatch
        assert result is True

# ------ Integration Tests ------

def test_logout_clears_session(mock_session_state):
    """Test that logout properly clears all auth-related session state"""
    # Setup authenticated session
    st.session_state['is_authenticated'] = True
    st.session_state['user_info'] = {'preferred_username': 'testuser'}
    st.session_state['access_token'] = 'test_token'
    st.session_state['auth_state'] = 'test_state'
    st.session_state['auth_method'] = 'sso'
    
    # Execute logout
    logout()
    
    # Verify all auth data was cleared
    assert 'is_authenticated' not in st.session_state
    assert 'user_info' not in st.session_state
    assert 'access_token' not in st.session_state
    assert 'auth_state' not in st.session_state
    assert 'auth_method' not in st.session_state

# Add these tests to check the query parameter auth method
def test_require_authentication_with_query_params(mock_session_state, mock_config):
    """Test that require_authentication correctly processes auth query parameters"""
    # Set up mock query_params
    mock_query_params = {
        'auth_success': 'true',
        'username': 'testuser',
        'auth_method': 'local',
        'admin': 'true'
    }
    
    # Test with query params
    with patch.object(st, 'query_params', mock_query_params):
        # Call require_authentication
        result = require_authentication()
        
        # Should be authenticated without showing login forms
        assert result is True
        assert st.session_state.get('is_authenticated') is True
        assert st.session_state.get('auth_method') == 'local'
        assert st.session_state.get('is_admin') is True
        assert st.session_state.get('permanent_auth') is True
        assert st.session_state.get('permanent_admin') is True
        assert st.session_state.get('username') == 'testuser'
        
        # Query params should be cleaned
        assert 'auth_success' not in mock_query_params

def test_require_authentication_with_query_params_non_admin(mock_session_state, mock_config):
    """Test query parameter auth with non-admin user"""
    # Set up mock query_params for non-admin
    mock_query_params = {
        'auth_success': 'true',
        'username': 'regularuser',
        'auth_method': 'local',
        'admin': 'false'
    }
    
    # Test with query params
    with patch.object(st, 'query_params', mock_query_params):
        # Call require_authentication
        result = require_authentication()
        
        # Should be authenticated but not admin
        assert result is True
        assert st.session_state.get('is_authenticated') is True
        assert st.session_state.get('auth_method') == 'local'
        assert st.session_state.get('is_admin') is False
        assert st.session_state.get('permanent_auth') is True
        assert st.session_state.get('permanent_admin') is False
        assert st.session_state.get('username') == 'regularuser'
        
        # Query params should be cleaned
        assert 'auth_success' not in mock_query_params

def test_require_authentication_preserves_other_query_params(mock_session_state, mock_config):
    """Test that other query parameters are preserved during auth"""
    # Set up mock query_params
    mock_query_params = {
        'auth_success': 'true',
        'username': 'testuser',
        'auth_method': 'local',
        'admin': 'true',
        'page': 'dashboard',  # Other parameter
        'filter': 'active'    # Other parameter
    }
    
    # Test with mixed query params
    with patch.object(st, 'query_params', mock_query_params):
        # Call require_authentication
        result = require_authentication()
        
        # Should be authenticated
        assert result is True
        assert st.session_state.get('is_authenticated') is True
        
        # Auth params should be removed
        assert 'auth_success' not in mock_query_params
        assert 'username' not in mock_query_params
        assert 'auth_method' not in mock_query_params
        assert 'admin' not in mock_query_params
        
        # Other params should be preserved
        assert 'page' in mock_query_params
        assert mock_query_params['page'] == 'dashboard'
        assert 'filter' in mock_query_params
        assert mock_query_params['filter'] == 'active' 