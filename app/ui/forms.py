# ui/forms.py
import os
import re
import json
import time
import asyncio
import logging
import requests
import traceback
import pandas as pd
from datetime import datetime, timedelta
from pytz import timezone
from typing import Dict, List, Any, Optional, Tuple, Union

import streamlit as st
from streamlit.components.v1 import html
from app.db.session import get_db
from app.db.models import User
from app.utils.config import Config
from app.auth.admin import (
    check_admin_permission,
    get_authentik_groups,
    manage_user_groups,
    get_user_details,
    search_users_by_criteria
)
from app.utils.transformations import parse_input
from app.auth.api import (
    list_users,
    create_invite,
    generate_secure_passphrase,
    force_password_reset,
    reset_user_password,
    create_discourse_post,
    create_user
)
from app.db.operations import search_users
from app.messages import create_invite_message, create_user_message
from app.utils.messages import WELCOME_MESSAGE

def reset_create_user_form_fields():
    """Helper function to reset all fields related to create user."""
    keys_to_reset = [
        "username_input",
        "username_input_outside",
        "first_name_input",
        "first_name_input_outside",
        "last_name_input",
        "last_name_input_outside",
        "email_input",
        "invited_by_input",
        "data_to_parse_input",
        "intro_input",
        "is_admin_checkbox",
        "selected_groups",
        "group_selection",
        "username_was_auto_generated"
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
    if not st.session_state.get("parse_data_input_outside", "").strip():
        logging.warning("Parsing called with empty data")
        st.warning("Nothing to parse. Please enter some data first.")
        return  # Just return if there's no data to parse
    
    # Log the input data for debugging
    input_data = st.session_state.get("parse_data_input_outside", "")
    logging.info(f"Parsing data: {input_data[:100]}..." if len(input_data) > 100 else f"Parsing data: {input_data}")
    
    try:
        # Parse the data from the text area
        parsed = parse_input(input_data)
        
        # Check for error in parsed data
        if isinstance(parsed, dict) and "error" in parsed:
            error_msg = parsed["error"]
            logging.error(f"Error parsing input: {error_msg}")
            st.error(f"Error parsing input: {error_msg}")
            return
        
        if not parsed:
            logging.error("Could not parse the input text, empty result")
            st.error("Could not parse the input text. The parser returned an empty result.")
            return
            
        # Log the parsed data
        logging.info(f"Successfully parsed data: {parsed}")
        
        # Store parsed data in temporary session state variables that can be used after rerun
        # Do NOT modify the widget values directly with _outside suffix
        if "first_name" in parsed:
            st.session_state["_parsed_first_name"] = parsed.get("first_name", "")
            logging.info(f"Set _parsed_first_name to: '{parsed.get('first_name', '')}'")
            
        if "last_name" in parsed:
            st.session_state["_parsed_last_name"] = parsed.get("last_name", "")
            logging.info(f"Set _parsed_last_name to: '{parsed.get('last_name', '')}'")
            
        if "email" in parsed:
            st.session_state["_parsed_email"] = parsed.get("email", "")
            logging.info(f"Set _parsed_email to: '{parsed.get('email', '')}'")
            
        if "invited_by" in parsed:
            st.session_state["_parsed_invited_by"] = parsed.get("invited_by", "")
            logging.info(f"Set _parsed_invited_by to: '{parsed.get('invited_by', '')}'")
            
        # Handle intro data which is nested
        if "intro" in parsed and isinstance(parsed["intro"], dict):
            intro_data = parsed.get("intro", {})
            org = intro_data.get("organization", "")
            interests = intro_data.get("interests", "")
            combined_intro = f"{org}\n\nInterests: {interests}" if interests else org
            st.session_state["_parsed_intro"] = combined_intro
            logging.info(f"Set _parsed_intro to organization: '{org}' and interests: '{interests}'")
        
        # Set a flag to indicate parsing was successful
        st.session_state["parsing_successful"] = True
        
        # Rerun so the fields can be updated with the parsed data
        logging.info("Rerunning with temporary parsed data in session state")
        st.rerun()
    except Exception as e:
        logging.error(f"Exception during parsing: {str(e)}")
        logging.error(traceback.format_exc())
        st.error(f"An error occurred while parsing: {str(e)}")

def clear_parse_data():
    """Callback to clear the parsed data and rerun the script."""
    # Set a flag to indicate that data should be cleared
    st.session_state["clear_parse_data_flag"] = True
    
    # Clear all temporary parsed data fields
    for key in [
        '_parsed_first_name', '_parsed_last_name', '_parsed_email',
        '_parsed_invited_by', '_parsed_intro'
    ]:
        if key in st.session_state:
            del st.session_state[key]
    
    # Set flags to indicate form should be cleared on next rerun
    st.session_state['should_clear_form'] = True
    
    # Rerun to apply changes
    st.rerun()

async def render_create_user_form():
    """Render the user creation form with improved layout and group selection."""
    # Custom CSS for better form styling
    st.markdown("""
    <style>
    /* Form styling */
    .form-container {
        background-color: #212529;
        padding: 20px;
        border-radius: 10px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        margin-bottom: 20px;
    }
    
    /* Input field styling */
    input[type="text"], input[type="email"], textarea {
        margin-bottom: 10px;
        border-radius: 5px !important;
        border: 1px solid #495057 !important;
        background-color: #343a40;
        color: #f8f9fa;
    }
    
    /* Button styling */
    .stButton button {
        border-radius: 5px;
        padding: 8px 16px;
        transition: all 0.3s;
    }
    
    .create-btn button {
        background-color: #4CAF50;
        color: white;
        border: none;
    }
    
    .create-btn button:hover {
        background-color: #45a049;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    
    .parse-btn button {
        background-color: #007bff;
        color: white;
        border: none;
    }
    
    .parse-btn button:hover {
        background-color: #0069d9;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    
    .clear-btn button {
        background-color: #6c757d;
        color: white;
        border: none;
    }
    
    .clear-btn button:hover {
        background-color: #5a6268;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    
    .check-btn button {
        background-color: #17a2b8;
        color: white;
        border: none;
    }
    
    .check-btn button:hover {
        background-color: #138496;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    
    /* Custom help text styling */
    .help-text {
        font-size: 0.8rem;
        color: #adb5bd;
        margin-bottom: 5px;
    }
    
    /* Divider styling */
    .divider {
        margin: 20px 0;
        border-top: 1px solid #495057;
    }
    
    /* Parse data section styling */
    .data-to-parse {
        background-color: #343a40;
        padding: 15px;
        border-radius: 5px;
        border: 1px solid #495057;
        margin-bottom: 20px;
    }
    
    /* Section headers */
    .stSubheader {
        color: #f8f9fa;
        margin-bottom: 15px;
    }
    
    /* Row spacing */
    .row-container {
        margin-bottom: 15px;
    }
    
    /* Button container */
    .button-container {
        display: flex;
        justify-content: space-between;
        margin-top: 20px;
    }
    </style>
    """, unsafe_allow_html=True)

    # Form clearing logic
    if st.session_state.get('should_clear_form', False):
        reset_create_user_form_fields()
        st.session_state['should_clear_form'] = False
    
    # Initialize or update session state variables from parsed data if it exists
    # This is how we'll update the form fields after parsing
    if st.session_state.get('parsing_successful', False):
        # Update session state variables from parsed data
        if '_parsed_first_name' in st.session_state:
            st.session_state['first_name_input'] = st.session_state['_parsed_first_name']
            logging.info(f"Updated first_name_input from parsed data: {st.session_state['_parsed_first_name']}")
            
        if '_parsed_last_name' in st.session_state:
            st.session_state['last_name_input'] = st.session_state['_parsed_last_name']
            logging.info(f"Updated last_name_input from parsed data: {st.session_state['_parsed_last_name']}")
            
        if '_parsed_email' in st.session_state:
            st.session_state['email_input'] = st.session_state['_parsed_email']
            logging.info(f"Updated email_input from parsed data: {st.session_state['_parsed_email']}")
            
        if '_parsed_invited_by' in st.session_state:
            st.session_state['invited_by_input'] = st.session_state['_parsed_invited_by']
            logging.info(f"Updated invited_by_input from parsed data: {st.session_state['_parsed_invited_by']}")
            
        if '_parsed_intro' in st.session_state:
            st.session_state['intro_text_input'] = st.session_state['_parsed_intro']
            logging.info(f"Updated intro_text_input from parsed data: {st.session_state['_parsed_intro']}")
        
        # Generate username from updated names
        if '_parsed_first_name' in st.session_state or '_parsed_last_name' in st.session_state:
            # Force username generation
            st.session_state['username_was_auto_generated'] = True
            # Update username
            update_username_from_inputs()
            
        # Clear the flag to prevent reprocessing
        st.session_state['parsing_successful'] = False
        
        # Show success message
        st.success(f"Successfully parsed user data")
    
    # Initialize session state variables for all form fields if they don't exist
    if 'first_name_input' not in st.session_state:
        st.session_state['first_name_input'] = ""
    if 'last_name_input' not in st.session_state:
        st.session_state['last_name_input'] = ""
    if 'email_input' not in st.session_state:
        st.session_state['email_input'] = ""
    if 'invited_by_input' not in st.session_state:
        st.session_state['invited_by_input'] = ""
    if 'username_input' not in st.session_state:
        st.session_state['username_input'] = ""
    if 'parse_data_input' not in st.session_state:
        st.session_state['parse_data_input'] = ""
        
    # Create tabs for main form and advanced options
    create_tabs = st.tabs(["Create User", "Advanced Options"])
    
    with create_tabs[0]:
        st.markdown("<div class='form-container'>", unsafe_allow_html=True)
        
        # User information section
        st.subheader("Basic Information")
        
        # Row 1: First Name and Last Name side by side
        col1, col2 = st.columns(2)
        with col1:
            # Fix for the widget key conflict
            if 'first_name_input_outside' in st.session_state:
                first_name = st.text_input(
                    "First Name *",
                    key="first_name_input_outside",
                    on_change=on_first_name_change,
                    help="Required: User's first name"
                )
            else:
                first_name = st.text_input(
                    "First Name *",
                    value=st.session_state.get('first_name_input', ""),
                    key="first_name_input_outside",
                    on_change=on_first_name_change,
                    help="Required: User's first name"
                )
        
        with col2:
            # Fix for the widget key conflict
            if 'last_name_input_outside' in st.session_state:
                last_name = st.text_input(
                    "Last Name",
                    key="last_name_input_outside",
                    on_change=on_last_name_change,
                    help="User's last name (optional)"
                )
            else:
                last_name = st.text_input(
                    "Last Name",
                    value=st.session_state.get('last_name_input', ""),
                    key="last_name_input_outside",
                    on_change=on_last_name_change,
                    help="User's last name (optional)"
                )
        
        # Row 2: Email Address and Invited By side by side
        col1, col2 = st.columns(2)
        with col1:
            # Fix for the widget key conflict
            if 'email_input_outside' in st.session_state:
                email = st.text_input(
                    "Email Address *",
                    key="email_input_outside",
                    help="Required: User's email address",
                    placeholder="user@example.com"
                )
            else:
                email = st.text_input(
                    "Email Address *",
                    value=st.session_state.get('email_input', ""),
                    key="email_input_outside",
                    help="Required: User's email address",
                    placeholder="user@example.com"
                )
        
        with col2:
            # Fix for the widget key conflict
            if 'invited_by_input_outside' in st.session_state:
                invited_by = st.text_input(
                    "Invited by",
                    key="invited_by_input_outside",
                    help="Who invited this person (optional)",
                    placeholder="username or name"
                )
            else:
                invited_by = st.text_input(
                    "Invited by",
                    value=st.session_state.get('invited_by_input', ""),
                    key="invited_by_input_outside",
                    help="Who invited this person (optional)",
                    placeholder="username or name"
                )
        
        # Row 3: Username and Check Username button
        col1, col2 = st.columns([3, 1])
        with col1:
            # Fix for the widget key conflict - don't use value when the key is in session state
            if 'username_input_outside' in st.session_state:
                username = st.text_input(
                    "Username *",
                    key="username_input_outside",
                    on_change=on_username_manual_edit,
                    help="Required: Unique username (auto-generated)",
                    placeholder="firstname-l"
                )
            else:
                username = st.text_input(
                    "Username *",
                    value=st.session_state.get('username_input', ""),
                    key="username_input_outside",
                    on_change=on_username_manual_edit,
                    help="Required: Unique username (auto-generated)",
                    placeholder="firstname-l"
                )
            st.markdown("<div class='help-text'>Username auto-generated. Edit to create custom username.</div>", unsafe_allow_html=True)
        
        with col2:
            st.markdown("<br>", unsafe_allow_html=True)  # Add spacing to align with text input
            st.markdown("<div class='check-btn'>", unsafe_allow_html=True)
            check_button = st.button("Check Username")
            st.markdown("</div>", unsafe_allow_html=True)
        
        # Handle Check Username logic
        if check_button:
            if not username:
                st.warning("Please enter a username to check")
            else:
                try:
                    from app.db.database import get_db
                    from app.db.models import User
                    db = next(get_db())
                    try:
                        existing_user = db.query(User).filter(User.username == username).first()
                        if existing_user:
                            st.warning(f"Username '{username}' already exists in local database.")
                        else:
                            # Also check in Authentik SSO
                            import requests
                            from app.utils.config import Config
                            headers = {
                                'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
                                'Content-Type': 'application/json'
                            }
                            user_check_url = f"{Config.AUTHENTIK_API_URL}/core/users/?username={username}"
                            response = requests.get(user_check_url, headers=headers)
                            
                            if response.status_code == 200:
                                auth_data = response.json()
                                if auth_data.get('count', 0) > 0:
                                    st.warning(f"Username '{username}' already exists in Authentik.")
                                else:
                                    st.success(f"Username '{username}' is available!")
                            else:
                                st.error(f"Error checking username in Authentik: {response.status_code}")
                    finally:
                        db.close()
                except Exception as e:
                    st.error(f"Database connection error: {str(e)}")
        
        # Row 4: Group Assignment section
        st.markdown("<div class='divider'></div>", unsafe_allow_html=True)
        
        # Group selection and Intro in same row
        col1, col2 = st.columns([1, 1])
        
        with col1:
            st.subheader("Group Assignment")
            # Group selection multi-select
            from app.auth.admin import get_authentik_groups
            groups = get_authentik_groups()
            if groups:
                # Group formatting function
                def format_group(group_id):
                    for group in groups:
                        if group.get('pk') == group_id:
                            return group.get('name', group_id)
                    return group_id
                    
                # Initialize selected_groups if not in session state
                if 'selected_groups' not in st.session_state:
                    # Pre-select main group if it exists
                    from app.utils.config import Config
                    main_group_id = Config.MAIN_GROUP_ID
                    st.session_state['selected_groups'] = [main_group_id] if main_group_id else []
                    
                # Group selection with multiselect
                st.multiselect(
                    "Assign to Groups",
                    options=[g.get('pk') for g in groups],
                    default=st.session_state['selected_groups'],
                    format_func=format_group,
                    key="group_selection",
                    help="Select groups to assign user to"
                )
        
        with col2:
            # Introduction text for the user
            st.subheader("Introduction")
            # Fix for the widget key conflict
            if 'intro_text_input_outside' in st.session_state:
                intro_text = st.text_area(
                    "User Introduction",
                    key="intro_text_input_outside",
                    placeholder="A few sentences about the new user",
                    help="Brief introduction for the new user",
                    height=100
                )
            else:
                intro_text = st.text_area(
                    "User Introduction",
                    value=st.session_state.get('intro_text_input', ""),
                    key="intro_text_input_outside",
                    placeholder="A few sentences about the new user",
                    help="Brief introduction for the new user",
                    height=100
                )
        
        # Data parsing section
        st.markdown("<div class='divider'></div>", unsafe_allow_html=True)
        st.subheader("Parse User Data")
        
        # Parse data textarea with fix for widget key conflict
        if 'parse_data_input_outside' in st.session_state:
            parse_data = st.text_area(
                "Enter data to parse",
                key="parse_data_input_outside",
                help="Enter multiple lines of information to parse into user fields",
                placeholder="First Name: John\nLast Name: Doe\nEmail: john.doe@example.com",
                height=100
            )
        else:
            parse_data = st.text_area(
                "Enter data to parse",
                value=st.session_state.get('parse_data_input', ""),
                key="parse_data_input_outside",
                help="Enter multiple lines of information to parse into user fields",
                placeholder="First Name: John\nLast Name: Doe\nEmail: john.doe@example.com",
                height=100
            )
        
        # Bottom row with all buttons
        col1, col2, col3 = st.columns([1, 1, 1])
        
        with col1:
            st.markdown("<div class='parse-btn'>", unsafe_allow_html=True)
            if st.button("Parse Data"):
                parse_and_rerun()
            st.markdown("</div>", unsafe_allow_html=True)
            
        with col2:
            st.markdown("<div class='clear-btn'>", unsafe_allow_html=True)
            if st.button("Clear Parse Data"):
                clear_parse_data()
            st.markdown("</div>", unsafe_allow_html=True)
        
        with col3:
            st.markdown("<div class='create-btn'>", unsafe_allow_html=True)
            create_user_button = st.button("Create User")
            st.markdown("</div>", unsafe_allow_html=True)
        
        # Handle Create User button logic
        if create_user_button:
            # Check required fields
            if not username or not first_name or not email:
                st.error("Please fill in all required fields (marked with *)")
            else:
                try:
                    # Prepare user data for submission
                    user_data = {
                        "username": username,
                        "name": f"{first_name} {last_name}".strip(),
                        "email": email
                    }
                    
                    # Add optional fields if provided
                    if invited_by:
                        user_data["attributes"] = {"invited_by": invited_by}
                    
                    if intro_text:
                        user_data["attributes"] = user_data.get("attributes", {})
                        user_data["attributes"]["intro"] = intro_text
                    
                    # Get selected groups
                    selected_groups = st.session_state.get('group_selection', [])
                    
                    # Add log for debugging
                    logging.info(f"Creating user with data: {user_data}")
                    logging.info(f"Selected groups: {selected_groups}")
                    
                    # Set a spinner while creating the user
                    with st.spinner("Creating user..."):
                        # Import the create_user function
                        from app.auth.api import create_user
                        
                        # Create user synchronously
                        result = create_user(
                            username=username,
                            name=user_data["name"],
                            email=email,
                            attributes=user_data.get("attributes", {}),
                            groups=selected_groups
                        )
                        
                        # Handle the result
                        if result and not result.get('error'):
                            from app.messages import create_user_message
                            # Show success message with buttons for clearing
                            
                            # Log the return values for debugging
                            logging.info(f"User creation result: {result}")
                            discourse_post_url = result.get('discourse_url')
                            logging.info(f"Discourse URL in result: {discourse_post_url}")
                            
                            create_user_message(
                                new_username=username,
                                temp_password=result.get('password', 'unknown'),
                                discourse_post_url=discourse_post_url,
                                password_reset_successful=result.get('password_reset_successful', False)
                            )
                            
                            # Store success flag but DON'T rerun immediately
                            st.session_state['user_created_successfully'] = True
                            # Don't clear form fields yet to allow message to be seen
                            st.session_state['should_clear_form'] = False
                            
                            # No st.rerun() here - let user see the message with buttons
                        else:
                            # Handle failure case
                            st.error(f"Failed to create user: {result.get('error', 'Unknown error')}")
                except Exception as e:
                    logging.error(f"Error creating user: {str(e)}")
                    logging.error(traceback.format_exc())
                    st.error(f"An unexpected error occurred: {str(e)}")
        
        # Note about required fields
        st.markdown("<div class='help-text'>* Required fields</div>", unsafe_allow_html=True)
        st.markdown("</div>", unsafe_allow_html=True)

    with create_tabs[1]:
        st.subheader("Advanced User Options")
        
        # This section could include additional options like:
        # - Custom attributes
        # - User expiration
        # - Initial password settings
        # - Notification preferences
        
        st.info("Advanced user options will be available in a future update.")

def on_first_name_change():
    """Update username when first name changes"""
    logging.info("on_first_name_change triggered")
    # Get the current value from the widget
    if 'first_name_input_outside' in st.session_state:
        # Update the form field value
        st.session_state['first_name_input'] = st.session_state['first_name_input_outside']
        logging.info(f"First name changed to: {st.session_state['first_name_input_outside']}")
        # Now update username - will only update the internal value
        username_updated = update_username_from_inputs()
        if username_updated:
            # Set flag to indicate username needs update on next rerun
            st.session_state['username_needs_update'] = True
            # We need to rerun to show the updated username immediately
            st.rerun()
        
def on_last_name_change():
    """Update username when last name changes"""
    logging.info("on_last_name_change triggered")
    # Get the current value from the widget
    if 'last_name_input_outside' in st.session_state:
        # Update the form field value
        st.session_state['last_name_input'] = st.session_state['last_name_input_outside']
        logging.info(f"Last name changed to: {st.session_state['last_name_input_outside']}")
        # Now update username - will only update the internal value
        username_updated = update_username_from_inputs()
        if username_updated:
            # Set flag to indicate username needs update on next rerun
            st.session_state['username_needs_update'] = True
            # We need to rerun to show the updated username immediately
            st.rerun()
        
def on_username_manual_edit():
    """Handle manual username edits"""
    # Set flag to prevent auto-updates when user manually edits the username
    st.session_state['username_was_auto_generated'] = False
    
    # Validate the username format
    if 'username_input_outside' in st.session_state:
        username = st.session_state['username_input_outside']
        # Update the internal value
        st.session_state['username_input'] = username
        
        if username:
            # Remove any special characters except hyphens and alphanumeric
            import re
            cleaned_username = re.sub(r'[^a-z0-9-]', '', username.lower())
            
            # If the username changed after cleaning
            if cleaned_username != username:
                # Only update the internal value, not the widget value
                st.session_state['username_input'] = cleaned_username
                # Set flag to indicate username needs update on next rerun
                st.session_state['username_needs_update'] = True
                # Don't rerun immediately - apply changes on next form submission
                # st.rerun()

    # Return false to indicate no username was generated
    return False

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
                # This action sends a verification email to the user
                result = handle_form_submission(
                    action="verify_safety_number",
                    username=username
                )
                
                if result:
                    st.success(f"Verification email sent to {username}")
                else:
                    st.error(f"Failed to send verification email to {username}")
                    success = False
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
                    st.error(f"Cannot update intro for {username}: missing user ID")
                    success = False
                    continue
                    
                result = update_user_intro(
                    Config.AUTHENTIK_API_URL,
                    headers,
                    user_id,
                    intro_text
                )
                
                if result:
                    st.success(f"Intro updated for {username}")
                else:
                    st.error(f"Failed to update intro for {username}")
                    success = False
            except Exception as e:
                logging.error(f"Error updating intro: {e}")
                st.error(f"Error updating intro: {str(e)}")
                success = False
            
        elif action_lower == "add invited by":
            try:
                # Get the invited by from action_params
                invited_by = action_params.get('invited_by')
                
                if not invited_by:
                    st.error(f"No 'invited by' provided for {username}")
                    success = False
                    continue
                    
                if not user_id:
                    st.error(f"Cannot update 'invited by' for {username}: missing user ID")
                    success = False
                    continue
                    
                result = update_user_invited_by(
                    Config.AUTHENTIK_API_URL,
                    headers,
                    user_id,
                    invited_by
                )
                
                if result:
                    st.success(f"Invited by updated for {username}")
                else:
                    st.error(f"Failed to update 'invited by' for {username}")
                    success = False
            except Exception as e:
                logging.error(f"Error updating 'invited by': {e}")
                st.error(f"Error updating 'invited by': {str(e)}")
                success = False
                
        elif action_lower == "add to groups":
            try:
                # Get the groups from action_params
                groups_to_add = action_params.get('groups_to_add', [])
                
                if not groups_to_add:
                    st.error(f"No groups specified to add {username} to")
                    success = False
                    continue
                    
                if not user_id:
                    st.error(f"Cannot add {username} to groups: missing user ID")
                    success = False
                    continue
                    
                # Add user to groups
                from app.auth.admin import manage_user_groups
                result = manage_user_groups(
                    st.session_state.get("username", "system"),
                    user_id,
                    groups_to_add=groups_to_add
                )
                
                if result:
                    # Get the group names for display
                    from app.auth.admin import get_authentik_groups
                    all_groups = get_authentik_groups()
                    group_names = []
                    for group_id in groups_to_add:
                        group_name = next((g.get('name') for g in all_groups if g.get('pk') == group_id), group_id)
                        group_names.append(str(group_name))
                    
                    st.success(f"Added {username} to groups: {', '.join(group_names)}")
                else:
                    st.error(f"Failed to add {username} to groups")
                    success = False
            except Exception as e:
                logging.error(f"Error adding user to groups: {e}")
                st.error(f"Error adding user to groups: {str(e)}")
                success = False
                
        elif action_lower == "remove from groups":
            try:
                # Get the groups from action_params
                groups_to_remove = action_params.get('groups_to_remove', [])
                
                if not groups_to_remove:
                    st.error(f"No groups specified to remove {username} from")
                    success = False
                    continue
                    
                if not user_id:
                    st.error(f"Cannot remove {username} from groups: missing user ID")
                    success = False
                    continue
                    
                # Remove user from groups
                from app.auth.admin import manage_user_groups
                result = manage_user_groups(
                    st.session_state.get("username", "system"),
                    user_id,
                    groups_to_remove=groups_to_remove
                )
                
                if result:
                    # Get the group names for display
                    from app.auth.admin import get_authentik_groups
                    all_groups = get_authentik_groups()
                    group_names = []
                    for group_id in groups_to_remove:
                        group_name = next((g.get('name') for g in all_groups if g.get('pk') == group_id), group_id)
                        group_names.append(str(group_name))
                    
                    st.success(f"Removed {username} from groups: {', '.join(group_names)}")
                else:
                    st.error(f"Failed to remove {username} from groups")
                    success = False
            except Exception as e:
                logging.error(f"Error removing user from groups: {e}")
                st.error(f"Error removing user from groups: {str(e)}")
                success = False
        
        else:
            st.error(f"Unknown action: {action}")
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

def update_username_from_inputs():
    """
    Generate a username based on first and last name inputs.
    Checks both local database and SSO service for existing usernames.
    """
    # Only auto-generate username if username is empty or matches previous auto-generation
    # This prevents overwriting a manually entered username
    if (not st.session_state.get('username_input') or 
        st.session_state.get('username_was_auto_generated', False)):
        
        first_name = st.session_state.get('first_name_input', '').strip().lower()
        last_name = st.session_state.get('last_name_input', '').strip().lower()
        
        logging.info(f"Attempting username generation with first_name='{first_name}', last_name='{last_name}'")
        
        # Generate username even with partial information
        if first_name or last_name:
            # Handle different combinations of first/last name
            if first_name and last_name:
                # First name and first letter of last name
                base_username = f"{first_name}-{last_name[0]}"
                logging.info(f"Generated base username from first+last: {base_username}")
            elif first_name:
                # Just first name if that's all we have
                base_username = first_name
                logging.info(f"Generated base username from first name only: {base_username}")
            else:
                # Just last name if that's all we have
                base_username = last_name
                logging.info(f"Generated base username from last name only: {base_username}")
            
            # Replace spaces with hyphens
            base_username = base_username.replace(" ", "-")
            
            # Remove any special characters except hyphens
            import re
            base_username = re.sub(r'[^a-z0-9-]', '', base_username)
            
            # Ensure we have at least one character
            if not base_username:
                base_username = "user"
                logging.info(f"Empty base username, using default: {base_username}")
            
            # Check for existing username in local database
            existing_usernames = []
            try:
                # Get a database session
                from app.db.database import get_db
                db = next(get_db())
                try:
                    from app.db.models import User
                    # Use a SQL query that works with both SQLite and PostgreSQL
                    local_existing = db.query(User).filter(User.username.like(f"{base_username}%")).all()
                    existing_usernames = [user.username for user in local_existing]
                    logging.info(f"Found {len(existing_usernames)} existing usernames in local DB with prefix {base_username}")
                except Exception as db_err:
                    logging.error(f"Database error checking existing usernames: {db_err}")
                    existing_usernames = []
                finally:
                    db.close()
            except Exception as e:
                logging.error(f"Error with database connection: {e}")
                existing_usernames = []
            
            # Also check for existing username in Authentik SSO
            try:
                import requests
                from app.utils.config import Config
                
                sso_usernames = []
                # Define headers before using them
                headers = {
                    'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
                    'Content-Type': 'application/json'
                }
                user_search_url = f"{Config.AUTHENTIK_API_URL}/core/users/?username__startswith={base_username}"
                response = requests.get(user_search_url, headers=headers, timeout=10)
                
                if response.status_code == 200:
                    users = response.json().get('results', [])
                    sso_usernames = [user['username'] for user in users]
                    logging.info(f"Found {len(sso_usernames)} existing usernames in SSO starting with {base_username}")
                else:
                    logging.warning(f"Failed to check SSO for existing usernames: {response.status_code}")
                
                # Combine both lists of existing usernames
                all_existing_usernames = list(set(existing_usernames + sso_usernames))
                logging.info(f"Total existing usernames: {len(all_existing_usernames)}")
                
                # Generate unique username
                final_username = base_username
                if final_username in all_existing_usernames:
                    # Try to add numeric suffix
                    suffix = 1
                    while f"{base_username}{suffix}" in all_existing_usernames:
                        suffix += 1
                        # Safety check to avoid infinite loop
                        if suffix > 100:
                            import random
                            # Add random suffix as fallback
                            random_suffix = random.randint(100, 999)
                            final_username = f"{base_username}{random_suffix}"
                            logging.warning(f"Using random suffix after trying 100 sequential numbers: {final_username}")
                            break
                    else:
                        final_username = f"{base_username}{suffix}"
                
                logging.info(f"Final generated username: {final_username}")
                
                # Update session state - update both username_input and username_input_outside
                st.session_state['username_input'] = final_username
                st.session_state['username_input_outside'] = final_username
                st.session_state['username_was_auto_generated'] = True
                
                # Set flag to indicate username needs update on next rerun
                st.session_state['username_needs_update'] = True
                
                # Return true to indicate username was generated
                return True
                
            except Exception as e:
                # If there's an error checking SSO, fall back to just local check
                logging.error(f"Error checking SSO for existing usernames: {e}")
                if base_username in existing_usernames:
                    # Generate a unique suffix
                    suffix = 1
                    while f"{base_username}{suffix}" in existing_usernames:
                        suffix += 1
                    suggested_username = f"{base_username}{suffix}"
                else:
                    suggested_username = base_username
                    
                # Update both internal value and widget value
                st.session_state['username_input'] = suggested_username
                st.session_state['username_input_outside'] = suggested_username
                st.session_state['username_was_auto_generated'] = True
                st.session_state['username_needs_update'] = True
                logging.info(f"Generated username (fallback): {suggested_username}")
                
                # Return true to indicate username was generated
                return True
                
    # Return false to indicate no username was generated
    return False

async def render_invite_form():
    """Render the form for creating invite links"""
    st.subheader("Create Invite Link")
    
    # Initialize session state for invite form
    if 'invite_email' not in st.session_state:
        st.session_state['invite_email'] = ""
    if 'invite_name' not in st.session_state:
        st.session_state['invite_name'] = ""
    if 'invite_expiry_days' not in st.session_state:
        st.session_state['invite_expiry_days'] = 7  # Default 7 days
    
    with st.form("create_invite_form_alt"):
        st.text_input(
            "Name",
            key="invite_name",
            placeholder="e.g., John Doe",
            help="Name of the person you're inviting"
        )
        
        st.text_input(
            "Email Address",
            key="invite_email",
            placeholder="e.g., john.doe@example.com",
            help="Email address to send the invite to"
        )
        
        st.number_input(
            "Expiry (days)",
            key="invite_expiry_days",
            min_value=1,
            max_value=30,
            value=7,
            help="Number of days before the invite expires"
        )
        
        # Get all available groups
        from app.auth.admin import get_authentik_groups
        all_groups = get_authentik_groups()
        
        # Group selection
        if all_groups:
            # Initialize selected_groups if not in session state
            if 'invite_selected_groups' not in st.session_state:
                st.session_state['invite_selected_groups'] = []
            
            # Find the main group ID if configured
            main_group_id = Config.MAIN_GROUP_ID
            
            # Pre-select the main group if it exists
            default_selection = [main_group_id] if main_group_id else []
            
            # Group selection with multiselect
            selected_groups = st.multiselect(
                "Pre-assign to Groups",
                options=[g.get('pk') for g in all_groups],
                default=default_selection,
                format_func=lambda pk: next((g.get('name') for g in all_groups if g.get('pk') == pk), pk),
                help="Select groups to pre-assign the invited user to",
                key="invite_group_selection"
            )
            
            # Store in session state
            st.session_state['invite_selected_groups'] = selected_groups
        
        col1, col2 = st.columns(2)
        with col1:
            submit_button = st.form_submit_button("Create Invite")
        with col2:
            clear_button = st.form_submit_button("Clear Form")
            
        if submit_button:
            # Validate inputs
            email = st.session_state.get('invite_email', '')
            name = st.session_state.get('invite_name', '')
            expiry_days = st.session_state.get('invite_expiry_days', 7)
            selected_groups = st.session_state.get('invite_selected_groups', [])
            
            if not email:
                st.error("Email address is required")
            elif not name:
                st.error("Name is required")
            else:
                # Create the invite
                try:
                    # Generate expiry date
                    expiry_date = datetime.now() + timedelta(days=expiry_days)
                    
                    # Create invite in the system
                    result = create_invite(
                        email=email,
                        name=name,
                        expiry=expiry_date.strftime('%Y-%m-%d'),
                        created_by=st.session_state.get("username", "system"),
                        groups=selected_groups
                    )
                    
                    if result.get('success'):
                        invite_link = result.get('invite_link')
                        st.success(f"Invite created successfully!")
                        
                        # Display the invite link
                        st.code(invite_link, language=None)
                        
                        # Copy button
                        if st.button("Copy Invite Link"):
                            st.markdown(f"""
                            <script>
                                navigator.clipboard.writeText('{invite_link}');
                                alert('Invite link copied to clipboard!');
                            </script>
                            """, unsafe_allow_html=True)
                        
                        # Option to send invite email
                        if st.button("Send Email Invitation"):
                            # Send email with invite link
                            try:
                                create_invite_message(
                                    to=email,
                                    subject="You've been invited to join our platform",
                                    full_name=name,
                                    invite_link=invite_link
                                )
                                st.success(f"Invitation email sent to {email}")
                            except Exception as e:
                                logging.error(f"Error sending invitation email: {e}")
                                st.error(f"Failed to send invitation email: {str(e)}")
                        
                        # Clear form after successful submission
                        if 'invite_email' in st.session_state:
                            st.session_state['invite_email'] = ""
                        if 'invite_name' in st.session_state:
                            st.session_state['invite_name'] = ""
                    else:
                        st.error(f"Failed to create invite: {result.get('error', 'Unknown error')}")
                
                except Exception as e:
                    logging.error(f"Error creating invite: {e}")
                    logging.error(traceback.format_exc())
                    st.error(f"An error occurred: {str(e)}")
            
        elif clear_button:
            # Clear form fields
            if 'invite_email' in st.session_state:
                st.session_state['invite_email'] = ""
            if 'invite_name' in st.session_state:
                st.session_state['invite_name'] = ""
            if 'invite_selected_groups' in st.session_state:
                st.session_state['invite_selected_groups'] = []
            # Don't reset the expiry days to keep the user preference

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

# Add new functions for user management
def update_user_status(api_url: str, headers: dict, user_id: str, is_active: bool) -> bool:
    """Update user's active status in Authentik."""
    try:
        url = f"{api_url}/core/users/{user_id}/"
        data = {'is_active': is_active}
        response = requests.patch(url, headers=headers, json=data)
        response.raise_for_status()
        return True
    except Exception as e:
        logging.error(f"Error updating user status: {e}")
        return False

def delete_user(api_url: str, headers: dict, user_id: str) -> bool:
    """Delete a user from Authentik."""
    try:
        url = f"{api_url}/core/users/{user_id}/"
        response = requests.delete(url, headers=headers)
        response.raise_for_status()
        return True
    except Exception as e:
        logging.error(f"Error deleting user: {e}")
        return False

def update_user_email(api_url: str, headers: dict, user_id: str, new_email: str) -> bool:
    """Update user's email in Authentik."""
    try:
        url = f"{api_url}/core/users/{user_id}/"
        data = {'email': new_email}
        response = requests.patch(url, headers=headers, json=data)
        response.raise_for_status()
        return True
    except Exception as e:
        logging.error(f"Error updating user email: {e}")
        return False

def update_user_intro(api_url: str, headers: dict, user_id: str, intro_text: str) -> bool:
    """Update user's intro in Authentik."""
    try:
        # First get current attributes
        user_details = get_user_details(user_id)
        if not user_details:
            return False
            
        # Update or add intro to attributes
        attributes = user_details.get('attributes', {})
        attributes['intro'] = intro_text
        
        # Update user with new attributes
        url = f"{api_url}/core/users/{user_id}/"
        data = {'attributes': attributes}
        response = requests.patch(url, headers=headers, json=data)
        response.raise_for_status()
        return True
    except Exception as e:
        logging.error(f"Error updating user intro: {e}")
        return False

def update_user_invited_by(api_url: str, headers: dict, user_id: str, invited_by: str) -> bool:
    """Update user's invited_by field in Authentik."""
    try:
        # First get current attributes
        user_details = get_user_details(user_id)
        if not user_details:
            return False
            
        # Update or add invited_by to attributes
        attributes = user_details.get('attributes', {})
        attributes['invited_by'] = invited_by
        
        # Update user with new attributes
        url = f"{api_url}/core/users/{user_id}/"
        data = {'attributes': attributes}
        response = requests.patch(url, headers=headers, json=data)
        response.raise_for_status()
        return True
    except Exception as e:
        logging.error(f"Error updating user invited_by: {e}")
        return False

def handle_form_submission(action: str, username: str, **kwargs) -> bool:
    """Handle form submissions for various user actions."""
    try:
        if action == "reset_password":
            # Implement password reset logic here
            return True
        elif action == "verify_safety_number":
            # Implement safety number verification logic here
            return True
        return False
    except Exception as e:
        logging.error(f"Error handling form submission: {e}")
        return False