import streamlit as st
import logging
import re
from typing import Tuple, Optional
import asyncio

from app.db.session import get_db
from app.db.operations import update_signal_identity, get_signal_identity
from app.utils.matrix_actions import (
    send_welcome_message, 
    invite_user_to_rooms_by_interests,
    MATRIX_ACTIVE
)
from app.auth.auth_middleware import auth_middleware
from app.utils.config import Config
from app.db.models import User

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def validate_signal_identity(signal_identity: str) -> Tuple[bool, str]:
    """
    Validate the Signal identity input.
    
    Args:
        signal_identity (str): The Signal identity to validate
        
    Returns:
        Tuple[bool, str]: (is_valid, error_message)
    """
    if not signal_identity:
        return False, "Signal identity cannot be empty"
    
    # Remove any whitespace
    signal_identity = signal_identity.strip()
    
    # Check if it's a phone number (simple validation)
    phone_pattern = re.compile(r'^\+?[0-9]{10,15}$')
    
    # If it looks like a phone number, validate it more strictly
    if phone_pattern.match(signal_identity):
        # Ensure it starts with a + for international format
        if not signal_identity.startswith('+'):
            return False, "Phone numbers should include country code (e.g., +1234567890)"
    
    # If it's not a phone number, it should be at least 3 characters long
    elif len(signal_identity) < 3:
        return False, "Signal name should be at least 3 characters long"
    
    return True, ""

async def handle_matrix_actions(username: str, signal_identity: str, interests: list = None) -> Tuple[bool, str]:
    """
    Handle Matrix actions when a user updates their Signal identity.
    
    Args:
        username (str): The username of the user
        signal_identity (str): The user's Signal identity
        interests (list, optional): List of user interests for room invitations
        
    Returns:
        Tuple[bool, str]: (success, message)
    """
    if not MATRIX_ACTIVE:
        return False, "Matrix integration is not active. Cannot perform Matrix actions."
    
    try:
        # Get the Matrix user ID format
        matrix_user_id = f"@{username}:{Config.BASE_DOMAIN}" if Config.BASE_DOMAIN else f"@{username}:matrix.org"
        
        # Get the user's full name
        db = next(get_db())
        user = db.query(User).filter(User.username == username).first()
        full_name = f"{user.first_name} {user.last_name}" if user else username
        
        # Send welcome message
        welcome_success = send_welcome_message(matrix_user_id, username, full_name)
        
        # If no interests provided, try to extract from user attributes
        if not interests and user and user.attributes and 'intro' in user.attributes:
            intro = user.attributes.get('intro', '')
            if isinstance(intro, dict) and 'interests' in intro:
                interests = intro['interests'].split(',')
            elif isinstance(intro, str) and 'interests' in intro.lower():
                # Try to extract interests from the intro text
                interests_text = intro.lower().split('interests:')[-1].strip()
                interests = [i.strip() for i in interests_text.split(',')]
        
        # Default interests if none found
        if not interests:
            interests = ["general"]
        
        # Invite to rooms based on interests
        rooms_result = {}
        if interests:
            rooms_result = invite_user_to_rooms_by_interests(matrix_user_id, interests, username)
        
        # Determine success message
        if welcome_success:
            if rooms_result:
                successful_rooms = sum(1 for success in rooms_result.values() if success)
                return True, f"Welcome message sent and invited to {successful_rooms} rooms based on interests."
            else:
                return True, "Welcome message sent successfully."
        else:
            return False, "Failed to send welcome message."
            
    except Exception as e:
        logger.error(f"Error handling Matrix actions: {e}")
        return False, f"Error: {str(e)}"

@auth_middleware
def render_signal_association():
    """
    Render the Signal identity association UI component.
    """
    st.title("Signal Identity Association")
    
    # Get current username from session state
    username = st.session_state.get("username")
    if not username:
        st.error("You must be logged in to associate your Signal identity.")
        return
    
    # Get database connection
    db = next(get_db())
    
    # Get current Signal identity if any
    current_signal_identity = get_signal_identity(db, username)
    
    st.write("Associate your Signal identity with your account to receive Matrix messages and room invitations.")
    
    with st.form("signal_identity_form"):
        signal_identity = st.text_input(
            "Signal Name or Phone Number",
            value=current_signal_identity or "",
            help="Enter your Signal name or phone number (with country code, e.g., +1234567890)"
        )
        
        # Optional interests selection for room invitations
        st.write("Select your interests to be added to relevant Matrix rooms:")
        interests = st.multiselect(
            "Interests",
            options=["Technology", "AI", "Programming", "Security", "Hardware", "General"],
            default=["General"],
            help="Select your interests to be added to relevant Matrix rooms"
        )
        
        submit_button = st.form_submit_button("Save Signal Identity")
    
    if submit_button:
        # Validate input
        is_valid, error_message = validate_signal_identity(signal_identity)
        
        if not is_valid:
            st.error(error_message)
        else:
            # Update Signal identity in database
            success, is_new_association = update_signal_identity(db, username, signal_identity)
            
            if success:
                st.success("Signal identity updated successfully!")
                
                # If this is a new association, trigger Matrix actions
                if is_new_association:
                    with st.spinner("Setting up Matrix integration..."):
                        # Create a new event loop for the async call
                        loop = asyncio.new_event_loop()
                        asyncio.set_event_loop(loop)
                        
                        # Call the async function using the event loop
                        matrix_success, matrix_message = loop.run_until_complete(
                            handle_matrix_actions(username, signal_identity, interests)
                        )
                        
                        # Clean up the loop
                        loop.close()
                        
                        if matrix_success:
                            st.success(matrix_message)
                        else:
                            st.warning(f"Signal identity updated, but Matrix integration failed: {matrix_message}")
            else:
                st.error("Failed to update Signal identity. Please try again.")
    
    # Display current Signal identity if any
    if current_signal_identity:
        st.info(f"Your current Signal identity: {current_signal_identity}")
        
        # Option to remove Signal identity
        if st.button("Remove Signal Identity"):
            success, _ = update_signal_identity(db, username, "")
            if success:
                st.success("Signal identity removed successfully!")
                st.rerun()
            else:
                st.error("Failed to remove Signal identity. Please try again.")
