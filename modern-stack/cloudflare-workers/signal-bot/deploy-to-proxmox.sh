#!/bin/bash

#
# Deploy Signal Bot to Proxmox Server
#
# This script sets up the Signal bot container on your Proxmox server
# with proper directory structure and Docker configuration.
#

set -e

PROXMOX_HOST="${PROXMOX_HOST:-root@proxmox-main}"
REMOTE_DIR="/home/signalcli"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Signal Bot Deployment to Proxmox"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 1: Create directory structure on Proxmox
echo "📁 Creating directory structure on $PROXMOX_HOST..."
ssh $PROXMOX_HOST "mkdir -p $REMOTE_DIR/{container,signal-data}"

# Step 2: Copy container files to Proxmox
echo "📦 Copying container files..."
rsync -avz --progress \
  container/ \
  $PROXMOX_HOST:$REMOTE_DIR/container/

# Step 3: Download Signal data from R2 to Proxmox
echo "📥 Downloading Signal data from R2..."
ssh $PROXMOX_HOST "cd $REMOTE_DIR && \
  curl -H 'Authorization: Bearer fE5bDjRu5B4HIOXq5rQkbKz5hOTGBSvMFcA+0LzcyxY=' \
    https://signal-cli-bot.wemea-5ahhf.workers.dev/api/r2/download/signal-data-backup.tar.gz \
    -o signal-data-backup.tar.gz && \
  tar -xzf signal-data-backup.tar.gz && \
  rm signal-data-backup.tar.gz && \
  echo '✅ Signal data extracted'"

# Step 4: Build Docker image on Proxmox
echo "🔨 Building Docker image on Proxmox..."
ssh $PROXMOX_HOST "cd $REMOTE_DIR/container && \
  docker build -t signal-cli-bot:latest ."

# Step 5: Create docker-compose.yml
echo "📝 Creating docker-compose.yml..."
ssh $PROXMOX_HOST "cat > $REMOTE_DIR/docker-compose.yml << 'DOCKERCOMPOSE'
version: '3.8'

services:
  signal-bot:
    image: signal-cli-bot:latest
    container_name: signal-bot
    restart: unless-stopped
    volumes:
      - ./signal-data:/app/signal-data
    environment:
      - SIGNAL_PHONE_NUMBER=+19108471202
      - WORKER_API_URL=https://signal-cli-bot.wemea-5ahhf.workers.dev
      - WORKER_API_TOKEN=\${WORKER_API_TOKEN}
      - OPENAI_ACTIVE=true
      - OPENAI_API_KEY=\${OPENAI_API_KEY}
      - DISCOURSE_API_URL=https://forum.irregularchat.com
      - DISCOURSE_API_KEY=\${DISCOURSE_API_KEY}
      - DISCOURSE_API_USERNAME=bot.irregularchat
      - AUTO_START=true
      - MODE=production
      - PORT=8080
      - SIGNAL_CLI_CONFIG_DIR=/app/signal-data
    ports:
      - '8080:8080'
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:8080/health']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
DOCKERCOMPOSE
"

# Step 6: Start the container
echo "🚀 Starting Signal bot container..."
ssh $PROXMOX_HOST "cd $REMOTE_DIR && docker-compose up -d"

# Step 7: Show logs
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Deployment Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Container is starting... Checking logs:"
echo ""
ssh $PROXMOX_HOST "cd $REMOTE_DIR && docker-compose logs --tail=50 -f signal-bot"
