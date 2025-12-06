# Cloudflare Container Deployment Guide

**For Signal Bot - No Local Docker Required**

This guide shows how to deploy the Signal bot container to Cloudflare's global network without needing Docker Desktop running on your local machine.

## Prerequisites

- ✅ Worker API deployed (you have this!)
- ✅ D1, R2, KV configured (done!)
- ✅ Wrangler CLI installed
- ⏳ Signal account registration (we'll do this)

## Deployment Options

### Option 1: Use Cloudflare's Build Service (Recommended)

Cloudflare can build your container image remotely - no local Docker needed!

```bash
cd container

# Build on Cloudflare's infrastructure
wrangler containers build .

# This uploads your Dockerfile and source code
# Cloudflare builds the image remotely
# Returns an image ID when complete
```

### Option 2: Use GitHub Actions (Best for CI/CD)

If you push to GitHub, we can use GitHub Actions to build and deploy automatically.

### Option 3: Use a Cloud Build Service

- Google Cloud Build (free tier available)
- AWS CodeBuild
- Fly.io (simple Docker builds)

## Step-by-Step: Cloudflare Container Deployment

### Step 1: Prepare the Container

Your container is already configured with:
- ✅ R2-backed persistent storage
- ✅ Automatic signal-data sync
- ✅ Worker API integration
- ✅ Graceful shutdown handling

### Step 2: Register Signal Account (One-Time)

**Challenge**: We need to register with Signal before deploying.

**Solution A - Use a Temporary Cloud VM**:

1. Spin up a small cloud VM (AWS EC2 t2.micro, Google Compute e2-micro free tier)
2. Install Docker on the VM
3. Run registration:
```bash
# On the cloud VM
docker run -it --rm \
  -e SIGNAL_PHONE_NUMBER=+19108471202 \
  signal-cli-bot:latest \
  signal-cli -a +19108471202 register

# Enter verification code from SMS
docker run -it --rm \
  -e SIGNAL_PHONE_NUMBER=+19108471202 \
  signal-cli-bot:latest \
  signal-cli -a +19108471202 verify YOUR_CODE
```

4. Upload signal-data to R2:
```bash
tar -czf signal-data.tar.gz signal-data/
# Upload via Worker API or wrangler
```

**Solution B - Use signal-cli Standalone**:

Download signal-cli locally (no Docker needed):
```bash
# macOS
brew install signal-cli

# Or download from: https://github.com/AsamK/signal-cli/releases

# Register
signal-cli -a +19108471202 register

# Verify
signal-cli -a +19108471202 verify YOUR_CODE

# Upload to R2
cd ~/.local/share/signal-cli  # or your config dir
tar -czf signal-data.tar.gz data/
# Upload using curl to Worker API
```

### Step 3: Upload Signal Data to R2

```bash
# Encode to base64
BASE64_DATA=$(base64 -i signal-data.tar.gz | tr -d '\n')

# Upload via Worker API
curl -X POST https://signal-cli-bot.wemea-5ahhf.workers.dev/api/r2/upload \
  -H "Authorization: Bearer fE5bDjRu5B4HIOXq5rQkbKz5hOTGBSvMFcA+0LzcyxY=" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "signal-data-backup.tar.gz",
    "content": "'$BASE64_DATA'",
    "contentType": "application/gzip",
    "encoding": "base64"
  }'
```

### Step 4: Build Container on Cloudflare

```bash
cd container

# Build remotely (no local Docker needed!)
wrangler containers build .

# Output will show build progress
# Returns image ID when complete
```

### Step 5: Push to Cloudflare Registry

```bash
# Tag the built image
wrangler containers push signal-bot:latest

# This makes it available for deployment
```

### Step 6: Deploy Container

Option A - Using wrangler.toml:

Add to `wrangler.toml`:
```toml
[[services]]
name = "signal-bot-container"
image = "signal-bot:latest"
memory = "2GiB"
cpu = 2
port = 8080

[services.env]
MODE = "production"
PORT = "8080"
AUTO_START = "true"
```

Then deploy:
```bash
wrangler deploy
```

Option B - Using CLI:

```bash
wrangler containers create \
  --name signal-bot-container \
  --image signal-bot:latest \
  --memory 2GiB \
  --cpu 2 \
  --port 8080
```

### Step 7: Verify Deployment

```bash
# List containers
wrangler containers list

# Check container status
wrangler containers info signal-bot-container

# View logs
wrangler containers logs signal-bot-container
```

### Step 8: Test the Bot

Send a message to +19108471202 from Signal:
```
!help
```

You should receive a response with available commands!

## Alternative: Deploy to Fly.io (Easier for Signal Bot)

If Cloudflare Containers is complex, Fly.io has better support for stateful containers:

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
flyctl auth login

# Initialize (in container directory)
cd container
flyctl launch --name signal-bot

# Set secrets
flyctl secrets set \
  SIGNAL_PHONE_NUMBER=+19108471202 \
  WORKER_API_URL=https://signal-cli-bot.wemea-5ahhf.workers.dev \
  WORKER_API_TOKEN=fE5bDjRu5B4HIOXq5rQkbKz5hOTGBSvMFcA+0LzcyxY= \
  OPENAI_ACTIVE=true

# Deploy
flyctl deploy

# Create persistent volume (for signal-data)
flyctl volumes create signal_data --size 1

# Scale to keep always running
flyctl scale count 1
```

Cost: ~$5-10/month

## Troubleshooting

### Container won't start

Check logs:
```bash
wrangler containers logs signal-bot-container --tail
```

Common issues:
- Missing environment variables
- Signal data not in R2
- Worker API URL incorrect

### Signal data not persisting

Verify R2 backup exists:
```bash
curl -H "Authorization: Bearer fE5bDjRu5B4HIOXq5rQkbKz5hOTGBSvMFcA+0LzcyxY=" \
  https://signal-cli-bot.wemea-5ahhf.workers.dev/api/r2/list
```

Should show `signal-data-backup.tar.gz`

### Bot not responding to messages

1. Check container is running: `wrangler containers list`
2. Check logs: `wrangler containers logs signal-bot-container`
3. Verify Worker API: `curl https://signal-cli-bot.wemea-5ahhf.workers.dev/health`
4. Test Signal connection from container

## Cost Breakdown

**Cloudflare (recommended)**:
- Worker: ~$5/month
- D1: ~$5/month
- R2: ~$5/month
- KV: ~$5/month
- Container: ~$1-6/month
- **Total: ~$21-26/month**

**Fly.io alternative**:
- Compute: ~$5-10/month
- Plus Cloudflare services: ~$20/month
- **Total: ~$25-30/month**

## Summary

You have two main paths:

1. **Cloudflare All-In-One** (Recommended for keeping everything in one platform)
   - Register Signal using signal-cli standalone or cloud VM
   - Upload signal-data to R2
   - Build container remotely with `wrangler containers build`
   - Deploy with `wrangler containers create`

2. **Fly.io Hybrid** (Easier for stateful containers)
   - Deploy container to Fly.io
   - Keep Worker API on Cloudflare
   - Container calls Worker API for D1/R2 access
   - Simpler persistent volume management

Both options give you a globally-distributed Signal bot running 24/7!

## Next Steps

Choose your deployment path:
- [ ] Option 1: Continue with Cloudflare Containers
- [ ] Option 2: Switch to Fly.io for container

Then:
1. Register Signal account
2. Upload signal-data to R2 (or Fly.io volume)
3. Deploy container
4. Test with `!help` command

Your Worker API is already live and working - just need the container running!
