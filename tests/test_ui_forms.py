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