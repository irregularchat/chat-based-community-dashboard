# CRITICAL: rsync --delete Data Loss (2025-12-03)

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
