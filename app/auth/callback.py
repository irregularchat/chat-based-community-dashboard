import streamlit as st
import logging
from app.auth.authentication import handle_auth_callback

def auth_callback():
    """
    Handle the authentication callback from Authentik.
    This function should be called when the user is redirected back from Authentik.
    """
    # Add debug logging
    logging.info("Auth callback function called")
    
    # Get query parameters
    query_params = st.query_params
    
    # Debug log the query parameters
    logging.info(f"Query parameters received: {dict(query_params)}")
    
    # Check if this is an authentication callback
    if 'code' in query_params and 'state' in query_params:
        logging.info("Found code and state in query parameters")
        
        code = query_params.get('code')
        state = query_params.get('state')
        
        logging.info(f"Code: {code[:5]}... (truncated), State: {state}")
        
        # Handle the authentication
        success = handle_auth_callback(code, state)
        
        if success:
            logging.info("Authentication successful, clearing parameters and redirecting")
            # Clear the query parameters (using the newer API)
            # Instead of st.experimental_set_query_params()
            try:
                for param in list(query_params.keys()):
                    del query_params[param]
                logging.info("Query parameters cleared successfully")
            except Exception as e:
                logging.error(f"Error clearing query parameters: {e}")
            
            # Redirect to the original page if available
            redirect_path = st.session_state.get('auth_redirect_path')
            if redirect_path:
                logging.info(f"Redirecting to original path: {redirect_path}")
                st.session_state['current_page'] = redirect_path
                del st.session_state['auth_redirect_path']
            
            st.success("Successfully logged in!")
            
            # Force a rerun to refresh the page
            try:
                st.rerun()
            except Exception as e:
                logging.error(f"Error during rerun: {e}")
                # Fallback to manual redirect - use base URL instead of trying to get query params
                st.markdown('''
                <meta http-equiv="refresh" content="1;url=/">
                ''', unsafe_allow_html=True)
        else:
            logging.error("Authentication failed")
            st.error("Authentication failed. Please try again.")
    else:
        # No callback parameters found
        logging.info("No authentication callback parameters found")
