# Signal CLI Bot - Quick Start Guide

Get your Signal bot running on Cloudflare in under 10 minutes!

## Prerequisites Checklist

- [ ] Cloudflare account with Workers Paid plan ($5/month)
- [ ] Wrangler CLI installed (`npm install -g wrangler`)
- [ ] Docker installed and running
- [ ] Authenticated with Cloudflare (`wrangler login`)

## 5-Step Quick Deploy

### Step 1: Install Dependencies

```bash
cd cloudflare-workers/signal-bot
npm install
```

### Step 2: Create Infrastructure

```bash
# Create KV namespace
npm run kv:create

# Create R2 bucket
npm run r2:create
```

**Important:** Copy the KV namespace ID from the output and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SIGNAL_CACHE"
id = "paste-your-namespace-id-here"
```

### Step 3: Set Secrets

```bash
# Set your Signal phone number
npm run secret:set-phone
# Enter: +19108471202 (or your number)

# Optional: Set OpenAI API key for AI features
npm run secret:set-openai
```

### Step 4: Deploy Everything

```bash
./deploy.sh
```

Or manually:

```bash
# Build and deploy
npm run container:push
```

### Step 5: Verify Deployment

```bash
# Check worker health
curl https://signal-cli-bot.<your-subdomain>.workers.dev/health

# Check full status
curl https://signal-cli-bot.<your-subdomain>.workers.dev/status
```

## Expected Output

If successful, you should see:

```json
{
  "worker": {
    "status": "healthy",
    "version": "1.0.0",
    "timestamp": "2025-01-18T12:00:00.000Z"
  },
  "container": {
    "status": "healthy",
    "instance": "primary-bot",
    "lastChecked": "2025-01-18T12:00:00.000Z"
  }
}
```

## Register Signal Account (If Needed)

If you don't have an existing Signal account in the container:

### 1. Get Captcha

Visit: https://signalcaptchas.org/registration/generate.html

Copy the captcha token.

### 2. Register Phone Number

```bash
curl -X POST "https://signal-cli-bot.<your-subdomain>.workers.dev/v1/register/+19108471202" \
  -H "Content-Type: application/json" \
  -d '{
    "captcha": "YOUR_CAPTCHA_TOKEN_HERE"
  }'
```

### 3. Verify with SMS Code

You'll receive an SMS code. Use it to verify:

```bash
curl -X POST "https://signal-cli-bot.<your-subdomain>.workers.dev/v1/register/+19108471202/verify/123456"
```

Replace `123456` with your actual SMS code.

## Migrate Existing Signal Data (Optional)

If you have existing signal-data from local setup:

```bash
# Navigate to project root
cd ../..

# Install wrangler if not already
npm install -g wrangler

# Upload signal data to R2
wrangler r2 object put signal-cli-data/accounts.json \
  --file=./signal-data/data/accounts.json

# Upload avatars (if any)
# Repeat for other files as needed
```

## Troubleshooting

### "Container not starting"

**Check logs:**
```bash
cd cloudflare-workers/signal-bot
npm run logs
```

**Common fixes:**
- Ensure Docker is running
- Check if secrets are set correctly
- Increase memory in wrangler.toml

### "Account not registered"

Either:
- Upload existing signal-data to R2 (see above)
- Register new account (see "Register Signal Account")

### "Rate limit exceeded"

Adjust limits in `src/index.js`:
```javascript
const limit = 100; // Change to higher value
```

### "Deployment failed"

1. Check you're on Workers Paid plan
2. Verify wrangler is authenticated: `wrangler whoami`
3. Check KV namespace ID is set in wrangler.toml
4. View detailed error: `npm run tail`

## Next Steps

Once deployed and healthy:

1. **Update your app** to use the Worker URL:
   ```bash
   # In your .env.local
   SIGNAL_CLI_REST_API_BASE_URL=https://signal-cli-bot.<your-subdomain>.workers.dev
   ```

2. **Test sending a message:**
   ```bash
   curl -X POST "https://signal-cli-bot.<your-subdomain>.workers.dev/v1/send" \
     -H "Content-Type: application/json" \
     -d '{
       "number": "+19108471202",
       "recipients": ["+1234567890"],
       "message": "Hello from Cloudflare!"
     }'
   ```

3. **Monitor your bot:**
   - Cloudflare Dashboard: https://dash.cloudflare.com
   - Real-time logs: `npm run logs`
   - Metrics: View in Cloudflare dashboard

4. **Set up custom domain (optional):**
   ```bash
   wrangler publish --routes="bot.yourdomain.com/*"
   ```

## Cost Breakdown

| Service | Cost |
|---------|------|
| Workers Paid Plan | $5/month (base) |
| Containers | TBD (beta) |
| R2 Storage | ~$0.01-0.15/month |
| KV Reads/Writes | ~$0.50-5/month |
| **Estimated Total** | **$10-30/month** |

## Getting Help

- 📚 Full docs: `README.md`
- 💬 Cloudflare Discord: https://discord.gg/cloudflaredev
- 📖 Cloudflare Docs: https://developers.cloudflare.com/containers/
- 🤖 Signal CLI API: https://bbernhard.github.io/signal-cli-rest-api/

## Rollback to Local Bot

If needed, you can always rollback:

```bash
# Delete Cloudflare deployment
cd cloudflare-workers/signal-bot
wrangler delete signal-cli-bot

# Start local bot
cd ../..
node start-native-signal-bot.js
```

Your local signal-data is unchanged!

---

**That's it!** Your Signal bot is now running globally on Cloudflare's edge network. 🎉
