# app/utils/config.py
import os
from dotenv import load_dotenv
import logging
import uuid

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Determine the absolute path to the root directory
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../'))

# Path to the .env file
env_path = os.path.join(ROOT_DIR, '.env')

# Load environment variables from the .env file
load_dotenv(dotenv_path=env_path)

class Config:
    AUTHENTIK_API_TOKEN = os.getenv("AUTHENTIK_API_TOKEN")
    MAIN_GROUP_ID = os.getenv("MAIN_GROUP_ID")
    BASE_DOMAIN = os.getenv("BASE_DOMAIN")
    FLOW_ID = os.getenv("FLOW_ID")
    INVITE_FLOW_ID = os.getenv("INVITE_FLOW_ID")
    INVITE_LABEL = os.getenv("INVITE_LABEL")
    LOCAL_DB = os.getenv("LOCAL_DB", "users.csv")
    SHLINK_API_TOKEN = os.getenv("SHLINK_API_TOKEN")
    SHLINK_URL = os.getenv("SHLINK_URL")
    SHLINK_ACTIVE = os.getenv("SHLINK_ACTIVE", "False").lower() == "true"
    AUTHENTIK_API_URL = os.getenv("AUTHENTIK_API_URL")
    PAGE_TITLE = os.getenv("PAGE_TITLE", "Authentik Streamlit App")
    FAVICON_URL = os.getenv("FAVICON_URL", "default_favicon.ico")
    WEBHOOK_URL = os.getenv("WEBHOOK_URL")
    WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET")
    WEBHOOK_ACTIVE = os.getenv("WEBHOOK_ACTIVE", "False").lower() == "true"
    DATABASE_URL = os.getenv("DATABASE_URL")
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
    SMTP_SERVER = os.getenv("SMTP_SERVER")
    SMTP_PORT = os.getenv("SMTP_PORT")
    SMTP_USER = os.getenv("SMTP_USER")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
    SMTP_FROM = os.getenv("SMTP_FROM")
    SMTP_BCC = os.getenv("SMTP_BCC")
    SMTP_ACTIVE = os.getenv("SMTP_ACTIVE", "False").lower() == "true"
    
    # Discourse integration (optional)
    DISCOURSE_URL = os.getenv("DISCOURSE_URL")
    DISCOURSE_CATEGORY_ID = os.getenv("DISCOURSE_CATEGORY_ID")
    DISCOURSE_INTRO_TAG = os.getenv("DISCOURSE_INTRO_TAG", "introductions")
    DISCOURSE_API_KEY = os.getenv("DISCOURSE_API_KEY")
    DISCOURSE_API_USERNAME = os.getenv("DISCOURSE_API_USERNAME")
    DISCOURSE_ACTIVE = os.getenv("DISCOURSE_ACTIVE", "False").lower() == "true"
    
    # Matrix integration (optional)
    MATRIX_ACTIVE = os.getenv("MATRIX_ACTIVE", "False").lower() == "true"
    MATRIX_URL = os.getenv("MATRIX_URL")
    MATRIX_ACCESS_TOKEN = os.getenv("MATRIX_ACCESS_TOKEN")
    MATRIX_BOT_USERNAME = os.getenv("MATRIX_BOT_USERNAME")
    MATRIX_BOT_DISPLAY_NAME = os.getenv("MATRIX_BOT_DISPLAY_NAME")
    MATRIX_DEFAULT_ROOM_ID = os.getenv("MATRIX_DEFAULT_ROOM_ID")
    MATRIX_WELCOME_ROOM_ID = os.getenv("MATRIX_WELCOME_ROOM_ID")
    MATRIX_ROOM_IDS_NAME_CATEGORY = os.getenv("MATRIX_ROOM_IDS_NAME_CATEGORY")
    
    @classmethod
    def get_matrix_rooms(cls):
        """
        Parse the MATRIX_ROOM_IDS_NAME_CATEGORY environment variable and return a list of room dictionaries.
        Format: name|category|room_id separated by semicolons or newlines
        Categories can be comma-separated for multiple categories
        """
        rooms_str = cls.MATRIX_ROOM_IDS_NAME_CATEGORY or ""
        rooms = []
        
        # Handle both semicolon-separated and newline-separated formats
        if ";" in rooms_str:
            room_entries = rooms_str.split(";")
        else:
            room_entries = rooms_str.splitlines()
        
        for entry in room_entries:
            entry = entry.strip()
            if not entry:
                continue
            
            # Remove any leading pipe character that might be present
            if entry.startswith("|"):
                entry = entry[1:]
            
            parts = entry.split("|")
            if len(parts) >= 3:
                name = parts[0].strip()
                # Handle multiple categories separated by commas
                categories_str = parts[1].strip()
                categories = [cat.strip() for cat in categories_str.split(",")]
                room_id = parts[2].strip()
                
                rooms.append({
                    "name": name,
                    "category": categories_str,  # Keep the original string for backward compatibility
                    "categories": categories,    # Add a new field with the list of categories
                    "room_id": room_id
                })
            else:
                logging.warning(f"Invalid room entry format: {entry}")
        
        return rooms
    
    @classmethod
    def get_matrix_rooms_by_category(cls, category):
        """
        Get Matrix rooms filtered by category.
        
        Args:
            category: The category to filter by
            
        Returns:
            List[Dict]: A list of room dictionaries matching the category
        """
        if not cls.MATRIX_ACTIVE:
            return []
            
        rooms = cls.get_matrix_rooms()
        return [room for room in rooms if room.get("category", "").lower() == category.lower()]
    
    @classmethod
    def get_matrix_room_categories(cls):
        """
        Get all unique Matrix room categories.
        
        Returns:
            List[str]: A list of unique category names
        """
        if not cls.MATRIX_ACTIVE:
            return []
            
        rooms = cls.get_matrix_rooms()
        categories = set(room.get("category", "") for room in rooms if "category" in room)
        return sorted(list(categories))
    
    @classmethod
    def get_all_matrix_rooms(cls):
        """
        Get all Matrix rooms, including both configured rooms and rooms the bot has access to.
        
        Returns:
            List[Dict]: Combined list of rooms with configuration data when available
        """
        from utils.matrix_actions import merge_room_data
        return merge_room_data()
    
    # Validate critical configurations
    required_vars = {
        "AUTHENTIK_API_TOKEN": AUTHENTIK_API_TOKEN,
        "MAIN_GROUP_ID": MAIN_GROUP_ID,
        "BASE_DOMAIN": BASE_DOMAIN,
        "FLOW_ID": FLOW_ID,
        "INVITE_FLOW_ID": INVITE_FLOW_ID,
        "INVITE_LABEL": INVITE_LABEL,
        "SHLINK_API_TOKEN": SHLINK_API_TOKEN,
        "SHLINK_URL": SHLINK_URL,
        "SHLINK_ACTIVE": SHLINK_ACTIVE,
        "AUTHENTIK_API_URL": AUTHENTIK_API_URL,
        "WEBHOOK_URL": WEBHOOK_URL,
        "WEBHOOK_SECRET": WEBHOOK_SECRET,
        "DATABASE_URL": DATABASE_URL,
        "OPENAI_API_KEY": OPENAI_API_KEY,
        "SMTP_SERVER": SMTP_SERVER,
        "SMTP_PORT": SMTP_PORT,
        "SMTP_USER": SMTP_USER,
        "SMTP_PASSWORD": SMTP_PASSWORD,
        "SMTP_FROM": SMTP_FROM,
        "SMTP_BCC": SMTP_BCC,
        "SMTP_ACTIVE": SMTP_ACTIVE,
        "DISCOURSE_URL": DISCOURSE_URL,
        "DISCOURSE_CATEGORY_ID": DISCOURSE_CATEGORY_ID,
        "DISCOURSE_INTRO_TAG": DISCOURSE_INTRO_TAG,
        "DISCOURSE_API_KEY": DISCOURSE_API_KEY,
        "DISCOURSE_API_USERNAME": DISCOURSE_API_USERNAME,
        "DISCOURSE_ACTIVE": DISCOURSE_ACTIVE,
        "MATRIX_ACTIVE": MATRIX_ACTIVE,
        "MATRIX_URL": MATRIX_URL,
        "MATRIX_ACCESS_TOKEN": MATRIX_ACCESS_TOKEN,
        "MATRIX_BOT_USERNAME": MATRIX_BOT_USERNAME,
        "MATRIX_BOT_DISPLAY_NAME": MATRIX_BOT_DISPLAY_NAME,
        "MATRIX_DEFAULT_ROOM_ID": MATRIX_DEFAULT_ROOM_ID,
        "MATRIX_WELCOME_ROOM_ID": MATRIX_WELCOME_ROOM_ID,
        "WEBHOOK_ACTIVE": WEBHOOK_ACTIVE,
    }
    if DISCOURSE_URL:
        # check if DISCOURSE_URL ends with a slash or /api or nothing
        if DISCOURSE_URL.endswith('/'):
            DISCOURSE_API_URL = f"{DISCOURSE_URL}api"
        elif DISCOURSE_URL.endswith('/api'):
            DISCOURSE_API_URL = DISCOURSE_URL
        else:
            DISCOURSE_API_URL = f"{DISCOURSE_URL}/api"
    # Check if MAIN_GROUP_ID is a valid UUID
    try:
        uuid.UUID(MAIN_GROUP_ID)
    except ValueError:
        raise ValueError(f"MAIN_GROUP_ID is not a valid UUID: {MAIN_GROUP_ID}")

    missing_vars = [var_name for var_name, var in required_vars.items() if var is None]
    if missing_vars:
        raise EnvironmentError(f"Missing required environment variables: {', '.join(missing_vars)}")

# Initialize Fernet outside the Config class
# Completely remove or comment out the following lines
# try:
#     fernet = Fernet(Config.ENCRYPTION_KEY)
# except Exception as e:
#     raise ValueError(f"Invalid ENCRYPTION_KEY: {e}")
