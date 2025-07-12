#!/bin/bash

# Exit on any error
set -e

echo "🚀 Starting Community Dashboard (Modern Stack)"

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
until npx prisma db push --accept-data-loss; do
  echo "Database not ready, waiting 5 seconds..."
  sleep 5
done

echo "✅ Database connection established"

# Run database migrations and generate Prisma client
echo "🔄 Running database setup..."
npx prisma generate
npx prisma db push

# Seed the database if SEED_DATABASE=true
if [ "$SEED_DATABASE" = "true" ]; then
  echo "🌱 Seeding database..."
  npm run db:seed || echo "⚠️  Seeding failed or skipped"
fi

echo "✅ Database setup complete"

# Start the application
echo "🌟 Starting application on port ${PORT:-3000}"
exec "$@" 