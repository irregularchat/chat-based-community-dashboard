# app/pages/settings.py
import streamlit as st
import os
import json
import logging
import asyncio
import threading
import time
from datetime import datetime
from typing import Dict, List, Any, Optional
from dotenv import load_dotenv, set_key
from app.utils.config import Config
from app.utils.matrix_actions import (
    get_all_accessible_rooms_sync,
    invite_to_matrix_room,
    send_direct_message,
    send_room_message,
    send_matrix_message_async,
    announce_new_user_async,
    merge_room_data
)
# Import the modules for the new tabs
from app.ui.summary import main as render_summary_page
from app.ui.help_resources import main as render_help_page
from app.ui.prompts import main as render_prompts_page, get_all_prompts
from app.ui.common import display_useful_links, display_login_button
from app.db.session import get_db
from app.db.operations import search_users
from app.auth.api import create_user, create_invite, shorten_url

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Determine the absolute path to the root directory
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../'))

# Path to the .env file - check both Docker and local paths
ENV_PATH = os.path.join(ROOT_DIR, '.env')
DOCKER_ENV_PATH = '/app/.env'  # Path in Docker container

def save_env_variable(key: str, value: str) -> bool:
    """
    Save a variable to the .env file.
    
    Args:
        key: The environment variable key
        value: The value to set
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Get the absolute path to the .env file
        # First try the Docker path
        if os.path.exists(DOCKER_ENV_PATH) and os.access(DOCKER_ENV_PATH, os.W_OK):
            env_path = DOCKER_ENV_PATH
            logging.info(f"Using Docker .env path: {env_path}")
        # Then try the local path
        elif os.path.exists(ENV_PATH) and os.access(ENV_PATH, os.W_OK):
            env_path = ENV_PATH
            logging.info(f"Using local .env path: {env_path}")
        # If neither exists, try to find it relative to the current directory
        else:
            env_path = os.path.join(os.getcwd(), '.env')
            logging.info(f"Trying current directory: {env_path}")
            
            # If that still doesn't exist, try to find it relative to the parent directory
            if not os.path.exists(env_path):
                env_path = os.path.join(os.path.dirname(os.getcwd()), '.env')
                logging.info(f"Trying parent directory: {env_path}")
        
        # Log the path we're using
        logging.info(f"Using .env path: {env_path}")
        
        # Check if the file exists and is writable
        if os.path.exists(env_path):
            if not os.access(env_path, os.W_OK):
                logging.error(f".env file exists but is not writable: {env_path}")
                st.error(f".env file exists but is not writable: {env_path}")
                return False
            
            with open(env_path, 'r') as f:
                lines = f.readlines()
        else:
            logging.warning(f".env file does not exist, creating new file: {env_path}")
            # Try to create the file
            try:
                with open(env_path, 'w') as f:
                    f.write("# Environment variables\n")
                lines = ["# Environment variables\n"]
            except Exception as e:
                logging.error(f"Failed to create .env file: {e}")
                st.error(f"Failed to create .env file: {e}")
                return False
        
        # Check if the key already exists
        key_exists = False
        for i, line in enumerate(lines):
            if line.strip().startswith(f"{key}="):
                lines[i] = f"{key}={value}\n"
                key_exists = True
                break
        
        # If the key doesn't exist, add it
        if not key_exists:
            lines.append(f"{key}={value}\n")
        
        # Write the updated .env file
        try:
            with open(env_path, 'w') as f:
                f.writelines(lines)
            logging.info(f"Successfully wrote {key} to .env file")
        except PermissionError:
            logging.error(f"Permission denied when writing to .env file: {env_path}")
            st.error(f"Permission denied when writing to .env file. Please check file permissions.")
            return False
        except Exception as e:
            logging.error(f"Error writing to .env file: {e}")
            st.error(f"Error writing to .env file: {e}")
            return False
        
        # Also update the environment variable in memory
        os.environ[key] = value
        
        # Try to use python-dotenv's set_key function as a backup method
        try:
            set_key(env_path, key, value)
            logging.info(f"Also set {key} using dotenv.set_key")
        except Exception as e:
            logging.warning(f"Could not use dotenv.set_key to set {key}: {e}")
        
        return True
    except Exception as e:
        logging.error(f"Error saving environment variable {key}: {e}")
        st.error(f"Error saving setting: {e}")
        return False

def save_matrix_rooms(rooms_data):
    """
    Save the matrix rooms data to a JSON file.
    
    Args:
        rooms_data (list): List of room data dictionaries
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Create the data directory if it doesn't exist
        data_dir = os.path.join(ROOT_DIR, 'data')
        if not os.path.exists(data_dir):
            os.makedirs(data_dir)
        
        # Save the rooms data to a JSON file
        rooms_file = os.path.join(data_dir, 'matrix_rooms.json')
        with open(rooms_file, 'w') as f:
            json.dump(rooms_data, f, indent=2)
        
        logging.info(f"Successfully saved matrix rooms data to {rooms_file}")
        return True
    except Exception as e:
        logging.error(f"Error saving matrix rooms data: {e}")
        return False

def save_welcome_messages(messages: Dict[str, str]) -> bool:
    """
    Save welcome messages to a JSON file.
    
    Args:
        messages: Dictionary of message templates
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Create the data directory path
        data_dir = os.path.join(os.getcwd(), 'app', 'data')
        messages_path = os.path.join(data_dir, 'welcome_messages.json')
        
        # Log what we're about to do
        logging.info(f"Saving welcome messages to {messages_path}")
        
        # Make sure the directory exists
        try:
            os.makedirs(data_dir, exist_ok=True)
            logging.info(f"Ensured data directory exists: {data_dir}")
        except Exception as e:
            logging.error(f"Failed to create data directory: {e}")
            st.error(f"Failed to create data directory: {e}")
            return False
        
        # Write the messages to the file
        try:
            with open(messages_path, 'w') as f:
                json.dump(messages, f, indent=2)
            logging.info("Successfully saved welcome messages")
            return True
        except PermissionError:
            logging.error(f"Permission denied when writing to welcome messages file: {messages_path}")
            st.error("Permission denied when saving welcome messages")
            return False
        except Exception as e:
            logging.error(f"Error writing to welcome messages file: {e}")
            st.error(f"Error saving welcome messages: {e}")
            return False
    except Exception as e:
        logging.error(f"Error saving welcome messages: {e}")
        st.error(f"Error saving welcome messages: {e}")
        return False

def load_welcome_messages() -> Dict[str, str]:
    """
    Load welcome messages from a JSON file.
    
    Returns:
        Dict[str, str]: Dictionary of message templates
    """
    try:
        messages_path = os.path.join(os.getcwd(), 'app', 'data', 'welcome_messages.json')
        if os.path.exists(messages_path):
            with open(messages_path, 'r') as f:
                messages = json.load(f)
                
                # Ensure the room_specific and category_specific fields exist
                if "room_specific" not in messages:
                    messages["room_specific"] = {}
                if "category_specific" not in messages:
                    messages["category_specific"] = {}
                    
                return messages
        else:
            # Default messages
            return {
                "direct_welcome": "Welcome to our community, {name}! 👋\n\nI'm the community bot, here to help you get started. Feel free to explore our community rooms and reach out if you have any questions.",
                "room_announcement": "🎉 Please welcome our new community member: **{name}** (@{username})!\n\n{intro}",
                "invite_message": "You've been invited to join this room based on your interests. We hope you'll find the discussions valuable!",
                "room_specific": {},  # Messages specific to room IDs
                "category_specific": {}  # Messages specific to categories
            }
    except Exception as e:
        logging.error(f"Error loading welcome messages: {e}")
        return {
            "direct_welcome": "Welcome to our community, {name}! 👋",
            "room_announcement": "🎉 Please welcome our new community member: **{name}** (@{username})!",
            "invite_message": "You've been invited to join this room based on your interests.",
            "room_specific": {},
            "category_specific": {}
        }

def save_user_settings(
    selected_theme: str, 
    shlink_url: str,
    auth0_domain: str, 
    auth0_callback_url: str, 
    auth0_authorize_url: str, 
    auth0_token_url: str, 
    authentik_api_url: str,
    authentik_api_token: str, 
    shlink_api_token: str, 
    main_group_id: str, 
    flow_id: str, 
    encryption_password: str, 
) -> bool:
    """
    Save user settings to the .env file.
    
    Args:
        Various user settings parameters
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Log what we're about to do
        logging.info("Saving user settings to .env file")
        
        # Update environment variables
        success = True
        settings = {
            "THEME": selected_theme,
            "SHLINK_URL": shlink_url,
            "AUTH0_DOMAIN": auth0_domain,
            "AUTH0_CALLBACK_URL": auth0_callback_url,
            "AUTH0_AUTHORIZE_URL": auth0_authorize_url,
            "AUTH0_TOKEN_URL": auth0_token_url,
            "AUTHENTIK_API_URL": authentik_api_url,
            "AUTHENTIK_API_TOKEN": authentik_api_token,
            "SHLINK_API_TOKEN": shlink_api_token,
            "MAIN_GROUP_ID": main_group_id,
            "FLOW_ID": flow_id,
            "ENCRYPTION_PASSWORD": encryption_password,
        }
        
        # Save each setting
        failed_settings = []
        for key, value in settings.items():
            result = save_env_variable(key, value)
            if not result:
                success = False
                failed_settings.append(key)
                logging.error(f"Failed to save setting: {key}")
        
        # Log the result
        if success:
            logging.info("Successfully saved all user settings")
        else:
            logging.error(f"Failed to save some user settings: {', '.join(failed_settings)}")
            st.error(f"Failed to save some settings: {', '.join(failed_settings)}")
        
        return success
    except Exception as e:
        logging.error(f"Error saving user settings: {e}")
        st.error(f"Error saving user settings: {e}")
        return False

def render_settings_page():
    """Main function to render the settings page with tabs for different setting categories"""
    # Add authentication protection directly in the page
    if not st.session_state.get('is_authenticated', False):
        st.title("Authentication Required")
        st.warning("You must log in to access Settings.")
        display_login_button(location="main")
        return
        
    # Only admin users should access settings
    if not st.session_state.get('is_admin', False):
        st.title("Access Denied")
        st.error("You need administrator privileges to access the Settings page.")
        st.info("Please contact an administrator if you need access to these settings.")
        return
    
    # Display the settings page
    st.title("Settings")
    
    # Display tabs for different setting categories
    tabs = st.tabs([
        "User Settings", 
        "Integration Settings", 
        "Matrix Rooms", 
        "Message Users", 
        "Prompts", 
        "Advanced Settings"
    ])
    
    # User Settings Tab
    with tabs[0]:
        render_user_settings()
    
    # Integration Settings Tab
    with tabs[1]:
        render_integration_settings()
    
    # Matrix Rooms Tab
    with tabs[2]:
        render_matrix_rooms_settings()
    
    # Message Users Tab
    with tabs[3]:
        render_message_users_settings()
    
    # Prompts Tab
    with tabs[4]:
        render_prompts_settings()
    
    # Advanced Settings Tab
    with tabs[5]:
        render_advanced_settings()

def render_integration_settings():
    """Render the integration settings tab"""
    st.header("Integration Settings")
    
    # Matrix Integration
    st.subheader("Matrix Integration")
    matrix_active = st.checkbox("Enable Matrix Integration", value=getattr(Config, "MATRIX_ACTIVE", False), key="integration_matrix_active")
    matrix_url = st.text_input("Matrix Server URL", value=getattr(Config, "MATRIX_HOMESERVER_URL", "") or "", key="integration_matrix_url")
    matrix_bot_username = st.text_input("Matrix Bot Username", value=getattr(Config, "MATRIX_BOT_USERNAME", "") or "", key="integration_matrix_bot_username")
    matrix_bot_display_name = st.text_input("Matrix Bot Display Name", value=getattr(Config, "MATRIX_BOT_DISPLAY_NAME", "") or "", key="integration_matrix_bot_display_name")
    matrix_access_token = st.text_input("Matrix Access Token", value=getattr(Config, "MATRIX_ACCESS_TOKEN", "") or "", type="password", key="integration_matrix_access_token")
    matrix_default_room_id = st.text_input("Matrix Default Room ID", value=getattr(Config, "MATRIX_DEFAULT_ROOM_ID", "") or "", key="integration_matrix_default_room_id")
    matrix_welcome_room_id = st.text_input("Matrix Welcome Room ID", value=getattr(Config, "MATRIX_WELCOME_ROOM_ID", "") or "", key="integration_matrix_welcome_room_id")
    
    # SMTP Integration
    st.subheader("Email (SMTP) Integration")
    smtp_active = st.checkbox("Enable Email Integration", value=getattr(Config, "SMTP_ACTIVE", False), key="integration_smtp_active")
    smtp_server = st.text_input("SMTP Server", value=getattr(Config, "SMTP_SERVER", "") or "", key="integration_smtp_server")
    smtp_port = st.number_input("SMTP Port", value=int(getattr(Config, "SMTP_PORT", 587) or 587), min_value=1, max_value=65535, key="integration_smtp_port")
    smtp_user = st.text_input("SMTP Username", value=getattr(Config, "SMTP_USERNAME", "") or "", key="integration_smtp_user")
    smtp_password = st.text_input("SMTP Password", value=getattr(Config, "SMTP_PASSWORD", "") or "", type="password", key="integration_smtp_password")
    smtp_from = st.text_input("From Email Address", value=getattr(Config, "SMTP_FROM_EMAIL", "") or "", key="integration_smtp_from")
    
    # Discourse Integration
    st.subheader("Discourse Integration")
    discourse_active = st.checkbox("Enable Discourse Integration", value=getattr(Config, "DISCOURSE_ACTIVE", False), key="integration_discourse_active")
    discourse_url = st.text_input("Discourse URL", value=getattr(Config, "DISCOURSE_URL", "") or "", key="integration_discourse_url")
    discourse_api_key = st.text_input("Discourse API Key", value=getattr(Config, "DISCOURSE_API_KEY", "") or "", type="password", key="integration_discourse_api_key")
    discourse_api_username = st.text_input("Discourse API Username", value=getattr(Config, "DISCOURSE_API_USERNAME", "") or "", key="integration_discourse_api_username")
    discourse_category_id = st.text_input("Discourse Category ID", value=getattr(Config, "DISCOURSE_CATEGORY_ID", "") or "", key="integration_discourse_category_id")
    

    # Save Integration Settings
    if st.button("Save Integration Settings", key="integration_save_button"):
        success = True
        
        # Save Matrix settings
        success &= save_env_variable("MATRIX_ACTIVE", str(matrix_active))
        success &= save_env_variable("MATRIX_HOMESERVER_URL", matrix_url)
        success &= save_env_variable("MATRIX_ACCESS_TOKEN", matrix_access_token)
        success &= save_env_variable("MATRIX_BOT_USERNAME", matrix_bot_username)
        success &= save_env_variable("MATRIX_BOT_DISPLAY_NAME", matrix_bot_display_name)
        success &= save_env_variable("MATRIX_DEFAULT_ROOM_ID", matrix_default_room_id)
        success &= save_env_variable("MATRIX_WELCOME_ROOM_ID", matrix_welcome_room_id)
        
        # Save SMTP settings
        success &= save_env_variable("SMTP_ACTIVE", str(smtp_active))
        success &= save_env_variable("SMTP_SERVER", smtp_server)
        success &= save_env_variable("SMTP_PORT", str(smtp_port))
        success &= save_env_variable("SMTP_USERNAME", smtp_user)
        success &= save_env_variable("SMTP_PASSWORD", smtp_password)
        success &= save_env_variable("SMTP_FROM_EMAIL", smtp_from)
        
        # Save Discourse settings
        success &= save_env_variable("DISCOURSE_ACTIVE", str(discourse_active))
        success &= save_env_variable("DISCOURSE_URL", discourse_url)
        success &= save_env_variable("DISCOURSE_API_KEY", discourse_api_key)
        success &= save_env_variable("DISCOURSE_API_USERNAME", discourse_api_username)
        success &= save_env_variable("DISCOURSE_CATEGORY_ID", discourse_category_id)
        
        
        if success:
            st.success("Integration settings saved successfully! Please restart the application for changes to take effect.")
        else:
            st.error("There was an error saving some settings. Please check the logs for details.")

def render_matrix_rooms_settings():
    """Render the Matrix rooms settings tab"""
    st.header("Matrix Rooms")
    
    # Create tabs for different sections
    rooms_tab, user_management_tab, categories_tab = st.tabs([
        "Room Management",
        "User Management",
        "Categories"
    ])
    
    with rooms_tab:
        render_room_management()
        
    with user_management_tab:
        render_user_management()
        
    with categories_tab:
        render_categories_management()

def render_room_management():
    """Render the room management section"""
    # Initialize session state for rooms
    if 'matrix_rooms' not in st.session_state:
        st.session_state.matrix_rooms = merge_room_data()
    
    # Display existing rooms
    st.subheader("Existing Rooms")
    
    # Create a dataframe for editing
    room_data = []
    for i, room in enumerate(st.session_state.matrix_rooms):
        room_data.append({
            "id": i,
            "name": room.get('name', ''),
            "categories": ', '.join(room.get('categories', [])),
            "room_id": room.get('room_id', ''),
            "configured": room.get('configured', False),
            "accessible": room.get('accessible', False)
        })
    
    # Use Streamlit's data editor
    edited_data = st.data_editor(
        room_data,
        column_config={
            "id": st.column_config.NumberColumn("ID", required=True),
            "name": st.column_config.TextColumn("Room Name", required=True),
            "categories": st.column_config.TextColumn("Categories (comma-separated)", required=True),
            "room_id": st.column_config.TextColumn("Room ID", required=True),
            "configured": st.column_config.CheckboxColumn("Configured"),
            "accessible": st.column_config.CheckboxColumn("Accessible")
        },
        hide_index=True,
        num_rows="dynamic",
        key="matrix_rooms_editor"
    )
    
    # Add a new room section
    st.subheader("Add New Room")
    
    # Option to select from accessible rooms
    st.write("Select from accessible rooms:")
    accessible_rooms = get_all_accessible_rooms_sync()  # Use the sync version
    room_options = ["-- Select a room --"]
    for room in accessible_rooms:
        if room.get('name') and room.get('room_id'):
            room_options.append(f"{room.get('name')} - {room.get('room_id')}")
    
    selected_room = st.selectbox("Select Room", room_options, key="matrix_room_select")
    
    if selected_room and selected_room != "-- Select a room --":
        # Extract room details
        room_name, room_id = selected_room.rsplit(" - ", 1)
        st.session_state.new_room_name = room_name
        st.session_state.new_room_id = room_id
    
    # Manual entry
    st.write("Or enter room details manually:")
    new_room_name = st.text_input("Room Name", value=st.session_state.get('new_room_name', ''), key="matrix_new_room_name")
    new_room_id = st.text_input("Room ID", value=st.session_state.get('new_room_id', ''), key="matrix_new_room_id")
    
    # Category selection
    all_categories = set()
    for room in st.session_state.matrix_rooms:
        if 'categories' in room:
            all_categories.update(room['categories'])
    
    new_room_categories = st.multiselect("Categories", sorted(all_categories), key="matrix_new_room_categories")
    
    # Add room button
    if st.button("Add Room", key="matrix_add_room_button"):
        if new_room_name and new_room_id:
            # Add to session state
            st.session_state.matrix_rooms.append({
                "name": new_room_name,
                "room_id": new_room_id,
                "categories": new_room_categories,
                "category": ','.join(new_room_categories),
                "configured": True,
                "accessible": True
            })
            
            # Clear form
            st.session_state.new_room_name = ""
            st.session_state.new_room_id = ""
            
            st.success(f"Room '{new_room_name}' added successfully!")
            st.rerun()
        else:
            st.error("Room name and ID are required.")
    
    # Save rooms button
    if st.button("Save All Rooms", key="matrix_save_rooms_button"):
        # Update session state from edited data
        updated_rooms = []
        for item in edited_data:
            # Parse categories back into a list
            categories = [cat.strip() for cat in item['categories'].split(',')]
            
            updated_rooms.append({
                "name": item['name'],
                "room_id": item['room_id'],
                "categories": categories,
                "category": item['categories'],
                "configured": item['configured'],
                "accessible": item['accessible']
            })
        
        # Save to .env file
        if save_matrix_rooms(updated_rooms):
            st.session_state.matrix_rooms = updated_rooms
            st.success("Rooms saved successfully! Please restart the application for changes to take effect.")
        else:
            st.error("Failed to save rooms. Please check the logs for details.")

def render_user_management():
    """Render the user management section."""
    st.subheader("User Management")
    
    # Create tabs for different user management functions
    create_tab, invite_tab, manage_tab = st.tabs([
        "Create User", 
        "Invite User", 
        "Manage Users"
    ])
    
    with create_tab:
        st.header("Create New User")
        
        # Create form for user creation
        with st.form("create_user_form"):
            username = st.text_input("Username", help="Enter the username for the new user")
            full_name = st.text_input("Full Name", help="Enter the full name of the user")
            email = st.text_input("Email", help="Enter the user's email address")
            intro = st.text_area("Introduction", help="Provide information about the user that will be shared in the welcome announcement")
            invited_by = st.text_input("Invited By", help="Who invited this user to the community?")
            
            submitted = st.form_submit_button("Create User")
            
            if submitted:
                if not username or not full_name:
                    st.error("Username and Full Name are required fields")
                else:
                    # Create an event loop to run the async function
                    try:
                        # Use thread-based approach to avoid event loop issues
                        import threading
                        
                        # Define function to run in background thread
                        def create_user_thread():
                            try:
                                # Create new event loop
                                loop = asyncio.new_event_loop()
                                asyncio.set_event_loop(loop)
                                
                                # Import here to avoid circular imports
                                from app.auth.api import create_user
                                
                                # Run the create_user function
                                st.session_state['create_user_result'] = loop.run_until_complete(
                                    create_user(username, full_name, email, invited_by, intro)
                                )
                                
                                # Clean up
                                loop.close()
                            except Exception as thread_error:
                                st.session_state['create_user_error'] = str(thread_error)
                                logging.error(f"Error in create_user thread: {thread_error}", exc_info=True)
                            finally:
                                st.session_state['create_user_finished'] = True
                        
                        # Set up state and start thread
                        if 'create_user_thread_started' not in st.session_state:
                            st.session_state['create_user_thread_started'] = True
                            st.session_state['create_user_finished'] = False
                            thread = threading.Thread(target=create_user_thread)
                            thread.start()
                            st.info("Creating user, please wait...")
                            st.rerun()
                        
                        # Check if thread is done
                        if 'create_user_finished' in st.session_state and st.session_state['create_user_finished']:
                            # Handle error case
                            if 'create_user_error' in st.session_state:
                                st.error(f"Error creating user: {st.session_state['create_user_error']}")
                                # Clean up state
                                if 'create_user_error' in st.session_state:
                                    del st.session_state['create_user_error']
                                if 'create_user_thread_started' in st.session_state:
                                    del st.session_state['create_user_thread_started']
                                if 'create_user_finished' in st.session_state:
                                    del st.session_state['create_user_finished']
                            
                            # Handle success case
                            elif 'create_user_result' in st.session_state:
                                success, created_username, temp_password, post_url = st.session_state['create_user_result']
                                
                                if success:
                                    st.success(f"User {created_username} created successfully!")
                                    st.info(f"Temporary password: {temp_password}")
                                    if post_url:
                                        st.info(f"Discourse post created: {post_url}")
                                else:
                                    st.error(f"Failed to create user. Error: {temp_password}")
                                
                                # Clean up state
                                if 'create_user_result' in st.session_state:
                                    del st.session_state['create_user_result']
                                if 'create_user_thread_started' in st.session_state:
                                    del st.session_state['create_user_thread_started']
                                if 'create_user_finished' in st.session_state:
                                    del st.session_state['create_user_finished']
                        else:
                            # Still running
                            st.info("Still creating user, please wait...")
                            st.rerun()
                    except Exception as e:
                        st.error(f"Error creating user: {str(e)}")
                        logging.error(f"Error in create_user: {str(e)}", exc_info=True)
    
    with invite_tab:
        st.header("Create Invite Link")
        # Create a form for invite creation
        with st.form("create_invite_form"):
            invite_label = st.text_input("Invite Label", help="A label to identify this invite")
            
            # Set default expiration to 2 hours from now
            from datetime import datetime, timedelta
            from pytz import timezone
            eastern = timezone('US/Eastern')
            eastern_now = datetime.now(eastern)
            expires_default = eastern_now + timedelta(hours=2)
            
            # Show the expiration time but default to 2 hours
            hours_options = [2, 4, 8, 12, 24, 48, 72]
            selected_hours = st.selectbox(
                "Expires in (hours)", 
                options=hours_options,
                index=0, 
                help="How long the invite link will be valid"
            )
            
            expires = eastern_now + timedelta(hours=selected_hours)
            
            submitted = st.form_submit_button("Create Invite")
            
            if submitted:
                if not invite_label:
                    st.error("Invite Label is required")
                else:
                    # Call the create_invite function
                    from app.auth.api import create_invite
                    from app.messages import create_invite_message
                    try:
                        result = create_invite(
                            email=f"{invite_label}@example.com",  # Use label as email prefix
                            name=invite_label,
                            expiry=expires.strftime('%Y-%m-%d'),
                            created_by=st.session_state.get("username", "system"),
                            groups=[]  # No pre-assigned groups
                        )
                        
                        if result and isinstance(result, dict) and result.get('success', False):
                            invite_link = result.get('invite_link')
                            
                            # Display the invite message
                            create_invite_message(invite_label, invite_link, expires)
                            
                            # Add copy button
                            if st.button("Copy Invite Link"):
                                st.markdown(f"""
                                <script>
                                    navigator.clipboard.writeText('{invite_link}');
                                    alert('Invite link copied to clipboard!');
                                </script>
                                """, unsafe_allow_html=True)
                        else:
                            error_msg = "Unknown error"
                            if isinstance(result, dict):
                                error_msg = result.get('error', 'Unknown error')
                            st.error(f"Failed to create invite: {error_msg}")
                    except Exception as e:
                        st.error(f"Error creating invite: {str(e)}")
                        logging.error(f"Error in create_invite: {str(e)}", exc_info=True)
    
    with manage_tab:
        st.header("Manage Existing Users")
        st.info("This section will allow you to manage existing users, reset passwords, and more.")
        
        # Add more user management functionality here
        # You could add a data editor for users, password reset buttons, etc.
        if st.button("List Users"):
            # Show a list of users from the database
            try:
                with next(get_db()) as db:
                    users = search_users(db, "")
                    if users:
                        st.write("Users in the database:")
                        for user in users:
                            st.write(f"• {user.username} ({user.name}) - {user.email}")
                    else:
                        st.warning("No users found in the database.")
            except Exception as e:
                st.error(f"Error listing users: {str(e)}")
                logging.error(f"Error listing users: {str(e)}", exc_info=True)

def render_categories_management():
    """Render the categories management section"""
    st.subheader("Room Categories")
    st.info("Categories help organize rooms and can be used for bulk invitations and messaging.")
    
    # Initialize session state for rooms
    if 'matrix_rooms' not in st.session_state:
        st.session_state.matrix_rooms = merge_room_data()
    
    # Get all existing categories
    all_categories = set()
    for room in st.session_state.matrix_rooms:
        if 'categories' in room:
            all_categories.update(room['categories'])
    
    # Display existing categories
    st.write("**Existing Categories:**")
    if all_categories:
        for category in sorted(all_categories):
            st.write(f"- {category}")
    else:
        st.write("No categories defined yet.")
    
    # Add new category
    st.write("**Add New Category:**")
    new_category = st.text_input("New Category Name", key="new_category_name")
    
    # Select rooms to apply the category to
    room_options = []
    for room in st.session_state.matrix_rooms:
        if room.get('name') and room.get('room_id'):
            room_options.append(f"{room.get('name')} - {room.get('room_id')}")
    
    selected_rooms = st.multiselect("Apply to Rooms", room_options, key="category_rooms_select")
    
    if st.button("Add Category to Selected Rooms", key="add_category_button"):
        if not new_category:
            st.error("Please enter a category name.")
        elif not selected_rooms:
            st.error("Please select at least one room.")
        else:
            updated_count = 0
            for selected_room in selected_rooms:
                room_name, room_id = selected_room.rsplit(" - ", 1)
                
                # Find the room in the session state
                for i, room in enumerate(st.session_state.matrix_rooms):
                    if room.get('room_id') == room_id:
                        # Add the category if it doesn't exist
                        if 'categories' not in room:
                            st.session_state.matrix_rooms[i]['categories'] = []
                        
                        if new_category not in st.session_state.matrix_rooms[i]['categories']:
                            st.session_state.matrix_rooms[i]['categories'].append(new_category)
                            updated_count += 1
            
            if updated_count > 0:
                # Save the updated room data
                if save_matrix_rooms(st.session_state.matrix_rooms):
                    st.success(f"Added category '{new_category}' to {updated_count} rooms.")
                else:
                    st.error("Failed to save room data.")
            else:
                st.info("No rooms were updated. The category may already be applied to all selected rooms.")
    
    # Remove category
    st.write("**Remove Category:**")
    category_to_remove = st.selectbox("Select Category to Remove", ["-- Select a category --"] + sorted(list(all_categories)), key="remove_category_select")
    
    if category_to_remove and category_to_remove != "-- Select a category --":
        if st.button("Remove Category from All Rooms", key="remove_category_button"):
            removed_count = 0
            for i, room in enumerate(st.session_state.matrix_rooms):
                if 'categories' in room and category_to_remove in room['categories']:
                    st.session_state.matrix_rooms[i]['categories'].remove(category_to_remove)
                    removed_count += 1
            
            if removed_count > 0:
                # Save the updated room data
                if save_matrix_rooms(st.session_state.matrix_rooms):
                    st.success(f"Removed category '{category_to_remove}' from {removed_count} rooms.")
                else:
                    st.error("Failed to save room data.")
            else:
                st.info("No rooms were updated.")

def render_message_users_settings():
    """Render the message users settings tab."""
    st.header("Message Users")
    
    # Use tabs to organize different messaging options
    dm_tab, room_tab = st.tabs(["Direct Message", "Room Message"])
    
    with dm_tab:
        st.subheader("Send Direct Message")
        
        # Get all accessible users
        try:
            # Create a button to fetch users (this avoids the event loop issue)
            if st.button("Fetch Matrix Users", key="fetch_matrix_users"):
                st.session_state['loading_matrix_users'] = True
                st.session_state['matrix_users'] = None  # Reset users to ensure fresh data
                st.info("Loading Matrix users, please wait...")
                st.rerun()
                
            if 'loading_matrix_users' in st.session_state and st.session_state['loading_matrix_users']:
                # Use a background thread to load users
                import threading
                import asyncio
                
                if 'matrix_users' not in st.session_state or st.session_state['matrix_users'] is None:
                    # Define the function to run in the background
                    def load_users():
                        try:
                            # Create new event loop
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                            
                            # Import here to avoid circular imports
                            from app.utils.matrix_actions import get_all_accessible_users
                            
                            # Run the async function
                            st.session_state['matrix_users'] = loop.run_until_complete(get_all_accessible_users())
                            
                            # Close the loop
                            loop.close()
                        except Exception as e:
                            st.session_state['matrix_error'] = str(e)
                            logging.error(f"Error loading Matrix users: {str(e)}", exc_info=True)
                        finally:
                            st.session_state['loading_matrix_users'] = False
                    
                    # Start the background thread
                    thread = threading.Thread(target=load_users)
                    thread.start()
                    st.info("Loading users, please wait...")
                    st.rerun()
                    
                # Check if we have users or an error
                if 'matrix_error' in st.session_state:
                    st.error(f"Error loading Matrix users: {st.session_state['matrix_error']}")
                    if 'matrix_error' in st.session_state:
                        del st.session_state['matrix_error']
                    st.session_state['loading_matrix_users'] = False
                
                if 'matrix_users' in st.session_state:
                    st.session_state['loading_matrix_users'] = False
                    display_direct_message_form(st.session_state['matrix_users'])
                else:
                    st.info("Loading users...")
            else:
                if 'matrix_users' in st.session_state and st.session_state['matrix_users'] is not None:
                    display_direct_message_form(st.session_state['matrix_users'])
                else:
                    st.info("Click 'Fetch Matrix Users' to load available users")
        except Exception as e:
            st.error(f"Error loading users: {str(e)}")
            logging.error(f"Error in render_message_users_settings: {str(e)}", exc_info=True)
    
    with room_tab:
        st.subheader("Send Message to Room")
        # This part isn't async so we don't need to modify it
        # ...

def display_direct_message_form(users):
    """Display the form for sending direct messages."""
    if not users:
        st.warning("No accessible users found. This could be due to Matrix integration being inactive or connection issues.")
        return
    
    # Create a dropdown with user display names
    user_options = ["-- Select a user --"] + [f"{user.get('display_name', user.get('user_id', 'Unknown'))} - {user.get('user_id', 'Unknown')}" for user in users]
    selected_user = st.selectbox("Select User", user_options, key="direct_message_user_select")
    
    if selected_user and selected_user != "-- Select a user --":
        # Extract the user ID from the selection
        user_id = selected_user.split(" - ")[-1]
        
        # Get previous message if in session state
        default_message = st.session_state.get('direct_message_text', '')
        
        # Message input
        message = st.text_area(
            "Direct Message", 
            value=default_message,
            height=150, 
            help="Enter your message here. This will be sent as a direct message.",
            key="direct_message_text_input"
        )
        
        if st.button("Send Message", key="direct_message_send_button"):
            if not message.strip():
                st.warning("Please enter a message before sending.")
                return
                
            # Set up progress state
            st.session_state['sending_message'] = True
            st.session_state['message_user_id'] = user_id
            st.session_state['message_text'] = message
            st.info("Sending message...")
            st.rerun()

    # Handle message sending in a separate state
    if 'sending_message' in st.session_state and st.session_state['sending_message']:
        # Use a background thread to send the message
        import threading
        import asyncio
        
        # Define the function to run in the background
        def send_message():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                from app.utils.matrix_actions import send_matrix_message_async
                st.session_state['message_result'] = loop.run_until_complete(
                    send_matrix_message_async(
                        st.session_state['message_user_id'], 
                        st.session_state['message_text']
                    )
                )
            except Exception as e:
                st.session_state['message_error'] = str(e)
            finally:
                loop.close()
                st.session_state['sending_message'] = False
        
        # Start the background thread if not already started
        if 'message_thread_started' not in st.session_state:
            st.session_state['message_thread_started'] = True
            thread = threading.Thread(target=send_message)
            thread.start()
            st.info("Sending message, please wait...")
            st.rerun()
        
        # Check if we have a result or an error
        if 'message_error' in st.session_state:
            st.error(f"Error sending message: {st.session_state['message_error']}")
            del st.session_state['message_error']
            del st.session_state['sending_message']
            del st.session_state['message_thread_started']
        
        if 'message_result' in st.session_state:
            result = st.session_state['message_result']
            if result:
                st.success(f"Message sent successfully!")
                # Clear the message
                st.session_state['direct_message_text'] = ''
            else:
                st.error(f"Failed to send message")
            
            del st.session_state['message_result']
            del st.session_state['sending_message']
            del st.session_state['message_thread_started']
            del st.session_state['message_user_id']
            del st.session_state['message_text']

def render_user_settings():
    """Render user settings section"""
    st.subheader("Integration Settings")
    
    # Load current settings with defaults for missing attributes
    selected_theme = os.getenv("THEME", "light")  # Default to light if not set
    shlink_url = getattr(Config, "SHLINK_URL", "")
    auth0_domain = getattr(Config, "AUTH0_DOMAIN", "")
    auth0_callback_url = getattr(Config, "AUTH0_CALLBACK_URL", "")
    auth0_authorize_url = getattr(Config, "AUTH0_AUTHORIZE_URL", "")
    auth0_token_url = getattr(Config, "AUTH0_TOKEN_URL", "")
    authentik_api_url = getattr(Config, "AUTHENTIK_API_URL", "")
    authentik_api_token = getattr(Config, "AUTHENTIK_API_TOKEN", "")
    shlink_api_token = getattr(Config, "SHLINK_API_TOKEN", "")
    main_group_id = getattr(Config, "MAIN_GROUP_ID", "")
    flow_id = getattr(Config, "FLOW_ID", "")
    encryption_password = getattr(Config, "ENCRYPTION_PASSWORD", "")
    
    # Create a form for saving settings
    with st.form("user_settings_form_main"):
        # Theme selection
        theme_options = ["light", "dark"]
        selected_theme = st.selectbox("Select theme", theme_options, 
                                      index=theme_options.index(selected_theme) if selected_theme in theme_options else 0,
                                      key="settings_theme")
        
        # Group ID settings
        st.subheader("Group and Flow Settings")
        main_group_id = st.text_input("Default Group ID", value=main_group_id or "", key="settings_main_group_id")
        flow_id = st.text_input("Flow ID", value=flow_id or "", key="settings_flow_id")
        
        # Auth0 settings
        st.subheader("Auth0 Configuration")
        auth0_domain = st.text_input("Auth0 Domain", value=auth0_domain or "", key="settings_auth0_domain")
        auth0_callback_url = st.text_input("Auth0 Callback URL", value=auth0_callback_url or "", key="settings_auth0_callback_url")
        auth0_authorize_url = st.text_input("Auth0 Authorize URL", value=auth0_authorize_url or "", key="settings_auth0_authorize_url")
        auth0_token_url = st.text_input("Auth0 Token URL", value=auth0_token_url or "", key="settings_auth0_token_url")
        
        # Authentik settings
        st.subheader("Authentik Configuration")
        authentik_api_url = st.text_input("Authentik API URL", value=authentik_api_url or "", key="settings_authentik_api_url")
        authentik_api_token = st.text_input("Authentik API Token", value=authentik_api_token or "", type="password", key="settings_authentik_api_token")
        
        # Shlink settings
        st.subheader("Shlink URL Shortener Configuration")
        shlink_url = st.text_input("Shlink URL", value=shlink_url or "", key="settings_shlink_url")
        shlink_api_token = st.text_input("Shlink API Token", value=shlink_api_token or "", type="password", key="settings_shlink_api_token")
        
        # Encryption settings
        st.subheader("Encryption Settings")
        encryption_password = st.text_input("Encryption Password", value=encryption_password or "", type="password", key="settings_encryption_password")
        
        submitted = st.form_submit_button("Save Settings")
        
        if submitted:
            if save_user_settings(
                selected_theme=selected_theme,
                shlink_url=shlink_url,
                auth0_domain=auth0_domain,
                auth0_callback_url=auth0_callback_url,
                auth0_authorize_url=auth0_authorize_url,
                auth0_token_url=auth0_token_url,
                authentik_api_url=authentik_api_url,
                authentik_api_token=authentik_api_token,
                shlink_api_token=shlink_api_token,
                main_group_id=main_group_id,
                flow_id=flow_id,
                encryption_password=encryption_password
            ):
                st.success("Settings saved successfully! Refresh the page to see the changes.")
            else:
                st.error("Failed to save settings.")

def render_prompts_settings():
    """Render the prompts management tab"""
    st.header("Prompts Management")
    
    from app.utils.prompts_manager import load_prompts, save_prompts, add_or_update_prompt, delete_prompt
    
    # Load all prompts
    prompts_data = load_prompts()
    
    # Create tabs for different prompt operations
    view_tab, edit_tab, create_tab, associate_tab = st.tabs([
        "View Prompts", 
        "Edit Prompt", 
        "Create Prompt",
        "Associate Prompts"
    ])
    
    with view_tab:
        st.subheader("All Prompts")
        
        if not prompts_data["prompts"]:
            st.info("No prompts found. Create a new prompt to get started.")
        else:
            # Create a dataframe for displaying prompts
            import pandas as pd
            prompt_list = []
            for prompt in prompts_data["prompts"]:
                prompt_list.append({
                    "ID": prompt["id"],
                    "Name": prompt["name"],
                    "Description": prompt["description"],
                    "Tags": ", ".join(prompt["tags"]),
                    "Content": prompt["content"][:50] + "..." if len(prompt["content"]) > 50 else prompt["content"]
                })
            
            prompts_df = pd.DataFrame(prompt_list)
            st.dataframe(prompts_df, use_container_width=True)
            
            # Allow selecting a prompt to view details
            prompt_ids = [prompt["id"] for prompt in prompts_data["prompts"]]
            selected_prompt_id = st.selectbox("Select a prompt to view details", ["-- Select a prompt --"] + prompt_ids)
            
            if selected_prompt_id and selected_prompt_id != "-- Select a prompt --":
                # Find the selected prompt
                selected_prompt = next((p for p in prompts_data["prompts"] if p["id"] == selected_prompt_id), None)
                
                if selected_prompt:
                    st.write("### Prompt Details")
                    st.write(f"**ID:** {selected_prompt['id']}")
                    st.write(f"**Name:** {selected_prompt['name']}")
                    st.write(f"**Description:** {selected_prompt['description']}")
                    st.write(f"**Tags:** {', '.join(selected_prompt['tags'])}")
                    
                    st.write("**Content:**")
                    st.text_area(
                        "Prompt Content",
                        value=selected_prompt['content'],
                        height=200,
                        disabled=True,
                        key=f"view_prompt_{selected_prompt_id}"
                    )
                    
                    # Display associations if any
                    room_associations = [room_id for room_id, prompt_id in prompts_data["room_associations"].items() if prompt_id == selected_prompt_id]
                    category_associations = [category for category, prompt_id in prompts_data["category_associations"].items() if prompt_id == selected_prompt_id]
                    
                    if room_associations:
                        st.write(f"**Associated with rooms:** {', '.join(room_associations)}")
                    
                    if category_associations:
                        st.write(f"**Associated with categories:** {', '.join(category_associations)}")
                    
                    # Add delete button
                    if st.button(f"Delete Prompt: {selected_prompt_id}"):
                        updated_prompts = delete_prompt(prompts_data, selected_prompt_id)
                        if save_prompts(updated_prompts):
                            st.success(f"Prompt '{selected_prompt_id}' deleted successfully!")
                            st.rerun()
                        else:
                            st.error("Failed to delete prompt. Please check logs for details.")
                
    with edit_tab:
        st.subheader("Edit Existing Prompt")
        
        if not prompts_data["prompts"]:
            st.info("No prompts found. Create a new prompt first.")
        else:
            # Select a prompt to edit
            prompt_ids = [prompt["id"] for prompt in prompts_data["prompts"]]
            edit_prompt_id = st.selectbox("Select a prompt to edit", ["-- Select a prompt --"] + prompt_ids, key="edit_prompt_select")
            
            if edit_prompt_id and edit_prompt_id != "-- Select a prompt --":
                # Find the selected prompt
                edit_prompt = next((p for p in prompts_data["prompts"] if p["id"] == edit_prompt_id), None)
                
                if edit_prompt:
                    with st.form("edit_prompt_form"):
                        prompt_name = st.text_input("Prompt Name", value=edit_prompt["name"])
                        prompt_description = st.text_input("Description", value=edit_prompt["description"])
                        prompt_content = st.text_area("Content", value=edit_prompt["content"], height=300)
                        prompt_tags = st.text_input("Tags (comma-separated)", value=", ".join(edit_prompt["tags"]))
                        
                        submitted = st.form_submit_button("Update Prompt")
                        
                        if submitted:
                            # Process tags
                            tags = [tag.strip() for tag in prompt_tags.split(",") if tag.strip()]
                            
                            # Update the prompt
                            updated_prompts = add_or_update_prompt(
                                prompts_data,
                                edit_prompt_id,
                                prompt_name,
                                prompt_content,
                                prompt_description,
                                tags
                            )
                            
                            if save_prompts(updated_prompts):
                                st.success(f"Prompt '{edit_prompt_id}' updated successfully!")
                            else:
                                st.error("Failed to update prompt. Please check logs for details.")
    
    with create_tab:
        st.subheader("Create New Prompt")
        
        with st.form("create_prompt_form"):
            new_prompt_id = st.text_input("Prompt ID (unique identifier)", placeholder="e.g., welcome_message_1")
            new_prompt_name = st.text_input("Prompt Name", placeholder="e.g., Welcome Message")
            new_prompt_description = st.text_input("Description", placeholder="e.g., Standard welcome message for new users")
            new_prompt_content = st.text_area(
                "Content", 
                placeholder="Enter your prompt template here. You can use variables like {name}, {username}, etc.",
                height=300
            )
            new_prompt_tags = st.text_input("Tags (comma-separated)", placeholder="e.g., welcome, onboarding, new user")
            
            submitted = st.form_submit_button("Create Prompt")
            
            if submitted:
                if not new_prompt_id or not new_prompt_name or not new_prompt_content:
                    st.error("Prompt ID, Name, and Content are required fields")
                else:
                    # Process tags
                    tags = [tag.strip() for tag in new_prompt_tags.split(",") if tag.strip()]
                    
                    # Check if prompt ID already exists
                    prompt_exists = any(p["id"] == new_prompt_id for p in prompts_data["prompts"])
                    if prompt_exists:
                        st.error(f"A prompt with ID '{new_prompt_id}' already exists. Please use a different ID.")
                    else:
                        # Add the new prompt
                        updated_prompts = add_or_update_prompt(
                            prompts_data,
                            new_prompt_id,
                            new_prompt_name,
                            new_prompt_content,
                            new_prompt_description,
                            tags
                        )
                        
                        if save_prompts(updated_prompts):
                            st.success(f"Prompt '{new_prompt_id}' created successfully!")
                            # Clear form
                            st.session_state["create_prompt_form"] = {
                                "new_prompt_id": "",
                                "new_prompt_name": "",
                                "new_prompt_description": "",
                                "new_prompt_content": "",
                                "new_prompt_tags": ""
                            }
                            st.rerun()
                        else:
                            st.error("Failed to create prompt. Please check logs for details.")
    
    with associate_tab:
        st.subheader("Associate Prompts with Rooms or Categories")
        
        if not prompts_data["prompts"]:
            st.info("No prompts found. Create a new prompt first.")
        else:
            # Create tabs for room and category associations
            room_tab, category_tab = st.tabs(["Room Associations", "Category Associations"])
            
            with room_tab:
                st.write("Associate prompts with specific Matrix rooms")
                
                # Get available rooms
                from app.utils.matrix_actions import merge_room_data
                matrix_rooms = merge_room_data()
                
                if not matrix_rooms:
                    st.info("No Matrix rooms found. Configure Matrix rooms first.")
                else:
                    # Create room selection
                    room_options = ["-- Select a room --"]
                    for room in matrix_rooms:
                        if room.get('name') and room.get('room_id'):
                            room_options.append(f"{room.get('name')} - {room.get('room_id')}")
                    
                    selected_room = st.selectbox("Select Room", room_options, key="associate_room_select")
                    
                    if selected_room and selected_room != "-- Select a room --":
                        # Extract room ID
                        room_name, room_id = selected_room.rsplit(" - ", 1)
                        
                        # Get current prompt association
                        current_prompt_id = prompts_data["room_associations"].get(room_id)
                        
                        # Create prompt selection
                        prompt_options = ["-- None --"] + [f"{p['id']} - {p['name']}" for p in prompts_data["prompts"]]
                        default_index = 0
                        if current_prompt_id:
                            for i, option in enumerate(prompt_options):
                                if option.startswith(f"{current_prompt_id} - "):
                                    default_index = i
                                    break
                        
                        selected_prompt = st.selectbox(
                            f"Select Prompt for {room_name}",
                            prompt_options,
                            index=default_index,
                            key=f"room_prompt_{room_id}"
                        )
                        
                        if st.button("Save Room Association"):
                            from app.utils.prompts_manager import associate_prompt_with_room
                            
                            if selected_prompt == "-- None --":
                                # Remove association if it exists
                                if room_id in prompts_data["room_associations"]:
                                    del prompts_data["room_associations"][room_id]
                                    if save_prompts(prompts_data):
                                        st.success(f"Removed prompt association for room {room_name}")
                                        st.rerun()
                                    else:
                                        st.error("Failed to update prompt associations")
                            else:
                                # Extract prompt ID
                                prompt_id = selected_prompt.split(" - ")[0]
                                
                                # Associate prompt with room
                                updated_prompts = associate_prompt_with_room(prompts_data, prompt_id, room_id)
                                
                                if save_prompts(updated_prompts):
                                    st.success(f"Associated prompt '{prompt_id}' with room {room_name}")
                                    st.rerun()
                                else:
                                    st.error("Failed to update prompt association")
            
            with category_tab:
                st.write("Associate prompts with room categories")
                
                # Get all categories from matrix rooms
                all_categories = set()
                from app.utils.matrix_actions import merge_room_data
                matrix_rooms = merge_room_data()
                
                for room in matrix_rooms:
                    if 'categories' in room:
                        all_categories.update(room['categories'])
                
                if not all_categories:
                    st.info("No room categories found. Configure room categories first.")
                else:
                    # Create category selection
                    category_options = ["-- Select a category --"] + sorted(list(all_categories))
                    selected_category = st.selectbox("Select Category", category_options, key="associate_category_select")
                    
                    if selected_category and selected_category != "-- Select a category --":
                        # Get current prompt association
                        current_prompt_id = prompts_data["category_associations"].get(selected_category)
                        
                        # Create prompt selection
                        prompt_options = ["-- None --"] + [f"{p['id']} - {p['name']}" for p in prompts_data["prompts"]]
                        default_index = 0
                        if current_prompt_id:
                            for i, option in enumerate(prompt_options):
                                if option.startswith(f"{current_prompt_id} - "):
                                    default_index = i
                                    break
                        
                        selected_prompt = st.selectbox(
                            f"Select Prompt for {selected_category} category",
                            prompt_options,
                            index=default_index,
                            key=f"category_prompt_{selected_category}"
                        )
                        
                        if st.button("Save Category Association"):
                            from app.utils.prompts_manager import associate_prompt_with_category
                            
                            if selected_prompt == "-- None --":
                                # Remove association if it exists
                                if selected_category in prompts_data["category_associations"]:
                                    del prompts_data["category_associations"][selected_category]
                                    if save_prompts(prompts_data):
                                        st.success(f"Removed prompt association for category {selected_category}")
                                        st.rerun()
                                    else:
                                        st.error("Failed to update prompt associations")
                            else:
                                # Extract prompt ID
                                prompt_id = selected_prompt.split(" - ")[0]
                                
                                # Associate prompt with category
                                updated_prompts = associate_prompt_with_category(prompts_data, prompt_id, selected_category)
                                
                                if save_prompts(updated_prompts):
                                    st.success(f"Associated prompt '{prompt_id}' with category {selected_category}")
                                    st.rerun()
                                else:
                                    st.error("Failed to update prompt association")

def render_advanced_settings():
    """Render the advanced settings tab"""
    st.header("Advanced Settings")
    st.warning("These settings are for advanced users only. Incorrect configuration may cause the application to malfunction.")
    
    # OpenAI settings
    st.subheader("OpenAI Integration")
    openai_api_key = st.text_input("OpenAI API Key", value=getattr(Config, "OPENAI_API_KEY", "") or "", type="password", key="advanced_openai_api_key")
    
    # Save button
    if st.button("Save Advanced Settings", key="advanced_save_button"):
        success = True
        success &= save_env_variable("OPENAI_API_KEY", openai_api_key)
        
        if success:
            st.success("Advanced settings saved successfully! Please restart the application for changes to take effect.")
        else:
            st.error("There was an error saving some settings. Please check the logs for details.")

# Main execution
render_settings_page() 