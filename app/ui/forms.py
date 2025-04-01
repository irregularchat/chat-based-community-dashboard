# ui/forms.py
import streamlit as st
import logging
import asyncio
import requests
import time
import warnings
import pandas as pd
import json
import numpy as np
import traceback
from datetime import datetime, timedelta
from pytz import timezone
from app.utils.transformations import parse_input
from app.utils.config import Config
from app.utils.helpers import (
    update_username,
    create_unique_username,
    handle_form_submission,
    reset_create_user_form_fields,
    get_eastern_time,
    add_timeline_event,
    safety_number_change_email
)
from app.db.database import get_db
# Import the Invite model if available (for backward compatibility)
try:
    from app.db.models import Invite, User
except ImportError:
    # Define placeholder classes that won't be used
    class Invite:
        pass
    class User:
        pass
    logging.warning("Models not found in app.db.models. Using placeholders.")
from app.db.operations import search_users, AdminEvent
from st_aggrid import AgGrid, GridOptionsBuilder, DataReturnMode, GridUpdateMode, ColumnsAutoSizeMode
from app.auth.api import (
    create_user,
    list_users,
    update_user_status,
    update_user_email,
    force_password_reset,
    delete_user,
    update_user_intro,
    update_user_invited_by,
    create_invite
)
from app.auth.admin import get_user_details
from app.messages import create_user_message, create_invite_message

def reset_create_user_form_fields():
    """Helper function to reset all fields related to create user."""
    keys_to_reset = [
        "username_input",
        "first_name_input",
        "last_name_input",
        "email_input",
        "invited_by_input",
        "data_to_parse_input",
        "intro_input",
        "is_admin_checkbox",
        "selected_groups",
        "group_selection"
    ]
    
    # Set a flag in session state to indicate we should clear fields
    st.session_state['clear_fields'] = True
    
    # Store current values temporarily to detect changes
    old_values = {key: st.session_state.get(key, "") for key in keys_to_reset}
    st.session_state['old_values'] = old_values
    
    # Clear the values
    for key in keys_to_reset:
        if key in st.session_state:
            if key in ["selected_groups", "group_selection"]:
                st.session_state[key] = []
            else:
                st.session_state[key] = ""

def parse_and_rerun():
    """Callback to parse data and rerun the script so widgets see updated session state."""
    # Check if input is empty
    if not st.session_state["data_to_parse_input"].strip():
        return  # Just return if there's no data to parse
    
    # Parse the data from the text area
    parsed = parse_input(st.session_state["data_to_parse_input"])
    
    # Check for error in parsed data
    if isinstance(parsed, dict) and "error" in parsed:
        st.error(parsed["error"])
        return
    
    if not parsed or (isinstance(parsed, tuple) and parsed[1] is False):
        st.error("Could not parse the input text")
        return

    # Update session state with safer dictionary access
    st.session_state["first_name_input"] = parsed.get("first_name", st.session_state["first_name_input"])
    st.session_state["last_name_input"] = parsed.get("last_name", st.session_state["last_name_input"])
    st.session_state["email_input"] = parsed.get("email", st.session_state["email_input"])
    st.session_state["invited_by_input"] = parsed.get("invited_by", st.session_state["invited_by_input"])
    
    # Safely access nested intro fields and combine organization and interests
    intro_data = parsed.get("intro", {})
    org = intro_data.get("organization", "")
    interests = intro_data.get("interests", "")
    combined_intro = f"{org}\n\nInterests: {interests}" if interests else org
    st.session_state["intro_input"] = combined_intro

    # Rerun so the text inputs see the updated session state
    st.rerun()

def clear_parse_data():
    """Callback to clear the parsed data and rerun the script."""
    # Set a flag to indicate that data should be cleared
    st.session_state["clear_parse_data_flag"] = True
    # Also clear any previously parsed data
    for key in ['first_name_input', 'last_name_input', 'username_input', 
               'email_input', 'invited_by_input', 'intro_input']:
        if key in st.session_state:
            st.session_state[key] = ""
    # Rerun to apply changes
    st.rerun()

async def render_create_user_form():
    """Render the create user form with an improved layout and group selection"""
    # Initialize session state variables if they don't exist
    for key in ['first_name_input', 'last_name_input', 'username_input', 
                'email_input', 'invited_by_input', 'intro_input', 'selected_groups']:
        if key not in st.session_state:
            st.session_state[key] = "" if key != 'selected_groups' else []

    # Check if data was cleared
    was_cleared = st.session_state.get("clear_parse_data_flag", False)
    if was_cleared:
        # Reset the flag
        st.session_state["clear_parse_data_flag"] = False

    # Get database connection
    db = next(get_db())
    
    # Define callback to update username when first or last name changes
    def update_username_from_inputs():
        # Only auto-generate username if username is empty or matches previous auto-generation
        # This prevents overwriting a manually entered username
        if (not st.session_state.get('username_input') or 
            st.session_state.get('username_was_auto_generated', False)):
            
            first_name = st.session_state.get('first_name_input', '').strip().lower()
            last_name = st.session_state.get('last_name_input', '').strip().lower()
            
            # Generate username even with partial information
            if first_name or last_name:
                # Handle different combinations of first/last name
                if first_name and last_name:
                    # First name and first letter of last name
                    base_username = f"{first_name}-{last_name[0]}"
                elif first_name:
                    # Just first name if that's all we have
                    base_username = first_name
                else:
                    # Just last name if that's all we have
                    base_username = last_name
                
                # Replace spaces with hyphens
                base_username = base_username.replace(" ", "-")
                
                # Check for existing username in local database
                local_existing = db.query(User).filter(User.username.like(f"{base_username}%")).all()
                local_usernames = [user.username for user in local_existing]
                
                # Also check for existing username in Authentik SSO
                try:
                    headers = {
                        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
                        'Content-Type': 'application/json'
                    }
                    
                    sso_usernames = []
                    user_search_url = f"{Config.AUTHENTIK_API_URL}/core/users/?username__startswith={base_username}"
                    response = requests.get(user_search_url, headers=headers, timeout=10)
                    
                    if response.status_code == 200:
                        users = response.json().get('results', [])
                        sso_usernames = [user['username'] for user in users]
                    
                    # Combine both lists of existing usernames
                    existing_usernames = list(set(local_usernames + sso_usernames))
                    
                    # Generate unique username
                    if base_username not in existing_usernames:
                        final_username = base_username
                    else:
                        suffix = 1
                        while f"{base_username}{suffix}" in existing_usernames:
                            suffix += 1
                        final_username = f"{base_username}{suffix}"
                    
                    # Update session state
                    st.session_state['username_input'] = final_username
                    st.session_state['username_was_auto_generated'] = True
                    
                except Exception as e:
                    # If there's an error checking SSO, fall back to just local check
                    logging.error(f"Error checking SSO for existing usernames: {e}")
                    suggested_username = create_unique_username(db, base_username)
                    st.session_state['username_input'] = suggested_username
                    st.session_state['username_was_auto_generated'] = True

    # Define callbacks for first and last name changes
    def on_first_name_change():
        update_username_from_inputs()
        # Force rerun after username update for immediate feedback
        st.rerun()
    
    def on_last_name_change():
        update_username_from_inputs()
        # Force rerun after username update for immediate feedback
        st.rerun()
        
    def on_username_manual_edit():
        # Set flag to prevent auto-updates
        st.session_state['username_was_auto_generated'] = False

    # Run username update on initialization if we have some name data
    if (st.session_state.get('first_name_input') or st.session_state.get('last_name_input')) and not st.session_state.get('username_input'):
        update_username_from_inputs()

    # Create tabs for different input methods
    create_tabs = st.tabs(["Manual Create", "Auto Create", "Advanced Options"])
    
    with create_tabs[0]:
        # Input fields outside the form for first name and last name to handle on_change
        st.subheader("Manual Create")
        st.info("Enter your information below to create a new user. The username will be automatically generated based on your first and last name.")
        
        col1_outside, col2_outside = st.columns(2)
        
        with col1_outside:
            st.text_input(
                "First Name *",
                key="first_name_input_outside",
                placeholder="e.g., John",
                help="User's first name (required)",
                on_change=on_first_name_change
            )
            
            # If the session state is updated by the on_change, sync it to the actual form input
            if 'first_name_input_outside' in st.session_state:
                st.session_state['first_name_input'] = st.session_state['first_name_input_outside']
        
        with col2_outside:
            st.text_input(
                "Last Name *",
                key="last_name_input_outside",
                placeholder="e.g., Doe",
                help="User's last name (required)",
                on_change=on_last_name_change
            )
            
            # If the session state is updated by the on_change, sync it to the actual form input
            if 'last_name_input_outside' in st.session_state:
                st.session_state['last_name_input'] = st.session_state['last_name_input_outside']
        
        # Username field outside form to handle manual edits
        username_value = st.session_state.get('username_input', '')
        st.text_input(
            "Username *",
            key="username_input_outside",
            placeholder="e.g., johndoe123",
            help="Username for login (required, must be unique). Auto-generated based on name.",
            on_change=on_username_manual_edit
        )
        
        # Sync the username from outside to inside form
        if 'username_input_outside' in st.session_state:
            st.session_state['username_input'] = st.session_state['username_input_outside']
            
        if st.session_state.get('username_was_auto_generated', False):
            st.caption("Username auto-generated. Edit to create custom username.")
        
        # Add a divider before the form
        st.divider()
        st.caption("Review the information above and click 'Create User' when ready.")
            
        # Now create the actual form with hidden fields that will be submitted
        with st.form("create_user_form"):
            # Store the values in hidden form fields
            st.session_state['first_name_input'] = st.session_state.get('first_name_input_outside', '')
            st.session_state['last_name_input'] = st.session_state.get('last_name_input_outside', '')
            st.session_state['username_input'] = st.session_state.get('username_input_outside', '')
            
            # Create two columns for better layout
            col1, col2 = st.columns(2)
            
            with col1:
                # Email field (not duplicated)
                st.text_input(
                    "Email Address",
                    key="email_input",
                    placeholder="e.g., johndoe@example.com",
                    help="Email address for password resets and notifications"
                )
            
            with col2:
                st.text_input(
                    "Invited by",
                    key="invited_by_input",
                    placeholder="e.g., @janedoe",
                    help="Who invited this user to the platform"
                )
                
                # Get all available groups
                from app.auth.admin import get_authentik_groups
                all_groups = get_authentik_groups()
                
                # Group selection
                if all_groups:
                    # Initialize selected_groups if not in session state
                    if 'selected_groups' not in st.session_state:
                        st.session_state['selected_groups'] = []
                    
                    # Find the main group ID if configured
                    main_group_id = Config.MAIN_GROUP_ID
                    
                    # Pre-select the main group if it exists
                    default_selection = [main_group_id] if main_group_id else []
                    
                    # Group selection with multiselect
                    selected_groups = st.multiselect(
                        "Assign to Groups",
                        options=[g.get('pk') for g in all_groups],
                        default=default_selection,
                        format_func=lambda pk: next((g.get('name') for g in all_groups if g.get('pk') == pk), pk),
                        help="Select groups to assign the user to",
                        key="group_selection"
                    )
                    
                    # Store in session state
                    st.session_state['selected_groups'] = selected_groups
            
            # Introduction text
            st.text_area(
                "Introduction",
                key="intro_input",
                height=100,
                placeholder="e.g., Software Engineer at TechCorp with interests in AI and machine learning",
                help="User's introduction or bio"
            )
            
            # Add admin checkbox (only visible to admins)
            is_admin = False
            # Check if current user is an admin
            from app.auth.admin import check_admin_permission
            current_username = st.session_state.get("username", "")
            if current_username and check_admin_permission(current_username):
                is_admin = st.checkbox("Grant Admin Privileges", key="is_admin_checkbox", 
                                      help="Make this user an administrator with full access to all features")
            
            # Submit buttons
            col1, col2, col3 = st.columns([1, 1, 1])
            with col1:
                submit_button = st.form_submit_button("Create User")
            with col2:
                clear_button = st.form_submit_button("Clear Form")
            with col3:
                # This is just a placeholder for layout balance
                st.write("")
            
            # Display required fields note
            st.markdown("**Note:** Fields marked with * are required")
    
    
    with create_tabs[1]:
        st.subheader("Auto Create Users")
        
        st.markdown("""
        ### Instructions
        Enter user details in the text area below. Each user should be in the following format:
        ```
        1. Full Name
        2. Organization/Company
        3. Invited by (username or email)
        4. Email Address
        5. Interests or additional information
        ```
        
        The system will attempt to parse this information and create user accounts automatically.
        """)
        
        st.markdown("""
        <style>
        .data-to-parse {
            background-color: #e0e0e0; 
            padding: 10px;
            border-radius: 5px;
        }
        </style>
        """, unsafe_allow_html=True)
        
        st.markdown('<div class="data-to-parse">', unsafe_allow_html=True)
        
        # Check if we should show cleared message
        if was_cleared:
            st.info("Data has been cleared. Enter new data below.")
        
        st.text_area(
            "User Data to Parse",
            key="data_to_parse_input",
            height=200,
            placeholder=("Please enter user details (each on a new line):\n"
                         "1. What's Your Name\n"
                         "2. What org are you with\n"
                         "3. Who invited you (add and mention them in this chat)\n"
                         "4. Your Email or Email-Alias/Mask (for password resets and safety number verifications)\n"
                         "5. Your Interests (so we can get you to the right chats)"),
            value="" if was_cleared else None  # Set to empty string when cleared
        )
        st.markdown('</div>', unsafe_allow_html=True)
        
        col1, col2 = st.columns(2)
        with col1:
            if st.button("Parse Data", key="parse_button", on_click=parse_and_rerun):
                pass  # The on_click handler will handle this
        with col2:
            if st.button("Clear Data", key="clear_data_button", on_click=clear_parse_data):
                pass  # The on_click handler will handle this

    with create_tabs[2]:
        st.subheader("Advanced User Options")
        
        # This section could include additional options like:
        # - Custom attributes
        # - User expiration
        # - Initial password settings
        # - Notification preferences
        
        st.info("Advanced user options will be available in a future update.")
    # Handle form submission
    if submit_button:
        # Validate required fields
        if not st.session_state.get('first_name_input'):
            st.error("First name is required.")
            return
        
        if not st.session_state.get('last_name_input'):
            st.error("Last name is required.")
            return
        
        if not st.session_state.get('username_input'):
            st.error("Username is required.")
            return
        
        # Get admin status from checkbox
        is_admin = st.session_state.get('is_admin_checkbox', False)
        
        # Handle the form submission with admin status
        from app.auth.api import create_user
        
        # Get form values
        username = st.session_state.get('username_input', '')
        full_name = f"{st.session_state.get('first_name_input', '')} {st.session_state.get('last_name_input', '')}".strip()
        email = st.session_state.get('email_input', '')
        invited_by = st.session_state.get('invited_by_input', '')
        intro = st.session_state.get('intro_input', '')
        selected_groups = st.session_state.get('selected_groups', [])
        
        if username and full_name:
            with st.spinner("Creating user..."):
                # Call create_user with admin status
                # Directly await the create_user function instead of using asyncio.run()
                success, username, password, discourse_url = await create_user(
                    username=username,
                    full_name=full_name,
                    email=email,
                    invited_by=invited_by,
                    intro=intro,
                    is_admin=is_admin,
                    groups=selected_groups
                )
                
                if success:
                    from app.messages import create_user_message
                    create_user_message(username, password, discourse_url)
                    
                    # Add user to selected groups if not already handled in create_user
                    if selected_groups and not Config.MAIN_GROUP_ID:
                        from app.auth.admin import manage_user_groups
                        
                        # Get the user ID from the API response
                        headers = {
                            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
                            'Content-Type': 'application/json'
                        }
                        
                        # Search for the newly created user
                        users = list_users(Config.AUTHENTIK_API_URL, headers, username)
                        user_id = next((user.get('pk') for user in users if user.get('username') == username), None)
                        
                        if user_id:
                            # Add user to selected groups
                            manage_user_groups(
                                st.session_state.get("username", "system"),
                                user_id,
                                groups_to_add=selected_groups
                            )
                    
                    # Reset form fields after successful submission
                    reset_create_user_form_fields()
                    st.rerun()
                else:
                    st.error(f"Failed to create user: {password}")  # password contains error message on failure
        else:
            st.error("Username and full name are required.")

    # Reset fields on Clear
    if clear_button:
        reset_create_user_form_fields()
        st.rerun()

    # Return the form values
    return (
        st.session_state["first_name_input"],
        st.session_state["last_name_input"],
        st.session_state["username_input"],
        st.session_state["email_input"],
        st.session_state["invited_by_input"],
        st.session_state["intro_input"],
        st.session_state.get("is_admin_checkbox", False),
        st.session_state.get("selected_groups", []),
        submit_button
    )

async def render_invite_form():
    """Render the invite form"""
    # Initialize session state
    if 'invite_email' not in st.session_state:
        st.session_state['invite_email'] = ""
    if 'invite_message' not in st.session_state:
        st.session_state['invite_message'] = ""

    with st.form("invite_form"):
        invite_label = st.text_input("Invite Label", key="invite_label", 
                                    help="A label to identify this invite (e.g., 'event-august-2025')")
        
        # Get the current Eastern Time
        eastern = timezone('US/Eastern')
        eastern_now = datetime.now(eastern)
        expires_default = eastern_now + timedelta(hours=2)
        
        # Use the Eastern time values for the date/time inputs
        expires_date = st.date_input("Enter Expiration Date", value=expires_default.date(), key="expires_date")
        expires_time = st.time_input("Enter Expiration Time", value=expires_default.time(), key="expires_time")
        #TODO: Add option to send invite to user directly , still show the invite code. 
        #TODO: Add option for single use or the default of time expiration.   
        custom_message = st.text_area("Custom Message (Optional)", key="custom_message",
                                     help="Add any additional instructions or context for the invite")
        
        submit_button = st.form_submit_button("Create Invite")
    
    # Handle the invite creation when submit is pressed
    if submit_button:
        try:
            # Combine date and time into a datetime object
            expires_datetime = datetime.combine(expires_date, expires_time)
            
            # Localize to Eastern time
            eastern = timezone('US/Eastern')
            expires_datetime = eastern.localize(expires_datetime)
            
            # Convert to ISO format for the API
            expires_iso = expires_datetime.isoformat()
            
            # Get headers for API request
            headers = {
                'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
                'Content-Type': 'application/json'
            }
            
            # Create the invite
            try:
                invite_result = create_invite(
                    headers=headers,
                    label=invite_label,
                    expires=expires_iso
                )
                
                # Handle different return formats
                if isinstance(invite_result, tuple) and len(invite_result) >= 2:
                    invite_url, expires = invite_result
                elif isinstance(invite_result, tuple):
                    # Handle case where we get more or fewer values than expected
                    invite_url = invite_result[0] if len(invite_result) > 0 else None
                    expires = invite_result[1] if len(invite_result) > 1 else None
                else:
                    # Handle case where we don't get a tuple
                    invite_url = invite_result
                    expires = expires_iso
                
                if invite_url:
                    # Create and display the invite message
                    create_invite_message(
                        label=invite_label,
                        invite_url=invite_url,
                        expires_datetime=expires_datetime
                    )
                    
                    # Add custom message if provided
                    if st.session_state.get("custom_message"):
                        st.markdown("### Additional Message:")
                        st.markdown(st.session_state.get("custom_message"))
                else:
                    st.error("Failed to create invite. Please check your settings and try again.")
                
            except Exception as e:
                logging.error(f"Error creating invite: {e}")
                st.error(f"An error occurred: {str(e)}")
                
        except Exception as e:
            logging.error(f"Error creating invite: {e}")
            st.error(f"An error occurred: {str(e)}")
    
    return (
        st.session_state.get('invite_message', ''),
        submit_button
    )

async def display_user_list(auth_api_url=None, headers=None):
    """Display the list of users with enhanced filtering and UI."""
    if auth_api_url is None:
        auth_api_url = Config.AUTHENTIK_API_URL
    if headers is None:
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
    
    # Initialize session state
    if 'user_list' not in st.session_state:
        st.session_state['user_list'] = get_users_from_db()
    if 'selection_state' not in st.session_state:
        st.session_state['selection_state'] = 'viewing'  # States: viewing, selected
    if 'selected_user_ids' not in st.session_state:
        st.session_state['selected_user_ids'] = []
    if 'filter_term' not in st.session_state:
        st.session_state['filter_term'] = ""
    if 'status_filter' not in st.session_state:
        st.session_state['status_filter'] = "All"
    
    # Process any pending actions
    if 'pending_action' in st.session_state:
        action = st.session_state['pending_action']['action']
        selected_users = st.session_state['pending_action']['selected_users']
        action_params = st.session_state['pending_action'].get('action_params', {})
        
        # Handle the action
        success = handle_action(action, selected_users, action_params, headers)
        
        # Clear the pending action
        del st.session_state['pending_action']
        
        # Reset state after action
        if success:
            st.session_state['user_list'] = get_users_from_db()
            st.session_state['selected_user_ids'] = []
            st.session_state['selection_state'] = 'viewing'
            
    try:
        st.write("## User Management")
        
        # Create filter section with columns for better layout
        st.subheader("Filter Users")
        filter_col1, filter_col2 = st.columns(2)
        
        with filter_col1:
            # Search by name, username, or email
            filter_term = st.text_input(
                "Search by name, username, or email", 
                value=st.session_state['filter_term'],
                key="filter_input"
            )
            st.session_state['filter_term'] = filter_term
        
        with filter_col2:
            # Filter by status
            status_options = ['All', 'Active', 'Inactive']
            status_filter = st.selectbox(
                "Filter by status",
                options=status_options,
                index=status_options.index(st.session_state['status_filter']),
                key="status_filter_select"
            )
            st.session_state['status_filter'] = status_filter
        
        # Simple UI with two states: selecting users and performing actions
        if st.session_state['selection_state'] == 'viewing':
            # STEP 1: SELECT USERS
            st.write("### Step 1: Select Users")
            
            # Convert user list to DataFrame
            df = pd.DataFrame(st.session_state['user_list'])
            
            # Apply filters
            if st.session_state['filter_term']:
                # Search in username, name, and email
                search_term = st.session_state['filter_term'].lower()
                df = df[
                    df['username'].str.lower().str.contains(search_term, na=False) |
                    df['name'].str.lower().str.contains(search_term, na=False) |
                    df['email'].str.lower().str.contains(search_term, na=False)
                ]
            
            # Apply status filter
            if st.session_state['status_filter'] != 'All':
                is_active = st.session_state['status_filter'] == 'Active'
                df = df[df['is_active'] == is_active]
            
            # Process fields for display
            if not df.empty:
                # Process fields
                df['intro'] = df.apply(
                    lambda row: row.get('attributes', {}).get('intro', '') 
                    if isinstance(row.get('attributes'), dict) else '', 
                    axis=1
                )
                df['last_login'] = df.apply(
                    lambda row: format_date(row.get('last_login')) if row.get('last_login') else '',
                    axis=1
                )
                df['is_active'] = df['is_active'].apply(lambda x: '✅ Active' if x else '❌ Inactive')
                df['invited_by'] = df.apply(
                    lambda row: row.get('attributes', {}).get('invited_by', '') 
                    if isinstance(row.get('attributes'), dict) else '', 
                    axis=1
                )
                
                # Create selection columns with unique IDs for each row
                if 'pk' in df.columns:
                    # Display the table with selection columns
                    cols_to_display = ['username', 'name', 'email', 'is_active', 'last_login']
                    st.write(f"Found {len(df)} users matching your filters")
                    
                    # Using Streamlit's data editor for selection
                    # Store selected rows from previous state if any
                    if 'selected_rows_indices' not in st.session_state:
                        st.session_state['selected_rows_indices'] = []
                    
                    edited_df = st.data_editor(
                        df[cols_to_display],
                        hide_index=True,
                        key="user_table",
                        use_container_width=True,
                        column_config={
                            "username": st.column_config.TextColumn("Username"),
                            "name": st.column_config.TextColumn("Name"),
                            "email": st.column_config.TextColumn("Email"),
                            "is_active": st.column_config.TextColumn("Status"),
                            "last_login": st.column_config.TextColumn("Last Login")
                        },
                        disabled=cols_to_display,
                        height=400
                    )
                    
                    # Add a multi-select to choose users
                    st.write("Select users from the list:")
                    selected_usernames = st.multiselect(
                        "Select Users",
                        options=df['username'].tolist(),
                        default=[],
                        key="selected_usernames"
                    )
                    
                    # Get selected rows based on username
                    if selected_usernames:
                        # Get the selected user IDs
                        selected_user_ids = df[df['username'].isin(selected_usernames)]['pk'].tolist()
                        
                        # Display selection info
                        st.success(f"Selected {len(selected_user_ids)} users")
                        
                        # Store selected users
                        st.session_state['selected_user_ids'] = selected_user_ids
                        st.session_state['selected_users'] = [
                            df[df['pk'] == user_id].to_dict('records')[0] 
                            for user_id in selected_user_ids
                        ]
                        
                        # Continue button
                        if st.button("Continue to Actions", key="continue_button"):
                            st.session_state['selection_state'] = 'selected'
                            st.rerun()
                    else:
                        st.info("Please select at least one user to continue.")
                        
            else:
                st.warning("No users match the filter criteria.")
                
        elif st.session_state['selection_state'] == 'selected':
            # STEP 2: PERFORM ACTIONS
            st.write("### Step 2: Choose an Action")
            
            # Get selected users data
            selected_users = st.session_state.get('selected_users', [])
            
            # Display selected usernames
            selected_usernames = [user.get('username', 'Unknown') for user in selected_users]
            st.write(f"**Selected Users:** {', '.join(selected_usernames)}")
            
            # Create tabs for different action categories
            action_tabs = st.tabs(["Account Actions", "Group Management", "Profile Updates"])
            
            # Tab 1: Account Actions
            with action_tabs[0]:
                st.subheader("Account Actions")
                
                # Action selection
                account_action = st.selectbox(
                    "Select Action",
                    ["Activate Users", "Deactivate Users", "Reset Password", "Delete Users"],
                    key="account_action_selection"
                )
                
                # Warning for destructive actions
                if account_action in ["Deactivate Users", "Delete Users"]:
                    st.warning(f"⚠️ {account_action} is a potentially destructive action. Please confirm you want to proceed.")
                
                # Confirmation checkbox for destructive actions
                confirm = True
                if account_action in ["Deactivate Users", "Delete Users"]:
                    confirm = st.checkbox("I confirm I want to perform this action", key="confirm_destructive")
                
                if st.button("Apply Account Action", key="apply_account_action", disabled=not confirm):
                    # Map the action to the internal action name
                    action_map = {
                        "Activate Users": "Activate",
                        "Deactivate Users": "Deactivate",
                        "Reset Password": "Reset Password",
                        "Delete Users": "Delete"
                    }
                    
                    # Store action and selected users
                    st.session_state['pending_action'] = {
                        'action': action_map[account_action],
                        'selected_users': selected_users
                    }
                    st.rerun()
            
            # Tab 2: Group Management
            with action_tabs[1]:
                st.subheader("Group Management")
                
                # Get all available groups
                from app.auth.admin import get_authentik_groups
                all_groups = get_authentik_groups()
                
                if not all_groups:
                    st.info("No groups available. Please create groups first.")
                else:
                    # Create two columns for add/remove operations
                    col1, col2 = st.columns(2)
                    
                    with col1:
                        st.write("**Add to Groups**")
                        groups_to_add = st.multiselect(
                            "Select groups to add users to",
                            options=[g.get('pk') for g in all_groups],
                            format_func=lambda pk: next((g.get('name') for g in all_groups if g.get('pk') == pk), pk),
                            key="groups_to_add"
                        )
                        
                        if groups_to_add and st.button("Add to Selected Groups", key="add_to_groups_btn"):
                            # Store action and selected users
                            st.session_state['pending_action'] = {
                                'action': "Add to Groups",
                                'selected_users': selected_users,
                                'action_params': {'groups_to_add': groups_to_add}
                            }
                            st.rerun()
                    
                    with col2:
                        st.write("**Remove from Groups**")
                        groups_to_remove = st.multiselect(
                            "Select groups to remove users from",
                            options=[g.get('pk') for g in all_groups],
                            format_func=lambda pk: next((g.get('name') for g in all_groups if g.get('pk') == pk), pk),
                            key="groups_to_remove"
                        )
                        
                        if groups_to_remove and st.button("Remove from Selected Groups", key="remove_from_groups_btn"):
                            # Store action and selected users
                            st.session_state['pending_action'] = {
                                'action': "Remove from Groups",
                                'selected_users': selected_users,
                                'action_params': {'groups_to_remove': groups_to_remove}
                            }
                            st.rerun()
            
            # Tab 3: Profile Updates
            with action_tabs[2]:
                st.subheader("Profile Updates")
                
                # Profile action selection
                profile_action = st.selectbox(
                    "Select Action",
                    ["Update Email", "Add Intro", "Add Invited By", "Verify Safety Number Change"],
                    key="profile_action_selection"
                )
                
                # Show additional inputs based on the selected action
                action_params = {}
                
                if profile_action == "Update Email":
                    st.info("This action is only applicable when a single user is selected.")
                    if len(selected_users) == 1:
                        user = selected_users[0]
                        new_email = st.text_input(
                            f"New email for {user.get('username')}",
                            value=user.get('email', ''),
                            key="new_email_input"
                        )
                        action_params['new_email'] = new_email
                    else:
                        st.warning("Please select only one user for email updates.")
                
                elif profile_action == "Add Intro":
                    intro_text = st.text_area(
                        "Enter Introduction Text",
                        key="intro_text_input",
                        height=100,
                        help="This will be added to all selected users"
                    )
                    action_params['intro_text'] = intro_text
                
                elif profile_action == "Add Invited By":
                    invited_by = st.text_input(
                        "Enter Invited By",
                        key="invited_by_input",
                        help="Who invited these users to the platform"
                    )
                    action_params['invited_by'] = invited_by
                
                elif profile_action == "Verify Safety Number Change":
                    st.info("This will send verification emails to all selected users.")
                
                if st.button("Apply Profile Action", key="apply_profile_action"):
                    # Map the action to the internal action name
                    action_map = {
                        "Update Email": "Update Email",
                        "Add Intro": "Add Intro",
                        "Add Invited By": "Add Invited By",
                        "Verify Safety Number Change": "Verify Safety Number Change"
                    }
                    
                    # Store action and selected users
                    st.session_state['pending_action'] = {
                        'action': action_map[profile_action],
                        'selected_users': selected_users,
                        'action_params': action_params
                    }
                    st.rerun()
            
            # Back button
            if st.button("Back to Selection", key="back_button"):
                st.session_state['selection_state'] = 'viewing'
                st.rerun()
    
    except Exception as e:
        logging.error(f"Error in display_user_list: {str(e)}")
        st.error(f"An error occurred: {str(e)}")
        import traceback
        logging.error(traceback.format_exc())

def handle_action(action, selected_users, action_params=None, headers=None):
    """Handle the selected action for the selected users with enhanced support for group operations."""
    if not selected_users:
        st.error("No users selected.")
        return False

    # Get headers if not provided
    if headers is None:
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }

    success = True  # Track if all actions completed successfully
    
    # Initialize action_params if None
    if action_params is None:
        action_params = {}
    
    # Debug logging to help diagnose issues
    logging.info(f"Processing action: {action} for {len(selected_users)} users")
    logging.info(f"Action parameters: {action_params}")
    
    # Process each selected user
    for user in selected_users:
        # Extract username and user_id from the user data
        if isinstance(user, dict):
            username = user.get('username')
            user_id = user.get('pk')
        else:
            # If user is not a dict, try to use it directly as username
            username = user
            user_id = None
            
        if not username:
            logging.error(f"Missing username for user: {user}")
            continue
            
        logging.info(f"Processing {action} for user: {username} (ID: {user_id})")
        
        action_lower = action.lower()
        
        # Handle different actions
        if action_lower in ["activate", "deactivate"]:
            # For activate/deactivate, we need to set is_active based on the action
            try:
                if not user_id:
                    st.error(f"Cannot {action_lower} user {username}: missing user ID")
                    success = False
                    continue
                    
                result = update_user_status(
                    Config.AUTHENTIK_API_URL,
                    headers,
                    user_id,
                    action_lower == "activate"
                )
                
                if result:
                    st.success(f"User {username} {'activated' if action_lower == 'activate' else 'deactivated'} successfully.")
                else:
                    st.error(f"Failed to {action_lower} user {username}")
                    success = False
            except Exception as e:
                logging.error(f"Error {'activating' if action_lower == 'activate' else 'deactivating'} user: {e}")
                st.error(f"Error {'activating' if action_lower == 'activate' else 'deactivating'} user: {str(e)}")
                success = False
                
        elif action_lower == "delete":
            try:
                if not user_id:
                    st.error(f"Cannot delete user {username}: missing user ID")
                    success = False
                    continue
                    
                result = delete_user(
                    Config.AUTHENTIK_API_URL,
                    headers,
                    user_id
                )
                
                if result:
                    st.success(f"User {username} deleted successfully")
                else:
                    st.error(f"Failed to delete user {username}")
                    success = False
            except Exception as e:
                logging.error(f"Error deleting user: {e}")
                st.error(f"Error deleting user: {str(e)}")
                success = False
            
        elif action_lower == "reset password":
            try:
                result = handle_form_submission(
                    action="reset_password",
                    username=username
                )
                
                if result:
                    st.success(f"Password reset for {username}")
                else:
                    st.error(f"Failed to reset password for {username}")
                    success = False
            except Exception as e:
                logging.error(f"Error resetting password: {e}")
                st.error(f"Error resetting password: {str(e)}")
                success = False
            
        elif action_lower == "update email":
            try:
                # Get the new email from action_params
                new_email = action_params.get('new_email')
                
                if not new_email:
                    st.error(f"No new email provided for {username}")
                    success = False
                    continue
                    
                if not user_id:
                    st.error(f"Cannot update email for {username}: missing user ID")
                    success = False
                    continue
                    
                result = update_user_email(
                    Config.AUTHENTIK_API_URL,
                    headers,
                    user_id,
                    new_email
                )
                
                if result:
                    st.success(f"Email updated for {username}")
                else:
                    st.error(f"Failed to update email for {username}")
                    success = False
            except Exception as e:
                logging.error(f"Error updating email: {e}")
                st.error(f"Error updating email: {str(e)}")
                success = False
            
        elif action_lower == "verify safety number change":
            try:
                # Try to get email from user data
                user_email = None
                if isinstance(user, dict):
                    user_email = user.get('email')
                
                if not user_email:
                    st.error(f"No email found for user {username}")
                    success = False
                    continue
                    
                # Get user's name
                user_name = username
                if isinstance(user, dict) and user.get('name'):
                    user_name = user.get('name')
                    
                safety_number_change_email(
                    to=user_email,
                    subject="Verify Your Safety Number Change",
                    full_name=user_name,
                    username=username
                )
                st.success(f"Verification email sent to {user_email}")
            except Exception as e:
                logging.error(f"Error sending verification email: {e}")
                st.error(f"Error sending verification email: {str(e)}")
                success = False
                
        elif action_lower == "add intro":
            try:
                # Get the intro text from action_params
                intro_text = action_params.get('intro_text')
                
                if not intro_text:
                    st.error(f"No intro text provided for {username}")
                    success = False
                    continue
                    
                if not user_id:
                    st.error(f"Cannot add intro for {username}: missing user ID")
                    success = False
                    continue
                    
                result = update_user_intro(
                    Config.AUTHENTIK_API_URL,
                    headers,
                    user_id,
                    intro_text
                )
                
                if result:
                    st.success(f"Intro added for {username}")
                else:
                    st.error(f"Failed to add intro for {username}")
                    success = False
            except Exception as e:
                logging.error(f"Error adding intro: {e}")
                st.error(f"Error adding intro: {str(e)}")
                success = False
                
        elif action_lower == "add invited by":
            try:
                # Get the invited by from action_params
                invited_by = action_params.get('invited_by')
                
                if not invited_by:
                    st.error(f"No invited by provided for {username}")
                    success = False
                    continue
                    
                if not user_id:
                    st.error(f"Cannot add invited by for {username}: missing user ID")
                    success = False
                    continue
                    
                result = update_user_invited_by(
                    Config.AUTHENTIK_API_URL,
                    headers,
                    user_id,
                    invited_by
                )
                
                if result:
                    st.success(f"Invited by added for {username}")
                else:
                    st.error(f"Failed to add invited by for {username}")
                    success = False
            except Exception as e:
                logging.error(f"Error adding invited by: {e}")
                st.error(f"Error adding invited by: {str(e)}")
                success = False
        
        elif action_lower == "add to groups":
            try:
                # Get the groups to add from action_params
                groups_to_add = action_params.get('groups_to_add', [])
                
                if not groups_to_add:
                    st.error(f"No groups specified to add {username} to")
                    success = False
                    continue
                    
                if not user_id:
                    st.error(f"Cannot add {username} to groups: missing user ID")
                    success = False
                    continue
                
                # Import the function here to avoid circular imports
                from app.auth.admin import manage_user_groups
                
                result = manage_user_groups(
                    st.session_state.get("username", "system"),
                    user_id,
                    groups_to_add=groups_to_add
                )
                
                if result.get('success'):
                    st.success(f"Added {username} to selected groups")
                else:
                    st.error(f"Failed to add {username} to groups: {result.get('error')}")
                    success = False
            except Exception as e:
                logging.error(f"Error adding user to groups: {e}")
                st.error(f"Error adding user to groups: {str(e)}")
                success = False
        
        elif action_lower == "remove from groups":
            try:
                # Get the groups to remove from action_params
                groups_to_remove = action_params.get('groups_to_remove', [])
                
                if not groups_to_remove:
                    st.error(f"No groups specified to remove {username} from")
                    success = False
                    continue
                    
                if not user_id:
                    st.error(f"Cannot remove {username} from groups: missing user ID")
                    success = False
                    continue
                
                # Import the function here to avoid circular imports
                from app.auth.admin import manage_user_groups
                
                result = manage_user_groups(
                    st.session_state.get("username", "system"),
                    user_id,
                    groups_to_remove=groups_to_remove
                )
                
                if result.get('success'):
                    st.success(f"Removed {username} from selected groups")
                else:
                    st.error(f"Failed to remove {username} from groups: {result.get('error')}")
                    success = False
            except Exception as e:
                logging.error(f"Error removing user from groups: {e}")
                st.error(f"Error removing user from groups: {str(e)}")
                success = False
                
    return success

def verify_safety_number_change(username, input_code):
    """Verify the safety number change using the input code."""
    stored_code = st.session_state.get(f'verification_code_{username}')
    if stored_code and stored_code == input_code:
        st.success("Verification successful!")
        # Proceed with any additional verification steps
    else:
        st.error("Verification failed. Please check the code and try again.")

def get_users_from_db():
    """Get all users from the database."""
    try:
        with next(get_db()) as db:
            users = search_users(db, "")  # Empty search term returns all users
            if users:
                formatted_users = []
                for user in users:
                    user_id = getattr(user, 'id', None) or getattr(user, 'user_id', None)
                    formatted_user = {
                        'pk': user_id,
                        'username': getattr(user, 'username', ''),
                        'name': getattr(user, 'name', ''),
                        'email': getattr(user, 'email', ''),
                        'is_active': getattr(user, 'is_active', True),
                        'last_login': getattr(user, 'last_login', None),
                        'attributes': getattr(user, 'attributes', {})
                    }
                    formatted_users.append(formatted_user)
                return formatted_users
            return []
    except Exception as e:
        logging.error(f"Error fetching users from database: {e}")
        return []

def format_date(date_str):
    """Format a date string for display."""
    if date_str is None:
        return ""
        
    try:
        # Handle pandas NaT values
        import pandas as pd
        if pd.isna(date_str) or str(date_str) == 'NaT':
            return ""
            
        if isinstance(date_str, str):
            dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        else:
            dt = date_str
        return dt.strftime('%Y-%m-%d %H:%M')
    except Exception as e:
        logging.error(f"Error formatting date {date_str}: {e}")
        return ""  # Return empty string instead of the error-causing value