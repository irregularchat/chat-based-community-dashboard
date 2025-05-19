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

# Extract database connection information using improved regex patterns
if grep -q "DATABASE_URL" /app/.env; then
    DB_URL=$(grep "DATABASE_URL" /app/.env | cut -d= -f2- | tr -d ' ')
    echo "Found DATABASE_URL: ${DB_URL//:*@/:***@}"
    
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
else
    # No DATABASE_URL found, use environment variables
    echo "DATABASE_URL not found in .env, using individual environment variables"
    
    # Default to 'db' if DATABASE_URL is not in .env
    DB_HOST="db"
    POSTGRES_DB=$(grep "POSTGRES_DB" /app/.env | cut -d= -f2- | tr -d ' ' || echo "dashboarddb")
    POSTGRES_USER=$(grep "POSTGRES_USER" /app/.env | cut -d= -f2- | tr -d ' ' || echo "dashboarduser")
    POSTGRES_PASSWORD=$(grep "POSTGRES_PASSWORD" /app/.env | cut -d= -f2- | tr -d ' ' || echo "password_for_db")
    POSTGRES_PORT=$(grep "POSTGRES_PORT" /app/.env | cut -d= -f2- | tr -d ' ' || echo "5432")
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
        
        # Create or update the DATABASE_URL in the application environment
        export DATABASE_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$DB_HOST:$POSTGRES_PORT/$POSTGRES_DB"
        echo "Set DATABASE_URL for application: ${DATABASE_URL//:*@/:***@}"
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
        NEW_URI="http://localhost:${PORT}/callback"
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

# Override DATABASE_URL in .env if it exists
if grep -q "DATABASE_URL" /app/.env; then
    echo "Ensuring DATABASE_URL in .env points to the correct database"
    sed -i "s|DATABASE_URL.*|DATABASE_URL = postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$DB_HOST:$POSTGRES_PORT/$POSTGRES_DB|g" /app/.env
    echo "Updated DATABASE_URL in .env file"
else
    echo "Adding DATABASE_URL to .env file"
    echo "DATABASE_URL = postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$DB_HOST:$POSTGRES_PORT/$POSTGRES_DB" >> /app/.env
fi

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