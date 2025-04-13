"""
Utility functions for authentication that are used across multiple modules.
This module helps prevent circular imports between auth.api and utils.helpers.
"""

import random
import logging
from xkcdpass import xkcd_password as xp
import requests
from app.utils.config import Config

# Locate the default wordlist provided by xkcdpass
wordfile = xp.locate_wordfile()
# Generate a wordlist with words of length between 5 and 8 characters
wordlist = xp.generate_wordlist(wordfile=wordfile, min_length=3, max_length=6)

def generate_secure_passphrase():
    """
    Generate a secure passphrase using xkcdpass.
    
    Returns:
        str: A secure passphrase with random number delimiter
    """
    # Generate a random number to use as part of the delimiter
    random_number = str(random.randint(10, 99))  # Generates a 2-digit number
    # Use the random number as a delimiter
    delimiter = random_number
    # Generate the passphrase with the random number as the delimiter
    passphrase = xp.generate_xkcdpassword(wordlist, numwords=2, delimiter=delimiter)
    return passphrase

def generate_username_with_random_word(first_name):
    """
    Generate a username using first name and a random word from xkcdpass.
    
    Args:
        first_name (str): The first name to use in the username
        
    Returns:
        str: A username in the format first-randomword
    """
    # Clean up the first name
    if not first_name:
        first_name = "user"
    
    # Convert to lowercase and remove special characters
    import re
    first_name = first_name.strip().lower()
    
    # Extract just the first part if there are spaces
    if ' ' in first_name:
        first_name = first_name.split(' ')[0]
    
    # Remove any special characters
    first_name = re.sub(r'[^a-z0-9-]', '', first_name)
    
    # Generate a random word using xkcdpass
    random_word = xp.generate_xkcdpassword(wordlist, numwords=1, delimiter="")
    
    # Combine first name and random word
    username = f"{first_name}-{random_word}"
    
    return username

def force_password_reset(username):
    """Force a password reset for a user."""
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    try:
        # First, get the user ID by username
        user_search_url = f"{Config.AUTHENTIK_API_URL}/core/users/?search={username}"
        response = requests.get(user_search_url, headers=headers, timeout=10)
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
        response = requests.get(reset_api_url, headers=headers, timeout=10)
        
        # If GET fails, try PUT
        if response.status_code == 405:  # Method Not Allowed
            logging.info(f"GET method not allowed for password reset, trying PUT")
            response = requests.put(reset_api_url, headers=headers, json={}, timeout=10)
            
        # If PUT fails, try PATCH
        if response.status_code == 405:  # Method Not Allowed
            logging.info(f"PUT method not allowed for password reset, trying PATCH")
            response = requests.patch(reset_api_url, headers=headers, json={}, timeout=10)
        
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

def shorten_url(long_url, url_type, name=None):
    """
    Shorten a URL using Shlink service if configured.
    
    Args:
        long_url (str): The URL to shorten
        url_type (str): Type of URL for tagging
        name (str, optional): Custom name for the short URL
        
    Returns:
        str: Shortened URL or original URL if service not available
    """
    if not Config.SHLINK_API_TOKEN or not Config.SHLINK_URL:
        return long_url  # Return original if no Shlink setup

    from datetime import datetime
    from pytz import timezone  
    
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
        "longUrl": long_url,
        "tags": [url_type],
        "customSlug": name
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
        logging.error(f'Response: {response.text if "response" in locals() else "No response"}')
        return long_url
    except requests.exceptions.RequestException as e:
        logging.error(f'Error shortening URL: {e}')
        return long_url 