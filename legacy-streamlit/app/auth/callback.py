import streamlit as st
import logging
import traceback
from app.auth.authentication import handle_auth_callback
import time
import os

def auth_callback():
    """
    Handle the authentication callback from Authentik.
    This function should be called when the user is redirected back from Authentik.
    """
    # Add debug logging
    logging.info("Auth callback function called")
    
    # Get query parameters immediately
    query_params = st.query_params
    logging.info(f"Query parameters received: {dict(query_params)}")
    
    # Check if we're in test mode
    is_test = os.environ.get('TEST_MODE', 'false').lower() == 'true'
    
    if not is_test:
        # Show loading UI for production
        st.markdown("""
        <div style="padding: 20px; text-align: center;">
            <h1>Authentication Processing</h1>
            <p>Please wait while we process your login...</p>
            <div style="margin: 30px 0;">
                <div style="border: 16px solid #f3f3f3; border-top: 16px solid #2e6fac; 
                            border-radius: 50%; width: 120px; height: 120px; margin: 0 auto;
                            animation: spin 2s linear infinite;">
                </div>
            </div>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
            
            <p>If you're not redirected in 5 seconds, <a href="/">click here</a> to go to the dashboard.</p>
            
            <script>
                // Always redirect after 5 seconds
                setTimeout(function() {
                    window.location.href = '/';
                }, 5000);
            </script>
        </div>
        """, unsafe_allow_html=True)
    
    # Create a title to ensure the page isn't blank
    st.title("Authentication Response")
    
    # Get the authorization code and state from query parameters
    code = query_params.get('code')
    state = query_params.get('state')
    
    if not code or not state:
        st.error("Missing required parameters in authentication callback")
        return False
    
    # Handle the authentication callback
    success = handle_auth_callback(code, state)
    
    if success:
        if not is_test:
            st.success("Authentication successful! Redirecting...")
            time.sleep(1)  # Give time to see the success message
            st.rerun()
        return True
    else:
        if not is_test:
            st.error("Authentication failed. Please try again.")
        return False
