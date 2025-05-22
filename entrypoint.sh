#!/bin/bash
set -e

# Check if .env file exists and is readable
if [ ! -f /app/.env ]; then
    echo "Error: .env file not found at /app/.env"
    exit 1
fi

# Use PORT from environment variable or default to 8503
PORT="${PORT:-8503}"

# Set essential environment variables
export IN_DOCKER=true
export PYTHONUNBUFFERED=1

# Process environment variable substitution in .env file
echo "Processing environment variables from .env file for substitution..."
# Handle spaces and quotes properly in .env file
while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip comments and empty lines
    [[ "$line" =~ ^[[:space:]]*#.*$ || -z "$line" ]] && continue
    
    # Extract variable name and value, handling spaces around equals sign
    if [[ "$line" =~ ^[[:space:]]*([A-Za-z0-9_]+)[[:space:]]*=[[:space:]]*(.*)[[:space:]]*$ ]]; then
        var_name="${BASH_REMATCH[1]}"
        var_value="${BASH_REMATCH[2]}"
        # Remove surrounding quotes if present
        var_value="${var_value#\"}"
        var_value="${var_value%\"}"
        # Export the variable
        export "$var_name"="$var_value"
    fi
done < /app/.env
echo "Processed environment variables from .env file"

# Debug the environment variables
echo "DEBUG: Environment variables:"
echo "POSTGRES_USER=${POSTGRES_USER}"
echo "POSTGRES_PASSWORD=****" # Don't log the actual password
echo "POSTGRES_DB=${POSTGRES_DB}"
echo "POSTGRES_PORT=${POSTGRES_PORT}"
echo "DB_HOST=${DB_HOST}"

# Extract database connection information
if grep -q "DATABASE_URL" /app/.env; then
    echo "Found DATABASE_URL in .env file, but not using it"
fi

# Set DB_URL directly from environment variables
DB_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${DB_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
echo "Created DB_URL: ${DB_URL//:*@/:***@}"
    
    # Extract hostname using better regex pattern
    if [[ $DB_URL =~ @([^:/]+)[:/] ]]; then
        DB_HOST="${BASH_REMATCH[1]}"
        echo "Extracted host from URL: $DB_HOST"
    else
        # Default to 'db' if parsing fails
        DB_HOST="db"
        echo "Could not parse host from DATABASE_URL, using default: $DB_HOST"
    fi
    
    # Extract port from URL
    if [[ $DB_URL =~ :([0-9]+)/ ]]; then
        POSTGRES_PORT="${BASH_REMATCH[1]}"
        echo "Extracted port from URL: $POSTGRES_PORT"
    else
        # Default port if not found
        POSTGRES_PORT="5432"
        echo "Could not parse port from DATABASE_URL, using default: $POSTGRES_PORT"
    fi
    
    # Extract database name from URL
    if [[ $DB_URL =~ /([^/]+)$ ]]; then
        POSTGRES_DB="${BASH_REMATCH[1]}"
        echo "Extracted database from URL: $POSTGRES_DB"
    else
        # Default database if not found
        POSTGRES_DB=$(grep "POSTGRES_DB" /app/.env | cut -d= -f2- | tr -d ' ' || echo "dashboarddb")
        echo "Could not parse database from DATABASE_URL, using env: $POSTGRES_DB"
    fi
    
    # Extract username from URL
    if [[ $DB_URL =~ ://([^:]+): ]]; then
        POSTGRES_USER="${BASH_REMATCH[1]}"
        echo "Extracted username from URL: $POSTGRES_USER"
    else
        # Default username if not found
        POSTGRES_USER=$(grep "POSTGRES_USER" /app/.env | cut -d= -f2- | tr -d ' ' || echo "dashboarduser")
        echo "Could not parse username from DATABASE_URL, using env: $POSTGRES_USER"
    fi
    
    # Extract password (masked for security)
    if [[ $DB_URL =~ ://[^:]+:([^@]+)@ ]]; then
        POSTGRES_PASSWORD="${BASH_REMATCH[1]}"
        echo "Extracted password from URL: ********"
    else
        # Default password if not found
        POSTGRES_PASSWORD=$(grep "POSTGRES_PASSWORD" /app/.env | cut -d= -f2- | tr -d ' ' || echo "password_for_db")
        echo "Could not parse password from DATABASE_URL, using env variable"
    fi

# In case we need to fallback to environment variables
if [ -z "$DB_HOST" ]; then
    DB_HOST="db"
    echo "Using default DB_HOST=db"
fi
if [ -z "$POSTGRES_DB" ]; then
    POSTGRES_DB="dashboarddb"
    echo "Using default POSTGRES_DB=dashboarddb"
fi
if [ -z "$POSTGRES_USER" ]; then
    POSTGRES_USER="postgres"
    echo "Using default POSTGRES_USER=postgres"
fi
if [ -z "$POSTGRES_PASSWORD" ]; then
    POSTGRES_PASSWORD="password_for_db"
    echo "Using default POSTGRES_PASSWORD=password_for_db"
fi
if [ -z "$POSTGRES_PORT" ]; then
    POSTGRES_PORT="5436"
    echo "Using default POSTGRES_PORT=5436"
fi

# Export variables for the application to use
export DB_HOST
export POSTGRES_DB
export POSTGRES_USER
export POSTGRES_PASSWORD
export POSTGRES_PORT

echo "Database connection parameters:"
echo "Host: $DB_HOST"
echo "Port: $POSTGRES_PORT"
echo "Database: $POSTGRES_DB"
echo "User: $POSTGRES_USER"
echo "Password: ********"

# Wait for PostgreSQL to be ready with improved error handling
echo "Waiting for PostgreSQL to be ready..."
RETRIES=15
CONNECTED=false

until [ $RETRIES -eq 0 ] || $CONNECTED; do
    if pg_isready -h $DB_HOST -U $POSTGRES_USER -d $POSTGRES_DB -t 5; then
        echo "✅ PostgreSQL server at $DB_HOST:$POSTGRES_PORT is accepting connections"
        CONNECTED=true
    else
        echo "Waiting for PostgreSQL to be ready... $((RETRIES--)) retries left"
        sleep 5
    fi
done

if ! $CONNECTED; then
    echo "⚠️ Warning: Could not connect to PostgreSQL after multiple attempts."
    echo "The application will attempt to start anyway, but it may not function correctly."
    echo "Consider using SQLite mode for local development if PostgreSQL is unavailable."
else
    # Test the connection with an actual query
    echo "Testing database connection with a simple query..."
    export PGPASSWORD=$POSTGRES_PASSWORD
    
    if psql -h $DB_HOST -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT 1;" > /dev/null 2>&1; then
        echo "✅ Database connection test successful!"
        
        # DATABASE_URL already set with direct values earlier
        echo "Using DATABASE_URL for application: ${DATABASE_URL//:*@/:***@}"
    else
        echo "⚠️ Database connection test failed. The application may not function correctly."
        echo "Error code: $?"
        
        # Try to get more detailed error information
        psql -h $DB_HOST -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT 1;" 2>&1 | head -n 5
    fi
fi

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

# Process the DATABASE_URL with direct values
echo "Creating DATABASE_URL with direct values"
# Create the URL with actual values, not variables
# When running in Docker, always use port 5432 for internal communication
if [ "$IN_DOCKER" = "true" ] && [ "$DB_HOST" = "db" ]; then
    DB_PORT="5432"  # Use internal Docker network port
    echo "Using internal Docker network port 5432 for database connection"
else
    DB_PORT="$POSTGRES_PORT"  # Otherwise use the configured port
fi
export DATABASE_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$DB_HOST:$DB_PORT/$POSTGRES_DB"
echo "Using DATABASE_URL: ${DATABASE_URL//:*@/:***@}"

# Update the .env file for future runs with direct values, no variable substitution
if grep -q "DATABASE_URL" /app/.env; then
    echo "Updating DATABASE_URL in .env file with direct values"
    sed -i "s|DATABASE_URL.*|DATABASE_URL = postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$DB_HOST:$DB_PORT/$POSTGRES_DB|g" /app/.env
else
    echo "Adding DATABASE_URL to .env file with direct values"
    echo "DATABASE_URL = postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$DB_HOST:$DB_PORT/$POSTGRES_DB" >> /app/.env
fi
echo "Updated .env file with direct values"

# Print final connection information
echo "Final database connection:"
echo "Host: $DB_HOST"
echo "Port: $POSTGRES_PORT"
echo "DB: $POSTGRES_DB"
echo "User: $POSTGRES_USER"
echo "URL format: postgresql://<user>:<password>@$DB_HOST:$POSTGRES_PORT/$POSTGRES_DB"

# Start the Streamlit app
echo "Starting Streamlit app on port $PORT"
exec streamlit run app/main.py --server.port=$PORT --server.address=0.0.0.0 