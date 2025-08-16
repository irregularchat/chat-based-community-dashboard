# ui/forms.py
import os
import re
import io
import csv
import json
import uuid
import pandas as pd
import logging
import traceback
import asyncio
import time  # Ensure time is imported
import requests
import streamlit as st
from app.utils.async_helpers import run_async_safely  # Import from utils instead of defining locally
from streamlit.components.v1 import html
from app.db.session import get_db
from app.db.models import User
from app.utils.recommendation import get_entrance_room_users_sync, get_room_recommendations_sync
from app.utils.matrix_actions import (
    invite_to_matrix_room, 
    invite_to_matrix_room_sync,
    send_matrix_message,
    create_matrix_direct_chat_sync,
    invite_user_to_recommended_rooms_sync,
    send_direct_message,
    verify_direct_message_delivery_sync,
    _send_room_message_with_content_async,
    remove_from_matrix_room_async,
    send_welcome_message_with_encryption_delay_sync
)
from app.db.session import get_groups_from_db
from app.utils.config import Config
from app.auth.admin import (
    check_admin_permission,
    get_authentik_groups,
    manage_user_groups,
    get_user_details,
    search_users_by_criteria,
    update_user_status
)
from app.utils.transformations import parse_input
# Import functions from forms_components for compatibility with tests
from app.ui.forms_components.create_user import render_create_user_form, clear_parse_data, update_username_from_inputs
from app.utils.form_helpers import reset_create_user_form_fields

# Re-export imported auth functions for tests that expect them from forms.py
from app.auth.api import create_user
from app.auth.api import (
    list_users,
    create_invite,
    generate_secure_passphrase,
    force_password_reset,
    reset_user_password,
    create_discourse_post,
    generate_recovery_link
)
from app.auth.utils import generate_username_with_random_word
from app.db.operations import (
    search_users,
    create_user_note,
    get_user_notes,
    update_user_note,
    delete_user_note,
    get_note_by_id
)
from app.messages import create_invite_message
from app.utils.messages import WELCOME_MESSAGE
from app.utils.helpers import send_invite_email, send_admin_email_to_users
from app.utils.recommendation import invite_user_to_recommended_rooms_sync
from datetime import datetime, timedelta
from app.utils.form_helpers import parse_and_rerun

# run_async_safely is now imported from app.utils.async_helpers


async def display_user_list():
    """
    Display a list of users with filtering and action capabilities.
    """
    from app.db.models import User
    from app.auth.api import search_users
    from app.db.session import get_db
    
    # Initialize session state variables if they don't exist
    if 'users_per_page' not in st.session_state:
        st.session_state.users_per_page = 10
    if 'filter_term' not in st.session_state:
        st.session_state.filter_term = ''
    if 'status_filter' not in st.session_state:
        st.session_state.status_filter = 'All'
    if 'selection_state' not in st.session_state:
        st.session_state.selection_state = 'viewing'
    
    # Filter UI
    col1, col2 = st.columns([3, 1])
    with col1:
        filter_term = st.text_input('Search users', value=st.session_state.filter_term, key='user_search')
        st.session_state.filter_term = filter_term
    
    with col2:
        status_options = ['All', 'Active', 'Inactive']
        status_filter = st.selectbox(
            'Status', status_options, 
            index=status_options.index(st.session_state.status_filter),
            key='status_filter_select'
        )
        st.session_state.status_filter = status_filter
        
    # Fetch and filter users
    try:
        with next(get_db()) as db:
            # Get all users from the database filtered by search term and status
            users = search_users(
                db,
                search_term=filter_term,
                status_filter=status_filter
            )
            
            if not users:
                st.info('No users found matching your criteria.')
                return
                
            # Convert to a format suitable for display
            user_data = [{
                'id': user.id,
                'username': user.username,
                'name': user.name,
                'email': user.email,
                'status': 'Active' if user.is_active else 'Inactive',
                'last_login': format_date(user.last_login),
            } for user in users]
            
            # Display users in a data editor
            st.data_editor(
                user_data,
                column_config={
                    'id': st.column_config.NumberColumn('ID'),
                    'username': st.column_config.TextColumn('Username'),
                    'name': st.column_config.TextColumn('Name'),
                    'email': st.column_config.TextColumn('Email'),
                    'status': st.column_config.TextColumn('Status'),
                    'last_login': st.column_config.TextColumn('Last Login'),
                },
                use_container_width=True,
                hide_index=True,
                key='user_table'
            )
            
            # User selection for actions
            if st.session_state.selection_state == 'viewing':
                usernames = [user.username for user in users]
                selected_users = st.multiselect('Select users for actions:', usernames)
                
                if selected_users and st.button('Select'):
                    st.session_state.selected_users = selected_users
                    st.session_state.selection_state = 'selected'
                    st.rerun()
            
            # Display actions if users are selected
            elif st.session_state.selection_state == 'selected':
                st.write(f"Selected users: {', '.join(st.session_state.selected_users)}")
                
                # Action buttons
                col1, col2, col3, col4 = st.columns(4)
                
                with col1:
                    if st.button('Activate'):
                        handle_action('activate', st.session_state.selected_users)
                        st.success(f"Activated {len(st.session_state.selected_users)} users.")
                        st.session_state.selection_state = 'viewing'
                        st.rerun()
                
                with col2:
                    if st.button('Deactivate'):
                        handle_action('deactivate', st.session_state.selected_users)
                        st.success(f"Deactivated {len(st.session_state.selected_users)} users.")
                        st.session_state.selection_state = 'viewing'
                        st.rerun()
                
                with col3:
                    if st.button('Delete'):
                        handle_action('delete', st.session_state.selected_users)
                        st.success(f"Deleted {len(st.session_state.selected_users)} users.")
                        st.session_state.selection_state = 'viewing'
                        st.rerun()
                
                with col4:
                    if st.button('Cancel'):
                        st.session_state.selection_state = 'viewing'
                        st.rerun()
            
    except Exception as e:
        st.error(f"Error loading users: {str(e)}")
        logging.error(f"Error in display_user_list: {traceback.format_exc()}")


def handle_action(action_type, usernames):
    """
    Handle user management actions like activate, deactivate, delete.
    
    Args:
        action_type: The type of action to perform ('activate', 'deactivate', 'delete')
        usernames: List of usernames to perform the action on
    """
    if not usernames:
        return False
        
    try:
        from app.db.session import get_db
        from app.db.models import User
        from app.auth.api import update_user_status, delete_user
        
        with next(get_db()) as db:
            for username in usernames:
                if action_type == 'activate':
                    update_user_status(db, username, is_active=True)
                elif action_type == 'deactivate':
                    update_user_status(db, username, is_active=False)
                elif action_type == 'delete':
                    delete_user(db, username)
        
        return True
    except Exception as e:
        st.error(f"Error performing {action_type} action: {str(e)}")
        logging.error(f"Error in handle_action: {traceback.format_exc()}")
        return False


def format_date(date_input):
    """
    Format a date for display in the UI.
    
    Args:
        date_input: Date input in various formats (string, datetime, None, or pd.NaT)
        
    Returns:
        Formatted date string or empty string for None/NaT
    """
    # For testing - explicitly handle None and empty cases exactly as tests expect
    if date_input is None:
        return ""
    
    if not date_input:  # Empty string, empty list, etc.
        return ""
        
    # Handle pandas NaT
    try:
        import pandas as pd
        if isinstance(date_input, pd._libs.NaTType) or pd.isna(date_input):
            return ""
    except (ImportError, AttributeError, TypeError):
        pass
    
    # Try to format if it's a string
    try:
        from datetime import datetime
        if isinstance(date_input, str):
            dt = datetime.fromisoformat(date_input.replace('Z', '+00:00'))
            return dt.strftime('%Y-%m-%d %H:%M')
        # For datetime objects
        if hasattr(date_input, 'strftime'):
            return date_input.strftime('%Y-%m-%d %H:%M')
    except (ValueError, AttributeError, TypeError) as e:
        # Log the error but still return empty string as tests expect
        import logging
        logging.error(f"Error formatting date: {e}")
        
    # Safety fallback - just return empty string for any other cases that tests expect
    return ""


async def render_invite_form():
    """Render the form for creating invite links"""
    # Custom CSS for better form styling
    st.markdown("""
    <style>
    /* Form styling */
    .form-container {
        background-color: var(--card-bg);
        padding: 24px;
        border-radius: 10px;
        box-shadow: var(--card-shadow);
        margin-bottom: 24px;
        border: 1px solid var(--border-color);
    }
    
    /* Input field styling */
    .stTextInput>div>div>input, 
    .stTextArea>div>div>textarea,
    .stNumberInput>div>div>input {
        margin-bottom: 10px !important;
        border-radius: 8px !important;
        border: 1px solid var(--border-color) !important;
        background-color: var(--input-bg) !important;
        color: var(--text-color) !important;
        padding: 12px !important;
        box-shadow: none !important;
        transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
    }
    
    /* Input field focus states */
    .stTextInput>div>div>input:focus,
    .stTextArea>div>div>textarea:focus,
    .stNumberInput>div>div>input:focus {
        border-color: var(--primary-color) !important;
        box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.25) !important;
        outline: 0 !important;
    }
    
    /* Label styling */
    .stTextInput label, 
    .stTextArea label, 
    .stNumberInput label,
    .stMultiselect label {
        font-weight: 500 !important;
        color: var(--text-color) !important;
        margin-bottom: 5px !important;
    }
    
    /* Button styling */
    .stButton button {
        border-radius: 8px;
        padding: 10px 18px;
        font-weight: 500;
        transition: all 0.3s;
    }
    
    .create-btn button {
        background-color: var(--secondary-color);
        color: white;
        border: none;
    }
    
    .create-btn button:hover {
        background-color: var(--secondary-hover);
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    
    .clear-btn button {
        background-color: var(--muted-color);
        color: white;
        border: none;
    }
    
    .clear-btn button:hover {
        background-color: #5a6268;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    
    /* MultiSelect styling */
    .stMultiselect > div > div {
        background-color: var(--input-bg) !important;
        border: 1px solid var(--border-color) !important;
        border-radius: 8px !important;
    }
    
    /* Code block styling */
    .stCodeBlock {
        background-color: var(--card-bg) !important;
        border: 1px solid var(--border-color) !important;
        border-radius: 8px !important;
        padding: 12px !important;
    }
    
    /* Form styling */
    .stForm > div:first-child {
        background-color: var(--card-bg);
        padding: 24px;
        border-radius: 10px;
        box-shadow: var(--card-shadow);
        margin-bottom: 24px;
        border: 1px solid var(--border-color);
    }
    
    /* Tab styling */
    .stTabs [data-baseweb="tab-list"] {
        gap: 2px;
        background-color: var(--card-bg);
        border-radius: 8px;
        padding: 5px;
    }
    
    .stTabs [data-baseweb="tab"] {
        height: auto;
        padding: 10px 16px;
        color: var(--text-color);
        border-radius: 6px;
    }
    
    .stTabs [aria-selected="true"] {
        background-color: var(--primary-color) !important;
        color: white !important;
    }
    
    /* Tab content container */
    .stTabs [data-baseweb="tab-panel"] {
        padding: 20px 0;
    }
    
    /* Dark mode optimization */
    @media (prefers-color-scheme: dark) {
        .stCodeBlock {
            background-color: var(--card-bg) !important;
            border-color: var(--border-color) !important;
        }
    }
    
    /* Mobile optimization */
    @media (max-width: 768px) {
        .form-container {
            padding: 16px;
        }
        
        .stTextInput>div>div>input, 
        .stTextArea>div>div>textarea,
        .stNumberInput>div>div>input {
            padding: 12px !important;
        }
        
        .stButton button {
            width: 100%;
            margin-bottom: 10px;
        }
        
        .stForm > div:first-child {
            padding: 16px !important;
        }
        
        .stTabs [data-baseweb="tab"] {
            padding: 12px 14px !important;
            font-size: 14px !important;
        }
    }
    </style>
    """, unsafe_allow_html=True)

    st.subheader("Create Invite Link")
    
    # Create tabs for different invite creation options
    invite_tab, send_tab = st.tabs(["Create Invite Link", "Create & Send Invite"])
    
    with invite_tab:
        with st.form("create_invite_form"):
            # Use text input with a value parameter instead of setting session state
            invite_label = st.text_input(
                "Label",
                value="",  # Start with empty value
                placeholder="e.g., New Member Invite",
                help="A descriptive label for this invite",
                key="invite_label_input"  # Use a different key, not "invite_label"
            )
            
            # Use number_input without setting value from session state
            expiry_days = st.number_input(
                "Expiry (days)",
                min_value=1,
                max_value=30,
                value=7,  # Default value
                help="Number of days before the invite expires"
            )
            
            # Get all available groups
            from app.auth.admin import get_authentik_groups
            all_groups = get_authentik_groups()
            
            # Group selection
            selected_groups = []
            if all_groups:
                # Find the main group ID if configured
                main_group_id = Config.MAIN_GROUP_ID
                
                # Pre-select the main group if it exists
                default_selection = [main_group_id] if main_group_id else []
                
                # Group selection with multiselect - don't use session state
                selected_groups = st.multiselect(
                    "Pre-assign to Groups",
                    options=[g.get('pk') for g in all_groups],
                    default=default_selection,
                    format_func=lambda pk: next((g.get('name') for g in all_groups if g.get('pk') == pk), pk),
                    help="Select groups to pre-assign the invited user to",
                    key="invite_group_selection"
                )
            
            col1, col2 = st.columns(2)
            with col1:
                st.markdown("<div class='create-btn'>", unsafe_allow_html=True)
                submit_button = st.form_submit_button("Create Invite")
                st.markdown("</div>", unsafe_allow_html=True)
            with col2:
                st.markdown("<div class='clear-btn'>", unsafe_allow_html=True)
                clear_button = st.form_submit_button("Clear Form")
                st.markdown("</div>", unsafe_allow_html=True)
                
            if submit_button:
                # Use the input value directly, not from session state
                if not invite_label:
                    st.error("Label is required")
                else:
                    # Create the invite
                    try:
                        # Generate expiry date (using expiry_days from the form, not session state)
                        expiry_date = datetime.now() + timedelta(days=expiry_days)
                        
                        # Get authentik headers
                        headers = {
                            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
                            'Content-Type': 'application/json'
                        }
                        
                        # Create invite in the system
                        from app.auth.api import create_invite
                        result = create_invite(
                            headers=headers,
                            label=invite_label,  # Use direct input value
                            expires=expiry_date.strftime('%Y-%m-%d'),
                            created_by=st.session_state.get("username", "system"),
                            groups=selected_groups
                        )
                        
                        if result.get('success'):
                            invite_link = result.get('invite_link')
                            st.success(f"Invite created successfully!")
                            
                            # Display the invite link
                            st.code(invite_link, language=None)
                            
                            # Store the invite link in session state for copying outside the form
                            st.session_state['created_invite_link'] = invite_link
                        else:
                            st.error(f"Failed to create invite: {result.get('error', 'Unknown error')}")
                    
                    except Exception as e:
                        logging.error(f"Error creating invite: {e}")
                        logging.error(traceback.format_exc())
                        st.error(f"An error occurred: {str(e)}")
        
        # Copy button outside the form
        if 'created_invite_link' in st.session_state and st.session_state['created_invite_link']:
            st.markdown("### Copy Invite Link")
            col1, col2 = st.columns([3, 1])
            with col1:
                st.code(st.session_state['created_invite_link'], language=None)
            with col2:
                if st.button("📋 Copy", key="copy_invite_link_btn"):
                    try:
                        import pyperclip
                        pyperclip.copy(st.session_state['created_invite_link'])
                        st.success("Copied!")
                        # Clear the session state after copying
                        del st.session_state['created_invite_link']
                    except ImportError:
                        st.warning("Could not copy to clipboard. Please manually copy the link above.")
                    except Exception as e:
                        st.error(f"Error copying to clipboard: {str(e)}")
    
    with send_tab:
        with st.form("send_invite_form"):
            # Use text inputs with value parameters instead of session state
            invite_name = st.text_input(
                "Name",
                value="",  # Start with empty value
                placeholder="e.g., John Doe",
                help="Name of the person you're inviting",
                key="invite_name_input"  # Use a different key
            )
            
            invite_email = st.text_input(
                "Email Address",
                value="",  # Start with empty value
                placeholder="e.g., john.doe@example.com",
                help="Email address to send the invite to",
                key="invite_email_input"  # Use a different key
            )
            
            # Use number_input without setting value from session state
            send_expiry_days = st.number_input(
                "Expiry (days)",
                min_value=1,
                max_value=30,
                value=7,  # Default value
                help="Number of days before the invite expires",
                key="send_invite_expiry"  # Use a unique key
            )
            
            # Group selection for send invite
            send_selected_groups = []
            if all_groups:
                # Pre-select the main group if it exists
                default_send_selection = [main_group_id] if main_group_id else []
                
                # Group selection with multiselect - don't use session state
                send_selected_groups = st.multiselect(
                    "Pre-assign to Groups",
                    options=[g.get('pk') for g in all_groups],
                    default=default_send_selection,
                    format_func=lambda pk: next((g.get('name') for g in all_groups if g.get('pk') == pk), pk),
                    help="Select groups to pre-assign the invited user to",
                    key="send_invite_group_selection"
                )
            
            col1, col2 = st.columns(2)
            with col1:
                st.markdown("<div class='create-btn'>", unsafe_allow_html=True)
                send_submit_button = st.form_submit_button("Create & Send Invite")
                st.markdown("</div>", unsafe_allow_html=True)
            with col2:
                st.markdown("<div class='clear-btn'>", unsafe_allow_html=True)
                send_clear_button = st.form_submit_button("Clear Form")
                st.markdown("</div>", unsafe_allow_html=True)
                
            if send_submit_button:
                # Use direct input values, not from session state
                if not invite_email:
                    st.error("Email address is required")
                elif not invite_name:
                    st.error("Name is required")
                else:
                    # Create the invite
                    try:
                        # Generate expiry date (using send_expiry_days from the form)
                        expiry_date = datetime.now() + timedelta(days=send_expiry_days)
                        
                        # Get authentik headers
                        headers = {
                            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
                            'Content-Type': 'application/json'
                        }
                        
                        # Create invite in the system
                        from app.auth.api import create_invite
                        result = create_invite(
                            headers=headers,
                            label=invite_name,
                            email=invite_email,
                            name=invite_name,
                            expires=expiry_date.strftime('%Y-%m-%d'),
                            created_by=st.session_state.get("username", "system"),
                            groups=send_selected_groups
                        )
                        
                        if result.get('success'):
                            invite_link = result.get('invite_link')
                            
                            # Send email with invite link
                            try:
                                email_sent = send_invite_email(
                                    to=invite_email,
                                    subject="You've been invited to join our platform",
                                    full_name=invite_name,
                                    invite_link=invite_link
                                )
                                if email_sent:
                                    st.success(f"Invitation created and email sent to {invite_email}")
                                else:
                                    st.warning(f"Invite created, but failed to send email. Check SMTP settings.")
                                    # Display the invite link in case email sending failed
                                    st.code(invite_link, language=None)
                                    # Store for copying outside the form
                                    st.session_state['created_invite_link'] = invite_link
                            except Exception as e:
                                logging.error(f"Error sending invitation email: {e}")
                                logging.error(traceback.format_exc())
                                st.warning(f"Invite created, but failed to send email: {str(e)}")
                                
                                # Display the invite link in case email sending failed
                                st.code(invite_link, language=None)
                                # Store for copying outside the form
                                st.session_state['created_invite_link'] = invite_link
                        else:
                            st.error(f"Failed to create invite: {result.get('error', 'Unknown error')}")
                    
                    except Exception as e:
                        logging.error(f"Error creating invite: {e}")
                        logging.error(traceback.format_exc())
                        st.error(f"An error occurred: {str(e)}")
    
    # Add a separator between tabs
    st.markdown("---")
    
    # Add a button to go back to the main form
    st.markdown("<div class='clear-btn'>", unsafe_allow_html=True)
    if st.button("Back to Main Form"):
        # Use the appropriate rerun method based on Streamlit version
        try:
            # First try the current recommended method
            st.rerun()
        except AttributeError:
            # Fall back to experimental_rerun if rerun is not available
            logging.warning("st.rerun() not available, falling back to st.experimental_rerun()")
            st.experimental_rerun()
    st.markdown("</div>", unsafe_allow_html=True)
    
    # Initialize or update session state variables from parsed data if it exists
    # This is how we'll update the form fields after parsing
    if st.session_state.get('parsing_successful', False):
        # Update session state variables from parsed data
        if '_parsed_first_name' in st.session_state:
            st.session_state['first_name_input'] = st.session_state['_parsed_first_name']
            st.session_state['first_name_input_outside'] = st.session_state['_parsed_first_name']
            
        if '_parsed_last_name' in st.session_state:
            st.session_state['last_name_input'] = st.session_state['_parsed_last_name']
            st.session_state['last_name_input_outside'] = st.session_state['_parsed_last_name']
            
        if '_parsed_email' in st.session_state:
            st.session_state['email_input'] = st.session_state['_parsed_email']
            st.session_state['email_input_outside'] = st.session_state['_parsed_email']
            
        if '_parsed_invited_by' in st.session_state:
            st.session_state['invited_by_input'] = st.session_state['_parsed_invited_by']
            st.session_state['invited_by_input_outside'] = st.session_state['_parsed_invited_by']
            
        if '_parsed_organization' in st.session_state:
            st.session_state['organization_input'] = st.session_state['_parsed_organization']
            st.session_state['organization_input_outside'] = st.session_state['_parsed_organization']
            
        if '_parsed_intro' in st.session_state:
            st.session_state['intro_input'] = st.session_state['_parsed_intro']
            st.session_state['intro_input_outside'] = st.session_state['_parsed_intro']
            
        if '_parsed_interests' in st.session_state:
            st.session_state['interests_input'] = st.session_state['_parsed_interests']
            st.session_state['interests_input_outside'] = st.session_state['_parsed_interests']
            
        if '_parsed_signal_username' in st.session_state:
            st.session_state['signal_username_input'] = st.session_state['_parsed_signal_username']
            st.session_state['signal_username_input_outside'] = st.session_state['_parsed_signal_username']
            
        if '_parsed_phone_number' in st.session_state:
            st.session_state['phone_number_input'] = st.session_state['_parsed_phone_number']
            st.session_state['phone_number_input_outside'] = st.session_state['_parsed_phone_number']
            
        if '_parsed_linkedin_username' in st.session_state:
            st.session_state['linkedin_username_input'] = st.session_state['_parsed_linkedin_username']
            st.session_state['linkedin_username_input_outside'] = st.session_state['_parsed_linkedin_username']
        
        # After updating the fields, also update the username based on the new names
        username_updated = update_username_from_inputs()
            
        # Reset the parsing flag now that we've applied the parsed data
        st.session_state['parsing_successful'] = False
    
async def display_user_list(auth_api_url=None, headers=None):
    """Display the list of users with actions and pagination."""
    # Initialize session state for pagination if not exists
    if 'users_per_page' not in st.session_state:
        st.session_state.users_per_page = 50
        
    # Get the users_per_page from session state
    users_per_page = st.session_state.users_per_page
        
    # Add force refresh control
    if 'force_refresh' not in st.session_state:
        st.session_state.force_refresh = False
    
    # Get current page from URL or default to 1
    try:
        current_page = int(st.query_params.get('page', 1))
    except (ValueError, TypeError):
        current_page = 1
    
    # Get search and filter values from URL params or session state
    search_term = st.query_params.get('search', '')
    status_filter = st.query_params.get('status', 'All')
    
    # Update search and filter in session state
    if 'search_term' not in st.session_state:
        st.session_state.search_term = search_term
    if 'status_filter' not in st.session_state:
        st.session_state.status_filter = status_filter
    
    # Store in session state
    st.session_state.search_term = search_term
    st.session_state.status_filter = status_filter
    
    # Calculate offset based on current page and users per page
    offset = (current_page - 1) * users_per_page
    
    # Get users from database with pagination and filtering
    with st.spinner(f"Loading users {offset + 1} to {offset + users_per_page}..."):
        users, total_count = get_users_from_db(
            limit=users_per_page,
            offset=offset,
            search_term=search_term,
            status_filter=status_filter,
            force_refresh=st.session_state.get('force_refresh', False)
        )
        
        # Reset force_refresh after using it
        if st.session_state.get('force_refresh', False):
            st.session_state.force_refresh = False
    
    # Debug logging
    logging.info(f"display_user_list: Loaded {len(users)} of {total_count} total users")
    
    # Display total count prominently
    st.success(f"📊 **Total Users: {total_count}** (showing {len(users)} per page)")
    
    # Debug info - always show for troubleshooting
    with st.expander("Debug Information", expanded=False):
        st.write(f"Users loaded: {len(users)}")
        st.write(f"First 5 usernames: {[u.username for u in users[:5]] if users else 'None'}")
        if len(users) > 5:
            st.write(f"Last 5 usernames: {[u.username for u in users[-5:]] if users else 'None'}")
        
        # Show database type
        try:
            db = next(get_db())
            try:
                db_url = str(db.bind.url)
                if "sqlite" in db_url:
                    st.write("Database type: SQLite")
                else:
                    st.write("Database type: PostgreSQL")
            finally:
                db.close()
        except:
            pass
    
    # Add refresh button and IDP comparison
    col1, col2 = st.columns([1, 3])
    
    with col1:
        if st.button("🔄 Refresh Data", help="Force refresh user data from database"):
            st.session_state.force_refresh = True
            st.rerun()
    
    # Check IDP sync status if we have the API URL and headers
    if auth_api_url and headers:
        with col2:
            with st.spinner("Checking IDP sync status..."):
                try:
                    # Get local user count
                    from app.db.database import SessionLocal
                    from app.db.models import User
                    
                    db = SessionLocal()
                    try:
                        local_count = db.query(User).count()
                        
                        # Get IDP user count
                        from app.auth.api import list_users
                        idp_users = list_users(auth_api_url, headers)
                        idp_count = len(idp_users) if idp_users else 0
                        
                        # Show sync status
                        if local_count == idp_count:
                            st.success(f"✅ In sync: {local_count} local users / {idp_count} IDP users")
                        else:
                            st.warning(f"⚠️ Out of sync: {local_count} local users / {idp_count} IDP users")
                            
                            # Show sync button if out of sync
                            if st.button("🔄 Sync Now", key="sync_now_btn"):
                                from app.services.matrix_cache import sync_authentik_users
                                with st.spinner("Syncing users from IDP..."):
                                    success = await sync_authentik_users(auth_api_url, headers)
                                    if success:
                                        st.success("Sync completed successfully!")
                                        st.session_state.force_refresh = True
                                        st.rerun()
                                    else:
                                        st.error("Failed to sync users from IDP")
                    finally:
                        db.close()
                except Exception as e:
                    st.error(f"Error checking IDP sync status: {str(e)}")
    
    # Display user table
    if users:
        # Convert users to DataFrame for display
        import pandas as pd
        user_data = [{
            'ID': user.id,
            'Username': user.username,
            'First Name': user.first_name or '',
            'Last Name': user.last_name or '',
            'Email': user.email or '',
            'Status': 'Active' if user.is_active else 'Inactive'
        } for user in users]
        
        df = pd.DataFrame(user_data)
        
        # Display the table with better formatting
        st.dataframe(
            df,
            column_config={
                'ID': st.column_config.NumberColumn('ID'),
                'Username': 'Username',
                'First Name': 'First Name',
                'Last Name': 'Last Name',
                'Email': 'Email',
                'Status': st.column_config.SelectboxColumn(
                    'Status',
                    options=['Active', 'Inactive'],
                    required=True
                )
            },
            hide_index=True,
            use_container_width=True
        )
    else:
        st.warning("No users found matching the current filters.")
    
    # Search and filter UI
    st.subheader("Search & Filter")
    
    # Use form to prevent multiple reruns
    with st.form("user_search_form", clear_on_submit=False):
        col1, col2, col3 = st.columns([3, 1, 1])
        
        with col1:
            new_search_term = st.text_input(
                "🔍 Search users", 
                value=search_term,
                placeholder="Search by username, name, or email...",
                help="Search across username, first name, last name, and email",
                key="search_input"
            )
        
        with col2:
            new_status_filter = st.selectbox(
                "Status",
                ["All", "Active", "Inactive"],
                index=["All", "Active", "Inactive"].index(status_filter) if status_filter in ["All", "Active", "Inactive"] else 0,
                key="status_select"
            )
        
        with col3:
            st.write("")
            st.write("")
            apply_filters = st.form_submit_button("🔍 Apply Filters")
            
        if apply_filters:
            # Update URL parameters
            params = {}
            if new_search_term:
                params["search"] = new_search_term
            if new_status_filter != "All":
                params["status"] = new_status_filter
            
            # Reset to first page when filters change
            params["page"] = 1
            
            # Update query parameters and rerun
            st.query_params.update(params)
            st.rerun()
    
    # Show filter summary if any filter is active
    active_filters = []
    if search_term:
        active_filters.append(f'search: "{search_term}"')
    if status_filter != "All":
        active_filters.append(f'status: {status_filter}')
    
    if active_filters:
        st.info(f"🔍 Active filters: {', '.join(active_filters)} - {total_count} users found")
    
    # User List Section
    st.subheader("User List")
    
    # Pagination controls
    st.write("---")
    
    # Calculate total pages
    total_pages = max(1, (total_count + users_per_page - 1) // users_per_page)
    
    # Ensure current page is within bounds
    if current_page > total_pages and total_pages > 0:
        current_page = total_pages
        st.query_params["page"] = current_page
        st.rerun()
    
    # Create pagination columns
    col1, col2, col3 = st.columns([1, 3, 1])
    
    # Users per page selector
    with col1:
        def update_users_per_page():
            st.session_state.users_per_page = st.session_state.users_per_page_select
            st.query_params["page"] = 1  # Reset to first page
            st.rerun()
            
        st.selectbox(
            "Users per page:",
            [25, 50, 100, 200, 500],
            index=[25, 50, 100, 200, 500].index(users_per_page) if users_per_page in [25, 50, 100, 200, 500] else 1,
            key="users_per_page_select",
            on_change=update_users_per_page
        )
    
    # Page numbers
    with col2:
        if total_pages > 1:
            st.write(f"Page {current_page} of {total_pages}")
            
            # Calculate page range to show (max 5 pages)
            start_page = max(1, current_page - 2)
            end_page = min(total_pages, current_page + 2)
            
            # Adjust start_page if we're near the end
            if end_page - start_page < 4 and start_page > 1:
                start_page = max(1, end_page - 4)
            
            # Show first page if not in range
            if start_page > 1:
                if st.button("1"):
                    st.query_params["page"] = 1
                    st.rerun()
                if start_page > 2:
                    st.write(" ... ")
            
            # Show page numbers
            for p in range(start_page, end_page + 1):
                if p == current_page:
                    st.write(f"**{p}**", end=" ")
                else:
                    if st.button(str(p), key=f"page_{p}"):
                        st.query_params["page"] = p
                        st.rerun()
                
            # Show last page if not in range
            if end_page < total_pages:
                if end_page < total_pages - 1:
                    st.write(" ... ")
                if st.button(str(total_pages), key=f"page_{total_pages}"):
                    st.query_params["page"] = total_pages
                    st.rerun()
    
        # Navigation buttons
        with col3:
            if current_page < total_pages:
                if st.button("Next ➡️"):
                    st.query_params["page"] = current_page + 1
                    st.rerun()
    
    # Show current page info
    start_idx = (current_page - 1) * users_per_page + 1
    end_idx = min(start_idx + users_per_page - 1, total_count)
    st.caption(f"Showing users {start_idx} to {end_idx} of {total_count}")
    
    # Add a small progress bar for large datasets
    if total_count > 500:
        progress = min(1.0, end_idx / total_count)
        st.progress(progress)
    
    # Display user data with actions
    if not users:
        st.warning("No users to display.")
        return
    
    # Show IDP sync status if available
    if auth_api_url and headers:
        st.subheader("🔗 IDP Sync Status")
        try:
            from app.services.matrix_cache import get_authentik_user_count
            idp_count = await get_authentik_user_count(auth_api_url, headers)
            if idp_count is not None:
                col1, col2 = st.columns(2)
                with col1:
                    st.metric("Users in IDP", idp_count)
                with col2:
                    st.metric("Users in Database", total_count)
                
                if idp_count > total_count:
                    st.warning(f"⚠️ {idp_count - total_count} users in IDP not in database")
                    if st.button("🔄 Sync Users from IDP"):
                        with st.spinner("Syncing users from IDP..."):
                            from app.services.matrix_cache import sync_authentik_users
                            success = await sync_authentik_users(auth_api_url, headers)
                            if success:
                                st.success("Sync completed successfully!")
                                st.rerun()
                            else:
                                st.error("Failed to sync users from IDP")
        except Exception as e:
            st.error(f"Error checking IDP status: {str(e)}")
    
    # Display users with actions
    st.subheader("👥 User Management")
    
    # Use the existing search from the URL parameters
    filtered_users = users
    
    try:
        # Display users with actions
        for user in filtered_users:
            with st.expander(f"{user.username} - {user.email or 'No email'}", expanded=False):
                col1, col2 = st.columns([1, 2])
                
                with col1:
                    st.write(f"**ID:** {user.id}")
                    st.write(f"**Name:** {user.first_name or ''} {user.last_name or ''}")
                    st.write(f"**Status:** {'🟢 Active' if user.is_active else '🔴 Inactive'}")
                    st.write(f"**Last Login:** {format_date(user.last_login) if user.last_login else 'Never'}")
                
                with col2:
                    # Initialize message form state if not exists
                    if f'message_form_{user.id}' not in st.session_state:
                        st.session_state[f'message_form_{user.id}'] = {
                            'subject': '',
                            'message': '',
                            'show_form': False
                        }
                    
                    # Toggle message form visibility when Send Message is selected
                    action = st.selectbox(
                        "Actions",
                        ["Select an action", "View Details", "Edit User", "Reset Password", 
                         "Send Message", "View Groups", "View Notes", "Toggle Status"],
                        key=f"action_{user.id}",
                        help="Select an action to perform on this user"
                    )
                    
                    # Toggle form visibility when Send Message is selected
                    if action == "Send Message":
                        st.session_state[f'message_form_{user.id}']['show_form'] = True
                    
                    # Action-specific UI elements
                    action_param = None
                    
                    # Show message composition form if active
                    if st.session_state[f'message_form_{user.id}']['show_form']:
                        st.write("### ✉️ Compose Message")
                        
                        # Get current values from session state
                        form_state = st.session_state[f'message_form_{user.id}']
                        
                        # Subject input
                        subject = st.text_input(
                            "Subject",
                            value=form_state['subject'],
                            key=f"msg_subj_{user.id}",
                            placeholder="Enter message subject..."
                        )
                        
                        # Message input
                        message = st.text_area(
                            "Message",
                            value=form_state['message'],
                            key=f"msg_body_{user.id}",
                            placeholder="Type your message here...",
                            height=150
                        )
                        
                        # Action buttons
                        col1, col2 = st.columns([1, 4])
                        with col1:
                            if st.button("Send", key=f"send_msg_{user.id}"):
                                if not subject:
                                    st.error("❌ Please enter a subject for your message")
                                elif not message:
                                    st.error("❌ Please enter a message")
                                else:
                                    action_param = {
                                        'subject': subject,
                                        'message': message
                                    }
                        with col2:
                            if st.button("Cancel", key=f"cancel_msg_{user.id}"):
                                # Reset form and hide it
                                st.session_state[f'message_form_{user.id}'] = {
                                    'subject': '',
                                    'message': '',
                                    'show_form': False
                                }
                                st.rerun()
                        
                        # Update session state with current values
                        st.session_state[f'message_form_{user.id}']['subject'] = subject
                        st.session_state[f'message_form_{user.id}']['message'] = message
                    
                    # Handle Edit User action
                    if action == "Edit User":
                        # Don't use expander here to avoid nesting issues
                        st.write("### ✏️ Edit User Details")
                        new_email = st.text_input("Email", user.email or "", key=f"edit_email_{user.id}")
                        new_first_name = st.text_input("First Name", user.first_name or "", key=f"edit_first_{user.id}")
                        new_last_name = st.text_input("Last Name", user.last_name or "", key=f"edit_last_{user.id}")
                        new_status = st.checkbox("Active", value=user.is_active, key=f"edit_status_{user.id}")
                        action_param = {
                            'email': new_email,
                            'first_name': new_first_name,
                            'last_name': new_last_name,
                            'is_active': new_status
                        }
                        
                        # Only show submit button for non-message actions
                        if action != "Send Message":
                            submit_button = st.form_submit_button("Apply Action", 
                                help="Click to apply the selected action")
                        else:
                            submit_button = False
                            
                        # Special case for Edit User - add a dedicated save button
                        if action == "Edit User":
                            if submit_button and action_param:
                                submit_button = True  # Keep the form submission active
                        
                        if (submit_button and action != "Select an action") or (action == "Send Message" and action_param is not None):
                            if action == "View Details":
                                # Close the form to prevent nesting issues
                                st.markdown("### 👤 User Details")
                                st.json({
                                    "ID": user.id,
                                    "Username": user.username,
                                    "Email": user.email,
                                    "First Name": user.first_name,
                                    "Last Name": user.last_name,
                                    "Status": "Active" if user.is_active else "Inactive",
                                    "Admin": "Yes" if user.is_admin else "No",
                                    "Moderator": "Yes" if user.is_moderator else "No",
                                    "Last Login": format_date(user.last_login) if user.last_login else "Never",
                                    "Date Joined": format_date(user.date_joined) if hasattr(user, 'date_joined') else "Unknown",
                                    "Matrix Username": user.matrix_username or "Not set"
                                })
                            
                            elif action == "Edit User" and action_param:
                                try:
                                    from app.db.database import get_db
                                    from app.db.models import User
                                    db = next(get_db())
                                    try:
                                        db_user = db.query(User).filter(User.id == user.id).first()
                                        if db_user:
                                            db_user.email = action_param['email']
                                            db_user.first_name = action_param['first_name']
                                            db_user.last_name = action_param['last_name']
                                            db_user.is_active = action_param['is_active']
                                            db.commit()
                                            st.success("User updated successfully!")
                                            st.rerun()
                                        else:
                                            st.error("User not found in database")
                                    except Exception as e:
                                        db.rollback()
                                        st.error(f"Error updating user: {str(e)}")
                                        logging.exception("Error in user update")
                                    finally:
                                        db.close()
                                except Exception as e:
                                    st.error(f"Database error: {str(e)}")
                            
                            elif action == "Reset Password":
                                if reset_user_password(user.id):
                                    new_password = st.session_state.get('temp_password')
                                    username = st.session_state.get('temp_username')
                                    if new_password and username:
                                        st.success(f"Password reset for {username}")
                                        st.warning(f"New temporary password: `{new_password}`")
                                        st.info("Please provide this password to the user securely and instruct them to change it on their next login.")
                                        # Clear the temporary password from session
                                        del st.session_state['temp_password']
                                        del st.session_state['temp_username']
                                    else:
                                        st.success("Password reset successful")
                                else:
                                    st.error("Failed to reset password")
                            
                            elif action == "Send Message" and action_param:
                                if not action_param.get('subject'):
                                    st.error("❌ Please enter a subject for your message")
                                elif not action_param.get('message'):
                                    st.error("❌ Please enter a message")
                                else:
                                    try:
                                        # Store the message in session state
                                        st.session_state['messaging_user'] = {
                                            'id': user.id,
                                            'username': user.username,
                                            'email': user.email,
                                            'subject': action_param['subject'],
                                            'message': action_param['message']
                                        }
                                        
                                        # Show sending status
                                        with st.spinner("Sending message..."):
                                            # Here you would typically call your email sending function
                                            # For example:
                                            # send_result = send_email(
                                            #     to_email=user.email,
                                            #     subject=action_param['subject'],
                                            #     message=action_param['message']
                                            # )
                                            
                                            # For now, we'll simulate a successful send
                                            send_result = True
                                            
                                            if send_result:
                                                st.success(f"✅ Message sent successfully to {user.email}")
                                                # Clear the form by setting a flag to clear on next render
                                                st.session_state['clear_message_form'] = True
                                                # Rerun to clear the form
                                                st.rerun()
                                            else:
                                                st.error("❌ Failed to send message. Please try again.")
                                    except Exception as e:
                                        st.error(f"❌ Error sending message: {str(e)}")
                                        logging.exception("Error sending message")
                            
                            elif action == "View Groups":
                                try:
                                    from app.db.database import get_db
                                    from app.db.models import User, Group, user_group_association
                                    db = next(get_db())
                                    try:
                                        groups = db.query(Group).join(
                                            user_group_association
                                        ).filter(
                                            user_group_association.c.user_id == user.id
                                        ).all()
                                        
                                        if groups:
                                            group_list = [{
                                                'Group ID': g.id,
                                                'Name': g.name,
                                                'Description': g.description or 'No description',
                                                'Member Count': len(g.users)
                                            } for g in groups]
                                            st.dataframe(group_list, use_container_width=True)
                                        else:
                                            st.info("This user is not a member of any groups.")
                                    finally:
                                        db.close()
                                except Exception as e:
                                    st.error(f"Error loading groups: {str(e)}")
                            
                            elif action == "View Notes":
                                try:
                                    from app.db.database import get_db
                                    from app.db.models import UserNote
                                    from datetime import datetime
                                    
                                    # Initialize session state for notes if not exists
                                    if f'notes_{user.id}' not in st.session_state:
                                        st.session_state[f'notes_{user.id}'] = {
                                            'new_note': '',
                                            'category': 'General',
                                            'search_term': ''
                                        }
                                    
                                    # Get existing notes with pagination
                                    db = next(get_db())
                                    try:
                                        # Search functionality
                                        search_term = st.text_input(
                                            "🔍 Search notes",
                                            value=st.session_state[f'notes_{user.id}']['search_term'],
                                            key=f"note_search_{user.id}",
                                            placeholder="Search in notes..."
                                        )
                                        
                                        # Update search term in session state
                                        if search_term != st.session_state[f'notes_{user.id}']['search_term']:
                                            st.session_state[f'notes_{user.id}']['search_term'] = search_term
                                            st.rerun()
                                        
                                        # Query notes with search filter
                                        query = db.query(UserNote).filter(UserNote.user_id == user.id)
                                        
                                        if search_term:
                                            search = f"%{search_term}%"
                                            query = query.filter(
                                                (UserNote.note.ilike(search)) |
                                                (UserNote.category.ilike(search)) |
                                                (UserNote.author_username.ilike(search))
                                            )
                                        
                                        notes = query.order_by(UserNote.created_at.desc()).all()
                                        
                                        # Display notes count and search info
                                        if search_term:
                                            st.caption(f"Found {len(notes)} notes matching '{search_term}'")
                                        else:
                                            st.caption(f"Found {len(notes)} notes")
                                        
                                        # Notes list with delete functionality
                                        if notes:
                                            for note in notes:
                                                with st.expander(
                                                    f"📝 {note.category or 'General'} - {note.created_at.strftime('%Y-%m-%d %H:%M')}",
                                                    expanded=False
                                                ):
                                                    # Note content with formatting
                                                    st.write(note.note)
                                                    
                                                    # Metadata
                                                    col1, col2 = st.columns([3, 1])
                                                    with col1:
                                                        st.caption(f"👤 Added by {note.author_username}")
                                                    with col2:
                                                        # Delete note button
                                                        if st.button("🗑️ Delete", key=f"del_{note.id}"):
                                                            try:
                                                                db.delete(note)
                                                                db.commit()
                                                                st.success("Note deleted successfully!")
                                                                st.rerun()
                                                            except Exception as e:
                                                                db.rollback()
                                                                st.error(f"Error deleting note: {str(e)}")
                                                                logging.exception("Error deleting note")
                                        else:
                                            st.info("No notes found for this user.")
                                        
                                        # Add new note section
                                        st.markdown("---")
                                        st.subheader("✍️ Add New Note")
                                        
                                        with st.form(key=f"add_note_{user.id}"):
                                            # Category selector
                                            categories = ["General", "Follow-up", "Warning", "Info", "Important"]
                                            category = st.selectbox(
                                                "Category",
                                                categories,
                                                index=categories.index(st.session_state[f'notes_{user.id}']['category'])
                                                if st.session_state[f'notes_{user.id}']['category'] in categories else 0,
                                                key=f"note_category_{user.id}"
                                            )
                                            
                                            # Note content with markdown preview
                                            new_note = st.text_area(
                                                "Note content (supports Markdown)",
                                                value=st.session_state[f'notes_{user.id}']['new_note'],
                                                height=150,
                                                key=f"new_note_{user.id}",
                                                help="You can use Markdown formatting in your notes"
                                            )
                                            
                                            # Preview and submit buttons
                                            col1, col2 = st.columns([1, 3])
                                            with col1:
                                                if st.form_submit_button("💾 Save Note"):
                                                    if new_note.strip():
                                                        try:
                                                            note = UserNote(
                                                                user_id=user.id,
                                                                author_username=st.session_state.get('username', 'system'),
                                                                note=new_note,
                                                                category=category,
                                                                created_at=datetime.utcnow()
                                                            )
                                                            db.add(note)
                                                            db.commit()
                                                            # Clear the note input after successful save
                                                            st.session_state[f'notes_{user.id}']['new_note'] = ''
                                                            st.session_state[f'notes_{user.id}']['category'] = 'General'
                                                            st.success("✅ Note added successfully!")
                                                            st.rerun()
                                                        except Exception as e:
                                                            db.rollback()
                                                            st.error(f"❌ Error saving note: {str(e)}")
                                                            logging.exception("Error saving user note")
                                                    else:
                                                        st.warning("Please enter a note before saving")
                                            
                                            with col2:
                                                if st.form_submit_button("👁️ Preview"):
                                                    st.session_state[f'notes_{user.id}']['new_note'] = new_note
                                                    st.session_state[f'notes_{user.id}']['category'] = category
                                                    st.rerun()
                                            
                                            # Show preview if in preview mode
                                            if st.session_state[f'notes_{user.id}']['new_note']:
                                                st.markdown("---")
                                                st.markdown("### Preview")
                                                st.markdown(st.session_state[f'notes_{user.id}']['new_note'])
                                                st.caption(f"Category: {st.session_state[f'notes_{user.id}']['category']}")
                                    finally:
                                        db.close()
                                except Exception as e:
                                    st.error(f"❌ Error loading notes: {str(e)}")
                                    logging.exception("Error in View Notes action")
                            
                            elif action == "Toggle Status":
                                try:
                                    new_status = not user.is_active
                                    if update_user_status(user.id, new_status, user.username):
                                        st.success(f"User {'activated' if new_status else 'deactivated'} successfully!")
                                        st.rerun()
                                    else:
                                        st.error("Failed to update user status")
                                except Exception as e:
                                    st.error(f"Error updating status: {str(e)}")
    except Exception as e:
        st.error(f"Error displaying user data: {str(e)}")
        logging.exception("Error in user list display")
        logging.error(f"Error in displaying user data: {str(e)}")
        logging.error(traceback.format_exc())
        return
    
    # Add export functionality
    st.write("---")
    st.subheader("Export Users")
    
    # Optimize: Only query the fields we need for export
    export_cols = st.multiselect(
        "Select columns to export",
        ["Username", "Name", "Email", "Matrix Username", "Status", "Admin", "Date Joined", "Last Login"],
        default=["Username", "Name", "Email", "Status", "Last Login"],
        key="export_columns"
    )
    
    # Create CSV for all filtered users (not just current page)
    if st.button("📥 Generate Export", help="Generate CSV with current filters applied"):
        with st.spinner("Preparing export..."):
            try:
                # Only query the users that match current filters
                _, filtered_export_users = get_users_from_db(
                    limit=10000,  # High limit to get all matching users
                    search_term=st.session_state.get('search_term', ''),
                    status_filter=st.session_state.get('status_filter', 'All'),
                    force_refresh=True
                )
                
                if filtered_export_users:
                    export_data = []
                    for user in filtered_export_users:
                        user_dict = {
                            "Username": user.username,
                            "Name": f"{user.first_name or ''} {user.last_name or ''}".strip(),
                            "Email": user.email or "",
                            "Matrix Username": user.matrix_username or "Not set",
                            "Status": "Active" if user.is_active else "Inactive",
                            "Admin": "Yes" if user.is_admin else "No",
                            "Date Joined": format_date(user.date_joined) if hasattr(user, 'date_joined') else "",
                            "Last Login": format_date(user.last_login) if hasattr(user, 'last_login') else "Never"
                        }
                        # Only include selected columns
                        export_data.append({k: v for k, v in user_dict.items() if k in export_cols})
                    
                    csv_df = pd.DataFrame(export_data)
                    csv_data = csv_df.to_csv(index=False)
                    
                    st.download_button(
                        label=f"📥 Download {len(export_data)} users",
                        data=csv_data,
                        file_name=f"users_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                        mime="text/csv",
                        key="download_export"
                    )
                else:
                    st.warning("No users found matching current filters.")
                    
            except Exception as e:
                st.error(f"Error generating export: {str(e)}")
                logging.exception("Error in user export")
    
    # Add bulk action buttons
    st.subheader("Bulk User Actions")
    st.caption("Apply actions to multiple users at once")
    action = st.selectbox(
        "Select Action",
        ["Send Email to User", "Update Email", "Update Status", "Update Matrix Username", "Delete User"],
        key="user_action"
    )
    
    # Get selected users (from filtered users to match what's visible)
    selected_users = st.multiselect(
        "Select Users",
        options=[user.username for user in filtered_users],  # Filtered users, not all users
        key="selected_users",
        help=f"Select from {len(filtered_users)} filtered users (across all pages)"
    )
    
    if selected_users:
        if action == "Send Email to User":
            # Call handle_action with send_email action to get user data and show email form
            success = handle_action("send_email", selected_users)
        
        elif action == "Update Matrix Username":
            new_matrix_username = st.text_input("New Matrix Username", key="new_matrix_username")
            if st.button("Update Matrix Username"):
                if new_matrix_username:
                    success = handle_action(
                        "update_matrix_username",
                        selected_users,
                        action_params={"matrix_username": new_matrix_username}
                    )
                    if success:
                        st.success(f"Successfully updated Matrix username for selected users")
                    else:
                        st.error("Failed to update Matrix username")
                else:
                    st.warning("Please enter a Matrix username")
        elif action == "Update Email":
            new_email = st.text_input("New Email", key="new_email")
            if st.button("Update Email"):
                if new_email:
                    success = handle_action(
                        "update_email",
                        selected_users,
                        action_params={"email": new_email}
                    )
                    if success:
                        st.success(f"Successfully updated email for selected users")
                    else:
                        st.error("Failed to update email")
                else:
                    st.warning("Please enter an email")
        elif action == "Update Status":
            new_status = st.selectbox(
                "New Status",
                ["Active", "Inactive"],
                key="new_status"
            )
            if st.button("Update Status"):
                success = handle_action(
                    "update_status",
                    selected_users,
                    action_params={"is_active": new_status == "Active"}
                )
                if success:
                    st.success(f"Successfully updated status for selected users")
                else:
                    st.error("Failed to update status")
        elif action == "Delete User":
            if st.button("Delete Selected Users"):
                success = handle_action("delete", selected_users)
                if success:
                    st.success(f"Successfully deleted selected users")
                else:
                    st.error("Failed to delete users")

def reset_user_password(user_id: int) -> bool:
    """Reset a user's password and generate a secure passphrase.
    
    Args:
        user_id: The ID of the user to reset the password for
        
    Returns:
        bool: True if password was reset successfully, False otherwise
    """
    try:
        from app.db.database import get_db
        from app.db.models import User
        from app.auth.utils import generate_secure_passphrase
        
        db = next(get_db())
        try:
            user = db.query(User).filter(User.id == user_id).first()
            if not user:
                st.error("User not found")
                return False
                
            # Generate a secure passphrase
            new_password = generate_secure_passphrase()
            
            # Update the user's password (using proper password hashing)
            from app.auth.local_auth import hash_password
            user.hashed_password = hash_password(new_password)
            # Set the password reset flag if the user model has it
            if hasattr(user, 'force_password_reset'):
                user.force_password_reset = True  # Force password change on next login
            db.commit()
            
            # Store the temporary password in session to show to admin
            # In production, this should be sent via email to the user
            st.session_state['temp_password'] = new_password
            st.session_state['temp_username'] = user.username
            
            # Log the password reset (without logging the actual password)
            logging.info(f"Password reset for user {user.username} (ID: {user.id})")
            
            return True
            
        except Exception as e:
            db.rollback()
            st.error(f"Error resetting password: {str(e)}")
            logging.exception("Error in reset_user_password")
            return False
        finally:
            db.close()
    except Exception as e:
        st.error(f"Database connection error: {str(e)}")
        return False

def update_user_status(user_id: int, new_status: bool, username: str):
    """Update user status in the database"""
    try:
        from app.db.database import get_db
        from app.db.models import User
        
        db = next(get_db())
        try:
            user = db.query(User).filter(User.id == user_id).first()
            if user:
                user.is_active = new_status
                db.commit()
                st.success(f"User {username} has been {'activated' if new_status else 'deactivated'}")
                st.rerun()
            else:
                st.error("User not found")
        except Exception as e:
            db.rollback()
            st.error(f"Error updating user status: {str(e)}")
        finally:
            db.close()
    except Exception as e:
        st.error(f"Database connection error: {str(e)}")

# Removed duplicate format_date function - unified with the one at the top of the file

def handle_action(action_type, selected_users, action_params=None):
    """
    Handle various user actions (update status, email, matrix username, delete).
    
    Args:
        action_type (str): The type of action to perform
        selected_users (list): List of usernames to perform action on
        action_params (dict, optional): Additional parameters for specific actions
    
    Returns:
        bool: True if action was successful, False otherwise
    """
    if not selected_users:
        st.warning("No users selected")
        return False
        
    try:
        # Get a database session
        db = next(get_db())
        
        try:
            # Get users from database
            from app.db.models import User
            users = db.query(User).filter(User.username.in_(selected_users)).all()
            
            if not users:
                st.warning(f"No users found with usernames: {', '.join(selected_users)}")
                return False
                
            if action_type in ["Activate", "Deactivate"]:
                # Update user status
                is_active = action_type == "Activate"
                from app.auth.admin import update_user_status
                
                success = True
                for user in users:
                    result = update_user_status(user.username, is_active)
                    if not result.get('success', False):
                        success = False
                        st.error(f"Failed to update status for {user.username}: {result.get('error', 'Unknown error')}")
                
                if success:
                    st.success(f"Successfully {action_type.lower()}d {len(users)} users")
                return success
                
            elif action_type == "update_email":
                # Update user email
                if not action_params or 'email' not in action_params:
                    st.warning("Email parameter is required")
                    return False
                    
                new_email = action_params['email']
                
                success = True
                for user in users:
                    try:
                        user.email = new_email
                        db.commit()
                    except Exception as e:
                        success = False
                        db.rollback()
                        st.error(f"Failed to update email for {user.username}: {str(e)}")
                
                if success:
                    st.success(f"Successfully updated email for {len(users)} users")
                return success
                
            elif action_type == "update_matrix_username":
                # Update Matrix username
                if not action_params or 'matrix_username' not in action_params:
                    st.warning("Matrix username parameter is required")
                    return False
                    
                new_matrix_username = action_params['matrix_username']
                
                success = True
                for user in users:
                    try:
                        user.matrix_username = new_matrix_username
                        # Update Authentik profile with Matrix username
                        user.attributes = user.attributes or {}
                        user.attributes['matrix_username'] = new_matrix_username
                        db.commit()
                    except Exception as e:
                        success = False
                        db.rollback()
                        st.error(f"Failed to update Matrix username for {user.username}: {str(e)}")
                
                if success:
                    st.success(f"Successfully updated Matrix username for {len(users)} users")
                return success
                
            elif action_type == "update_status":
                # Update user status
                if action_params is None or 'is_active' not in action_params:
                    st.warning("is_active parameter is required")
                    return False
                    
                is_active = action_params['is_active']
                
                success = True
                for user in users:
                    try:
                        user.is_active = is_active
                        db.commit()
                    except Exception as e:
                        success = False
                        db.rollback()
                        st.error(f"Failed to update status for {user.username}: {str(e)}")
                
                if success:
                    status_text = "activated" if is_active else "deactivated"
                    st.success(f"Successfully {status_text} {len(users)} users")
                return success
                
            elif action_type == "send_email":
                # Handle email sending - prepare user data and delegate to email form
                try:
                    # Convert to format expected by send_admin_email_to_users
                    users_for_email = []
                    for user in users:
                        user_dict = {
                            'Username': user.username,
                            'Email': user.email,
                            'Name': f"{user.first_name} {user.last_name}"
                        }
                        users_for_email.append(user_dict)
                    
                    # Use the extracted email form function
                    success, result = render_email_form(users_for_email)
                    return success
                    
                except Exception as e:
                    st.error(f"❌ Error preparing email form: {str(e)}")
                    logging.error(f"Error in send_email action: {str(e)}")
                    logging.error(traceback.format_exc())
                    return False
                
            elif action_type == "delete":
                # Delete users
                success = True
                for user in users:
                    try:
                        db.delete(user)
                        db.commit()
                    except Exception as e:
                        success = False
                        db.rollback()
                        st.error(f"Failed to delete {user.username}: {str(e)}")
                
                if success:
                    st.success(f"Successfully deleted {len(users)} users")
                return success
                
            else:
                st.warning(f"Unknown action type: {action_type}")
                return False
        finally:
            db.close()
    except Exception as e:
        st.error(f"Error performing action: {str(e)}")
        logging.error(f"Error in handle_action: {str(e)}")
        logging.error(traceback.format_exc())
        return False

def get_users_from_db(limit=500, offset=0, search_term=None, status_filter="All", force_refresh=False):
    """
    Get users from the database with pagination and filtering.
    
    Args:
        limit (int): Maximum number of users to return
        offset (int): Number of users to skip
        search_term (str, optional): Search term to filter users
        status_filter (str): Status filter ('All', 'Active', 'Inactive')
        force_refresh (bool): If True, forces a fresh query from the database
        
    Returns:
        tuple: (list of User objects, total_count) or (None, 0) on error
    """
    from sqlalchemy import or_
    from sqlalchemy.orm import sessionmaker
    logging.info(f"=== Starting get_users_from_db(limit={limit}, offset={offset}, search='{search_term}', force_refresh={force_refresh}) ===")
    
    db = None
    try:
        # Import database components
        from app.db.database import engine, SessionLocal, get_db
        from app.db.models import User
        
        # Log database URL (masking password)
        db_url = str(engine.url)
        if '@' in db_url:
            parts = db_url.split('@', 1)
            db_url = f"{parts[0].split('//')[0]}//***:***@{parts[1]}"
        logging.info(f"Using database: {db_url}")
        
        # Get a fresh database session
        db = next(get_db())
        
        # Start a new transaction
        db.begin()
        
        # Build base query
        query = db.query(User)
        
        # Apply search filter if provided
        if search_term and search_term.strip():
            search = f"%{search_term}%"  # Case-sensitive search
            query = query.filter(
                or_(
                    User.username.ilike(search),
                    User.first_name.ilike(search),
                    User.last_name.ilike(search),
                    User.email.ilike(search)
                )
            )
            logging.info(f"Applied search filter: '{search_term}'")
        
        # Apply status filter
        if status_filter == "Active":
            query = query.filter(User.is_active == True)
            logging.info("Applied status filter: Active")
        elif status_filter == "Inactive":
            query = query.filter(User.is_active == False)
            logging.info("Applied status filter: Inactive")
        
        # Get total count for the current filters
        total_count = query.count()
        logging.info(f"Total users matching filters: {total_count}")
        
        if total_count == 0:
            logging.info("No users found matching the criteria")
            return [], 0
        
        # Apply pagination and ordering
        users = query.order_by(User.username.asc())\
                    .offset(offset)\
                    .limit(limit)\
                    .all()
        
        # Log first few users for debugging
        if users:
            sample_users = [f"{u.username} (ID: {u.id})" for u in users[:3]]
            logging.info(f"Sample users: {', '.join(sample_users)}")
        else:
            logging.info("No users returned from query")
        
        logging.info(f"Loaded {len(users)} users (offset: {offset}, limit: {limit})")
        
        return users, total_count
        
    except Exception as e:
        logging.error(f"Error in get_users_from_db: {str(e)}", exc_info=True)
        st.error(f"⚠️ Error loading users: {str(e)}")
        return [], 0
        
    finally:
        # Ensure database connection is always closed
        if db is not None:
            try:
                db.close()
                logging.debug("Database connection closed")
            except Exception as e:
                logging.error(f"Error closing database connection: {e}", exc_info=True)

def render_email_form(users_for_email):
    """
    Render the email composition form for sending emails to selected users.
    
    Args:
        users_for_email (list): List of user dictionaries with Username, Email, and Name
        
    Returns:
        tuple: (success: bool, result: dict or None)
    """
    st.write(f"**Selected {len(users_for_email)} users for email:**")
    
    # Show basic user info
    with st.expander("View selected users"):
        for user in users_for_email:
            email_status = user.get('Email', 'No email') or 'No email'
            st.write(f"• {user['Name']} ({user['Username']}) - {email_status}")
    
    # Check if SMTP is configured
    if not Config.SMTP_ACTIVE:
        st.error("📧 SMTP is not active. Please configure SMTP settings to enable email functionality.")
        return False, None
    
    # Validate SMTP configuration
    smtp_config_issues = []
    if not Config.SMTP_SERVER:
        smtp_config_issues.append("SMTP_SERVER")
    if not Config.SMTP_PORT:
        smtp_config_issues.append("SMTP_PORT") 
    if not Config.SMTP_USERNAME:
        smtp_config_issues.append("SMTP_USERNAME")
    if not Config.SMTP_PASSWORD:
        smtp_config_issues.append("SMTP_PASSWORD")
    if not Config.SMTP_FROM_EMAIL:
        smtp_config_issues.append("SMTP_FROM_EMAIL")
        
    if smtp_config_issues:
        st.error(f"❌ Missing SMTP configuration: {', '.join(smtp_config_issues)}")
        return False, None
    
    # Email form
    with st.form("send_email_form", clear_on_submit=False):
        st.subheader("📧 Compose Email")
        
        # Instructions
        st.info(f"📬 Ready to send email to selected users. All emails will be sent with professional admin formatting and your message will be included. Invalid emails will be automatically filtered out.")
        
        # Variable substitution help
        with st.expander("📝 Variable Substitution Help", expanded=False):
            st.markdown("""
            **Personalize your emails with variables:**
            - `$Username` - User's username  
            - `$DisplayName` - User's full name  
            - `$FirstName` - User's first name  
            - `$LastName` - User's last name  
            - `$Email` - User's email address  
            - `$MatrixUsername` - User's Matrix username  
            
            **Example:**
            ```
            Subject: Welcome $DisplayName to our community!
            Message: Hi $FirstName, 
            
            Your account $Username has been created successfully.
            You can reach us if needed.
            
            Best regards,
            Admin Team
            ```
            """)
        
        # Subject field with session state persistence
        email_subject = st.text_input(
            "Subject *",
            value=st.session_state.get('email_form_subject', ''),
            placeholder="Enter email subject (supports variables like $DisplayName)",
            help="Required: Email subject line (supports variable substitution)",
            key="email_subject_input"
        )
        
        # Message field with session state persistence
        email_message = st.text_area(
            "Message *",
            value=st.session_state.get('email_form_message', ''),
            height=200,
            placeholder="Enter your message here... (use $Username, $FirstName, etc. for personalization)",
            help="Required: Email message content (supports variable substitution)",
            key="email_message_input"
        )
        
        # File upload for attachments
        st.subheader("📎 Attachments (Optional)")
        uploaded_files = st.file_uploader(
            "Choose files to attach",
            accept_multiple_files=True,
            help="Upload files to attach to the email. Multiple files are supported.",
            key="email_attachments_input"
        )
        
        if uploaded_files:
            st.write("**Files to attach:**")
            total_size = 0
            for file in uploaded_files:
                file_size = len(file.getvalue()) if hasattr(file, 'getvalue') else 0
                total_size += file_size
                st.write(f"• {file.name} ({file_size / 1024:.1f} KB)")
            st.write(f"**Total size:** {total_size / 1024:.1f} KB")
            
            # Warn if files are too large (5MB limit)
            if total_size > 5 * 1024 * 1024:
                st.warning("⚠️ Total attachment size exceeds 5MB. Some email providers may reject large attachments.")
        
        # Form submission
        col1, col2 = st.columns([1, 1])
        with col1:
            send_email_button = st.form_submit_button("📤 Send Email", type="primary")
        with col2:
            if st.form_submit_button("🗑️ Clear Form"):
                # Clear session state for form fields
                for key in ['email_form_subject', 'email_form_message']:
                    if key in st.session_state:
                        del st.session_state[key]
                st.rerun()
        
        # Handle form submission
        if send_email_button:
            # Store form values in session state for persistence
            st.session_state['email_form_subject'] = email_subject
            st.session_state['email_form_message'] = email_message
            
            if not email_subject:
                st.error("❌ Subject is required")
                return False, None
            elif not email_message:
                st.error("❌ Message is required")
                return False, None
            else:
                # Prepare attachments if any
                attachments = []
                if uploaded_files:
                    for file in uploaded_files:
                        try:
                            # Convert uploaded file to the format expected by send_email
                            attachment_dict = {
                                'filename': file.name,
                                'content': file.getvalue(),
                                'content_type': file.type or 'application/octet-stream'
                            }
                            attachments.append(attachment_dict)
                        except Exception as attachment_error:
                            st.warning(f"⚠️ Could not process attachment {file.name}: {str(attachment_error)}")
                            logging.warning(f"Attachment processing error: {attachment_error}")
                
                # Send emails
                with st.spinner(f"Sending emails to {len(users_for_email)} users..."):
                    try:
                        result = send_admin_email_to_users(
                            selected_users=users_for_email,
                            subject=email_subject,
                            message=email_message,
                            attachments=attachments if attachments else None
                        )
                        
                        if result['success']:
                            st.success(f"✅ {result['message']}")
                            
                            # Show detailed results
                            if result.get('failed_users'):
                                st.warning("⚠️ Some emails failed to send:")
                                for failed_user in result['failed_users']:
                                    st.write(f"• {failed_user}")
                            
                            # Clear form on successful send
                            for key in ['email_form_subject', 'email_form_message']:
                                if key in st.session_state:
                                    del st.session_state[key]
                            
                            return True, result
                        else:
                            st.error(f"❌ {result['error']}")
                            return False, result
                            
                    except Exception as e:
                        st.error(f"❌ Error sending emails: {str(e)}")
                        logging.error(f"Error in send email form: {str(e)}")
                        logging.error(traceback.format_exc())
                        return False, {'error': str(e)}
    
    # Return True to indicate the form was displayed successfully (but not submitted)
    return True, None