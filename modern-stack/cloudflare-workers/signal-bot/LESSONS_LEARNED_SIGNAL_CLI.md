# Lessons Learned: Signal CLI Bot Implementation

**Document Version**: 1.0
**Last Updated**: 2025-11-19
**Project**: Signal CLI Bot with Cloudflare Integration

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Java Version Requirements](#java-version-requirements)
3. [JSON-RPC vs Spawn-based Architecture](#json-rpc-vs-spawn-based-architecture)
4. [Message Receiving Implementation](#message-receiving-implementation)
5. [Config File Locking Issues](#config-file-locking-issues)
6. [Cloudflare R2 Integration](#cloudflare-r2-integration)
7. [Container Deployment](#container-deployment)
8. [Performance Optimizations](#performance-optimizations)
9. [Common Pitfalls](#common-pitfalls)
10. [Best Practices](#best-practices)
11. [Social Media Content Downloader](#social-media-content-downloader-with-yt-dlp)
12. [CommandHandler Bot Instance Injection](#commandhandler-bot-instance-injection)
13. [Signal @Mentions and Command Context](#signal-mentions-and-command-context-2025-11-19)
14. [Deployment Architecture: Self-Hosted vs Cloudflare](#deployment-architecture-self-hosted-vs-cloudflare-mode-2025-11-20)
15. [Docker Build Caching](#docker-build-caching-and-code-deployment-2025-11-21)
16. [Emoji Reactions Implementation](#emoji-reactions-implementation-2025-11-22)
17. [Signal Mention Name Resolution](#signal-mention-name-resolution-2025-11-27)
18. [Signal CLI Admin Detection Bug](#signal-cli-admin-detection-bug-2025-12-01)
19. [Wiki Search Git Dependency](#wiki-search-git-dependency-2025-12-02)
20. [CRITICAL: rsync --delete Data Loss](#critical-rsync-delete-data-loss-2025-12-03)
21. [VPN/Gluetun Container Management](#vpngluetun-container-management-2025-12-03)
22. [Docker Network IP Address Changes](#docker-network-ip-address-changes-2025-12-03)
23. [Phone Number Privacy in Display Names](#phone-number-privacy-in-display-names-2025-12-04)
24. [pCloud Download Links Are IP-Bound](#pcloud-download-links-are-ip-bound-2025-12-04)
25. [Auto-Archive Documents After Virus Scan](#auto-archive-documents-after-virus-scan-2025-12-04)
26. [Docker Volume Mount Permissions (rclone Config)](#docker-volume-mount-permissions-rclone-config-2025-12-04)

---

## Executive Summary

**Key Learnings**:
- ✅ JSON-RPC TCP mode is superior to spawn-based signal-cli invocation
- ✅ Java 21 is required for signal-cli v0.13.22+
- ✅ `subscribeReceive()` is mandatory for receiving messages in manual mode
- ✅ Cloudflare R2 provides excellent persistent storage for Signal data
- ✅ Multi-stage Docker builds optimize image size and security

**Performance Gains (V1 → V2)**:
- Message send time: 5s → 2s (60% faster)
- No more config file locking issues
- Automatic reconnection capability
- Real-time message streaming

---

## Java Version Requirements

### Problem

**Initial Error**:
```
java.lang.UnsupportedClassVersionError: org/asamk/signal/Main has been compiled by a more recent version of the Java Runtime (class file version 65.0), this version of the Java Runtime only recognizes class file versions up to 61.0
```

**Root Cause**:
- signal-cli v0.13.22 is compiled with Java 21 (class file version 65.0)
- Container had Java 17 (supports up to class file version 61.0)

### Solution

**Multi-pronged Approach**:

1. **For signal-cli build stage** - Use Debian Trixie:
```dockerfile
FROM debian:trixie-slim AS signal-cli

RUN apt-get update && apt-get install -y \
    openjdk-21-jre-headless \
    wget
```

2. **For runtime stage** - Add Adoptium repository:
```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    curl wget apt-transport-https gnupg \
    && mkdir -p /etc/apt/keyrings \
    && wget -O - https://packages.adoptium.net/artifactory/api/gpg/key/public \
        | tee /etc/apt/keyrings/adoptium.asc \
    && echo "deb [signed-by=/etc/apt/keyrings/adoptium.asc] \
        https://packages.adoptium.net/artifactory/deb \
        $(awk -F= '/^VERSION_CODENAME/{print$2}' /etc/os-release) main" \
        | tee /etc/apt/sources.list.d/adoptium.list \
    && apt-get update \
    && apt-get install -y temurin-21-jre
```

### Lesson

✅ **Always verify Java version compatibility** before upgrading signal-cli
✅ **Use appropriate Debian version** - Trixie has Java 21, Bookworm does not
✅ **Consider Adoptium/Temurin** for controlled Java versions

**File**: `container/Dockerfile`
**Lines**: 24, 42-53

---

## JSON-RPC vs Spawn-based Architecture

### V1 Architecture (Spawn-based)

**Implementation**:
```typescript
async sendMessage(params) {
  const process = spawn('signal-cli', [
    '-a', this.config.phoneNumber,
    '--config', this.config.dataDir,
    'send',
    '-m', params.message,
    params.recipient
  ]);

  // Wait for process to complete
  return new Promise((resolve, reject) => {
    process.on('exit', code => {
      code === 0 ? resolve() : reject();
    });
  });
}
```

**Problems**:
1. ❌ **Config File Locking**: Each spawn locks the Signal data directory
2. ❌ **Slow Performance**: ~5 seconds per message (spawn overhead)
3. ❌ **No Concurrent Operations**: Can't send while receiving
4. ❌ **Resource Heavy**: New process for every operation
5. ❌ **No Reconnection**: Manual restart required on failure

### V2 Architecture (JSON-RPC)

**Implementation**:
```typescript
// 1. Start daemon once
signal-cli daemon --tcp localhost:7583 --receive-mode manual

// 2. Connect JSON-RPC client
this.rpcClient = new SignalJsonRpcClient('localhost', 7583);
await this.rpcClient.connect();

// 3. Subscribe to receive messages
await this.rpcClient.subscribeReceive();

// 4. Send messages via JSON-RPC
async sendMessage(params) {
  await this.rpcClient.sendMessage({
    message: params.message,
    recipient: [params.recipient],
  });
}
```

**Benefits**:
1. ✅ **No File Locking**: Daemon owns the config, clients use TCP
2. ✅ **Fast Performance**: ~2 seconds per message (60% improvement)
3. ✅ **Concurrent Operations**: Send and receive simultaneously
4. ✅ **Resource Efficient**: Single daemon process
5. ✅ **Auto-Reconnection**: Built-in reconnection logic

### Lesson

✅ **Always use TCP/JSON-RPC mode for production**
✅ **Spawn-based is OK for one-off CLI operations** only
✅ **JSON-RPC enables real-time bi-directional communication**

**Files**:
- `container/src/bot/signal-jsonrpc-client.ts`
- `container/src/bot/signal-bot.ts`

---

## Message Receiving Implementation

### Problem 1: --json Flag Deprecated

**Error**:
```
signal-cli: error: unrecognized arguments: '--json'
```

**Root Cause**:
- signal-cli v0.13.22 removed `--json` flag
- Now uses `--receive-mode` with TCP/socket modes

**Solution**:
```bash
# OLD (doesn't work)
signal-cli daemon --json

# NEW (works)
signal-cli daemon --tcp localhost:7583 --receive-mode manual
```

### Problem 2: Messages Not Reaching Bot

**Symptoms**:
- Daemon logging messages to stderr
- Bot not processing messages
- No "📨 Message from" logs

**Root Cause**:
In TCP mode with `--receive-mode manual`, messages don't automatically stream to clients. You MUST call `subscribeReceive()`.

**Wrong Approach**:
```typescript
// ❌ This won't work!
await this.rpcClient.connect();
// Messages won't come through...
```

**Correct Approach**:
```typescript
// ✅ This works!
await this.rpcClient.connect();
await this.rpcClient.subscribeReceive();  // CRITICAL!
// Now messages will come through as notifications
```

### Problem 3: Notification Format (CRITICAL!)

**Initial Assumption** (wrong):
```typescript
// Assumed notifications would have { envelope: { ... } }
this.rpcClient.on('notification', (notification) => {
  this.handleMessage(notification);  // ❌ Wrong format
});
```

**Second Attempt** (still wrong):
```typescript
// Thought envelope was directly in params
this.rpcClient.on('notification', (notification) => {
  if (notification.params) {
    this.handleMessage({ envelope: notification.params });  // ❌ Still wrong!
  }
});
```

**Actual Format from `subscribeReceive()`**:
```json
{
  "jsonrpc": "2.0",
  "method": "receive",
  "params": {
    "subscription": 0,
    "result": {
      "envelope": {
        "source": "+1234567890",
        "sourceNumber": "+1234567890",
        "dataMessage": {
          "message": "!help",
          ...
        }
      }
    }
  }
}
```

**Correct Implementation**:
```typescript
// ✅ CORRECT! Envelope is nested in params.result.envelope
this.rpcClient.on('notification', (notification) => {
  if (notification.params?.result?.envelope) {
    this.handleMessage({ envelope: notification.params.result.envelope });
  } else if (notification.params?.envelope) {
    // Fallback for other notification types
    this.handleMessage({ envelope: notification.params.envelope });
  } else {
    console.log('Received notification without envelope');
  }
});
```

**Debugging Steps**:
1. Added debug logging: `console.log('🔔 Received JSON-RPC notification:', JSON.stringify(notification).substring(0, 200))`
2. Saw notifications arriving but messages not processing
3. Examined notification structure and found the nested format
4. Updated handler to extract from `params.result.envelope`
5. **Messages immediately started processing!**

### Lesson

✅ **Always call `subscribeReceive()` after connecting** in manual mode
✅ **Use `--receive-mode manual`** for programmatic control
✅ **Envelope is at `notification.params.result.envelope`** NOT `notification.params`
✅ **Add debug logging** to inspect actual notification format
✅ **Test message receiving separately** from sending
✅ **Verify `📨 Message from` logs appear** after sending test message

**File**: `container/src/bot/signal-bot.ts`
**Lines**: 245-257 (subscribeReceive), 276-292 (notification handler)

---

## Config File Locking Issues

### Problem

**Scenario**: Trying to send a message while daemon is running

**Error**:
```
INFO SignalAccount - Config file is in use by another instance, waiting…
```

**Root Cause**:
- Signal CLI uses file-based locking for the config directory
- Only ONE process can access the config at a time
- Spawn-based approach creates conflicts

### Solution

**Use JSON-RPC (V2)**:
```typescript
// ❌ V1: Each operation locks config
spawn('signal-cli', [..., 'send', ...]);  // Waits for lock
spawn('signal-cli', [..., 'receive']);     // Waits for lock

// ✅ V2: Daemon owns config, clients use TCP
signal-cli daemon --tcp localhost:7583    // Daemon holds lock
rpcClient.sendMessage({...});              // No lock needed (TCP)
rpcClient.subscribeReceive();              // No lock needed (TCP)
```

### Lesson

✅ **JSON-RPC eliminates all locking issues**
✅ **Never spawn multiple signal-cli instances** simultaneously
✅ **If you must use spawn**, ensure sequential execution

**Impact**: V1 had frequent lockups, V2 has ZERO locking issues

---

## Cloudflare R2 Integration

### Architecture

```
Container Start
     ↓
Download signal-data from R2
     ↓
Extract to /app/signal-data
     ↓
Start signal-cli daemon
     ↓
Container Running
     ↓
Container Stop Signal
     ↓
Upload signal-data to R2
     ↓
Container Stop
```

### Implementation

**Sync Script** (`sync-signal-data.sh`):
```bash
# Download from R2
curl -H "Authorization: Bearer ${WORKER_API_TOKEN}" \
  "${WORKER_API_URL}/api/r2/download/signal-data-backup.tar.gz" \
  -o /tmp/signal-data-backup.tar.gz

tar -xzf /tmp/signal-data-backup.tar.gz -C /app/signal-data

# Upload to R2
tar -czf /tmp/signal-data-backup.tar.gz /app/signal-data
BASE64_CONTENT=$(base64 -i /tmp/signal-data-backup.tar.gz | tr -d '\n')

curl -X POST \
  -H "Authorization: Bearer ${WORKER_API_TOKEN}" \
  -d "{\"key\":\"signal-data-backup.tar.gz\",\"content\":\"$BASE64_CONTENT\",\"encoding\":\"base64\"}" \
  "${WORKER_API_URL}/api/r2/upload"
```

### Gotchas

**1. macOS Extended Attributes**:
```
tar: Ignoring unknown extended header keyword 'LIBARCHIVE.xattr.com.apple.provenance'
```
- **Impact**: Harmless warnings, doesn't affect functionality
- **Fix**: Not needed, but can use `--no-mac-metadata` if desired

**2. Base64 Encoding Size**:
- Signal data is ~5-10MB compressed
- Base64 increases size by ~33%
- Worker API handles this fine, but be aware of limits

**3. Worker API Timeout**:
- Large uploads may timeout
- Consider streaming for very large files
- Current implementation works for typical Signal data (< 50MB)

### Lesson

✅ **R2 is perfect for Signal data persistence**
✅ **Always backup before container operations**
✅ **Base64 encoding works well** for binary data transfer
✅ **Monitor R2 storage usage** and costs

**Files**:
- `container/sync-signal-data.sh`
- `container/entrypoint.sh`

---

## Container Deployment

### Multi-Stage Docker Build

**Strategy**:
```dockerfile
# Stage 1: Build TypeScript
FROM node:20-alpine AS builder
RUN npm ci && npm run build

# Stage 2: Install signal-cli
FROM debian:trixie-slim AS signal-cli
RUN apt-get install openjdk-21-jre-headless wget
RUN wget signal-cli && tar xf

# Stage 3: Runtime
FROM node:20-slim
COPY --from=builder /app/dist ./dist
COPY --from=signal-cli /opt/signal-cli ./signal-cli
RUN npm ci --only=production
```

**Benefits**:
- ✅ **Smaller final image**: ~450MB vs ~1.2GB
- ✅ **No build tools in production**
- ✅ **Better security**: Minimal attack surface
- ✅ **Faster deploys**: Less data to transfer

### Health Checks

**Implementation**:
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
  CMD curl -f http://localhost:8080/health || exit 1
```

**Importance**:
- Docker/Kubernetes can auto-restart unhealthy containers
- Load balancers can remove unhealthy instances
- Monitoring systems can alert on health check failures

### Lesson

✅ **Use multi-stage builds** for production images
✅ **Implement health checks** at both container and app level
✅ **Volume mount Signal data** for persistence
✅ **Use restart policies** (`--restart unless-stopped`)

**File**: `container/Dockerfile`

---

## Performance Optimizations

### Message Send Time

| Version | Method | Time | Notes |
|---------|--------|------|-------|
| V1 | spawn-based | ~5s | Process spawn overhead |
| V2 | JSON-RPC | ~2s | TCP socket, no spawn |

**Improvement**: **60% faster**

### Memory Usage

| Version | Memory | Notes |
|---------|--------|-------|
| V1 | ~420MB | Multiple processes |
| V2 | ~380MB | Single daemon |

**Improvement**: **10% reduction**

### CPU Usage (idle)

| Version | CPU | Notes |
|---------|-----|-------|
| V1 | ~5% | Periodic spawns |
| V2 | ~2% | Event-driven |

**Improvement**: **60% reduction**

### Startup Time

| Version | Time | Notes |
|---------|------|-------|
| V1 | ~20s | Multiple initializations |
| V2 | ~15s | Single daemon start |

**Improvement**: **25% faster**

### Lesson

✅ **JSON-RPC provides significant performance gains**
✅ **Event-driven architecture** reduces CPU usage
✅ **Single long-running process** is more efficient
✅ **Profile before optimizing** - measure real impact

---

## Bot Version Management & Module Loading

### Problem: Wrong Bot Version Loaded

**Symptoms**:
- Bot receives messages but doesn't process them
- No debug logs appearing even though code is deployed
- URL security features not triggering
- D1 errors causing function termination

**Root Cause**:
The container was importing `signal-bot.js` (V1) instead of `signal-bot-v2.js` even though V2 had all the features and fixes.

**File**: `container/src/index.ts`
**Line 14**:
```typescript
// ❌ WRONG - imports old V1 bot
import { SignalBot, BotConfig } from './bot/signal-bot.js';

// ✅ CORRECT - imports new V2 bot with JSON-RPC
import { SignalBot, BotConfig } from './bot/signal-bot-v2.js';
```

**Detection Steps**:
1. Check which bot file is imported in `index.ts`
2. Verify with: `docker exec signal-bot cat /app/dist/index.js | grep 'signal-bot'`
3. Look for V2-specific debug logs in output
4. If debug logs don't appear, wrong version is loaded

**Impact**:
- **Message routing fixes** in V2 not applied (messages going to wrong channel)
- **URL security scanning** in V2 never executed
- **D1 error handling improvements** in V2 not active
- **Debug logging** in V2 not visible

### Problem: D1 Errors Stopping Message Processing

**Symptoms**:
- Commands partially work but then fail
- "Database query failed: Request failed with status code 500" errors
- URL checking code never reached
- `handleMessage()` function exits early

**Root Cause**:
D1 database parameter binding errors in `logError()` and `logCommand()` were throwing unhandled exceptions that terminated the entire `handleMessage()` async function before it could reach the URL security checks.

**Error Details**:
```
D1_ERROR: Wrong number of parameter bindings for SQL query.
```

**Stack Trace**:
```
Error handling message: Error: Database query failed: Request failed with status code 500
    at WorkerAPIClient.logError (file:///app/dist/api/worker-api-client.js:161:9)
    at async SignalBot.handleCommand (file:///app/dist/bot/signal-bot.js:326:13)
    at async SignalBot.handleMessage (file:///app/dist/bot/signal-bot.js:275:17)
```

**The Chain of Failure**:
1. User sends `!ask` command
2. Command handler fails (application logic error)
3. Bot tries to log error to D1 via `workerApi.logError()`
4. D1 query has wrong parameter count → throws exception
5. Exception bubbles up to `handleCommand()`
6. `handleCommand()` re-throws to `handleMessage()`
7. **`handleMessage()` exits before reaching URL check code at line 356**
8. URL security feature silently fails

**Solution Strategy**:
1. **Fix Module Import**: Change `index.ts` to import `signal-bot-v2.js`
2. **Verify D1 Schema**: Ensure Worker API D1 queries match table schema
3. **Add More Try-Catch**: Wrap D1 operations so they don't kill message processing
4. **Non-blocking Logging**: Make all logging operations fire-and-forget
5. **Test Message Flow**: Verify URL checks run even when D1 fails

**Prevention**:
```typescript
// ✅ GOOD: D1 errors don't stop message processing
try {
  await this.workerApi.logError({...});
} catch (error) {
  console.error('Failed to log to D1 (non-critical):', error);
  // Continue processing - don't throw!
}

// Continue to URL security check regardless of D1 status
const urlAlerts = processMessageURLs(messageText);
```

### Problem: SQLite Database Corruption from R2

**Symptoms**:
- `SQLITE_CORRUPT` error on every deployment
- "malformed database schema (sqlite_autoindex_kyber_pre_key_1) - orphan index"
- Bot won't start until database is manually restored
- `NoSessionException` errors for group message decryption

**Root Cause**:
The R2 backup contains a corrupted `account.db` file. Every deployment downloads this corrupt backup, requiring manual intervention.

**Permanent Fix** (✅ IMPLEMENTED in `sync-signal-data.sh`):

1. **Exclude account.db from R2 backups** to prevent storing corrupt database:
```bash
tar -czf /tmp/signal-data-backup.tar.gz \
    --exclude='*/813876.d/account.db*' \
    --exclude='*/data/*/account.db*' \
    "$(basename ${SIGNAL_DATA_DIR})"
```

2. **Auto-regenerate account.db from SQL dump** when restoring from R2:
```bash
if [ -f "${ACCOUNT_DIR}/account_dump.sql" ]; then
    rm -f "${ACCOUNT_DIR}"/account.db*
    sqlite3 account.db < account_dump.sql 2>&1 | grep -v "UNIQUE constraint" || true
fi
```

**One-time steps to apply fix**:
```bash
# 1. Deploy with updated sync-signal-data.sh
./deploy-to-proxmox.sh

# 2. Fix database manually ONE last time
ssh root@proxmox-main "docker exec signal-bot sh -c 'cd /app/signal-data/data/813876.d && rm -f account.db* && sqlite3 account.db < account_dump.sql'"
ssh root@proxmox-main "docker restart signal-bot"

# 3. Create fresh R2 backup without corrupt database
ssh root@proxmox-main "docker exec signal-bot /app/sync-signal-data.sh upload"

# 4. All future deployments will auto-regenerate clean database!
```

### Lesson

✅ **Always verify which bot version is imported** in `index.ts`
✅ **D1 errors should never stop message processing** - use try-catch
✅ **Implement fire-and-forget logging** for non-critical operations
✅ **Test URL features independently** from D1 functionality
✅ **Check R2 backups for corruption** before deploying
✅ **Add database health checks** to deployment process
✅ **Create SQL dumps as backup** when database corruption is detected
✅ **Use debug logging liberally** to trace execution flow

**Files Affected**:
- `container/src/index.ts` (line 14) - Bot version import
- `container/src/bot/signal-bot-v2.ts` (lines 290-405) - Message handling with debug logs
- `container/src/api/worker-api-client.ts` - D1 query errors
- `deploy-to-proxmox.sh` - R2 backup download causing corruption

---

## Common Pitfalls

### 1. Forgetting to Subscribe

**Mistake**:
```typescript
await this.rpcClient.connect();
// Oops! Didn't call subscribeReceive()
// Messages won't come through!
```

**Fix**:
```typescript
await this.rpcClient.connect();
await this.rpcClient.subscribeReceive();  // Don't forget!
```

### 2. Wrong Recipient Format

**Mistake**:
```typescript
await rpcClient.sendMessage({
  message: "Hello",
  recipient: "+1234567890",  // ❌ String, should be array
});
```

**Fix**:
```typescript
await rpcClient.sendMessage({
  message: "Hello",
  recipient: ["+1234567890"],  // ✅ Array format
});
```

### 3. Not Handling Reconnections

**Mistake**:
```typescript
// Connection lost... bot stops working forever
```

**Fix**:
```typescript
this.rpcClient.on('disconnected', () => {
  console.log('Connection lost, will auto-reconnect...');
  // Auto-reconnection built into SignalJsonRpcClient
});
```

### 4. Ignoring Daemon Errors

**Mistake**:
```typescript
spawn('signal-cli', ['daemon', ...]);
// Daemon crashes... no handling
```

**Fix**:
```typescript
this.daemonProcess.on('exit', (code) => {
  if (code !== 0) {
    console.error(`Daemon exited with code ${code}`);
    this.emit('daemon-exit', code);
    // Trigger restart logic
  }
});
```

### 5. Not Testing Message Receiving

**Mistake**:
- Only test sending messages
- Assume receiving will "just work"

**Fix**:
- Test `!help` command immediately after deployment
- Monitor logs for "📨 Message from" entries
- Verify `subscribeReceive()` succeeds

---

## Best Practices

### 1. Architecture

✅ **Use JSON-RPC for all production deployments**
✅ **Spawn-based only for CLI/one-off operations**
✅ **Single daemon, multiple JSON-RPC clients if needed**
✅ **Event-driven message processing**

### 2. Error Handling

✅ **Log all errors to Cloudflare D1**
✅ **Implement graceful degradation**
✅ **Auto-restart on daemon crash**
✅ **Exponential backoff for reconnections**

### 3. Persistence

✅ **Backup to R2 on every container stop**
✅ **Restore from R2 on every container start**
✅ **Periodic backups (hourly/daily)**
✅ **Version backup files** for rollback capability

### 4. Monitoring

✅ **Health checks at multiple levels** (container, daemon, RPC)
✅ **Track message send/receive counts**
✅ **Alert on error rate thresholds**
✅ **Monitor Cloudflare service usage**

### 5. Security

✅ **Strong API tokens** (32+ random bytes)
✅ **Environment variables for secrets**
✅ **Firewall bot API** (port 8919)
✅ **HTTPS for Worker API**
✅ **Regular Signal account backups**

### 6. Testing

✅ **Test message sending** via API
✅ **Test message receiving** with `!help`
✅ **Test R2 backup/restore** cycle
✅ **Test daemon restarts**
✅ **Test network disconnections**

---

## Social Media Content Downloader with yt-dlp

### Problem: Instagram/TikTok URL Sharing in Signal

**User Request**:
Users wanted to share Instagram Reels and TikTok videos in Signal groups, but:
- URLs included tracking parameters (`?igsh=...`, `?utm_source=...`)
- Signal doesn't auto-preview social media content
- Manual downloading and re-uploading was tedious

**Goal**:
Automatically detect social media URLs, remove trackers, download content, and send it as an attachment in Signal-compatible format.

### Implementation: yt-dlp Integration

**Inspired by** `dl` function from `~/Git/dotfiles/platforms/macos/config/.zsh_functions`

**Architecture**:
```
User posts Instagram URL
    ↓
Bot detects platform (Instagram, TikTok, etc.)
    ↓
Bot removes tracker parameters
    ↓
Bot downloads with yt-dlp (Signal-compatible format)
    ↓
Bot sanitizes filename
    ↓
Bot sends file as Signal attachment
    ↓
Clean URL included in message
```

**Key Components**:

1. **Social Media Detector** (`src/utils/social-media-detector.ts`):
   - 12 platform support (Instagram, TikTok, Twitter/X, YouTube, Facebook, Reddit, Vimeo, Twitch, LinkedIn, Pinterest, Snapchat)
   - 50+ tracker parameter removal (igsh, fbclid, utm_*, etc.)
   - Content type detection (Reel, Post, Video, Short, etc.)

2. **Social Media Downloader** (`src/utils/social-media-downloader.ts`):
   - yt-dlp integration for universal downloading
   - Signal-compatible video format:
     - Video: H.264 Main profile, level 3.1, yuv420p
     - Audio: AAC at 128kbps, stereo
     - Container: MP4 with faststart
   - Quality selection (1080p, 720p, 480p, 360p, best, worst)
   - 95 MB file size limit (Signal cross-platform maximum)
   - Automatic filename sanitization (lowercase, underscores)

3. **Bot Integration** (`src/bot/signal-bot-v2.ts`):
   - `checkForSocialMediaUrls()` method processes messages
   - Attachment support in `sendMessage()`
   - Non-blocking (doesn't stop other features)

### Critical Bug Fix #1: Shell Redirection Operators

**Problem**:
```
/bin/sh: 1: cannot open =720]+bestaudio/best[height: No such file
```

**Root Cause**:
yt-dlp format selector `bestvideo[height<=720]+bestaudio/best[height<=720]/best` contains `<` and `>` characters that `/bin/sh` interprets as file redirection operators when passed through `execAsync()`.

**Failed Command**:
```typescript
const command = `yt-dlp -f bestvideo[height<=720]+bestaudio/best[height<=720]/best ...`;
await execAsync(command);  // Shell interprets < as redirection!
```

**Fix**:
```typescript
// Quote arguments containing shell special characters
const quotedArgs = ytdlArgs.map(arg => {
  if (arg.includes(' ') || arg.includes('<') || arg.includes('>') ||
      arg.includes('[') || arg.includes(']')) {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
  return arg;
});
const command = `yt-dlp ${quotedArgs.join(' ')}`;
```

**File**: `container/src/utils/social-media-downloader.ts:185-186`

### Critical Bug Fix #2: Instagram Format Selection

**Problem**:
```
❌ Download failed: Requested format is not available
```

**Root Cause**:
Instagram videos come as a single combined MP4 file (format ID 0) with video and audio already muxed. The format selector `bestvideo[height<=720]+bestaudio` expects separate streams that can be combined, which Instagram doesn't provide.

**Instagram Format Structure**:
```
ID EXT RESOLUTION | PROTO | VCODEC  ACODEC
-------------------------------------------
0  mp4 750x1000   | https | unknown unknown
```

**Fix**:
```typescript
// Before (fails for Instagram)
'-f', 'bestvideo[height<=720]+bestaudio'

// After (works for Instagram AND YouTube)
'-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best'
```

The fallback chain:
1. Try: `bestvideo[height<=720]+bestaudio` (YouTube, etc.)
2. Fallback: `best[height<=720]` (single format with height limit)
3. Final fallback: `best` (best available regardless of height)

**File**: `container/src/utils/social-media-downloader.ts:140-142`

### Dockerfile Updates

**Dependencies Added**:
```dockerfile
RUN apt-get install -y \
    ffmpeg \          # Video processing
    python3 \         # Required for yt-dlp
    python3-pip \     # Package manager
    && pip3 install --no-cache-dir --break-system-packages yt-dlp
```

**File**: `container/Dockerfile:49-57`

### Testing & Verification

**Manual Testing** (confirmed working):
```bash
# Test yt-dlp with full command
docker exec signal-bot yt-dlp \
  -f 'bestvideo[height<=720]+bestaudio/best[height<=720]/best' \
  --merge-output-format mp4 \
  --postprocessor-args 'ffmpeg:-c:v libx264 -profile:v main...' \
  -o '/tmp/test.%(ext)s' \
  'https://www.instagram.com/reel/DNwP6ZCwv6r/'

# Result: ✅ Downloaded 1.92 MiB in 00:00:00
```

**Live Bot Testing**:
- User posts: `https://www.instagram.com/reel/DNwP6ZCwv6r/?igsh=MWJ4bG9zN2lndTRhNg==`
- Bot responds:
  ```
  📸 Instagram Reel detected. Processing...

  📸 Instagram Reel
  📎 Downloaded: video_title.mp4
  📊 Size: 1.92 MB

  🧹 Clean URL:
  https://www.instagram.com/reel/DNwP6ZCwv6r/
  ```
- Video plays in Signal without issues

### Lesson

✅ **Shell special characters must be quoted** when building commands
✅ **Test yt-dlp commands manually first** before integrating
✅ **Instagram requires fallback format selectors** (single format)
✅ **Signal has specific codec requirements** (H.264 Main + AAC + yuv420p)
✅ **yt-dlp is extremely versatile** - handles 1000+ sites
✅ **Filename sanitization prevents issues** with special characters
✅ **95 MB limit enforcement** prevents Signal upload failures

**Shell Escape Characters to Quote**:
- `<`, `>` - Redirection operators
- `[`, `]` - Glob patterns
- `(`, `)` - Subshells
- `$` - Variable expansion
- Spaces - Argument splitting

**Files**:
- `container/src/utils/social-media-detector.ts` - Platform detection
- `container/src/utils/social-media-downloader.ts` - yt-dlp integration
- `container/src/bot/signal-bot-v2.ts` - Bot integration
- `container/Dockerfile` - Dependencies

---

## CommandHandler Bot Instance Injection

### Problem: !groups Command Failing

**Symptoms**:
```
!groups
→ ❌ Bot instance not available
```

**Root Cause**:
CommandHandler needs access to bot methods like `getGroups()` and `getGroupInfo()`, but `this.bot` was initialized as `null` and never set.

**Code Structure**:
```typescript
// command-handler.ts
export class CommandHandler {
  private bot: any | null = null;  // ← Initialized as null

  constructor(config: BotConfig, workerApi: WorkerAPIClient) {
    this.config = config;
    this.workerApi = workerApi;
    // bot is still null!
  }

  setBotInstance(bot: any): void {  // ← Method exists but never called!
    this.bot = bot;
  }

  private async handleGroups(): Promise<string> {
    if (!this.bot) {  // ← Always true because bot is null!
      return '❌ Bot instance not available';
    }
    const groups = await this.bot.getGroups();  // Never reached
    // ...
  }
}
```

**signal-bot-v2.ts Constructor**:
```typescript
constructor(config: BotConfig, workerApi: WorkerAPIClient) {
  super();
  this.config = config;
  this.workerApi = workerApi;
  this.commandHandler = new CommandHandler(config, workerApi);
  // ❌ Forgot to call: this.commandHandler.setBotInstance(this);
}
```

### Solution

**Fix Applied**:
```typescript
// signal-bot-v2.ts constructor
constructor(config: BotConfig, workerApi: WorkerAPIClient) {
  super();
  this.config = config;
  this.workerApi = workerApi;
  this.commandHandler = new CommandHandler(config, workerApi);
  // ✅ ADDED: Pass bot instance to command handler
  this.commandHandler.setBotInstance(this);
}
```

**File**: `container/src/bot/signal-bot-v2.ts:103`

### Why This Pattern Exists

**Circular Dependency Prevention**:
- SignalBot creates CommandHandler
- CommandHandler needs SignalBot methods
- Can't pass `this` in constructor (not fully initialized yet)
- Solution: Two-phase initialization with `setBotInstance()`

**Alternative Approaches Considered**:

1. ❌ **Pass bot in constructor**: `this` not ready yet
2. ❌ **Pass methods as callbacks**: Too many methods to pass
3. ✅ **Dependency injection after construction**: Clean and safe

### Affected Commands

Commands that need `this.bot`:
- `!groups` - List all Signal groups
- `!addto <group#> @user` - Add users to groups (admin only)
- Any future commands that interact with Signal groups

**Testing**:
```
!groups
→ 📱 Your Signal Groups:

────────────────
1. IrregularChat Community 👑
   👥 3 members

2. Off Topic Guild 👤
   👥 45 members

────────────────
📊 Total: 2 groups
👥 Member slots: 48 (47 unique users)
👑 = Bot has admin rights
👤 = Bot is regular member
```

### Lesson

✅ **Dependency injection is common pattern** for circular dependencies
✅ **Constructor initialization happens in phases** - be mindful of order
✅ **"Instance not available" usually means** dependency wasn't injected
✅ **Test all command paths** after architectural changes
✅ **Two-phase initialization is OK** when done intentionally

**Detection Steps**:
1. See "Instance not available" error
2. Check if setter method exists (`setBotInstance`)
3. Verify setter is called after construction
4. Ensure called in the right constructor (V1 vs V2!)

**Files**:
- `container/src/bot/command-handler.ts:40-42` - setBotInstance method
- `container/src/bot/signal-bot-v2.ts:103` - Injection call

---

## Signal @Mentions and Command Context (2025-11-19)

### The Problem: Parsing vs Structured Data

**WRONG APPROACH** ❌: Extracting phone numbers from command text
```typescript
// This DOES NOT WORK with Signal @mentions
const phoneMatch = args.match(/\+\d{10,15}/);
if (!phoneMatch) {
  return '❌ Could not find valid phone number\n\nUsage: !gtg +12345678901';
}
const userPhone = phoneMatch[0];
```

**Why This Fails**:
- Signal @mentions (like `@Justin McIntosh`) are NOT plain text in the message
- They're structured data in `envelope.dataMessage.mentions`
- Phone numbers are often not present - Signal uses UUIDs
- Regex parsing cannot resolve mentioned users to their identifiers

### The Solution: Use Message Envelope Mentions

Signal messages include a `mentions` array with structured data:

```typescript
// Signal mention structure
interface Mention {
  start: number;    // Position in message text where mention starts
  length: number;   // Length of mention text
  uuid?: string;    // User's Signal UUID (preferred)
  number?: string;  // User's phone number (if available)
}
```

**CORRECT APPROACH** ✅:

1. **Update CommandContext Interface**:
```typescript
export interface CommandContext {
  sourceNumber: string;
  sourceName: string;
  groupId?: string;
  timestamp: number;
  quotedText?: string;
  mentions?: Mention[];  // Add mentions array
}
```

2. **Pass Mentions from Bot to Command Handler**:
```typescript
// In signal-bot-v2.ts handleMessage()
await this.handleCommand(messageText, {
  sourceNumber: sourceNumber || '',
  sourceName: sourceName || '',
  groupId,
  timestamp,
  quotedText,
  mentions: envelope.dataMessage?.mentions,  // Pass structured mentions
});
```

3. **Extract User Identifiers from Mentions**:
```typescript
// For single user commands like !gtg
private async handleGtg(args: string, context: CommandContext): Promise<string> {
  if (!context.mentions || context.mentions.length === 0) {
    return '❌ Please mention a user\n\nUsage: !gtg @user';
  }

  const mention = context.mentions[0];
  const userPhone = mention.number || mention.uuid;  // Prefer number, fallback to UUID

  if (!userPhone) {
    return '❌ Could not resolve mentioned user';
  }

  // Now use userPhone with signal-cli commands
  await this.bot.sendMessage({ recipient: userPhone, message: '...' });
}

// For multi-user commands like !addto
private async handleAddTo(args: string, context: CommandContext): Promise<string> {
  if (!context.mentions || context.mentions.length === 0) {
    return '❌ Please mention users to add\n\nUsage: !addto @user1 @user2 11';
  }

  const userIdentifiers: string[] = [];
  for (const mention of context.mentions) {
    const identifier = mention.number || mention.uuid;
    if (identifier) {
      userIdentifiers.push(identifier);
    }
  }

  // Process all mentioned users
  for (const identifier of userIdentifiers) {
    await this.addUserToGroup(identifier, groupId);
  }
}
```

### Deployment Lesson: Container Rebuild Required

**CRITICAL**: When deploying code changes, you MUST rebuild the container, not just restart it.

**WRONG** ❌:
```bash
# This keeps old code cached in Node.js memory
ssh root@proxmox-main "cd /home/signal-bot-selfhosted && docker-compose restart signal-bot"
```

**CORRECT** ✅:
```bash
# This rebuilds the image with new code and restarts
ssh root@proxmox-main "cd /home/signal-bot-selfhosted && docker-compose up -d --build signal-bot"
```

**Why This Matters**:
- Node.js caches imported modules in memory
- Simply restarting the container reuses the same image with old code
- `--build` flag forces Docker to rebuild the image with updated source
- Without rebuild, your changes won't take effect even after rsync deployment

**Deployment Script Best Practice**:
```bash
# In deploy-to-proxmox.sh, always use --build flag
echo "📦 Rebuilding and restarting container..."
ssh root@proxmox-main "cd /home/signal-bot-selfhosted && docker-compose up -d --build signal-bot"
```

### Testing @Mentions

**Test Command Format**:
```
!gtg @UserName         # Approve and add user to groups
!addto @User1 @User2 11  # Add multiple users to group #11
!addto 11 @User        # Group number can be first or last
```

**Verification Steps**:
1. Send test command with @mention in Signal
2. Check bot logs for mention resolution: `docker-compose logs signal-bot`
3. Verify user receives welcome message (for !gtg)
4. Verify user is added to groups
5. Check database for join request updates

### Key Takeaways

1. **Never parse mention text** - Always use `context.mentions` array
2. **Prefer UUID over phone** - `mention.uuid` is more reliable than `mention.number`
3. **Container rebuild is mandatory** - Use `docker-compose up -d --build`, not `restart`
4. **Update all related commands** - Any command that needs user identifiers should use mentions
5. **Test with actual @mentions** - Don't test with phone numbers, test with @username syntax

### Commands Updated with Mention Support

- `!gtg @user` - Approve user and add to recommended groups
- `!addto @user1 @user2 <group-number>` - Add users to specific group
- Any admin command that targets users should follow this pattern

---

## Deployment Architecture: Self-Hosted vs Cloudflare Mode (2025-11-20)

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

---

## Summary

### Top 5 Lessons

1. **JSON-RPC is Essential**: Don't use spawn-based approach in production
2. **Java 21 Required**: signal-cli v0.13.22+ needs Java 21
3. **Must Subscribe**: Call `subscribeReceive()` to get messages
4. **R2 is Perfect**: Cloudflare R2 works excellently for Signal data
5. **Test Receiving**: Always test message receiving, not just sending

### Migration Path

If currently using V1 (spawn-based):

1. Update Dockerfile to Java 21
2. Implement SignalJsonRpcClient
3. Update bot to use JSON-RPC
4. Add `subscribeReceive()` call
5. Test thoroughly
6. Deploy

**Expected Results**:
- 60% faster message sending
- Zero config locking issues
- Better reliability
- Lower resource usage

### Files to Review

**Critical Files**:
- `container/Dockerfile` - Java 21 setup
- `container/src/bot/signal-jsonrpc-client.ts` - JSON-RPC client
- `container/src/bot/signal-bot.ts` - Bot implementation
- `container/sync-signal-data.sh` - R2 sync

**Documentation**:
- `SIGNAL_BOT_DOCUMENTATION.md` - Complete guide
- `ARCHITECTURE.md` - System design
- `DEPLOYMENT.md` - Deployment steps

---

## Docker Build Caching and Code Deployment (2025-11-21)

### Problem: New Code Not Deployed Despite Successful Build

**Symptoms**:
- Code changes made locally and rsync'd to server
- Docker rebuild appears successful
- Container restarts without errors
- BUT new functionality doesn't work - old code still running!

**Root Cause**:
Docker's layer caching combined with the Dockerfile's `COPY src/ ./src/` and `RUN npm run build` structure means:
1. Docker caches the `COPY src/` layer based on file timestamps/checksums
2. If Docker thinks the files haven't changed, it uses the cached layer
3. The `RUN npm run build` step is also cached if its dependencies are cached
4. Result: Old compiled code remains in the image even after "rebuilding"

### The Deployment Issue

**Scenario**:
1. Make changes to `src/bot/command-handler.ts` locally
2. Run `./deploy-to-proxmox.sh` to copy files to server
3. Run `docker-compose build --no-cache signal-bot` on server
4. Run `docker-compose up -d` to restart
5. **Problem**: Old code still running!

**Why `--no-cache` Didn't Help**:
- The deployment script was copying files to `/home/signal-bot-selfhosted/bot/`
- But Docker build was looking at files IN THE IMAGE BUILD CONTEXT
- The Dockerfile does `COPY src/ ./src/` during build
- This copies from the HOST file system at build time
- If the HOST files are old, Docker caches them

### Solution 1: Forceful File Update + No-Cache Build

**Two-Step Process**:

1. **Update Source Files on Host**:
```bash
# Copy BOTH source TypeScript AND compiled JavaScript
rsync -avz --progress \
  /local/path/signal-bot/container/src/bot/command-handler.ts \
  root@proxmox-main:/home/signal-bot-selfhosted/bot/src/bot/command-handler.ts

rsync -avz --progress \
  /local/path/signal-bot/container/dist/bot/command-handler.js \
  root@proxmox-main:/home/signal-bot-selfhosted/bot/dist/bot/command-handler.js
```

2. **Force Complete Rebuild**:
```bash
ssh root@proxmox-main "cd /home/signal-bot-selfhosted && \
  docker-compose build --no-cache signal-bot && \
  docker-compose up -d"
```

**Why This Works**:
- Updates the TypeScript source files that Docker will `COPY`
- `--no-cache` forces Docker to ignore all cached layers
- Forces fresh `npm run build` inside container
- Compiles the NEW source code
- Creates entirely new image with new code

### Solution 2: Better Dockerfile Structure (Recommended)

**Current Problematic Pattern**:
```dockerfile
# ❌ This structure leads to caching issues
COPY src/ ./src/
RUN npm run build

# Docker caches both layers together
# Hard to invalidate selectively
```

**Improved Pattern**:
```dockerfile
# ✅ Add cache-busting mechanism
ARG BUILD_DATE
ARG GIT_COMMIT
LABEL build_date=$BUILD_DATE
LABEL git_commit=$GIT_COMMIT

COPY src/ ./src/
RUN npm run build
```

**Build with cache-busting**:
```bash
docker-compose build \
  --build-arg BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ') \
  --build-arg GIT_COMMIT=$(git rev-parse HEAD) \
  signal-bot
```

### Solution 3: Pre-Compile Locally (Fastest)

**Strategy**:
```bash
# 1. Compile locally
cd /local/path/signal-bot/container
npm run build

# 2. Copy ONLY compiled JavaScript (no source)
rsync -avz --delete --progress \
  dist/ root@proxmox-main:/home/signal-bot-selfhosted/bot/dist/

# 3. Restart container (no rebuild needed if dependencies unchanged)
ssh root@proxmox-main "cd /home/signal-bot-selfhosted && docker-compose restart signal-bot"
```

**Pros**:
- ✅ Fastest deployment (no Docker rebuild)
- ✅ No TypeScript compilation on server
- ✅ Guaranteed to use your local compiled code

**Cons**:
- ❌ Must rebuild if `package.json` dependencies change
- ❌ Doesn't update Dockerfile changes

### Solution 4: Automated Deployment Script (Recommended)

**Script**: `deploy-signal-bot-code.sh`

A comprehensive deployment script that automates all the steps above and includes verification:

```bash
cd /Users/sac/Git/chat-based-community-dashboard/modern-stack/cloudflare-workers/signal-bot
./deploy-signal-bot-code.sh
```

**What It Does**:
1. ✅ Builds TypeScript locally (`npm run build`)
2. ✅ Copies both source AND compiled files to server (rsync)
3. ✅ Verifies files on host (grep verification pattern)
4. ✅ Force rebuilds Docker image with `--no-cache`
5. ✅ Restarts container with new image
6. ✅ Waits for container to stabilize
7. ✅ Verifies deployment (grep verification pattern in running container)
8. ✅ Shows container logs for final confirmation

**Usage Options**:
```bash
# Full deployment with all steps
./deploy-signal-bot-code.sh

# Skip local build (use existing dist/)
./deploy-signal-bot-code.sh --skip-build

# Skip verification checks
./deploy-signal-bot-code.sh --skip-verify
```

**Script Features**:
- Color-coded output for easy reading
- Step-by-step progress indicators
- Automatic error detection and exit on failure
- Verification pattern checking (confirms code is deployed)
- Container health checks
- Deployment statistics summary

### Verification Checklist

**After Every Deployment**:

1. **Verify File Contents on Host**:
```bash
ssh root@proxmox-main "grep -c 'GROUP_KEYWORD_MAP' \
  /home/signal-bot-selfhosted/bot/src/bot/command-handler.ts"
# Should return: 3 (or whatever your code has)
```

2. **Verify File Contents in Container**:
```bash
ssh root@proxmox-main "docker exec signal-bot-selfhosted \
  grep -c 'GROUP_KEYWORD_MAP' /app/dist/bot/command-handler.js"
# Should return: 3 (matches source)
```

3. **Check Container Logs for Startup**:
```bash
ssh root@proxmox-main "docker logs signal-bot-selfhosted --tail 50"
# Should see: Signal bot started successfully
```

4. **Test New Feature**:
```bash
# Send test command via Signal
# Watch logs for expected behavior
ssh root@proxmox-main "docker logs signal-bot-selfhosted -f"
```

### The Deployment Script Problem

**Original `deploy-to-proxmox.sh`**:
```bash
# Copies files
rsync container/src root@proxmox-main:/home/signal-bot-selfhosted/bot/

# BUT doesn't force rebuild properly
ssh root@proxmox-main "cd /home/signal-bot-selfhosted && docker-compose up -d --build"
# --build will use cache if Docker thinks files unchanged!
```

**Improved Version** (see below for full script):
```bash
# 1. Build locally first
echo "🔨 Building TypeScript locally..."
cd container && npm run build && cd ..

# 2. Copy both source AND compiled files
echo "📦 Copying files to server..."
rsync -avz --progress container/ root@proxmox-main:/home/signal-bot-selfhosted/bot/

# 3. Force no-cache rebuild
echo "🔨 Force rebuilding Docker image..."
ssh root@proxmox-main "cd /home/signal-bot-selfhosted && \
  docker-compose build --no-cache signal-bot"

# 4. Restart with new image
echo "🚀 Restarting container..."
ssh root@proxmox-main "cd /home/signal-bot-selfhosted && docker-compose up -d"

# 5. Verify deployment
echo "✅ Verifying deployment..."
sleep 5
ssh root@proxmox-main "docker exec signal-bot-selfhosted \
  grep -c 'GROUP_KEYWORD_MAP' /app/dist/bot/command-handler.js"
```

### Lesson

✅ **Always verify deployed code** by checking inside the running container
✅ **Docker caching is aggressive** - use `--no-cache` when in doubt
✅ **Update host files BEFORE building** - Docker copies at build time
✅ **Test new features immediately** after deployment
✅ **Keep verification steps** in deployment script
✅ **Build locally when possible** - faster and more reliable
✅ **Check both source AND compiled files** - they must match

**Critical Commands**:
```bash
# Verify code on host
grep 'NEW_FEATURE' /home/signal-bot-selfhosted/bot/src/file.ts

# Verify code in container
docker exec container grep 'NEW_FEATURE' /app/dist/file.js

# Force rebuild
docker-compose build --no-cache service-name

# Check which code is actually running
docker logs container --tail 50
```

**Files**:
- `deploy-signal-bot-code.sh` - New reliable deployment script (see below)
- `container/Dockerfile` - Build configuration
- `docker-compose.yml` - Service orchestration

---

## Emoji Reactions Implementation (2025-11-22)

### Problem: Implementing Keyword-to-Emoji Auto-Reactions

**User Request**:
Automatically react with emojis when messages contain specific keywords (e.g., 🥔 when someone says "potato").

### Implementation: Three-Part System

**Architecture**:
```
Message received
    ↓
Check for keywords (emoji-reaction-handler.ts)
    ↓
Match found → Send reaction via JSON-RPC
    ↓
signal-cli sends emoji reaction to message
```

**Components**:

1. **Configuration** (`container/config/emoji-reactions.json`):
   - User-friendly JSON config with keyword-to-emoji mappings
   - Settings for matching behavior (case sensitivity, whole word, etc.)
   - Debounce settings to prevent duplicate reactions

2. **Handler** (`container/src/utils/emoji-reaction-handler.ts`):
   - Loads config and matches keywords against messages
   - Implements debouncing to prevent spam
   - Provides reload capability without restart

3. **JSON-RPC Integration** (`container/src/bot/signal-jsonrpc-client.ts`):
   - `sendReaction()` method added to JSON-RPC client
   - Sends reactions via signal-cli's `sendReaction` command

4. **Bot Integration** (`container/src/bot/signal-bot-v2.ts`):
   - Checks messages for matching emojis after command handling
   - Sends reactions asynchronously (non-blocking)

### Critical Bug #1: __dirname Not Available in ES Modules

**Problem**:
```
💥 Uncaught exception: ReferenceError: __dirname is not defined
    at new EmojiReactionHandler (file:///app/dist/utils/emoji-reaction-handler.js:13:51)
```

**Root Cause**:
ES modules don't have `__dirname` available. The code was trying to use it to construct the config file path:

```typescript
// ❌ WRONG - __dirname doesn't exist in ES modules
constructor(configPath?: string) {
  this.configPath = configPath || path.join(__dirname, '../../config/emoji-reactions.json');
  this.config = this.loadConfig();
}
```

**Solution**:
Use conditional path based on `NODE_ENV` with absolute path for production:

```typescript
// ✅ CORRECT - Use absolute path in production, relative in development
constructor(configPath?: string) {
  // Use absolute path in containerized environment, or relative path for development
  this.configPath = configPath || process.env.NODE_ENV === 'production'
    ? '/app/config/emoji-reactions.json'
    : path.join(process.cwd(), 'config/emoji-reactions.json');
  this.config = this.loadConfig();
}
```

**File**: `container/src/utils/emoji-reaction-handler.ts:36-41`

### Critical Bug #2: Wrong JSON-RPC Parameter Name

**Problem**:
```
Failed to send 🍕 reaction: Error: JSON-RPC Error -32603: Cannot invoke "java.lang.Long.longValue()" because "targetTimestamp" is null (NullPointerException)
```

**Root Cause**:
signal-cli's `sendReaction` JSON-RPC method expects `targetTimestamp`, but the code was sending `targetSentTimestamp`:

```typescript
// ❌ WRONG - parameter name doesn't match signal-cli expectation
async sendReaction(params: {
  emoji: string;
  targetAuthor: string;
  targetTimestamp: number;  // Interface says targetTimestamp
}): Promise<void> {
  const rpcParams: any = {
    emoji: params.emoji,
    targetAuthor: params.targetAuthor,
    targetSentTimestamp: params.targetTimestamp,  // ← WRONG! Sends as targetSentTimestamp
  };

  await this.request('sendReaction', rpcParams);
}
```

**Solution**:
Use the correct parameter name `targetTimestamp`:

```typescript
// ✅ CORRECT - parameter name matches signal-cli expectation
async sendReaction(params: {
  emoji: string;
  targetAuthor: string;
  targetTimestamp: number;
}): Promise<void> {
  const rpcParams: any = {
    emoji: params.emoji,
    targetAuthor: params.targetAuthor,
    targetTimestamp: params.targetTimestamp,  // ✅ Correct parameter name
  };

  if (params.recipient) {
    rpcParams.recipient = params.recipient;
  }

  if (params.groupId) {
    rpcParams.groupId = params.groupId;
  }

  await this.request('sendReaction', rpcParams);
}
```

**File**: `container/src/bot/signal-jsonrpc-client.ts:377-395`

### Critical Bug #3: Missing Config Directory in Dockerfile

**Problem**:
Container logs showed config file error even though the file existed in the source repository.

**Root Cause**:
Dockerfile was missing the `COPY config ./config` command, so the emoji-reactions.json file was never copied into the Docker image:

```dockerfile
# ❌ WRONG - config directory not copied
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install production dependencies only
RUN npm ci --only=production
```

**Solution**:
Add the config directory copy command:

```dockerfile
# ✅ CORRECT - config directory is copied
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Copy configuration files
COPY config ./config

# Install production dependencies only
RUN npm ci --only=production
```

**File**: `container/Dockerfile:66-74`

### Testing & Verification

**Manual Testing** (confirmed working):
```
User: potato
Bot: [Reacts with 🥔]

User: I love pizza!
Bot: [Reacts with 🍕]

User: That's fire!
Bot: [Reacts with 🔥]
```

**Configured Reactions**:
- potato → 🥔
- pizza → 🍕
- beer → 🍺
- coffee → ☕
- fire/lit → 🔥
- thumbsup/good job → 👍
- laugh/lol/haha → 😂
- heart/love → ❤️

**Log Verification**:
```bash
# Check for successful emoji reaction
ssh root@proxmox-main "docker logs signal-bot 2>&1 | grep -i 'sent.*reaction'"

# Expected output:
# ✅ Sent 🥔 reaction to message
# 🎯 Sent reaction 🥔 to message from +1234567890
```

### Lesson

✅ **ES modules don't have `__dirname`** - use `process.cwd()` or absolute paths
✅ **Always verify JSON-RPC parameter names** against signal-cli documentation
✅ **Dockerfile COPY commands are explicit** - directories won't be included automatically
✅ **Test with actual Signal messages** - logs can confirm reactions sent
✅ **signal-cli reactions use timestamp of target message** - must pass original message timestamp
✅ **Config-driven features are maintainable** - users can add new reactions without code changes

**Parameter Name Patterns in signal-cli**:
- `targetTimestamp` - NOT `targetSentTimestamp`
- `targetAuthor` - Phone number or UUID of message author
- `emoji` - Unicode emoji character
- `groupId` - Optional, for group messages
- `recipient` - Optional, for direct messages

**Deployment Checklist for Config-Based Features**:
1. ✅ Create config file in `container/config/`
2. ✅ Add `COPY config ./config` to Dockerfile
3. ✅ Use production-appropriate paths in code
4. ✅ Verify config file exists in running container
5. ✅ Test feature with actual data

**Files**:
- `container/config/emoji-reactions.json` - Configuration
- `container/src/utils/emoji-reaction-handler.ts` - Handler logic
- `container/src/bot/signal-jsonrpc-client.ts` - JSON-RPC sendReaction method
- `container/src/bot/signal-bot-v2.ts` - Bot integration (lines 461-491)
- `container/Dockerfile` - Config directory copy (line 71)

---

## Signal Mention Name Resolution (2025-11-27)

### Problem: Mentions Show UUIDs Instead of Names

**Symptoms**:
```
!cast @Austyn @Jennifer Allen Kay
→ 🥇 User-4a4b6530
   🥈 User-f828a84d
```

Users see shortened UUIDs like `User-4a4b6530` instead of actual names like "Austyn" or "Jennifer Allen Kay".

**User Complaint**:
> "the mention isn't working ! . needs to be human readiable"

### Root Cause Investigation

**Signal CLI Logs Show Names**:
```
Signal CLI: - "Austyn" 4a4b6530-627a-4b52-b6f8-7ed38fcbeecb: 6 (length: 1)
Signal CLI: - "N" f828a84d-2278-498a-acb4-d2cb0707d607: 8 (length: 1)
```

**But JSON-RPC Mentions Don't Include Names**:
```typescript
interface Mention {
  start: number;    // Position in message text
  length: number;   // Length of mention
  uuid?: string;    // User's Signal UUID ✅
  number?: string;  // User's phone number ✅
  name?: string;    // ❌ NOT PROVIDED by JSON-RPC!
}
```

**Message Text Contains Unicode Placeholders**:
```typescript
// User types: !cast @Austyn @Jennifer
// Message text received: !cast ￼ ￼
// ￼ = U+FFFC (Unicode Object Replacement Character)
```

Signal replaces mentions with special Unicode placeholder characters (￼) in the message text. The `start` and `length` fields in mentions point to these placeholders, not to actual names.

**Conclusion**: Signal CLI daemon KNOWS the names (shows them in logs) but doesn't pass them through JSON-RPC.

### Discovery: Signal CLI's SQLite Database

Signal CLI stores all contact information in a local SQLite database:

**Location**: `/app/signal-data/data/813876.d/account.db`

**Key Table**: `recipient`

**Schema**:
```sql
CREATE TABLE recipient (
  _id INTEGER PRIMARY KEY AUTOINCREMENT,
  aci TEXT UNIQUE,              -- Signal UUID (Address Communication Identifier)
  pni TEXT UNIQUE,              -- Phone Number Identifier
  number TEXT UNIQUE,           -- E.164 phone number
  username TEXT UNIQUE,         -- Signal username

  -- Contact names (manually added)
  given_name TEXT,
  family_name TEXT,
  nick_name TEXT,

  -- Signal profile names (from user's profile)
  profile_given_name TEXT,
  profile_family_name TEXT,
  profile_about TEXT,
  profile_about_emoji TEXT,
  profile_avatar_url_path TEXT,

  -- Other fields...
) STRICT;
```

**Sample Query**:
```bash
docker exec signal-bot-selfhosted sqlite3 /app/signal-data/data/813876.d/account.db \
  "SELECT aci, number, profile_given_name, profile_family_name
   FROM recipient
   WHERE aci IS NOT NULL
   LIMIT 5"

# Output:
770b19f5-389e-444e-8976-551a52136cf6|+12247253276|Sac|
4a4b6530-627a-4b52-b6f8-7ed38fcbeecb||Austyn|
8dabe77c-006a-4aed-8839-22dd09c5b0d1||Kristen|Hansmann
f828a84d-2278-498a-acb4-d2cb0707d607||N|
```

This database contains **2,486 contacts** with their Signal profile names!

### Solution: Import Signal CLI Database to PostgreSQL

**Step 1: Export Contact Data from Signal CLI Database**

```bash
# Copy Signal CLI database to host
docker cp signal-bot-selfhosted:/app/signal-data/data/813876.d/account.db /tmp/signal-account.db

# Extract contacts to CSV
sqlite3 -csv /tmp/signal-account.db "
  SELECT
    COALESCE(aci, pni) as uuid,
    number as phone_number,
    COALESCE(
      profile_given_name || ' ' || profile_family_name,
      profile_given_name,
      given_name || ' ' || family_name,
      given_name,
      'Unknown'
    ) as display_name,
    profile_given_name,
    given_name,
    family_name
  FROM recipient
  WHERE aci IS NOT NULL OR pni IS NOT NULL
" > /tmp/contacts.csv
```

**Step 2: Import into PostgreSQL**

```bash
# Generate INSERT statements
sqlite3 /tmp/signal-account.db "
  SELECT
    'INSERT INTO signal_members (id, uuid, phone_number, display_name, profile_name, first_name, last_name, is_bot, created_at, updated_at) VALUES (' ||
    quote(COALESCE(aci, pni)) || ', ' ||
    quote(COALESCE(aci, pni)) || ', ' ||
    quote(number) || ', ' ||
    quote(COALESCE(profile_given_name || ' ' || profile_family_name, profile_given_name, given_name)) || ', ' ||
    quote(profile_given_name) || ', ' ||
    quote(given_name) || ', ' ||
    quote(family_name) || ', ' ||
    'false, NOW(), NOW()) ON CONFLICT (uuid) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW();'
  FROM recipient
  WHERE (aci IS NOT NULL OR pni IS NOT NULL)
" | docker exec -i signal-bot-postgres psql -U signal_bot -d signal_bot

# Verify import
docker exec signal-bot-postgres psql -U signal_bot -d signal_bot \
  -c "SELECT COUNT(*) FROM signal_members"
# Result: 2486 contacts imported
```

**Step 3: Update Code to Use Database Lookups**

```typescript
// container/src/bot/command-handler.ts
for (const mention of context.mentions) {
  let userName = 'Unknown';

  // Try database lookup first if available
  if (this.dbClient && mention.uuid) {
    try {
      const memberInfo = await this.dbClient.query(
        'SELECT display_name, profile_name, first_name, last_name, phone_number FROM signal_members WHERE uuid = $1 LIMIT 1',
        [mention.uuid]
      );
      if (memberInfo.results && memberInfo.results.length > 0) {
        const row = memberInfo.results[0];
        userName = row.display_name || row.profile_name ||
                  (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name) ||
                  row.phone_number || userName;
      }
    } catch (error) {
      console.log('Could not look up member name:', error);
    }
  }

  // Fallback: Use phone number if available
  if (userName === 'Unknown' && mention.number) {
    userName = mention.number;
  }

  // Final fallback: Shortened UUID
  if (userName === 'Unknown' && mention.uuid) {
    userName = `User-${mention.uuid.substring(0, 8)}`;
  }
}
```

**PostgreSQL Table Structure**:
```sql
-- Check signal_members schema
\d signal_members

-- Key columns:
uuid TEXT UNIQUE NOT NULL           -- Maps to Signal CLI 'aci'
phone_number TEXT                   -- Maps to Signal CLI 'number'
display_name TEXT                   -- Combined name for display
profile_name TEXT                   -- Signal profile given name
first_name TEXT                     -- Contact given name
last_name TEXT                      -- Contact family name
```

### Testing & Verification

**Before Fix**:
```
!cast @Austyn @Jennifer Allen Kay
→ 🥇 User-4a4b6530
   Rolls: ⚄
   Total: 5

   🥈 User-f828a84d
   Rolls: ⚀
   Total: 1
```

**After Fix**:
```
!cast 7 @Jessica Dawson
→ 🥇 JD
   Rolls: ⚅ ⚄ ⚁ ⚂ ⚅ ⚄ ⚃
   Total: 31

   🥈 Sac
   Rolls: ⚁ ⚀ ⚀ ⚁ ⚂ ⚃ ⚅
   Total: 19
```

**Database Verification**:
```sql
-- Check specific UUIDs from user tests
SELECT uuid, display_name, phone_number
FROM signal_members
WHERE uuid IN (
  '4a4b6530-627a-4b52-b6f8-7ed38fcbeecb',  -- Austyn
  'f828a84d-2278-498a-acb4-d2cb0707d607'   -- N
);

-- Results:
uuid                                 | display_name | phone_number
-------------------------------------|--------------|-------------
4a4b6530-627a-4b52-b6f8-7ed38fcbeecb | Austyn       |
f828a84d-2278-498a-acb4-d2cb0707d607 | N            |
```

### Additional Feature: Include Command Sender

The user also requested that the command initiator be included in dice rolls:

**Implementation**:
```typescript
// Always include the sender/initiator
let senderName = context.sourceName || 'You';
if (this.dbClient && context.sourceNumber) {
  try {
    const senderInfo = await this.dbClient.query(
      'SELECT display_name, profile_name, first_name, last_name, phone_number FROM signal_members WHERE phone_number = $1 OR uuid = $1 LIMIT 1',
      [context.sourceNumber]
    );
    if (senderInfo.results && senderInfo.results.length > 0) {
      const row = senderInfo.results[0];
      senderName = row.display_name || row.profile_name ||
                  (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name) ||
                  row.phone_number || senderName;
    }
  } catch (error) {
    console.log('Could not look up sender name:', error);
  }
}

// Roll for the sender first
const senderRolls: number[] = [];
let senderTotal = 0;
for (let i = 0; i < numDice; i++) {
  const roll = Math.floor(Math.random() * 6) + 1;
  senderRolls.push(roll);
  senderTotal += roll;
}
results.push({
  name: senderName,
  uuid: context.sourceNumber || '',
  rolls: senderRolls,
  total: senderTotal
});

// Then roll for each mentioned user...
```

### Lesson

✅ **Signal CLI JSON-RPC omits names from mentions** - only provides UUIDs
✅ **Signal CLI logs show names** - daemon has the data but doesn't expose it
✅ **Signal CLI stores contacts in SQLite** - `account.db` contains all profile data
✅ **Direct database access is the solution** - extract from SQLite, import to PostgreSQL
✅ **Profile names are most reliable** - `profile_given_name` available for most users
✅ **Context needs message text** - but message has Unicode placeholders, not names
✅ **Database import is one-time** - 2,486 contacts imported successfully
✅ **UUIDs are the key** - map mentions to signal_members by UUID

**Why This Pattern Exists**:
- Signal prioritizes privacy - mentions are cryptographic identifiers (UUIDs)
- Names come from Signal profiles, not guaranteed to be present
- Signal CLI daemon caches profile data locally for performance
- JSON-RPC is designed for automation, not human-readable display

**Alternative Approaches Considered**:

1. ❌ **Parse from message text**: Message contains Unicode placeholders (￼), not names
2. ❌ **Use signal-cli listContacts**: Requires stopping daemon (config file locking)
3. ❌ **Rely on mention.number**: Only 84 of 2,486 contacts have phone numbers
4. ✅ **Direct SQLite access**: Complete, accurate, and performant

**Maintenance**:

To keep names up-to-date, periodically re-import from Signal CLI database:

```bash
# Create a sync script
cat > /tmp/sync-contacts.sh << 'EOF'
#!/bin/bash
docker cp signal-bot-selfhosted:/app/signal-data/data/813876.d/account.db /tmp/signal-account.db
sqlite3 /tmp/signal-account.db "[INSERT query]" | \
  docker exec -i signal-bot-postgres psql -U signal_bot -d signal_bot
EOF

# Run monthly via cron
0 0 1 * * /tmp/sync-contacts.sh
```

**Files**:
- `container/src/bot/command-handler.ts:1609-1682` - Mention name resolution with database lookups
- `/app/signal-data/data/813876.d/account.db` - Signal CLI SQLite database
- PostgreSQL table: `signal_members` - Imported contact data

---

## Signal CLI Admin Detection Bug (2025-12-01)

### Problem: Bot Not Showing as Admin in !groups

**Symptoms**:
```
!groups
→ 1. IrregularChat: Tech 👤
     Members: 920
```

All groups showed `👤` (regular member) instead of `👑` (admin) even when the bot IS an admin.

### Root Cause: Wrong Assumption About Admin Array Format

**The Bug**:
The code assumed `group.admins` was an array of objects:
```typescript
// ❌ WRONG - This was the assumption
interface Admin {
  number: string;   // Phone number
  uuid: string;     // UUID
}
admins: Admin[]
```

**Actual Format from signal-cli JSON-RPC**:
```typescript
// ✅ CORRECT - admins is an array of UUID strings
admins: string[]  // ["922faebe-03bd-4cee-85a7-6b62ab446e45", ...]
```

**The Broken Code** (in `command-handler.ts` and `signal-bot-v2.ts`):
```typescript
// ❌ This never matched because admin is a string, not an object
const botIsAdmin = group.admins?.some((admin: any) =>
  admin.number === this.config.phoneNumber
) || false;
```

### Solution: Check UUID Strings and Look Up Bot's UUID

**Step 1: Bot's UUID from Database**
```sql
SELECT uuid FROM signal_members WHERE phone_number = '+19108471202';
-- Result: 922faebe-03bd-4cee-85a7-6b62ab446e45
```

**Step 2: Fixed Admin Check**
```typescript
// ✅ CORRECT - Handle both string UUIDs and legacy object format
private isBotAdmin(group: any): boolean {
  if (!group.admins || !Array.isArray(group.admins)) {
    return false;
  }

  return group.admins.some((admin: any) => {
    // Case 1: admin is a string (UUID) - actual format from signal-cli
    if (typeof admin === 'string') {
      return (this.botUuid && admin === this.botUuid) ||
             admin === this.config.phoneNumber;
    }
    // Case 2: admin is an object (legacy/fallback)
    if (admin && typeof admin === 'object') {
      if (admin.number === this.config.phoneNumber) return true;
      if (this.botUuid && admin.uuid === this.botUuid) return true;
    }
    return false;
  });
}
```

**Step 3: Cache Bot UUID on First Use**
```typescript
// Look up bot's UUID from database if not cached
if (!this.botUuid && this.dbClient) {
  const result = await this.dbClient.query(
    'SELECT uuid FROM signal_members WHERE phone_number = $1 LIMIT 1',
    [this.config.phoneNumber]
  );
  if (result.results && result.results.length > 0) {
    this.botUuid = result.results[0].uuid;
    console.log(`🤖 Bot UUID resolved: ${this.botUuid}`);
  }
}
```

### Testing & Verification

**Before Fix**:
```
!groups
→ 1. IrregularChat: Tech 👤
   ✅ Bot can add users to 0 group(s)
```

**After Fix**:
```
!groups
→ 1. IrregularChat: Tech 👑
   ✅ Bot can add users to 15 group(s)
```

### Key Takeaways

✅ **signal-cli returns admins as UUID strings** - NOT objects with number/uuid fields
✅ **Interface types can be wrong** - `ListGroupsResult.admins: string[]` was correct, but implementation assumed objects
✅ **Always log the actual data structure** - Debug logs showed `typeof group.admins[0]` was string
✅ **Bot UUID must be looked up from database** - Phone number won't match UUID strings
✅ **Check both formats** - Support legacy object format as fallback

**Debugging Pattern**:
```typescript
console.log(`First admin (type: ${typeof group.admins[0]}): ${JSON.stringify(group.admins[0])}`);
// Output: First admin (type: string): "922faebe-03bd-4cee-85a7-6b62ab446e45"
```

**Files Changed**:
- `container/src/bot/command-handler.ts` - `isBotAdmin()` and `isBotAdminAsync()` functions
- `container/src/bot/signal-bot-v2.ts` - `saveGroupsToDatabase()` function

---

## Wiki Search Git Dependency (2025-12-02)

### Problem: !ws and !wa Commands Return No Results

**Symptoms**:
```
!ws certification
→ 🔍 Wiki Search: "certification"
  ❌ No results found

!wa certification funding
→ 🤖 WikiAsk: "certification funding"
  📚 No wiki articles found for context
```

But the wiki website at irregularpedia.org shows results when searching for "certification".

### Root Cause: Git Not Installed in Docker Container

**Investigation**:
```bash
# Check if git exists in container
docker exec signal-bot-selfhosted which git
# Result: Git not found

# Check apt installed packages
docker exec signal-bot-selfhosted apt list --installed 2>/dev/null | grep git
# Result: Only libraries with "git" in version string, not git itself
```

**Why Git is Required**:
The wiki search utility (`src/utils/wiki-search.ts`) uses `git grep` to search through a bare git repository:

```typescript
// wiki-search.ts
async searchWiki(query: string): Promise<WikiSearchResult[]> {
  // Uses git grep to search the bare repo
  const result = await execAsync(
    `GIT_DIR=${this.repoPath} git grep -i -l "${escapedQuery}" HEAD -- docs/`
  );
  // ...
}
```

**The Dockerfile DID have git**:
```dockerfile
# Line 33 in Dockerfile
RUN apt-get update && apt-get install -y \
    curl wget apt-transport-https gnupg sqlite3 ffmpeg python3 python3-pip git \
    ...
```

**But the running container was built from an older Dockerfile** that didn't include git.

### Solution: Rebuild Docker Image

**Step 1: Verify Dockerfile has git** (it did):
```dockerfile
RUN apt-get update && apt-get install -y \
    curl wget apt-transport-https gnupg sqlite3 ffmpeg python3 python3-pip git \
```

**Step 2: Force rebuild with --no-cache**:
```bash
cd /home/signal-bot-selfhosted
docker compose build --no-cache signal-bot
docker compose up -d signal-bot --force-recreate
```

**Step 3: Verify git is now installed**:
```bash
docker exec signal-bot-selfhosted which git
# Result: /usr/bin/git

docker exec signal-bot-selfhosted git --version
# Result: git version 2.39.5
```

**Step 4: Verify wiki search works**:
```bash
docker exec signal-bot-selfhosted bash -c "GIT_DIR=/app/wiki-repo git grep -i -l certification HEAD -- docs/ | head -5"
# Result:
# HEAD:docs/ai-ml/main-page.md
# HEAD:docs/community/2026-recommendations.md
# HEAD:docs/community/community-reading-list.md
# ...
```

### Wiki Repository Mount Configuration

The wiki-repo must be properly mounted in docker-compose.yml:

```yaml
signal-bot:
  volumes:
    - /home/forgejo/data/git/repositories/irregulars/irregularchatwiki.git:/app/wiki-repo:ro
```

**Important Notes**:
- The wiki repo is a **bare git repository** (`.git` directory structure)
- Mount as read-only (`:ro`) since the bot only searches, never writes
- The path must match the Forgejo/Gitea repository location

### Testing Wiki Search

**Test Commands**:
```bash
# List files in wiki repo
docker exec signal-bot-selfhosted bash -c "GIT_DIR=/app/wiki-repo git ls-tree --name-only -r HEAD | grep docs/ | head -10"

# Search for specific term
docker exec signal-bot-selfhosted bash -c "GIT_DIR=/app/wiki-repo git grep -i -l 'certification' HEAD -- docs/"

# Get content from specific file
docker exec signal-bot-selfhosted bash -c "GIT_DIR=/app/wiki-repo git show HEAD:docs/community/community-recommended-pathways.md | head -50"
```

### Lesson

✅ **Docker images must be rebuilt** when Dockerfile dependencies change
✅ **`docker compose restart` is NOT enough** - use `--force-recreate` or `build --no-cache`
✅ **Verify system dependencies in running container** - not just in Dockerfile
✅ **Wiki search requires git** - uses `git grep` on bare repository
✅ **Bare repos need GIT_DIR environment** - `GIT_DIR=/path/to/repo.git git <command>`
✅ **Old containers may use cached images** - always rebuild after Dockerfile changes

**Detection Steps**:
1. `!ws <term>` returns no results
2. Check if wiki site shows results for same term
3. SSH into container and check if git exists
4. If git missing, rebuild Docker image

**Quick Fix Commands**:
```bash
# Rebuild and restart
cd /home/signal-bot-selfhosted
docker compose build --no-cache signal-bot
docker compose up -d signal-bot --force-recreate

# Verify
docker exec signal-bot-selfhosted git --version
```

**Files**:
- `container/Dockerfile` - Must include `git` in apt-get install
- `docker-compose.yml` - Must mount wiki-repo volume
- `container/src/utils/wiki-search.ts` - Uses git grep for search

---

## Signal Attachment Handling for !tldr Command (2025-12-03)

### Problem: Summarizing PDF Attachments from Quoted Messages

**User Request**:
Reply to a message containing a PDF attachment with `!tldr` to get a summary of the PDF content.

**Challenge**:
Signal attachments in quoted messages don't include the attachment file ID or storage path - only metadata like `contentType` and `filename`.

### Discovery: Quote Attachments Have Limited Metadata

**What signal-cli JSON-RPC Returns**:
```json
{
  "dataMessage": {
    "quote": {
      "id": 1764733463840,
      "author": "17b25619-f1ba-4c37-8a5a-50e139586191",
      "text": "",
      "attachments": [
        {
          "contentType": "application/pdf",
          "filename": "Drone Dominance RFI.pdf"
        }
      ]
    }
  }
}
```

**Missing Fields**:
- ❌ `id` - The attachment storage ID
- ❌ `storedFilename` - Where signal-cli saved the file
- ❌ `size` - File size in bytes

**Available Fields**:
- ✅ `contentType` - MIME type (e.g., "application/pdf")
- ✅ `filename` - Original filename

### Where Signal-CLI Stores Attachments

**Location**: `/app/signal-data/attachments/`

**Filename Pattern**: Random alphanumeric ID + file extension

**Example Files**:
```bash
docker exec signal-bot-selfhosted ls -lat /app/signal-data/attachments/ | grep pdf | head -5
# akU08iutNUIMuhcRMSS2.pdf  (493 kB)
# eJLasHFkNqmDUl_yLaYy.pdf  (1.3 MB)
# rHUdjEmxJ_soi__Uz04J.pdf  (6.5 MB)
```

### Solution: Search for Recent PDFs

Since quoted attachments don't include the file path, the solution is to search the attachments directory for recent PDF files:

**Implementation** (`command-handler.ts`):
```typescript
// Check for PDF attachments in quoted message
const pdfAttachment = context.quotedAttachments?.find(att =>
  att.contentType === 'application/pdf' ||
  att.filename?.toLowerCase().endsWith('.pdf')
);

if (pdfAttachment && (!remainingArgs || remainingArgs.length === 0)) {
  const dataDir = this.config.dataDir || '/app/signal-data';
  const attachmentsDir = `${dataDir}/attachments`;
  const fs = await import('fs/promises');

  let pdfPath: string | null = null;
  let pdfResult: any = { success: false };

  // If we have an attachment ID, try that first
  const attachmentId = pdfAttachment.id || pdfAttachment.storedFilename;
  if (attachmentId) {
    // Try direct path with/without .pdf extension
    for (const path of [`${attachmentsDir}/${attachmentId}`, `${attachmentsDir}/${attachmentId}.pdf`]) {
      const result = await scrapePdfFromPath(path, pdfAttachment.filename);
      if (result.success) {
        pdfPath = path;
        pdfResult = result;
        break;
      }
    }
  }

  // If no ID or direct path failed, search for recent PDF files
  if (!pdfResult.success) {
    const files = await fs.readdir(attachmentsDir);
    const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));

    // Get file stats and sort by modification time (newest first)
    const fileStats = await Promise.all(
      pdfFiles.map(async (f) => {
        const fullPath = `${attachmentsDir}/${f}`;
        const stat = await fs.stat(fullPath);
        return { name: f, path: fullPath, mtime: stat.mtime };
      })
    );

    fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // Try the most recent PDF files (up to 5)
    for (const file of fileStats.slice(0, 5)) {
      const result = await scrapePdfFromPath(file.path, pdfAttachment.filename);
      if (result.success) {
        pdfPath = file.path;
        pdfResult = result;
        break;
      }
    }
  }

  // Summarize the PDF content...
}
```

### Key Implementation Details

**1. Add SignalAttachment Interface** (`command-handler.ts`):
```typescript
export interface SignalAttachment {
  contentType?: string;
  filename?: string;
  id?: string;
  storedFilename?: string;
  size?: number;
  width?: number;
  height?: number;
  caption?: string;
}

export interface CommandContext {
  // ... existing fields
  quotedAttachments?: SignalAttachment[]; // Attachments from quoted message
}
```

**2. Pass Attachments from Bot** (`signal-bot-v2.ts`):
```typescript
// In handleMessage()
const quotedAttachments = dataMessage?.quote?.attachments;

// In handleCommand()
await this.handleCommand(messageText, {
  // ... other context
  quotedAttachments,
});
```

**3. Add Local PDF Scraper** (`pdf-scraper.ts`):
```typescript
export async function scrapePdfFromPath(
  filePath: string,
  originalFilename?: string
): Promise<PDFScrapedContent> {
  const buffer = await fs.readFile(filePath);
  const data = await pdf(buffer);
  // Extract text, apply smart extraction for large PDFs...
}
```

### Testing & Verification

**Test Scenario**:
1. User posts a PDF file in Signal group
2. Another user replies with `!tldr`
3. Bot reads the PDF from attachments directory
4. Bot summarizes with GPT-4o-mini
5. Bot posts summary back to group

**Log Output (Working)**:
```
📎 Found PDF attachment in quoted message: {"contentType":"application/pdf","filename":"Drone Dominance RFI.pdf"}
📂 Searching attachments directory for recent PDFs...
📂 Found 15 PDF files, checking most recent...
📄 Trying recent PDF: akU08iutNUIMuhcRMSS2.pdf (modified: 2025-12-03T03:44:00.000Z)
📄 Reading local PDF: /app/signal-data/attachments/akU08iutNUIMuhcRMSS2.pdf
📄 PDF parsed: 6 pages, 12543 chars
✅ PDF processed: 12543 chars (full extraction)
```

**Response Format**:
```
📄 **Drone Dominance RFI.pdf**
6 pages • full extraction

📝 **Summary:**
The document outlines a Request for Information (RFI) regarding drone technology...
```

### Limitations

1. **Recent Files Only**: Searches the 5 most recently modified PDFs, may not find older attachments
2. **No Filename Matching**: Can't verify the PDF filename matches the quoted attachment
3. **Quote Metadata Limited**: Signal doesn't provide attachment IDs in quotes

### Potential Improvements

**Option 1: Track Attachments in Database**
```sql
CREATE TABLE signal_attachments (
  id TEXT PRIMARY KEY,           -- signal-cli generated ID
  message_timestamp BIGINT,      -- Original message timestamp
  filename TEXT,                 -- Original filename
  content_type TEXT,             -- MIME type
  file_path TEXT,                -- Local storage path
  created_at TIMESTAMP
);
```

When messages with attachments are received, store the mapping. Then lookup by quote timestamp.

**Option 2: Use Quote ID to Find Original Message**
The quote includes `id` (timestamp of original message). Could search database for message at that timestamp to find attachment info.

### Lesson

✅ **Quote attachments have limited metadata** - no file ID or path
✅ **Signal-cli stores attachments by random ID** - not by original filename
✅ **Searching recent files works** - most users quote recent messages
✅ **PDF parsing with pdf-parse** - works well for text extraction
✅ **Smart extraction for large PDFs** - TOC, chapters, conclusion
✅ **Container rebuild required** - when adding new fs imports

**Debugging Commands**:
```bash
# Check attachments directory
docker exec signal-bot-selfhosted ls -lat /app/signal-data/attachments/ | head -20

# Find recent PDFs
docker exec signal-bot-selfhosted ls -lat /app/signal-data/attachments/ | grep pdf | head -10

# Check if pdf-parse can read a file
docker exec signal-bot-selfhosted node -e "
  const pdf = require('pdf-parse');
  const fs = require('fs');
  const data = fs.readFileSync('/app/signal-data/attachments/akU08iutNUIMuhcRMSS2.pdf');
  pdf(data).then(r => console.log('Pages:', r.numpages, 'Chars:', r.text.length));
"
```

**Files**:
- `container/src/bot/command-handler.ts:51-79` - SignalAttachment interface
- `container/src/bot/command-handler.ts:1540-1665` - PDF attachment handling in handleSummarize
- `container/src/bot/signal-bot-v2.ts:521-586` - quotedAttachments extraction and passing
- `container/src/utils/pdf-scraper.ts:294-411` - scrapePdfFromPath function

---

**Document Status**: ✅ Complete
**Review Date**: 2025-12-03
**Next Review**: 2026-01-01

---

## CRITICAL: rsync --delete Data Loss (2025-12-03)

### The Incident

**What Happened:**
A catastrophic data loss occurred when `rsync -avz --delete` was used with the WRONG destination path.

**Command Used (WRONG):**
```bash
rsync -avz --delete container/ root@proxmox-main:/home/signal-bot-selfhosted/
```

**Correct Path Should Have Been:**
```bash
rsync -avz --delete container/ root@proxmox-main:/home/signal-bot-selfhosted/bot/
```

### Impact

The `--delete` flag caused rsync to DELETE all files in the destination that weren't in the source:

- ❌ `docker-compose.yml` - DELETED (production configuration)
- ❌ `.env` - DELETED (credentials, API keys)
- ❌ `data/signal-data/data/813876.d/account.db` - DELETED (Signal registration - CRITICAL)
- ❌ All persistent data directories - DELETED

**Result:** Signal CLI account was permanently lost. The account.db file contains Signal's device registration, encryption keys, and group memberships. Without it, the bot cannot authenticate with Signal servers.

### Successful Recovery

**Local Backup Found!**

1. Found LOCAL backup at `/Users/sac/Git/chat-based-community-dashboard/modern-stack/signal-data/`
2. Backup was from September 11, 2025 - complete and valid!
3. Contained full account.db with all 45 tables (recipients, sessions, groups, etc.)
4. **Successfully restored with rsync (without --delete):**
   ```bash
   rsync -avz /Users/sac/Git/chat-based-community-dashboard/modern-stack/signal-data/ \
     root@proxmox-main:/home/signal-bot-selfhosted/data/signal-data/
   ```
5. Bot restarted and is working: 27 groups, 5427 membership records

**Backup Locations (Priority Order):**
1. **Local dev machine**: `modern-stack/signal-data/` (most likely to have recent data)
2. **R2 Cloud**: Bot auto-syncs on startup/shutdown
3. **Server backups**: `/home/signal-bot-selfhosted/data/backups/`

### Root Cause

The deploy script (`deploy-selfhosted.sh`) correctly specifies:
```bash
REMOTE_PATH="/home/signal-bot-selfhosted/bot"
```

But manual rsync commands without checking the script used the wrong path.

### Prevention

**ALWAYS:**

1. **Use the deploy script** - It has the correct paths
   ```bash
   ./deploy-selfhosted.sh
   ```

2. **If you must rsync manually, ALWAYS use --dry-run first:**
   ```bash
   rsync -avz --dry-run --delete container/ root@proxmox-main:/home/signal-bot-selfhosted/bot/
   ```

3. **Check for "deleting" lines in --dry-run output** - If you see critical files like `docker-compose.yml` or `data/` being deleted, STOP

4. **NEVER use --delete when syncing to a parent directory** that contains other important files

5. **Backup critical data BEFORE any rsync --delete:**
   ```bash
   ssh root@proxmox-main "tar -czvf /tmp/signal-bot-backup-$(date +%Y%m%d).tar.gz /home/signal-bot-selfhosted/data/signal-data/"
   ```

### Lesson

✅ **ALWAYS verify the destination path matches the deploy script**
✅ **ALWAYS use --dry-run before --delete**
✅ **NEVER assume the destination path - check first**
✅ **Backup Signal data regularly - it's irreplaceable**
✅ **Prefer deploy scripts over manual commands**

**Files**: 
- `deploy-selfhosted.sh` (lines 18-19 show correct path)
- `CLAUDE.md` (updated with rsync warning)


---

## VPN/Gluetun Container Management (2025-12-03)

### Problem

The Signal bot uses `network_mode: "service:vpn"` to route all traffic through a Mullvad VPN container (gluetun). This provides IP privacy but introduces several failure modes:

**Common Symptoms:**
- `container for service "vpn" is unhealthy` during deploy
- `Error: connect ECONNREFUSED` to database/redis
- `curl: (6) Could not resolve host` - DNS resolution fails
- `curl: (60) SSL certificate problem` - SSL verification fails through VPN
- Signal CLI: `Connection terminated unexpectedly`

**Root Causes:**
1. VPN connection drops or tunnel fails
2. Mullvad WireGuard server becomes unavailable
3. DNS resolution through Mullvad DNS (10.64.0.1) fails
4. Container IP addresses change after network recreation

### Solution

**Manual VPN Restart:**
```bash
# Check VPN status
docker logs --tail 50 signal-bot-vpn

# Restart VPN and wait for healthy
docker compose restart vpn
sleep 30

# Verify connectivity
docker exec signal-bot-selfhosted curl -s https://api.ipify.org
# Should return VPN IP (e.g., 143.244.47.75)

# Then restart the bot
docker compose up -d signal-bot
```

**Automated VPN Health Check (in deploy script):**
```bash
# Check if VPN is healthy before deploying
VPN_HEALTH=$(docker inspect signal-bot-vpn --format='{{.State.Health.Status}}' 2>/dev/null || echo "none")
if [ "$VPN_HEALTH" != "healthy" ]; then
    echo "⚠️  VPN unhealthy, restarting..."
    docker compose restart vpn
    sleep 30
fi
```

**Docker Compose VPN Configuration:**
```yaml
vpn:
  image: qmcgaw/gluetun:latest
  cap_add:
    - NET_ADMIN
  devices:
    - /dev/net/tun:/dev/net/tun
  environment:
    VPN_SERVICE_PROVIDER: mullvad
    VPN_TYPE: wireguard
    WIREGUARD_PRIVATE_KEY: <key>
    # ... other WireGuard settings
  healthcheck:
    test: ["CMD", "ping", "-c", "1", "1.1.1.1"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 30s

signal-bot:
  network_mode: "service:vpn"  # Routes ALL traffic through VPN
  depends_on:
    vpn:
      condition: service_healthy  # Won't start until VPN healthy
```

### Key Points

1. **Bot uses VPN's network stack** - The signal-bot container has NO direct network access
2. **DNS goes through Mullvad** - Uses 10.64.0.1 instead of system DNS
3. **IP addresses are dynamic** - Container IPs change on network recreation
4. **VPN must be healthy first** - Always ensure VPN is up before starting bot

### Lesson

✅ **Always check VPN health before deploying**
✅ **Restart VPN if DNS or connectivity fails**
✅ **Wait 30+ seconds after VPN restart for connection to stabilize**
✅ **Use `depends_on: condition: service_healthy`** in docker-compose
✅ **Monitor VPN logs for WireGuard timeout errors**

**Files**: `docker-compose.yml`, `deploy-selfhosted.sh`

---

## Docker Network IP Address Changes (2025-12-03)

### Problem

After `docker compose down && docker compose up -d`, container IP addresses change. The signal-bot uses hardcoded IPs to reach postgres/redis (because `network_mode: service:vpn` prevents DNS resolution of container names).

**Error Example:**
```
Error: connect ECONNREFUSED 172.24.0.2:5432
```

**What Happened:**
- Before restart: postgres at 172.24.0.2
- After restart: VPN got 172.24.0.2, postgres moved to 172.24.0.3

### Solution

**Check Current IPs:**
```bash
docker network inspect signal-bot-selfhosted_signal-bot-network | grep -E '(Name|IPv4)'
```

**Update docker-compose.yml with new IPs:**
```bash
# Current layout (as of 2025-12-03):
# - VPN: 172.24.0.2
# - Postgres: 172.24.0.3
# - Redis: 172.24.0.4

# Update the environment variables in docker-compose.yml:
DB_HOST: 172.24.0.3     # Was 172.24.0.2
REDIS_HOST: 172.24.0.4
REDIS_URL: redis://172.24.0.4:6379
```

**Better Long-term Fix (TODO):**
Use static IPs in docker-compose.yml:
```yaml
networks:
  signal-bot-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.24.0.0/16

services:
  vpn:
    networks:
      signal-bot-network:
        ipv4_address: 172.24.0.2
  postgres:
    networks:
      signal-bot-network:
        ipv4_address: 172.24.0.3
  redis:
    networks:
      signal-bot-network:
        ipv4_address: 172.24.0.4
```

### Lesson

✅ **Check container IPs after any `docker compose down/up`**
✅ **Update docker-compose.yml if IPs changed**
✅ **Consider using static IP assignments for reliability**
✅ **VPN container always gets first available IP**

**Files**: `docker-compose.yml`

---

## Phone Number Privacy in Display Names (2025-12-04)

### Problem

The bot was exposing users' phone numbers in group chat messages when displaying their names. This happened because the code used phone numbers as fallback values when database lookups didn't return a proper display name.

**Example of Leaked Phone Number:**
```
🔒 +12247253276 holds ❌ FADE 20 pts
```

**Root Cause:**
Multiple places in `command-handler.ts` had fallback chains that included phone numbers:
```typescript
// WRONG - Phone number was in the fallback chain
playerName = row.display_name || row.profile_name ||
            (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name) ||
            row.phone_number || playerName;  // <-- Privacy leak!
```

### Solution

**Remove all phone number fallbacks from display name chains:**

1. **Dice game player names** (line ~5100):
```typescript
// CORRECT - Never use phone_number as name
playerName = row.display_name || row.profile_name ||
            (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name) ||
            playerName;
```

2. **!cast command** (lines ~3177, ~3217):
   - Removed phone number from database lookup fallback
   - Removed entire phone number formatting fallback block
   - Falls back to `User-{shortUUID}` instead

3. **!remove command** (line ~4173):
   - Default to "a member" instead of raw identifier
   - Only show actual display names if found

**Privacy-Safe Fallback Hierarchy:**
```
1. display_name (from database)
2. profile_name (from database)
3. first_name + last_name (from database)
4. "Player-{4 chars of UUID}" (safe anonymized fallback)
5. "a member" (for public messages about users)
```

### Lesson

✅ **NEVER use phone numbers in fallback chains for display names**
✅ **Always use anonymized identifiers** (short UUID, "a member") as final fallback
✅ **Phone numbers are okay for internal logging** (console.log) but never for group messages
✅ **Review all user-facing messages** to ensure no identifiers can leak

**Files**: `container/src/bot/command-handler.ts`

---

## pCloud Download Links Are IP-Bound (2025-12-04)

### Problem

**Symptom**: pCloud file search results returned links that led to "dead pages" or "HTTP 410 Gone" errors.

**Initial Investigation**:
```bash
# Fresh API call from server - returns 200 OK
curl -sI "https://def1.pcloud.com/[fresh-path]/file.pdf"
# HTTP/1.1 200 OK

# Same URL from user's browser - returns 410 Gone
# HTTP/1.1 410 Gone
```

**Root Cause**: pCloud's `getpublinkdownload` API generates **temporary IP-bound download URLs** that:
1. Are valid only for the IP that generated them
2. Expire after ~4-6 hours
3. Return `HTTP 410 Gone` when accessed from a different IP

Since the Signal bot server generates the URL, but users click from their own IPs, the links never work.

### Solution

**Instead of generating direct download URLs, use pCloud web viewer URLs**:

```typescript
// WRONG - Temporary IP-bound URL (doesn't work for users!)
export async function getDirectDownloadLink(relativePath: string) {
  const response = await fetch(`https://api.pcloud.com/getpublinkdownload?code=${code}&fileid=${fileid}`);
  const data = await response.json();
  return `https://${data.hosts[0]}${data.path}`;  // IP-bound!
}

// CORRECT - Web viewer URL (works for everyone!)
export async function getDirectDownloadLink(relativePath: string) {
  const entry = pcloudIndex.files.get(relativePath);
  // Format: https://u.pcloud.link/publink/show?code=XXX#folder=FOLDER_ID&file=FILE_ID
  return `${PCLOUD_PUBLIC_URL}#folder=${entry.parentfolderid}&file=${entry.fileid}`;
}
```

**How the web viewer URL works**:
1. User clicks the link → pCloud web interface loads
2. Web app interprets `#folder=X&file=Y` fragment
3. Navigates directly to the file's parent folder
4. User can view/download from there (generates their own IP-bound download)

### Implementation Details

**Updated pCloud file index** to track parent folder IDs:
```typescript
interface PCloudFileEntry {
  fileid: number;
  parentfolderid: number;  // NEW: Required for web viewer URL
  name: string;
  path: string;
  size: number;
}
```

**Recursive indexing** captures parent folder IDs:
```typescript
function indexPCloudContents(
  contents: any[],
  currentPath: string,
  parentFolderId: number,  // Track parent
  files: Map<string, PCloudFileEntry>
): void {
  for (const item of contents) {
    if (item.isfolder) {
      indexPCloudContents(item.contents, itemPath, item.folderid || parentFolderId, files);
    } else if (item.fileid) {
      files.set(itemPath.toLowerCase(), {
        fileid: item.fileid,
        parentfolderid: item.parentfolderid || parentFolderId,
        name: item.name,
        path: itemPath,
        size: item.size || 0,
      });
    }
  }
}
```

### pCloud API Reference

**Two data centers** (must match user's account location):
- `api.pcloud.com` - United States
- `eapi.pcloud.com` - Europe

**Useful endpoints**:
- `showpublink?code=XXX` - Get folder structure with fileids (recursive)
- `getpublinkdownload?code=XXX&fileid=Y` - Get temporary download URL (IP-bound!)
- `getfilepublink?fileid=Y&auth=TOKEN` - Create new public link (requires auth)

### Lesson

✅ **pCloud download URLs from `getpublinkdownload` are IP-bound** - don't use for sharing
✅ **Use web viewer URLs** with `#folder=X&file=Y` fragment for shareable links
✅ **Store `parentfolderid`** in file index for web viewer URL construction
✅ **Match API host to account location** (US: api.pcloud.com, EU: eapi.pcloud.com)

**Sources**:
- [pCloud SDK PHP GitHub Issue #15](https://github.com/pCloud/pcloud-sdk-php/issues/15)
- [Stack Overflow: Download files with pCloud API](https://stackoverflow.com/questions/73759126/download-files-with-the-pcloud-api)
- [pCloud API Documentation](https://docs.pcloud.com/methods/public_links/)

**Files**: `container/src/utils/file-search.ts`

---

## 25. Auto-Archive Documents After Virus Scan (2025-12-04)

### Problem
Users wanted documents (PDFs, PPTX, STL files, etc.) to be automatically archived to pCloud after the automatic virus scan, without needing to manually use `!archive`.

### Solution
Extended the `autoScanAttachments()` function in `signal-bot-v2.ts` to:
1. Track clean files eligible for auto-archive
2. After virus scan, automatically organize and upload safe file types
3. Return pCloud viewer links in the scan results message

### Implementation

**Safe file types for auto-archive** (defined in `AUTO_ARCHIVE_EXTENSIONS`):
- **Documents**: `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `.odt`, `.ods`, `.odp`, `.rtf`, `.csv`
- **Text/code**: `.md`, `.json`, `.yaml`, `.yml`, `.txt`
- **Fabrication/3D**: `.stl`, `.gcode`, `.step`, `.stp`, `.iges`, `.igs`, `.scad`, `.obj`, `.3mf`, `.amf`, `.dxf`, `.dwg`

**Flow**:
1. Auto-scan runs ClamAV on attachment
2. If clean AND extension is in `AUTO_ARCHIVE_EXTENSIONS`:
   - Get group name from database for categorization
   - Call `organizeFile()` from file-organizer.ts
   - Upload to pCloud via rclone
   - Get public link via `rclone link`
3. Send combined message with scan results + archive links

### Code Changes

```typescript
// signal-bot-v2.ts - New import
import { organizeFile, getDirectoryForGroup, FileOrganizeResult } from '../utils/file-organizer.js';

// Track clean files during scanning
interface CleanFileInfo {
  filename: string;
  filePath: string;
  ext: string;
  fileSizeKB: number;
}
const cleanFiles: CleanFileInfo[] = [];

// When virus scan passes
if (stdout.includes('OK')) {
  results.push(`✅ ${filename} (${fileSizeKB} KB) - Clean`);
  if (AUTO_ARCHIVE_EXTENSIONS.has(ext)) {
    cleanFiles.push({ filename, filePath: targetFile.path, ext, fileSizeKB });
  }
}

// After all scans, archive clean files
for (const cleanFile of cleanFiles) {
  const result = await organizeFile(cleanFile.filePath, { groupName, scanVirus: false });
  // Upload via rclone and get link...
}
```

### Message Format

When a user uploads a document, they now see:

```
🛡️ Auto-Scan Results

✅ report.pdf (245 KB) - Clean

✓ Files scanned with ClamAV

📂 Auto-Archived to pCloud:

📁 report.pdf → Research/Documents
   ☁️ https://u.pcloud.link/publink/show?...
```

### Group-to-Directory Mapping

Files are automatically categorized based on Signal group name using `file-organizer.ts`:
- `ai/ml`, `machine learning` → `AI-ML/`
- `drone`, `uav`, `fpv` → `UnmannedSystems/`
- `cyber`, `infosec` → `Cybersecurity/`
- `fabrication`, `3d print` → `Fabrication/`
- Unknown groups → `UNSORTED/`

### Lesson

✅ **Auto-archive eliminates manual `!archive` step** for safe file types
✅ **Virus scan happens first** - infected files are NOT archived
✅ **Group-based categorization** routes files to appropriate directories
✅ **pCloud links returned immediately** for easy sharing

**Files**:
- `container/src/bot/signal-bot-v2.ts` - Auto-scan with auto-archive logic
- `container/src/utils/file-organizer.ts` - Group-to-directory mapping

---

## 26. Docker Volume Mount Permissions (rclone Config) (2025-12-04)

### Problem

**Symptom**: rclone commands failing with "permission denied" when accessing config file mounted from host.

**Error Message**:
```
CRITICAL: Failed to load config file "/app/config/rclone.conf": permission denied
```

**Debug Investigation**:
```bash
# Inside container - check directory permissions
docker exec signal-bot-selfhosted ls -la /app/config/
# drwx------ 2 501 dialout 4096 Dec  4 03:16 .
# -rw-r--r-- 1 501 dialout  275 Dec  4 03:16 rclone.conf

# Check container user
docker exec signal-bot-selfhosted whoami
# node

docker exec signal-bot-selfhosted id
# uid=1000(node) gid=1000(node) groups=1000(node)
```

### Root Cause

**UID/GID Mismatch Between Host and Container**:
- Host directory created by macOS or original user with **UID 501** (default macOS user)
- Container runs as `node` user with **UID 1000**
- Directory permissions were `drwx------` (700) - only owner can access
- Even though `rclone.conf` file inside was world-readable (`-rw-r--r--`), the **parent directory** blocked access

**Key Insight**: It's not enough for the file to be readable - the container user must also have **execute permission on the directory** to list and access files within it.

### Solution

**On the host server**, fix permissions to allow container user access:

```bash
# Make directory traversable (755 = rwxr-xr-x)
chmod 755 /home/signal-bot-selfhosted/config

# Change ownership to match container user (UID 1000)
chown -R 1000:1000 /home/signal-bot-selfhosted/config

# Verify
ls -la /home/signal-bot-selfhosted/config/
# drwxr-xr-x 2 1000 1000 4096 Dec  4 03:16 .
# -rw-r--r-- 1 1000 1000  275 Dec  4 03:16 rclone.conf
```

**Alternative**: If you can't change ownership, ensure directory is world-executable:
```bash
chmod 755 /home/signal-bot-selfhosted/config
# This allows any user to traverse the directory
```

### Docker Compose Volume Mount Reference

```yaml
services:
  signal-bot:
    volumes:
      # Config directory - must be readable by container user (UID 1000)
      - ./config:/app/config:ro
```

### Prevention

**When creating host directories for Docker volume mounts**:

1. **Check what user the container runs as**:
   ```bash
   docker exec <container> id
   ```

2. **Set correct ownership before mounting**:
   ```bash
   mkdir -p /path/to/config
   chown -R 1000:1000 /path/to/config
   chmod 755 /path/to/config
   ```

3. **Or use explicit user mapping in docker-compose.yml**:
   ```yaml
   services:
     app:
       user: "${UID}:${GID}"  # Run as host user
   ```

### Common UID Values

| Source | UID | Notes |
|--------|-----|-------|
| macOS default user | 501 | First user on macOS |
| Linux default user | 1000 | First user on most Linux distros |
| Docker `node` user | 1000 | Official Node.js images |
| root | 0 | Never recommended |

### Lesson

✅ **Directory permissions matter, not just file permissions** - container needs execute (`x`) on parent directories
✅ **Check UID/GID mismatch** when "permission denied" errors occur on mounted volumes
✅ **Fix on host, not in Dockerfile** - volume mounts override container filesystem
✅ **Use `chmod 755` for directories** that need to be traversable by any user
✅ **Match UID 1000** for most Node.js containers (the `node` user)

**Files**:
- `docker-compose.yml` - Volume mount configuration
- Host: `/home/signal-bot-selfhosted/config/` - rclone configuration directory
