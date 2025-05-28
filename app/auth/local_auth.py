#!/usr/bin/env python3
"""
Local authentication module for admin users.

This module handles local admin authentication using username/password
and stores authentication state in browser cookies for persistence.
"""

import streamlit as st
import hashlib
import logging
from datetime import datetime
from typing import Tuple
from app.db.session import get_db
from app.db.models import User
from app.auth.cookie_auth import store_auth_in_cookies

logger = logging.getLogger(__name__)

def hash_password(password: str) -> str:
    """Hash a password using SHA-256."""
    return hashlib.sha256(password.encode()).hexdigest()

def verify_local_admin(username: str, password: str) -> Tuple[bool, bool]:
    """
    Verify local admin credentials.
    
    Args:
        username: The username to verify
        password: The password to verify
        
    Returns:
        Tuple of (is_valid, is_admin)
    """
    try:
        db = next(get_db())
        try:
            # Check if this is a local admin user
            user = db.query(User).filter(
                User.username == username,
                User.is_active == True
            ).first()
            
            if user and user.attributes:
                # Check if this is a local account with stored password
                if user.attributes.get('local_account'):
                    stored_password = user.attributes.get('hashed_password')
                    temp_password = user.attributes.get('temp_password')
                    
                    # Verify password
                    if stored_password and stored_password == hash_password(password):
                        logger.info(f"Local admin authentication successful for: {username}")
                        return True, user.is_admin
                    elif temp_password and temp_password == password:
                        # Upgrade temp password to hashed password
                        user.attributes['hashed_password'] = hash_password(password)
                        if 'temp_password' in user.attributes:
                            del user.attributes['temp_password']
                        db.commit()
                        logger.info(f"Local admin authentication successful for: {username} (password upgraded)")
                        return True, user.is_admin
            
            logger.warning(f"Local admin authentication failed for: {username}")
            return False, False
        finally:
            db.close()
                
    except Exception as e:
        logger.error(f"Error verifying local admin credentials: {e}")
        return False, False

def handle_local_login(username: str, password: str) -> Tuple[bool, str]:
    """
    Handle local admin login.
    
    Args:
        username: The username
        password: The password
        
    Returns:
        Tuple of (success, message)
    """
    try:
        # Verify credentials
        is_valid, is_admin = verify_local_admin(username, password)
        
        if is_valid:
            # Set session state
            st.session_state['is_authenticated'] = True
            st.session_state['username'] = username
            st.session_state['is_admin'] = is_admin
            st.session_state['is_moderator'] = False  # Check this from database if needed
            st.session_state['auth_method'] = 'local'
            st.session_state['auth_timestamp'] = datetime.now().timestamp()
            
            # Set permanent flags for session restoration
            st.session_state['permanent_auth'] = True
            st.session_state['permanent_admin'] = is_admin
            st.session_state['permanent_moderator'] = False
            st.session_state['permanent_username'] = username
            st.session_state['permanent_auth_method'] = 'local'
            
            # Create user info
            st.session_state['user_info'] = {
                'preferred_username': username,
                'name': username,
                'email': '',
                'is_local_admin': True
            }
            
            # Store authentication state in browser cookies with error handling
            try:
                store_auth_in_cookies(username, is_admin, False, 'local')
            except Exception as cookie_error:
                logger.warning(f"Could not store auth state in cookies: {cookie_error}")
                # Don't fail the login if cookie storage fails
            
            logger.info(f"Local admin login successful: {username}")
            return True, f"Welcome, {username}! You are now logged in as a local admin."
        else:
            logger.warning(f"Local admin login failed: {username}")
            return False, "Invalid username or password."
            
    except Exception as e:
        logger.error(f"Error during local login: {e}")
        return False, "An error occurred during login. Please try again."

def display_local_login_form():
    """
    Display the local admin login form.
    
    Returns:
        True if login was successful, False otherwise
    """
    st.subheader("🔐 Local Admin Login")
    
    with st.form("local_login_form"):
        username = st.text_input("Username", placeholder="Enter admin username")
        password = st.text_input("Password", type="password", placeholder="Enter password")
        submit_button = st.form_submit_button("Login", use_container_width=True)
        
        if submit_button:
            if username and password:
                success, message = handle_local_login(username, password)
                if success:
                    st.success(message)
                    st.rerun()
                else:
                    st.error(message)
                return success
            else:
                st.error("Please enter both username and password")
                return False
    
    return False

def is_local_admin() -> bool:
    """
    Check if the current user is authenticated as a local admin.
    
    Returns:
        True if the user is a local admin, False otherwise
    """
    if not st.session_state.get('is_authenticated', False):
        return False
    
    return st.session_state.get('auth_method') == 'local'
