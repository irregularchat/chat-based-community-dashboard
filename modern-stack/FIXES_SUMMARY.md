# Signal Bot Fixes Summary

## Issues Fixed

### 1. Mention Validation Errors ✅
**Problem**: Commands like `!addto`, `!gtg`, `!sngtg` failed with "Security validation failed" when using @mentions
**Solution**: Added these commands to the `mentionAwareCommands` list that skips validation after the ￼ character
**Commands Fixed**: `addto`, `adduser`, `removeuser`, `mention`, `gtg`, `sngtg`

### 2. Multi-line Message Parsing ✅
**Problem**: `!tldr` and other commands failed when users sent multi-line messages (URL on one line, description on next)
**Solution**: Modified `processCommand` to only parse the first line of messages for command and arguments

### 3. Group Ordering Inconsistency ✅
**Problem**: `!groups` showed groups sorted by member count, but `!addto` used unsorted cache order, causing group #6 to target wrong group
**Solution**: Made `!addto` use the same sorted-by-member-count ordering as `!groups` command

## Current Issue Under Investigation

### UpdateGroup Not Actually Adding Users
**Symptoms**: 
- Bot says "✅ User added successfully" but user is not actually added to the group
- Direct JSON-RPC command to socket works: `{"jsonrpc":"2.0","result":{},"id":999}`
- Bot's sendJsonRpcRequest might not be handling the response correctly

**Debug Steps Added**:
1. Added logging to show JSON-RPC requests being sent
2. Added logging to show responses received
3. Need user to test `!addto` command again to see actual request/response

**Potential Issues**:
1. The UUID might not be passed correctly from mentions array
2. The socket communication might be interrupted
3. The bot might not have proper admin permissions (though manual test worked)

## Testing Commands

### Test Mention Validation
```bash
node test-validation.js
```

### Test Multi-line Handling
```bash
node test-multiline.js
```

### Test Group Ordering
```bash
node test-group-ordering-simple.js
```

### Test All Fixes
```bash
node test-all-fixes.js
```

### Manual UpdateGroup Test (works!)
```bash
echo '{"jsonrpc":"2.0","method":"updateGroup","params":{"account":"+19108471202","groupId":"sXo1i+q2bjKUOpZfczzkyAO0VglsGlalOL/MWTzQX2w=","addMembers":["01383f13-1479-4058-b51b-d39244b679f4"]},"id":999}' | nc -U /tmp/signal-cli-socket
```

## Next Steps

1. User needs to test `!addto 6 @Joshua` again with debug logging enabled
2. Check bot-debug.log for the actual JSON-RPC request and response
3. Verify the UUID is being extracted correctly from mentions
4. Ensure the socket connection is stable (seeing "Connection closed unexpectedly" warnings)

## Files Modified

- `/src/lib/signal-cli/native-daemon-service.js` - Main bot service file with all fixes