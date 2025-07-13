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
    if npx prisma db execute --command "SELECT 1;" 2>/dev/null; then
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
if ! npx prisma db execute --command "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'User';" 2>/dev/null | grep -q "User"; then
  echo "📋 Database not initialized, deploying schema..."
  npx prisma db push --accept-data-loss
else
  echo "📋 Database schema exists, applying migrations..."
  npx prisma db push
fi

# Seed the database if SEED_DATABASE=true and no users exist
if [ "$SEED_DATABASE" = "true" ]; then
  echo "🔍 Checking if database needs seeding..."
  USER_COUNT=$(npx prisma db execute --command "SELECT COUNT(*) FROM \"User\";" 2>/dev/null | tail -n 1 | tr -d ' ' || echo "0")
  
  if [ "$USER_COUNT" = "0" ] || [ "$USER_COUNT" = "" ]; then
    echo "🌱 Seeding database..."
    npm run db:seed || echo "⚠️  Seeding failed, continuing without seed data"
  else
    echo "👥 Database already has $USER_COUNT users, skipping seed"
  fi
fi

echo "✅ Database setup complete"

# Start the application
echo "🌟 Starting application on port ${PORT:-3000}"
exec "$@" 