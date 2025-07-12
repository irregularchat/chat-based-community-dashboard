# app/utils/config.py
import os
import re
from dotenv import load_dotenv
import logging
import uuid
from typing import List, Optional
import traceback

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Determine the absolute path to the root directory
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../'))

# Path to the .env file
env_path = os.path.join(ROOT_DIR, '.env')

# Load environment variables from the .env file
load_dotenv(dotenv_path=env_path)
logger.info(f"Loaded environment from {env_path}")

def parse_database_url(url):
    """
    Parse a PostgreSQL database URL into its components.
    Returns a dictionary with host, port, user, password, dbname.
    """
    result = {}
    
    # Extract hostname
    host_match = re.search(r'@([^:/]+)[:/]', url)
    result['host'] = host_match.group(1) if host_match else None
    
    # Extract port
    port_match = re.search(r'@[^:]+:(\d+)', url)
    result['port'] = port_match.group(1) if port_match else '5432'
    
    # Extract username
    user_match = re.search(r'://([^:]+):', url)
    result['user'] = user_match.group(1) if user_match else None
    
    # Extract password (careful with logging this)
    pass_match = re.search(r'://[^:]+:([^@]+)@', url)
    result['password'] = pass_match.group(1) if pass_match else None
    
    # Extract database name
    db_match = re.search(r'[:/]([^:/]+)$', url)
    result['dbname'] = db_match.group(1) if db_match else None
    
    return result

# Initialize database URL handling
def get_database_url():
    """
    Build and return the correct DATABASE_URL based on environment variables.
    This function consolidates database URL logic to avoid duplication.
    """
    # If directly specified, use the environment DATABASE_URL
    if os.getenv("DATABASE_URL"):
        db_url = os.getenv("DATABASE_URL")
        try:
            components = parse_database_url(db_url)
            logger.info(f"Using DATABASE_URL from environment variables: {components['user']}:****@{components['host']}:{components['port']}/{components['dbname']}")
        except Exception as e:
            logger.warning(f"Error parsing DATABASE_URL: {str(e)}")
            # Log a masked version of the URL
            masked_url = db_url.split('@')[0].split(':')[0] + ':****@' + db_url.split('@')[1] if '@' in db_url else db_url
            logger.info(f"Using DATABASE_URL from environment variables: {masked_url}")
        return db_url
    
    # If in Docker, build URL with 'db' as host
    if os.getenv('IN_DOCKER') == 'true':
        db_host = os.getenv('DB_HOST', 'db')
        postgres_user = os.getenv('POSTGRES_USER', 'dashboarduser')
        postgres_password = os.getenv('POSTGRES_PASSWORD', 'password_for_db')
        postgres_db = os.getenv('POSTGRES_DB', 'dashboarddb')
        postgres_port = os.getenv('POSTGRES_PORT', '5432')
        
        db_url = f"postgresql://{postgres_user}:{postgres_password}@{db_host}:{postgres_port}/{postgres_db}"
        logger.info(f"Built Docker DATABASE_URL using host: {db_host}")
        return db_url
        
    # If not in Docker, build URL with localhost
    postgres_user = os.getenv('POSTGRES_USER', 'dashboarduser')
    postgres_password = os.getenv('POSTGRES_PASSWORD', 'password_for_db')
    postgres_db = os.getenv('POSTGRES_DB', 'dashboarddb')
    postgres_port = os.getenv('POSTGRES_PORT', '5432')
    
    db_url = f"postgresql://{postgres_user}:{postgres_password}@localhost:{postgres_port}/{postgres_db}"
    logger.info(f"Built local DATABASE_URL using localhost")
    return db_url

# Set DATABASE_URL in environment for other modules to use
if not os.getenv("DATABASE_URL") and os.getenv('IN_DOCKER') == 'true':
    db_url = get_database_url()
    os.environ['DATABASE_URL'] = db_url
    logger.info(f"Set DATABASE_URL in environment")

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
    DATABASE_URL = os.getenv("DATABASE_URL") or get_database_url()  # Use helper function if not set
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
    MATRIX_ENABLED = MATRIX_ACTIVE  # Add this alias for compatibility with create_user function
    MATRIX_HOMESERVER_URL = os.getenv("MATRIX_HOMESERVER_URL")
    MATRIX_USER_ID = os.getenv("MATRIX_USER_ID")
    MATRIX_ACCESS_TOKEN = os.getenv("MATRIX_ACCESS_TOKEN")
    MATRIX_ROOM_ID = os.getenv("MATRIX_ROOM_ID")
    MATRIX_BOT_USERNAME = os.getenv("MATRIX_BOT_USERNAME")
    MATRIX_BOT_DISPLAY_NAME = os.getenv("MATRIX_BOT_DISPLAY_NAME")
    MATRIX_DEFAULT_ROOM_ID = os.getenv("MATRIX_DEFAULT_ROOM_ID")
    MATRIX_WELCOME_ROOM_ID = os.getenv("MATRIX_WELCOME_ROOM_ID")
    MATRIX_SIGNAL_BRIDGE_ROOM_ID = os.getenv("MATRIX_SIGNAL_BRIDGE_ROOM_ID")
    MATRIX_ROOM_IDS_NAME_CATEGORY = os.getenv("MATRIX_ROOM_IDS_NAME_CATEGORY")
    MATRIX_MESSAGE_NOTICE = os.getenv("MATRIX_MESSAGE_NOTICE", "__NOREPLY: This message was sent from the admin dashboard__")
    
    # INDOC room removal configuration
    AUTO_REMOVE_FROM_INDOC = os.getenv("AUTO_REMOVE_FROM_INDOC", "True").lower() == "true"

    
    # Matrix cache configuration
    MATRIX_MIN_ROOM_MEMBERS = int(os.getenv("MATRIX_MIN_ROOM_MEMBERS", "5"))
    
    # Matrix Encryption and Security Keys (DISABLED)
    # MATRIX_SECURITY_KEY = os.getenv("MATRIX_SECURITY_KEY")
    # MATRIX_RECOVERY_PASSPHRASE = os.getenv("MATRIX_RECOVERY_PASSPHRASE")
    # MATRIX_STORE_PATH = os.getenv("MATRIX_STORE_PATH", "/app/matrix_store")
    
    # Authentik OIDC configuration
    OIDC_CLIENT_ID = os.getenv("OIDC_CLIENT_ID")
    OIDC_CLIENT_SECRET = os.getenv("OIDC_CLIENT_SECRET")
    OIDC_AUTHORIZATION_ENDPOINT = os.getenv("OIDC_AUTHORIZATION_ENDPOINT")
    OIDC_TOKEN_ENDPOINT = os.getenv("OIDC_TOKEN_ENDPOINT")
    OIDC_USERINFO_ENDPOINT = os.getenv("OIDC_USERINFO_ENDPOINT")
    OIDC_END_SESSION_ENDPOINT = os.getenv("OIDC_END_SESSION_ENDPOINT")
    OIDC_SCOPES = os.getenv("OIDC_SCOPES", "openid,profile,email").split(",")
    OIDC_REDIRECT_URI = os.getenv("OIDC_REDIRECT_URI")
    
    # Admin configuration
    ADMIN_USERNAMES = [username.strip() for username in os.getenv("ADMIN_USERNAMES", "").split(",") if username.strip()]
    
    # Default admin user credentials
    DEFAULT_ADMIN_USERNAME = os.getenv("DEFAULT_ADMIN_USERNAME", "adminuser")
    DEFAULT_ADMIN_PASSWORD = os.getenv("DEFAULT_ADMIN_PASSWORD", "Admin_Password123!")
    
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
        
        # Extract categories including both single categories and lists
        categories = set()
        for room in rooms:
            # Add the primary category string for backward compatibility
            if "category" in room and room["category"]:
                categories.add(room["category"].lower())
            
            # Add each individual category from the categories list
            if "categories" in room and isinstance(room["categories"], list):
                for category in room["categories"]:
                    if category:
                        categories.add(category.lower())
        
        # Ensure main categories always present
        main_categories = ["tech", "information & research", "miscellaneous", "locations"]
        for cat in main_categories:
            categories.add(cat.lower())
            
        return sorted(list(categories))
    
    @classmethod
    def get_all_matrix_rooms(cls):
        """
        Get all Matrix rooms, including both configured rooms and rooms the bot has access to.
        
        Returns:
            List[Dict]: Combined list of rooms with configuration data when available
        """
        from app.utils.matrix_actions import merge_room_data
        return merge_room_data()
    
    @classmethod
    def get_configured_categories(cls):
        """
        Get all configured categories from environment variables.
        
        Returns:
            Dict[str, Dict]: Dictionary mapping category names to their configuration
        """
        categories = {}
        
        # Find all CATEGORY_* environment variables
        for key, value in os.environ.items():
            if key.startswith('CATEGORY_') and value:
                category_id = key[9:]  # Remove 'CATEGORY_' prefix
                
                # Parse category configuration
                # Format: Display Name|keyword1,keyword2,keyword3
                parts = value.split('|')
                if len(parts) >= 2:
                    display_name = parts[0].strip()
                    keywords_str = parts[1].strip()
                    keywords = [kw.strip().lower() for kw in keywords_str.split(',') if kw.strip()]
                    
                    categories[category_id] = {
                        'display_name': display_name,
                        'keywords': keywords,
                        'id': category_id
                    }
                else:
                    logger.warning(f"Invalid category format in {key}: {value}")
        
        return categories
    
    @classmethod
    def get_configured_rooms(cls):
        """
        Get all configured rooms from environment variables using the new flexible system.
        
        Returns:
            List[Dict]: List of room dictionaries with name, categories, description, and room_id
        """
        rooms = []
        categories_config = cls.get_configured_categories()
        
        # Find all ROOM_* environment variables (excluding settings)
        excluded_room_vars = {
            'ROOM_RECOMMENDATIONS_ENABLED',
            'ROOM_CONFIG',
            'ROOM_SETTINGS'
        }
        
        for key, value in os.environ.items():
            if (key.startswith('ROOM_') and value and 
                not any(key.startswith(excluded) for excluded in excluded_room_vars)):
                room_id = key[5:]  # Remove 'ROOM_' prefix
                
                # Parse room configuration
                # Format: Room Name|Category Name(s)|Description|Matrix Room ID
                parts = value.split('|')
                if len(parts) >= 4:
                    name = parts[0].strip()
                    category_names_str = parts[1].strip()
                    description = parts[2].strip()
                    matrix_room_id = parts[3].strip()
                    
                    # Parse category names and resolve to full category info
                    category_names = [cat.strip() for cat in category_names_str.split(',')]
                    resolved_categories = []
                    all_keywords = set()
                    
                    for cat_name in category_names:
                        # Find matching category by display name
                        for cat_id, cat_config in categories_config.items():
                            if cat_config['display_name'].lower() == cat_name.lower():
                                resolved_categories.append(cat_config['display_name'])
                                all_keywords.update(cat_config['keywords'])
                                break
                        else:
                            # If no exact match, use the name as-is
                            resolved_categories.append(cat_name)
                    
                    rooms.append({
                        'name': name,
                        'categories': resolved_categories,
                        'category': ', '.join(resolved_categories),  # For backward compatibility
                        'category_keywords': list(all_keywords),  # Keywords from categories
                        'description': description,
                        'room_id': matrix_room_id,
                        'member_count': 0,  # Will be updated from cache if available
                        'is_direct': False,
                        'room_type': 'public',
                        'config_id': room_id  # For debugging
                    })
                else:
                    logger.warning(f"Invalid room entry format in {key}: {value}")
        
        return rooms
    
    @classmethod
    def get_interest_keyword_expansions(cls):
        """
        Get interest keyword expansions for better room matching.
        
        Returns:
            Dict[str, List[str]]: Dictionary mapping keywords to their synonyms
        """
        expansions_str = os.getenv('INTEREST_KEYWORD_EXPANSIONS', '')
        expansions = {}
        
        if expansions_str:
            # Parse format: keyword1:synonym1,synonym2,synonym3|keyword2:synonym1,synonym2
            keyword_groups = expansions_str.split('|')
            
            for group in keyword_groups:
                if ':' in group:
                    keyword, synonyms_str = group.split(':', 1)
                    keyword = keyword.strip().lower()
                    synonyms = [s.strip().lower() for s in synonyms_str.split(',') if s.strip()]
                    expansions[keyword] = synonyms
        
        return expansions
    
    @classmethod
    def get_room_recommendation_settings(cls):
        """
        Get room recommendation configuration settings.
        
        Returns:
            Dict: Dictionary with recommendation settings
        """
        return {
            'enabled': os.getenv('ROOM_RECOMMENDATIONS_ENABLED', 'True').lower() == 'true',
            'max_recommendations': int(os.getenv('MAX_ROOM_RECOMMENDATIONS', '5')),
            'min_score': float(os.getenv('MIN_RECOMMENDATION_SCORE', '0.3'))
        }
    
    @classmethod
    def is_admin(cls, username: str) -> bool:
        """
        Check if a username is in the admin list.
        
        Args:
            username (str): The username to check
            
        Returns:
            bool: True if the user is an admin, False otherwise
        """
        if not username:
            return False
        return username in cls.ADMIN_USERNAMES
    
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
            if not cls.MATRIX_ACCESS_TOKEN:
                required_vars.append("MATRIX_ACCESS_TOKEN")
            if not cls.MATRIX_ROOM_ID:
                required_vars.append("MATRIX_ROOM_ID")
            if not cls.MATRIX_BOT_USERNAME:
                required_vars.append("MATRIX_BOT_USERNAME")
        
        # Only check Discourse variables if Discourse integration is active
        if cls.DISCOURSE_ACTIVE:
            if not cls.DISCOURSE_URL:
                required_vars.append("DISCOURSE_URL")
            if not cls.DISCOURSE_API_KEY:
                required_vars.append("DISCOURSE_API_KEY")
            if not cls.DISCOURSE_API_USERNAME:
                required_vars.append("DISCOURSE_API_USERNAME")
            if not cls.DISCOURSE_CATEGORY_ID:
                required_vars.append("DISCOURSE_CATEGORY_ID")
        
        # Check database URL
        if not cls.DATABASE_URL:
            required_vars.append("DATABASE_URL")
        
        return required_vars
    
    @classmethod
    def validate(cls):
        """Validate the configuration."""
        missing_vars = cls.get_required_vars()
        if missing_vars:
            raise EnvironmentError(f"Missing required environment variables: {', '.join(missing_vars)}")
        
        # Additional validations
        if cls.MATRIX_ACTIVE:
            cls.validate_matrix_config()
        
        if cls.DISCOURSE_ACTIVE:
            cls.validate_discourse_config()
    
    @classmethod
    def validate_matrix_config(cls):
        """Validate the Matrix configuration."""
        # Check Matrix user ID format
        if cls.MATRIX_USER_ID and not cls.MATRIX_USER_ID.startswith('@'):
            logging.warning(f"MATRIX_USER_ID should start with '@', got: {cls.MATRIX_USER_ID}")
        
        # Check Matrix room ID format
        if cls.MATRIX_ROOM_ID and not cls.MATRIX_ROOM_ID.startswith('!'):
            logging.warning(f"MATRIX_ROOM_ID should start with '!', got: {cls.MATRIX_ROOM_ID}")
        
        # Validate room configuration format
        if cls.MATRIX_ROOM_IDS_NAME_CATEGORY:
            try:
                rooms = cls.get_matrix_rooms()
                if not rooms:
                    logging.warning("No Matrix rooms were parsed from configuration")
                else:
                    logging.info(f"Successfully parsed {len(rooms)} Matrix rooms")
                    
                    # Validate that all rooms have required fields
                    for i, room in enumerate(rooms):
                        if 'name' not in room or not room['name']:
                            logging.warning(f"Room at index {i} is missing a name")
                        if 'room_id' not in room or not room['room_id']:
                            logging.warning(f"Room {room.get('name', f'at index {i}')} is missing a room_id")
                        if ('category' not in room and 'categories' not in room) or (not room.get('category') and not room.get('categories')):
                            logging.warning(f"Room {room.get('name', f'at index {i}')} is missing category information")
                        
                        # Check room ID format
                        if 'room_id' in room and room['room_id'] and not room['room_id'].startswith('!'):
                            logging.warning(f"Room {room.get('name', f'at index {i}')} has an invalid room_id format: {room['room_id']}")
            except Exception as e:
                logging.error(f"Error validating Matrix room configuration: {e}")
                logging.error(traceback.format_exc())
                raise ValueError(f"Invalid Matrix room configuration: {str(e)}")
    
    @classmethod
    def validate_discourse_config(cls):
        """Validate the Discourse configuration."""
        if not cls.DISCOURSE_URL:
            logging.warning("DISCOURSE_URL is missing")
        if not cls.DISCOURSE_API_KEY:
            logging.warning("DISCOURSE_API_KEY is missing")
        if not cls.DISCOURSE_API_USERNAME:
            logging.warning("DISCOURSE_API_USERNAME is missing")
        if not cls.DISCOURSE_CATEGORY_ID:
            logging.warning("DISCOURSE_CATEGORY_ID is missing")
    
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
          "OIDC_CLIENT_ID": cls.OIDC_CLIENT_ID,
          "OIDC_AUTHORIZATION_ENDPOINT": cls.OIDC_AUTHORIZATION_ENDPOINT,
          "OIDC_TOKEN_ENDPOINT": cls.OIDC_TOKEN_ENDPOINT,
          "OIDC_USERINFO_ENDPOINT": cls.OIDC_USERINFO_ENDPOINT,
          "OIDC_END_SESSION_ENDPOINT": cls.OIDC_END_SESSION_ENDPOINT,
          "OIDC_REDIRECT_URI": cls.OIDC_REDIRECT_URI,
          "DEBUG": cls.DEBUG,
          "SECRET_KEY": cls.SECRET_KEY,
          "LOG_LEVEL": cls.LOG_LEVEL,
          "LOG_FILE": cls.LOG_FILE,
        }
        if cls.DISCOURSE_URL:
            return {k: v for k, v in vars(cls).items() if not k.startswith('_')}
    
    @classmethod
    def validate_oidc_config(cls):
        """Validate OIDC configuration and log debugging information."""
        valid = True
        logger.info("=== OIDC Configuration Validation ===")
        
        # Check OIDC client ID
        if not cls.OIDC_CLIENT_ID:
            logger.error("❌ OIDC_CLIENT_ID is missing")
            valid = False
        else:
            logger.info(f"✅ OIDC_CLIENT_ID is configured: {cls.OIDC_CLIENT_ID}")
            
        # Check OIDC client secret
        if not cls.OIDC_CLIENT_SECRET:
            logger.error("❌ OIDC_CLIENT_SECRET is missing")
            valid = False
        else:
            logger.info("✅ OIDC_CLIENT_SECRET is configured")
            
        # Check OIDC endpoints
        for endpoint_name, endpoint_value in [
            ('OIDC_AUTHORIZATION_ENDPOINT', cls.OIDC_AUTHORIZATION_ENDPOINT),
            ('OIDC_TOKEN_ENDPOINT', cls.OIDC_TOKEN_ENDPOINT),
            ('OIDC_USERINFO_ENDPOINT', cls.OIDC_USERINFO_ENDPOINT),
            ('OIDC_END_SESSION_ENDPOINT', cls.OIDC_END_SESSION_ENDPOINT),
        ]:
            if not endpoint_value:
                logger.error(f"❌ {endpoint_name} is missing")
                valid = False
            else:
                logger.info(f"✅ {endpoint_name} is configured: {endpoint_value}")
                
        # Check OIDC redirect URI
        if not cls.OIDC_REDIRECT_URI:
            logger.error("❌ OIDC_REDIRECT_URI is missing")
            valid = False
        else:
            logger.info(f"✅ OIDC_REDIRECT_URI is configured: {cls.OIDC_REDIRECT_URI}")
            
        # Check OIDC scopes
        if not cls.OIDC_SCOPES:
            logger.error("❌ OIDC_SCOPES is missing")
            valid = False
        else:
            logger.info(f"✅ OIDC_SCOPES is configured: {cls.OIDC_SCOPES}")
            
        logger.info(f"OIDC Configuration is {'valid' if valid else 'INVALID'}")
        return valid
    
    @classmethod
    def validate_room_categories(cls):
        """
        Validate that rooms are organized into the expected categories.
        
        Returns:
            bool: True if categories are valid, False otherwise
        """
        if not cls.MATRIX_ACTIVE:
            return True
            
        rooms = cls.get_matrix_rooms()
        categories = cls.get_matrix_room_categories()
        
        # Check that we have the main categories
        required_categories = ["tech", "information & research", "miscellaneous", "locations"]
        missing_categories = [cat for cat in required_categories 
                            if not any(existing.lower() == cat.lower() for existing in categories)]
        
        if missing_categories:
            logging.warning(f"Missing required room categories: {', '.join(missing_categories)}")
            return False
            
        # Check that each room has a valid category
        invalid_rooms = []
        for room in rooms:
            has_valid_category = False
            
            # Check primary category
            if "category" in room and room["category"]:
                room_category = room["category"].lower()
                if any(cat.lower() == room_category for cat in categories):
                    has_valid_category = True
            
            # Check categories list
            if "categories" in room and isinstance(room["categories"], list):
                for category in room["categories"]:
                    if category and any(cat.lower() == category.lower() for cat in categories):
                        has_valid_category = True
                        break
            
            if not has_valid_category:
                invalid_rooms.append(room.get("name", "Unnamed room"))
        
        if invalid_rooms:
            logging.warning(f"Rooms with invalid categories: {', '.join(invalid_rooms)}")
            return False
            
        return True

# Initialize Fernet outside the Config class
# Completely remove or comment out the following lines
# try:
#     fernet = Fernet(Config.ENCRYPTION_KEY)
# except Exception as e:
#     raise ValueError(f"Invalid ENCRYPTION_KEY: {e}")