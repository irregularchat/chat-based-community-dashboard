# app/pages/settings.py
import streamlit as st
import os
import json
import logging
from typing import Dict, List, Any, Optional
from dotenv import load_dotenv, set_key
from utils.config import Config
from utils.matrix_actions import get_all_accessible_rooms, merge_room_data

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

def save_matrix_rooms(rooms: List[Dict[str, Any]]) -> bool:
    """
    Save Matrix rooms to the .env file.
    
    Args:
        rooms: List of room dictionaries with name, categories, and room_id
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Log what we're about to do
        logging.info(f"Saving {len(rooms)} matrix rooms to .env file")
        
        # Convert rooms to the string format
        room_entries = []
        for room in rooms:
            name = room.get('name', '')
            categories = room.get('categories', [])
            category_str = ','.join(categories)
            room_id = room.get('room_id', '')
            
            if name and room_id:
                room_entries.append(f"{name}|{category_str}|{room_id}")
                logging.debug(f"Added room: {name} with categories: {category_str}")
            else:
                logging.warning(f"Skipping room with missing name or ID: {room}")
        
        # Join with semicolons
        rooms_str = ';'.join(room_entries)
        
        # Save to .env
        result = save_env_variable('MATRIX_ROOM_IDS_NAME_CATEGORY', rooms_str)
        if result:
            logging.info("Successfully saved matrix rooms to .env file")
        else:
            logging.error("Failed to save matrix rooms to .env file")
            st.error("Failed to save matrix rooms. Please check the logs for details.")
        
        return result
    except Exception as e:
        logging.error(f"Error saving matrix rooms: {e}")
        st.error(f"Error saving matrix rooms: {e}")
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
                return json.load(f)
        else:
            # Default messages
            return {
                "direct_welcome": "Welcome to our community, {name}! 👋\n\nI'm the community bot, here to help you get started. Feel free to explore our community rooms and reach out if you have any questions.",
                "room_announcement": "🎉 Please welcome our new community member: **{name}** (@{username})!\n\n{intro}",
                "invite_message": "You've been invited to join this room based on your interests. We hope you'll find the discussions valuable!"
            }
    except Exception as e:
        logging.error(f"Error loading welcome messages: {e}")
        return {
            "direct_welcome": "Welcome to our community, {name}! 👋",
            "room_announcement": "🎉 Please welcome our new community member: **{name}** (@{username})!",
            "invite_message": "You've been invited to join this room based on your interests."
        }

def save_user_settings(
    webhook_enabled: bool, 
    user_created_webhook: bool, 
    password_reset_webhook: bool, 
    selected_theme: str, 
    shlink_url: str,
    auth0_domain: str, 
    auth0_callback_url: str, 
    auth0_authorize_url: str, 
    auth0_token_url: str, 
    authentik_api_url: str,
    webhook_url: str, 
    authentik_api_token: str, 
    shlink_api_token: str, 
    main_group_id: str, 
    flow_id: str, 
    encryption_password: str, 
    webhook_secret: str
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
            "WEBHOOK_ENABLED": str(webhook_enabled).lower(),
            "WEBHOOK_USER_CREATED": str(user_created_webhook).lower(),
            "WEBHOOK_PASSWORD_RESET": str(password_reset_webhook).lower(),
            "THEME": selected_theme,
            "SHLINK_URL": shlink_url,
            "AUTH0_DOMAIN": auth0_domain,
            "AUTH0_CALLBACK_URL": auth0_callback_url,
            "AUTH0_AUTHORIZE_URL": auth0_authorize_url,
            "AUTH0_TOKEN_URL": auth0_token_url,
            "AUTHENTIK_API_URL": authentik_api_url,
            "WEBHOOK_URL": webhook_url,
            "AUTHENTIK_API_TOKEN": authentik_api_token,
            "SHLINK_API_TOKEN": shlink_api_token,
            "MAIN_GROUP_ID": main_group_id,
            "FLOW_ID": flow_id,
            "ENCRYPTION_PASSWORD": encryption_password,
            "WEBHOOK_SECRET": webhook_secret
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
    """Main function to render the settings page with all tabs and functionality"""
    # Set page title
    st.title("Dashboard Settings")

    # Create tabs for different settings categories
    tab1, tab2, tab3, tab4, tab5, tab6 = st.tabs([
        "Integration Settings", 
        "Matrix Rooms", 
        "Categories", 
        "Welcome Messages",
        "User Settings",
        "Advanced Settings"
    ])

    with tab1:
        render_integration_settings()

    with tab2:
        render_matrix_rooms_settings()

    with tab3:
        render_categories_settings()
        
    with tab4:
        render_welcome_messages_settings()
        
    with tab5:
        render_user_settings()
        
    with tab6:
        render_advanced_settings()

def render_integration_settings():
    """Render the integration settings tab"""
    st.header("Integration Settings")
    
    # Matrix Integration
    st.subheader("Matrix Integration")
    matrix_active = st.checkbox("Enable Matrix Integration", value=Config.MATRIX_ACTIVE, key="integration_matrix_active")
    matrix_url = st.text_input("Matrix Server URL", value=Config.MATRIX_URL or "", key="integration_matrix_url")
    matrix_token = st.text_input("Matrix Access Token", value=Config.MATRIX_ACCESS_TOKEN or "", type="password", key="integration_matrix_token")
    matrix_bot_username = st.text_input("Matrix Bot Username", value=Config.MATRIX_BOT_USERNAME or "", key="integration_matrix_bot_username")
    
    # SMTP Integration
    st.subheader("Email (SMTP) Integration")
    smtp_active = st.checkbox("Enable Email Integration", value=Config.SMTP_ACTIVE, key="integration_smtp_active")
    smtp_server = st.text_input("SMTP Server", value=Config.SMTP_SERVER or "", key="integration_smtp_server")
    smtp_port = st.number_input("SMTP Port", value=int(Config.SMTP_PORT or 587), min_value=1, max_value=65535, key="integration_smtp_port")
    smtp_user = st.text_input("SMTP Username", value=Config.SMTP_USER or "", key="integration_smtp_user")
    smtp_password = st.text_input("SMTP Password", value=Config.SMTP_PASSWORD or "", type="password", key="integration_smtp_password")
    smtp_from = st.text_input("From Email Address", value=Config.SMTP_FROM or "", key="integration_smtp_from")
    
    # Discourse Integration
    st.subheader("Discourse Integration")
    discourse_active = st.checkbox("Enable Discourse Integration", value=Config.DISCOURSE_ACTIVE, key="integration_discourse_active")
    discourse_url = st.text_input("Discourse URL", value=Config.DISCOURSE_URL or "", key="integration_discourse_url")
    discourse_api_key = st.text_input("Discourse API Key", value=Config.DISCOURSE_API_KEY or "", type="password", key="integration_discourse_api_key")
    discourse_api_username = st.text_input("Discourse API Username", value=Config.DISCOURSE_API_USERNAME or "", key="integration_discourse_api_username")
    discourse_category_id = st.text_input("Discourse Category ID", value=Config.DISCOURSE_CATEGORY_ID or "", key="integration_discourse_category_id")
    
    # Webhook Integration
    st.subheader("Webhook Integration")
    webhook_active = st.checkbox("Enable Webhook Integration", value=Config.WEBHOOK_ACTIVE, key="integration_webhook_active")
    webhook_url = st.text_input("Webhook URL", value=Config.WEBHOOK_URL or "", key="integration_webhook_url")
    webhook_secret = st.text_input("Webhook Secret", value=Config.WEBHOOK_SECRET or "", type="password", key="integration_webhook_secret")
    
    # Save Integration Settings
    if st.button("Save Integration Settings", key="integration_save_button"):
        success = True
        
        # Save Matrix settings
        success &= save_env_variable("MATRIX_ACTIVE", str(matrix_active))
        success &= save_env_variable("MATRIX_URL", matrix_url)
        success &= save_env_variable("MATRIX_ACCESS_TOKEN", matrix_token)
        success &= save_env_variable("MATRIX_BOT_USERNAME", matrix_bot_username)
        
        # Save SMTP settings
        success &= save_env_variable("SMTP_ACTIVE", str(smtp_active))
        success &= save_env_variable("SMTP_SERVER", smtp_server)
        success &= save_env_variable("SMTP_PORT", str(smtp_port))
        success &= save_env_variable("SMTP_USER", smtp_user)
        success &= save_env_variable("SMTP_PASSWORD", smtp_password)
        success &= save_env_variable("SMTP_FROM", smtp_from)
        
        # Save Discourse settings
        success &= save_env_variable("DISCOURSE_ACTIVE", str(discourse_active))
        success &= save_env_variable("DISCOURSE_URL", discourse_url)
        success &= save_env_variable("DISCOURSE_API_KEY", discourse_api_key)
        success &= save_env_variable("DISCOURSE_API_USERNAME", discourse_api_username)
        success &= save_env_variable("DISCOURSE_CATEGORY_ID", discourse_category_id)
        
        # Save Webhook settings
        success &= save_env_variable("WEBHOOK_ACTIVE", str(webhook_active))
        success &= save_env_variable("WEBHOOK_URL", webhook_url)
        success &= save_env_variable("WEBHOOK_SECRET", webhook_secret)
        
        if success:
            st.success("Integration settings saved successfully! Please restart the application for changes to take effect.")
        else:
            st.error("There was an error saving some settings. Please check the logs for details.")

def render_matrix_rooms_settings():
    """Render the Matrix rooms settings tab"""
    st.header("Matrix Rooms")
    
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
    accessible_rooms = get_all_accessible_rooms()
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

def render_categories_settings():
    """Render the categories settings tab"""
    st.header("Categories")
    st.info("This section allows you to manage categories for organizing rooms and content.")
    
    # Get all existing categories
    all_categories = set()
    for room in st.session_state.get('matrix_rooms', []):
        if 'categories' in room:
            all_categories.update(room['categories'])
    
    # Display existing categories
    st.subheader("Existing Categories")
    if all_categories:
        for category in sorted(all_categories):
            st.write(f"- {category}")
    else:
        st.write("No categories defined yet.")
    
    # Add new category
    st.subheader("Add New Category")
    new_category = st.text_input("Category Name", key="categories_new_category")
    
    if st.button("Add Category", key="categories_add_button"):
        if new_category:
            # We don't actually need to save categories separately,
            # they're saved with rooms. This just adds it to the list
            # for selection in the room editor.
            st.success(f"Category '{new_category}' added. You can now assign it to rooms.")
            st.rerun()
        else:
            st.error("Please enter a category name.")

def render_welcome_messages_settings():
    """Render the welcome messages settings tab"""
    st.header("Welcome Messages")
    
    # Load current welcome messages
    welcome_messages = load_welcome_messages()
    
    st.subheader("Message Templates")
    st.info("These messages are used when welcoming new users. You can use placeholders like {name}, {username}, and {intro}.")
    
    # Direct welcome message
    direct_welcome = st.text_area(
        "Direct Welcome Message", 
        value=welcome_messages.get("direct_welcome", ""),
        help="Sent as a direct message to new users. Placeholders: {name}",
        key="welcome_direct_message"
    )
    
    # Room announcement
    room_announcement = st.text_area(
        "Room Announcement", 
        value=welcome_messages.get("room_announcement", ""),
        help="Posted in community rooms to announce new users. Placeholders: {name}, {username}, {intro}",
        key="welcome_room_announcement"
    )
    
    # Invite message
    invite_message = st.text_area(
        "Room Invite Message", 
        value=welcome_messages.get("invite_message", ""),
        help="Sent when inviting users to rooms based on their interests.",
        key="welcome_invite_message"
    )
    
    # Save button
    if st.button("Save Welcome Messages", key="welcome_save_button"):
        updated_messages = {
            "direct_welcome": direct_welcome,
            "room_announcement": room_announcement,
            "invite_message": invite_message
        }
        
        if save_welcome_messages(updated_messages):
            st.success("Welcome messages saved successfully!")
        else:
            st.error("Failed to save welcome messages. Please check the logs for details.")

def render_user_settings():
    """Render the user settings tab"""
    st.header("User Settings")
    
    # Security settings
    st.subheader("Security Settings")
    encryption_password = st.text_input("Encryption Password", value=os.getenv("ENCRYPTION_PASSWORD", ""), type="password", key="user_encryption_password")
    
    # Theme settings
    st.subheader("Theme Settings")
    selected_theme = st.selectbox("Theme", ["light", "dark"], index=0 if selected_theme == "light" else 1, key="user_theme")
    
    # Save button
    if st.button("Save User Settings", key="user_save_button"):
        success = save_user_settings(
            webhook_enabled, 
            user_created_webhook, 
            password_reset_webhook, 
            selected_theme, 
            shlink_url,
            auth0_domain, 
            auth0_callback_url, 
            auth0_authorize_url, 
            auth0_token_url, 
            authentik_api_url,
            webhook_url, 
            authentik_api_token, 
            shlink_api_token, 
            main_group_id, 
            flow_id, 
            encryption_password, 
            webhook_secret
        )
        
        if success:
            st.success("User settings saved successfully! Please restart the application for changes to take effect.")
        else:
            st.error("There was an error saving some settings. Please check the logs for details.")

def render_advanced_settings():
    """Render the advanced settings tab"""
    st.header("Advanced Settings")
    st.warning("These settings are for advanced users only. Incorrect configuration may cause the application to malfunction.")
    
    
    # OpenAI settings
    st.subheader("OpenAI Integration")
    openai_api_key = st.text_input("OpenAI API Key", value=Config.OPENAI_API_KEY or "", type="password", key="advanced_openai_api_key")
    
    # Save button
    if st.button("Save Advanced Settings", key="advanced_save_button"):
        success = True
        success &= save_env_variable("OPENAI_API_KEY", openai_api_key)
        
        if success:
            st.success("Advanced settings saved successfully! Please restart the application for changes to take effect.")
        else:
            st.error("There was an error saving some settings. Please check the logs for details.")

    # Load current settings
    webhook_enabled = os.getenv("WEBHOOK_ENABLED", "true").lower() == "true"
    user_created_webhook = os.getenv("WEBHOOK_USER_CREATED", "true").lower() == "true"
    password_reset_webhook = os.getenv("WEBHOOK_PASSWORD_RESET", "true").lower() == "true"
    selected_theme = os.getenv("THEME", "light")
    
    # Authentication settings
    st.subheader("Authentication Settings")
    
    authentik_api_url = st.text_input("Authentik API URL", value=Config.AUTHENTIK_API_URL or "", key="user_authentik_api_url")
    authentik_api_token = st.text_input("Authentik API Token", value=Config.AUTHENTIK_API_TOKEN or "", type="password", key="user_authentik_api_token")
    main_group_id = st.text_input("Main Group ID", value=Config.MAIN_GROUP_ID or "", key="user_main_group_id")
    flow_id = st.text_input("Flow ID", value=Config.FLOW_ID or "", key="user_flow_id")
    
    # Auth0 settings
    st.subheader("Auth0 Settings (Optional)")
    auth0_domain = st.text_input("Auth0 Domain", value=os.getenv("AUTH0_DOMAIN", ""), key="user_auth0_domain")
    auth0_callback_url = st.text_input("Auth0 Callback URL", value=os.getenv("AUTH0_CALLBACK_URL", ""), key="user_auth0_callback_url")
    auth0_authorize_url = st.text_input("Auth0 Authorize URL", value=os.getenv("AUTH0_AUTHORIZE_URL", ""), key="user_auth0_authorize_url")
    auth0_token_url = st.text_input("Auth0 Token URL", value=os.getenv("AUTH0_TOKEN_URL", ""), key="user_auth0_token_url")
    
    # Webhook settings
    st.subheader("Webhook Settings")
    webhook_enabled = st.checkbox("Enable Webhooks", value=webhook_enabled, key="user_webhook_enabled")
    webhook_url = st.text_input("Webhook URL", value=Config.WEBHOOK_URL or "", key="user_webhook_url")
    webhook_secret = st.text_input("Webhook Secret", value=Config.WEBHOOK_SECRET or "", type="password", key="user_webhook_secret")
    
    # Webhook events
    st.write("Webhook Events:")
    user_created_webhook = st.checkbox("User Created", value=user_created_webhook, key="user_webhook_user_created")
    password_reset_webhook = st.checkbox("Password Reset", value=password_reset_webhook, key="user_webhook_password_reset")
    
    # URL Shortener settings
    st.subheader("URL Shortener Settings")
    shlink_url = st.text_input("Shlink URL", value=Config.SHLINK_URL or "", key="user_shlink_url")
    shlink_api_token = st.text_input("Shlink API Token", value=Config.SHLINK_API_TOKEN or "", type="password", key="user_shlink_api_token")
    
# Main execution
render_settings_page() 