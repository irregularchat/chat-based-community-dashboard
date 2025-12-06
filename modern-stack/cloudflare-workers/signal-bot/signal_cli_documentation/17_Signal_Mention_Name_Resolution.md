# Signal Mention Name Resolution (2025-11-27)

### Problem: Mentions Show UUIDs Instead of Names

**Symptoms**:
```
!cast @Austyn @Jennifer Allen Kay
→ 🥇 User-4a4b6530
   🥈 User-f828a84d
```

Users see shortened UUIDs like `User-4a4b6530` instead of actual names like "Austyn" or "Jennifer Allen Kay".

**User Complaint**:
> "the mention isn't working ! . needs to be human readiable"

### Root Cause Investigation

**Signal CLI Logs Show Names**:
```
Signal CLI: - "Austyn" 4a4b6530-627a-4b52-b6f8-7ed38fcbeecb: 6 (length: 1)
Signal CLI: - "N" f828a84d-2278-498a-acb4-d2cb0707d607: 8 (length: 1)
```

**But JSON-RPC Mentions Don't Include Names**:
```typescript
interface Mention {
  start: number;    // Position in message text
  length: number;   // Length of mention
  uuid?: string;    // User's Signal UUID ✅
  number?: string;  // User's phone number ✅
  name?: string;    // ❌ NOT PROVIDED by JSON-RPC!
}
```

**Message Text Contains Unicode Placeholders**:
```typescript
// User types: !cast @Austyn @Jennifer
// Message text received: !cast ￼ ￼
// ￼ = U+FFFC (Unicode Object Replacement Character)
```

Signal replaces mentions with special Unicode placeholder characters (￼) in the message text. The `start` and `length` fields in mentions point to these placeholders, not to actual names.

**Conclusion**: Signal CLI daemon KNOWS the names (shows them in logs) but doesn't pass them through JSON-RPC.

### Discovery: Signal CLI's SQLite Database

Signal CLI stores all contact information in a local SQLite database:

**Location**: `/app/signal-data/data/813876.d/account.db`

**Key Table**: `recipient`

**Schema**:
```sql
CREATE TABLE recipient (
  _id INTEGER PRIMARY KEY AUTOINCREMENT,
  aci TEXT UNIQUE,              // Signal UUID (Address Communication Identifier)
  pni TEXT UNIQUE,              // Phone Number Identifier
  number TEXT UNIQUE,           // E.164 phone number
  username TEXT UNIQUE,         // Signal username

  -- Contact names (manually added)
  given_name TEXT,
  family_name TEXT,
  nick_name TEXT,

  -- Signal profile names (from user's profile)
  profile_given_name TEXT,
  profile_family_name TEXT,
  profile_about TEXT,
  profile_about_emoji TEXT,
  profile_avatar_url_path TEXT,

  -- Other fields...
) STRICT;
```

**Sample Query**:
```bash
docker exec signal-bot-selfhosted sqlite3 /app/signal-data/data/813876.d/account.db \
  "SELECT aci, number, profile_given_name, profile_family_name
   FROM recipient
   WHERE aci IS NOT NULL
   LIMIT 5"

# Output:
770b19f5-389e-444e-8976-551a52136cf6|+12247253276|Sac|
4a4b6530-627a-4b52-b6f8-7ed38fcbeecb||Austyn|
8dabe77c-006a-4aed-8839-22dd09c5b0d1||Kristen|Hansmann
f828a84d-2278-498a-acb4-d2cb0707d607||N|
```

This database contains **2,486 contacts** with their Signal profile names!

### Solution: Import Signal CLI Database to PostgreSQL

**Step 1: Export Contact Data from Signal CLI Database**

```bash
# Copy Signal CLI database to host
docker cp signal-bot-selfhosted:/app/signal-data/data/813876.d/account.db /tmp/signal-account.db

# Extract contacts to CSV
sqlite3 -csv /tmp/signal-account.db "
  SELECT
    COALESCE(aci, pni) as uuid,
    number as phone_number,
    COALESCE(
      profile_given_name || ' ' || profile_family_name,
      profile_given_name,
      given_name || ' ' || family_name,
      given_name,
      'Unknown'
    ) as display_name,
    profile_given_name,
    given_name,
    family_name
  FROM recipient
  WHERE aci IS NOT NULL OR pni IS NOT NULL
" > /tmp/contacts.csv
```

**Step 2: Import into PostgreSQL**

```bash
# Generate INSERT statements
sqlite3 /tmp/signal-account.db "
  SELECT
    'INSERT INTO signal_members (id, uuid, phone_number, display_name, profile_name, first_name, last_name, is_bot, created_at, updated_at) VALUES (' ||
    quote(COALESCE(aci, pni)) || ', ' ||
    quote(COALESCE(aci, pni)) || ', ' ||
    quote(number) || ', ' ||
    quote(COALESCE(profile_given_name || ' ' || profile_family_name, profile_given_name, given_name)) || ', ' ||
    quote(profile_given_name) || ', ' ||
    quote(given_name) || ', ' ||
    quote(family_name) || ', ' ||
    'false, NOW(), NOW()) ON CONFLICT (uuid) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = NOW();'
  FROM recipient
  WHERE (aci IS NOT NULL OR pni IS NOT NULL)
" | docker exec -i signal-bot-postgres psql -U signal_bot -d signal_bot

# Verify import
docker exec signal-bot-postgres psql -U signal_bot -d signal_bot \
  -c "SELECT COUNT(*) FROM signal_members"
# Result: 2486 contacts imported
```

**Step 3: Update Code to Use Database Lookups**

```typescript
// container/src/bot/command-handler.ts
for (const mention of context.mentions) {
  let userName = 'Unknown';

  // Try database lookup first if available
  if (this.dbClient && mention.uuid) {
    try {
      const memberInfo = await this.dbClient.query(
        'SELECT display_name, profile_name, first_name, last_name, phone_number FROM signal_members WHERE uuid = $1 LIMIT 1',
        [mention.uuid]
      );
      if (memberInfo.results && memberInfo.results.length > 0) {
        const row = memberInfo.results[0];
        userName = row.display_name || row.profile_name ||
                  (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name) ||
                  row.phone_number || userName;
      }
    } catch (error) {
      console.log('Could not look up member name:', error);
    }
  }

  // Fallback: Use phone number if available
  if (userName === 'Unknown' && mention.number) {
    userName = mention.number;
  }

  // Final fallback: Shortened UUID
  if (userName === 'Unknown' && mention.uuid) {
    userName = `User-${mention.uuid.substring(0, 8)}`;
  }
}
```

**PostgreSQL Table Structure**:
```sql
-- Check signal_members schema
\d signal_members

-- Key columns:
uuid TEXT UNIQUE NOT NULL           // Maps to Signal CLI 'aci'
phone_number TEXT                   // Maps to Signal CLI 'number'
display_name TEXT                   // Combined name for display
profile_name TEXT                   // Signal profile given name
first_name TEXT                     // Contact given name
last_name TEXT                      // Contact family name
```

### Testing & Verification

**Before Fix**:
```
!cast @Austyn @Jennifer Allen Kay
→ 🥇 User-4a4b6530
   Rolls: ⚄
   Total: 5

   🥈 User-f828a84d
   Rolls: ⚀
   Total: 1
```

**After Fix**:
```
!cast 7 @Jessica Dawson
→ 🥇 JD
   Rolls: ⚅ ⚄ ⚁ ⚂ ⚅ ⚄ ⚃
   Total: 31

   🥈 Sac
   Rolls: ⚁ ⚀ ⚀ ⚁ ⚂ ⚃ ⚅
   Total: 19
```

**Database Verification**:
```sql
-- Check specific UUIDs from user tests
SELECT uuid, display_name, phone_number
FROM signal_members
WHERE uuid IN (
  '4a4b6530-627a-4b52-b6f8-7ed38fcbeecb',  // Austyn
  'f828a84d-2278-498a-acb4-d2cb0707d607'   // N
);

-- Results:
uuid                                 | display_name | phone_number
-------------------------------------|--------------|-------------
4a4b6530-627a-4b52-b6f8-7ed38fcbeecb | Austyn       |
f828a84d-2278-498a-acb4-d2cb0707d607 | N            |
```

### Additional Feature: Include Command Sender

The user also requested that the command initiator be included in dice rolls:

**Implementation**:
```typescript
// Always include the sender/initiator
let senderName = context.sourceName || 'You';
if (this.dbClient && context.sourceNumber) {
  try {
    const senderInfo = await this.dbClient.query(
      'SELECT display_name, profile_name, first_name, last_name, phone_number FROM signal_members WHERE phone_number = $1 OR uuid = $1 LIMIT 1',
      [context.sourceNumber]
    );
    if (senderInfo.results && senderInfo.results.length > 0) {
      const row = senderInfo.results[0];
      senderName = row.display_name || row.profile_name ||
                  (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name) ||
                  row.phone_number || senderName;
    }
  } catch (error) {
    console.log('Could not look up sender name:', error);
  }
}

// Roll for the sender first
const senderRolls: number[] = [];
let senderTotal = 0;
for (let i = 0; i < numDice; i++) {
  const roll = Math.floor(Math.random() * 6) + 1;
  senderRolls.push(roll);
  senderTotal += roll;
}
results.push({
  name: senderName,
  uuid: context.sourceNumber || '',
  rolls: senderRolls,
  total: senderTotal
});

// Then roll for each mentioned user...
```

### Lesson

✅ **Signal CLI JSON-RPC omits names from mentions** - only provides UUIDs
✅ **Signal CLI logs show names** - daemon has the data but doesn't expose it
✅ **Signal CLI stores contacts in SQLite** - `account.db` contains all profile data
✅ **Direct database access is the solution** - extract from SQLite, import to PostgreSQL
✅ **Profile names are most reliable** - `profile_given_name` available for most users
✅ **Context needs message text** - but message has Unicode placeholders, not names
✅ **Database import is one-time** - 2,486 contacts imported successfully
✅ **UUIDs are the key** - map mentions to signal_members by UUID

**Why This Pattern Exists**:
- Signal prioritizes privacy - mentions are cryptographic identifiers (UUIDs)
- Names come from Signal profiles, not guaranteed to be present
- Signal CLI daemon caches profile data locally for performance
- JSON-RPC is designed for automation, not human-readable display

**Alternative Approaches Considered**:

1. ❌ **Parse from message text**: Message contains Unicode placeholders (￼), not names
2. ❌ **Use signal-cli listContacts**: Requires stopping daemon (config file locking)
3. ❌ **Rely on mention.number**: Only 84 of 2,486 contacts have phone numbers
4. ✅ **Direct SQLite access**: Complete, accurate, and performant

**Maintenance**:

To keep names up-to-date, periodically re-import from Signal CLI database:

```bash
# Create a sync script
cat > /tmp/sync-contacts.sh << 'EOF'
#!/bin/bash
docker cp signal-bot-selfhosted:/app/signal-data/data/813876.d/account.db /tmp/signal-account.db
sqlite3 /tmp/signal-account.db "[INSERT query]" | \
  docker exec -i signal-bot-postgres psql -U signal_bot -d signal_bot
EOF

# Run monthly via cron
0 0 1 * * /tmp/sync-contacts.sh
```

**Files**:
- `container/src/bot/command-handler.ts:1609-1682` - Mention name resolution with database lookups
- `/app/signal-data/data/813876.d/account.db` - Signal CLI SQLite database
- PostgreSQL table: `signal_members` - Imported contact data
