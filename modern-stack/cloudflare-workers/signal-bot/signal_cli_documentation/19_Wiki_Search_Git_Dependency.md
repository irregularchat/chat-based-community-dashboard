# Wiki Search Git Dependency (2025-12-02)

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
