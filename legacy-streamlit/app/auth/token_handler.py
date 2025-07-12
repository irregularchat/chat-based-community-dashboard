import streamlit as st
import logging
import requests
import os
import time
import traceback
from urllib.parse import urlencode
from app.utils.config import Config

def token_handler_page():
    """
    A dedicated page for handling OAuth tokens outside of callback.py
    This is a more reliable way to handle authentication when the callback page has issues.
    """
    st.markdown("""
    <style>
        .auth-container {
            padding: 20px;
            border-radius: 10px;
            background-color: #f8f9fa;
            margin: 20px 0;
        }
        .spinner {
            border: 16px solid #f3f3f3;
            border-top: 16px solid #3498db;
            border-radius: 50%;
            width: 80px;
            height: 80px;
            animation: spin 2s linear infinite;
            margin: 20px auto;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
    """, unsafe_allow_html=True)
    
    st.title("Authentication Token Handler")
    
    query_params = st.query_params
    
    # If no code and state, show the form to paste them manually
    if 'code' not in query_params or 'state' not in query_params:
        st.info("No authentication code detected in URL. You can either:")
        
        method = st.radio(
            "Choose an option:",
            ["Restart login process", "Enter code manually"],
            index=0
        )
        
        if method == "Restart login process":
            # Generate a new state
            import uuid
            state = str(uuid.uuid4())
            st.session_state['auth_state'] = state
            
            # Create login URL
            params = {
                'client_id': Config.OIDC_CLIENT_ID,
                'response_type': 'code',
                'scope': ' '.join(Config.OIDC_SCOPES),
                'redirect_uri': Config.OIDC_REDIRECT_URI,
                'state': state
            }
            auth_url = f"{Config.OIDC_AUTHORIZATION_ENDPOINT}?{urlencode(params)}"
            
            st.markdown(f"""
            <div class="auth-container">
                <h3>Click the button below to start authentication:</h3>
                <p>You will be redirected to Authentik to login. After successful login, you should be redirected back here.</p>
                <a href="{auth_url}" style="display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; 
                        text-decoration: none; border-radius: 5px; margin-top: 10px;">
                    Start Authentication
                </a>
            </div>
            """, unsafe_allow_html=True)
        else:
            # Manual code entry option
            st.write("#### Enter Authentication Details")
            st.write("If you were redirected to a blank page, you can copy the code and state from the URL.")
            st.write("URL format: `http://localhost:8503/auth/callback?code=YOUR_CODE&state=YOUR_STATE`")
            
            manual_code = st.text_input("Enter code from URL:")
            manual_state = st.text_input("Enter state from URL:")
            
            if st.button("Process Manual Authentication") and manual_code and manual_state:
                # Set these as query parameters
                st.query_params.update({
                    'code': manual_code,
                    'state': manual_state
                })
                st.rerun()
    else:
        # Has code and state in URL
        code = query_params.get('code')
        state = query_params.get('state')
        
        st.markdown("""
        <div class="auth-container">
            <h3>Processing Authentication...</h3>
            <div class="spinner"></div>
            <p>Please wait while we validate your authentication...</p>
        </div>
        """, unsafe_allow_html=True)
        
        # Process the token exchange
        try:
            # 1. Exchange code for token
            with st.spinner("Exchanging code for token..."):
                from requests.auth import HTTPBasicAuth
                
                # First try using HTTP Basic Auth (preferred by many OIDC providers)
                auth = HTTPBasicAuth(Config.OIDC_CLIENT_ID, Config.OIDC_CLIENT_SECRET)
                
                # Don't include client_id and client_secret in the request body
                data = {
                    'grant_type': 'authorization_code',
                    'code': code,
                    'redirect_uri': Config.OIDC_REDIRECT_URI
                }
                
                headers = {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                }
                
                st.info("Trying HTTP Basic Authentication...")
                token_response = requests.post(
                    Config.OIDC_TOKEN_ENDPOINT,
                    data=data,
                    headers=headers,
                    auth=auth,
                    timeout=10
                )
                
                # If that fails, try with credentials in request body
                if token_response.status_code in (400, 401):
                    st.info("Basic auth failed, trying credentials in request body...")
                    data = {
                        'grant_type': 'authorization_code',
                        'code': code,
                        'client_id': Config.OIDC_CLIENT_ID,
                        'client_secret': Config.OIDC_CLIENT_SECRET,
                        'redirect_uri': Config.OIDC_REDIRECT_URI
                    }
                    token_response = requests.post(
                        Config.OIDC_TOKEN_ENDPOINT,
                        data=data,
                        headers=headers,
                        timeout=10
                    )
                
                # If that still fails, try JSON format
                if token_response.status_code in (400, 401, 405):
                    st.info("Form data methods failed, trying JSON format...")
                    headers = {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                    token_response = requests.post(
                        Config.OIDC_TOKEN_ENDPOINT,
                        json=data,
                        headers=headers,
                        timeout=10
                    )
            
            if token_response.status_code != 200:
                st.error(f"Error retrieving token: Status {token_response.status_code}")
                st.json(token_response.json() if token_response.content else {"error": "No content returned"})
                return
            
            tokens = token_response.json()
            
            # Store tokens
            st.session_state['access_token'] = tokens.get('access_token')
            st.session_state['refresh_token'] = tokens.get('refresh_token', '')
            st.session_state['id_token'] = tokens.get('id_token', '')
            st.session_state['token_expiry'] = time.time() + tokens.get('expires_in', 3600)
            
            # 2. Get user info
            with st.spinner("Retrieving user information..."):
                userinfo_response = requests.get(
                    Config.OIDC_USERINFO_ENDPOINT,
                    headers={'Authorization': f'Bearer {st.session_state["access_token"]}'},
                    timeout=10
                )
            
            if userinfo_response.status_code != 200:
                st.error(f"Error retrieving user info: Status {userinfo_response.status_code}")
                st.json(userinfo_response.json() if userinfo_response.content else {"error": "No content returned"})
                return
            
            user_info = userinfo_response.json()
            
            # Store user info
            st.session_state['user_info'] = user_info
            st.session_state['username'] = user_info.get('preferred_username', '')
            st.session_state['email'] = user_info.get('email', '')
            
            # Check if user is admin
            admin_usernames = Config.ADMIN_USERNAMES
            username = user_info.get('preferred_username', '')
            st.session_state['is_admin'] = username in admin_usernames if admin_usernames else False
            
            # Mark as authenticated
            st.session_state['is_authenticated'] = True
            
            # Success message
            st.success("Authentication successful!")
            st.markdown(f"""
            <div class="auth-container" style="background-color: #e8f5e9;">
                <h3>Welcome, {user_info.get('preferred_username', 'User')}!</h3>
                <p>You have been successfully authenticated.</p>
                <a href="/" style="display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; 
                        text-decoration: none; border-radius: 5px; margin-top: 10px;">
                    Go to Dashboard
                </a>
            </div>
            """, unsafe_allow_html=True)
            
            # Display user info
            with st.expander("View User Information"):
                st.json(user_info)
            
            # Clear the URL parameters after successful authentication
            st.query_params.clear()
            
        except Exception as e:
            st.error(f"Authentication error: {str(e)}")
            st.write("Error details:")
            st.code(traceback.format_exc())
            
            st.write("#### Try Again")
            if st.button("Restart Authentication"):
                st.query_params.clear()
                st.rerun() 