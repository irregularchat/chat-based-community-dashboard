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
    AUTHENTIK_API_URL = os.getenv("AUTHENTIK_API_URL")
    PAGE_TITLE = os.getenv("PAGE_TITLE", "Authentik Streamlit App")
    FAVICON_URL = os.getenv("FAVICON_URL", "default_favicon.ico")
    WEBHOOK_URL = os.getenv("WEBHOOK_URL")
    WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET")
    DATABASE_URL = os.getenv("DATABASE_URL")
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
    SMTP_SERVER = os.getenv("SMTP_SERVER")
    SMTP_PORT = os.getenv("SMTP_PORT")
    SMTP_USER = os.getenv("SMTP_USER")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
    SMTP_FROM = os.getenv("SMTP_FROM")
    SMTP_BCC = os.getenv("SMTP_BCC")
    
    # Discourse integration (optional)
    DISCOURSE_URL = os.getenv("DISCOURSE_URL")
    DISCOURSE_CATEGORY_ID = os.getenv("DISCOURSE_CATEGORY_ID")
    DISCOURSE_INTRO_TAG = os.getenv("DISCOURSE_INTRO_TAG", "introductions")
    DISCOURSE_API_KEY = os.getenv("DISCOURSE_API_KEY")
    DISCOURSE_API_USERNAME = os.getenv("DISCOURSE_API_USERNAME")
    
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
        "AUTHENTIK_API_URL": AUTHENTIK_API_URL,
        "WEBHOOK_URL": WEBHOOK_URL,
        "DATABASE_URL": DATABASE_URL,
        "OPENAI_API_KEY": OPENAI_API_KEY,
        "SMTP_SERVER": SMTP_SERVER,
        "SMTP_PORT": SMTP_PORT,
        "SMTP_USER": SMTP_USER,
        "SMTP_PASSWORD": SMTP_PASSWORD,
        "SMTP_FROM": SMTP_FROM,
        "SMTP_BCC": SMTP_BCC,
        "DISCOURSE_URL": DISCOURSE_URL,
        "DISCOURSE_CATEGORY_ID": DISCOURSE_CATEGORY_ID,
        "DISCOURSE_INTRO_TAG": DISCOURSE_INTRO_TAG,
        "DISCOURSE_API_KEY": DISCOURSE_API_KEY,
        "DISCOURSE_API_USERNAME": DISCOURSE_API_USERNAME,
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
