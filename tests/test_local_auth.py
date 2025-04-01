import pytest
from unittest.mock import patch, MagicMock
import streamlit as st
from app.auth.local_auth import validate_local_admin, handle_local_login, is_local_admin, display_local_login_form


def test_validate_local_admin():
    """Test the validate_local_admin function."""
    # Test with valid credentials
    with patch('app.auth.local_auth.Config') as mock_config:
        mock_config.DEFAULT_ADMIN_USERNAME = 'admin'
        mock_config.DEFAULT_ADMIN_PASSWORD = 'password'
        
        assert validate_local_admin('admin', 'password') is True
        
        # Test with invalid username
        assert validate_local_admin('wrong', 'password') is False
        
        # Test with invalid password
        assert validate_local_admin('admin', 'wrong') is False
        
        # Test with empty credentials
        assert validate_local_admin('', '') is False
        assert validate_local_admin(None, 'password') is False
        assert validate_local_admin('admin', None) is False


def test_handle_local_login():
    """Test the handle_local_login function."""
    # Mock session state
    with patch('streamlit.session_state', {}), \
         patch('app.auth.local_auth.validate_local_admin', return_value=True):
        
        # Test successful login
        assert handle_local_login('admin', 'password') is True
        
        # Check session state was updated correctly
        assert st.session_state['is_authenticated'] is True
        assert st.session_state['auth_method'] == 'local'
        assert 'session_start_time' in st.session_state
        assert st.session_state['is_admin'] is True
        assert st.session_state['user_info']['preferred_username'] == 'admin'
    
    # Test failed login
    with patch('streamlit.session_state', {}), \
         patch('app.auth.local_auth.validate_local_admin', return_value=False):
        
        assert handle_local_login('wrong', 'wrong') is False
        
        # Check session state was not updated
        assert 'is_authenticated' not in st.session_state


def test_is_local_admin():
    """Test the is_local_admin function."""
    # Test when not authenticated
    with patch('streamlit.session_state', {}):
        assert is_local_admin() is False
    
    # Test when authenticated but not as local admin
    with patch('streamlit.session_state', {'is_authenticated': True, 'auth_method': 'sso'}):
        assert is_local_admin() is False
    
    # Test when authenticated as local admin
    with patch('streamlit.session_state', {'is_authenticated': True, 'auth_method': 'local'}):
        assert is_local_admin() is True


def test_display_local_login_form():
    """Test the display_local_login_form function."""
    # This is a UI function that's hard to test directly
    # We'll just mock the form submission and handle_local_login
    with patch('streamlit.form') as mock_form, \
         patch('streamlit.text_input') as mock_text_input, \
         patch('streamlit.form_submit_button') as mock_submit, \
         patch('app.auth.local_auth.handle_local_login', return_value=True) as mock_handle_login:
        
        # Mock form context manager
        mock_form_cm = MagicMock()
        mock_form.return_value = mock_form_cm
        mock_form_cm.__enter__.return_value = None
        
        # Mock form inputs
        mock_text_input.side_effect = ['admin', 'password']
        
        # Mock form submission
        mock_submit.return_value = True
        
        # Call the function
        result = display_local_login_form()
        
        # Check the result
        assert result is True
        mock_handle_login.assert_called_once_with('admin', 'password')
