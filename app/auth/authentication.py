import streamlit as st
import requests
import logging
import urllib.parse
import uuid
from datetime import datetime
from app.utils.config import Config
from app.auth.local_auth import display_local_login_form

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
    expected_state = st.session_state.get('auth_state')
    if state != expected_state:
        logging.error(f"Invalid state parameter in authentication callback. Received: {state}, Expected: {expected_state}")
        return False
    
    # Log authentication details
    logging.info(f"Authenticating with code: {code[:5]}... (truncated), state: {state}")
    logging.info(f"Using redirect URI: {Config.OIDC_REDIRECT_URI}")
    
    # Exchange the code for tokens
    try:
        # Log token endpoint
        logging.info(f"Token endpoint: {Config.OIDC_TOKEN_ENDPOINT}")
        
        # Prepare token request data
        token_data = {
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': Config.OIDC_REDIRECT_URI,
            'client_id': Config.OIDC_CLIENT_ID,
            'client_secret': Config.OIDC_CLIENT_SECRET
        }
        
        # Log token request data (excluding client_secret)
        safe_token_data = token_data.copy()
        safe_token_data['client_secret'] = '*****'
        logging.info(f"Token request data: {safe_token_data}")
        
        # Make the token request
        token_response = requests.post(
            Config.OIDC_TOKEN_ENDPOINT,
            data=token_data,
            timeout=10
        )
        
        # Check response status
        if token_response.status_code != 200:
            logging.error(f"Token response error: Status {token_response.status_code}")
            logging.error(f"Token response content: {token_response.text}")
            return False
            
        token_data = token_response.json()
        
        # Get the access token
        access_token = token_data.get('access_token')
        if not access_token:
            logging.error("No access token in token response")
            logging.error(f"Token response: {token_data}")
            return False
        
        logging.info("Access token received successfully")
        
        # Get user info
        user_response = requests.get(
            Config.OIDC_USERINFO_ENDPOINT,
            headers={'Authorization': f'Bearer {access_token}'},
            timeout=10
        )
        
        # Check user info response status
        if user_response.status_code != 200:
            logging.error(f"User info response error: Status {user_response.status_code}")
            logging.error(f"User info response content: {user_response.text}")
            return False
            
        user_data = user_response.json()
        
        # Log user data (excluding sensitive information)
        safe_user_data = user_data.copy() if isinstance(user_data, dict) else {}
        for key in ['sub', 'email', 'preferred_username']:
            if key in safe_user_data:
                safe_user_data[key] = f"{safe_user_data[key][:3]}..." if safe_user_data[key] else None
        logging.info(f"User data received: {safe_user_data}")
        
        # Store user data in session state
        st.session_state['is_authenticated'] = True
        st.session_state['user_info'] = user_data
        st.session_state['access_token'] = access_token
        st.session_state['session_start_time'] = datetime.now()
        st.session_state['auth_method'] = 'sso'  # Set auth_method to 'sso'
        
        # Check if user is admin
        from app.auth.admin import check_admin_permission
        preferred_username = user_data.get('preferred_username', '')
        is_admin = check_admin_permission(preferred_username)
        st.session_state['is_admin'] = is_admin
        
        logging.info(f"Authentication successful for user: {preferred_username[:3]}...")
        return True
        
    except requests.exceptions.RequestException as e:
        logging.error(f"Request error in authentication callback: {e}")
        return False
    except ValueError as e:
        logging.error(f"JSON parsing error in authentication callback: {e}")
        return False
    except Exception as e:
        logging.error(f"Unexpected error in authentication callback: {e}")
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
        'is_admin',
        'auth_method'  # Add auth_method to the list of keys to clear
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
        
        # Create tabs for different login methods
        try:
            sso_tab, local_tab = st.tabs(["Login with SSO", "Local Admin Login"])
            
            with sso_tab:
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
            
            with local_tab:
                # Display local login form
                if display_local_login_form():
                    # If login was successful, refresh the page
                    st.rerun()
        except ValueError:
            # Fallback for test environments where tabs might not work properly
            login_url = get_login_url(page_path)
            
            # Display login options without tabs
            st.markdown("### Login with SSO")
            st.markdown(
                f"""
                <div style="text-align: center; margin: 30px 0;">
                    <a href="{login_url}" class="login-button" style="font-size: 16px; padding: 12px 24px;">
                        Login with Authentik
                    </a>
                </div>
                """, 
                unsafe_allow_html=True
            )
            
            st.markdown("### Local Admin Login")
            # Always call display_local_login_form in the fallback path to ensure it's called in tests
            login_result = display_local_login_form()
            if login_result:
                # If login was successful, refresh the page
                st.rerun()
        
        return False
    
    return True