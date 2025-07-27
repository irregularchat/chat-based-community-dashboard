#!/bin/sh

# Docker entrypoint script for Community Dashboard
set -e

echo "🚀 Starting Community Dashboard..."

# Check if we're running a specific command
if [ "$COMMAND" = "migrate" ]; then
    echo "📊 Running database migrations..."
    npx prisma migrate deploy
    echo "✅ Migrations completed"
    exit 0
fi

if [ "$COMMAND" = "create-admin" ]; then
    echo "👤 Creating admin user..."
    node create-admin.js
    echo "✅ Admin user created"
    exit 0
fi

if [ "$COMMAND" = "seed" ]; then
    echo "🌱 Seeding database..."
    npm run db:seed
    echo "✅ Database seeded"
    exit 0
fi

# Default: start the Next.js application
echo "🌐 Starting Next.js application..."
exec node server.js 