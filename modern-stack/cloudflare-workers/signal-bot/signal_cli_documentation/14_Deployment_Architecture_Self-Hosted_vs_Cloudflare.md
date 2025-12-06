# Deployment Architecture: Self-Hosted vs Cloudflare Mode (2025-11-20)

### The Problem: Wrong Deployment Script Used

**Symptoms**:
- Bot not responding to commands like `!summarize -n 3`
- Error: "Failed to get messages: Request failed with status code 404"
- Container logs show "☁️ Running in CLOUDFLARE-NATIVE mode (Worker API)"
- But Proxmox has PostgreSQL installed, not Cloudflare Worker API

**Root Cause**:
The bot has TWO deployment architectures, but the wrong deployment script was being used:

1. **Cloudflare Mode** (`deploy-to-proxmox.sh`):
   - Deploys to `/home/signalcli`
   - Uses Worker API endpoints (HTTP calls to Cloudflare)
   - No direct database access
   - Requires `WORKER_API_URL` and `WORKER_API_TOKEN`

2. **Self-Hosted Mode** (`deploy-selfhosted.sh`):
   - Deploys to `/home/signal-bot-selfhosted`
   - Uses direct PostgreSQL connection
   - Requires `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
   - Includes PostgreSQL container in docker-compose

**The Mix-up**:
- User was running `deploy-to-proxmox.sh` (Cloudflare mode)
- But Proxmox had PostgreSQL setup at `/home/signal-bot-selfhosted`
- Bot tried to call Worker API endpoints that don't exist
- Result: 404 errors when trying to retrieve messages

### How Mode Detection Works

The entrypoint script (`entrypoint.sh`) auto-detects which mode to run based on environment variables:

```bash
# Check deployment mode (self-hosted or cloudflare-native)
if [ -n "$DB_HOST" ]; then
    echo "🏠 Running in SELF-HOSTED mode (PostgreSQL)"
    echo "   Database: $DB_HOST:$DB_PORT"
    ENTRY_POINT="index-selfhosted.js"
else
    echo "☁️  Running in CLOUDFLARE-NATIVE mode (Worker API)"
    # Check required environment variables for Cloudflare mode
    if [ -z "$WORKER_API_URL" ]; then
        echo "❌ ERROR: WORKER_API_URL is not set"
        exit 1
    fi
    if [ -z "$WORKER_API_TOKEN" ]; then
        echo "❌ ERROR: WORKER_API_TOKEN is not set"
        exit 1
    fi
    echo "   Worker URL: $WORKER_API_URL"
    ENTRY_POINT="index.js"
fi
```

**Key Detection**:
- If `DB_HOST` environment variable is set → Self-Hosted mode
- If `DB_HOST` is NOT set → Cloudflare mode

### The Fix: Use Correct Deployment Script

**WRONG** ❌:
```bash
# This deploys in Cloudflare mode
cd /Users/sac/Git/chat-based-community-dashboard/modern-stack/cloudflare-workers/signal-bot
./deploy-to-proxmox.sh  # ← Wrong script!
```

**CORRECT** ✅:
```bash
# This deploys in Self-Hosted mode with PostgreSQL
cd /Users/sac/Git/chat-based-community-dashboard/modern-stack/cloudflare-workers/signal-bot/container
npm run build

cd ..
./deploy-selfhosted.sh  # ← Correct script!

# Then on Proxmox
ssh root@proxmox-main
cd /home/signal-bot-selfhosted
docker-compose down
docker-compose up -d --build
```

### Deployment Script Comparison

| Feature | `deploy-to-proxmox.sh` | `deploy-selfhosted.sh` |
|---------|------------------------|------------------------|
| **Mode** | Cloudflare Native | Self-Hosted |
| **Deploy Path** | `/home/signalcli` | `/home/signal-bot-selfhosted` |
| **Database** | None (Worker API) | PostgreSQL container |
| **Data Layer** | HTTP API calls | Direct SQL queries |
| **Environment** | `WORKER_API_URL`, `WORKER_API_TOKEN` | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` |
| **Entry Point** | `index.js` | `index-selfhosted.js` |
| **Use Case** | Cloudflare-hosted Worker + D1 | Proxmox/VPS with PostgreSQL |

### Architecture Differences

**Cloudflare Mode (`index.js`)**:
```typescript
// Uses Worker API Client (HTTP calls)
const workerApi = new WorkerAPIClient(config.workerApiUrl, config.workerApiToken);
const bot = new SignalBot(config, workerApi);

// Message retrieval
const messages = await workerApi.getMessagesWithConstraints(groupId, count, hours);
// → Makes HTTP POST to /api/messages/with-constraints
```

**Self-Hosted Mode (`index-selfhosted.js`)**:
```typescript
// Uses PostgreSQL Client (direct SQL)
const dbClient = new PostgresClient({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'signalbot',
  user: process.env.DB_USER || 'signalbot',
  password: process.env.DB_PASSWORD,
});

const bot = new SignalBot(config, dbClient);

// Message retrieval
const messages = await dbClient.getMessagesWithConstraints(groupId, count, hours);
// → Direct SQL: SELECT * FROM signal_messages WHERE...
```

### Diagnostic Commands

**Check which mode container is running**:
```bash
# Check container logs
ssh root@proxmox-main "docker logs signal-bot --tail 30 | grep 'Running in'"

# Expected output for Cloudflare mode:
# ☁️  Running in CLOUDFLARE-NATIVE mode (Worker API)

# Expected output for Self-Hosted mode:
# 🏠 Running in SELF-HOSTED mode (PostgreSQL)
```

**Check environment variables**:
```bash
# For Cloudflare mode
ssh root@proxmox-main "docker exec signal-bot env | grep WORKER_API"

# For Self-Hosted mode
ssh root@proxmox-main "docker exec signal-bot env | grep DB_"
```

**Check which entry point is running**:
```bash
ssh root@proxmox-main "docker logs signal-bot --tail 30 | grep 'Entry point'"

# Expected for Cloudflare:    Entry point: index.js
# Expected for Self-Hosted:    Entry point: index-selfhosted.js
```

### Lesson

✅ **There are TWO deployment scripts** - use the right one for your architecture
✅ **Check container logs for mode detection** on every deployment
✅ **`DB_HOST` presence determines mode** - Cloudflare vs Self-Hosted
✅ **Wrong mode = 404 errors** when trying to access non-existent API endpoints
✅ **Self-hosted requires PostgreSQL** setup with docker-compose
✅ **Cloudflare requires Worker API** deployed separately with Wrangler

**Quick Reference**:
- Have PostgreSQL on Proxmox? → Use `deploy-selfhosted.sh`
- Using Cloudflare D1 + Workers? → Use `deploy-to-proxmox.sh` or `deploy.sh`

**Files**:
- `deploy-selfhosted.sh` - Self-hosted PostgreSQL deployment
- `deploy-to-proxmox.sh` - Cloudflare Worker API mode deployment
- `entrypoint.sh:19-40` - Mode detection logic
- `src/index-selfhosted.ts` - Self-hosted entry point with PostgreSQL
- `src/index.ts` - Cloudflare entry point with Worker API
