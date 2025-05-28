#!/usr/bin/env python3
"""
Cookie-based authentication module for persistent login state.

This module uses streamlit-cookies-controller to store authentication state
in browser cookies, which persist across page refreshes and browser sessions.
"""

import streamlit as st
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

# Cookie configuration
COOKIE_NAME = 'community_dashboard_auth'
COOKIE_EXPIRY_HOURS = 24
COOKIE_KEY = 'auth_cookies'  # Unique key for the cookie controller

# Global cookie controller instance to avoid multiple widget creation
_cookie_controller = None

def get_cookie_controller():
    """Get or create a cookie controller instance using singleton pattern."""
    global _cookie_controller
    
    try:
        # Return existing controller if available
        if _cookie_controller is not None:
            return _cookie_controller
        
        from streamlit_cookies_controller import CookieController
        
        # Create new controller only if one doesn't exist
        _cookie_controller = CookieController(key=COOKIE_KEY)
        return _cookie_controller
        
    except ImportError:
        logger.error("streamlit-cookies-controller not installed. Please install it with: pip install streamlit-cookies-controller")
        return None
    except Exception as e:
        logger.error(f"Error creating cookie controller: {e}")
        return None

def store_auth_in_cookies(username: str, is_admin: bool, is_moderator: bool, auth_method: str):
    """
    Store authentication state in browser cookies.
    
    Args:
        username: The authenticated username
        is_admin: Whether user has admin privileges
        is_moderator: Whether user has moderator privileges
        auth_method: The authentication method used ('local' or 'sso')
    """
    try:
        controller = get_cookie_controller()
        if not controller:
            logger.error("Cookie controller not available")
            return
        
        auth_data = {
            'username': username,
            'is_admin': is_admin,
            'is_moderator': is_moderator,
            'auth_method': auth_method,
            'timestamp': datetime.now().isoformat(),
            'expires_at': (datetime.now() + timedelta(hours=COOKIE_EXPIRY_HOURS)).isoformat()
        }
        
        # Store auth data as JSON string in cookie with expiry
        controller.set(
            COOKIE_NAME, 
            json.dumps(auth_data),
            max_age=COOKIE_EXPIRY_HOURS * 3600  # Convert hours to seconds
        )
        
        logger.info(f"Stored auth state in cookies for user: {username}")
        
    except Exception as e:
        logger.error(f"Error storing auth state in cookies: {e}")

def retrieve_auth_from_cookies() -> Optional[Dict[str, Any]]:
    """
    Retrieve authentication state from browser cookies.
    
    Returns:
        Dict containing auth state if found and valid, None otherwise
    """
    try:
        controller = get_cookie_controller()
        if not controller:
            logger.error("Cookie controller not available")
            return None
        
        # Get auth data from cookie with error handling
        auth_cookie = None
        try:
            auth_cookie = controller.get(COOKIE_NAME)
        except Exception as widget_error:
            logger.error(f"Widget error retrieving cookie: {widget_error}")
            return None
        
        if not auth_cookie:
            logger.debug("No auth cookie found")
            return None
        
        # Parse JSON data
        auth_data = json.loads(auth_cookie)
        
        # Check if cookie has expired
        expires_at = datetime.fromisoformat(auth_data['expires_at'])
        if datetime.now() > expires_at:
            logger.info("Auth cookie expired, removing")
            clear_auth_cookies()
            return None
        
        logger.info(f"Retrieved valid auth state from cookies for user: {auth_data['username']}")
        return auth_data
        
    except json.JSONDecodeError as e:
        logger.error(f"Error parsing auth cookie JSON: {e}")
        clear_auth_cookies()  # Clear corrupted cookie
        return None
    except Exception as e:
        logger.error(f"Error retrieving auth state from cookies: {e}")
        return None

def clear_auth_cookies():
    """
    Clear authentication state from browser cookies.
    """
    try:
        controller = get_cookie_controller()
        if not controller:
            logger.error("Cookie controller not available")
            return
            
        controller.remove(COOKIE_NAME)
        logger.info("Cleared auth state from cookies")
        
    except Exception as e:
        logger.error(f"Error clearing auth state from cookies: {e}")

def restore_session_from_cookies() -> bool:
    """
    Check browser cookies for valid auth state and restore to session state.
    
    Returns:
        True if auth state was restored, False otherwise
    """
    try:
        # Skip if already authenticated (avoid overwriting current session)
        if st.session_state.get('is_authenticated', False):
            return False
        
        # Retrieve auth data from cookies with additional error handling
        auth_data = None
        try:
            auth_data = retrieve_auth_from_cookies()
        except Exception as cookie_error:
            logger.error(f"Failed to retrieve auth data from cookies: {cookie_error}")
            return False
        
        if not auth_data:
            return False
        
        # Restore session state from cookie data
        st.session_state['is_authenticated'] = True
        st.session_state['username'] = auth_data['username']
        st.session_state['is_admin'] = auth_data['is_admin']
        st.session_state['is_moderator'] = auth_data['is_moderator']
        st.session_state['auth_method'] = auth_data['auth_method']
        
        # Set permanent flags for backup
        st.session_state['permanent_auth'] = True
        st.session_state['permanent_admin'] = auth_data['is_admin']
        st.session_state['permanent_moderator'] = auth_data['is_moderator']
        st.session_state['permanent_username'] = auth_data['username']
        st.session_state['permanent_auth_method'] = auth_data['auth_method']
        
        # Create user_info
        st.session_state['user_info'] = {
            'preferred_username': auth_data['username'],
            'name': auth_data['username'],
            'email': '',
            'is_local_admin': auth_data['auth_method'] == 'local'
        }
        
        # Set auth timestamp
        st.session_state['auth_timestamp'] = datetime.now().timestamp()
        
        logger.info(f"Successfully restored session from cookies for user: {auth_data['username']}")
        return True
        
    except Exception as e:
        logger.error(f"Error restoring session from cookies: {e}")
        return False

def check_and_refresh_cookies():
    """
    Check if cookies need to be refreshed and update them if necessary.
    This should be called periodically to extend the session.
    """
    try:
        if not st.session_state.get('is_authenticated', False):
            return
        
        # Try to get auth data with error handling
        auth_data = None
        try:
            auth_data = retrieve_auth_from_cookies()
        except Exception as cookie_error:
            logger.warning(f"Could not check cookies for refresh: {cookie_error}")
            return
        
        if not auth_data:
            # Cookie expired or missing, but session is still active
            # Re-store the current session state in cookies
            username = st.session_state.get('username', '')
            is_admin = st.session_state.get('is_admin', False)
            is_moderator = st.session_state.get('is_moderator', False)
            auth_method = st.session_state.get('auth_method', 'unknown')
            
            if username:
                store_auth_in_cookies(username, is_admin, is_moderator, auth_method)
                logger.info(f"Refreshed expired cookies for user: {username}")
        
    except Exception as e:
        logger.error(f"Error checking/refreshing cookies: {e}")

def hide_cookie_component():
    """
    Hide the cookie controller component UI element.
    This prevents the iframe from showing when cookies are set/retrieved.
    """
    try:
        st.html("""
        <style>
            div[data-testid='element-container']:has(iframe[title='streamlit_cookies_controller.cookie_controller.cookie_controller']) {
                display: none;
            }
        </style>
        """)
    except Exception as e:
        logger.debug(f"Could not hide cookie component: {e}")
        # This is not critical, so we just log and continue

def reset_cookie_controller():
    """Reset the global cookie controller instance. Useful for testing or error recovery."""
    global _cookie_controller
    _cookie_controller = None
    logger.debug("Reset cookie controller instance") 