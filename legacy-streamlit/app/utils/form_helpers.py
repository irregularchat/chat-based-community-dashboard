"""
Form utility functions for the application.

This module contains utility functions specifically related to form handling
and state management, separated to avoid circular import issues.
"""

import streamlit as st
import logging
import traceback
from app.utils.config import Config
from app.utils.transformations import parse_input

def parse_and_rerun():
    """Callback to parse data and rerun the script so widgets see updated session state."""
    # Check if input is empty
    if not st.session_state.get("parse_data_input_outside", "").strip():
        logging.warning("Parsing called with empty data")
        st.warning("Nothing to parse. Please enter some data first.")
        return  # Just return if there's no data to parse
    
    # Log the input data for debugging
    input_data = st.session_state.get("parse_data_input_outside", "")
    # Save to the preserved data field to ensure it persists
    st.session_state['preserved_parse_data'] = input_data
    
    logging.info(f"Parsing data: {input_data[:100]}..." if len(input_data) > 100 else f"Parsing data: {input_data}")
    
    try:
        # Parse the data from the text area
        parsed = parse_input(input_data)
        
        # Check for error in parsed data
        if isinstance(parsed, dict) and "error" in parsed:
            error_msg = parsed["error"]
            logging.error(f"Error parsing input: {error_msg}")
            st.error(f"Error parsing input: {error_msg}")
            return
        
        if not parsed:
            logging.error("Could not parse the input text, empty result")
            st.error("Could not parse the input text. The parser returned an empty result.")
            return
            
        # Log the parsed data
        logging.info(f"Successfully parsed data: {parsed}")
        
        # Store parsed data in temporary session state variables that can be used after rerun
        # Do NOT modify the widget values directly with _outside suffix
        if "first_name" in parsed:
            st.session_state["_parsed_first_name"] = parsed.get("first_name", "")
            logging.info(f"Set _parsed_first_name to: '{parsed.get('first_name', '')}'")
            
        if "last_name" in parsed:
            st.session_state["_parsed_last_name"] = parsed.get("last_name", "")
            logging.info(f"Set _parsed_last_name to: '{parsed.get('last_name', '')}'")
            
        if "email" in parsed:
            st.session_state["_parsed_email"] = parsed.get("email", "")
            logging.info(f"Set _parsed_email to: '{parsed.get('email', '')}'")
            
        if "invited_by" in parsed:
            st.session_state["_parsed_invited_by"] = parsed.get("invited_by", "")
            logging.info(f"Set _parsed_invited_by to: '{parsed.get('invited_by', '')}'")
            
        if "organization" in parsed:
            st.session_state["_parsed_organization"] = parsed.get("organization", "")
            logging.info(f"Set _parsed_organization to: '{parsed.get('organization', '')}'")
            
        if "intro" in parsed and isinstance(parsed["intro"], dict):
            intro_data = parsed.get("intro", {})
            org = intro_data.get("organization", "")
            interests = intro_data.get("interests", "")
            
            # Set organization and interests as separate fields
            if org:
                st.session_state["_parsed_organization"] = org
                logging.info(f"Set _parsed_organization to: '{org}'")
                
            if interests:
                st.session_state["_parsed_interests"] = interests
                logging.info(f"Set _parsed_interests to: '{interests}'")
            
            # Set the intro field to only contain actual introduction text if any
            intro_text = intro_data.get("text", "")
            if intro_text:
                st.session_state["_parsed_intro"] = intro_text
                logging.info(f"Set _parsed_intro to: '{intro_text}'")
        elif "intro" in parsed and isinstance(parsed["intro"], str):
            # If intro is just a string, use it directly
            st.session_state["_parsed_intro"] = parsed["intro"]
            logging.info(f"Set _parsed_intro to string value: '{parsed['intro']}'")
        
        # Handle additional fields if present in parsed data
        if "signal_username" in parsed:
            st.session_state["_parsed_signal_username"] = parsed.get("signal_username", "")
            logging.info(f"Set _parsed_signal_username to: '{parsed.get('signal_username', '')}'")
            
        if "phone_number" in parsed:
            st.session_state["_parsed_phone_number"] = parsed.get("phone_number", "")
            logging.info(f"Set _parsed_phone_number to: '{parsed.get('phone_number', '')}'")
            
        if "linkedin_username" in parsed:
            st.session_state["_parsed_linkedin_username"] = parsed.get("linkedin_username", "")
            logging.info(f"Set _parsed_linkedin_username to: '{parsed.get('linkedin_username', '')}'")
        
        # Set a flag to indicate parsing was successful
        st.session_state["parsing_successful"] = True
        
        # Display success message and trigger rerun to update form fields
        st.success("Data parsed successfully! Form has been updated with the parsed information.")
        logging.info("Parsing completed successfully")
        
        # Trigger a rerun to update the form fields with parsed data
        try:
            st.rerun()
        except AttributeError:
            # Fall back to experimental_rerun if rerun is not available
            logging.warning("st.rerun() not available, falling back to st.experimental_rerun()")
            st.experimental_rerun()
        
    except Exception as e:
        logging.error(f"Exception during parsing: {str(e)}")
        logging.error(traceback.format_exc())
        st.error(f"An error occurred while parsing: {str(e)}")
    
    
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