import os
import requests
from flask import Flask, request, redirect, session
import logging
import secrets
from urllib.parse import urlencode
import json
import tempfile

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('auth_router')

# This file creates a Flask server route specifically for handling OIDC callbacks
# It creates a simple, reliable approach for authentication without relying on Streamlit's session state

# Determine environment
is_dev = os.environ.get('FLASK_ENV') == 'development'
host = "localhost" if is_dev else "0.0.0.0"
port = int(os.environ.get('AUTH_PORT', 8505))

# Use tempfile directory instead of /tmp to be more cross-platform
temp_dir = tempfile.gettempdir()
logger.info(f"Using temp directory: {temp_dir}")

app = Flask(__name__)
app.secret_key = secrets.token_hex(16)

# Load config from environment
OIDC_CLIENT_ID = os.environ.get('OIDC_CLIENT_ID')
OIDC_CLIENT_SECRET = os.environ.get('OIDC_CLIENT_SECRET')
OIDC_AUTHORIZATION_ENDPOINT = os.environ.get('OIDC_AUTHORIZATION_ENDPOINT')
OIDC_TOKEN_ENDPOINT = os.environ.get('OIDC_TOKEN_ENDPOINT')
OIDC_USERINFO_ENDPOINT = os.environ.get('OIDC_USERINFO_ENDPOINT')
OIDC_REDIRECT_URI = os.environ.get('AUTH_REDIRECT_URI', f"http://localhost:{port}/auth/callback")
STREAMLIT_URL = os.environ.get('STREAMLIT_URL', 'http://localhost:8503')

# Log configuration for debugging
logger.info(f"OIDC_CLIENT_ID: {OIDC_CLIENT_ID}")
logger.info(f"OIDC_AUTHORIZATION_ENDPOINT: {OIDC_AUTHORIZATION_ENDPOINT}")
logger.info(f"OIDC_TOKEN_ENDPOINT: {OIDC_TOKEN_ENDPOINT}")
logger.info(f"OIDC_USERINFO_ENDPOINT: {OIDC_USERINFO_ENDPOINT}")
logger.info(f"OIDC_REDIRECT_URI: {OIDC_REDIRECT_URI}")
logger.info(f"STREAMLIT_URL: {STREAMLIT_URL}")

@app.route('/auth/login')
def login():
    """Start the OIDC authentication flow"""
    # Generate and store a state parameter
    state = secrets.token_hex(16)
    session['oidc_state'] = state
    
    # Build authorization URL
    params = {
        'client_id': OIDC_CLIENT_ID,
        'response_type': 'code',
        'scope': 'openid profile email',
        'redirect_uri': OIDC_REDIRECT_URI,
        'state': state
    }
    
    auth_url = f"{OIDC_AUTHORIZATION_ENDPOINT}?{urlencode(params)}"
    logger.info(f"Redirecting to authorization URL: {auth_url}")
    return redirect(auth_url)

@app.route('/auth/callback')
def auth_callback():
    """Handle the OIDC callback"""
    code = request.args.get('code')
    state = request.args.get('state')
    
    logger.info(f"Auth callback received - code: {code[:5]}... state: {state}")
    
    # Verify state parameter
    if state != session.get('oidc_state'):
        logger.error(f"State mismatch: received {state}, expected {session.get('oidc_state')}")
        return redirect(f"{STREAMLIT_URL}/?auth_error=invalid_state")
    
    # Exchange code for tokens
    token_data = {
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': OIDC_REDIRECT_URI,
        'client_id': OIDC_CLIENT_ID,
        'client_secret': OIDC_CLIENT_SECRET
    }
    
    try:
        logger.info("Exchanging code for tokens...")
        logger.info(f"Token endpoint: {OIDC_TOKEN_ENDPOINT}")
        logger.info(f"Token request data (excluding secret): client_id={OIDC_CLIENT_ID}, redirect_uri={OIDC_REDIRECT_URI}")
        
        # Add request debugging
        token_response = requests.post(
            OIDC_TOKEN_ENDPOINT,
            data=token_data,
            timeout=10
        )
        
        logger.info(f"Token response status code: {token_response.status_code}")
        
        if token_response.status_code != 200:
            logger.error(f"Token error: {token_response.status_code}")
            logger.error(f"Token response content: {token_response.text}")
            # Extract specific error if available
            error_details = "unknown_error"
            try:
                error_json = token_response.json()
                if 'error' in error_json:
                    error_details = error_json['error']
                if 'error_description' in error_json:
                    error_details += f": {error_json['error_description']}"
            except:
                pass
            
            return redirect(f"{STREAMLIT_URL}/?auth_error=token_error:{error_details}")
        
        token_json = token_response.json()
        access_token = token_json.get('access_token')
        
        # Get user info
        logger.info("Getting user info...")
        user_response = requests.get(
            OIDC_USERINFO_ENDPOINT,
            headers={'Authorization': f'Bearer {access_token}'},
            timeout=10
        )
        
        if user_response.status_code != 200:
            logger.error(f"Userinfo error: {user_response.status_code} {user_response.text}")
            return redirect(f"{STREAMLIT_URL}/?auth_error=userinfo_error")
        
        user_data = user_response.json()
        logger.info(f"User authenticated: {user_data.get('preferred_username', 'unknown')}")
        
        # Store user data in session
        session['user_data'] = user_data
        session['authenticated'] = True
        
        # Redirect to Streamlit with auth token for retrieval
        auth_token = secrets.token_hex(16)
        session['auth_token'] = auth_token
        
        # Store user data for retrieval in a secure temp file
        try:
            data_file = os.path.join(temp_dir, f"auth_{auth_token}.json")
            with open(data_file, "w") as f:
                json.dump(user_data, f)
            logger.info(f"User data stored at {data_file}")
        except Exception as file_error:
            logger.error(f"Failed to write auth token file: {file_error}")
            return redirect(f"{STREAMLIT_URL}/?auth_error=file_storage_error")
        
        logger.info(f"Redirecting to Streamlit with auth token: {auth_token[:5]}...")
        return redirect(f"{STREAMLIT_URL}/?auth_token={auth_token}")
        
    except Exception as e:
        logger.error(f"Authentication error: {str(e)}", exc_info=True)
        return redirect(f"{STREAMLIT_URL}/?auth_error={str(e)}")

@app.route('/auth/status')
def auth_status():
    """Return the authentication status and user data"""
    auth_token = request.args.get('auth_token')
    
    if not auth_token:
        logger.error("No auth token provided")
        return {"authenticated": False, "error": "No auth token provided"}, 400
    
    try:
        # Check if user data file exists
        data_file = os.path.join(temp_dir, f"auth_{auth_token}.json")
        if not os.path.exists(data_file):
            logger.error(f"Invalid auth token: {auth_token[:5]}...")
            return {"authenticated": False, "error": "Invalid auth token"}, 401
        
        # Read user data
        with open(data_file, "r") as f:
            user_data = json.load(f)
        
        logger.info(f"Auth status check successful for token: {auth_token[:5]}...")
        return {"authenticated": True, "user_data": user_data}
    except Exception as e:
        logger.error(f"Error checking auth status: {str(e)}", exc_info=True)
        return {"authenticated": False, "error": str(e)}, 500

@app.route('/auth/logout')
def logout():
    """Log the user out"""
    logger.info("Logging out user")
    session.clear()
    return redirect(STREAMLIT_URL)

@app.route('/health')
def health_check():
    """Simple health check endpoint"""
    return {"status": "ok"}

if __name__ == '__main__':
    logger.info(f"Starting auth server on {host}:{port}...")
    app.run(host=host, port=port, debug=is_dev) 