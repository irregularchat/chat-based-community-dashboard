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
    add_timeline_event,
    handle_form_submission
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

            # Handle form submission with named arguments
            handle_form_submission(
                action=operation,
                username=username,
                email=email_input,
                invited_by=invited_by,
                intro=intro,
                verification_context=None
            )
    elif operation == "Create Invite":
        invite_label, expires_date, expires_time = render_invite_form()
        # Handle invite creation logic here
        invite_button = st.button("Create Invite")
        if invite_button:
            handle_form_submission(
                action=operation,
                username=None,
                invited_by=None,
                intro=None,
                verification_context=None
            )
    elif operation == "List and Manage Users":
        username_input = st.text_input("Search Query", key="username_input", placeholder="Enter username or email to search")
        
        # Add a submit button for the search
        search_button = st.button("Search")
        
        if search_button:
            with next(get_db()) as db:
                try:
                    users = search_users(db, username_input)
                    if users:
                        formatted_users = []
                        for user in users:
                            user_id = getattr(user, 'id', None) or getattr(user, 'user_id', None)
                            formatted_user = {
                                'pk': user_id,
                                'username': getattr(user, 'username', ''),
                                'name': f"{getattr(user, 'first_name', '')} {getattr(user, 'last_name', '')}".strip(),
                                'email': getattr(user, 'email', ''),
                                'is_active': getattr(user, 'is_active', True),
                                'last_login': getattr(user, 'last_login', None),
                                'intro': getattr(user, 'intro', ''),
                                'attributes': {
                                    'intro': getattr(user, 'intro', ''),
                                    'invited_by': getattr(user, 'invited_by', '')
                                }
                            }
                            formatted_users.append(formatted_user)
                        st.session_state['user_list'] = formatted_users
                    else:
                        st.session_state['user_list'] = []
                except Exception as e:
                    st.error(f"Error searching users: {str(e)}")
                    logging.error(f"Error searching users: {str(e)}")
        
        # Display user list and handle pending actions
        if 'user_list' in st.session_state and st.session_state['user_list']:
            display_user_list(Config.AUTHENTIK_API_URL, headers)
            
            # Handle any pending actions from the grid
            if 'pending_action' in st.session_state:
                action_data = st.session_state['pending_action']
                handle_form_submission(
                    action_data['action'],
                    action_data['selected_users'],
                    verification_context=action_data.get('verification_context', '')
                )
                # Clear the pending action after handling
                del st.session_state['pending_action']
        elif search_button:
            st.info("No users found matching your search criteria.")

