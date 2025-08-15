#!/bin/bash

# Local development startup script for modern stack
set -e

echo "🚀 Starting Community Dashboard (Modern Stack) Local Development"

# Check if we're in the right directory
if [ ! -f "modern-stack/package.json" ]; then
    echo "❌ Error: Please run this script from the project root directory"
    exit 1
fi

cd modern-stack

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "📝 Setting up environment file..."
    if [ -f ".env.local" ]; then
        cp .env.local .env
        echo "✅ Copied .env.local to .env"
    else
        echo "❌ Error: No .env.local template found"
        echo "Please create .env file with required environment variables"
        exit 1
    fi
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Generate Prisma client
echo "🔧 Generating Prisma client..."
npx prisma generate

# Check database connection and setup
echo "🗄️ Checking database connection..."
if npx prisma db push --accept-data-loss; then
    echo "✅ Database schema synchronized"
else
    echo "❌ Database connection failed"
    echo "Please check your DATABASE_URL in .env file"
    echo ""
    echo "Options:"
    echo "1. Use Cloud SQL Proxy: cloud-sql-proxy speech-memorization:us-central1:community-dashboard-db --port=5432"
    echo "2. Start local PostgreSQL: docker-compose up db -d"
    echo "3. Install PostgreSQL locally"
    echo ""
    echo "See LOCAL_SETUP.md for detailed instructions"
    exit 1
fi

# Seed database if empty (optional)
echo "🌱 Checking if database needs seeding..."
if npm run db:seed 2>/dev/null; then
    echo "✅ Database seeded with initial data"
else
    echo "ℹ️ Database seeding skipped (data may already exist)"
fi

echo ""
echo "🎉 Setup complete! Starting development server..."
echo ""
echo "🌐 Local URLs:"
echo "  App:      http://localhost:3000"
echo "  Database: http://localhost:5555 (run 'npx prisma studio' in another terminal)"
echo ""
echo "🔐 Authentication:"
echo "  SSO login will redirect to Authentik"
echo "  Make sure http://localhost:3000/api/auth/callback/authentik is configured in Authentik"
echo ""

# Start the development server
npm run dev