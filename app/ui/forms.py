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
    generate_secure_passphrase
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
    if not st.session_state.get("data_to_parse_input", "").strip():
        logging.warning("Parsing called with empty data")
        return  # Just return if there's no data to parse
    
    # Log the input data for debugging
    input_data = st.session_state.get("data_to_parse_input", "")
    logging.info(f"Parsing data: {input_data[:100]}..." if len(input_data) > 100 else f"Parsing data: {input_data}")
    
    try:
        # Parse the data from the text area
        parsed = parse_input(input_data)
    
        # Check for error in parsed data
        if isinstance(parsed, dict) and "error" in parsed:
            error_msg = parsed["error"]
            logging.error(f"Error parsing input: {error_msg}")
            st.error(error_msg)
            return
        
        if not parsed or (isinstance(parsed, tuple) and parsed[1] is False):
            logging.error("Could not parse the input text, empty or invalid result")
            st.error("Could not parse the input text")
            return

        # Debug the parsed data
        logging.info(f"Successfully parsed data: {parsed}")
        
        # Update session state properly
        # Make sure to update all fields even if they're missing in the parsed result
        if "first_name" in parsed:
            st.session_state["first_name_input"] = parsed.get("first_name")
            st.session_state["first_name_input_outside"] = parsed.get("first_name")
            logging.info(f"Updated first_name to: {parsed.get('first_name')}")
        
        if "last_name" in parsed:
            st.session_state["last_name_input"] = parsed.get("last_name")
            st.session_state["last_name_input_outside"] = parsed.get("last_name") 
            logging.info(f"Updated last_name to: {parsed.get('last_name')}")
        
        if "email" in parsed:
            st.session_state["email_input"] = parsed.get("email")
            logging.info(f"Updated email to: {parsed.get('email')}")
        
        if "invited_by" in parsed:
            st.session_state["invited_by_input"] = parsed.get("invited_by")
            logging.info(f"Updated invited_by to: {parsed.get('invited_by')}")
    
        # Safely access nested intro fields and combine organization and interests
        if "intro" in parsed:
            intro_data = parsed.get("intro", {})
            org = intro_data.get("organization", "")
            interests = intro_data.get("interests", "")
            combined_intro = f"{org}\n\nInterests: {interests}" if interests else org
            st.session_state["intro_input"] = combined_intro
            logging.info(f"Updated intro with org: '{org}' and interests: '{interests}'")
        
        # Trigger username generation from the updated names
        if ("first_name" in parsed or "last_name" in parsed) and st.session_state.get('username_was_auto_generated', False):
            # If we're updating name fields, we should update the username too if it was auto-generated
            first_name = st.session_state.get('first_name_input', '')
            last_name = st.session_state.get('last_name_input', '')
            logging.info(f"Triggering username generation with first_name='{first_name}', last_name='{last_name}'")
        
        # Set a flag to indicate parsing was successful
        st.session_state["parsing_successful"] = True

        # Rerun so the text inputs see the updated session state
        logging.info("Rerunning with updated session state")
        st.rerun()
    except Exception as e:
        logging.error(f"Exception during parsing: {str(e)}")
        logging.error(traceback.format_exc())
        st.error(f"An error occurred while parsing: {str(e)}")

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
    # Handle form clearing at the start of rendering
    if st.session_state.get('should_clear_form', False):
        # Initialize empty values for the next render
        st.session_state['first_name_input_outside'] = ""
        st.session_state['last_name_input_outside'] = ""
        st.session_state['username_input_outside'] = ""
        st.session_state['email_input'] = ""
        st.session_state['invited_by_input'] = ""
        st.session_state['intro_input'] = ""
        st.session_state['selected_groups'] = []
        
        # Reset the flag
        st.session_state['should_clear_form'] = False
    
    # We're now using create_user_message directly instead of this success message
    # Clear any existing user_created flags
    if st.session_state.get('user_created', False):
        st.session_state['user_created'] = False
        if 'success_message' in st.session_state:
            del st.session_state['success_message']
    
    # Initialize session state variables if they don't exist
    for key in ['first_name_input', 'last_name_input', 'username_input', 
                'email_input', 'invited_by_input', 'intro_input', 'selected_groups']:
        if key not in st.session_state:
            st.session_state[key] = "" if key != 'selected_groups' else []
    
    # Also initialize the outside form fields if not already present
    # But DO NOT modify them if they already exist to avoid the "cannot modify after widget instantiation" error
    for key in ['first_name_input_outside', 'last_name_input_outside', 'username_input_outside']:
        if key not in st.session_state:
            # Get the base key (without _outside)
            base_key = key.replace('_outside', '')
            # If base key exists, copy its value, otherwise initialize empty
            st.session_state[key] = st.session_state.get(base_key, "")
    
    # Initialize username auto-generation flag if not present
    if 'username_was_auto_generated' not in st.session_state:
        st.session_state['username_was_auto_generated'] = False
    
    # Initialize a new flag to indicate if username needs updating
    if 'username_needs_update' not in st.session_state:
        st.session_state['username_needs_update'] = False

    # Check if data was cleared
    was_cleared = st.session_state.get("clear_parse_data_flag", False)
    if was_cleared:
        # Reset the flag
        st.session_state["clear_parse_data_flag"] = False

    # Get database connection
    db = next(get_db())

    # Run username update on initialization if we have some name data
    if ((st.session_state.get('first_name_input') or 
         st.session_state.get('last_name_input')) and 
        not st.session_state.get('username_input')):
        update_username_from_inputs()

    # Create tabs for different input methods
    create_tabs = st.tabs(["Manual Create", "Auto Create", "Advanced Options"])
    
    with create_tabs[0]:
        # Input fields outside the form for first name and last name to handle on_change
        st.subheader("Manual Create")
        st.info("Enter your information below to create a new user. The username will be automatically generated based on your first and last name.")
            
        col1_outside, col2_outside = st.columns(2)
            
        with col1_outside:
            # Fix: Don't use value parameter when key exists in session state
            if 'first_name_input_outside' in st.session_state:
                st.text_input(
                    "First Name *",
                    key="first_name_input_outside",
                    placeholder="e.g., John",
                    help="User's first name (required)",
                    on_change=on_first_name_change
                )
            else:
                # Use value parameter only for initial setup
                st.text_input(
                    "First Name *",
                    key="first_name_input_outside",
                    value=st.session_state.get('first_name_input', ''),
                    placeholder="e.g., John",
                    help="User's first name (required)",
                    on_change=on_first_name_change
                )
            
            # Keep the sync logic simple - only set if not already in session state
            if 'first_name_input_outside' in st.session_state and 'first_name_input' not in st.session_state:
                st.session_state['first_name_input'] = st.session_state['first_name_input_outside']
        
        with col2_outside:
            # Fix: Don't use value parameter when key exists in session state
            if 'last_name_input_outside' in st.session_state:
                st.text_input(
                    "Last Name",  # Removed the required asterisk since last name is optional
                    key="last_name_input_outside",
                    placeholder="e.g., Doe",
                    help="User's last name (optional)",
                    on_change=on_last_name_change
                )
            else:
                # Use value parameter only for initial setup
                st.text_input(
                    "Last Name",  # Removed the required asterisk since last name is optional
                    key="last_name_input_outside",
                    value=st.session_state.get('last_name_input', ''),
                    placeholder="e.g., Doe",
                    help="User's last name (optional)",
                    on_change=on_last_name_change
                )
            
            # Keep the sync logic simple - only set if not already in session state 
            if 'last_name_input_outside' in st.session_state and 'last_name_input' not in st.session_state:
                st.session_state['last_name_input'] = st.session_state['last_name_input_outside']
        
        # Username field outside form to handle manual edits
        username_value = st.session_state.get('username_input', '')
        # Reset the needs_update flag if it's set
        if st.session_state.get('username_needs_update', False):
            st.session_state['username_needs_update'] = False
            
        # Always render a single username input with conditional value
        if 'username_input_outside' in st.session_state:
            st.text_input(
                "Username *",
                key="username_input_outside",
                placeholder="e.g., johndoe123",
                help="Username for login (required, must be unique). Auto-generated based on name.",
                on_change=on_username_manual_edit
            )
        else:
            st.text_input(
                "Username *",
                key="username_input_outside",
                value=username_value if username_value else None,
                placeholder="e.g., johndoe123",
                help="Username for login (required, must be unique). Auto-generated based on name.",
                on_change=on_username_manual_edit
            )
        
        # Always sync from the widget to the internal value - this is safe
        if 'username_input_outside' in st.session_state:
            st.session_state['username_input'] = st.session_state['username_input_outside']
            
        if st.session_state.get('username_was_auto_generated', False):
            st.caption("Username auto-generated. Edit to create custom username.")
            
            # Add a check button to verify username uniqueness
            if st.button("Check Username Availability", key="check_username_btn"):
                username = st.session_state.get('username_input', '')
                if username:
                    try:
                        # Check in local database
                        with next(get_db()) as db:
                            local_existing = db.query(User).filter(User.username == username).first()
                        
                        # Check exact match in SSO
                        headers = {
                            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
                            'Content-Type': 'application/json'
                        }
                        
                        user_search_url = f"{Config.AUTHENTIK_API_URL}/core/users/?username={username}"
                        response = requests.get(user_search_url, headers=headers, timeout=10)
                        
                        if response.status_code == 200:
                            sso_users = response.json().get('results', [])
                            
                            if not local_existing and not sso_users:
                                st.success(f"Username '{username}' is available!")
                                logging.info(f"Username check: '{username}' is available")
                            else:
                                st.error(f"Username '{username}' is already taken. Please choose another.")
                                logging.warning(f"Username check: '{username}' is already taken")
                                # Suggest a different username
                                base_username = username
                                # Generate a unique suffix
                                existing_usernames = []
                                if local_existing:
                                    # Get similar usernames
                                    similar_local = db.query(User).filter(User.username.like(f"{base_username}%")).all()
                                    existing_usernames = [user.username for user in similar_local]
                                
                                if sso_users:
                                    # Add SSO usernames
                                    similar_sso_url = f"{Config.AUTHENTIK_API_URL}/core/users/?username__startswith={base_username}"
                                    sso_response = requests.get(similar_sso_url, headers=headers, timeout=10)
                                    if sso_response.status_code == 200:
                                        similar_sso_users = sso_response.json().get('results', [])
                                        sso_usernames = [user['username'] for user in similar_sso_users]
                                        existing_usernames.extend(sso_usernames)
                                
                                # Find available username with suffix
                                suffix = 1
                                while f"{base_username}{suffix}" in existing_usernames:
                                    suffix += 1
                                suggested_username = f"{base_username}{suffix}"
                                st.info(f"Suggestion: How about '{suggested_username}'?")
                        else:
                            st.warning("Could not verify username availability with SSO service.")
                            logging.warning(f"Username check: Could not verify with SSO: {response.status_code}")
                    except Exception as e:
                        logging.error(f"Error checking username availability: {str(e)}")
                        logging.error(traceback.format_exc())
                        st.error("An error occurred while checking username availability.")
        
        # Add a divider before the form
        st.divider()
        st.caption("Review the information above and click 'Create User' when ready.")
            
        # Now create the actual form with hidden fields that will be submitted
        with st.form("create_user_form_alt"):
            # Sync values between outside and inside forms
            # We don't need to assign these directly in hidden fields, as they'll be
            # read from session_state when needed
            
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
            
            # Submit buttons - Handle different Streamlit versions
            try:
                # Try to create three columns for buttons
                cols = st.columns([1, 1, 1])
                if len(cols) == 3:
                    col1, col2, col3 = cols
                    with col1:
                        submit_button = st.form_submit_button("Create User")
                    with col2:
                        clear_button = st.form_submit_button("Clear Form")
                    with col3:
                        # This is just a placeholder for layout balance
                        st.write("")
                else:
                    # Fall back to two columns if three aren't created
                    col1, col2 = st.columns(2)
                    with col1:
                        submit_button = st.form_submit_button("Create User")
                    with col2:
                        clear_button = st.form_submit_button("Clear Form")
            except Exception as e:
                # Fall back to simple layout if columns fail
                logging.warning(f"Error creating columns for buttons: {e}")
                submit_button = st.form_submit_button("Create User")
                clear_button = st.form_submit_button("Clear Form")
            
            # Display required fields note
            st.markdown("**Note:** Fields marked with * are required")
    
            # Handle form submission
            if submit_button:
                try:
                    # Validate required fields
                    username = st.session_state.get('username_input', '').strip()
                    first_name = st.session_state.get('first_name_input', '').strip()
                    email = st.session_state.get('email_input', '').strip()
                    
                    if not username:
                        st.error("Username is required")
                    elif not first_name:
                        st.error("First name is required")
                    elif not email:
                        st.error("Email is required")
                    else:
                        # Prepare user data
                        user_data = {
                            'username': username,
                            'name': f"{first_name} {st.session_state.get('last_name_input', '').strip()}".strip(),
                            'email': email,
                            'is_active': True,
                            'attributes': {
                                'invited_by': st.session_state.get('invited_by_input', '').strip(),
                                'intro': st.session_state.get('intro_input', '').strip()
                            }
                        }
                        
                        # Create user in Authentik
                        headers = {
                            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
                            'Content-Type': 'application/json'
                        }
                        
                        # First create the user in Authentik
                        create_user_url = f"{Config.AUTHENTIK_API_URL}/core/users/"
                        logging.info(f"Creating user with data: {user_data}")
                        logging.info(f"Using API URL: {create_user_url}")
                        
                        try:
                            response = requests.post(create_user_url, headers=headers, json=user_data)
                            logging.info(f"Response status code: {response.status_code}")
                            logging.info(f"Response headers: {response.headers}")
                            logging.info(f"Response body: {response.text}")
                            
                            if response.status_code == 201:
                                # User created successfully
                                created_username = user_data['username']
                                
                                # Generate a secure temporary password
                                temp_password = generate_secure_passphrase()
                                
                                # Set flags for next render
                                st.session_state['user_created'] = True
                                st.session_state['created_username'] = created_username
                                st.session_state['should_clear_form'] = True
                                
                                # Reset the password to our generated secure password
                                user_id = response.json().get('pk')
                                reset_url = f"{Config.AUTHENTIK_API_URL}/core/users/{user_id}/set_password/"
                                reset_data = {'password': temp_password}
                                reset_response = requests.post(reset_url, headers=headers, json=reset_data)
                                
                                if reset_response.status_code == 200:
                                    # Display welcome message using the message template from app/messages.py
                                    create_user_message(created_username, temp_password)
                                else:
                                    st.error(f"Failed to set password: {reset_response.text}")
                                
                                # Rerun to refresh the form
                                st.rerun()
                            else:
                                error_response = response.json()
                                logging.error(f"Error creating user: {error_response}")
                                logging.error(f"Response status: {response.status_code}")
                                
                                # Handle field-specific errors
                                if isinstance(error_response, dict):
                                    for field, errors in error_response.items():
                                        if isinstance(errors, list):
                                            error_msg = f"{field.title()}: {', '.join(errors)}"
                                            st.error(error_msg)
                                        else:
                                            st.error(f"{field.title()}: {errors}")
                                            
                                    # Suggest a new username if username is taken
                                    if 'username' in error_response and any('unique' in str(err).lower() for err in error_response['username']):
                                        # Generate a new unique username suggestion
                                        base_username = username
                                        suffix = 1
                                        while True:
                                            suggested_username = f"{base_username}{suffix}"
                                            # Check if suggested username exists
                                            check_url = f"{Config.AUTHENTIK_API_URL}/core/users/?username={suggested_username}"
                                            check_response = requests.get(check_url, headers=headers)
                                            if check_response.status_code == 200:
                                                results = check_response.json().get('results', [])
                                                if not results:
                                                    break
                                            suffix += 1
                                        st.info(f"Suggestion: Try using '{suggested_username}' instead")
                                else:
                                    st.error(f"Failed to create user: {error_response}")
                                
                        except requests.exceptions.RequestException as e:
                            logging.error(f"Request error: {str(e)}")
                            logging.error(traceback.format_exc())
                            st.error(f"Failed to connect to Authentik API: {str(e)}")
                        except json.JSONDecodeError as e:
                            logging.error(f"JSON decode error: {str(e)}")
                            logging.error(f"Raw response: {response.text}")
                            st.error("Failed to parse Authentik API response")
                        except Exception as e:
                            logging.error(f"Unexpected error: {str(e)}")
                            logging.error(traceback.format_exc())
                            st.error(f"An unexpected error occurred: {str(e)}")
                except Exception as e:
                    logging.error(f"Error creating user: {str(e)}")
                    logging.error(traceback.format_exc())
                    st.error(f"An error occurred while creating the user: {str(e)}")
            
            # Handle clear button
            elif clear_button:
                reset_create_user_form_fields()
                st.rerun()

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
            # Force rerun after username update for immediate feedback
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
            # Force rerun after username update for immediate feedback
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
                # Schedule a rerun
                st.rerun()

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
            with next(get_db()) as db:
                local_existing = db.query(User).filter(User.username.like(f"{base_username}%")).all()
                existing_usernames = [user.username for user in local_existing]
                logging.info(f"Found {len(existing_usernames)} existing usernames in local DB with prefix {base_username}")
            
            # Also check for existing username in Authentik SSO
            try:
                sso_usernames = []
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
                
                # Update session state - ONLY update username_input, not the widget value
                st.session_state['username_input'] = final_username
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
                    
                # Update only the internal value, not the widget value
                st.session_state['username_input'] = suggested_username
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