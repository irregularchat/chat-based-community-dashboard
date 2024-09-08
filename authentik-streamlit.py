import streamlit as st
import requests
import pandas as pd
from datetime import datetime, timedelta
from dotenv import load_dotenv
import os
import hashlib
import base64
from cryptography.fernet import Fernet
from io import StringIO
import logging
from pytz import timezone

# Load environment variables from .env file
load_dotenv()

# Define the vars for the app from the .env file
PAGE_TITLE = os.getenv("PAGE_TITLE")
FAVICON_URL = os.getenv("FAVICON_URL")
AUTHENTIK_API_TOKEN = os.getenv("AUTHENTIK_API_TOKEN")
MAIN_GROUP_ID = os.getenv("MAIN_GROUP_ID")
BASE_DOMAIN = os.getenv("BASE_DOMAIN")
FLOW_ID = os.getenv("FLOW_ID")
LOCAL_DB = "users.csv"
ENCRYPTION_PASSWORD = base64.urlsafe_b64encode(hashlib.sha256(os.getenv("ENCRYPTION_PASSWORD").encode()).digest())
SHLINK_API_TOKEN = os.getenv("SHLINK_API_TOKEN")
SHLINK_URL = os.getenv("SHLINK_URL")
AUTHENTIK_API_URL = os.getenv("AUTHENTIK_API_URL")

# Configuration
# Define the Eastern Time zone for accurate time processing
eastern = timezone('US/Eastern')
current_time_eastern = datetime.now(eastern)

# Set page configuration for Streamlit UI
st.set_page_config(page_title=PAGE_TITLE, page_icon=FAVICON_URL)
st.title(PAGE_TITLE)

# Authentication check
if not AUTHENTIK_API_TOKEN or not MAIN_GROUP_ID:
    st.warning("Please enter both the API token and the main group ID to proceed.")
    AUTHENTIK_API_TOKEN = st.text_input("Enter your AUTHENTIK API TOKEN", type="password")
    MAIN_GROUP_ID = st.text_input("Enter the MAIN GROUP ID")
    st.stop()

headers = {
    "Authorization": f"Bearer {AUTHENTIK_API_TOKEN}",
    "Content-Type": "application/json"
}

# Function to shorten URL using Shlink API
def shorten_url(long_url, url_type, name=None):
    """
    Shorten a URL using Shlink API.
    
    Parameters:
        long_url (str): The URL to be shortened.
        url_type (str): The type of the URL (e.g., 'recovery', 'invite', 'setup').
        name (str, optional): The custom name for the shortened URL.
    
    Returns:
        str: The shortened URL or the original URL if the API key is not set.
    """
    if not SHLINK_API_TOKEN or not SHLINK_URL:
        return long_url  # Return original if no Shlink setup

    # Generate name for slug if not provided
    if not name:
        name = f"{current_time_eastern.strftime('%d%H%M')}-{url_type}"
    else:
        name = f"{current_time_eastern.strftime('%d%H%M')}-{url_type}-{name}"

    headers = {
        'X-Api-Key': SHLINK_API_TOKEN,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }

    payload = {
        'longUrl': long_url,
        'customSlug': name,
        'findIfExists': True  # Reuse existing short URL if available
    }

    try:
        response = requests.post(SHLINK_URL, json=payload, headers=headers)
        response_data = response.json()

        if response.status_code in [201, 200]:
            short_url = response_data.get('shortUrl')
            if short_url:
                return short_url.replace('http://', 'https://')  # Ensure HTTPS
            else:
                print('Error: API response missing "shortUrl".')
                return long_url
        else:
            print(f'Error: {response.status_code}')
            print(response_data)
            return long_url
    except requests.exceptions.RequestException as e:
        print(f'Exception: {e}')
        return long_url

# Function to encrypt data
def encrypt_data(data):
    f = Fernet(ENCRYPTION_PASSWORD)
    return f.encrypt(data.encode()).decode()

# Function to decrypt data
def decrypt_data(data):
    f = Fernet(ENCRYPTION_PASSWORD)
    return f.decrypt(data.encode()).decode()

# Function to update the local user database
def update_LOCAL_DB():
    users = list_users(AUTHENTIK_API_URL, headers)
    df = pd.DataFrame(users)
    encrypted_data = encrypt_data(df.to_csv(index=False))
    with open(LOCAL_DB, 'w') as file:
        file.write(encrypted_data)

# Function to load local user database
def load_LOCAL_DB():
    if not os.path.exists(LOCAL_DB):
        update_LOCAL_DB()
    with open(LOCAL_DB, 'r') as file:
        encrypted_data = file.read()
    decrypted_data = decrypt_data(encrypted_data)
    df = pd.read_csv(StringIO(decrypted_data))
    return df

# Function to search the local database for a username
def search_LOCAL_DB(username):
    df = load_LOCAL_DB()
    return df[df['username'].str.lower() == username.lower()]

# Function to get user ID by username
def get_user_id_by_username(AUTHENTIK_API_URL, headers, username):
    url = f"{AUTHENTIK_API_URL}/core/users/?search={username}"
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    users = response.json()['results']
    if not users:
        raise ValueError(f"User with username {username} not found.")
    return users[0]['pk']

# Set up logging to file
logging.basicConfig(filename='invite_creation.log', level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Function to create an invite
def create_invite(headers, label, expires=None):
    """
    Create an invitation for a user.

    Parameters:
        headers (dict): The request headers for Authentik API.
        label (str): The label to identify the invitation.
        expires (str, optional): The expiration time for the invite.
    
    Returns:
        tuple: The shortened invite URL and expiration time, if successful.
    """
    eastern = timezone('US/Eastern')
    current_time_str = datetime.now(eastern).strftime('%H-%M')

    # Default name for the invite
    if not label:
        label = current_time_str

    # Expiration logic
    if expires is None:
        expires = (datetime.now(eastern) + timedelta(hours=2)).isoformat()

    data = {
        "name": label,
        "expires": expires,
        "fixed_data": {},
        "single_use": True,
        "flow": FLOW_ID
    }
    
    # Authentik API invitation endpoint
    invite_api_url = f"{AUTHENTIK_API_URL}/stages/invitation/invitations/"

    try:
        response = requests.post(invite_api_url, headers=headers, json=data)
        response.raise_for_status()
        response_data = response.json()

        # Get the invite ID and construct the full URL
        invite_id = response_data.get('pk')
        if not invite_id:
            raise ValueError("API response missing 'pk' field.")

        invite_link = f"https://sso.{BASE_DOMAIN}/if/flow/simple-enrollment-flow/?itoken={invite_id}"

        # Shorten the invite link
        short_invite_link = shorten_url(invite_link, 'invite', label)
        return short_invite_link, expires

    except requests.exceptions.HTTPError as http_err:
        logging.error(f"HTTP error occurred: {http_err}")
        logging.info("API Response: %s", response.json())
    except Exception as err:
        logging.error(f"An error occurred: {err}")
        logging.info("API Response: %s", response.text)

    return None, None

# Function to generate a recovery link for the user
def generate_recovery_link(AUTHENTIK_API_URL, headers, username):
    # Get the user ID by username
    user_id = get_user_id_by_username(AUTHENTIK_API_URL, headers, username)
    
    # Define the URL for generating a recovery link
    url = f"{AUTHENTIK_API_URL}/core/users/{user_id}/recovery/"
    
    # Make a POST request to generate the recovery link
    response = requests.post(url, headers=headers)
    response.raise_for_status()

    # Fetch the recovery link directly from the response
    recovery_link = response.json().get('link')
    
    if not recovery_link:
        raise ValueError("Failed to generate recovery link.")
    
    return recovery_link

# Function to create a unique username
def create_unique_username(base_username, existing_usernames):
    counter = 1
    new_username = base_username
    while new_username in existing_usernames:
        new_username = f"{base_username}{counter}"
        counter += 1
    return new_username

# Function to list all usernames
def get_existing_usernames(AUTHENTIK_API_URL, headers):
    url = f"{AUTHENTIK_API_URL}/core/users/"
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    users = response.json()['results']
    return {user['username'] for user in users}

# Function to create a new user
def create_user(AUTHENTIK_API_URL, headers, username, email, name):
    data = {
        "username": username,
        "name": name,
        "is_active": True,
        "email": email,
        "groups": [MAIN_GROUP_ID],
        "attributes": {
            "intro": intro,
            "invited_by": invited_by
        },
        "path": "users",
        "type": "internal"
    }
    url = f"{AUTHENTIK_API_URL}/core/users/"
    response = requests.post(url, headers=headers, json=data)
    if response.status_code == 400:
        return None
    response.raise_for_status()
    return response.json()['pk']

# Function to list users
def list_users(AUTHENTIK_API_URL, headers, search_term=None):
    url = f"{AUTHENTIK_API_URL}/core/users/?search={search_term}" if search_term else f"{AUTHENTIK_API_URL}/core/users/"
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return response.json()['results']

# Function to update a user's status
def update_user_status(AUTHENTIK_API_URL, headers, user_id, is_active):
    url = f"{AUTHENTIK_API_URL}/core/users/{user_id}/"
    data = {"is_active": is_active}
    response = requests.patch(url, headers=headers, json=data)
    response.raise_for_status()
    return response.json()

# Function to delete a user
def delete_user(AUTHENTIK_API_URL, headers, user_id):
    url = f"{AUTHENTIK_API_URL}/core/users/{user_id}/"
    response = requests.delete(url, headers=headers)
    response.raise_for_status()
    return response.status_code == 204

# Function to reset a user's password
def reset_user_password(AUTHENTIK_API_URL, headers, user_id, new_password):
    url = f"{AUTHENTIK_API_URL}/core/users/{user_id}/set_password/"
    data = {"password": new_password}
    response = requests.post(url, headers=headers, json=data)
    response.raise_for_status()
    return response.json()

########## Streamlit Interface ##########
# Set up a row layout with columns to adjust the width (2/3 for links, 1/3 for form)
col_links, col_form = st.columns([2, 1])  # Adjust width: 2 parts for links, 1 part for the form

# Display the links on the left side (column 1)
with col_links:
    st.markdown("""
    - [Login to the IrregularChat SSO](https://sso.irregularchat.com)
    - [📋 Use the Signal CopyPasta for Welcome Messages](https://wiki.irregularchat.com/en/community/chat/admin/signal-prompts)
    - [Admin Prompts for Common Situations](https://wiki.irregularchat.com/community/chat/admin.md)
    - [🔗 Links to All the Community Chats and Services](https://wiki.irregularchat.com/community/links.md)
    """)

# First name and last name input before the username so that username can be updated dynamically
# First name and last name input before the username so that username can be updated dynamically
col1, col2 = st.columns(2)
with col1:
    first_name = st.text_input("Enter First Name", key="first_name_input")
with col2:
    last_name = st.text_input("Enter Last Name", key="last_name_input")

# Handle cases where first or last name might be empty and update session state for the username
if first_name and last_name:
    base_username = f"{first_name.strip().lower()}-{last_name.strip()[0].lower()}"
elif first_name:
    base_username = first_name.strip().lower()
elif last_name:
    base_username = last_name.strip().lower()
else:
    base_username = "pending"  # Default base username if both are empty

# Processed username
processed_username = base_username.replace(" ", "-")

# Update session state with the processed username
st.session_state['username_input'] = processed_username

# Form on the right side (column 2, narrower)
with col_form:
    # Username field at the top, dynamically updated
    username_input = st.text_input("Username", key="username_input")
    # Operation dropdown below the username
    operation = st.selectbox("Select Operation", [
        "Create User", 
        "Generate Recovery Link", 
        "Create Invite",
        "List Users"
    ])

# Place email and invited by side by side
col1, col2 = st.columns(2)
with col1:
    email_input = st.text_input("Enter Email Address (optional)", key="email_input")
with col2:
    invited_by = st.text_input("Invited by (optional)", key="invited_by_input")

# Intro (long text 2 lines tall)
intro = st.text_area("Intro (optional)", height=2, key="intro_input")

# Submit button now below the intro field, aligned to the right with balanced spacing
col1, col2 = st.columns([6, 1])  # Adjusting the width: 6 parts for spacing, 1 part for the button
with col2:
    submit_button = st.button("Submit", key="unique_submit_button")

# Show date and time inputs only for specific operations
if operation in ["Generate Recovery Link", "Create Invite"]:
    expires_default = datetime.now() + timedelta(hours=2)
    expires_date = st.date_input("Enter Expiration Date (optional)", value=expires_default.date())
    expires_time = st.time_input("Enter Expiration Time (optional)", value=expires_default.time())
else:
    expires_date, expires_time = None, None

# Handling form submission
if submit_button:
    try:
        if operation == "Create User":
            # Search locally first
            update_LOCAL_DB()
            user_exists = search_LOCAL_DB(username_input)
            if not user_exists.empty:
                st.warning(f"User {username_input} already exists. Trying to create a unique username.")
                existing_usernames = get_existing_usernames(AUTHENTIK_API_URL, headers)
                new_username = create_unique_username(username_input, existing_usernames)
            else:
                existing_usernames = get_existing_usernames(AUTHENTIK_API_URL, headers)
                new_username = create_unique_username(username_input, existing_usernames)
            
            email = email_input if email_input else f"{new_username}@{BASE_DOMAIN}"
            full_name = f"{first_name.strip()} {last_name.strip()}"
            new_user = create_user(AUTHENTIK_API_URL, headers, new_username, email, full_name)
            
            if new_user is None:
                st.warning(f"Username {new_username} might already exist. Trying to fetch existing user.")
                user_exists = search_LOCAL_DB(new_username)
                if user_exists.empty():
                    st.error(f"Could not create or find user {new_username}. Please try again.")
                else:
                    st.warning(f"User {new_username} already exists. Please reset the password or create a new user with a different username.")
            else:
                # Generate and shorten the setup link
                shortened_recovery_link = shorten_url(generate_recovery_link(AUTHENTIK_API_URL, headers, new_username), 'first-login', f"{new_username}")
                welcome_message = f"""
                🌟 Welcome to the IrregularChat Community of Interest (CoI)! 🌟
                You've just joined a community focused on breaking down silos, fostering innovation, and supporting service members and veterans. Here's what you need to know to get started and a guide to join the wiki and other services:
                ---
                See Below for username ⬇️
                Username: {new_username}
                👆🏼 See Above for username 👆🏼

                1️⃣ Step 1:
                - Activate your IrregularChat Login with your username 👉🏼 {new_username} 👈🏼 here: {shortened_recovery_link}

                2️⃣ Step 2:
                - Login to the wiki with that Irregular Chat Login and visit https://url.irregular.chat/welcome
                """
                st.code(welcome_message, language='markdown')
                st.session_state['message'] = welcome_message
                update_LOCAL_DB()
                st.session_state['user_list'] = None  # Clear user list if there was any
                st.success("User created successfully!")

        elif operation == "Generate Recovery Link":
            recovery_link = generate_recovery_link(AUTHENTIK_API_URL, headers, username_input)
            recovery_message = f"""
            🌟 Your account recovery link 🌟
            **Username**: {username_input}
            **Recovery Link**: {recovery_link}

            Use the link above to recover your account.
            """
            st.code(recovery_message, language='markdown')
            st.session_state['message'] = recovery_message
            st.session_state['user_list'] = None  # Clear user list if there was any
            st.success("Recovery link generated successfully!")

        elif operation == "Create Invite":
            if expires_date and expires_time:
                local_expires = datetime.combine(expires_date, expires_time)
                expires = (datetime.now(eastern) + timedelta(hours=2)).isoformat()
            else:
                expires = None
            
            invite_link, invite_expires = create_invite(headers, username_input, expires)
            if invite_expires:  # Ensure invite_expires is properly handled as a string
                invite_expires_time = datetime.fromisoformat(invite_expires.replace('Z', '+00:00')).astimezone(timezone('US/Eastern')) - datetime.now(timezone('US/Eastern'))
                hours, remainder = divmod(invite_expires_time.total_seconds(), 3600)
                minutes, _ = divmod(remainder, 60)
                invite_message = f"""
                💣 This Invite Will Self Destruct! ⏳
                This is how you get an IrregularChat Login and how you can see all the chats and services:
                
                IrregularChat Temp Invite ⏭️ : {invite_link}
                ⏲️ Invite Expires: {int(hours)} hours and {int(minutes)} minutes from now
                
                🌟 After you login you'll see options for the wiki, the forum, matrix "element messenger", and other self-hosted services. 
                Login to the wiki with that Irregular Chat Login and visit https://url.irregular.chat/welcome/
                """
                st.code(invite_message, language='markdown')
                st.session_state['user_list'] = None
                st.success("Invite created successfully!")
            else:
                st.error("Invite creation failed.")

        elif operation == "List Users":
            users = list_users(AUTHENTIK_API_URL, headers, username_input if username_input else None)
            st.session_state['user_list'] = users
            st.session_state['message'] = "Users listed successfully!"

    except Exception as e:
        st.error(f"An error occurred: {e}")

# Display any messages or errors from previous actions
if 'message' in st.session_state:
    st.success(st.session_state['message'])

# Display the user list and handle user actions
if 'user_list' in st.session_state and st.session_state['user_list']:
    df = pd.DataFrame(st.session_state['user_list'])

    # Sorting options for the user list
    sort_by = st.selectbox("Sort by", options=["username", "email", "is_active"], index=0)
    sort_ascending = st.radio("Sort order", ("Ascending", "Descending"))
    df = df.sort_values(by=sort_by, ascending=(sort_ascending == "Ascending"))

    # Checkbox for selecting users
    selected_users = []
    for idx, row in df.iterrows():
        if st.checkbox(f"**Username**: {row['username']}, **Email**: {row['email']}, **Active**: {row['is_active']}", key=row['username']):
            selected_users.append(row)

    st.write(f"Selected Users: {len(selected_users)}")

    # Actions for selected users
    if selected_users:
        st.write("**Actions for Selected Users**")
        action = st.selectbox("Select Action", ["Activate", "Deactivate", "Reset Password", "Delete"])

        if action == "Reset Password":
            new_password = st.text_input("Enter new password", type="password")

        if st.button("Apply"):
            try:
                for user in selected_users:
                    user_id = user['pk']
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
                st.success(f"{action} action applied successfully to selected users.")
            except Exception as e:
                st.error(f"An error occurred while applying {action} action: {e}")

    st.dataframe(df)

# Clean up session state
if 'message' in st.session_state:
    del st.session_state['message']