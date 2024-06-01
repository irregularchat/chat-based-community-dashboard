#authentik-creation-workflow.py
import random
import string
import requests
from dotenv import load_dotenv
import os
import sys


# Load from .env file- authentik api key, base_username
load_dotenv()

# Function to generate a strong password
def generate_password(length=):
    # Ensure the total length accounts for "TempPassword"
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
def get_existing_usernames(api_url, headers):
    response = requests.get(f"{api_url}/users/", headers=headers)
    response.raise_for_status()
    users = response.json()
    return {user['username'] for user in users}

# Function to create a new user
def create_user(api_url, headers, username, password):
    data = {
        "username": username,
        "password": password,
        "is_active": True
    }
    response = requests.post(f"{api_url}/users/", headers=headers, json=data)
    response.raise_for_status()
    return response.json()

# API settings
api_url = "https://authentik.company/api/v3"
token = os.getenv("AUTHENTIK_API_TOKEN")
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# Get the base username from the command-line argument or raise an error if not provided
if len(sys.argv) > 1:
    base_username = sys.argv[1]
else:
    raise ValueError("A base username must be provided as a command-line argument.")

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