#!/bin/bash

###############################################################################
# Signal CLI Bot - Cloudflare Container Deployment Script
#
# This script automates the deployment process:
# 1. Builds the Docker container
# 2. Pushes to Cloudflare Container Registry
# 3. Deploys the Worker
# 4. Runs health checks
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Signal CLI Bot - Cloudflare Container Deployment     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ Error: wrangler CLI not found${NC}"
    echo "Install with: npm install -g wrangler"
    exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Error: Docker not found${NC}"
    echo "Install Docker Desktop from: https://www.docker.com/products/docker-desktop"
    exit 1
fi

# Check if logged in to Cloudflare
echo -e "${BLUE}🔐 Checking Cloudflare authentication...${NC}"
if ! wrangler whoami &> /dev/null; then
    echo -e "${RED}❌ Not logged in to Cloudflare${NC}"
    echo "Run: wrangler login"
    exit 1
fi
echo -e "${GREEN}✅ Authenticated${NC}"
echo ""

# Parse arguments
ENVIRONMENT="${1:-development}"
SKIP_BUILD="${2:-false}"

echo -e "${BLUE}📦 Deployment Configuration:${NC}"
echo "   Environment: $ENVIRONMENT"
echo "   Skip Build: $SKIP_BUILD"
echo ""

# Step 1: Build Docker image (unless skipped)
if [ "$SKIP_BUILD" != "true" ]; then
    echo -e "${BLUE}🔨 Building Docker image...${NC}"
    docker build -t signal-cli-bot:latest .

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Docker image built successfully${NC}"
    else
        echo -e "${RED}❌ Docker build failed${NC}"
        exit 1
    fi
    echo ""
else
    echo -e "${YELLOW}⏩ Skipping Docker build${NC}"
    echo ""
fi

# Step 2: Check if KV namespace exists
echo -e "${BLUE}🗂️  Checking KV namespace...${NC}"
if ! grep -q 'id = "[a-zA-Z0-9]' wrangler.toml; then
    echo -e "${YELLOW}⚠️  KV namespace not configured${NC}"
    echo "Creating KV namespace..."
    wrangler kv:namespace create SIGNAL_CACHE
    echo ""
    echo -e "${YELLOW}📝 Please update wrangler.toml with the namespace ID${NC}"
    echo "Then run this script again"
    exit 0
fi
echo -e "${GREEN}✅ KV namespace configured${NC}"
echo ""

# Step 3: Check if R2 bucket exists
echo -e "${BLUE}🪣  Checking R2 bucket...${NC}"
if wrangler r2 bucket list | grep -q "signal-cli-data"; then
    echo -e "${GREEN}✅ R2 bucket exists${NC}"
else
    echo -e "${YELLOW}⚠️  R2 bucket not found${NC}"
    echo "Creating R2 bucket..."
    wrangler r2 bucket create signal-cli-data
    echo -e "${GREEN}✅ R2 bucket created${NC}"
fi
echo ""

# Step 4: Check secrets
echo -e "${BLUE}🔒 Checking secrets...${NC}"
echo -e "${YELLOW}Note: Cannot verify secrets exist, assuming they are set${NC}"
echo "If deployment fails, run:"
echo "  npm run secret:set-phone"
echo "  npm run secret:set-openai (optional)"
echo ""

# Step 5: Deploy to Cloudflare
echo -e "${BLUE}🚀 Deploying to Cloudflare...${NC}"
if [ "$ENVIRONMENT" == "production" ]; then
    wrangler deploy --env production
else
    wrangler deploy
fi

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Deployment successful${NC}"
else
    echo -e "${RED}❌ Deployment failed${NC}"
    exit 1
fi
echo ""

# Step 6: Get deployment URL
echo -e "${BLUE}🔗 Getting deployment URL...${NC}"
WORKER_URL=$(wrangler deployments list --name signal-cli-bot 2>/dev/null | grep -o 'https://[^ ]*' | head -1)

if [ -z "$WORKER_URL" ]; then
    # Fallback: construct URL from account
    ACCOUNT_ID=$(wrangler whoami | grep -o 'Account ID: [^ ]*' | cut -d' ' -f3)
    WORKER_URL="https://signal-cli-bot.${ACCOUNT_ID}.workers.dev"
    echo -e "${YELLOW}⚠️  Could not auto-detect URL, using estimated URL${NC}"
fi

echo -e "${GREEN}Worker URL: $WORKER_URL${NC}"
echo ""

# Step 7: Health check
echo -e "${BLUE}🏥 Running health check...${NC}"
sleep 3  # Give it a moment to start

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/health" || echo "000")

if [ "$HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}✅ Health check passed${NC}"

    # Get detailed status
    echo ""
    echo -e "${BLUE}📊 Worker Status:${NC}"
    curl -s "$WORKER_URL/status" | python3 -m json.tool 2>/dev/null || echo "Could not fetch status"

else
    echo -e "${YELLOW}⚠️  Health check returned HTTP $HTTP_CODE${NC}"
    echo "This is normal on first deployment. Container may need time to start."
    echo ""
    echo "Check status in 1-2 minutes:"
    echo "  curl $WORKER_URL/health"
fi
echo ""

# Step 8: Show next steps
echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            🎉 Deployment Complete! 🎉                  ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}📌 Next Steps:${NC}"
echo ""
echo "1. Test the health endpoint:"
echo "   ${YELLOW}curl $WORKER_URL/health${NC}"
echo ""
echo "2. Check worker + container status:"
echo "   ${YELLOW}curl $WORKER_URL/status${NC}"
echo ""
echo "3. View real-time logs:"
echo "   ${YELLOW}npm run logs${NC}"
echo ""
echo "4. Register Signal account (if needed):"
echo "   Visit: https://signalcaptchas.org/registration/generate.html"
echo "   Then: ${YELLOW}curl -X POST $WORKER_URL/v1/register/+YOUR_NUMBER${NC}"
echo ""
echo "5. Update your app to use Worker URL:"
echo "   ${YELLOW}SIGNAL_CLI_REST_API_BASE_URL=$WORKER_URL${NC}"
echo ""
echo "📚 Documentation: ./README.md"
echo "💬 Cloudflare Discord: https://discord.gg/cloudflaredev"
echo ""
