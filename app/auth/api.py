import requests
import random
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from app.utils.config import Config # This will import the Config class from the config module
from datetime import datetime, timedelta
from pytz import timezone  
import logging

# Initialize the logger
logger = logging.getLogger(__name__)

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
import traceback
from app.auth.utils import generate_secure_passphrase, force_password_reset, shorten_url, generate_username_with_random_word
import threading
from app.db.session import get_db

# Define user path constant for Authentik
USER_PATH = "users"

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

# Comment out webhook_notification as it's no longer used
# async def webhook_notification(event_type: str, username: str = None, **kwargs) -> dict:
#     """
#     Send a webhook notification.
#     
#     Args:
#         event_type (str): Type of event (e.g., "user_created")
#         username (str): Username associated with the event
#         **kwargs: Additional data to include in webhook
#         
#     Returns:
#         dict: Response containing success status
#     """
#     if not Config.WEBHOOK_ACTIVE or not Config.WEBHOOK_URL:
#         logging.info("Webhook integration not active")
#         return {"success": False, "error": "Webhook not configured"}
# 
#     try:
#         # Clean up None values from kwargs
#         cleaned_kwargs = {k: v for k, v in kwargs.items() if v is not None}
#         
#         payload = {
#             "event_type": event_type,
#             "username": username,
#             "timestamp": datetime.now().isoformat(),
#             **cleaned_kwargs
#         }
#         
#         headers = {
#             "Content-Type": "application/json",
#             "X-Webhook-Signature": generate_webhook_signature(payload)
#         }
#         
#         response = requests.post(
#             Config.WEBHOOK_URL,
#             json=payload,
#             headers=headers,
#             timeout=10
#         )
#         response.raise_for_status()
#         
#         return {"success": True}
#         
#     except Exception as e:
#         logging.error(f"Error sending webhook notification: {e}")
#         return {"success": False, "error": str(e)}


# Function to generate a secure password
from app.auth.utils import generate_secure_passphrase

def list_events_cached(api_url, headers):
    response = requests.get(f"{api_url}/events", headers=headers)
    response.raise_for_status()  # Raise an error for bad responses
    return response.json()

def reset_user_password(auth_api_url, headers, user_id, temp_password=None):
    """
    Reset a user's password and create a password reset link.
    """
    # Ensure URL has a trailing slash
    url = f"{auth_api_url}/core/users/{user_id}/set_password/"
    data = {"password": temp_password}
    
    # Log what we're about to do (without the actual password)
    logger.info(f"Attempting to reset password for user {user_id}")
    
    try:
        # First try with POST method
        logger.info(f"Attempting POST request to {url}")
        response = requests.post(url, headers=headers, json=data, timeout=30, verify=True)
        
        # Log response for debugging
        logger.info(f"POST response status code: {response.status_code}")
        
        # If POST fails with 405, try PUT method
        if response.status_code == 405:  # Method Not Allowed
            logger.info(f"POST method not allowed for password reset, trying PUT")
            response = requests.put(url, headers=headers, json=data, timeout=30, verify=True)
            logger.info(f"PUT response status code: {response.status_code}")
        
        # Check if any of the requests was successful
        if response.status_code in [200, 201, 202, 204]:
            logger.info(f"Password for user {user_id} reset successfully with status {response.status_code}.")
            
            # For LDAP integration, add a delay to allow for propagation
            # This can help with issues where LDAP writeback needs time to complete
            import time
            time.sleep(1)
            
            return True
        
        # Try to decode the error response
        try:
            error_detail = response.json()
            logger.error(f"Password reset API response: {json.dumps(error_detail, indent=2)}")
        except:
            logger.error(f"Password reset failed with non-JSON response: {response.text}")
        
        # If we reached here without a success status code, log the error and return False
        logger.error(f"Password reset failed with status code {response.status_code}")
        
        return False
            
    except requests.exceptions.HTTPError as http_err:
        logger.error(f"HTTP error occurred while resetting password for user {user_id}: {http_err}")
        return False
    except requests.exceptions.Timeout:
        logger.error(f"Timeout occurred while resetting password for user {user_id}. This might be an LDAP writeback delay issue.")
        return False
    except requests.exceptions.RequestException as e:
        logger.error(f"Error resetting password for user {user_id}: {e}")
        return False

def send_welcome_to_user(message):
    """
    Send a welcome message to a new user.
    
    Args:
        message (str): The welcome message to send to the user
        
    Returns:
        bool: True if the message was sent successfully, False otherwise
    """
    try:
        if not message:
            logger.warning("Empty welcome message received, cannot send")
            return False
            
        logger.info(f"Welcome message would be sent: {message[:100]}... (truncated)")
        # Implementation would go here - this is a placeholder
        # This function would typically send a welcome message via Matrix or other channels
        
        # Attempt to send via Matrix if configured
        if hasattr(Config, 'MATRIX_ACTIVE') and Config.MATRIX_ACTIVE:
            try:
                from app.utils.matrix_actions import send_direct_message
                # Extract username from the message to determine recipient
                import re
                match = re.search(r'Username: ([a-zA-Z0-9-]+)', message)
                if match:
                    username = match.group(1)
                    logger.info(f"Extracted username from welcome message: {username}")
                    # Send the actual message (implementation depends on your Matrix setup)
                    # This is just a placeholder
                    logger.info(f"Would send welcome message to Matrix user {username}")
                    # send_direct_message(username, message)
                else:
                    logger.warning("Could not extract username from welcome message")
            except Exception as matrix_error:
                logger.error(f"Error sending welcome via Matrix: {str(matrix_error)}")
        
        return True
    except Exception as e:
        logger.error(f"Error sending welcome message: {str(e)}")
        return False

def create_user(
    email,
    first_name,
    last_name,
    attributes=None,
    groups=None,
    send_welcome=True,
    should_create_discourse_post=False,
    desired_username=None,
    reset_password=False,
):
    """
    Create a new user in Authentik and optionally send a welcome message
    """
    # Import inside function to avoid circular imports
    from app.utils.helpers import create_unique_username
    from app.messages import create_user_message
    from app.auth.utils import generate_username_with_random_word
    import threading
    
    # Initialize the response dictionary
    response = {
        "success": False,
        "error": None,
        "user_id": None,
        "username": None,
        "temp_password": None,
        "password_reset": None,
    }
    
    # Generate username with a random word based on first name
    if not desired_username:
        # Use generate_username_with_random_word to create a unique username
        username = generate_username_with_random_word(first_name)
        logger.info(f"Generated username with random word: {username}")
    else:
        username = desired_username
        logger.info(f"Using provided username: {username}")
    
    # Store the username for later use in response
    response["username"] = username
    
    # Create a temporary password for the user
    temp_password = generate_secure_passphrase()
    response["temp_password"] = temp_password
    
    # Initialize user data with attributes and groups
    user_data = {
        "username": username,
        "name": f"{first_name} {last_name}".strip(),
        "email": email,
        "password": temp_password,
        "is_active": True,  # Explicitly set is_active
    }

    # Set the path only if USER_PATH is defined and not empty
    if USER_PATH and USER_PATH.strip():
        user_data["path"] = USER_PATH

    # Add attributes if provided
    if attributes:
        # Make sure attributes is a dictionary
        if not isinstance(attributes, dict):
            attributes = {}
        user_data["attributes"] = attributes
    
    # Add main group ID if configured
    main_group_id = os.getenv("AUTHENTIK_MAIN_GROUP_ID")
    if main_group_id:
        user_data["groups"] = [str(main_group_id)]  # Convert to string to ensure correct format
    
    # Add groups if provided and convert to strings
    if groups:
        try:
            # Ensure groups is a list of strings
            if isinstance(groups, str):
                groups = [groups]
            
            # Convert any non-string group IDs to strings
            string_groups = [str(group) for group in groups]
            
            # Remove duplicates while preserving order
            unique_groups = []
            for group in string_groups:
                if group not in unique_groups:
                    unique_groups.append(group)
                    
            user_data["groups"] = unique_groups
        except Exception as e:
            logger.error(f"Error processing groups: {e}")
            # Continue without groups if there's an error

    try:
        # Create the user in Authentik
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        
        # Log detailed payload for debugging
        logger.info(f"Creating user with data: {json.dumps(user_data, indent=2)}")
        
        response_url = f"{Config.AUTHENTIK_API_URL}/core/users/"
        try:
            api_response = requests.post(response_url, headers=headers, json=user_data, timeout=10)
            
            # Log response status and body for diagnostics
            logger.info(f"API Response status: {api_response.status_code}")
            
            # Try to decode the response as JSON
            try:
                response_data = api_response.json()
                logger.info(f"API Response body: {json.dumps(response_data, indent=2)}")
            except:
                logger.info(f"API Response text (not JSON): {api_response.text}")
            
            # Handle username uniqueness error specially
            if api_response.status_code == 400:
                error_details = api_response.json()
                if 'username' in error_details and any('unique' in err.lower() for err in error_details['username']):
                    # Username is not unique, try again with a different random word
                    logger.warning(f"Username '{username}' already exists. Generating a new one.")
                    response["error"] = f"Failed to create user: Username '{username}' already exists."
                    return response
            
            # Only raise for status here after logging
            api_response.raise_for_status()
            response_json = api_response.json()
            
            if not response_json.get("pk"):
                response["error"] = f"Failed to create user: {response_json}"
                logger.error(f"Error creating user: {response_json}")
                return response
                
        except requests.exceptions.HTTPError as http_err:
            # Get the response JSON if possible for more detailed error info
            error_detail = "Unknown error"
            try:
                error_detail = api_response.json()
            except:
                error_detail = api_response.text
                
            response["error"] = f"HTTP error {api_response.status_code}: {error_detail}"
            logger.error(f"HTTP error creating user: {api_response.status_code} - {error_detail}")
            return response
        except Exception as req_err:
            response["error"] = f"Request error: {str(req_err)}"
            logger.error(f"Request error creating user: {str(req_err)}")
            return response
        
        # User created successfully
        user_id = response_json.get("pk")
        response["user_id"] = user_id
        response["success"] = True
        
        # Reset the user's password in a separate thread to avoid blocking
        # This is important because:
        # 1. It ensures the password from API is properly set
        # 2. It creates a proper password reset link for the user 
        # 3. It handles potential race conditions with the Authentik backend
        if reset_password:
            # First, set a default value
            response["password_reset"] = True  # Default to success

            # Define the reset task
            def reset_password_task():
                try:
                    password_reset_response = reset_user_password(Config.AUTHENTIK_API_URL, headers, user_id, temp_password)
                    if password_reset_response:
                        logger.info(f"Password reset link created for user {username}")
                        # No need to update response here as it's already set to True by default
                    else:
                        logger.error(f"Failed to create password reset link for user {username}")
                        response["password_reset"] = False
                except Exception as e:
                    logger.error(f"Error in password reset task: {str(e)}")
                    response["password_reset"] = False
            
            # Start the password reset thread and perform it synchronously to avoid race conditions
            try:
                reset_password_task()  # Run directly without threading
            except Exception as e:
                logger.error(f"Error while resetting password: {str(e)}")
                response["password_reset"] = False
        else:
            # Skip password reset, just mark it as completed
            logger.info(f"Skipping password reset for user {username}")
            response["password_reset"] = True
        
        # Send welcome message if requested
        if send_welcome:
            def send_welcome_message_task():
                try:
                    # Create welcome message using the unique username
                    message = create_user_message(username, temp_password)
                    
                    # Log the message for debugging
                    logger.info(f"Sending welcome message to {username}")
                    
                    # Send message via Matrix
                    send_welcome_to_user(message)
                    logger.info(f"Welcome message sent to {username}")
                except Exception as e:
                    logger.error(f"Error sending welcome message: {str(e)}")
            
            # Start welcome message thread
            threading.Thread(target=send_welcome_message_task).start()
        
        # Create Discourse post if requested
        if should_create_discourse_post:
            try:
                # Create a title for the introduction post
                post_title = f"Introduction: {username}"
                # Get intro from attributes if available
                intro = None
                invited_by = None
                organization = None
                interests = None
                if attributes and isinstance(attributes, dict):
                    intro = attributes.get('intro')
                    invited_by = attributes.get('invited_by')
                    organization = attributes.get('organization')
                    interests = attributes.get('interests')
                
                # Format intro text to include organization and interests if available
                formatted_intro = ""
                if intro:
                    formatted_intro += f"{intro}\n\n"
                
                if organization:
                    formatted_intro += f"**Organization:** {organization}\n"
                
                if interests:
                    formatted_intro += f"**Interests:** {interests}\n"
                
                # Use the formatted intro or the original intro if no formatting was done
                final_intro = formatted_intro.strip() if formatted_intro.strip() else intro
                
                # Import the create_discourse_post function here to avoid circular imports
                from app.auth.api import create_discourse_post
                
                # Log what we're about to do
                logger.info(f"Creating Discourse post for {username} with intro: {final_intro}")
                
                # Call the create_discourse_post function directly (not in a thread)
                success, post_url = create_discourse_post(headers, post_title, "", username, final_intro, invited_by)
                
                if success and post_url:
                    logger.info(f"Created Discourse post for new user {username} at {post_url}")
                    # Add post URL to the response
                    response["discourse_url"] = post_url
                else:
                    logger.warning(f"Failed to create Discourse post for user {username} or post URL not returned")
            except Exception as e:
                logger.error(f"Error creating Discourse post: {str(e)}")
        
        return response
    
    except Exception as e:
        logger.error(f"Error in create_user: {str(e)}")
        response["error"] = str(e)
        return response


def list_users(auth_api_url, headers, search_term=None, status=None):
    """
    Get users from Authentik API with fallback to local database if API fails.
    
    Args:
        auth_api_url (str): Authentik API URL
        headers (dict): Headers with authentication token
        search_term (str, optional): Search term to filter users
        status (str, optional): Filter by user status ('active' or 'inactive')
        
    Returns:
        list: List of user dictionaries
    """
    try:
        params = {
            'page_size': 500,  # Reduced page size for better reliability
            'ordering': 'username'  # Default ordering by username
        }
        
        # Add search term if provided
        if search_term:
            params['search'] = search_term
        
        # Add status filter if provided
        if status:
            params['is_active'] = status == 'active'

        users = []
        url = f"{auth_api_url}/core/users/"
        page_count = 0
        total_fetched = 0
        max_retries = 3

        while url:
            page_count += 1
            logger.info(f"Fetching users page {page_count}...")
            
            # Try with retries for each page
            for retry in range(max_retries):
                try:
                    response = session.get(url, headers=headers, params=params, timeout=60)  # Increased timeout
                    response.raise_for_status()
                    data = response.json()
                    break  # Success, exit retry loop
                except Exception as e:
                    if retry < max_retries - 1:
                        logger.warning(f"Error fetching page {page_count}, retrying ({retry+1}/{max_retries}): {e}")
                        time.sleep(2)  # Wait before retrying
                    else:
                        logger.error(f"Failed to fetch page {page_count} after {max_retries} attempts: {e}")
                        if page_count == 1:  # Only fallback if we fail on the first page
                            logger.warning("Falling back to local database for user data")
                            return _get_users_from_local_db(search_term, status)
                        else:
                            # We've already fetched some pages, so return what we have
                            logger.warning(f"Returning {len(users)} users fetched before failure")
                            return users
            
            results = data.get('results', [])
            total_fetched += len(results)
            logger.info(f"Fetched {len(results)} users (total so far: {total_fetched})")
            
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

        logger.info(f"Total users fetched: {len(users)}")
        return users
    except requests.exceptions.RequestException as e:
        logger.error(f"Error listing users: {e}")
        logger.warning("Falling back to local database for user data")
        return _get_users_from_local_db(search_term, status)

def _get_users_from_local_db(search_term=None, status=None):
    """
    Internal function to get users from local database.
    Used as a fallback when Authentik API is unavailable.
    
    Args:
        search_term (str, optional): Search term to filter users
        status (str, optional): Filter by user status ('active' or 'inactive')
        
    Returns:
        list: List of user dictionaries formatted like Authentik API response
    """
    try:
        # Import here to avoid circular imports
        from app.db.database import get_db
        from app.db.models import User
        
        logger.info("Fetching users from local database")
        
        with next(get_db()) as db:
            # Build query based on filters
            query = db.query(User)
            
            # Apply search filter if provided
            if search_term:
                search_pattern = f"%{search_term}%"
                query = query.filter(
                    or_(
                        User.username.ilike(search_pattern),
                        User.name.ilike(search_pattern),
                        User.email.ilike(search_pattern)
                    )
                )
            
            # Apply status filter if provided
            if status:
                is_active = status == 'active'
                query = query.filter(User.is_active == is_active)
            
            # Execute query
            local_users = query.all()
            logger.info(f"Found {len(local_users)} users in local database")
            
            # Format users to match Authentik API response format
            formatted_users = []
            for user in local_users:
                formatted_user = {
                    'pk': user.authentik_id or user.id,  # Use authentik_id if available, otherwise use local id
                    'username': user.username,
                    'name': user.name,
                    'email': user.email,
                    'is_active': user.is_active,
                    'last_login': user.last_login,
                    'attributes': user.attributes or {},
                }
                
                # Add LinkedIn username if available
                if hasattr(user, 'linkedin_username') and user.linkedin_username:
                    if 'attributes' not in formatted_user:
                        formatted_user['attributes'] = {}
                    formatted_user['attributes']['linkedin_username'] = user.linkedin_username
                
                formatted_users.append(formatted_user)
            
            logger.info(f"Returning {len(formatted_users)} formatted users from local database")
            return formatted_users
    except Exception as e:
        logger.error(f"Error fetching users from local database: {e}")
        return []  # Return empty list as last resort

def list_users_cached(auth_api_url, headers):
    """List users with caching to reduce API calls."""
    try:
        response = session.get(f"{auth_api_url}/core/users/", headers=headers, timeout=10)
        response.raise_for_status()
        users = response.json().get('results', [])
        return users
    except requests.exceptions.RequestException as e:
        logger.error(f"Error listing users: {e}")
        return []


def create_invite(headers=None, label=None, expires=None, email=None, name=None, expiry=None, created_by=None, groups=None):
    """
    Create an invitation for a user.

    Parameters:
        headers (dict): The request headers for Authentik API.
        label (str): The label to identify the invitation.
        expires (str, optional): The expiration time for the invite.
        email (str, optional): Email address of the invitee.
        name (str, optional): Name of the invitee, will be used as label if provided.
        expiry (str, optional): Alternative format for expiration time.
        created_by (str, optional): Username of the person creating the invitation.
        groups (list, optional): List of group IDs to pre-assign the user to.

    Returns:
        dict: Dictionary containing 'invite_link', 'expiry', 'success' and error message if applicable.
    """
    # Get headers if not provided
    if headers is None:
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
    
    # Handle different parameter options for name/label
    if name and not label:
        label = name
    
    logger.info(f"Creating invite with label: {label}")
    eastern = timezone('US/Eastern')
    if not label:
        label = datetime.now(eastern).strftime('%H-%M')
        logger.info(f"No label provided, using timestamp: {label}")

    # Fix the label to ensure it is a valid slug:
    # - Convert to lowercase
    # - Replace whitespace with underscores
    # - Remove any character that is not a letter, number, underscore, or hyphen
    import re
    fixed_label = label.strip().lower()
    fixed_label = re.sub(r'\s+', '_', fixed_label)
    fixed_label = re.sub(r'[^a-z0-9_-]', '', fixed_label)
    
    if fixed_label != label:
        logger.info(f"Label modified for validity: {label} -> {fixed_label}")
        label = fixed_label

    # Handle different parameter options for expiration
    if expiry and not expires:
        expires = expiry
        
    if expires is None:
        expires = (datetime.now(eastern) + timedelta(hours=2)).isoformat()
        logger.info(f"No expiry provided, using default: {expires}")

    # Prepare fixed data for invitation
    fixed_data = {}
    
    # Add email to fixed data if provided
    if email:
        fixed_data['email'] = email
        logger.info(f"Adding email to invitation: {email}")
        
    # Add groups to fixed data if provided
    if groups and isinstance(groups, list) and len(groups) > 0:
        fixed_data['groups'] = groups
        logger.info(f"Adding groups to invitation: {groups}")
        
    # Add created_by information if provided    
    if created_by:
        fixed_data['created_by'] = created_by
        logger.info(f"Adding created_by to invitation: {created_by}")

    data = {
        "name": label,
        "expires": expires,
        "fixed_data": fixed_data,
        "single_use": True,
        "flow": Config.INVITE_FLOW_ID  # Use the invite flow ID for invitations
    }

    invite_api_url = f"{Config.AUTHENTIK_API_URL}/stages/invitation/invitations/"
    logger.info(f"Sending request to: {invite_api_url}")
    
    try:
        response = requests.post(invite_api_url, headers=headers, json=data, timeout=10)
        response.raise_for_status()
        response_data = response.json()
        logger.info(f"Received response data: {response_data}")

        # Get the invite ID from the API response
        invite_id = response_data.get('pk')
        if not invite_id:
            logger.error("API response missing 'pk' field.")
            return {
                'success': False,
                'error': "API response missing 'pk' field."
            }

        # Construct the full invite URL
        invite_link = f"https://sso.{Config.BASE_DOMAIN}/if/flow/{Config.INVITE_LABEL}/?itoken={invite_id}"
        logger.info(f"Created invite link: {invite_link}")
        
        # Return as dictionary with success flag
        return {
            'success': True,
            'invite_link': invite_link,
            'expiry': expires
        }

    except requests.exceptions.HTTPError as http_err:
        logger.error(f"HTTP error occurred: {http_err}")
        error_detail = ""
        try:
            error_detail = response.json()
        except Exception:
            try:
                error_detail = response.text
            except Exception:
                error_detail = "Unknown error"
        logger.error(f"API Error response: {error_detail}")
        
        return {
            'success': False,
            'error': f"HTTP error: {http_err}",
            'details': error_detail
        }
    except Exception as err:
        logger.error(f"An error occurred: {err}")
        return {
            'success': False,
            'error': f"Error: {err}"
        }


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
        logger.info(f"Updating user {user_id} status to {'active' if is_active else 'inactive'}")
        response = session.patch(url, headers=headers, json=data, timeout=10)
        
        if response.status_code in [200, 201, 202, 204]:
            logger.info(f"User {user_id} status updated to {'active' if is_active else 'inactive'}.")
            return True
        else:
            logger.error(f"Failed to update user {user_id} status. Status code: {response.status_code}")
            return False
            
    except requests.exceptions.RequestException as e:
        logger.error(f"Error updating user status: {e}")
        return False

def delete_user(auth_api_url, headers, user_id):
    url = f"{auth_api_url}/core/users/{user_id}/"
    try:
        response = session.delete(url, headers=headers, timeout=10)
        if response.status_code == 204:
            logger.info(f"User {user_id} deleted successfully.")
            return True
        else:
            logger.error(f"Failed to delete user {user_id}. Status Code: {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        logger.error(f"Error deleting user: {e}")
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
        logger.info(f"Updating intro for user {user_id}")
        response = session.patch(url, headers=headers, json=data, timeout=10)
        
        if response.status_code in [200, 201, 202, 204]:
            logger.info(f"Intro for user {user_id} updated successfully.")
            return True
        else:
            logger.error(f"Failed to update intro for user {user_id}. Status code: {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        logger.error(f"Error updating user intro: {e}")
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
        logger.info(f"Updating 'invited by' for user {user_id}")
        response = session.patch(url, headers=headers, json=data, timeout=10)
        
        if response.status_code in [200, 201, 202, 204]:
            logger.info(f"'Invited By' for user {user_id} updated successfully.")
            return True
        else:
            logger.error(f"Failed to update 'invited by' for user {user_id}. Status code: {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        logger.error(f"Error updating 'Invited By': {e}")
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
            logger.error(f"No user found with username: {username}")
            return None
        user_id = users[0]['pk']

        # Now, generate the recovery link using POST
        recovery_api_url = f"{Config.AUTHENTIK_API_URL}/core/users/{user_id}/recovery/"
        response = requests.post(recovery_api_url, headers=headers, timeout=10)
        response.raise_for_status()
        recovery_link = response.json().get('link')
        logger.info(f"Recovery link generated for user: {username}")
        return recovery_link

    except requests.exceptions.RequestException as e:
        logger.error(f"Error generating recovery link for {username}: {e}")
        return None

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
    
    logger.info(f"Attempting to update email for user {user_id} to {new_email}")
    try:
        response = session.patch(url, headers=headers, json=data, timeout=10)
        
        if response.status_code in [200, 201, 202, 204]:
            logger.info(f"Email for user {user_id} updated successfully to {new_email}")
            return True
        else:
            logger.error(f"Failed to update email for user {user_id}. Status code: {response.status_code}")
            return False
    except requests.exceptions.HTTPError as http_err:
        logger.error(f"HTTP error updating email: {http_err}")
        logger.error(f"Response content: {http_err.response.text if http_err.response else 'No response content'}")
        return False
    except requests.exceptions.RequestException as e:
        logger.error(f"Error updating user email: {e}")
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
                    logger.error(f"Invalid last_updated format: {last_updated}")
        
        # Fallback: return the current time
        return datetime.now()
    except Exception as e:
        logger.error(f"Error getting last modified timestamp: {e}")
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
            logger.info(f"Fetching modified users page {page_count}...")
            
            # Try with retries for each page
            for retry in range(max_retries):
                try:
                    response = session.get(url, headers=headers, params=params, timeout=60)
                    response.raise_for_status()
                    data = response.json()
                    break  # Success, exit retry loop
                except Exception as e:
                    if retry < max_retries - 1:
                        logger.warning(f"Error fetching page {page_count}, retrying ({retry+1}/{max_retries}): {e}")
                        time.sleep(2)  # Wait before retrying
                    else:
                        logger.error(f"Failed to fetch page {page_count} after {max_retries} attempts: {e}")
                        raise  # Re-raise the exception after all retries failed
            
            results = data.get('results', [])
            total_fetched += len(results)
            logger.info(f"Fetched {len(results)} modified users (total so far: {total_fetched})")
            
            users.extend(results)
            
            url = data.get('next')
            params = {}  # Clear params after first request

        logger.info(f"Total modified users fetched: {len(users)}")
        return users
    except Exception as e:
        logger.error(f"Error getting modified users: {e}")
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
    # Debug logging to identify if function is being called
    logger.info("=== create_discourse_post function called ===")
    logger.info(f"Parameters: title='{title}', username='{username}', invited_by='{invited_by}'")
    logger.info(f"Intro text: {intro[:100] + '...' if intro and len(intro) > 100 else intro}")
    
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
        logger.warning(f"Discourse integration not fully configured. Missing: {', '.join(missing_configs)}. Skipping post creation.")
        return False, None
    
    if not Config.DISCOURSE_ACTIVE:
        logger.info("Discourse integration is disabled (DISCOURSE_ACTIVE=False). Skipping post creation.")
        return False, None
    
    logger.info(f"Starting Discourse post creation for user {username}")
    logger.info(f"Using Discourse URL: {Config.DISCOURSE_URL}")
    logger.info(f"Using Discourse category ID: {Config.DISCOURSE_CATEGORY_ID}")
    logger.info(f"Using Discourse API username: {Config.DISCOURSE_API_USERNAME}")
    logger.info(f"Discourse API key is {'configured' if Config.DISCOURSE_API_KEY else 'missing'}")
        
    try:
        # Create the post content with the exact template format specified
        
        # Ensure intro has a value and is properly formatted
        intro_text = "No introduction provided."
        if intro:
            # Remove any leading/trailing whitespace and ensure proper line endings
            intro_text = intro.strip()
            # Ensure there are no more than two consecutive line breaks
            import re
            intro_text = re.sub(r'\n{3,}', '\n\n', intro_text)
        
        formatted_content = f"""This is {username}

Introduction:
{intro_text}

Invited by: {invited_by or 'Not specified'}

_Use this post to link to your introduction in the chats and have IrregularChat Members find you based on your interests or offerings._
Notice that Login is required to view any of the Community posts. Please help maintain community privacy."""
        
        # Log the formatted content for debugging
        logger.info(f"Formatted Discourse post content: {formatted_content}")
        
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
        
        logger.info(f"Attempting to create Discourse post for {username} at URL: {url}")
        logger.info(f"Request data: {json.dumps(data)}")
        # Increase timeout to 30 seconds to allow more time for Discourse API
        response = requests.post(url, headers=discourse_headers, json=data, timeout=30)
        
        logger.info(f"Discourse API response status code: {response.status_code}")
        
        if response.status_code >= 400:
            error_detail = "Unknown error"
            try:
                error_detail = response.json().get('errors', response.text) if response.text else "Unknown error"
            except:
                error_detail = response.text if response.text else "Unknown error"
                
            logger.error(f"Error creating Discourse post: {error_detail}")
            return False, None
        
        # Get the post's topic URL from the response
        try:
            response_data = response.json()
            logger.info(f"Discourse API response data: {json.dumps(response_data)}")
            
            post_id = response_data.get('id')
            topic_id = response_data.get('topic_id')
            
            # Construct the post URL
            if topic_id:
                post_url = f"{base_url}/t/{topic_id}"
                logger.info(f"Successfully created Discourse post for {username} at URL: {post_url}")
                
                # Store success in session state for UI display
                if hasattr(st, 'session_state'):
                    st.session_state['discourse_post_created'] = True
                    st.session_state['discourse_post_url'] = post_url
                
                return True, post_url
            else:
                logger.warning(f"Created post but couldn't get topic_id from response: {response_data}")
                return True, None
        except Exception as e:
            logger.error(f"Error parsing post response: {e}")
            logger.error(traceback.format_exc())
            return True, None
    except Exception as e:
        logger.error(f"Error creating Discourse post for {username}: {e}")
        logger.error(traceback.format_exc())
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
        logger.error(f"Error verifying email: {e}")
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
        logger.error(f"Error in reset_password: {e}")
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
            success = await update_user_data(username, user_data)
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
        logger.error(f"Error processing auth webhook: {e}")
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
            logger.warning("Webhook secret not configured")
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
        logger.error(f"Error validating webhook signature: {e}")
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
            logger.error(f"Error parsing webhook data: {e}")
            return {
                "success": False,
                "error": "Invalid JSON data"
            }
            
        # Process webhook
        result = await process_auth_webhook(webhook_data)
        return result
        
    except Exception as e:
        logger.error(f"Error handling webhook: {e}")
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
        logger.info(f"Would send verification email to {email} with code {code}")
        return True
    except Exception as e:
        logger.error(f"Error sending verification email: {e}")
        return False

async def get_user_by_email(email: str, db: Session) -> Optional[User]:
    """Get user by email address."""
    try:
        return db.query(User).filter(User.email == email).first()
    except Exception as e:
        logger.error(f"Error getting user by email: {e}")
        return None

async def send_reset_code(email: str, code: str) -> bool:
    """Send password reset code to user."""
    try:
        subject = "Reset your password"
        body = f"Your password reset code is: {code}"
        
        # Use your email sending logic here
        # For now, just log it
        logger.info(f"Would send reset code to {email}: {code}")
        return True
    except Exception as e:
        logger.error(f"Error sending reset code: {e}")
        return False

async def update_user_data(auth_api_url: str, headers: dict, data: dict):  
    url = f"{auth_api_url}/core/users/{user_id}/"
    
    logger.info(f"Attempting to update user {user_id}")
    try:
        response = session.patch(url, headers=headers, json=data, timeout=10)
        
        if response.status_code in [200, 201, 202, 204]:
            logger.info(f"User {user_id} updated successfully.")
            return True
        else:
            logger.error(f"Failed to update user {user_id}. Status code: {response.status_code}")
            return False
            
    except requests.exceptions.HTTPError as http_err:
        logger.error(f"HTTP error updating user: {http_err}")
        logger.error(f"Response content: {http_err.response.text if http_err.response else 'No response content'}")
        return False
    except requests.exceptions.RequestException as e:
        logger.error(f"Error updating user: {e}")
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
        logger.error(f"Error getting verification code: {e}")
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
        logger.error(f"Error marking email as verified: {e}")
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
        logger.error(f"Error processing webhook: {e}")
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
        success, created_username, temp_password, discourse_post_url = await create_user(
            username=username,
            first_name=full_name.split()[0],
            last_name=full_name.split()[1],
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
            "temp_password": temp_password,  # Include temporary password in response
            "discourse_post_url": discourse_post_url
        }
        
    except Exception as e:
        logger.error(f"Error handling registration: {e}")
        if hasattr(db, 'rollback'):
            db.rollback()
        return {
            "success": False,
            "error": str(e)
        }

async def grant_admin_privileges(username: str) -> bool:
    """
    Grant admin privileges to a user.
    
    Args:
        username (str): Username to grant admin privileges to
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        with SessionLocal() as db:
            from app.db.operations import update_admin_status
            return update_admin_status(db, username, True)
    except Exception as e:
        logger.error(f"Error granting admin privileges to {username}: {e}")
        return False

async def revoke_admin_privileges(username: str) -> bool:
    """
    Revoke admin privileges from a user.
    
    Args:
        username (str): Username to revoke admin privileges from
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        with SessionLocal() as db:
            from app.db.operations import update_admin_status
            return update_admin_status(db, username, False)
    except Exception as e:
        logger.error(f"Error revoking admin privileges from {username}: {e}")
        return False

async def is_admin(username: str) -> bool:
    """
    Check if a user is an admin.
    
    Args:
        username (str): Username to check
        
    Returns:
        bool: True if the user is an admin, False otherwise
    """
    try:
        # First check if the user is in the admin list in the configuration
        from app.utils.config import Config
        if Config.is_admin(username):
            return True
            
        # Then check the database
        with SessionLocal() as db:
            from app.db.operations import is_admin as db_is_admin
            return db_is_admin(db, username)
    except Exception as e:
        logger.error(f"Error checking admin status for {username}: {e}")
        return False

async def get_admin_users() -> List[Dict[str, Any]]:
    """
    Get all admin users.
    
    Returns:
        List[Dict[str, Any]]: List of admin users
    """
    try:
        with SessionLocal() as db:
            from app.db.operations import get_admin_users as db_get_admin_users
            admin_users = db_get_admin_users(db)
            return [user.to_dict() for user in admin_users]
    except Exception as e:
        logger.error(f"Error getting admin users: {e}")
        return []

async def sync_admin_status() -> bool:
    """
    Sync admin status from configuration to database.
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        with SessionLocal() as db:
            from app.db.operations import sync_admin_status as db_sync_admin_status
            return db_sync_admin_status(db)
    except Exception as e:
        logger.error(f"Error syncing admin status: {e}")
        return False

# Function to create a user in Authentik
def create_authentik_user(user_data):
    """
    Create a user in Authentik using the API.
    
    Args:
        user_data (dict): User data containing username, name, email, password, etc.
        
    Returns:
        dict: Response from the Authentik API
    """
    try:
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        
        # Log detailed payload for debugging (excluding sensitive data)
        log_data = user_data.copy()
        if 'password' in log_data:
            log_data['password'] = '********'  # Mask password
        logger.info(f"Creating user with data: {json.dumps(log_data, indent=2)}")
        
        response_url = f"{Config.AUTHENTIK_API_URL}/core/users/"
        api_response = requests.post(response_url, headers=headers, json=user_data, timeout=10)
        
        # Log response status
        logger.info(f"API Response status: {api_response.status_code}")
        
        # Try to decode the response as JSON
        try:
            response_data = api_response.json()
            logger.info(f"API Response body: {json.dumps(response_data, indent=2)}")
        except:
            logger.info(f"API Response text (not JSON): {api_response.text}")
        
        api_response.raise_for_status()
        return api_response.json()
        
    except requests.exceptions.HTTPError as http_err:
        # Get the response JSON if possible for more detailed error info
        error_detail = "Unknown error"
        try:
            error_detail = api_response.json()
        except:
            error_detail = api_response.text
            
        logger.error(f"HTTP error creating user: {api_response.status_code} - {error_detail}")
        raise
    except Exception as req_err:
        logger.error(f"Request error creating user: {str(req_err)}")
        raise