#!/bin/bash
# Script to run the application locally with direct authentication (no Flask server)

echo "Starting Community Dashboard with direct authentication..."

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

# Export direct authentication flag
export USE_DIRECT_AUTH=true

# Run Streamlit directly
echo "Starting Streamlit app with direct authentication..."
python3 -m streamlit run app/main.py --server.port 8503 