# Message Receiving Implementation

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
