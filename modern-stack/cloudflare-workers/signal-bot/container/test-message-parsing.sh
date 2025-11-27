#!/bin/bash
# Test script for Signal bot message parsing
# Sends a test message and captures the detailed logs

echo "================================================"
echo "Signal Bot Message Parsing Test"
echo "================================================"
echo ""

# Build the code
echo "📦 Building TypeScript..."
cd /Users/sac/Git/chat-based-community-dashboard/modern-stack/cloudflare-workers/signal-bot/container
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi
echo "✅ Build successful"
echo ""

# Deploy to container
echo "🚀 Deploying to container..."
cd /Users/sac/Git/chat-based-community-dashboard/modern-stack/cloudflare-workers/signal-bot
./deploy-to-proxmox.sh > /dev/null 2>&1
echo "✅ Deployment complete"
echo ""

# Wait for container to start
echo "⏳ Waiting for container to start..."
sleep 10

# Check if bot needs database fix
echo "🔍 Checking bot status..."
if ssh root@proxmox-main "docker logs --tail=20 signal-bot 2>&1" | grep -q "SQLITE_CORRUPT"; then
    echo "🔧 Fixing database corruption..."
    ssh root@proxmox-main "docker exec signal-bot sh -c 'cd /app/signal-data/data/813876.d && rm -f account.db* && sqlite3 account.db < account_dump.sql'" 2>/dev/null
    echo "🔄 Starting bot via API..."
    ssh root@proxmox-main "docker exec signal-bot curl -s -X POST http://localhost:8080/bot/start" > /dev/null
    sleep 5
fi
echo "✅ Bot is running"
echo ""

# Clear existing logs
echo "🧹 Clearing old logs..."
ssh root@proxmox-main "docker exec signal-bot sh -c 'echo \"\" > /proc/1/fd/1'" 2>/dev/null || true
echo ""

# Send test message via Signal CLI
echo "📤 Sending test message with URL..."
echo "   Message: 'Test message https://google.com?utm_source=tracking'"
echo ""

ssh root@proxmox-main "docker exec signal-bot signal-cli -a +19108471202 --config /app/signal-data send -m 'Test message https://google.com?utm_source=tracking' +12247253276" 2>&1 | head -5
echo ""

# Wait for message to be processed
echo "⏳ Waiting for message processing (10 seconds)..."
sleep 10
echo ""

# Capture and display detailed logs
echo "📋 CAPTURED LOGS:"
echo "================================================"
ssh root@proxmox-main "docker logs --tail=100 signal-bot 2>&1" | grep -E "(🔍 \[TRACE\]|🔵 \[DEBUG\]|Message text:|📨|🚨)" | tail -50
echo "================================================"
echo ""

echo "✅ Test complete!"
echo ""
echo "📊 Summary:"
echo "   - Check for 🔍 [TRACE] logs showing notification structure"
echo "   - Check for 🔵 [DEBUG] logs showing message parsing"
echo "   - Check if message text appears correctly"
echo "   - Check if URL security alert was sent (🚨)"
