#!/bin/bash

# Run the application with LOCAL_DEV environment variable set
export LOCAL_DEV=true

# Check if PostgreSQL is running on the local machine
echo "Checking if PostgreSQL is running..."
if command -v pg_isready > /dev/null; then
  pg_isready -h localhost -p ${POSTGRES_PORT:-5432} -U ${POSTGRES_USER:-dashboarduser}
  if [ $? -ne 0 ]; then
    echo "Warning: PostgreSQL doesn't seem to be running on localhost:${POSTGRES_PORT:-5432}."
    echo "Make sure PostgreSQL is installed and running before starting the application."
    echo "You can create the database with:"
    echo "  createdb -U ${POSTGRES_USER:-dashboarduser} ${POSTGRES_DB:-dashboarddb}"
  else
    echo "PostgreSQL is running."
  fi
else
  echo "pg_isready not found. Make sure PostgreSQL client tools are installed."
fi

# Run the Streamlit app
echo "Starting the application in local development mode..."
streamlit run app/main.py 