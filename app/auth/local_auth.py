"""
Local authentication module for admin users.

This module provides functionality for local admin authentication,
including credential validation and session state management.
"""
import logging
import time
from datetime import datetime

import streamlit as st

from app.utils.config import Config
from app.db.session import get_db
from app.db.operations import is_moderator


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
        logging.warning("Invalid local admin login attempt with username: %s", username)
        return False
    
    # Check if password matches the configured admin password
    if password != Config.DEFAULT_ADMIN_PASSWORD:
        logging.warning("Invalid local admin login attempt for username: %s", username)
        return False
    
    logging.info("Local admin login successful for username: %s", username)
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
        
        # Check if user is also moderator (unlikely for local admin, but for consistency)
        db = next(get_db())
        try:
            is_mod = is_moderator(db, username)
            st.session_state['is_moderator'] = is_mod
            logging.info(f"Moderator status for local admin {username}: {is_mod}")
        except Exception as e:
            logging.error(f"Error checking moderator status: {e}")
            st.session_state['is_moderator'] = False
        finally:
            db.close()
        
        # Add persistence flags to avoid losing login state on redirect
        st.session_state['permanent_auth'] = True
        st.session_state['permanent_admin'] = True
        if st.session_state['is_moderator']:
            st.session_state['permanent_moderator'] = True
        st.session_state['auth_timestamp'] = datetime.timestamp(datetime.now())
        st.session_state['username'] = username
        
        # Log successful login with persistence
        logging.info("Local admin login successful with persistence flags set")
        
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
        col1, _ = st.columns([3, 1])
        with col1:
            submit_button = st.form_submit_button("Login", use_container_width=True)
        
        if submit_button:
            if handle_local_login(username, password):
                st.success("Login successful!")
                
                # Delay slightly to ensure session state is saved
                time.sleep(0.5)
                
                # Instead of using meta refresh which causes RerunException,
                # use Streamlit's built-in mechanisms for page navigation
                # Store authentication data in session state and use st.experimental_rerun()
                st.session_state['auth_success'] = True
                st.session_state['auth_method'] = 'local'
                st.session_state['username'] = username
                st.session_state['admin'] = True
                
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
