# Signal @Mentions and Command Context (2025-11-19)

### The Problem: Parsing vs Structured Data

**WRONG APPROACH** ❌: Extracting phone numbers from command text
```typescript
// This DOES NOT WORK with Signal @mentions
const phoneMatch = args.match(/\+\d{10,15}/);
if (!phoneMatch) {
  return '❌ Could not find valid phone number\n\nUsage: !gtg +12345678901';
}
const userPhone = phoneMatch[0];
```

**Why This Fails**:
- Signal @mentions (like `@Justin McIntosh`) are NOT plain text in the message
- They're structured data in `envelope.dataMessage.mentions`
- Phone numbers are often not present - Signal uses UUIDs
- Regex parsing cannot resolve mentioned users to their identifiers

### The Solution: Use Message Envelope Mentions

Signal messages include a `mentions` array with structured data:

```typescript
// Signal mention structure
interface Mention {
  start: number;    // Position in message text where mention starts
  length: number;   // Length of mention text
  uuid?: string;    // User's Signal UUID (preferred)
  number?: string;  // User's phone number (if available)
}
```

**CORRECT APPROACH** ✅:

1. **Update CommandContext Interface**:
```typescript
export interface CommandContext {
  sourceNumber: string;
  sourceName: string;
  groupId?: string;
  timestamp: number;
  quotedText?: string;
  mentions?: Mention[];  // Add mentions array
}
```

2. **Pass Mentions from Bot to Command Handler**:
```typescript
// In signal-bot-v2.ts handleMessage()
await this.handleCommand(messageText, {
  sourceNumber: sourceNumber || '',
  sourceName: sourceName || '',
  groupId,
  timestamp,
  quotedText,
  mentions: envelope.dataMessage?.mentions,  // Pass structured mentions
});
```

3. **Extract User Identifiers from Mentions**:
```typescript
// For single user commands like !gtg
private async handleGtg(args: string, context: CommandContext): Promise<string> {
  if (!context.mentions || context.mentions.length === 0) {
    return '❌ Please mention a user\n\nUsage: !gtg @user';
  }

  const mention = context.mentions[0];
  const userPhone = mention.number || mention.uuid;  // Prefer number, fallback to UUID

  if (!userPhone) {
    return '❌ Could not resolve mentioned user';
  }

  // Now use userPhone with signal-cli commands
  await this.bot.sendMessage({ recipient: userPhone, message: '...' });
}

// For multi-user commands like !addto
private async handleAddTo(args: string, context: CommandContext): Promise<string> {
  if (!context.mentions || context.mentions.length === 0) {
    return '❌ Please mention users to add\n\nUsage: !addto @user1 @user2 11';
  }

  const userIdentifiers: string[] = [];
  for (const mention of context.mentions) {
    const identifier = mention.number || mention.uuid;
    if (identifier) {
      userIdentifiers.push(identifier);
    }
  }

  // Process all mentioned users
  for (const identifier of userIdentifiers) {
    await this.addUserToGroup(identifier, groupId);
  }
}
```

### Deployment Lesson: Container Rebuild Required

**CRITICAL**: When deploying code changes, you MUST rebuild the container, not just restart it.

**WRONG** ❌:
```bash
# This keeps old code cached in Node.js memory
ssh root@proxmox-main "cd /home/signal-bot-selfhosted && docker-compose restart signal-bot"
```

**CORRECT** ✅:
```bash
# This rebuilds the image with new code and restarts
ssh root@proxmox-main "cd /home/signal-bot-selfhosted && docker-compose up -d --build signal-bot"
```

**Why This Matters**:
- Node.js caches imported modules in memory
- Simply restarting the container reuses the same image with old code
- `--build` flag forces Docker to rebuild the image with updated source
- Without rebuild, your changes won't take effect even after rsync deployment

**Deployment Script Best Practice**:
```bash
# In deploy-to-proxmox.sh, always use --build flag
echo "📦 Rebuilding and restarting container..."
ssh root@proxmox-main "cd /home/signal-bot-selfhosted && docker-compose up -d --build signal-bot"
```

### Testing @Mentions

**Test Command Format**:
```
!gtg @UserName         # Approve and add user to groups
!addto @User1 @User2 11  # Add multiple users to group #11
!addto 11 @User        # Group number can be first or last
```

**Verification Steps**:
1. Send test command with @mention in Signal
2. Check bot logs for mention resolution: `docker-compose logs signal-bot`
3. Verify user receives welcome message (for !gtg)
4. Verify user is added to groups
5. Check database for join request updates

### Key Takeaways

1. **Never parse mention text** - Always use `context.mentions` array
2. **Prefer UUID over phone** - `mention.uuid` is more reliable than `mention.number`
3. **Container rebuild is mandatory** - Use `docker-compose up -d --build`, not `restart`
4. **Update all related commands** - Any command that needs user identifiers should use mentions
5. **Test with actual @mentions** - Don't test with phone numbers, test with @username syntax

### Commands Updated with Mention Support

- `!gtg @user` - Approve user and add to recommended groups
- `!addto @user1 @user2 <group-number>` - Add users to specific group
- Any admin command that targets users should follow this pattern
