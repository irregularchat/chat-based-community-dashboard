import requests
import random
from xkcdpass import xkcd_password as xp
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from app.utils.config import Config # This will import the Config class from the config module
from datetime import datetime, timedelta
from pytz import timezone  
import logging
import os
from sqlalchemy.orm import Session
from app.db.operations import AdminEvent, sync_user_data, User, VerificationCode
from app.db.database import SessionLocal
import time
import json
import streamlit as st
import hmac
import hashlib
from typing import Optional, List, Dict, Any
import string

# Initialize a session with retry strategy
# auth/api.py

# Initialize a session with adjusted retry strategy
session = requests.Session()
retry = Retry(
    total=2,  # Reduced total retries
    backoff_factor=0.5,  # Reduced backoff factor
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["HEAD", "GET", "POST", "PUT", "DELETE", "OPTIONS", "TRACE"]
)
adapter = HTTPAdapter(max_retries=retry)
session.mount("http://", adapter)
session.mount("https://", adapter)

def generate_webhook_signature(payload: dict) -> str:
    """
    Generate a signature for webhook payload.
    
    Args:
        payload (dict): The webhook payload
        
    Returns:
        str: The generated signature
    """
    if not Config.WEBHOOK_SECRET:
        return ""
        
    # Convert payload to string and encode
    payload_str = json.dumps(payload, sort_keys=True)
    message = payload_str.encode('utf-8')
    
    # Generate HMAC signature
    signature = hmac.new(
        Config.WEBHOOK_SECRET.encode('utf-8'),
        message,
        hashlib.sha256
    ).hexdigest()
    
    return signature

async def webhook_notification(event_type: str, username: str = None, **kwargs) -> dict:
    """
    Send a webhook notification.
    
    Args:
        event_type (str): Type of event (e.g., "user_created")
        username (str): Username associated with the event
        **kwargs: Additional data to include in webhook
        
    Returns:
        dict: Response containing success status
    """
    if not Config.WEBHOOK_ACTIVE or not Config.WEBHOOK_URL:
        logging.info("Webhook integration not active")
        return {"success": False, "error": "Webhook not configured"}

    try:
        # Clean up None values from kwargs
        cleaned_kwargs = {k: v for k, v in kwargs.items() if v is not None}
        
        payload = {
            "event_type": event_type,
            "username": username,
            "timestamp": datetime.now().isoformat(),
            **cleaned_kwargs
        }
        
        headers = {
            "Content-Type": "application/json",
            "X-Webhook-Signature": generate_webhook_signature(payload)
        }
        
        response = requests.post(
            Config.WEBHOOK_URL,
            json=payload,
            headers=headers,
            timeout=10
        )
        response.raise_for_status()
        
        return {"success": True}
        
    except Exception as e:
        logging.error(f"Error sending webhook notification: {e}")
        return {"success": False, "error": str(e)}


def shorten_url(long_url, url_type, name=None):
    if not Config.SHLINK_API_TOKEN or not Config.SHLINK_URL:
        return long_url  # Return original if no Shlink setup

    eastern = timezone('US/Eastern')
    current_time_eastern = datetime.now(eastern)

    # Use the name parameter properly
    if not name:
        name = f"{current_time_eastern.strftime('%d%H%M')}-{url_type}"
    else:
        name = f"{current_time_eastern.strftime('%d%H%M')}-{url_type}-{name}"
    # Sanitize the slug
    name = name.replace(' ', '-').lower()

    headers = {
        'X-Api-Key': Config.SHLINK_API_TOKEN,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
    }


    try:
        response = requests.post(Config.SHLINK_URL, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
        response_data = response.json()

        short_url = response_data.get('shortUrl')
        if short_url:
            return short_url.replace('http://', 'https://')  # Ensure HTTPS
        else:
            logging.error('API response missing "shortUrl".')
            return long_url
    except requests.exceptions.HTTPError as http_err:
        logging.error(f'HTTP error occurred while shortening URL: {http_err}')
        logging.error(f'Response: {response.text}')
        return long_url
    except requests.exceptions.RequestException as e:
        logging.error(f'Error shortening URL: {e}')
        return long_url

# Function to generate a secure password

# Locate the default wordlist provided by xkcdpass
wordfile = xp.locate_wordfile()
# Generate a wordlist with words of length between 5 and 8 characters
wordlist = xp.generate_wordlist(wordfile=wordfile, min_length=3, max_length=6)
# Create a passphrase using 4 words and optional special characters
def generate_secure_passphrase():
    # Generate a random number to use as part of the delimiter
    random_number = str(random.randint(10, 99))  # Generates a 2-digit number
    # Use the random number as a delimiter
    delimiter = random_number
    # Generate the passphrase with the random number as the delimiter
    passphrase = xp.generate_xkcdpassword(wordlist, numwords=2, delimiter=delimiter)
    return passphrase
def list_events_cached(api_url, headers):
    response = requests.get(f"{api_url}/events", headers=headers)
    response.raise_for_status()  # Raise an error for bad responses
    return response.json()

def reset_user_password(auth_api_url, headers, user_id, new_password):
    """Reset a user's password using the correct endpoint and data payload."""
    url = f"{auth_api_url}/core/users/{user_id}/set_password/"
    data = {"password": new_password}
    try:
        response = requests.post(url, headers=headers, json=data, timeout=10)
        response.raise_for_status()
        logging.info(f"Password for user {user_id} reset successfully.")
        return True
    except requests.exceptions.HTTPError as http_err:
        logging.error(f"HTTP error occurred while resetting password for user {user_id}: {http_err}")
        logging.error(f"Response status code: {response.status_code}")
        logging.error(f"Response content: {response.text}")
        return False
    except requests.exceptions.RequestException as e:
        logging.error(f"Error resetting password for user {user_id}: {e}")
        return False

async def create_user(username, full_name, email, invited_by=None, intro=None):
    """Create a new user in Authentik."""
    # Generate a temporary password using a secure passphrase
    temp_password = generate_secure_passphrase()
    discourse_post_url = None  # Initialize post URL variable

    # Check for existing usernames and modify if necessary
    original_username = username
    counter = 1
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    
    while True:
        user_search_url = f"{Config.AUTHENTIK_API_URL}/core/users/?username={username}"
        response = session.get(user_search_url, headers=headers, timeout=10)
        response.raise_for_status()
        users = response.json().get('results', [])
        
        # Explicitly check for exact username match
        if not any(user['username'] == username for user in users):
            break  # Unique username found
        else:
            username = f"{original_username}{counter}"
            counter += 1
    
    # Log if username was modified
    if username != original_username:
        logging.info(f"Username modified for uniqueness: {original_username} -> {username}")

    user_data = {
        "username": username,
        "name": full_name,
        "is_active": True,
        "email": email,
        "groups": [Config.MAIN_GROUP_ID],
        "attributes": {}
    }

    # Add 'invited_by' and 'intro' to attributes if provided
    if invited_by:
        user_data['attributes']['invited_by'] = invited_by
    if intro:
        user_data['attributes']['intro'] = intro

    # Generate API URL
    user_api_url = f"{Config.AUTHENTIK_API_URL}/core/users/"

    try:
        # API request to create the user
        response = requests.post(user_api_url, headers=headers, json=user_data, timeout=10)
        response.raise_for_status()
        user = response.json()

        # Ensure 'user' is a dictionary
        if not isinstance(user, dict):
            logging.error("Unexpected response format: user is not a dictionary.")
            return False, username, 'default_pass_issue', None

        logging.info(f"User created: {user.get('username')}")

        # Reset the user's password
        reset_result = reset_user_password(Config.AUTHENTIK_API_URL, headers, user['pk'], temp_password)
        if not reset_result:
            logging.error(f"Failed to reset the password for user {user.get('username')}. Returning default_pass_issue.")
            return False, username, 'default_pass_issue', None

        # Send webhook notification if webhook integration is active
        if Config.WEBHOOK_ACTIVE:
            try:
                # Use asyncio.create_task to handle the coroutine
                await webhook_notification("user_created", username, full_name, email, intro, invited_by, temp_password)
                logging.info(f"Webhook notification sent for user {username}")
            except Exception as e:
                logging.error(f"Failed to send webhook notification for user {username}: {e}")
        else:
            logging.info("Webhook integration is not active. Skipping webhook notification.")

        # Sync the new user with local database
        with SessionLocal() as db:
            try:
                # Fetch all users to ensure complete sync
                all_users_request = requests.get(
                    f"{Config.AUTHENTIK_API_URL}/core/users/",
                    headers=headers,
                    timeout=10
                )
                all_users_request.raise_for_status()
                all_users = all_users_request.json().get('results', [])

                # Sync users with local database
                sync_user_data(db, all_users)

                # Add creation event to admin events
                admin_event = AdminEvent(
                    timestamp=datetime.now(),
                    event_type='user_created',
                    username=username,
                    description=f'User created and synced to local database'
                )
                db.add(admin_event)
                db.commit()

                logging.info(f"Successfully created and synced user {username}")
            except Exception as e:
                logging.error(f"Error syncing after user creation: {e}")
                # Note: We continue even if sync fails, as the user was created in Authentik

        # Create a Discourse post for the user introduction if Discourse is configured
        if all([Config.DISCOURSE_URL, Config.DISCOURSE_API_KEY, 
                Config.DISCOURSE_API_USERNAME, Config.DISCOURSE_CATEGORY_ID]):
            try:
                post_title = f"Introduction: {username}"
                success, post_url = create_discourse_post(
                    headers=headers,
                    title=post_title,
                    content="",  # Not used, the function creates its own content
                    username=username,
                    intro=intro,
                    invited_by=invited_by
                )
                
                if success and post_url:
                    logging.info(f"Successfully created Discourse post for user {username} at URL: {post_url}")
                    discourse_post_url = post_url
                elif success:
                    logging.warning(f"Created Discourse post for user {username} but couldn't get the URL")
                else:
                    logging.warning(f"Failed to create Discourse post for user {username}")
            except Exception as e:
                logging.error(f"Error creating Discourse post for user {username}: {e}")
                # Continue even if Discourse post creation fails
        else:
            logging.info("Discourse integration not configured. Skipping post creation.")

        return (True, username, temp_password, discourse_post_url)

    except requests.exceptions.HTTPError as http_err:
        logging.error(f"HTTP error occurred while creating user: {http_err}")
        try:
            logging.error(f"Response: {response.text}")
        except Exception:
            pass
        return False, username, 'default_pass_issue', None
    except requests.exceptions.RequestException as e:
        logging.error(f"Error creating user: {e}")
        return False, username, 'default_pass_issue', None


# List Users Function is needed and works better than the new methos session.get(f"{auth_api_url}/users/", headers=headers, timeout=10)
 # auth/api.py

def list_users(auth_api_url, headers, search_term=None):
    """List users, optionally filtering by a search term, handling pagination to fetch all users."""
    try:
        # First get all users since the API search might not catch attribute contents
        params = {'page_size': 500}  # Reduced page size for better reliability
        users = []
        url = f"{auth_api_url}/core/users/"
        page_count = 0
        total_fetched = 0
        max_retries = 3

        while url:
            page_count += 1
            logging.info(f"Fetching users page {page_count}...")
            
            # Try with retries for each page
            for retry in range(max_retries):
                try:
                    response = session.get(url, headers=headers, params=params, timeout=60)  # Increased timeout
                    response.raise_for_status()
                    data = response.json()
                    break  # Success, exit retry loop
                except Exception as e:
                    if retry < max_retries - 1:
                        logging.warning(f"Error fetching page {page_count}, retrying ({retry+1}/{max_retries}): {e}")
                        time.sleep(2)  # Wait before retrying
                    else:
                        logging.error(f"Failed to fetch page {page_count} after {max_retries} attempts: {e}")
                        raise  # Re-raise the exception after all retries failed
            
            results = data.get('results', [])
            total_fetched += len(results)
            logging.info(f"Fetched {len(results)} users (total so far: {total_fetched})")
            
            if search_term:
                search_term_lower = search_term.lower()
                filtered_results = []
                for user in results:
                    # Get all searchable fields
                    searchable_text = []
                    
                    # Add standard fields
                    searchable_text.extend([
                        str(user.get('username', '')).lower(),
                        str(user.get('name', '')).lower(),
                        str(user.get('email', '')).lower()
                    ])
                    
                    # Add attributes content
                    attributes = user.get('attributes', {})
                    if isinstance(attributes, dict):
                        # Add all attribute values to searchable text
                        searchable_text.extend(str(value).lower() for value in attributes.values())
                    
                    # Check if search term is in any of the searchable text
                    if any(search_term_lower in text for text in searchable_text):
                        filtered_results.append(user)
                
                users.extend(filtered_results)
            else:
                users.extend(results)
            
            url = data.get('next')
            params = {}  # Clear params after first request

        logging.info(f"Total users fetched: {len(users)}")
        return users
    except requests.exceptions.RequestException as e:
        logging.error(f"Error listing users: {e}")
        return []
       
def list_users_cached(auth_api_url, headers):
    """List users with caching to reduce API calls."""
    try:
        response = session.get(f"{auth_api_url}/core/users/", headers=headers, timeout=10)
        response.raise_for_status()
        users = response.json().get('results', [])
        return users
    except requests.exceptions.RequestException as e:
        logging.error(f"Error listing users: {e}")
        return []


def create_invite(headers, label, expires=None):
    """
    Create an invitation for a user.

    Parameters:
        headers (dict): The request headers for Authentik API.
        label (str): The label to identify the invitation.
        expires (str, optional): The expiration time for the invite.

    Returns:
        tuple: The invite URL and expiration time, if successful.
    """
    eastern = timezone('US/Eastern')
    if not label:
        label = datetime.now(eastern).strftime('%H-%M')

    # Fix the label to ensure it is a valid slug:
    # - Convert to lowercase
    # - Replace whitespace with underscores
    # - Remove any character that is not a letter, number, underscore, or hyphen
    import re
    fixed_label = label.strip().lower()
    fixed_label = re.sub(r'\s+', '_', fixed_label)
    fixed_label = re.sub(r'[^a-z0-9_-]', '', fixed_label)

    if expires is None:
        expires = (datetime.now(eastern) + timedelta(hours=2)).isoformat()

    data = {
        "name": fixed_label,
        "expires": expires,
        "fixed_data": {},
        "single_use": True,
        "flow": Config.INVITE_FLOW_ID  # Use the invite flow ID for invitations
    }

    invite_api_url = f"{Config.AUTHENTIK_API_URL}/stages/invitation/invitations/"

    try:
        response = requests.post(invite_api_url, headers=headers, json=data, timeout=10)
        response.raise_for_status()
        response_data = response.json()

        # Get the invite ID from the API response
        invite_id = response_data.get('pk')
        if not invite_id:
            raise ValueError("API response missing 'pk' field.")

        # Construct the full invite URL without shortening it
        invite_link = f"https://sso.{Config.BASE_DOMAIN}/if/flow/{Config.INVITE_LABEL}/?itoken={invite_id}"
        return invite_link, expires

    except requests.exceptions.HTTPError as http_err:
        logging.error(f"HTTP error occurred: {http_err}")
        try:
            logging.info("API Response: %s", response.json())
        except Exception:
            logging.info("API Response: %s", response.text)
    except Exception as err:
        logging.error(f"An error occurred: {err}")
        try:
            logging.info("API Response: %s", response.text)
        except Exception:
            pass

    return None, None


def update_user_status(auth_api_url, headers, user_id, is_active):
    """Update a user's active status in Authentik.
    
    Args:
        auth_api_url (str): The base URL for the Authentik API
        headers (dict): Headers for the API request
        user_id (str): The ID of the user to update
        is_active (bool): Whether the user should be active or inactive
        
    Returns:
        bool: True if the update was successful, False otherwise
    """
    url = f"{auth_api_url}/core/users/{user_id}/"
    data = {"is_active": is_active}
    try:
        logging.info(f"Updating user {user_id} status to {'active' if is_active else 'inactive'}")
        response = session.patch(url, headers=headers, json=data, timeout=10)
        
        if response.status_code in [200, 201, 202, 204]:
            logging.info(f"User {user_id} status updated to {'active' if is_active else 'inactive'}.")
            return True
        else:
            logging.error(f"Failed to update user {user_id} status. Status code: {response.status_code}")
            return False
            
    except requests.exceptions.RequestException as e:
        logging.error(f"Error updating user status: {e}")
        return False

def delete_user(auth_api_url, headers, user_id):
    url = f"{auth_api_url}/core/users/{user_id}/"
    try:
        response = session.delete(url, headers=headers, timeout=10)
        if response.status_code == 204:
            logging.info(f"User {user_id} deleted successfully.")
            return True
        else:
            logging.error(f"Failed to delete user {user_id}. Status Code: {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        logging.error(f"Error deleting user: {e}")
        return False


def update_user_intro(auth_api_url, headers, user_id, intro_text):
    """Update a user's introduction in Authentik.
    
    Args:
        auth_api_url (str): The base URL for the Authentik API
        headers (dict): Headers for the API request
        user_id (str): The ID of the user to update
        intro_text (str): The introduction text to set
        
    Returns:
        bool: True if the update was successful, False otherwise
    """
    url = f"{auth_api_url}/core/users/{user_id}/"
    data = {"attributes": {"intro": intro_text}}
    try:
        logging.info(f"Updating intro for user {user_id}")
        response = session.patch(url, headers=headers, json=data, timeout=10)
        
        if response.status_code in [200, 201, 202, 204]:
            logging.info(f"Intro for user {user_id} updated successfully.")
            return True
        else:
            logging.error(f"Failed to update intro for user {user_id}. Status code: {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        logging.error(f"Error updating user intro: {e}")
        return False

def update_user_invited_by(auth_api_url, headers, user_id, invited_by):
    """Update a user's 'invited by' field in Authentik.
    
    Args:
        auth_api_url (str): The base URL for the Authentik API
        headers (dict): Headers for the API request
        user_id (str): The ID of the user to update
        invited_by (str): The name of the person who invited the user
        
    Returns:
        bool: True if the update was successful, False otherwise
    """
    url = f"{auth_api_url}/core/users/{user_id}/"
    data = {"attributes": {"invited_by": invited_by}}
    try:
        logging.info(f"Updating 'invited by' for user {user_id}")
        response = session.patch(url, headers=headers, json=data, timeout=10)
        
        if response.status_code in [200, 201, 202, 204]:
            logging.info(f"'Invited By' for user {user_id} updated successfully.")
            return True
        else:
            logging.error(f"Failed to update 'invited by' for user {user_id}. Status code: {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        logging.error(f"Error updating 'Invited By': {e}")
        return False

def generate_recovery_link(username):
    """Generate a recovery link for a user."""
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    try:
        # First, get the user ID by username
        user_search_url = f"{Config.AUTHENTIK_API_URL}/core/users/?search={username}"
        response = session.get(user_search_url, headers=headers, timeout=10)
        response.raise_for_status()
        users = response.json().get('results', [])
        if not users:
            logging.error(f"No user found with username: {username}")
            return None
        user_id = users[0]['pk']

        # Now, generate the recovery link using POST
        recovery_api_url = f"{Config.AUTHENTIK_API_URL}/core/users/{user_id}/recovery/"
        response = requests.post(recovery_api_url, headers=headers, timeout=10)
        response.raise_for_status()
        recovery_link = response.json().get('link')
        logging.info(f"Recovery link generated for user: {username}")
        return recovery_link

    except requests.exceptions.RequestException as e:
        logging.error(f"Error generating recovery link for {username}: {e}")
        return None

def force_password_reset(username):
    """Force a password reset for a user."""
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    try:
        # First, get the user ID by username
        user_search_url = f"{Config.AUTHENTIK_API_URL}/core/users/?search={username}"
        response = session.get(user_search_url, headers=headers, timeout=10)
        response.raise_for_status()
        users = response.json().get('results', [])
        if not users:
            logging.error(f"No user found with username: {username}")
            return False
        user_id = users[0]['pk']

        # Now, force the password reset using the correct method
        # The 405 error indicates Method Not Allowed, so we need to check the API documentation
        # for the correct method (GET, PUT, or PATCH instead of POST)
        reset_api_url = f"{Config.AUTHENTIK_API_URL}/core/users/{user_id}/force_password_reset/"
        logging.info(f"Sending password reset request for user {username} (ID: {user_id})")
        
        # Try GET method first
        response = session.get(reset_api_url, headers=headers, timeout=10)
        
        # If GET fails, try PUT
        if response.status_code == 405:  # Method Not Allowed
            logging.info(f"GET method not allowed for password reset, trying PUT")
            response = session.put(reset_api_url, headers=headers, json={}, timeout=10)
            
        # If PUT fails, try PATCH
        if response.status_code == 405:  # Method Not Allowed
            logging.info(f"PUT method not allowed for password reset, trying PATCH")
            response = session.patch(reset_api_url, headers=headers, json={}, timeout=10)
        
        # Check if the response has content before trying to parse JSON
        if response.status_code in [200, 201, 202, 204]:  # Success codes
            logging.info(f"Password reset successful for user {username} (ID: {user_id}) with status code {response.status_code}")
            return True
            
        if response.content:  # Only try to parse JSON if there's content
            try:
                response_data = response.json()
                logging.error(f"Error forcing password reset for {username}: {response_data.get('detail', 'Unknown error')}")
            except ValueError:
                logging.error(f"Invalid JSON response for password reset: {response.content}")
        else:
            logging.error(f"Password reset failed for user {username} (ID: {user_id}) with status code {response.status_code}")
            
        return False
            
    except requests.exceptions.RequestException as e:
        logging.error(f"Error forcing password reset for {username}: {e}")
        return False

def update_user_email(auth_api_url, headers, user_id, new_email):
    """Update a user's email address in Authentik.
    
    Args:
        auth_api_url (str): The base URL for the Authentik API
        headers (dict): Headers for the API request
        user_id (str): The ID of the user to update
        new_email (str): The new email address
        
    Returns:
        bool: True if the update was successful, False otherwise
    """
    url = f"{auth_api_url}/core/users/{user_id}/"
    data = {"email": new_email}
    
    logging.info(f"Attempting to update email for user {user_id} to {new_email}")
    try:
        response = session.patch(url, headers=headers, json=data, timeout=10)
        
        if response.status_code in [200, 201, 202, 204]:
            logging.info(f"Email for user {user_id} updated successfully to {new_email}")
            return True
        else:
            logging.error(f"Failed to update email for user {user_id}. Status code: {response.status_code}")
            return False
    except requests.exceptions.HTTPError as http_err:
        logging.error(f"HTTP error updating email: {http_err}")
        logging.error(f"Response content: {http_err.response.text if http_err.response else 'No response content'}")
        return False
    except requests.exceptions.RequestException as e:
        logging.error(f"Error updating user email: {e}")
        return False

def get_last_modified_timestamp(auth_api_url, headers):
    """
    Get the timestamp of the most recently modified user in Authentik.
    This helps determine if a sync is needed without fetching all users.
    
    Args:
        auth_api_url: The Authentik API URL
        headers: The request headers
        
    Returns:
        datetime: The timestamp of the most recently modified user, or None if error
    """
    try:
        # Get users sorted by last modified date in descending order
        params = {
            'page_size': 1,
            'ordering': '-last_updated'  # Most recently updated first
        }
        
        response = session.get(
            f"{auth_api_url}/core/users/",
            headers=headers,
            params=params,
            timeout=10
        )
        response.raise_for_status()
        data = response.json()
        
        if data.get('results') and len(data['results']) > 0:
            # Get the last_updated field from the most recently updated user
            last_updated = data['results'][0].get('last_updated')
            if last_updated:
                try:
                    # Convert to datetime
                    return datetime.fromisoformat(last_updated.replace('Z', '+00:00'))
                except (ValueError, TypeError):
                    logging.error(f"Invalid last_updated format: {last_updated}")
        
        # Fallback: return the current time
        return datetime.now()
    except Exception as e:
        logging.error(f"Error getting last modified timestamp: {e}")
        return None

def get_users_modified_since(auth_api_url, headers, since_timestamp):
    """
    Get only users that have been modified since a specific timestamp.
    This is much more efficient than fetching all users for incremental syncs.
    
    Args:
        auth_api_url: The Authentik API URL
        headers: The request headers
        since_timestamp: Datetime object representing the cutoff time
        
    Returns:
        list: Users modified since the timestamp
    """
    try:
        # Convert timestamp to ISO format for the API
        since_iso = since_timestamp.isoformat()
        
        # Set up parameters to filter by last_updated
        params = {
            'page_size': 500,
            'last_updated__gte': since_iso  # Only get users updated since the timestamp
        }
        
        users = []
        url = f"{auth_api_url}/core/users/"
        page_count = 0
        total_fetched = 0
        max_retries = 3

        while url:
            page_count += 1
            logging.info(f"Fetching modified users page {page_count}...")
            
            # Try with retries for each page
            for retry in range(max_retries):
                try:
                    response = session.get(url, headers=headers, params=params, timeout=60)
                    response.raise_for_status()
                    data = response.json()
                    break  # Success, exit retry loop
                except Exception as e:
                    if retry < max_retries - 1:
                        logging.warning(f"Error fetching page {page_count}, retrying ({retry+1}/{max_retries}): {e}")
                        time.sleep(2)  # Wait before retrying
                    else:
                        logging.error(f"Failed to fetch page {page_count} after {max_retries} attempts: {e}")
                        raise  # Re-raise the exception after all retries failed
            
            results = data.get('results', [])
            total_fetched += len(results)
            logging.info(f"Fetched {len(results)} modified users (total so far: {total_fetched})")
            
            users.extend(results)
            
            url = data.get('next')
            params = {}  # Clear params after first request

        logging.info(f"Total modified users fetched: {len(users)}")
        return users
    except Exception as e:
        logging.error(f"Error getting modified users: {e}")
        return []


def create_discourse_post(headers, title, content, username=None, intro=None, invited_by=None):
    """Create a new post on Discourse for a new user.
    
    Args:
        headers: Authentication headers for the API request (not used, we create our own)
        title: Title of the post
        content: Base content of the post (not used, we create our own)
        username: Username of the new user
        intro: User's introduction text (optional)
        invited_by: Username of the person who invited the user (optional)
    
    Returns:
        tuple: (success: bool, post_url: str) - A tuple with success status and the URL of the created post (or None if failed)
    """
    # Check if Discourse integration is configured
    missing_configs = []
    if not Config.DISCOURSE_URL:
        missing_configs.append("DISCOURSE_URL")
    if not Config.DISCOURSE_API_KEY:
        missing_configs.append("DISCOURSE_API_KEY")
    if not Config.DISCOURSE_API_USERNAME:
        missing_configs.append("DISCOURSE_API_USERNAME")
    if not Config.DISCOURSE_CATEGORY_ID:
        missing_configs.append("DISCOURSE_CATEGORY_ID")
    
    if missing_configs:
        logging.warning(f"Discourse integration not fully configured. Missing: {', '.join(missing_configs)}. Skipping post creation.")
        return False, None
    
    logging.info(f"Starting Discourse post creation for user {username}")
    logging.info(f"Using Discourse URL: {Config.DISCOURSE_URL}")
    logging.info(f"Using Discourse category ID: {Config.DISCOURSE_CATEGORY_ID}")
    logging.info(f"Using Discourse API username: {Config.DISCOURSE_API_USERNAME}")
    logging.info(f"Discourse API key is {'configured' if Config.DISCOURSE_API_KEY else 'missing'}")
        
    try:
        # Create the post content with the exact template format specified
        formatted_content = f"""This is {username}

Introduction:
{intro or 'No introduction provided.'}

Invited by: {invited_by or 'Not specified'}

_Use this post to link to your introduction in the chats and have IrregularChat Members find you based on your interests or offerings._
Notice that Login is required to view any of the Community posts. Please help maintain community privacy."""
        
        # Create completely new headers for the Discourse API
        discourse_headers = {
            "Api-Key": Config.DISCOURSE_API_KEY,
            "Api-Username": Config.DISCOURSE_API_USERNAME,  # This should be an admin user in Discourse
            "Content-Type": "application/json"
        }
        
        # Construct the API URL
        base_url = Config.DISCOURSE_URL
        if not base_url.startswith('http'):
            base_url = f"https://{base_url}"
        
        # Discourse API endpoint for creating posts
        url = f"{base_url}/posts.json"
            
        data = {
            "title": title,
            "raw": formatted_content,
            "category": int(Config.DISCOURSE_CATEGORY_ID),
            "tags": [Config.DISCOURSE_INTRO_TAG] if Config.DISCOURSE_INTRO_TAG else []
        }
        
        logging.info(f"Attempting to create Discourse post for {username} at URL: {url}")
        logging.info(f"Request data: {json.dumps(data)}")
        response = requests.post(url, headers=discourse_headers, json=data, timeout=10)
        
        logging.info(f"Discourse API response status code: {response.status_code}")
        
        if response.status_code >= 400:
            error_detail = "Unknown error"
            try:
                error_detail = response.json().get('errors', response.text) if response.text else "Unknown error"
            except:
                error_detail = response.text if response.text else "Unknown error"
                
            logging.error(f"Error creating Discourse post: {error_detail}")
            return False, None
        
        # Get the post's topic URL from the response
        try:
            response_data = response.json()
            logging.info(f"Discourse API response data: {json.dumps(response_data)}")
            
            post_id = response_data.get('id')
            topic_id = response_data.get('topic_id')
            
            # Construct the post URL
            if topic_id:
                post_url = f"{base_url}/t/{topic_id}"
                logging.info(f"Successfully created Discourse post for {username} at URL: {post_url}")
                
                # Store success in session state for UI display
                if hasattr(st, 'session_state'):
                    st.session_state['discourse_post_created'] = True
                    st.session_state['discourse_post_url'] = post_url
                
                return True, post_url
            else:
                logging.warning(f"Created post but couldn't get topic_id from response: {response_data}")
                return True, None
        except Exception as e:
            logging.error(f"Error parsing post response: {e}")
            return True, None
    except Exception as e:
        logging.error(f"Error creating Discourse post for {username}: {e}")
        return False, None

async def verify_email(verification_code: str, db: Session) -> dict:
    """
    Verify a user's email using the verification code.
    
    Args:
        verification_code (str): The verification code sent to the user's email
        db (Session): Database session
        
    Returns:
        dict: Response containing success status and any error messages
    """
    try:
        # Get the verification code details
        code_details = await get_verification_code(verification_code, db)
        if not code_details:
            return {"success": False, "error": "Invalid verification code"}
            
        # Mark the email as verified
        user_id = code_details["user_id"]
        if await mark_email_verified(user_id, db):
            return {
                "success": True,
                "message": "Email verified successfully"
            }
        return {"success": False, "error": "Failed to verify email"}
        
    except Exception as e:
        logging.error(f"Error verifying email: {e}")
        return {"success": False, "error": str(e)}

async def reset_password(email: str, db: Session) -> dict:
    """
    Initiate password reset process for a user.
    
    Args:
        email (str): User's email address
        db (Session): Database session
        
    Returns:
        dict: Response containing success status and any messages
    """
    try:
        # Get user by email
        user = await get_user_by_email(email, db)
        if not user:
            return {
                "success": False,
                "error": "No user found with this email address"
            }
            
        # Generate and send reset code
        reset_code = await send_reset_code(user["id"], user["email"], db)
        if reset_code:
            return {
                "success": True,
                "reset_code_sent": True,
                "message": "Password reset code has been sent to your email"
            }
            
        return {
            "success": False,
            "error": "Failed to send reset code"
        }
        
    except Exception as e:
        logging.error(f"Error in reset_password: {e}")
        return {
            "success": False,
            "error": str(e)
        }

async def process_auth_webhook(webhook_data: dict) -> dict:
    """Process authentication webhook data."""
    try:
        user_data = webhook_data.get('data', {})
        username = user_data.get('username')
        
        if not username:
            return {
                "success": False,
                "error": "Missing username in webhook data"
            }
            
        # Update user data in local database
        with SessionLocal() as db:
            success = await update_user_data(username, user_data, db)
            if success:
                return {
                    "success": True,
                    "message": f"Successfully updated user {username}"
                }
                
        return {
            "success": False,
            "error": f"Failed to update user {username}"
        }
        
    except Exception as e:
        logging.error(f"Error processing auth webhook: {e}")
        return {
            "success": False,
            "error": str(e)
        }

def validate_webhook_signature(signature: str, body: bytes) -> bool:
    """
    Validate the webhook signature against the request body.
    
    Args:
        signature (str): The signature from the webhook header
        body (bytes): The raw request body
        
    Returns:
        bool: True if signature is valid, False otherwise
    """
    try:
        if not Config.WEBHOOK_SECRET:
            logging.warning("Webhook secret not configured")
            return False
            
        # Calculate expected signature
        expected = hmac.new(
            Config.WEBHOOK_SECRET.encode(),
            body,
            hashlib.sha256
        ).hexdigest()
        
        # Compare signatures using constant time comparison
        return hmac.compare_digest(signature, expected)
        
    except Exception as e:
        logging.error(f"Error validating webhook signature: {e}")
        return False

async def handle_webhook(request) -> dict:
    """
    Handle incoming webhook request.
    
    Args:
        request: The webhook request object
        
    Returns:
        dict: Response containing success status and any messages
    """
    try:
        # Validate signature
        signature = request.headers.get('X-Webhook-Signature')
        if not signature:
            return {
                "success": False,
                "error": "Missing webhook signature"
            }
            
        # Get request body
        body = await request.get_data() if hasattr(request.get_data, '__await__') else request.get_data()
        if isinstance(body, str):
                body = body.encode('utf-8')
            
        # Validate signature
        if not validate_webhook_signature(signature, body):
            return {
                "success": False,
                "error": "Invalid webhook signature"
            }
            
        # Parse webhook data
        try:
                webhook_data = json.loads(body.decode('utf-8'))
        except json.JSONDecodeError as e:
            logging.error(f"Error parsing webhook data: {e}")
            return {
                "success": False,
                "error": "Invalid JSON data"
            }
            
        # Process webhook
        result = await process_auth_webhook(webhook_data)
        return result
        
    except Exception as e:
        logging.error(f"Error handling webhook: {e}")
        return {
            "success": False,
            "error": str(e)
        }

async def send_verification_email(email: str, code: str) -> bool:
    """Send verification email to user."""
    try:
        subject = "Verify your email"
        body = f"Your verification code is: {code}"
        
        # Use your email sending logic here
        # For now, just log it
        logging.info(f"Would send verification email to {email} with code {code}")
        return True
    except Exception as e:
        logging.error(f"Error sending verification email: {e}")
        return False

async def get_user_by_email(email: str, db: Session) -> Optional[User]:
    """Get user by email address."""
    try:
        return db.query(User).filter(User.email == email).first()
    except Exception as e:
        logging.error(f"Error getting user by email: {e}")
        return None

async def send_reset_code(email: str, code: str) -> bool:
    """Send password reset code to user."""
    try:
        subject = "Reset your password"
        body = f"Your password reset code is: {code}"
        
        # Use your email sending logic here
        # For now, just log it
        logging.info(f"Would send reset code to {email}: {code}")
        return True
    except Exception as e:
        logging.error(f"Error sending reset code: {e}")
        return False

async def update_user_data(username: str, data: dict, db: Session) -> bool:
    """Update user data in local database."""
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            return False
            
        # Update user fields
        for key, value in data.items():
            if hasattr(user, key):
                setattr(user, key, value)
                
        db.commit()
        return True
    except Exception as e:
        logging.error(f"Error updating user data: {e}")
        db.rollback()
        return False

def generate_verification_code(length: int = 6) -> str:
    """Generate a random verification code."""
    return ''.join(random.choices(string.digits, k=length))

async def get_verification_code(code: str, db: Session) -> Optional[dict]:
    """Get verification code details from database."""
    try:
        verification = db.query(VerificationCode).filter(
            VerificationCode.code == code
        ).first()
        
        if not verification:
            return None
            
        return {
            "user_id": verification.user_id,
            "code": verification.code
        }
    except Exception as e:
        logging.error(f"Error getting verification code: {e}")
        return None

async def mark_email_verified(user_id: int, db: Session) -> bool:
    """Mark user's email as verified."""
    try:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            return False
            
        user.email_verified = True
        db.commit()
        return True
    except Exception as e:
        logging.error(f"Error marking email as verified: {e}")
        db.rollback()
        return False

async def process_webhook(webhook_data: dict) -> dict:
    """
    Process a webhook notification.
    
    Args:
        webhook_data (dict): The webhook payload
        
    Returns:
        dict: Response containing success status and any messages
    """
    try:
        event = webhook_data.get('event')
        if not event:
            return {
                "success": False,
                "error": "Missing event type"
            }
            
        # Handle different event types
        if event == "user.created":
            return await process_auth_webhook(webhook_data)
        elif event == "user.updated":
            return await process_auth_webhook(webhook_data)
        else:
            return {
                "success": False,
                "error": f"Unsupported event type: {event}"
            }
            
    except Exception as e:
        logging.error(f"Error processing webhook: {e}")
        return {
            "success": False,
            "error": str(e)
        }

async def handle_registration(user_data: dict, db: Session) -> dict:
    """
    Handle user registration process.
    
    Args:
        user_data (dict): User registration data
        db (Session): Database session
        
    Returns:
        dict: Response containing success status and any messages
    """
    try:
        # Extract user data
        username = user_data['username']
        email = user_data['email']
        full_name = user_data.get('full_name', '')
        organization = user_data.get('organization', '')
        invited_by = user_data.get('invited_by')
        
        # Create user in Authentik
        success, created_username, temp_password, error = await create_user(
            username=username,
            full_name=full_name,
            email=email,
            invited_by=invited_by,
            intro=organization
        )
        
        if not success:
            return {
                "success": False,
                "error": error or "Failed to create user"
            }
            
        # Generate and store verification code
        verification_code = generate_verification_code()
        verification = VerificationCode(
            user_id=created_username,
            code=verification_code,
            expires_at=datetime.utcnow() + timedelta(hours=24)
        )
        db.add(verification)
        db.commit()
        
        # Send verification email
        verification_sent = await send_verification_email(email, verification_code)
        
        return {
            "success": True,
            "username": created_username,
            "verification_sent": verification_sent,
            "temp_password": temp_password  # Include temporary password in response
        }
        
    except Exception as e:
        logging.error(f"Error handling registration: {e}")
        if hasattr(db, 'rollback'):
            db.rollback()
        return {
            "success": False,
            "error": str(e)
        }