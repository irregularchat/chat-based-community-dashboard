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
    
    # Get the current page from session state or default to "Create User"
    current_page = st.session_state.get('current_page', 'Create User')
    
    # Create the page selection dropdown
    selected_page = st.sidebar.selectbox(
        "Select Page",
        [
            "Create User",
            "Create Invite",
            "List & Manage Users",
            "Matrix Messages and Rooms",
            "Signal Association",
            "Settings",
            "Prompts Manager",
            "Admin Dashboard"
        ],
        index=0 if current_page not in st.session_state else None,
        key='current_page'
    )
    
    return selected_page

async def render_main_content():
    """Render the main content area"""
    st.title("Community Dashboard")
    
    # Process authentication callback if present
    auth_callback()
    
    # Get the current page from session state
    page = st.session_state.get('current_page', 'Create User')
    
    try:
        # Import UI components only when needed to avoid circular imports
        if page == "Create User":
            await render_create_user_form()
        elif page == "Create Invite":
            # Protect with authentication
            if require_authentication(page):
                await render_invite_form()
        elif page == "List & Manage Users":
            # Protect with authentication
            if require_authentication(page):
                await display_user_list()
        elif page == "Matrix Messages and Rooms":
            # Protect with authentication
            if require_authentication(page):
                await render_matrix_messaging_page()
        elif page == "Signal Association":
            # Protect with authentication
            if require_authentication(page):
                render_signal_association()
        elif page == "Settings":
            # Protect with authentication and admin check
            if require_authentication(page) and st.session_state.get('is_admin', False):
                from app.pages.settings import render_settings_page
                render_settings_page()
            elif is_authenticated() and not st.session_state.get('is_admin', False):
                st.error("You need administrator privileges to access this page.")
        elif page == "Prompts Manager":
            # Protect with authentication
            if require_authentication(page):
                from app.pages.prompts_manager import render_prompts_manager
                render_prompts_manager()
        elif page == "Admin Dashboard":
            # Protect with authentication and admin check
            if require_authentication(page) and st.session_state.get('is_admin', False):
                render_admin_dashboard()
            elif is_authenticated() and not st.session_state.get('is_admin', False):
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
        
        # Initialize current_page in session state if not present
        if 'current_page' not in st.session_state:
            st.session_state['current_page'] = 'Create User'
        
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