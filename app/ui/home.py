# app/ui/home.py
import streamlit as st
from authentik_streamlit import (
    create_user, generate_recovery_link, create_invite, list_users, 
    update_LOCAL_DB, search_LOCAL_DB, shorten_url
)
from datetime import datetime, timedelta
from pytz import timezone
from messages import (
    create_user_message, create_recovery_message, create_invite_message, 
    display_message, clear_session_state
)

load_dotenv(dotenv_path='../.env')

# Define the vars for the app from the .env file
AUTHENTIK_API_TOKEN = os.getenv("AUTHENTIK_API_TOKEN")
MAIN_GROUP_ID = os.getenv("MAIN_GROUP_ID")
BASE_DOMAIN = os.getenv("BASE_DOMAIN")
FLOW_ID = os.getenv("FLOW_ID")
LOCAL_DB = "users.csv"
ENCRYPTION_PASSWORD = base64.urlsafe_b64encode(hashlib.sha256(os.getenv("ENCRYPTION_PASSWORD").encode()).digest())
SHLINK_API_TOKEN = os.getenv("SHLINK_API_TOKEN")
SHLINK_URL = os.getenv("SHLINK_URL")
AUTHENTIK_API_URL = os.getenv("AUTHENTIK_API_URL")


def handle_form_submission(operation, username_input, email_input, invited_by, intro, expires_date, expires_time):
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
            new_user = create_user(AUTHENTIK_API_URL, headers, new_username, email, full_name)

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
                expires = (datetime.now(timezone('US/Eastern')) + timedelta(hours=2)).isoformat()
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

# In render_home_page or wherever you display messages
display_message()

# After displaying user list or performing user actions, clear session state
clear_session_state()