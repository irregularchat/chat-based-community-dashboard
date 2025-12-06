#!/bin/bash

# Deploy Signal bot with proper environment variables from .env.local
# This script extracts the API keys from .env.local and deploys to production

echo "🚀 Deploying Signal bot with proper API configuration..."

# Extract API keys from .env.local
OPENAI_KEY=$(grep "OPENAI_API_KEY=" .env.local | cut -d'"' -f2)
LOCAL_AI_URL=$(grep "LOCAL_AI_URL=" .env.local | cut -d'"' -f2)
LOCAL_AI_KEY=$(grep "LOCAL_AI_API_KEY=" .env.local | cut -d'"' -f2)

echo "📋 Configuration extracted:"
echo "• OpenAI API Key: ${OPENAI_KEY:0:20}..."
echo "• LocalAI URL: $LOCAL_AI_URL"
echo "• LocalAI API Key: ${LOCAL_AI_KEY:0:20}..."

# Deploy to production server
echo "📡 Copying bot to production server..."
scp production-ready-signal-bot.js root@100.107.228.108:/home/chat-based-community-dashboard/modern-stack/

echo "🔄 Restarting bot with proper configuration..."
ssh root@100.107.228.108 "
cd /home/chat-based-community-dashboard/modern-stack && 
killall node 2>/dev/null || true && 
sleep 3 &&
OPENAI_API_KEY='$OPENAI_KEY' \
LOCAL_AI_URL='$LOCAL_AI_URL' \
LOCAL_AI_API_KEY='$LOCAL_AI_KEY' \
nohup node production-ready-signal-bot.js > bot.log 2>&1 &
echo '✅ Bot deployed with PID:' \$(pgrep -f production-ready-signal-bot.js)
"

echo "🎉 Deployment complete! Bot running with proper API configuration."