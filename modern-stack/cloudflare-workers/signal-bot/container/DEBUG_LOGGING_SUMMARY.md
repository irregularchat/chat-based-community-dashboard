# Debug Logging Implementation Summary

## Files Created

### 1. `migrations/003_debug_logs.sql`
PostgreSQL migration that creates the `debug_logs` table with fields:
- `id` (SERIAL PRIMARY KEY)
- `timestamp` (BIGINT)
- `event_type` (VARCHAR(50)) - connection_open, connection_close, message_decrypt_failed, etc.
- `severity` (VARCHAR(20)) - debug, info, warn, error, critical
- `component` (VARCHAR(50)) - signal-cli, rpc-client, bot-handler, etc.
- `message` (TEXT)
- `data` (JSONB) - context-specific debugging information
- `stack_trace` (TEXT)
- Indexes on timestamp, event_type, severity, component

### 2. `src/utils/debug-logger.ts`
Comprehensive DebugLogger class that provides methods to:
- Log connection lifecycle events (open, close, error, reconnect attempts)
- Log RPC requests/responses/errors/timeouts
- Log message processing events and decryption failures
- Query recent logs from database
- Clean up old logs

## Files Modified

### 3. `src/bot/signal-jsonrpc-client.ts`
Added debug logging to SignalJsonRpcClient:
- Connection open events (host, port)
- Connection close events (with reconnect context)
- Connection error events (with error details)
- Reconnect attempt logging (attempt number, delay)
- Message received notifications (preview of params)
- RPC request logging (method, params, requestId)
- RPC error logging (method, error, requestId)
- RPC timeout logging (method, timeout duration, requestId)

Constructor now accepts optional `DebugLogger` parameter.

## Integration Needed

### 4. `src/bot/signal-bot-v2.ts` (TODO)
Still needs DebugLogger integration for:
- Bot lifecycle events (start, stop)
- Message processing errors
- Message decryption failures (InvalidMessageException)
- Signal CLI errors

Constructor should:
1. Create DebugLogger instance with PostgreSQL client
2. Pass debugLogger to SignalJsonRpcClient constructor
3. Add debug logging around message handler try-catch blocks
4. Log bot start/stop events

## Deployment Steps

1. **Run PostgreSQL Migration**:
   ```bash
   ssh root@proxmox-main "cd /home/signal-bot-selfhosted && \\
     docker exec postgres-signal-bot psql -U postgres -d signal_bot < /path/to/003_debug_logs.sql"
   ```

2. **Build and Deploy**:
   ```bash
   cd /Users/sac/Git/chat-based-community-dashboard/modern-stack/cloudflare-workers/signal-bot/container
   npm run build
   cd ..
   ./deploy-to-proxmox.sh
   ```

3. **Query Debug Logs**:
   ```sql
   -- Recent errors
   SELECT * FROM debug_logs WHERE severity = 'error' ORDER BY timestamp DESC LIMIT 20;

   -- Connection issues
   SELECT * FROM debug_logs WHERE event_type IN ('connection_close', 'connection_error', 'reconnect_attempt')
   ORDER BY timestamp DESC LIMIT 50;

   -- Message decryption failures
   SELECT * FROM debug_logs WHERE event_type = 'message_decrypt_failed' ORDER BY timestamp DESC LIMIT 20;

   -- RPC timeouts
   SELECT * FROM debug_logs WHERE event_type = 'rpc_timeout' ORDER BY timestamp DESC LIMIT 20;
   ```

4. **Monitoring Queries**:
   ```sql
   -- Event type breakdown (last hour)
   SELECT event_type, COUNT(*) as count
   FROM debug_logs
   WHERE timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '1 hour') * 1000
   GROUP BY event_type
   ORDER BY count DESC;

   -- Error summary (last hour)
   SELECT component, event_type, COUNT(*) as count
   FROM debug_logs
   WHERE severity IN ('error', 'critical')
     AND timestamp > EXTRACT(EPOCH FROM NOW() - INTERVAL '1 hour') * 1000
   GROUP BY component, event_type
   ORDER BY count DESC;
   ```

## Benefits

This debug logging system will help diagnose:
1. **Connection Instability**: Track when and why connections drop, how often reconnections happen
2. **Message Decryption Failures**: Capture envelope data when InvalidMessageException occurs
3. **RPC Communication Issues**: See which RPC calls timeout or fail
4. **Performance Issues**: Identify slow operations or excessive reconnections
5. **Root Cause Analysis**: Historical data to correlate multiple failure modes

## Next Steps

1. Complete integration in `signal-bot-v2.ts`
2. Run database migration
3. Deploy and monitor
4. Add API endpoint to query debug logs (optional)
5. Create Grafana dashboard for debug log visualization (optional)
