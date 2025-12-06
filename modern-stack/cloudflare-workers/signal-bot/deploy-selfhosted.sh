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
# Skip backup:
#   ./deploy-selfhosted.sh --skip-backup
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXMOX_HOST="${PROXMOX_HOST:-root@proxmox-main}"
REMOTE_PATH="/home/signal-bot-selfhosted/bot"
LOCAL_PATH="$SCRIPT_DIR/container"
LOCAL_BACKUP="/Users/sac/Git/chat-based-community-dashboard/modern-stack/signal-data"
REMOTE_DATA="/home/signal-bot-selfhosted/data/signal-data"

# Parse arguments
FULL_DEPLOY=false
NO_CACHE=""
SKIP_BACKUP=false
for arg in "$@"; do
  case $arg in
    --full) FULL_DEPLOY=true ;;
    --no-cache) NO_CACHE="--no-cache" ;;
    --skip-backup) SKIP_BACKUP=true ;;
  esac
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Deploying Signal Bot - Self-Hosted Mode"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 0: Backup Signal data locally (before any changes)
if [ "$SKIP_BACKUP" = false ]; then
  echo "📦 Backing up Signal data locally..."
  mkdir -p "$LOCAL_BACKUP"
  rsync -avz --progress "$PROXMOX_HOST:$REMOTE_DATA/" "$LOCAL_BACKUP/" 2>/dev/null || echo "⚠️  Backup failed (might be first deploy)"
  echo "✅ Backup saved to: $LOCAL_BACKUP"
  echo ""
fi

# Step 0.5: Check VPN health and restart if needed
echo "🔍 Checking VPN container health..."
VPN_HEALTH=$(ssh $PROXMOX_HOST "docker inspect signal-bot-vpn --format='{{.State.Health.Status}}' 2>/dev/null" || echo "none")
if [ "$VPN_HEALTH" != "healthy" ]; then
  echo "⚠️  VPN is $VPN_HEALTH, restarting..."
  ssh $PROXMOX_HOST "cd /home/signal-bot-selfhosted && docker compose restart vpn"
  echo "⏳ Waiting 30s for VPN to establish connection..."
  sleep 30

  # Verify VPN is now healthy
  VPN_HEALTH=$(ssh $PROXMOX_HOST "docker inspect signal-bot-vpn --format='{{.State.Health.Status}}' 2>/dev/null" || echo "none")
  if [ "$VPN_HEALTH" != "healthy" ]; then
    echo "❌ VPN still not healthy after restart. Status: $VPN_HEALTH"
    echo "   Try: ssh $PROXMOX_HOST 'docker logs signal-bot-vpn'"
    exit 1
  fi
fi
echo "✅ VPN is healthy"
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

# Step 5: Wait and verify
echo "⏳ Waiting for container to start..."
sleep 10

# Step 6: Verify health
echo "🔍 Checking bot health..."
BOT_HEALTH=$(ssh $PROXMOX_HOST "docker exec signal-bot-selfhosted curl -s http://localhost:8080/health 2>/dev/null" || echo '{"status":"error"}')
BOT_STATUS=$(echo "$BOT_HEALTH" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
BOT_RUNNING=$(echo "$BOT_HEALTH" | grep -o '"running":[^,}]*' | cut -d':' -f2)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ "$BOT_RUNNING" = "true" ]; then
  echo "  ✅ Deployment Complete!"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "📊 Bot Status: $BOT_STATUS"
  echo "🤖 Bot Running: $BOT_RUNNING"
else
  echo "  ⚠️  Deployment Complete (Bot may need attention)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "📊 Bot Status: $BOT_STATUS"
  echo "🤖 Bot Running: $BOT_RUNNING"
  echo ""
  echo "💡 If bot didn't start, try:"
  echo "   ssh $PROXMOX_HOST 'docker exec signal-bot-selfhosted curl -X POST http://localhost:8080/bot/start'"
fi
echo ""
echo "📋 Recent logs:"
ssh $PROXMOX_HOST "docker logs --tail=20 signal-bot-selfhosted 2>&1"

echo ""
echo "📦 Local backup location: $LOCAL_BACKUP"
