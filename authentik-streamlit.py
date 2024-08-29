import streamlit as st
import requests
import pandas as pd
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
import os

load_dotenv()

########## Configuration ##########
# Site Static Content
favicon_url = "https://filedn.com/lDsr08WnANmQTUJg2h6Jg2Q/Logos/Irregular%20Chat-Tech.png"
st.set_page_config(page_title="IrregularChat User Management", page_icon=favicon_url)
st.title("IrregularChat User Management")
# Adding the list of links under the title
st.markdown("""
- [Login to the IrregularChat SSO](https://sso.irregularchat.com)
- [Use the Signal CopyPasta for Welcome Messages](https://wiki.irregularchat.com/en/community/chat/admin/signal-prompts)
- [Admin Prompts for Common Situations](https://wiki.irregularchat.com/community/chat/admin.md)
- [Links to All the Community Chats and Services](https://wiki.irregularchat.com/community/links.md)
""")
# Define the vars for the app
AUTHENTIK_API_TOKEN = os.getenv("AUTHENTIK_API_TOKEN")
MAIN_GROUP_ID = os.getenv("MAIN_GROUP_ID")
base_domain = os.getenv("BASE_DOMAIN")

# If AUTHENTIK_API_TOKEN or MAIN_GROUP_ID are blank, ask the user to input the values
if not AUTHENTIK_API_TOKEN or not MAIN_GROUP_ID:
    st.warning("Please enter both the API token and the main group ID to proceed.")
    AUTHENTIK_API_TOKEN = st.text_input("Enter your AUTHENTIK API TOKEN", type="password")
    MAIN_GROUP_ID = st.text_input("Enter the MAIN GROUP ID")
    st.stop()

API_URL = f"https://sso.{base_domain}/api/v3/"
headers = {
    "Authorization": f"Bearer {AUTHENTIK_API_TOKEN}",
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
    return response.json()['pk'], expires

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
        "groups": [MAIN_GROUP_ID],
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

def list_users(API_URL, headers, search_term=None):
    if search_term:
        url = f"{API_URL}core/users/?search={search_term}"
    else:
        url = f"{API_URL}core/users/"
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    users = response.json()['results']
    return users

def update_user_status(API_URL, headers, user_id, is_active):
    url = f"{API_URL}core/users/{user_id}/"
    data = {"is_active": is_active}
    response = requests.patch(url, headers=headers, json=data)
    response.raise_for_status()
    return response.json()

def delete_user(API_URL, headers, user_id):
    url = f"{API_URL}core/users/{user_id}/"
    response = requests.delete(url, headers=headers)
    response.raise_for_status()
    return response.status_code == 204

def reset_user_password(API_URL, headers, user_id, new_password):
    url = f"{API_URL}core/users/{user_id}/set_password/"
    data = {"password": new_password}
    response = requests.post(url, headers=headers, json=data)
    response.raise_for_status()
    return response.json()

########## Streamlit Interface ##########
operation = st.selectbox("Select Operation", [
    "Create User", 
    "Generate Recovery Link", 
    "Create Invite",
    "List Users"
])

entity_name = st.text_input("Enter Username or Invite Name (if applicable)")
email_input = st.text_input("Enter Email Address (optional)")

# Show date and time inputs only for specific operations
if operation in ["Generate Recovery Link", "Create Invite"]:
    expires_default = datetime.now() + timedelta(hours=2)
    expires_date = st.date_input("Enter Expiration Date (optional)", value=expires_default.date())
    expires_time = st.time_input("Enter Expiration Time (optional)", value=expires_default.time())
else:
    expires_date, expires_time = None, None

if st.button("Submit"):
    try:
        if operation == "Create User":
            existing_usernames = get_existing_usernames(API_URL, headers)
            new_username = create_unique_username(entity_name, existing_usernames)
            email = email_input if email_input else f"{new_username}@{base_domain}"
            new_user = create_user(API_URL, headers, new_username, email)
            
            while new_user is None:
                new_username = create_unique_username(entity_name, existing_usernames)
                new_user = create_user(API_URL, headers, new_username, email)
            
            recovery_link = generate_recovery_link(API_URL, headers, new_username)
            welcome_message = f"""
🌟 Welcome to the IrregularChat Community of Interest (CoI)! 🌟
You've just joined a community focused on breaking down silos, fostering innovation, and supporting service members and veterans. Here's what you need to know to get started and a guide to join the wiki and other services:
---
Username: {new_username}

^^^^^^^^ See Above for User Name ^^^^^^^^^^^

**Step 1**:
- Activate your IrregularChat Login with your username ({new_username}) here: {recovery_link}

**Step 2**:
- Login to the wiki with that Irregular Chat Login and visit https://wiki.irregularchat.com/community/welcome
"""
            st.code(welcome_message, language='markdown')
            st.session_state['message'] = welcome_message
            st.session_state['user_list'] = None  # Clear user list if there was any
            st.success("User created successfully!")
        
        # Other operations remain unchanged
        
        elif operation == "Generate Recovery Link":
            recovery_link = generate_recovery_link(API_URL, headers, entity_name)
            recovery_message = f"""
🌟 Your account recovery link 🌟
**Username**: {entity_name}
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
                expires = local_expires.astimezone(timezone.utc).isoformat()
            else:
                expires = None
            
            invite_id, invite_expires = create_invite(API_URL, headers, entity_name, expires)
            invite_expires_time = datetime.fromisoformat(invite_expires).astimezone(timezone.utc) - datetime.now(timezone.utc)
            hours, remainder = divmod(invite_expires_time.total_seconds(), 3600)
            minutes, _ = divmod(remainder, 60)
            invite_message = f"""
            🌟 Welcome to the IrregularChat Community of Interest (CoI)! 🌟
            You've just joined a community focused on breaking down silos, fostering innovation, and supporting service members and veterans. Here's what you need to know to get started and a guide to join the wiki and other services:
            **IrregularChat Temp Invite**: https://sso.irregularchat.com/if/flow/simple-enrollment-flow/?itoken={invite_id}
            **Invite Expires**: {int(hours)} hours and {int(minutes)} minutes from now
            
            🌟 After you login you'll see options for the wiki, the forum, matrix "element messenger", and other self-hosted services. 
            Login to the wiki with that Irregular Chat Login and visit https://wiki.irregularchat.com/community/links/
            """
            
            
            st.session_state['user_list'] = None  # Clear user list if there was any
            st.success("Invite created successfully!")
            #create code block with invite message make sure that the copy button works and shows click when clicked
            st.code(invite_message, language='markdown')
            st.session_state['message'] = invite_message
        
        elif operation == "List Users":
            users = list_users(API_URL, headers, entity_name if entity_name else None)
            st.session_state['user_list'] = users
            st.session_state['message'] = "Users listed successfully!"

    except Exception as e:
        st.error(f"An error occurred: {e}")

if 'message' in st.session_state:
    st.success(st.session_state['message'])

if 'user_list' in st.session_state and st.session_state['user_list']:
    df = pd.DataFrame(st.session_state['user_list'])

    # Sorting options
    sort_by = st.selectbox("Sort by", options=["username", "email", "is_active"], index=0)
    sort_ascending = st.radio("Sort order", ("Ascending", "Descending"))
    df = df.sort_values(by=sort_by, ascending=(sort_ascending == "Ascending"))

    selected_users = []
    for idx, row in df.iterrows():
        if st.checkbox(f"**Username**: {row['username']}, **Email**: {row['email']}, **Active**: {row['is_active']}", key=row['username']):
            selected_users.append(row)

    st.write(f"Selected Users: {len(selected_users)}")

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
                        update_user_status(API_URL, headers, user_id, True)
                    elif action == "Deactivate":
                        update_user_status(API_URL, headers, user_id, False)
                    elif action == "Reset Password":
                        if new_password:
                            reset_user_password(API_URL, headers, user_id, new_password)
                        else:
                            st.warning("Please enter a new password")
                            break
                    elif action == "Delete":
                        delete_user(API_URL, headers, user_id)
                st.success(f"{action} action applied successfully to selected users.")
            except Exception as e:
                st.error(f"An error occurred while applying {action} action: {e}")

    st.dataframe(df)

if 'message' in st.session_state:
    del st.session_state['message']
