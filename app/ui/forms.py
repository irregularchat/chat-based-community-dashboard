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
from streamlit.components.v1 import html
from app.db.session import get_db
from app.db.models import User
from app.utils.recommendation import get_entrance_room_users_sync, get_room_recommendations_sync
from app.utils.matrix_actions import (
    invite_to_matrix_room, 
    get_all_accessible_users,
    invite_to_matrix_room_sync,
    send_matrix_message,
    create_matrix_direct_chat_sync,
    invite_user_to_recommended_rooms_sync,
    send_direct_message
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
from app.auth.api import (
    list_users,
    create_invite,
    generate_secure_passphrase,
    force_password_reset,
    reset_user_password,
    create_discourse_post,
    create_user,
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
from app.messages import create_invite_message, create_user_message, display_welcome_message_ui
from app.utils.messages import WELCOME_MESSAGE
from app.utils.helpers import send_invite_email
from app.utils.recommendation import invite_user_to_recommended_rooms_sync

# Utility function for running async tasks safely in Streamlit
def run_async_safely(async_func, *args, **kwargs):
    """
    Safely runs an async function in a Streamlit app.
    Handles event loop conflicts using nest_asyncio.
    
    Args:
        async_func: The async function to run
        *args, **kwargs: Arguments to pass to the async function
        
    Returns:
        The result of the async function
    """
    import nest_asyncio
    
    # Apply nest_asyncio to patch current event loop
    nest_asyncio.apply()
    
    try:
        # Get or create event loop
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            # If there's no event loop, create a new one
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        # Handle the case when the loop is already running
        if loop.is_running():
            # Create a future in the existing loop
            future = asyncio.ensure_future(async_func(*args, **kwargs), loop=loop)
            # Wait for it to complete
            while not future.done():
                loop._run_once()
            # Get the result
            return future.result()
        else:
            # Standard approach if loop is not running
            return loop.run_until_complete(async_func(*args, **kwargs))
    except Exception as e:
        logging.error(f"Error running async function {async_func.__name__}: {str(e)}")
        logging.error(traceback.format_exc())
        return None

def reset_create_user_form_fields():
    """Helper function to reset all fields related to create user."""
    # List of keys to reset
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
        "username_was_auto_generated",
        "organization_input",
        "organization_input_outside",
        "interests_input",
        "interests_input_outside",
        "signal_username_input",
        "signal_username_input_outside",
        "phone_number_input",
        "phone_number_input_outside",
        "linkedin_username_input",
        "linkedin_username_input_outside",
        "parse_data_input_outside",
        # Add Matrix-related state variables
        "matrix_user_id",
        "matrix_user_select",
        "matrix_user_selected",
        "recommended_rooms",
        "selected_rooms",
        "group_selection"
    ]
    
    # Clear the values in session state
    for key in keys_to_reset:
        if key in st.session_state:
            del st.session_state[key]
    
    # Clear any parsed data
    for key in list(st.session_state.keys()):
        if key.startswith('_parsed'):
            del st.session_state[key]
            
    # Reset Matrix-related flags
    st.session_state["recommended_rooms"] = []
    st.session_state["selected_rooms"] = set()
    
    # Reset parsing flags
    st.session_state["parsing_successful"] = False
    if 'clear_fields' in st.session_state:
        del st.session_state['clear_fields']
    if 'old_values' in st.session_state:
        del st.session_state['old_values']
    
    # Set a flag in session state to indicate we should clear fields
    st.session_state['clear_fields'] = True
    
    # Store current values temporarily to detect changes
    old_values = {key: st.session_state.get(key, "") for key in keys_to_reset}
    st.session_state['old_values'] = old_values
    
    # Clear the values
    for key in keys_to_reset:
        if key in st.session_state:
            st.session_state[key] = ""
    
    # Handle group selection separately - reset to default MAIN_GROUP_ID
    main_group_id = Config.MAIN_GROUP_ID
    st.session_state['selected_groups'] = [main_group_id] if main_group_id else []
    st.session_state['group_selection'] = [main_group_id] if main_group_id else []

def parse_and_rerun():
    """Callback to parse data and rerun the script so widgets see updated session state."""
    # Check if input is empty
    if not st.session_state.get("parse_data_input_outside", "").strip():
        logging.warning("Parsing called with empty data")
        st.warning("Nothing to parse. Please enter some data first.")
        return  # Just return if there's no data to parse
    
    # Log the input data for debugging
    input_data = st.session_state.get("parse_data_input_outside", "")
    # Save to the preserved data field to ensure it persists
    st.session_state['preserved_parse_data'] = input_data
    
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
            
        if "organization" in parsed:
            st.session_state["_parsed_organization"] = parsed.get("organization", "")
            logging.info(f"Set _parsed_organization to: '{parsed.get('organization', '')}'")
            
        if "intro" in parsed and isinstance(parsed["intro"], dict):
            intro_data = parsed.get("intro", {})
            org = intro_data.get("organization", "")
            interests = intro_data.get("interests", "")
            
            # Set organization and interests as separate fields
            if org:
                st.session_state["_parsed_organization"] = org
                logging.info(f"Set _parsed_organization to: '{org}'")
                
            if interests:
                st.session_state["_parsed_interests"] = interests
                logging.info(f"Set _parsed_interests to: '{interests}'")
            
            # Set the intro field to only contain actual introduction text if any
            intro_text = intro_data.get("text", "")
            if intro_text:
                st.session_state["_parsed_intro"] = intro_text
                logging.info(f"Set _parsed_intro to: '{intro_text}'")
        elif "intro" in parsed and isinstance(parsed["intro"], str):
            # If intro is just a string, use it directly
            st.session_state["_parsed_intro"] = parsed["intro"]
            logging.info(f"Set _parsed_intro to string value: '{parsed['intro']}'")
        
        # Handle additional fields if present in parsed data
        if "signal_username" in parsed:
            st.session_state["_parsed_signal_username"] = parsed.get("signal_username", "")
            logging.info(f"Set _parsed_signal_username to: '{parsed.get('signal_username', '')}'")
            
        if "phone_number" in parsed:
            st.session_state["_parsed_phone_number"] = parsed.get("phone_number", "")
            logging.info(f"Set _parsed_phone_number to: '{parsed.get('phone_number', '')}'")
            
        if "linkedin_username" in parsed:
            st.session_state["_parsed_linkedin_username"] = parsed.get("linkedin_username", "")
            logging.info(f"Set _parsed_linkedin_username to: '{parsed.get('linkedin_username', '')}'")
        
        # Set a flag to indicate parsing was successful
        st.session_state["parsing_successful"] = True
        
        # Display success message instead of using st.rerun()
        # IMPORTANT: We're avoiding st.rerun() calls entirely due to RerunData errors in Streamlit 1.37+
        st.success("Data parsed successfully! Form has been updated with the parsed information.")
        logging.info("Parsing completed successfully")
        
    except Exception as e:
        logging.error(f"Exception during parsing: {str(e)}")
        logging.error(traceback.format_exc())
        st.error(f"An error occurred while parsing: {str(e)}")
    

def update_username_from_inputs():
    """
    Generate a username based on first name and a random word.
    Checks both local database and SSO service for existing usernames.
    """
    # Only auto-generate username if username is empty or matches previous auto-generation
    # This prevents overwriting a manually entered username
    if (not st.session_state.get('username_input') or 
        st.session_state.get('username_was_auto_generated', False)):
        
        first_name = st.session_state.get('first_name_input', '').strip().lower()
        
        logging.info(f"Attempting username generation with first_name='{first_name}'")
        
        # Generate username with first name and random word
        if first_name:
            # Use the new function to generate a username with random word
            from app.auth.utils import generate_username_with_random_word
            base_username = generate_username_with_random_word(first_name)
            logging.info(f"Generated base username with random word: {base_username}")
        else:
            # Just use a default if no first name
            import random
            random_suffix = random.randint(100, 999)
            base_username = f"user-{random_suffix}"
            logging.info(f"No first name provided, using default: {base_username}")
        
        # Check for existing username in local database
        existing_usernames = []
        try:
            # Get a database session
            from app.db.database import get_db
            db = next(get_db())
            try:
                from app.db.models import User
                # Use a SQL query that works with both SQLite and PostgreSQL
                local_existing = db.query(User).filter(User.username == base_username).all()
                if local_existing:
                    existing_usernames = [user.username for user in local_existing]
                    logging.info(f"Username {base_username} already exists in local DB")
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
            # Config already imported at top level
            import requests
            
            sso_exists = False
            # Define headers before using them
            headers = {
                'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
                'Content-Type': 'application/json'
            }
            user_search_url = f"{Config.AUTHENTIK_API_URL}/core/users/?username={base_username}"
            response = requests.get(user_search_url, headers=headers, timeout=10)
            
            if response.status_code == 200:
                users = response.json()
                if users.get('count', 0) > 0 or len(users.get('results', [])) > 0:
                    sso_exists = True
                    logging.info(f"Username {base_username} already exists in SSO")
            else:
                logging.warning(f"Failed to check SSO for existing username: {response.status_code}")
            
            # If username exists in either system, generate a new one with a suffix
            if base_username in existing_usernames or sso_exists:
                # Generate a new username with a random suffix
                import random
                random_suffix = random.randint(100, 999)
                final_username = f"{base_username}-{random_suffix}"
                logging.info(f"Username already exists, using random suffix: {final_username}")
            else:
                final_username = base_username
            
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
            logging.error(f"Error checking SSO for existing username: {e}")
            if base_username in existing_usernames:
                # Generate a unique suffix
                import random
                random_suffix = random.randint(100, 999)
                suggested_username = f"{base_username}-{random_suffix}"
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
            
        # Reset the parsing flag now that we've applied the parsed data
        st.session_state['parsing_successful'] = False

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
            
        # Reset the parsing flag now that we've applied the parsed data
        st.session_state['parsing_successful'] = False
        
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
                try:
                    # First try the current recommended method
                    st.rerun()
                except AttributeError:
                    # Fall back to experimental_rerun if rerun is not available
                    logging.warning("st.rerun() not available, falling back to st.experimental_rerun()")
                    st.experimental_rerun()

    # Return false to indicate no username was generated
    return False

def on_organization_change():
    """Handle changes to the organization field to avoid auto-filling introduction"""
    if 'organization_input_outside' in st.session_state:
        # Update the internal value
        st.session_state['organization_input'] = st.session_state['organization_input_outside']
        logging.info(f"Organization changed to: {st.session_state['organization_input_outside']}")
        
def on_interests_change():
    """Handle changes to the interests field to avoid auto-filling introduction"""
    if 'interests_input_outside' in st.session_state:
        # Update the internal value
        st.session_state['interests_input'] = st.session_state['interests_input_outside']
        logging.info(f"Interests changed to: {st.session_state['interests_input_outside']}")

def clear_parse_data():
    """Clear parse data from session state and reset form fields."""
    # Clear parse data from session state
    if 'parse_data' in st.session_state:
        del st.session_state.parse_data
    if 'parse_data_input' in st.session_state:
        del st.session_state.parse_data_input
    if 'parse_data_input_outside' in st.session_state:
        del st.session_state.parse_data_input_outside
    
    # Reset form fields
    reset_create_user_form_fields()
    
    # Display success message instead of using st.rerun()
    # IMPORTANT: We're avoiding st.rerun() calls entirely due to RerunData errors in Streamlit 1.37+
    st.success("Form has been cleared successfully!")
    logging.info("Form cleared successfully")

async def render_create_user_form():
    """Render the user creation form with improved layout and group selection."""
    
    # Import time module explicitly within the function scope to ensure it's available
    import time
    
    # Initialize key session state variables to prevent AttributeError
    if 'matrix_user_selected' not in st.session_state:
        # Restore from preserved data if available
        if 'preserved_matrix_user' in st.session_state:
            st.session_state.matrix_user_selected = st.session_state.preserved_matrix_user
        else:
            st.session_state.matrix_user_selected = None
            
    if 'recommended_rooms' not in st.session_state:
        st.session_state.recommended_rooms = []

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
    .stTextArea>div>div>textarea {
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
    .stTextArea>div>div>textarea:focus {
        border-color: var(--primary-color) !important;
        box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.25) !important;
        outline: 0 !important;
    }
    
    /* Label styling */
    .stTextInput label, .stTextArea label, .stSelectbox label {
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
    
    .parse-btn button {
        background-color: var(--primary-color);
        color: white;
        border: none;
    }
    
    .parse-btn button:hover {
        background-color: var(--primary-hover);
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
    
    .check-btn button {
        background-color: var(--info-color);
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
        color: var(--muted-color);
        margin-bottom: 5px;
    }
    
    /* Help icon styling */
    .stTextInput div svg, .stTextArea div svg, .stSelectbox div svg {
        color: var(--muted-color) !important;
    }
    
    /* Help text tooltips */
    .stTextInput div small, .stTextArea div small, .stSelectbox div small {
        color: var(--muted-color) !important;
    }
    
    /* Divider styling */
    .divider {
        margin: 24px 0;
        border-top: 1px solid var(--border-color);
    }
    
    /* Parse data section styling */
    .data-to-parse {
        background-color: var(--card-bg);
        padding: 15px;
        border-radius: 8px;
        border: 1px solid var(--border-color);
        margin-bottom: 20px;
    }
    
    /* Section headers */
    .stSubheader {
        color: var(--text-color);
        margin-bottom: 20px;
        font-weight: 600;
    }
    
    /* Row spacing */
    .row-container {
        margin-bottom: 20px;
    }
    
    /* Button container */
    .button-container {
        display: flex;
        justify-content: space-between;
        margin-top: 24px;
    }
    
    /* Dark mode optimization */
    @media (prefers-color-scheme: dark) {
        .help-text {
            color: var(--muted-color);
        }
        
        .data-to-parse {
            background-color: var(--card-bg);
            border-color: var(--border-color);
        }
    }
    
    /* Mobile optimization */
    @media (max-width: 768px) {
        .form-container {
            padding: 16px;
        }
        
        .stTextInput>div>div>input, 
        .stTextArea>div>div>textarea {
            padding: 12px !important;
        }
        
        .stButton button {
            width: 100%;
            margin-bottom: 10px;
        }
        
        .divider {
            margin: 16px 0;
        }
    }
    </style>
    """, unsafe_allow_html=True)

    # Initialize matrix_user_selected to prevent AttributeError
    if 'matrix_user_selected' not in st.session_state:
        st.session_state.matrix_user_selected = None
    if 'recommended_rooms' not in st.session_state:
        st.session_state.recommended_rooms = []

    # Fetch INDOC room users in background if not already fetched
    if 'fetch_indoc_users_started' not in st.session_state:
        st.session_state['fetch_indoc_users_started'] = False

    # Start background fetching of INDOC users
    if not st.session_state.get('fetch_indoc_users_started', False):
        try:
            import threading
            
            def fetch_indoc_users_thread():
                logging.info("Background INDOC user fetch thread started.")
                try:
                    # Import the needed function
                    from app.utils.recommendation import get_entrance_room_users_sync
                    import asyncio
                    import nest_asyncio
                    
                    # Create a new event loop for this thread
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    
                    # Apply nest_asyncio to allow nested event loops (if needed)
                    nest_asyncio.apply(loop)
                    
                    try:
                        # Get the users using the thread's event loop
                        fetched_users = get_entrance_room_users_sync()
                        st.session_state['indoc_users'] = fetched_users
                        st.session_state['fetch_indoc_users_complete'] = True
                        logging.info(f"Background INDOC user fetch completed. Found {len(fetched_users) if fetched_users else 0} users.")
                    finally:
                        # Always close the loop properly when done
                        loop.close()
                        logging.info("Event loop closed properly in background thread.")
                        
                except Exception as e:
                    logging.error(f"Error in background INDOC user fetch thread: {str(e)}")
                    logging.error(traceback.format_exc())
                    st.session_state['fetch_indoc_users_error'] = str(e)
                finally:
                    st.session_state['fetch_indoc_users_finished'] = True
                    logging.info("Background INDOC user fetch thread finished.")
            
            # Mark as started and launch thread
            st.session_state['fetch_indoc_users_started'] = True
            st.session_state['fetch_indoc_users_finished'] = False
            thread = threading.Thread(target=fetch_indoc_users_thread)
            thread.start()
            logging.info("Started background thread to fetch INDOC room users")
        except Exception as e:
            logging.error(f"Error starting background fetch of INDOC users: {str(e)}")
            logging.error(traceback.format_exc())
    
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
    
    # Get a list of available groups from Authentik for group selection
    groups = []
    
    try:
        # First, check if groups are in session state to avoid extra API calls
        if 'authentik_groups' in st.session_state and st.session_state.get('authentik_groups_timestamp', 0) > (time.time() - 3600):
            # Use cached groups if they're less than an hour old
            groups = st.session_state.authentik_groups
            logging.info("Using cached Authentik groups")
        else:
            # Fetch groups from Authentik
            api_url = f"{Config.AUTHENTIK_API_URL}/core/groups/"
            try:
                response = requests.get(api_url, headers={
                    'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
                    'Content-Type': 'application/json'
                }, timeout=10)
                
                if response.status_code == 200:
                    groups = response.json().get('results', [])
                    # Cache the groups and timestamp
                    st.session_state.authentik_groups = groups
                    st.session_state.authentik_groups_timestamp = time.time()
                    logging.info(f"Fetched and cached {len(groups)} Authentik groups")
                else:
                    st.error(f"Error fetching groups: {response.status_code} - {response.text}")
                    logging.error(f"Error fetching groups: {response.status_code} - {response.text}")
            except requests.exceptions.Timeout:
                st.warning("Timeout while fetching groups. Using cached data if available.")
                logging.warning("Timeout while fetching Authentik groups")
                if 'authentik_groups' in st.session_state:
                    groups = st.session_state.authentik_groups
            except requests.exceptions.RequestException as e:
                st.warning(f"Network error while fetching groups: {str(e)}")
                logging.warning(f"Network error fetching Authentik groups: {str(e)}")
                if 'authentik_groups' in st.session_state:
                    groups = st.session_state.authentik_groups
    except Exception as e:
        logging.error(f"Error getting groups: {str(e)}")
        logging.error(traceback.format_exc())
    
    # Row 1: First Name, Last Name, and Invited By
    col1, col2, col3 = st.columns([2, 2, 2])
    
    with col1:
        # First Name field with error checking
        if 'first_name_input_outside' in st.session_state:
            first_name = st.text_input(
                "First Name *",
                key="first_name_input_outside",
                on_change=on_first_name_change,
                help="Required: User's first name",
                placeholder="John"
            )
        else:
            first_name = st.text_input(
                "First Name *",
                value=st.session_state.get('first_name_input', ""),
                key="first_name_input_outside",
                on_change=on_first_name_change,
                help="Required: User's first name",
                placeholder="John"
            )
    
    with col2:
        # Last Name field
        if 'last_name_input_outside' in st.session_state:
            last_name = st.text_input(
                "Last Name",
                key="last_name_input_outside",
                on_change=on_last_name_change,
                help="User's last name",
                placeholder="Doe"
            )
        else:
            last_name = st.text_input(
                "Last Name",
                value=st.session_state.get('last_name_input', ""),
                key="last_name_input_outside",
                on_change=on_last_name_change,
                help="User's last name",
                placeholder="Doe"
            )
    
    with col3:
        # Invited by field
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
    
    # Row 2: Email, Signal Username, Phone Number, LinkedIn Username
    col1, col2, col3, col4 = st.columns([3, 2, 2, 2])
    
    with col1:
        # Email field
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
        # Signal username field
        if 'signal_username_input_outside' in st.session_state:
            signal_username = st.text_input(
                "Signal Username",
                key="signal_username_input_outside",
                help="User's Signal username (optional)",
                placeholder="@username"
            )
        else:
            signal_username = st.text_input(
                "Signal Username",
                value=st.session_state.get('signal_username_input', ""),
                key="signal_username_input_outside",
                help="User's Signal username (optional)",
                placeholder="@username"
            )
    
    with col3:
        # Phone number field
        if 'phone_number_input_outside' in st.session_state:
            phone_number = st.text_input(
                "Phone Number",
                key="phone_number_input_outside",
                help="User's phone number (optional)",
                placeholder="+1234567890"
            )
        else:
            phone_number = st.text_input(
                "Phone Number",
                value=st.session_state.get('phone_number_input', ""),
                key="phone_number_input_outside",
                help="User's phone number (optional)",
                placeholder="+1234567890"
            )
    
    with col4:
        # LinkedIn username field
        if 'linkedin_username_input_outside' in st.session_state:
            linkedin_username = st.text_input(
                "LinkedIn Username",
                key="linkedin_username_input_outside",
                help="User's LinkedIn username (optional)",
                placeholder="username"
            )
        else:
            linkedin_username = st.text_input(
                "LinkedIn Username",
                value=st.session_state.get('linkedin_username_input', ""),
                key="linkedin_username_input_outside",
                help="User's LinkedIn username (optional)",
                placeholder="username"
            )
    
    # Row 3: Organization, Username, and Check Username button
    col1, col2, col3 = st.columns([2, 2, 1])
    
    with col1:
        # Organization field
        if 'organization_input_outside' in st.session_state:
            organization = st.text_input(
                "Organization",
                key="organization_input_outside",
                on_change=on_organization_change,
                help="User's organization or company (optional)",
                placeholder="Company or organization name"
            )
        else:
            organization = st.text_input(
                "Organization",
                value=st.session_state.get('organization_input', ""),
                key="organization_input_outside",
                on_change=on_organization_change,
                help="User's organization or company (optional)",
                placeholder="Company or organization name"
            )
    
    with col2:
        # Username field
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
    
    with col3:
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
                # First, clean the username to ensure it follows proper format
                import re
                cleaned_username = re.sub(r'[^a-z0-9-]', '', username.lower())
                
                if cleaned_username != username:
                    st.warning(f"Username has been cleaned to '{cleaned_username}'. Please use this version.")
                    username = cleaned_username
                    st.session_state['username_input'] = cleaned_username
                    st.session_state['username_input_outside'] = cleaned_username
                
                # Check local database
                from app.db.database import get_db
                from app.db.models import User
                db = next(get_db())
                
                local_exists = False
                sso_exists = False
                
                try:
                    # Check local database first
                    existing_user = db.query(User).filter(User.username == username).first()
                    if existing_user:
                        local_exists = True
                        st.warning(f"Username '{username}' already exists in local database.")
                    
                    # Also check in Authentik SSO
                    headers = {
                        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
                        'Content-Type': 'application/json'
                    }
                    
                    # Check two ways: exact match and prefix match
                    sso_exists = False
                    
                    # 1. Check for exact match first
                    exact_check_url = f"{Config.AUTHENTIK_API_URL}/core/users/?username={username}"
                    try:
                        response = requests.get(exact_check_url, headers=headers, timeout=10)
                        
                        if response.status_code == 200:
                            auth_data = response.json()
                            if auth_data.get('count', 0) > 0 or len(auth_data.get('results', [])) > 0:
                                sso_exists = True
                                st.warning(f"Username '{username}' already exists in Authentik SSO.")
                        else:
                            st.error(f"Error checking username in Authentik: {response.status_code} - {response.text}")
                            logging.error(f"Error checking username: {response.status_code} - {response.text}")
                    except requests.exceptions.RequestException as req_err:
                        st.error(f"Network error checking username in Authentik: {str(req_err)}")
                        logging.error(f"Network error checking username: {str(req_err)}")
                        
                    # 2. If exact match doesn't exist, check if it starts with the username (for incremented usernames)
                    if not sso_exists:
                        prefix_check_url = f"{Config.AUTHENTIK_API_URL}/core/users/?username__startswith={username}"
                        try:
                            response = requests.get(prefix_check_url, headers=headers, timeout=10)
                            if response.status_code == 200:
                                auth_data = response.json()
                                matches = auth_data.get('results', [])
                                # Check if there's an exact match in the results
                                exact_matches = [u for u in matches if u.get('username') == username]
                                if exact_matches:
                                    sso_exists = True
                                    st.warning(f"Username '{username}' already exists in Authentik SSO.")
                                elif matches:
                                    # Show how many similar usernames exist
                                    similar_count = len(matches)
                                    st.info(f"Found {similar_count} similar usernames starting with '{username}' in Authentik SSO.")
                        except requests.exceptions.RequestException as req_err:
                            logging.error(f"Network error checking username prefix in Authentik: {str(req_err)}")
                    
                    # If username exists in either system, suggest alternatives
                    if local_exists or sso_exists:
                        # Generate alternative username suggestions
                        import random
                        base_username = username.rstrip('0123456789')  # Remove any trailing numbers
                        
                        # Try sequential numbers first
                        suggestions = []
                        for i in range(1, 4):
                            suggestions.append(f"{base_username}{i}")
                        
                        # Also add a random suggestion
                        random_suffix = random.randint(100, 999)
                        suggestions.append(f"{base_username}{random_suffix}")
                        
                        # Show suggestions
                        st.info(f"Suggested alternatives: {', '.join(suggestions)}")
                    else:
                        st.success(f"Username '{username}' is available!")
                finally:
                    db.close()
            except Exception as e:
                logging.error(f"Error checking username: {str(e)}")
                logging.error(traceback.format_exc())
                st.error(f"An error occurred while checking username: {str(e)}")
    
    # Additional Information heading
    st.markdown("<div class='divider'></div>", unsafe_allow_html=True)
    st.subheader("Additional Information")
    
    # Row 4: Interests and Introduction
    col1, col2 = st.columns([1, 2])
    
    with col1:
        # Interests field
        if 'interests_input_outside' in st.session_state:
            interests = st.text_input(
                "Interests",
                key="interests_input_outside",
                on_change=on_interests_change,
                help="User's interests or areas of expertise (optional)",
                placeholder="AI, Security, Development, etc."
            )
        else:
            interests = st.text_input(
                "Interests",
                value=st.session_state.get('interests_input', ""),
                key="interests_input_outside",
                on_change=on_interests_change,
                help="User's interests or areas of expertise (optional)",
                placeholder="AI, Security, Development, etc."
            )
    
    with col2:
        # Introduction text for the user
        st.subheader("Introduction")
        # Fix for the widget key conflict
        if 'intro_text_input_outside' in st.session_state:
            intro_text = st.text_area(
                "User Introduction",
                key="intro_text_input_outside",
                placeholder="A few sentences about the new user (Organization and Interests are handled separately)",
                help="Brief introduction for the new user. Organization and Interests information will be added automatically from their respective fields.",
                height=100
            )
        else:
            intro_text = st.text_area(
                "User Introduction",
                value=st.session_state.get('intro_text_input', ""),
                key="intro_text_input_outside",
                placeholder="A few sentences about the new user (Organization and Interests are handled separately)",
                help="Brief introduction for the new user. Organization and Interests information will be added automatically from their respective fields.",
                height=100
            )
        
        # Add explanatory text
        st.markdown("""
        <div style="font-size:0.8rem; color:#6c757d;">
        Organization and Interests entered above will be automatically included in the user's profile and introduction post.
        No need to repeat them here.
        </div>
        """, unsafe_allow_html=True)
    
    # Row 5: Group Assignment and Discourse Post Checkbox
    col1, col2 = st.columns([1, 1])
    
    with col1:
        st.subheader("Group Assignment")
        main_group_id = Config.MAIN_GROUP_ID
        if main_group_id:
            st.session_state['selected_groups'] = [main_group_id]
            st.session_state['group_selection'] = [main_group_id]
            st.info(f"User will be automatically added to the default group")
        else:
            st.warning("No default group configured in MAIN_GROUP_ID")
    
    with col2:
        # Add Discourse checkbox
        st.write("")  # Add some space
        create_discourse_post = st.checkbox(
            "Create Discourse introduction post",
            value=True,
            key="create_discourse_post",
            help="Create an introduction post on the Discourse forum for this user"
        )
        
        # Add Matrix integration options
        st.write("")  # Add some space
        send_matrix_welcome = st.checkbox(
            "Send welcome message to Matrix user",
            value=True,
            key="send_matrix_welcome",
            help="Send the welcome message directly to the connected Matrix user"
        )
        
        st.write("")  # Add some space
        add_to_recommended_rooms = st.checkbox(
            "Add to recommended Matrix rooms",
            value=True,
            key="add_to_recommended_rooms",
            help="Automatically add the user to recommended rooms based on their interests"
        )
    
    # Data parsing section
    st.markdown("<div class='divider'></div>", unsafe_allow_html=True)
    st.subheader("Parse User Data")
    
    # Add a section to connect with Matrix user from INDOC
    st.markdown("<div class='divider'></div>", unsafe_allow_html=True)
    st.subheader("Connect with Matrix User")
    
    # Load Matrix users from INDOC room if not already loaded
    if not st.session_state.matrix_users:
        with st.spinner("Loading Matrix users from INDOC room..."):
            try:
                # Create a new event loop for the background thread
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                
                # Apply nest_asyncio to allow nested event loops
                import nest_asyncio
                nest_asyncio.apply()
                
                # Fetch Matrix users from INDOC room
                st.session_state.matrix_users = await get_all_accessible_users()
                
                # Close the loop
                loop.close()
                
                if not st.session_state.matrix_users:
                    st.warning("No Matrix users found in INDOC room. Please try again later.")
            except Exception as e:
                st.error(f"Error loading Matrix users: {str(e)}")
                st.session_state.matrix_users = []
    
    # Display Matrix user selection
    if st.session_state.matrix_users:
        # Ensure matrix_user_selected is initialized
        if 'matrix_user_selected' not in st.session_state:
            st.session_state.matrix_user_selected = None
        if 'matrix_user_display_name' not in st.session_state:
            st.session_state.matrix_user_display_name = None

        # Store previous selection to detect changes
        previous_selection = st.session_state.get('matrix_user_selected')
            
        matrix_user_options = [f"{user['display_name']} ({user['user_id']})" for user in st.session_state.matrix_users]
        selected_user = st.selectbox(
            "Select Matrix User",
            options=[""] + matrix_user_options,
            key="matrix_user_select"
        )
        
        if selected_user:
            # Extract user_id and display_name from the selected option
            user_id = selected_user.split("(")[-1].rstrip(")")
            display_name = selected_user.split("(")[0].strip()
            
            # Always explicitly set both keys for the session state 
            st.session_state['matrix_user_selected'] = user_id
            st.session_state.matrix_user_selected = user_id
            st.session_state['matrix_user_display_name'] = display_name
            st.session_state.matrix_user_display_name = display_name
            
            # If the selection changed, clear recommendations for a fresh start
            if previous_selection != user_id:
                st.session_state.recommended_rooms = []
            
            # Initialize recommended_rooms if it does not exist
            if "recommended_rooms" not in st.session_state:
                st.session_state.recommended_rooms = []
            
            # Store the Matrix username in the database
            try:
                # Import models and database connection at the function level to avoid scope issues
                from app.db.session import get_db
                from app.db.models import User  # Ensure User model is imported here
                
                # Ensure email is defined and valid before querying
                email = st.session_state.get('email_input_outside', '')
                if email:
                    db = next(get_db())
                    user = db.query(User).filter(User.email == email).first()
                    if user:
                        user.matrix_username = display_name
                        # Update Authentik profile with Matrix username
                        user.attributes = user.attributes or {}
                        user.attributes['matrix_username'] = display_name
                        db.commit()
                        st.success(f"Matrix username {display_name} linked to account")
            except Exception as e:
                st.error(f"Error storing Matrix username: {str(e)}")
                
            # Add a button to get room recommendations
            user_interests = st.session_state.get('interests_input', '')
            get_recommendations = st.button("Get Room Recommendations", key="get_recommendations_button")
            
            if get_recommendations and user_interests:
                with st.spinner("Getting room recommendations based on interests..."):
                    try:
                        from app.utils.recommendation import get_room_recommendations_sync
                        logging.info(f"Getting manual room recommendations for interests: {user_interests}")
                        
                        # Use a longer timeout when explicitly requested
                        recommended_rooms = get_room_recommendations_sync(user_id, user_interests)
                        
                        # Store the recommendations in session state
                        st.session_state.recommended_rooms = recommended_rooms
                        
                        if not recommended_rooms:
                            st.warning("No recommended rooms found based on interests. Please try again.")
                    except Exception as e:
                        st.error(f"Error getting room recommendations: {str(e)}")
                        logging.error(f"Error in manual room recommendations: {str(e)}")
    
    # Room recommendations based on interests - check that matrix_user_selected exists and is not None
    # Use a more robust check to handle different ways the key might be stored
    matrix_user = st.session_state.get('matrix_user_selected')
    if matrix_user and interests:
        st.subheader("Recommended Rooms")
        
        # Get room recommendations
        if "recommended_rooms" not in st.session_state:
            st.session_state.recommended_rooms = []
        if not st.session_state.recommended_rooms:
            with st.spinner("Getting room recommendations based on interests..."):
                try:
                    # Use a timeout to prevent hanging if the recommendation service is slow
                    import threading
                    import queue
                    import time
                    from concurrent.futures import ThreadPoolExecutor
                    
                    result_queue = queue.Queue()
                    
                    def get_recommendations_with_timeout():
                        try:
                            # Ensure the recommendation function is properly imported
                            from app.utils.recommendation import get_room_recommendations_sync
                            
                            # Ensure matrix_user has a value and use safe get()
                            matrix_user_id = st.session_state.get('matrix_user_selected')
                            if matrix_user_id is None:
                                # Log the issue but don't raise an exception
                                logging.warning("matrix_user_selected is None during recommendation")
                                matrix_user_id = ""  # Empty string as fallback
                                
                            # Get room recommendations with defensive checks
                            logging.info(f"Starting room recommendation request for user: {matrix_user_id}, interests: {interests}")
                            
                            # Use a separate thread with timeout to avoid getting stuck
                            with ThreadPoolExecutor(max_workers=1) as executor:
                                future = executor.submit(get_room_recommendations_sync, matrix_user_id, interests or "")
                                try:
                                    # Wait for result with timeout
                                    rooms = future.result(timeout=8)  # 8 second timeout
                                    result_queue.put(("success", rooms))
                                    logging.info(f"Successfully got room recommendations: {len(rooms) if rooms else 0} rooms")
                                except TimeoutError:
                                    logging.error("Room recommendation timed out in ThreadPoolExecutor")
                                    result_queue.put(("error", "Recommendation request timed out"))
                                    # Force cancel the future if possible
                                    future.cancel()
                        except Exception as e:
                            # Log the full exception details
                            logging.error(f"Error in get_recommendations_with_timeout: {str(e)}")
                            logging.error(traceback.format_exc())
                            result_queue.put(("error", str(e)))
                    
                    # Start the recommendation thread
                    rec_thread = threading.Thread(target=get_recommendations_with_timeout)
                    rec_thread.daemon = True
                    rec_thread.start()
                    
                    # Wait for result with a firm timeout
                    start_time = time.time()
                    max_wait = 10  # Maximum 10 seconds wait
                    
                    while time.time() - start_time < max_wait:
                        if not result_queue.empty():
                            status, result = result_queue.get()
                            if status == "success":
                                # Ensure result is not None before assigning to session state
                                if result is not None:
                                    st.session_state.recommended_rooms = result
                                    logging.info(f"Set recommended_rooms with {len(result)} rooms")
                                else:
                                    st.session_state.recommended_rooms = []
                                    st.warning("No recommendations found. Using empty list.")
                                    logging.warning("Recommendation result was None")
                            else:
                                st.error(f"Error getting room recommendations: {result}")
                                st.session_state.recommended_rooms = []  # Ensure it's initialized as empty list
                                logging.error(f"Recommendation error: {result}")
                            break
                        
                        # Sleep briefly to avoid CPU spinning
                        time.sleep(0.1)
                    else:
                        # Loop completed without finding result
                        st.warning("Timed out while getting room recommendations. Please try again.")
                        st.session_state.recommended_rooms = []
                        logging.warning("Recommendation timed out after waiting for result")
                        
                        # If thread is still alive after timeout, log a warning
                        if rec_thread.is_alive():
                            logging.warning("Recommendation thread is still running after timeout")
                    
                except Exception as e:
                    st.error(f"Error getting room recommendations: {str(e)}")
                    logging.error(f"Error getting room recommendations: {str(e)}")
                    logging.error(traceback.format_exc())
                    st.session_state.recommended_rooms = []
        
        # Display recommended rooms with checkboxes
        if st.session_state.recommended_rooms:
            try:
                # Create a container for the rooms with a max height
                room_container = st.container()
                
                with room_container:
                    # Group rooms by category if possible
                    room_categories = {}
                    
                    # Safely process rooms
                    for room in st.session_state.recommended_rooms:
                        try:
                            room_id = room.get('room_id', '')
                            if not room_id:
                                continue  # Skip rooms without ID
                                
                            room_key = f"room_{room_id}"
                            
                            # Try to extract category from room name or topic
                            category = "General"
                            room_name = room.get('name', f"Room {room_id}")
                            room_topic = room.get('topic', '')
                            
                            # Look for category indicators in name or topic
                            if ":" in room_name:
                                parts = room_name.split(":", 1)
                                if len(parts[0].strip()) <= 20:  # Reasonable category length
                                    category = parts[0].strip()
                            
                            # Add room to category
                            if category not in room_categories:
                                room_categories[category] = []
                            
                            room_categories[category].append({
                                'id': room_id,
                                'key': room_key,
                                'name': room_name,
                                'description': room.get('description', room.get('topic', '')),
                                'selected': room_key in st.session_state.selected_rooms
                            })
                        except Exception as room_err:
                            # Log error but continue with other rooms
                            logging.error(f"Error processing room: {str(room_err)}")
                            continue
                    
                    # Display rooms by category
                    for category, rooms in sorted(room_categories.items()):
                        if category != "General":
                            st.subheader(f"{category}")
                        
                        # Create columns for better layout
                        cols = st.columns(2)
                        col_idx = 0
                        
                        for room in sorted(rooms, key=lambda r: r['name']):
                            with cols[col_idx]:
                                # Create checkbox with room name and description
                                description = room['description']
                                # Add null check for description to handle None values
                                if description is None:
                                    description = ""
                                tooltip = description if len(description) > 50 else ""
                                display_desc = description[:50] + "..." if len(description) > 50 else description
                                
                                if st.checkbox(
                                    f"{room['name']}",
                                    key=room['key'],
                                    value=room['selected'],
                                    help=tooltip
                                ):
                                    st.session_state.selected_rooms.add(room['key'])
                                    st.caption(display_desc)
                                else:
                                    st.session_state.selected_rooms.discard(room['key'])
                                    st.caption(display_desc)
                            
                            # Alternate columns
                            col_idx = (col_idx + 1) % 2
                
                # Add to selected rooms button with improved feedback
                col1, col2 = st.columns(2)
                
                with col1:
                    if st.button("Add to Selected Rooms", key="add_to_rooms_button"):
                        selected_room_ids = [
                            room['room_id'] for room in st.session_state.recommended_rooms
                            if f"room_{room['room_id']}" in st.session_state.selected_rooms
                        ]
                        
                        if selected_room_ids:
                            with st.spinner("Adding to rooms..."):
                                try:
                                    # Track progress for each room
                                    progress_placeholder = st.empty()
                                    results_container = st.container()
                                    
                                    total_rooms = len(selected_room_ids)
                                    successful = 0
                                    failed = 0
                                    
                                    # Process each room individually for better feedback
                                    for i, room_id in enumerate(selected_room_ids):
                                        room_name = next((room['name'] for room in st.session_state.recommended_rooms 
                                                        if room['room_id'] == room_id), f"Room {room_id}")
                                        
                                        progress_placeholder.progress((i) / total_rooms, 
                                                                    text=f"Processing {i+1}/{total_rooms}: {room_name}")
                                        
                                        try:
                                            # Invite to this specific room
                                            from app.utils.matrix_actions import invite_to_matrix_room_sync, invite_to_matrix_room
                                            
                                            matrix_user_id = st.session_state.get('matrix_user_selected')
                                            if not matrix_user_id:
                                                with results_container:
                                                    st.error("Invalid Matrix user ID. Please select a user first.")
                                                failed += 1
                                                continue
                                            
                                            # Use run_async_safely to handle event loop properly
                                            success = run_async_safely(
                                                invite_to_matrix_room,  # Use the async version directly
                                                room_id,
                                                matrix_user_id
                                            )
                                            
                                            if success:
                                                with results_container:
                                                    st.success(f"Added to: {room_name}")
                                                successful += 1
                                            else:
                                                with results_container:
                                                    st.warning(f"Failed to add to: {room_name}")
                                                failed += 1
                                        except Exception as e:
                                            with results_container:
                                                st.error(f"Error adding to {room_name}: {str(e)}")
                                            failed += 1
                                    
                                    # Final progress and summary
                                    progress_placeholder.progress(1.0, text="Completed")
                                    
                                    if successful > 0:
                                        st.success(f"Successfully added to {successful} out of {total_rooms} rooms")
                                    if failed > 0:
                                        st.warning(f"Failed to add to {failed} rooms. You may need to try again later.")
                                except Exception as e:
                                    st.error(f"Error adding to rooms: {str(e)}")
                                    logging.error(f"Error adding to rooms: {str(e)}")
                                    logging.error(traceback.format_exc())
                    else:
                        st.warning("Please select at least one room to join")
                
                with col2:
                    if st.button("Select All Rooms", key="select_all_rooms"):
                        # Add all room keys to selected_rooms
                        for room in st.session_state.recommended_rooms:
                            room_key = f"room_{room['room_id']}"
                            st.session_state.selected_rooms.add(room_key)
                        # Use the appropriate rerun method based on Streamlit version
                        try:
                            # First try the current recommended method
                            st.rerun()
                        except AttributeError:
                            # Fall back to experimental_rerun if rerun is not available
                            logging.warning("st.rerun() not available, falling back to st.experimental_rerun()")
                            st.experimental_rerun()
            except Exception as rec_error:
                # Log error but allow form to continue functioning for user creation
                st.warning("Could not display room recommendations due to an error. You can still create the user.")
                logging.error(f"Error displaying room recommendations: {str(rec_error)}")
                logging.error(traceback.format_exc())
        
        # Display the "No recommended rooms" message only if there are no recommended rooms
        else:
            st.warning("No recommended rooms found based on your interests.")
    
    # Add manual room search feature
    st.markdown("<div class='divider'></div>", unsafe_allow_html=True)
    st.subheader("Search for Rooms")
    
    # Room search input and button
    col1, col2, col3 = st.columns([3, 2, 1])
    with col1:
        room_search_query = st.text_input(
            "Search for rooms by keyword",
            key="room_search_query",
            help="Enter keywords to find specific rooms (e.g., 'tech', 'outdoor', 'ai', etc.)"
        )
    
    with col2:
        # Add category filter dropdown
        search_category = st.selectbox(
            "Filter by category",
            options=["All Categories", "Tech", "Information & Research", "Miscellaneous", "Locations"],
            key="search_category"
        )
    
    with col3:
        search_rooms_button = st.button("Search Rooms", key="search_rooms_button")
    
    # Handle room search
    if search_rooms_button and room_search_query:
        with st.spinner("Searching for rooms..."):
            try:
                from app.utils.recommendation import get_room_recommendations_sync
                
                # Combine search query with category if selected
                search_terms = room_search_query
                if search_category != "All Categories":
                    search_terms = f"{search_terms}, {search_category}"
                
                # Use the search query as the interests parameter
                search_results = get_room_recommendations_sync("", search_terms)
                
                if search_results:
                    st.success(f"Found {len(search_results)} rooms matching your search")
                    
                    # Show search results in a similar format to recommended rooms
                    room_container = st.container()
                    
                    with room_container:
                        # Group rooms by category if possible
                        room_categories = {}
                        
                        for room in search_results:
                            try:
                                room_id = room.get('room_id', '')
                                if not room_id:
                                    continue  # Skip rooms without ID
                                    
                                room_key = f"search_room_{room_id}"
                                
                                # Try to extract category from room name or topic
                                category = "General"
                                room_name = room.get('name', f"Room {room_id}")
                                room_topic = room.get('topic', '')
                                
                                # Look for category indicators in name or topic
                                if ":" in room_name:
                                    parts = room_name.split(":", 1)
                                    if len(parts[0].strip()) <= 20:  # Reasonable category length
                                        category = parts[0].strip()
                                
                                # Add room to category
                                if category not in room_categories:
                                    room_categories[category] = []
                                
                                room_categories[category].append({
                                    'id': room_id,
                                    'key': room_key,
                                    'name': room_name,
                                    'description': room.get('description', room.get('topic', '')),
                                    'selected': room_key in st.session_state.selected_rooms
                                })
                            except Exception as room_err:
                                # Log error but continue with other rooms
                                logging.error(f"Error processing search room: {str(room_err)}")
                                continue
                        
                        # Display rooms by category
                        for category, rooms in sorted(room_categories.items()):
                            if category != "General":
                                st.subheader(f"{category}")
                            
                            # Create columns for better layout
                            cols = st.columns(2)
                            col_idx = 0
                            
                            for room in sorted(rooms, key=lambda r: r['name']):
                                with cols[col_idx]:
                                    # Create checkbox with room name and description
                                    description = room['description']
                                    # Add null check for description to handle None values
                                    if description is None:
                                        description = ""
                                    tooltip = description if len(description) > 50 else ""
                                    display_desc = description[:50] + "..." if len(description) > 50 else description
                                    
                                    if st.checkbox(
                                        f"{room['name']}",
                                        key=room['key'],
                                        value=room['selected'],
                                        help=tooltip
                                    ):
                                        st.session_state.selected_rooms.add(room['key'])
                                        st.caption(display_desc)
                                    else:
                                        st.session_state.selected_rooms.discard(room['key'])
                                        st.caption(display_desc)
                                
                                # Alternate columns
                                col_idx = (col_idx + 1) % 2
                        
                        # Add search results to selected rooms button
                        search_col1, search_col2 = st.columns(2)
                        
                        with search_col1:
                            if st.button("Add Search Results to Selected Rooms", key="add_search_rooms_button"):
                                selected_room_ids = [
                                    room['id'] for category_rooms in room_categories.values() 
                                    for room in category_rooms if room['key'] in st.session_state.selected_rooms
                                ]
                                
                                if selected_room_ids:
                                    st.success(f"Added {len(selected_room_ids)} rooms to selection")
                                else:
                                    st.warning("Please select at least one room from the search results")
                        
                        with search_col2:
                            if st.button("Select All Search Results", key="select_all_search_rooms"):
                                # Add all search room keys to selected_rooms
                                for category_rooms in room_categories.values():
                                    for room in category_rooms:
                                        st.session_state.selected_rooms.add(room['key'])
                                st.rerun()
                else:
                    st.warning("No rooms found matching your search criteria. Try different keywords.")
            except Exception as e:
                st.error(f"Error searching for rooms: {str(e)}")
                logging.error(f"Error in room search: {str(e)}")
                logging.error(traceback.format_exc())
    
    # Parse data textarea 
    st.markdown("<div class='divider'></div>", unsafe_allow_html=True)
    st.subheader("Parse Text Data")
    
    # Store the parse data input value separately to ensure it persists through reruns
    if 'preserved_parse_data' not in st.session_state:
        st.session_state['preserved_parse_data'] = ""
    
    # Parse data textarea 
    if 'parse_data_input_outside' in st.session_state:
        # Use the preserved value if it exists
        parse_data = st.text_area(
            "Enter data to parse",
            key="parse_data_input_outside",
            value=st.session_state.get('preserved_parse_data', ""),
            help="Enter multiple lines of information to parse into user fields",
            placeholder="1. John Doe\n2. ACME Corporation\n3. Jane Smith\n4. john.doe@example.com\n5. AI, Python, Security\n6. johndoe",
            height=150
        )
        # Update the preserved value whenever the field changes
        st.session_state['preserved_parse_data'] = parse_data
    else:
        parse_data = st.text_area(
            "Enter data to parse",
            value=st.session_state.get('preserved_parse_data', ""),
            key="parse_data_input_outside",
            help="Enter multiple lines of information to parse into user fields",
            placeholder="1. John Doe\n2. ACME Corporation\n3. Jane Smith\n4. john.doe@example.com\n5. AI, Python, Security\n6. johndoe",
            height=150
        )
        # Update the preserved value whenever the field changes
        st.session_state['preserved_parse_data'] = parse_data
    
    # Bottom row with all buttons
    col1, col2, col3 = st.columns([1, 1, 1])
    
    with col1:
        st.markdown("<div class='parse-btn'>", unsafe_allow_html=True)
        if st.button("Parse Data", key="parse_data_button"):
            parse_and_rerun()
        st.markdown("</div>", unsafe_allow_html=True)
        
    with col2:
        st.markdown("<div class='clear-btn'>", unsafe_allow_html=True)
        if st.button("Clear Parse Data", key="clear_parse_data_button"):
            clear_parse_data()
        st.markdown("</div>", unsafe_allow_html=True)
    
    with col3:
        st.markdown("<div class='create-btn'>", unsafe_allow_html=True)
        create_user_button = st.button("Create User", key="create_user_button")
        st.markdown("</div>", unsafe_allow_html=True)
    
    # Handle Create User button logic
    if create_user_button:
        # Save currently selected Matrix user info to ensure it persists
        if 'matrix_user_selected' in st.session_state:
            matrix_user_selected = st.session_state.matrix_user_selected
            # Store it in a separate variable to ensure it's preserved
            st.session_state['preserved_matrix_user'] = matrix_user_selected
        
        # Validate email format
        import re  # Make sure re is imported within this scope
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        is_valid_email = re.match(email_pattern, email) if email else False
        
        # Check required fields
        if not username or not first_name or not email:
            st.error("Please fill in all required fields (marked with *)")
        elif not is_valid_email:
            st.error("Please enter a valid email address")
        else:
            try:
                # Prepare user data for submission
                user_data = {
                    "username": username,
                    "name": f"{first_name} {last_name}".strip(),
                    "email": email
                }
                
                # Initialize attributes dictionary
                attributes = {}
                
                # Add optional fields if provided
                if invited_by:
                    attributes["invited_by"] = invited_by
                
                if intro_text:
                    attributes["intro"] = intro_text
                
                # Add new optional fields if provided
                if organization:
                    attributes["organization"] = organization
                
                if interests:
                    attributes["interests"] = interests
                
                if signal_username:
                    attributes["signal_username"] = signal_username
                
                if phone_number:
                    attributes["phone_number"] = phone_number
                
                if linkedin_username:
                    attributes["linkedin_username"] = linkedin_username
                
                # Add attributes to user_data if any were provided
                if attributes:
                    user_data["attributes"] = attributes
                
                # Get selected groups
                selected_groups = st.session_state.get('group_selection', [])
                
                # Add log for debugging
                logging.info(f"Creating user with data: {user_data}")
                logging.info(f"Selected groups: {selected_groups}")
                
                # Set a spinner while creating the user
                with st.spinner("Creating user..."):
                    # Use the create_user function that was already imported at the top level
                    
                    # Create user synchronously - use parameters that match the API function
                    result = create_user(
                        email=email,
                        first_name=first_name,
                        last_name=last_name,
                        attributes=user_data.get("attributes", {}),
                        groups=selected_groups,
                        desired_username=username,
                        reset_password=True,
                        should_create_discourse_post=True
                    )
                    
                    # Handle the result
                    if result and not result.get('error'):
                        # Get the username from the result, which may have been incremented for uniqueness
                        final_username = result.get('username', username)
                        if final_username != username:
                            logging.info(f"Username was modified for uniqueness: {username} -> {final_username}")
                            st.info(f"Note: Username was adjusted to ensure uniqueness. The assigned username is: {final_username}")
                        
                        # Show success message
                        st.success(f"User {final_username} has been created! You can now connect them with a Matrix user.")
                        
                        # Log the return values for debugging
                        logging.info(f"User creation result: {result}")
                        discourse_post_url = result.get('discourse_url')
                        logging.info(f"Discourse URL in result: {discourse_post_url}")
                        
                        # Store discourse URL in session state for persistence across reruns
                        st.session_state['discourse_post_url'] = discourse_post_url
                        
                        # Display forum post information prominently if available
                        if discourse_post_url:
                            st.success(f"✅ Forum post created successfully!")
                            st.markdown(f"""
                            ### 📝 Forum Post
                            An introduction post has been created for this user on the forum:
                            
                            **[View forum post]({discourse_post_url})**
                            
                            The user will be prompted to complete their introduction when they log in.
                            """)
                        else:
                            st.warning("⚠️ No forum post was created. This might be because Discourse integration is not fully configured.")
                            # Log more details about the Discourse configuration
                            logging.info("=== Checking Discourse Integration Configuration ===")
                            # Config already imported at top level
                            logging.info(f"DISCOURSE_URL is configured: {Config.DISCOURSE_URL}")
                            logging.info(f"DISCOURSE_API_KEY is configured: {'yes' if Config.DISCOURSE_API_KEY else 'no'}")
                            logging.info(f"DISCOURSE_API_USERNAME is configured: {Config.DISCOURSE_API_USERNAME}")
                            logging.info(f"DISCOURSE_CATEGORY_ID is configured: {Config.DISCOURSE_CATEGORY_ID}")
                            logging.info(f"DISCOURSE_INTRO_TAG is configured: {Config.DISCOURSE_INTRO_TAG}")
                            logging.info(f"DISCOURSE_ACTIVE is set to: {Config.DISCOURSE_ACTIVE}")
                            if all([Config.DISCOURSE_URL, Config.DISCOURSE_API_KEY, Config.DISCOURSE_API_USERNAME, Config.DISCOURSE_CATEGORY_ID]):
                                logging.info("✅ Discourse integration is fully configured")
                                st.error("All Discourse settings are configured but post creation failed. Check logs for more details.")
                            else:
                                missing = []
                                if not Config.DISCOURSE_URL: missing.append("DISCOURSE_URL")
                                if not Config.DISCOURSE_API_KEY: missing.append("DISCOURSE_API_KEY")
                                if not Config.DISCOURSE_API_USERNAME: missing.append("DISCOURSE_API_USERNAME")
                                if not Config.DISCOURSE_CATEGORY_ID: missing.append("DISCOURSE_CATEGORY_ID")
                                if not Config.DISCOURSE_ACTIVE: missing.append("DISCOURSE_ACTIVE (set to False)")
                                logging.warning(f"⚠️ Discourse integration is not fully configured. Missing: {', '.join(missing)}")
                                st.warning(f"Discourse integration is not fully configured. Missing: {', '.join(missing)}")
                        
                        # Create and display welcome message with improved persistence
                        from app.messages import create_user_message, display_welcome_message_ui
                        
                        # Generate welcome message
                        welcome_message = create_user_message(
                            new_username=final_username,
                            temp_password=result.get('temp_password', 'unknown'),
                            discourse_post_url=discourse_post_url,
                            password_reset_successful=result.get('password_reset', False)
                        )
                        
                        # Store the welcome message in session state for persistence
                        st.session_state['welcome_message'] = welcome_message
                        st.session_state['discourse_post_url'] = discourse_post_url
                        
                        # Display the welcome message using direct code block for maximum persistence
                        st.markdown("### 📩 Welcome Message")
                        st.code(welcome_message, language="")
                        
                        # Show forum post link if available (again for after button presses)
                        if st.session_state.get('discourse_post_url'):
                            with st.expander("View Forum Post Link", expanded=True):
                                st.markdown(f"""
                                ### 📝 Forum Post
                                **[View forum post]({st.session_state.get('discourse_post_url')})**
                                """)
                        
                        # Copy button
                        if st.button("Copy Welcome Message to Clipboard", key="copy_welcome"):
                            try:
                                import pyperclip
                                pyperclip.copy(welcome_message)
                                st.success("Welcome message copied to clipboard!")
                            except ImportError:
                                st.warning("Could not copy to clipboard. Please manually copy the message above.")
                        
                        # Add a button to send welcome message if Matrix user is selected
                        if st.session_state.get('matrix_user_selected'):
                            matrix_user = st.session_state.get('matrix_user_display_name', 
                                           st.session_state.get('matrix_user_selected'))
                            
                            # Check if message was already sent in this session
                            message_sent = st.session_state.get('welcome_message_sent', False)
                            
                            if message_sent:
                                # Show the success message if the message was sent
                                st.success(f"Welcome message sent to {matrix_user}!")
                                # Re-display the welcome message that was sent
                                st.markdown("### 📩 Welcome Message (sent)")
                                st.code(welcome_message, language="")
                            else:
                                # Show the send button if message hasn't been sent yet
                                if st.button(f"Send Message to {matrix_user}", key="send_direct"):
                                    try:
                                        from app.utils.matrix_actions import send_direct_message
                                        
                                        # Log the attempt for debugging
                                        logging.info(f"Attempting to send welcome message to {matrix_user}...")
                                        
                                        # Show progress indicator
                                        with st.spinner(f"Sending message to {matrix_user}..."):
                                            # Send the message directly
                                            success = send_direct_message(
                                                st.session_state.get('matrix_user_selected'),
                                                welcome_message
                                            )
                                        
                                        # Mark the message as sent in session state to preserve state
                                        st.session_state['welcome_message_sent'] = success
                                        
                                        if success:
                                            st.success(f"Welcome message sent to {matrix_user}!")
                                            # Re-display the welcome message after sending
                                            st.markdown("### 📩 Welcome Message (sent)")
                                            st.code(welcome_message, language="")
                                        else:
                                            st.error(f"Failed to send welcome message to {matrix_user}")
                                            # Keep current state and don't mark as sent
                                            st.session_state['welcome_message_sent'] = False
                                    except Exception as e:
                                        logging.error(f"Error sending message: {str(e)}")
                                        st.error(f"Error sending welcome message: {str(e)}")
                                        # Keep current state and don't mark as sent
                                        st.session_state['welcome_message_sent'] = False
                        
                        # Add a section to manually connect with Matrix if not already done
                        if not st.session_state.get('matrix_user_id'):
                            st.markdown("---")
                            st.subheader("Connect with Matrix User")
                            st.info(f"User {final_username} has been created! You can now connect them with a Matrix user.")
                            
                            # Button to fetch INDOC users
                            if st.button("Connect with Matrix User", key="connect_matrix_after_create"):
                                # TODO: Implement Matrix user connection
                                # Pseudocode:
                                # 1. Fetch Matrix users from INDOC room
                                # 2. Display dropdown for user selection
                                # 3. Connect selected Matrix user with the created account
                                # 4. Invite user to recommended rooms based on interests
                                st.info("Matrix connection functionality has been simplified for debugging")
                            
                            # Store success flag but DON'T rerun immediately
                            st.session_state['user_created_successfully'] = True
                            # Don't clear form fields yet to allow message to be seen
                            st.session_state['should_clear_form'] = False
                            
                            # No need to rerun - let user see the message with buttons
                        
                        # Store the form data in session state
                        st.session_state['form_submitted'] = True
                        st.session_state['created_username'] = final_username
                        
                        # Force input focus to matrix_user_dropdown if not already selected
                        if not st.session_state.get('matrix_user_selected'):
                            st.info("Please select a Matrix user to connect with this new account from the dropdown below.")
                        
                        # Invite to recommended rooms based on interests if a Matrix user is selected
                        matrix_user_id = st.session_state.get('matrix_user_selected')
                        if matrix_user_id and st.session_state.get('add_to_recommended_rooms', True):
                            # Process interests for room recommendations
                            try:
                                from app.utils.recommendation import invite_user_to_recommended_rooms_sync, get_room_recommendations_sync
                                
                                # Get interests from the form
                                user_interests = interests if interests else ""
                                if not user_interests and organization:
                                    user_interests = organization
                                
                                # Enhance the interests string to include keywords from intro text
                                if intro_text:
                                    user_interests = f"{user_interests}, {intro_text}" if user_interests else intro_text
                                
                                # Log interests for debugging
                                logging.info(f"Getting room recommendations for interests: {user_interests}")
                                
                                # Invite to recommended rooms based on interests
                                if user_interests:
                                    with st.spinner("Inviting user to recommended rooms based on interests..."):
                                        try:
                                            # Get room recommendations with timeout handling
                                            recommended_rooms = get_room_recommendations_sync(matrix_user_id, user_interests)
                                            
                                            if recommended_rooms:
                                                # Use the new bulk invitation function
                                                room_ids = []
                                                for room in recommended_rooms:
                                                    # Try different possible keys for room ID
                                                    room_id = room.get('room_id') or room.get('id')
                                                    if room_id:
                                                        room_ids.append(room_id)
                                                
                                                if room_ids:
                                                    # Log the room IDs for debugging
                                                    logging.info(f"Found {len(room_ids)} room IDs to invite user to: {room_ids}")
                                                    
                                                    # Create a custom async function for room invitations that we can run with run_async_safely
                                                    async def invite_to_rooms_async(user_id, room_ids):
                                                        results = []
                                                        failed_rooms = []
                                                        
                                                        for room_id in room_ids:
                                                            try:
                                                                # Invite to this specific room with timeout
                                                                from app.utils.matrix_actions import invite_to_matrix_room
                                                                success = await invite_to_matrix_room(user_id, room_id)
                                                                
                                                                if success:
                                                                    # Get room name if available
                                                                    from app.utils.matrix_actions import get_room_name_by_id, get_matrix_client
                                                                    client = await get_matrix_client()
                                                                    room_name = await get_room_name_by_id(client, room_id) if client else room_id
                                                                    if client:
                                                                        await client.close()
                                                                    results.append((room_id, room_name or room_id))
                                                                else:
                                                                    failed_rooms.append(room_id)
                                                            except Exception as e:
                                                                logging.error(f"Error inviting to room {room_id}: {str(e)}")
                                                                failed_rooms.append(room_id)
                                                        
                                                        return {
                                                            "success": len(results) > 0,
                                                            "invited_rooms": results,
                                                            "failed_rooms": failed_rooms
                                                        }
                                                    
                                                    # Use run_async_safely to handle event loop properly
                                                    invitation_results = run_async_safely(invite_to_rooms_async, matrix_user_id, room_ids)
                                                    
                                                    # Process results
                                                    if invitation_results and invitation_results.get('success'):
                                                        invited_rooms = invitation_results.get('invited_rooms', [])
                                                        failed_rooms = invitation_results.get('failed_rooms', [])
                                                        
                                                        if invited_rooms:
                                                            st.success(f"Added to {len(invited_rooms)} rooms based on interests!")
                                                            for room_id, room_name in invited_rooms:
                                                                st.info(f"✅ Added to {room_name}")
                                                        
                                                        if failed_rooms:
                                                            st.warning(f"Failed to add to {len(failed_rooms)} rooms. You may need to try again later.")
                                                    else:
                                                        st.warning(f"Room invitations failed: {invitation_results.get('error', 'Unknown error')}")
                                                else:
                                                    st.info("No valid room IDs found in recommendations")
                                                    
                                            else:
                                                st.info("No rooms were recommended based on the user's interests.")
                                        except Exception as e:
                                            # Log the error but continue with user creation process
                                            logging.error(f"Error getting room recommendations: {str(e)}")
                                            st.warning(f"Could not get room recommendations: {str(e)}")
                                else:
                                    logging.info("No interests specified for room recommendations.")
                            except Exception as e:
                                logging.error(f"Error inviting Matrix user to rooms: {str(e)}")
                                st.error("Error inviting to recommended rooms")
            except Exception as e:
                logging.error(f"Error creating user: {str(e)}")
                logging.error(traceback.format_exc())
                st.error(f"An unexpected error occurred: {str(e)}")
            else:
                # Handle failure case
                error_message = result.get('error', 'Unknown error')
                if error_message and "username" in error_message and "unique" in error_message:
                    st.error(f"Failed to create user: Username is not unique. Please try a different username or let the system generate one for you.")
                    # Generate a new username suggestion
                    new_username = generate_username_with_random_word(first_name)
                    st.info(f"Suggested username: {new_username}")
                    # Update the username field
                    st.session_state['username_input'] = new_username
                    st.session_state['username_input_outside'] = new_username
                    st.session_state['username_was_auto_generated'] = True
                elif error_message == 'None' or error_message is None:
                    # This is actually a success case that was misreported
                    st.success(f"User {username} created successfully!")
                    
                    # Set up Matrix connection section
                    st.markdown("---")
                    st.subheader("Connect with Matrix User")
                    st.info(f"You can now connect {username} with a Matrix user.")
                    
                    # Store success flag but DON'T rerun immediately
                    st.session_state['user_created_successfully'] = True
                    # Don't clear form fields yet to allow message to be seen
                    st.session_state['should_clear_form'] = False
                else:
                    st.error(f"Failed to create user: {error_message}")
    
    # Note about required fields
    st.markdown("<div class='help-text'>* Required fields</div>", unsafe_allow_html=True)
    st.markdown("</div>", unsafe_allow_html=True)

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
                            
                            # Copy button
                            if st.button("Copy Invite Link"):
                                st.markdown(f"""
                                <script>
                                    navigator.clipboard.writeText('{invite_link}');
                                    alert('Invite link copied to clipboard!');
                                </script>
                                """, unsafe_allow_html=True)
                        else:
                            st.error(f"Failed to create invite: {result.get('error', 'Unknown error')}")
                    
                    except Exception as e:
                        logging.error(f"Error creating invite: {e}")
                        logging.error(traceback.format_exc())
                        st.error(f"An error occurred: {str(e)}")
    
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
                            except Exception as e:
                                logging.error(f"Error sending invitation email: {e}")
                                logging.error(traceback.format_exc())
                                st.warning(f"Invite created, but failed to send email: {str(e)}")
                                
                                # Display the invite link in case email sending failed
                                st.code(invite_link, language=None)
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
    """Display the list of users with actions."""
    # Get users from database
    users = get_users_from_db()
    
    if not users:
        st.warning("No users found in the database.")
        return
    
    # Convert users to DataFrame for display
    user_data = []
    for user in users:
        user_dict = {
            "Username": user.username,
            "Name": f"{user.first_name} {user.last_name}",
            "Email": user.email,
            "Matrix Username": user.matrix_username or "Not set",
            "Status": "Active" if user.is_active else "Inactive",
            "Admin": "Yes" if user.is_admin else "No",
            "Date Joined": format_date(user.date_joined),
            "Last Login": format_date(user.last_login)
        }
        user_data.append(user_dict)
    
    df = pd.DataFrame(user_data)
    
    # Display the DataFrame
    st.dataframe(df)
    
    # Add action buttons
    st.subheader("User Actions")
    action = st.selectbox(
        "Select Action",
        ["Update Email", "Update Status", "Update Matrix Username", "Delete User"],
        key="user_action"
    )
    
    # Get selected users
    selected_users = st.multiselect(
        "Select Users",
        options=[user.username for user in users],
        key="selected_users"
    )
    
    if selected_users:
        if action == "Update Matrix Username":
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

def format_date(date_obj):
    """Format a date object for display."""
    if date_obj is None or pd.isna(date_obj):
        return ""
    try:
        return date_obj.strftime("%Y-%m-%d %H:%M")
    except (AttributeError, TypeError, ValueError):
        # If it's a string, try to parse it
        if isinstance(date_obj, str):
            try:
                from datetime import datetime
                return datetime.fromisoformat(date_obj.replace('Z', '+00:00')).strftime("%Y-%m-%d %H:%M")
            except (ValueError, AttributeError):
                return date_obj
        return str(date_obj)

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

def get_users_from_db():
    """Get all users from the database."""
    try:
        # Get a database session
        db = next(get_db())
        try:
            # Get users from database
            from app.db.models import User
            users = db.query(User).all()
            return users
        finally:
            db.close()
    except Exception as e:
        st.error(f"Error getting users from database: {str(e)}")
        logging.error(f"Error in get_users_from_db: {str(e)}")
        logging.error(traceback.format_exc())
        return []