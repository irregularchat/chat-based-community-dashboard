# ui/home.py
import streamlit as st
from st_aggrid import AgGrid, GridOptionsBuilder, GridUpdateMode, DataReturnMode
import json
import pandas as pd
from utils.config import Config
from auth.api import (
    create_user,
    generate_recovery_link,
    list_users_cached,
    update_user_status,
    delete_user,
    reset_user_password,
    update_user_intro,
    update_user_invited_by,
    create_invite,
    shorten_url,
    list_users
)
from ui.forms import render_create_user_form, render_invite_form
from utils.helpers import (
    get_existing_usernames,
    create_unique_username,
    update_LOCAL_DB,
    search_LOCAL_DB
)
from messages import (
    create_user_message,
    create_recovery_message,
    create_invite_message
)
import logging
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
    if st.session_state.get('first_name_input') and st.session_state.get('last_name_input'):
        base_username = f"{st.session_state['first_name_input'].strip().lower()}-{st.session_state['last_name_input'].strip()[0].lower()}"
    elif st.session_state.get('first_name_input'):
        base_username = st.session_state['first_name_input'].strip().lower()
    elif st.session_state.get('last_name_input'):
        base_username = st.session_state['last_name_input'].strip().lower()
    else:
        base_username = "pending"
    st.session_state['username_input'] = base_username.replace(" ", "-")


## Working good table
# def display_user_list(auth_api_url, headers):
#     if 'user_list' in st.session_state and st.session_state['user_list']:
#         users = st.session_state['user_list']
#         st.subheader("User List")

#         # Create DataFrame
#         df = pd.DataFrame(users)

#         # Display available columns for debugging
#         # st.write("Available DataFrame Columns:", df.columns.tolist())

#         # Determine the identifier field
#         identifier_field = None
#         for field in ['username', 'name', 'email']:
#             if field in df.columns:
#                 identifier_field = field
#                 break

#         if not identifier_field:
#             st.error("No suitable identifier field found in user data.")
#             logging.error("No suitable identifier field found in DataFrame.")
#             return

#         # Limit the displayed columns
#         display_columns = ['username', 'name', 'is_active', 'last_login', 'email', 'attributes']
#         display_columns = [col for col in display_columns if col in df.columns]

#         # Include 'id' and 'pk' columns if they exist
#         identifier_columns = ['id', 'pk']
#         available_identifier_columns = [col for col in identifier_columns if col in df.columns]

#         if not available_identifier_columns:
#             st.error("User data does not contain 'id' or 'pk' fields required for performing actions.")
#             logging.error("No 'id' or 'pk' fields in user data.")
#             return

#         # Combine columns to be used in the DataFrame
#         all_columns = display_columns + available_identifier_columns

#         # Update the DataFrame with available columns
#         df = df[all_columns]

#         # Process 'attributes' column
#         if 'attributes' in df.columns:
#             df['attributes'] = df['attributes'].apply(
#                 lambda x: json.dumps(x, indent=2) if isinstance(x, dict) else str(x)
#             )

#         # Build AgGrid options
#         gb = GridOptionsBuilder.from_dataframe(df)

#         # Configure default columns (make all columns filterable, sortable, and resizable)
#         gb.configure_default_column(filter=True, sortable=True, resizable=True)

#         # Hide 'id' and 'pk' columns if they are present
#         gb.configure_columns(available_identifier_columns, hide=True)

#         # Page size options
#         page_size_options = [20, 50, 100, 500, 1000]
#         page_size = st.selectbox("Page Size", options=page_size_options, index=2)

#         # Configure grid options
#         gb.configure_selection('multiple', use_checkbox=True)
#         gb.configure_pagination(paginationAutoPageSize=False, paginationPageSize=page_size)
#         gb.configure_side_bar()
#         gb.configure_grid_options(domLayout='normal')
#         grid_options = gb.build()

#         # Adjust table height
#         table_height = 800

#         # Display AgGrid table
#         grid_response = AgGrid(
#             df,
#             gridOptions=grid_options,
#             data_return_mode=DataReturnMode.FILTERED_AND_SORTED,
#             update_mode=GridUpdateMode.SELECTION_CHANGED,
#             fit_columns_on_grid_load=True,
#             enable_enterprise_modules=False,
#             theme='alpine',
#             height=table_height,
#             width='100%',
#             reload_data=True
#         )

#         selected_rows = grid_response['selected_rows']
#         selected_users = pd.DataFrame(selected_rows)

#         st.write(f"Selected Users: {len(selected_users)}")
#         # st.write("Selected Users Columns:", selected_users.columns.tolist())  # For debugging

#         if not selected_users.empty:
#             action = st.selectbox("Select Action", [
#                 "Activate", "Deactivate", "Reset Password", "Delete", "Add Intro", "Add Invited By"
#             ])

#             # Action-specific inputs
#             if action == "Reset Password":
#                 new_password = st.text_input("Enter new password", type="password")
#             elif action == "Add Intro":
#                 intro_text = st.text_area("Enter Intro Text", height=2)
#             elif action == "Add Invited By":
#                 invited_by = st.text_input("Enter Invited By")

#             if st.button("Apply"):
#                 try:
#                     success_count = 0
#                     for _, user in selected_users.iterrows():
#                         user_id = None
#                         for col in available_identifier_columns:
#                             if col in user and pd.notna(user[col]):
#                                 user_id = user[col]
#                                 break
#                         if not user_id:
#                             st.error(f"User {user[identifier_field]} does not have a valid ID.")
#                             continue

#                         # Perform the selected action
#                         if action == "Activate":
#                             result = update_user_status(auth_api_url, headers, user_id, True)
#                         elif action == "Deactivate":
#                             result = update_user_status(auth_api_url, headers, user_id, False)
#                         elif action == "Reset Password":
#                             if new_password:
#                                 result = reset_user_password(auth_api_url, headers, user_id, new_password)
#                             else:
#                                 st.warning("Please enter a new password")
#                                 continue
#                         elif action == "Delete":
#                             result = delete_user(auth_api_url, headers, user_id)
#                         elif action == "Add Intro":
#                             result = update_user_intro(auth_api_url, headers, user_id, intro_text)
#                         elif action == "Add Invited By":
#                             result = update_user_invited_by(auth_api_url, headers, user_id, invited_by)
#                         else:
#                             result = None

#                         if result:
#                             success_count += 1
#                     st.success(f"{action} action applied successfully to {success_count} out of {len(selected_users)} selected users.")
#                 except Exception as e:
#                     st.error(f"An error occurred while applying {action} action: {e}")
#         else:
#             st.info("No users selected.")
#     else:
#         st.info("No users found.")

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

        if not selected_users.empty:
            action = st.selectbox("Select Action", [
                "Activate", "Deactivate", "Reset Password", "Delete", "Add Intro", "Add Invited By"
            ])

            # Action-specific inputs
            if action == "Reset Password":
                new_password = st.text_input("Enter new password", type="password")
            elif action == "Add Intro":
                intro_text = st.text_area("Enter Intro Text", height=2)
            elif action == "Add Invited By":
                invited_by = st.text_input("Enter Invited By")

            if st.button("Apply"):
                try:
                    success_count = 0
                    for _, user in selected_users.iterrows():
                        user_id = None
                        for col in available_identifier_columns:
                            if col in user and pd.notna(user[col]):
                                user_id = user[col]
                                break
                        if not user_id:
                            st.error(f"User {user[identifier_field]} does not have a valid ID.")
                            continue

                        # Perform the selected action
                        if action == "Activate":
                            result = update_user_status(auth_api_url, headers, user_id, True)
                        elif action == "Deactivate":
                            result = update_user_status(auth_api_url, headers, user_id, False)
                        elif action == "Reset Password":
                            if new_password:
                                result = reset_user_password(auth_api_url, headers, user_id, new_password)
                            else:
                                st.warning("Please enter a new password")
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
                    st.success(f"{action} action applied successfully to {success_count} out of {len(selected_users)} selected users.")
                except Exception as e:
                    st.error(f"An error occurred while applying {action} action: {e}")
        else:
            st.info("No users selected.")
    else:
        st.info("No users found.")

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
            new_user = create_user(new_username, full_name, email, invited_by, intro)
            if new_user:
                recovery_link = generate_recovery_link(new_username)
                if recovery_link:
                    shortened_recovery_link = shorten_url(recovery_link, 'first-login', new_username)
                    create_user_message(new_username, shortened_recovery_link)
                else:
                    st.error("Failed to generate recovery link.")
            else:
                st.error("Failed to create user.")

        elif operation == "Generate Recovery Link":
            if not username_input:
                st.error("Username is required to generate a recovery link.")
                return
            recovery_link = generate_recovery_link(username_input)
            if recovery_link:
                shortened_recovery_link = shorten_url(recovery_link, 'recovery', username_input)
                create_recovery_message(username_input, shortened_recovery_link)
            else:
                st.error("Failed to generate recovery link.")

        elif operation == "Create Invite":
            if not invite_label:
                st.error("Invite label is required.")
                return
            if not expires_date or not expires_time:
                st.error("Expiration date and time are required.")
                return

            expires_datetime = datetime.combine(expires_date, expires_time)
            expires_iso = expires_datetime.isoformat()

            invite_link, invite_expires = create_invite(headers, invite_label, expires_iso)
            if invite_link:
                create_invite_message(invite_label, invite_link, invite_expires)
            else:
                st.error("Failed to create invite.")

        # elif operation == "List Users":
        #     search_query = username_input.strip()
        #     if not search_query:
        #         st.error("Please enter a search query.")
        #         return
        elif operation == "List Users":
            search_query = username_input.strip()
            # Allow empty search_query to fetch all users

            # First, search the local database
            local_users = search_LOCAL_DB(search_query)
            if not local_users.empty:
                st.session_state['user_list'] = local_users.to_dict(orient='records')
                st.session_state['message'] = "Users found in local database."
            else:
                # If not found locally or search query is empty, search using the API
                users = list_users(Config.AUTHENTIK_API_URL, headers, search_query)
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
        ####

            # First, search the local database
            local_users = search_LOCAL_DB(search_query)
            if not local_users.empty:
                st.session_state['user_list'] = local_users.to_dict(orient='records')
                st.session_state['message'] = "Users found in local database."
            else:
                # If not found locally, search using the API
                users = list_users(Config.AUTHENTIK_API_URL, headers, search_query)
                if users:
                    st.session_state['user_list'] = users
                    st.session_state['message'] = "Users found via API."
                else:
                    st.session_state['user_list'] = []
                    st.session_state['message'] = "No users found."

            # Add logging to inspect the data
            logging.debug(f"user_list data: {st.session_state['user_list']}")
            if st.session_state['user_list']:
                first_user = st.session_state['user_list'][0]
                logging.debug(f"First user keys: {first_user.keys()}")

    except Exception as e:
        st.error(f"An error occurred during '{operation}': {e}")
        logging.error(f"Error during '{operation}': {e}")
