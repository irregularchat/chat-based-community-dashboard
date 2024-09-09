# /auth/session_init.py
import streamlit as st

def initialize_session_state():
    """
    Ensure session state initialization for user_list, selected_users, and operation_selection.
    """
    if 'user_list' not in st.session_state:
        st.session_state['user_list'] = []  # Initialize an empty list if it doesn't exist

    if 'selected_users' not in st.session_state:
        st.session_state['selected_users'] = []  # Initialize an empty list for selected users

    if 'operation_selection' not in st.session_state:
        st.session_state['operation_selection'] = 'Create User'  # Default operation
