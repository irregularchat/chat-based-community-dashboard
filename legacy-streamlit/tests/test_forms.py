import pytest
from unittest.mock import patch, Mock, AsyncMock, MagicMock
import streamlit as st
from app.ui import forms
from app.utils.config import Config
from typing import List

@pytest.fixture
def mock_streamlit():
    """Mock the Streamlit library for testing"""
    with patch('app.ui.forms.st') as mock_st:
        # Create a session state that supports both dict and attribute access
        class MockSessionState(dict):
            def __getattr__(self, name):
                return self.get(name)
            def __setattr__(self, name, value):
                self[name] = value
            def __delattr__(self, name):
                if name in self:
                    del self[name]
        
        mock_st.session_state = MockSessionState()
        
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
        mock_st.spinner = MagicMock()
        
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
         patch('app.auth.local_auth.Config', MockConfig), \
         patch('app.auth.token_handler.Config', MockConfig), \
         patch('app.force_sync.Config', MockConfig):
        yield MockConfig

@pytest.fixture
def mock_db():
    """Mock database session"""
    with patch('app.ui.forms.get_db') as mock_get_db:
        mock_session = Mock()
        mock_get_db.return_value = mock_session
        mock_session.__enter__ = Mock(return_value=mock_session)
        mock_session.__exit__ = Mock(return_value=None)
        yield mock_session

@pytest.mark.asyncio
async def test_render_create_user_form(mock_streamlit, mock_db, mock_config):
    """Test create user form rendering"""
    # Set up mock form values using the MockSessionState
    mock_streamlit.session_state.update({
        'first_name_input': '',
        'last_name_input': '',
        'username_input': '',
        'email_input': '',
        'invited_by_input': '',
        'intro_input': '',
        'selected_groups': [mock_config.MAIN_GROUP_ID],
        'group_selection': [mock_config.MAIN_GROUP_ID],
        'fetch_indoc_users_started': True,
        'fetch_indoc_users_finished': True,
        'indoc_users': [],
        'authentik_groups': []
    })
    
    # Mock the form components with enough side effects for all text inputs
    mock_streamlit.text_input.side_effect = [''] * 20  # Provide enough empty strings for all text inputs
    mock_streamlit.text_area.return_value = ''
    mock_streamlit.checkbox.return_value = False
    mock_streamlit.button.return_value = False
    
    # Mock the columns function to return mock columns for each call
    def mock_columns(ratios):
        # Create the appropriate number of mock columns based on the ratios list
        mock_cols = [MagicMock() for _ in ratios]
        for col in mock_cols:
            # Mock the context manager behavior
            col.__enter__ = MagicMock(return_value=col)
            col.__exit__ = MagicMock(return_value=None)
            # Mock text_input to return empty string
            col.text_input = MagicMock(return_value='')
            col.checkbox = MagicMock(return_value=False)
            col.button = MagicMock(return_value=False)
            col.markdown = MagicMock()
            col.write = MagicMock()
            col.info = MagicMock()
            col.warning = MagicMock()
            col.error = MagicMock()
            col.success = MagicMock()
            col.selectbox = MagicMock(return_value='')
            col.multiselect = MagicMock(return_value=[])
        return mock_cols
    
    mock_streamlit.columns.side_effect = mock_columns
    
    # Mock additional streamlit components
    mock_streamlit.markdown = MagicMock()
    mock_streamlit.write = MagicMock()
    mock_streamlit.info = MagicMock()
    mock_streamlit.warning = MagicMock()
    mock_streamlit.error = MagicMock()
    mock_streamlit.success = MagicMock()
    mock_streamlit.selectbox = MagicMock(return_value='')
    mock_streamlit.multiselect = MagicMock(return_value=[])
    
    # Mock requests to avoid actual API calls
    with patch('requests.get') as mock_get, \
         patch('app.ui.forms.update_username_from_inputs') as mock_update_username, \
         patch('app.ui.forms.on_first_name_change') as mock_first_name_change, \
         patch('app.ui.forms.on_last_name_change') as mock_last_name_change, \
         patch('app.ui.forms.Config', mock_config):
        
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = {'results': []}
        mock_update_username.return_value = True
        
        # Call the function
        result = await forms.render_create_user_form()
    
    # Verify the result - the function doesn't return anything, so result should be None
    assert result is None
    
    # Verify Config was accessed correctly
    assert mock_streamlit.session_state.get('selected_groups', []) == [mock_config.MAIN_GROUP_ID]
    assert mock_streamlit.session_state.get('group_selection', []) == [mock_config.MAIN_GROUP_ID]
    
    # Verify columns were called with correct ratios
    mock_streamlit.columns.assert_any_call([2, 2, 2])  # First row
    mock_streamlit.columns.assert_any_call([3, 2, 2, 2])  # Second row

def test_reset_create_user_form_fields(mock_streamlit, mock_config):
    """Test resetting create user form fields"""
    # Import from the new location
    from app.utils.form_helpers import reset_create_user_form_fields
    
    # Set up initial session state
    mock_streamlit.session_state = {
        'username_input': 'test',
        'first_name_input': 'John',
        'last_name_input': 'Doe',
        'email_input': 'test@example.com',
        'selected_groups': ['group1'],
        'group_selection': ['group1']
    }
    
    # Mock the streamlit session state and Config for the form_helpers module
    with patch('app.utils.form_helpers.st', mock_streamlit), \
         patch('app.utils.form_helpers.Config', mock_config):
        # Call the function
        reset_create_user_form_fields()
    
    # Verify fields were reset
    assert mock_streamlit.session_state.get('username_input', '') == ''
    assert mock_streamlit.session_state.get('first_name_input', '') == ''
    assert mock_streamlit.session_state.get('last_name_input', '') == ''
    assert mock_streamlit.session_state.get('email_input', '') == ''
    
    # Verify groups were reset to MAIN_GROUP_ID
    assert mock_streamlit.session_state.get('selected_groups', []) == [mock_config.MAIN_GROUP_ID]
    assert mock_streamlit.session_state.get('group_selection', []) == [mock_config.MAIN_GROUP_ID] 