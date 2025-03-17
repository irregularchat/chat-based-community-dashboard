#!/bin/bash
set -e

# Check if .env file exists and is readable
if [ ! -f /app/.env ]; then
    echo "Error: .env file not found at /app/.env"
    exit 1
fi

# Print environment variables (without sensitive values)
echo "Checking environment variables..."
grep -v '^#' /app/.env | grep '=' | cut -d= -f1 | while read -r var; do
    if [ ! -z "$var" ]; then
        echo "$var is set"
    fi
done

# Always use 8502 for the internal port
exec streamlit run app/main.py --server.port=8502 --server.address=0.0.0.0 