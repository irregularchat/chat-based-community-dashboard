# ui/forms.py
import streamlit as st
from utils.transformations import parse_input
from datetime import datetime, timedelta
from utils.helpers import (
    update_username, 
    get_eastern_time, 
    add_timeline_event,
    handle_form_submission,
    safety_number_change_email
)
from db.operations import AdminEvent
from db.database import get_db
from db.init_db import should_sync_users
import re
import pandas as pd
import json
import logging
from st_aggrid import AgGrid, GridOptionsBuilder, DataReturnMode, GridUpdateMode, ColumnsAutoSizeMode
import time
import warnings
import requests
from pytz import timezone

def reset_create_user_form_fields():
    """Helper function to reset all fields related to create user."""
    keys_to_reset = [
        "username_input",
        "first_name_input",
        "last_name_input",
        "email_input",
        "invited_by_input",
        "data_to_parse_input",
        "intro_input"
    ]
    
    # Set a flag in session state to indicate we should clear fields
    st.session_state['clear_fields'] = True
    
    # Store current values temporarily to detect changes
    old_values = {key: st.session_state.get(key, "") for key in keys_to_reset}
    st.session_state['old_values'] = old_values

def parse_and_rerun():
    """Callback to parse data and rerun the script so widgets see updated session state."""
    # Check if input is empty
    if not st.session_state["data_to_parse_input"].strip():
        return  # Just return if there's no data to parse
    
    # Parse the data from the text area
    parsed = parse_input(st.session_state["data_to_parse_input"])
    
    # Check for error in parsed data
    if isinstance(parsed, dict) and "error" in parsed:
        st.error(parsed["error"])
        return
    
    if not parsed or (isinstance(parsed, tuple) and parsed[1] is False):
        st.error("Could not parse the input text")
        return

    # Update session state with safer dictionary access
    st.session_state["first_name_input"] = parsed.get("first_name", st.session_state["first_name_input"])
    st.session_state["last_name_input"] = parsed.get("last_name", st.session_state["last_name_input"])
    st.session_state["email_input"] = parsed.get("email", st.session_state["email_input"])
    st.session_state["invited_by_input"] = parsed.get("invited_by", st.session_state["invited_by_input"])
    
    # Safely access nested intro fields and combine organization and interests
    intro_data = parsed.get("intro", {})
    org = intro_data.get("organization", "")
    interests = intro_data.get("interests", "")
    combined_intro = f"{org}\n\nInterests: {interests}" if interests else org
    st.session_state["intro_input"] = combined_intro

    # Rerun so the text inputs see the updated session state
    st.rerun()

def render_create_user_form():
    # 1. Check if we need to clear fields (do this before any widgets are created)
    if st.session_state.get('clear_fields', False):
        # Clear all the fields
        for key in [
            "username_input",
            "first_name_input",
            "last_name_input",
            "email_input",
            "invited_by_input",
            "data_to_parse_input",
            "intro_input"
        ]:
            if key in st.session_state:
                del st.session_state[key]
        
        # Reset the clear flag
        del st.session_state['clear_fields']
        # Rerun to start fresh
        st.rerun()

    # 2. Initialize session state keys
    for key in [
        "username_input",
        "first_name_input",
        "last_name_input",
        "invited_by_input",
        "email_input",
        "data_to_parse_input",
        "intro_input"
    ]:
        if key not in st.session_state:
            st.session_state[key] = ""

    # 3. Update username whenever first/last name changes
    def update_username_callback():
        update_username()

    # 4. Update username *before* widgets are created
    update_username()

    # 5. Inputs outside the form to allow the on_change callbacks
    col1, col2 = st.columns(2)
    with col1:
        st.text_input(
            "Enter First Name",
            key="first_name_input",
            placeholder="e.g., John",
            on_change=update_username_callback
        )
    with col2:
        st.text_input(
            "Enter Last Name",
            key="last_name_input",
            placeholder="e.g., Doe",
            on_change=update_username_callback
        )

    with st.form("create_user_form"):
        # Text inputs
        st.text_input(
            "Enter Username",
            key="username_input",
            placeholder="e.g., johndoe123"
        )
        st.text_input(
            "Invited by (optional)",
            key="invited_by_input",
            placeholder="Signal Username e.g., @janedoe"
        )
        st.text_input(
            "Enter Email Address (optional)",
            key="email_input",
            placeholder="e.g., johndoe@example.com"
        )
        st.text_area(
            "Intro",
            key="intro_input",
            height=100,
            placeholder="e.g., Software Engineer at TechCorp"
        )
        
        # Text area for data parsing
        # the concept of the data to parse is that it is a list of users with their intro info
        # the user will paste the intro info into the text area and then click parse
        # the parse function will parse the intro info into a list of users
        # the list of users will be displayed in the user grid
        # the user can then select users to apply actions to
        # the actions will be applied to the selected users
        
        st.markdown("""
            <style>
            .data-to-parse {
                background-color: #e0e0e0; 
                padding: 10px;
                border-radius: 5px;
            }
            </style>
            <script>
            document.addEventListener('DOMContentLoaded', function() {
                document.getElementById('data_to_parse_input').focus();
            });
            </script>
            """, unsafe_allow_html=True)
        
        st.markdown('<div class="data-to-parse">', unsafe_allow_html=True)
        st.text_area(
            "Data to Parse",
            key="data_to_parse_input",
            height=180,
            placeholder=("Please enter your details (each on a new line):\n"
                         "1. What's Your Name\n"
                         "2. What org are you with\n"
                         "3. Who invited you (add and mention them in this chat)\n"
                         "4. Your Email or Email-Alias/Mask (for password resets and safety number verifications)\n"
                         "5. Your Interests (so we can get you to the right chats)")
        )
        st.markdown('</div>', unsafe_allow_html=True)

        # 6. Bind parse button to the parse_and_rerun callback
        parse_button = st.form_submit_button("Parse", on_click=parse_and_rerun)

        # 7. Submit and clear
        submit_button = st.form_submit_button("Submit")
        clear_button = st.form_submit_button("Clear All Fields")

    # Reset fields on Clear
    if clear_button:
        reset_create_user_form_fields()
        st.rerun()

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
    
    # Get the current Eastern Time
    eastern = timezone('US/Eastern')
    eastern_now = datetime.now(eastern)
    expires_default = eastern_now + timedelta(hours=2)
    
    # Use the Eastern time values for the date/time inputs
    expires_date = st.date_input("Enter Expiration Date", value=expires_default.date(), key="expires_date")
    expires_time = st.time_input("Enter Expiration Time", value=expires_default.time(), key="expires_time")
    
    return invite_label, expires_date, expires_time

def display_user_list(auth_api_url, headers):
    # Process a pending action if one exists.
    if 'pending_action' in st.session_state:
        st.write("DEBUG: Processing pending action:", st.session_state['pending_action'])
        pending = st.session_state['pending_action']
        handle_action(
            pending['action'],
            pending['selected_users'],
            pending.get('verification_context', '')
        )
        del st.session_state['pending_action']

    warnings.filterwarnings('ignore', category=FutureWarning, 
                            message='DataFrame.applymap has been deprecated')

    if 'persisted_selection' not in st.session_state:
        st.session_state['persisted_selection'] = []

    if 'user_list' not in st.session_state or not st.session_state['user_list']:
        st.write("DEBUG: No users found in session state.")
        return

    df = pd.DataFrame(st.session_state['user_list'])

    if df.empty:
        st.info("No users found.")
        return

    # Process the attributes column if available.
    if 'attributes' in df.columns:
        df['intro'] = df['attributes'].apply(
            lambda x: x.get('intro', '') if isinstance(x, dict) else ''
        )
    
    if 'last_login' in df.columns:
        df['last_login'] = pd.to_datetime(df['last_login']).dt.strftime('%Y-%m-%d %H:%M')
    if 'is_active' in df.columns:
        df['is_active'] = df['is_active'].map({True: '✓', False: '×'})

    # Only include columns that exist in the DataFrame.
    columns_to_display = ['pk', 'username', 'name', 'email', 'is_active', 'last_login', 'intro']
    columns_to_display = [col for col in columns_to_display if col in df.columns]
    df = df[columns_to_display]
    
    # Debug: output the head of the DataFrame.
    st.write("DEBUG: DataFrame head:", df.head())
    
    # Build grid options.
    gb = GridOptionsBuilder.from_dataframe(df)
    gb.configure_default_column(resizable=True, filterable=True, sortable=True, editable=False)
    gb.configure_selection(
        selection_mode='multiple',
        use_checkbox=True,
        header_checkbox=True,
        pre_selected_rows=st.session_state['persisted_selection']
    )
    grid_options = gb.build()
    
    st.write("DEBUG: Grid Options:", grid_options)
    
    # Launch AgGrid.
    grid_response = AgGrid(
        df,
        gridOptions=grid_options,
        data_return_mode=DataReturnMode.FILTERED_AND_SORTED,
        update_mode=GridUpdateMode.SELECTION_CHANGED,
        fit_columns_on_grid_load=True,
        theme='alpine',
        height=600,
        key="user_grid"
    )
    
    # Debug: show the full grid response.
    st.write("DEBUG: Grid Response:", grid_response)
    
    # Use the AgGridReturn attribute to get selected rows.
    selected_rows = grid_response.selected_rows
    st.write("DEBUG: Selected Rows (raw):", selected_rows)
    
    # If selected_rows is a DataFrame, convert it to a list of dictionaries.
    if isinstance(selected_rows, pd.DataFrame):
        selected_rows = selected_rows.to_dict('records')
    
    # Save the selected row data into session state.
    st.session_state['persisted_selection'] = selected_rows
    
    # Now, check if there are any selected rows.
    if len(selected_rows) > 0:
        st.write("---")
        st.write(f"DEBUG: {len(selected_rows)} user(s) selected.")
        
        action = st.selectbox(
            "Select Action",
            [
                "Activate", 
                "Deactivate", 
                "Reset Password", 
                "Delete", 
                "Add Intro", 
                "Add Invited By", 
                "Verify Safety Number Change",
                "Update Email"
            ],
            key="action_selection"
        )
        st.write("DEBUG: Action selected:", action)
        
        if action == "Add Intro":
            st.text_area("Enter Intro Text", key="intro_input")
        elif action == "Add Invited By":
            st.text_input("Enter Invited By", key="invited_by_input")
        elif action == "Verify Safety Number Change":
            # Send the safety number change email with a unique code
            user_email = st.session_state.get(f"email_{username}")
            full_name = f"{st.session_state.get('first_name_input', '')} {st.session_state.get('last_name_input', '')}".strip()
            
            if user_email:
                safety_number_change_email(
                    to=user_email,
                    subject="Verify Your Safety Number Change",
                    full_name=full_name,
                    username=username
                )
                st.success(f"Verification email sent to {user_email}.")
            else:
                st.error("User email not found. Cannot send verification email.")
        elif action == "Update Email":
            for user in selected_rows:
                st.text_input(
                    f"New email for {user['username']}",
                    key=f"email_{user['pk']}",
                    value=user.get('email', '')
                )
        
        if st.button("Apply", key="apply_action"):
            st.write("DEBUG: Applying action.")
            st.session_state['pending_action'] = {
                'action': action,
                'selected_users': selected_rows,
                'verification_context': st.session_state.get("verification_context", "")
            }
            st.rerun()

def handle_action(action, selected_users, verification_context=''):
    """Pass the action to handle_form_submission in helpers.py"""
    if not selected_users:
        st.error("Please select users first")
        return

    # Initialize session state for form inputs if not exists
    if 'form_inputs' not in st.session_state:
        st.session_state.form_inputs = {}
    
    # Batch process all selected users
    for user in selected_users:
        username = user['username']  # Extract username from user dict
        
        try:
            if action == "Update Email":
                email_key = f"email_{user['pk']}"
                new_email = st.session_state.get(email_key)
                if new_email and new_email != user.get('email', ''):
                    handle_form_submission(
                        action=action,
                        username=username,
                        email=new_email
                    )
                    
            elif action == "Add Intro":
                intro_text = st.session_state.get("intro_input")
                if intro_text:
                    handle_form_submission(
                        action=action,
                        username=username,
                        intro=intro_text
                    )
                    
            elif action == "Add Invited By":
                invited_by = st.session_state.get("invited_by_input")
                if invited_by:
                    handle_form_submission(
                        action=action,
                        username=username,
                        invited_by=invited_by
                    )
                    
            elif action == "Reset Password":
                handle_form_submission(
                    action=action,
                    username=username
                )
                
            elif action in ["Activate", "Deactivate"]:
                handle_form_submission(
                    action=action,
                    username=username
                )
                
            elif action == "Verify Safety Number Change":
                # Send the safety number change email with a unique code
                user_email = st.session_state.get(f"email_{username}")
                full_name = f"{st.session_state.get('first_name_input', '')} {st.session_state.get('last_name_input', '')}".strip()
                
                if user_email:
                    safety_number_change_email(
                        to=user_email,
                        subject="Verify Your Safety Number Change",
                        full_name=full_name,
                        username=username
                    )
                    st.success(f"Verification email sent to {user_email}.")
                else:
                    st.error("User email not found. Cannot send verification email.")
                
        except Exception as e:
            logging.error(f"Error processing action {action} for user {username}: {e}")
            st.error(f"Error processing action {action} for user {username}")
            continue

def verify_safety_number_change(username, input_code):
    """Verify the safety number change using the input code."""
    stored_code = st.session_state.get(f'verification_code_{username}')
    if stored_code and stored_code == input_code:
        st.success("Verification successful!")
        # Proceed with any additional verification steps
    else:
        st.error("Verification failed. Please check the code and try again.")

