#!/bin/bash
#
# Signal Bot Self-Hosted Deployment Script
#
# Quick deploy (code changes only):
#   ./deploy-selfhosted.sh
#
# Full deploy with env setup:
#   ./deploy-selfhosted.sh --full
#
# Force rebuild without cache:
#   ./deploy-selfhosted.sh --no-cache
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXMOX_HOST="${PROXMOX_HOST:-root@proxmox-main}"
REMOTE_PATH="/home/signal-bot-selfhosted/bot"
LOCAL_PATH="$SCRIPT_DIR/container"

# Parse arguments
FULL_DEPLOY=false
NO_CACHE=""
for arg in "$@"; do
  case $arg in
    --full) FULL_DEPLOY=true ;;
    --no-cache) NO_CACHE="--no-cache" ;;
  esac
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Deploying Signal Bot - Self-Hosted Mode"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Full deploy requires environment variables
if [ "$FULL_DEPLOY" = true ]; then
  if [ -z "$DB_PASSWORD" ] || [ -z "$SIGNAL_PHONE" ] || [ -z "$OPENAI_API_KEY" ] || [ -z "$DISCOURSE_API_KEY" ]; then
    echo "❌ ERROR: Missing required environment variables for --full deploy"
    echo ""
    echo "Please set the following environment variables:"
    echo "  - DB_PASSWORD"
    echo "  - SIGNAL_PHONE"
    echo "  - OPENAI_API_KEY"
    echo "  - DISCOURSE_API_KEY"
    echo ""
    exit 1
  fi

  DISCOURSE_URL="${DISCOURSE_URL:-https://forum.irregularchat.com}"
  DISCOURSE_USERNAME="${DISCOURSE_USERNAME:-bot.irregularchat}"

  echo "📝 Setting up environment..."
  ssh $PROXMOX_HOST "cat > /home/signal-bot-selfhosted/.env << ENVEOF
DB_PASSWORD=${DB_PASSWORD}
SIGNAL_PHONE=${SIGNAL_PHONE}
OPENAI_API_KEY=${OPENAI_API_KEY}
DISCOURSE_URL=${DISCOURSE_URL}
DISCOURSE_API_KEY=${DISCOURSE_API_KEY}
DISCOURSE_USERNAME=${DISCOURSE_USERNAME}
ENVEOF
"
fi

# Step 1: Build TypeScript locally
echo "🔧 Building TypeScript..."
cd "$LOCAL_PATH"
npm run build

# Step 2: Sync files to server
echo "📤 Syncing files to server..."
rsync -avz --delete --exclude='.git' --exclude='node_modules' "$LOCAL_PATH/" "$PROXMOX_HOST:$REMOTE_PATH/"

# Step 3: Rebuild Docker image
echo "🐳 Rebuilding Docker container..."
ssh $PROXMOX_HOST "cd /home/signal-bot-selfhosted && docker compose build $NO_CACHE signal-bot"

# Step 4: Restart container
echo "🔄 Restarting container..."
ssh $PROXMOX_HOST "cd /home/signal-bot-selfhosted && docker compose up -d --force-recreate signal-bot"

# Step 5: Wait and show logs
echo "⏳ Waiting for container to start..."
sleep 5

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Recent logs:"
ssh $PROXMOX_HOST "docker logs --tail=20 signal-bot-selfhosted 2>&1"
