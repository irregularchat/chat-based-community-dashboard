#!/bin/bash

# Exit on any error
set -e

echo "🚀 Starting Community Dashboard (Modern Stack)"

# Function to wait for database
wait_for_db() {
  echo "⏳ Waiting for database to be ready..."
  local max_attempts=30
  local attempt=1
  
  while [ $attempt -le $max_attempts ]; do
    if echo "SELECT 1;" | npx prisma db execute --stdin --schema=./prisma/schema.prisma 2>/dev/null; then
      echo "✅ Database connection established"
      return 0
    fi
    
    echo "Database not ready (attempt $attempt/$max_attempts), waiting 5 seconds..."
    sleep 5
    attempt=$((attempt + 1))
  done
  
  echo "❌ Database connection failed after $max_attempts attempts"
  exit 1
}

# Wait for database
wait_for_db

# Generate Prisma client
echo "🔄 Generating Prisma client..."
npx prisma generate --schema=./prisma/schema.prisma

# Check if database is initialized
echo "🔍 Checking database schema..."
if ! echo "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users';" | npx prisma db execute --stdin --schema=./prisma/schema.prisma 2>/dev/null | grep -q "users"; then
  echo "📋 Database not initialized, deploying schema..."
  npx prisma db push --accept-data-loss
else
  echo "📋 Database schema exists, applying migrations..."
  npx prisma db push
fi

# Seed the database if SEED_DATABASE=true and no users exist
if [ "$SEED_DATABASE" = "true" ]; then
  echo "🔍 Checking if database needs seeding..."
  USER_COUNT=$(echo "SELECT COUNT(*) FROM users;" | npx prisma db execute --stdin --schema=./prisma/schema.prisma 2>/dev/null | tail -n 1 | tr -d ' ' || echo "0")
  
  if [ "$USER_COUNT" = "0" ] || [ "$USER_COUNT" = "" ]; then
    echo "🌱 Seeding database..."
    if ! npm run db:seed; then
      echo "❌ Database seeding failed! Cannot start application without admin user."
      echo "💡 Check the following:"
      echo "   - DEFAULT_ADMIN_PASSWORD environment variable is set"
      echo "   - Database connection is working"
      echo "   - Prisma schema is up to date"
      exit 1
    fi
    echo "✅ Database seeded successfully"
  else
    echo "👥 Database already has $USER_COUNT users, skipping seed"
  fi
else
  echo "🔍 Database seeding disabled (SEED_DATABASE != true)"
fi

echo "✅ Database setup complete"

# Start the application
echo "🌟 Starting application on port ${PORT:-3000}"
exec "$@" 