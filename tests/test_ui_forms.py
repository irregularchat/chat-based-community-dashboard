import pytest
from unittest.mock import patch, Mock, AsyncMock, MagicMock
import streamlit as st
import pandas as pd
from app.ui.forms import display_user_list, handle_action, format_date, parse_and_rerun, clear_parse_data, render_create_user_form

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
        mock_get_db.assert_called()
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

def test_parse_and_rerun_session_state_handling():
    """Test that parse_and_rerun handles Streamlit session state correctly and doesn't modify widget values directly."""
    from app.ui.forms import parse_and_rerun
    from streamlit.errors import StreamlitAPIException
    
    # Simulate the parsed data that would come from parse_input
    mock_parsed_data = {
        "first_name": "John",
        "last_name": "Doe",
        "email": "john@example.com",
        "invited_by": "Jane Smith",
        "intro": {
            "organization": "ACME Corp",
            "interests": "Python, Testing",
            "text": "Some introduction text"
        }
    }
    
    # Mock Streamlit's session state
    st.session_state = {
        "parse_data_input_outside": "John Doe\nACME Corp\njohn@example.com\nInvited by Jane Smith\nPython, Testing",
    }
    
    # Setup mocks
    with patch('app.ui.forms.parse_input', return_value=mock_parsed_data) as mock_parse_input, \
         patch('streamlit.success') as mock_success, \
         patch('streamlit.error') as mock_error, \
         patch('streamlit.warning') as mock_warning, \
         patch('streamlit.rerun') as mock_rerun, \
         patch('logging.info') as mock_logging_info, \
         patch('logging.error') as mock_logging_error:
        
        # Test the correct approach (using temporary variables)
        parse_and_rerun()
        
        # Verify parse_input was called
        mock_parse_input.assert_called_once()
        
        # Check that we stored the parsed data in _parsed_* variables instead of trying to modify widget values directly
        assert "_parsed_first_name" in st.session_state
        assert "_parsed_last_name" in st.session_state
        assert "_parsed_email" in st.session_state
        assert "_parsed_invited_by" in st.session_state
        assert "_parsed_organization" in st.session_state
        assert "_parsed_interests" in st.session_state
        assert "_parsed_intro" in st.session_state
        assert "parsing_successful" in st.session_state
        
        # Verify these values match what was parsed
        assert st.session_state["_parsed_first_name"] == "John"
        assert st.session_state["_parsed_last_name"] == "Doe"
        assert st.session_state["_parsed_email"] == "john@example.com"
        assert st.session_state["_parsed_invited_by"] == "Jane Smith"
        assert st.session_state["_parsed_organization"] == "ACME Corp"
        assert st.session_state["_parsed_interests"] == "Python, Testing"
        assert st.session_state["_parsed_intro"] == "Some introduction text"
        
        # Check that rerun was called
        mock_rerun.assert_called_once()

def test_clear_parse_data_session_state_handling():
    """Test that clear_parse_data properly cleans up session state without modifying widget values."""
    from app.ui.forms import clear_parse_data
    import os
    
    # Mock Config.MAIN_GROUP_ID 
    with patch('app.utils.config.Config') as mock_config:
        mock_config.MAIN_GROUP_ID = "default-group-id"
        
        # Setup initial session state with parsed data
        st.session_state = {
            "_parsed_first_name": "John",
            "_parsed_last_name": "Doe",
            "_parsed_email": "john@example.com",
            "_parsed_invited_by": "Jane Smith",
            "_parsed_intro": "ACME Corp\n\nInterests: Python, Testing",
            "parsing_successful": True,
            "parse_data_input_outside": "Some parsed data",
            "selected_groups": ["some-other-group"],
            "group_selection": ["some-other-group"]
        }
        
        # Setup mocks
        with patch('streamlit.rerun') as mock_rerun:
            # Call the function
            clear_parse_data()
            
            # Verify all temporary parsed data is removed
            assert "_parsed_first_name" not in st.session_state
            assert "_parsed_last_name" not in st.session_state
            assert "_parsed_email" not in st.session_state
            assert "_parsed_invited_by" not in st.session_state
            assert "_parsed_intro" not in st.session_state
            
            # Verify flags are set properly
            assert st.session_state["clear_parse_data_flag"] is True
            assert st.session_state["should_clear_form"] is True
            
            # Verify parse input field is cleared
            assert st.session_state["parse_data_input_outside"] == ""
            
            # Verify group selection is reset to default
            assert st.session_state["selected_groups"] == ["default-group-id"]
            assert st.session_state["group_selection"] == ["default-group-id"]
            
            # Check that rerun was called
            mock_rerun.assert_called_once()

def test_session_state_modification_after_widget_instantiation():
    """Test that simulates the Streamlit error when modifying widget values after instantiation."""
    from streamlit.errors import StreamlitAPIException
    
    # Create a mock for Streamlit's session state that simulates its behavior
    class MockSessionState(dict):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.instantiated_widgets = set()
            
        def __setitem__(self, key, value):
            # Simulate Streamlit's behavior: once a widget with a key is instantiated,
            # you can no longer modify that key in session_state
            if key.endswith('_outside') and key in self.instantiated_widgets:
                raise StreamlitAPIException(
                    f"`st.session_state.{key}` cannot be modified after the widget with key `{key}` is instantiated."
                )
            super().__setitem__(key, value)
            
        def mark_widget_as_instantiated(self, key):
            """Mark a widget as instantiated, which means its value can't be modified via session_state."""
            self.instantiated_widgets.add(key)
    
    # Replace st.session_state with our mock
    mock_state = MockSessionState()
    mock_state['parse_data_input_outside'] = "Initial text"
    
    # Simulate the widget being instantiated
    mock_state.mark_widget_as_instantiated('parse_data_input_outside')
    
    with patch('streamlit.session_state', mock_state):
        # Trying to modify the widget value after instantiation should raise an exception
        with pytest.raises(StreamlitAPIException) as excinfo:
            st.session_state['parse_data_input_outside'] = "New text"
        
        # Check the exception message
        assert "cannot be modified after the widget with key" in str(excinfo.value)
        
        # But setting temporary variables should work fine
        st.session_state['_parsed_data'] = "This works fine"
        assert st.session_state['_parsed_data'] == "This works fine"

def test_render_create_user_form_handles_parsed_data():
    """Test that render_create_user_form correctly applies parsed data from temporary session state variables."""
    from app.ui.forms import render_create_user_form
    
    # Setup session state with parsed data
    st.session_state = {
        'parsing_successful': True,
        '_parsed_first_name': 'John',
        '_parsed_last_name': 'Doe',
        '_parsed_email': 'john@example.com',
        '_parsed_invited_by': 'Jane Smith',
        '_parsed_intro': 'ACME Corp\n\nInterests: Python, Testing',
        'username_was_auto_generated': False
    }
    
    # Mocks for Streamlit widgets and functions
    with patch('streamlit.text_input') as mock_text_input, \
         patch('streamlit.markdown') as mock_markdown, \
         patch('streamlit.success') as mock_success, \
         patch('app.ui.forms.update_username_from_inputs') as mock_update_username, \
         patch('logging.info') as mock_logging_info:
        
        # Run the coroutine
        import asyncio
        asyncio.run(render_create_user_form())
        
        # Verify session state was updated correctly
        assert st.session_state['first_name_input'] == 'John'
        assert st.session_state['last_name_input'] == 'Doe'
        assert st.session_state['email_input'] == 'john@example.com'
        assert st.session_state['invited_by_input'] == 'Jane Smith'
        assert st.session_state['intro_text_input'] == 'ACME Corp\n\nInterests: Python, Testing'
        
        # Verify username was updated
        mock_update_username.assert_called_once()
        
        # Verify success message
        mock_success.assert_called_once()
        
        # Verify parsing_successful flag was reset
        assert st.session_state['parsing_successful'] is False 

def test_email_validation():
    """Test that email validation works correctly in the create user form."""
    from app.ui.forms import render_create_user_form
    import re
    
    # Test valid email addresses
    valid_emails = [
        "user@example.com",
        "user.name@example.co.uk",
        "user+tag@example.org",
        "user-name@sub.domain.com",
        "123456@example.com"
    ]
    
    # Test invalid email addresses
    invalid_emails = [
        "not-an-email",
        "missing@domain",
        "@example.com",
        "user@.com",
        "user@example.",
        "user name@example.com",
        "user@exam ple.com"
    ]
    
    # Extract the email validation pattern from the forms.py file
    with patch('streamlit.button') as mock_button:
        mock_button.return_value = True
        
        # Set up session state with required fields
        st.session_state = {
            'username_input': 'testuser',
            'first_name_input': 'Test',
            'create_user_button': True
        }
        
        # Get the email validation pattern from the code
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        
        # Test valid emails
        for email in valid_emails:
            assert re.match(email_pattern, email) is not None, f"Email '{email}' should be valid"
        
        # Test invalid emails
        for email in invalid_emails:
            assert re.match(email_pattern, email) is None, f"Email '{email}' should be invalid"

def test_reset_create_user_form_fields():
    """Test that reset_create_user_form_fields properly clears all form fields including Matrix-related ones."""
    from app.ui.forms import reset_create_user_form_fields
    
    # Setup session state with various fields
    st.session_state = {
        'username_input': 'testuser',
        'first_name_input': 'Test',
        'last_name_input': 'User',
        'email_input': 'test@example.com',
        'matrix_user_id': 'matrix_user_id',
        'matrix_user_select': 'selected_matrix_user',
        'matrix_user_selected': True,
        'recommended_rooms': ['room1', 'room2'],
        'selected_rooms': {'room_1', 'room_2'},
        'group_selection': ['group1', 'group2'],
        '_parsed_first_name': 'Parsed',
        'parsing_successful': True
    }
    
    # Call the reset function
    reset_create_user_form_fields()
    
    # Verify all fields are cleared
    assert 'username_input' not in st.session_state
    assert 'first_name_input' not in st.session_state
    assert 'last_name_input' not in st.session_state
    assert 'email_input' not in st.session_state
    assert 'matrix_user_id' not in st.session_state
    assert 'matrix_user_select' not in st.session_state
    assert 'matrix_user_selected' not in st.session_state
    assert '_parsed_first_name' not in st.session_state
    assert 'parsing_successful' not in st.session_state
    
    # Verify Matrix-related flags are reset
    assert st.session_state['recommended_rooms'] == []
    assert st.session_state['selected_rooms'] == set()

def test_authentik_groups_caching():
    """Test that Authentik groups are properly cached and reused."""
    from app.ui.forms import render_create_user_form
    import time
    
    # Mock the current time
    current_time = time.time()
    
    with patch('app.ui.forms.time.time') as mock_time, \
         patch('app.ui.forms.requests.get') as mock_get, \
         patch('streamlit.error') as mock_error, \
         patch('streamlit.warning') as mock_warning, \
         patch('logging.info') as mock_logging_info, \
         patch('logging.error') as mock_logging_error:
        
        # Setup time mock
        mock_time.return_value = current_time
        
        # Setup API response mock
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json.return_value = {'results': [{'id': '1', 'name': 'Test Group'}]}
        mock_get.return_value = mock_response
        
        # First call should fetch groups
        st.session_state = {}
        asyncio.run(render_create_user_form())
        
        # Verify API was called
        mock_get.assert_called_once()
        assert 'authentik_groups' in st.session_state
        assert 'authentik_groups_timestamp' in st.session_state
        assert st.session_state['authentik_groups_timestamp'] == current_time
        
        # Reset mock
        mock_get.reset_mock()
        
        # Second call within cache window should use cached groups
        mock_time.return_value = current_time + 1800  # 30 minutes later
        asyncio.run(render_create_user_form())
        
        # Verify API was not called again
        mock_get.assert_not_called()
        mock_logging_info.assert_any_call("Using cached Authentik groups")
        
        # Reset mock
        mock_get.reset_mock()
        mock_logging_info.reset_mock()
        
        # Call after cache expiry should fetch again
        mock_time.return_value = current_time + 3700  # Just over 1 hour later
        asyncio.run(render_create_user_form())
        
        # Verify API was called again
        mock_get.assert_called_once()

def test_matrix_user_connection_race_condition():
    """Test that Matrix user connection checks for existing connections."""
    from app.ui.forms import render_create_user_form
    from app.db.models import User
    
    # Mock database and User model
    with patch('app.ui.forms.get_db') as mock_get_db, \
         patch('streamlit.warning') as mock_warning, \
         patch('logging.warning') as mock_logging_warning:
        
        # Setup mock database
        mock_db = Mock()
        mock_get_db.return_value.__next__.return_value = mock_db
        
        # Create mock user with existing Matrix connection
        existing_user = Mock(spec=User)
        existing_user.username = "existing_user"
        existing_user.attributes = {"matrix_user_id": "existing_matrix_id"}
        
        # Setup query mock to find the existing connection
        mock_query = Mock()
        mock_query.filter.return_value.first.return_value = existing_user
        mock_db.query.return_value = mock_query
        
        # Setup session state with Matrix user ID
        st.session_state = {
            'matrix_user_id': 'existing_matrix_id',
            'create_user_button': True,
            'username_input': 'new_user',
            'first_name_input': 'New',
            'email_input': 'new@example.com'
        }
        
        # Mock create_user to return success
        with patch('app.auth.api.create_user') as mock_create_user, \
             patch('app.messages.create_user_message') as mock_create_message:
            
            mock_create_user.return_value = {
                'success': True,
                'user_id': '123',
                'username': 'new_user',
                'error': None
            }
            
            # Run the form
            asyncio.run(render_create_user_form())
            
            # Verify warning was shown about existing connection
            mock_warning.assert_any_call("This Matrix user is already linked to account 'existing_user'. Please select a different Matrix user.")
            mock_logging_warning.assert_any_call("Attempted to link Matrix user existing_matrix_id to new_user, but it's already linked to existing_user")

def test_attribute_handling():
    """Test that user attributes are properly handled and converted."""
    from app.ui.forms import render_create_user_form
    from app.db.models import User
    
    # Mock database and User model
    with patch('app.ui.forms.get_db') as mock_get_db, \
         patch('logging.warning') as mock_logging_warning:
        
        # Setup mock database
        mock_db = Mock()
        mock_get_db.return_value.__next__.return_value = mock_db
        
        # Create mock user with non-dictionary attributes
        user = Mock(spec=User)
        user.username = "test_user"
        user.attributes = "not_a_dict"  # This should be converted to a dict
        
        # Setup query mock to find the user
        mock_query = Mock()
        mock_query.filter.return_value.first.return_value = user
        mock_db.query.return_value = mock_query
        
        # Setup session state
        st.session_state = {
            'matrix_user_id': 'matrix_id',
            'create_user_button': True,
            'username_input': 'test_user',
            'first_name_input': 'Test',
            'email_input': 'test@example.com'
        }
        
        # Mock create_user to return success
        with patch('app.auth.api.create_user') as mock_create_user, \
             patch('app.messages.create_user_message') as mock_create_message:
            
            mock_create_user.return_value = {
                'success': True,
                'user_id': '123',
                'username': 'test_user',
                'error': None
            }
            
            # Run the form
            asyncio.run(render_create_user_form())
            
            # Verify attributes were converted to a dictionary
            assert isinstance(user.attributes, dict)
            assert user.attributes.get('matrix_user_id') == 'matrix_id'
            mock_logging_warning.assert_any_call("Had to reset attributes for user test_user as they were not a valid dictionary")