# app/messages.py

import streamlit as st
from authentik_streamlit import shorten_url, generate_recovery_link, create_invite, update_LOCAL_DB
from pytz import timezone
from datetime import datetime, timedelta

# Load time zone
eastern = timezone('US/Eastern')

def create_user_message(new_username, shortened_recovery_link):
    """Generate and display the welcome message after user creation."""
    welcome_message = f"""
    🌟 Welcome to the IrregularChat Community of Interest (CoI)! 🌟
    You've just joined a community focused on breaking down silos, fostering innovation, and supporting service members and veterans. Here's what you need to know to get started and a guide to join the wiki and other services:
    ---
    See Below for username ⬇️
    Username: {new_username}
    👆🏼 See Above for username 👆🏼

    1️⃣ Step 1:
    - Activate your IrregularChat Login with your username 👉🏼 {new_username} 👈🏼 here: {shortened_recovery_link}

    2️⃣ Step 2:
    - Login to the wiki with that Irregular Chat Login and visit https://url.irregular.chat/welcome
    """
    st.code(welcome_message, language='markdown')
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
    st.code(recovery_message, language='markdown')
    st.session_state['message'] = recovery_message
    st.session_state['user_list'] = None  # Clear user list if there was any
    st.success("Recovery link generated successfully!")

def create_invite_message(username_input, invite_link, invite_expires):
    """Generate and display the invite message."""
    if invite_expires:
        invite_expires_time = datetime.fromisoformat(invite_expires.replace('Z', '+00:00')).astimezone(timezone('US/Eastern')) - datetime.now(timezone('US/Eastern'))
        hours, remainder = divmod(invite_expires_time.total_seconds(), 3600)
        minutes, _ = divmod(remainder, 60)

        invite_message = f"""
        💣 This Invite Will Self Destruct! ⏳
        This is how you get an IrregularChat Login and how you can see all the chats and services:
        
        IrregularChat Temp Invite ⏭️ : {invite_link}
        ⏲️ Invite Expires: {int(hours)} hours and {int(minutes)} minutes from now
        
        🌟 After you login you'll see options for the wiki, the forum, matrix "element messenger", and other self-hosted services. 
        Login to the wiki with that Irregular Chat Login and visit https://url.irregular.chat/welcome/
        """
        st.code(invite_message, language='markdown')
        st.session_state['user_list'] = None
        st.success("Invite created successfully!")
    else:
        st.error("Invite creation failed.")

def display_message():
    """Display any previously stored message."""
    if 'message' in st.session_state:
        st.success(st.session_state['message'])

def clear_session_state():
    """Clear session state after the user list has been displayed."""
    if 'message' in st.session_state:
        del st.session_state['message']
