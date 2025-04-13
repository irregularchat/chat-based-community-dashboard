import streamlit as st
import logging
import hashlib
from datetime import datetime
from app.utils.config import Config
import time


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
        
        # Add persistence flags to avoid losing login state on redirect
        st.session_state['permanent_auth'] = True
        st.session_state['permanent_admin'] = True
        st.session_state['auth_timestamp'] = datetime.timestamp(datetime.now())
        st.session_state['username'] = username
        
        # Log successful login with persistence
        logging.info(f"Local admin login successful with persistence flags set")
        
        return True
    
    return False


def display_local_login_form():
    """
    Display a local login form for admin authentication.
    
    Returns:
        bool: True if login was successful, False otherwise
    """
    st.subheader("Local Admin Login")
    
    # Add a brief explanation
    st.info("Use local admin credentials to access the dashboard.")
    
    with st.form("local_login_form", clear_on_submit=True):
        username = st.text_input("Username", placeholder="Enter admin username")
        password = st.text_input("Password", type="password", placeholder="Enter admin password")
        
        # Make the login button more prominent
        col1, col2 = st.columns([3, 1])
        with col1:
            submit_button = st.form_submit_button("Login", use_container_width=True)
        
        if submit_button:
            if handle_local_login(username, password):
                st.success("Login successful!")
                
                # Delay slightly to ensure session state is saved
                time.sleep(0.5)
                
                # Redirect to special login success page with auth params 
                # This creates a much more reliable way to maintain session state
                st.markdown(f'<meta http-equiv="refresh" content="1;URL=\'/?auth_success=true&auth_method=local&username={username}&admin=true\'">', unsafe_allow_html=True)
                
                # Return True to signal successful login to parent components
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
