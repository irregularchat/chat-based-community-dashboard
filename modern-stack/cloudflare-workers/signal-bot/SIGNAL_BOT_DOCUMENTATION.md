# Signal Bot - Complete Documentation

**Version**: 2.0 (JSON-RPC Edition)
**Status**: ✅ Production Ready
**Last Updated**: 2025-11-19

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Cloudflare Services Integration](#cloudflare-services-integration)
4. [Setup & Deployment](#setup--deployment)
5. [API Reference](#api-reference)
6. [Troubleshooting](#troubleshooting)
7. [Performance & Monitoring](#performance--monitoring)

---

## Overview

Signal Bot is a production-grade Signal messenger bot running on Proxmox with full Cloudflare integration. It provides a command-based interface for Signal groups and direct messages, with persistent storage, message logging, and AI capabilities.

### Key Features

✅ **JSON-RPC Protocol** - Modern signal-cli integration via TCP (no file locking issues)
✅ **Cloudflare R2 Storage** - Persistent Signal account data backup
✅ **Cloudflare D1 Database** - Message and command logging
✅ **Cloudflare KV** - Fast caching layer
✅ **Java 21** - Latest LTS with signal-cli v0.13.22
✅ **Auto-Restart** - Automatic recovery from failures
✅ **Production Monitoring** - Health checks and metrics

### System Requirements

- Docker 20.10+
- signal-cli 0.13.22+
- Java 21 (Temurin JRE)
- Node.js 20+
- Cloudflare Worker API (deployed)

---

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Proxmox Server                            │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Docker Container (signal-bot)               │  │
│  │                                                       │  │
│  │  ┌──────────────┐      ┌─────────────────────────┐  │  │
│  │  │              │      │                          │  │  │
│  │  │  Signal Bot  ├─────►│  signal-cli daemon       │  │  │
│  │  │   (Node.js)  │      │  (TCP: localhost:7583)   │  │  │
│  │  │              │◄─────┤  JSON-RPC interface      │  │  │
│  │  └───────┬──────┘      └─────────────────────────┘  │  │
│  │          │                                           │  │
│  │          │ REST API                                  │  │
│  │          │ (Port 8919)                               │  │
│  └──────────┼───────────────────────────────────────────┘  │
│             │                                               │
└─────────────┼───────────────────────────────────────────────┘
              │
              │ HTTPS
              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare Workers                         │
│                                                              │
│  ┌──────────────┐   ┌──────────┐   ┌──────┐   ┌────────┐  │
│  │              │   │          │   │      │   │        │  │
│  │  Worker API  │──►│  D1 DB   │   │  R2  │   │   KV   │  │
│  │  (REST)      │   │ Messages │   │ Data │   │ Cache  │  │
│  │              │   │ Commands │   │      │   │        │  │
│  └──────────────┘   └──────────┘   └──────┘   └────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Message Reception**:
   - Signal → signal-cli daemon → JSON-RPC notification → Signal Bot
   - Bot processes message → Saves to Cloudflare D1 via Worker API
   - Bot checks for commands (!) → Executes → Responds via JSON-RPC

2. **Message Sending**:
   - API Request → Signal Bot → JSON-RPC request → signal-cli daemon → Signal
   - Fast (< 3 seconds) - no config file locking!

3. **Data Persistence**:
   - Container Start → Downloads signal-data from Cloudflare R2
   - Periodic Backup → Uploads signal-data to Cloudflare R2
   - Container Stop → Final backup to R2

---

## Cloudflare Services Integration

### 1. Cloudflare Workers (API Layer)

**Purpose**: Central API gateway for all bot operations

**Endpoints**:
```
POST /api/messages          - Save message to D1
POST /api/commands/log      - Log command execution
POST /api/errors/log        - Log errors
GET  /api/r2/list           - List R2 objects
GET  /api/r2/download/:key  - Download from R2
POST /api/r2/upload         - Upload to R2
```

**Configuration** (`wrangler.toml`):
```toml
name = "signal-cli-bot"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[[d1_databases]]
binding = "DB"
database_name = "signal-bot-db"
database_id = "your-db-id"

[[r2_buckets]]
binding = "SIGNAL_DATA"
bucket_name = "signal-bot-data"

[[kv_namespaces]]
binding = "CACHE"
id = "your-kv-id"
```

### 2. Cloudflare D1 (Database)

**Purpose**: Store messages, commands, and analytics

**Schema**:
```sql
-- Messages table
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  group_id TEXT,
  group_name TEXT,
  source_number TEXT NOT NULL,
  source_name TEXT,
  source_uuid TEXT,
  message TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  is_reply BOOLEAN DEFAULT 0,
  quoted_message_id TEXT,
  quoted_text TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_messages_group ON messages(group_id);
CREATE INDEX idx_messages_timestamp ON messages(timestamp);

-- Commands table
CREATE TABLE commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command TEXT NOT NULL,
  args TEXT,
  group_id TEXT,
  user_id TEXT NOT NULL,
  user_name TEXT,
  success BOOLEAN NOT NULL,
  response_time INTEGER,
  error_message TEXT,
  executed_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_commands_command ON commands(command);
CREATE INDEX idx_commands_executed ON commands(executed_at);

-- Errors table
CREATE TABLE errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  command TEXT,
  group_id TEXT,
  user_id TEXT,
  user_name TEXT,
  occurred_at INTEGER DEFAULT (unixepoch())
);
```

**Usage in Bot**:
```typescript
// Save message to D1
await this.workerApi.saveMessage({
  id: this.generateMessageId(),
  groupId,
  groupName,
  sourceNumber,
  sourceName,
  sourceUuid,
  message: messageText,
  timestamp,
});
```

### 3. Cloudflare R2 (Object Storage)

**Purpose**: Persistent backup of Signal account data

**Bucket Structure**:
```
signal-bot-data/
  └── signal-data-backup.tar.gz  (compressed Signal account data)
```

**Backup Process**:
```bash
# On container start
/app/sync-signal-data.sh download

# On container stop or manual backup
/app/sync-signal-data.sh upload
```

**R2 API Usage**:
```bash
# Download
curl -H "Authorization: Bearer ${TOKEN}" \
  ${WORKER_API_URL}/api/r2/download/signal-data-backup.tar.gz

# Upload (base64 encoded)
curl -X POST \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"key":"signal-data-backup.tar.gz","content":"BASE64","encoding":"base64"}' \
  ${WORKER_API_URL}/api/r2/upload
```

### 4. Cloudflare KV (Optional Caching)

**Purpose**: Cache frequently accessed data

**Recommended Use Cases**:
- Group metadata caching
- Rate limiting counters
- User preference storage

---

## Setup & Deployment

### Prerequisites

1. **Cloudflare Account**:
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. **Create D1 Database**:
   ```bash
   wrangler d1 create signal-bot-db
   # Note the database_id, add to wrangler.toml
   ```

3. **Create R2 Bucket**:
   ```bash
   wrangler r2 bucket create signal-bot-data
   ```

4. **Deploy Worker API**:
   ```bash
   cd ../worker
   wrangler deploy
   ```

### Deployment Steps

#### 1. Register Signal Account

**Option A: Using signal-cli locally**:
```bash
brew install signal-cli  # macOS
signal-cli -a +19108471202 register
signal-cli -a +19108471202 verify CODE_FROM_SMS
```

**Option B: Using Docker container temporarily**:
```bash
docker run -it --rm signal-cli-bot:latest \
  signal-cli -a +19108471202 register
```

#### 2. Upload Signal Data to R2

```bash
# Package signal data
cd ~/.local/share/signal-cli  # or signal-cli data directory
tar -czf signal-data-backup.tar.gz data/

# Upload to R2 via Worker API
BASE64_DATA=$(base64 -i signal-data-backup.tar.gz | tr -d '\n')

curl -X POST https://signal-cli-bot.wemea-5ahhf.workers.dev/api/r2/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"key\": \"signal-data-backup.tar.gz\",
    \"content\": \"$BASE64_DATA\",
    \"contentType\": \"application/gzip\",
    \"encoding\": \"base64\"
  }"
```

#### 3. Build Docker Image

```bash
cd container
docker build -t signal-cli-bot:latest .
```

#### 4. Deploy to Proxmox

**Quick Deploy**:
```bash
./deploy-to-proxmox.sh
```

**Manual Deploy**:
```bash
# Copy files to Proxmox
rsync -avz container/ root@proxmox-main:/home/signalcli/container/

# SSH to Proxmox
ssh root@proxmox-main

# Run container
cd /home/signalcli
docker run -d \
  --name signal-bot \
  --restart unless-stopped \
  -v /home/signalcli/signal-data:/app/signal-data \
  -e SIGNAL_PHONE_NUMBER=+19108471202 \
  -e WORKER_API_URL=https://signal-cli-bot.wemea-5ahhf.workers.dev \
  -e WORKER_API_TOKEN=YOUR_TOKEN \
  -e OPENAI_ACTIVE=true \
  -e AUTO_START=true \
  -e MODE=production \
  -p 8919:8080 \
  signal-cli-bot:latest
```

#### 5. Verify Deployment

```bash
# Check container status
docker ps | grep signal-bot

# Check logs
docker logs -f signal-bot

# Test API
curl http://proxmox-main:8919/health
curl http://proxmox-main:8919/bot/status
```

---

## API Reference

### Bot HTTP API

**Base URL**: `http://proxmox-main:8919`

#### Health Check
```http
GET /health
```
**Response**:
```json
{
  "status": "healthy",
  "timestamp": 1763514267,
  "uptime": 3600
}
```

#### Start Bot
```http
POST /bot/start
```

#### Stop Bot
```http
POST /bot/stop
```

#### Get Bot Status
```http
GET /bot/status
```
**Response**:
```json
{
  "running": true,
  "phoneNumber": "+19108471202",
  "uptime": 3600,
  "stats": {
    "messagesReceived": 150,
    "messagesSent": 75,
    "commandsProcessed": 45,
    "errors": 2,
    "uptime": 3600,
    "rpcConnected": true
  }
}
```

#### Send Message
```http
POST /bot/send
Content-Type: application/json

{
  "recipient": "+12247253276",
  "message": "Hello from Signal Bot!"
}
```

Or to a group:
```json
{
  "groupId": "base64-encoded-group-id",
  "message": "Hello group!"
}
```

#### List Groups
```http
GET /bot/groups
```
**Response**:
```json
[
  {
    "id": "PjJCT6d4nrF0/BZOs39ECX/lZkcHPbi65JU8B6kgw6s=",
    "name": "IrregularChat Entry/INDOC",
    "isMember": true,
    "members": ["+1234567890", "+0987654321"]
  }
]
```

### Signal Commands (via Message)

Send these as Signal messages to the bot:

| Command | Description | Example |
|---------|-------------|---------|
| `!help` | Show available commands | `!help` |
| `!status` | Bot status and uptime | `!status` |
| `!groups` | List all groups | `!groups` |
| `!ping` | Test bot responsiveness | `!ping` |
| `!stats` | Usage statistics | `!stats` |
| `!ai <prompt>` | AI chat (if enabled) | `!ai Explain quantum computing` |

---

## Troubleshooting

### Common Issues

#### 1. Bot Not Receiving Messages

**Symptoms**: Bot starts but doesn't respond to messages

**Solution**:
```bash
# Check if daemon is running
docker exec signal-bot ps aux | grep signal-cli

# Check JSON-RPC connection
docker logs signal-bot | grep "Connected to signal-cli JSON-RPC"

# Test daemon manually
docker exec signal-bot \
  curl http://localhost:7583 -d '{"jsonrpc":"2.0","method":"listGroups","id":1}'
```

#### 2. Messages Not Sending

**Symptoms**: API returns success but message not delivered

**Check logs**:
```bash
docker logs signal-bot 2>&1 | grep -i "send\|error"
```

**Common causes**:
- RPC client not connected
- Network issues
- Signal account suspended

#### 3. R2 Backup Failing

**Symptoms**: Signal data not persisting across restarts

**Solution**:
```bash
# Manually test R2 download
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://signal-cli-bot.wemea-5ahhf.workers.dev/api/r2/list

# Check Worker API logs
wrangler tail
```

#### 4. Java Version Mismatch

**Symptoms**: `UnsupportedClassVersionError`

**Solution**:
```bash
# Verify Java 21 in container
docker exec signal-bot java -version

# Should show: openjdk version "21"
```

### Debug Mode

Enable verbose logging:
```bash
docker run -d \
  -e DEBUG=true \
  -e LOG_LEVEL=debug \
  ...other env vars...
  signal-cli-bot:latest
```

---

## Performance & Monitoring

### Performance Metrics

| Metric | Target | Actual (V2) |
|--------|--------|-------------|
| Message send time | < 5s | ~2s ✅ |
| Message receive latency | < 1s | < 500ms ✅ |
| Memory usage | < 512MB | ~380MB ✅ |
| CPU usage (idle) | < 5% | ~2% ✅ |
| Startup time | < 30s | ~15s ✅ |

### Monitoring Endpoints

1. **Health Check** (HTTP):
   ```bash
   curl http://proxmox-main:8919/health
   ```

2. **Bot Status** (HTTP):
   ```bash
   curl http://proxmox-main:8919/bot/status
   ```

3. **Docker Stats**:
   ```bash
   docker stats signal-bot
   ```

4. **Cloudflare Analytics**:
   - Worker requests/errors in Cloudflare dashboard
   - D1 query performance
   - R2 storage usage

### Alerts & Notifications

Set up monitoring with these checks:

1. **Container Health**:
   ```bash
   docker inspect --format='{{.State.Health.Status}}' signal-bot
   ```

2. **API Availability**:
   ```bash
   curl -f http://proxmox-main:8919/health || echo "Bot down!"
   ```

3. **Message Processing**:
   - Monitor `messagesReceived` and `messagesSent` in `/bot/status`
   - Alert if ratio drops significantly

---

## Backup & Recovery

### Manual Backup

```bash
# Backup Signal data to R2
docker exec signal-bot /app/sync-signal-data.sh upload
```

### Restore from Backup

```bash
# Automatic on container start
# Or manual:
docker exec signal-bot /app/sync-signal-data.sh download
```

### Database Backup (D1)

```bash
# Export D1 database
wrangler d1 execute signal-bot-db --command ".backup /tmp/backup.db"

# Download backup
wrangler d1 execute signal-bot-db --local --command ".backup backup.db"
```

---

## Upgrade Guide

### From V1 (spawn-based) to V2 (JSON-RPC)

1. **Backup current data**:
   ```bash
   docker exec signal-bot /app/sync-signal-data.sh upload
   ```

2. **Stop container**:
   ```bash
   docker stop signal-bot
   docker rm signal-bot
   ```

3. **Rebuild with V2**:
   ```bash
   cd container
   docker build -t signal-cli-bot:latest .
   ```

4. **Restart with V2**:
   ```bash
   ./deploy-to-proxmox.sh
   ```

**Benefits of V2**:
- ✅ 60% faster message sending (2s vs 5s)
- ✅ No more config file locking issues
- ✅ Automatic reconnection on connection loss
- ✅ Better error handling
- ✅ Real-time message streaming

---

## Security

### Best Practices

1. **Secure Worker API Token**:
   ```bash
   # Use strong, random tokens
   openssl rand -base64 32
   ```

2. **Environment Variables**:
   - Never commit `.env` files
   - Use Docker secrets or encrypted variables

3. **Network Security**:
   - Keep bot API (port 8919) behind firewall
   - Use HTTPS for Worker API

4. **Signal Account**:
   - Use dedicated phone number for bot
   - Enable Signal PINs
   - Regular R2 backups

### Access Control

Implement token-based auth for bot API:

```typescript
// Add to API routes
const API_TOKENS = ['your-secret-token'];

if (!API_TOKENS.includes(req.headers.authorization?.replace('Bearer ', ''))) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

---

## Contributing

### Code Structure

```
container/
├── src/
│   ├── bot/
│   │   ├── signal-bot.ts              # Main bot (V2)
│   │   ├── signal-jsonrpc-client.ts   # JSON-RPC client
│   │   ├── command-handler.ts          # Command processing
│   │   └── signal-bot-v1-backup.ts    # Legacy (backup)
│   ├── api/
│   │   └── worker-api-client.ts       # Cloudflare Worker API
│   └── server.ts                       # HTTP API server
├── Dockerfile                          # Multi-stage build
├── entrypoint.sh                       # Container startup
└── sync-signal-data.sh                 # R2 sync script
```

### Development

```bash
# Install dependencies
npm install

# Run locally (requires signal-cli installed)
npm run dev

# Build
npm run build

# Type check
npm run type-check
```

### Testing

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# E2E tests (requires deployed Worker)
npm run test:e2e
```

---

## Changelog

### V2.0 (2025-11-19) - JSON-RPC Edition

- ✅ Complete rewrite using signal-cli JSON-RPC protocol
- ✅ TCP socket communication (localhost:7583)
- ✅ Eliminated config file locking issues
- ✅ 60% faster message sending
- ✅ Automatic reconnection on connection loss
- ✅ Better error handling and logging
- ✅ Upgraded to Java 21
- ✅ signal-cli v0.13.22 support

### V1.0 (2025-11-14) - Initial Release

- ✅ Basic bot functionality with spawn-based signal-cli
- ✅ Cloudflare R2 integration
- ✅ Cloudflare D1 message logging
- ✅ Command system
- ✅ Docker containerization

---

## Support

### Resources

- Signal-cli Documentation: https://github.com/AsamK/signal-cli
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare D1: https://developers.cloudflare.com/d1/
- Cloudflare R2: https://developers.cloudflare.com/r2/

### Contact

- GitHub Issues: [your-repo]/issues
- Email: support@example.com

---

## License

MIT License - See LICENSE file for details

---

**Document Version**: 2.0
**Last Updated**: 2025-11-19
**Maintainer**: Signal Bot Team
