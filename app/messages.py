# app/messages.py
import streamlit as st
from auth.api import shorten_url, generate_recovery_link, create_invite  # Ensure create_invite is imported
from utils.helpers import update_LOCAL_DB
from pytz import timezone
from datetime import datetime
import logging
from utils.config import Config  # Ensure Config is imported

def create_user_message(new_username, shortened_recovery_link):
    """Generate and display the welcome message after user creation."""
    welcome_message = f"""
    🌟 Welcome to the IrregularChat Community of Interest (CoI)! 🌟
    You've just joined a community focused on breaking down silos, fostering innovation, and supporting service members and veterans. Here's what you need to know to get started and a guide to join the wiki and other services:
    ---
    See Below for username ⬇️
    Username: {new_username}
    See Above for username 👆🏼

    1️⃣ Step 1:
    - Activate your IrregularChat Login with your username 👉🏼 {new_username} 👈🏼 here: {shortened_recovery_link}

    2️⃣ Step 2:
    - Login to the wiki with that Irregular Chat Login and visit https://url.irregular.chat/welcome
    """
    st.code(welcome_message)
    st.session_state['message'] = welcome_message
    update_LOCAL_DB()
    st.session_state['user_list'] = None  # Clear user list if there was any
    st.success("User created successfully!")

def create_recovery_message(username_input, recovery_link):
    """Generate and display the recovery message after generating a recovery link."""
    recovery_message = f"""
    🌟 Your account recovery link 🌟
    **Username**: {username_input}
    **Recovery Link**: {recovery_link}

    Use the link above to recover your account.
    """
    st.code(recovery_message)
    st.session_state['message'] = recovery_message
    st.session_state['user_list'] = None  # Clear user list if there was any
    st.success("Recovery link generated successfully!")

def create_invite_message(label, invite_link, invite_expires):
    """Generate and display the invite message."""
    # Call create_invite to get the invite link and expiration
    headers = {
        'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
        'Content-Type': 'application/json'
    }
    
    invite_link, invite_expires = create_invite(headers, label)
    
    if invite_expires:
        eastern = timezone('US/Eastern')
        invite_expires_time = datetime.fromisoformat(invite_expires.replace('Z', '+00:00')).astimezone(eastern)
        time_remaining = invite_expires_time - datetime.now(eastern)
        hours, remainder = divmod(int(time_remaining.total_seconds()), 3600)
        minutes, _ = divmod(remainder, 60)

        invite_message = f"""
        💣 This Invite Will Self Destruct! ⏳
        This is how you get an IrregularChat Login and how you can see all the chats and services:
        
        IrregularChat Temp Invite ⏭️ : {invite_link}
        ⏲️ Invite Expires: {hours} hours and {minutes} minutes from now
        
        🌟 After you login you'll see options for the wiki, the forum, matrix "element messenger", and other self-hosted services. 
        Login to the wiki with that Irregular Chat Login and visit https://url.irregular.chat/welcome/
        """
        st.code(invite_message)
        st.session_state['user_list'] = None
        st.success("Invite created successfully!")
    else:
        st.error("Invite creation failed.")
