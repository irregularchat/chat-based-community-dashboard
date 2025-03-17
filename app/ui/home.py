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
from db.operations import search_users, User
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
from db.init_db import should_sync_users, sync_user_data, sync_user_data_incremental
from db.init_db import AdminEvent
from auth.api import get_users_modified_since
from ui.common import display_useful_links

# Set up session with retry logic
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

def reset_form():
    # Reset form fields
    if 'username' in st.session_state:
        del st.session_state['username']
    if 'full_name' in st.session_state:
        del st.session_state['full_name']
    if 'email' in st.session_state:
        del st.session_state['email']
    if 'invited_by' in st.session_state:
        del st.session_state['invited_by']
    if 'intro' in st.session_state:
        del st.session_state['intro']

def render_home_page():
    st.title("Community Dashboard")
    
    # Display Useful Links in the sidebar
    display_useful_links()
    
    # Define headers here to ensure they're available throughout the function
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    
    # Display Discourse integration status in the sidebar
    with st.sidebar.expander("Discourse Integration Status", expanded=False):
        # Check if Discourse integration is configured
        if all([Config.DISCOURSE_URL, Config.DISCOURSE_API_KEY, 
                Config.DISCOURSE_API_USERNAME, Config.DISCOURSE_CATEGORY_ID]):
            st.success("✅ Discourse integration is fully configured")
            st.write(f"URL: {Config.DISCOURSE_URL}")
            st.write(f"API Username: {Config.DISCOURSE_API_USERNAME}")
            st.write(f"Category ID: {Config.DISCOURSE_CATEGORY_ID}")
            st.write(f"Intro Tag: {Config.DISCOURSE_INTRO_TAG or 'Not set (optional)'}")
        else:
            st.error("⚠️ Discourse integration is not fully configured")
            st.write("The following settings are required for creating forum posts:")
            
            if not Config.DISCOURSE_URL:
                st.warning("❌ DISCOURSE_URL is not set")
            else:
                st.success(f"✅ DISCOURSE_URL: {Config.DISCOURSE_URL}")
                
            if not Config.DISCOURSE_API_KEY:
                st.warning("❌ DISCOURSE_API_KEY is not set")
            else:
                st.success("✅ DISCOURSE_API_KEY is set")
                
            if not Config.DISCOURSE_API_USERNAME:
                st.warning("❌ DISCOURSE_API_USERNAME is not set")
            else:
                st.success(f"✅ DISCOURSE_API_USERNAME: {Config.DISCOURSE_API_USERNAME}")
                
            if not Config.DISCOURSE_CATEGORY_ID:
                st.warning("❌ DISCOURSE_CATEGORY_ID is not set")
            else:
                st.success(f"✅ DISCOURSE_CATEGORY_ID: {Config.DISCOURSE_CATEGORY_ID}")
                
            st.info("Set these environment variables to enable Discourse integration")
    
    # Add a button to force user synchronization
    if st.sidebar.button("Force User Sync"):
        # Check if sync is already in progress
        if 'sync_in_progress' in st.session_state and st.session_state['sync_in_progress']:
            st.sidebar.warning("Sync already in progress, please wait...")
        else:
            st.sidebar.info("Starting user synchronization...")
            try:
                # Set sync in progress flag
                st.session_state['sync_in_progress'] = True
                
                with next(get_db()) as db:
                    # Ask user if they want a full sync or incremental sync
                    sync_type = st.sidebar.radio(
                        "Sync Type",
                        ["Incremental (Only Changed Users)", "Full (All Users)"],
                        index=0
                    )
                    
                    is_full_sync = sync_type == "Full (All Users)"
                    
                    if is_full_sync:
                        st.sidebar.info("Fetching all users from Authentik...")
                        # Get all users from Authentik
                        authentik_users = list_users(Config.AUTHENTIK_API_URL, headers)
                        
                        if authentik_users:
                            st.sidebar.info(f"Syncing {len(authentik_users)} users...")
                            # Use the incremental sync with full_sync=True
                            success = sync_user_data_incremental(db, authentik_users, full_sync=True)
                            
                            if success:
                                # Record sync event
                                sync_event = AdminEvent(
                                    timestamp=datetime.now(),
                                    event_type='system_sync',
                                    username='system',
                                    description=f'Manual full sync of {len(authentik_users)} users from Authentik'
                                )
                                db.add(sync_event)
                                db.commit()
                                
                                # Verify the sync worked
                                local_count = db.query(User).count()
                                st.sidebar.success(f"Successfully synced {len(authentik_users)} users. Local database now has {local_count} users.")
                            else:
                                st.sidebar.error("Sync failed. Check logs for details.")
                        else:
                            st.sidebar.error("No users fetched from Authentik API")
                    else:
                        # Get the last sync timestamp
                        last_sync = (
                            db.query(AdminEvent)
                              .filter(AdminEvent.event_type == 'system_sync')
                              .order_by(AdminEvent.timestamp.desc())
                              .first()
                        )
                        
                        if not last_sync:
                            st.sidebar.warning("No previous sync found. Performing full sync instead.")
                            # Get all users from Authentik
                            authentik_users = list_users(Config.AUTHENTIK_API_URL, headers)
                            
                            if authentik_users:
                                st.sidebar.info(f"Syncing {len(authentik_users)} users...")
                                # Use the incremental sync with full_sync=True
                                success = sync_user_data_incremental(db, authentik_users, full_sync=True)
                                
                                if success:
                                    # Record sync event
                                    sync_event = AdminEvent(
                                        timestamp=datetime.now(),
                                        event_type='system_sync',
                                        username='system',
                                        description=f'Manual full sync of {len(authentik_users)} users from Authentik'
                                    )
                                    db.add(sync_event)
                                    db.commit()
                                    
                                    # Verify the sync worked
                                    local_count = db.query(User).count()
                                    st.sidebar.success(f"Successfully synced {len(authentik_users)} users. Local database now has {local_count} users.")
                                else:
                                    st.sidebar.error("Sync failed. Check logs for details.")
                            else:
                                st.sidebar.error("No users fetched from Authentik API")
                        else:
                            st.sidebar.info(f"Getting users modified since {last_sync.timestamp}...")
                            # Get users modified since the last sync
                            modified_users = get_users_modified_since(
                                Config.AUTHENTIK_API_URL, 
                                headers, 
                                last_sync.timestamp
                            )
                            
                            if modified_users:
                                st.sidebar.info(f"Syncing {len(modified_users)} modified users...")
                                # Use the incremental sync with full_sync=False
                                success = sync_user_data_incremental(db, modified_users, full_sync=False)
                                
                                if success:
                                    # Record sync event
                                    sync_event = AdminEvent(
                                        timestamp=datetime.now(),
                                        event_type='system_sync',
                                        username='system',
                                        description=f'Manual incremental sync of {len(modified_users)} modified users from Authentik'
                                    )
                                    db.add(sync_event)
                                    db.commit()
                                    
                                    # Verify the sync worked
                                    local_count = db.query(User).count()
                                    st.sidebar.success(f"Successfully synced {len(modified_users)} modified users. Local database now has {local_count} users.")
                                else:
                                    st.sidebar.error("Sync failed. Check logs for details.")
                            else:
                                st.sidebar.info("No modified users found since last sync.")
                                # Still record a sync event to update the timestamp
                                sync_event = AdminEvent(
                                    timestamp=datetime.now(),
                                    event_type='system_sync',
                                    username='system',
                                    description='Manual check - no modified users found since last sync'
                                )
                                db.add(sync_event)
                                db.commit()
                    
                    # Update the last change check time
                    st.session_state['last_change_check'] = datetime.now()
                    
                    # Force refresh of the page
                    st.rerun()
            except Exception as e:
                st.sidebar.error(f"Error syncing users: {str(e)}")
                logging.error(f"Error during manual user sync: {e}")
            finally:
                # Clear sync in progress flag
                st.session_state['sync_in_progress'] = False
    
    # Clear all session state variables except those we want to keep
    for var in ['message', 'user_list', 'prev_operation']:
        if var in st.session_state:
            del st.session_state[var]

    # Initialize session state variables
    if 'last_sync_check' not in st.session_state:
        st.session_state['last_sync_check'] = datetime.now()
    if 'sync_interval' not in st.session_state:
        st.session_state['sync_interval'] = timedelta(minutes=5)
    
    for var in ['message', 'user_list', 'prev_operation']:
        if var not in st.session_state:
            st.session_state[var] = "" if var in ['message', 'prev_operation'] else []

    # Initialize show_* variables if they don't exist
    if 'show_create_user' not in st.session_state:
        st.session_state['show_create_user'] = False
    if 'show_invite_form' not in st.session_state:
        st.session_state['show_invite_form'] = False
    if 'show_user_list' not in st.session_state:
        st.session_state['show_user_list'] = False
    if 'show_operation_selector' not in st.session_state:
        st.session_state['show_operation_selector'] = True

    # Operation selection - only show if none of the specific forms are requested
    # or if show_operation_selector is True
    if (not (st.session_state['show_create_user'] or st.session_state['show_invite_form'] or 
             st.session_state['show_user_list']) and st.session_state['show_operation_selector']):
        operation = st.selectbox(
            "Select Operation",
            ["Create User", "Create Invite", "List and Manage Users"],
            key="operation_selection"
        )

        # Only reset form if operation changes
        if 'prev_operation' not in st.session_state or st.session_state['prev_operation'] != operation:
            reset_form()
            st.session_state['prev_operation'] = operation
    else:
        # Set operation based on session state
        if st.session_state['show_create_user']:
            operation = "Create User"
        elif st.session_state['show_invite_form']:
            operation = "Create Invite"
        elif st.session_state['show_user_list']:
            operation = "List and Manage Users"
        else:
            operation = "Create User"  # Default
        
        # Reset form when switching operations
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
        
        if st.button("Create Invite"):
            if not invite_label:
                st.error("Invite label is required.")
                return
            if not expires_date or not expires_time:
                st.error("Expiration date and time are required.")
                return

            # Combine date and time and set Eastern timezone
            eastern = timezone('US/Eastern')
            expires_datetime = datetime.combine(expires_date, expires_time)
            expires_datetime = eastern.localize(expires_datetime)
            expires_iso = expires_datetime.isoformat()

            # Call create_invite with the ISO formatted string
            invite_link, invite_expires = create_invite(headers, invite_label, expires_iso)
            if invite_link:
                create_invite_message(invite_label, invite_link, expires_datetime)
                
                # Add to timeline
                with next(get_db()) as db:
                    add_timeline_event(
                        db,
                        "invite_created",
                        "system",
                        f"Created invite with label: {invite_label}"
                    )
            else:
                st.error("Failed to create invite.")
    elif operation == "List and Manage Users":
        st.markdown("""
            ### Search Help
            You can search by specific columns using the format `column:value`. For example:
            - `username:john`
            - `intro:engineer`
            - `email:gmail`
            
            Multiple search terms can be combined with spaces:
            - `username:john intro:engineer`
            
            Or search across all fields by entering text without a column specifier.
        """)
        
        username_input = st.text_input(
            "Search Query", 
            key="username_input", 
            placeholder="e.g., username:john intro:engineer"
        )
        
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
                                'name': getattr(user, 'name', ''),
                                'email': getattr(user, 'email', ''),
                                'is_active': getattr(user, 'is_active', True),
                                'last_login': getattr(user, 'last_login', None),
                                'intro': getattr(user, 'attributes', {}).get('intro', ''),
                                'attributes': {
                                    'intro': getattr(user, 'attributes', {}).get('intro', ''),
                                    'invited_by': getattr(user, 'attributes', {}).get('invited_by', '')
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
                # Extract the username from the selected_users list
                username = action_data['selected_users'][0] if action_data['selected_users'] else None
                
                if username:
                    handle_form_submission(
                        action=action_data['action'],
                        username=username,
                        verification_context=action_data.get('verification_context', '')
                    )
                # Clear the pending action after handling
                del st.session_state['pending_action']
        elif search_button:
            st.info("No users found matching your search criteria.")

