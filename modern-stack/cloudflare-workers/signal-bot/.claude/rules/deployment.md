# Signal Bot Deployment Rules

## CRITICAL: rsync --delete Can Destroy Production Data

### THE RULE: NEVER use rsync --delete to server parent directories

**CATASTROPHIC INCIDENT (Dec 3, 2025):**
- Used `rsync -avz --delete container/ root@proxmox-main:/home/signal-bot-selfhosted/`
- Synced to WRONG directory (should have been `/home/signal-bot-selfhosted/bot/`)
- `--delete` FLAG DELETED ALL FILES NOT IN SOURCE:
  - `docker-compose.yml` (production config)
  - Signal CLI registration data (`account.db` - CRITICAL, UNRECOVERABLE)
  - `.env` file with credentials
  - All `data/` subdirectories
- **RESULT: Signal bot account data PERMANENTLY LOST**

### Safe rsync Commands

```bash
# ALWAYS use deployment script instead of manual rsync
./deploy-selfhosted.sh

# If manual rsync required:
# 1. ALWAYS --dry-run first
rsync -avz --dry-run --delete container/ root@proxmox-main:/home/signal-bot-selfhosted/bot/

# 2. VERIFY destination path is exactly correct
# 3. CHECK if destination has OTHER files that shouldn't be deleted

# SAFE: Sync to specific subdirectory
rsync -avz --delete dist/ root@proxmox-main:/home/signal-bot-selfhosted/bot/dist/

# DANGEROUS: Sync to parent directory
rsync -avz --delete container/ root@proxmox-main:/home/signal-bot-selfhosted/
```

### Before ANY rsync --delete
1. **ALWAYS run --dry-run first**
2. **VERIFY destination path is exactly correct**
3. **CHECK if destination has OTHER files** (docker-compose.yml, .env, data/)
4. **PREFER deploy scripts** over manual rsync

---

## Docker Build Caching Issues

### THE RULE: Use --no-cache when deploying code changes

**Problem**: Docker caches build layers. If host files change AFTER an image was built, the cached image won't have your new code.

**WRONG:**
```bash
# Container restart keeps old cached code
docker-compose restart signal-bot
```

**CORRECT:**
```bash
# Force rebuild with new code
docker-compose build --no-cache signal-bot && docker-compose up -d signal-bot

# Or combined
docker-compose up -d --build signal-bot
```

### Deployment Verification Checklist

After EVERY deployment:

1. **Verify on host:**
   ```bash
   ssh root@proxmox-main "grep -c 'YOUR_NEW_FEATURE' /home/signal-bot-selfhosted/bot/src/bot/command-handler.ts"
   ```

2. **Verify in container:**
   ```bash
   ssh root@proxmox-main "docker exec signal-bot-selfhosted grep -c 'YOUR_NEW_FEATURE' /app/dist/bot/command-handler.js"
   ```

3. **Check logs:**
   ```bash
   ssh root@proxmox-main "docker logs signal-bot-selfhosted --tail 50"
   ```

---

## Self-Hosted vs Cloudflare Mode

### THE RULE: Use correct deployment script for architecture

| Feature | `deploy-to-proxmox.sh` | `deploy-selfhosted.sh` |
|---------|------------------------|------------------------|
| **Mode** | Cloudflare Native | Self-Hosted |
| **Deploy Path** | `/home/signalcli` | `/home/signal-bot-selfhosted` |
| **Database** | Cloudflare D1 via Worker API | PostgreSQL container |
| **Environment** | `WORKER_API_URL`, `WORKER_API_TOKEN` | `DB_HOST`, `DB_PORT`, etc. |
| **Entry Point** | `index.js` | `index-selfhosted.js` |

### Mode Detection
Container auto-detects mode based on `DB_HOST` environment variable:
- `DB_HOST` set → Self-Hosted mode (PostgreSQL)
- `DB_HOST` NOT set → Cloudflare mode (Worker API)

### Check Current Mode
```bash
ssh root@proxmox-main "docker logs signal-bot-selfhosted --tail 30 | grep 'Running in'"
# Expected: 🏠 Running in SELF-HOSTED mode (PostgreSQL)
# Or:       ☁️  Running in CLOUDFLARE-NATIVE mode (Worker API)
```

---

## Container Rebuild Required After Code Changes

### THE RULE: Rebuild container, don't just restart

**WRONG:**
```bash
docker-compose restart signal-bot  # Keeps old code!
```

**CORRECT:**
```bash
docker-compose up -d --build signal-bot
# Or with no-cache:
docker-compose build --no-cache signal-bot && docker-compose up -d
```

**Why**: Node.js caches imported modules. Restart reuses same image with old code.

---

## Signal Data Backup Rules

### Critical Files That Must Be Backed Up
- `/app/signal-data/data/*/account.db` - Signal account registration (UNRECOVERABLE if lost)
- `.env` - Credentials and configuration
- `docker-compose.yml` - Production orchestration

### Backup Commands
```bash
# Backup signal data before any risky operation
ssh root@proxmox-main "tar -czf /home/backup/signal-data-$(date +%Y%m%d).tar.gz /home/signal-bot-selfhosted/signal-data/"
```

---

## Quick Reference: Signal Bot Deployment

### Standard Deployment
```bash
# From: /Users/sac/Git/chat-based-community-dashboard/modern-stack/cloudflare-workers/signal-bot
cd container && npm run build && cd ..
./deploy-selfhosted.sh
ssh root@proxmox-main "cd /home/signal-bot-selfhosted && docker-compose up -d --build"
```

### Verify Deployment
```bash
# Check mode
ssh root@proxmox-main "docker logs signal-bot-selfhosted --tail 20 | grep -E '(Running in|started)'"

# Test command
# Send "!help" in Signal and verify response
```

### Emergency Recovery
```bash
# If signal data lost, check for backups
ssh root@proxmox-main "ls -la /home/backup/signal-data*.tar.gz"

# Restore from backup
ssh root@proxmox-main "tar -xzf /home/backup/signal-data-YYYYMMDD.tar.gz -C /"
```

---

## VPN/Gluetun Container Notes

When using VPN (Gluetun) container:
1. Signal bot container uses `network_mode: "service:gluetun"`
2. Bot inherits VPN container's network
3. If VPN container restarts, signal-bot also needs restart
4. Check VPN is connected: `docker logs gluetun | grep -i connected`

---

## Docker Network IP Changes

Container IPs can change on restart. For database connections:
- Use Docker DNS names (service names from docker-compose)
- Or use bridge network with `container_name` for DNS
- Don't hardcode container IPs

```yaml
# Good: Use service name
DB_HOST: postgres

# Bad: Hardcoded IP (will break)
DB_HOST: 172.18.0.3
```
