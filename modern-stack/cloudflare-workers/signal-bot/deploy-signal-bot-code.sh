#!/bin/bash
#
# Signal Bot Code Deployment Script
# Ensures new code is properly deployed and container is restarted
#
# Usage: ./deploy-signal-bot-code.sh [--skip-build] [--skip-verify]
#
# This script addresses Docker layer caching issues by:
# 1. Building TypeScript locally first
# 2. Copying both source AND compiled files to server
# 3. Force rebuilding Docker image with --no-cache
# 4. Restarting container with new image
# 5. Verifying deployment with code pattern checks
#

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REMOTE_HOST="proxmox-main"
REMOTE_USER="root"
REMOTE_PATH="/home/signal-bot-selfhosted"
LOCAL_CONTAINER_DIR="container"
VERIFICATION_PATTERN="GROUP_KEYWORD_MAP"
VERIFICATION_FILE="/app/dist/bot/command-handler.js"

# Parse arguments
SKIP_BUILD=false
SKIP_VERIFY=false

for arg in "$@"; do
  case $arg in
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --skip-verify)
      SKIP_VERIFY=true
      shift
      ;;
    *)
      echo -e "${RED}❌ Unknown argument: $arg${NC}"
      echo "Usage: $0 [--skip-build] [--skip-verify]"
      exit 1
      ;;
  esac
done

# Function to print step headers
print_step() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Function to print success
print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

# Function to print warning
print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

# Function to print error and exit
print_error() {
  echo -e "${RED}❌ $1${NC}"
  exit 1
}

# Start deployment
echo -e "${GREEN}🚀 Signal Bot Code Deployment Script${NC}"
echo -e "${GREEN}=====================================\n${NC}"

# Step 1: Build TypeScript locally
if [ "$SKIP_BUILD" = false ]; then
  print_step "Step 1: Building TypeScript locally"

  if [ ! -d "$LOCAL_CONTAINER_DIR" ]; then
    print_error "Container directory not found: $LOCAL_CONTAINER_DIR"
  fi

  cd "$LOCAL_CONTAINER_DIR"

  echo "🔨 Running npm install..."
  npm install --quiet || print_error "npm install failed"

  echo "🔨 Building TypeScript..."
  npm run build || print_error "TypeScript build failed"

  print_success "Local build completed"
  cd ..
else
  print_warning "Skipping local build (--skip-build flag set)"
fi

# Step 2: Copy files to server
print_step "Step 2: Copying files to server"

echo "📦 Using rsync to copy container directory..."
echo "   Source: $LOCAL_CONTAINER_DIR/"
echo "   Destination: $REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/bot/"

rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '*.log' \
  "$LOCAL_CONTAINER_DIR/" \
  "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/bot/" \
  || print_error "rsync failed"

print_success "Files copied to server"

# Step 3: Verify files on server
print_step "Step 3: Verifying source files on server"

echo "🔍 Checking for verification pattern in source file..."
SOURCE_COUNT=$(ssh "$REMOTE_USER@$REMOTE_HOST" \
  "grep -c '$VERIFICATION_PATTERN' $REMOTE_PATH/bot/src/bot/command-handler.ts" || echo "0")

if [ "$SOURCE_COUNT" -gt "0" ]; then
  print_success "Verification pattern found in source file ($SOURCE_COUNT occurrences)"
else
  print_error "Verification pattern NOT found in source file! Code may not have copied correctly."
fi

# Step 4: Force rebuild Docker image
print_step "Step 4: Force rebuilding Docker image (--no-cache)"

echo "🔨 This will take several minutes..."
echo "🔨 Building signal-bot image from scratch..."

ssh "$REMOTE_USER@$REMOTE_HOST" \
  "cd $REMOTE_PATH && docker-compose build --no-cache signal-bot" \
  || print_error "Docker build failed"

print_success "Docker image rebuilt"

# Step 5: Restart container
print_step "Step 5: Restarting container with new image"

echo "🚀 Stopping old container..."
ssh "$REMOTE_USER@$REMOTE_HOST" \
  "cd $REMOTE_PATH && docker-compose stop signal-bot" \
  || print_warning "Stop command failed (container may not be running)"

echo "🚀 Starting new container..."
ssh "$REMOTE_USER@$REMOTE_HOST" \
  "cd $REMOTE_PATH && docker-compose up -d signal-bot" \
  || print_error "Container start failed"

print_success "Container restarted"

# Step 6: Wait for container to stabilize
print_step "Step 6: Waiting for container to stabilize"

echo "⏳ Waiting 10 seconds for container to fully start..."
sleep 10

# Check if container is running
CONTAINER_STATUS=$(ssh "$REMOTE_USER@$REMOTE_HOST" \
  "docker inspect -f '{{.State.Status}}' signal-bot-selfhosted" 2>/dev/null || echo "not_found")

if [ "$CONTAINER_STATUS" = "running" ]; then
  print_success "Container is running"
else
  print_error "Container is not running (status: $CONTAINER_STATUS)"
fi

# Step 7: Verify deployment
if [ "$SKIP_VERIFY" = false ]; then
  print_step "Step 7: Verifying code deployment"

  echo "🔍 Checking for verification pattern in compiled code..."
  COMPILED_COUNT=$(ssh "$REMOTE_USER@$REMOTE_HOST" \
    "docker exec signal-bot-selfhosted grep -c '$VERIFICATION_PATTERN' $VERIFICATION_FILE" || echo "0")

  if [ "$COMPILED_COUNT" -gt "0" ]; then
    print_success "Verification pattern found in compiled code ($COMPILED_COUNT occurrences)"
    print_success "✅ NEW CODE IS DEPLOYED AND RUNNING!"
  else
    print_error "Verification pattern NOT found in compiled code! Deployment may have failed."
  fi

  # Additional verification: Check container logs
  echo ""
  echo "📋 Recent container logs:"
  ssh "$REMOTE_USER@$REMOTE_HOST" \
    "docker logs signal-bot-selfhosted --tail 15" || print_warning "Could not fetch logs"
else
  print_warning "Skipping verification (--skip-verify flag set)"
fi

# Final summary
print_step "Deployment Summary"

echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo ""
echo "📊 Deployment Statistics:"
echo "   - Source file verification: $SOURCE_COUNT occurrences"
if [ "$SKIP_VERIFY" = false ]; then
  echo "   - Compiled code verification: $COMPILED_COUNT occurrences"
fi
echo "   - Container status: $CONTAINER_STATUS"
echo ""
echo "🔍 To monitor the bot:"
echo "   ssh $REMOTE_USER@$REMOTE_HOST 'docker logs -f signal-bot-selfhosted'"
echo ""
echo "🧪 To test the bot:"
echo "   Send a Signal message to test commands"
echo ""
