# ui/forms.py
import streamlit as st
from app.utils.transformations import parse_input
from datetime import datetime, timedelta
from app.utils.helpers import (
    update_username, 
    get_eastern_time, 
    add_timeline_event,
    handle_form_submission,
    safety_number_change_email,
    create_unique_username
)
from app.utils.config import Config
from app.db.operations import AdminEvent, search_users, User
from app.db.database import get_db
from app.db.init_db import should_sync_users
import re
import pandas as pd
import json
import logging
from st_aggrid import AgGrid, GridOptionsBuilder, DataReturnMode, GridUpdateMode, ColumnsAutoSizeMode
import time
import warnings
import requests
from pytz import timezone
import numpy as np
from app.auth.api import (
    update_user_status,
    delete_user,
    update_user_intro,
    update_user_invited_by,
    create_invite
)
from app.messages import create_invite_message

def reset_create_user_form_fields():
    """Helper function to reset all fields related to create user."""
    keys_to_reset = [
        "username_input",
        "first_name_input",
        "last_name_input",
        "email_input",
        "invited_by_input",
        "data_to_parse_input",
        "intro_input"
    ]
    
    # Set a flag in session state to indicate we should clear fields
    st.session_state['clear_fields'] = True
    
    # Store current values temporarily to detect changes
    old_values = {key: st.session_state.get(key, "") for key in keys_to_reset}
    st.session_state['old_values'] = old_values

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

async def render_create_user_form():
    """Render the create user form"""
    # Initialize session state variables if they don't exist
    for key in ['first_name_input', 'last_name_input', 'username_input', 
                'email_input', 'invited_by_input', 'intro_input']:
        if key not in st.session_state:
            st.session_state[key] = ""

    # Get database connection
    db = next(get_db())

    # Update username based on first and last name before form
    if st.session_state.get('first_name_input') and st.session_state.get('last_name_input'):
        # Create a base username from first and last name
        base_username = f"{st.session_state['first_name_input'].lower()}{st.session_state['last_name_input'].lower()}"
        suggested_username = create_unique_username(db, base_username)
        if not st.session_state.get('username_input'):
            st.session_state['username_input'] = suggested_username

    with st.form("create_user_form"):
        # Text inputs
        st.text_input(
            "Enter First Name",
            key="first_name_input",
            placeholder="e.g., John"
        )
        st.text_input(
            "Enter Last Name",
            key="last_name_input",
            placeholder="e.g., Doe"
        )
        st.text_input(
            "Enter Username",
            key="username_input",
            placeholder="e.g., johndoe123"
        )
        st.text_input(
            "Invited by (optional)",
            key="invited_by_input",
            placeholder="Signal Username e.g., @janedoe"
        )
        st.text_input(
            "Enter Email Address (optional)",
            key="email_input",
            placeholder="e.g., johndoe@example.com"
        )
        st.text_area(
            "Intro",
            key="intro_input",
            height=100,
            placeholder="e.g., Software Engineer at TechCorp"
        )
        
        # Text area for data parsing
        st.markdown("""
            <style>
            .data-to-parse {
                background-color: #e0e0e0; 
                padding: 10px;
                border-radius: 5px;
            }
            </style>
            <script>
            document.addEventListener('DOMContentLoaded', function() {
                document.getElementById('data_to_parse_input').focus();
            });
            </script>
            """, unsafe_allow_html=True)
        
        st.markdown('<div class="data-to-parse">', unsafe_allow_html=True)
        st.text_area(
            "Data to Parse",
            key="data_to_parse_input",
            height=180,
            placeholder=("Please enter your details (each on a new line):\n"
                         "1. What's Your Name\n"
                         "2. What org are you with\n"
                         "3. Who invited you (add and mention them in this chat)\n"
                         "4. Your Email or Email-Alias/Mask (for password resets and safety number verifications)\n"
                         "5. Your Interests (so we can get you to the right chats)")
        )
        st.markdown('</div>', unsafe_allow_html=True)

        # Submit buttons
        parse_button = st.form_submit_button("Parse", on_click=parse_and_rerun)
        submit_button = st.form_submit_button("Submit")
        clear_button = st.form_submit_button("Clear All Fields")

    # Handle form submission
    if submit_button:
        # Update username one last time before submission
        if st.session_state.get('first_name_input') and st.session_state.get('last_name_input'):
            # Create a base username from first and last name
            base_username = f"{st.session_state['first_name_input'].lower()}{st.session_state['last_name_input'].lower()}"
            suggested_username = create_unique_username(db, base_username)
            if not st.session_state.get('username_input'):
                st.session_state['username_input'] = suggested_username
                st.rerun()

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
            invite_url, expires = create_invite(
                headers=headers,
                label=invite_label,
                expires=expires_iso
            )
            
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
    
    return (
        st.session_state.get('invite_message', ''),
        submit_button
    )

async def display_user_list(auth_api_url=None, headers=None):
    """Display the list of users in a grid."""
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
    
    # Process any pending actions
    if 'pending_action' in st.session_state:
        action = st.session_state['pending_action']['action']
        selected_users = st.session_state['pending_action']['selected_users']
        verification_context = st.session_state['pending_action'].get('verification_context', '')
        
        # Handle the action
        success = handle_action(action, selected_users, verification_context, headers)
        
        # Clear the pending action
        del st.session_state['pending_action']
        
        # Reset state after action
        if success:
            st.session_state['user_list'] = get_users_from_db()
            st.session_state['selected_user_ids'] = []
            st.session_state['selection_state'] = 'viewing'
            
    try:
        st.write("## User Management")
        
        # Simple UI with two states: selecting users and performing actions
        if st.session_state['selection_state'] == 'viewing':
            # STEP 1: SELECT USERS
            st.write("### Step 1: Select Users")
            
            # Create filter input
            filter_term = st.text_input("Filter by username:", key="filter_input")
            st.session_state['filter_term'] = filter_term
            
            # Convert user list to DataFrame
            df = pd.DataFrame(st.session_state['user_list'])
            
            # Apply filter if provided
            if st.session_state['filter_term']:
                df = df[df['username'].str.contains(st.session_state['filter_term'], case=False)]
            
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
                df['is_active'] = df['is_active'].apply(lambda x: '✅' if x else '❌')
                df['invited_by'] = df.apply(
                    lambda row: row.get('attributes', {}).get('invited_by', '') 
                    if isinstance(row.get('attributes'), dict) else '', 
                    axis=1
                )
                
                # Create selection columns with unique IDs for each row
                if 'pk' in df.columns:
                    # Display the table with selection columns
                    cols_to_display = ['username', 'name', 'email', 'is_active', 'last_login']
                    st.write("Select users from the table below:")
                    
                    # Using Streamlit's data editor for selection
                    selection = st.data_editor(
                        df[cols_to_display],
                        hide_index=True,
                        key="user_table",
                        use_container_width=True,
                        column_config={
                            "username": st.column_config.TextColumn("Username"),
                            "name": st.column_config.TextColumn("Name"),
                            "email": st.column_config.TextColumn("Email"),
                            "is_active": st.column_config.TextColumn("Active"),
                            "last_login": st.column_config.TextColumn("Last Login")
                        },
                        disabled=cols_to_display,
                        height=400
                    )
                    
                    # Multi-select
                    selected_indices = st.multiselect(
                        "Select users:",
                        options=df['username'].tolist(),
                        format_func=lambda x: x,
                        key="user_multiselect"
                    )
                    
                    # Get the selected user IDs
                    selected_user_ids = df[df['username'].isin(selected_indices)]['pk'].tolist()
                    
                    # Display selection info
                    if selected_user_ids:
                        st.success(f"Selected {len(selected_user_ids)} users")
                        
                        # Store selected users
                        st.session_state['selected_user_ids'] = selected_user_ids
                        
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
            selected_users = []
            df = pd.DataFrame(st.session_state['user_list'])
            for user_id in st.session_state['selected_user_ids']:
                user_data = df[df['pk'] == user_id].to_dict('records')
                if user_data:
                    selected_users.append(user_data[0])
            
            # Display selected usernames
            selected_usernames = [user.get('username', 'Unknown') for user in selected_users]
            st.write(f"**Selected Users:** {', '.join(selected_usernames)}")
            
            # Action selection
            action = st.selectbox(
                "Select Action",
                ["Activate", "Deactivate", "Reset Password", "Delete", "Add Intro", "Add Invited By", "Verify Safety Number Change", "Update Email"],
                key="action_selection"
            )
            
            # Show additional inputs based on the selected action
            action_params = {}
            if action == "Add Intro":
                action_params['intro_text'] = st.text_area("Enter Intro Text", key="intro_input", height=100)
            elif action == "Add Invited By":
                action_params['invited_by'] = st.text_input("Enter Invited By", key="invited_by_input")
            elif action == "Update Email":
                st.write("### Update Email Addresses")
                for user in selected_users:
                    email_key = f"email_{user.get('pk')}"
                    action_params[email_key] = st.text_input(
                        f"New email for {user.get('username')}",
                        value=user.get('email', ''),
                        key=email_key
                    )
            
            # Action buttons
            col1, col2 = st.columns(2)
            with col1:
                if st.button("Apply Action", key="apply_action"):
                    # Store action and selected users
                    st.session_state['pending_action'] = {
                        'action': action,
                        'selected_users': selected_users,
                        'action_params': action_params
                    }
                    st.rerun()
            with col2:
                if st.button("Back to Selection", key="back_button"):
                    st.session_state['selection_state'] = 'viewing'
                    st.rerun()
    
    except Exception as e:
        logging.error(f"Error in display_user_list: {str(e)}")
        st.error(f"An error occurred: {str(e)}")
        import traceback
        logging.error(traceback.format_exc())

def handle_action(action, selected_users, verification_context='', headers=None):
    """Handle the selected action for the selected users."""
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
    
    # Debug logging to help diagnose issues
    logging.info(f"Processing action: {action} for {len(selected_users)} users")
    logging.info(f"Selected users data type: {type(selected_users)}")
    for i, user in enumerate(selected_users):
        logging.info(f"User {i}: {type(user)} - {user}")
    
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
                # Try different ways to get the email key
                email_key = None
                if user_id:
                    email_key = f"email_{user_id}"
                if email_key not in st.session_state:
                    email_key = f"email_{username}"
                    
                new_email = st.session_state.get(email_key)
                
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
                intro_key = "intro_input"
                intro_text = st.session_state.get(intro_key)
                
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
                invited_by_key = "invited_by_input"
                invited_by = st.session_state.get(invited_by_key)
                
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

