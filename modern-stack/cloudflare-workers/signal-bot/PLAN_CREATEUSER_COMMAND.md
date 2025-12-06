# Plan: !createuser Command - Authentik SSO Integration

## Overview

Add `!createuser` admin command to Signal bot that creates users in Authentik SSO, mirroring the dashboard's `createSSOUser` functionality.

## Command Syntax

```
!createuser @user email@example.com          # Primary: use mentioned user's name
!createuser email@example.com FirstName      # Fallback: no mention, provide name
!createuser email@example.com First Last     # With full name
```

## Features

1. **Admin-only command** (uses existing `isAdmin()` check)
2. **@mention support** - extract first name from Signal profile if user is mentioned
3. **Auto-generate username** - using dashboard's algorithm (firstname + random word + number)
4. **Generate secure passphrase** - same format as dashboard (3 words + number + special char)
5. **Send DM to created user** with:
   - Username
   - Temporary password
   - Login URL (sso.irregularchat.com)
   - Welcome message
6. **Reply in group** with confirmation (no password shown)

## Implementation Steps

### Step 1: Create Authentik Service for Signal Bot

**File**: `container/src/utils/authentik-client.ts`

Port the key functions from `src/lib/authentik.ts`:
- `isConfigured()` - check if API URL and token are set
- `generateUsername(firstName)` - random word + number
- `generateSecurePassphrase()` - 3 words + number + special char
- `checkUsernameExists(username)` - API call to verify uniqueness
- `createUser(payload)` - POST to Authentik API
- `resetUserPassword(userId, newPassword)` - for immediate password reset

**Environment Variables Required**:
```
AUTHENTIK_BASE_URL=https://sso.irregularchat.com
AUTHENTIK_API_TOKEN=<bearer-token>
MAIN_GROUP_ID=<default-group-uuid>  # Optional
```

### Step 2: Add !createuser Command Handler

**File**: `container/src/bot/command-handler.ts`

```typescript
case '!createuser':
  return this.handleCreateUser(args, context);
```

### Step 3: Implement handleCreateUser

```typescript
private async handleCreateUser(args: string, context: CommandContext): Promise<string> {
  // 1. Admin check
  const isUserAdmin = await this.isAdmin(context.sourceUuid || context.sourceNumber);
  if (!isUserAdmin) {
    return '❌ Admin-only command';
  }

  // 2. Check if Authentik is configured
  if (!authentikClient.isConfigured()) {
    return '❌ SSO service not configured';
  }

  // 3. Parse arguments
  let email: string;
  let firstName: string;
  let lastName: string = '';
  let targetUserUuid: string | undefined;

  // Check for @mention
  if (context.mentions && context.mentions.length > 0) {
    // Format: !createuser @user email@example.com
    const mention = context.mentions[0];
    targetUserUuid = mention.uuid;

    // Get name from database
    const userInfo = await this.dbClient.query(
      'SELECT display_name, profile_name, first_name FROM signal_members WHERE uuid = $1',
      [mention.uuid]
    );

    if (userInfo.results?.length > 0) {
      const row = userInfo.results[0];
      firstName = row.first_name || row.profile_name?.split(' ')[0] || row.display_name?.split(' ')[0] || 'User';
    } else {
      firstName = 'User';
    }

    // Extract email from remaining args
    const emailMatch = args.match(/[\w.-]+@[\w.-]+\.\w+/);
    if (!emailMatch) {
      return '❌ Email required\n\nUsage: !createuser @user email@example.com';
    }
    email = emailMatch[0];

  } else {
    // Format: !createuser email@example.com FirstName [LastName]
    const parts = args.trim().split(/\s+/);
    if (parts.length < 2) {
      return '❌ Missing arguments\n\nUsage:\n!createuser @user email@example.com\n!createuser email@example.com FirstName';
    }

    const emailMatch = parts[0].match(/[\w.-]+@[\w.-]+\.\w+/);
    if (emailMatch) {
      email = parts[0];
      firstName = parts[1];
      lastName = parts.slice(2).join(' ');
    } else {
      // Email might be second
      email = parts.find(p => p.includes('@')) || '';
      firstName = parts.find(p => !p.includes('@')) || 'User';
    }

    if (!email) {
      return '❌ Invalid email address';
    }
  }

  // 4. Generate username
  let username = await authentikClient.generateUsername(firstName);
  let attempts = 0;
  while (await authentikClient.checkUsernameExists(username) && attempts < 10) {
    username = await authentikClient.generateUsername(firstName);
    attempts++;
  }

  // 5. Create user in Authentik
  const result = await authentikClient.createUser({
    username,
    email,
    firstName,
    lastName,
    attributes: {
      created_by: 'signal_bot',
      created_via: 'signal_createuser_command',
      signal_uuid: targetUserUuid,
    },
  });

  if (!result.success) {
    return `❌ Failed to create user: ${result.error}`;
  }

  // 6. Send DM to user with credentials (if we have their Signal ID)
  const welcomeMessage = `🎉 Welcome to IrregularChat!

Your account has been created:

Username: ${username}
Password: ${result.temp_password}

🔐 Login at: https://sso.irregularchat.com

📚 Getting Started:
• Join chats that interest you: https://wiki.irregularchat.com/community/chat_groups
• Introduce yourself on the forum: https://forum.irregularchat.com/c/introduction
• Read the FAQs: https://forum.irregularchat.com/t/irregularchat-forum-start-here-faqs/84

See you in the community!`;

  // Determine DM recipient: target user if mentioned, otherwise admin who ran command
  const dmRecipient = targetUserUuid || context.sourceUuid || context.sourceNumber;
  let dmSent = false;

  if (dmRecipient && this.bot) {
    try {
      await this.bot.sendMessage({
        recipient: dmRecipient,
        message: welcomeMessage,
      });
      dmSent = true;
    } catch (dmError) {
      console.error('Failed to send DM:', dmError);
    }
  }

  // 7. Return success (no password in group response!)
  const response = [
    '✅ SSO Account Created',
    '',
    `Email: ${email}`,
    `Username: ${username}`,
    `Name: ${firstName} ${lastName}`.trim(),
  ];

  if (dmSent) {
    if (targetUserUuid) {
      response.push('', '📨 Credentials sent to user via DM');
    } else {
      response.push('', '📨 Credentials sent to you via DM (forward to user)');
    }
  } else {
    response.push('', '⚠️ Could not send DM - contact user manually');
  }

  return response.join('\n');
}
```

### Step 4: Update Environment Template

**File**: `cloudflare-workers/signal-bot/.env.selfhosted.template`

Add:
```bash
# Authentik SSO Integration (for !createuser command)
AUTHENTIK_BASE_URL=https://sso.irregularchat.com
AUTHENTIK_API_TOKEN=your-api-token-here
MAIN_GROUP_ID=optional-default-group-uuid
```

### Step 5: Update docker-compose-vpn.yml

Add environment variables to signal-bot service:
```yaml
environment:
  AUTHENTIK_BASE_URL: ${AUTHENTIK_BASE_URL:-}
  AUTHENTIK_API_TOKEN: ${AUTHENTIK_API_TOKEN:-}
  MAIN_GROUP_ID: ${MAIN_GROUP_ID:-}
```

### Step 6: Update Help Command

Add to `!help` output:
```
👤 User Management (Admin):
!createuser @user email    - Create SSO account for mentioned user
!createuser email name     - Create SSO account with email and name
```

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `container/src/utils/authentik-client.ts` | CREATE | Authentik API client |
| `container/src/bot/command-handler.ts` | MODIFY | Add !createuser handler |
| `.env.selfhosted.template` | MODIFY | Add Authentik env vars |
| `docker-compose-vpn.yml` | MODIFY | Pass Authentik env vars |
| `LESSONS_LEARNED_SIGNAL_CLI.md` | MODIFY | Document integration |

## Security Considerations

1. **Password visibility**:
   - NEVER show password in group chat response
   - If @mention: Send credentials via DM to the target user
   - If no @mention: Send credentials via DM to the admin who ran the command (for manual forwarding)

2. **Admin-only**:
   - Uses existing `isAdmin()` check
   - Only admins can create accounts

3. **API token security**:
   - Token stored in environment variable
   - Never logged or exposed

4. **Rate limiting**:
   - Consider adding rate limit (e.g., 10 users per hour)

## Testing Plan

1. Test with @mention in group:
   ```
   !createuser @TestUser test@example.com
   ```
   - Verify user created in Authentik
   - Verify DM sent to user
   - Verify group response has no password

2. Test without @mention:
   ```
   !createuser test2@example.com John Smith
   ```
   - Verify user created
   - Verify password shown in response (with warning)

3. Test error cases:
   - Non-admin user
   - Invalid email
   - Authentik service down
   - Duplicate username

## Estimated Effort

- Create authentik-client.ts: ~100 lines
- Add handleCreateUser: ~80 lines
- Update configs: ~10 lines
- Testing: Manual verification

Total: ~200 lines of code
