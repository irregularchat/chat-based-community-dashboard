import streamlit as st
import logging
import hashlib
from datetime import datetime
from app.utils.config import Config


def validate_local_admin(username, password):
    """
    Validate local admin credentials against the configured values.
    
    Args:
        username (str): The username to validate
        password (str): The password to validate
        
    Returns:
        bool: True if credentials are valid, False otherwise
    """
    if not username or not password:
        return False
        
    # Check if username matches the configured admin username
    if username != Config.DEFAULT_ADMIN_USERNAME:
        logging.warning(f"Invalid local admin login attempt with username: {username}")
        return False
        
    # Check if password matches the configured admin password
    if password != Config.DEFAULT_ADMIN_PASSWORD:
        logging.warning(f"Invalid local admin login attempt for username: {username}")
        return False
    
    logging.info(f"Local admin login successful for username: {username}")
    return True


def handle_local_login(username, password):
    """
    Handle local admin login and set up session state.
    
    Args:
        username (str): The username for login
        password (str): The password for login
        
    Returns:
        bool: True if login was successful, False otherwise
    """
    if validate_local_admin(username, password):
        # Set up session state for authenticated user
        st.session_state['is_authenticated'] = True
        st.session_state['auth_method'] = 'local'
        st.session_state['session_start_time'] = datetime.now()
        
        # Create a minimal user_info dictionary for local admin
        st.session_state['user_info'] = {
            'preferred_username': username,
            'name': 'Local Administrator',
            'email': '',
            'is_local_admin': True
        }
        
        # Set admin privileges
        st.session_state['is_admin'] = True
        
        return True
    
    return False


def display_local_login_form():
    """
    Display a local login form for admin authentication.
    
    Returns:
        bool: True if login was successful, False otherwise
    """
    st.subheader("Local Admin Login")
    
    with st.form("local_login_form"):
        username = st.text_input("Username")
        password = st.text_input("Password", type="password")
        submit_button = st.form_submit_button("Login")
        
        if submit_button:
            if handle_local_login(username, password):
                st.success("Login successful!")
                return True
            else:
                st.error("Invalid username or password")
    
    return False


def is_local_admin():
    """
    Check if the current user is authenticated as a local admin.
    
    Returns:
        bool: True if the user is a local admin, False otherwise
    """
    if not st.session_state.get('is_authenticated', False):
        return False
        
    return st.session_state.get('auth_method') == 'local'
