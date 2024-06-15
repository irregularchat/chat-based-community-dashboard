#authentik-creation-workflow.py
import random
import string
import requests
from dotenv import load_dotenv
import os
import sys
import json
import pyperclip

########## Configuration ##########
# Load environment variables from .env file
load_dotenv()

# Define the vars coming from the .env file
base_domain = "irregularchat.com"  # Update this to your domain
token = os.getenv("AUTHENTIK_API_TOKEN")

if not token:
    raise ValueError("The AUTHENTIK_API_TOKEN environment variable is not set.")
main_group_id = os.getenv("MAIN_GROUP_ID")
if not main_group_id:
    raise ValueError("The MAIN_GROUP_ID environment variable is not set.")
API_URL = f"https://sso.{base_domain}/api/v3/"  # Ensure trailing slash

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

########## Functions ##########
# Function to get user ID by username
def get_user_id_by_username(API_URL, headers, username):
    url = f"{API_URL}core/users/?search={username}"
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    users = response.json()['results']
    if not users:
        raise ValueError(f"User with username {username} not found.")
    return users[0]['pk']

# Function to create an invite code
def create_invite(API_URL, headers, name, expires=None):
    current_time_str = datetime.utcnow().strftime('%Y-%m-%dT%H-%M-%S')
    if not name:
        name = current_time_str
    else:
        name = f"{name}-{current_time_str}"
    
    if expires is None:
        expires = (datetime.utcnow() + timedelta(hours=2)).isoformat() + "Z"
    
    data = {
        "name": name,
        "expires": expires,
        "fixed_data": {},
        "single_use": True,
        "flow": "simple-enrollment-flow"  # Replace with the actual flow ID if needed
    }
    
    url = f"{API_URL}core/invites/"
    response = requests.post(url, headers=headers, json=data)
    if response.status_code == 403:
        print(f"403 Forbidden Error: Check if the API token has the necessary permissions to access {url}")
    response.raise_for_status()
    return response.json()['pk']

# Function to generate a strong password
def generate_password():
    base_password = os.getenv("base_password")
    if not base_password:
        raise ValueError("The base_password environment variable is not set.")

    # Ensure the total length accounts for the base password
    random_length = 3

    # Characters to be used in the random part of the password
    characters = string.ascii_letters + string.digits 

    # Generate the random part of the password
    random_part = ''.join(random.choice(characters) for i in range(random_length))
    
    # Combine the base password with the random part
    password = base_password + random_part
    return password

# Function to reset a user's password
def reset_user_password(API_URL, headers, username):
    user_id = get_user_id_by_username(API_URL, headers, username)  # Get user ID by username
    new_password = generate_password()
    data = json.dumps({
        "password": new_password
    })
    url = f"{API_URL}core/users/{user_id}/set_password/"
    response = requests.post(url, headers=headers, data=data)
    if response.status_code == 403:
        print(f"403 Forbidden Error: Check if the API token has the necessary permissions to access {url}")
    response.raise_for_status()
    return new_password

# Function to set a user's password
def set_user_password(API_URL, headers, user_id, password):
    data = json.dumps({
        "password": password
    })
    url = f"{API_URL}core/users/{user_id}/set_password/"
    response = requests.post(url, headers=headers, data=data)
    if response.status_code == 403:
        print(f"403 Forbidden Error: Check if the API token has the necessary permissions to access {url}")
    response.raise_for_status()
    return password

# Function to create a unique username
def create_unique_username(base_username, existing_usernames):
    counter = 1
    new_username = base_username
    while new_username in existing_usernames:
        new_username = f"{base_username}{counter}"
        counter += 1
    return new_username

# Function to get existing usernames
# Documentation: https://docs.goauthentik.io/developer-docs/api/reference/core-users-list
def get_existing_usernames(API_URL, headers):
    url = f"{API_URL}core/users/"
    response = requests.get(url, headers=headers)  # Ensure URL is properly constructed
    if response.status_code == 403:
        print(f"403 Forbidden Error: Check if the API token has the necessary permissions to access {url}")
    response.raise_for_status()
    users = response.json()['results']  # Assuming the API returns paginated results
    return {user['username'] for user in users}

# Function to create a new user
def create_user(API_URL, headers, username, password):
    main_group_id = os.getenv("MAIN_GROUP_ID")
    if not main_group_id:
        raise ValueError("The MAIN_GROUP_ID environment variable is not set.")
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
    if response.status_code == 403:
        print(f"403 Forbidden Error: Check if the API token has the necessary permissions to access {url}")
    if response.status_code == 400:
        print(f"400 Bad Request: The username {username} is already taken.")
        return None  # Signal that the username is taken
    response.raise_for_status()
    user_id = response.json()['pk']
    # Set the password for the new user
    set_user_password(API_URL, headers, user_id, password)
    return user_id

# Determine operation (create user, reset password, or create invite) from command-line arguments
if len(sys.argv) < 3:
    raise ValueError("Usage: script.py [create|reset|invite] [username|invite_name] [expires(optional)]")

operation = sys.argv[1]
entity_name = sys.argv[2] if len(sys.argv) > 2 else None
expires = sys.argv[3] if len(sys.argv) > 3 else None

if operation not in ['create', 'reset', 'invite']:
    raise ValueError("Invalid operation. Use 'create' to create a user, 'reset' to reset a password, or 'invite' to create an invite.")

# Check if the API URL can be resolved
try:
    response = requests.get(f"{API_URL}core/users/", headers=headers)
    response.raise_for_status()
except requests.exceptions.RequestException as e:
    print(f"Error: Unable to connect to the API at {API_URL}core/users/. Please check the URL and your network connection.")
    print(f"Exception: {e}")
    sys.exit(1)

# Main logic based on operation
if operation == 'create':
    existing_usernames = get_existing_usernames(API_URL, headers)
    new_username = create_unique_username(entity_name, existing_usernames)
    new_password = generate_password()
    new_user = create_user(API_URL, headers, new_username, new_password)
    
    while new_user is None:  # Username is taken
        print(f"DEBUG: Username {new_username} was taken, attempting to handle it.")
        action = input(f"The username '{new_username}' is already taken. Do you want to (1) create another user with a modified username or (2) reset the password? Enter 1 or 2: ")
        if action == '1':
            new_username = create_unique_username(entity_name, existing_usernames)
            print(f"DEBUG: Trying with new modified username: {new_username}")
            new_user = create_user(API_URL, headers, new_username, new_password)
            if new_user is None:
                print("Failed to create a new user. Please try again.")
                sys.exit(1)
        elif action == '2':
            new_password = reset_user_password(API_URL, headers, entity_name)
            reset_message = f"""
            PASSWORD: {new_password}
            Username: {entity_name}

            🌟 Your password has been reset 
            Use the password and username above to obtain Login: https://sso.irregularchat.com/ 
            """
            print(reset_message)
            pyperclip.copy(reset_message)
            print("The above message has been copied to the clipboard.")
            sys.exit(0)
        else:
            print("Invalid action. Exiting script.")
            sys.exit(1)
    
    # Instead of just printing, this should also copy to clipboard
    welcome_message = f"""
    Temp PASSWORD: {new_password}
    Username: {new_username}
    
    🌟 Welcome to the IrregularChat Community of Interest (CoI)! 🌟
    You've just joined a community focused on breaking down silos, fostering innovation, and supporting service members and veterans. Here's what you need to know to get started and a guide to join the wiki and other services:

    ---
    Step 1:
    - Use the password and username above to obtain your Irregular Chat Login, giving you access to the wiki and other services: https://sso.irregularchat.com/ 
    Step 2:
    - Login to the wiki with that Irregular Chat Login and visit https://wiki.irregularchat.com/community/welcome


    ------
    """
    print(welcome_message)
    pyperclip.copy(welcome_message)
    print("The above message has been copied to the clipboard.")

elif operation == 'reset':
    new_password = reset_user_password(API_URL, headers, entity_name)
    reset_message = f"""
    PASSWORD: {new_password}
    Username: {entity_name}

    🌟 Your password has been reset 
    Use the password and username above to obtain Login: https://sso.irregularchat.com/ 
    """

    print(reset_message)
    pyperclip.copy(reset_message)
    print("The above message has been copied to the clipboard.")

elif operation == 'invite':
    invite_id = create_invite(API_URL, headers, entity_name, expires)
    invite_message = f"""
    Invite created successfully!
    Invite ID: {invite_id}
    Name: {entity_name}
    Expires: {expires if expires else '2 hours from now'}

    🌟 Use the invite ID to proceed with the enrollment.
    """
    print(invite_message)
    pyperclip.copy(invite_message)
    print("The above message has been copied to the clipboard.")