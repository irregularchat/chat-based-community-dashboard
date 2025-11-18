#!/bin/bash

#
# Container Entrypoint Script
#
# This script handles:
# 1. Downloading Signal data from R2 (if it exists)
# 2. Starting the Signal bot
# 3. Uploading Signal data to R2 on shutdown
#

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Signal Bot Container Starting"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check required environment variables
if [ -z "$WORKER_API_URL" ]; then
    echo "❌ ERROR: WORKER_API_URL is not set"
    exit 1
fi

if [ -z "$WORKER_API_TOKEN" ]; then
    echo "❌ ERROR: WORKER_API_TOKEN is not set"
    exit 1
fi

echo "✅ Environment variables configured"
echo "   Worker URL: $WORKER_API_URL"
echo ""

# Function to handle graceful shutdown
shutdown_handler() {
    echo ""
    echo "🛑 Received shutdown signal..."
    echo "📤 Backing up Signal data to R2..."

    # Upload signal-data to R2
    /app/sync-signal-data.sh upload || echo "⚠️  Failed to backup (non-fatal)"

    echo "✅ Shutdown complete"
    exit 0
}

# Trap SIGTERM and SIGINT for graceful shutdown
trap shutdown_handler SIGTERM SIGINT

# Download signal-data from R2 if it exists
echo "📥 Checking for existing Signal data in R2..."
/app/sync-signal-data.sh download || echo "ℹ️  Starting with empty Signal data directory"
echo ""

# Start periodic backup in background (every 5 minutes)
(
    while true; do
        sleep 300  # 5 minutes
        echo "🔄 Periodic backup to R2..."
        /app/sync-signal-data.sh upload || echo "⚠️  Backup failed (will retry in 5 min)"
    done
) &
BACKUP_PID=$!

echo "🚀 Starting Signal Bot..."
echo ""

# Start the Node.js application
node dist/index.js &
APP_PID=$!

# Wait for the application to exit
wait $APP_PID

# Clean up background backup process
kill $BACKUP_PID 2>/dev/null || true

# Final backup before exit
echo "📤 Final backup to R2..."
/app/sync-signal-data.sh upload || echo "⚠️  Final backup failed"

exit 0
