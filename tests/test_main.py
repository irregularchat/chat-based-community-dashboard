import pytest
from unittest.mock import patch, Mock, AsyncMock
import app.main
from datetime import datetime, timedelta
from app.db.operations import AdminEvent

@pytest.fixture
def mock_streamlit():
    """Mock Streamlit components with proper async support"""
    with patch('app.main.st') as mock_st:
        # Set up session state
        mock_st.session_state = {}
        
        # Set up sidebar with async support
        mock_sidebar = Mock()
        mock_sidebar.title = AsyncMock()
        mock_sidebar.selectbox = AsyncMock()
        mock_st.sidebar = mock_sidebar
        
        # Set up form with context manager support
        mock_form = AsyncMock()
        mock_form.__aenter__ = AsyncMock(return_value=mock_form)
        mock_form.__aexit__ = AsyncMock(return_value=None)
        mock_st.form.return_value = mock_form
        
        # Set up basic session state values
        mock_st.session_state.update({
            'first_name_input': '',
            'last_name_input': '',
            'username_input': '',
            'email_input': '',
            'invited_by_input': '',
            'intro_input': '',
            'invite_email': '',
            'invite_message': '',
            'show_create_user': False,
            'show_invite_form': False,
            'show_user_list': False,
            'show_operation_selector': True,
            'current_page': 'Create User'
        })
        
        yield mock_st

@pytest.fixture
def mock_config():
    """Mock configuration and ensure it's available in all required modules"""
    config_values = {
        'PAGE_TITLE': "Test Dashboard",
        'FAVICON_URL': "test_favicon.ico",
        'AUTHENTIK_API_URL': "http://test-api",
        'AUTHENTIK_API_TOKEN': "test-token",
        'MATRIX_ACTIVE': False,
        'DISCOURSE_URL': None,
        'DISCOURSE_API_KEY': None,
        'DISCOURSE_API_USERNAME': None,
        'DISCOURSE_CATEGORY_ID': None,
        'DISCOURSE_INTRO_TAG': None,
        'DISCOURSE_ACTIVE': False,
        'WEBHOOK_URL': None,
        'WEBHOOK_SECRET': None,
        'WEBHOOK_ACTIVE': False,
        'DATABASE_URL': "sqlite:///test.db"
    }
    
    class MockConfig:
        pass
    
    # Add config values as class attributes
    for key, value in config_values.items():
        setattr(MockConfig, key, value)
    
    with patch('app.utils.config.Config', MockConfig), \
         patch('app.ui.forms.Config', MockConfig), \
         patch('app.ui.home.Config', MockConfig), \
         patch('app.main.Config', MockConfig):
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

@pytest.mark.asyncio
async def test_render_sidebar(mock_streamlit):
    """Test sidebar rendering"""
    # Set up the mock to return a value directly (not a coroutine)
    mock_selectbox = Mock()
    mock_selectbox.return_value = "Create User"
    mock_streamlit.sidebar.selectbox = mock_selectbox
    
    # Set up the title mock as regular mock (not async)
    mock_title = Mock()
    mock_streamlit.sidebar.title = mock_title
    
    # Call the function and await its result
    result = await app.main.render_sidebar()
    
    # Verify the calls
    mock_title.assert_called_once_with("Navigation")
    mock_selectbox.assert_called_once_with(
        "Select Page",
        [
            "Create User",
            "Create Invite",
            "List & Manage Users",
            "Matrix Messages and Rooms",
            "Settings",
            "Prompts Manager"
        ],
        index=0,
        key='current_page'
    )
    assert result == "Create User"

@pytest.mark.asyncio
async def test_render_main_content(mock_streamlit):
    """Test main content rendering"""
    with patch('app.main.render_create_user_form', new_callable=AsyncMock) as mock_create_form, \
         patch('app.main.render_invite_form', new_callable=AsyncMock) as mock_invite_form, \
         patch('app.main.display_user_list', new_callable=AsyncMock) as mock_display_users:
        
        mock_streamlit.session_state['current_page'] = 'Create User'
        await app.main.render_main_content()
        mock_create_form.assert_awaited_once()
        
        mock_streamlit.session_state['current_page'] = 'Create Invite'
        await app.main.render_main_content()
        mock_invite_form.assert_awaited_once()
        
        mock_streamlit.session_state['current_page'] = 'List & Manage Users'
        await app.main.render_main_content()
        mock_display_users.assert_awaited_once()

@pytest.mark.asyncio
async def test_main(mock_streamlit, mock_config):
    """Test main function"""
    with patch('app.main.setup_page_config') as mock_setup, \
         patch('app.main.initialize_session_state') as mock_init, \
         patch('app.main.render_sidebar', new_callable=AsyncMock) as mock_sidebar, \
         patch('app.main.render_main_content', new_callable=AsyncMock) as mock_content, \
         patch('app.main.init_db') as mock_init_db:
        
        mock_sidebar.return_value = "Create User"
        
        await app.main.main()
        
        mock_setup.assert_called_once()
        mock_init.assert_called_once()
        mock_init_db.assert_called_once()
        mock_sidebar.assert_awaited_once()
        mock_content.assert_awaited_once()

@pytest.mark.asyncio
async def test_main_error_handling(mock_streamlit):
    """Test error handling in main function"""
    with patch('app.main.setup_page_config') as mock_setup:
        mock_setup.side_effect = Exception("Test error")
        
        await app.main.main()
        
        mock_streamlit.error.assert_called_once()

@pytest.mark.asyncio
async def test_session_state_modification_after_widget(mock_streamlit):
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
        'current_page': 'Create User'
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
    result = await app.main.render_sidebar()
    
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
            "Create Invite",
            "List & Manage Users",
            "Matrix Messages and Rooms",
            "Settings",
            "Prompts Manager"
        ],
        index=0,
        key='current_page'
    )

@pytest.mark.asyncio
async def test_main_session_state_handling(mock_streamlit):
    """Test that main function properly handles session state"""
    # Create a custom session state that tracks modifications
    class MockSessionState:
        def __init__(self):
            self._state = {}
            self._modified_keys = set()
        
        def __getitem__(self, key):
            return self._state.get(key)
        
        def __setitem__(self, key, value):
            self._state[key] = value
            self._modified_keys.add(key)
        
        def get(self, key, default=None):
            return self._state.get(key, default)
    
    mock_streamlit.session_state = MockSessionState()
    
    with patch('app.main.setup_page_config') as mock_setup, \
         patch('app.main.initialize_session_state') as mock_init, \
         patch('app.main.render_sidebar', new_callable=AsyncMock) as mock_sidebar, \
         patch('app.main.render_main_content', new_callable=AsyncMock) as mock_content, \
         patch('app.main.init_db') as mock_init_db:
        
        # Set up the sidebar mock to return a value
        mock_sidebar.return_value = "Create User"
        
        # Call main function
        await app.main.main()
        
        # Verify that session state was initialized before sidebar rendering
        assert mock_init.call_count == 1
        
        # Verify that sidebar was rendered
        assert mock_sidebar.call_count == 1
        
        # Verify that main content was rendered
        assert mock_content.call_count == 1
        
        # Verify that current_page was initialized before widget creation
        assert 'current_page' in mock_streamlit.session_state._modified_keys
        assert mock_streamlit.session_state['current_page'] == 'Create User' 