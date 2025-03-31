import streamlit as st
import logging
from app.auth.authentication import handle_auth_callback

def auth_callback():
    """
    Handle the authentication callback from Authentik.
    This function should be called when the user is redirected back from Authentik.
    """
    # Get query parameters
    query_params = st.query_params
    
    # Check if this is an authentication callback
    if 'code' in query_params and 'state' in query_params:
        code = query_params.get('code')
        state = query_params.get('state')
        
        # Handle the authentication
        success = handle_auth_callback(code, state)
        
        if success:
            # Clear the query parameters (using the newer API)
            # Instead of st.experimental_set_query_params()
            for param in list(query_params.keys()):
                del query_params[param]
            
            # Redirect to the original page if available
            redirect_path = st.session_state.get('auth_redirect_path')
            if redirect_path:
                st.session_state['current_page'] = redirect_path
                del st.session_state['auth_redirect_path']
            
            st.success("Successfully logged in!")
            st.experimental_rerun()
        else:
            st.error("Authentication failed. Please try again.")
