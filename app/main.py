# app/main.py
import streamlit as st
from utils.config import Config
from ui.home import render_home_page
from ui.summary import main as render_summary_page
from ui.help_resources import main as render_help_page
from ui.prompts import main as render_prompts_page
from ui.matrix import render_matrix_messaging_page
from utils.helpers import setup_logging
import logging
from db.database import get_db
from db.init_db import init_db

# Initialize logging
setup_logging()

# Initialize database tables
init_db()

# Log configuration status for Discourse integration
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

# Set page config early
st.set_page_config(
    page_title=Config.PAGE_TITLE,
    page_icon=Config.FAVICON_URL,
    layout="wide"
)


def main():
    try:
        # Get a database session
        db_session = next(get_db())

        # Now, db_session can be used to query or write to the DB
        # E.g.: results = db_session.query(YourModel).all()

        st.write("Database session is ready to use!")

        # Add a selectbox for navigation with action-focused options
        page = st.sidebar.selectbox(
            "Select Action",
            ["Dashboard", "Create User", "Matrix Messaging", "Create Invite", "List & Manage Users", "Settings"]
        )

        # Set session state based on selected action
        if page == "Dashboard":
            # Clear form-specific session state
            st.session_state['show_create_user'] = False
            st.session_state['show_invite_form'] = False
            st.session_state['show_user_list'] = False
        elif page == "Create User":
            st.session_state['show_create_user'] = True
            st.session_state['show_invite_form'] = False
            st.session_state['show_user_list'] = False
        elif page == "Create Invite":
            st.session_state['show_create_user'] = False
            st.session_state['show_invite_form'] = True
            st.session_state['show_user_list'] = False
        elif page == "List & Manage Users":
            st.session_state['show_create_user'] = False
            st.session_state['show_invite_form'] = False
            st.session_state['show_user_list'] = True
        elif page == "Matrix Messaging":
            # Clear form-specific session state
            st.session_state['show_create_user'] = False
            st.session_state['show_invite_form'] = False
            st.session_state['show_user_list'] = False
        elif page == "Settings":
            # Clear form-specific session state
            st.session_state['show_create_user'] = False
            st.session_state['show_invite_form'] = False
            st.session_state['show_user_list'] = False
        
        # Render the selected page
        if page == "Dashboard":
            render_home_page()
        elif page in ["Create User", "Create Invite", "List & Manage Users"]:
            render_home_page()
        elif page == "Matrix Messaging":
            render_matrix_messaging_page()
        elif page == "Settings":
            # Import and render the settings page
            from pages.settings import render_settings_page
            render_settings_page()
    except Exception as e:
        st.error(f"An unexpected error occurred: {e}")
        logging.error(f"Unexpected error in main: {e}")

if __name__ == "__main__":
    main()





# auth/api.py: Handle all API interactions with Authentik and Shlink.
# auth/encryption.py: Manage encryption and decryption functionalities.
# ui/forms.py: Render and handle user input forms.
# ui/home.py: Manage the main UI components and layout.
# utils/config.py: Centralize configuration management.
# messages.py: Handle user-facing messages and notifications.
