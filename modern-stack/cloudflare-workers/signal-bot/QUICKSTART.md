# Signal Bot - Quick Start Guide

Get your Signal bot running on Cloudflare in 30 minutes.

## Prerequisites

```bash
# Install tools
npm install -g wrangler
docker --version

# Authenticate
wrangler login
```

## 5-Step Deployment

### Step 1: Clone & Setup (2 min)

```bash
cd cloudflare-workers/signal-bot

# Install dependencies
npm install
cd container && npm install && cd ..

# Verify everything is ready
./scripts/pre-deployment-check.sh
```

### Step 2: Infrastructure (10 min)

```bash
# Create D1 database
./database/setup.sh

# Create R2 bucket
wrangler r2 bucket create signal-cli-data

# Create KV namespace
wrangler kv:namespace create SIGNAL_CACHE
# Copy the ID and update wrangler.toml
```

### Step 3: Secrets (3 min)

```bash
# Set Signal phone number
wrangler secret put SIGNAL_PHONE_NUMBER
# Enter: +1XXXXXXXXXX

# Generate and set API token
openssl rand -base64 32
wrangler secret put WORKER_API_TOKEN
# Paste the token

# Optional: OpenAI API key
wrangler secret put OPENAI_API_KEY
wrangler secret put OPENAI_ACTIVE
# Enter: true
```

### Step 4: Deploy (5 min)

```bash
# Deploy Worker
npm run deploy

# Note your Worker URL
# Example: https://signal-cli-bot.YOUR-SUBDOMAIN.workers.dev

# Set Worker URL for container
wrangler secret put WORKER_API_URL
# Enter: https://signal-cli-bot.YOUR-SUBDOMAIN.workers.dev
```

### Step 5: Container (10 min)

```bash
cd container

# Build image
docker build -t signal-cli-bot:latest .

# Register Signal account (FIRST TIME ONLY)
docker run -it --rm \
  -v $(pwd)/signal-data:/app/signal-data \
  signal-cli-bot:latest \
  signal-cli -a +1XXXXXXXXXX register

# You'll receive SMS - verify with:
docker run -it --rm \
  -v $(pwd)/signal-data:/app/signal-data \
  signal-cli-bot:latest \
  signal-cli -a +1XXXXXXXXXX verify CODE_HERE

# Deploy to Cloudflare
cd ..
wrangler deploy --container
```

## Start the Bot

```bash
# Start bot
curl -X POST "https://signal-cli-bot.YOUR-SUBDOMAIN.workers.dev/bot/start" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Check status
curl "https://signal-cli-bot.YOUR-SUBDOMAIN.workers.dev/bot/status" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Test the Bot

Send a message to your bot's phone number from Signal:

```
!help
```

You should receive a response with available commands!

## Quick Test

```bash
# Run automated tests
./test-deployment.sh
```

## Monitor

```bash
# Watch logs
wrangler tail --format pretty

# Monitor status
./scripts/monitor.sh
```

## Troubleshooting

**Bot not responding?**
```bash
# Check status
curl https://YOUR-WORKER.workers.dev/status

# Restart bot
curl -X POST https://YOUR-WORKER.workers.dev/bot/stop \
  -H "Authorization: Bearer YOUR_TOKEN"
curl -X POST https://YOUR-WORKER.workers.dev/bot/start \
  -H "Authorization: Bearer YOUR_TOKEN"

# Check logs
wrangler tail
```

**Database issues?**
```bash
# Verify database exists
wrangler d1 list

# Check tables
wrangler d1 execute signal-bot-db \
  --command="SELECT name FROM sqlite_master WHERE type='table';" \
  --remote
```

**Container issues?**
```bash
# Check container logs
wrangler tail --format pretty

# Verify container is running
curl https://YOUR-WORKER.workers.dev/status
```

## Next Steps

- ✅ Bot is running!
- 📱 Add bot to Signal groups
- 📊 Monitor with `./scripts/monitor.sh`
- 💾 Schedule backups: `./scripts/backup-database.sh`
- 📚 Read full docs: `DEPLOYMENT.md`

## Cost

**~$21-26/month** for moderate usage (10k messages/day)

## Commands

Once your bot is running, try:

- `!help` - Show all commands
- `!ping` - Test bot
- `!ai What is Cloudflare?` - Ask AI
- `!ask How do I deploy?` - Post question
- `!questions` - List questions
- `!stats` - Bot statistics

## Support

- Full Guide: [DEPLOYMENT.md](./DEPLOYMENT.md)
- API Docs: [WORKER_API.md](./WORKER_API.md)
- Architecture: [README.md](./README.md)

---

**🎉 Your Signal bot is now running globally on Cloudflare!**

*Response time <50ms from anywhere in the world*
