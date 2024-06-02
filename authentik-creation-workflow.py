#authentik-creation-workflow.py
import random
import string
import requests
from dotenv import load_dotenv
import os
import sys
import json

# Load environment variables from .env file
# API_URL, authentik_api_token, base_password, MAIN_GROUP_ID
load_dotenv()
base_domain = "irregularchat.com" #update this to your domain

API_URL = f"https://sso.{base_domain}/api/v3"  # Correct construction of API_URL
# debugging
# # Debugging to ensure environment variables are loaded
# print(f"MAIN_GROUP_ID: {os.getenv('MAIN_GROUP_ID')}")
# print(f"AUTHENTIK_API_TOKEN: {os.getenv('AUTHENTIK_API_TOKEN')}")
# print(f"base_password: {os.getenv('base_password')}")

# Function to generate a strong password
def generate_password():
    base_password = os.getenv("base_password")
    if not base_password:
        raise ValueError("The base_password environment variable is not set.")
    
    # Ensure the total length accounts for the base password
    random_length = 5
    
    # Characters to be used in the random part of the password
    characters = string.ascii_letters + string.digits + string.punctuation
    
    # Generate the random part of the password
    random_part = ''.join(random.choice(characters) for i in range(random_length))
    
    # Combine the base password with the random part
    password = base_password + random_part
    
    return password

# Function to create a unique username
def create_unique_username(base_username, existing_usernames):
    username = base_username
    counter = 1
    while username in existing_usernames:
        username = f"{base_username}{counter}"
        counter += 1
    return username

# Function to get existing usernames
# documentation https://docs.goauthentik.io/developer-docs/api/reference/core-users-list
def get_existing_usernames(API_URL, headers):
    url = f"{API_URL}/core/users/"
    response = requests.get(url, headers=headers)  # Ensure URL is properly constructed
    if response.status_code == 403:
        print(f"403 Forbidden Error: Check if the API token has the necessary permissions to access {url}")
    response.raise_for_status()
    users = response.json()['results']  # Assuming the API returns paginated results
    return {user['username'] for user in users}


# Function to create a new user
# Function to create a new user
def create_user(API_URL, headers, username, password):
    main_group_id = os.getenv("MAIN_GROUP_ID")  # Load from environment variable
    if not main_group_id:
        raise ValueError("The MAIN_GROUP_ID environment variable is not set.")
    
    data = json.dumps({
        "username": username,
        "name": username,
        "is_active": True,
        "email": f"{username}@{base_domain}",
        "groups": [
            main_group_id  # Now using the environment variable
        ],
        "attributes": {},
        "path": "users",
        "type": "internal"
    })
    url = f"{API_URL}/core/users/"
    response = requests.post(url, headers=headers, data=data)  # Ensure URL is properly constructed
    if response.status_code == 403:
        print(f"403 Forbidden Error: Check if the API token has the necessary permissions to access {url}")
    response.raise_for_status()
    return response.json()

# Load API settings from environment variables
# Load API settings from environment variables
API_URL = os.getenv("API_URL")
if not API_URL.endswith('/'):
    API_URL = API_URL + '/'
if not API_URL:
    raise ValueError("The API_URL environment variable is not set.")

token = os.getenv("AUTHENTIK_API_TOKEN")
if not token:
    raise ValueError("The AUTHENTIK_API_TOKEN environment variable is not set.")

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# Get the base username from the command-line argument or raise an error if not provided
if len(sys.argv) > 1:
    base_username = sys.argv[1]
else:
    raise ValueError("A base username must be provided as a command-line argument.")

# Check if the API URL can be resolved
try:
    response = requests.get(API_URL, headers=headers)
    response.raise_for_status()
except requests.exceptions.RequestException as e:
    print(f"Error: Unable to connect to the API at {API_URL}. Please check the URL and your network connection.")
    sys.exit(1)

# Get existing usernames
existing_usernames = get_existing_usernames(API_URL, headers)

# Generate unique username and strong password
new_username = create_unique_username(base_username, existing_usernames)
new_password = generate_password()

# Create new user account
new_user = create_user(API_URL, headers, new_username, new_password)

print(f"""
Temp PASSWORD: {new_password}
Username: {new_username}

🌟 Welcome to the IrregularChat Community of Interest (CoI)! 🌟
You've just joined a community focused on breaking down silos, fostering innovation, and supporting service members and veterans. Here's what you need to know to get started and a guide to join the wiki and other services:

    ---
    Step 1:
    - Use the password and username above to obtain your Irregular Chat Login, giving you access to the wiki and other services: https://sso.irregularchat.com/ 
    Step 2: 
    - Then change your password AND email here: https://sso.irregularchat.com/if/user/#/settings;%7B%22page%22%3A%22page-details%22%7D
    Step 3:
    - Login to the wiki with that Irregular Chat Login and visit https://wiki.irregularchat.com/community/welcome


    ------
""")