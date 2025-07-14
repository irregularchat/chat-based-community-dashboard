import pytest
from unittest.mock import patch, MagicMock
import streamlit as st
from app.auth.auth_middleware import auth_middleware, admin_middleware
from app.auth.local_auth import is_local_admin


@pytest.fixture
def mock_session_state():
    """Fixture to mock st.session_state"""
    with patch.object(st, 'session_state', {}) as mock_state:
        yield mock_state


@pytest.fixture
def mock_streamlit():
    """Fixture to mock streamlit components"""
    with patch('streamlit.markdown') as mock_markdown, \
         patch('streamlit.error') as mock_error, \
         patch('streamlit.info') as mock_info:
        yield {
            'markdown': mock_markdown,
            'error': mock_error,
            'info': mock_info
        }


def test_auth_middleware_with_local_login(mock_session_state, mock_streamlit):
    """Test that auth_middleware allows access for local admin users"""
    # Create a mock page function
    mock_page_function = MagicMock()
    
    # Create a wrapped function using auth_middleware
    wrapped_function = auth_middleware(mock_page_function)
    
    # Test when user is not authenticated
    with patch('app.auth.authentication.is_authenticated', return_value=False), \
         patch('app.ui.common.display_login_button'):
        wrapped_function()
        # Page function should not be called when not authenticated
        mock_page_function.assert_not_called()
    
    # Test when user is authenticated as local admin
    mock_session_state['is_authenticated'] = True
    mock_session_state['auth_method'] = 'local'
    
    with patch('app.auth.authentication.is_authenticated', return_value=True):
        wrapped_function()
        # Page function should be called when authenticated
        mock_page_function.assert_called_once()


def test_admin_middleware_with_local_login(mock_session_state, mock_streamlit):
    """Test that admin_middleware allows access for local admin users"""
    # Create a mock page function
    mock_page_function = MagicMock()
    
    # Create a wrapped function using admin_middleware
    wrapped_function = admin_middleware(mock_page_function)
    
    # Test when user is not authenticated
    with patch('app.auth.authentication.is_authenticated', return_value=False), \
         patch('app.ui.common.display_login_button'):
        wrapped_function()
        # Page function should not be called when not authenticated
        mock_page_function.assert_not_called()
    
    # Test when user is authenticated but not admin
    mock_session_state['is_authenticated'] = True
    mock_session_state['is_admin'] = False
    mock_session_state['auth_method'] = 'sso'  # Not local admin
    
    with patch('app.auth.authentication.is_authenticated', return_value=True), \
         patch('app.auth.local_auth.is_local_admin', return_value=False):
        wrapped_function()
        # Page function should not be called when not admin
        mock_page_function.assert_not_called()
        # Error message should be displayed
        mock_streamlit['error'].assert_called()
    
    # Test when user is authenticated as local admin
    mock_session_state['is_authenticated'] = True
    mock_session_state['auth_method'] = 'local'
    
    with patch('app.auth.authentication.is_authenticated', return_value=True), \
         patch('app.auth.local_auth.is_local_admin', return_value=True):
        # Reset the mock to clear previous calls
        mock_page_function.reset_mock()
        wrapped_function()
        # Page function should be called when authenticated as local admin
        mock_page_function.assert_called_once()


def test_admin_middleware_with_is_local_admin_function(mock_session_state, mock_streamlit):
    """Test that admin_middleware correctly uses is_local_admin function"""
    # Create a mock page function
    mock_page_function = MagicMock()
    
    # Create a wrapped function using admin_middleware
    wrapped_function = admin_middleware(mock_page_function)
    
    # Test when user is authenticated as local admin but is_admin is False
    # This tests that the middleware correctly uses is_local_admin() as a fallback
    mock_session_state['is_authenticated'] = True
    mock_session_state['is_admin'] = False  # Not admin in session state
    mock_session_state['auth_method'] = 'local'
    
    with patch('app.auth.authentication.is_authenticated', return_value=True), \
         patch('app.auth.local_auth.is_local_admin', return_value=True):  # But is local admin
        wrapped_function()
        # Page function should be called because is_local_admin() returns True
        mock_page_function.assert_called_once()
