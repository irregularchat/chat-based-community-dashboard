# Signal Bridge Encryption Issue

## Problem Description

The Signal verification system is failing because the Signal bridge room is encrypted using Matrix's Megolm encryption (`m.megolm.v1.aes-sha2`). When our application sends `resolve-identifier` commands to the Signal bridge, the bot responds with encrypted messages that our Matrix client cannot decrypt.

## Root Cause

1. ✅ **Signal bridge bot is present** in the room
2. ✅ **Signal bridge bot responds** to resolve-identifier commands
3. ❌ **All bot responses are encrypted** - Our Matrix client lacks encryption keys to decrypt them

## Evidence

When examining the Signal bridge room messages:
- Command: `resolve-identifier +12247253276` (unencrypted)
- Response: `[no body]` with encrypted content in `ciphertext` field

```json
{
  "algorithm": "m.megolm.v1.aes-sha2",
  "ciphertext": "AwgKEpAEQNNbY8Fx1pDRS1TBLnU2lyhkvBRh...",
  "device_id": "ALWZSGEGRH",
  "sender_key": "O+V8CTdrV+cv8dgK2yJivYAfH9/sVqLOpEjAA+fuD0g",
  "session_id": "pmmpz3Z+QuJ61L6nXstlhLcNZ249GH2bYhdmr/Y3K2w"
}
```

## Solutions

### Option 1: Use Unencrypted Bridge Room (Recommended)
Configure the Signal bridge to use an unencrypted room for administrative commands.

**Steps:**
1. Create a new unencrypted Matrix room for Signal bridge commands
2. Configure the Signal bridge to use this room
3. Update `MATRIX_SIGNAL_BRIDGE_ROOM_ID` to point to the new room
4. Ensure the room has encryption disabled

**Pros:**
- Simple to implement
- No changes to application code required
- Reliable message reading

**Cons:**
- Bridge commands are not encrypted (but they're administrative, not user data)

### Option 2: Enable Encryption in Matrix Client
Configure our Matrix client to handle encryption/decryption.

**Steps:**
1. Install and configure `matrix-js-sdk` with encryption support
2. Set up Olm/Megolm encryption in the Matrix client
3. Handle key exchange and device verification
4. Implement proper error handling for encryption issues

**Pros:**
- Maintains encryption in bridge room
- More secure overall

**Cons:**
- Complex implementation
- Requires ongoing key management
- Potential for sync/encryption issues

### Option 3: Alternative Verification Method
Use a different approach that doesn't rely on the encrypted bridge room.

**Possibilities:**
- Direct API calls to Signal bridge
- Webhook-based verification
- Manual verification process
- Phone number validation without Signal integration

## Current Implementation

The application now detects when the Signal bridge room is encrypted and provides a clear error message:

```
❌ RESOLVE: Signal bridge room is encrypted - cannot read bot responses
💡 RESOLVE: Solution: Configure an unencrypted Signal bridge room or enable encryption in Matrix client
```

## Recommended Action

**Implement Option 1** (Unencrypted Bridge Room) as it provides the best balance of simplicity and reliability for this use case.

## Files Modified

- `src/lib/matrix.ts` - Added encryption detection and error handling
- `SIGNAL_BRIDGE_ENCRYPTION_ISSUE.md` - This documentation file 