# Docker Volume Mount Permissions (rclone Config) (2025-12-04)

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
