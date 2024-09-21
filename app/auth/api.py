# auth/api.py
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from utils.config import Config
from datetime import datetime, timedelta
from pytz import timezone  
import logging

# Initialize a session with retry strategy
session = requests.Session()
retry = Retry(
    total=5,
    backoff_factor=1,
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["HEAD", "GET", "POST", "PUT", "DELETE", "OPTIONS", "TRACE"]  # Updated for newer urllib3 versions
)
adapter = HTTPAdapter(max_retries=retry)
session.mount("http://", adapter)
session.mount("https://", adapter)

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
        response = session.post(Config.SHLINK_URL, json=payload, headers=headers, timeout=10)
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


def create_user(username, full_name, email, invited_by=None, intro=None):
    """Create a new user in Authentik."""
    user_data = {
        "username": username,
        "name": full_name,
        "is_active": True,
        "email": email,
        "groups": [Config.MAIN_GROUP_ID],
        "attributes": {}
    }

    # Add 'invited_by' and 'intro' to attributes if they are provided
    if invited_by:
        user_data['attributes']['invited_by'] = invited_by
    if intro:
        user_data['attributes']['intro'] = intro

    user_api_url = f"{Config.AUTHENTIK_API_URL}/core/users/"
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    try:
        response = session.post(user_api_url, headers=headers, json=user_data, timeout=10)
        response.raise_for_status()
        user = response.json()
        logging.info(f"User created: {user.get('username')}")
        return user
    except requests.exceptions.HTTPError as http_err:
        logging.error(f"HTTP error occurred while creating user: {http_err}")
        try:
            logging.error(f"Response: {response.text}")
        except Exception:
            pass
        return None
    except requests.exceptions.RequestException as e:
        logging.error(f"Error creating user: {e}")
        return None

# List Users Function is needed and works better than the new methos session.get(f"{auth_api_url}/users/", headers=headers, timeout=10)
    
def list_users(auth_api_url, headers, search_term=None):
    """List users, optionally filtering by a search term."""
    try:
        params = {}
        if search_term:
            params['search'] = search_term
        else:
            params['page_size'] = 600  # Adjust based on API limits

        users = []
        next_url = f"{auth_api_url}/core/users/"

        while next_url:
            response = session.get(next_url, headers=headers, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            users.extend(data.get('results', []))
            next_url = data.get('next')

            # Clear params after the first request to avoid duplicate parameters
            params = {}

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
        tuple: The shortened invite URL and expiration time, if successful.
    """
    eastern = timezone('US/Eastern')
    current_time_str = datetime.now(eastern).strftime('%H-%M')

    # Default name for the invite
    if not label:
        label = current_time_str

    # Expiration logic
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

def reset_user_password(auth_api_url, headers, user_id, new_password):
    url = f"{auth_api_url}/core/users/{user_id}/set_password/"
    data = {"password": new_password}
    try:
        response = session.post(url, headers=headers, json=data, timeout=10)
        response.raise_for_status()
        logging.info(f"Password for user {user_id} reset successfully.")
        return response.json()
    except requests.exceptions.RequestException as e:
        logging.error(f"Error resetting password: {e}")
        return None

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
        response = session.post(recovery_api_url, headers=headers, timeout=10)
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
        response = session.post(reset_api_url, headers=headers, timeout=10)
        response.raise_for_status()
    except response.json().get('detail'):
        logging.error(f"Error forcing password reset for {username}: {response.json().get('detail')}")
        return False
    except requests.exceptions.RequestException as e:
        logging.error(f"Error forcing password reset for {username}: {e}")
        return False
    return True
