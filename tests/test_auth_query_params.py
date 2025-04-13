import pytest
from unittest.mock import patch, MagicMock
import streamlit as st
import time
from app.utils.config import Config
from app.auth.authentication import require_authentication, is_authenticated
from app.auth.local_auth import handle_local_login, display_local_login_form

@pytest.fixture
def mock_session_state():
    """Fixture to mock st.session_state"""
    with patch.object(st, 'session_state', {}) as mock_state:
        yield mock_state

@pytest.fixture
def mock_query_params():
    """Fixture to mock st.query_params"""
    mock_params = {}
    with patch.object(st, 'query_params', mock_params) as mock_qp:
        yield mock_qp

@pytest.fixture
def mock_streamlit():
    """Fixture to mock streamlit components"""
    with patch('streamlit.markdown') as mock_markdown, \
         patch('streamlit.success') as mock_success, \
         patch('streamlit.info') as mock_info, \
         patch('streamlit.error') as mock_error, \
         patch('streamlit.rerun') as mock_rerun, \
         patch('streamlit.form') as mock_form, \
         patch('streamlit.form_submit_button') as mock_form_submit, \
         patch('streamlit.text_input') as mock_text_input, \
         patch('streamlit.columns') as mock_columns, \
         patch('streamlit.tabs') as mock_tabs, \
         patch('streamlit.warning') as mock_warning:
        
        # Mock form context manager
        mock_form_cm = MagicMock()
        mock_form.return_value = mock_form_cm
        mock_form_cm.__enter__ = MagicMock(return_value=mock_form_cm)
        mock_form_cm.__exit__ = MagicMock(return_value=None)
        
        # Mock tabs
        tab1 = MagicMock()
        tab2 = MagicMock()
        mock_tabs.return_value = [tab1, tab2]
        
        # Mock columns
        col1 = MagicMock()
        col2 = MagicMock()
        mock_columns.return_value = [col1, col2]
        
        yield {
            'markdown': mock_markdown,
            'success': mock_success,
            'info': mock_info,
            'error': mock_error,
            'rerun': mock_rerun,
            'form': mock_form,
            'form_cm': mock_form_cm,
            'form_submit': mock_form_submit,
            'text_input': mock_text_input,
            'columns': mock_columns,
            'tabs': mock_tabs,
            'tab1': tab1,
            'tab2': tab2,
            'col1': col1,
            'col2': col2,
            'warning': mock_warning
        }

@pytest.fixture
def mock_config():
    """Fixture to mock Config class attributes"""
    with patch.object(Config, 'DEFAULT_ADMIN_USERNAME', 'admin'), \
         patch.object(Config, 'DEFAULT_ADMIN_PASSWORD', 'adminpass'), \
         patch.object(Config, 'ADMIN_USERNAMES', ['admin']):
        yield

def test_auth_success_query_params(mock_session_state, mock_query_params, mock_streamlit):
    """Test authentication via query parameters"""
    # Set up auth query parameters
    mock_query_params.update({
        'auth_success': 'true',
        'username': 'admin',
        'auth_method': 'local',
        'admin': 'true'
    })
    
    # Create a custom QueryParams class to spy on updates
    class QueryParamsSpy:
        def __init__(self, data):
            self.data = data.copy()
            self.update_calls = []
            
        def __getitem__(self, key):
            return self.data.get(key)
            
        def get(self, key, default=None):
            return self.data.get(key, default)
            
        def update(self, other_dict):
            self.update_calls.append(other_dict)
            self.data.update(other_dict)
            
        def items(self):
            return self.data.items()
    
    # Create spy object
    query_params_spy = QueryParamsSpy(mock_query_params)
    
    # Check if authentication is recognized
    with patch.object(st, 'query_params', query_params_spy):
        result = require_authentication()
        
        # Should be authenticated
        assert result is True
        assert st.session_state.get('is_authenticated') is True
        assert st.session_state.get('auth_method') == 'local'
        assert st.session_state.get('is_admin') is True
        assert st.session_state.get('permanent_auth') is True
        assert st.session_state.get('permanent_admin') is True
        assert 'username' in st.session_state
        assert 'user_info' in st.session_state
        
        # Verify query params update was called
        assert len(query_params_spy.update_calls) == 1

def test_auth_success_query_params_non_admin(mock_session_state, mock_query_params, mock_streamlit):
    """Test authentication via query parameters for non-admin user"""
    # Set up auth query parameters
    mock_query_params.update({
        'auth_success': 'true',
        'username': 'regularuser',
        'auth_method': 'local',
        'admin': 'false'
    })
    
    # Create a custom QueryParams class to spy on updates
    class QueryParamsSpy:
        def __init__(self, data):
            self.data = data.copy()
            self.update_calls = []
            
        def __getitem__(self, key):
            return self.data.get(key)
            
        def get(self, key, default=None):
            return self.data.get(key, default)
            
        def update(self, other_dict):
            self.update_calls.append(other_dict)
            self.data.update(other_dict)
            
        def items(self):
            return self.data.items()
    
    # Create spy object
    query_params_spy = QueryParamsSpy(mock_query_params)
    
    # Check if authentication is recognized
    with patch.object(st, 'query_params', query_params_spy):
        result = require_authentication()
        
        # Should be authenticated but not admin
        assert result is True
        assert st.session_state.get('is_authenticated') is True
        assert st.session_state.get('auth_method') == 'local'
        assert st.session_state.get('is_admin') is False
        assert st.session_state.get('permanent_auth') is True
        assert st.session_state.get('permanent_admin') is False
        assert st.session_state.get('username') == 'regularuser'
        
        # Verify query params update was called
        assert len(query_params_spy.update_calls) == 1

def test_auth_params_from_local_login_redirect(mock_session_state, mock_streamlit, mock_config):
    """Test that local login redirects with correct auth parameters"""
    # Prepare form submission
    mock_streamlit['text_input'].side_effect = ['admin', 'adminpass']
    mock_streamlit['form_submit'].return_value = True
    
    # Execute the local login form
    with patch('app.auth.local_auth.handle_local_login', side_effect=handle_local_login) as mock_handle_login:
        result = display_local_login_form()
        
        # Should return True for successful login
        assert result is True
        
        # Should call handle_local_login with correct credentials
        mock_handle_login.assert_called_once_with('admin', 'adminpass')
        
        # Should show success message
        mock_streamlit['success'].assert_called_once()
        
        # Should set up redirect with auth parameters
        mock_streamlit['markdown'].assert_called_with(
            f'<meta http-equiv="refresh" content="1;URL=\'/?auth_success=true&auth_method=local&username=admin&admin=true\'">', 
            unsafe_allow_html=True
        )

def test_main_function_detects_auth_params(mock_session_state, mock_query_params, mock_streamlit):
    """Test that the main function correctly detects auth parameters"""
    # Set up auth query parameters
    mock_query_params.update({
        'auth_success': 'true',
        'username': 'admin',
        'auth_method': 'local',
        'admin': 'true'
    })
    
    # Import the main function
    with patch('app.main.init_db') as mock_init_db, \
         patch('app.main.initialize_session_state') as mock_init_session, \
         patch('app.main.setup_page_config') as mock_setup_config, \
         patch('app.main.time.time', return_value=12345.0):
        
        from app.main import main
        
        # Call the main function
        import asyncio
        asyncio.run(main())
        
        # Check if session state was updated correctly
        assert st.session_state.get('is_authenticated') is True
        assert st.session_state.get('auth_method') == 'local'
        assert st.session_state.get('is_admin') is True
        assert st.session_state.get('username') == 'admin'
        assert st.session_state.get('permanent_auth') is True
        assert st.session_state.get('permanent_admin') is True
        assert st.session_state.get('auth_timestamp') == 12345.0
        
        # Query params should be cleaned but other functions still called
        mock_init_db.assert_called_once()
        mock_init_session.assert_called_once()
        mock_setup_config.assert_called_once()

def test_render_main_content_auth_params(mock_session_state, mock_query_params, mock_streamlit):
    """Test that render_main_content handles auth parameters correctly"""
    # Set up auth query parameters
    mock_query_params.update({
        'auth_success': 'true',
        'username': 'admin',
        'auth_method': 'local',
        'admin': 'true'
    })
    
    # Import the render_main_content function
    with patch('app.main.time.time', return_value=12345.0), \
         patch('app.main.time.sleep') as mock_sleep, \
         patch('app.main.logging') as mock_logging:
        
        from app.main import render_main_content
        
        # Call the function
        import asyncio
        asyncio.run(render_main_content())
        
        # Check session state
        assert st.session_state.get('is_authenticated') is True
        assert st.session_state.get('is_admin') is True
        
        # Should show welcome message
        mock_streamlit['success'].assert_called_once()
        assert 'Welcome' in mock_streamlit['success'].call_args[0][0]
        
        # Should log the successful login
        mock_logging.info.assert_any_call(
            f"Login success page: user=admin, admin=True, method=local"
        )
        
        # Should redirect to admin dashboard
        assert st.session_state.get('current_page') == 'Admin Dashboard'
        mock_streamlit['rerun'].assert_called_once()

def test_permanent_flag_persistence(mock_session_state, mock_streamlit):
    """Test persistence mechanism with permanent flags"""
    # Setup session with permanent flags but not authenticated
    st.session_state['permanent_auth'] = True
    st.session_state['permanent_admin'] = True
    st.session_state['username'] = 'admin'
    
    # Not authenticated yet
    assert 'is_authenticated' not in st.session_state
    
    # Import the main function
    with patch('app.main.init_db') as mock_init_db, \
         patch('app.main.initialize_session_state') as mock_init_session, \
         patch('app.main.setup_page_config') as mock_setup_config, \
         patch('app.main.logging') as mock_logging:
        
        from app.main import main
        
        # Call the main function
        import asyncio
        asyncio.run(main())
        
        # Check if authentication state was restored
        assert st.session_state.get('is_authenticated') is True
        assert st.session_state.get('is_admin') is True
        
        # Should log the restoration
        mock_logging.info.assert_any_call("Restoring authentication state from permanent flag")
        mock_logging.info.assert_any_call("Restoring admin status from permanent flag")

def test_full_local_login_flow(mock_session_state, mock_query_params, mock_streamlit, mock_config):
    """Test the complete local login flow with redirects"""
    # Setup form inputs
    mock_streamlit['text_input'].side_effect = ['admin', 'adminpass']
    mock_streamlit['form_submit'].return_value = True
    
    # Not authenticated yet
    assert 'is_authenticated' not in st.session_state
    
    # First step: local login
    with patch('app.auth.local_auth.time.sleep') as mock_sleep:
        result = display_local_login_form()
        
        # Should be successful
        assert result is True
        assert st.session_state.get('is_authenticated') is True
        assert st.session_state.get('auth_method') == 'local'
        assert st.session_state.get('is_admin') is True
        
        # Should redirect with auth params
        assert mock_streamlit['markdown'].called
        redirect_call = mock_streamlit['markdown'].call_args[0][0]
        assert 'auth_success=true' in redirect_call
        assert 'auth_method=local' in redirect_call
        assert 'username=admin' in redirect_call
        assert 'admin=true' in redirect_call
    
    # Reset session for second part of test
    st.session_state.clear()
    mock_streamlit['markdown'].reset_mock()
    mock_streamlit['success'].reset_mock()  # Reset success calls
    
    # Second step: process auth params in the main content handler
    mock_query_params.update({
        'auth_success': 'true',
        'username': 'admin',
        'auth_method': 'local',
        'admin': 'true'
    })
    
    # Test main content handling the redirect
    with patch('app.main.time.sleep') as mock_sleep, \
         patch('app.main.time.time', return_value=12345.0), \
         patch('app.main.logging') as mock_logging:
        
        from app.main import render_main_content
        
        # Call the function
        import asyncio
        asyncio.run(render_main_content())
        
        # Check session state
        assert st.session_state.get('is_authenticated') is True
        assert st.session_state.get('is_admin') is True
        assert st.session_state.get('auth_method') == 'local'
        assert st.session_state.get('username') == 'admin'
        
        # Should show welcome message
        assert mock_streamlit['success'].called
        welcome_msg = mock_streamlit['success'].call_args[0][0]
        assert 'Welcome' in welcome_msg
        
        # Should redirect to admin dashboard
        assert st.session_state.get('current_page') == 'Admin Dashboard'
        mock_streamlit['rerun'].assert_called_once()
        
    # All query params should be cleared
    assert 'auth_success' not in mock_query_params 

def test_require_authentication_preserves_other_query_params(mock_session_state, mock_config):
    """Test that other query parameters are preserved during auth"""
    # Set up mock query_params
    params_data = {
        'auth_success': 'true',
        'username': 'testuser',
        'auth_method': 'local',
        'admin': 'true',
        'page': 'dashboard',  # Other parameter
        'filter': 'active'    # Other parameter
    }
    
    # Create a custom QueryParams class to spy on updates
    class QueryParamsSpy:
        def __init__(self, data):
            self.data = data.copy()
            self.update_calls = []
            
        def __getitem__(self, key):
            return self.data.get(key)
            
        def get(self, key, default=None):
            return self.data.get(key, default)
            
        def update(self, other_dict):
            self.update_calls.append(other_dict)
            self.data.update(other_dict)
            
        def items(self):
            return self.data.items()
    
    # Create spy object
    query_params_spy = QueryParamsSpy(params_data)
    
    # Test with query params spy
    with patch.object(st, 'query_params', query_params_spy):
        # Call require_authentication
        result = require_authentication()
        
        # Should be authenticated
        assert result is True
        assert st.session_state.get('is_authenticated') is True
        
        # Verify update was called with only the non-auth params
        assert len(query_params_spy.update_calls) == 1
        update_dict = query_params_spy.update_calls[0]
        
        # Non-auth params should be preserved
        assert 'page' in update_dict
        assert update_dict['page'] == 'dashboard'
        assert 'filter' in update_dict
        assert update_dict['filter'] == 'active'
        
        # Auth params should not be in the update
        assert 'auth_success' not in update_dict
        assert 'username' not in update_dict
        assert 'auth_method' not in update_dict
        assert 'admin' not in update_dict 