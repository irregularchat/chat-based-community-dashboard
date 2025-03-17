# app/utils/config.py
import os
from dotenv import load_dotenv
import logging
import uuid
from typing import List, Optional

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
    SMTP_USERNAME = os.getenv("SMTP_USERNAME")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
    SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL")
    SMTP_BCC = os.getenv("SMTP_BCC")
    SMTP_ACTIVE = os.getenv("SMTP_ACTIVE", "False").lower() == "true"
    
    # Discourse integration (optional)
    DISCOURSE_URL = os.getenv("DISCOURSE_URL")
    DISCOURSE_CATEGORY_ID = os.getenv("DISCOURSE_CATEGORY_ID")
    DISCOURSE_INTRO_TAG = os.getenv("DISCOURSE_INTRO_TAG", "introductions")
    DISCOURSE_API_KEY = os.getenv("DISCOURSE_API_KEY")
    DISCOURSE_API_USERNAME = os.getenv("DISCOURSE_API_USERNAME")
    DISCOURSE_ACTIVE = os.getenv("DISCOURSE_ACTIVE", "False").lower() == "true"
    DISCOURSE_WEBHOOK_SECRET = os.getenv("DISCOURSE_WEBHOOK_SECRET")
    
    # Matrix integration (optional)
    MATRIX_ACTIVE = os.getenv("MATRIX_ACTIVE", "False").lower() == "true"
    MATRIX_HOMESERVER_URL = os.getenv("MATRIX_HOMESERVER_URL")
    MATRIX_USER_ID = os.getenv("MATRIX_USER_ID")
    MATRIX_ACCESS_TOKEN = os.getenv("MATRIX_ACCESS_TOKEN")
    MATRIX_ROOM_ID = os.getenv("MATRIX_ROOM_ID")
    MATRIX_BOT_USERNAME = os.getenv("MATRIX_BOT_USERNAME")
    MATRIX_BOT_DISPLAY_NAME = os.getenv("MATRIX_BOT_DISPLAY_NAME")
    MATRIX_DEFAULT_ROOM_ID = os.getenv("MATRIX_DEFAULT_ROOM_ID")
    MATRIX_WELCOME_ROOM_ID = os.getenv("MATRIX_WELCOME_ROOM_ID")
    MATRIX_ROOM_IDS_NAME_CATEGORY = os.getenv("MATRIX_ROOM_IDS_NAME_CATEGORY")
    
    # Application configuration
    DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'
    SECRET_KEY = os.getenv('SECRET_KEY', 'your-secret-key-here')
    
    # Logging configuration
    LOG_LEVEL = os.getenv('LOG_LEVEL', 'INFO')
    LOG_FILE = os.getenv('LOG_FILE', 'app.log')
    
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
    
    @classmethod
    def get_required_vars(cls) -> List[str]:
        """Get a list of required environment variables."""
        required_vars = []
        
        # Only check Matrix variables if Matrix integration is active
        if cls.MATRIX_ACTIVE:
            if not cls.MATRIX_HOMESERVER_URL:
                required_vars.append("MATRIX_HOMESERVER_URL")
            if not cls.MATRIX_USER_ID:
                required_vars.append("MATRIX_USER_ID")
            if not cls.MATRIX_ROOM_ID:
                required_vars.append("MATRIX_ROOM_ID")
        
        # Only check Discourse variables if Discourse integration is active
        if cls.DISCOURSE_ACTIVE:
            if not cls.DISCOURSE_URL:
                required_vars.append("DISCOURSE_URL")
            if not cls.DISCOURSE_API_KEY:
                required_vars.append("DISCOURSE_API_KEY")
            if not cls.DISCOURSE_API_USERNAME:
                required_vars.append("DISCOURSE_API_USERNAME")
        
        return required_vars
    
    @classmethod
    def validate(cls):
        """Validate the configuration."""
        missing_vars = cls.get_required_vars()
        if missing_vars:
            raise EnvironmentError(f"Missing required environment variables: {', '.join(missing_vars)}")
    
    @classmethod
    def to_dict(cls):
        """Convert configuration to dictionary."""
        return {
          "DATABASE_URL": cls.DATABASE_URL,
          "WEBHOOK_SECRET": cls.WEBHOOK_SECRET,
          "WEBHOOK_ACTIVE": cls.WEBHOOK_ACTIVE,
          "OPENAI_API_KEY": cls.OPENAI_API_KEY,
          "SMTP_SERVER": cls.SMTP_SERVER,
          "SMTP_PORT": cls.SMTP_PORT,
          "SMTP_USERNAME": cls.SMTP_USERNAME,
          "SMTP_PASSWORD": cls.SMTP_PASSWORD,
          "SMTP_FROM_EMAIL": cls.SMTP_FROM_EMAIL,
          "DISCOURSE_URL": cls.DISCOURSE_URL,
          "DISCOURSE_API_KEY": cls.DISCOURSE_API_KEY,
          "DISCOURSE_API_USERNAME": cls.DISCOURSE_API_USERNAME,
          "DISCOURSE_WEBHOOK_SECRET": cls.DISCOURSE_WEBHOOK_SECRET,
          "DISCOURSE_ACTIVE": cls.DISCOURSE_ACTIVE,
          "MATRIX_ACTIVE": cls.MATRIX_ACTIVE,
          "MATRIX_HOMESERVER_URL": cls.MATRIX_HOMESERVER_URL,
          "MATRIX_USER_ID": cls.MATRIX_USER_ID,
          "MATRIX_ACCESS_TOKEN": cls.MATRIX_ACCESS_TOKEN,
          "MATRIX_ROOM_ID": cls.MATRIX_ROOM_ID,
          "MATRIX_BOT_USERNAME": cls.MATRIX_BOT_USERNAME,
          "MATRIX_BOT_DISPLAY_NAME": cls.MATRIX_BOT_DISPLAY_NAME,
          "MATRIX_DEFAULT_ROOM_ID": cls.MATRIX_DEFAULT_ROOM_ID,
          "MATRIX_WELCOME_ROOM_ID": cls.MATRIX_WELCOME_ROOM_ID,
          "WEBHOOK_ACTIVE": cls.WEBHOOK_ACTIVE,
          "DEBUG": cls.DEBUG,
          "SECRET_KEY": cls.SECRET_KEY,
          "LOG_LEVEL": cls.LOG_LEVEL,
          "LOG_FILE": cls.LOG_FILE,
        }
        if cls.DISCOURSE_URL:
            return {k: v for k, v in vars(cls).items() if not k.startswith('_')}

# Initialize Fernet outside the Config class
# Completely remove or comment out the following lines
# try:
#     fernet = Fernet(Config.ENCRYPTION_KEY)
# except Exception as e:
#     raise ValueError(f"Invalid ENCRYPTION_KEY: {e}")
