# auth/api.py
import requests
import random
from xkcdpass import xkcd_password as xp
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from app.utils.config import Config # This will import the Config class from the config module
from datetime import datetime, timedelta, date
import logging
import os
from pytz import timezone  # Add this import at the top with other imports
from app.auth.utils import generate_username_with_random_word

# Initialize a session with retry strategy
# auth/api.py

# Initialize a session with adjusted retry strategy
session = requests.Session()
retry = Retry(
    total=3,  # Reduced total retries
    backoff_factor=0.7,  # Reduced backoff factor
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
    headers = {
        "Content-Type": "application/json"
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
    
    logging.debug(f"Preparing to send POST request to https://n8.irregularchat.com/webhook/dashboard with headers: {headers} and data: {data}")
    try:
        response = requests.post(
            "https://n8.irregularchat.com/webhook/dashboard", 
            json=data, 
            headers=headers
        )
        response.raise_for_status()
        
        logging.info("Webhook notification sent successfully.")
    except requests.exceptions.HTTPError as http_err:
        logging.error(f"HTTP error occurred while sending webhook: {http_err}")
        logging.error(f"Response status code: {response.status_code}")
        logging.error(f"Response content: {response.text}")
        
        # Additional debugging information
        print(f"Request Method: {response.request.method}")
        print(f"Request Headers: {response.request.headers}")
        print(f"Request Body: {response.request.body}")
        
    except requests.exceptions.RequestException as e:
        logging.error(f"Error sending webhook notification: {e}")
        print(f"Final Webhook URL: 'https://n8.irregularchat.com/webhook/dashboard'")


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

    payload = {
        'longUrl': long_url,
        'customSlug': name,
        'findIfExists': True,
        # Include 'domain' if necessary
        # 'domain': 'your-domain.com'
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
    try:
        # Parse full_name to get first_name and last_name
        name_parts = full_name.split(maxsplit=1)
        first_name = name_parts[0] if name_parts else ""
        last_name = name_parts[1] if len(name_parts) > 1 else ""
        
        # Import the non-async create_user function
        from app.auth.api import create_user as create_user_sync
        
        # Prepare attributes
        attributes = {}
        if invited_by:
            attributes['invited_by'] = invited_by
        if intro:
            attributes['intro'] = intro
            
        # Call the non-async create_user function
        result = create_user_sync(
            email=email,
            first_name=first_name,
            last_name=last_name,
            attributes=attributes,
            desired_username=username,
            reset_password=True  # Enable the password reset process
        )
        
        if result["success"]:
            # Return in the format expected by callers
            return True, result["username"], result["temp_password"], result.get("discourse_url")
        else:
            # Handle error case
            error_message = result.get("error", "Unknown error")
            return False, username, error_message, None
            
    except Exception as e:
        logging.error(f"Error creating user: {e}")
        return False, username, str(e), None


# List Users Function is needed and works better than the new methos session.get(f"{auth_api_url}/users/", headers=headers, timeout=10)
 # auth/api.py

def list_users(auth_api_url, headers, search_term=None):
    """List users, optionally filtering by a search term, handling pagination to fetch all users."""
    try:
        params = {
            'page_size': 750  # Adjust based on API limits
        }
        if search_term:
            params['search'] = search_term

        users = []
        url = f"{auth_api_url}/core/users/"

        while url:
            response = session.get(url, headers=headers, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            if search_term:
                # Parse search terms into column-specific filters
                search_filters = {}
                terms = search_term.split()
                for term in terms:
                    if ':' in term:
                        column, value = term.split(':', 1)
                        search_filters[column.lower()] = value.lower()
                    else:
                        # If no column specified, search all columns
                        search_filters['general'] = term.lower()

                filtered_results = []
                for user in data.get('results', []):
                    match = True
                    
                    # Check each filter
                    for column, value in search_filters.items():
                        if column == 'general':
                            # Search all searchable fields
                            searchable_text = [
                                str(user.get('username', '')).lower(),
                                str(user.get('name', '')).lower(),
                                str(user.get('email', '')).lower(),
                                str(user.get('attributes', {}).get('intro', '')).lower(),
                                str(user.get('attributes', {}).get('invited_by', '')).lower()
                            ]
                            if not any(value in text for text in searchable_text):
                                match = False
                                break
                        else:
                            # Column-specific search
                            if column in ['intro', 'invited_by']:
                                field_value = str(user.get('attributes', {}).get(column, '')).lower()
                            else:
                                field_value = str(user.get(column, '')).lower()
                            
                            if value not in field_value:
                                match = False
                                break
                    
                    if match:
                        filtered_results.append(user)
                
                users.extend(filtered_results)
            else:
                users.extend(data.get('results', []))
            
            url = data.get('next')
            params = {}

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
        expires (str): The expiration time for the invite in ISO format.

    Returns:
        tuple: The shortened invite URL and expiration time, if successful.
    """
    eastern = timezone('US/Eastern')
    current_time_str = datetime.now(eastern).strftime('%H-%M')

    # Default name for the invite
    if not label:
        label = current_time_str

    # Use the provided ISO formatted expires string or create a default one
    if expires is None:
        expires = (datetime.now(eastern) + timedelta(hours=2)).isoformat()

    data = {
        "name": label,
        "expires": expires,
        "fixed_data": {},
        "single_use": True,
        "flow": Config.FLOW_ID  # The flow ID for invitation
    }
    
    # Authentik API invitation endpoint
    invite_api_url = f"{Config.AUTHENTIK_API_URL}/stages/invitation/invitations/"

    try:
        response = session.post(invite_api_url, headers=headers, json=data, timeout=10)
        response.raise_for_status()
        response_data = response.json()

        # Get the invite ID and construct the full URL
        invite_id = response_data.get('pk')
        if not invite_id:
            raise ValueError("API response missing 'pk' field.")

        invite_link = f"https://sso.{Config.BASE_DOMAIN}/if/flow/simple-enrollment-flow/?itoken={invite_id}"

        # Shorten the invite link
        short_invite_link = shorten_url(invite_link, 'invite', label)
        return short_invite_link, expires

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
    url = f"{auth_api_url}/core/users/{user_id}/"
    data = {"is_active": is_active}
    try:
        response = session.patch(url, headers=headers, json=data, timeout=10)
        response.raise_for_status()
        logging.info(f"User {user_id} status updated to {'active' if is_active else 'inactive'}.")
        return response.json()
    except requests.exceptions.RequestException as e:
        logging.error(f"Error updating user status: {e}")
        return None

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
    url = f"{auth_api_url}/core/users/{user_id}/"
    data = {"attributes": {"intro": intro_text}}
    try:
        response = session.patch(url, headers=headers, json=data, timeout=10)
        response.raise_for_status()
        logging.info(f"Intro for user {user_id} updated successfully.")
        return response.json()
    except requests.exceptions.RequestException as e:
        logging.error(f"Error updating user intro: {e}")
        return None

def update_user_invited_by(auth_api_url, headers, user_id, invited_by):
    url = f"{auth_api_url}/core/users/{user_id}/"
    data = {"attributes": {"invited_by": invited_by}}
    try:
        response = session.patch(url, headers=headers, json=data, timeout=10)
        response.raise_for_status()
        logging.info(f"'Invited By' for user {user_id} updated successfully.")
        return response.json()
    except requests.exceptions.RequestException as e:
        logging.error(f"Error updating 'Invited By': {e}")
        return None

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

        # Now, force the password reset using POST
        reset_api_url = f"{Config.AUTHENTIK_API_URL}/core/users/{user_id}/force_password_reset/"
        response = requests.post(reset_api_url, headers=headers, timeout=10)
        response.raise_for_status()
    except response.json().get('detail'):
        logging.error(f"Error forcing password reset for {username}: {response.json().get('detail')}")
        return False
    except requests.exceptions.RequestException as e:
        logging.error(f"Error forcing password reset for {username}: {e}")
        return False
    return True