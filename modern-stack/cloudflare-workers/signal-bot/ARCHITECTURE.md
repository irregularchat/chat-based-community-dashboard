# Signal Bot Cloudflare Architecture

## Architecture Decision

After analyzing the codebase, the Signal bot has extensive features that require database access:

### Database Tables Used by Bot (15+ tables):
- `signal_groups` - Group cache
- `signal_group_memberships` - User-group associations
- `signal_available_groups` - Joinable groups
- `signal_group_join_requests` - Join request moderation
- `signal_messages` - Message history (4096 char text)
- `signal_reactions` - Emoji reactions
- `signal_verification_codes` - User verification
- `news_links` - News link tracking
- `repository_links` - GitHub/GitLab repo tracking
- `url_summaries` - URL summarization (!tldr command)
- `bot_command_usage` - Command usage analytics
- `bot_message_reactions` - Bot message feedback
- `bot_errors` - Error logging
- `signal_members` - Member tracking system
- `q_and_a_questions` - Q&A system

### Bot Features Requiring Database:
1. **Q&A System** - `!ask`, `!questions`, `!answer`, `!solve`
2. **News Processing** - Automatic news link detection and forum posting
3. **Repository Analysis** - GitHub/GitLab link enrichment
4. **URL Summarization** - `!tldr` command with AI
5. **Member Tracking** - Comprehensive member deduplication
6. **Join Request Moderation** - Group join approval workflow
7. **Command Analytics** - Usage tracking and metrics
8. **Error Logging** - Debugging and monitoring
9. **Verification System** - Signal account linking
10. **AI Thread Context** - OpenAI/Local AI provider selection
11. **Event Management** - Community event tracking
12. **Discourse Integration** - Forum post creation

### tRPC API Endpoints (30+):
- Group management (getGroups, getNativeGroups)
- User management (getUsers, getDisplayName, updateProfile)
- Bot control (startNativeBot, stopNativeBot, getNativeBotHealth)
- Account registration (registerNativeAccount, verifyNativeAccount)
- Join requests (getPendingJoinRequests, approveJoinRequest, denyJoinRequest)
- Health monitoring (getHealth, getServiceStatus, getSignalCliHealth)
- Backup/restore (createSignalCliBackup, restoreSignalCliFromBackup)
- User features (getMySignalStatus, getAvailableSignalGroups, requestSignalGroupJoin)

## Chosen Architecture: Hybrid Approach

```
┌─────────────────────────────────────────────────────────────┐
│  USER'S BROWSER                                             │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTPS
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  NEXT.JS APP (Current Server)                               │
│  - tRPC API Routes                                          │
│  - Signal Router (30+ procedures)                           │
│  - NativeSignalBotService                                   │
│  - Prisma Database Client                                   │
│  - Business Logic & AI                                      │
└────────┬────────────────────────┬───────────────────────────┘
         │                        │
         │ Database               │ HTTP/REST
         │ (Prisma)               │ (signal-cli API calls)
         ▼                        ▼
┌──────────────────┐    ┌────────────────────────────────────┐
│  PostgreSQL      │    │  Cloudflare Worker                 │
│  localhost:5436  │    │  - Rate limiting                   │
│  (or hosted)     │    │  - Authentication                  │
│                  │    │  - Health checks                   │
└──────────────────┘    │  - Request proxy                   │
                        └─────────────┬──────────────────────┘
                                      │ HTTP
                                      ▼
                        ┌─────────────────────────────────────┐
                        │  Cloudflare Container               │
                        │  - signal-cli-rest-api              │
                        │  - Signal message send/receive      │
                        │  - Group management                 │
                        │  - Account registration             │
                        └────────────┬────────────────────────┘
                                     │ Signal Protocol
                                     ▼
                        ┌─────────────────────────────────────┐
                        │  Signal Messenger Network           │
                        └─────────────────────────────────────┘
```

## Why This Architecture?

### Option 1: Container with Database (NOT CHOSEN)
**Problems:**
- Container would need PostgreSQL access (complex networking)
- Would need to replicate all Prisma models in container
- Duplicate business logic between Next.js and container
- D1 incompatible (no ENUMs, transactions, PostgreSQL features)
- Hyperdrive adds latency for every DB query

### Option 2: Hybrid (CHOSEN) ✅
**Advantages:**
- **Zero changes** to database schema or Prisma models
- **Minimal changes** to existing code
- **Keep all business logic** in Next.js app
- **Clean separation**: Container = signal-cli, Next.js = everything else
- **Easy migration**: Just change API endpoint URL
- **Local dev still works**: Can still run native bot locally

**Trade-off:**
- Next.js app must be accessible from internet (already is)
- Signal messages go: Container → Next.js → Process → Container → Signal
- Adds network hop (minimal latency, ~10-50ms)

## Implementation Details

### 1. Container Role: Signal CLI REST API Only

The container runs **only** the signal-cli REST API service:
- Send messages
- Receive messages (polling)
- List groups
- List contacts
- Register/verify accounts
- Manage group memberships

**No database access needed.**

### 2. Next.js App Role: Business Logic & Database

The Next.js app keeps all existing functionality:
- tRPC API routes (no changes)
- Signal bot service with all commands
- Database operations via Prisma
- AI integration (OpenAI, Local AI)
- Discourse integration
- PDF processing
- All custom commands

**Changes needed:**
- Update `SIGNAL_CLI_REST_API_BASE_URL` to point to Worker URL
- Or keep using local container for dev, Worker for prod

### 3. Worker Role: Proxy & Security

The Cloudflare Worker acts as a proxy:
- Forward all requests to container
- Add authentication (optional)
- Rate limiting (100 req/min default)
- Health monitoring
- Request logging

**No business logic in Worker.**

## Configuration

### Environment Variables

**Container (via Worker secrets):**
```bash
SIGNAL_PHONE_NUMBER=+19108471202
```

**Next.js App (.env.local):**
```bash
# Database (no change)
DATABASE_URL=postgresql://user:pass@localhost:5436/dashboarddb

# Signal CLI API (CHANGE THIS)
SIGNAL_CLI_REST_API_BASE_URL=https://signal-cli-bot.your-subdomain.workers.dev
# Or for local dev:
# SIGNAL_CLI_REST_API_BASE_URL=http://localhost:50240

# Signal Bot
SIGNAL_PHONE_NUMBER=+19108471202
SIGNAL_BOT_PHONE_NUMBER=+19108471202
SIGNAL_BOT_ENABLED=true

# AI Features (no change)
OPENAI_ACTIVE=true
OPENAI_API_KEY=sk-...
LOCAL_AI_URL=https://ai.example.com
LOCAL_AI_API_KEY=...

# Discourse Integration (no change)
DISCOURSE_API_URL=https://forum.irregularchat.com
DISCOURSE_API_KEY=...
DISCOURSE_API_USERNAME=system

# Matrix (if used, no change)
MATRIX_ACTIVE=true
MATRIX_HOMESERVER=...
```

## Migration Steps

### Step 1: Deploy Container
```bash
cd cloudflare-workers/signal-bot
npm install
./deploy.sh
```

Get Worker URL: `https://signal-cli-bot.your-subdomain.workers.dev`

### Step 2: Upload Signal Data to Container

**Option A: Fresh registration**
- Use Worker API to register new account

**Option B: Migrate existing data**
```bash
# The container needs signal-cli account data
# This is stored in ./signal-data/data/

# Option 1: Register fresh account via Worker API
curl -X POST "https://signal-cli-bot.your-subdomain.workers.dev/v1/register/+19108471202"

# Option 2: Copy existing account data
# Upload signal-data/data/* to container's persistent storage
# (R2 or container volume)
```

### Step 3: Update Next.js App

**In .env.local:**
```bash
# Change this line:
SIGNAL_CLI_REST_API_BASE_URL=https://signal-cli-bot.your-subdomain.workers.dev
```

**Restart Next.js:**
```bash
npm run dev
```

### Step 4: Test Integration

```bash
# Test Worker health
curl https://signal-cli-bot.your-subdomain.workers.dev/health

# Test signal-cli health
curl https://signal-cli-bot.your-subdomain.workers.dev/v1/health

# Test from Next.js app
# Visit admin panel → Signal Bot → Health Check
```

### Step 5: Start Native Bot in Next.js

The `NativeSignalBotService` will now connect to the containerized signal-cli:
```bash
node start-native-signal-bot.js
```

Or via tRPC:
- Admin panel → Signal Bot → Start Bot

## Data Flow Examples

### Example 1: User Sends Message to Bot

```
Signal User
   ↓ Signal Protocol
Container (polls /v1/receive)
   ↓ HTTP 200 (messages array)
Container holds message
   ← Next.js polls container via Worker
Next.js receives message
   ↓ Process via NativeSignalBotService
Next.js executes command
   ↓ Database updates (Prisma)
PostgreSQL
   ↓ AI processing (if needed)
OpenAI API
   ↓ Generate response
Next.js sends response
   → POST to Worker
   → POST to Container /v1/send
   → Signal Network
   → User receives reply
```

### Example 2: Admin Uses tRPC API

```
Browser
   ↓ tRPC: signal.getGroups()
Next.js API Route
   ↓ Call NativeSignalBotService.getGroups()
   → HTTP GET to Worker /v1/groups/{number}
   → HTTP GET to Container
   ← Container returns groups JSON
   ← Worker proxies response
   ← Next.js receives groups
   ↓ Update database cache (Prisma)
PostgreSQL
   ← Return groups to browser
Browser displays groups
```

## Advantages of This Architecture

1. ✅ **No Database Migration**: PostgreSQL stays with Next.js
2. ✅ **All Features Work**: Q&A, news, repos, member tracking, etc.
3. ✅ **Minimal Code Changes**: Just change API URL
4. ✅ **Local Dev Still Works**: Can run local container for dev
5. ✅ **Global Signal CLI**: Container runs at edge
6. ✅ **Separation of Concerns**: Signal protocol ≠ business logic
7. ✅ **Easy Rollback**: Change URL back to localhost
8. ✅ **No Schema Changes**: Prisma models untouched
9. ✅ **No Duplicate Code**: Business logic stays in one place
10. ✅ **Existing tRPC Works**: No API changes

## Trade-offs

1. ⚠️ **Network Hop**: Next.js ↔ Worker ↔ Container (adds ~10-50ms)
2. ⚠️ **Two Services**: Next.js + Container (but cleaner architecture)
3. ⚠️ **Internet Required**: Next.js must reach Worker (already required)

## Future Enhancements

1. **Move Next.js to Cloudflare Pages** (optional)
   - Then both services on Cloudflare
   - Reduce network latency
   - Still use same PostgreSQL

2. **Add Hyperdrive Later** (if needed)
   - Connect Pages to PostgreSQL via Hyperdrive
   - Only if latency becomes an issue

3. **Add D1 Cache Layer** (optional)
   - Cache frequently accessed data in D1
   - Reduce PostgreSQL queries
   - Keep PostgreSQL as source of truth

## Monitoring

### Health Check Endpoints

**Worker:**
- `GET /health` - Worker status
- `GET /status` - Worker + Container status

**Container (via Worker):**
- `GET /v1/health` - signal-cli status
- `GET /v1/accounts` - Registered accounts

**Next.js App:**
- tRPC: `signal.getNativeBotHealth()` - Bot process health
- tRPC: `signal.getSignalCliHealth()` - Database + API health
- tRPC: `signal.getServiceStatus()` - Full service status

### Logs

**Worker Logs:**
```bash
cd cloudflare-workers/signal-bot
npm run logs
```

**Container Logs:**
- View in Cloudflare Dashboard → Workers & Pages → signal-cli-bot → Logs

**Next.js Logs:**
- Standard console output
- Check bot process logs

## Cost Breakdown

| Component | Monthly Cost |
|-----------|-------------|
| Next.js App | $0 (self-hosted) or $5-20 (Vercel/Railway) |
| PostgreSQL | $0 (self-hosted) or $5-25 (Neon/Supabase) |
| Cloudflare Worker | $5 (Workers Paid plan) |
| Cloudflare Container | TBD (beta pricing) |
| R2 Storage | ~$0.01-0.15 |
| KV Cache | ~$0.50-5 |
| **Estimated Total** | **$15-50/month** |

## Summary

This architecture keeps your existing codebase intact while gaining the benefits of Cloudflare's global network for the Signal CLI component. The separation of concerns makes the system more maintainable and scalable.

**Key Point**: The container is **only** the signal-cli REST API. All your custom bot logic, database operations, and features stay in Next.js where they belong.
