#!/bin/bash

# startup.sh - Complete startup script for the Community Dashboard
# This script handles Docker startup, database initialization, and admin user creation

set -e

echo "🚀 Starting Community Dashboard - Complete Setup"
echo "================================================"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Function to cleanup on exit
cleanup() {
    if [ $? -ne 0 ]; then
        echo "❌ Setup failed. Cleaning up..."
        docker-compose down
    fi
}
trap cleanup EXIT

# Stop any existing containers
echo "🧹 Stopping any existing containers..."
docker-compose down -v

# Remove any existing database volumes if they exist
echo "🗑️  Removing old database volumes..."
docker volume rm chat-based-community-dashboard_postgres_data 2>/dev/null || true

# Build and start the containers
echo "🏗️  Building and starting containers..."
docker-compose up -d --build

# Wait for containers to be ready
echo "⏳ Waiting for containers to start..."
sleep 10

# Check if containers are running
if ! docker-compose ps --services --filter "status=running" | grep -q "app\|db"; then
    echo "❌ Containers failed to start properly"
    docker-compose logs
    exit 1
fi

# Wait for application to be ready
echo "⏳ Waiting for application to be ready..."
max_attempts=30
attempt=1

while [ $attempt -le $max_attempts ]; do
    if curl -f http://localhost:8503 > /dev/null 2>&1; then
        echo "✅ Application is ready!"
        break
    fi
    
    echo "Application not ready (attempt $attempt/$max_attempts), waiting 10 seconds..."
    sleep 10
    attempt=$((attempt + 1))
done

if [ $attempt -gt $max_attempts ]; then
    echo "❌ Application failed to start within expected time"
    echo "📋 Container logs:"
    docker-compose logs app
    exit 1
fi

# Force database seeding with admin user creation
echo "🌱 Ensuring admin user is created via database seeding..."
docker-compose exec app sh -c "
export SEED_DATABASE=true
export DEFAULT_ADMIN_PASSWORD=shareme314
export ADMIN_EMAIL=admin@irregularchat.com
# Install bcryptjs and generate Prisma client, then run seed
npm install bcryptjs@^3.0.2 && npx prisma generate && npm run db:seed
"

# Wait a moment for seeding to complete
sleep 5

# Verify admin user was created
echo "🔍 Verifying admin user creation..."
ADMIN_EXISTS=$(docker-compose exec -T db psql -U postgres -d dashboarddb -t -c "SELECT COUNT(*) FROM users WHERE username = 'admin' AND is_admin = true;" 2>/dev/null | tr -d ' ' || echo "0")

if [ "$ADMIN_EXISTS" = "1" ]; then
    echo "✅ Admin user created successfully!"
    echo ""
    echo "🎉 Community Dashboard is now running!"
    echo "================================================"
    echo "📱 Dashboard URL: http://localhost:8503"
    echo "👤 Admin Username: admin"
    echo "🔑 Admin Password: shareme314"
    echo "📧 Admin Email: admin@irregularchat.com"
    echo ""
    echo "⚠️  IMPORTANT: Change the default password after first login!"
    echo ""
    echo "🐳 Container Management:"
    echo "   - View logs: docker-compose logs -f app"
    echo "   - Stop: docker-compose down"
    echo "   - Restart: docker-compose restart"
    echo ""
    echo "📊 Database Access:"
    echo "   - Host: localhost:5436"
    echo "   - Database: dashboarddb"
    echo "   - Username: postgres"
    echo "   - Password: postgres"
    
else
    echo "❌ Admin user was not created properly"
    echo "📋 Please check the logs for more information:"
    echo "   docker-compose logs app"
    exit 1
fi

# Success - don't trigger cleanup
trap - EXIT