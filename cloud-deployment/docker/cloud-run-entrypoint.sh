#!/bin/bash

# Cloud Run Entrypoint Script for Community Dashboard
set -e

echo "🚀 Starting Community Dashboard on Google Cloud Run"

# Function to wait for database connection
wait_for_database() {
    echo "⏳ Waiting for database connection..."
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        # Test database connection
        if timeout 10 npx prisma db push --accept-data-loss 2>/dev/null; then
            echo "✅ Database connection established"
            return 0
        fi
        
        echo "Database not ready (attempt $attempt/$max_attempts), waiting 5 seconds..."
        sleep 5
        attempt=$((attempt + 1))
    done
    
    echo "❌ Database connection failed after $max_attempts attempts"
    echo "💡 Check your DATABASE_URL and Cloud SQL instance status"
    exit 1
}

# Function to setup database schema
setup_database() {
    echo "📋 Setting up database schema..."
    
    # Generate Prisma client if needed
    if ! npx prisma generate --silent 2>/dev/null; then
        echo "🔧 Generating Prisma client..."
        npx prisma generate
    fi
    
    # Deploy database schema
    echo "📊 Deploying database schema..."
    if timeout 120 npx prisma db push --accept-data-loss; then
        echo "✅ Database schema deployed successfully"
    else
        echo "❌ Database schema deployment failed"
        exit 1
    fi
}

# Function to seed database
seed_database() {
    if [ "$SEED_DATABASE" = "true" ]; then
        echo "🌱 Seeding database..."
        
        # Install bcryptjs if not available (should be in image)
        if ! npm list bcryptjs > /dev/null 2>&1; then
            echo "📦 Installing bcryptjs..."
            npm install bcryptjs@^3.0.2
        fi
        
        # Run database seeding
        if timeout 60 npm run db:seed; then
            echo "✅ Database seeding completed"
        else
            echo "⚠️ Database seeding failed, continuing startup"
            echo "💡 You may need to create an admin user manually"
        fi
    else
        echo "🔍 Database seeding disabled (SEED_DATABASE != true)"
    fi
}

# Function to create admin user if needed
create_admin_user() {
    if [ "$CREATE_ADMIN" = "true" ] && [ -n "$DEFAULT_ADMIN_PASSWORD" ]; then
        echo "👤 Creating admin user..."
        
        # Set admin environment variables
        export ADMIN_EMAIL="${ADMIN_EMAIL:-admin@irregularchat.com}"
        export DEFAULT_ADMIN_USERNAME="${DEFAULT_ADMIN_USERNAME:-admin}"
        
        if timeout 30 node create-admin.js; then
            echo "✅ Admin user created/verified"
        else
            echo "⚠️ Admin user creation failed, continuing startup"
        fi
    fi
}

# Function to perform health check
health_check() {
    echo "🏥 Setting up health check endpoint..."
    
    # Create a simple health check endpoint if it doesn't exist
    cat > health-check.js << 'EOF'
const http = require('http');
const port = process.env.PORT || 8080;

// Simple health check server for testing
const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'healthy', 
            timestamp: new Date().toISOString(),
            service: 'community-dashboard'
        }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// Only start if main server isn't running
if (process.argv[2] === 'health-only') {
    server.listen(port, '0.0.0.0', () => {
        console.log(`Health check server running on port ${port}`);
    });
}
EOF
}

# Main startup sequence
main() {
    echo "🎯 Starting Cloud Run deployment sequence..."
    
    # Set Cloud Run specific environment variables
    export HOSTNAME="0.0.0.0"
    export PORT=${PORT:-8080}
    
    # Wait for database
    wait_for_database
    
    # Setup database schema
    setup_database
    
    # Seed database if enabled
    seed_database
    
    # Create admin user if enabled
    create_admin_user
    
    # Setup health check
    health_check
    
    echo "✅ Cloud Run setup complete!"
    echo "🌐 Starting application on port $PORT"
    echo "🔗 Environment: ${NODE_ENV:-production}"
    echo "📍 Region: ${GOOGLE_CLOUD_REGION:-us-central1}"
    
    # Execute the main command
    exec "$@"
}

# Handle special commands
case "${1:-}" in
    "health-check")
        echo "🏥 Running health check..."
        node health-check.js health-only
        ;;
    "migrate")
        echo "📊 Running migrations only..."
        setup_database
        echo "✅ Migrations completed"
        ;;
    "seed")
        echo "🌱 Running database seed only..."
        seed_database
        echo "✅ Seeding completed"
        ;;
    "create-admin")
        echo "👤 Creating admin user only..."
        create_admin_user
        echo "✅ Admin user setup completed"
        ;;
    *)
        # Normal startup
        main
        ;;
esac
