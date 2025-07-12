import pytest
from unittest.mock import patch, MagicMock
import streamlit as st
from app.auth.authentication import require_authentication, is_authenticated, logout
from app.auth.local_auth import handle_local_login, is_local_admin
from app.ui.common import display_login_button, display_useful_links


@pytest.fixture
def mock_session_state():
    """Fixture to mock st.session_state"""
    with patch.object(st, 'session_state', {}) as mock_state:
        yield mock_state


@pytest.fixture
def mock_streamlit():
    """Fixture to mock streamlit components"""
    with patch('streamlit.tabs') as mock_tabs, \
         patch('streamlit.warning') as mock_warning, \
         patch('streamlit.markdown') as mock_markdown, \
         patch('streamlit.sidebar') as mock_sidebar, \
         patch('streamlit.rerun') as mock_rerun, \
         patch('streamlit.button') as mock_button, \
         patch('streamlit.columns') as mock_columns:
        
        # Mock tabs
        tab1 = MagicMock()
        tab2 = MagicMock()
        mock_tabs.return_value = [tab1, tab2]
        
        # Mock columns
        col1 = MagicMock()
        col2 = MagicMock()
        mock_columns.return_value = [col1, col2]
        
        yield {
            'tabs': mock_tabs,
            'tab1': tab1,
            'tab2': tab2,
            'warning': mock_warning,
            'markdown': mock_markdown,
            'sidebar': mock_sidebar,
            'rerun': mock_rerun,
            'button': mock_button,
            'columns': mock_columns,
            'col1': col1,
            'col2': col2
        }


def test_require_authentication_displays_both_login_options(mock_session_state, mock_streamlit):
    """Test that require_authentication displays both SSO and local login options"""
    # Set up not authenticated state
    with patch('app.auth.authentication.is_authenticated', return_value=False), \
         patch('app.auth.authentication.get_login_url', return_value='https://test.com/auth'), \
         patch('app.auth.local_auth.display_local_login_form', return_value=False) as mock_display_form:
        
        # Call require_authentication
        result = require_authentication()
        
        # Verify result is False (not authenticated)
        assert result is False
        
        # Verify both login options are displayed
        mock_streamlit['tabs'].assert_called_once_with(["Login with SSO", "Local Admin Login"])
        mock_display_form.assert_called_once()


def test_require_authentication_fallback_for_tests(mock_session_state, mock_streamlit):
    """Test that require_authentication has a fallback for test environments"""
    # Set up not authenticated state and make tabs raise ValueError (simulating test environment)
    mock_streamlit['tabs'].side_effect = ValueError("Tabs not supported in this context")
    
    with patch('app.auth.authentication.is_authenticated', return_value=False), \
         patch('app.auth.authentication.get_login_url', return_value='https://test.com/auth'), \
         patch('app.auth.local_auth.display_local_login_form', return_value=False) as mock_display_form:
        
        # Call require_authentication
        result = require_authentication()
        
        # Verify result is False (not authenticated)
        assert result is False
        
        # Verify fallback displays both login options without tabs
        mock_streamlit['markdown'].assert_any_call("### Login with SSO")
        mock_streamlit['markdown'].assert_any_call("### Local Admin Login")
        mock_display_form.assert_called_once()


def test_successful_local_login_in_require_authentication(mock_session_state, mock_streamlit):
    """Test successful local login through require_authentication"""
    # Set up not authenticated state
    with patch('app.auth.authentication.is_authenticated', return_value=False), \
         patch('app.auth.authentication.get_login_url', return_value='https://test.com/auth'), \
         patch('app.auth.local_auth.display_local_login_form', return_value=True) as mock_display_form:
        
        # Call require_authentication
        result = require_authentication()
        
        # Verify rerun is called after successful login
        mock_streamlit['rerun'].assert_called_once()


def test_display_login_button_shows_both_options(mock_session_state, mock_streamlit):
    """Test that display_login_button shows both SSO and local login options"""
    with patch('app.auth.authentication.get_login_url', return_value='https://test.com/auth'), \
         patch('app.ui.common.display_local_login_form', return_value=False) as mock_display_form:
        
        # Call display_login_button with sidebar location
        display_login_button(location="sidebar")
        
        # Verify local login option is displayed
        mock_streamlit['sidebar'].expander.assert_any_call("**LOCAL LOGIN**", expanded=True)
        
        # Verify SSO login button is displayed
        mock_streamlit['sidebar'].button.assert_any_call("Login with Authentik SSO")


def test_display_useful_links_with_local_admin(mock_session_state, mock_streamlit):
    """Test that display_useful_links correctly handles local admin users"""
    # Set up authenticated state as local admin
    mock_session_state['is_authenticated'] = True
    mock_session_state['auth_method'] = 'local'
    mock_session_state['user_info'] = {
        'preferred_username': 'admin',
        'name': 'Local Administrator'
    }
    
    with patch('app.auth.authentication.is_authenticated', return_value=True), \
         patch('app.auth.authentication.get_current_user', return_value=mock_session_state['user_info']):
        
        # Call display_useful_links
        display_useful_links()
        
        # Verify local admin is displayed correctly
        mock_streamlit['sidebar'].success.assert_called_with("Logged in as: admin (Local Admin)")


def test_logout_with_different_auth_methods(mock_session_state, mock_streamlit):
    """Test that logout works correctly for both SSO and local admin users"""
    # Test logout for SSO user
    mock_session_state['is_authenticated'] = True
    mock_session_state['auth_method'] = 'sso'
    mock_session_state['user_info'] = {'preferred_username': 'ssouser'}
    mock_session_state['access_token'] = 'token123'
    
    with patch('app.auth.authentication.get_logout_url', return_value='https://test.com/logout'):
        # Call logout through the sidebar button handler
        with patch('app.auth.authentication.logout') as mock_logout:
            # Simulate clicking logout button
            mock_streamlit['sidebar'].button.return_value = True
            display_useful_links()
            
            # Verify logout was called
            mock_logout.assert_called_once()
            
            # Verify redirect to SSO logout URL
            mock_streamlit['markdown'].assert_called_with(
                '<meta http-equiv="refresh" content="0;URL=\'https://test.com/logout\'">', 
                unsafe_allow_html=True
            )
    
    # Test logout for local admin user
    mock_session_state.clear()
    mock_session_state['is_authenticated'] = True
    mock_session_state['auth_method'] = 'local'
    mock_session_state['user_info'] = {'preferred_username': 'admin'}
    
    # Call logout through the sidebar button handler
    with patch('app.auth.authentication.logout') as mock_logout:
        # Simulate clicking logout button
        mock_streamlit['sidebar'].button.return_value = True
        display_useful_links()
        
        # Verify logout was called
        mock_logout.assert_called_once()
        
        # Verify no redirect for local admin (just rerun)
        mock_streamlit['rerun'].assert_called_once()


def test_switching_between_auth_methods(mock_session_state, mock_streamlit):
    """Test that users can switch between authentication methods"""
    # Start with no authentication
    mock_session_state.clear()
    
    # Test local login
    with patch('app.auth.local_auth.validate_local_admin', return_value=True):
        result = handle_local_login('admin', 'password')
        assert result is True
        assert mock_session_state['is_authenticated'] is True
        assert mock_session_state['auth_method'] == 'local'
    
    # Test logout
    logout()
    assert 'is_authenticated' not in mock_session_state
    assert 'auth_method' not in mock_session_state
    
    # Test OIDC login (simulated)
    mock_session_state['is_authenticated'] = True
    mock_session_state['auth_method'] = 'sso'
    mock_session_state['user_info'] = {'preferred_username': 'oidcuser'}
    mock_session_state['access_token'] = 'token123'
    
    # Verify authentication state
    assert is_authenticated() is True
    assert not is_local_admin()  # Should not be local admin
    
    # Test logout again
    logout()
    assert 'is_authenticated' not in mock_session_state
    assert 'auth_method' not in mock_session_state
