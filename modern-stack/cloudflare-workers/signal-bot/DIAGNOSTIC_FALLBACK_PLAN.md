# Signal Bot Diagnostic & Fallback Plan

## Current Status (2025-11-19)

### Issues Identified
1. **Wrong bot version was loaded** - `index.ts` imported V1 instead of V2 ✅ FIXED
2. **JSON-RPC notification parsing bug** - Message text shows as "undefined" ❌ NOT FIXED
3. **Database corruption on every deployment** - Requires manual fix each time ⚠️ WORKAROUND EXISTS

### Root Cause: JSON-RPC Notification Structure Mismatch

The bot receives notifications from signal-cli but can't parse the message text. Based on logs:
- Signal CLI receives: `Body: https://google.com?utm_source=test`
- Bot sees: `Message text: "undefined"`

**Hypothesis**: The notification structure has an extra layer we're not accounting for.

## Diagnostic Steps (Run these manually if test fails)

### 1. Check Bot Status
```bash
ssh root@proxmox-main "curl -s http://localhost:8080/bot/status"
```

Expected: `{"running":true,"phoneNumber":"+19108471202",...}`

### 2. Check for Trace Logs
```bash
ssh root@proxmox-main "docker logs --tail=200 signal-bot 2>&1 | grep '🔍 \[TRACE\]'"
```

This will show the FULL notification structure we added in `signal-bot-v2.ts:276-279`

### 3. Send Test Message
```bash
ssh root@proxmox-main "docker exec signal-bot signal-cli -a +19108471202 --config /app/signal-data send -m 'Test https://example.com' +12247253276"
```

### 4. Capture Full Notification JSON
```bash
ssh root@proxmox-main "docker logs --tail=50 signal-bot 2>&1 | grep -A 20 '🔍 \[TRACE\] Full notification'"
```

## Fallback Solutions

### Option 1: Log Raw JSON from signal-jsonrpc-client.ts

If trace logs don't show up, add logging directly in the JSON-RPC client:

**File**: `container/src/bot/signal-jsonrpc-client.ts` (around line 150-180)

Add after parsing JSON messages:
```typescript
const message = JSON.parse(line);
console.log('🟢 [RPC-CLIENT] Raw message:', JSON.stringify(message, null, 2));

if (message.method && !message.id) {
  // This is a notification
  console.log('🟢 [RPC-CLIENT] Emitting notification with params:',
    JSON.stringify(message.params, null, 2));
  this.emit('notification', message);
}
```

### Option 2: Simplify Message Extraction

Based on earlier logs showing `"params":{"subscription":1,"result":{"envelope":{...}}}`, try:

**File**: `container/src/bot/signal-bot-v2.ts:274-291`

Replace with:
```typescript
private handleJsonRpcNotification(notification: any): void {
  try {
    console.log('🔍 [TRACE] notification:', JSON.stringify(notification, null, 2));

    // Try multiple possible structures
    let envelope = null;

    if (notification.params?.envelope) {
      console.log('📍 Found envelope at notification.params.envelope');
      envelope = notification.params.envelope;
    } else if (notification.params?.result?.envelope) {
      console.log('📍 Found envelope at notification.params.result.envelope');
      envelope = notification.params.result.envelope;
    } else if (notification.envelope) {
      console.log('📍 Found envelope at notification.envelope');
      envelope = notification.envelope;
    } else {
      console.error('❌ Could not find envelope in notification');
      return;
    }

    this.handleMessage({ envelope });
  } catch (error) {
    console.error('Error handling JSON-RPC notification:', error);
    this.stats.errors++;
  }
}
```

### Option 3: Direct Signal CLI Integration (Nuclear Option)

If JSON-RPC continues to fail, fall back to the old method:

```typescript
// Spawn signal-cli in receive mode and parse stdout
const process = spawn('signal-cli', [
  '-a', phoneNumber,
  '--config', dataDir,
  'receive',
  '--json'
]);

process.stdout.on('data', (data) => {
  const lines = data.toString().split('\n');
  lines.forEach(line => {
    if (line.trim()) {
      try {
        const message = JSON.parse(line);
        if (message.envelope?.dataMessage?.message) {
          // Process message
        }
      } catch (e) {}
    }
  });
});
```

## Database Corruption Fix (Permanent Solution Needed)

Current workaround after each deployment:
```bash
ssh root@proxmox-main "docker exec signal-bot sh -c 'cd /app/signal-data/data/813876.d && rm -f account.db* && sqlite3 account.db < account_dump.sql'"
ssh root@proxmox-main "docker exec signal-bot curl -s -X POST http://localhost:8080/bot/start"
```

**Permanent Fix Ideas**:
1. Don't backup account.db to R2 (regenerate on each deploy)
2. Fix the SQL dump to not have UNIQUE constraint violations
3. Use signal-cli's built-in backup mechanism instead

## Testing Without Manual Intervention

Run the automated test script:
```bash
cd /Users/sac/Git/chat-based-community-dashboard/modern-stack/cloudflare-workers/signal-bot/container
./test-message-parsing.sh
```

This will:
1. Build code
2. Deploy
3. Fix database if needed
4. Send test message
5. Capture detailed logs

## Files Modified (Ready to Deploy)

1. ✅ `container/src/index.ts:14` - Fixed to import V2
2. ✅ `container/src/bot/signal-bot-v2.ts:274-290` - Added trace logging
3. ✅ `LESSONS_LEARNED_SIGNAL_CLI.md` - Documented issues
4. ✅ `container/test-message-parsing.sh` - Automated test

## Next Steps When Server is Accessible

1. Check test output: `./test-message-parsing.sh` should have completed
2. Look for `🔍 [TRACE]` logs showing notification structure
3. Based on structure, implement Option 2 (multiple envelope locations)
4. Redeploy and test
5. If still failing, implement Option 3 (direct spawn integration)

## Success Criteria

✅ Bot receives messages and `Message text:` shows actual text (not "undefined")
✅ URL security alerts are sent for URLs with tracking params
✅ URL security alerts are sent for suspicious TLDs (.cn, .ru, etc.)
✅ Bot responds to !commands
✅ No database corruption on deployment

## Contact/Debug Info

- Bot container: `signal-bot` on `proxmox-main`
- Bot API: `http://localhost:8080` (from inside container)
- Worker API: `https://signal-cli-bot.wemea-5ahhf.workers.dev`
- Bot phone: `+19108471202`
- Test phone: `+12247253276`
