# Signal Verification Debugging Guide

## Overview

This guide helps debug Signal verification issues using comprehensive logging and testing tools.

## Files

- `test-signal-debug.mjs` - Standalone test script that simulates the full Signal verification flow
- `SIGNAL_VERIFICATION_IMPROVEMENTS.md` - Documentation of improvements made to the system
- `.env.test` - Template for test environment variables

## Running the Debug Test

### 1. Setup Environment

Copy your actual Matrix credentials to `.env.test`:

```bash
cp .env.local .env.test
# Edit .env.test with your actual values
```

Required variables:
- `MATRIX_HOMESERVER` - Your Matrix homeserver URL
- `MATRIX_ACCESS_TOKEN` - Bot access token  
- `MATRIX_BOT_USERNAME` - Your bot's Matrix ID
- `MATRIX_SIGNAL_BRIDGE_ROOM_ID` - Signal bridge room ID
- `MATRIX_SIGNAL_BOT_USERNAME` - Signal bridge bot username
- `TEST_PHONE_NUMBER` - Phone number to test with

### 2. Run the Test Script

```bash
npm run test:signal
```

Or directly:
```bash
node test-signal-debug.mjs
```

## Understanding the Test Results

The test runs through 5 steps:

### Step 1: Signal Bridge Room Access
✅ **PASS**: Bot can access the Signal bridge room
❌ **FAIL**: Check `MATRIX_SIGNAL_BRIDGE_ROOM_ID` configuration

### Step 2: Phone Number Resolution  
✅ **PASS**: Phone resolves to Signal UUID
❌ **FAIL**: Check if phone is registered with Signal or bridge bot is responsive

### Step 3: Start Chat Command
✅ **PASS**: `start-chat` command sent successfully
❌ **FAIL**: Check Signal bridge room permissions

### Step 4: Find Signal Chat Room
✅ **PASS**: Found the created Signal chat room
❌ **FAIL**: Bridge may not have created room or timing issues

### Step 5: Send Test Message
✅ **PASS**: Message sent to Signal user
❌ **FAIL**: Check room permissions or encryption issues

## Live Debugging

When running the actual application (`npm run dev`), watch the console for logs prefixed with:

- `🔍 RESOLVE:` - Phone number resolution process
- `🔥 BRIDGE:` - Signal bridge message flow  
- `🔍 FIND:` - Room finding process
- `📤 BRIDGE:` - Message sending steps

## Common Issues & Solutions

### Issue: Phone Resolution Fails
**Logs to look for:**
```
❌ RESOLVE: SignalBot resolve failed: Failed to resolve identifier
```
**Solution:** Verify phone number is registered with Signal

### Issue: No Signal Chat Room Found
**Logs to look for:**
```
❌ FIND: No Signal chat room found for user: @signal_UUID:domain
```
**Solution:** Check if Signal bridge is creating rooms properly

### Issue: Wrong Bot Username
**Logs to look for:**
```
🤖 FIND: Bot (@wrong_bot:domain) in room: false
```
**Solution:** Verify `MATRIX_BOT_USERNAME` vs `MATRIX_SIGNAL_BOT_USERNAME`

### Issue: Timing Problems
**Logs to look for:**
```
⏱️ BRIDGE: Still not found, trying one more time...
```
**Solution:** Increase `SIGNAL_BRIDGE_BOT_RESPONSE_DELAY`

## Debug Log Examples

### Successful Flow
```
🔍 RESOLVE: Starting phone resolution for +12247253276
📤 RESOLVE: Sending command to bridge room: resolve-identifier +12247253276
✅ RESOLVE: Successfully resolved +12247253276 to UUID: 770b19f5-389e-444e-8976-551a52136cf6
🔥 BRIDGE: Starting Signal bridge message flow for @signal_770b19f5-389e-444e-8976-551a52136cf6:irregularchat.com
📤 BRIDGE: Sending Signal bridge command: start-chat 770b19f5-389e-444e-8976-551a52136cf6
🎯 FIND: Selected Signal chat room: !roomid:domain (Members: 2)
✅ BRIDGE: Signal message sent successfully: $eventid
```

### Failed Flow
```
🔍 RESOLVE: Starting phone resolution for +12247253276
❌ RESOLVE: No UUID found for phone +12247253276 in bot responses
❌ BRIDGE: Failed to extract Signal UUID from undefined
```

## Next Steps

1. **Run the test script** to identify which step is failing
2. **Check the logs** in the actual application during verification
3. **Compare results** between test script and live application
4. **Fix configuration** based on identified issues
5. **Re-test** until all steps pass

## Troubleshooting Checklist

- [ ] Signal bridge bot is responsive in bridge room
- [ ] Phone number is registered with Signal
- [ ] Bot has proper permissions in Signal bridge room
- [ ] Environment variables are correctly set
- [ ] Signal bridge room ID is correct
- [ ] Bot usernames are properly configured
- [ ] Network connectivity to Matrix server is working

## Configuration Template

```bash
# Working Configuration Example
MATRIX_HOMESERVER=https://matrix.irregularchat.com
MATRIX_BOT_USERNAME=@irregular_chat_bot:irregularchat.com
MATRIX_SIGNAL_BOT_USERNAME=@signalbot:irregularchat.com
MATRIX_SIGNAL_BRIDGE_ROOM_ID=!signal_bridge_room:irregularchat.com
SIGNAL_BRIDGE_BOT_RESPONSE_DELAY=3.0
``` 