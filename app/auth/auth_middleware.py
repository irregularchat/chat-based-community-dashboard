import streamlit as st
from app.auth.authentication import is_authenticated, require_authentication
from app.auth.local_auth import is_local_admin
import logging

def auth_middleware(page_function):
    """
    Middleware to check authentication before rendering a page.
    
    Args:
        page_function: The function that renders the page
        
    Returns:
        function: A wrapped function that checks authentication first
    """
    def wrapper(*args, **kwargs):
        # Get the current page path
        page_path = st.session_state.get('current_page')
        
        # Check if user is authenticated
        if not is_authenticated():
            # Display login button instead of the requested page
            from app.ui.common import display_login_button
            st.markdown("## Authentication Required")
            st.markdown("Please log in to access this page.")
            display_login_button()
            return
        
        # If authenticated, render the page
        return page_function(*args, **kwargs)
    
    return wrapper

def admin_middleware(page_function):
    """
    Middleware to check admin permissions before rendering a page.
    
    Args:
        page_function: The function that renders the page
        
    Returns:
        function: A wrapped function that checks admin permissions first
    """
    def wrapper(*args, **kwargs):
        # First check authentication
        if not is_authenticated():
            # Display login button instead of the requested page
            from app.ui.common import display_login_button
            st.markdown("## Authentication Required")
            st.markdown("Please log in to access this page.")
            display_login_button()
            return
        
        # Then check admin permissions (either SSO admin or local admin)
        is_admin = st.session_state.get('is_admin', False) or is_local_admin()
        
        if not is_admin:
            st.error("You do not have permission to access this page")
            st.info("This page requires administrator privileges. Please contact an administrator if you need access.")
            return
        
        # If admin, render the page
        return page_function(*args, **kwargs)
    
    return wrapper