# ui/forms.py
import streamlit as st
from utils.transformations import parse_input
from datetime import datetime, timedelta
from utils.helpers import update_username, get_eastern_time
import re
import pandas as pd
import json
import logging
from st_aggrid import AgGrid, GridOptionsBuilder, DataReturnMode, GridUpdateMode
import time

def render_create_user_form():
    # Initialize session state keys
    for key in ["username_input", "first_name_input", "last_name_input", "invited_by_input", "email_input", "data_to_parse_input", "intro_input"]:
        if key not in st.session_state:
            st.session_state[key] = ""

    # Define a callback to update the username
    def update_username_callback():
        update_username()

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

    # Update the username before rendering the form
    update_username()

    # Inputs outside the form to allow callbacks
    col1, col2 = st.columns(2)
    with col1:
        first_name = st.text_input(
            "Enter First Name", 
            key="first_name_input",
            placeholder="e.g., John",
            on_change=update_username_callback
        )
    with col2:
        last_name = st.text_input(
            "Enter Last Name", 
            key="last_name_input",
            placeholder="e.g., Doe",
            on_change=update_username_callback
        )

    with st.form("create_user_form"):
        # Draw input widgets referencing session state as the source of truth
        username = st.text_input(
            "Enter Username", 
            key="username_input",
            placeholder="e.g., johndoe123"
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
            # This is a hack to focus the data_to_parse_input box when the page loads
            """
            <style>
            .data-to-parse {
                background-color: #e0e0e0;  /* Lighter shade for distinction */
                padding: 10px;
                border-radius: 5px;
            }
            </style>
            <script>
            document.addEventListener('DOMContentLoaded', function() {
                document.getElementById('data_to_parse_input').focus();
            });
            </script>
            """,
            unsafe_allow_html=True
        )

        st.markdown('<div class="data-to-parse">', unsafe_allow_html=True)
        data_to_parse = st.text_area(
            "Data to Parse", 
            key="data_to_parse_input", 
            height=180,
            placeholder="(Optional Method. Take User's Intro and parse it.) \n1. John Doe\n2. TechCorp\n3. @janedoe\n4. johndoe@example.com\n5. Interested in AI, ML, and Data Science"
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
    
    # Get the current Eastern Time
    eastern_now = get_eastern_time(datetime.now().date(), datetime.now().time())
    expires_default = eastern_now + timedelta(hours=2)
    
    expires_date = st.date_input("Enter Expiration Date", value=expires_default.date(), key="expires_date")
    expires_time = st.time_input("Enter Expiration Time", value=expires_default.time(), key="expires_time")
    
    # Convert to Eastern Time
    eastern_time = get_eastern_time(expires_date, expires_time)
    
    return invite_label, eastern_time.date(), eastern_time.time()

def display_user_list(auth_api_url, headers):
    if 'user_list' not in st.session_state or not st.session_state['user_list']:
        return

    # Cache the DataFrame in session state
    if 'df_cache' not in st.session_state:
        df = pd.DataFrame(st.session_state['user_list'])
        st.session_state['df_cache'] = df
    else:
        df = st.session_state['df_cache']

    # Only update cache if user list has changed
    if len(st.session_state['user_list']) != len(st.session_state['df_cache']):
        df = pd.DataFrame(st.session_state['user_list'])
        st.session_state['df_cache'] = df

    # Generate a unique identifier for this instance using timestamp
    form_id = str(int(time.time() * 1000))  # millisecond timestamp
    
    if 'user_list' in st.session_state and len(st.session_state['user_list']) > 0:
        users = st.session_state['user_list']
        st.subheader("User List")

        # Format last_login to be more readable
        if 'last_login' in df.columns:
            df['last_login'] = pd.to_datetime(df['last_login']).dt.strftime('%Y-%m-%d %H:%M')

        # Convert is_active to more compact display
        if 'is_active' in df.columns:
            df['is_active'] = df['is_active'].map({True: '✓', False: '×'})

        # Process attributes to extract intro
        if 'attributes' in df.columns:
            df['intro'] = df['attributes'].apply(
                lambda x: x.get('intro', '') if isinstance(x, dict) else ''
            )

        # Limit and reorder the displayed columns
        display_columns = ['username', 'name', 'is_active', 'last_login', 'email', 'intro']
        display_columns = [col for col in display_columns if col in df.columns]

        # Include 'id' and 'pk' columns if they exist (but hide them)
        identifier_columns = ['id', 'pk']
        available_identifier_columns = [col for col in identifier_columns if col in df.columns]

        if len(available_identifier_columns) == 0:
            st.error("User data does not contain 'id' or 'pk' fields required for performing actions.")
            logging.error("No 'id' or 'pk' fields in user data.")
            return

        # Combine columns to be used in the DataFrame
        all_columns = display_columns + available_identifier_columns
        df = df[all_columns]

        # Action dropdown and Apply button above the table
        action_col, button_col = st.columns([3, 1])
        with action_col:
            action = st.selectbox(
                "Select Action",
                options=[
                    "Activate", "Deactivate", "Reset Password", "Delete", 
                    "Add Intro", "Add Invited By"
                ],
                key=f"action_selectbox_{form_id}"
            )
            
            # Add action-specific inputs here
            if action == "Reset Password":
                use_password_generator = st.checkbox(
                    "Use Password Generator",
                    value=True,
                    key=f"use_password_generator_{form_id}"
                )
                if not use_password_generator:
                    new_password = st.text_input(
                        "Enter new password",
                        type="password",
                        key=f"new_password_{form_id}"
                    )
            elif action == "Add Intro":
                intro_text = st.text_area(
                    "Enter Intro Text",
                    height=2,
                    key=f"intro_text_{form_id}"
                )
            elif action == "Add Invited By":
                invited_by = st.text_input(
                    "Enter Invited By",
                    key=f"invited_by_{form_id}"
                )
        
        with button_col:
            apply_button = st.button("Apply", key=f"apply_button_{form_id}")

        # Configure pagination
        page_size = st.selectbox(
            "Page Size",
            options=[100, 250, 500, 1000],
            index=2,
            key=f"page_size_{form_id}"
        )

        # Build AgGrid options
        gb = GridOptionsBuilder.from_dataframe(df)
        
        # Configure default column properties
        gb.configure_default_column(
            resizable=True,
            filterable=True,
            sortable=True,
            editable=False
        )

        # Configure specific column properties
        gb.configure_column('is_active', width=80)
        gb.configure_column('last_login', width=130)
        gb.configure_column('username', width=120)
        gb.configure_column('name', width=120)
        gb.configure_column('email', width=200)
        gb.configure_column('intro', width=200)
        
        # Hide identifier columns
        gb.configure_columns(available_identifier_columns, hide=True)
        
        # Configure selection
        gb.configure_selection(
            selection_mode='multiple',
            use_checkbox=True,
            header_checkbox=True,
            suppressRowDeselection=False,
            suppressRowClickSelection=True
        )
        
        # Configure pagination
        gb.configure_pagination(
            enabled=True,
            paginationAutoPageSize=False,
            paginationPageSize=page_size
        )
        
        # Build grid options
        grid_options = gb.build()

        # Display AgGrid table
        grid_response = AgGrid(
            df,
            gridOptions=grid_options,
            data_return_mode=DataReturnMode.FILTERED_AND_SORTED,
            update_mode=GridUpdateMode.MODEL_CHANGED | GridUpdateMode.SELECTION_CHANGED,
            fit_columns_on_grid_load=True,
            theme='alpine',
            height=600,
            allow_unsafe_jscode=True,
            key=f"grid_{form_id}"
        )

        # Handle actions when Apply button is clicked
        if apply_button and len(grid_response['selected_rows']) > 0:
            selected_users = grid_response['selected_rows']
            if action == "Activate":
                st.success(f"Activated {len(selected_users)} users")
            elif action == "Deactivate":
                st.success(f"Deactivated {len(selected_users)} users")
            elif action == "Reset Password":
                st.success(f"Reset password for {len(selected_users)} users")
            elif action == "Delete":
                st.success(f"Deleted {len(selected_users)} users")
            elif action == "Add Intro":
                st.success(f"Updated intro for {len(selected_users)} users")
            elif action == "Add Invited By":
                st.success(f"Updated invited by for {len(selected_users)} users")

