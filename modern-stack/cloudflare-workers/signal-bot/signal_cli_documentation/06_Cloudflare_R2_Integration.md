# Cloudflare R2 Integration

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

```