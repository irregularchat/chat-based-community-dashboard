# Best Practices

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
