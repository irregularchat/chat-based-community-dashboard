"""
Local authentication module for admin users.

This module provides functionality for local admin authentication,
including credential validation and session state management.
"""
import logging
import time
import bcrypt
from datetime import datetime

import streamlit as st

from app.utils.config import Config
from app.db.session import get_db
from app.db.operations import is_moderator, get_user_by_username


def hash_password(password: str) -> str:
    """
    Hash a password using bcrypt.
    
    Args:
        password (str): Plain text password
        
    Returns:
        str: Hashed password
    """
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')


def verify_password(password: str, hashed: str) -> bool:
    """
    Verify a password against its hash.
    
    Args:
        password (str): Plain text password
        hashed (str): Hashed password
        
    Returns:
        bool: True if password matches, False otherwise
    """
    try:
        return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
    except Exception as e:
        logging.error(f"Error verifying password: {e}")
        return False


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


def validate_local_database_user(username, password):
    """
    Validate local database user credentials.
    
    Args:
        username (str): The username to validate
        password (str): The password to validate
        
    Returns:
        tuple: (bool, User|None) - (success, user_object)
    """
    if not username or not password:
        return False, None
    
    try:
        db = next(get_db())
        try:
            # Get user from database
            user = get_user_by_username(db, username)
            if not user:
                logging.warning(f"Local database login attempt with non-existent username: {username}")
                return False, None
            
            # Check if this is a local account
            if not user.attributes or not user.attributes.get('local_account'):
                logging.warning(f"Login attempt for non-local account: {username}")
                return False, None
            
            # Get stored password from attributes
            stored_password = user.attributes.get('temp_password')
            hashed_password = user.attributes.get('hashed_password')
            
            # Check password - support both temp passwords and hashed passwords
            password_valid = False
            
            if hashed_password:
                # Use hashed password verification
                password_valid = verify_password(password, hashed_password)
            elif stored_password:
                # Use temp password (plain text comparison for backwards compatibility)
                password_valid = (password == stored_password)
                
                # If temp password matches, hash it and store it for future use
                if password_valid:
                    hashed = hash_password(password)
                    user.attributes['hashed_password'] = hashed
                    # Remove temp password for security
                    if 'temp_password' in user.attributes:
                        del user.attributes['temp_password']
                    db.commit()
                    db.refresh(user)  # Refresh the user object after commit
                    logging.info(f"Upgraded temp password to hashed password for user: {username}")
            
            if password_valid:
                logging.info(f"Local database login successful for username: {username}")
                return True, user
            else:
                logging.warning(f"Invalid password for local database user: {username}")
                return False, None
                
        finally:
            db.close()
            
    except Exception as e:
        logging.error(f"Error validating local database user {username}: {e}")
        return False, None


def handle_local_login(username, password):
    """
    Handle local admin login and set up session state.
    
    Args:
        username (str): The username for login
        password (str): The password for login
        
    Returns:
        bool: True if login was successful, False otherwise
    """
    # First try default admin login
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
        
        # Store additional permanent session variables for restoration
        st.session_state['permanent_username'] = username
        st.session_state['permanent_auth_method'] = 'local'
        
        # Log successful login with persistence
        logging.info("Local admin login successful with persistence flags set")
        
        return True
    
    # Try local database user login
    success, user = validate_local_database_user(username, password)
    if success and user:
        # Set up session state for authenticated database user
        st.session_state['is_authenticated'] = True
        st.session_state['auth_method'] = 'local'
        st.session_state['session_start_time'] = datetime.now()
        
        # Create user_info dictionary from database user
        st.session_state['user_info'] = {
            'preferred_username': user.username,
            'name': f"{user.first_name} {user.last_name}".strip() or user.username,
            'email': user.email or '',
            'is_local_admin': False,
            'is_local_database_user': True
        }
        
        # Set privileges based on user's database status
        st.session_state['is_admin'] = user.is_admin
        st.session_state['is_moderator'] = user.is_moderator
        st.session_state['username'] = user.username
        
        # Add persistence flags
        st.session_state['permanent_auth'] = True
        st.session_state['permanent_admin'] = user.is_admin
        st.session_state['permanent_moderator'] = user.is_moderator
        st.session_state['auth_timestamp'] = datetime.timestamp(datetime.now())
        
        # Store additional permanent session variables for restoration
        st.session_state['permanent_username'] = user.username
        st.session_state['permanent_auth_method'] = 'local'
        
        # Update last login time
        try:
            db = next(get_db())
            try:
                user.last_login = datetime.now()
                db.commit()
            finally:
                db.close()
        except Exception as e:
            logging.error(f"Error updating last login time: {e}")
        
        # Log successful login
        logging.info(f"Local database user login successful for username: {username}")
        
        return True
    
    return False


def display_local_login_form():
    """
    Display a local login form for admin authentication.
    
    Returns:
        bool: True if login was successful, False otherwise
    """
    st.subheader("Local Account Login")
    
    # Add a brief explanation
    st.info("Use local account credentials to access the dashboard.")
    
    with st.form("local_login_form", clear_on_submit=True):
        username = st.text_input("Username", placeholder="Enter username")
        password = st.text_input("Password", type="password", placeholder="Enter password")
        
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
                st.session_state['admin'] = st.session_state.get('is_admin', False)
                
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
