# /auth/session_init.py
import streamlit as st

def initialize_session_state():
    """
    Ensure session state initialization for user_list, selected_users, operation_selection,
    and any additional session state variables.
    """
    # Initialize user_list if it doesn't exist
    if 'user_list' not in st.session_state:
        st.session_state['user_list'] = []

    # Initialize selected_users if it doesn't exist
    if 'selected_users' not in st.session_state:
        st.session_state['selected_users'] = []

    # Initialize operation_selection with a default value if it doesn't exist
    if 'operation_selection' not in st.session_state:
        st.session_state['operation_selection'] = 'Create User'

    # Example of adding a new session state variable
    if 'is_authenticated' not in st.session_state:
        st.session_state['is_authenticated'] = False  # Default to not authenticated

    # Example of adding a timestamp for session start
    if 'session_start_time' not in st.session_state:
        st.session_state['session_start_time'] = None  # Initialize with None or a specific timestamp
