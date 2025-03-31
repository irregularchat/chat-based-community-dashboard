import streamlit as st
import requests
import logging
import urllib.parse
import uuid
from datetime import datetime
from app.utils.config import Config

def get_login_url(redirect_path=None):
    """
    Generate a login URL for Authentik SSO.
    
    Args:
        redirect_path (str, optional): Path to redirect to after login
        
    Returns:
        str: The login URL
    """
    # Generate a random state parameter to prevent CSRF
    state = str(uuid.uuid4())
    
    # Store the state and redirect path in session state
    st.session_state['auth_state'] = state
    if redirect_path:
        st.session_state['auth_redirect_path'] = redirect_path
    
    # Build the authorization URL
    params = {
        'client_id': Config.OIDC_CLIENT_ID,
        'response_type': 'code',
        'scope': ' '.join(Config.OIDC_SCOPES),
        'redirect_uri': Config.OIDC_REDIRECT_URI,
        'state': state
    }
    
    auth_url = f"{Config.OIDC_AUTHORIZATION_ENDPOINT}?{urllib.parse.urlencode(params)}"
    return auth_url

def get_logout_url():
    """
    Generate a logout URL for Authentik SSO.
    
    Returns:
        str: The logout URL
    """
    # Build the end session URL
    params = {
        'client_id': Config.OIDC_CLIENT_ID,
        'post_logout_redirect_uri': Config.OIDC_REDIRECT_URI
    }
    
    logout_url = f"{Config.OIDC_END_SESSION_ENDPOINT}?{urllib.parse.urlencode(params)}"
    return logout_url

def handle_auth_callback(code, state):
    """
    Handle the authentication callback from Authentik.
    
    Args:
        code (str): The authorization code
        state (str): The state parameter
        
    Returns:
        bool: True if authentication was successful, False otherwise
    """
    # Verify the state parameter
    if state != st.session_state.get('auth_state'):
        logging.error("Invalid state parameter in authentication callback")
        return False
    
    # Exchange the code for tokens
    try:
        token_response = requests.post(
            Config.OIDC_TOKEN_ENDPOINT,
            data={
                'grant_type': 'authorization_code',
                'code': code,
                'redirect_uri': Config.OIDC_REDIRECT_URI,
                'client_id': Config.OIDC_CLIENT_ID,
                'client_secret': Config.OIDC_CLIENT_SECRET
            },
            timeout=10
        )
        token_response.raise_for_status()
        token_data = token_response.json()
        
        # Get the access token
        access_token = token_data.get('access_token')
        if not access_token:
            logging.error("No access token in token response")
            return False
        
        # Get user info
        user_response = requests.get(
            Config.OIDC_USERINFO_ENDPOINT,
            headers={'Authorization': f'Bearer {access_token}'},
            timeout=10
        )
        user_response.raise_for_status()
        user_data = user_response.json()
        
        # Store user data in session state
        st.session_state['is_authenticated'] = True
        st.session_state['user_info'] = user_data
        st.session_state['access_token'] = access_token
        st.session_state['session_start_time'] = datetime.now()
        
        # Check if user is admin
        from app.auth.admin import check_admin_permission
        is_admin = check_admin_permission(user_data.get('preferred_username', ''))
        st.session_state['is_admin'] = is_admin
        
        return True
        
    except Exception as e:
        logging.error(f"Error in authentication callback: {e}")
        return False

def is_authenticated():
    """
    Check if the user is authenticated.
    
    Returns:
        bool: True if the user is authenticated, False otherwise
    """
    return st.session_state.get('is_authenticated', False)

def get_current_user():
    """
    Get the current authenticated user's information.
    
    Returns:
        dict: User information or None if not authenticated
    """
    if not is_authenticated():
        return None
    
    return st.session_state.get('user_info')

def logout():
    """
    Log the user out by clearing session state.
    """
    # Clear authentication-related session state
    auth_keys = [
        'is_authenticated', 
        'user_info', 
        'access_token', 
        'auth_state', 
        'auth_redirect_path',
        'session_start_time',
        'is_admin'
    ]
    
    for key in auth_keys:
        if key in st.session_state:
            del st.session_state[key]

def require_authentication(page_path=None):
    """
    Check if user is authenticated and redirect to login if not.
    
    Args:
        page_path (str, optional): The current page path for redirect after login
        
    Returns:
        bool: True if authenticated, False if redirecting to login
    """
    if not is_authenticated():
        st.warning("You must be logged in to access this page")
        
        login_url = get_login_url(page_path)
        
        # Display a more prominent login button
        st.markdown(
            f"""
            <div style="text-align: center; margin: 30px 0;">
                <p style="font-size: 18px; margin-bottom: 15px;">Please log in to continue</p>
                <a href="{login_url}" class="login-button" style="font-size: 16px; padding: 12px 24px;">
                    Login with Authentik
                </a>
            </div>
            """, 
            unsafe_allow_html=True
        )
        
        return False
    
    return True