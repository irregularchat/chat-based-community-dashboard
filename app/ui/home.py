# ui/home.py
import streamlit as st
import os
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from st_aggrid import AgGrid, GridOptionsBuilder, GridUpdateMode, DataReturnMode
import json
import pandas as pd
from utils.config import Config
from auth.api import (
    create_user,
    force_password_reset,
    generate_secure_passphrase,
    list_users_cached,
    update_user_status,
    delete_user,
    reset_user_password,
    update_user_intro,
    update_user_invited_by,
    create_invite,
    shorten_url,
    list_users,
    webhook_notification
)
from ui.forms import render_create_user_form, render_invite_form
from utils.helpers import (
    get_existing_usernames,
    create_unique_username,
    update_LOCAL_DB,
    search_LOCAL_DB,
    update_username,
    get_eastern_time
)
from messages import (
    create_user_message,
    create_recovery_message,
    create_invite_message, 
    multi_recovery_message
)
import logging
import pandas as pd
from datetime import datetime, timedelta
from pytz import timezone  # Ensure this is imported
from utils.transformations import parse_input

session = requests.Session()
retry = Retry(
    total=2,  # Reduced total retries
    backoff_factor=0.5,  # Reduced backoff factor
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["HEAD", "GET", "POST", "PUT", "DELETE", "OPTIONS", "TRACE"]
)
adapter = HTTPAdapter(max_retries=retry)
session.mount("http://", adapter)
session.mount("https://", adapter)



def reset_form():
    for key in [
        'first_name_input', 'last_name_input', 'username_input', 'email_input',
        'invited_by', 'intro', 'invite_label', 'expires_date', 'expires_time'
    ]:
        if key in st.session_state:
            del st.session_state[key]

def update_username():
    if st.session_state.get('first_name_input') and st.session_state.get('last_name_input'):
        base_username = f"{st.session_state['first_name_input'].strip().lower()}-{st.session_state['last_name_input'].strip()[0].lower()}"
    elif st.session_state.get('first_name_input'):
        base_username = st.session_state['first_name_input'].strip().lower()
    elif st.session_state.get('last_name_input'):
        base_username = st.session_state['last_name_input'].strip().lower()
    else:
        base_username = "pending"
    st.session_state['username_input'] = base_username.replace(" ", "-")


def display_user_list(auth_api_url, headers):
    if 'user_list' in st.session_state and st.session_state['user_list']:
        users = st.session_state['user_list']
        st.subheader("User List")

        # Create DataFrame
        df = pd.DataFrame(users)

        # Determine the identifier field
        identifier_field = None
        for field in ['username', 'name', 'email']:
            if field in df.columns:
                identifier_field = field
                break

        if not identifier_field:
            st.error("No suitable identifier field found in user data.")
            logging.error("No suitable identifier field found in DataFrame.")
            return

        # Limit the displayed columns
        display_columns = ['username', 'name', 'is_active', 'last_login', 'email', 'attributes']
        display_columns = [col for col in display_columns if col in df.columns]

        # Include 'id' and 'pk' columns if they exist
        identifier_columns = ['id', 'pk']
        available_identifier_columns = [col for col in identifier_columns if col in df.columns]

        if not available_identifier_columns:
            st.error("User data does not contain 'id' or 'pk' fields required for performing actions.")
            logging.error("No 'id' or 'pk' fields in user data.")
            return

        # Combine columns to be used in the DataFrame
        all_columns = display_columns + available_identifier_columns

        # Update the DataFrame with available columns
        df = df[all_columns]

        # Process 'attributes' column
        if 'attributes' in df.columns:
            df['attributes'] = df['attributes'].apply(
                lambda x: json.dumps(x, indent=2) if isinstance(x, dict) else str(x)
            )

        # Build AgGrid options
        gb = GridOptionsBuilder.from_dataframe(df)

        # Configure default columns (make all columns filterable, sortable, and resizable)
        gb.configure_default_column(filter=True, sortable=True, resizable=True)

        # Hide 'id' and 'pk' columns if they are present
        gb.configure_columns(available_identifier_columns, hide=True)

        # Configure selection
        gb.configure_selection(
            selection_mode='multiple',
            use_checkbox=True,
            header_checkbox=True  # Enable header checkbox for "Select All"
        )

        # Page size options
        page_size_options = [100, 250, 500, 1000]
        page_size = st.selectbox("Page Size", options=page_size_options, index=2)

        # Configure grid options
        gb.configure_pagination(paginationAutoPageSize=False, paginationPageSize=page_size)
        gb.configure_side_bar()
        gb.configure_grid_options(domLayout='normal')
        grid_options = gb.build()

        # Adjust table height
        table_height = 800

        # Action dropdown and Apply button above the table
        action_col, button_col = st.columns([3, 1])
        with action_col:
            action = st.selectbox("Select Action", [
                "Activate", "Deactivate", "Reset Password", "Delete", "Add Intro", "Add Invited By"
            ])
            # Add action-specific inputs here
            if action == "Reset Password":
                use_password_generator = st.checkbox("Use Password Generator", value=True)
                if not use_password_generator:
                    new_password = st.text_input("Enter new password", type="password", key="reset_password_input")
            elif action == "Add Intro":
                intro_text = st.text_area("Enter Intro Text", height=2, key="add_intro_textarea")
            elif action == "Add Invited By":
                invited_by = st.text_input("Enter Invited By", key="add_invited_by_input")
        with button_col:
            apply_button = st.button("Apply")

        # Display AgGrid table
        grid_response = AgGrid(
            df,
            gridOptions=grid_options,
            data_return_mode=DataReturnMode.FILTERED_AND_SORTED,
            update_mode=GridUpdateMode.MODEL_CHANGED,
            fit_columns_on_grid_load=True,
            enable_enterprise_modules=False,
            theme='alpine',
            height=table_height,
            width='100%',
            reload_data=True
        )

        selected_rows = grid_response['selected_rows']
        selected_users = pd.DataFrame(selected_rows)

        st.write(f"Selected Users: {len(selected_users)}")

        # Action dropdown and Apply button below the table
        action_col_below, button_col_below = st.columns([3, 1])
        with action_col_below:
            action_below = st.selectbox("Select Action", [
                "Activate", "Deactivate", "Reset Password", "Delete", "Add Intro", "Add Invited By"
            ], key="action_below")
        with button_col_below:
            apply_button_below = st.button("Apply", key="apply_below")

        # Initialize a message variable
        action_message = ""

        # Determine which apply button was pressed
        if apply_button or apply_button_below:
            if not selected_users.empty:
                # Action-specific inputs
                if action == "Reset Password":
                    if use_password_generator:
                        new_passwords = {user['username']: generate_secure_passphrase() for _, user in selected_users.iterrows()}
                    else:
                        new_password = st.text_input("Enter new password", type="password", key="reset_password_input_top")
                        new_passwords = {user['username']: new_password for _, user in selected_users.iterrows()}
                elif action == "Add Intro":
                    intro_text = st.text_area("Enter Intro Text", height=2, key="add_intro_textarea_top")
                elif action == "Add Invited By":
                    invited_by = st.text_input("Enter Invited By", key="add_invited_by_input_top")

                try:
                    success_count = 0
                    for _, user in selected_users.iterrows():
                        user_id = None
                        for col in available_identifier_columns:
                            if col in user and pd.notna(user[col]):
                                user_id = user[col]
                                break
                        if not user_id:
                            action_message = f"User {user[identifier_field]} does not have a valid ID."
                            st.error(action_message)
                            continue

                        # Perform the selected action
                        if action == "Activate":
                            result = update_user_status(auth_api_url, headers, user_id, True)
                        elif action == "Deactivate":
                            result = update_user_status(auth_api_url, headers, user_id, False)
                        elif action == "Reset Password":
                            if new_passwords[user['username']]:
                                result = reset_user_password(auth_api_url, headers, user_id, new_passwords[user['username']])
                                if result:
                                    st.success(f"Password for user {user[identifier_field]} has been reset.")
                            else:
                                action_message = "Please enter a new password"
                                st.warning(action_message)
                                continue
                        elif action == "Delete":
                            result = delete_user(auth_api_url, headers, user_id)
                        elif action == "Add Intro":
                            result = update_user_intro(auth_api_url, headers, user_id, intro_text)
                        elif action == "Add Invited By":
                            result = update_user_invited_by(auth_api_url, headers, user_id, invited_by)
                        else:
                            result = None

                        if result:
                            success_count += 1

                    if action == "Reset Password":
                        multi_recovery_message(selected_users.to_dict(orient='records'))

                    action_message = f"{action} action applied successfully to {success_count} out of {len(selected_users)} selected users."
                    st.success(action_message)
                except Exception as e:
                    action_message = f"An error occurred while applying {action} action: {e}"
                    st.error(action_message)
            else:
                action_message = "No users selected."
                st.info(action_message)

        # Display the message at the top section
        if action_message:
            st.write(action_message)

        # Display the message at the bottom section
        if action_message:
            st.write(action_message)
    else:
        st.info("No users found.")

def render_home_page():
    # Initialize session state variables
    for var in ['message', 'user_list', 'prev_operation']:
        if var not in st.session_state:
            st.session_state[var] = "" if var in ['message', 'prev_operation'] else []

    # Define headers
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }

    # Operation selection
    operation = st.selectbox(
        "Select Operation",
        ["Create User", "Create Invite", "List and Manage Users"],
        key="operation_selection"
    )

    # Check if the operation has changed
    if st.session_state['prev_operation'] != operation:
        reset_form()
        st.session_state['prev_operation'] = operation

    # Render form based on operation
    if operation == "Create User":
        first_name, last_name, username, email_input, invited_by, intro, submit_button = render_create_user_form()

        if submit_button:
            if not first_name and not last_name:
                st.error("At least one of first name or last name is required.")
                return

            # Handle form submission with the correct values
            handle_form_submission(
                operation,
                username,
                email_input,
                invited_by,
                intro,
                None,
                None,
                first_name,
                last_name
            )
    elif operation == "Create Invite":
        invite_label, expires_date, expires_time = render_invite_form()
        # Handle invite creation logic here
        invite_button = st.button("Create Invite")
        if invite_button:
            handle_form_submission(
                operation,
                None,
                None,
                None,
                None,
                expires_date,
                expires_time,
                None,
                None,
                invite_label
            )
    elif operation == "List and Manage Users":
        username_input = st.text_input("Search Query", key="username_input", placeholder="Enter username or email to search")
        
        # Add a submit button for the search
        search_button = st.button("Search")
        
        if search_button:
            handle_form_submission(
                operation,
                username_input,
                None,
                None,
                None,
                None,
                None,
                None,
                None
            )


def handle_form_submission(
    operation, username_input, email_input, invited_by, intro, expires_date,
    expires_time, first_name, last_name, invite_label=None
):  
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    try:
        if operation == "Create User":
            if not first_name and not last_name:
                st.error("At least one of first name or last name is required.")
                return

            # Update Local DB to ensure it's up-to-date
            update_LOCAL_DB()

            # Check if the username already exists
            user_exists = search_LOCAL_DB(username_input)
            if not user_exists.empty:
                st.warning(f"User '{username_input}' already exists. Creating a unique username.")
                new_username = create_unique_username(username_input)
            else:
                new_username = username_input

            email = email_input if email_input else f"{new_username}@{Config.BASE_DOMAIN}"

            # Construct the full name based on available inputs
            if first_name and last_name:
                full_name = f"{first_name.strip()} {last_name.strip()}"
            elif first_name:
                full_name = first_name.strip()
            elif last_name:
                full_name = last_name.strip()
            else:
                full_name = ""  # This should not occur due to the earlier check

            # Create the user
            new_user, temp_password = create_user(new_username, full_name, email, invited_by, intro)
            if new_user:
                # Use the username from the created user
                created_username = new_user.get('username', new_username)
                create_user_message(created_username, temp_password)
                # Send a webhook notification
                """webhook_notification
                function is defined in auth/api.py and is called here. 
                New format def webhook_notification(event_type, username=None, full_name=None, email=None, intro=None, invited_by=None, password=None):
                """
                webhook_notification("user_created", created_username, full_name, email, intro, invited_by, temp_password)
                st.success(f"User '{created_username}' created successfully with a temporary password.")
            else:
                st.error("Failed to create user. Please verify inputs and try again.")
        elif operation == "Reset User Password":
            if not username_input:
                st.error("Username is required to reset password.")
                return
            new_password = generate_secure_passphrase()
            # First, get the user ID by username
            user_search_url = f"{Config.AUTHENTIK_API_URL}/core/users/?search={username_input}"
            try:
                response = session.get(user_search_url, headers=headers, timeout=10)
                response.raise_for_status()
                users = response.json().get('results', [])
                if users:
                    user_id = users[0]['pk']
                    if reset_user_password(Config.AUTHENTIK_API_URL, headers, user_id, new_password):
                        create_recovery_message(username_input, new_password)
                        st.success(f"Password reset successfully for user: {username_input}")
                    else:
                        st.error("Failed to set new password.")
                else:
                    st.error(f"No user found with username: {username_input}")
            except requests.exceptions.RequestException as e:
                st.error(f"Error occurred while resetting password: {str(e)}")
            
        elif operation == "Create Invite":
            if not invite_label:
                st.error("Invite label is required.")
                return
            if not expires_date or not expires_time:
                st.error("Expiration date and time are required.")
                return

            # Convert to Eastern Time
            eastern_time = get_eastern_time(expires_date, expires_time)
            expires_iso = eastern_time.isoformat()

            invite_link, invite_expires = create_invite(headers, invite_label, expires_iso)
            if invite_link:
                create_invite_message(invite_label, invite_link, invite_expires)
            else:
                st.error("Failed to create invite.")

        elif operation == "List and Manage Users":
            search_query = username_input.strip()
            st.write(f"Search Query: {search_query}")  # Debugging output

            # First, search the local database
            local_users = search_LOCAL_DB(search_query)
            st.write(f"Local Users Found: {local_users}")  # Debugging output

            if not local_users.empty:
                st.session_state['user_list'] = local_users.to_dict(orient='records')
                st.session_state['message'] = "Users found in local database."
            else:
                # If not found locally or search query is empty, search using the API
                users = list_users(Config.AUTHENTIK_API_URL, headers, search_query)
                st.write(f"API Users Found: {users}")  # Debugging output

                if users:
                    st.session_state['user_list'] = users
                    st.session_state['message'] = "Users found via API."
                else:
                    st.session_state['user_list'] = []
                    st.session_state['message'] = "No users found."

            # Logging and debugging (optional)
            logging.debug(f"user_list data: {st.session_state['user_list']}")
            if st.session_state['user_list']:
                first_user = st.session_state['user_list'][0]
                logging.debug(f"First user keys: {first_user.keys()}")

    except Exception as e:
        st.error(f"An error occurred during '{operation}': {e}")
        logging.error(f"Error during '{operation}': {e}")

