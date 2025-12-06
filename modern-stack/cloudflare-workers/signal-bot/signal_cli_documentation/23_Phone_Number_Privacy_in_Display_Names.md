# Phone Number Privacy in Display Names (2025-12-04)

### Problem

The bot was exposing users' phone numbers in group chat messages when displaying their names. This happened because the code used phone numbers as fallback values when database lookups didn't return a proper display name.

**Example of Leaked Phone Number:**
```
🔒 +12247253276 holds ❌ FADE 20 pts
```

**Root Cause:**
Multiple places in `command-handler.ts` had fallback chains that included phone numbers:
```typescript
// WRONG - Phone number was in the fallback chain
playerName = row.display_name || row.profile_name ||
            (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name) ||
            row.phone_number || playerName;  // <-- Privacy leak!
```

### Solution

**Remove all phone number fallbacks from display name chains:**

1. **Dice game player names** (line ~5100):
```typescript
// CORRECT - Never use phone_number as name
playerName = row.display_name || row.profile_name ||
            (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name) ||
            playerName;
```

2. **!cast command** (lines ~3177, ~3217):
   - Removed phone number from database lookup fallback
   - Removed entire phone number formatting fallback block
   - Falls back to `User-{shortUUID}` instead

3. **!remove command** (line ~4173):
   - Default to "a member" instead of raw identifier
   - Only show actual display names if found

**Privacy-Safe Fallback Hierarchy:**
```
1. display_name (from database)
2. profile_name (from database)
3. first_name + last_name (from database)
4. "Player-{4 chars of UUID}" (safe anonymized fallback)
5. "a member" (for public messages about users)
```

### Lesson

✅ **NEVER use phone numbers in fallback chains for display names**
✅ **Always use anonymized identifiers** (short UUID, "a member") as final fallback
✅ **Phone numbers are okay for internal logging** (console.log) but never for group messages
✅ **Review all user-facing messages** to ensure no identifiers can leak

**Files**: `container/src/bot/command-handler.ts`
