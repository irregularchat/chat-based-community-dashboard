#!/bin/bash

# Run the application with SQLITE_DEV environment variable set
export SQLITE_DEV=true

echo "Starting the application with SQLite database (local_dev.db)..."
echo "This is the simplest way to run the app without Docker or PostgreSQL."
echo "Note: Some features that depend on PostgreSQL specifics may not work correctly."

# Run the Streamlit app
streamlit run app/main.py 