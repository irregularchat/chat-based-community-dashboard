import streamlit as st
import logging
import traceback
from app.auth.authentication import handle_auth_callback
import time

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
    
    # CRITICAL: Add raw HTML rendering as fallback
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
    
    # Check if auth has already been processed to prevent double processing
    if st.session_state.get('auth_processed'):
        st.success("Authentication already processed. Redirecting to dashboard...")
        st.markdown('<meta http-equiv="refresh" content="1;URL=\'/\'">', unsafe_allow_html=True)
        return
    
    # Display debug info on screen for troubleshooting
    st.write("### Authentication Debug Info")
    st.write(f"Query Parameters: {dict(query_params)}")
    st.write(f"Session State Keys: {list(st.session_state.keys())}")
    st.write(f"Auth State Match: {'auth_state' in st.session_state}")
    
    # Check if error is present
    if 'error' in query_params:
        error = query_params.get('error')
        error_description = query_params.get('error_description', 'No description provided')
        logging.error(f"Authentication error: {error} - {error_description}")
        st.error(f"Authentication failed: {error}")
        st.warning(f"Error description: {error_description}")
        return
    
    # Check if this is an authentication callback
    if 'code' in query_params and 'state' in query_params:
        st.info("Processing authentication...")
        
        code = query_params.get('code')
        state = query_params.get('state')
        
        logging.info(f"Code: {code[:5]}... (truncated), State: {state}")
        
        # Handle the authentication
        try:
            success = handle_auth_callback(code, state)
            
            if success:
                logging.info("Authentication successful")
                
                # Mark that we've processed this authentication to prevent loops
                st.session_state['auth_processed'] = True
                
                # Show success message with direct links for navigation
                st.success("Authentication successful!")
                
                # Add small delay to allow session state to stabilize before redirect
                time.sleep(0.5)
                
                # Provide navigation buttons
                col1, col2, col3 = st.columns(3)
                with col1:
                    if st.button("Go to Dashboard"):
                        st.switch_page("app/main.py")
                with col2:
                    if st.button("Create User"):
                        st.session_state['current_page'] = 'Create User'
                        st.rerun()
                with col3:
                    if st.button("Manage Users"):
                        st.session_state['current_page'] = 'List & Manage Users'
                        st.rerun()
                
                # Direct links (more reliable than buttons)
                st.markdown("""
                <div style="text-align: center; padding: 20px; background-color: #e8f5e9; border-radius: 10px; margin: 20px 0;">
                    <h2 style="color: #2e7d32;">✅ Successfully logged in!</h2>
                    <p style="font-size: 16px; margin: 10px 0;">Please click one of these links to continue:</p>
                    <div style="margin: 15px 0;">
                        <a href="/" style="background-color: #4CAF50; color: white; padding: 10px 20px; 
                                        text-decoration: none; border-radius: 4px; margin: 10px; display: inline-block;">
                            Go to Dashboard
                        </a>
                        <a href="/?page=auth_debug" style="background-color: #2196F3; color: white; padding: 10px 20px; 
                                                text-decoration: none; border-radius: 4px; margin: 10px; display: inline-block;">
                            Authentication Debug
                        </a>
                    </div>
                </div>
                """, unsafe_allow_html=True)
                
                # Display user info
                user_info = st.session_state.get('user_info', {})
                if user_info:
                    st.write("### User Information")
                    st.json({
                        "username": user_info.get('preferred_username', 'Not provided'),
                        "email": user_info.get('email', 'Not provided'),
                        "is_admin": st.session_state.get('is_admin', False)
                    })
            else:
                st.error("Authentication failed. Please try again.")
                
                # Add more details to help debugging
                st.markdown("""
                <div style="background-color: #f8d7da; padding: 10px; border-radius: 5px; margin-top: 10px;">
                <p>Authentication failed. This could be due to:</p>
                <ul>
                    <li>Invalid or expired authentication code</li>
                    <li>Mismatched redirect URI</li>
                    <li>CSRF state mismatch</li>
                    <li>Problem with the OIDC provider</li>
                </ul>
                <p>Please check the application logs for more details.</p>
                </div>
                """, unsafe_allow_html=True)
                
                # Provide a "Try Again" button
                if st.button("Try Again"):
                    from app.auth.authentication import get_login_url
                    login_url = get_login_url()
                    st.markdown(f'<meta http-equiv="refresh" content="0;URL=\'{login_url}\'">', unsafe_allow_html=True)
        except Exception as e:
            # Log the full stack trace
            logging.error(f"Exception during authentication: {e}")
            logging.error(traceback.format_exc())
            
            # Show error to user
            st.error(f"Authentication error: {str(e)}")
            st.warning("Please try again or contact support if the issue persists.")
    else:
        # No callback parameters found
        st.warning("No authentication callback parameters found in the URL")
        
        # Provide a link to start authentication
        if st.button("Start Authentication"):
            from app.auth.authentication import get_login_url
            login_url = get_login_url()
            st.markdown(f'<meta http-equiv="refresh" content="0;URL=\'{login_url}\'">', unsafe_allow_html=True)
