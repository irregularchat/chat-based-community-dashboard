# Signal Bot Operations Guide

**Last Updated**: 2025-12-01
**Server**: proxmox-main
**Deployment Path**: `/home/signal-bot-selfhosted`

## Quick Reference

### SSH Access
```bash
ssh root@proxmox-main
cd /home/signal-bot-selfhosted
```

### Container Status
```bash
docker ps | grep signal
docker logs signal-bot-selfhosted --tail 50
docker logs signal-bot-selfhosted -f  # Follow logs
```

### Quick Restart
```bash
docker compose restart signal-bot
```

---

## Infrastructure Overview

### Docker Containers

| Container | Purpose | Port | Health Check |
|-----------|---------|------|--------------|
| `signal-bot-selfhosted` | Main bot (Node.js + signal-cli) | 8080 | `/health` |
| `signal-bot-postgres` | PostgreSQL database | 5432 | pg_isready |
| `signal-bot-redis` | Redis cache | 6379 | redis-cli ping |
| `signal-bot-vpn` | Mullvad VPN (gluetun) | 8000 | ping 1.1.1.1 |
| `signal-bot-backup` | PostgreSQL backup | - | - |

### Network Architecture
```
signal-bot-selfhosted
       │
       ├── depends_on: vpn (network_mode: service:vpn)
       │                └── All HTTP traffic routes through Mullvad VPN
       │
       ├── connects to: postgres (direct)
       └── connects to: redis (direct)
```

### Data Persistence

| Path | Purpose |
|------|---------|
| `/home/signal-bot-selfhosted/data/signal-data` | Signal CLI registration, keys, messages |
| `/home/signal-bot-selfhosted/data/downloads` | Temporary downloads (yt-dlp) |
| `signal-bot-postgres` volume | PostgreSQL database |
| `signal-bot-redis` volume | Redis cache |

---

## Deployment Workflow

### Standard Code Deployment

From local machine:
```bash
# 1. Navigate to project
cd /Users/sac/Git/chat-based-community-dashboard/modern-stack/cloudflare-workers/signal-bot/container

# 2. Build TypeScript
npm run build

# 3. Sync source files to server
rsync -avz --delete src/ root@proxmox-main:/home/signal-bot-selfhosted/bot/src/

# 4. Rebuild Docker image (on server)
ssh root@proxmox-main "cd /home/signal-bot-selfhosted && docker compose build signal-bot"

# 5. Restart container
ssh root@proxmox-main "cd /home/signal-bot-selfhosted && docker compose up -d signal-bot"
```

### One-Liner Deployment
```bash
npm run build && \
rsync -avz src/ root@proxmox-main:/home/signal-bot-selfhosted/bot/src/ && \
ssh root@proxmox-main "cd /home/signal-bot-selfhosted && docker compose build signal-bot && docker compose up -d signal-bot"
```

### Force Full Rebuild (when caching issues)
```bash
ssh root@proxmox-main "cd /home/signal-bot-selfhosted && docker compose build --no-cache signal-bot && docker compose up -d signal-bot"
```

---

## VPN Container Management

The VPN container (gluetun with Mullvad) is **critical** for security - it masks the server's IP from URL fetches.

### Check VPN Health
```bash
# Check container status
docker ps | grep vpn
# Should show "healthy"

# Check VPN IP
docker exec signal-bot-vpn curl -s ifconfig.me
# Should NOT be your server's real IP
```

### VPN Unhealthy - Fix Steps

**Symptoms:**
- Signal bot won't start
- Error: `container for service "vpn" is unhealthy`
- Bot container stuck in "waiting" state

**Solution:**
```bash
ssh root@proxmox-main

# 1. Restart VPN container
cd /home/signal-bot-selfhosted
docker compose restart vpn

# 2. Wait for health check (30 seconds)
sleep 30

# 3. Check VPN is healthy
docker ps | grep vpn

# 4. Start signal bot
docker compose up -d signal-bot
```

### VPN Still Not Working?

```bash
# Check VPN logs
docker logs signal-bot-vpn --tail 50

# Common issues:
# - WireGuard key expired → Update in docker-compose.yml
# - Mullvad server down → Change endpoint
# - Network issues → Restart Docker daemon

# Nuclear option - recreate VPN container
docker compose down vpn
docker compose up -d vpn
sleep 30
docker compose up -d signal-bot
```

---

## Common Operations

### View Bot Logs
```bash
# Last 50 lines
docker logs signal-bot-selfhosted --tail 50

# Follow logs in real-time
docker logs signal-bot-selfhosted -f

# Filter for errors
docker logs signal-bot-selfhosted 2>&1 | grep -i error

# Filter for specific command
docker logs signal-bot-selfhosted 2>&1 | grep "!links"
```

### Restart Bot (Quick)
```bash
docker compose restart signal-bot
```

### Restart All Services
```bash
docker compose down
docker compose up -d
```

### Check Bot Health
```bash
# HTTP health check
curl http://localhost:8080/health

# From local machine
ssh root@proxmox-main "curl -s http://localhost:8080/health"
```

### Execute Command in Container
```bash
# Interactive shell
docker exec -it signal-bot-selfhosted sh

# Run specific command
docker exec signal-bot-selfhosted ls /app/signal-data
```

---

## Database Operations

### PostgreSQL Access
```bash
# Interactive psql
docker exec -it signal-bot-postgres psql -U signal_bot -d signal_bot

# Run query directly
docker exec signal-bot-postgres psql -U signal_bot -d signal_bot -c "SELECT COUNT(*) FROM signal_messages;"
```

### Common Queries

```sql
-- Recent messages
SELECT source_name, message, timestamp
FROM signal_messages
ORDER BY timestamp DESC
LIMIT 10;

-- News links
SELECT title, domain, post_count, first_posted_at
FROM news_links
ORDER BY last_posted_at DESC
LIMIT 10;

-- Group list
SELECT id, name, member_count
FROM signal_groups
ORDER BY name;

-- Delete test data
DELETE FROM news_links
WHERE domain = 'example.com'
AND first_posted_at > NOW() - INTERVAL '1 hour';
```

### Backup Database
```bash
# Create backup
docker exec signal-bot-postgres pg_dump -U signal_bot signal_bot > backup_$(date +%Y%m%d).sql

# Restore backup
docker exec -i signal-bot-postgres psql -U signal_bot -d signal_bot < backup_20251201.sql
```

---

## Signal CLI Operations

### Check Signal CLI Status
```bash
docker exec signal-bot-selfhosted signal-cli -a +19108471202 --config /app/signal-data listGroups
```

### Signal Data Location
```
/home/signal-bot-selfhosted/data/signal-data/
├── data/
│   └── 813876.d/
│       ├── account.db      # SQLite database with contacts
│       ├── sender-keys/    # Group encryption keys
│       └── ...
└── attachments/
```

### Import Contacts to PostgreSQL
```bash
# Export from Signal CLI SQLite
docker cp signal-bot-selfhosted:/app/signal-data/data/813876.d/account.db /tmp/

# Generate INSERT statements
sqlite3 /tmp/account.db "
  SELECT 'INSERT INTO signal_members ... VALUES ...'
  FROM recipient WHERE aci IS NOT NULL
" | docker exec -i signal-bot-postgres psql -U signal_bot -d signal_bot
```

---

## Troubleshooting

### Bot Not Responding

1. **Check if container is running:**
   ```bash
   docker ps | grep signal-bot-selfhosted
   ```

2. **Check logs for errors:**
   ```bash
   docker logs signal-bot-selfhosted --tail 100
   ```

3. **Check signal-cli daemon:**
   ```bash
   docker logs signal-bot-selfhosted 2>&1 | grep "signal-cli"
   ```

4. **Verify JSON-RPC connection:**
   ```bash
   docker logs signal-bot-selfhosted 2>&1 | grep "JSON-RPC"
   # Should see: "Connected to signal-cli JSON-RPC"
   ```

### Container Won't Start

1. **Check VPN health first:**
   ```bash
   docker ps | grep vpn
   # If unhealthy, see VPN section above
   ```

2. **Check for port conflicts:**
   ```bash
   netstat -tlnp | grep 8080
   ```

3. **Check Docker logs:**
   ```bash
   docker compose logs signal-bot
   ```

### Database Connection Issues

1. **Check PostgreSQL is running:**
   ```bash
   docker ps | grep postgres
   ```

2. **Test connection:**
   ```bash
   docker exec signal-bot-postgres pg_isready -U signal_bot
   ```

3. **Check bot can reach database:**
   ```bash
   docker logs signal-bot-selfhosted 2>&1 | grep -i postgres
   ```

### Messages Not Being Received

1. **Check subscribeReceive was called:**
   ```bash
   docker logs signal-bot-selfhosted 2>&1 | grep "subscribeReceive"
   # Should see: "Successfully subscribed to receive messages"
   ```

2. **Verify daemon is running:**
   ```bash
   docker logs signal-bot-selfhosted 2>&1 | grep "daemon"
   ```

3. **Check for message processing:**
   ```bash
   docker logs signal-bot-selfhosted -f
   # Send a test message, look for "📨 Message from"
   ```

---

## Bot Commands Reference

### User Commands

| Command | Description | Example |
|---------|-------------|---------|
| `!help` | Show all commands | `!help` |
| `!ping` | Test bot | `!ping` |
| `!links` | Browse shared news | `!links`, `!links -f`, `!links -a` |
| `!groups` | List Signal groups | `!groups` |
| `!ai <question>` | Ask AI | `!ai What is Docker?` |
| `!cast <dice>` | Roll dice | `!cast 3`, `!cast @user` |
| `!faq` | Community FAQ | `!faq` |
| `!forum` | Forum link | `!forum` |

### `!links` Options

| Flag | Description |
|------|-------------|
| (default) | Show actual article URLs |
| `-f` | Show forum discussion URLs |
| `-a` | Show archive.org URLs |
| `-c` | Current group only |
| `-t <time>` | Time period (24h, 7d, 1w) |
| `-d <domain>` | Filter by domain |
| `-n <count>` | Limit results |

### Admin Commands

| Command | Description |
|---------|-------------|
| `!announce <msg>` | Send announcement |
| `!gtg @user` | Approve user |
| `!addto @user <group#>` | Add user to group |

---

## File Locations

### Local Development
```
/Users/sac/Git/chat-based-community-dashboard/modern-stack/cloudflare-workers/signal-bot/
├── container/
│   ├── src/               # TypeScript source
│   ├── dist/              # Compiled JavaScript
│   ├── config/            # Configuration files
│   └── Dockerfile.selfhosted
├── LESSONS_LEARNED_SIGNAL_CLI.md  # Technical lessons
├── OPERATIONS.md          # This file
└── README.md              # Project overview
```

### Server (proxmox-main)
```
/home/signal-bot-selfhosted/
├── bot/
│   ├── src/               # TypeScript source (synced)
│   ├── dist/              # Built by Docker
│   └── config/            # Config files
├── data/
│   ├── signal-data/       # Signal CLI data (CRITICAL)
│   └── downloads/         # Temp files
├── docker-compose.yml     # Service definitions
└── .env                   # Environment variables
```

---

## Environment Variables

Key variables in `.env`:
```bash
# Signal
SIGNAL_PHONE=+19108471202

# Database
DB_PASSWORD=<secure_password>

# OpenAI (optional)
OPENAI_API_KEY=sk-...

# Discourse (optional)
DISCOURSE_URL=https://forum.irregularchat.com
DISCOURSE_API_KEY=...
DISCOURSE_USERNAME=bot
```

---

## Maintenance Schedule

### Daily (Automated)
- PostgreSQL backup via `signal-bot-backup` container
- Health checks every 30 seconds

### Weekly
- Check VPN connection is working
- Review error logs
- Check disk space: `df -h`

### Monthly
- Update signal-cli if new version available
- Review and clean old news_links
- Sync contacts from Signal CLI to PostgreSQL

---

## Emergency Procedures

### Complete System Recovery

If everything is broken:

```bash
ssh root@proxmox-main
cd /home/signal-bot-selfhosted

# 1. Stop everything
docker compose down

# 2. Check disk space
df -h

# 3. Check signal data exists
ls -la data/signal-data/

# 4. Start services in order
docker compose up -d postgres redis
sleep 10
docker compose up -d vpn
sleep 30
docker compose up -d signal-bot

# 5. Check status
docker compose ps
docker logs signal-bot-selfhosted --tail 50
```

### Backup Signal Data

**CRITICAL**: Always backup before major changes!

```bash
# On server
tar -czvf signal-data-backup-$(date +%Y%m%d).tar.gz data/signal-data/

# Copy to local
scp root@proxmox-main:/home/signal-bot-selfhosted/signal-data-backup-*.tar.gz ~/backups/
```

---

## See Also

- `LESSONS_LEARNED_SIGNAL_CLI.md` - Technical implementation details
- `README.md` - Project overview and architecture
- `docker-compose.yml` - Service definitions
