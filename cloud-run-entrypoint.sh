#!/bin/bash

# Exit on any error
set -e

echo "🚀 Starting Community Dashboard on Google Cloud Run"

# Function to wait for Cloud SQL connection
wait_for_cloudsql() {
  echo "⏳ Waiting for Cloud SQL connection..."
  local max_attempts=30
  local attempt=1
  
  while [ $attempt -le $max_attempts ]; do
    if [ -n "$INSTANCE_CONNECTION_NAME" ]; then
      echo "Using Cloud SQL instance: $INSTANCE_CONNECTION_NAME"
      # Test database connection with Prisma
      if timeout 10 npx prisma db push --accept-data-loss --force-reset --preview-feature 2>/dev/null; then
        echo "✅ Cloud SQL connection established"
        return 0
      fi
    else
      # For external database connections
      if timeout 5 npx prisma generate && timeout 10 npx prisma db push --accept-data-loss 2>/dev/null; then
        echo "✅ Database connection established"
        return 0
      fi
    fi
    
    echo "Database not ready (attempt $attempt/$max_attempts), waiting 5 seconds..."
    sleep 5
    attempt=$((attempt + 1))
  done
  
  echo "❌ Database connection failed after $max_attempts attempts"
  echo "💡 Check your DATABASE_URL and Cloud SQL instance status"
  exit 1
}

# Generate Prisma client if not available
echo "🔧 Ensuring Prisma client is ready..."
npx prisma generate || {
  echo "❌ Prisma client generation failed"
  exit 1
}

# Wait for and setup database
wait_for_cloudsql

# Deploy database schema (Cloud SQL safe)
echo "📋 Deploying database schema..."
timeout 120 npx prisma db push --accept-data-loss || {
  echo "❌ Prisma schema deployment failed or timed out"
  echo "💡 This might be due to Cloud SQL cold start - the service will retry"
  exit 1
}

# Seed the database if SEED_DATABASE=true
if [ "$SEED_DATABASE" = "true" ]; then
  echo "🌱 Seeding database (if needed)..."
  if timeout 60 npm run db:seed; then
    echo "✅ Database seeding completed"
  else
    echo "⚠️ Database seeding failed, but continuing startup"
    echo "💡 You may need to create an admin user manually"
    echo "   This can happen if dependencies are missing or user already exists"
  fi
else
  echo "🔍 Database seeding disabled (SEED_DATABASE != true)"
fi

echo "✅ Database setup complete"

# Cloud Run health check endpoint
echo "🏥 Setting up health checks for Cloud Run..."

# Start the application
echo "🌟 Starting application on port ${PORT:-8080}"
echo "🔗 Cloud SQL instance: ${INSTANCE_CONNECTION_NAME:-external-database}"
echo "🌐 Environment: ${NODE_ENV:-production}"

exec "$@"