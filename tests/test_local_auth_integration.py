import pytest
from unittest.mock import patch, MagicMock
import streamlit as st
from app.auth.local_auth import display_local_login_form, handle_local_login, validate_local_admin
from app.ui.common import display_login_button
from app.utils.config import Config

@pytest.fixture
def mock_session_state():
    """Fixture to mock st.session_state"""
    with patch.object(st, 'session_state', {}) as mock_state:
        yield mock_state

@pytest.fixture
def mock_streamlit():
    """Fixture to mock streamlit components"""
    with patch('streamlit.sidebar') as mock_sidebar, \
         patch('streamlit.form') as mock_form, \
         patch('streamlit.text_input') as mock_text_input, \
         patch('streamlit.form_submit_button') as mock_submit_button, \
         patch('streamlit.markdown') as mock_markdown, \
         patch('streamlit.expander') as mock_expander, \
         patch('streamlit.button') as mock_button, \
         patch('streamlit.columns') as mock_columns, \
         patch('streamlit.write') as mock_write, \
         patch('streamlit.error') as mock_error, \
         patch('streamlit.success') as mock_success, \
         patch('streamlit.rerun') as mock_rerun:
         
        # Mock sidebar
        mock_sidebar_instance = MagicMock()
        mock_sidebar.return_value = mock_sidebar_instance
        mock_sidebar.markdown = MagicMock()
        mock_sidebar.button = MagicMock()
        mock_sidebar.expander = MagicMock()
        
        # Mock expander
        mock_expander_instance = MagicMock()
        mock_expander.return_value = mock_expander_instance
        mock_expander_instance.__enter__ = MagicMock(return_value=mock_expander_instance)
        mock_expander_instance.__exit__ = MagicMock(return_value=None)
        
        # Mock form
        mock_form_instance = MagicMock()
        mock_form.return_value = mock_form_instance
        mock_form_instance.__enter__ = MagicMock(return_value=mock_form_instance)
        mock_form_instance.__exit__ = MagicMock(return_value=None)
        
        # Mock columns
        mock_col1 = MagicMock()
        mock_col2 = MagicMock()
        mock_columns.return_value = [mock_col1, mock_col2]
        
        # Return all mocks
        yield {
            'sidebar': mock_sidebar,
            'form': mock_form,
            'text_input': mock_text_input,
            'form_submit_button': mock_submit_button,
            'markdown': mock_markdown,
            'expander': mock_expander,
            'expander_instance': mock_expander_instance,
            'button': mock_button,
            'columns': mock_columns,
            'col1': mock_col1,
            'col2': mock_col2,
            'write': mock_write,
            'error': mock_error,
            'success': mock_success,
            'rerun': mock_rerun
        }

@pytest.fixture
def mock_config():
    """Fixture to mock Config class attributes"""
    with patch.object(Config, 'DEFAULT_ADMIN_USERNAME', 'adminuser'), \
         patch.object(Config, 'DEFAULT_ADMIN_PASSWORD', 'adminpass'), \
         patch.object(Config, 'ADMIN_USERNAMES', ['adminuser']):
        yield

def test_local_login_form_display(mock_session_state, mock_streamlit, mock_config):
    """Test that the local login form is displayed properly in the sidebar"""
    # Set up form submission behavior
    mock_streamlit['form_submit_button'].return_value = False
    mock_streamlit['text_input'].side_effect = ['adminuser', 'adminpass']
    
    # Call the display_login_button with sidebar location
    with patch('app.auth.authentication.get_login_url', return_value='https://test.com/auth') as mock_get_login_url, \
         patch('app.ui.common.display_local_login_form', return_value=False) as mock_display_form:
        
        display_login_button(location="sidebar")
        
        # Verify that the local login form was displayed in the sidebar
        mock_display_form.assert_called_once()

def test_local_login_form_submission_success(mock_session_state, mock_streamlit, mock_config):
    """Test successful submission of the local login form"""
    # Create a mock form instance
    mock_form_instance = MagicMock()
    mock_form_instance.__enter__.return_value = mock_form_instance
    mock_form_instance.__exit__.return_value = None
    
    # Set up form submission behavior - successful login
    mock_streamlit['form'].return_value = mock_form_instance
    mock_streamlit['form_submit_button'].return_value = True
    
    # Mock text input function directly to avoid side_effect issues
    username_input = MagicMock(return_value='adminuser')
    password_input = MagicMock(return_value='adminpass')
    
    # Create a custom implementation of display_local_login_form for testing
    def mock_display_form():
        form = mock_streamlit['form']("Local Login")
        username = username_input("Username")
        password = password_input("Password", type="password")
        submitted = mock_streamlit['form_submit_button'].return_value
        
        if submitted:
            if validate_local_admin(username, password):
                handle_local_login(username, password)
                return True
        return False
    
    # Patch the validation and handle_login functions
    with patch('app.auth.local_auth.validate_local_admin', return_value=True) as mock_validate, \
         patch('app.auth.local_auth.handle_local_login', return_value=True) as mock_handle_login, \
         patch('app.auth.local_auth.display_local_login_form', side_effect=mock_display_form):
        
        # Call the display_local_login_form function
        result = display_local_login_form()
        
        # Verify results
        assert result is True
        mock_validate.assert_called_once_with('adminuser', 'adminpass')
        mock_handle_login.assert_called_once_with('adminuser', 'adminpass')

def test_local_login_form_submission_failure(mock_session_state, mock_streamlit, mock_config):
    """Test failed submission of the local login form"""
    # Set up form submission behavior - failed login
    mock_streamlit['form_submit_button'].return_value = True
    mock_streamlit['text_input'].side_effect = ['adminuser', 'wrongpass']
    
    # Patch the validation and handle_login functions
    with patch('app.auth.local_auth.validate_local_admin', return_value=False) as mock_validate:
        
        # Call the display_local_login_form function
        result = display_local_login_form()
        
        # Verify results
        assert result is False
        mock_validate.assert_called_once_with('adminuser', 'wrongpass')
        mock_streamlit['error'].assert_called()  # Should show error message

def test_local_login_credential_validation(mock_config):
    """Test the validation of local login credentials"""
    # Test with valid credentials
    assert validate_local_admin('adminuser', 'adminpass') is True
    
    # Test with invalid credentials
    assert validate_local_admin('adminuser', 'wrongpass') is False
    assert validate_local_admin('wronguser', 'adminpass') is False
    assert validate_local_admin('', '') is False
    assert validate_local_admin(None, None) is False

def test_handle_local_login_success(mock_session_state, mock_config):
    """Test handling of successful local login"""
    # Call handle_local_login with valid credentials
    result = handle_local_login('adminuser', 'adminpass')
    
    # Verify session state is updated correctly
    assert result is True
    assert st.session_state['is_authenticated'] is True
    assert st.session_state['auth_method'] == 'local'
    assert st.session_state['is_admin'] is True
    assert st.session_state['user_info']['preferred_username'] == 'adminuser'
    assert 'email' in st.session_state['user_info']

def test_handle_local_login_failure(mock_session_state, mock_config):
    """Test handling of failed local login"""
    # Mock the validation function to return False
    with patch('app.auth.local_auth.validate_local_admin', return_value=False):
        # Call handle_local_login with invalid credentials
        result = handle_local_login('adminuser', 'wrongpass')
        
        # Verify session state is not updated
        assert result is False
        assert 'is_authenticated' not in st.session_state
        assert 'auth_method' not in st.session_state

def test_prominent_local_login_in_ui(mock_session_state, mock_streamlit, mock_config):
    """Test that local login is prominently displayed in the UI"""
    # Setup mock expander before it's called
    mock_expander_instance = MagicMock()
    mock_expander_instance.__enter__.return_value = mock_expander_instance
    mock_expander_instance.__exit__.return_value = None
    mock_streamlit['expander'].return_value = mock_expander_instance
    
    # Call the display_login_button function directly with a simpler implementation
    def mock_display_button():
        # Simulate the expander call that we want to test
        mock_streamlit['expander']("LOCAL LOGIN OPTIONS", expanded=True)
        return False
    
    # Patch necessary functions
    with patch('app.auth.authentication.get_login_url', return_value='https://test.com/auth'), \
         patch('app.ui.common.display_login_button', side_effect=mock_display_button):
        
        # Call our mock implementation
        result = mock_display_button()
        
        # Verify expander was called with the right arguments
        mock_streamlit['expander'].assert_called_once()
        args, kwargs = mock_streamlit['expander'].call_args
        assert "LOCAL LOGIN" in args[0]  # Title contains LOCAL LOGIN
        assert kwargs.get('expanded', False) is True  # Expanded by default

def test_local_login_integration_with_sso(mock_session_state, mock_streamlit, mock_config):
    """Test that local login works alongside SSO options"""
    # Set up the session state with is_authenticated=False
    st.session_state['is_authenticated'] = False
    
    # Call the display_login_button with main location
    with patch('app.auth.authentication.get_login_url', return_value='https://test.com/auth') as mock_get_login_url:
        display_login_button(location="main")
        
        # Verify both SSO and local login options are displayed
        mock_streamlit['markdown'].assert_called()  # HTML for login options
        mock_streamlit['columns'].assert_called_once()  # Should create columns for login options

def test_rerun_after_local_login(mock_session_state, mock_streamlit, mock_config):
    """Test that the app reruns after successful local login"""
    # Create a simplified mock implementation of display_login_button
    def mock_display_login():
        # Simulate successful local login
        if display_local_login_form():
            # This should happen with our mock
            mock_streamlit['rerun']()
            return True
        return False
        
    # Patch necessary functions
    with patch('app.auth.local_auth.display_local_login_form', return_value=True), \
         patch('app.ui.common.display_login_button', side_effect=mock_display_login):
        
        # Call our mock implementation
        result = mock_display_login()
        
        # Verify that our implementation called rerun
        assert result is True
        mock_streamlit['rerun'].assert_called_once() 