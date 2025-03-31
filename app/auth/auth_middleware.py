import streamlit as st
from app.auth.authentication import is_authenticated, require_authentication
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
        if not require_authentication(page_path):
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
        page_path = st.session_state.get('current_page')
        if not require_authentication(page_path):
            return
        
        # Then check admin permissions
        if not st.session_state.get('is_admin', False):
            st.error("You do not have permission to access this page")
            return
        
        # If admin, render the page
        return page_function(*args, **kwargs)
    
    return wrapper
