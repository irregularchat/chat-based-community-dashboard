# Signal Bot Deployment Guide - Cloudflare Native

Complete deployment guide for the Signal CLI bot on Cloudflare infrastructure.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Cloudflare Global Network                │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐ │
│  │   Worker     │◄──►│  Container   │◄──►│   signal-cli  │ │
│  │  (API Layer) │    │  (Bot Logic) │    │    (Java)     │ │
│  └──────┬───────┘    └──────────────┘    └───────────────┘ │
│         │                                                    │
│         ├──► D1 Database (SQLite at edge)                   │
│         ├──► R2 Storage (Signal attachments)                │
│         ├──► KV Cache (Rate limiting)                       │
│         └──► Durable Objects (State management)             │
└─────────────────────────────────────────────────────────────┘
```

**Key Components:**
- **Worker**: HTTP API for D1/R2 access (container calls this)
- **Container**: Runs signal-cli daemon + bot logic
- **D1**: SQLite database for messages, commands, Q&A
- **R2**: Object storage for attachments and avatars
- **KV**: Key-value store for caching and rate limiting
- **Durable Objects**: State management, message queue, WebSocket

---

## Prerequisites

### Required Tools

```bash
# Node.js 20+
node --version  # Should be v20+

# Wrangler CLI
npm install -g wrangler
wrangler --version

# Docker (for building container)
docker --version

# Git
git --version
```

### Cloudflare Account

1. **Sign up for Cloudflare** (if you don't have an account):
   - Go to https://dash.cloudflare.com/sign-up
   - Verify your email

2. **Upgrade to Workers Paid plan** ($5/month minimum):
   - Required for: Containers, Durable Objects, higher limits
   - Go to: Workers & Pages → Plans
   - Click "Upgrade to Paid"

3. **Authenticate Wrangler**:
   ```bash
   wrangler login
   ```

### Signal Account

You need a registered Signal phone number for the bot:

1. **Get a phone number**:
   - Use a real phone number (can be a second SIM, Google Voice, etc.)
   - SMS verification required

2. **Register with signal-cli** (we'll do this later in container setup)

---

## Step 1: Set Up D1 Database

### Create D1 Database

```bash
cd cloudflare-workers/signal-bot

# Run automated setup script
./database/setup.sh
```

This script will:
1. Create a new D1 database called `signal-bot-db`
2. Extract the database ID
3. Update `wrangler.toml` with the database ID
4. Apply the schema to both local and remote databases
5. Verify the setup

**Manual steps if script fails:**

```bash
# Create database
wrangler d1 create signal-bot-db

# Copy the database_id from output, then update wrangler.toml:
# [[d1_databases]]
# database_id = "YOUR_DATABASE_ID_HERE"

# Apply schema to remote database
wrangler d1 execute signal-bot-db --file=database/schema.sql --remote

# Verify
wrangler d1 execute signal-bot-db --command="SELECT name FROM sqlite_master WHERE type='table';" --remote
```

### Verify D1 Setup

```bash
# List all tables
wrangler d1 execute signal-bot-db --command="SELECT name FROM sqlite_master WHERE type='table';" --remote

# Should show:
# signal_messages, signal_groups, signal_contacts, signal_members,
# bot_command_usage, bot_errors, q_and_a_questions, news_links, etc.
```

---

## Step 2: Set Up R2 Storage

### Create R2 Bucket

```bash
# Create bucket for Signal data (attachments, avatars, etc.)
wrangler r2 bucket create signal-cli-data

# Create preview bucket for development
wrangler r2 bucket create signal-cli-data-preview
```

### Verify R2 Setup

```bash
# List buckets
wrangler r2 bucket list

# Should show:
# - signal-cli-data
# - signal-cli-data-preview
```

---

## Step 3: Set Up KV Namespace

### Create KV Namespace

```bash
# Create KV namespace for caching and rate limiting
wrangler kv:namespace create SIGNAL_CACHE

# Copy the ID from output, then update wrangler.toml:
# [[kv_namespaces]]
# binding = "SIGNAL_CACHE"
# id = "YOUR_KV_ID_HERE"

# Create preview namespace for development
wrangler kv:namespace create SIGNAL_CACHE --preview

# Update wrangler.toml with preview_id:
# preview_id = "YOUR_PREVIEW_ID_HERE"
```

---

## Step 4: Configure Secrets

### Set Required Secrets

```bash
# Signal phone number (with country code, e.g., +19108471202)
wrangler secret put SIGNAL_PHONE_NUMBER
# Enter: +1XXXXXXXXXX

# Worker API token (generate a strong random token)
wrangler secret put WORKER_API_TOKEN
# Generate token: openssl rand -base64 32
# Enter the generated token

# Worker API URL (will be your deployed Worker URL)
# You'll set this after deploying the Worker
```

### Set Optional Secrets (for AI features)

```bash
# OpenAI API key (for !ai command)
wrangler secret put OPENAI_API_KEY
# Enter your OpenAI API key

# Mark OpenAI as active
wrangler secret put OPENAI_ACTIVE
# Enter: true
```

### Set Optional Secrets (for Discourse integration)

```bash
# Discourse forum URL
wrangler secret put DISCOURSE_API_URL
# Enter: https://your-forum.com

# Discourse API key
wrangler secret put DISCOURSE_API_KEY
# Enter your Discourse API key

# Discourse API username
wrangler secret put DISCOURSE_API_USERNAME
# Enter: system
```

---

## Step 5: Deploy Worker

### Install Dependencies

```bash
cd cloudflare-workers/signal-bot

# Install Node packages
npm install
```

### Deploy to Cloudflare

```bash
# Deploy Worker
npm run deploy

# Output will show:
# ✨ Your worker has been published!
# 🌎 URL: https://signal-cli-bot.YOUR-SUBDOMAIN.workers.dev
```

### Test Worker Deployment

```bash
# Test health endpoint
curl https://signal-cli-bot.YOUR-SUBDOMAIN.workers.dev/health

# Should return:
# {
#   "status": "healthy",
#   "service": "signal-bot-worker",
#   "version": "3.0.0",
#   "architecture": "cloudflare-native",
#   "components": {
#     "worker": "active",
#     "d1": "bound",
#     "r2": "bound",
#     "kv": "bound"
#   }
# }
```

### Update Container Environment

Now that Worker is deployed, set the Worker URL for the container:

```bash
# Set WORKER_API_URL secret
wrangler secret put WORKER_API_URL
# Enter: https://signal-cli-bot.YOUR-SUBDOMAIN.workers.dev
```

---

## Step 6: Build Container

### Build Docker Image

```bash
cd cloudflare-workers/signal-bot/container

# Build container image
docker build -t signal-cli-bot:latest .

# This will:
# 1. Build TypeScript to JavaScript
# 2. Install signal-cli with Java 17
# 3. Create production container image
```

### Test Container Locally (Optional)

```bash
# Run container locally for testing
docker run -p 8080:8080 \
  -e SIGNAL_PHONE_NUMBER="+1XXXXXXXXXX" \
  -e WORKER_API_URL="https://signal-cli-bot.YOUR-SUBDOMAIN.workers.dev" \
  -e WORKER_API_TOKEN="your-token" \
  -e AUTO_START="false" \
  signal-cli-bot:latest

# In another terminal, test endpoints
curl http://localhost:8080/health
```

---

## Step 7: Register Signal Account

Before deploying the container, you need to register your Signal phone number with signal-cli.

### Run Container for Registration

```bash
# Start container with shell access
docker run -it --rm \
  -v $(pwd)/signal-data:/app/signal-data \
  signal-cli-bot:latest \
  /bin/bash

# Inside container, register phone number
signal-cli -a +1XXXXXXXXXX register

# You'll receive SMS with verification code
# Verify with the code
signal-cli -a +1XXXXXXXXXX verify CODE_HERE

# Exit container
exit
```

### Backup Registration Data

```bash
# The signal-data directory now contains your registration
# Back it up securely!
tar -czf signal-registration-backup.tar.gz signal-data/

# Store this backup securely (encrypted storage)
```

---

## Step 8: Deploy Container to Cloudflare

### Push Image to Cloudflare Container Registry

```bash
# Tag image for Cloudflare
docker tag signal-cli-bot:latest registry.cloudflare.com/YOUR_ACCOUNT_ID/signal-cli-bot:latest

# Login to Cloudflare registry
docker login registry.cloudflare.com

# Push image
docker push registry.cloudflare.com/YOUR_ACCOUNT_ID/signal-cli-bot:latest
```

### Deploy Container

```bash
# Deploy container via Wrangler
wrangler deploy --container

# This reads the [[containers]] section in wrangler.toml and deploys
```

### Configure Container Environment

Update `wrangler.toml` with container environment variables:

```toml
[[containers]]
name = "signal-bot-container"
image = "registry.cloudflare.com/YOUR_ACCOUNT_ID/signal-cli-bot:latest"
memory = "2GiB"
cpu = 2
port = 8080

[containers.env]
MODE = "production"
PORT = "8080"
AUTO_START = "true"

# Note: Secrets (SIGNAL_PHONE_NUMBER, WORKER_API_TOKEN, etc.)
# are automatically injected from wrangler secrets
```

---

## Step 9: Start the Bot

### Start Bot via Container API

```bash
# Get your Worker URL
WORKER_URL="https://signal-cli-bot.YOUR-SUBDOMAIN.workers.dev"
API_TOKEN="your-worker-api-token"

# Start bot
curl -X POST "${WORKER_URL}/bot/start" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json"

# Should return:
# {
#   "success": true,
#   "message": "Bot started successfully",
#   "phoneNumber": "+1XXXXXXXXXX"
# }
```

### Check Bot Status

```bash
# Check status
curl "${WORKER_URL}/bot/status" \
  -H "Authorization: Bearer ${API_TOKEN}"

# Should return:
# {
#   "running": true,
#   "phoneNumber": "+1XXXXXXXXXX",
#   "uptime": 42,
#   "stats": {
#     "messagesReceived": 0,
#     "messagesSent": 0,
#     "commandsProcessed": 0,
#     "errors": 0
#   }
# }
```

---

## Step 10: Test Bot

### Send Test Message

Send a message to your bot's phone number from another Signal account:

```
!help
```

You should receive a response with available commands.

### Test Commands

```bash
# Test ping
!ping

# Test AI (if OpenAI enabled)
!ai What is Cloudflare?

# Test Q&A system
!ask How do I deploy a Worker?

# Test questions list
!questions

# Test whoami
!whoami

# Test version
!version

# Test stats
!stats
```

---

## Monitoring & Maintenance

### View Logs

```bash
# Tail Worker logs
wrangler tail

# Tail with pretty formatting
wrangler tail --format pretty

# Filter by status
wrangler tail --status error
```

### Check Health

```bash
# Check overall status
curl "${WORKER_URL}/status"

# Check database stats
curl "${WORKER_URL}/api/db/stats" \
  -H "Authorization: Bearer ${API_TOKEN}"

# Check storage stats
curl "${WORKER_URL}/api/r2/stats" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

### Container Management

```bash
# Stop bot
curl -X POST "${WORKER_URL}/bot/stop" \
  -H "Authorization: Bearer ${API_TOKEN}"

# Restart bot (stop, then start)
curl -X POST "${WORKER_URL}/bot/stop" \
  -H "Authorization: Bearer ${API_TOKEN}"

curl -X POST "${WORKER_URL}/bot/start" \
  -H "Authorization: Bearer ${API_TOKEN}"
```

### Database Queries

```bash
# Query database via Worker API
curl -X POST "${WORKER_URL}/api/db/query" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "sql": "SELECT COUNT(*) as count FROM signal_messages",
    "params": []
  }'
```

---

## Troubleshooting

### Worker Issues

**Problem: Worker not responding**
```bash
# Check deployment status
wrangler deployments list

# Redeploy
npm run deploy
```

**Problem: D1 binding not working**
```bash
# Verify database exists
wrangler d1 list

# Verify database ID in wrangler.toml matches
wrangler d1 info signal-bot-db
```

### Container Issues

**Problem: Container not starting**
```bash
# Check container logs
wrangler tail --format pretty

# Look for error messages about signal-cli or configuration
```

**Problem: signal-cli not registered**
```bash
# Re-register (see Step 7)
# Make sure you backed up registration data
```

### Bot Issues

**Problem: Bot not receiving messages**
```bash
# Check bot status
curl "${WORKER_URL}/bot/status"

# Restart bot
curl -X POST "${WORKER_URL}/bot/stop"
curl -X POST "${WORKER_URL}/bot/start"
```

**Problem: Commands not working**
```bash
# Check command logs in Worker tail
wrangler tail --format pretty

# Look for errors in command processing
```

---

## Cost Estimates

### Cloudflare Workers Paid Plan

**Monthly costs** (assuming moderate usage):

| Service | Usage | Cost |
|---------|-------|------|
| Workers | 10M requests | $5.00 (base) |
| D1 | 25M reads, 50k writes | $0.375 |
| R2 | 10GB storage, 1M ops | $0.15 |
| KV | 100k reads, 1k writes | $0.50 |
| Containers | 2 GiB RAM, 24/7 | ~$15-20 |
| **Total** | | **~$21-26/month** |

**Notes:**
- Container costs are pay-per-use (memory × time)
- Set `sleepAfter: "10m"` to reduce costs during inactivity
- Most costs are variable and scale with usage
- Much cheaper than traditional VPS hosting

---

## Production Recommendations

### Security

1. **Use strong tokens**:
   ```bash
   openssl rand -base64 32
   ```

2. **Rotate secrets regularly**:
   ```bash
   wrangler secret put WORKER_API_TOKEN
   # Enter new token
   ```

3. **Enable rate limiting** (configured in wrangler.toml):
   ```toml
   [vars]
   RATE_LIMIT_PER_MINUTE = "100"
   ```

4. **Backup registration data**:
   ```bash
   # Regularly backup signal-cli data
   tar -czf backup-$(date +%Y%m%d).tar.gz signal-data/
   ```

### Performance

1. **Use D1 indexes** (already in schema):
   - Indexes on `group_id`, `source_number`, `timestamp`
   - Speeds up common queries

2. **Enable KV caching**:
   - Cache frequently accessed data
   - Reduce D1 reads

3. **Optimize container sleep**:
   - Set `sleepAfter: "10m"` to save costs
   - Container wakes up automatically on requests

### Monitoring

1. **Set up alerts**:
   - Use Cloudflare's notification system
   - Alert on Worker errors, high response times

2. **Monitor costs**:
   - Check Cloudflare dashboard regularly
   - Set billing alerts

3. **Track usage**:
   - Use `/status` endpoint for health checks
   - Use `/api/db/stats` for database metrics

---

## Updating the Bot

### Update Worker

```bash
cd cloudflare-workers/signal-bot

# Pull latest code
git pull

# Install dependencies
npm install

# Deploy
npm run deploy
```

### Update Container

```bash
cd cloudflare-workers/signal-bot/container

# Pull latest code
git pull

# Rebuild image
docker build -t signal-cli-bot:latest .

# Tag and push
docker tag signal-cli-bot:latest registry.cloudflare.com/YOUR_ACCOUNT_ID/signal-cli-bot:latest
docker push registry.cloudflare.com/YOUR_ACCOUNT_ID/signal-cli-bot:latest

# Redeploy
wrangler deploy --container

# Restart bot
curl -X POST "${WORKER_URL}/bot/stop"
curl -X POST "${WORKER_URL}/bot/start"
```

---

## Next Steps

1. **Join Signal groups**: Test bot in Signal groups
2. **Monitor usage**: Watch logs and metrics
3. **Add features**: Extend bot commands as needed
4. **Set up backups**: Regular database and registration backups
5. **Enable WebSocket** (optional): For real-time updates

---

## Support

- **Cloudflare Docs**: https://developers.cloudflare.com
- **Signal CLI**: https://github.com/AsamK/signal-cli
- **Issues**: Report bugs in your repository

---

**Congratulations! Your Signal bot is now running on Cloudflare's global network! 🎉**
