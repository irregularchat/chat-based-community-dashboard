# ui/forms.py
import streamlit as st
from utils.transformations import parse_input
from datetime import datetime, timedelta
from utils.helpers import (
    update_username, 
    get_eastern_time, 
    add_timeline_event,
    handle_form_submission
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
    # Parse the data from the text area
    parsed = parse_input(st.session_state["data_to_parse_input"])

    # Update session state
    st.session_state["first_name_input"] = parsed.get("first_name", st.session_state["first_name_input"])
    st.session_state["last_name_input"] = parsed.get("last_name", st.session_state["last_name_input"])
    st.session_state["email_input"] = parsed.get("email", st.session_state["email_input"])
    st.session_state["invited_by_input"] = parsed.get("invited_by", st.session_state["invited_by_input"])
    st.session_state["intro_input"] = parsed["intro"].get("organization", "")

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
            placeholder="(Optional) Paste user intro info here..."
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
    eastern_now = get_eastern_time(datetime.now().date(), datetime.now().time())
    expires_default = eastern_now + timedelta(hours=2)
    
    expires_date = st.date_input("Enter Expiration Date", value=expires_default.date(), key="expires_date")
    expires_time = st.time_input("Enter Expiration Time", value=expires_default.time(), key="expires_time")
    
    # Convert to Eastern Time
    eastern_time = get_eastern_time(expires_date, expires_time)
    
    return invite_label, eastern_time.date(), eastern_time.time()

def display_user_list(auth_api_url, headers):
    warnings.filterwarnings('ignore', category=FutureWarning, message='DataFrame.applymap has been deprecated')

    # Ensure we always have a place to store selections
    if 'persisted_selection' not in st.session_state:
        st.session_state['persisted_selection'] = []

    if 'user_list' not in st.session_state or not st.session_state['user_list']:
        return

    df = pd.DataFrame(st.session_state['user_list'])

    # If DataFrame is empty, stop
    if df.empty:
        st.info("No users found.")
        return

    # Example column formatting
    if 'last_login' in df.columns:
        df['last_login'] = pd.to_datetime(df['last_login']).dt.strftime('%Y-%m-%d %H:%M')
    if 'is_active' in df.columns:
        df['is_active'] = df['is_active'].map({True: '✓', False: '×'})
    if 'attributes' in df.columns:
        df['intro'] = df['attributes'].apply(
            lambda x: x.get('intro', '') if isinstance(x, dict) else ''
        )

    # Select and reorder columns (adjust as you prefer)
    columns_to_display = ['pk', 'username', 'name', 'email', 'is_active', 'last_login', 'intro']
    df = df[columns_to_display]

    # Build grid options
    gb = GridOptionsBuilder.from_dataframe(df)
    gb.configure_default_column(resizable=True, filterable=True, sortable=True, editable=False)

    # Configure selection, reapplying existing selection
    gb.configure_selection(
        selection_mode='multiple',
        use_checkbox=True,
        header_checkbox=True,
        # We use "pre_selected_rows" to highlight rows previously selected
        pre_selected_rows=st.session_state['persisted_selection']
    )

    grid_options = gb.build()

    # Show the AgGrid
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

    # If we have a valid grid response, retrieve selected rows
    if grid_response and isinstance(grid_response, dict):
        selected_rows = grid_response.get('selected_rows', [])

        # Store the current selection's row indices in session state
        # (Alternatively, store PK or any other unique field if the DF can reorder)
        st.session_state['persisted_selection'] = [
            row['_selectedRowNodeInfo']['nodeRowIndex'] for row in selected_rows
        ]

        # Display action dropdown if rows are selected
        if selected_rows:
            st.write("---")
            st.write(f"Selected {len(selected_rows)} users")

            action = st.selectbox(
                "Select Action",
                [
                    "Activate", 
                    "Deactivate", 
                    "Reset Password", 
                    "Delete", 
                    "Add Intro", 
                    "Add Invited By", 
                    "Safety Number Change Verified",
                    "Update Email"
                ],
                key="action_selection"
            )

            # Example action-specific inputs
            if action == "Add Intro":
                intro_text = st.text_area("Enter Intro Text", key="intro_input")
            elif action == "Add Invited By":
                invited_by = st.text_input("Enter Invited By", key="invited_by_input")
            elif action == "Safety Number Change Verified":
                verification_context = st.text_area("Enter verification context", key="verification_context")
            elif action == "Update Email":
                for user in selected_rows:
                    st.text_input(
                        f"New email for {user['username']}",
                        key=f"email_{user['pk']}",
                        value=user.get('email', '')
                    )

            if st.button("Apply", key="apply_action"):
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
                
            elif action == "Safety Number Change Verified":
                handle_form_submission(
                    action=action,
                    username=username,
                    verification_context=verification_context
                )
                
        except Exception as e:
            logging.error(f"Error processing action {action} for user {username}: {e}")
            st.error(f"Error processing action {action} for user {username}")
            continue

