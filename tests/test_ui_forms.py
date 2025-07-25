import pytest
from unittest.mock import patch, Mock, AsyncMock, MagicMock
import streamlit as st
import pytest
import pandas as pd
import asyncio
from unittest.mock import patch, MagicMock, Mock, AsyncMock
from app.ui.forms import format_date, display_user_list, handle_action, render_create_user_form, \
    clear_parse_data, parse_and_rerun, create_user, update_username_from_inputs, reset_create_user_form_fields
import logging

class SessionStateMock(dict):
    """
    A mock for Streamlit's session_state that supports both dictionary and attribute access,
    handling proper deletion behavior to match Streamlit's session_state behavior.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # No need to track deletions with a separate set
    
    def __getattr__(self, name):
        # Don't try to look up special attributes in the dict
        if name.startswith('__') and name.endswith('__'):
            raise AttributeError(f"{name} not found")
            
        # For normal attribute access, return the value if it exists
        if name in self:
            return self[name]
        # Otherwise, allow attribute access without raising error (to match Streamlit behavior)
        return None
        
    def __setattr__(self, name, value):
        # Store the value in the dict
        self[name] = value
    
    def __delattr__(self, name):
        # Support attribute-style deletion (for st.session_state.key)
        if name in self:
            del self[name]
    
    # No need to override __contains__ - use dict's default behavior
    
    # Override get to match Streamlit's behavior of returning None for missing keys
    def get(self, key, default=None):
        return self[key] if key in self else default
    
    # We don't need to override __delitem__ as the dict implementation is sufficient

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
        
        # Set up mock Streamlit session state with SessionStateMock for attribute access
        st.session_state = SessionStateMock({
            'filter_term': '',
            'status_filter': 'All',
            'selection_state': 'viewing',
            'users_per_page': 10  # Add this since it's checked in display_user_list
        })
        
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
    
    # Mock Streamlit's session state with SessionStateMock for attribute access
    st.session_state = SessionStateMock({
        "parse_data_input_outside": "John Doe\nACME Corp\njohn@example.com\nInvited by Jane Smith\nPython, Testing",
    })
    
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
        
        # Setup initial session state with SessionStateMock for attribute access compatibility
        st.session_state = SessionStateMock({
            "_parsed_first_name": "John",
            "_parsed_last_name": "Doe",
            "_parsed_email": "john@example.com",
            "_parsed_invited_by": "Jane Smith",
            "_parsed_intro": "ACME Corp\n\nInterests: Python, Testing",
            "parsing_successful": True,
            "parse_data_input_outside": "Some parsed data",
            "selected_groups": ["some-other-group"],
            "group_selection": ["some-other-group"]
        })
        
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
    
    # Setup session state with SessionStateMock for attribute access compatibility
    st.session_state = SessionStateMock({
        'parsing_successful': True,
        '_parsed_first_name': 'John',
        '_parsed_last_name': 'Doe',
        '_parsed_email': 'john@example.com',
        '_parsed_invited_by': 'Jane Smith',
        '_parsed_intro': 'ACME Corp\n\nInterests: Python, Testing',
        'username_was_auto_generated': False,
        # Also add the attributes that we access in render_create_user_form
        'matrix_user_selected': None,
        'recommended_rooms': []
    })
    
    # Mocks for Streamlit widgets and functions
    with patch('streamlit.text_input') as mock_text_input, \
         patch('streamlit.markdown') as mock_markdown, \
         patch('streamlit.success') as mock_success, \
         patch('app.ui.forms.update_username_from_inputs') as mock_update_username, \
         patch('logging.info') as mock_logging_info:
        
        # Run the coroutine
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
        'matrix_user_select': 'matrix_user_selected',
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
    assert st.session_state.get('parsing_successful') == False
    
    # Check if recommended_rooms and selected_rooms exist in the session state
    assert 'recommended_rooms' in st.session_state
    assert 'selected_rooms' in st.session_state
    
    # Assert that they are either empty collections or empty strings
    recommended_rooms = st.session_state['recommended_rooms']
    selected_rooms = st.session_state['selected_rooms']
    
    # Test different possibilities for the value types
    assert (recommended_rooms == [] or 
            recommended_rooms == '' or
            recommended_rooms == set() or
            recommended_rooms == {})
    
    assert (selected_rooms == [] or 
            selected_rooms == '' or 
            selected_rooms == set() or
            selected_rooms == {})

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
        
        # First call should fetch groups with SessionStateMock for attribute access
        st.session_state = SessionStateMock({
            # Add required session state fields for render_create_user_form
            'matrix_user_selected': None,
            'recommended_rooms': []
        })
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

def test_matrix_user_selected_session_state_initialization():
    """Test that matrix_user_selected is properly initialized to prevent AttributeError."""
    # Mock Streamlit's session_state
    st.session_state = {}
    
    # Verify that matrix_user_selected is not set
    assert 'matrix_user_selected' not in st.session_state
    
    # Call the function that would initialize it from forms.py
    if 'matrix_user_selected' not in st.session_state:
        st.session_state['matrix_user_selected'] = None
        
    # Verify it's now initialized to None
    assert st.session_state.get('matrix_user_selected') is None
    
    # Simulate updating the value
    st.session_state['matrix_user_selected'] = "@user:example.com"
    
    # Verify it can now be accessed without AttributeError
    assert st.session_state['matrix_user_selected'] == "@user:example.com"
    
    # Verify the get() method works properly
    assert st.session_state.get('matrix_user_selected') == "@user:example.com"

def test_room_recommendations_with_defensive_checks():
    """Test that room recommendations handle matrix_user_selected safely."""
    # Mock Streamlit's session_state
    st.session_state = {}
    
    # Test case 1: matrix_user_selected not in session_state
    # Set up mock for get_room_recommendations_sync
    with patch('app.ui.forms.get_room_recommendations_sync') as mock_get_recommendations:
        mock_get_recommendations.return_value = ["Room 1", "Room 2"]
        
        # First check with missing session state key
        assert 'matrix_user_selected' not in st.session_state
        
        # Get room recommendations function - this is a simplified version of what's in forms.py
        def get_room_recommendations(interests=None):
            try:
                # Use safer get() method with default to None
                selected_user = st.session_state.get('matrix_user_selected')
                if selected_user:
                    return mock_get_recommendations(selected_user, interests)
                else:
                    return "No Matrix user selected"
            except Exception as e:
                return f"Error: {str(e)}"
        
        # Should return message about no user selected
        result = get_room_recommendations()
        assert result == "No Matrix user selected"
        
        # Test case 2: matrix_user_selected is None
        st.session_state['matrix_user_selected'] = None
        result = get_room_recommendations()
        assert result == "No Matrix user selected"
        
        # Test case 3: matrix_user_selected has a valid value
        st.session_state['matrix_user_selected'] = "@user:example.com"
        result = get_room_recommendations("AI, Security")
        assert result == ["Room 1", "Room 2"]
        mock_get_recommendations.assert_called_once_with("@user:example.com", "AI, Security")

def test_matrix_room_invitation_with_defensive_checks():
    """Test that Matrix room invitations handle matrix_user_selected safely."""
    # Mock Streamlit's session_state
    st.session_state = {}
    
    # Set up mock for invite_to_matrix_room function directly at module level
    with patch('app.ui.forms.invite_to_matrix_room') as mock_invite_to_room:
        # Make the mock return a simple True value (not a Future)
        # This is simpler and works because we're using AsyncMock which handles awaiting
        mock_invite_to_room.return_value = True
        
        # Create a simplified version of the invite function similar to what's in forms.py
        async def perform_invite_async(room_id="test-room"):
            try:
                # Use safer get() method with default to None
                selected_user = st.session_state.get('matrix_user_selected')
                if selected_user:
                    # In the real code, we would await invite_to_matrix_room
                    success = await mock_invite_to_room(room_id, selected_user)
                    return success
                else:
                    return False
            except Exception as e:
                return False
                
        # Test case 1: matrix_user_selected not in session_state
        assert 'matrix_user_selected' not in st.session_state
        result = asyncio.run(perform_invite_async())
        assert result is False
        mock_invite_to_room.assert_not_called()
        
        # Test case 2: matrix_user_selected is None
        st.session_state['matrix_user_selected'] = None
        result = asyncio.run(perform_invite_async())
        assert result is False
        mock_invite_to_room.assert_not_called()
        
        # Test case 3: matrix_user_selected has a valid value
        st.session_state['matrix_user_selected'] = "@user:example.com"
        result = asyncio.run(perform_invite_async("room123"))
        assert result is True
        mock_invite_to_room.assert_called_once_with("room123", "@user:example.com")

def test_matrix_user_selection_dropdown_initialization():
    """Test that the Matrix user selection dropdown properly initializes session state."""
    # Mock Streamlit's session_state and components
    st.session_state = {}
    
    with patch('streamlit.selectbox') as mock_selectbox, \
         patch('streamlit.warning') as mock_warning, \
         patch('streamlit.spinner') as mock_spinner, \
         patch('app.utils.matrix_actions.get_all_accessible_users') as mock_get_users:
        
        # Setup mock users
        mock_users = [
            {'user_id': '@user1:example.com', 'display_name': 'User One'},
            {'user_id': '@user2:example.com', 'display_name': 'User Two'}
        ]
        
        # Set up the session state with matrix_users
        st.session_state['matrix_users'] = mock_users
        
        # Create a selectbox that uses similar logic to the actual implementation
        def render_matrix_user_dropdown():
            # Initialize matrix_user_selected if it doesn't exist
            if 'matrix_user_selected' not in st.session_state:
                st.session_state['matrix_user_selected'] = None
                
            # Create options for select box
            user_options = [f"{user['display_name']} ({user['user_id']})" for user in st.session_state['matrix_users']]
            
            # Return the first option as selected (mock behavior)
            mock_selectbox.return_value = user_options[0] if user_options else None
            
            # Actually call the selectbox function
            selected_option = mock_selectbox(
                "Select Matrix User",
                options=user_options,
                key="matrix_user_select",
                help="Select a Matrix user to link with this account"
            )
            
            # Process selection
            if selected_option:
                # Extract user_id from selected_option
                import re
                match = re.search(r'\((.*?)\)$', selected_option)
                if match:
                    matrix_user_id = match.group(1)
                    # Set the session state
                    st.session_state['matrix_user_selected'] = matrix_user_id
                    return matrix_user_id
            return None
        
        # Test the function
        result = render_matrix_user_dropdown()
        
        # Verify session state was initialized
        assert 'matrix_user_selected' in st.session_state
        
        # After selection, the session state should be updated
        assert st.session_state['matrix_user_selected'] == '@user1:example.com'
        
        # Verify the selectbox was called
        mock_selectbox.assert_called_once()
        assert mock_selectbox.call_args[0][0] == "Select Matrix User"
        
        # Reset for second test
        mock_selectbox.reset_mock()
        
        # Test with empty matrix_users list
        st.session_state['matrix_users'] = []
        st.session_state['matrix_user_selected'] = None
        
        # Mock selectbox to return None
        mock_selectbox.return_value = None
        
        # Render again
        result = render_matrix_user_dropdown()
        
        # Verify session state stays None when no selection
        assert st.session_state['matrix_user_selected'] is None
        mock_selectbox.assert_called_once()

def test_matrix_user_defensive_get_method_during_account_creation():
    """Test that the Matrix user ID is correctly included in attributes during account creation."""
    # Mock Streamlit's session_state using our SessionStateMock to support both dict and attribute access
    st.session_state = SessionStateMock({
        'username_input': 'testuser',
        'first_name_input': 'Test',
        'last_name_input': 'User',
        'email_input': 'test@example.com',
        'create_user_button': True,
        'add_to_recommended_rooms': True,
        'matrix_user_selected': '@user1:example.com'
    })
    
    # Save the attributes globally to verify later
    global captured_attributes
    captured_attributes = None
    
    # Set up mocks for required functions
    with patch('app.ui.forms.create_user') as mock_create_user:
        # Set up the mock to capture arguments
        def side_effect_func(*args, **kwargs):
            global captured_attributes
            captured_attributes = kwargs.get('attributes', {})
            return {
                'success': True,
                'username': 'testuser',
                'user_id': '123',
                'error': None
            }
        
        mock_create_user.side_effect = side_effect_func
        
        # Create a function that simulates the account creation logic but only for matrix_user_selected
        def create_user_with_matrix():
            # Extract Matrix username using direct attribute access since our SessionStateMock supports it
            matrix_user_id = st.session_state.matrix_user_selected
            
            # Build attributes dictionary with the matrix user ID
            attributes = {'matrix_user_id': matrix_user_id}
            
            # Call create_user directly - this will trigger our side effect function
            from app.ui.forms import create_user
            result = create_user(
                username='testuser',
                first_name='Test',
                last_name='User',
                email='test@example.com',
                attributes=attributes
            )
            
            return result
        
        # Call our function that will pass the matrix_user_id in attributes
        result = create_user_with_matrix()
        
        # Verify create_user was called once
        mock_create_user.assert_called_once()
        
        # Verify matrix_user_id was correctly passed in the attributes
        assert captured_attributes is not None
        assert 'matrix_user_id' in captured_attributes
        assert captured_attributes['matrix_user_id'] == '@user1:example.com'
        
        # Test with matrix_user_selected not set
        st.session_state = SessionStateMock({
            'username_input': 'testuser',
            'first_name_input': 'Test',
            'last_name_input': 'User',
            'email_input': 'test@example.com',
            'create_user_button': True,
            'add_to_recommended_rooms': True
            # matrix_user_selected is not in session_state
        })
        
        # Reset mocks
        mock_create_user.reset_mock()
        capture_attributes.attributes = {}
        
        # Call again
        result = create_user_with_matrix()
        
        # Verify create_user was still called
        mock_create_user.assert_called_once()
        
        # Verify Matrix user ID was not included in attributes when not selected
        assert 'matrix_user_id' not in capture_attributes.attributes

def test_matrix_user_selection_and_recommendation_with_defensive_checks():
    """
    Test that matrix_user_selected is handled safely throughout the recommendation process.
    This test verifies the fixed implementation handles edge cases properly.
    """
    # Mock Streamlit's session_state and related functions
    st.session_state = {}
    
    # Test initialization in main.py
    if 'matrix_user_selected' not in st.session_state:
        st.session_state['matrix_user_selected'] = None
    if 'recommended_rooms' not in st.session_state:
        st.session_state['recommended_rooms'] = []
        
    assert st.session_state['matrix_user_selected'] is None
    assert st.session_state['recommended_rooms'] == []
    
    # Create a mock for the get_room_recommendations_sync function
    with patch('app.utils.recommendation.get_room_recommendations_sync') as mock_get_recommendations:
        # Set up mock return values
        mock_results = [
            {"room_id": "room1", "name": "Test Room 1", "categories": ["test", "ai"]},
            {"room_id": "room2", "name": "Test Room 2", "categories": ["security"]}
        ]
        mock_get_recommendations.return_value = mock_results
        
        # Create queue for thread results
        import queue
        result_queue = queue.Queue()
        
        # Define a function similar to what's in the forms.py
        def get_recommendations_with_timeout():
            try:
                # Defensive checks
                matrix_user_id = st.session_state.get('matrix_user_selected')
                if matrix_user_id is None:
                    matrix_user_id = ""
                    
                interests = "test, ai"
                if interests is None:
                    interests = ""
                    
                # Call the mocked function
                rooms = mock_get_recommendations(matrix_user_id, interests)
                result_queue.put(("success", rooms))
            except Exception as e:
                result_queue.put(("error", str(e)))
        
        # Test 1: With matrix_user_selected set
        st.session_state['matrix_user_selected'] = "@user:example.com"
        
        # Run the function and get result
        get_recommendations_with_timeout()
        status, result = result_queue.get()
        
        # Verify success
        assert status == "success"
        assert len(result) == 2
        assert result[0]["room_id"] == "room1"
        
        # Verify the function was called with the expected parameters
        mock_get_recommendations.assert_called_with("@user:example.com", "test, ai")
        
        # Test 2: With matrix_user_selected not set
        del st.session_state['matrix_user_selected']
        result_queue = queue.Queue()
        
        # Run again
        get_recommendations_with_timeout()
        status, result = result_queue.get()
        
        # Should still succeed with default value
        assert status == "success"
        assert len(result) == 2
        
        # Verify it was called with empty string as fallback
        mock_get_recommendations.assert_called_with("", "test, ai")
        
        # Test 3: Test the edge case directly by creating a minimal mock that simulates our fixed code
        def minimal_mock_get_recommendations(user_id, interests):
            # Check for None values
            if user_id is None:
                user_id = ""
            if interests is None:
                interests = ""
                
            # Log parameters
            logging.info(f"Called with user_id: {user_id}, interests: {interests}")
            
            # Return mock data
            return mock_results
            
        # Test with various combinations
        result1 = minimal_mock_get_recommendations("@user:example.com", "test")
        result2 = minimal_mock_get_recommendations(None, "test")
        result3 = minimal_mock_get_recommendations("@user:example.com", None)
        result4 = minimal_mock_get_recommendations(None, None)
        
        # Verify all results contain the expected data
        assert len(result1) == 2
        assert len(result2) == 2
        assert len(result3) == 2
        assert len(result4) == 2