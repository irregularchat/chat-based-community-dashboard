#!/bin/bash

# Script to run the Community Dashboard app with flexible authentication options

# Default values
STREAMLIT_PORT=8503
FLASK_PORT=8505
AUTH_METHOD="direct"  # Default to direct auth

# Colors for better user experience
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to display usage
function show_usage {
  echo -e "${YELLOW}Usage:${NC} $0 [OPTIONS]"
  echo -e "${YELLOW}Options:${NC}"
  echo "  --flask         Use Flask authentication server (default: direct auth)"
  echo "  --direct        Use direct authentication (default)"
  echo "  --st-port PORT  Set Streamlit port (default: 8503)"
  echo "  --flask-port P  Set Flask server port (default: 8505)"
  echo "  --bypass-state  Bypass state validation (use with caution)"
  echo "  --help          Show this help message"
}

# Parse arguments
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --flask) AUTH_METHOD="flask"; shift ;;
    --direct) AUTH_METHOD="direct"; shift ;;
    --st-port) STREAMLIT_PORT="$2"; shift; shift ;;
    --flask-port) FLASK_PORT="$2"; shift; shift ;;
    --bypass-state) BYPASS_STATE="true"; shift ;;
    --help) show_usage; exit 0 ;;
    *) echo -e "${RED}Unknown option:${NC} $1"; show_usage; exit 1 ;;
  esac
done

# Check Python is installed
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}Python 3 is not installed.${NC} Please install Python 3 to run this application."
    exit 1
fi

# Check pip is installed
if ! command -v pip3 &> /dev/null; then
    echo -e "${RED}pip3 is not installed.${NC} Please install pip3 to run this application."
    exit 1
fi

# Check if streamlit is installed
if ! python3 -c "import streamlit" &> /dev/null; then
    echo -e "${YELLOW}Streamlit is not installed.${NC} Installing..."
    pip3 install streamlit
fi

# Check if Flask is installed (needed for flask auth)
if [ "$AUTH_METHOD" == "flask" ] && ! python3 -c "import flask" &> /dev/null; then
    echo -e "${YELLOW}Flask is not installed.${NC} Installing..."
    pip3 install flask
fi

# Check .env file
if [ ! -f .env ]; then
    echo -e "${RED}.env file not found.${NC}"
    echo "Please create a .env file with the required environment variables."
    echo "You can use .env.example as a template."
    exit 1
fi

# Kill any existing processes on the ports
function kill_process_on_port {
    port=$1
    pid=$(lsof -ti:$port)
    if [ ! -z "$pid" ]; then
        echo -e "${YELLOW}Found process (PID: $pid) running on port $port. Terminating...${NC}"
        kill -9 $pid
    fi
}

# Kill processes on both ports to ensure clean start
kill_process_on_port $STREAMLIT_PORT
if [ "$AUTH_METHOD" == "flask" ]; then
    kill_process_on_port $FLASK_PORT
fi

# Set environment variables
export STREAMLIT_SERVER_PORT=$STREAMLIT_PORT

if [ "$AUTH_METHOD" == "direct" ]; then
    export USE_DIRECT_AUTH=true
    echo -e "${GREEN}Starting Streamlit app with direct authentication on port $STREAMLIT_PORT${NC}"
    
    if [ "$BYPASS_STATE" == "true" ]; then
        export BYPASS_STATE_CHECK=true
        echo -e "${YELLOW}⚠️ State validation bypassed - this reduces security but may help with session issues${NC}"
    fi
    
    # Use python -m streamlit to ensure it's found
    python3 -m streamlit run app/main.py --server.port=$STREAMLIT_PORT
else
    # Flask auth method
    export USE_DIRECT_AUTH=false
    export FLASK_AUTH_PORT=$FLASK_PORT
    
    echo -e "${GREEN}Starting auth server on port $FLASK_PORT and Streamlit app on port $STREAMLIT_PORT${NC}"
    python3 app/run_servers.py --st-port $STREAMLIT_PORT --flask-port $FLASK_PORT
fi 