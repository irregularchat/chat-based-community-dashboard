#!/bin/bash
set -e

# Check if .env file exists and is readable
if [ ! -f /app/.env ]; then
    echo "Error: .env file not found at /app/.env"
    exit 1
fi

# Use PORT from environment variable or default to 8503
PORT="${PORT:-8503}"

# Adjust the OIDC_REDIRECT_URI in .env if needed
if grep -q "OIDC_REDIRECT_URI" /app/.env; then
    # Get the current value
    CURRENT_URI=$(grep "OIDC_REDIRECT_URI" /app/.env | cut -d= -f2- | tr -d ' ')
    echo "Current OIDC_REDIRECT_URI: $CURRENT_URI"
    
    # Check if it's a localhost URI (for development)
    if [[ "$CURRENT_URI" == *"localhost"* ]]; then
        # Create the new URI with the correct format
        NEW_URI="http://localhost:${PORT}/auth/callback"
        
        echo "Updating OIDC_REDIRECT_URI to: $NEW_URI"
        # Update the URI in the .env file
        sed -i "s|OIDC_REDIRECT_URI.*|OIDC_REDIRECT_URI = ${NEW_URI}|g" /app/.env
    fi
fi

# Print environment variables (without sensitive values)
echo "Checking environment variables..."
grep -v '^#' /app/.env | grep '=' | cut -d= -f1 | while read -r var; do
    if [ ! -z "$var" ]; then
        echo "$var is set"
    fi
done

# Start the Streamlit app
echo "Starting Streamlit app on port $PORT"
exec streamlit run app/main.py --server.port=$PORT --server.address=0.0.0.0 