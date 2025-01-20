# utils/helpers.py
import pandas as pd
import os
from utils.config import Config
import logging
from auth.api import list_users_cached
# from auth.encryption import encrypt_data, decrypt_data
from io import StringIO
import streamlit as st
from pytz import timezone  
from datetime import datetime
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

def search_LOCAL_DB(search_term):
    try:
        # Load the local database
        df = pd.read_csv(Config.LOCAL_DB)
        
        if search_term:
            search_term = search_term.lower()
            
            # Create a mask for each column we want to search
            masks = []
            
            # Search in standard columns
            searchable_columns = ['username', 'name', 'email']
            for col in searchable_columns:
                if col in df.columns:
                    masks.append(df[col].astype(str).str.lower().str.contains(search_term, na=False))
            
            # Search in attributes
            if 'attributes' in df.columns:
                # Convert attributes to string and search within it
                # This will search through all attribute values
                attributes_mask = df['attributes'].apply(
                    lambda x: search_term in str(x).lower() if pd.notnull(x) else False
                )
                masks.append(attributes_mask)
            
            # Combine all masks with OR operation
            if masks:
                final_mask = pd.concat(masks, axis=1).any(axis=1)
                return df[final_mask]
            
        return df
    except Exception as e:
        logging.error(f"Error searching LOCAL_DB: {e}")
        return pd.DataFrame()

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
def update_username():
    # Retrieve and clean first and last name inputs
    first_name = st.session_state.get('first_name_input', '').strip().lower()
    last_name = st.session_state.get('last_name_input', '').strip().lower()
    
    # Construct base username based on available inputs
    if first_name and last_name:
        base_username = f"{first_name}-{last_name[0]}"
    elif first_name:
        base_username = first_name
    elif last_name:
        base_username = last_name
    else:
        base_username = "pending"
    
    # Replace spaces with hyphens and update session state
    st.session_state['username_input'] = base_username.replace(" ", "-")

def create_unique_username(desired_username):
    existing_usernames = get_existing_usernames()
    if desired_username not in existing_usernames:
        return desired_username
    else:
        suffix = 1
        while f"{desired_username}{suffix}" in existing_usernames:
            suffix += 1
        return f"{desired_username}{suffix}"


def get_eastern_time(expires_date, expires_time):
    # Combine date and time
    local_time = datetime.combine(expires_date, expires_time)
    
    # Define Eastern Time zone
    eastern = timezone('US/Eastern')
    
    # Localize the time to Eastern Time
    eastern_time = eastern.localize(local_time)
    
    return eastern_time