# ui/user_settings.py
import os
from dotenv import load_dotenv, set_key
import logging
import streamlit as st

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Determine the absolute path to the root directory
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../'))

# Path to the .env file
env_path = os.path.join(ROOT_DIR, '.env')

# Load environment variables from the .env file
load_dotenv(dotenv_path=env_path)

class LocalConfig:
    def __init__(self):
        self.AUTHENTIK_API_TOKEN = os.getenv("AUTHENTIK_API_TOKEN")
        self.MAIN_GROUP_ID = os.getenv("MAIN_GROUP_ID")
        self.BASE_DOMAIN = os.getenv("BASE_DOMAIN")
        self.FLOW_ID = os.getenv("FLOW_ID")
        self.LOCAL_DB = os.getenv("LOCAL_DB", "users.csv")
        self.SHLINK_API_TOKEN = os.getenv("SHLINK_API_TOKEN")
        self.SHLINK_URL = os.getenv("SHLINK_URL")
        self.AUTHENTIK_API_URL = os.getenv("AUTHENTIK_API_URL")
        self.PAGE_TITLE = os.getenv("PAGE_TITLE", "Authentik Streamlit App")
        self.FAVICON_URL = os.getenv("FAVICON_URL", "default_favicon.ico")
        self.WEBHOOK_URL = os.getenv("WEBHOOK_URL")
        self.WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET")
        self.WEBHOOK_ENABLED = os.getenv("WEBHOOK_ENABLED", "true").lower() == "true"
        self.INDIVIDUAL_WEBHOOKS = {
            "user_created": os.getenv("WEBHOOK_USER_CREATED", "true").lower() == "true",
            "password_reset": os.getenv("WEBHOOK_PASSWORD_RESET", "true").lower() == "true",
        }
        self.ENCRYPTION_PASSWORD = os.getenv("ENCRYPTION_PASSWORD", "****")

        # Validate critical configurations
        self.validate_config()

    def validate_config(self):
        required_vars = {
            "AUTHENTIK_API_TOKEN": self.AUTHENTIK_API_TOKEN,
            "MAIN_GROUP_ID": self.MAIN_GROUP_ID,
            "BASE_DOMAIN": self.BASE_DOMAIN,
            "FLOW_ID": self.FLOW_ID,
            "LOCAL_DB": self.LOCAL_DB,
            "SHLINK_API_TOKEN": self.SHLINK_API_TOKEN,
            "SHLINK_URL": self.SHLINK_URL,
            "AUTHENTIK_API_URL": self.AUTHENTIK_API_URL,
            "WEBHOOK_URL": self.WEBHOOK_URL,
            "WEBHOOK_SECRET": self.WEBHOOK_SECRET
        }
        
        missing_vars = [var_name for var_name, var in required_vars.items() if var is None]
        if missing_vars:
            raise EnvironmentError(f"Missing required environment variables: {', '.join(missing_vars)}")

# Instantiate the LocalConfig class
Config = LocalConfig()

def save_settings(
    webhook_enabled, user_created_webhook, password_reset_webhook, selected_theme, shlink_url,
    auth0_domain, auth0_callback_url, auth0_authorize_url, auth0_token_url, authentik_api_url,
    webhook_url, authentik_api_token, shlink_api_token, main_group_id, flow_id, encryption_password, webhook_secret
):
    # Update environment variables in memory
    os.environ["WEBHOOK_ENABLED"] = str(webhook_enabled).lower()
    os.environ["WEBHOOK_USER_CREATED"] = str(user_created_webhook).lower()
    os.environ["WEBHOOK_PASSWORD_RESET"] = str(password_reset_webhook).lower()
    os.environ["SHLINK_URL"] = shlink_url
    os.environ["AUTH0_DOMAIN"] = auth0_domain
    os.environ["AUTH0_CALLBACK_URL"] = auth0_callback_url
    os.environ["AUTH0_AUTHORIZE_URL"] = auth0_authorize_url
    os.environ["AUTH0_TOKEN_URL"] = auth0_token_url
    os.environ["AUTHENTIK_API_URL"] = authentik_api_url
    os.environ["WEBHOOK_URL"] = webhook_url
    os.environ["AUTHENTIK_API_TOKEN"] = authentik_api_token if authentik_api_token != "****" else os.environ.get("AUTHENTIK_API_TOKEN", "")
    os.environ["SHLINK_API_TOKEN"] = shlink_api_token if shlink_api_token != "****" else os.environ.get("SHLINK_API_TOKEN", "")
    os.environ["MAIN_GROUP_ID"] = main_group_id
    os.environ["FLOW_ID"] = flow_id
    os.environ["ENCRYPTION_PASSWORD"] = encryption_password if encryption_password != "****" else os.environ.get("ENCRYPTION_PASSWORD", "")
    os.environ["WEBHOOK_SECRET"] = webhook_secret if webhook_secret != "****" else os.environ.get("WEBHOOK_SECRET", "")
    os.environ["STREAMLIT_THEME"] = selected_theme

    # Persist changes to the .env file
    set_key(env_path, "WEBHOOK_ENABLED", os.environ["WEBHOOK_ENABLED"])
    set_key(env_path, "WEBHOOK_USER_CREATED", os.environ["WEBHOOK_USER_CREATED"])
    set_key(env_path, "WEBHOOK_PASSWORD_RESET", os.environ["WEBHOOK_PASSWORD_RESET"])
    set_key(env_path, "SHLINK_URL", os.environ["SHLINK_URL"])
    set_key(env_path, "AUTH0_DOMAIN", os.environ["AUTH0_DOMAIN"])
    set_key(env_path, "AUTH0_CALLBACK_URL", os.environ["AUTH0_CALLBACK_URL"])
    set_key(env_path, "AUTH0_AUTHORIZE_URL", os.environ["AUTH0_AUTHORIZE_URL"])
    set_key(env_path, "AUTH0_TOKEN_URL", os.environ["AUTH0_TOKEN_URL"])
    set_key(env_path, "AUTHENTIK_API_URL", os.environ["AUTHENTIK_API_URL"])
    set_key(env_path, "WEBHOOK_URL", os.environ["WEBHOOK_URL"])
    set_key(env_path, "AUTHENTIK_API_TOKEN", os.environ["AUTHENTIK_API_TOKEN"])
    set_key(env_path, "SHLINK_API_TOKEN", os.environ["SHLINK_API_TOKEN"])
    set_key(env_path, "MAIN_GROUP_ID", os.environ["MAIN_GROUP_ID"])
    set_key(env_path, "FLOW_ID", os.environ["FLOW_ID"])
    set_key(env_path, "ENCRYPTION_PASSWORD", os.environ["ENCRYPTION_PASSWORD"])
    set_key(env_path, "WEBHOOK_SECRET", os.environ["WEBHOOK_SECRET"])
    set_key(env_path, "STREAMLIT_THEME", os.environ["STREAMLIT_THEME"])

def display_settings():
    st.title("Automation Settings")

    # Group settings into expandable sections
    with st.expander("Webhook Settings"):
        webhook_enabled = st.checkbox("Enable Webhooks", value=Config.WEBHOOK_ENABLED)
        user_created_webhook = st.checkbox("User Created Webhook", value=Config.INDIVIDUAL_WEBHOOKS["user_created"])
        password_reset_webhook = st.checkbox("Password Reset Webhook", value=Config.INDIVIDUAL_WEBHOOKS["password_reset"])
        webhook_url = st.text_input("Webhook URL", value=Config.WEBHOOK_URL or "")
        webhook_secret = st.text_input("Webhook Secret", value="****" if Config.WEBHOOK_SECRET else "", type="password")

    with st.expander("Environment Variables"):
        theme_options = ["light", "dark", "auto"]
        current_theme = os.getenv("STREAMLIT_THEME", "auto")
        selected_theme = st.selectbox("Color Theme", options=theme_options, index=theme_options.index(current_theme))
        auth0_domain = st.text_input("Auth0 Domain", value=os.getenv("AUTH0_DOMAIN", ""))
        auth0_callback_url = st.text_input("Auth0 Callback URL", value=os.getenv("AUTH0_CALLBACK_URL", ""))
        auth0_authorize_url = st.text_input("Auth0 Authorize URL", value=os.getenv("AUTH0_AUTHORIZE_URL", ""))
        auth0_token_url = st.text_input("Auth0 Token URL", value=os.getenv("AUTH0_TOKEN_URL", ""))
        authentik_api_url = st.text_input("Authentik API URL", value=Config.AUTHENTIK_API_URL or "")
        authentik_api_token = st.text_input("Authentik API Token", value="****" if Config.AUTHENTIK_API_TOKEN else "", type="password")
        shlink_url = st.text_input("Shlink URL", value=Config.SHLINK_URL or "")
        shlink_api_token = st.text_input("Shlink API Token", value="****" if Config.SHLINK_API_TOKEN else "", type="password")
        main_group_id = st.text_input("Main Group ID", value=Config.MAIN_GROUP_ID or "")
        flow_id = st.text_input("Flow ID", value=Config.FLOW_ID or "")
        encryption_password = st.text_input("Encryption Password", value="****" if Config.ENCRYPTION_PASSWORD else "", type="password")

    if st.button("Save Settings"):
        logger.info("Saving settings...")
        logger.debug(f"Webhook Enabled: {webhook_enabled}")
        logger.debug(f"User Created Webhook: {user_created_webhook}")
        logger.debug(f"Password Reset Webhook: {password_reset_webhook}")
        # ... add more debug logs for other variables ...

        save_settings(
            webhook_enabled, user_created_webhook, password_reset_webhook, selected_theme, shlink_url,
            auth0_domain, auth0_callback_url, auth0_authorize_url, auth0_token_url, authentik_api_url,
            webhook_url, authentik_api_token, shlink_api_token, main_group_id, flow_id, encryption_password, webhook_secret
        )
        st.success("Settings saved successfully!")