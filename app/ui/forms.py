# ui/forms.py
import streamlit as st
from utils.transformations import parse_input
from datetime import datetime, timedelta
from utils.helpers import update_username
import re

def render_create_user_form():
    # Initialize session state keys
    for key in ["username_input", "first_name_input", "last_name_input", "invited_by_input", "email_input", "data_to_parse_input", "intro_input"]:
        if key not in st.session_state:
            st.session_state[key] = ""

    # Check if the parse button was pressed in a previous run
    if "parsed" in st.session_state and st.session_state["parsed"]:
        # Update session state with the parsed values
        parsed = parse_input(st.session_state["data_to_parse_input"])
        st.session_state["first_name_input"] = parsed.get("first_name", st.session_state["first_name_input"])
        st.session_state["last_name_input"] = parsed.get("last_name", st.session_state["last_name_input"])
        st.session_state["email_input"] = parsed.get("email", st.session_state["email_input"])
        st.session_state["invited_by_input"] = parsed.get("invited_by", st.session_state["invited_by_input"])
        st.session_state["intro_input"] = parsed["intro"].get("organization", "")  # Only organization for intro
        st.session_state["parsed"] = False  # Reset the parsed flag

        # Update the username after parsing
        update_username()

    with st.form("create_user_form"):
        # Draw input widgets referencing session state as the source of truth
        username = st.text_input(
            "Enter Username", 
            key="username_input",
            placeholder="e.g., johndoe123"
        )
        
        col1, col2 = st.columns(2)
        with col1:
            first_name = st.text_input(
                "Enter First Name", 
                key="first_name_input",
                placeholder="e.g., John"
            )
        with col2:
            last_name = st.text_input(
                "Enter Last Name", 
                key="last_name_input",
                placeholder="e.g., Doe"
            )

        invited_by = st.text_input(
            "Invited by (optional)", 
            key="invited_by_input",
            placeholder="Signal Username e.g., @janedoe"
        )

        email_input = st.text_input(
            "Enter Email Address (optional)", 
            key="email_input",
            placeholder="e.g., johndoe@example.com"
        )

        intro = st.text_area(
            "Intro", 
            key="intro_input", 
            height=100,
            placeholder="e.g., Software Engineer at TechCorp"
        )

        # Custom style for the "Data to Parse" box
        st.markdown(
            """
            <style>
            .data-to-parse {
                background-color: #e0e0e0;  /* Lighter shade for distinction */
                padding: 10px;
                border-radius: 5px;
            }
            </style>
            """,
            unsafe_allow_html=True
        )

        st.markdown('<div class="data-to-parse">', unsafe_allow_html=True)
        data_to_parse = st.text_area(
            "Data to Parse", 
            key="data_to_parse_input", 
            height=100,
            placeholder="1. John Doe\n2. TechCorp\n3. @janedoe\n4. johndoe@example.com\n5. Interested in AI, ML, and Data Science"
        )
        st.markdown('</div>', unsafe_allow_html=True)

        # Buttons
        parse_button = st.form_submit_button("Parse")
        if parse_button:
            st.session_state["parsed"] = True
            st.rerun()

        submit_button = st.form_submit_button("Submit")

    # Return the final values from session state
    return (
        st.session_state["first_name_input"],
        st.session_state["last_name_input"],
        st.session_state["username_input"],
        st.session_state["email_input"],
        st.session_state["invited_by_input"],
        st.session_state["intro_input"],
        submit_button
    )

def render_invite_form():
    invite_label = st.text_input("Invite Label", key="invite_label")
    expires_default = datetime.now() + timedelta(hours=2)
    expires_date = st.date_input("Enter Expiration Date", value=expires_default.date(), key="expires_date")
    expires_time = st.time_input("Enter Expiration Time", value=expires_default.time(), key="expires_time")
    return invite_label, expires_date, expires_time

