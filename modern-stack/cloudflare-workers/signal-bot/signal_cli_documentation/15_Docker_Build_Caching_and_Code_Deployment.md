# Docker Build Caching and Code Deployment (2025-11-21)

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
