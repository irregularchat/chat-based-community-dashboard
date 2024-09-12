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
    PAGE_TITLE, FAVICON_URL, MAIN_GROUP_ID
)
from datetime import datetime, timedelta
from pytz import timezone
from messages import (
    create_user_message, create_recovery_message, create_invite_message,
)
from .forms import (
    render_create_user_form, render_invite_form
)
from auth.session_init import initialize_session_state
# Call set_page_config as the very first Streamlit command
st.set_page_config(page_title=PAGE_TITLE, page_icon=FAVICON_URL)
# Call the function to initialize session state
initialize_session_state()


# Cached list users to avoid re-fetching too often
@st.cache_data(ttl=600)  # Cache for 10 minutes
def list_users_cached(authentik_api_url, headers, username_input=None):
    return list_users(authentik_api_url, headers, username_input)
# Ensure session state for username exists
if 'username_input' not in st.session_state:
    st.session_state['username_input'] = ''

# Text input field for username with session state
username_input = st.text_input("Username", value=st.session_state['username_input'])

# Update session state with the input value
if username_input:
    st.session_state['username_input'] = username_input

# Display the updated username
st.write(f"Current Username: {st.session_state['username_input']}")

def get_user_list():
    """Retrieve the list of users from session state."""
    return st.session_state.get('user_list', [])

def set_user_list(users):
    """Set the list of users in session state."""
    st.session_state['user_list'] = users
def update_username():
    st.session_state['username_input'] = st.session_state['temp_username']

st.text_input("Username", key="temp_username", on_change=update_username)
st.write(f"Current Username: {st.session_state.get('username_input', '')}")
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
            users = list_users_cached(AUTHENTIK_API_URL, headers, username_input if username_input else None)
            set_user_list(users)
            st.success("Users listed successfully!")

    except Exception as e:
        st.error(f"An error occurred: {e}")

# Render home page with dynamic fields based on operation
def render_home_page():
    # Sidebar for useful links
    st.sidebar.markdown("""
        ## Useful Links:
        - [Login to IrregularChat SSO](https://sso.irregularchat.com)
        - [Use Signal CopyPasta for Welcome Messages](https://wiki.irregularchat.com/en/community/chat/admin/signal-prompts)
        - [Admin Prompts for Common Situations](https://wiki.irregularchat.com/community/chat/admin.md)
        - [Links to Community Chats and Services](https://wiki.irregularchat.com/community/links.md)
    """)

    # Operation selection and username input
    col1, col2 = st.columns([2, 3])
    with col1:
        operation = st.selectbox(
            "Select Operation",
            ["Create User", "Generate Recovery Link", "Create Invite", "List Users"],
            key="operation_selection"  # Use a static key tied to session state
        )

    with col2:
        username_input = st.text_input("Username", key="username_input")  # Static key for the username

    # Form section
    with st.form(key="user_management_form"):
        # Dynamic fields based on the operation selected
        if operation == "Create User":
            first_name, last_name, email_input, invited_by, intro = render_create_user_form()
            expires_date, expires_time = None, None
        elif operation == "Generate Recovery Link":
            first_name, last_name, email_input, invited_by, intro = [None] * 5
            expires_date, expires_time = None, None
        elif operation == "Create Invite":
            invite_label, expires_date, expires_time = render_invite_form()
            first_name, last_name, email_input, invited_by, intro = [None] * 5
        elif operation == "List Users":
            first_name, last_name, email_input, invited_by, intro = [None] * 5
            expires_date, expires_time = None, None
        
        # Submit button for the form
        submit_button = st.form_submit_button("Submit")

    # Form submission logic
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

    # Display user list and actions
    display_user_list(AUTHENTIK_API_URL, headers)

# Call render_home_page to display the form and user list
render_home_page()