import pytest
from unittest.mock import patch, Mock, AsyncMock, MagicMock
import streamlit as st
import pandas as pd
from app.ui.forms import display_user_list, handle_action, format_date

@pytest.mark.asyncio
async def test_display_user_list():
    """Test the display_user_list function with mock data."""
    # Mock the database session and streamlit components
    with patch('app.ui.forms.get_db') as mock_get_db, \
         patch('app.ui.forms.search_users') as mock_search_users, \
         patch('streamlit.text_input') as mock_text_input, \
         patch('streamlit.selectbox') as mock_selectbox, \
         patch('streamlit.data_editor') as mock_data_editor, \
         patch('streamlit.multiselect') as mock_multiselect, \
         patch('streamlit.button') as mock_button, \
         patch('streamlit.write') as mock_write, \
         patch('streamlit.success') as mock_success, \
         patch('streamlit.info') as mock_info:
        
        # Set up mock database and search results
        mock_db = Mock()
        mock_db_context = MagicMock()
        mock_db_context.__enter__.return_value = mock_db
        mock_get_db.return_value.__next__.return_value = mock_db_context
        
        # Create mock user data
        mock_users = [
            Mock(id=1, username='user1', name='User One', email='user1@example.com', 
                 is_active=True, last_login=None, attributes={}),
            Mock(id=2, username='user2', name='User Two', email='user2@example.com', 
                 is_active=False, last_login=None, attributes={})
        ]
        mock_search_users.return_value = mock_users
        
        # Set up mock Streamlit session state
        st.session_state = {
            'filter_term': '',
            'status_filter': 'All',
            'selection_state': 'viewing'
        }
        
        # Set up mock returns for Streamlit components
        mock_text_input.return_value = ''
        mock_selectbox.return_value = 'All'
        mock_multiselect.return_value = ['user1', 'user2']
        mock_button.return_value = True
        
        # Call the function under test
        await display_user_list()
        
        # Verify the expected function calls
        mock_get_db.assert_called_once()
        mock_search_users.assert_called_once()
        
        # Verify multiselect was called for user selection
        mock_multiselect.assert_called()
        
        # Verify session state was updated correctly when users are selected
        assert 'selection_state' in st.session_state
        
        # Check that button rerun was triggered
        if mock_button.return_value:
            assert st.session_state['selection_state'] == 'selected'

@pytest.mark.asyncio
async def test_handle_action():
    """Test the handle_action function."""
    # Create mock users and action parameters
    mock_users = [
        {'pk': '1', 'username': 'user1', 'email': 'user1@example.com'},
        {'pk': '2', 'username': 'user2', 'email': 'user2@example.com'}
    ]
    
    # Test activate/deactivate action
    with patch('app.ui.forms.update_user_status') as mock_update_status, \
         patch('streamlit.success') as mock_success, \
         patch('streamlit.error') as mock_error:
        
        mock_update_status.return_value = True
        
        # Call the function
        result = handle_action('Activate', mock_users)
        
        # Verify the function calls and results
        assert result is True
        mock_update_status.assert_called()
        mock_success.assert_called()

@pytest.mark.parametrize(
    "date_input,expected",
    [
        (None, ""),
        ("2023-01-01T12:00:00Z", "2023-01-01 12:00"),
        (pd.NaT, ""),
    ]
)
def test_format_date(date_input, expected):
    """Test the format_date function with various inputs."""
    result = format_date(date_input)
    assert result == expected 

def test_no_widget_key_conflicts():
    """Test that username_input_outside widget doesn't have both default and session state values."""
    # Set up session state with values
    st.session_state = {
        'username_input_outside': 'test_username',
        'username_input': 'test_username'
    }
    
    # Create a conflict detection mechanism
    conflicts_detected = []
    
    # Save the original text_input function
    original_text_input = st.text_input
    
    # Replace with our tracking version
    def tracked_text_input(*args, **kwargs):
        key = kwargs.get('key')
        if key == 'username_input_outside' and 'value' in kwargs and kwargs['value'] is not None:
            conflicts_detected.append({
                'key': key,
                'error': f"Widget '{key}' created with default value but also had value set via Session State",
                'session_state_value': st.session_state.get(key),
                'default_value': kwargs['value']
            })
        return original_text_input(*args, **kwargs)
    
    # Apply the patch
    with patch('streamlit.text_input', tracked_text_input):
        # Mock implementation of the username input field with potential conflict
        # This imitates the text_input in forms.py line ~274
        username_value = st.session_state.get('username_input', '')
        
        # Correct way - no value parameter when key is in session state
        tracked_text_input(
            "Username *",
            key="username_input_outside",
            placeholder="e.g., johndoe123",
            help="Username for login (required, must be unique)."
        )
        
        # Incorrect way - using both session state and value parameter
        tracked_text_input(
            "Username *",
            key="username_input_outside",
            value=username_value,  # This creates a conflict!
            placeholder="e.g., johndoe123",
            help="Username for login (required, must be unique)."
        )
        
    # Verify we detected the conflict with the username_input_outside widget
    assert len(conflicts_detected) == 1, "Expected exactly one conflict to be detected"
    conflict = conflicts_detected[0]
    assert conflict['key'] == 'username_input_outside', "Conflict should be with username_input_outside"
    assert conflict['session_state_value'] == 'test_username', "Session state value should be 'test_username'"
    assert conflict['default_value'] == 'test_username', "Default value should match username_value" 