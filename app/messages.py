"""
Messages module for IrregularChat community dashboard.

This module provides functions for generating welcome messages and invite messages for users.
"""
import logging
from datetime import datetime
import traceback

import streamlit as st
from pytz import timezone

from app.auth import generate_secure_passphrase
from app.auth.api import generate_recovery_link
from app.utils.matrix_actions import send_welcome_message_with_encryption_delay_sync, create_matrix_direct_chat_sync

# Set up logging
logger = logging.getLogger(__name__)

def create_invite_message(invite_link, expires_at):
    """
    Create an invite message with a link and expiration time.
    
    Args:
        invite_link: URL for the invite
        expires_at: Timestamp when the invite expires
        
    Returns:
        str: Formatted invite message
    """
    # Get timezone and format expiration time
    try:
        eastern = timezone('US/Eastern')
        expires_dt = datetime.fromtimestamp(expires_at).astimezone(eastern)
        expires_formatted = expires_dt.strftime('%A, %B %d at %I:%M %p %Z')
        logger.info("Formatted expiration time: %s", expires_formatted)
    except (ValueError, TypeError) as e:
        logger.error("Error formatting expiration time: %s", str(e))
        expires_formatted = "Unknown"

    # Create the invite message
    message = f"""
    🌟 Welcome to IrregularChat! 🌟

    You're invited to join our community. Please use the link below to create your account:

    {invite_link}

    This invite expires on {expires_formatted}.

    Looking forward to seeing you in the community!
    """
    return message

def create_user_message(new_username, temp_password=None, discourse_post_url=None, password_reset_successful=False):
    """
    Create a welcome message for a new user with login credentials and optional Discourse post URL.
    
    Args:
        new_username: The username of the new user
        temp_password: Temporary password for the user, None if password reset is needed
        discourse_post_url: URL to the user's Discourse introduction post
        password_reset_successful: Whether the password reset was successful
    
    Returns:
        str: Welcome message
    """
    # new_username is the final username that may have been incremented for uniqueness
    # This is passed from the create_user function and already has any numeric suffixes
    logger.info("Generating welcome message for user: %s", new_username)
    logger.info("Forum post URL: %s", discourse_post_url)
    
    # Special case for failed password reset
    if not temp_password:
        welcome_message = f"""
        🌟 User Created But Password Reset Failed 🌟
        
        Your account has been created. Please set your password using the steps below:
        
        Username: {new_username}
        
        To set your password:
        
        1️⃣ Go to https://sso.irregularchat.com/if/flow/password-reset/
        2️⃣ Enter the username: {new_username}
        3️⃣ Click "Reset Password" and follow the instructions
        
        For admin assistance, please contact the system administrator.
        """
        
        # Display message to admin
        st.code(welcome_message)
        st.session_state['message'] = welcome_message
        st.session_state['user_list'] = None  # Clear user list if there was any
        st.warning("User created but password reset failed. Manual reset required.")
    else:
        # Normal case with successful password reset
        welcome_message = f"""
        🌟 Your First Step Into the IrregularChat! 🌟
        You've just joined a community focused on breaking down silos, fostering innovation, 
        and supporting service members and veterans.
        ---
        Use This Username and Temporary Password ⬇️
        Username: {new_username}
        Temporary Password: {temp_password}
        Exactly as shown above 👆🏼

        1️⃣ Step 1:
        - Use the username and temporary password to log in to https://sso.irregularchat.com
        
        2️⃣ Step 2:
        - Update your email, important to be able to recover your account and verify your identity
        - Save your Login Username and New Password to a Password Manager
        - Visit the welcome page while logged in https://forum.irregularchat.com/t/84
        """

        # Add forum post URL to welcome message if available
        if discourse_post_url:
            welcome_message += f"""
        3️⃣ Step 3:
        - We posted an intro about you, but you can complete or customize it:
        {discourse_post_url}
        """
        
        welcome_message += """
        Please take a moment to learn about the community before you jump in.
        
        If you have any questions or need assistance, feel free to reach out to the community admins.
        
        Welcome aboard!
        """
        
        # Always display the welcome message to the admin in the UI
        st.code(welcome_message, language="")
        
        # Store the message in session state for later use
        st.session_state['welcome_message'] = welcome_message
        
        # Add a button to copy the message to clipboard
        if st.button("Copy Welcome Message to Clipboard"):
            try:
                import pyperclip
                pyperclip.copy(welcome_message)
                st.success("Welcome message copied to clipboard!")
                # Don't rerun or clear the welcome message
            except ImportError:
                st.info("Please copy the message manually using Ctrl+C or ⌘+C")
            
        # Add a button to directly send the welcome message to the Matrix user if one is selected
        if st.session_state.get('matrix_user_selected') and st.session_state.get('matrix_user_display_name'):
            matrix_user = st.session_state.get('matrix_user_display_name')
            if st.button(f"Send Welcome Message to {matrix_user}"):
                try:
                    # Log the attempt for debugging
                    logging.info(f"Attempting to send welcome message to {matrix_user} ({st.session_state.get('matrix_user_selected')})")
                    
                    # Send the message with encryption delay to ensure readability
                    success, room_id, event_id = send_welcome_message_with_encryption_delay_sync(
                        st.session_state.get('matrix_user_selected'),
                        welcome_message,
                        delay_seconds=5  # Standard delay for welcome messages
                    )
                    
                    if success:
                        st.success(f"Welcome message sent to {matrix_user}!")
                    else:
                        st.error(f"Failed to send welcome message to {matrix_user}")
                except Exception as e:
                    logging.error(f"Error sending welcome message: {str(e)}")
                    logging.error(traceback.format_exc())
                    st.error(f"Error sending welcome message: {str(e)}")
        
    return welcome_message

def create_recovery_message(username_input, new_password):
    """
    Generate and display the recovery message after generating a recovery link.
    
    Args:
        username_input: Username for recovery
        new_password: New password for the user
    
    Returns:
        None
    """
    recovery_message = f"""
    Account recovery Details
    **Username**: {username_input}
    **New Password**: {new_password}

    Use the credentials above to recover your account. Make sure you update your email address 
    after recovering your account so you can recover your account in the future.
    
    If you have any issues, please reach out to the admin team.
    Once Logged in, see all the chats and services: https://forum.irregularchat.com/t/84
    """
    st.code(recovery_message)
    st.session_state['message'] = recovery_message
    st.session_state['user_list'] = None  # Clear user list if there was any
    st.success("Recovery link generated successfully!")

def multi_recovery_message(user_list):
    """
    Generate and display recovery messages after resetting passwords for multiple users.
    
    Args:
        user_list: List of users with their details
    
    Returns:
        None
    """
    for user in user_list:
        username_input = user['username']
        new_password = generate_secure_passphrase()  # Assuming this function generates a secure password

        recovery_message = f"""
        Account recovery Details
        **Username**: {username_input}
        **New Password**: {new_password}

        Use the credentials above to recover your account. Make sure you update your email address 
        after recovering your account so you can recover your account in the future.
        
        If you have any issues, please reach out to the admin team.
        Once Logged in, see all the chats and services: https://forum.irregularchat.com/t/84
        """

        st.code(recovery_message)
        st.session_state['message'] = recovery_message
        st.success(f"Recovery link generated successfully for {username_input}!")

    st.session_state['user_list'] = None  # Clear user list if there was any

def create_user_summary(username, display_name, organization, email, interests_input, send_welcome=False):
    """
    Create a summary of the user creation details.
    
    Args:
        username: Username
        display_name: Display name
        organization: Organization
        email: Email address
        interests_input: User interests
        send_welcome: Whether to send welcome email
    
    Returns:
        str: User creation summary
    """
    return f"""
    📋 User Creation Summary:
    
    👤 Username: {username}
    📛 Name: {display_name}
    🏢 Organization: {organization}
    📧 Email: {email}
    🔍 Interests: {interests_input}
    📨 Send Welcome: {'Yes' if send_welcome else 'No'}
    """

def handle_passwordless_recovery(username_input):
    """
    Handle passwordless recovery for a user.
    
    Args:
        username_input: Username for recovery
    """
    st.warning("🔄 Generating recovery link...")
    
    # Generate a reset link
    reset_link = generate_recovery_link(username_input)
    
    if reset_link:
        recovery_message = f"""
        🔑 Recovery Link for {username_input}:
        
        {reset_link}
        
        The link will expire after use or after 1 hour.
        """
        
        st.code(recovery_message)
        st.session_state['message'] = recovery_message
        st.success(f"Recovery link generated successfully for {username_input}!")

    st.session_state['user_list'] = None  # Clear user list if there was any

def display_welcome_message_ui(welcome_message, forum_post_url=None):
    """
    Display a welcome message in the Streamlit UI with options for copying and sending.
    
    Args:
        welcome_message: The welcome message to display
        forum_post_url: URL to the user's forum post, if available
    """
    try:
        # Always store the welcome message in session state first for persistence
        st.session_state['current_welcome_message'] = welcome_message
        
        # Display the message in a code block with a border
        st.markdown("### Welcome Message")
        st.code(welcome_message, language="")
        
        # Store forum post URL if provided
        if forum_post_url:
            st.session_state['forum_post_url'] = forum_post_url
            st.markdown(f"[View forum post]({forum_post_url})")
        
        # Add a button to copy the message to clipboard
        col1, col2 = st.columns(2)
        with col1:
            if st.button("Copy Welcome Message to Clipboard", key="copy_welcome_btn"):
                try:
                    import pyperclip
                    pyperclip.copy(welcome_message)
                    st.success("Welcome message copied to clipboard!")
                except ImportError:
                    st.warning("Could not copy to clipboard. Please manually copy the message above.")
        
        # Add a button to directly send the welcome message to the Matrix user if one is selected
        with col2:
            if st.session_state.get('matrix_user_selected') and st.session_state.get('matrix_user_display_name'):
                matrix_user = st.session_state.get('matrix_user_display_name')
                if st.button(f"Send Welcome Message to {matrix_user}", key="send_welcome_btn"):
                    try:
                        # Log the attempt for debugging
                        logging.info(f"Attempting to send welcome message to {matrix_user} ({st.session_state.get('matrix_user_selected')})")
                        
                        # Send the message with encryption delay to ensure readability
                        success, room_id, event_id = send_welcome_message_with_encryption_delay_sync(
                            st.session_state.get('matrix_user_selected'),
                            welcome_message,
                            delay_seconds=5  # Standard delay for welcome messages
                        )
                        
                        if success:
                            st.success(f"Welcome message sent to {matrix_user}!")
                        else:
                            st.error(f"Failed to send welcome message to {matrix_user}")
                    except Exception as e:
                        logging.error(f"Error sending welcome message: {str(e)}")
                        logging.error(traceback.format_exc())
                        st.error(f"Error sending welcome message: {str(e)}")
    
    except Exception as e:
        logging.error(f"Error displaying welcome message UI: {str(e)}")
        logging.error(traceback.format_exc())
        st.error(f"Error displaying welcome message: {str(e)}")