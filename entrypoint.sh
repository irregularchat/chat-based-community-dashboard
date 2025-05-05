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

# Check for required environment variables
echo "Validating database environment variables..."
MISSING_VARS=0

# Check DB_HOST
if [ -z "$DB_HOST" ]; then
    echo "⚠️ WARNING: DB_HOST environment variable is not set"
    echo "Using default value 'db' for DB_HOST"
    DB_HOST="db"
    MISSING_VARS=$((MISSING_VARS+1))
fi

# Check POSTGRES_DB
if [ -z "$POSTGRES_DB" ]; then
    echo "⚠️ WARNING: POSTGRES_DB environment variable is not set"
    echo "Please set POSTGRES_DB in your environment or .env file"
    MISSING_VARS=$((MISSING_VARS+1))
fi

# Check POSTGRES_USER
if [ -z "$POSTGRES_USER" ]; then
    echo "⚠️ WARNING: POSTGRES_USER environment variable is not set"
    echo "Please set POSTGRES_USER in your environment or .env file"
    MISSING_VARS=$((MISSING_VARS+1))
fi

# Check POSTGRES_PASSWORD
if [ -z "$POSTGRES_PASSWORD" ]; then
    echo "⚠️ WARNING: POSTGRES_PASSWORD environment variable is not set"
    echo "Please set POSTGRES_PASSWORD in your environment or .env file"
    MISSING_VARS=$((MISSING_VARS+1))
fi

# Check POSTGRES_PORT
if [ -z "$POSTGRES_PORT" ]; then
    echo "⚠️ WARNING: POSTGRES_PORT environment variable is not set"
    echo "Using default value '5432' for POSTGRES_PORT"
    POSTGRES_PORT="5432"
fi

# Exit if critical variables are missing
if [ $MISSING_VARS -gt 0 ]; then
    echo "⚠️ $MISSING_VARS required environment variables are missing or empty"
    echo "The application may not function correctly without these variables"
    echo "Please check your docker-compose.yml and .env files"
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

# Print environment variables (without sensitive values)
echo "Checking environment variables..."
grep -v '^#' /app/.env | grep '=' | cut -d= -f1 | while read -r var; do
    if [ ! -z "$var" ]; then
        echo "$var is set"
    fi
done

# Set the DATABASE_URL in the environment
export DATABASE_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$DB_HOST:$POSTGRES_PORT/$POSTGRES_DB"

# Update DATABASE_URL in .env file if it exists
if grep -q "DATABASE_URL" /app/.env; then
    echo "Ensuring DATABASE_URL in .env points to the correct database"
    # Create a temporary file with the correct DATABASE_URL (masked for security in logs)
    echo "DATABASE_URL=postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@$DB_HOST:$POSTGRES_PORT/$POSTGRES_DB" > /tmp/db_url
    sed -i "s|DATABASE_URL=.*|$(cat /tmp/db_url)|g" /app/.env
    # Securely remove the temporary file
    rm -f /tmp/db_url
    echo "Updated DATABASE_URL in .env file"
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