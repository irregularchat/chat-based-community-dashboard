# Verification Request System Implementation Plan

## Overview

A secure, automated verification flow for new users joining via the Entry/INDOC chat.

## Security Model

1. **Vouch-based trust**: Every new user must be vouched for by an existing community member
2. **Time-limited**: 24-hour window to complete verification (prevents stale/abandoned requests)
3. **Accountability**: Both parties (user + voucher) are logged for audit trail
4. **Automated enforcement**: Bot removes users who fail verification

---

## Flow Diagram

```
Admin: !req @newuser
    ↓
Bot → @newuser: "Welcome! Please introduce yourself and @mention who invited you"
    ↓
User responds with intro + @voucher mention
    ↓
Bot → @voucher: "Do you vouch for @newuser to join IrregularChat?"
    ↓
Voucher responds: "yes" / "no"
    ↓
YES → !gtg flow (create account, add to groups, remove from entry chat)
NO  → Remove user with denial message

[24-hour timeout] → Auto-remove user with timeout message
```

---

## Database Schema

### New Table: `verification_requests`

```sql
CREATE TABLE verification_requests (
    id SERIAL PRIMARY KEY,
    user_uuid VARCHAR(255) NOT NULL,
    user_name VARCHAR(255),
    user_phone VARCHAR(50),
    entry_group_id VARCHAR(255) NOT NULL,

    -- Status tracking
    status VARCHAR(50) NOT NULL DEFAULT 'pending_intro',
    -- pending_intro: Waiting for user to respond with intro + mention
    -- pending_vouch: Waiting for voucher to confirm
    -- approved: Voucher said yes, processing with GTG
    -- denied: Voucher said no
    -- expired: 24 hours passed without completion
    -- removed: User was removed

    -- Voucher info (set when user mentions someone)
    voucher_uuid VARCHAR(255),
    voucher_name VARCHAR(255),

    -- Admin who initiated
    requested_by_uuid VARCHAR(255),
    requested_by_name VARCHAR(255),

    -- Intro text (captured when user responds)
    intro_text TEXT,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    voucher_asked_at TIMESTAMP,
    completed_at TIMESTAMP,

    -- Unique constraint: one active request per user per group
    CONSTRAINT unique_active_request UNIQUE (user_uuid, entry_group_id, status)
);

CREATE INDEX idx_verification_pending ON verification_requests(status, expires_at);
CREATE INDEX idx_verification_user ON verification_requests(user_uuid);
CREATE INDEX idx_verification_voucher ON verification_requests(voucher_uuid, status);
```

---

## Implementation Steps

### Step 1: Database Migration

1. Create `migrations/004_verification_requests.sql`
2. Add `verification_requests` to `ALLOWED_TABLES` in postgres-client.ts
3. Add helper methods to PostgresClient:
   - `createVerificationRequest()`
   - `getActiveVerificationRequest(userUuid, groupId)`
   - `getPendingVouchRequests(voucherUuid)`
   - `updateVerificationStatus()`
   - `getExpiredRequests()`

### Step 2: Enhanced `!req @user` Command

**Location**: `command-handler.ts` - modify `handleRequest()`

Current behavior: Just returns static help text
New behavior:
- Admin-only when used with mention
- Creates verification request in DB
- Sends personalized message to the mentioned user:

```
📝 Welcome to IrregularChat Entry!

@NewUser, you've been invited to join the community.

To complete verification:
1. Introduce yourself (name, org, interests)
2. @mention the person who invited you to vouch for you

Example: "Hi, I'm John from ABC Corp, interested in cyber. @JaneDoe invited me"

⏰ You have 24 hours to complete verification.
```

### Step 3: Message Handler - Detect Voucher Mentions

**Location**: `command-handler.ts` - add to `handleMessage()` flow

When a message comes in Entry/INDOC chat:
1. Check if sender has a `pending_intro` verification request
2. If yes and message contains a mention:
   - Store the intro text
   - Extract voucher UUID from mention
   - Update status to `pending_vouch`
   - Send vouch request to voucher:

```
🤝 Verification Request

@Voucher, @NewUser is requesting to join IrregularChat and mentioned you as their connection.

Do you trust and vouch for @NewUser to join the IrregularChat community?

Reply with:
• "yes" or "1" to approve
• "no" or "2" to deny

ℹ️ By vouching, you confirm they understand the community rules at forum.irregularchat.com
```

### Step 4: Message Handler - Detect Voucher Response

When a message comes in Entry/INDOC chat:
1. Check if sender has a `pending_vouch` request where they are the voucher
2. Parse response: yes/y/1/approve → approve, no/n/2/deny → deny
3. If approved:
   - Update status to `approved`
   - Run GTG flow (create SSO, add to groups)
   - Post success message
   - Remove user from entry chat
4. If denied:
   - Update status to `denied`
   - Post denial message
   - Remove user from entry chat

### Step 5: Periodic Timeout Check

**Location**: `signal-bot-v2.ts` - add new interval like `groupRefreshInterval`

Every 30 minutes:
1. Query for expired verification requests
2. For each expired request:
   - Update status to `expired`
   - Post timeout message to entry chat
   - Remove user from entry chat

Timeout message:
```
⏰ Verification Timeout

@User failed to complete verification within 24 hours and has been removed.

They can try again by having a community member add them directly to this chat.
```

### Step 6: Enhanced `!gtg` Flow

Modify `handleGtg()` to:
1. After successful processing, remove user from entry chat
2. Post farewell message in entry chat:

```
✅ Good to go! @User has been verified.

Thanks for keeping the community safe.

@User - you'll receive:
1. A DM with your IrregularChat login
2. Group invites based on your interests

Learn about the community: https://forum.irregularchat.com/t/irregularchat-forum-start-here-faqs/84

See you out there!
```

---

## Security Considerations

1. **Admin-only initiation**: Only admins can start verification with `!req @user`
2. **Voucher must be existing member**: Bot verifies voucher is in other IC groups (not just entry)
3. **One active request per user**: Prevents spam/abuse
4. **Audit trail**: All requests logged with timestamps and actors
5. **No phone numbers in public messages**: Use display names only
6. **Timeout enforcement**: Prevents abandoned accounts lingering

---

## Files to Modify

1. **`migrations/004_verification_requests.sql`** - New migration
2. **`src/db/postgres-client.ts`** - Add table to whitelist, helper methods
3. **`src/bot/command-handler.ts`**:
   - `handleRequest()` - Accept @mention, create request
   - Add `handleVerificationMessage()` - Detect intro/vouch responses
   - `handleGtg()` - Add removal from entry chat
4. **`src/bot/signal-bot-v2.ts`** - Add timeout check interval

---

## Testing Plan

1. Test `!req @user` creates request and sends prompt
2. Test user intro with mention triggers vouch request
3. Test voucher "yes" triggers GTG flow + removal
4. Test voucher "no" triggers denial + removal
5. Test 24-hour timeout triggers removal
6. Test duplicate request prevention
7. Test non-admin cannot use `!req @user`
