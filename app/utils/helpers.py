# utils/helpers.py
import logging
import streamlit as st
from pytz import timezone  
from datetime import datetime
from db.operations import search_users, add_admin_event
from db.database import get_db
from sqlalchemy.orm import Session

def setup_logging():
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler("app.log")
        ]
    )

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

def add_timeline_event(db: Session, event_type: str, username: str, event_description: str):
    """
    Add an event to the timeline of database events that will show user creations, 
    user verifications (email verification or manual verification), user deletions, etc.
    
    Args:
        db: Database session
        event_type: Type of event (e.g., 'user_created', 'user_verified', 'user_deleted')
        username: Username associated with the event
        event_description: Detailed description of the event
    """
    timestamp = datetime.now()
    return add_admin_event(db, event_type, username, event_description, timestamp)

def create_unique_username(db, desired_username):
    # Query the database for usernames that start with the desired username
    existing_users = search_users(db, desired_username)
    existing_usernames = [user.username for user in existing_users]
    
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