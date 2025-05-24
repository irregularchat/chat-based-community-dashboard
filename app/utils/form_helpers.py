"""
Form utility functions for the application.

This module contains utility functions specifically related to form handling
and state management, separated to avoid circular import issues.
"""

import streamlit as st
import logging
from app.utils.config import Config


def reset_create_user_form_fields():
    """
    Helper function to reset all fields related to create user form.
    
    This function is moved here from ui.forms to resolve circular import issues
    between utils.helpers and ui.forms modules.
    """
    # List of keys to reset
    keys_to_reset = [
        "username_input",
        "username_input_outside",
        "first_name_input",
        "first_name_input_outside",
        "last_name_input",
        "last_name_input_outside",
        "email_input",
        "invited_by_input",
        "data_to_parse_input",
        "intro_input",
        "is_admin_checkbox",
        "username_was_auto_generated",
        "organization_input",
        "organization_input_outside",
        "interests_input",
        "interests_input_outside",
        "signal_username_input",
        "signal_username_input_outside",
        "phone_number_input",
        "phone_number_input_outside",
        "linkedin_username_input",
        "linkedin_username_input_outside",
        "parse_data_input_outside",
        # Add Matrix-related state variables
        "matrix_user_id",
        "matrix_user_select",
        "matrix_user_selected",
        "recommended_rooms",
        "selected_rooms",
        "group_selection"
    ]
    
    # Clear the values in session state
    for key in keys_to_reset:
        if key in st.session_state:
            del st.session_state[key]
    
    # Clear any parsed data
    for key in list(st.session_state.keys()):
        if key.startswith('_parsed'):
            del st.session_state[key]
            
    # Reset Matrix-related flags
    st.session_state["recommended_rooms"] = []
    st.session_state["selected_rooms"] = set()
    
    # Reset parsing flags
    st.session_state["parsing_successful"] = False
    if 'clear_fields' in st.session_state:
        del st.session_state['clear_fields']
    if 'old_values' in st.session_state:
        del st.session_state['old_values']
    
    # Set a flag in session state to indicate we should clear fields
    st.session_state['clear_fields'] = True
    
    # Store current values temporarily to detect changes
    old_values = {key: st.session_state.get(key, "") for key in keys_to_reset}
    st.session_state['old_values'] = old_values
    
    # Clear the values
    for key in keys_to_reset:
        if key in st.session_state:
            st.session_state[key] = ""
    
    # Handle group selection separately - reset to default MAIN_GROUP_ID
    main_group_id = Config.MAIN_GROUP_ID
    st.session_state['selected_groups'] = [main_group_id] if main_group_id else []
    st.session_state['group_selection'] = [main_group_id] if main_group_id else []


def clear_session_state_pattern(pattern: str):
    """
    Clear session state keys that match a specific pattern.
    
    Args:
        pattern: String pattern to match against session state keys
    """
    keys_to_clear = [key for key in st.session_state.keys() if pattern in key]
    for key in keys_to_clear:
        del st.session_state[key]
    logging.info(f"Cleared {len(keys_to_clear)} session state keys matching pattern: {pattern}")


def reset_form_section(section_name: str, fields: list):
    """
    Reset a specific section of form fields.
    
    Args:
        section_name: Name of the form section for logging
        fields: List of field names to reset
    """
    cleared_count = 0
    for field in fields:
        if field in st.session_state:
            del st.session_state[field]
            cleared_count += 1
    
    logging.info(f"Reset {cleared_count} fields in {section_name} section") 