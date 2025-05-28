#!/usr/bin/env python3
"""
SSO Authentication module using OIDC/OAuth2.

This module handles Single Sign-On authentication and stores
authentication state in browser cookies for persistence.
"""

import streamlit as st
import requests
import logging
from datetime import datetime
from urllib.parse import urlencode, parse_qs, urlparse
from typing import Dict, Any, Optional
from app.utils.config import Config
from app.auth.cookie_auth import store_auth_in_cookies, clear_auth_cookies

logger = logging.getLogger(__name__)

def get_login_url() -> str:
    """
    Generate the SSO login URL for Authentik.
    
    Returns:
        The complete login URL
    """
    try:
        # Build the authorization URL
        auth_params = {
            'response_type': 'code',
            'client_id': Config.OIDC_CLIENT_ID,
            'redirect_uri': Config.OIDC_REDIRECT_URI,
            'scope': 'openid profile email',
            'state': 'streamlit_auth'  # Simple state for CSRF protection
        }
        
        auth_url = f"{Config.OIDC_AUTHORIZATION_ENDPOINT}?" + urlencode(auth_params)
        logger.info(f"Generated SSO login URL: {auth_url}")
        return auth_url
        
    except Exception as e:
        logger.error(f"Error generating login URL: {e}")
        return "#"

def exchange_code_for_token(code: str) -> Optional[Dict[str, Any]]:
    """
    Exchange authorization code for access token.
    
    Args:
        code: The authorization code from the callback
        
    Returns:
        Token response dict or None if failed
    """
    try:
        token_data = {
            'grant_type': 'authorization_code',
            'client_id': Config.OIDC_CLIENT_ID,
            'client_secret': Config.OIDC_CLIENT_SECRET,
            'code': code,
            'redirect_uri': Config.OIDC_REDIRECT_URI
        }
        
        token_url = Config.OIDC_TOKEN_ENDPOINT
        
        response = requests.post(
            token_url,
            data=token_data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
            timeout=30
        )
        
        if response.status_code == 200:
            token_response = response.json()
            logger.info("Successfully exchanged code for token")
            return token_response
        else:
            logger.error(f"Token exchange failed: {response.status_code} - {response.text}")
            return None
            
    except Exception as e:
        logger.error(f"Error exchanging code for token: {e}")
        return None

def get_user_info(access_token: str) -> Optional[Dict[str, Any]]:
    """
    Get user information from the OIDC provider.
    
    Args:
        access_token: The access token
        
    Returns:
        User info dict or None if failed
    """
    try:
        userinfo_url = Config.OIDC_USERINFO_ENDPOINT
        
        response = requests.get(
            userinfo_url,
            headers={'Authorization': f'Bearer {access_token}'},
            timeout=30
        )
        
        if response.status_code == 200:
            user_info = response.json()
            logger.info(f"Retrieved user info for: {user_info.get('preferred_username', 'unknown')}")
            return user_info
        else:
            logger.error(f"User info request failed: {response.status_code} - {response.text}")
            return None
            
    except Exception as e:
        logger.error(f"Error getting user info: {e}")
        return None

def handle_auth_callback():
    """
    Handle the authentication callback from the OIDC provider.
    """
    try:
        # Check for authorization code in query parameters
        query_params = st.query_params
        
        if 'code' in query_params:
            code = query_params['code']
            state = query_params.get('state', '')
            
            # Verify state parameter
            if state != 'streamlit_auth':
                logger.warning("Invalid state parameter in auth callback")
                st.error("Authentication failed: Invalid state parameter")
                return
            
            # Exchange code for token
            token_response = exchange_code_for_token(code)
            if not token_response:
                st.error("Authentication failed: Could not exchange code for token")
                return
            
            # Get user information
            access_token = token_response.get('access_token')
            if not access_token:
                st.error("Authentication failed: No access token received")
                return
            
            user_info = get_user_info(access_token)
            if not user_info:
                st.error("Authentication failed: Could not retrieve user information")
                return
            
            # Set session state
            username = user_info.get('preferred_username', user_info.get('sub', 'unknown'))
            st.session_state['is_authenticated'] = True
            st.session_state['username'] = username
            st.session_state['user_info'] = user_info
            st.session_state['auth_method'] = 'sso'
            st.session_state['auth_timestamp'] = datetime.now().timestamp()
            
            # Determine user privileges (this would typically come from group membership)
            # For now, we'll set basic privileges - this should be customized based on your needs
            is_admin = 'admin' in user_info.get('groups', []) or username in ['admin', 'administrator']
            is_moderator = 'moderator' in user_info.get('groups', []) or is_admin
            
            st.session_state['is_admin'] = is_admin
            st.session_state['is_moderator'] = is_moderator
            
            # Set permanent flags for session restoration
            st.session_state['permanent_auth'] = True
            st.session_state['permanent_admin'] = is_admin
            st.session_state['permanent_moderator'] = is_moderator
            st.session_state['permanent_username'] = username
            st.session_state['permanent_auth_method'] = 'sso'
            
            # Store authentication state in browser cookies
            store_auth_in_cookies(username, is_admin, is_moderator, 'sso')
            
            # Clear the URL parameters to avoid re-processing
            st.query_params.clear()
            
            logger.info(f"SSO authentication successful for: {username}")
            st.success(f"Welcome, {username}! You are now logged in.")
            st.rerun()
            
    except Exception as e:
        logger.error(f"Error handling auth callback: {e}")
        st.error("An error occurred during authentication. Please try again.")

def logout():
    """
    Log out the current user and clear all authentication state.
    """
    try:
        username = st.session_state.get('username', 'unknown')
        
        # Clear session state
        auth_keys = [
            'is_authenticated', 'username', 'user_info', 'auth_method', 'auth_timestamp',
            'is_admin', 'is_moderator', 'permanent_auth', 'permanent_admin', 
            'permanent_moderator', 'permanent_username', 'permanent_auth_method'
        ]
        
        for key in auth_keys:
            if key in st.session_state:
                del st.session_state[key]
        
        # Clear authentication cookies with error handling
        try:
            clear_auth_cookies()
        except Exception as cookie_error:
            logger.warning(f"Could not clear cookies during logout: {cookie_error}")
            # Reset cookie controller to recover from widget errors
            from app.auth.cookie_auth import reset_cookie_controller
            reset_cookie_controller()
        
        logger.info(f"User logged out: {username}")
        st.success("You have been logged out successfully.")
        
    except Exception as e:
        logger.error(f"Error during logout: {e}")
        st.error("An error occurred during logout.")

def is_authenticated() -> bool:
    """
    Check if the current user is authenticated.
    
    Returns:
        True if authenticated, False otherwise
    """
    return st.session_state.get('is_authenticated', False)

def require_authentication():
    """
    Require authentication for the current page.
    Redirects to login if not authenticated.
    """
    if not is_authenticated():
        st.warning("Please log in to access this page.")
        st.stop()

def get_current_user() -> Optional[Dict[str, Any]]:
    """
    Get the current authenticated user's information.
    
    Returns:
        User info dict or None if not authenticated
    """
    if is_authenticated():
        return st.session_state.get('user_info', {})
    return None

def get_logout_url() -> str:
    """
    Generate the SSO logout URL.
    
    Returns:
        The logout URL
    """
    try:
        logout_url = Config.OIDC_END_SESSION_ENDPOINT
        logger.info(f"Generated SSO logout URL: {logout_url}")
        return logout_url
    except Exception as e:
        logger.error(f"Error generating logout URL: {e}")
        return "#"