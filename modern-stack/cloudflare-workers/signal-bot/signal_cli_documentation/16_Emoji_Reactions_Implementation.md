# Emoji Reactions Implementation (2025-11-22)

### Problem: Implementing Keyword-to-Emoji Auto-Reactions

**User Request**:
Automatically react with emojis when messages contain specific keywords (e.g., 🥔 when someone says "potato").

### Implementation: Three-Part System

**Architecture**:
```
Message received
    ↓
Check for keywords (emoji-reaction-handler.ts)
    ↓
Match found → Send reaction via JSON-RPC
    ↓
signal-cli sends emoji reaction to message
```

**Components**:

1. **Configuration** (`container/config/emoji-reactions.json`):
   - User-friendly JSON config with keyword-to-emoji mappings
   - Settings for matching behavior (case sensitivity, whole word, etc.)
   - Debounce settings to prevent duplicate reactions

2. **Handler** (`container/src/utils/emoji-reaction-handler.ts`):
   - Loads config and matches keywords against messages
   - Implements debouncing to prevent spam
   - Provides reload capability without restart

3. **JSON-RPC Integration** (`container/src/bot/signal-jsonrpc-client.ts`):
   - `sendReaction()` method added to JSON-RPC client
   - Sends reactions via signal-cli's `sendReaction` command

4. **Bot Integration** (`container/src/bot/signal-bot-v2.ts`):
   - Checks messages for matching emojis after command handling
   - Sends reactions asynchronously (non-blocking)

### Critical Bug #1: __dirname Not Available in ES Modules

**Problem**:
```
💥 Uncaught exception: ReferenceError: __dirname is not defined
    at new EmojiReactionHandler (file:///app/dist/utils/emoji-reaction-handler.js:13:51)
```

**Root Cause**:
ES modules don't have `__dirname` available. The code was trying to use it to construct the config file path:

```typescript
// ❌ WRONG - __dirname doesn't exist in ES modules
constructor(configPath?: string) {
  this.configPath = configPath || path.join(__dirname, '../../config/emoji-reactions.json');
  this.config = this.loadConfig();
}
```

**Solution**:
Use conditional path based on `NODE_ENV` with absolute path for production:

```typescript
// ✅ CORRECT - Use absolute path in production, relative in development
constructor(configPath?: string) {
  // Use absolute path in containerized environment, or relative path for development
  this.configPath = configPath || process.env.NODE_ENV === 'production'
    ? '/app/config/emoji-reactions.json'
    : path.join(process.cwd(), 'config/emoji-reactions.json');
  this.config = this.loadConfig();
}
```

**File**: `container/src/utils/emoji-reaction-handler.ts:36-41`

### Critical Bug #2: Wrong JSON-RPC Parameter Name

**Problem**:
```
Failed to send 🍕 reaction: Error: JSON-RPC Error -32603: Cannot invoke "java.lang.Long.longValue()" because "targetTimestamp" is null (NullPointerException)
```

**Root Cause**:
signal-cli's `sendReaction` JSON-RPC method expects `targetTimestamp`, but the code was sending `targetSentTimestamp`:

```typescript
// ❌ WRONG - parameter name doesn't match signal-cli expectation
async sendReaction(params: {
  emoji: string;
  targetAuthor: string;
  targetTimestamp: number;  // Interface says targetTimestamp
}): Promise<void> {
  const rpcParams: any = {
    emoji: params.emoji,
    targetAuthor: params.targetAuthor,
    targetSentTimestamp: params.targetTimestamp,  // ← WRONG! Sends as targetSentTimestamp
  };

  await this.request('sendReaction', rpcParams);
}
```

**Solution**:
Use the correct parameter name `targetTimestamp`:

```typescript
// ✅ CORRECT - parameter name matches signal-cli expectation
async sendReaction(params: {
  emoji: string;
  targetAuthor: string;
  targetTimestamp: number;
}): Promise<void> {
  const rpcParams: any = {
    emoji: params.emoji,
    targetAuthor: params.targetAuthor,
    targetTimestamp: params.targetTimestamp,  // ✅ Correct parameter name
  };

  if (params.recipient) {
    rpcParams.recipient = params.recipient;
  }

  if (params.groupId) {
    rpcParams.groupId = params.groupId;
  }

  await this.request('sendReaction', rpcParams);
}
```

**File**: `container/src/bot/signal-jsonrpc-client.ts:377-395`

### Critical Bug #3: Missing Config Directory in Dockerfile

**Problem**:
Container logs showed config file error even though the file existed in the source repository.

**Root Cause**:
Dockerfile was missing the `COPY config ./config` command, so the emoji-reactions.json file was never copied into the Docker image:

```dockerfile
# ❌ WRONG - config directory not copied
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install production dependencies only
RUN npm ci --only=production
```

**Solution**:
Add the config directory copy command:

```dockerfile
# ✅ CORRECT - config directory is copied
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Copy configuration files
COPY config ./config

# Install production dependencies only
RUN npm ci --only=production
```

**File**: `container/Dockerfile:66-74`

### Testing & Verification

**Manual Testing** (confirmed working):
```
User: potato
Bot: [Reacts with 🥔]

User: I love pizza!
Bot: [Reacts with 🍕]

User: That's fire!
Bot: [Reacts with 🔥]
```

**Configured Reactions**:
- potato → 🥔
- pizza → 🍕
- beer → 🍺
- coffee → ☕
- fire/lit → 🔥
- thumbsup/good job → 👍
- laugh/lol/haha → 😂
- heart/love → ❤️

**Log Verification**:
```bash
# Check for successful emoji reaction
ssh root@proxmox-main "docker logs signal-bot 2>&1 | grep -i 'sent.*reaction'"

# Expected output:
# ✅ Sent 🥔 reaction to message
# 🎯 Sent reaction 🥔 to message from +1234567890
```

### Lesson

✅ **ES modules don't have `__dirname`** - use `process.cwd()` or absolute paths
✅ **Always verify JSON-RPC parameter names** against signal-cli documentation
✅ **Dockerfile COPY commands are explicit** - directories won't be included automatically
✅ **Test with actual Signal messages** - logs can confirm reactions sent
✅ **signal-cli reactions use timestamp of target message** - must pass original message timestamp
✅ **Config-driven features are maintainable** - users can add new reactions without code changes

**Parameter Name Patterns in signal-cli**:
- `targetTimestamp` - NOT `targetSentTimestamp`
- `targetAuthor` - Phone number or UUID of message author
- `emoji` - Unicode emoji character
- `groupId` - Optional, for group messages
- `recipient` - Optional, for direct messages

**Deployment Checklist for Config-Based Features**:
1. ✅ Create config file in `container/config/`
2. ✅ Add `COPY config ./config` to Dockerfile
3. ✅ Use production-appropriate paths in code
4. ✅ Verify config file exists in running container
5. ✅ Test feature with actual data

**Files**:
- `container/config/emoji-reactions.json` - Configuration
- `container/src/utils/emoji-reaction-handler.ts` - Handler logic
- `container/src/bot/signal-jsonrpc-client.ts` - JSON-RPC sendReaction method
- `container/src/bot/signal-bot-v2.ts` - Bot integration (lines 461-491)
- `container/Dockerfile` - Config directory copy (line 71)
