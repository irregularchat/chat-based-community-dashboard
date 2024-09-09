# app/main.py
import streamlit as st
from ui.home import render_home_page
from authentik_streamlit import AUTHENTIK_API_TOKEN, MAIN_GROUP_ID  # Import env vars from authentik-streamlit.py
from dotenv import load_dotenv

# Load environment variables
load_dotenv(dotenv_path='../.env')
# Set page config
PAGE_TITLE = os.getenv("PAGE_TITLE", "Authentik Account Creation App")
FAVICON_URL = os.getenv("FAVICON_URL", ":lock:")
st.set_page_config(page_title=PAGE_TITLE, page_icon=FAVICON_URL)

# Render the home page
render_home_page()