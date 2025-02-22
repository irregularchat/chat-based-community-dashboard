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
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import random
import string

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
                st.success(f"User {username} created successfully.")
            return result

        elif action == "Reset Password":
            result = force_password_reset(username)
            if result:
                add_timeline_event(db, "password_reset", username, f"Password reset by admin")
                st.success(f"Password reset for {username} succeeded.")
            return result

        elif action in ["Activate", "Deactivate"]:
            # Assume "Activate" means the desired status is True (active)
            # and "Deactivate" means False (inactive).
            desired_status = True if action == "Activate" else False
            result = update_user_status(username, desired_status)
            if result:
                add_timeline_event(db, f"user_{action.lower()}", username,
                                   f"User {username} {action.lower()}d by admin")
                st.success(f"User {username} {action.lower()}d successfully.")
            else:
                st.error(f"User {username} could not be {action.lower()}d.")
            return result

        elif action == "Delete":
            result = delete_user(username)
            if result:
                add_timeline_event(db, "user_deleted", username, f"User {username} deleted by admin")
                st.success(f"User {username} deleted successfully.")
            return result

        elif action == "Add Intro":
            if intro:
                result = update_user_intro(username, intro)
                if result:
                    add_timeline_event(db, "user_intro_updated", username, f"Intro updated to: {intro}")
                    st.success(f"Intro for {username} updated successfully.")
                return result

        elif action == "Add Invited By":
            if invited_by:
                result = update_user_invited_by(username, invited_by)
                if result:
                    add_timeline_event(db, "user_invited_by_updated", username, f"Invited by changed to: {invited_by}")
                    st.success(f"Invited By for {username} updated successfully.")
                return result

        elif action == "Safety Number Change Verified":
            result = handle_safety_number_change(username, verification_context)
            if result:
                add_timeline_event(db, "safety_number_change_verified", username, "Safety number change verified.")
                st.success(f"Safety number change verified for {username}.")
            return result

        else:
            st.error(f"Unrecognized action: {action}")
    except Exception as e:
        logging.error(f"Error processing action {action} for user {username}: {e}")
        st.error(f"Error processing action {action} for user {username}")
        return None
    

def send_email(to, subject, body):
    try:
        # Create a MIMEText object to represent the email
        msg = MIMEMultipart()
        msg['From'] = config.SMTP_FROM
        msg['To'] = to
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'html'))

        # Connect to the SMTP server and send the email
        server = smtplib.SMTP(config.SMTP_SERVER, config.SMTP_PORT)
        server.starttls()
        server.login(config.SMTP_USER, config.SMTP_PASSWORD)
        server.send_message(msg)
        server.quit()
        
        logging.info(f"Email sent successfully to {to}")
    except Exception as e:
        logging.error(f"Failed to send email to {to}: {e}")

def get_email_html_content(full_name, username, password, topic_id):
    """
    Generate the HTML content for the email.

    Args:
        full_name (str): Full name of the user.
        username (str): Username of the user.
        password (str): Password for the user.
        topic_id (str): Topic ID for the introduction post.

    Returns:
        str: HTML content for the email.
    """
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                margin: 0;
                padding: 0;
            }}
            .email-container {{
                max-width: 600px;
                margin: auto;
                padding: 20px;
                border: 1px solid #ddd;
                border-radius: 8px;
                background-color: #f9f9f9;
            }}
            h1 {{
                font-size: 24px;
                color: #0056b3;
            }}
            h2 {{
                font-size: 20px;
                color: #333;
            }}
            p {{
                margin: 10px 0;
            }}
            a {{
                color: #0056b3;
                text-decoration: none;
            }}
            a:hover {{
                text-decoration: underline;
            }}
            .button {{
                display: inline-block;
                padding: 10px 20px;
                margin-top: 20px;
                background-color: #0056b3;
                color: #fff;
                text-decoration: none;
                border-radius: 4px;
            }}
            .button:hover {{
                background-color: #003d80;
            }}
            .footer {{
                font-size: 12px;
                color: #666;
                text-align: center;
                margin-top: 20px;
            }}
        </style>
    </head>
    <body>
        <div class="email-container">
            <h1>Welcome, {full_name}!</h1>
            <p>We're excited to have you join the IrregularChat community.</p>

            <h2>Your Next Steps:</h2>
            
            <p><strong>1. Log In and Change Your Password:</strong><br>
               <em>We highly recommend using a password manager for a strong, secure password. Check out our <a href="https://irregularpedia.org/index.php/Guide_to_Password_Managers#Getting_Started_with_Password_Managers">quick guide on password managers</a>.</em><br>
               Use your login details below to access your account to see all the chats, services, and login only pages:<br>
               <strong>Username:</strong> {username}<br>
               <strong>Password:</strong> {password}<br>
               <strong>Login Link:</strong> <a href="https://sso.irregularchat.com/if/user/#/settings">https://sso.irregularchat.com/if/user/#/settings</a>
            </p>
            <hr style="border: 1px solid #eee; margin: 20px 0;">
            <p><strong>2. Learn the Community Rules:</strong><br>
               Please read the <a href="https://forum.irregularchat.com/t/irregularchat-forum-start-here-faqs/84/3">Community Start Guide</a> to understand how to participate in our community.   
            </p>
            <p><strong>3. Introduce Yourself:</strong><br>
                People are often looking for someone to start a project with, get mentorship from, hire or request a recommendation, etc. Introducing yourself is a great way to connect with other community members!<br>
                <a href="https://forum.irregularchat.com/t/{topic_id}">
                    Post Created for Your Introduction
                </a>.
                This is a great way to connect with other community members!
             </p>
             <p><strong>4. Explore Chats and Services:</strong><br>
               Once you've introduced yourself, dive into our community! Access all of our chats and services here:<br>
               <a href="https://forum.irregularchat.com/t/community-links-to-chats-and-services/229">
                   Community Links to Chats and Services
               </a>.
            </p>

            <a href="https://sso.irregularchat.com" class="button">Log in Now</a>

            <div class="footer">
                 If you have any questions, feel free to reach out to our <a href="https://signal.group/#CjQKIL5qhTG80gnMDHO4u7gyArJm2VXkKmRlyWorGQFif8n_EhCIsKoPI0FBFas5ujyH2Uve">admin signal group</a>
             </div>
         </div>
    </body>
    </html>
    """

def community_intro_email(to, subject, full_name, username, password, topic_id):
    """
    Send a community introduction email to a new user.

    Args:
        to (str): Recipient's email address.
        subject (str): Subject of the email.
        full_name (str): Full name of the user.
        username (str): Username of the user.
        password (str): Password for the user.
        topic_id (str): Topic ID for the introduction post.
    """
    # Get the HTML content for the email
    html_content = get_email_html_content(full_name, username, password, topic_id)

    # Send the email using the send_email function
    send_email(to, subject, html_content)

def generate_unique_code(length=6):
    """Generate a random alphanumeric code of a given length."""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))

def safety_number_change_email(to, subject, full_name, username):
    """
    Send a safety number change email to a user. Forcing them to verify their email after a signal safety number change.
    A user's signal safety number change occurs when they change their phone number or when they lose their phone. 
    To prevent a man-in-the-middle attack, the user must verify a unique code sent to their email which they will send to the signal chat room. 
    Args:
        to (str): Recipient's email address.
        subject (str): Subject of the email.
        full_name (str): Full name of the user.
        username (str): Username of the user.
    """
    # Generate a unique verification code
    verification_code = generate_unique_code()

    # Store the verification code in session state or database for later verification
    st.session_state[f'verification_code_{username}'] = verification_code

    # Get the HTML content with the verification code
    html_content = get_safety_number_change_email_html_content(full_name, username, verification_code)
    send_email(to, subject, html_content)

def get_safety_number_change_email_html_content(full_name, username, verification_code):
    """
    Get the HTML content for the safety number change email.
    """
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body {{
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                margin: 0;
                padding: 0;
            }}
            .email-container {{
                max-width: 600px;
                margin: auto;
                padding: 20px;
                border: 1px solid #ddd;
                border-radius: 8px;
                background-color: #f9f9f9;
            }}
            h1 {{
                font-size: 24px;
                color: #0056b3;
            }}
            p {{
                margin: 10px 0;
            }}
            .code {{
                font-size: 20px;
                font-weight: bold;
                color: #0056b3;
            }}
        </style>
    </head>
    <body>
        <div class="email-container">
            <h1>Hello, {full_name}!</h1>
            <p>We have detected a change in your Signal safety number. To ensure your account's security, please verify your identity by using the following code:</p>
            <p class="code">{verification_code}</p>
            <p>Send this code to the Signal chat room to complete the verification process.</p>
            <p>If you did not initiate this change, please contact support immediately.</p>
        </div>
    </body>
    </html>
    """

