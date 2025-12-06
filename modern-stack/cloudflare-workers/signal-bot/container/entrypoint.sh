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

# Check deployment mode (self-hosted or cloudflare-native)
if [ -n "$DB_HOST" ]; then
    echo "🏠 Running in SELF-HOSTED mode (PostgreSQL)"
    echo "   Database: $DB_HOST:$DB_PORT"
    ENTRY_POINT="index-selfhosted.js"
else
    echo "☁️  Running in CLOUDFLARE-NATIVE mode (Worker API)"
    # Check required environment variables for Cloudflare mode
    if [ -z "$WORKER_API_URL" ]; then
        echo "❌ ERROR: WORKER_API_URL is not set"
        exit 1
    fi
    if [ -z "$WORKER_API_TOKEN" ]; then
        echo "❌ ERROR: WORKER_API_TOKEN is not set"
        exit 1
    fi
    echo "   Worker URL: $WORKER_API_URL"
    ENTRY_POINT="index.js"
fi

echo "✅ Environment variables configured"
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

# Check for database corruption and handle it
echo "🔍 Checking database integrity..."
DB_CORRUPT=false

# Check if signal-data.db exists
if [ -f /app/signal-data/data/signal-data.db ]; then
    # Try a simple query to detect corruption
    if ! sqlite3 /app/signal-data/data/signal-data.db "PRAGMA integrity_check;" > /dev/null 2>&1; then
        echo "⚠️  Database corruption detected!"
        DB_CORRUPT=true
    fi

    # Also check for schema incompatibility (missing columns)
    if sqlite3 /app/signal-data/data/signal-data.db "SELECT endorsement_expiration_time FROM group LIMIT 1;" > /dev/null 2>&1; then
        echo "✅ Database schema is compatible"
    else
        echo "⚠️  Database schema incompatible with signal-cli v0.13.22"
        DB_CORRUPT=true
    fi
fi

# If corrupt, rebuild database while preserving account registration
if [ "$DB_CORRUPT" = true ]; then
    echo "🔧 Rebuilding database (preserving account registration)..."

    # Preserve account registration keys (.storage/ contains account identity)
    # Delete corrupt database files but keep account registration
    rm -f /app/signal-data/data/*.db 2>/dev/null || true
    rm -f /app/signal-data/data/*.db-shm 2>/dev/null || true
    rm -f /app/signal-data/data/*.db-wal 2>/dev/null || true

    echo "✅ Corrupt database removed, signal-cli will rebuild with correct schema"
else
    echo "✅ Database is healthy"
fi

# Remove lock files
echo "🔓 Removing any lock files..."
rm -f /app/signal-data/data/*.lock 2>/dev/null || true
rm -f /app/signal-data/data/.*.lock 2>/dev/null || true
echo "✅ Lock files cleared"
echo ""

# Update ClamAV virus definitions at startup (may fail if not running as root)
echo "🛡️ Updating ClamAV virus definitions..."
# SECURITY: Running as non-root user, freshclam may not have permissions
# The virus definitions are updated during docker build instead
freshclam --quiet 2>/dev/null || echo "ℹ️  ClamAV using build-time definitions (non-root user)"
echo "✅ ClamAV ready"
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

# Start daily ClamAV updates in background (every 24 hours)
# SECURITY: May fail when running as non-root, that's expected
(
    while true; do
        sleep 86400  # 24 hours
        echo "🛡️ Daily ClamAV virus definition update..."
        freshclam --quiet 2>/dev/null || echo "ℹ️  ClamAV update skipped (non-root)"
    done
) &
CLAMAV_PID=$!

echo "🚀 Starting Signal Bot..."
echo "📝 Entry point: $ENTRY_POINT"
echo ""

# Start the Node.js application
node dist/$ENTRY_POINT &
APP_PID=$!

# Wait for the application to exit
wait $APP_PID

# Clean up background processes
kill $BACKUP_PID 2>/dev/null || true
kill $CLAMAV_PID 2>/dev/null || true

# Final backup before exit
echo "📤 Final backup to R2..."
/app/sync-signal-data.sh upload || echo "⚠️  Final backup failed"

exit 0
