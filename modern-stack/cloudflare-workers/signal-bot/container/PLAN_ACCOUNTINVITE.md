# Plan: !accountinvite Command

## Overview
Create a `!accountinvite` command that generates a single-use Authentik SSO invite URL valid for 4 hours.

## Key Findings from Existing Code

### API Endpoint
```
POST /api/v3/stages/invitation/invitations/
```

### Request Payload
```json
{
  "name": "signal_bot_invite_<timestamp>",
  "expires": "2025-12-04T00:00:00.000Z",  // 4 hours from now
  "fixed_data": {},
  "single_use": true,
  "flow": "5618f121-1270-4d09-81ff-59fbf00a8c0d"  // Invite flow ID
}
```

### Response
```json
{
  "pk": "7a877339-3143-452a-b245-83dff055d8a4",  // Invite ID
  "name": "signal_bot_invite_1733356800000",
  "expires": "...",
  "single_use": true,
  "flow_obj": {
    "slug": "invite-enrollment-flow"
  }
}
```

### Correct Invite URL Format (from Lessons_Learned.md)
```
https://sso.irregularchat.com/if/flow/{flow_slug}/?itoken={invite_id}
```
Example:
```
https://sso.irregularchat.com/if/flow/invite-enrollment-flow/?itoken=7a877339-3143-452a-b245-83dff055d8a4
```

## Implementation Steps

### Step 1: Add Environment Variables
Add to `.env` or docker-compose:
```
AUTHENTIK_INVITE_FLOW_ID=5618f121-1270-4d09-81ff-59fbf00a8c0d
AUTHENTIK_INVITE_FLOW_SLUG=invite-enrollment-flow
```

### Step 2: Add `createInvite()` Method to authentik-client.ts

```typescript
interface CreateInviteResponse {
  success: boolean;
  inviteUrl?: string;
  inviteId?: string;
  expiresAt?: string;
  error?: string;
}

public async createInvite(
  label?: string,
  expiresInHours: number = 4,
  singleUse: boolean = true
): Promise<CreateInviteResponse> {
  if (!this.isActive) {
    return { success: false, error: 'Authentik service not configured' };
  }

  try {
    const flowId = process.env.AUTHENTIK_INVITE_FLOW_ID;
    const flowSlug = process.env.AUTHENTIK_INVITE_FLOW_SLUG || 'invite-enrollment-flow';

    if (!flowId) {
      return { success: false, error: 'AUTHENTIK_INVITE_FLOW_ID not configured' };
    }

    // Calculate expiry
    const expiryDate = new Date();
    expiryDate.setHours(expiryDate.getHours() + expiresInHours);

    const inviteData = {
      name: label || `signal_invite_${Date.now()}`,
      expires: expiryDate.toISOString(),
      fixed_data: {},
      single_use: singleUse,
      flow: flowId,
    };

    const response = await this.makeRequest(
      'stages/invitation/invitations/',
      'POST',
      inviteData
    );

    // Build correct invite URL
    const inviteUrl = `${this.config.apiUrl.replace('/api/v3', '')}/if/flow/${flowSlug}/?itoken=${response.pk}`;

    return {
      success: true,
      inviteUrl,
      inviteId: response.pk,
      expiresAt: expiryDate.toISOString(),
    };

  } catch (error) {
    console.error('Error creating invite:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

### Step 3: Add Command Handler in command-handler.ts

```typescript
case '!accountinvite':
case '!invite':
  return this.handleAccountInvite(args, context);
```

```typescript
/**
 * !accountinvite - Generate SSO invite link (admin only)
 *
 * Usage:
 * - !accountinvite - Creates 4-hour single-use invite
 * - !accountinvite 24 - Creates 24-hour single-use invite
 * - !accountinvite reusable - Creates 4-hour reusable invite
 */
private async handleAccountInvite(args: string, context: CommandContext): Promise<string> {
  // Admin check
  const isUserAdmin = await this.isAdmin(context.sourceUuid || context.sourceNumber);
  if (!isUserAdmin) {
    return '❌ Admin-only command';
  }

  // Check if Authentik is configured
  if (!authentikClient.isConfigured()) {
    return '❌ SSO service not configured';
  }

  // Parse args
  let expiresInHours = 4;
  let singleUse = true;
  const argLower = args.trim().toLowerCase();

  if (argLower === 'reusable') {
    singleUse = false;
  } else if (argLower) {
    const hours = parseInt(argLower, 10);
    if (!isNaN(hours) && hours > 0 && hours <= 168) { // Max 1 week
      expiresInHours = hours;
    }
  }

  // Create label with requester info
  const label = `signal_${context.sourceName?.replace(/[^a-z0-9]/gi, '')}_${Date.now()}`;

  const result = await authentikClient.createInvite(label, expiresInHours, singleUse);

  if (!result.success) {
    return `❌ Failed to create invite: ${result.error}`;
  }

  const expiryTime = new Date(result.expiresAt!);
  const response = [
    '✅ SSO Invite Created',
    '',
    `🔗 ${result.inviteUrl}`,
    '',
    `⏰ Expires: ${expiryTime.toLocaleString()}`,
    `🔄 Single use: ${singleUse ? 'Yes' : 'No (reusable)'}`,
  ];

  return this.formatForSignal(response.join('\n'));
}
```

### Step 4: Update Docker Compose / Environment

Add these environment variables:
```yaml
environment:
  - AUTHENTIK_INVITE_FLOW_ID=5618f121-1270-4d09-81ff-59fbf00a8c0d
  - AUTHENTIK_INVITE_FLOW_SLUG=invite-enrollment-flow
```

## Files to Modify

1. **authentik-client.ts** - Add `createInvite()` method and interface
2. **command-handler.ts** - Add case statement and handler method
3. **docker-compose.yml** or **.env** - Add flow ID and slug env vars

## Testing

1. Deploy code
2. Run `!accountinvite` in Signal group
3. Verify invite URL works in browser
4. Test expiration by waiting 4+ hours
5. Test single-use by using invite twice
