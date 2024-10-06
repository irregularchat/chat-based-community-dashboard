import requests
import logging
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Setup API configuration (fill in with your actual values)
API_URL = 'https://sso.irregularchat.com/api/v3/core/users/'
AUTHENTIK_API_TOKEN = 'usB6ijadk9JB7g4PwCvbbnPwtro0MqjSy3NPKSscIKe2wfv8HL2GlJrpAedU'

# Setup retry strategy for handling potential request failures
session = requests.Session()
retry = Retry(
    total=5,
    backoff_factor=1,
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["HEAD", "GET", "POST", "PUT", "DELETE", "OPTIONS", "TRACE"]
)
adapter = HTTPAdapter(max_retries=retry)
session.mount("http://", adapter)
session.mount("https://", adapter)

# Setup headers for authentication
headers = {
    'Authorization': f"Bearer {AUTHENTIK_API_TOKEN}",
    'Content-Type': 'application/json'
}

def list_users():
    """Fetch all users from the API with pagination."""
    users = []
    url = API_URL
    params = {'page_size': 600}  # Adjust as needed
    
    while url:
        try:
            response = session.get(url, headers=headers, params=params)
            response.raise_for_status()
            data = response.json()
            users.extend(data.get('results', []))
            url = data.get('next')  # Pagination link
        except requests.RequestException as e:
            logging.error(f"Failed to fetch users: {e}")
            return []
    
    return users

def update_user_to_internal(user_id, username):
    """Update a specific user to be an internal user."""
    update_url = f"{API_URL}{user_id}/"
    user_data = {"type": "internal"}  # Change user type to 'internal'
    
    try:
        response = session.patch(update_url, headers=headers, json=user_data)
        response.raise_for_status()
        logging.info(f"Successfully updated user {username} (ID: {user_id}) to internal.")
    except requests.RequestException as e:
        logging.error(f"Failed to update user {username} (ID: {user_id}): {e}")

def process_external_users():
    """Find all external users and update them to internal."""
    users = list_users()
    if not users:
        logging.error("No users retrieved.")
        return

    for user in users:
        user_id = user.get('pk') or user.get('id')  # Check both 'pk' and 'id'
        username = user.get('username')
        user_type = user.get('type')
        
        # Log details of each user before attempting conversion
        logging.info(f"Processing user: {username} (ID: {user_id}, Type: {user_type})")
        
        # Ensure the user ID is valid and of type 'external'
        if user_id and user_type == 'external':
            logging.info(f"Updating user {username} (ID: {user_id}) to internal.")
            update_user_to_internal(user_id, username)
        else:
            if not user_id:
                logging.warning(f"User {username} does not have a valid ID.")
            if user_type != 'external':
                logging.info(f"User {username} is not an external user (current type: {user_type}).")

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    process_external_users()