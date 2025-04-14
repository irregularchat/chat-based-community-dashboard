# app/messages.py
import streamlit as st
from app.auth import generate_secure_passphrase, force_password_reset, shorten_url
from app.auth.api import create_invite  # Keep this import for now
from pytz import timezone
from datetime import datetime
import logging
from app.utils.config import Config  # Fixed import path

def create_user_message(new_username, temp_password, discourse_post_url=None, password_reset_successful=True):
    """Generate and display the welcome message after user creation with temp password.
    
    Returns:
        str: The welcome message as a string
    """
    
    # new_username is the final username that may have been incremented for uniqueness
    # This is passed from the create_user function and already has any numeric suffixes
    logging.info(f"Generating welcome message for user: {new_username}")
    
    # Special case for failed password reset
    if not password_reset_successful or temp_password == "PASSWORD_NEEDS_RESET":
        welcome_message = f"""
        🌟 User Created But Password Reset Failed 🌟
        
        Username: {new_username}
        
        ⚠️ Important: The system was unable to set a password automatically.
        
        Please follow these steps:
        1️⃣ Go to https://sso.irregularchat.com/if/flow/password-reset/
        2️⃣ Enter the username: {new_username}
        3️⃣ Click "Reset Password" and follow the instructions
        
        For admin assistance, please contact the system administrator.
        """
        
        st.code(welcome_message)
        st.session_state['message'] = welcome_message
        st.session_state['user_list'] = None  # Clear user list if there was any
        st.warning("User created but password reset failed. Manual reset required.")
        
    else:
        # Normal case with successful password reset
        welcome_message = f"""
        🌟 Your First Step Into the IrregularChat! 🌟
        You've just joined a community focused on breaking down silos, fostering innovation, and supporting service members and veterans.
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
        
        # Add Discourse post URL if available
        if discourse_post_url:
            logging.info(f"Including discourse post URL in welcome message: {discourse_post_url}")
            welcome_message += f"""
        3️⃣ Step 3:
        - Check out your introduction post: {discourse_post_url}
        - Feel free to update it with more information about yourself!
            """
        else:
            logging.info("No discourse post URL available for welcome message")
        
        welcome_message += """
        Please take a moment to learn about the community before you jump in.
        """
        
        st.code(welcome_message)
        st.session_state['message'] = welcome_message
        st.session_state['user_list'] = None  # Clear user list if there was any
        st.success("User created successfully!")
    
    # Add buttons to control next actions - outside of any form
    col1, col2 = st.columns(2)
    with col1:
        if st.button("Clear Message", key="clear_message_btn"):
            # Clear message from session state
            if 'message' in st.session_state:
                del st.session_state['message']
            st.rerun()
    with col2:
        if st.button("Create Another User", key="create_another"):
            # Clear form fields and message
            if 'message' in st.session_state:
                del st.session_state['message']
            st.session_state['should_clear_form'] = True
            st.rerun()
            
    # Return the welcome message so it can be used by other functions
    return welcome_message


def create_recovery_message(username_input, new_password):
    """Generate and display the recovery message after generating a recovery link."""
    recovery_message = f"""
    Account recovery Details
    **Username**: {username_input}
    **New Password**: {new_password}

    Use the credentials above to recover your account. Make sure you update your email address after recovering your account so you can recover your account in the future.
    
    If you have any issues, please reach out to the admin team.
    Once Logged in, see all the chats and services: https://forum.irregularchat.com/t/84
    """
    st.code(recovery_message)
    st.session_state['message'] = recovery_message
    st.session_state['user_list'] = None  # Clear user list if there was any
    st.success("Recovery link generated successfully!")

def multi_recovery_message(user_list):
    """Generate and display recovery messages after resetting passwords for multiple users."""
    for user in user_list:
        username_input = user['username']
        new_password = generate_secure_passphrase()  # Assuming this function generates a secure password

        recovery_message = f"""
        Account recovery Details
        **Username**: {username_input}
        **New Password**: {new_password}

        Use the credentials above to recover your account. Make sure you update your email address after recovering your account so you can recover your account in the future.
        
        If you have any issues, please reach out to the admin team.
        Once Logged in, see all the chats and services: https://forum.irregularchat.com/t/84
        """

        st.code(recovery_message)
        st.session_state['message'] = recovery_message
        st.success(f"Recovery link generated successfully for {username_input}!")

    st.session_state['user_list'] = None  # Clear user list if there was any

def create_invite_message(label, invite_url, expires_datetime):
    """Generate and display the invite message."""
    if invite_url:
        eastern = timezone('US/Eastern')
        
        # Ensure both datetimes are timezone-aware in Eastern time
        if expires_datetime.tzinfo is None:
            expires_datetime = eastern.localize(expires_datetime)
        now = datetime.now(eastern)
        
        time_remaining = expires_datetime - now
        hours, remainder = divmod(int(time_remaining.total_seconds()), 3600)
        minutes, _ = divmod(remainder, 60)

        invite_message = f"""
        💣 This Invite Will Self Destruct! ⏳
        This is how you get an IrregularChat Login and how you can see all the chats and services:
        
        IrregularChat Temp Invite ⏭️ : {invite_url}
        ⏲️ Invite Expires: {hours} hours and {minutes} minutes from now
        
        🌟 After you login you'll see options for the wiki, the forum, matrix "element messenger", and other self-hosted services. 
        Login to the wiki with that Irregular Chat Login and visit https://forum.irregularchat.com/t/84/
        """
        st.code(invite_message)
        st.session_state['message'] = invite_message
        st.session_state['user_list'] = None
        st.success("Invite created successfully!")
        
        # Add buttons to control next actions - outside of any form
        col1, col2 = st.columns(2)
        with col1:
            if st.button("Clear Message", key="clear_invite_message_btn"):
                # Clear message from session state
                if 'message' in st.session_state:
                    del st.session_state['message']
                st.rerun()
        with col2:
            if st.button("Create Another Invite", key="create_another_invite"):
                # Clear form fields and message
                if 'message' in st.session_state:
                    del st.session_state['message']
                st.rerun()
    else:
        st.error("Failed to generate invite message - no invite URL provided.")