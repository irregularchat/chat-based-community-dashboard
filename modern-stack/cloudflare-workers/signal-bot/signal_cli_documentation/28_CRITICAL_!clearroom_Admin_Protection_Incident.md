# CRITICAL: !clearroom Admin Protection Incident (2025-12-04)

### Incident Summary

The `!clearroom` command inadvertently removed community admins from the Entry/INDOC room because the protection logic only checked for Signal group admins, not bot admins or Admin group members.

### What Happened

1. Admin ran `!clearroom confirm` in Entry room
2. Command removed ALL non-Signal-admin members
3. **49 community admins were removed** because they weren't Signal admins in that specific group
4. Required manual restoration via signal-cli commands

### Root Cause

Original protection logic:
```typescript
// WRONG - Only protected Signal group admins
const protectedSet = new Set(signalAdmins);
const nonAdminMembers = members.filter((m: string) => !protectedSet.has(m));
```

This failed because:
- Signal group admins ≠ Community admins
- Bot admins (from `ADMIN_UUIDS` env var) weren't protected
- Admin group members weren't protected

### Solution: Three-Layer Protection

Updated protection logic (`command-handler.ts:4555-4573`):
```typescript
// 1. Signal group admins (explicit admins of THIS group)
const protectedSet = new Set(signalAdmins);

// 2. Bot admins from ADMIN_UUIDS environment variable
const botAdminUuids = process.env.ADMIN_UUIDS?.split(',').map(u => u.trim()).filter(Boolean) || [];
for (const uuid of botAdminUuids) {
  protectedSet.add(uuid);
}

// 3. CRITICAL: All members of the Admin group (by name pattern "**Admin**")
const adminGroup = allGroups.find((g: any) =>
  g.name && g.name.toLowerCase().includes('admin') && g.name.includes('**')
);
const adminGroupMembers: string[] = adminGroup?.members || [];
for (const uuid of adminGroupMembers) {
  protectedSet.add(uuid);
}
```

### Additional Safeguard: Preview Before Confirm

New behavior:
- `!clearroom` → Shows preview of who will be removed (with display names from DB)
- `!clearroom confirm` → Actually executes removal

Preview message shows:
- Number of members to be removed
- List of member names (up to 20, with "...and N more")
- Number of protected members and breakdown by source

### Recovery Process

To restore removed admin members:
```bash
# 1. Get Admin group members from Signal
docker exec signal-bot-selfhosted signal-cli -a +19108471202 \
  --config /app/signal-data listGroups -d -g 'ADMIN_GROUP_ID' \
  -o json | jq -r '.[0].members[].uuid'

# 2. Add them back to Entry group as members
docker exec signal-bot-selfhosted signal-cli -a +19108471202 \
  --config /app/signal-data updateGroup -g 'ENTRY_GROUP_ID' \
  -m UUID1 UUID2 UUID3 ...

# 3. Promote them to admins
docker exec signal-bot-selfhosted signal-cli -a +19108471202 \
  --config /app/signal-data updateGroup -g 'ENTRY_GROUP_ID' \
  --admin UUID1 UUID2 UUID3 ...
```

### Key IDs Reference

| Group | ID |
|-------|-----|
| Admin Group | `+By7SYBOPGExcE2PuBeAGdujLLaYTxG9yseTVA/d4dI=` |
| Entry/INDOC | `PjJCT6d4nrF0/BZOs39ECX/lZkcHPbi65JU8B6kgw6s=` |

### Lessons Learned

✅ **NEVER trust single-source protection** - Use multiple overlapping protection layers
✅ **Preview destructive actions** - Show what will be affected before confirming
✅ **Dynamic protection, not hardcoded** - Query Admin group live, don't hardcode UUIDs
✅ **Include display names** - Users can't verify UUIDs, need human-readable names
✅ **Log protection breakdown** - Console log shows `(Signal admins: X, Bot admins: Y, Admin group: Z)`

### Files Modified

- `container/src/bot/command-handler.ts` - Updated `handleClearRoom` function (lines 4518-4680)
- `container/src/db/postgres-client.ts` - Added `getMemberDisplayNamesByUuids` method (lines 800-818)
