# Signal CLI Bot - Quick Start Guide (Hybrid Architecture)

Get your Signal bot running on Cloudflare Containers while keeping all features in Next.js!

## What is This?

This deploys your Signal CLI to Cloudflare's global edge network while keeping all your custom bot logic, database, and features in your existing Next.js app.

**Architecture:**
```
Next.js App (Your Server) → Cloudflare Worker → Container (signal-cli) → Signal Network
```

## Prerequisites Checklist

- [ ] Cloudflare account with Workers Paid plan ($5/month)
- [ ] Wrangler CLI installed (`npm install -g wrangler`)
- [ ] Docker installed and running
- [ ] Authenticated with Cloudflare (`wrangler login`)
- [ ] Your Next.js app is running

## 3-Step Quick Deploy

### Step 1: Deploy Container to Cloudflare

```bash
cd cloudflare-workers/signal-bot
npm install

# Login to Cloudflare
wrangler login

# Create KV namespace
npm run kv:create
# Copy the namespace ID to wrangler.toml

# Set secrets
npm run secret:set-phone
# Enter: +19108471202 (your bot's number)

# Deploy
./deploy.sh
```

Note your Worker URL: `https://signal-cli-bot.your-subdomain.workers.dev`

### Step 2: Register Signal Account in Container

Get captcha: https://signalcaptchas.org/registration/generate.html

Register:
```bash
curl -X POST "https://signal-cli-bot.your-subdomain.workers.dev/v1/register/+19108471202" \
  -H "Content-Type": application/json" \
  -d '{"captcha": "YOUR_CAPTCHA_TOKEN"}'
```

Verify with SMS code:
```bash
curl -X POST "https://signal-cli-bot.your-subdomain.workers.dev/v1/register/+19108471202/verify/123456"
```

### Step 3: Connect Next.js App to Container

Edit `.env.local` in your Next.js project root:

```bash
# Change this line:
SIGNAL_CLI_REST_API_BASE_URL=https://signal-cli-bot.your-subdomain.workers.dev

# Keep everything else unchanged!
```

Restart Next.js:
```bash
npm run dev
```

Start bot:
```bash
node start-native-signal-bot.js
```

## Verify It Works

### Test 1: Worker Health

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

### Test 2: Container Health

```bash
curl https://signal-cli-bot.your-subdomain.workers.dev/v1/health
```

Expected:
```json
{
  "status": "healthy"
}
```

### Test 3: Bot Commands

Send a message in any Signal group the bot is in:

```
!ping
```

Expected response:
```
🏓 Pong! Bot is responsive.
```

### Test 4: Admin Panel

1. Go to: `http://localhost:3000/admin/signal`
2. Check "Signal Bot Health" - should be green
3. Try "Get Groups" - should list your groups
4. Check database features work (Q&A, news tracking, etc.)

## What Changed vs. Local Setup?

| Component | Before | After | Changed? |
|-----------|--------|-------|----------|
| Signal CLI | Localhost | Cloudflare Container | ✅ Yes |
| Next.js App | Localhost | Localhost | ❌ No |
| Database | PostgreSQL | PostgreSQL | ❌ No |
| Bot Logic | Next.js | Next.js | ❌ No |
| All Features | Working | Working | ❌ No |

**Summary:** Only Signal CLI moved to Cloudflare. Everything else unchanged!

## All Features Still Work

✅ All bot commands (`!help`, `!ping`, `!ai`, etc.)
✅ Q&A system (`!ask`, `!questions`, `!answer`)
✅ News link tracking (automatic)
✅ Repository analysis (GitHub/GitLab links)
✅ URL summarization (`!tldr`)
✅ Member tracking system
✅ Join request moderation
✅ AI integration (OpenAI, Local AI)
✅ Discourse integration
✅ Database operations
✅ Analytics & monitoring
✅ Admin panel
✅ tRPC API routes

**Nothing was removed or disabled.**

## Troubleshooting

### "Container not starting"

**Check logs:**
```bash
cd cloudflare-workers/signal-bot
npm run logs
```

**Common fixes:**
- Ensure Docker is running
- Check SIGNAL_PHONE_NUMBER secret is set
- Verify container deployed: Check Cloudflare Dashboard

### "Bot not responding to commands"

**Checklist:**
1. Is Next.js app running? (`npm run dev`)
2. Is bot started? (`node start-native-signal-bot.js` or admin panel)
3. Is `.env.local` updated with Worker URL?
4. Is account registered in container?

**Test manually:**
```bash
# Test Worker
curl https://signal-cli-bot.your-subdomain.workers.dev/health

# Test Next.js connection to Worker
# Check Next.js terminal logs for errors
```

### "Database features not working"

**This shouldn't happen** - database didn't change.

**Check:**
1. Next.js app is running
2. DATABASE_URL in `.env.local` is correct
3. Prisma is connected: `npx prisma studio`

### "Rate limit exceeded"

Increase limit in `wrangler.toml`:
```toml
[env.production.vars]
RATE_LIMIT_PER_MINUTE = "200"
```

## Rollback to Local Setup

If needed, rollback is instant:

```bash
# 1. Stop bot (Ctrl+C)

# 2. Edit .env.local
SIGNAL_CLI_REST_API_BASE_URL=http://localhost:50240

# 3. Start local container
docker-compose -f docker-compose.signal-cli.yml up -d

# 4. Start bot
node start-native-signal-bot.js
```

Done! Back to local setup.

## Why This Architecture?

### Advantages

✅ **Global Performance**: Signal CLI at edge (low latency worldwide)
✅ **Zero Downtime**: Container auto-scales and restarts
✅ **No Infrastructure**: Let Cloudflare manage containers
✅ **All Features Kept**: Database & business logic untouched
✅ **Easy Rollback**: Just change one URL
✅ **Clean Separation**: Signal protocol ≠ business logic

### Trade-offs

⚠️ **Network Hop**: Adds ~10-50ms latency (negligible)
⚠️ **Two Services**: Next.js + Container (but cleaner)
⚠️ **Beta Pricing**: Container costs TBD (public beta)

## Cost Breakdown

| Service | Monthly Cost |
|---------|-------------|
| Cloudflare Worker | $5 (Paid plan) |
| Cloudflare Container | TBD (beta) |
| R2 Storage | ~$0.01-0.15 |
| KV Cache | ~$0.50-5 |
| Next.js hosting | (your existing cost) |
| PostgreSQL | (your existing cost) |
| **New costs** | **~$10-30/month** |

## Next Steps

1. ✅ **Monitor for 24 hours** - Check everything works
2. ✅ **Test all commands** - Verify features work
3. ✅ **Check database** - Ensure data is being saved
4. ✅ **Review logs** - Worker + Next.js logs
5. ✅ **Optimize** - Adjust rate limits if needed

## Documentation

- **Architecture Details**: `ARCHITECTURE.md`
- **Full Migration Guide**: `MIGRATION.md`
- **Complete Docs**: `README.md`

## Getting Help

- 📚 Read `ARCHITECTURE.md` for design details
- 🔍 Check Worker logs: `npm run logs`
- 💬 Cloudflare Discord: https://discord.gg/cloudflaredev
- 📖 Cloudflare Docs: https://developers.cloudflare.com/containers/

---

**That's it!** Your Signal bot is now running globally on Cloudflare's edge while all your custom features stay safely in your Next.js app. 🎉

**Key takeaway:** Container = Signal CLI only. Your app = Everything else.
