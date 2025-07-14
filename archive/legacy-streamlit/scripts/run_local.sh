#!/bin/bash
# Script to run the application locally with improved authentication

echo "Starting Community Dashboard with enhanced authentication..."

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Python 3 is required but not found. Please install Python 3."
    exit 1
fi

# Check if pip is installed
if ! command -v pip3 &> /dev/null; then
    echo "pip3 is required but not found. Please install pip3."
    exit 1
fi

# Check if required packages are installed
if ! python3 -c "import flask" &> /dev/null; then
    echo "Installing Flask package..."
    pip3 install flask requests
fi

# Check if streamlit is installed
if ! python3 -c "import streamlit" &> /dev/null; then
    echo "Installing Streamlit package..."
    pip3 install streamlit
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Error: .env file not found. Please create one based on .env-template."
    exit 1
fi

# Make the Python script executable
chmod +x run_servers.py

# Run the script
echo "Starting servers..."
python3 run_servers.py 