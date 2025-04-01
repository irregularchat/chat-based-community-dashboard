# ui/home.py
import streamlit as st
import os
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from st_aggrid import AgGrid, GridOptionsBuilder, GridUpdateMode, DataReturnMode
import json
from app.utils.config import Config
from app.auth.api import (
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
    list_users
)
from app.ui.forms import render_create_user_form, render_invite_form, display_user_list
from app.utils.helpers import (
    create_unique_username,
    update_username,
    get_eastern_time,
    add_timeline_event,
    handle_form_submission
)
from app.db.session import get_db
from app.db.operations import search_users, User
from app.messages import (
    create_user_message,
    create_recovery_message,
    create_invite_message, 
    multi_recovery_message
)
import logging
import pandas as pd
from datetime import datetime, timedelta
from pytz import timezone  # Ensure this is imported
from app.utils.transformations import parse_input
from app.db.init_db import should_sync_users, sync_user_data, sync_user_data_incremental
from app.db.init_db import AdminEvent
from app.auth.api import get_users_modified_since
from app.ui.common import display_useful_links

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

async def render_home_page():
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
        return await render_create_user_form()
    elif operation == "Create Invite":
        return await render_invite_form()
    elif operation == "List and Manage Users":
        return await display_user_list()

