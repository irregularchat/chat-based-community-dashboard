# utils/helpers.py
import logging
import streamlit as st
from pytz import timezone  
from datetime import datetime, date, time as time_type
import time
from db.operations import search_users, add_admin_event, sync_user_data
from db.database import get_db
from sqlalchemy.orm import Session
from auth.api import (
    create_user,
    force_password_reset,
    update_user_status,
    update_user_email,
    update_user_intro,
    update_user_invited_by
)
from messages import (
    create_user_message,
    create_recovery_message,
    create_invite_message, 
    multi_recovery_message
)
from typing import Tuple, Optional, List

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

def handle_form_submission(action, username, email=None, invited_by=None, intro=None, verification_context=None):
    """
    Handle form submissions for user management actions.
    
    Args:
        action (str): The action to perform (e.g., "Create User", "Reset Password", etc.)
        username (str): The username to perform the action on
        email (str, optional): Email address for the user
        invited_by (str, optional): Who invited the user
        intro (str, optional): User's introduction/organization
        verification_context (str, optional): Context for safety number verification
    """
    try:
        db = next(get_db())
        
        if action == "Create User":
            # Get the full name from session state
            first_name = st.session_state.get('first_name_input', '')
            last_name = st.session_state.get('last_name_input', '')
            full_name = f"{first_name} {last_name}".strip()
            
            # Call create_user with correct parameters
            result, temp_password = create_user(
                username=username,
                full_name=full_name,
                email=email,
                invited_by=invited_by,
                intro=intro
            )
            
            if result:
                add_timeline_event(db, "user_created", username, f"User created by admin")
                create_user_message(username, temp_password)
                return True
                
        elif action == "Reset Password":
            # Handle password reset
            result = force_password_reset(username)
            if result:
                add_timeline_event(db, "password_reset", username, f"Password reset by admin")
                
        elif action in ["Activate", "Deactivate"]:
            # Handle activation/deactivation
            is_active = action == "Activate"
            result = update_user_status(username, is_active)
            if result:
                add_timeline_event(db, f"user_{action.lower()}", username, f"User {action.lower()}d by admin")
                
        elif action == "Safety Number Change Verified":
            # Handle safety number verification
            if verification_context:
                add_timeline_event(db, "safety_number_verified", username, verification_context)
                
        elif action == "Update Email":
            # Handle email update
            if email:
                result = update_user_email(username, email)
                if result:
                    add_timeline_event(db, "email_updated", username, f"Email updated to {email}")
                    
        elif action == "Add Intro":
            # Handle intro update
            if intro:
                result = update_user_intro(username, intro)
                if result:
                    add_timeline_event(db, "intro_updated", username, f"Intro updated")
                    
        elif action == "Add Invited By":
            # Handle invited by update
            if invited_by:
                result = update_user_invited_by(username, invited_by)
                if result:
                    add_timeline_event(db, "invited_by_updated", username, f"Invited by updated to {invited_by}")
        
        db.close()
        return True
        
    except Exception as e:
        logging.error(f"Error in handle_form_submission: {e}")
        return False