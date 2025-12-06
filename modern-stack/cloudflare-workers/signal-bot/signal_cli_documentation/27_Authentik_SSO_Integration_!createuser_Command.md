# Authentik SSO Integration (!createuser Command) (2025-12-04)

### Overview

The Signal bot can now create SSO accounts in Authentik directly from Signal chat using the `!createuser` command. This mirrors the functionality available in the community dashboard.

### Command Syntax

```
# With @mention (uses Signal profile name):
!createuser @user email@example.com

# Without @mention (specify name):
!createuser email@example.com FirstName
!createuser email@example.com First Last
```

### Features

1. **Admin-only command** - Uses existing `isAdmin()` check
2. **@mention support** - Extracts first name from Signal profile database
3. **Auto-generate username** - Format: `firstnameword42` (e.g., `johnswift42`)
4. **Generate secure passphrase** - Format: `WordWordWord42!` (3 words + number + special char)
5. **Password security** - NEVER shown in group chat response
6. **DM credentials**:
   - If @mention: DM sent to the mentioned user
   - If no @mention: DM sent to admin who ran command (for manual forwarding)

### Environment Variables

Add to `.env` on the server:

```bash
# Authentik SSO Integration
AUTHENTIK_BASE_URL=https://sso.irregularchat.com
AUTHENTIK_API_TOKEN=your-api-token-here
MAIN_GROUP_ID=  # Optional: default group UUID for new users
```

Add to `docker-compose.yml` in the signal-bot service environment:

```yaml
environment:
  # Authentik SSO configuration (optional - for !createuser command)
  AUTHENTIK_BASE_URL: ${AUTHENTIK_BASE_URL:-}
  AUTHENTIK_API_TOKEN: ${AUTHENTIK_API_TOKEN:-}
  MAIN_GROUP_ID: ${MAIN_GROUP_ID:-}
```

### Implementation Files

| File | Purpose |
|------|---------|
| `container/src/utils/authentik-client.ts` | Authentik API client |
| `container/src/bot/command-handler.ts` | `handleCreateUser()` method |
| `.env.selfhosted.template` | Environment variable template |
| `docker-compose-vpn.yml` | Container environment configuration |

### Authentik API Client (`authentik-client.ts`)

Key functions:

```typescript
// Check if Authentik is configured
authentikClient.isConfigured(): boolean

// Generate unique username: "firstnameword42"
authentikClient.generateUsername(firstName: string): Promise<string>

// Generate passphrase: "WordWordWord42!"
authentikClient.generateSecurePassphrase(): Promise<string>

// Check if username exists
authentikClient.checkUsernameExists(username: string): Promise<boolean>

// Create user in Authentik
authentikClient.createUser(payload: CreateUserPayload): Promise<CreateUserResponse>
```

### CRITICAL: Password Must Be Set Separately

**Problem Discovered (2025-12-04):**
Authentik's user creation API (`POST /api/v3/core/users/`) does NOT reliably apply the `password` field during user creation. Users are created but cannot log in because the password was never set.

**Solution:**
Password MUST be set via a separate API call after user creation:

```typescript
// Step 1: Create user WITHOUT password
const response = await fetch(`${apiUrl}/core/users/`, {
  method: 'POST',
  body: JSON.stringify({
    username: 'johndoe42',
    name: 'John Doe',
    email: 'john@example.com',
    is_active: true,
    // NOTE: Do NOT include password here - it won't work!
  })
});

// Step 2: Set password SEPARATELY using dedicated endpoint
await fetch(`${apiUrl}/core/users/${userId}/set_password/`, {
  method: 'POST',
  body: JSON.stringify({ password: 'SecurePass123!' })
});
```

**API Endpoint:**
```
POST /api/v3/core/users/{user_id}/set_password/
Body: { "password": "the-password" }
```

**Symptoms of the Bug:**
- User appears in Authentik admin with "Active: Yes"
- Event log shows "Model created" success
- User cannot log in - always shows "Failed login" in event log
- Password field during creation is silently ignored

**Verification in Logs:**
When working correctly, you'll see:
```
🔐 Creating user in Authentik...
✅ User created in Authentik: 1234
🔑 Setting password for user 1234...
✅ Password set successfully for user 1234
```

### Welcome Message Template

The welcome message sent via DM matches the dashboard format:

```
🌟 Your First Step Into the IrregularChat! 🌟
You've just joined a community focused on breaking down silos, fostering innovation, and supporting service members and veterans.
---
Use This Username and Temporary Password ⬇️
Username: johnswift42
Temporary Password: CorrectHorseBattery42!
Exactly as shown above 👆🏼

1️⃣ Step 1:
- Use the username and temporary password to log in to https://sso.irregularchat.com

2️⃣ Step 2:
- Update your email, important to be able to recover your account
- Save your Login Username and New Password to a Password Manager
- Visit the welcome page while logged in https://forum.irregularchat.com/t/84

Please take a moment to learn about the community before you jump in.
Welcome aboard!
```

### Security Considerations

1. **Password never in group chat** - Only sent via DM
2. **Admin verification** - Uses `isAdmin()` check (UUID + phone number)
3. **API token security** - Stored in environment variable, never logged
4. **Rate limiting** - Consider adding rate limit for production

### Example Usage

**In a Signal group (as admin):**

```
Admin: !createuser @JohnDoe john.doe@example.com
Bot: ✅ SSO Account Created

📧 Email: john.doe@example.com
👤 Username: johnswift42
📛 Name: John Doe

📨 Credentials sent to user via DM
```

**Without @mention:**

```
Admin: !createuser jane.smith@example.com Jane Smith
Bot: ✅ SSO Account Created

📧 Email: jane.smith@example.com
👤 Username: janeocean87
📛 Name: Jane Smith

📨 Credentials sent to you via DM (forward to user)
```

### Error Handling

| Scenario | Response |
|----------|----------|
| Non-admin user | `❌ Admin-only command` |
| Authentik not configured | `❌ SSO service not configured` |
| Missing email | `❌ Email required` |
| Invalid email | `❌ Invalid email address` |
| API error | `❌ Failed to create user: <error>` |
| DM failed, sent to admin | `📨 Credentials sent to admin (forward to user manually)` |
| DM failed completely | `⚠️ Could not send DM - contact user manually` |

### Troubleshooting

**"SSO service not configured"**
- Verify `AUTHENTIK_BASE_URL` and `AUTHENTIK_API_TOKEN` are set in `.env`
- Verify docker-compose passes the environment variables
- Restart container after .env changes

**User created but login fails (password not working)**
- Check logs for `🔑 Setting password for user` and `✅ Password set successfully`
- If missing, the old code (without separate set_password call) is deployed
- Solution: Rebuild with the fixed `authentik-client.ts` that uses `set_password` endpoint
- See "CRITICAL: Password Must Be Set Separately" section above

**Check environment variables in container:**
```bash
docker exec signal-bot-selfhosted printenv | grep AUTHENTIK
```

**Expected output:**
```
AUTHENTIK_BASE_URL=https://sso.irregularchat.com
AUTHENTIK_API_TOKEN=your-token-here
```

### Lesson

✅ **Reuse existing patterns** - Ported dashboard's Authentik service, maintaining consistency
✅ **Security first** - Never expose passwords in group chat
✅ **Progressive DM delivery** - Send to target user if mentioned, else to admin
✅ **Same username algorithm** - Dashboard and bot create compatible usernames
✅ **Same passphrase format** - Consistent user experience across tools
✅ **CRITICAL: Use separate set_password endpoint** - Authentik's user creation API ignores the password field; must use `POST /core/users/{id}/set_password/` after creation
✅ **Admin fallback for DM failures** - If DM to user fails, send credentials to admin (+12247253276) for manual forwarding
