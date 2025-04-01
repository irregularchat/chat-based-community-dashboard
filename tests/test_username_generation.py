import pytest
from unittest.mock import patch, Mock, AsyncMock, MagicMock
import asyncio
import streamlit as st
from app.ui.forms import render_create_user_form
from app.db.models import User
from app.utils.helpers import create_unique_username

@pytest.mark.asyncio
async def test_username_generation():
    """Test automatic username generation from first and last name."""
    # Set up session state with initial values
    st.session_state = {
        'first_name_input': 'John',
        'last_name_input': 'Doe',
        'username_input': '',
        'username_was_auto_generated': False
    }
    
    # Mock the database session, API calls, and other functions
    with patch('app.ui.forms.get_db') as mock_get_db, \
         patch('app.utils.helpers.create_unique_username') as mock_create_unique, \
         patch('requests.get') as mock_requests_get, \
         patch('streamlit.form') as mock_form, \
         patch('streamlit.columns') as mock_columns, \
         patch('streamlit.text_input') as mock_text_input, \
         patch('streamlit.multiselect') as mock_multiselect, \
         patch('streamlit.text_area') as mock_text_area, \
         patch('streamlit.checkbox') as mock_checkbox, \
         patch('streamlit.form_submit_button') as mock_submit, \
         patch('streamlit.rerun'):
        
        # Set up necessary mocks for the function to run
        mock_db = Mock()
        mock_db_next = Mock(return_value=mock_db)
        mock_get_db.return_value.__next__ = mock_db_next
        
        # Mock the User query to return no existing usernames
        mock_query = Mock()
        mock_db.query.return_value = mock_query
        mock_filter = Mock()
        mock_query.filter.return_value = mock_filter
        mock_filter.all.return_value = []
        
        # Mock API response for no existing usernames in Authentik
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'results': []}
        mock_requests_get.return_value = mock_response
        
        # Create a form context manager
        mock_form_context = MagicMock()
        mock_form.return_value.__enter__.return_value = mock_form_context
        mock_form.return_value.__exit__.return_value = None
        
        # Create columns context manager
        mock_columns_context = [MagicMock(), MagicMock()]
        mock_columns.return_value = mock_columns_context
        
        # Set up behavior for text inputs
        def text_input_side_effect(*args, **kwargs):
            key = kwargs.get('key', '')
            if key == 'first_name_input_outside':
                # Trigger the on_change handler
                if 'on_change' in kwargs:
                    kwargs['on_change']()
                return st.session_state.get('first_name_input', '')
            elif key == 'last_name_input_outside':
                # Trigger the on_change handler
                if 'on_change' in kwargs:
                    kwargs['on_change']()
                return st.session_state.get('last_name_input', '')
            elif key == 'username_input_outside':
                return st.session_state.get('username_input', '')
            return ''
            
        mock_text_input.side_effect = text_input_side_effect
        
        # Set up tests with different name combinations
        test_cases = [
            # First name, Last name, Expected username
            ('John', 'Doe', 'john-d'),
            ('Jane', '', 'jane'),
            ('', 'Smith', 'smith'),
            ('John David', 'Smith', 'john-david-s')
        ]
        
        for first_name, last_name, expected_username in test_cases:
            # Reset mocks and session state
            mock_db.reset_mock()
            mock_db.query.return_value.filter.return_value.all.return_value = []
            
            # Set test values in session state
            st.session_state['first_name_input'] = first_name
            st.session_state['last_name_input'] = last_name
            st.session_state['username_input'] = ''
            st.session_state['username_was_auto_generated'] = False
            
            # Call the render function - this will trigger username generation
            await render_create_user_form()
            
            # Check if the username was set correctly
            assert st.session_state['username_input'] == expected_username, \
                f"Expected username '{expected_username}' for '{first_name} {last_name}', got '{st.session_state['username_input']}'"
        
        # Test case for existing username (increment)
        # Mock to return an existing username
        mock_query.filter.return_value.all.return_value = [Mock(username='john-d')]
        
        # Reset session state
        st.session_state['first_name_input'] = 'John'
        st.session_state['last_name_input'] = 'Doe'
        st.session_state['username_input'] = ''
        st.session_state['username_was_auto_generated'] = False
        
        # Mock create_unique_username to return an incremented name
        mock_create_unique.return_value = 'john-d1'
        
        # Call the render function
        await render_create_user_form()
        
        # Check if username was incremented
        assert 'john-d1' in st.session_state['username_input']
        
        # Test that custom username is not overwritten
        st.session_state['first_name_input'] = 'John'
        st.session_state['last_name_input'] = 'Doe'
        st.session_state['username_input'] = 'custom_username'
        st.session_state['username_was_auto_generated'] = False
        
        # Call the render function
        await render_create_user_form()
        
        # Custom username should be preserved
        assert st.session_state['username_input'] == 'custom_username'

@pytest.mark.asyncio
async def test_username_generation_api_error():
    """Test username generation when API check fails."""
    # Set up session state
    st.session_state = {
        'first_name_input': 'John',
        'last_name_input': 'Doe',
        'username_input': '',
        'username_was_auto_generated': False
    }
    
    # Mock functions
    with patch('app.ui.forms.get_db') as mock_get_db, \
         patch('app.utils.helpers.create_unique_username') as mock_create_unique, \
         patch('requests.get') as mock_requests_get, \
         patch('streamlit.form') as mock_form, \
         patch('streamlit.columns') as mock_columns, \
         patch('streamlit.text_input') as mock_text_input, \
         patch('streamlit.multiselect') as mock_multiselect, \
         patch('streamlit.text_area') as mock_text_area, \
         patch('streamlit.checkbox') as mock_checkbox, \
         patch('streamlit.form_submit_button') as mock_submit, \
         patch('streamlit.rerun'):
        
        # Set up necessary mocks
        mock_db = Mock()
        mock_db_next = Mock(return_value=mock_db)
        mock_get_db.return_value.__next__ = mock_db_next
        mock_query = Mock()
        mock_db.query.return_value = mock_query
        mock_filter = Mock()
        mock_query.filter.return_value = mock_filter
        mock_filter.all.return_value = []
        
        # Set up form context
        mock_form_context = MagicMock()
        mock_form.return_value.__enter__.return_value = mock_form_context
        mock_form.return_value.__exit__.return_value = None
        
        # Create columns context manager
        mock_columns_context = [MagicMock(), MagicMock()]
        mock_columns.return_value = mock_columns_context
        
        # Mock API error
        mock_requests_get.side_effect = Exception("API Error")
        
        # Mock create_unique_username for the fallback
        mock_create_unique.return_value = "john-d-fallback"
        
        # Set up text input side effect to trigger on_change
        def text_input_side_effect(*args, **kwargs):
            key = kwargs.get('key', '')
            if key in ('first_name_input_outside', 'last_name_input_outside') and 'on_change' in kwargs:
                kwargs['on_change']()
            return st.session_state.get(key.replace('_outside', ''), '')
            
        mock_text_input.side_effect = text_input_side_effect
        
        # Call the function
        await render_create_user_form()
        
        # Check that the fallback username was used
        assert st.session_state['username_input'] == "john-d-fallback"
        mock_create_unique.assert_called() 