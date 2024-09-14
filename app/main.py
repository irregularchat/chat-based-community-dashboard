# app/main.py
import streamlit as st
from utils.config import Config
from ui.home import render_home_page
from utils.helpers import setup_logging
import logging

# Initialize logging
setup_logging()

# Set page config early
st.set_page_config(page_title=Config.PAGE_TITLE, page_icon=Config.FAVICON_URL)

def main():
    try:
        render_home_page()
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
