# ui/home.py
import streamlit as st
import os
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from st_aggrid import AgGrid, GridOptionsBuilder, GridUpdateMode, DataReturnMode
import json
from utils.config import Config
from auth.api import (
    create_user,
    force_password_reset,
    generate_secure_passphrase,
    list_users_cached,
    update_user_status,
    delete_user,
    reset_user_password,
    update_user_intro,
    update_user_invited_by,
    create_invite,
    shorten_url,
    list_users,
    webhook_notification
)
from ui.forms import render_create_user_form, render_invite_form, display_user_list
from utils.helpers import (
    create_unique_username,
    update_username,
    get_eastern_time,
    add_timeline_event
)
from db.database import get_db
from db.operations import search_users
from messages import (
    create_user_message,
    create_recovery_message,
    create_invite_message, 
    multi_recovery_message
)
import logging
import pandas as pd
from datetime import datetime, timedelta
from pytz import timezone  # Ensure this is imported
from utils.transformations import parse_input
from db.init_db import should_sync_users, sync_user_data

session = requests.Session()
retry = Retry(
    total=2,  # Reduced total retries
    backoff_factor=0.5,  # Reduced backoff factor
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["HEAD", "GET", "POST", "PUT", "DELETE", "OPTIONS", "TRACE"]
)
adapter = HTTPAdapter(max_retries=retry)
session.mount("http://", adapter)
session.mount("https://", adapter)

# define headers
headers = {
    'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
    'Content-Type': 'application/json'
}


def reset_form():
    for key in [
        'first_name_input', 'last_name_input', 'username_input', 'email_input',
        'invited_by', 'intro', 'invite_label', 'expires_date', 'expires_time'
    ]:
        if key in st.session_state:
            del st.session_state[key]

def render_home_page():
    # Initialize session state variables
    if 'last_sync_check' not in st.session_state:
        st.session_state['last_sync_check'] = datetime.now()
    if 'sync_interval' not in st.session_state:
        st.session_state['sync_interval'] = timedelta(minutes=5)
    
    for var in ['message', 'user_list', 'prev_operation']:
        if var not in st.session_state:
            st.session_state[var] = "" if var in ['message', 'prev_operation'] else []

    # Operation selection
    operation = st.selectbox(
        "Select Operation",
        ["Create User", "Create Invite", "List and Manage Users"],
        key="operation_selection"
    )

    # Only reset form if operation changes
    if 'prev_operation' not in st.session_state or st.session_state['prev_operation'] != operation:
        reset_form()
        st.session_state['prev_operation'] = operation

    # Render form based on operation
    if operation == "Create User":
        first_name, last_name, username, email_input, invited_by, intro, submit_button = render_create_user_form()

        if submit_button:
            if not first_name and not last_name:
                st.error("At least one of first name or last name is required.")
                return

            # Handle form submission with the correct values
            handle_form_submission(
                operation,
                username,
                email_input,
                invited_by,
                intro,
                None,
                None,
                first_name,
                last_name
            )
    elif operation == "Create Invite":
        invite_label, expires_date, expires_time = render_invite_form()
        # Handle invite creation logic here
        invite_button = st.button("Create Invite")
        if invite_button:
            handle_form_submission(
                operation,
                None,
                None,
                None,
                None,
                expires_date,
                expires_time,
                None,
                None,
                invite_label
            )
    elif operation == "List and Manage Users":
        username_input = st.text_input("Search Query", key="username_input", placeholder="Enter username or email to search")
        
        # Add a submit button for the search
        search_button = st.button("Search")
        
        if search_button:
            handle_form_submission(
                operation,
                username_input,
                None,
                None,
                None,
                None,
                None,
                None,
                None
            )
        
        # Always try to display the user list if there's data in session state
        if 'user_list' in st.session_state and st.session_state['user_list']:
            display_user_list(Config.AUTHENTIK_API_URL, headers)
        elif search_button:  # Only show "no results" message if search was attempted
            st.info("No users found matching your search criteria.")


def handle_form_submission(
    operation, username_input, email_input, invited_by, intro, expires_date,
    expires_time, first_name, last_name, invite_label=None
):  
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    try:
        if operation == "Create User":
            if not first_name and not last_name:
                st.error("At least one of first name or last name is required.")
                return

            # Get database session
            db = next(get_db())

            # Check if the username already exists using database search
            existing_users = search_users(db, username_input)
            if existing_users:
                st.warning(f"User '{username_input}' already exists. Creating a unique username.")
                new_username = create_unique_username(db, username_input)
            else:
                new_username = username_input

            email = email_input if email_input else f"{new_username}@{Config.BASE_DOMAIN}"

            # Construct the full name based on available inputs
            if first_name and last_name:
                full_name = f"{first_name.strip()} {last_name.strip()}"
            elif first_name:
                full_name = first_name.strip()
            elif last_name:
                full_name = last_name.strip()
            else:
                full_name = ""  # This should not occur due to the earlier check

            # Create the user
            new_user, temp_password = create_user(new_username, full_name, email, invited_by, intro)
            if new_user:
                # Use the username from the created user
                created_username = new_user.get('username', new_username)
                
                # Add timeline event
                event_description = (
                    f"Created user: {full_name} ({created_username})\n"
                    f"Email: {email}\n"
                    f"Invited by: {invited_by if invited_by else 'N/A'}\n"
                    f"Intro: {intro if intro else 'N/A'}"
                )
                add_timeline_event(
                    db=db,
                    event_type='user_created',
                    username=created_username,
                    event_description=event_description
                )
                
                create_user_message(created_username, temp_password)
                # Send a webhook notification
                """webhook_notification
                function is defined in auth/api.py and is called here. 
                New format def webhook_notification(event_type, username=None, full_name=None, email=None, intro=None, invited_by=None, password=None):
                """
                webhook_notification("user_created", created_username, full_name, email, intro, invited_by, temp_password)
                st.success(f"User '{created_username}' created successfully with a temporary password.")
            else:
                st.error("Failed to create user. Please verify inputs and try again.")
        elif operation == "Reset User Password":
            if not username_input:
                st.error("Username is required to reset password.")
                return
            new_password = generate_secure_passphrase()
            # First, get the user ID by username
            user_search_url = f"{Config.AUTHENTIK_API_URL}/core/users/?search={username_input}"
            try:
                response = session.get(user_search_url, headers=headers, timeout=10)
                response.raise_for_status()
                users = response.json().get('results', [])
                if users:
                    user_id = users[0]['pk']
                    if reset_user_password(Config.AUTHENTIK_API_URL, headers, user_id, new_password):
                        create_recovery_message(username_input, new_password)
                        st.success(f"Password reset successfully for user: {username_input}")
                    else:
                        st.error("Failed to set new password.")
                else:
                    st.error(f"No user found with username: {username_input}")
            except requests.exceptions.RequestException as e:
                st.error(f"Error occurred while resetting password: {str(e)}")
            
        elif operation == "Create Invite":
            if not invite_label:
                st.error("Invite label is required.")
                return
            if not expires_date or not expires_time:
                st.error("Expiration date and time are required.")
                return

            # Convert to Eastern Time
            eastern_time = get_eastern_time(expires_date, expires_time)
            expires_iso = eastern_time.isoformat()

            invite_link, invite_expires = create_invite(headers, invite_label, expires_iso)
            if invite_link:
                create_invite_message(invite_label, invite_link, invite_expires)
            else:
                st.error("Failed to create invite.")

        elif operation == "List and Manage Users":
            search_query = username_input.strip()
            
            # Get a database session
            db = next(get_db())
            
            # Search users in the database
            local_users = search_users(db, search_query)
            
            if local_users:
                # Convert SQLAlchemy objects to dictionaries
                st.session_state['user_list'] = [user.to_dict() for user in local_users]
            else:
                # Only check for sync if enough time has passed
                current_time = datetime.now()
                if (current_time - st.session_state['last_sync_check']) > st.session_state['sync_interval']:
                    st.session_state['last_sync_check'] = current_time
                    if should_sync_users(db):
                        with st.spinner('Syncing user data...'):
                            authentik_users = list_users(Config.AUTHENTIK_API_URL, headers)
                            if authentik_users:
                                sync_user_data(db, authentik_users)
                                local_users = search_users(db, search_query)
                                if local_users:
                                    st.session_state['user_list'] = [user.to_dict() for user in local_users]
                                    return
            
            # Only if still no results, use API as last resort
            users = list_users(Config.AUTHENTIK_API_URL, headers, search_query)
            if users:
                st.session_state['user_list'] = users

            # Display user list if there are results
            if st.session_state['user_list']:
                display_user_list(Config.AUTHENTIK_API_URL, headers)
            else:
                st.info("No users found matching your search criteria.")

    except Exception as e:
        st.error(f"An error occurred during '{operation}': {e}")
        logging.error(f"Error during '{operation}': {e}")

