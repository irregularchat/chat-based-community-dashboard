# auth/api.py
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
from app.db.operations import AdminEvent, sync_user_data
from app.db.database import SessionLocal
import time
import json
import streamlit as st
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

# This function sends a webhook notification to the webhook url with the user and event type
def webhook_notification(event_type, username=None, full_name=None, email=None, intro=None, invited_by=None, password=None):
    """
    This function sends a webhook notification to the webhook url with the user and event type
    The required parameters are event_type, send_signal_notification
    The optional parameters are username, full_name, email, intro, invited_by, password
    Example: webhook_notification(event_type)
    to run with only partial of the optional parameters, use None for the missing parameters:
    webhook_notification(event_type, username, full_name, None, None, invited_by, None)
    """
    WEBHOOK_URL = Config.WEBHOOK_URL
    WEBHOOK_SECRET = Config.WEBHOOK_SECRET
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {WEBHOOK_SECRET}"  # Added testing authentication header
    }
    data = {
        "event": event_type,
        "full_name": full_name or '',
        "username": username or '',
        "email": email or '',
        "intro": intro or '',
        "invited_by": invited_by or '',
        "password": password or ''
    }
    logging.debug(f"Preparing to send POST request to {WEBHOOK_URL} with headers: {headers} and data: {data}")
    try:
        # Use session.post instead of requests.post to utilize the retry configuration
        response = requests.post(WEBHOOK_URL, json=data, headers=headers)
        response.raise_for_status()
        
        logging.info("Webhook notification sent successfully.")
    except requests.exceptions.HTTPError as http_err:
        logging.error(f"HTTP error occurred while sending webhook: {http_err}")
        logging.error(f"Response status code: {response.status_code}")
        logging.error(f"Response content: {response.text}")
    except requests.exceptions.RequestException as e:
        logging.error(f"Error sending webhook notification: {e}")
        print(f"Final Webhook URL: '{WEBHOOK_URL}'")


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

def create_user(username, full_name, email, invited_by=None, intro=None):
    """Create a new user in Authentik and sync with local database."""
    
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
        new_user = response.json()

        # Ensure 'user' is a dictionary
        if not isinstance(new_user, dict):
            logging.error("Unexpected response format: user is not a dictionary.")
            return None, 'default_pass_issue', None

        # Reset the user's password
        reset_result = reset_user_password(Config.AUTHENTIK_API_URL, headers, new_user['pk'], temp_password)
        if not reset_result:
            logging.error(f"Failed to reset the password for user {new_user.get('username')}.")
            return new_user, 'default_pass_issue', None

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
        return None, 'default_pass_issue', None
    except requests.exceptions.RequestException as e:
        logging.error(f"Error creating user: {e}")
        return None, 'default_pass_issue', None


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

def verify_email(auth_api_url, headers, user_id, email):
    """Verify a user's email address in Authentik.
    
    Args:
        auth_api_url (str): The base URL for the Authentik API
        headers (dict): Headers for the API request
        user_id (str): The ID of the user to verify
        email (str): The email address to verify
        
    Returns:
        bool: True if the verification was successful, False otherwise
    """
    url = f"{auth_api_url}/core/users/{user_id}/"
    data = {"email": email, "email_verified": True}
    try:
        logging.info(f"Verifying email {email} for user {user_id}")
        response = session.patch(url, headers=headers, json=data, timeout=10)
        
        if response.status_code in [200, 201, 202, 204]:
            logging.info(f"Email {email} verified for user {user_id}")
            return True
        else:
            logging.error(f"Failed to verify email for user {user_id}. Status code: {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        logging.error(f"Error verifying email: {e}")
        return False

def reset_password(auth_api_url, headers, user_id, new_password):
    """Reset a user's password in Authentik.
    
    Args:
        auth_api_url (str): The base URL for the Authentik API
        headers (dict): Headers for the API request
        user_id (str): The ID of the user to update
        new_password (str): The new password to set
        
    Returns:
        bool: True if the password was reset successfully, False otherwise
    """
    url = f"{auth_api_url}/core/users/{user_id}/set_password/"
    data = {"password": new_password}
    try:
        logging.info(f"Resetting password for user {user_id}")
        response = session.post(url, headers=headers, json=data, timeout=10)
        
        if response.status_code in [200, 201, 202, 204]:
            logging.info(f"Password reset for user {user_id}")
            return True
        else:
            logging.error(f"Failed to reset password for user {user_id}. Status code: {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        logging.error(f"Error resetting password: {e}")
        return False