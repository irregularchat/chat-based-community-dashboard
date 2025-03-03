# auth/api.py
import requests
import random
from xkcdpass import xkcd_password as xp
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from utils.config import Config # This will import the Config class from the config module
from datetime import datetime, timedelta
from pytz import timezone  
import logging
import os
from sqlalchemy.orm import Session
from db.operations import AdminEvent
from db.database import SessionLocal
import time
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
            return None, 'default_pass_issue'

        # Reset the user's password
        reset_result = reset_user_password(Config.AUTHENTIK_API_URL, headers, new_user['pk'], temp_password)
        if not reset_result:
            logging.error(f"Failed to reset the password for user {new_user.get('username')}.")
            return new_user, 'default_pass_issue'

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

        return new_user, temp_password

    except requests.exceptions.HTTPError as http_err:
        logging.error(f"HTTP error occurred while creating user: {http_err}")
        try:
            logging.error(f"Response: {response.text}")
        except Exception:
            pass
        return None, 'default_pass_issue'
    except requests.exceptions.RequestException as e:
        logging.error(f"Error creating user: {e}")
        return None, 'default_pass_issue'


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
