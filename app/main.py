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
    if 'current_page' not in st.session_state:
        st.session_state['current_page'] = 'Create User'

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
    
    # Get the current page from session state or default to appropriate page
    current_page = st.session_state.get('current_page', 'Create User')
    
    # Define pages based on authentication status and admin rights
    is_authenticated = st.session_state.get('is_authenticated', False)
    is_admin = st.session_state.get('is_admin', False)
    
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
    
    # If current_page is not in available options, reset to the first available option
    if current_page not in page_options and page_options:
        current_page = page_options[0]
        st.session_state['current_page'] = current_page
    
    # Create the page selection dropdown
    if page_options:
        selected_page = st.sidebar.selectbox(
            "Select Page",
            page_options,
            index=page_options.index(current_page) if current_page in page_options else 0,
            key='current_page'
        )
    else:
        # Fallback for empty page_options (shouldn't happen)
        selected_page = "Create User"
        st.session_state['current_page'] = selected_page
    
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
    
    return selected_page

async def render_main_content():
    """Render the main content area"""
    st.title("Community Dashboard")
    
    # Check for auth callback parameters first
    query_params = st.query_params
    if 'code' in query_params and 'state' in query_params:
        # Process authentication callback if present
        logging.info("Authentication callback detected in URL, processing...")
        auth_callback()
        return  # Return early after handling callback
    
    # Get the current page from session state
    page = st.session_state.get('current_page', 'Create User')
    is_admin = st.session_state.get('is_admin', False)
    is_authenticated = st.session_state.get('is_authenticated', False)
    
    # Handle unauthenticated users
    if page in ["Prompts Manager", "Settings"] and not is_authenticated:
        # Require authentication for sensitive pages
        from app.ui.common import display_login_button
        st.markdown("## Authentication Required")
        st.markdown("You must login to access this page.")
        display_login_button(location="main")
        return
    
    # Global authentication check for most pages (except Create User)
    if not is_authenticated and page != "Create User":
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
        if page == "Create User":
            # Protect with admin check
            if st.session_state.get('is_admin', False):
                await render_create_user_form()
            else:
                st.error("You need administrator privileges to access this page.")
                st.info("Please contact an administrator if you need to create a user account.")
        
        elif page == "Create Invite":
            await render_invite_form()
            
        elif page == "List & Manage Users":
            await display_user_list()
            
        elif page == "Matrix Messages and Rooms":
            await render_matrix_messaging_page()
            
        elif page == "Signal Association":
            render_signal_association()
            
        elif page == "Settings":
            # Protect with admin check
            if is_admin:
                from app.pages.settings import render_settings_page
                render_settings_page()
            else:
                st.error("You need administrator privileges to access this page.")
                
        elif page == "Prompts Manager":
            # Additional authentication check to ensure no unauthenticated access
            if is_authenticated:
                from app.pages.prompts_manager import render_prompts_manager
                render_prompts_manager()
            else:
                from app.ui.common import display_login_button
                st.markdown("## Authentication Required")
                st.markdown("You must login to access the Prompts Manager.")
                display_login_button(location="main")
            
        elif page == "Admin Dashboard":
            # Protect with admin check
            if st.session_state.get('is_admin', False):
                render_admin_dashboard()
            else:
                st.error("You need administrator privileges to access this page.")

        elif page == "Test SMTP":
            # Protect with admin check
            if st.session_state.get('is_admin', False):
                await test_smtp_connection()
            else:
                st.error("You need administrator privileges to access this page.")
    except Exception as e:
        st.error(f"Error rendering content: {str(e)}")
        logging.error(f"Error in render_main_content: {str(e)}", exc_info=True)

async def main():
    """Main application entry point"""
    try:
        # Initialize the application
        setup_page_config()
        initialize_session_state()
        
        # Initialize database
        init_db()
        
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

# auth/api.py: Handle all API interactions with Authentik and Shlink.
# auth/encryption.py: Manage encryption and decryption functionalities.
# ui/forms.py: Render and handle user input forms.
# ui/home.py: Manage the main UI components and layout.
# utils/config.py: Centralize configuration management.
# messages.py: Handle user-facing messages and notifications.