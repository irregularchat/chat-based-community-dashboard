# Announcement Feature Plan

## Overview
Add `!announce` command for broadcasting messages to Signal groups with optional scheduling.

---

## Command Syntax

```
!announce [-t <time>] [-g <group#,group#,...>] [-dm] <message>
```

### Flags
| Flag | Description | Example |
|------|-------------|---------|
| `-t` | Schedule time (optional) | `-t 24h`, `-t 12/25/2025:10:35`, `-t 2h30m` |
| `-g` | Target groups (optional, comma-separated) | `-g 1,5,12` or `-g all` |
| `-dm` | Send as DM to each member (optional) | `-dm` (instead of group message) |

### Time Format Support
- Relative: `30m`, `2h`, `24h`, `1d`, `1w`
- Absolute: `12/25/2025:10:35`, `2025-12-25T10:35`, `12/25 10:35am`
- Natural: `tomorrow 9am`, `next monday 2pm`

### Examples
```
!announce Hello everyone!                              # Immediate to current group
!announce -g 1,5 Server maintenance tonight            # Immediate to groups 1 and 5
!announce -t 24h -g all Reminder: meeting tomorrow     # Scheduled to all groups
!announce -t 12/25/2025:09:00 -g 3 Merry Christmas!   # Specific date/time
!announce -dm -g 5 Please check your email             # DM each member of group 5
!announce -t 1h -dm -g all Important update            # Scheduled DM to all members
```

---

## Architecture

### File Changes

```
cloudflare-workers/signal-bot/
├── container/src/
│   ├── bot/
│   │   ├── command-handler.ts      # Add !announce command routing
│   │   └── announcement-handler.ts # NEW: Announcement logic
│   ├── scheduler/
│   │   └── announcement-scheduler.ts # NEW: Scheduled delivery
│   └── utils/
│       └── time-parser.ts          # NEW: Parse time formats
└── database/
    └── migrations/
        └── 002_announcements.sql   # NEW: Announcements table
```

### Database Schema

```sql
-- Scheduled announcements table
CREATE TABLE scheduled_announcements (
  id SERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  target_groups TEXT[],                -- Array of group IDs (null = current group)
  send_as_dm BOOLEAN DEFAULT false,    -- True = DM each member
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255) NOT NULL,    -- Admin UUID/phone
  created_by_name TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed', 'cancelled')),
  sent_at TIMESTAMP WITH TIME ZONE,
  recipient_count INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB                       -- Store additional context
);

CREATE INDEX idx_announcements_scheduled ON scheduled_announcements(scheduled_at);
CREATE INDEX idx_announcements_status ON scheduled_announcements(status);
CREATE INDEX idx_announcements_created_by ON scheduled_announcements(created_by);

-- Announcement delivery log
CREATE TABLE announcement_deliveries (
  id SERIAL PRIMARY KEY,
  announcement_id INTEGER NOT NULL REFERENCES scheduled_announcements(id),
  recipient_type VARCHAR(20) NOT NULL CHECK(recipient_type IN ('group', 'dm')),
  recipient_id VARCHAR(255) NOT NULL,  -- Group ID or phone/UUID
  recipient_name TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
  sent_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT
);

CREATE INDEX idx_deliveries_announcement ON announcement_deliveries(announcement_id);
CREATE INDEX idx_deliveries_status ON announcement_deliveries(status);
```

---

## Implementation Roadmap

### Phase 1: Core Announcement (Immediate Delivery)
**Files:** `command-handler.ts`, `announcement-handler.ts`

1. Add `!announce` case in command switch (line ~275)
2. Create `AnnouncementHandler` class with:
   - `parseCommand(args: string)` - Parse flags and message
   - `sendToGroup(groupId: string, message: string)` - Send to group
   - `sendToMembers(groupId: string, message: string)` - DM each member
3. Admin-only check using existing `isAdmin()` method
4. Get group list from `this.bot.getGroups()`
5. For DM mode: query `signal_member_group_memberships` to get member phones

**Key Code Pattern (from !gtg at line 1909):**
```typescript
// Send DM to individual
await this.bot.sendMessage({
  recipient: userPhone,
  message: announcementMessage,
});

// Send to group
await this.bot.sendMessage({
  groupId: groupId,
  message: announcementMessage,
});
```

### Phase 2: Time Parsing Utility
**Files:** `utils/time-parser.ts`

1. Create `parseTimeSpec(spec: string): Date | null`
2. Support formats:
   - Relative: `/^(\d+)(m|h|d|w)$/` -> add to current time
   - ISO: `Date.parse()` for ISO 8601
   - US Format: `/^(\d{1,2})\/(\d{1,2})(\/\d{4})?[:\s]?(\d{1,2}):(\d{2})(am|pm)?$/`
   - Natural: Map common phrases to dates
3. Handle timezone (default: America/New_York from config)

### Phase 3: Scheduled Announcements
**Files:** `scheduler/announcement-scheduler.ts`, database migration

1. Create database table via migration
2. Create `AnnouncementScheduler` class:
   - `scheduleAnnouncement(params)` - Insert into DB
   - `checkPendingAnnouncements()` - Query and execute due announcements
   - `cancelAnnouncement(id: number)` - Cancel scheduled
3. Start scheduler on bot startup (setInterval every 60 seconds)
4. Add `!announcements` command to list pending
5. Add `!cancelannounce <id>` to cancel

### Phase 4: DM Broadcast to Group Members
**Files:** `announcement-handler.ts`, `postgres-client.ts`

1. Add `getGroupMembers(groupId: string)` to postgres-client:
```sql
SELECT m.uuid, m.phone_number, m.display_name
FROM signal_members m
JOIN signal_member_group_memberships mgm ON m.id = mgm.member_id
WHERE mgm.group_id = $1 AND mgm.is_active = true
```
2. Rate limit DM sending (1 per 500ms to avoid spam detection)
3. Track delivery status in `announcement_deliveries` table
4. Report back: "Sent to X of Y members"

### Phase 5: Enhanced Features (Optional)
1. **Confirmation prompt:** "Send to 150 users? Reply Y to confirm"
2. **Preview mode:** `!announce --preview` to show targets without sending
3. **Templates:** `!announce -template welcome` for pre-defined messages
4. **Recurring:** `!announce -repeat daily` for recurring announcements

---

## Command Handler Integration

**Location:** `command-handler.ts` lines 270-277

```typescript
// Add to switch statement
case '!announce':
  return this.handleAnnounce(args, context);

case '!announcements':
  return this.handleListAnnouncements(context);

case '!cancelannounce':
  return this.handleCancelAnnouncement(args, context);
```

**Handler Method Signature:**
```typescript
private async handleAnnounce(args: string, context: CommandContext): Promise<string> {
  // 1. Check admin
  const isUserAdmin = await this.isAdmin(context.sourceUuid || context.sourceNumber);
  if (!isUserAdmin) return '❌ Admin-only command';

  // 2. Parse flags
  const { time, groups, dm, message } = this.parseAnnounceArgs(args);

  // 3. Validate
  if (!message) return '❌ No message provided\n\nUsage: !announce [-t time] [-g groups] [-dm] message';

  // 4. Get target groups
  const targetGroups = await this.resolveTargetGroups(groups, context.groupId);

  // 5. Schedule or send immediately
  if (time) {
    return this.scheduleAnnouncement({ time, groups: targetGroups, dm, message, context });
  } else {
    return this.sendAnnouncementNow({ groups: targetGroups, dm, message, context });
  }
}
```

---

## Database Queries

### Get Members of a Group
```sql
SELECT
  m.uuid,
  m.phone_number,
  m.display_name,
  m.profile_name
FROM signal_members m
INNER JOIN signal_member_group_memberships mgm ON m.id = mgm.member_id
WHERE mgm.group_id = $1
  AND mgm.is_active = true
  AND m.is_bot = false
ORDER BY m.display_name;
```

### Get Pending Announcements
```sql
SELECT *
FROM scheduled_announcements
WHERE status = 'pending'
  AND scheduled_at <= NOW()
ORDER BY scheduled_at ASC;
```

### List User's Scheduled Announcements
```sql
SELECT
  id,
  message,
  target_groups,
  send_as_dm,
  scheduled_at,
  status,
  recipient_count
FROM scheduled_announcements
WHERE created_by = $1
  AND status = 'pending'
ORDER BY scheduled_at ASC
LIMIT 20;
```

---

## Estimated Effort

| Phase | Scope | Priority |
|-------|-------|----------|
| Phase 1 | Core immediate announcement | High |
| Phase 2 | Time parsing | High |
| Phase 3 | Scheduled delivery | Medium |
| Phase 4 | DM broadcast | Medium |
| Phase 5 | Enhanced features | Low |

---

## Security Considerations

1. **Admin-only:** All announce commands require admin privileges
2. **Rate limiting:** Max 1 DM per 500ms, max 10 groups per announcement
3. **Audit log:** All announcements logged with creator info
4. **Confirmation:** Require confirmation for broadcasts > 50 recipients
5. **Opt-out:** Consider member opt-out for DM broadcasts (future)

---

## Existing Code References

| Feature | File | Line | Description |
|---------|------|------|-------------|
| Command routing | command-handler.ts | 135-277 | Switch statement for commands |
| Admin check | command-handler.ts | 79-130 | `isAdmin()` method |
| Send DM | command-handler.ts | 1909-1912 | Pattern in `!gtg` command |
| Get groups | signal-bot-v2.ts | 889-901 | `getGroups()` with cache |
| Send message | signal-bot-v2.ts | 806-831 | `sendMessage()` method |
| DB client | postgres-client.ts | - | PostgreSQL operations |
| Group members table | postgres-schema.sql | 212-229 | `signal_member_group_memberships` |
