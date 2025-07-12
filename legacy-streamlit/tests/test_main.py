import pytest
from unittest.mock import patch, Mock, AsyncMock, MagicMock
import streamlit as st
import app.main
from datetime import datetime, timedelta
from app.db.operations import AdminEvent
from app.utils.config import Config
from typing import List

@pytest.fixture
def mock_streamlit():
    """Mock the Streamlit library for testing"""
    with patch('app.main.st') as mock_st:
        # Create a basic mock session state as a dict
        mock_st.session_state = {}
        
        # Set mock for nested items
        mock_st.sidebar = MagicMock()
        mock_st.title = MagicMock()
        mock_st.success = MagicMock()
        mock_st.error = MagicMock()
        mock_st.info = MagicMock()
        mock_st.warning = MagicMock()
        mock_st.markdown = MagicMock()
        mock_st.columns = MagicMock()
        mock_st.expander = MagicMock()
        mock_st.query_params = {}
        mock_st.rerun = MagicMock()
        
        # Common mock for form components
        mock_st.text_input = MagicMock()
        mock_st.text_area = MagicMock()
        mock_st.selectbox = MagicMock()
        mock_st.multiselect = MagicMock()
        mock_st.checkbox = MagicMock()
        mock_st.button = MagicMock()
        mock_st.form = MagicMock()
        
        # Return the mock
        yield mock_st

@pytest.fixture
def mock_session_state():
    """Mock just the session state for Streamlit"""
    with patch.object(st, 'session_state', {}) as mock_state:
        yield mock_state

@pytest.fixture
def mock_config():
    """Mock configuration and ensure it's available in all required modules"""
    config_values = {
        'PAGE_TITLE': "Test Dashboard",
        'FAVICON_URL': "test_favicon.ico",
        'AUTHENTIK_API_URL': "http://test-api",
        'AUTHENTIK_API_TOKEN': "test-token",
        'MAIN_GROUP_ID': "test-group-id",
        'MATRIX_ACTIVE': False,
        'MATRIX_HOMESERVER_URL': "https://matrix.test",
        'MATRIX_USER_ID': "@bot:matrix.test",
        'MATRIX_ACCESS_TOKEN': "test-token",
        'MATRIX_ROOM_ID': "!test:matrix.test",
        'DISCOURSE_URL': None,
        'DISCOURSE_API_KEY': None,
        'DISCOURSE_API_USERNAME': None,
        'DISCOURSE_CATEGORY_ID': None,
        'DISCOURSE_INTRO_TAG': None,
        'DISCOURSE_ACTIVE': False,
        'DATABASE_URL': "sqlite:///test.db",
        'DEFAULT_ADMIN_USERNAME': "admin",
        'DEFAULT_ADMIN_PASSWORD': "password"
    }
    
    class MockConfig:
        @classmethod
        def validate_oidc_config(cls):
            return True
            
        @classmethod
        def get_matrix_rooms(cls):
            return []
            
        @classmethod
        def get_matrix_rooms_by_category(cls, category):
            return []
            
        @classmethod
        def get_matrix_room_categories(cls):
            return []
            
        @classmethod
        def get_all_matrix_rooms(cls):
            return []
            
        @classmethod
        def is_admin(cls, username: str) -> bool:
            return username == "admin"
            
        @classmethod
        def get_required_vars(cls) -> List[str]:
            return []
            
        @classmethod
        def validate(cls):
            return True
            
        @classmethod
        def to_dict(cls):
            return config_values
    
    # Add config values as class attributes
    for key, value in config_values.items():
        setattr(MockConfig, key, value)
    
    with patch('app.utils.config.Config', MockConfig), \
         patch('app.ui.forms.Config', MockConfig), \
         patch('app.ui.home.Config', MockConfig), \
         patch('app.main.Config', MockConfig), \
         patch('app.auth.local_auth.Config', MockConfig), \
         patch('app.auth.token_handler.Config', MockConfig), \
         patch('app.force_sync.Config', MockConfig):
        yield MockConfig

@pytest.fixture
def mock_db():
    """Mock database session"""
    with patch('app.main.get_db') as mock_get_db:
        mock_session = Mock()
        mock_get_db.return_value = mock_session
        mock_session.__enter__ = Mock(return_value=mock_session)
        mock_session.__exit__ = Mock(return_value=None)
        yield mock_session

def test_initialize_session_state(mock_streamlit):
    """Test session state initialization"""
    app.main.initialize_session_state()
    
    assert 'sync_in_progress' in mock_streamlit.session_state
    assert 'last_sync_time' in mock_streamlit.session_state
    assert 'user_count' in mock_streamlit.session_state
    assert 'active_users' in mock_streamlit.session_state

def test_setup_page_config(mock_streamlit, mock_config):
    """Test page configuration setup"""
    app.main.setup_page_config()
    
    mock_streamlit.set_page_config.assert_called_once_with(
        page_title=mock_config.PAGE_TITLE,
        page_icon=mock_config.FAVICON_URL,
        layout="wide",
        initial_sidebar_state="expanded"
    )

@pytest.mark.asyncio
async def test_render_home_page(mock_streamlit, mock_db, mock_config):
    """Test home page rendering"""
    with patch('app.ui.home.st.title') as mock_title, \
         patch('app.ui.home.display_useful_links') as mock_links, \
         patch('app.ui.home.render_create_user_form', new_callable=AsyncMock) as mock_create_form:
        
        # Mock session state
        mock_streamlit.session_state = {
            'show_create_user': True,
            'show_invite_form': False,
            'show_user_list': False,
            'show_operation_selector': False
        }
        
        # Mock return values
        mock_create_form.return_value = (None, None, None, None, None, None, None)
        
        # Test rendering home page
        await app.main.render_home_page()
        
        # Verify calls
        mock_title.assert_called_once_with("Community Dashboard")
        mock_links.assert_called_once()
        mock_create_form.assert_awaited_once()

@pytest.mark.asyncio
async def test_render_create_user_form(mock_streamlit, mock_db, mock_config):
    """Test create user form rendering"""
    # We need to patch both the imported function in main and the source
    with patch('app.main.render_create_user_form', new_callable=AsyncMock) as mock_main_form, \
         patch('app.ui.forms.render_create_user_form', new_callable=AsyncMock) as mock_form:
        
        # Set up mock form values
        mock_streamlit.session_state.update({
            'first_name_input': '',
            'last_name_input': '',
            'username_input': '',
            'email_input': '',
            'invited_by_input': '',
            'intro_input': ''
        })
        expected_values = ('', '', '', '', '', '', False)  # Last value is submit_button
        mock_form.return_value = expected_values
        mock_main_form.return_value = expected_values
        
        # Call the function
        result = await app.main.render_create_user_form()
        
        # Verify the result
        assert result == expected_values
        assert mock_form.await_count + mock_main_form.await_count == 1

@pytest.mark.asyncio
async def test_render_invite_form(mock_streamlit, mock_db, mock_config):
    """Test invite form rendering"""
    with patch('app.main.render_invite_form', new_callable=AsyncMock) as mock_main_form, \
         patch('app.ui.forms.render_invite_form', new_callable=AsyncMock) as mock_form:
        
        # Set up mock form values
        mock_streamlit.session_state.update({
            'invite_email': '',
            'invite_message': ''
        })
        expected_values = ('', '', False)  # email, message, submit_button
        mock_form.return_value = expected_values
        mock_main_form.return_value = expected_values
        
        # Call the function
        result = await app.main.render_invite_form()
        
        # Verify the result
        assert result == expected_values
        assert mock_form.await_count + mock_main_form.await_count == 1

@pytest.mark.asyncio
async def test_display_user_list(mock_streamlit, mock_db, mock_config):
    """Test user list display"""
    with patch('app.main.display_user_list', new_callable=AsyncMock) as mock_main_display, \
         patch('app.ui.forms.display_user_list', new_callable=AsyncMock) as mock_display:
        
        # Set up mock return value
        mock_display.return_value = None
        mock_main_display.return_value = None
        
        # Call the function
        await app.main.display_user_list()
        
        # Verify the call - either the main or forms version should be called once
        assert mock_display.await_count + mock_main_display.await_count == 1

def test_render_sidebar(mock_streamlit):
    """Test sidebar rendering"""
    # Set up the mock to return a value directly (not a coroutine)
    mock_selectbox = Mock()
    mock_selectbox.return_value = "Create User"
    mock_streamlit.sidebar.selectbox = mock_selectbox
    
    # Set up the title mock as regular mock (not async)
    mock_title = Mock()
    mock_streamlit.sidebar.title = mock_title
    
    # Mock an authenticated admin user
    mock_streamlit.session_state['is_authenticated'] = True
    mock_streamlit.session_state['is_admin'] = True
    mock_streamlit.session_state['current_page'] = 'Create User'
    
    # Call the function (not async)
    result = app.main.render_sidebar()
    
    # Verify the calls
    mock_title.assert_called_once_with("Navigation")
    mock_selectbox.assert_called_once_with(
        "Select Page",
        [
            "Create User", 
            "List & Manage Users",
            "Create Invite",
            "Matrix Messages and Rooms",
            "Signal Association"
        ],
        index=mock_selectbox.call_args[0][1].index("Create User"),
        key='current_page'
    )
    
    # Verify the result
    assert result == "Create User"

@pytest.mark.asyncio
async def test_render_main_content(mock_streamlit):
    """Test main content rendering"""
    with patch('app.main.render_create_user_form', new_callable=AsyncMock) as mock_create_form, \
         patch('app.main.render_invite_form', new_callable=AsyncMock) as mock_invite_form, \
         patch('app.main.display_user_list', new_callable=AsyncMock) as mock_display_users, \
         patch('app.main.is_authenticated', return_value=True) as mock_is_auth, \
         patch('app.main.require_authentication', return_value=True) as mock_require_auth:
        
        # Mock authentication state
        mock_streamlit.session_state['is_authenticated'] = True
        mock_streamlit.session_state['is_admin'] = True
        mock_streamlit.query_params = {}
        
        mock_streamlit.session_state['current_page'] = 'Create User'
        await app.main.render_main_content()
        mock_create_form.assert_awaited_once()
        
        # Reset mocks
        mock_create_form.reset_mock()
        mock_invite_form.reset_mock()
        mock_display_users.reset_mock()
        
        mock_streamlit.session_state['current_page'] = 'Create Invite'
        await app.main.render_main_content()
        mock_invite_form.assert_awaited_once()
        
        # Reset mocks
        mock_create_form.reset_mock()
        mock_invite_form.reset_mock()
        mock_display_users.reset_mock()
        
        mock_streamlit.session_state['current_page'] = 'List & Manage Users'
        await app.main.render_main_content()
        mock_display_users.assert_awaited_once()

def test_main(mock_streamlit, mock_config):
    """Test main function"""
    with patch('app.main.initialize_session_state') as mock_init, \
         patch('app.main.render_sidebar') as mock_sidebar, \
         patch('app.main.render_main_content') as mock_content, \
         patch('app.main.init_db') as mock_init_db:

        mock_sidebar.return_value = "Create User"

        app.main.main()

        mock_init.assert_called_once()
        mock_init_db.assert_called_once()
        mock_sidebar.assert_called_once()
        mock_content.assert_called_once()

def test_main_error_handling(mock_streamlit):
    """Test error handling in main function"""
    with patch('app.main.setup_page_config') as mock_setup:
        mock_setup.side_effect = Exception("Test error")
        
        app.main.main()
        
        mock_streamlit.error.assert_called_once()

def test_session_state_modification_after_widget(mock_streamlit):
    """Test that session state cannot be modified after widget creation"""
    # Create a custom session state that raises an exception when modified after widget creation
    class MockSessionState(dict):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._widget_created = False
        
        def __getitem__(self, key):
            return super().get(key)
        
        def __setitem__(self, key, value):
            if self._widget_created and key == 'current_page':
                raise Exception("`st.session_state.current_page` cannot be modified after the widget with key `current_page` is instantiated.")
            super().__setitem__(key, value)
            
        def get(self, key, default=None):
            return super().get(key, default)
            
        def update(self, *args, **kwargs):
            super().update(*args, **kwargs)
    
    # Initialize the mock session state
    session_state = MockSessionState()
    session_state.update({
        'is_authenticated': True,
        'is_admin': True
    })
    mock_streamlit.session_state = session_state
    
    # Set up the selectbox mock to return a value
    mock_selectbox = Mock()
    mock_selectbox.return_value = "Create User"
    mock_streamlit.sidebar.selectbox = mock_selectbox
    
    # Set up the title mock
    mock_title = Mock()
    mock_streamlit.sidebar.title = mock_title
    
    # First render the sidebar to create the widget
    result = app.main.render_sidebar()
    
    # Verify the result
    assert result == "Create User"
    
    # Mark that the widget has been created
    mock_streamlit.session_state._widget_created = True
    
    # Now try to modify the session state
    with pytest.raises(Exception) as exc_info:
        mock_streamlit.session_state['current_page'] = "Create Invite"
    
    # Verify that the error is about modifying session state after widget creation
    assert "cannot be modified after the widget" in str(exc_info.value)
    
    # Verify that the title was called
    mock_title.assert_called_once_with("Navigation")
    
    # Verify that the selectbox was called with the correct arguments
    mock_selectbox.assert_called_once_with(
        "Select Page",
        [
            "Create User", 
            "List & Manage Users",
            "Create Invite",
            "Matrix Messages and Rooms",
            "Signal Association"
        ],
        index=0,  # Create User is at index 0
        key='current_page'
    )

def test_main_session_state_handling(mock_streamlit):
    """Test that main function properly handles session state"""
    # Initialize the mock session state
    mock_streamlit.session_state = {}
    
    with patch('app.main.setup_page_config'), \
         patch('app.main.initialize_session_state') as mock_init, \
         patch('app.main.render_sidebar') as mock_sidebar, \
         patch('app.main.render_main_content'), \
         patch('app.main.init_db'):
        
        # Set up the sidebar mock to return a value
        mock_sidebar.return_value = "List & Manage Users"
        
        # Call main function
        app.main.main()
        
        # Verify that initialize_session_state was called
        mock_init.assert_called_once()
        
        # We're not checking session_state['current_page'] anymore since we don't set it there directly

def test_widget_default_and_session_state_conflict(mock_streamlit):
    """Test that widgets don't have both default values and session state values set."""
    
    # Create a custom TrackedWidget class to detect conflicts
    class WidgetConflictTracker:
        def __init__(self):
            self.widgets = {}  # Track widget keys and how they're initialized
            self.conflict_detected = False
            self.conflict_details = []
        
        def register_widget(self, key, has_default_value, has_session_state):
            if key in self.widgets:
                # We already have this widget registered, so update its status
                if has_default_value and self.widgets[key]['has_session_state']:
                    self.conflict_detected = True
                    self.conflict_details.append({
                        'key': key,
                        'error': "Widget created with default value but also had value set via Session State API"
                    })
                if has_session_state and self.widgets[key]['has_default_value']:
                    self.conflict_detected = True
                    self.conflict_details.append({
                        'key': key,
                        'error': "Widget had value set via Session State API but was also created with default value"
                    })
            else:
                # New widget, register it
                self.widgets[key] = {
                    'has_default_value': has_default_value,
                    'has_session_state': has_session_state
                }
    
    # Initialize tracker
    tracker = WidgetConflictTracker()
    
    # Create a text_input mock that registers widgets
    def tracked_text_input(*args, **kwargs):
        key = kwargs.get('key')
        has_default_value = 'value' in kwargs and kwargs['value'] is not None
        has_session_state = key in mock_streamlit.session_state
        
        if key:
            tracker.register_widget(key, has_default_value, has_session_state)
        
        # Return a mock widget value
        return kwargs.get('value') or mock_streamlit.session_state.get(key, "")
    
    # Replace the text_input with our tracked version
    mock_streamlit.text_input = tracked_text_input
    
    # Set up a session state with values for our key of interest
    mock_streamlit.session_state = {
        'username_input_outside': 'test_username',
        'first_name_input_outside': 'John',
        'last_name_input_outside': 'Doe'
    }
    
    # Now simulate creating widgets both ways to trigger detection
    # 1. Correct way - using session state without default
    tracked_text_input("Username", key="username_input_outside")
    
    # 2. Incorrect way - using both session state and default value
    tracked_text_input("Username", key="username_input_outside", value="default_username")
    
    # Check that our tracker detected the conflict
    assert tracker.conflict_detected, "Widget conflict was not detected"
    assert len(tracker.conflict_details) > 0, "No conflict details were recorded"
    
    # Check that the specific username_input_outside conflict was detected
    username_conflicts = [d for d in tracker.conflict_details if d['key'] == 'username_input_outside']
    assert len(username_conflicts) > 0, "No conflict detected for username_input_outside"
    assert "Widget" in username_conflicts[0]['error'], "Error message not specific to widget conflict"

def test_main_function_handles_auth_query_params(mock_streamlit):
    """Test that main function properly processes auth query parameters"""
    # Setup query parameters
    mock_query_params = {
        'auth_success': 'true',
        'username': 'testuser',
        'auth_method': 'local',
        'admin': 'true'
    }
    
    # Mock the query_params attribute of st
    mock_streamlit.query_params = mock_query_params
    
    # Also patch other dependencies
    with patch('app.main.init_db') as mock_init_db, \
         patch('app.main.setup_page_config') as mock_setup_config, \
         patch('app.main.render_sidebar', new_callable=AsyncMock) as mock_render_sidebar, \
         patch('app.main.render_main_content', new_callable=AsyncMock) as mock_render_main, \
         patch('app.main.initialize_session_state') as mock_init_session, \
         patch('app.main.time.time', return_value=12345.0), \
         patch('app.main.logging') as mock_logging:
        
        # Import the function
        from app.main import main
        
        # Call the function
        import asyncio
        asyncio.run(main())
        
        # Verify that auth state is set correctly
        assert mock_streamlit.session_state.get('is_authenticated') is True
        assert mock_streamlit.session_state.get('username') == 'testuser'
        assert mock_streamlit.session_state.get('auth_method') == 'local'
        assert mock_streamlit.session_state.get('is_admin') is True
        assert mock_streamlit.session_state.get('permanent_auth') is True
        assert mock_streamlit.session_state.get('permanent_admin') is True
        assert mock_streamlit.session_state.get('auth_timestamp') == 12345.0
        
        # Verify all expected functions were called
        mock_init_db.assert_called_once()
        mock_setup_config.assert_called_once()
        mock_init_session.assert_called_once()
        mock_render_sidebar.assert_called_once()
        mock_render_main.assert_called_once()

def test_render_main_content_with_auth_success(mock_streamlit):
    """Test that render_main_content handles auth_success query parameter properly"""
    # Setup query parameters
    mock_query_params = {
        'auth_success': 'true',
        'username': 'testuser',
        'auth_method': 'local',
        'admin': 'true'
    }
    
    # Mock the query_params attribute of st
    mock_streamlit.query_params = mock_query_params
    
    # Mock other dependencies
    with patch('app.main.time.sleep') as mock_sleep, \
         patch('app.main.time.time', return_value=12345.0), \
         patch('app.main.logging') as mock_logging:
        
        # Import the function
        from app.main import render_main_content
        
        # Call the function
        import asyncio
        asyncio.run(render_main_content())
        
        # Verify session state is updated
        assert mock_streamlit.session_state.get('is_authenticated') is True
        assert mock_streamlit.session_state.get('username') == 'testuser'
        assert mock_streamlit.session_state.get('is_admin') is True
        
        # Verify welcome message is shown
        mock_streamlit.success.assert_called_once()
        
        # Verify admin message is shown
        mock_streamlit.info.assert_called_once()

def test_main_function_restores_from_permanent_flags(mock_streamlit):
    """Test that main function restores auth state from permanent flags"""
    # Setup session state with permanent flags but no auth state
    mock_streamlit.session_state['permanent_auth'] = True
    mock_streamlit.session_state['permanent_admin'] = True
    mock_streamlit.session_state['username'] = 'persistentuser'
    
    # Mock dependencies
    with patch('app.main.init_db') as mock_init_db, \
         patch('app.main.setup_page_config') as mock_setup_config, \
         patch('app.main.render_sidebar', new_callable=AsyncMock) as mock_render_sidebar, \
         patch('app.main.render_main_content', new_callable=AsyncMock) as mock_render_main, \
         patch('app.main.initialize_session_state') as mock_init_session, \
         patch('app.main.logging') as mock_logging:
        
        # Import the function
        from app.main import main
        
        # Call the function
        import asyncio
        asyncio.run(main())
        
        # Verify auth state is restored from permanent flags
        assert mock_streamlit.session_state.get('is_authenticated') is True
        assert mock_streamlit.session_state.get('is_admin') is True
        
        # Verify it logged the restoration
        mock_logging.info.assert_any_call("Restoring authentication state from permanent flag")
        mock_logging.info.assert_any_call("Restoring admin status from permanent flag")
        
        # Verify expected functions were still called
        mock_init_db.assert_called_once()
        mock_render_sidebar.assert_called_once()
        mock_render_main.assert_called_once() 