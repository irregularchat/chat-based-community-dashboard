#!/bin/bash

# Exit on any error
set -e

echo "🚀 Starting Community Dashboard (Modern Stack)"

# Function to wait for database
wait_for_db() {
  echo "⏳ Waiting for database to be ready..."
  local max_attempts=15
  local attempt=1
  
  # Extract database connection details from DATABASE_URL
  DB_HOST="db"
  DB_PORT="5432"
  
  while [ $attempt -le $max_attempts ]; do
    # Use netcat to test if database port is accessible
    if nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; then
      echo "✅ Database connection established"
      return 0
    fi
    
    echo "Database not ready (attempt $attempt/$max_attempts), waiting 3 seconds..."
    sleep 3
    attempt=$((attempt + 1))
  done
  
  echo "❌ Database connection failed after $max_attempts attempts"
  exit 1
}

# Use pre-generated Prisma client from build phase
echo "✅ Using pre-generated Prisma client from build phase"
# Check if prisma client exists
if [ ! -d "./node_modules/.prisma" ]; then
  echo "❌ Prisma client not found, this is a build issue"
  exit 1
fi

# Wait for database
wait_for_db

# Skip Prisma operations for now due to binary compatibility issues
echo "⚠️ Skipping Prisma schema deployment due to binary compatibility issues"
echo "💡 Database schema will be managed through application startup"

echo "✅ Database setup skipped, starting application"

# Start the application
echo "🌟 Starting application on port ${PORT:-3000}"
exec "$@" 