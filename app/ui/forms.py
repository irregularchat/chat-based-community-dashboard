from dotenv import load_dotenv
import os
import streamlit as st
import pandas as pd
from authentik_streamlit import (
    create_user, generate_recovery_link, create_invite, list_users, 
    update_LOCAL_DB, search_LOCAL_DB, shorten_url, update_user_status, 
    reset_user_password, delete_user, update_user_intro, update_user_invited_by,
    display_message, clear_session_state
)
from datetime import datetime, timedelta
from pytz import timezone
from messages import (
    create_user_message, create_recovery_message, create_invite_message
)

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

# This is the function that needs to be called in `main.py`
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

    # Form Section
    with st.form(key="user_management_form"):
        # First name and last name input before the username
        col1, col2 = st.columns(2)
        with col1:
            first_name = st.text_input("Enter First Name", key="first_name_input")
        with col2:
            last_name = st.text_input("Enter Last Name", key="last_name_input")

        # Processed username
        base_username = f"{first_name.strip().lower()}-{last_name.strip()[0].lower()}" if first_name and last_name else "pending"
        processed_username = base_username.replace(" ", "-")

        # Username field at the top
        username_input = st.text_input("Username", value=processed_username, key="username_input")

        # Operation dropdown
        operation = st.selectbox("Select Operation", [
            "Create User", 
            "Generate Recovery Link", 
            "Create Invite",
            "List Users"
        ])

        # Email and Invited by fields
        col1, col2 = st.columns(2)
        with col1:
            email_input = st.text_input("Enter Email Address (optional)", key="email_input")
        with col2:
            invited_by = st.text_input("Invited by (optional)", key="invited_by_input")

        # Intro text area
        intro = st.text_area("Intro (optional)", height=2, key="intro_input")

        # Date and Time inputs for certain operations
        if operation in ["Generate Recovery Link", "Create Invite"]:
            expires_default = datetime.now() + timedelta(hours=2)
            expires_date = st.date_input("Enter Expiration Date (optional)", value=expires_default.date())
            expires_time = st.time_input("Enter Expiration Time (optional)", value=expires_default.time())
        else:
            expires_date, expires_time = None, None

        # Submit button
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

    # Handle displaying user list and actions only if "List Users" is selected
    # Assuming we're in the section where you're displaying users
    if operation == "List Users" and submit_button:
        try:
            # Check if the user list is already in session state
            if 'user_list' not in st.session_state:
                # Fetch user list from Authentik API and store it in session_state
                users = list_users(AUTHENTIK_API_URL, headers)
                st.session_state['user_list'] = users
            else:
                users = st.session_state['user_list']

            if users:
                df = pd.DataFrame(users)

                # Add columns for 'invited_by' and 'intro' from 'attributes'
                df['invited_by'] = df['attributes'].apply(lambda x: x.get('invited_by', 'N/A'))
                df['intro'] = df['attributes'].apply(lambda x: x.get('intro', 'N/A'))

                # Sorting options for the user list
                sort_by = st.selectbox("Sort by", options=["username", "email", "is_active"], index=0)
                sort_ascending = st.radio("Sort order", ("Ascending", "Descending"))
                df = df.sort_values(by=sort_by, ascending=(sort_ascending == "Ascending"))

                # Check if selected_users exists in session_state, if not, initialize it
                if 'selected_users' not in st.session_state:
                    st.session_state['selected_users'] = []

                selected_users = st.session_state['selected_users']

                # Checkbox for selecting users
                for idx, row in df.iterrows():
                    if st.checkbox(f"**Username**: {row['username']}, **Email**: {row['email']}, **Active**: {row['is_active']}, **Invited By**: {row['invited_by']}, **Intro**: {row['intro']}", 
                                key=row['username'], value=row['username'] in selected_users):
                        if row['username'] not in selected_users:
                            selected_users.append(row['username'])
                    else:
                        if row['username'] in selected_users:
                            selected_users.remove(row['username'])

                st.session_state['selected_users'] = selected_users

                st.write(f"Selected Users: {len(selected_users)}")

                # Actions for selected users
                if selected_users:
                    st.write("**Actions for Selected Users**")
                    
                    # Action dropdown
                    action = st.selectbox("Select Action", ["Activate", "Deactivate", "Reset Password", "Delete", "Add Intro", "Add Invited By"])

                    if action == "Reset Password":
                        new_password = st.text_input("Enter new password", type="password")

                    if action == "Add Intro":
                        intro_text = st.text_area("Enter Intro Text", height=2)

                    if action == "Add Invited By":
                        invited_by = st.text_input("Enter Invited By")

                    # Submit button for actions
                    if st.button("Apply"):
                        try:
                            for user in selected_users:
                                user_data = df[df['username'] == user].iloc[0]
                                user_id = user_data['pk']

                                if action == "Activate":
                                    update_user_status(AUTHENTIK_API_URL, headers, user_id, True)
                                elif action == "Deactivate":
                                    update_user_status(AUTHENTIK_API_URL, headers, user_id, False)
                                elif action == "Reset Password":
                                    if new_password:
                                        reset_user_password(AUTHENTIK_API_URL, headers, user_id, new_password)
                                    else:
                                        st.warning("Please enter a new password")
                                        break
                                elif action == "Delete":
                                    delete_user(AUTHENTIK_API_URL, headers, user_id)
                                elif action == "Add Intro":
                                    update_user_intro(AUTHENTIK_API_URL, headers, user_id, intro_text)
                                elif action == "Add Invited By":
                                    update_user_invited_by(AUTHENTIK_API_URL, headers, user_id, invited_by)

                            st.success(f"{action} action applied successfully to selected users.")
                        
                        except Exception as e:
                            st.error(f"An error occurred while applying {action} action: {e}")

                st.dataframe(df)
        except Exception as e:
            st.error(f"An error occurred: {e}")