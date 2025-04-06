import streamlit as st
import logging
import uuid
from app.utils.config import Config

def test_login_page():
    """
    A simple page to test OIDC login functionality.
    This page strips away all the complexities of the main app
    to focus only on authentication.
    """
    st.title("Authentication Test Page")
    
    # Display the current OIDC configuration
    with st.expander("OIDC Configuration"):
        st.write({
            "OIDC_CLIENT_ID": Config.OIDC_CLIENT_ID,
            "OIDC_AUTHORIZATION_ENDPOINT": Config.OIDC_AUTHORIZATION_ENDPOINT,
            "OIDC_TOKEN_ENDPOINT": Config.OIDC_TOKEN_ENDPOINT,
            "OIDC_USERINFO_ENDPOINT": Config.OIDC_USERINFO_ENDPOINT,
            "OIDC_REDIRECT_URI": Config.OIDC_REDIRECT_URI,
            "OIDC_SCOPES": Config.OIDC_SCOPES
        })
    
    # Display the current session state
    with st.expander("Current Session State"):
        st.write({k: v for k, v in st.session_state.items() if k not in ['_secrets', 'password']})
    
    # Test login functionality
    st.subheader("Test Login")
    
    if st.button("Test Login Flow"):
        # Generate state parameter
        state = str(uuid.uuid4())
        st.session_state['auth_state'] = state
        
        # Create login URL
        login_url = build_login_url(state)
        
        # Log the login attempt
        logging.info(f"Test login initiated with state: {state}")
        logging.info(f"Login URL: {login_url}")
        
        # Redirect to login page
        st.markdown(f'<meta http-equiv="refresh" content="0;URL=\'{login_url}\'">', unsafe_allow_html=True)
        st.markdown(f'[Click here if not redirected automatically]({login_url})')
    
    # Test callback handling
    st.subheader("Callback Testing")
    
    # Get query parameters
    query_params = st.query_params
    if 'code' in query_params and 'state' in query_params:
        st.success("Authentication callback detected!")
        
        # Display callback parameters
        st.write({
            "code": f"{query_params.get('code')[:5]}...",
            "state": query_params.get('state'),
            "expected_state": st.session_state.get('auth_state')
        })
        
        # Check state match
        expected_state = st.session_state.get('auth_state')
        received_state = query_params.get('state')
        
        if received_state == expected_state:
            st.success("State parameter matches! This indicates session state is being preserved correctly.")
        else:
            st.error(f"State mismatch! Received: {received_state}, Expected: {expected_state}")
            st.warning("This indicates a session state persistence issue. Check Streamlit server settings.")
        
        # Option to clear parameters
        if st.button("Clear Query Parameters"):
            for param in list(query_params.keys()):
                del query_params[param]
            st.rerun()
    
    # Option to reset session state
    if st.button("Reset Session State"):
        for key in list(st.session_state.keys()):
            del st.session_state[key]
        st.success("Session state cleared!")
        st.rerun()

def build_login_url(state):
    """Build the login URL with the given state parameter."""
    import urllib.parse
    
    params = {
        'client_id': Config.OIDC_CLIENT_ID,
        'response_type': 'code',
        'scope': ' '.join(Config.OIDC_SCOPES),
        'redirect_uri': Config.OIDC_REDIRECT_URI,
        'state': state
    }
    
    return f"{Config.OIDC_AUTHORIZATION_ENDPOINT}?{urllib.parse.urlencode(params)}" 