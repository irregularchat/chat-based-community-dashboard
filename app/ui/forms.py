# /app/ui/forms.py
from dotenv import load_dotenv
import os
import streamlit as st
import pandas as pd
from authentik_streamlit import (
    create_user, generate_recovery_link, create_invite, list_users, 
    update_LOCAL_DB, search_LOCAL_DB, shorten_url, update_user_status, 
    reset_user_password, delete_user, update_user_intro, update_user_invited_by,
    display_message, clear_session_state, create_unique_username, get_existing_usernames,
    display_user_list, BASE_DOMAIN, AUTHENTIK_API_URL, AUTHENTIK_API_TOKEN, headers,
    PAGE_TITLE, FAVICON_URL
)
from datetime import datetime, timedelta
from pytz import timezone
from messages import (
    create_user_message, create_recovery_message, create_invite_message
)
def render_create_user_form():
    first_name = st.text_input("Enter First Name")
    last_name = st.text_input("Enter Last Name")
    email_input = st.text_input("Enter Email Address (optional)")
    invited_by = st.text_input("Invited by (optional)")
    intro = st.text_area("Intro (optional)", height=2)
    return first_name, last_name, email_input, invited_by, intro

def render_invite_form():
    invite_label = st.text_input("Invite Label")
    expires_default = datetime.now() + timedelta(hours=2)
    expires_date = st.date_input("Enter Expiration Date", value=expires_default.date())
    expires_time = st.time_input("Enter Expiration Time", value=expires_default.time())
    return invite_label, expires_date, expires_time
