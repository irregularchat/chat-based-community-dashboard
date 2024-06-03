#authentik-creation-workflow.py
import random
import string
import requests
from dotenv import load_dotenv
import os
import sys
import json
import pyperclip

########## Debugging ##########
def debug(message):
    print(f"DEBUG: {message}")

########## Configuration ##########
# Load environment variables from .env file
load_dotenv()
debug("Loaded environment variables from .env file")

# Define the vars coming from the .env file
base_domain = "irregularchat.com"  # Update this to your domain
token = os.getenv("AUTHENTIK_API_TOKEN")
debug(f"Token: {token}")

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
debug("Headers set")

########## Functions ##########
# Function to get user ID by username
def get_user_id_by_username(API_URL, headers, username):
    url = f"{API_URL}core/users/?search={username}"
    debug(f"get_user_id_by_username URL: {url}")
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    users = response.json()['results']
    debug(f"Users found: {users}")
    if not users:
        raise ValueError(f"User with username {username} not found.")
    debug(f"User ID found: {users[0]['pk']}")
    return users[0]['pk']

debug("Functions defined")

# Function to generate a strong password
def generate_password():
    debug("Generating password")
    base_password = os.getenv("base_password")
    if not base_password:
        raise ValueError("The base_password environment variable is not set.")
    debug(f"Base password: {base_password}")

    # Ensure the total length accounts for the base password
    random_length = 3
    debug(f"Random length: {random_length}")

    # Characters to be used in the random part of the password
    characters = string.ascii_letters + string.digits 
    debug(f"Characters: {characters}")

    # Generate the random part of the password
    random_part = ''.join(random.choice(characters) for i in range(random_length))
    
    # Combine the base password with the random part
    password = base_password + random_part
    debug(f"Generated password: {password}")
    return password

debug("Password generated")

# Function to reset a user's password
def reset_user_password(API_URL, headers, username):
    user_id = get_user_id_by_username(API_URL, headers, username)  # Get user ID by username
    new_password = generate_password()
    data = json.dumps({
        "password": new_password
    })
    url = f"{API_URL}core/users/{user_id}/set_password/"
    debug(f"reset_user_password URL: {url}")
    response = requests.post(url, headers=headers, data=data)
    if response.status_code == 403:
        print(f"403 Forbidden Error: Check if the API token has the necessary permissions to access {url}")
    response.raise_for_status()
    debug(f"Password reset for user {username}")
    debug(f"New password: {new_password}")
    return new_password

debug("Password reset")

# Function to set a user's password
def set_user_password(API_URL, headers, user_id, password):
    data = json.dumps({
        "password": password
    })
    url = f"{API_URL}core/users/{user_id}/set_password/"
    debug(f"set_user_password URL: {url}")
    response = requests.post(url, headers=headers, data=data)
    if response.status_code == 403:
        print(f"403 Forbidden Error: Check if the API token has the necessary permissions to access {url}")
    response.raise_for_status()
    debug(f"Password set for user ID {user_id}")
    return password

debug("Password setting function defined")

# Function to create a unique username
def create_unique_username(base_username, existing_usernames):
    username = base_username
    counter = 1
    # Debugging print statement to trace execution
    print(f"Trying base username: {username}")
    while username in existing_usernames:
        username = f"{base_username}{counter}"
        print(f"Username {username} already taken, trying {username}")
        counter += 1
    print(f"Unique username found: {username}")
    debug(f"Unique username found: {username}")
    return username

debug("Unique username created")

# Function to get existing usernames
# Documentation: https://docs.goauthentik.io/developer-docs/api/reference/core-users-list
def get_existing_usernames(API_URL, headers):
    url = f"{API_URL}core/users/"
    debug(f"get_existing_usernames URL: {url}")
    response = requests.get(url, headers=headers)  # Ensure URL is properly constructed
    if response.status_code == 403:
        print(f"403 Forbidden Error: Check if the API token has the necessary permissions to access {url}")
    response.raise_for_status()
    users = response.json()['results']  # Assuming the API returns paginated results
    debug(f"Existing usernames: {[user['username'] for user in users]}")
    return {user['username'] for user in users}

debug("Existing usernames retrieved")

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
    debug(f"create_user URL: {url}")
    response = requests.post(url, headers=headers, json=data)
    if response.status_code == 403:
        print(f"403 Forbidden Error: Check if the API token has the necessary permissions to access {url}")
    response.raise_for_status()
    debug(f"User {username} created")
    user_id = response.json()['pk']
    debug(f"User ID: {user_id}")
    # Set the password for the new user
    set_user_password(API_URL, headers, user_id, password)
    return user_id

debug("User created")

# Determine operation (create user or reset password) from command-line arguments
if len(sys.argv) < 3:
    raise ValueError("Usage: script.py [create|reset] username")

debug("Arguments parsed")
operation = sys.argv[1]
username = sys.argv[2]
debug(f"Operation: {operation}")

if operation not in ['create', 'reset']:
    raise ValueError("Invalid operation. Use 'create' to create a user or 'reset' to reset a password.")
debug("Operation validated")

# Check if the API URL can be resolved
try:
    debug(f"Validating API URL: {API_URL}core/users/")
    response = requests.get(f"{API_URL}core/users/", headers=headers)
    response.raise_for_status()
except requests.exceptions.RequestException as e:
    debug(f"Error: Unable to connect to the API at {API_URL}core/users/. Please check the URL and your network connection.")
    print(f"Exception: {e}")
    debug("Exiting script")
    sys.exit(1)

debug("API URL validated")

# Main logic based on operation
if operation == 'create':
    debug("Creating new user")
    existing_usernames = get_existing_usernames(API_URL, headers)
    debug(f"Existing usernames: {existing_usernames}")
    new_username = create_unique_username(username, existing_usernames)
    debug(f"New username: {new_username}")
    new_password = generate_password()
    debug(f"New password: {new_password}")
    new_user = create_user(API_URL, headers, new_username, new_password)
    debug(f"New user created with username {new_username}")
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
    debug("Resetting user password")
    new_password = reset_user_password(API_URL, headers, username)
    debug(f"Password reset for user {username}")
    reset_message = f"""
    PASSWORD: {new_password}
    Username: {username}

    🌟 Your password has been reset 
    Use the password and username above to obtain Login: https://sso.irregularchat.com/ 
    """

    print(reset_message)
    pyperclip.copy(reset_message)
    print("The above message has been copied to the clipboard.")
