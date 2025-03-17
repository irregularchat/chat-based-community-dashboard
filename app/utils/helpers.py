# utils/helpers.py
import logging
import streamlit as st
import requests
from pytz import timezone  
from datetime import datetime, date, time as time_type
import time
from db.operations import search_users, add_admin_event, sync_user_data, User
from db.database import get_db
from sqlalchemy.orm import Session
from auth.api import (
    create_user,
    force_password_reset,
    generate_secure_passphrase,
    list_users_cached,
    update_user_status,
    delete_user,
    reset_user_password,
    update_user_intro,
    update_user_invited_by,
    create_invite,
    shorten_url,
    list_users,
    webhook_notification,
    create_discourse_post
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
from utils.config import Config
import os
from datetime import timedelta
from typing import Dict, Any, Union
from db.operations import AdminEvent

# Import the reset_create_user_form_fields function from ui.forms
# Use a try/except block to handle potential circular imports
try:
    from ui.forms import reset_create_user_form_fields
except ImportError:
    # Define a fallback function in case of circular import
    def reset_create_user_form_fields():
        """Fallback function to reset form fields in case of circular import"""
        if 'first_name_input' in st.session_state:
            st.session_state['first_name_input'] = ""
        if 'last_name_input' in st.session_state:
            st.session_state['last_name_input'] = ""
        if 'username_input' in st.session_state:
            st.session_state['username_input'] = ""
        if 'email_input' in st.session_state:
            st.session_state['email_input'] = ""
        if 'invited_by_input' in st.session_state:
            st.session_state['invited_by_input'] = ""
        if 'intro_input' in st.session_state:
            st.session_state['intro_input'] = ""
        if 'data_to_parse_input' in st.session_state:
            st.session_state['data_to_parse_input'] = ""

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
        action (str): The action to perform (e.g., "create_user", "reset_password", etc.)
        username (str): The username to perform the action on
        email (str, optional): Email address for the user
        invited_by (str, optional): Who invited the user
        intro (str, optional): User's introduction/organization
        verification_context (str, optional): Context for safety number verification
    """
    try:
        db = next(get_db())
        headers = {
            'Authorization': f"Bearer {Config.AUTHENTIK_API_TOKEN}",
            'Content-Type': 'application/json'
        }
        
        # Normalize action string (remove spaces, convert to lowercase)
        normalized_action = action.lower().replace(' ', '_')
        
        logging.info(f"Processing action: {action}, normalized to: {normalized_action}")
        
        if normalized_action == "create_user":
            # Get the full name from session state
            first_name = st.session_state.get('first_name_input', '')
            last_name = st.session_state.get('last_name_input', '')
            full_name = f"{first_name} {last_name}".strip()
            
            logging.info(f"Creating user {username} with full name {full_name}")
            
            # For create_user, we don't need to check if the user exists first
            # The create_user function will handle username uniqueness
            result, final_username, temp_password, discourse_post_url = create_user(
                username=username,
                full_name=full_name,
                email=email,
                invited_by=invited_by,
                intro=intro
            )
            
            if result:
                # Use the final_username which may have been modified for uniqueness
                add_timeline_event(db, "user_created", final_username, f"User created by admin")
                create_user_message(final_username, temp_password, discourse_post_url)
                
                # Show forum post creation status
                if discourse_post_url:
                    st.success(f"✅ Forum introduction post created successfully: {discourse_post_url}")
                else:
                    st.warning("⚠️ Forum introduction post could not be created. Please check Discourse configuration.")
                
                if email:
                    logging.info(f"Sending welcome email to {email} for user {final_username}")
                    topic_id = "84"
                    # Add forum post URL to the email if available
                    email_result = community_intro_email(
                        to=email,
                        subject="Welcome to IrregularChat!",
                        full_name=full_name,
                        username=final_username,
                        password=temp_password,
                        topic_id=topic_id,
                        discourse_post_url=discourse_post_url
                    )
                    
                    if email_result:
                        st.success(f"✅ Welcome email sent to {email}")
                    else:
                        st.warning(f"⚠️ Failed to send welcome email to {email}. Please check SMTP configuration.")
                
                # If username was modified, inform the admin
                if final_username != username:
                    st.info(f"⚠️ Username was modified for uniqueness: {username} → {final_username}")
                
                # Clear the form
                try:
                    reset_create_user_form_fields()
                except Exception as e:
                    logging.error(f"Error resetting form fields: {e}")
                    # Attempt to reset fields directly
                    if 'first_name_input' in st.session_state:
                        st.session_state['first_name_input'] = ""
                    if 'last_name_input' in st.session_state:
                        st.session_state['last_name_input'] = ""
                    if 'username_input' in st.session_state:
                        st.session_state['username_input'] = ""
                    if 'email_input' in st.session_state:
                        st.session_state['email_input'] = ""
                    if 'invited_by_input' in st.session_state:
                        st.session_state['invited_by_input'] = ""
                    if 'intro_input' in st.session_state:
                        st.session_state['intro_input'] = ""
                    if 'data_to_parse_input' in st.session_state:
                        st.session_state['data_to_parse_input'] = ""
                
                st.success(f"User {final_username} created successfully.")
            else:
                st.error(f"Failed to create user {final_username}.")
            return result
        else:
            # For all other actions, we need to get the user ID first
            user_search_url = f"{Config.AUTHENTIK_API_URL}/core/users/?username={username}"
            response = requests.get(user_search_url, headers=headers, timeout=10)
            response.raise_for_status()
            users = response.json().get('results', [])
            
            if not users:
                st.error(f"User {username} not found")
                return False
                
            user_id = users[0]['pk']
            
            if normalized_action == "reset_password":
                result = force_password_reset(username)
                if result:
                    add_timeline_event(db, "password_reset", username, f"Password reset by admin")
                    st.success(f"Password reset for {username} succeeded.")
                return result

            elif normalized_action in ["activate", "deactivate"]:
                is_active = normalized_action == "activate"
                result = update_user_status(Config.AUTHENTIK_API_URL, headers, user_id, is_active)
                if result:
                    add_timeline_event(db, f"user_{normalized_action}", username, f"User {username} {normalized_action}d by admin")
                    st.success(f"User {username} {normalized_action}d successfully.")
                else:
                    st.error(f"User {username} could not be {normalized_action}d.")
                return result

            elif normalized_action == "delete":
                result = delete_user(Config.AUTHENTIK_API_URL, headers, user_id)
                if result:
                    add_timeline_event(db, "user_deleted", username, f"User {username} deleted by admin")
                    
                    # Remove the user from the local database
                    try:
                        # Delete the user from the local database
                        db_user = db.query(User).filter_by(username=username).first()
                        if db_user:
                            db.delete(db_user)
                            db.commit()
                            logging.info(f"User {username} deleted from local database")
                        
                        # Force refresh of user list in session state
                        if 'user_list' in st.session_state:
                            st.session_state['user_list'] = [u for u in st.session_state['user_list'] 
                                                            if u.get('username') != username]
                    except Exception as e:
                        logging.error(f"Error removing user from local database: {e}")
                    
                    st.success(f"User {username} deleted successfully.")
                return result

            elif normalized_action == "add_intro":
                if intro:
                    result = update_user_intro(Config.AUTHENTIK_API_URL, headers, user_id, intro)
                    if result:
                        add_timeline_event(db, "user_intro_updated", username, f"Intro updated to: {intro}")
                        st.success(f"Intro for {username} updated successfully.")
                    return result

            elif normalized_action == "add_invited_by":
                if invited_by:
                    result = update_user_invited_by(Config.AUTHENTIK_API_URL, headers, user_id, invited_by)
                    if result:
                        add_timeline_event(db, "user_invited_by_updated", username, f"Invited by changed to: {invited_by}")
                        st.success(f"Invited By for {username} updated successfully.")
                    return result

            elif normalized_action == "update_email":
                if email:
                    result = update_user_email(Config.AUTHENTIK_API_URL, headers, user_id, email)
                    if result:
                        add_timeline_event(db, "user_email_updated", username, f"Email updated to: {email}")
                        st.success(f"Email for {username} updated successfully.")
                    return result

            else:
                st.error(f"Unrecognized action: {action}")
                return False
            
    except Exception as e:
        logging.error(f"Error processing action {action} for user {username}: {e}")
        st.error(f"Error processing action {action} for user {username}")
        return False

def send_email(to, subject, body):
    try:
        logging.info(f"Attempting to send email to: {to}")
        
        # Create a MIMEText object to represent the email
        msg = MIMEMultipart()
        msg['From'] = Config.SMTP_FROM
        msg['To'] = to
        if Config.SMTP_BCC:
            msg['Bcc'] = Config.SMTP_BCC
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'html'))

        logging.info(f"Email content prepared. From: {Config.SMTP_FROM}, To: {to}, Subject: {subject}")

        # Connect to the SMTP server and send the email
        logging.info(f"Connecting to SMTP server: {Config.SMTP_SERVER}:{Config.SMTP_PORT}")
        server = smtplib.SMTP(Config.SMTP_SERVER, int(Config.SMTP_PORT))
        server.set_debuglevel(1)  # Enable SMTP debug output
        
        logging.info("Starting TLS")
        server.starttls()
        
        logging.info("Attempting SMTP login")
        server.login(Config.SMTP_USER, Config.SMTP_PASSWORD)
        
        logging.info("Sending email message")
        recipients = [to]
        if Config.SMTP_BCC:
            recipients.append(Config.SMTP_BCC)
        server.sendmail(Config.SMTP_FROM, recipients, msg.as_string())
        
        logging.info("Closing SMTP connection")
        server.quit()
        
        logging.info(f"Email sent successfully to {to}")
        return True
    except smtplib.SMTPException as smtp_e:
        logging.error(f"SMTP error sending email to {to}: {smtp_e}")
        logging.error(f"SMTP Configuration: Server={Config.SMTP_SERVER}, Port={Config.SMTP_PORT}, From={Config.SMTP_FROM}")
        logging.error(f"Error details: {str(smtp_e)}")
        return False
    except Exception as e:
        logging.error(f"Unexpected error sending email to {to}: {e}")
        logging.error(f"SMTP Configuration: Server={Config.SMTP_SERVER}, Port={Config.SMTP_PORT}, From={Config.SMTP_FROM}")
        logging.error(f"Error type: {type(e).__name__}")
        logging.error(f"Error details: {str(e)}")
        return False

def get_email_html_content(full_name, username, password, topic_id, discourse_post_url=None):
    """
    Generate the HTML content for the email.

    Args:
        full_name (str): Full name of the user.
        username (str): Username of the user.
        password (str): Password for the user.
        topic_id (str): Topic ID for the introduction post.
        discourse_post_url (str, optional): URL to the user's introduction post on Discourse.

    Returns:
        str: HTML content for the email.
    """
    # Create Discourse post link section if URL is available
    discourse_section = ""
    if discourse_post_url:
        discourse_section = f"""
            <p>Your introduction post: <a href="{discourse_post_url}">View your introduction post</a></p>
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
                color: #2a6496;
                border-bottom: 2px solid #eee;
                padding-bottom: 10px;
            }}
            .credentials {{
                background-color: #f5f5f5;
                padding: 15px;
                border-radius: 5px;
                margin: 20px 0;
                border-left: 4px solid #2a6496;
            }}
            .button {{
                display: inline-block;
                padding: 10px 20px;
                background-color: #2a6496;
                color: white;
                text-decoration: none;
                border-radius: 5px;
                margin-top: 20px;
            }}
            .footer {{
                margin-top: 30px;
                padding-top: 15px;
                border-top: 1px solid #eee;
                font-size: 0.9em;
                color: #777;
            }}
        </style>
    </head>
    <body>
        <div class="email-container">
            <h1>Welcome to IrregularChat, {full_name}!</h1>
            
            <p>Thank you for joining our community. We're excited to have you with us!</p>
            
            <div class="credentials">
                <p><strong>Username:</strong> {username}</p>
                <p><strong>Temporary Password:</strong> {password}</p>
                <p><em>Please change your password after your first login.</em></p>
            </div>
            
            <h3>Next Steps:</h3>
            
            <ol>
                <li>Log in at <a href="https://sso.irregularchat.com">https://sso.irregularchat.com</a></li>
                <li>Change your temporary password to something secure</li>
                <li>Join our Signal groups to connect with the community</li>
                <li>Explore our community resources and events</li>
            </ol>
            
            <h3>Community Resources:</h3>
            
            <ul>
                <li><a href="https://forum.irregularchat.com">Community Forum</a> - Discussions, announcements, and resources</li>
                <li><a href="https://wiki.irregularchat.com">Community Wiki</a> - Knowledge base and documentation</li>
                <li><a href="https://calendar.irregularchat.com">Community Calendar</a> - Upcoming events and activities</li>
            </ul>
            
            <a href="https://sso.irregularchat.com" class="button">Log in Now</a>

            {discourse_section}

            <div class="footer">
                 If you have any questions, feel free to reach out to our <a href="https://signal.group/#CjQKIL5qhTG80gnMDHO4u7gyArJm2VXkKmRlyWorGQFif8n_EhCIsKoPI0FBFas5ujyH2Uve">admin signal group</a>
             </div>
         </div>
    </body>
    </html>
    """

def community_intro_email(to, subject, full_name, username, password, topic_id, discourse_post_url=None):
    """
    Send a community introduction email to a new user.
    
    Args:
        to (str): Email address to send to
        subject (str): Email subject
        full_name (str): User's full name
        username (str): User's username
        password (str): User's temporary password
        topic_id (str): Topic ID for the welcome page
        discourse_post_url (str, optional): URL to the user's introduction post
        
    Returns:
        bool: True if email was sent successfully, False otherwise
    """
    try:
        logging.info(f"Preparing community intro email for {username}")
        
        # Get the HTML content for the email
        html_content = get_email_html_content(full_name, username, password, topic_id, discourse_post_url)
        
        # Send the email and get the result
        result = send_email(to, subject, html_content)
        
        if result:
            logging.info(f"Successfully sent community intro email to {to}")
            return True
        else:
            logging.error(f"Failed to send community intro email to {to}")
            return False
    except Exception as e:
        logging.error(f"Error preparing or sending community intro email: {e}")
        return False

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

def test_email_connection():
    """Test SMTP connection and settings"""
    try:
        # Create test connection
        server = smtplib.SMTP(Config.SMTP_SERVER, Config.SMTP_PORT)
        server.set_debuglevel(1)  # Enable debug output
        
        # Try STARTTLS
        try:
            server.starttls()
            logging.info("STARTTLS successful")
        except Exception as e:
            logging.error(f"STARTTLS failed: {e}")
            
        # Try login
        try:
            server.login(Config.SMTP_USER, Config.SMTP_PASSWORD)
            logging.info("SMTP login successful")
        except Exception as e:
            logging.error(f"SMTP login failed: {e}")
            
        server.quit()
        return True
        
    except Exception as e:
        logging.error(f"SMTP connection test failed: {e}")
        return False

