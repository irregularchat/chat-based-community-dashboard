# app/main.py
import streamlit as st
from datetime import datetime, timedelta
import logging
from app.utils.config import Config
from app.db.session import get_db
from app.db.operations import User, AdminEvent
from app.ui.home import render_home_page
from app.ui.forms import (
    render_create_user_form,
    render_invite_form,
    display_user_list
)
from app.ui.summary import main as render_summary_page
from app.ui.help_resources import main as render_help_page
from app.ui.prompts import main as render_prompts_page
from app.ui.matrix import render_matrix_messaging_page
from app.ui.admin import render_admin_dashboard
from app.ui.signal_association import render_signal_association
from app.utils.helpers import (
    create_unique_username,
    update_username,
    get_eastern_time,
    add_timeline_event,
    handle_form_submission
)
from app.db.init_db import init_db
from app.utils.helpers import setup_logging
from app.db.models import *  # Import models to ensure tables are created
from app.auth.callback import auth_callback
from app.auth.auth_middleware import auth_middleware, admin_middleware
from app.auth.authentication import is_authenticated, require_authentication
import traceback
import requests
import os
import time

# Initialize logging first
setup_logging()

__all__ = ['initialize_session_state', 'setup_page_config', 'render_sidebar', 'render_main_content', 'main']

def initialize_session_state():
    """Initialize Streamlit session state variables"""
    if 'sync_in_progress' not in st.session_state:
        st.session_state['sync_in_progress'] = False
    if 'last_sync_time' not in st.session_state:
        st.session_state['last_sync_time'] = None
    if 'user_count' not in st.session_state:
        st.session_state['user_count'] = 0
    if 'active_users' not in st.session_state:
        st.session_state['active_users'] = 0
    if 'is_authenticated' not in st.session_state:
        st.session_state['is_authenticated'] = False
    if 'is_admin' not in st.session_state:
        st.session_state['is_admin'] = False

def setup_page_config():
    """Set up the Streamlit page configuration"""
    st.set_page_config(
        page_title=Config.PAGE_TITLE,
        page_icon=Config.FAVICON_URL,
        layout="wide",
        initial_sidebar_state="expanded"
    )

async def render_sidebar():
    """Render the sidebar navigation"""
    # Use synchronous Streamlit components
    st.sidebar.title("Navigation")
    
    # Define pages based on authentication status and admin rights
    is_authenticated = st.session_state.get('is_authenticated', False)
    is_admin = st.session_state.get('is_admin', False)
    
    # Check if we just completed authentication (within the last 5 seconds)
    recent_auth = False
    if is_authenticated and 'auth_timestamp' in st.session_state:
        auth_time = st.session_state.get('auth_timestamp', 0)
        recent_auth = (time.time() - auth_time) < 5  # Consider auth "recent" if within 5 seconds
    
    # Define page options based on authentication and admin status
    if is_authenticated:
        if is_admin:
            # Admin users get all pages
            page_options = [
                "Create User", 
                "List & Manage Users",
                "Create Invite",
                "Matrix Messages and Rooms",
                "Signal Association",
                "Settings",
                "Prompts Manager",
                "Admin Dashboard",
                "Test SMTP"  # Add the new page for admin users
            ]
        else:
            # Regular authenticated users
            page_options = [
                "Create User",
                "List & Manage Users",
                "Create Invite",
                "Matrix Messages and Rooms",
                "Signal Association",
                "Prompts Manager"  # No Settings page for non-admin users
            ]
    else:
        # Non-authenticated users only see the Create User page
        # Neither Settings nor Prompts Manager are available to non-authenticated users
        page_options = ["Create User"]
    
    # Default page is the first one in the available pages
    default_page = page_options[0] if page_options else "Create User"
    
    # Check for sidebar_selection query parameter
    selected_index = 0  # Default index
    if 'sidebar_selection' in st.query_params:
        try:
            # Get the index from the query parameter
            selection_index = int(st.query_params.get('sidebar_selection'))
            
            # Make sure the index is valid
            if 0 <= selection_index < len(page_options):
                selected_index = selection_index
                # Clear the sidebar_selection parameter to prevent redirect loops
                st.query_params.clear()
        except (ValueError, TypeError):
            # Handle invalid index values
            pass
    
    # Create the page selection dropdown
    if page_options:
        selected_page = st.sidebar.selectbox(
            "Select Page",
            page_options,
            index=selected_index,
            key='current_page'
        )
    else:
        # Fallback for empty page_options (shouldn't happen)
        selected_page = "Create User"
    
    # Show login/logout in sidebar
    st.sidebar.markdown("---")
    if is_authenticated:
        username = st.session_state.get('username', '')
        st.sidebar.write(f"Logged in as: **{username}**")
        if is_admin:
            st.sidebar.write("📊 Admin privileges")
        
        if st.sidebar.button("Logout"):
            # Clear session state and redirect
            for key in list(st.session_state.keys()):
                if key != 'current_page':
                    del st.session_state[key]
            st.session_state['is_authenticated'] = False
            st.session_state['is_admin'] = False
            st.rerun()
    else:
        # Display login button for non-authenticated users
        from app.ui.common import display_login_button
        display_login_button(location="sidebar")
    
    # If we just completed authentication and it's still recent, don't rerun again
    # This helps prevent the logout loop after login
    if is_authenticated and recent_auth:
        # Add a small visual indicator that login was successful
        st.sidebar.success("✅ Login successful!")
    
    return selected_page

async def render_main_content():
    """Render the main content area"""
    st.title("Community Dashboard")
    
    # Handle redirect query parameter first (before any other processing)
    query_params = st.query_params
    if 'redirect' in query_params:
        redirect_to = query_params.get('redirect')
        
        # Clear the redirect parameter to prevent redirect loops
        query_params.clear()
        
        # Handle specific redirects - these will be managed by the sidebar selectbox
        if redirect_to == 'admin_dashboard':
            # Initialize page options based on user's authentication status
            is_authenticated = st.session_state.get('is_authenticated', False)
            is_admin = st.session_state.get('is_admin', False)
            
            # Only redirect to Admin Dashboard if user is authenticated and admin
            if is_authenticated and is_admin:
                # We'll manually select this in the sidebar on the next rerun
                page_options = [
                    "Create User", 
                    "List & Manage Users",
                    "Create Invite",
                    "Matrix Messages and Rooms",
                    "Signal Association",
                    "Settings",
                    "Prompts Manager",
                    "Admin Dashboard",
                    "Test SMTP"
                ]
                
                # Find the index of the Admin Dashboard option
                if "Admin Dashboard" in page_options:
                    admin_index = page_options.index("Admin Dashboard")
                    # Force a rerun using URL parameters to rerender the sidebar
                    st.query_params["sidebar_selection"] = admin_index
                    st.rerun()
        
        # For other redirects, just rerun to reset the page
        st.rerun()
    
    # Check for auth_success query params next (high priority)
    if 'auth_success' in query_params and query_params.get('auth_success') == 'true':
        # Handle login success
        username = query_params.get('username', 'admin')
        is_admin = query_params.get('admin', 'false').lower() == 'true'
        auth_method = query_params.get('auth_method', 'local')
        
        # Update session state
        st.session_state['is_authenticated'] = True
        st.session_state['permanent_auth'] = True
        st.session_state['username'] = username
        st.session_state['auth_method'] = auth_method
        st.session_state['is_admin'] = is_admin
        st.session_state['permanent_admin'] = is_admin
        st.session_state['auth_timestamp'] = time.time()
        
        # Create user info
        st.session_state['user_info'] = {
            'preferred_username': username,
            'name': 'Local Administrator' if auth_method == 'local' else username,
            'email': '',
            'is_local_admin': auth_method == 'local'
        }
        
        # Show a welcome message
        st.success(f"👋 Welcome, {username}!")
        
        # Display a prominent message about admin status
        if is_admin:
            st.info("✅ You have administrator privileges")
            
        # Log the successful login
        logging.info(f"Login success page: user={username}, admin={is_admin}, method={auth_method}")
        
        # Continue rendering the normal dashboard after short delay
        time.sleep(0.5)
        
        # Clear the auth params
        clean_params = {k: v for k, v in query_params.items() 
                       if k not in ['auth_success', 'username', 'auth_method', 'admin']}
        st.query_params.update(clean_params)
        
        # After login processing, continue with rendering the main content
        
    # Check for special routes next
    if st.query_params.get('page') == 'test_login':
        # Import and render the test login page
        try:
            from app.auth.test_login import test_login_page
            test_login_page()
        except ImportError as e:
            st.error(f"Error importing test_login_page: {e}")
            st.write("Diagnostic information:")
            import sys
            import os
            
            st.code(f"Python path: {sys.path}")
            
            test_file = os.path.join('app', 'auth', 'test_login.py')
            if os.path.exists(test_file):
                st.success(f"File {test_file} exists")
            else:
                st.error(f"File {test_file} does not exist")
                
            # Check auth dir contents
            auth_dir = os.path.join('app', 'auth')
            if os.path.exists(auth_dir):
                st.success(f"Directory {auth_dir} exists")
                st.write("Files in directory:")
                for file in os.listdir(auth_dir):
                    st.write(f"- {file}")
            else:
                st.error(f"Directory {auth_dir} does not exist")
                
            # Create a direct link to manually try the auth flow
            auth_url = f"{Config.OIDC_AUTHORIZATION_ENDPOINT}?client_id={Config.OIDC_CLIENT_ID}&response_type=code&scope={'+'.join(Config.OIDC_SCOPES)}&redirect_uri={Config.OIDC_REDIRECT_URI}&state=manual-test"
            st.markdown(f"Try direct authentication: [Login]({auth_url})")
            
        return  # Return early to avoid rendering other content
    
    # Direct auth debug pathway (alternative to test_login)
    if st.query_params.get('page') == 'auth_debug':
        st.header("Authentication Debug Page")
        st.write("This page helps troubleshoot OIDC authentication issues")
        
        # Import Config here to fix the local variable error
        from app.utils.config import Config
        
        # Display OIDC configuration
        st.subheader("OIDC Configuration")
        oidc_config = {
            "OIDC_CLIENT_ID": Config.OIDC_CLIENT_ID,
            "OIDC_AUTHORIZATION_ENDPOINT": Config.OIDC_AUTHORIZATION_ENDPOINT,
            "OIDC_TOKEN_ENDPOINT": Config.OIDC_TOKEN_ENDPOINT,
            "OIDC_USERINFO_ENDPOINT": Config.OIDC_USERINFO_ENDPOINT,
            "OIDC_REDIRECT_URI": Config.OIDC_REDIRECT_URI,
            "OIDC_SCOPES": Config.OIDC_SCOPES
        }
        st.json(oidc_config)
        
        # Display session state
        st.subheader("Current Session State")
        session_state = {k: v for k, v in st.session_state.items() if k not in ['_secrets', 'password']}
        st.json(session_state)
        
        # Special login option with blank page prevention
        st.subheader("Special Login Options")
        col1, col2 = st.columns(2)
        
        with col1:
            if st.button("Login with Auto-Redirect"):
                # Set flag to auto-redirect in callback
                st.session_state['auto_redirect'] = True
                # Generate state parameter
                import uuid
                state = str(uuid.uuid4())
                st.session_state['auth_state'] = state
                
                # Create login URL
                import urllib.parse
                params = {
                    'client_id': Config.OIDC_CLIENT_ID,
                    'response_type': 'code',
                    'scope': ' '.join(Config.OIDC_SCOPES),
                    'redirect_uri': Config.OIDC_REDIRECT_URI,
                    'state': state
                }
                login_url = f"{Config.OIDC_AUTHORIZATION_ENDPOINT}?{urllib.parse.urlencode(params)}"
                
                # Redirect to login page
                st.markdown(f'<meta http-equiv="refresh" content="0;URL=\'{login_url}\'">', unsafe_allow_html=True)
        
        with col2:
            if st.button("Bypass State Validation"):
                # Use a fixed state to prevent validation failures
                fixed_state = "fixed-state-for-testing"
                
                # Create URL with fixed state
                import urllib.parse
                params = {
                    'client_id': Config.OIDC_CLIENT_ID,
                    'response_type': 'code',
                    'scope': ' '.join(Config.OIDC_SCOPES),
                    'redirect_uri': Config.OIDC_REDIRECT_URI,
                    'state': fixed_state
                }
                auth_url = f"{Config.OIDC_AUTHORIZATION_ENDPOINT}?{urllib.parse.urlencode(params)}"
                
                # Redirect to login page with fixed state
                st.markdown(f'<meta http-equiv="refresh" content="0;URL=\'{auth_url}\'">', unsafe_allow_html=True)
        
        # Instructions for users
        st.info("If you encounter a blank white page after login, wait 5 seconds and then manually navigate to /?page=auth_debug")
        
        # Add "try again" button at the bottom
        if st.button("Return to Home Page"):
            st.markdown('<meta http-equiv="refresh" content="0;URL=\'/\'">', unsafe_allow_html=True)
        
        return  # Return early
    
    # Check for auth callback parameters
    query_params = st.query_params
    if 'code' in query_params and 'state' in query_params:
        # Process authentication callback if present
        logging.info("Authentication callback detected in URL, processing...")
        
        # OPTION 1: Try to directly handle the code without going to callback page
        # This provides a fallback in case the callback page shows blank
        try:
            from app.auth.authentication import handle_auth_callback
            code = query_params.get('code')
            state = query_params.get('state')
            
            success = handle_auth_callback(code, state)
            if success:
                logging.info("Direct authentication successful!")
                st.success("Authentication successful!")
                
                # Display user info and navigation options
                user_info = st.session_state.get('user_info', {})
                st.write(f"Welcome, {user_info.get('preferred_username', 'User')}!")
                
                # Update session state to prevent reruns from losing auth state
                st.session_state['permanent_auth'] = True
                st.session_state['is_authenticated'] = True
                st.session_state['username'] = user_info.get('preferred_username', 'User')
                
                # Force a browser refresh to the main page to update UI state properly
                st.markdown('<meta http-equiv="refresh" content="1;URL=\'/\'">', unsafe_allow_html=True)
                return
            else:
                # Fall back to normal callback handling
                logging.warning("Direct authentication failed, falling back to callback page")
                auth_callback()
                return
        except Exception as e:
            logging.error(f"Error in direct auth handling: {str(e)}")
            logging.error(traceback.format_exc())
            # Fall back to normal callback handling
            auth_callback()
        return
    
    # Simple direct login route (no session state dependence)
    if st.query_params.get('page') == 'direct_login':
        st.header("Direct Login Test")
        st.info("This page provides a direct login link that doesn't rely on session state")
        
        # Import Config to avoid variable errors
        from app.utils.config import Config
        
        # Create state in URL (not session state)
        direct_state = "fixed-state-for-testing" 
        
        # Create URL-encoded parameters manually
        import urllib.parse
        auth_params = {
            'client_id': Config.OIDC_CLIENT_ID,
            'response_type': 'code',
            'scope': ' '.join(Config.OIDC_SCOPES),
            'redirect_uri': Config.OIDC_REDIRECT_URI,
            'state': direct_state
        }
        
        auth_url = f"{Config.OIDC_AUTHORIZATION_ENDPOINT}?{urllib.parse.urlencode(auth_params)}"
        
        # Display direct link
        st.markdown(f"""
        <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #f0f7ff; border-radius: 10px;">
            <h3>Follow these steps to test authentication:</h3>
            <ol style="text-align: left; max-width: 600px; margin: 0 auto; padding: 15px 30px;">
                <li>Click the green button below to initiate authentication with Authentik</li>
                <li>Log in with your Authentik credentials when prompted</li>
                <li>You will be redirected back to this application</li>
                <li>If you see a blank white page after redirect, wait 5 seconds and then go to: 
                   <a href="/?page=auth_debug">Authentication Debug Page</a>
                </li>
            </ol>
            <div style="margin-top: 20px;">
                <a href="{auth_url}" style="background-color: #4CAF50; color: white; padding: 15px 30px; 
                            text-decoration: none; border-radius: 4px; font-size: 18px; display: inline-block;">
                    Start Authentication Test
                </a>
            </div>
        </div>
        """, unsafe_allow_html=True)
        
        # Display configuration information
        st.subheader("Configuration Information")
        st.json({
            "Client ID": Config.OIDC_CLIENT_ID,
            "Redirect URI": Config.OIDC_REDIRECT_URI,
            "Authorization Endpoint": Config.OIDC_AUTHORIZATION_ENDPOINT,
            "Token Endpoint": Config.OIDC_TOKEN_ENDPOINT,
            "Userinfo Endpoint": Config.OIDC_USERINFO_ENDPOINT
        })
        
        # Display troubleshooting info
        with st.expander("Troubleshooting Tips"):
            st.markdown("""
            ### Common Issues
            
            1. **Blank white page after authentication**: This is often caused by Streamlit session state issues.
               - Navigate to `/?page=auth_debug` manually to see debugging information
               - Check that your OIDC configuration is correct
            
            2. **Authentication failure**: This can be caused by:
               - Mismatched redirect URI
               - Invalid client ID or secret
               - CSRF state validation failures
               
            3. **Import errors**: If you're seeing Python import errors, ensure:
               - All files have proper `__init__.py` files
               - The application is properly installed or in the Python path
            """)
        
        return  # Return early
    
    # Ultra direct HTML-only login page
    if st.query_params.get('page') == 'html_login':
        # Import Config explicitly to avoid variable errors
        from app.utils.config import Config
        
        st.markdown(f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Login</title>
            <style>
                body {{ font-family: Arial, sans-serif; margin: 0; padding: 0; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f5f5f5; }}
                .login-container {{ background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 500px; width: 100%; }}
                .login-button {{ display: inline-block; background-color: #4285f4; color: white; padding: 12px 20px; border-radius: 4px; text-decoration: none; font-weight: bold; }}
                h1 {{ color: #333; text-align: center; }}
                p {{ margin: 20px 0; line-height: 1.5; }}
            </style>
        </head>
        <body>
            <div class="login-container">
                <h1>Community Dashboard Login</h1>
                <p>Click the button below to login with your Authentik account.</p>
                <p style="text-align: center;">
                    <a href="{Config.OIDC_AUTHORIZATION_ENDPOINT}?client_id={Config.OIDC_CLIENT_ID}&response_type=code&scope={'+'.join(Config.OIDC_SCOPES)}&redirect_uri={Config.OIDC_REDIRECT_URI}&state=direct-html-login" class="login-button">
                        Login with Authentik
                    </a>
                </p>
                <p style="font-size: 0.9em; margin-top: 30px; color: #666; text-align: center;">
                    If you encounter any issues, please contact the administrator.
                </p>
            </div>
        </body>
        </html>
        """, unsafe_allow_html=True)
        return
    
    # Token handler page - more robust OIDC callback handling
    if st.query_params.get('page') == 'token':
        from app.auth.token_handler import token_handler_page
        token_handler_page()
        return
    
    # OIDC endpoint diagnostic page
    if st.query_params.get('page') == 'oidc_debug':
        # Import Config for endpoint diagnostics
        from app.utils.config import Config
        
        st.title("OIDC Endpoint Diagnostics")
        
        # Display all OIDC endpoints
        st.subheader("OIDC Configuration")
        st.json({
            "OIDC_CLIENT_ID": Config.OIDC_CLIENT_ID,
            "OIDC_AUTHORIZATION_ENDPOINT": Config.OIDC_AUTHORIZATION_ENDPOINT,
            "OIDC_TOKEN_ENDPOINT": Config.OIDC_TOKEN_ENDPOINT,
            "OIDC_USERINFO_ENDPOINT": Config.OIDC_USERINFO_ENDPOINT,
            "OIDC_END_SESSION_ENDPOINT": Config.OIDC_END_SESSION_ENDPOINT,
            "OIDC_REDIRECT_URI": Config.OIDC_REDIRECT_URI,
            "OIDC_SCOPES": Config.OIDC_SCOPES
        })
        
        # Test token endpoint methods
        st.subheader("Token Endpoint Test")
        if st.button("Test Token Endpoint Methods"):
            try:
                # Test OPTIONS request to get allowed methods
                st.write("Testing OPTIONS request...")
                options_response = requests.options(
                    Config.OIDC_TOKEN_ENDPOINT,
                    timeout=5
                )
                st.write(f"OPTIONS Status: {options_response.status_code}")
                if 'Allow' in options_response.headers:
                    st.success(f"Allowed methods: {options_response.headers['Allow']}")
                else:
                    st.warning("No 'Allow' header in OPTIONS response")
                
                # Test HEAD request
                st.write("Testing HEAD request...")
                head_response = requests.head(
                    Config.OIDC_TOKEN_ENDPOINT,
                    timeout=5
                )
                st.write(f"HEAD Status: {head_response.status_code}")
                
                # Test GET request
                st.write("Testing GET request...")
                get_response = requests.get(
                    Config.OIDC_TOKEN_ENDPOINT,
                    timeout=5
                )
                st.write(f"GET Status: {get_response.status_code}")
                
                # Test empty POST request
                st.write("Testing empty POST request...")
                post_response = requests.post(
                    Config.OIDC_TOKEN_ENDPOINT,
                    timeout=5
                )
                st.write(f"POST Status: {post_response.status_code}")
                
            except Exception as e:
                st.error(f"Error testing endpoint: {str(e)}")
        
        return
    
    # Special alternative login page with custom redirect
    if st.query_params.get('page') == 'alt_login':
        from app.utils.config import Config
        import uuid
        import urllib.parse
        
        st.title("Alternative Login Method")
        st.info("This page provides an alternative login method that might work better with your SSO provider.")
        
        # Create columns for the options
        c1, c2 = st.columns(2)
        
        with c1:
            st.subheader("Option 1: Use Configured Redirect URI")
            st.write("This uses the URI configured in Authentik.")
            
            # Generate state parameter
            state = str(uuid.uuid4())
            st.session_state['auth_state'] = state
            
            # Use the configured redirect URI from config
            redirect_uri = Config.OIDC_REDIRECT_URI
            
            # Create login URL with alternative redirect
            params = {
                'client_id': Config.OIDC_CLIENT_ID,
                'response_type': 'code',
                'scope': ' '.join(Config.OIDC_SCOPES),
                'redirect_uri': redirect_uri,
                'state': state
            }
            login_url = f"{Config.OIDC_AUTHORIZATION_ENDPOINT}?{urllib.parse.urlencode(params)}"
            
            if st.button("Standard Login"):
                st.markdown(f'<meta http-equiv="refresh" content="0;URL=\'{login_url}\'">', unsafe_allow_html=True)
                
        with c2:
            st.subheader("Option 2: Debug Connection")
            st.write("Test the OIDC endpoints to diagnose connection issues.")
            
            if st.button("Go to OIDC Diagnostics"):
                st.markdown('<meta http-equiv="refresh" content="0;URL=\'/?page=oidc_debug\'">', unsafe_allow_html=True)
        
        # Show the configured redirect URI
        st.markdown("---")
        st.warning(f"**Your Configured Redirect URI**: `{Config.OIDC_REDIRECT_URI}`")
        st.info("Make sure this exact URI is configured in Authentik as an allowed redirect URI.")
        
        # Add direct URL link as fallback
        st.markdown("---")
        st.markdown(f"If the button doesn't work, [click this link]({login_url})")
        
        return
    
    # Config update page
    if st.query_params.get('page') == 'update_config':
        from app.utils.config import Config
        
        st.title("Update OIDC Configuration")
        st.info("This page helps fix redirect URI mismatches between your app and Authentik.")
        
        # Display current configuration
        st.subheader("Current Configuration")
        st.json({
            "OIDC_CLIENT_ID": Config.OIDC_CLIENT_ID,
            "OIDC_REDIRECT_URI": Config.OIDC_REDIRECT_URI,
            "CONFIGURED_IN_AUTHENTIK": "http://localhost:8503/?page=token"
        })
        
        # Option to update the redirect URI
        st.subheader("Update Redirect URI")
        st.warning("There's a mismatch between your configured redirect URI and what Authentik expects")
        
        # Options for fixing
        fix_method = st.radio(
            "Choose a fix method:",
            [
                "Option 1: Change .env to match Authentik (http://localhost:8503/?page=token)",
                "Option 2: Keep .env as is and update Authentik configuration"
            ],
            index=0
        )
        
        if st.button("Apply Selected Fix"):
            if "Option 1" in fix_method:
                # Update the .env file
                try:
                    # Read the current .env file
                    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), '.env')
                    with open(env_path, 'r') as f:
                        env_content = f.readlines()
                    
                    # Update the OIDC_REDIRECT_URI line
                    updated_content = []
                    for line in env_content:
                        if line.startswith('OIDC_REDIRECT_URI'):
                            updated_content.append('OIDC_REDIRECT_URI = http://localhost:8503/?page=token\n')
                        else:
                            updated_content.append(line)
                    
                    # Write the updated content back
                    with open(env_path, 'w') as f:
                        f.writelines(updated_content)
                    
                    st.success("Updated .env file with new redirect URI: http://localhost:8503/?page=token")
                    st.info("Please restart the application for changes to take effect.")
                    
                    if st.button("Restart Now"):
                        # This will cause a rerun, which effectively restarts the app
                        st.rerun()
                except Exception as e:
                    st.error(f"Error updating .env file: {str(e)}")
            else:
                # Instructions for updating Authentik
                st.info("To update Authentik configuration:")
                st.code("""
1. Log in to your Authentik admin interface
2. Navigate to Applications > Applications
3. Find and select your OIDC application
4. Under "Settings" tab, find the "Redirect URIs/Origins" section
5. Add this URI as an allowed redirect URI: http://localhost:8503/auth/callback
6. Save changes
                """)
                st.warning("After updating Authentik, you'll need to wait a few minutes for changes to propagate.")
        
        # Add navigation buttons
        st.markdown("---")
        if st.button("Go Back to Login Page"):
            st.markdown('<meta http-equiv="refresh" content="0;URL=\'/\'">', unsafe_allow_html=True)
        
        return
    
    # Authentik client authentication config page
    if st.query_params.get('page') == 'auth_config':
        from app.utils.config import Config
        import json
        
        st.title("Authentik Client Authentication Configuration")
        st.info("This page helps troubleshoot and fix client authentication issues with Authentik.")
        
        # Display current error
        st.error("Current Error: **invalid_client** - Client authentication failed")
        st.warning("Authentik may be expecting a different authentication method than what we're using.")
        
        # Display OIDC configuration
        st.subheader("Current OIDC Configuration")
        client_config = {
            "OIDC_CLIENT_ID": Config.OIDC_CLIENT_ID,
            "OIDC_TOKEN_ENDPOINT": Config.OIDC_TOKEN_ENDPOINT,
            "OIDC_REDIRECT_URI": Config.OIDC_REDIRECT_URI,
            "Authentik Redirect URI (from screenshot)": "http://localhost:8503/auth/callback"
        }
        st.json(client_config)
        
        # Authentication methods
        st.subheader("Authentication Methods")
        st.write("Select which authentication method to try:")
        
        auth_method = st.radio(
            "Client Authentication Method",
            [
                "HTTP Basic Auth (send credentials in Authorization header)",
                "Client Secret Post (send credentials in request body)",
                "None (public client)",
                "Try all methods (recommended)"
            ],
            index=3
        )
        
        if st.button("Save Configuration"):
            # Set in session state for now
            method_map = {
                "HTTP Basic Auth (send credentials in Authorization header)": "basic",
                "Client Secret Post (send credentials in request body)": "post",
                "None (public client)": "none",
                "Try all methods (recommended)": "all"
            }
            
            st.session_state['auth_method_preference'] = method_map.get(auth_method, "all")
            st.success(f"Set authentication method preference to: {method_map.get(auth_method, 'all')}")
            
            # Create a new auth URL to try
            import uuid
            from urllib.parse import urlencode
            
            state = str(uuid.uuid4())
            st.session_state['auth_state'] = state
            
            params = {
                'client_id': Config.OIDC_CLIENT_ID,
                'response_type': 'code',
                'scope': ' '.join(Config.OIDC_SCOPES),
                'redirect_uri': Config.OIDC_REDIRECT_URI,
                'state': state
            }
            
            auth_url = f"{Config.OIDC_AUTHORIZATION_ENDPOINT}?{urlencode(params)}"
            st.info("Ready to try authentication with new method")
            
            if st.button("Start Authentication"):
                st.markdown(f'<meta http-equiv="refresh" content="0;URL=\'{auth_url}\'">', unsafe_allow_html=True)
        
        # Manual configuration for Authentik
        st.subheader("Authentik Provider Configuration")
        st.write("You may need to configure Authentik to match the expected authentication method:")
        
        st.code("""
1. In Authentik admin, go to Providers > OAuth2/OpenID Providers
2. Find and edit your provider (mod dashboard)
3. Under "Client Authentication" make sure the expected method is selected:
   - For public clients: Select "None"
   - For confidential clients: Select "client_secret_post" or "client_secret_basic"
4. Save changes and try authenticating again
        """)
        
        if st.button("Go Back"):
            st.markdown('<meta http-equiv="refresh" content="0;URL=\'/\'">', unsafe_allow_html=True)
        
        return
    
    # Get the current page directly from the widget
    current_page = st.session_state.get('current_page', 'Create User')
    is_admin = st.session_state.get('is_admin', False)
    is_authenticated = st.session_state.get('is_authenticated', False)
    
    # Handle unauthenticated users
    if current_page in ["Prompts Manager", "Settings"] and not is_authenticated:
        # Require authentication for sensitive pages
        from app.ui.common import display_login_button
        st.markdown("## Authentication Required")
        st.markdown("You must login to access this page.")
        display_login_button(location="main")
        return
    
    # Global authentication check for most pages (except Create User)
    if not is_authenticated and current_page != "Create User":
        # Show login page instead of the requested page
        from app.ui.common import display_login_button
        st.markdown("## Welcome to the Community Dashboard")
        st.markdown("Please log in to access all features.")
        display_login_button(location="main")
        return
    
    # Display welcome message for authenticated users
    username = st.session_state.get('user_info', {}).get('preferred_username', 'Guest')
    if username and username != 'Guest':
        st.write(f"## Welcome, {username}!")
    
    try:
        # Import UI components only when needed to avoid circular imports
        if current_page == "Create User":
            # Protect with admin check
            if st.session_state.get('is_admin', False):
                await render_create_user_form()
            else:
                st.error("You need administrator privileges to access this page.")
                st.info("Please contact an administrator if you need to create a user account.")
        
        elif current_page == "Create Invite":
            await render_invite_form()
            
        elif current_page == "List & Manage Users":
            await display_user_list()
            
        elif current_page == "Matrix Messages and Rooms":
            await render_matrix_messaging_page()
            
        elif current_page == "Signal Association":
            render_signal_association()
            
        elif current_page == "Settings":
            # Protect with admin check
            if is_admin:
                from app.pages.settings import render_settings_page
                render_settings_page()
            else:
                st.error("You need administrator privileges to access this page.")
                
        elif current_page == "Prompts Manager":
            # Additional authentication check to ensure no unauthenticated access
            if is_authenticated:
                from app.pages.prompts_manager import render_prompts_manager
                render_prompts_manager()
            else:
                from app.ui.common import display_login_button
                st.markdown("## Authentication Required")
                st.markdown("You must login to access the Prompts Manager.")
                display_login_button(location="main")
            
        elif current_page == "Admin Dashboard":
            # Protect with admin check
            if st.session_state.get('is_admin', False):
                render_admin_dashboard()
            else:
                st.error("You need administrator privileges to access this page.")

        elif current_page == "Test SMTP":
            # Protect with admin check
            if st.session_state.get('is_admin', False):
                await test_smtp_connection()
            else:
                st.error("You need administrator privileges to access this page.")
    except Exception as e:
        st.error(f"Error rendering content: {str(e)}")
        logging.error(f"Error in render_main_content: {str(e)}", exc_info=True)

async def test_smtp_connection():
    """Test SMTP connection and settings"""
    try:
        from app.utils.helpers import test_email_connection
        # Test the email connection
        result = test_email_connection()
        if result:
            st.success("SMTP connection test successful! Email sending should work.")
        else:
            st.error("SMTP connection test failed. Check your SMTP settings and logs.")
            
        # Display current SMTP settings
        from app.utils.config import Config
        st.subheader("Current SMTP Configuration")
        st.json({
            "SMTP_SERVER": Config.SMTP_SERVER,
            "SMTP_PORT": Config.SMTP_PORT,
            "SMTP_USERNAME": Config.SMTP_USERNAME,
            "SMTP_FROM_EMAIL": Config.SMTP_FROM_EMAIL,
            "SMTP_ACTIVE": Config.SMTP_ACTIVE,
            "SMTP_BCC": Config.SMTP_BCC
        })
        
        return True
    except Exception as e:
        st.error(f"Error testing SMTP connection: {str(e)}")
        return False

async def main():
    """Main application entry point"""
    try:
        # Initialize the application
        setup_page_config()
        initialize_session_state()
        
        # Check for auth_success query parameter (more reliable than session state persistence)
        query_params = st.query_params
        if 'auth_success' in query_params and query_params.get('auth_success') == 'true':
            logging.info("Detected auth_success query parameter - setting auth state")
            st.session_state['is_authenticated'] = True
            st.session_state['permanent_auth'] = True
            
            # Get username and auth method from query params
            username = query_params.get('username', 'admin')
            auth_method = query_params.get('auth_method', 'local')
            
            # Set admin status from query params
            is_admin = query_params.get('admin', 'false').lower() == 'true'
            st.session_state['is_admin'] = is_admin
            st.session_state['permanent_admin'] = is_admin
            
            # Set additional session info
            st.session_state['username'] = username
            st.session_state['auth_method'] = auth_method
            st.session_state['auth_timestamp'] = time.time()
            
            # Create minimal user info
            st.session_state['user_info'] = {
                'preferred_username': username,
                'name': username,
                'email': '',
                'is_local_admin': auth_method == 'local'
            }
            
            # Clear the URL to avoid repeating the login on refresh
            logging.info(f"Auth state restored from query params: user={username}, admin={is_admin}")
            
            # Replace URL with clean one without losing other query params
            clean_params = {k: v for k, v in query_params.items() 
                           if k not in ['auth_success', 'username', 'auth_method', 'admin']}
            st.query_params.update(clean_params)
        
        # Also check for permanent auth flag as a backup method
        elif st.session_state.get('permanent_auth', False) and not st.session_state.get('is_authenticated', False):
            # Restore authentication state from permanent flag
            logging.info("Restoring authentication state from permanent flag")
            st.session_state['is_authenticated'] = True
            
            # Also restore admin status if it was set
            if st.session_state.get('permanent_admin', False):
                logging.info("Restoring admin status from permanent flag")
                st.session_state['is_admin'] = True
                
            # Log detailed session restoration for debugging
            logging.info(f"Session state after restoration: auth={st.session_state.get('is_authenticated')}, admin={st.session_state.get('is_admin')}")
        
        # Initialize database
        init_db()
        
        # Using direct authentication instead of Flask auth server
        logging.info("Using direct authentication instead of Flask auth server")
        
        # Validate OIDC configuration
        logging.info("=== Validating OIDC Configuration ===")
        if Config.validate_oidc_config():
            logging.info("✅ OIDC configuration validated successfully")
        else:
            logging.error("⚠️ OIDC configuration has issues - authentication may not work properly")
            if st.session_state.get('is_admin', False):
                st.warning("The OIDC configuration has issues - authentication may not work properly. Please check the application logs.")
        
        # Log configuration status
        logging.info("=== Checking Discourse Integration Configuration ===")
        if Config.DISCOURSE_URL:
            logging.info(f"DISCOURSE_URL is configured: {Config.DISCOURSE_URL}")
        else:
            logging.warning("DISCOURSE_URL is not configured")
        
        if Config.DISCOURSE_API_KEY:
            logging.info("DISCOURSE_API_KEY is configured")
        else:
            logging.warning("DISCOURSE_API_KEY is not configured")
        
        if Config.DISCOURSE_API_USERNAME:
            logging.info(f"DISCOURSE_API_USERNAME is configured: {Config.DISCOURSE_API_USERNAME}")
        else:
            logging.warning("DISCOURSE_API_USERNAME is not configured")
        
        if Config.DISCOURSE_CATEGORY_ID:
            logging.info(f"DISCOURSE_CATEGORY_ID is configured: {Config.DISCOURSE_CATEGORY_ID}")
        else:
            logging.warning("DISCOURSE_CATEGORY_ID is not configured")
        
        if Config.DISCOURSE_INTRO_TAG:
            logging.info(f"DISCOURSE_INTRO_TAG is configured: {Config.DISCOURSE_INTRO_TAG}")
        else:
            logging.info("DISCOURSE_INTRO_TAG is not configured (optional)")
        
        if all([Config.DISCOURSE_URL, Config.DISCOURSE_API_KEY, 
                Config.DISCOURSE_API_USERNAME, Config.DISCOURSE_CATEGORY_ID]):
            logging.info("✅ Discourse integration is fully configured")
        else:
            logging.warning("⚠️ Discourse integration is not fully configured")
        
        # Render the sidebar and get selected page
        # The selectbox widget will automatically update st.session_state.current_page
        await render_sidebar()
        
        # Render the main content based on the current page in session state
        await render_main_content()
        
    except Exception as e:
        st.error(f"An error occurred: {str(e)}")
        logging.error(f"Application error: {str(e)}", exc_info=True)

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())

# auth/api.py: Handle all API interactions with Authentik and Shlink.
# auth/encryption.py: Manage encryption and decryption functionalities.
# ui/forms.py: Render and handle user input forms.
# ui/home.py: Manage the main UI components and layout.
# utils/config.py: Centralize configuration management.
# messages.py: Handle user-facing messages and notifications.