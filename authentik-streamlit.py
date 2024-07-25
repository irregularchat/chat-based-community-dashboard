import streamlit as st
import requests
from datetime import datetime, timedelta, timezone

########## Configuration ##########
# Define the vars for the app
st.title("IrregularChat Authentik Management")

base_domain = "irregularchat.com"  # Update this to your domain
token = st.text_input("Enter your AUTHENTIK API TOKEN", type="password")
main_group_id = st.text_input("Enter the MAIN GROUP ID")

if not token or not main_group_id:
    st.warning("Please enter both the API token and the main group ID to proceed.")
    st.stop()

API_URL = f"https://sso.{base_domain}/api/v3/"
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

########## Functions ##########
def get_user_id_by_username(API_URL, headers, username):
    url = f"{API_URL}core/users/?search={username}"
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    users = response.json()['results']
    if not users:
        raise ValueError(f"User with username {username} not found.")
    return users[0]['pk']

def create_invite(API_URL, headers, name, expires=None):
    current_time_str = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H-%M-%S')
    if not name:
        name = current_time_str
    else:
        name = f"{name}-{current_time_str}"
    
    if expires is None:
        expires = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    
    data = {
        "name": name,
        "expires": expires,
        "fixed_data": {},
        "single_use": True,
        "flow": "41a44b0e-1d06-4551-9ec1-41bd793b6f27"
    }
    
    url = f"{API_URL}/stages/invitation/invitations/"
    response = requests.post(url, headers=headers, json=data)
    response.raise_for_status()
    return response.json()['pk']

def generate_recovery_link(API_URL, headers, username):
    user_id = get_user_id_by_username(API_URL, headers, username)
    
    url = f"{API_URL}core/users/{user_id}/recovery/"
    response = requests.post(url, headers=headers)
    response.raise_for_status()
    
    recovery_link = response.json().get('link')
    if not recovery_link:
        raise ValueError("Failed to generate recovery link.")
    
    return recovery_link

def create_unique_username(base_username, existing_usernames):
    counter = 1
    new_username = base_username
    while new_username in existing_usernames:
        new_username = f"{base_username}{counter}"
        counter += 1
    return new_username

def get_existing_usernames(API_URL, headers):
    url = f"{API_URL}core/users/"
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    users = response.json()['results']
    return {user['username'] for user in users}

def create_user(API_URL, headers, username):
    data = {
        "username": username,
        "name": username,
        "is_active": True,
        "email": f"{username}@{base_domain}",
        "groups": [main_group_id],
        "attributes": {},
        "path": "users",
        "type": "internal"
    }
    url = f"{API_URL}core/users/"
    response = requests.post(url, headers=headers, json=data)
    if response.status_code == 400:
        return None
    response.raise_for_status()
    return response.json()['pk']

########## Streamlit Interface ##########
operation = st.selectbox("Select Operation", ["Create User", "Generate Recovery Link", "Create Invite"])

entity_name = st.text_input("Enter Username or Invite Name")
expires = st.text_input("Enter Expiration Time (optional, format: YYYY-MM-DDTHH:MM:SS)")

if st.button("Submit"):
    try:
        if operation == "Create User":
            existing_usernames = get_existing_usernames(API_URL, headers)
            new_username = create_unique_username(entity_name, existing_usernames)
            new_user = create_user(API_URL, headers, new_username)
            
            while new_user is None:
                new_username = create_unique_username(entity_name, existing_usernames)
                new_user = create_user(API_URL, headers, new_username)
            
            recovery_link = generate_recovery_link(API_URL, headers, new_username)
            welcome_message = f"""
            🌟 Welcome to the IrregularChat Community of Interest (CoI)! 🌟
            You've just joined a community focused on breaking down silos, fostering innovation, and supporting service members and veterans. Here's what you need to know to get started and a guide to join the wiki and other services:
            Username: {new_username}
            ---
            Step 1:
            - Activate your IrregularChat Login with your username ({new_username}) here: {recovery_link}
            Step 2:
            - Login to the wiki with that Irregular Chat Login and visit https://wiki.irregularchat.com/community/welcome
            """
            st.success(welcome_message)
        
        elif operation == "Generate Recovery Link":
            recovery_link = generate_recovery_link(API_URL, headers, entity_name)
            recovery_message = f"""
            🌟 Your account recovery link 🌟
            Username: {entity_name}
            Recovery Link: {recovery_link}

            Use the link above to recover your account.
            """
            st.success(recovery_message)
        
        elif operation == "Create Invite":
            invite_id = create_invite(API_URL, headers, entity_name, expires)
            invite_message = f"""
            🌟 Welcome to the IrregularChat Community of Interest (CoI)! 🌟
            You've just joined a community focused on breaking down silos, fostering innovation, and supporting service members and veterans. Here's what you need to know to get started and a guide to join the wiki and other services:
            IrregularChat Temp Invite: https://sso.irregularchat.com/if/flow/simple-enrollment-flow/?itoken={invite_id}
            Invite Expires: {expires if expires else '2 hours from now'}

            🌟 After you login you'll see options for the wiki, matrix "element messenger", and other self-hosted services. 
            Login to the wiki with that Irregular Chat Login and visit https://wiki.irregularchat.com/community/links/
            """
            st.success(invite_message)

    except Exception as e:
        st.error(f"An error occurred: {e}")
