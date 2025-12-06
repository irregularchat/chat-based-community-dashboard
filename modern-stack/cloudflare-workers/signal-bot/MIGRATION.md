# Migrating Signal Bot to Cloudflare Containers

This guide walks you through migrating your Signal bot to use Cloudflare Containers while keeping all existing functionality intact.

## Pre-Migration Checklist

✅ Read `ARCHITECTURE.md` to understand the hybrid approach
✅ Backup your signal-data directory
✅ Backup your database
✅ Test current bot is working
✅ Have Cloudflare Workers Paid plan
✅ Have wrangler CLI installed and authenticated

## Architecture Summary

**Before:**
```
Next.js App → Native signal-cli (localhost)
```

**After:**
```
Next.js App → Cloudflare Worker → Container (signal-cli) → Signal Network
```

**What Changes:**
- Signal CLI runs in Cloudflare Container (global edge)

**What Stays:**
- Next.js app (unchanged)
- Database (unchanged)
- All bot features (unchanged)
- tRPC API routes (unchanged)

## Step-by-Step Migration

### Step 1: Deploy Cloudflare Container

#### 1.1 Navigate to Worker Directory

```bash
cd cloudflare-workers/signal-bot
```

#### 1.2 Install Dependencies

```bash
npm install
```

#### 1.3 Login to Cloudflare

```bash
wrangler login
```

#### 1.4 Create Infrastructure

```bash
# Create KV namespace for rate limiting
npm run kv:create

# Copy the namespace ID from output, then edit wrangler.toml:
# [[kv_namespaces]]
# binding = "SIGNAL_CACHE"
# id = "paste-your-id-here"

# Create R2 bucket for signal data (optional)
npm run r2:create
```

#### 1.5 Set Secrets

```bash
# Required: Signal phone number
npm run secret:set-phone
# Enter: +19108471202 (your bot's number)

# Optional: API authentication token
# wrangler secret put API_AUTH_TOKEN
# Enter a secure random token if you want auth
```

#### 1.6 Deploy

```bash
./deploy.sh

# Or manually:
# docker build -t signal-cli-bot:latest .
# npm run deploy
```

#### 1.7 Note Worker URL

After deployment, note your Worker URL:
```
https://signal-cli-bot.your-subdomain.workers.dev
```

### Step 2: Register Signal Account in Container

You have two options:

#### Option A: Fresh Registration (Recommended for Testing)

1. Get captcha token from: https://signalcaptchas.org/registration/generate.html

2. Register via Worker API:
```bash
curl -X POST "https://signal-cli-bot.your-subdomain.workers.dev/v1/register/+19108471202" \
  -H "Content-Type: application/json" \
  -d '{
    "captcha": "YOUR_CAPTCHA_TOKEN"
  }'
```

3. Verify with SMS code:
```bash
curl -X POST "https://signal-cli-bot.your-subdomain.workers.dev/v1/register/+19108471202/verify/123456"
```

#### Option B: Migrate Existing Account Data

**⚠️ WARNING**: This is advanced and may not work perfectly. Prefer fresh registration.

```bash
# Your existing signal-data is in:
# ./signal-data/data/{phone-number}.d/

# Container needs this data in its volume
# Currently, there's no direct way to upload to container volume
# Workaround: Register fresh account (Option A)
```

### Step 3: Test Container

#### 3.1 Test Worker Health

```bash
curl https://signal-cli-bot.your-subdomain.workers.dev/health
```

Expected:
```json
{
  "status": "healthy",
  "worker": "signal-cli-bot-proxy",
  "version": "2.0.0",
  "role": "proxy",
  "architecture": "hybrid"
}
```

#### 3.2 Test Container Health

```bash
curl https://signal-cli-bot.your-subdomain.workers.dev/v1/health
```

Expected:
```json
{
  "status": "healthy"
}
```

#### 3.3 Test Full Status

```bash
curl https://signal-cli-bot.your-subdomain.workers.dev/status
```

Expected:
```json
{
  "worker": {
    "status": "healthy",
    ...
  },
  "container": {
    "status": "healthy",
    "instance": "primary-bot"
  },
  "overall": "healthy"
}
```

### Step 4: Update Next.js App Configuration

#### 4.1 Stop Current Bot

```bash
# If running:
# Ctrl+C to stop start-native-signal-bot.js
# Or via admin panel: Signal Bot → Stop Bot
```

#### 4.2 Update Environment Variables

Edit `.env.local`:

```bash
# Change this line (IMPORTANT):
SIGNAL_CLI_REST_API_BASE_URL=https://signal-cli-bot.your-subdomain.workers.dev

# Keep these unchanged:
DATABASE_URL=postgresql://user:pass@localhost:5436/dashboarddb
SIGNAL_PHONE_NUMBER=+19108471202
SIGNAL_BOT_PHONE_NUMBER=+19108471202
SIGNAL_BOT_ENABLED=true
OPENAI_ACTIVE=true
OPENAI_API_KEY=sk-...
# ... all other variables stay the same
```

#### 4.3 Restart Next.js App

```bash
# Development:
npm run dev

# Production:
npm run build
npm run start
```

### Step 5: Start Bot in Next.js

The bot service will now connect to the containerized signal-cli via the Worker.

#### Option A: Via Script

```bash
node start-native-signal-bot.js
```

#### Option B: Via Admin Panel

1. Go to admin panel: `http://localhost:3000/admin/signal`
2. Click "Start Bot"
3. Monitor health status

### Step 6: Test Integration

#### 6.1 Test tRPC Endpoints

Open admin panel → Signal Bot:

1. **Get Groups**: Should show your Signal groups
2. **Get Users**: Should show contacts
3. **Health Check**: Should be green/healthy
4. **Send Test Message**: Try sending to yourself

#### 6.2 Test Bot Commands

Send a message to any group the bot is in:

```
!ping
```

Expected response:
```
🏓 Pong! Bot is responsive.
```

Try other commands:
```
!help
!whoami
```

#### 6.3 Test Database Features

These should all work (they use Next.js app's database):

```
!ask What is the best programming language?
!questions
!news (share a news link)
```

#### 6.4 Monitor Logs

**Worker logs:**
```bash
cd cloudflare-workers/signal-bot
npm run logs
```

**Next.js logs:**
```bash
# Check terminal where Next.js is running
# Should see bot activity
```

### Step 7: Verify All Features Work

Test each category of features:

#### Database Features ✅
- [ ] Q&A System (`!ask`, `!questions`, `!answer`)
- [ ] News processing (auto-detect links)
- [ ] Repository analysis (GitHub/GitLab links)
- [ ] Member tracking
- [ ] Join request moderation

#### AI Features ✅
- [ ] `!ai <question>`
- [ ] `!phelp` (personalized help)
- [ ] `!tldr <url>` (URL summarization)

#### Bot Commands ✅
- [ ] `!help` (command list)
- [ ] `!ping` (health check)
- [ ] `!whoami` (user info)
- [ ] URL cleaner (auto-clean tracking URLs)

#### Admin Functions ✅
- [ ] Group management via admin panel
- [ ] User management
- [ ] Join request approval/denial
- [ ] Health monitoring
- [ ] Analytics

### Step 8: Production Migration

Once testing is complete:

#### 8.1 Update Production Environment

```bash
# In production .env (or environment variables):
SIGNAL_CLI_REST_API_BASE_URL=https://signal-cli-bot.your-subdomain.workers.dev
```

#### 8.2 Deploy to Production

```bash
# Deploy Worker to production
cd cloudflare-workers/signal-bot
npm run deploy:production

# Deploy Next.js app
npm run build
npm run start
```

#### 8.3 Monitor

- Check Cloudflare Dashboard → Workers & Pages → signal-cli-bot
- Monitor logs: `npm run logs`
- Check admin panel health dashboard
- Monitor database for bot activity

## Rollback Plan

If anything goes wrong, rollback is simple:

### Quick Rollback

```bash
# 1. Stop bot
# Ctrl+C or admin panel → Stop Bot

# 2. Restore .env.local
SIGNAL_CLI_REST_API_BASE_URL=http://localhost:50240

# 3. Start local container (if using Docker)
docker-compose -f docker-compose.signal-cli.yml up -d

# 4. Start local bot
node start-native-signal-bot.js
```

Your signal-data directory is unchanged, so local bot will work immediately.

## Troubleshooting

### Container Not Starting

**Symptom:** `/status` shows container unhealthy

**Solutions:**
1. Check Worker logs: `npm run logs`
2. Verify container deployment: Check Cloudflare Dashboard
3. Check SIGNAL_PHONE_NUMBER secret is set
4. Restart container: `wrangler deploy --force`

### Bot Commands Not Working

**Symptom:** Bot doesn't respond to commands

**Possible causes:**
1. **Bot not started in Next.js**: Start via `start-native-signal-bot.js` or admin panel
2. **Wrong API URL**: Check `.env.local` has correct Worker URL
3. **Account not registered**: Container needs registered Signal account

**Solutions:**
1. Check Next.js bot logs
2. Verify `SIGNAL_CLI_REST_API_BASE_URL` in `.env.local`
3. Test Worker health: `curl .../health`
4. Test container health: `curl .../v1/health`

### Database Features Not Working

**Symptom:** Q&A, news tracking, etc. not working

**This shouldn't happen** - database stays with Next.js app.

**Check:**
1. Next.js app is running
2. DATABASE_URL is correct
3. Prisma migrations are up to date: `npx prisma migrate deploy`
4. Bot service is running in Next.js

### Rate Limit Errors

**Symptom:** Getting 429 errors

**Solutions:**
1. Increase rate limit in wrangler.toml:
   ```toml
   [env.production.vars]
   RATE_LIMIT_PER_MINUTE = "200"
   ```
2. Or disable rate limiting temporarily (not recommended)
3. Check if legitimate traffic is being blocked

### High Latency

**Symptom:** Slow bot responses

**Expected latency:** 50-500ms (acceptable)

**If > 1 second:**
1. Check Worker region: Should be global
2. Check Next.js app location: Should be internet-accessible
3. Monitor Worker response times: `npm run logs`
4. Check container isn't sleeping: Increase `sleepAfter` in wrangler.toml

## Performance Optimization

### Reduce Container Cold Starts

Edit `wrangler.toml`:
```toml
[[containers]]
sleepAfter = "30m"  # Keep alive longer
```

Or keep warm with health check cron:
```toml
[triggers]
crons = ["*/5 * * * *"]  # Ping every 5 minutes
```

### Increase Rate Limits

For high-traffic groups:
```toml
[env.production.vars]
RATE_LIMIT_PER_MINUTE = "500"
```

### Enable Authentication

For security:
```bash
wrangler secret put API_AUTH_TOKEN
# Enter a secure random token
```

Update Next.js app to include token in requests.

## Monitoring

### Key Metrics to Watch

1. **Worker Health**: `/health` endpoint
2. **Container Health**: `/v1/health` via Worker
3. **Database Connectivity**: Check Next.js app logs
4. **Bot Response Time**: Monitor Cloudflare dashboard
5. **Error Rate**: Check bot_errors table in database

### Cloudflare Dashboard

Monitor at: `https://dash.cloudflare.com`

- Workers & Pages → signal-cli-bot
- View real-time requests
- Check error rates
- Monitor CPU/memory usage

### Database Monitoring

Query analytics tables:
```sql
-- Bot activity
SELECT COUNT(*) FROM bot_command_usage WHERE timestamp > NOW() - INTERVAL '1 hour';

-- Recent errors
SELECT * FROM bot_errors ORDER BY timestamp DESC LIMIT 10;

-- Message volume
SELECT COUNT(*) FROM signal_messages WHERE "createdAt" > NOW() - INTERVAL '1 day';
```

## Cost Tracking

Monitor costs:

| Service | Expected Monthly Cost |
|---------|----------------------|
| Cloudflare Worker | $5 (Paid plan) |
| Cloudflare Container | TBD (beta) |
| R2 Storage | ~$0.01-0.15 |
| KV Storage | ~$0.50-5 |
| Next.js hosting | (your existing cost) |
| PostgreSQL | (your existing cost) |

## Next Steps After Migration

1. ✅ Monitor for 24-48 hours
2. ✅ Verify all features working
3. ✅ Check database is being updated
4. ✅ Test all bot commands
5. ✅ Review error logs
6. ✅ Optimize rate limits if needed
7. ✅ Enable authentication if desired
8. ✅ Set up monitoring alerts
9. ✅ Update team documentation
10. ✅ Celebrate! 🎉

## Support

If you encounter issues:

1. Check `ARCHITECTURE.md` for design details
2. Check Worker logs: `npm run logs`
3. Check Next.js logs in terminal
4. Check database bot_errors table
5. Test endpoints manually with curl
6. Ask in Cloudflare Discord: https://discord.gg/cloudflaredev

## Summary

This migration is designed to be **low-risk** and **easily reversible**:

✅ Database unchanged
✅ Next.js app mostly unchanged
✅ All features preserved
✅ Easy rollback (just change URL)
✅ Local dev still works

The only significant change is Signal CLI now runs in Cloudflare Container instead of localhost, giving you global edge performance while keeping all your custom logic and data safe.
