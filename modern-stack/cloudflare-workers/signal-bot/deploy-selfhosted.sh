#!/bin/bash

set -e

PROXMOX_HOST="${PROXMOX_HOST:-root@proxmox-main}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Deploying Signal Bot - Self-Hosted Mode"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Validate required environment variables
if [ -z "$DB_PASSWORD" ] || [ -z "$SIGNAL_PHONE" ] || [ -z "$OPENAI_API_KEY" ] || [ -z "$DISCOURSE_API_KEY" ]; then
  echo "❌ ERROR: Missing required environment variables"
  echo ""
  echo "Please set the following environment variables before running this script:"
  echo "  - DB_PASSWORD"
  echo "  - SIGNAL_PHONE"
  echo "  - OPENAI_API_KEY"
  echo "  - DISCOURSE_API_KEY"
  echo "  - DISCOURSE_URL (optional, defaults to https://forum.irregularchat.com)"
  echo "  - DISCOURSE_USERNAME (optional, defaults to bot.irregularchat)"
  echo ""
  echo "Example:"
  echo "  export DB_PASSWORD='your-secure-password'"
  echo "  export OPENAI_API_KEY='sk-proj-...'"
  echo "  ./deploy-selfhosted.sh"
  echo ""
  exit 1
fi

# Set defaults for optional variables
DISCOURSE_URL="${DISCOURSE_URL:-https://forum.irregularchat.com}"
DISCOURSE_USERNAME="${DISCOURSE_USERNAME:-bot.irregularchat}"

# Step 1: Stop old Cloudflare mode container
echo "🛑 Stopping old Cloudflare mode container..."
ssh $PROXMOX_HOST "cd /home/signalcli && docker-compose down || true"

# Step 2: Copy Signal data from old location to selfhosted
echo "📦 Copying Signal data..."
ssh $PROXMOX_HOST "mkdir -p /home/signal-bot-selfhosted/data && \
  rsync -av /home/signalcli/signal-data/ /home/signal-bot-selfhosted/data/signal-data/ || true"

# Step 3: Copy updated code to selfhosted bot directory
echo "📤 Deploying updated code..."
rsync -avz --progress container/ $PROXMOX_HOST:/home/signal-bot-selfhosted/bot/

# Step 4: Deploy environment file from local variables
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

# Step 5: Start self-hosted stack
echo "🚀 Starting self-hosted Signal bot stack..."
ssh $PROXMOX_HOST "cd /home/signal-bot-selfhosted && docker-compose up -d --build"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Container logs:"
ssh $PROXMOX_HOST "cd /home/signal-bot-selfhosted && docker-compose logs --tail=50 -f signal-bot"
