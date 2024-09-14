# app/utils/config.py
import os
from dotenv import load_dotenv
import logging

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
    LOCAL_DB = os.getenv("LOCAL_DB", "users.csv")
    # ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")  # Commented out
    SHLINK_API_TOKEN = os.getenv("SHLINK_API_TOKEN")
    SHLINK_URL = os.getenv("SHLINK_URL")
    AUTHENTIK_API_URL = os.getenv("AUTHENTIK_API_URL")
    PAGE_TITLE = os.getenv("PAGE_TITLE", "Authentik Streamlit App")
    FAVICON_URL = os.getenv("FAVICON_URL", "default_favicon.ico")

    # # Log loaded environment variables (mask sensitive data)
    # logger.info("Loaded Environment Variables:")
    # logger.info(f"AUTHENTIK_API_TOKEN: {'****' if AUTHENTIK_API_TOKEN else None}")
    # logger.info(f"MAIN_GROUP_ID: {MAIN_GROUP_ID}")
    # logger.info(f"BASE_DOMAIN: {BASE_DOMAIN}")
    # logger.info(f"FLOW_ID: {FLOW_ID}")
    # # logger.info(f"ENCRYPTION_KEY: {'****' if ENCRYPTION_KEY else None}")  # Commented out
    # logger.info(f"SHLINK_API_TOKEN: {'****' if SHLINK_API_TOKEN else None}")
    # logger.info(f"SHLINK_URL: {SHLINK_URL}")
    # logger.info(f"AUTHENTIK_API_URL: {AUTHENTIK_API_URL}")
    # logger.info(f"PAGE_TITLE: {PAGE_TITLE}")
    # logger.info(f"FAVICON_URL: {FAVICON_URL}")

    # Validate critical configurations
    required_vars = {
        "AUTHENTIK_API_TOKEN": AUTHENTIK_API_TOKEN,
        "MAIN_GROUP_ID": MAIN_GROUP_ID,
        "BASE_DOMAIN": BASE_DOMAIN,
        "FLOW_ID": FLOW_ID,
        # "ENCRYPTION_KEY": ENCRYPTION_KEY,  # Commented out
        "SHLINK_API_TOKEN": SHLINK_API_TOKEN,
        "SHLINK_URL": SHLINK_URL,
        "AUTHENTIK_API_URL": AUTHENTIK_API_URL
    }
    
    missing_vars = [var_name for var_name, var in required_vars.items() if var is None]
    if missing_vars:
        raise EnvironmentError(f"Missing required environment variables: {', '.join(missing_vars)}")

# Initialize Fernet outside the Config class
# Completely remove or comment out the following lines
# try:
#     fernet = Fernet(Config.ENCRYPTION_KEY)
# except Exception as e:
#     raise ValueError(f"Invalid ENCRYPTION_KEY: {e}")
