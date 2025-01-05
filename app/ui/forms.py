# ui/forms.py
import streamlit as st
from datetime import datetime, timedelta
from utils.transformations import parse_input  # Import the parse_input function

def render_create_user_form():
    col1, col2 = st.columns(2)
    with col1:
        first_name = st.text_input("Enter First Name", key="first_name")
    with col2:
        last_name = st.text_input("Enter Last Name", key="last_name")
    
    invited_by = st.text_input("Invited by (optional)", key="invited_by")
    email_input = st.text_input("Enter Email Address (optional)", key="email_input")
    intro = st.text_area("Intro (optional)", height=100, key="intro")
    
    # Parse button
    if st.button("Parse"):
        # Parse the input from the intro field
        parsed_data = parse_input(intro)
        
        # Update the session state with parsed data
        st.session_state['first_name'] = parsed_data['first_name']
        st.session_state['last_name'] = parsed_data['last_name']
        st.session_state['email_input'] = parsed_data['email']
        st.session_state['invited_by'] = parsed_data['invited_by']
        
        # Format the intro field with organization and interests
        st.session_state['intro'] = f"Organization: {parsed_data['intro']['organization']}\nInterests: {parsed_data['intro']['interests']}"
    
    # Add a checkbox for sending notification to Signal
    # send_signal_notification = st.checkbox("Send notification to Signal", value=True, key="send_signal_notification")
    return first_name, last_name, email_input, invited_by, intro

def render_invite_form():
    invite_label = st.text_input("Invite Label", key="invite_label")
    expires_default = datetime.now() + timedelta(hours=2)
    expires_date = st.date_input("Enter Expiration Date", value=expires_default.date(), key="expires_date")
    expires_time = st.time_input("Enter Expiration Time", value=expires_default.time(), key="expires_time")
    return invite_label, expires_date, expires_time

