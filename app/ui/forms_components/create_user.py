"""
This file will contain the functions that started on forms.py to create users in the main page.
"""

import streamlit as st
import logging
import traceback
import requests
import asyncio
import threading
import time
import random
import re
from datetime import datetime

from app.auth.api import create_user
from app.messages import create_user_message, display_welcome_message_ui
from app.utils.form_helpers import reset_create_user_form_fields, parse_and_rerun
from app.utils.config import Config
from app.db.session import get_db
# Add missing imports for async functions
from app.ui.forms import run_async_safely
from app.utils.matrix_actions import (
    _send_room_message_with_content_async,
    remove_from_matrix_room_async,
    send_welcome_message_with_encryption_delay_sync
)
from app.auth.utils import generate_username_with_random_word


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
    logging.info("Starting form clear operation")
    
    # Clear parse data from session state
    if 'parse_data' in st.session_state:
        del st.session_state.parse_data
    if 'parse_data_input' in st.session_state:
        del st.session_state.parse_data_input
    if 'parse_data_input_outside' in st.session_state:
        del st.session_state.parse_data_input_outside
    
    # Clear preserved parse data field
    if 'preserved_parse_data' in st.session_state:
        del st.session_state.preserved_parse_data
    
    # Clear all parsed data fields
    parsed_keys = [key for key in st.session_state.keys() if key.startswith('_parsed_')]
    for key in parsed_keys:
        del st.session_state[key]
    
    # FIRST: Set all form field values to empty strings to clear the widgets
    # This ensures the widgets display empty values when they're recreated
    form_field_keys = [
        # Internal form field keys (used as default values)
        "username_input",
        "first_name_input",
        "last_name_input", 
        "email_input",
        "invited_by_input",
        "data_to_parse_input",
        "intro_input",
        "intro_text_input",
        "organization_input",
        "interests_input",
        "signal_username_input",
        "phone_number_input",
        "linkedin_username_input",
        # External form field keys (actual widget keys)
        "username_input_outside", 
        "first_name_input_outside",
        "last_name_input_outside",
        "email_input_outside",
        "invited_by_input_outside",
        "intro_input_outside",
        "intro_text_input_outside",
        "organization_input_outside",
        "interests_input_outside",
        "signal_username_input_outside", 
        "phone_number_input_outside",
        "linkedin_username_input_outside",
        "parse_data_input_outside"
    ]
    
    # Set all form fields to empty strings first
    for field in form_field_keys:
        st.session_state[field] = ""
    
    logging.info("Set all form fields to empty strings")
    
    # Clear Matrix user selection
    st.session_state.matrix_user_selected = None
    
    # Clear recommended rooms and selected rooms
    st.session_state.recommended_rooms = []
    if 'selected_rooms' in st.session_state:
        st.session_state.selected_rooms = set()
    
    # Clear group selection - reset to default
    main_group_id = Config.MAIN_GROUP_ID
    st.session_state.selected_groups = [main_group_id] if main_group_id else []
    st.session_state.group_selection = [main_group_id] if main_group_id else []
    
    # Clear admin checkbox
    if 'is_admin_checkbox' in st.session_state:
        st.session_state.is_admin_checkbox = False
    
    # Clear username generation flag
    if 'username_was_auto_generated' in st.session_state:
        st.session_state.username_was_auto_generated = False
    
    # Clear parsing flags
    st.session_state.parsing_successful = False
    
    # Clear welcome message state
    if 'welcome_message_sent' in st.session_state:
        st.session_state.welcome_message_sent = False
    
    # Clear welcome message content
    if 'welcome_message' in st.session_state:
        del st.session_state.welcome_message
    
    # Clear any other form-related flags
    if 'welcome_message_is_placeholder' in st.session_state:
        del st.session_state.welcome_message_is_placeholder
    
    logging.info("Form cleared successfully - set all form fields to empty strings and cleared related state")
    
    # Trigger rerun to update the UI - this is necessary to actually clear the visible fields
    try:
        st.rerun()
    except AttributeError:
        # Fall back to experimental_rerun if rerun is not available
        logging.warning("st.rerun() not available, falling back to st.experimental_rerun()")
        try:
            st.experimental_rerun()
        except AttributeError:
            # If neither rerun method is available, just show success message
            st.success("Form has been cleared successfully! Please refresh the page if fields are still visible.")
            logging.warning("No rerun method available, showing manual refresh message")

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

    # Initialize background task states
    if 'background_tasks_started' not in st.session_state:
        st.session_state['background_tasks_started'] = False
        st.session_state['fetch_indoc_users_started'] = False
        st.session_state['room_recommendations_started'] = False

    # Start concurrent background tasks for Matrix sync and room recommendations
    if not st.session_state.get('background_tasks_started', False):
        try:
            # Mark as started immediately to prevent multiple starts
            st.session_state['background_tasks_started'] = True
            st.session_state['fetch_indoc_users_started'] = True
            st.session_state['fetch_indoc_users_finished'] = False
            
            # Initialize session state variables
            if 'matrix_users' not in st.session_state:
                st.session_state.matrix_users = []
            if 'recommended_rooms' not in st.session_state:
                st.session_state.recommended_rooms = []
            
            import threading
            import concurrent.futures
            
            def concurrent_background_tasks():
                """Run Matrix sync and room recommendations concurrently"""
                try:
                    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                        # Task 1: Fetch Matrix users
                        def fetch_matrix_users():
                            try:
                                from app.services.matrix_cache import matrix_cache
                                
                                db = next(get_db())
                                try:
                                    # Check if cache is fresh, if not trigger lightweight sync
                                    if not matrix_cache.is_cache_fresh(db, max_age_minutes=30):
                                        # Trigger lightweight sync for user creation workflow
                                        import asyncio
                                        try:
                                            loop = asyncio.get_event_loop()
                                            loop.create_task(matrix_cache.lightweight_sync(db, max_age_minutes=30))
                                        except RuntimeError:
                                            # If no event loop, start lightweight sync in thread
                                            def lightweight_sync():
                                                loop = asyncio.new_event_loop()
                                                asyncio.set_event_loop(loop)
                                                try:
                                                    loop.run_until_complete(matrix_cache.lightweight_sync(db, max_age_minutes=30))
                                                finally:
                                                    loop.close()
                                            threading.Thread(target=lightweight_sync, daemon=True).start()
                                    
                                    # Get cached users (fast)
                                    cached_users = matrix_cache.get_cached_users(db)
                                    
                                    # Convert to the expected format
                                    fetched_users = [
                                        {
                                            'user_id': user['user_id'],
                                            'display_name': user['display_name'],
                                            'is_admin': False
                                        }
                                        for user in cached_users
                                    ]
                                    
                                    return fetched_users
                                finally:
                                    db.close()
                            except Exception as e:
                                logging.error(f"Error fetching Matrix users: {str(e)}")
                                return []
                        
                        # Task 2: Pre-warm room recommendations cache
                        def prewarm_room_cache():
                            try:
                                from app.utils.recommendation import get_all_accessible_rooms_with_details
                                import asyncio
                                
                                # Pre-warm the room cache for faster recommendations later
                                loop = asyncio.new_event_loop()
                                asyncio.set_event_loop(loop)
                                try:
                                    # Use shorter timeout for pre-warming
                                    rooms = loop.run_until_complete(
                                        asyncio.wait_for(get_all_accessible_rooms_with_details(), timeout=3.0)
                                    )
                                    logging.info(f"Pre-warmed room cache with {len(rooms) if rooms else 0} rooms")
                                    return rooms or []
                                except asyncio.TimeoutError:
                                    logging.warning("Room cache pre-warming timed out")
                                    return []
                                finally:
                                    loop.close()
                            except Exception as e:
                                logging.error(f"Error pre-warming room cache: {str(e)}")
                                return []
                        
                        # Submit both tasks concurrently
                        matrix_future = executor.submit(fetch_matrix_users)
                        room_future = executor.submit(prewarm_room_cache)
                        
                        # Wait for Matrix users (this is more critical)
                        try:
                            fetched_users = matrix_future.result(timeout=10)
                            st.session_state['indoc_users'] = fetched_users or []
                            st.session_state.matrix_users = fetched_users or []
                            st.session_state['fetch_indoc_users_complete'] = True
                            logging.info(f"Background Matrix user fetch completed. Found {len(fetched_users) if fetched_users else 0} users.")
                        except concurrent.futures.TimeoutError:
                            logging.error("Matrix user fetch timed out")
                            st.session_state['indoc_users'] = []
                            st.session_state.matrix_users = []
                            st.session_state['fetch_indoc_users_error'] = "Matrix sync timed out"
                        
                        # Room pre-warming can complete in background (non-blocking)
                        try:
                            room_future.result(timeout=1)  # Very short timeout, it's just pre-warming
                        except concurrent.futures.TimeoutError:
                            logging.info("Room pre-warming continuing in background")
                        
                except Exception as e:
                    logging.error(f"Error in concurrent background tasks: {str(e)}")
                    st.session_state['fetch_indoc_users_error'] = str(e)
                    st.session_state['indoc_users'] = []
                    st.session_state.matrix_users = []
                finally:
                    st.session_state['fetch_indoc_users_finished'] = True
            
            # Launch concurrent tasks in daemon thread
            thread = threading.Thread(target=concurrent_background_tasks, daemon=True)
            thread.start()
            logging.info("Started concurrent background tasks for Matrix sync and room pre-warming")
                
        except Exception as e:
            logging.error(f"Error starting background tasks: {str(e)}")
            # Fallback: set empty lists
            st.session_state['indoc_users'] = []
            st.session_state.matrix_users = []
    
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

    # Parse Text Data section moved to the top
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
    
    # Parse Data buttons row
    parse_col1, parse_col2 = st.columns([1, 1])
    
    with parse_col1:
        st.markdown("<div class='parse-btn'>", unsafe_allow_html=True)
        if st.button("Parse Data", key="parse_data_button"):
            parse_and_rerun()
        st.markdown("</div>", unsafe_allow_html=True)
        
    with parse_col2:
        st.markdown("<div class='clear-btn'>", unsafe_allow_html=True)
        if st.button("Clear Parse Data", key="clear_parse_data_button"):
            clear_parse_data()
        st.markdown("</div>", unsafe_allow_html=True)
    
    st.markdown("<div class='divider'></div>", unsafe_allow_html=True)
    
    # Add a section to connect with Matrix user from INDOC
    st.subheader("Connect with Matrix User")
    
    # Store current form state before sync to prevent data loss
    def save_form_state():
        return {
            'username': st.session_state.get('username_input', ''),
            'first_name': st.session_state.get('first_name_input', ''),
            'last_name': st.session_state.get('last_name_input', ''),
            'email': st.session_state.get('email_input', ''),
            'selected_matrix_user': st.session_state.get('matrix_user_selected'),
            'manual_matrix_username': st.session_state.get('manual_matrix_username', '')
        }
        
    def restore_form_state(state):
        if state:
            st.session_state['username_input'] = state['username']
            st.session_state['first_name_input'] = state['first_name']
            st.session_state['last_name_input'] = state['last_name']
            st.session_state['email_input'] = state['email']
            st.session_state['matrix_user_selected'] = state['selected_matrix_user']
            # Handle manual Matrix username field
            if 'manual_matrix_username' in state:
                st.session_state['manual_matrix_username'] = state['manual_matrix_username']
    
    # Add a manual sync button to refresh Matrix users cache
    if st.button("🔄 Sync Matrix User Cache", key="manual_sync_matrix_cache"):
        form_state = save_form_state()
        with st.spinner("Syncing Matrix rooms and refreshing user list..."):
            try:
                from app.services.matrix_cache import matrix_cache
                db_sync = next(get_db())
                try:
                    # Perform a full sync of all rooms
                    sync_result = await matrix_cache.full_sync(db_sync, force=True)
                    
                    if sync_result.get("status") == "completed":
                        # Reload users from the welcome room
                        cached_users_after_sync = matrix_cache.get_users_in_room(db_sync, Config.MATRIX_WELCOME_ROOM_ID)
                        logging.info(f"Matrix sync completed. Found {len(cached_users_after_sync)} users in INDOC room")
                        
                        # Update the matrix users list
                        st.session_state.matrix_users = [
                            {'user_id': u['user_id'], 'display_name': u['display_name']}
                            for u in cached_users_after_sync
                        ]
                        
                        # Restore form state
                        restore_form_state(form_state)
                        st.toast("Successfully synced Matrix rooms and updated user list", icon="✅")
                        
                        # Force a rerun to update the dropdown
                        st.rerun()
                    else:
                        st.error(f"Failed to sync Matrix users: {sync_result.get('error', 'Unknown error')}")
                except Exception as e:
                    st.error(f"Error during Matrix sync: {str(e)}")
                    logging.error(f"Error during Matrix sync: {str(e)}", exc_info=True)
                finally:
                    db_sync.close()
            except Exception as e_sync:
                st.error(f"Error during Matrix cache sync: {str(e_sync)}")
                logging.error(f"Error during Matrix cache sync: {str(e_sync)}", exc_info=True)
    
    # Load Matrix users from INDOC room if not already loaded
    if 'matrix_users' not in st.session_state or not st.session_state.matrix_users:
        with st.spinner("Loading Matrix users from INDOC room..."):
            try:
                from app.services.matrix_cache import matrix_cache
                
                db = next(get_db())
                try:
                    welcome_room_id = Config.MATRIX_WELCOME_ROOM_ID
                    if not welcome_room_id:
                        st.warning("MATRIX_WELCOME_ROOM_ID not configured")
                        st.session_state.matrix_users = []
                        return
                    
                    # Check if cache is fresh, if not trigger background sync
                    if not matrix_cache.is_cache_fresh(db, max_age_minutes=30):
                        # Trigger background sync but don't wait for it
                        def bg_sync():
                            try:
                                loop = asyncio.new_event_loop()
                                asyncio.set_event_loop(loop)
                                try:
                                    # Perform a full sync in the background
                                    loop.run_until_complete(matrix_cache.full_sync(db, force=True))
                                    # Reload users from the welcome room after sync
                                    room_members = matrix_cache.get_users_in_room(db, welcome_room_id)
                                    st.session_state.matrix_users = [
                                        {'user_id': user['user_id'], 'display_name': user.get('display_name', user['user_id'].split(':')[0][1:])}
                                        for user in room_members
                                    ]
                                    st.rerun()
                                except Exception as e:
                                    logging.error(f"Background sync error: {e}")
                                finally:
                                    loop.close()
                            except Exception as e:
                                logging.error(f"Background sync thread error: {str(e)}", exc_info=True)
                        
                        # Start the background sync thread
                        thread = threading.Thread(target=bg_sync, daemon=True)
                        thread.start()
                    
                    # Get users from the welcome room
                    room_members = matrix_cache.get_users_in_room(db, welcome_room_id)
                    
                    # Convert to the expected format
                    st.session_state.matrix_users = [
                        {
                            'user_id': user['user_id'],
                            'display_name': user.get('display_name', user['user_id'].split(':')[0][1:])
                        }
                        for user in room_members
                    ]
                    
                    logging.info(f"Loaded {len(st.session_state.matrix_users)} users from INDOC room")
                    
                except Exception as e:
                    logging.error(f"Error loading Matrix users: {str(e)}", exc_info=True)
                    st.session_state.matrix_users = []
                finally:
                    db.close()
            except Exception as e:
                logging.error(f"Error initializing Matrix users: {str(e)}", exc_info=True)
                st.session_state.matrix_users = []
    
    # Display Matrix user selection
    if 'matrix_users' in st.session_state and st.session_state.matrix_users:
        # Ensure matrix_user_selected is initialized
        if 'matrix_user_selected' not in st.session_state:
            st.session_state.matrix_user_selected = None
        if 'matrix_user_display_name' not in st.session_state:
            st.session_state.matrix_user_display_name = None

        # Store previous selection to detect changes
        previous_selection = st.session_state.get('matrix_user_selected')
            
        # Log current state for debugging
        logging.info(f"Before selection - matrix_user_selected: {previous_selection}, welcome_message_sent: {st.session_state.get('welcome_message_sent', False)}")
            
        matrix_user_options = [f"{user['display_name']} ({user['user_id']})" for user in st.session_state.matrix_users]
        selected_user = st.selectbox(
            "Select Matrix User (Bridge User from Signal, Etc)",
            options=[""] + matrix_user_options,
            key="matrix_user_select",
            help="Connect a Matrix account to this user to: 1) Send welcome message directly to them, 2) Automatically remove them from the entry/INDOC chat after account creation, 3) Enable future direct communication and room management"
        )
        
        if selected_user:
            # Extract user_id and display_name from the selected option
            user_id = selected_user.split("(")[-1].rstrip(")")
            display_name = selected_user.split("(")[0].strip()
            
            # Ensure user_id is a valid Matrix ID format
            if not user_id.startswith('@'):
                logging.warning(f"Invalid Matrix user ID format: {user_id}, should start with @")
            
            # Log the selection for debugging
            logging.info(f"Selected Matrix user: {display_name} ({user_id})")
            
            # Always explicitly set both keys for the session state 
            st.session_state['matrix_user_selected'] = user_id
            st.session_state.matrix_user_selected = user_id
            st.session_state['matrix_user_display_name'] = display_name
            st.session_state.matrix_user_display_name = display_name
            
            # If the selection changed (user selected a new Matrix user), 
            # clear prior message state and reset for new auto-sending
            if previous_selection != user_id:
                logging.info(f"Matrix user selection changed from {previous_selection} to {user_id}. Resetting message status.")
                st.session_state.recommended_rooms = []
                # Reset message sending status to allow auto-sending to the newly selected user
                if 'welcome_message_sent' in st.session_state:
                    st.session_state.welcome_message_sent = False
                    
        # Add manual Matrix username input field
        manual_username = st.text_input(
            "Or enter Matrix username manually (e.g., @username:domain.com)",
            key="manual_matrix_username",
            value=st.session_state.get('manual_matrix_username', '')
        )
        
        # Handle manual username entry
        if manual_username:
            # Override dropdown selection with manual input
            logging.info(f"Using manually entered Matrix username: {manual_username}")
            
            # Extract display name from the user ID if possible
            display_name = manual_username.split(':')[0][1:] if manual_username.startswith('@') else manual_username
            
            # Store in session state
            st.session_state.matrix_user_selected = manual_username
            st.session_state.matrix_user_display_name = display_name
            
            # Reset message sending status for new manual user
            if previous_selection != manual_username:
                logging.info(f"Matrix user changed to manual entry: {manual_username}. Resetting message status.")
                st.session_state.recommended_rooms = []
                if 'welcome_message_sent' in st.session_state:
                    st.session_state.welcome_message_sent = False
                if 'welcome_message_status' in st.session_state:
                    del st.session_state['welcome_message_status']
                
                # Explicitly set welcome_message_sent to False for clarity
                st.session_state['welcome_message_sent'] = False
                
                # Force a rerun to trigger the automatic message sending logic
                st.rerun()
            else:
                # If selection didn't change, log current message status
                logging.info(f"Matrix user selection unchanged. Current welcome_message_sent: {st.session_state.get('welcome_message_sent', False)}")
                
                # Check if we should trigger auto-send for existing welcome message
                if (st.session_state.get('welcome_message') and 
                    st.session_state.get('send_matrix_welcome', True) and 
                    not st.session_state.get('welcome_message_sent', False) and
                    not st.session_state.get('welcome_message_is_placeholder', False)):  # Don't auto-send placeholder messages
                    logging.info(f"Setting trigger flag for auto-send to unchanged Matrix user selection")
                    st.session_state['trigger_auto_send'] = True
            
            # Manual trigger button for debugging
            if (st.session_state.get('welcome_message') and 
                not st.session_state.get('welcome_message_sent', False)):
                if st.button(f"🔄 Manually Send Welcome Message to {display_name}", key="manual_send_welcome"):
                    st.session_state['trigger_auto_send'] = True
                    st.rerun()
            
            # Initialize recommended_rooms if it does not exist
            if "recommended_rooms" not in st.session_state:
                st.session_state.recommended_rooms = []
            
            # Store the Matrix username in the database
            try:
                # Import models and database connection at the function level to avoid scope issues
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
                logging.error(f"Error storing Matrix username in database: {str(e)}")
                logging.error(traceback.format_exc())
            
            # Check if there's already a welcome message and auto-send is enabled
            if (st.session_state.get('welcome_message') and 
                st.session_state.get('send_matrix_welcome', True) and 
                not st.session_state.get('welcome_message_sent', False) and
                not st.session_state.get('welcome_message_is_placeholder', False)):  # Don't auto-send placeholder messages
                
                # Also check for manual trigger flag
                should_auto_send = (
                    st.session_state.get('trigger_auto_send', False) or  # Manual trigger
                    previous_selection != user_id  # Selection changed
                )
                
                # Debug logging
                logging.info(f"Auto-send check - welcome_message exists: {bool(st.session_state.get('welcome_message'))}")
                logging.info(f"Auto-send check - send_matrix_welcome: {st.session_state.get('send_matrix_welcome', True)}")
                logging.info(f"Auto-send check - message_sent: {st.session_state.get('welcome_message_sent', False)}")
                logging.info(f"Auto-send check - is_placeholder: {st.session_state.get('welcome_message_is_placeholder', False)}")
                logging.info(f"Auto-send check - should_auto_send: {should_auto_send}")
                logging.info(f"Auto-send check - trigger_auto_send flag: {st.session_state.get('trigger_auto_send', False)}")
                
                if should_auto_send:
                    # Clear the trigger flag
                    if 'trigger_auto_send' in st.session_state:
                        del st.session_state['trigger_auto_send']
                        
                    try:
                        from app.utils.matrix_actions import send_direct_message
                        
                        # Log the attempt for debugging
                        logging.info(f"Auto-sending existing welcome message to {display_name} ({user_id})...")
                        
                        # Show progress indicator
                        with st.spinner(f"Sending welcome message to {display_name} (with encryption setup)..."):
                            # Send the message with encryption delay to ensure readability
                            success, room_id, event_id = send_welcome_message_with_encryption_delay_sync(
                                user_id,
                                st.session_state['welcome_message'],
                                delay_seconds=3  # Shorter delay for auto-send
                            )
                        
                        # Log the result immediately
                        logging.info(f"Auto-send result: success={success}, room_id={room_id}, event_id={event_id}")
                        
                        # Track message status details for verification
                        message_status = {
                            'success': success,
                            'room_id': room_id,
                            'event_id': event_id,
                            'timestamp': datetime.now().isoformat(),
                            'verified': False,
                            'auto_sent': True
                        }
                        
                        # Store message status for verification
                        st.session_state['welcome_message_status'] = message_status
                        
                        # Mark the message as sent in session state to preserve state
                        st.session_state['welcome_message_sent'] = success
                        
                        if success:
                            st.success(f"✅ Welcome message automatically sent to {display_name}!")
                            # Force refresh with rerun to update UI
                            st.rerun()
                        else:
                            st.error(f"❌ Failed to automatically send welcome message to {display_name}")
                            
                    except Exception as e:
                        logging.error(f"Error automatically sending existing welcome message: {str(e)}")
                        logging.error(traceback.format_exc())
                        st.error(f"Error sending welcome message: {str(e)}")
                        # Keep current state and don't mark as sent
                        st.session_state['welcome_message_sent'] = False
            
            # Create a default welcome message if none exists yet (but mark it as placeholder)
            if not st.session_state.get('welcome_message'):
                # Get form field values to create a default welcome message
                username = st.session_state.get('username_input_outside', 'newuser')
                first_name = st.session_state.get('first_name_input_outside', '')
                last_name = st.session_state.get('last_name_input_outside', '')
                
                # Create a basic welcome message template
                default_welcome = f"""
🌟 Welcome to IrregularChat! 🌟

Hello {display_name}!

{f"We're creating an account for {first_name} {last_name}".strip() if first_name or last_name else "We're setting up your account"} with username: {username}

You'll receive your login credentials shortly. Welcome to the community!

If you have any questions, feel free to reach out to the community admins.
"""
                # Store the default welcome message and mark it as placeholder
                st.session_state['welcome_message'] = default_welcome
                st.session_state['welcome_message_is_placeholder'] = True  # Mark as placeholder to prevent auto-send
                logging.info(f"Created placeholder welcome message for Matrix user: {display_name}")
    
    st.markdown("<div class='divider'></div>", unsafe_allow_html=True)
    
    # Get a list of available groups from Authentik for group selection
    groups = []
    
    try:
        # First, check if groups are in session state to avoid extra API calls
        if 'authentik_groups' in st.session_state and st.session_state.get('authentik_groups_timestamp', 0) > (time.time() - 3600):
            # Use cached groups if they're less than an hour old
            groups = st.session_state.authentik_groups
            logging.info("Using cached Authentik groups")
        else:
            # Fetch groups from Authentik with improved error handling
            api_url = f"{Config.AUTHENTIK_API_URL}/core/groups/"
            max_retries = 3
            retry_delay = 2
            
            # Simple session with SSL fallback
            for attempt in range(max_retries):
                try:
                    # Try with SSL verification first
                    response = requests.get(api_url, headers={
                        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
                        'Content-Type': 'application/json'
                    }, timeout=15, verify=False)
                    
                    if response.status_code == 200:
                        groups = response.json().get('results', [])
                        # Cache the groups and timestamp
                        st.session_state.authentik_groups = groups
                        st.session_state.authentik_groups_timestamp = time.time()
                        logging.info(f"Fetched and cached {len(groups)} Authentik groups on attempt {attempt + 1}")
                        break  # Success, exit retry loop
                    else:
                        if attempt == max_retries - 1:  # Last attempt
                            st.error(f"Error fetching groups: {response.status_code}")
                            logging.error(f"Error fetching groups: {response.status_code}")
                        else:
                            logging.warning(f"Attempt {attempt + 1} failed with status {response.status_code}, retrying...")
                            time.sleep(retry_delay)
                            
                except requests.exceptions.SSLError as ssl_err:
                    # SSL error - try without verification
                    logging.warning(f"SSL error on attempt {attempt + 1}, trying without verification: {ssl_err}")
                    try:
                        import urllib3
                        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
                        
                        response = requests.get(api_url, headers={
                            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
                            'Content-Type': 'application/json'
                        }, timeout=15, verify=False)
                        
                        if response.status_code == 200:
                            groups = response.json().get('results', [])
                            st.session_state.authentik_groups = groups
                            st.session_state.authentik_groups_timestamp = time.time()
                            logging.info(f"Fetched groups without SSL verification on attempt {attempt + 1}")
                            st.warning("🔒 Connected using relaxed SSL settings due to server compatibility issues.")
                            break
                        elif attempt == max_retries - 1:
                            st.error("🔒 SSL/TLS connectivity issue. Using cached data if available.")
                            
                    except Exception as fallback_err:
                        if attempt == max_retries - 1:
                            st.error("🔒 Unable to connect to authentication server.")
                            logging.error(f"SSL fallback failed: {fallback_err}")
                        
                except requests.exceptions.ConnectionError as conn_err:
                    error_msg = str(conn_err)
                    if attempt == max_retries - 1:  # Last attempt
                        if "Failed to resolve" in error_msg or "NameResolutionError" in error_msg:
                            st.error("🌐 Cannot resolve sso.irregularchat.com. Check internet connection.")
                        else:
                            st.error("🌐 Connection error. Using cached data if available.")
                        logging.error(f"Connection error: {error_msg}")
                        
                        # Try to use cached data as fallback
                        if 'authentik_groups' in st.session_state:
                            groups = st.session_state.authentik_groups
                            st.info("Using previously cached groups.")
                    else:
                        logging.warning(f"Connection error on attempt {attempt + 1}, retrying...")
                        time.sleep(retry_delay)
                        
                except requests.exceptions.Timeout:
                    if attempt == max_retries - 1:  # Last attempt
                        st.warning("⏱️ Request timeout. Using cached data if available.")
                        if 'authentik_groups' in st.session_state:
                            groups = st.session_state.authentik_groups
                            st.info("Using previously cached groups.")
                    else:
                        logging.warning(f"Timeout on attempt {attempt + 1}, retrying...")
                        time.sleep(retry_delay)
                        
                except Exception as e:
                    if attempt == max_retries - 1:  # Last attempt
                        st.error(f"Unexpected error: {str(e)}")
                        logging.error(f"Unexpected error fetching groups: {str(e)}")
                        # Try to use cached data as fallback
                        if 'authentik_groups' in st.session_state:
                            groups = st.session_state.authentik_groups
                            st.info("Using cached groups due to error.")
                    else:
                        logging.warning(f"Error on attempt {attempt + 1}, retrying...")
                        time.sleep(retry_delay)
                        
            # If we still have no groups after all retries, create a minimal fallback
            if not groups and not st.session_state.get('authentik_groups'):
                logging.warning("No groups available, creating fallback")
                if Config.MAIN_GROUP_ID:
                    groups = [{"pk": Config.MAIN_GROUP_ID, "name": "Default Group"}]
                    st.info("🔧 Using default group configuration.")
                else:
                    groups = []
                    st.warning("⚠️ No groups available. Some features may be limited.")
    
    except Exception as e:
        logging.error(f"Error getting groups: {str(e)}")
        logging.error(traceback.format_exc())
        # Fallback to cached groups or default
        if 'authentik_groups' in st.session_state:
            groups = st.session_state.authentik_groups
            st.info("Using cached groups due to unexpected error.")
        else:
            st.error("Unable to fetch groups. Please refresh the page or contact support if the issue persists.")
            groups = []
    
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
    
    # Continue with the rest of the form fields...
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
    
    # Row 3: Organization and Username
    col1, col2 = st.columns([2, 2])
    
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
    
    # Additional Information heading
    st.markdown("<div class='divider'></div>", unsafe_allow_html=True)
    st.subheader("Additional Information")
    
    # Row 4: Interests and Introduction
    col1, col2 = st.columns([1, 2])
    
    with col1:
        # Interests field - use text_area for better visibility
        if 'interests_input_outside' in st.session_state:
            interests = st.text_area(
                "Interests & Expertise",
                key="interests_input_outside",
                on_change=on_interests_change,
                help="User's interests and areas of expertise for Matrix room recommendations",
                placeholder="AI, Machine Learning, Cybersecurity, RF, Electronic Warfare, Drone Technology, 3D Printing, Fabrication, Business Development, Outdoor Activities, etc.",
                height=100
            )
        else:
            interests = st.text_area(
                "Interests & Expertise",
                value=st.session_state.get('interests_input', ""),
                key="interests_input_outside",
                on_change=on_interests_change,
                help="User's interests and areas of expertise for Matrix room recommendations",
                placeholder="AI, Machine Learning, Cybersecurity, RF, Electronic Warfare, Drone Technology, 3D Printing, Fabrication, Business Development, Outdoor Activities, etc.",
                height=100
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
            "Add to selected Matrix rooms",
            value=True,
            key="add_to_recommended_rooms",
            help="Automatically add the user to Matrix rooms that you select in the recommendations below"
        )
        
        # INDOC room removal option
        auto_remove_from_indoc = getattr(Config, 'AUTO_REMOVE_FROM_INDOC', True)
        if auto_remove_from_indoc:
            skip_indoc_removal = st.checkbox(
                "Skip INDOC room removal",
                value=False,
                key="skip_indoc_removal",
                help="Check this to skip automatic removal from INDOC room after user creation and room invitations"
            )
    
    # Data parsing section
    st.markdown("<div class='divider'></div>", unsafe_allow_html=True)
    
    # Add configured Signal group rooms section
    st.subheader("🏠 Signal Group Rooms")
    st.info("💡 The introduction and interests will be used for intelligent Matrix room recommendations!")
    
    # Initialize selected_rooms if not present
    if 'selected_rooms' not in st.session_state:
        st.session_state.selected_rooms = set()
    
    # Load configured rooms
    if 'configured_rooms' not in st.session_state:
        try:
            configured_rooms = Config.get_configured_rooms()
            st.session_state.configured_rooms = configured_rooms
            logging.info(f"Loaded {len(configured_rooms)} configured rooms")
        except Exception as e:
            logging.error(f"Error loading configured rooms: {e}")
            st.session_state.configured_rooms = []
    
    # Display configured rooms
    if st.session_state.configured_rooms:
        # Add control buttons
        col1, col2, col3, col4 = st.columns([1, 1, 1, 1])
        
        with col1:
            if st.button("📋 Select All", key="select_all_configured"):
                for room in st.session_state.configured_rooms:
                    room_key = f"config_room_{room['room_id']}"
                    st.session_state.selected_rooms.add(room_key)
                st.rerun()
        
        with col2:
            if st.button("❌ Unselect All", key="unselect_all_configured"):
                # Remove all configured room keys
                configured_keys = {f"config_room_{room['room_id']}" for room in st.session_state.configured_rooms}
                st.session_state.selected_rooms = st.session_state.selected_rooms - configured_keys
                st.rerun()
        
        with col3:
            # Smart recommendations button
            if st.button("🧠 Apply Smart Recommendations", key="apply_smart_recommendations"):
                if interests or st.session_state.get('intro_text_input'):
                    # Get smart room selections
                    try:
                        from app.utils.room_recommendations import get_smart_room_selections
                        
                        # Combine content for analysis
                        content_parts = []
                        if st.session_state.get('intro_text_input'):
                            content_parts.append(st.session_state.get('intro_text_input'))
                        if interests:
                            content_parts.append(interests)
                        if st.session_state.get('organization_input'):
                            content_parts.append(st.session_state.get('organization_input'))
                        
                        content = " ".join(content_parts)
                        
                        if content.strip():
                            smart_selections = get_smart_room_selections(content, st.session_state.configured_rooms)
                            
                            # Clear existing configured room selections
                            configured_keys = {f"config_room_{room['room_id']}" for room in st.session_state.configured_rooms}
                            st.session_state.selected_rooms = st.session_state.selected_rooms - configured_keys
                            
                            # Add smart selections
                            for room_id in smart_selections:
                                room_key = f"config_room_{room_id}"
                                st.session_state.selected_rooms.add(room_key)
                            
                            st.success(f"🧠 Applied smart recommendations: {len(smart_selections)} rooms selected")
                            st.rerun()
                        else:
                            st.warning("Please enter some interests or introduction text for smart recommendations")
                    except Exception as e:
                        logging.error(f"Error applying smart recommendations: {e}")
                        st.error("Error applying smart recommendations. Please try manual selection.")
                else:
                    st.warning("Please enter interests or introduction text for smart recommendations")
        
        with col4:
            # Selection counter
            configured_selected = len([k for k in st.session_state.selected_rooms if k.startswith("config_room_")])
            total_configured = len(st.session_state.configured_rooms)
            st.metric("Selected", f"{configured_selected}/{total_configured}")
        
        # Display rooms in columns
        cols = st.columns(2)
        col_idx = 0
        
        for room in st.session_state.configured_rooms:
            with cols[col_idx]:
                room_key = f"config_room_{room['room_id']}"
                is_selected = room_key in st.session_state.selected_rooms
                
                # Check if this room is intelligently recommended
                display_name = room.get('display_name', room.get('name', room['room_id']))
                
                if st.checkbox(
                    display_name,
                    key=room_key,
                    value=is_selected,
                    help=f"Room ID: {room['room_id']}\n{room.get('description', '')}"
                ):
                    st.session_state.selected_rooms.add(room_key)
                else:
                    st.session_state.selected_rooms.discard(room_key)
                
                # Show room description
                if room.get('description'):
                    st.caption(room['description'][:100] + "..." if len(room['description']) > 100 else room['description'])
            
            col_idx = (col_idx + 1) % 2
        
        # Show selection summary
        configured_selected = len([k for k in st.session_state.selected_rooms if k.startswith("config_room_")])
        if configured_selected > 0:
            st.success(f"✅ {configured_selected}/{len(st.session_state.configured_rooms)} Signal group rooms selected")
        
        # Add explanatory text
        st.markdown("""
        <div style="font-size:0.9rem; color:#6c757d; margin-top:10px;">
        🧠 <strong>Smart Recommendations:</strong> The introduction, interests, and organization will be analyzed together to automatically suggest the most relevant Matrix rooms.
        </div>
        """, unsafe_allow_html=True)
    
    else:
        st.warning("No configured Signal group rooms found. Please check your environment configuration.")
    
    # Only show room recommendations section when not in the middle of creating a user
    show_recommendations = not st.session_state.get('user_creation_in_progress', False)
    
    if show_recommendations:
        st.subheader("Room Recommendations for New User")
        
        # Room recommendations based on interests - check that matrix_user_selected exists and is not None
        matrix_user = st.session_state.get('matrix_user_selected')
        
        if matrix_user and interests:
            # Manual recommendation button instead of automatic
            col1, col2 = st.columns([1, 1])
            
            with col1:
                if st.button("🔍 Get Room Recommendations", key="get_recommendations_button", type="secondary"):
                    # Get room recommendations with optimized async approach
                    st.session_state.recommendations_fetching = True
                    st.session_state.recommended_rooms = []
                    
                    with st.spinner("Getting room recommendations based on interests..."):
                        try:
                            import asyncio
                            import concurrent.futures
                            
                            def get_recommendations_fast():
                                """Optimized room recommendation function using cached data"""
                                try:
                                    from app.utils.recommendation import match_interests_with_rooms
                                    
                                    # Use the async function directly with proper event loop management
                                    loop = asyncio.new_event_loop()
                                    asyncio.set_event_loop(loop)
                                    try:
                                        # Use reduced timeout since room cache should be pre-warmed
                                        rooms = loop.run_until_complete(
                                            asyncio.wait_for(match_interests_with_rooms(interests), timeout=3.0)
                                        )
                                        logging.info(f"Fast room recommendations completed: {len(rooms) if rooms else 0} rooms")
                                        return rooms or []
                                    except asyncio.TimeoutError:
                                        logging.warning("Fast room recommendations timed out, using fallback")
                                        return []
                                    finally:
                                        loop.close()
                                except Exception as e:
                                    logging.error(f"Error in fast room recommendations: {str(e)}")
                                    return []
                            
                            # Use ThreadPoolExecutor for better control
                            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                                future = executor.submit(get_recommendations_fast)
                                try:
                                    rooms = future.result(timeout=4.0)  # Reduced from 8 to 4 seconds
                                    st.session_state.recommended_rooms = rooms or []
                                    if rooms:
                                        st.success(f"Found {len(rooms)} recommended rooms based on your interests!")
                                    else:
                                        st.info("No rooms found matching your interests. You can still create the user without room recommendations.")
                                    st.rerun()
                                except concurrent.futures.TimeoutError:
                                    logging.error("Room recommendation timed out")
                                    st.session_state.recommended_rooms = []
                                    st.warning("⏱️ Room recommendation search timed out. This may be due to network issues. You can still create the user without recommendations.")
                                    st.rerun()
                                except Exception as e:
                                    logging.error(f"Error getting room recommendations: {str(e)}")
                                    st.session_state.recommended_rooms = []
                                    st.error(f"❌ Error getting room recommendations: {str(e)}. You can still create the user.")
                                    st.rerun()
                                finally:
                                    st.session_state.recommendations_fetching = False
                        except Exception as e:
                            # Handle any exceptions in the setup process
                            logging.error(f"Error setting up recommendation search: {str(e)}")
                            logging.error(traceback.format_exc())
                            st.session_state.recommended_rooms = []
                            st.session_state.recommendations_fetching = False
                            st.error(f"Failed to start recommendation search: {str(e)}")
            
            with col2:
                if st.button("🗑️ Clear Recommendations", key="clear_recommendations_button"):
                    st.session_state.recommended_rooms = []
                    # Clear selected recommendation rooms
                    recommendation_keys = {k for k in st.session_state.selected_rooms if k.startswith("room_")}
                    st.session_state.selected_rooms = st.session_state.selected_rooms - recommendation_keys
                    st.info("Cleared room recommendations")
                    st.rerun()
        else:
            if not matrix_user:
                st.info("Please select a Matrix user first to get room recommendations.")
            if not interests:
                st.info("Please enter interests to get personalized room recommendations.")
    
    # Display recommended rooms if they exist
    if st.session_state.get('recommended_rooms'):
        st.subheader("Recommended Rooms")
        
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
                
                # Add control buttons for recommended rooms
                rec_col1, rec_col2 = st.columns(2)
                
                with rec_col1:
                    if st.button("✅ Select All Recommended", key="select_all_recommended"):
                        for room in st.session_state.recommended_rooms:
                            room_key = f"room_{room['room_id']}"
                            st.session_state.selected_rooms.add(room_key)
                        st.rerun()
                
                with rec_col2:
                    if st.button("❌ Unselect All Recommended", key="unselect_all_recommended"):
                        # Remove all recommended room keys
                        recommended_keys = {f"room_{room['room_id']}" for room in st.session_state.recommended_rooms}
                        st.session_state.selected_rooms = st.session_state.selected_rooms - recommended_keys
                        st.rerun()
                
                # Show selection summary
                recommended_selected = len([k for k in st.session_state.selected_rooms if k.startswith("room_")])
                if recommended_selected > 0:
                    st.success(f"✅ {recommended_selected}/{len(st.session_state.recommended_rooms)} recommended rooms selected")
        
        except Exception as rec_error:
            # Log error but allow form to continue functioning for user creation
            st.warning("Could not display room recommendations due to an error. You can still create the user.")
            logging.error(f"Error displaying room recommendations: {str(rec_error)}")
            logging.error(traceback.format_exc())
    
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
    if st.session_state.get("search_rooms_button", False) and room_search_query:
        with st.spinner("Searching for rooms..."):
            try:
                # Combine search query with category if selected
                search_terms = room_search_query
                if search_category != "All Categories":
                    search_terms = f"{search_terms}, {search_category}"
                
                # First try to get rooms from database
                search_results = []
                db = next(get_db())
                try:
                    from app.db.models import MatrixRoom
                    # Look for matches in database first
                    search_keywords = [kw.strip().lower() for kw in search_terms.split(',') if kw.strip()]
                    
                    db_rooms = []
                    if search_keywords:
                        for keyword in search_keywords:
                            if len(keyword) > 2:  # Only use keywords with reasonable length
                                # Search in room name, topic, or description
                                matching_rooms = db.query(MatrixRoom).filter(
                                    db.or_(
                                        MatrixRoom.name.ilike(f"%{keyword}%"),
                                        MatrixRoom.topic.ilike(f"%{keyword}%")
                                    )
                                ).all()
                                
                                # Add to results
                                for room in matching_rooms:
                                    if room not in db_rooms:  # Avoid duplicates
                                        db_rooms.append(room)
                    
                    # Format database rooms like recommendation results
                    if db_rooms:
                        search_results = [
                            {
                                'room_id': room.room_id,
                                'name': room.name or room.room_id,
                                'topic': room.topic or "",
                                'description': room.topic or "",
                                'from_database': True
                            }
                            for room in db_rooms
                        ]
                        logging.info(f"Loaded {len(search_results)} rooms from database for search")
                except Exception as db_err:
                    logging.error(f"Error searching rooms in database: {str(db_err)}")
                finally:
                    db.close()
                
                # If we didn't find enough rooms in the database, use the recommendation service
                if len(search_results) < 3:
                    # Use the existing recommendation service as backup
                    from app.utils.recommendation import get_room_recommendations_sync
                    additional_rooms = get_room_recommendations_sync("", search_terms)
                    
                    # Filter out any rooms already in the list
                    existing_ids = {room['room_id'] for room in search_results}
                    new_rooms = [room for room in additional_rooms if room['room_id'] not in existing_ids]
                    
                    # Add new rooms to the list
                    search_results.extend(new_rooms)
                    logging.info(f"Added {len(new_rooms)} additional rooms from recommendation service for search")
                
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
    
    # User Creation and Room Assignment Section
    st.markdown("<div class='divider'></div>", unsafe_allow_html=True)
    st.subheader("👤 Create User & Add to Selected Rooms")
    
    # Show summary of what will happen
    selected_room_count = len(st.session_state.get('selected_rooms', set()))
    matrix_user_selected = st.session_state.get('matrix_user_selected')
    
    if selected_room_count > 0:
        st.info(f"📊 **Summary**: Will create user and add to {selected_room_count} selected rooms")
    else:
        st.warning("⚠️ **Note**: No rooms selected. User will be created but not added to any rooms.")
    
    if not matrix_user_selected:
        st.warning("⚠️ **Important**: Please select a Matrix user above to connect with the new account.")
    
    # Bottom row with Create User button
    col1, col2, col3 = st.columns([1, 1, 1])
    
    with col2:
        st.markdown("<div class='form-section-container'>", unsafe_allow_html=True)
        
        # Show what the button will do
        button_text = "Create User"
        if selected_room_count > 0 and matrix_user_selected:
            button_text = f"🚀 Create User & Add to {selected_room_count} Rooms"
        elif selected_room_count > 0:
            button_text = f"Create User (Select Matrix User First)"
        
        button_disabled = not matrix_user_selected if selected_room_count > 0 else False
        
        if st.button(button_text, key="create_user_button", type="primary", disabled=button_disabled):
            # Set flag to indicate user creation is in progress
            # This will prevent showing recommendations during creation
            st.session_state.user_creation_in_progress = True
    
    # Handle Create User button logic
    if st.session_state.get('create_user_button'):
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
                        # Clear the placeholder flag since this is now a real welcome message
                        st.session_state['welcome_message_is_placeholder'] = False
                        # Reset message sent status to allow auto-sending of the new real message
                        st.session_state['welcome_message_sent'] = False
                        
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
                        
                        # Copy button with unique key
                        if st.button("Copy Welcome Message to Clipboard", key="copy_welcome_after_creation"):
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
                            message_status = st.session_state.get('welcome_message_status', {})
                            
                            # Always display the welcome message content in the UI for visibility
                            st.markdown("### 📩 Welcome Message")
                            st.code(welcome_message, language="")
                            
                            # Copy button - always visible
                            if st.button("Copy Welcome Message to Clipboard", key="copy_welcome_in_form"):
                                try:
                                    import pyperclip
                                    pyperclip.copy(welcome_message)
                                    st.success("Welcome message copied to clipboard!")
                                except ImportError:
                                    st.warning("Could not copy to clipboard. Please manually copy the message above.")
                            
                            # DEBUG - Add logging to understand what's happening with auto-sending
                            logging.info(f"Matrix user: {matrix_user}, message_sent: {message_sent}, send_matrix_welcome: {st.session_state.get('send_matrix_welcome', True)}")
                            
                            # If the send_matrix_welcome checkbox is checked and message hasn't been sent yet,
                            # automatically send the welcome message
                            if st.session_state.get('send_matrix_welcome', True) and not message_sent:
                                try:
                                    # Log the attempt for debugging
                                    logging.info(f"Starting automatic send process to {matrix_user}...")
                                    
                                    # Explicitly log the Matrix user ID we're sending to
                                    matrix_user_id = st.session_state.get('matrix_user_selected')
                                    logging.info(f"Sending to Matrix user ID: {matrix_user_id}")
                                    
                                    # Show progress indicator
                                    with st.spinner(f"Sending welcome message to {matrix_user} (with encryption setup)..."):
                                        # Send the message with encryption delay to ensure readability
                                        success, room_id, event_id = send_welcome_message_with_encryption_delay_sync(
                                            matrix_user_id,
                                            welcome_message,
                                            delay_seconds=2  # Wait 2 seconds for encryption setup
                                        )
                                        
                                        # Log the result immediately
                                        logging.info(f"Auto-send result: success={success}, room_id={room_id}, event_id={event_id}")
                                    
                                    # Track message status details for verification
                                    message_status = {
                                        'success': success,
                                        'room_id': room_id,
                                        'event_id': event_id,
                                        'timestamp': datetime.now().isoformat(),
                                        'verified': False,
                                        'auto_sent': True
                                    }
                                    
                                    # Store message status for verification
                                    st.session_state['welcome_message_status'] = message_status
                                    
                                    # Mark the message as sent in session state to preserve state
                                    st.session_state['welcome_message_sent'] = success
                                except Exception as e:
                                    logging.error(f"Error automatically sending message: {str(e)}")
                                    logging.error(traceback.format_exc())
                                    st.error(f"Error sending welcome message: {str(e)}")
                                    # Keep current state and don't mark as sent
                                    st.session_state['welcome_message_sent'] = False
                            
                            # Message status display section
                            st.markdown("### Message Status")
                            status_col1, status_col2 = st.columns([1, 1])
                            
                            with status_col1:
                                if message_sent:
                                    # Show the success message if the message was sent
                                    # Include delivery verification information if available
                                    room_id = message_status.get('room_id')
                                    event_id = message_status.get('event_id')
                                    
                                    st.success(f"✅ Message sent to Matrix user!")
                                    
                                    # Add verification status if available
                                    if message_status.get('verified'):
                                        st.success("✅ Message delivery confirmed!")
                                    elif room_id and event_id:
                                        # Add a verification button
                                        if st.button("Verify Delivery", key="verify_delivery_status"):
                                            try:
                                                from app.utils.matrix_actions import verify_direct_message_delivery_sync
                                                verified = verify_direct_message_delivery_sync(room_id, event_id)
                                                
                                                if verified:
                                                    st.success("✅ Message delivery confirmed!")
                                                    # Update session state
                                                    message_status['verified'] = True
                                                    st.session_state['welcome_message_status'] = message_status
                                                else:
                                                    st.warning("⚠️ Could not verify message delivery. The user might not have received it.")
                                                    
                                            except Exception as e:
                                                logging.error(f"Error verifying message delivery: {str(e)}")
                                                st.error(f"Error verifying delivery: {str(e)}")
                                else:
                                    st.info("📤 Message not yet sent to Matrix user")
                            
                            with status_col2:
                                # Always show a send/resend button
                                button_text = "Resend Message" if message_sent else f"Send Message to {matrix_user}"
                                button_key = "resend_direct_button" if message_sent else "send_direct_button"
                                
                                send_btn = st.button(button_text, key=button_key)
                                if send_btn:
                                    try:
                                        # Log the attempt for debugging
                                        logging.info(f"Manually sending welcome message to {matrix_user}...")
                                        
                                        # Show progress indicator
                                        with st.spinner(f"Sending message to {matrix_user} (with encryption setup)..."):
                                            # Send the message with encryption delay to ensure readability
                                            success, room_id, event_id = send_welcome_message_with_encryption_delay_sync(
                                                st.session_state.get('matrix_user_selected'),
                                                welcome_message,
                                                delay_seconds=2  # Wait 2 seconds for encryption setup
                                            )
                                        
                                        # Track message status details for verification
                                        message_status = {
                                            'success': success,
                                            'room_id': room_id,
                                            'event_id': event_id,
                                            'timestamp': datetime.now().isoformat(),
                                            'verified': False,
                                            'auto_sent': False
                                        }
                                        
                                        # Store message status for verification
                                        st.session_state['welcome_message_status'] = message_status
                                        
                                        # Mark the message as sent in session state to preserve state
                                        st.session_state['welcome_message_sent'] = success
                                        
                                        if success:
                                            st.success(f"Welcome message sent to {matrix_user}!")
                                            # Force refresh with rerun to update UI
                                            st.rerun()
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
                            # Process selected rooms from both configured and recommended rooms
                            try:
                                selected_room_ids = []
                                
                                # Check configured rooms (from config system)
                                if 'configured_rooms' in st.session_state and st.session_state.configured_rooms:
                                    for room in st.session_state.configured_rooms:
                                        room_key = f"config_room_{room['room_id']}"
                                        if room_key in st.session_state.get('selected_rooms', set()):
                                            selected_room_ids.append(room['room_id'])
                                            logging.info(f"Found selected configured room: {room['room_id']}")
                                
                                # Check recommended rooms (from interest-based system)
                                if 'recommended_rooms' in st.session_state and st.session_state.recommended_rooms:
                                    for room in st.session_state.recommended_rooms:
                                        room_key = f"room_{room['room_id']}"
                                        if room_key in st.session_state.get('selected_rooms', set()):
                                            selected_room_ids.append(room['room_id'])
                                            logging.info(f"Found selected recommended room: {room['room_id']}")
                                
                                # Remove duplicates
                                selected_room_ids = list(set(selected_room_ids))
                                
                                if selected_room_ids:
                                    # Log the selected room IDs for debugging
                                    logging.info(f"Found {len(selected_room_ids)} selected room IDs to invite user to: {selected_room_ids}")
                                    
                                    with st.spinner("Inviting user to selected rooms..."):
                                        try:
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
                                            invitation_results = run_async_safely(invite_to_rooms_async, matrix_user_id, selected_room_ids)
                                            
                                            # Process results
                                            if invitation_results and invitation_results.get('success'):
                                                invited_rooms = invitation_results.get('invited_rooms', [])
                                                failed_rooms = invitation_results.get('failed_rooms', [])
                                                
                                                if invited_rooms:
                                                    st.success(f"Added to {len(invited_rooms)} selected rooms!")
                                                    for room_id, room_name in invited_rooms:
                                                        st.info(f"✅ Added to {room_name}")
                                                
                                                if failed_rooms:
                                                    st.warning(f"Failed to add to {len(failed_rooms)} rooms. You may need to try again later.")
                                            else:
                                                st.warning(f"Room invitations failed: {invitation_results.get('error', 'Unknown error')}")
                                        except Exception as e:
                                            # Log the error but continue with user creation process
                                            logging.error(f"Error inviting to selected rooms: {str(e)}")
                                            st.warning(f"Could not invite to selected rooms: {str(e)}")
                                else:
                                    st.info("No rooms were selected. User was not added to any rooms automatically.")
                                    logging.info("No rooms selected for automatic invitation.")
                            except Exception as e:
                                logging.error(f"Error processing selected rooms for Matrix user: {str(e)}")
                                st.error("Error processing room selections")
                        
                        # INDOC Room Removal Process - moved outside room invitation logic
                        # This should happen regardless of whether rooms were selected or not
                        if matrix_user_id:
                            # Check if auto-removal is enabled (default: True)
                            auto_remove_from_indoc = getattr(Config, 'AUTO_REMOVE_FROM_INDOC', True)
                            skip_indoc_removal = st.session_state.get('skip_indoc_removal', False)
                            
                            # Log INDOC removal decision process
                            logging.info(f"=== INDOC REMOVAL DECISION PROCESS ===")
                            logging.info(f"AUTO_REMOVE_FROM_INDOC config: {auto_remove_from_indoc}")
                            logging.info(f"skip_indoc_removal (admin choice): {skip_indoc_removal}")
                            logging.info(f"Should proceed with INDOC removal: {auto_remove_from_indoc and not skip_indoc_removal}")
                            
                            if auto_remove_from_indoc and not skip_indoc_removal:
                                entrance_room_id = Config.MATRIX_WELCOME_ROOM_ID
                                logging.info(f"INDOC room ID from config: {entrance_room_id}")
                                logging.info(f"Matrix user ID from session: {matrix_user_id}")
                                
                                if entrance_room_id and matrix_user_id:
                                    try:
                                        # Get display name for the user
                                        display_name = matrix_user_id.split(":")[0].lstrip("@") if ":" in matrix_user_id else matrix_user_id.lstrip("@")
                                        
                                        # Try to get actual display name from Matrix cache
                                        try:
                                            from app.services.matrix_cache import matrix_cache
                                            db = next(get_db())
                                            try:
                                                cached_users = matrix_cache.get_cached_users(db)
                                                for cached_user in cached_users:
                                                    if cached_user.get('user_id') == matrix_user_id:
                                                        display_name = cached_user.get('display_name', display_name)
                                                        break
                                            finally:
                                                db.close()
                                        except Exception as e:
                                            logging.warning(f"Could not get display name from cache: {e}")
                                        
                                        # Define INDOC graduation message template (plain text version)
                                        graduation_template = """@USER Good to go. Thanks for verifying. This is how we keep the community safe.
                                        
1. Please leave this chat

2. You'll receive a direct message with your IrregularChat Login and a Link to all the chats.

3. Join all the Chats that interest you when you get your login

4. Until then, Learn about the community https://irregularpedia.org/index.php/Main_Page

See you out there!"""

                                        # Define HTML version of the template with proper formatting
                                        graduation_template_html = """@USER Good to go. Thanks for verifying. This is how we keep the community safe.<br><br>
1. Please leave this chat<br><br>
2. You'll receive a direct message with your IrregularChat Login and a Link to all the chats.<br><br>
3. Join all the Chats that interest you when you get your login<br><br>
4. Until then, Learn about the community <a href="https://irregularpedia.org/index.php/Main_Page">https://irregularpedia.org/index.php/Main_Page</a><br><br>
See you out there!"""
                                        
                                        # Create HTML mention link for the user
                                        mention_html = f'<a href="https://matrix.to/#/{matrix_user_id}" data-mention-type="user">@{display_name}</a>'
                                        
                                        # Create personalized messages with proper HTML formatting
                                        personalized_message = graduation_template_html.replace("@USER", mention_html)
                                        plain_text_body = graduation_template.replace("@USER", f"@{display_name}")
                                        
                                        # Create message content with HTML formatting
                                        message_content = {
                                            "msgtype": "m.text",
                                            "body": plain_text_body,  # Plain text fallback
                                            "format": "org.matrix.custom.html",
                                            "formatted_body": personalized_message
                                        }
                                        
                                        # Log the INDOC removal process start
                                        logging.info(f"=== INDOC REMOVAL PROCESS STARTED ===")
                                        logging.info(f"User: {matrix_user_id} (display: {display_name})")
                                        logging.info(f"INDOC Room ID: {entrance_room_id}")
                                        logging.info(f"Message content: {message_content}")
                                        
                                        with st.spinner("Sending INDOC graduation message..."):
                                            # Send INDOC graduation message to room
                                            logging.info(f"Attempting to send INDOC graduation message to room {entrance_room_id}")
                                            message_success = run_async_safely(_send_room_message_with_content_async, entrance_room_id, message_content)
                                            
                                            if message_success:
                                                st.info(f"📤 INDOC graduation message sent to room for {display_name}")
                                                logging.info(f"✅ SUCCESS: INDOC graduation message sent to room for user {matrix_user_id}")
                                                logging.info(f"Message body: {plain_text_body}")
                                                logging.info(f"HTML formatted body: {personalized_message}")
                                            else:
                                                st.warning(f"⚠️ Failed to send INDOC graduation message to room for {display_name}")
                                                logging.error(f"❌ FAILED: Could not send INDOC graduation message to room for user {matrix_user_id}")
                                                logging.error(f"Room ID: {entrance_room_id}")
                                                logging.error(f"Message content that failed: {message_content}")
                                        
                                        with st.spinner("Removing user from INDOC room..."):
                                            # Remove user from INDOC room
                                            logging.info(f"Attempting to remove user {matrix_user_id} from INDOC room {entrance_room_id}")
                                            removal_success = run_async_safely(remove_from_matrix_room_async, entrance_room_id, matrix_user_id, "User graduated from verification to full community access")
                                            
                                            if removal_success:
                                                st.success(f"🎓 {display_name} successfully graduated from INDOC room!")
                                                logging.info(f"✅ SUCCESS: User {matrix_user_id} successfully removed from INDOC room {entrance_room_id}")
                                                logging.info(f"Removal reason: User graduated from verification to full community access")
                                            else:
                                                st.warning(f"⚠️ Failed to remove {display_name} from INDOC room. They may need to leave manually.")
                                                logging.error(f"❌ FAILED: Could not remove user {matrix_user_id} from INDOC room {entrance_room_id}")
                                                logging.error(f"User may still be in INDOC room and need to leave manually")
                                        
                                        logging.info(f"=== INDOC REMOVAL PROCESS COMPLETED ===")
                                        logging.info(f"Message success: {message_success}, Removal success: {removal_success}")
                                        
                                    except Exception as indoc_error:
                                        logging.error(f"Error during INDOC room removal process: {indoc_error}")
                                        st.warning(f"⚠️ Error during INDOC graduation process: {str(indoc_error)}")
                                else:
                                    logging.warning("=== INDOC REMOVAL SKIPPED - MISSING REQUIREMENTS ===")
                                    if not entrance_room_id:
                                        logging.warning("❌ MATRIX_WELCOME_ROOM_ID not configured, skipping INDOC removal")
                                        st.warning("⚠️ INDOC room removal skipped: MATRIX_WELCOME_ROOM_ID not configured")
                                    if not matrix_user_id:
                                        logging.warning("❌ No Matrix user ID available, skipping INDOC removal")
                                        st.warning("⚠️ INDOC room removal skipped: No Matrix user selected")
                            else:
                                logging.info("=== INDOC REMOVAL SKIPPED - DISABLED ===")
                                if not auto_remove_from_indoc:
                                    logging.info("❌ INDOC room removal disabled by configuration (AUTO_REMOVE_FROM_INDOC=False)")
                                    st.info("ℹ️ INDOC room removal disabled by configuration")
                                if skip_indoc_removal:
                                    logging.info("❌ INDOC room removal skipped by admin choice")
                                    st.info("ℹ️ INDOC room removal skipped by admin choice")
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
                    # User creation is no longer in progress
                    st.session_state['user_creation_in_progress'] = False
                    
                    # Now that the user is created, load room recommendations from the database first
                    try:
                        # If we have interests, try to load recommendations after user creation
                        if interests:
                            st.session_state.recommended_rooms = []
                            with st.spinner("Loading room recommendations..."):
                                # First try to get rooms from database
                                db = next(get_db())
                                try:
                                    from app.db.models import MatrixRoom
                                    # Query rooms from database that match interests keywords
                                    interest_keywords = [kw.strip().lower() for kw in interests.split(',') if kw.strip()]
                                    
                                    db_rooms = []
                                    if interest_keywords:
                                        for keyword in interest_keywords:
                                            if len(keyword) > 3:  # Only use keywords with reasonable length
                                                # Search in room name, topic, or description
                                                matching_rooms = db.query(MatrixRoom).filter(
                                                    db.or_(
                                                        MatrixRoom.name.ilike(f"%{keyword}%"),
                                                        MatrixRoom.topic.ilike(f"%{keyword}%")
                                                    )
                                                ).all()
                                                
                                                # Convert to dict format for recommendations
                                                for room in matching_rooms:
                                                    if room not in db_rooms:  # Avoid duplicates
                                                        db_rooms.append(room)
                                    
                                    # Format database rooms like recommendation results
                                    if db_rooms:
                                        st.session_state.recommended_rooms = [
                                            {
                                                'room_id': room.room_id,
                                                'name': room.name or room.room_id,
                                                'topic': room.topic or "",
                                                'description': room.topic or "",
                                                'from_database': True
                                            }
                                            for room in db_rooms
                                        ]
                                        logging.info(f"Loaded {len(st.session_state.recommended_rooms)} rooms from database")
                                except Exception as db_err:
                                    logging.error(f"Error loading rooms from database: {str(db_err)}")
                                finally:
                                    db.close()
                                    
                                # If we didn't find enough rooms in the database, use the recommendation service
                                if len(st.session_state.recommended_rooms) < 3:
                                    # Use the existing async recommendation logic for backup
                                    from app.utils.recommendation import get_room_recommendations_sync
                                    additional_rooms = get_room_recommendations_sync(matrix_user, interests)
                                    
                                    # Filter out any rooms already in the list
                                    existing_ids = {room['room_id'] for room in st.session_state.recommended_rooms}
                                    new_rooms = [room for room in additional_rooms if room['room_id'] not in existing_ids]
                                    
                                    # Add new rooms to the list
                                    st.session_state.recommended_rooms.extend(new_rooms)
                                    logging.info(f"Added {len(new_rooms)} additional rooms from recommendation service")
                            
                            # Force a rerun to display the recommendations
                            st.experimental_rerun()
                    except Exception as rec_err:
                        logging.error(f"Error loading recommendations after user creation: {str(rec_err)}")
                        # Non-blocking error, we can continue without recommendations
                else:
                    st.error(f"Failed to create user: {error_message}")
    
    # Note about required fields
    st.markdown("<div class='help-text'>* Required fields</div>", unsafe_allow_html=True)
    st.markdown("</div>", unsafe_allow_html=True)
    
    # Add manual "Add to Rooms" functionality
    st.markdown("<div class='divider'></div>", unsafe_allow_html=True)
    st.subheader("🏠 Manual Room Management")
    st.info("Use this section to manually add any Matrix user to selected rooms, regardless of the user creation process.")
    
    # Matrix user selection for manual room management
    col1, col2 = st.columns([2, 1])
    
    with col1:
        # Get Matrix users for manual selection
        matrix_users_for_manual = st.session_state.get('matrix_users_dict', {})
        
        if matrix_users_for_manual:
            # Create options for manual user selection
            manual_user_options = ["Select a Matrix user..."] + [
                f"{user_data.get('display_name', user_id)} ({user_id})" 
                for user_id, user_data in matrix_users_for_manual.items()
            ]
            
            manual_selected_user = st.selectbox(
                "Select Matrix User to Add to Rooms",
                options=manual_user_options,
                key="manual_user_selection",
                help="Select a Matrix user to add to rooms"
            )
            
            # Extract user ID from selection
            manual_matrix_user_id = None
            if manual_selected_user != "Select a Matrix user...":
                # Extract user ID from the display format
                manual_matrix_user_id = manual_selected_user.split(" (")[-1].rstrip(")")
                st.info(f"Selected: {manual_selected_user}")
        else:
            st.warning("No Matrix users available. Please wait for the user list to load.")
            manual_matrix_user_id = None
    
    with col2:
        if st.button("🔄 Refresh User List", key="refresh_manual_users"):
            # Clear cached users to force refresh
            if 'matrix_users_dict' in st.session_state:
                del st.session_state['matrix_users_dict']
            if 'matrix_users_fetched' in st.session_state:
                del st.session_state['matrix_users_fetched']
            st.rerun()
    
    # Room selection for manual management
    if manual_matrix_user_id:
        st.markdown("#### Select Rooms to Add User To")
        
        # Get available rooms (both configured and cached)
        available_rooms = []
        
        # Add configured rooms
        if 'configured_rooms' in st.session_state:
            for room in st.session_state.configured_rooms:
                available_rooms.append({
                    'room_id': room['room_id'],
                    'name': room.get('name', room['room_id']),
                    'description': room.get('description', ''),
                    'source': 'configured'
                })
        
        # Add cached rooms from database
        try:
            db = next(get_db())
            try:
                from app.db.models import MatrixRoom
                cached_rooms = db.query(MatrixRoom).filter(MatrixRoom.member_count >= 5).all()
                for room in cached_rooms:
                    # Avoid duplicates
                    if not any(r['room_id'] == room.room_id for r in available_rooms):
                        available_rooms.append({
                            'room_id': room.room_id,
                            'name': room.name or room.room_id,
                            'description': room.topic or '',
                            'source': 'cached'
                        })
            finally:
                db.close()
        except Exception as e:
            logging.error(f"Error loading cached rooms: {e}")
        
        if available_rooms:
            # Initialize manual room selection
            if 'manual_selected_rooms' not in st.session_state:
                st.session_state.manual_selected_rooms = set()
            
            # Add room selection controls
            col1, col2, col3 = st.columns([1, 1, 1])
            
            with col1:
                if st.button("📋 Select All Rooms", key="select_all_manual_rooms"):
                    for room in available_rooms:
                        st.session_state.manual_selected_rooms.add(room['room_id'])
                    st.rerun()
            
            with col2:
                if st.button("❌ Unselect All Rooms", key="unselect_all_manual_rooms"):
                    st.session_state.manual_selected_rooms.clear()
                    st.rerun()
            
            with col3:
                manual_selected_count = len(st.session_state.manual_selected_rooms)
                st.metric("Selected Rooms", manual_selected_count)
            
            # Display rooms in columns
            cols = st.columns(2)
            col_idx = 0
            
            for room in available_rooms:
                with cols[col_idx]:
                    room_key = room['room_id']
                    is_selected = room_key in st.session_state.manual_selected_rooms
                    
                    source_indicator = "⚙️" if room['source'] == 'configured' else "💾"
                    display_name = f"{source_indicator} {room['name']}"
                    
                    if st.checkbox(
                        display_name,
                        key=f"manual_room_{room_key}",
                        value=is_selected,
                        help=f"Source: {room['source']}\n{room['description']}"
                    ):
                        st.session_state.manual_selected_rooms.add(room_key)
                    else:
                        st.session_state.manual_selected_rooms.discard(room_key)
                    
                    if room['description']:
                        st.caption(room['description'][:100] + "..." if len(room['description']) > 100 else room['description'])
                
                col_idx = (col_idx + 1) % 2
            
            # Add user to selected rooms button
            if st.session_state.manual_selected_rooms:
                st.markdown("---")
                
                selected_room_list = [room for room in available_rooms if room['room_id'] in st.session_state.manual_selected_rooms]
                
                st.write(f"**Ready to add {manual_selected_user.split(' (')[0]} to {len(selected_room_list)} rooms:**")
                for room in selected_room_list[:5]:  # Show first 5
                    st.write(f"• {room['name']}")
                if len(selected_room_list) > 5:
                    st.write(f"• ... and {len(selected_room_list) - 5} more rooms")
                
                if st.button("🏠 Add User to Selected Rooms", key="manual_add_to_rooms", type="primary"):
                    selected_room_ids = list(st.session_state.manual_selected_rooms)
                    
                    with st.spinner(f"Adding {manual_selected_user.split(' (')[0]} to {len(selected_room_ids)} rooms..."):
                        try:
                            # Use the same async function as the automatic invitation
                            async def manual_invite_to_rooms_async(user_id, room_ids):
                                results = []
                                failed_rooms = []
                                
                                for room_id in room_ids:
                                    try:
                                        from app.utils.matrix_actions import invite_to_matrix_room
                                        success = await invite_to_matrix_room(user_id, room_id)
                                        
                                        if success:
                                            # Get room name if available
                                            room_name = next((r['name'] for r in available_rooms if r['room_id'] == room_id), room_id)
                                            results.append((room_id, room_name))
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
                            
                            # Execute the invitations
                            invitation_results = run_async_safely(manual_invite_to_rooms_async, manual_matrix_user_id, selected_room_ids)
                            
                            # Process results
                            if invitation_results and invitation_results.get('success'):
                                invited_rooms = invitation_results.get('invited_rooms', [])
                                failed_rooms = invitation_results.get('failed_rooms', [])
                                
                                if invited_rooms:
                                    st.success(f"✅ Successfully added {manual_selected_user.split(' (')[0]} to {len(invited_rooms)} rooms!")
                                    with st.expander("View Added Rooms", expanded=True):
                                        for room_id, room_name in invited_rooms:
                                            st.info(f"✅ {room_name}")
                                
                                if failed_rooms:
                                    st.warning(f"⚠️ Failed to add to {len(failed_rooms)} rooms:")
                                    with st.expander("View Failed Rooms"):
                                        for room_id in failed_rooms:
                                            room_name = next((r['name'] for r in available_rooms if r['room_id'] == room_id), room_id)
                                            st.error(f"❌ {room_name}")
                                
                                # Clear selection after successful operation
                                st.session_state.manual_selected_rooms.clear()
                                st.info("Room selection cleared. You can select new rooms for another user.")
                            else:
                                st.error(f"❌ Failed to add user to rooms: {invitation_results.get('error', 'Unknown error')}")
                        except Exception as e:
                            logging.error(f"Error in manual room addition: {str(e)}")
                            st.error(f"❌ Error adding user to rooms: {str(e)}")
            else:
                st.info("Select rooms above to add the user to them.")
        else:
            st.warning("No rooms available. Please wait for room data to load or check system configuration.")
    else:
        st.info("Select a Matrix user above to manage their room memberships.")
