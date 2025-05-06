#!/usr/bin/env python3
import os
import subprocess
import sys
import time
import signal
import socket
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Function to check if a port is available
def is_port_available(port):
    """Check if a port is available by attempting to bind to it."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('localhost', port))
            return True
        except OSError:
            return False

# Function to find an available port starting from a given port
def find_available_port(start_port, max_attempts=10):
    """Find an available port starting from start_port."""
    port = start_port
    attempts = 0
    
    while attempts < max_attempts:
        if is_port_available(port):
            return port
        port += 1
        attempts += 1
    
    raise RuntimeError(f"Could not find an available port after {max_attempts} attempts")

# Default ports
STREAMLIT_PORT = int(os.environ.get('PORT', '8503'))
AUTH_PORT_START = int(os.environ.get('AUTH_PORT', '8505'))

# Find an available port for the auth server
try:
    AUTH_PORT = find_available_port(AUTH_PORT_START)
    print(f"Using auth server port: {AUTH_PORT}")
except RuntimeError as e:
    print(f"Error: {e}")
    sys.exit(1)

# Set environment variables for authentication
os.environ['STREAMLIT_URL'] = f"http://localhost:{STREAMLIT_PORT}"
os.environ['AUTH_REDIRECT_URI'] = f"http://localhost:{STREAMLIT_PORT}/auth/callback"
os.environ['AUTH_PORT'] = str(AUTH_PORT)

# Load OIDC config from .env file
required_env_vars = [
    'OIDC_CLIENT_ID', 
    'OIDC_CLIENT_SECRET', 
    'OIDC_AUTHORIZATION_ENDPOINT', 
    'OIDC_TOKEN_ENDPOINT', 
    'OIDC_USERINFO_ENDPOINT'
]

missing_vars = [var for var in required_env_vars if not os.environ.get(var)]
if missing_vars:
    print(f"Error: Missing required environment variables: {', '.join(missing_vars)}")
    sys.exit(1)

# Start Flask auth server
print(f"Starting auth server on port {AUTH_PORT}...")
auth_server = subprocess.Popen(
    [sys.executable, 'app/auth/auth_router.py'],
    env=os.environ.copy()
)

# Wait for auth server to start
time.sleep(2)  

# Start Streamlit app
print(f"Starting Streamlit app on port {STREAMLIT_PORT}...")
streamlit_server = subprocess.Popen(
    [sys.executable, '-m', 'streamlit', 'run', 'app/main.py', '--server.port', str(STREAMLIT_PORT)], 
    env=os.environ.copy()
)

# Function to handle shutdown
def shutdown(signal, frame):
    print("Shutting down servers...")
    auth_server.terminate()
    streamlit_server.terminate()
    sys.exit(0)

# Register signal handlers
signal.signal(signal.SIGINT, shutdown)
signal.signal(signal.SIGTERM, shutdown)

print(f"""
Authentication server running at: http://localhost:{AUTH_PORT}
Streamlit app running at: http://localhost:{STREAMLIT_PORT}

Press Ctrl+C to stop the servers
""")

try:
    # Keep the script running
    while True:
        time.sleep(1)
except KeyboardInterrupt:
    shutdown(None, None) 