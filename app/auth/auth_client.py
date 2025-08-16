import streamlit as st
import requests
import logging
import os
import tempfile

# Configure logging
logger = logging.getLogger('auth_client')

# Flask auth server URL
AUTH_SERVER_URL = os.environ.get('AUTH_SERVER_URL', 'http://localhost:8505')

def check_auth_token():
    """
    Check if an auth token exists in the query parameters and validate it.
    This function should be called at app startup.
    """
    # Check for auth_token in URL parameters
    auth_token = st.query_params.get('auth_token')
    if not auth_token:
        return False
    
    logger.info(f"Found auth token in URL parameters: {auth_token[:5]}...")
    
    try:
        # Verify the token with the auth server
        status_url = f"{AUTH_SERVER_URL}/auth/status?auth_token={auth_token}"
        logger.info(f"Checking auth token status: {status_url}")
        
        response = requests.get(status_url, timeout=10)
        
        if response.status_code != 200:
            logger.error(f"Failed to validate auth token: {response.status_code} {response.text}")
            return False
        
        result = response.json()
        
        if result.get('authenticated'):
            # Store user data in session state
            user_data = result.get('user_data', {})
            st.session_state['is_authenticated'] = True
            st.session_state['user_info'] = user_data
            st.session_state['auth_method'] = 'sso'
            
            # Check if user is admin
            try:
                from app.auth.admin import check_admin_permission
                preferred_username = user_data.get('preferred_username', '')
                is_admin = check_admin_permission(preferred_username)
                st.session_state['is_admin'] = is_admin
                
                logger.info(f"Successfully authenticated user via auth server: {preferred_username}")
                logger.info(f"User admin status: {is_admin}")
            except ImportError as e:
                logger.error(f"Failed to import admin module: {e}")
                st.session_state['is_admin'] = False
            
            # Clear auth token from URL to prevent token leakage
            try:
                params = dict(st.query_params)
                params.pop('auth_token')
                # NOTE: We don't actually change the URL here as it may cause issues with Streamlit
                logger.info("Auth token parameter should be cleared from URL")
            except Exception as e:
                logger.error(f"Failed to handle URL parameters: {e}")
            
            return True
        else:
            logger.error(f"Authentication failed: {result.get('error')}")
            return False
            
    except requests.exceptions.ConnectionError:
        logger.error(f"Failed to connect to auth server at {AUTH_SERVER_URL}")
        st.error(f"Failed to connect to authentication server. Is it running at {AUTH_SERVER_URL}?")
        return False
    except Exception as e:
        logger.error(f"Error validating auth token: {str(e)}")
        return False

def check_auth_error():
    """Check if an auth error exists in the query parameters."""
    auth_error = st.query_params.get('auth_error')
    if auth_error:
        logger.error(f"Authentication error found in URL parameters: {auth_error}")
        st.error(f"Authentication failed: {auth_error}")
        return True
    return False

def get_login_url():
    """Get the login URL from the auth server."""
    login_url = f"{AUTH_SERVER_URL}/auth/login"
    logger.info(f"Generated login URL: {login_url}")
    return login_url

def get_logout_url():
    """Get the logout URL from the auth server."""
    logout_url = f"{AUTH_SERVER_URL}/auth/logout"
    logger.info(f"Generated logout URL: {logout_url}")
    return logout_url

def check_auth_server_health():
    """Check if the auth server is healthy."""
    try:
        response = requests.get(f"{AUTH_SERVER_URL}/health", timeout=2)
        return response.status_code == 200
    except:
        return False 