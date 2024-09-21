# utils/helpers.py
import pandas as pd
import os
from utils.config import Config
import logging
from auth.api import list_users_cached
# from auth.encryption import encrypt_data, decrypt_data
from io import StringIO


def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler("app.log")
        ]
    )

def update_LOCAL_DB():
    try:
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        users = list_users_cached(Config.AUTHENTIK_API_URL, headers)
        if users:
            df = pd.DataFrame(users)
            csv_data = df.to_csv(index=False)
            # encrypted_data = encrypt_data(csv_data)
            # with open(Config.LOCAL_DB, 'w') as file:
            #     file.write(encrypted_data)
            with open(Config.LOCAL_DB, 'w') as file:
                file.write(csv_data)
            logging.info("Local DB updated successfully.")
        else:
            logging.warning("No users to update in Local DB.")
    except Exception as e:
        logging.error(f"Failed to update Local DB: {e}")


def load_LOCAL_DB():
    if not os.path.exists(Config.LOCAL_DB):
        update_LOCAL_DB()
    try:
        with open(Config.LOCAL_DB, 'r') as file:
            # encrypted_data = file.read()
            # decrypted_data = decrypt_data(encrypted_data)
            # df = pd.read_csv(StringIO(decrypted_data))
            # Load CSV directly without decryption
            csv_data = file.read()
            df = pd.read_csv(StringIO(csv_data))
        return df
    except Exception as e:
        logging.error(f"Error loading Local DB: {e}")
        return pd.DataFrame()  # Return empty DataFrame on failure

# def search_LOCAL_DB(query):
#     df = load_LOCAL_DB()
#     # Perform a case-insensitive search across multiple fields
#     mask = (
#         df['username'].str.contains(query, case=False, na=False) |
#         df['email'].str.contains(query, case=False, na=False) |
#         df['name'].str.contains(query, case=False, na=False) |
#         df['attributes'].astype(str).str.contains(query, case=False, na=False)
#     )
#     results = df[mask]
#     return results

def search_LOCAL_DB(query):
    df = load_LOCAL_DB()
    if df.empty:
        logging.warning("Local DB is empty.")
        return df

    if query:
        # Perform a case-insensitive search across multiple fields
        mask = (
            df['username'].str.contains(query, case=False, na=False) |
            df['email'].str.contains(query, case=False, na=False) |
            df['name'].str.contains(query, case=False, na=False) |
            df['attributes'].astype(str).str.contains(query, case=False, na=False)
        )
        results = df[mask]
    else:
        # If query is empty, return all users
        results = df

    return results

def get_existing_usernames():
    if os.path.exists(Config.LOCAL_DB):
        try:
            df = pd.read_csv(Config.LOCAL_DB)
            return df['username'].tolist()
        except Exception as e:
            logging.error(f"Error reading Local DB: {e}")
            return []
    else:
        logging.warning("Local DB does not exist.")
        return []

def create_unique_username(desired_username):
    existing_usernames = get_existing_usernames()
    if desired_username not in existing_usernames:
        return desired_username
    else:
        suffix = 1
        while f"{desired_username}{suffix}" in existing_usernames:
            suffix += 1
        return f"{desired_username}{suffix}"

