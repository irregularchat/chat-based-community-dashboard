from dotenv import load_dotenv
import os
import streamlit as st
import pandas as pd
from authentik_streamlit import (
    create_user, generate_recovery_link, create_invite, list_users, 
    update_LOCAL_DB, search_LOCAL_DB, shorten_url, update_user_status, 
    reset_user_password, delete_user, update_user_intro, update_user_invited_by,
    display_message, clear_session_state, create_unique_username, get_existing_usernames,
    display_user_list
)
from datetime import datetime, timedelta
from pytz import timezone
from messages import (
    create_user_message, create_recovery_message, create_invite_message
)
""" Must contain create handle_form_submission and render_home_page functions """

# Load environment variables
load_dotenv(dotenv_path='../.env')

# Define headers for Authentik API requests
BASE_DOMAIN = os.getenv("BASE_DOMAIN")
AUTHENTIK_API_URL = os.getenv("AUTHENTIK_API_URL")
AUTHENTIK_API_TOKEN = os.getenv("AUTHENTIK_API_TOKEN")
PAGE_TITLE = os.getenv("PAGE_TITLE")
FAVICON_URL = os.getenv("FAVICON_URL")

headers = {
    "Authorization": f"Bearer {AUTHENTIK_API_TOKEN}",
    "Content-Type": "application/json"
}

# Handle form submissions based on operation selected
def handle_form_submission(operation, username_input, email_input, invited_by, intro, expires_date, expires_time, first_name, last_name):
    try:
        if operation == "Create User":
            update_LOCAL_DB()
            user_exists = search_LOCAL_DB(username_input)
            if not user_exists.empty:
                st.warning(f"User {username_input} already exists.")
                existing_usernames = get_existing_usernames(AUTHENTIK_API_URL, headers)
                new_username = create_unique_username(username_input, existing_usernames)
            else:
                new_username = username_input

            email = email_input if email_input else f"{new_username}@{BASE_DOMAIN}"
            full_name = f"{first_name.strip()} {last_name.strip()}"
            
            # Ensure intro and invited_by are passed when creating the user
            new_user = create_user(AUTHENTIK_API_URL, headers, new_username, email, full_name, intro, invited_by)

            if new_user is None:
                st.warning(f"Username {new_username} might already exist.")
            else:
                shortened_recovery_link = shorten_url(generate_recovery_link(AUTHENTIK_API_URL, headers, new_username), 'first-login', new_username)
                create_user_message(new_username, shortened_recovery_link)

        elif operation == "Generate Recovery Link":
            recovery_link = generate_recovery_link(AUTHENTIK_API_URL, headers, username_input)
            create_recovery_message(username_input, recovery_link)

        elif operation == "Create Invite":
            if expires_date and expires_time:
                local_expires = datetime.combine(expires_date, expires_time)
                expires = local_expires.isoformat()
            else:
                expires = None
            
            invite_link, invite_expires = create_invite(headers, username_input, expires)
            create_invite_message(username_input, invite_link, invite_expires)

        elif operation == "List Users":
            users = list_users(AUTHENTIK_API_URL, headers, username_input if username_input else None)
            st.session_state['user_list'] = users
            st.session_state['message'] = "Users listed successfully!"
    
    except Exception as e:
        st.error(f"An error occurred: {e}")

# Define the function to render the home page with dynamic fields based on the operation
def render_home_page():
    # Set page configuration and title
    st.set_page_config(page_title=PAGE_TITLE, page_icon=FAVICON_URL)
    st.title(PAGE_TITLE)

    # Display useful links
    st.markdown("""
    ## Useful Links:
    - [Login to IrregularChat SSO](https://sso.irregularchat.com)
    - [Use Signal CopyPasta for Welcome Messages](https://wiki.irregularchat.com/en/community/chat/admin/signal-prompts)
    - [Admin Prompts for Common Situations](https://wiki.irregularchat.com/community/chat/admin.md)
    - [Links to Community Chats and Services](https://wiki.irregularchat.com/community/links.md)
    """)

    # Fetch user list only once, on first load
    if 'user_list' not in st.session_state:
        st.session_state['user_list'] = []

    if 'selected_users' not in st.session_state:
        st.session_state['selected_users'] = []

    # Move the operation dropdown OUTSIDE the form to avoid the callback restriction
    operation = st.selectbox("Select Operation", [
        "Create User", 
        "Generate Recovery Link", 
        "Create Invite",
        "List Users"
    ], key="operation_selection")

    # Form Section
    with st.form(key="user_management_form"):
        # Show/Hide fields based on the operation selected
        if operation == "Create User":
            # Fields for creating a user
            col1, col2 = st.columns(2)
            with col1:
                first_name = st.text_input("Enter First Name", key="first_name_input")
            with col2:
                last_name = st.text_input("Enter Last Name", key="last_name_input")

            username_input = st.text_input("Username", key="username_input")
            
            col1, col2 = st.columns(2)
            with col1:
                email_input = st.text_input("Enter Email Address (optional)", key="email_input")
            with col2:
                invited_by = st.text_input("Invited by (optional)", key="invited_by_input")

            intro = st.text_area("Intro (optional)", height=2, key="intro_input")
            expires_date, expires_time = None, None

        elif operation == "Generate Recovery Link":
            # Only username for recovery link
            username_input = st.text_input("Username", key="username_input")
            first_name, last_name, email_input, invited_by, intro, expires_date, expires_time = [None] * 7

        elif operation == "Create Invite":
            # Only username and invite expiration details for invite creation
            username_input = st.text_input("Username", key="username_input")
            first_name, last_name, email_input, invited_by, intro = [None] * 5

            expires_default = datetime.now() + timedelta(hours=2)
            expires_date = st.date_input("Enter Expiration Date (optional)", value=expires_default.date())
            expires_time = st.time_input("Enter Expiration Time (optional)", value=expires_default.time())

        elif operation == "List Users":
            # Only username input for searching users
            username_input = st.text_input("Search Users by Username (optional)", key="username_input")
            first_name, last_name, email_input, invited_by, intro, expires_date, expires_time = [None] * 7

        # Submit button for form
        submit_button = st.form_submit_button("Submit")

    # Form handling logic
    if submit_button:
        handle_form_submission(
            operation, 
            username_input, 
            email_input, 
            invited_by, 
            intro, 
            expires_date, 
            expires_time,
            first_name,
            last_name
        )

    # Call the display_user_list function to handle listing and user actions
    display_user_list(AUTHENTIK_API_URL, headers)

# Call render home page to display the form
render_home_page()