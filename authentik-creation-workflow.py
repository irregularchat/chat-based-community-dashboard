#authentik-creation-workflow.py
import random
import string
import requests
from dotenv import load_dotenv
import os
import sys
import json

# Load environment variables from .env file
# api_url, authentik_api_token, base_password, MAIN_GROUP_ID
load_dotenv()
# debugging
# Debugging to ensure environment variables are loaded
print(f"API_URL: {os.getenv('API_URL')}")
print(f"AUTHENTIK_API_TOKEN: {os.getenv('AUTHENTIK_API_TOKEN')}")
print(f"base_password: {os.getenv('base_password')}")

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
def get_existing_usernames(api_url, headers):
    url = f"{api_url}/core/users/?is_active=true"
    response = requests.get(url, headers=headers)  # Ensure URL is properly constructed
    if response.status_code == 403:
        print(f"403 Forbidden Error: Check if the API token has the necessary permissions to access {url}")
    response.raise_for_status()
    users = response.json()['results']  # Assuming the API returns paginated results
    return {user['username'] for user in users}


# Function to create a new user
def create_user(api_url, headers, username, password):
    data = json.dumps({
        "username": username,
        "name": username,
        "is_active": True,
        "email": f"{username}@BASE_DOMAIN",
        "groups": [MAIN_GROUP_ID],
        "attributes": {},
        "path": "string",
        "type": "internal"
    })
    url = f"{api_url}/core/users/"
    response = requests.post(url, headers=headers, data=data)  # Ensure URL is properly constructed
    if response.status_code == 403:
        print(f"403 Forbidden Error: Check if the API token has the necessary permissions to access {url}")
    response.raise_for_status()
    return response.json()

# Load API settings from environment variables
# Load API settings from environment variables
api_url = os.getenv("API_URL")
if not api_url.endswith('/'):
    api_url = api_url + '/'
if not api_url:
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
    response = requests.get(api_url, headers=headers)
    response.raise_for_status()
except requests.exceptions.RequestException as e:
    print(f"Error: Unable to connect to the API at {api_url}. Please check the URL and your network connection.")
    sys.exit(1)

# Get existing usernames
existing_usernames = get_existing_usernames(api_url, headers)

# Generate unique username and strong password
new_username = create_unique_username(base_username, existing_usernames)
new_password = generate_password()

# Create new user account
new_user = create_user(api_url, headers, new_username, new_password)

print(f"New Username: {new_username}")
print(f"New Password: {new_password}")
print("User created successfully:", new_user)