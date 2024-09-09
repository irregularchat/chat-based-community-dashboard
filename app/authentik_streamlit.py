# authentik-streamlit.py
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
from auth.session_init import initialize_session_state
# Call the function to initialize session state
initialize_session_state()


# Load environment variables from .env file
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
PAGE_TITLE = os.getenv("PAGE_TITLE")
FAVICON_URL = os.getenv("FAVICON_URL")


# Configuration
# Define the Eastern Time zone for accurate time processing
eastern = timezone('US/Eastern')
current_time_eastern = datetime.now(eastern)

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
def create_user(AUTHENTIK_API_URL, headers, username, email, name, intro=None, invited_by=None):
    # Add intro and invited_by to the user attributes
    data = {
        "username": username,
        "name": name,
        "is_active": True,
        "email": email,
        "groups": [MAIN_GROUP_ID],
        "attributes": {
            "intro": intro,              # Pass intro attribute
            "invited_by": invited_by      # Pass invited_by attribute
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
    # Update the search query only if search_term is provided
    url = f"{AUTHENTIK_API_URL}/core/users/?search={search_term}" if search_term else f"{AUTHENTIK_API_URL}/core/users/"
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    users = response.json()['results']
    
    # Adding necessary fields like name, last_login, and attributes (intro, invited_by)
    user_list = []
    for user in users:
        user_list.append({
            'username': user['username'],
            'email': user['email'],
            'is_active': user['is_active'],
            'pk': user.get('pk', 'N/A'),  # User ID
            'name': user.get('name', 'N/A'),  # Full name
            'last_login': user.get('last_login', 'N/A'),  # Add 'N/A' if no last login available
            'intro': user['attributes'].get('intro', 'N/A'),  # Intro from attributes
            'invited_by': user['attributes'].get('invited_by', 'N/A')  # Invited by from attributes
        })

    return user_list

# Function to update a user's status
def update_user_status(AUTHENTIK_API_URL, headers, user_id, is_active):
    url = f"{AUTHENTIK_API_URL}/core/users/{user_id}/"
    data = {"is_active": is_active}
    response = requests.patch(url, headers=headers, json=data)
    response.raise_for_status()
    return response.json()
def update_user_intro(AUTHENTIK_API_URL, headers, user_id, intro_text):
    url = f"{AUTHENTIK_API_URL}/core/users/{user_id}/"
    data = {"attributes": {"intro": intro_text}}
    response = requests.patch(url, headers=headers, json=data)
    response.raise_for_status()
    return response.json()

def update_user_invited_by(AUTHENTIK_API_URL, headers, user_id, invited_by):
    url = f"{AUTHENTIK_API_URL}/core/users/{user_id}/"
    data = {"attributes": {"invited_by": invited_by}}
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

def display_message():
    """Display any previously stored message."""
    if 'message' in st.session_state:
        st.success(st.session_state['message'])

def clear_session_state():
    """Clear session state after the user list has been displayed."""
    if 'message' in st.session_state:
        del st.session_state['message']

def display_user_list(AUTHENTIK_API_URL, headers):
    initialize_session_state()
    # Check if user list is available and display
    if st.session_state['user_list']:
        users = st.session_state['user_list']
        df = pd.DataFrame(users)

        # Sorting options for the user list
        sort_by = st.selectbox("Sort by", options=["username", "email", "is_active", "name", "last_login"], index=0)
        sort_ascending = st.radio("Sort order", ("Ascending", "Descending"))
        df = df.sort_values(by=sort_by, ascending=(sort_ascending == "Ascending"))

        # Display the user list with the new fields
        for idx, row in df.iterrows():
            st.write(f"**Username**: {row['username']}, **Name**: {row['name']}, **Email**: {row['email']}, "
                     f"**Active**: {row['is_active']}, **Last Login**: {row['last_login']}, "
                     f"**Intro**: {row['intro']}, **Invited By**: {row['invited_by']}")

            if st.checkbox(f"Select {row['username']}", key=row['username']):
                if row['username'] not in st.session_state['selected_users']:
                    st.session_state['selected_users'].append(row['username'])
            else:
                if row['username'] in st.session_state['selected_users']:
                    st.session_state['selected_users'].remove(row['username'])

        st.write(f"Selected Users: {len(st.session_state['selected_users'])}")

        # Actions for selected users
        if st.session_state['selected_users']:
            st.write("**Actions for Selected Users**")
            action = st.selectbox("Select Action", ["Activate", "Deactivate", "Reset Password", "Delete", "Add Intro", "Add Invited By"])

            if action == "Reset Password":
                new_password = st.text_input("Enter new password", type="password")

            if action == "Add Intro":
                intro_text = st.text_area("Enter Intro Text", height=2)

            if action == "Add Invited By":
                invited_by = st.text_input("Enter Invited By")

            # Apply actions
            if st.button("Apply"):
                try:
                    for username in st.session_state['selected_users']:
                        user_data = df[df['username'] == username]
                        
                        if not user_data.empty:
                            user_id = user_data.iloc[0]['pk']  # Corrected to access 'user_data'
                        else:
                            st.warning(f"No data found for the username: {username}")
                            continue  # Skip to the next iteration if no user data is found

                        # Now process the action for the current user
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
                    st.error(f"An error occurred: {e}")