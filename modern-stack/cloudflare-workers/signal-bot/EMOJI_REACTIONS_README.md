# Emoji Reactions Feature

## Overview
The Signal bot now supports automatic emoji reactions to messages containing specific keywords. When someone mentions "potato" in a message, the bot will react with a 🥔 emoji.

## Configuration File
Location: `container/config/emoji-reactions.json`

### Structure
```json
{
  "enabled": true,
  "reactions": [
    {
      "keywords": ["potato", "potatoes", "🥔"],
      "emoji": "🥔",
      "description": "React with potato emoji when someone mentions potato",
      "caseSensitive": false
    }
  ],
  "settings": {
    "matchWholeWord": false,
    "maxReactionsPerMessage": 3,
    "reactToOwnMessages": false,
    "reactToCommands": false,
    "debounceMs": 1000
  }
}
```

### Adding New Reactions
To add a new keyword-to-emoji reaction:

1. Open `container/config/emoji-reactions.json`
2. Add a new entry to the `reactions` array:
```json
{
  "keywords": ["your", "keywords", "here"],
  "emoji": "😀",
  "description": "Description of when to use this reaction",
  "caseSensitive": false
}
```

### Settings Explained
- **enabled**: Master on/off switch for emoji reactions
- **matchWholeWord**: If true, only matches complete words (not substrings)
- **maxReactionsPerMessage**: Limit reactions per message to avoid spam
- **reactToOwnMessages**: Whether bot should react to its own messages
- **reactToCommands**: Whether bot should react to command messages (starting with !)
- **debounceMs**: Minimum time between reactions to prevent duplicate reactions

## Implementation Status

### ✅ Completed
1. Configuration file created (`config/emoji-reactions.json`)
2. Emoji reaction handler utility (`src/utils/emoji-reaction-handler.ts`)
3. JSON-RPC client `sendReaction()` method added
4. Import added to signal-bot-v2.ts

### 🔨 Remaining Work
Need to integrate into message handler in `signal-bot-v2.ts`:

1. Initialize emoji handler in constructor:
```typescript
private emojiReactionHandler: EmojiReactionHandler;

constructor(config: BotConfig, workerApi: WorkerAPIClient) {
  // ... existing code ...
  this.emojiReactionHandler = new EmojiReactionHandler();
}
```

2. Add emoji reaction logic in `handleMessage()` method (after line 450):
```typescript
// Check for emoji reactions (after command handling)
if (messageText && sourceNumber && timestamp) {
  const isOwnMessage = sourceNumber === this.config.phoneNumber;
  const isCommand = messageText.startsWith('!');

  const matchingEmojis = this.emojiReactionHandler.findMatchingEmojis(
    messageText,
    isCommand,
    isOwnMessage
  );

  if (matchingEmojis.length > 0) {
    const messageId = `${sourceNumber}-${timestamp}`;
    if (!this.emojiReactionHandler.shouldDebounce(messageId)) {
      for (const emoji of matchingEmojis) {
        try {
          await this.sendReaction({
            emoji,
            targetAuthor: sourceNumber,
            targetTimestamp: timestamp,
            groupId,
            recipient: groupId ? undefined : sourceNumber,
          });
          console.log(`✅ Sent ${emoji} reaction to message`);
        } catch (error) {
          console.error(`Failed to send ${emoji} reaction:`, error);
        }
      }
    }
  }
}
```

3. Add `sendReaction()` method to SignalBot class:
```typescript
/**
 * Send a reaction to a message
 */
async sendReaction(params: {
  emoji: string;
  targetAuthor: string;
  targetTimestamp: number;
  groupId?: string;
  recipient?: string;
}): Promise<void> {
  if (!this.rpcClient) {
    throw new Error('Bot is not running');
  }

  await this.rpcClient.sendReaction(params);
  console.log(`🎯 Sent reaction ${params.emoji} to message from ${params.targetAuthor}`);
}
```

## Testing

Once integrated, test with these messages:
- "I love potato" → Should get 🥔 reaction
- "Let's get pizza tonight" → Should get 🍕 reaction
- "That's fire!" → Should get 🔥 reaction
- "Good job on that!" → Should get 👍 reaction

## Reloading Configuration

To reload the emoji reactions config without restarting the bot, you can add a command:
```typescript
case '!reloademo ji':
  this.emojiReactionHandler.reloadConfig();
  await this.sendMessage({
    groupId: context.groupId,
    recipient: context.groupId ? undefined : context.sourceNumber,
    message: '✅ Emoji reactions configuration reloaded',
  });
  break;
```

## File Locations
- Config: `container/config/emoji-reactions.json`
- Handler: `container/src/utils/emoji-reaction-handler.ts`
- JSON-RPC method: `container/src/bot/signal-jsonrpc-client.ts` (line 366)
- Bot integration: `container/src/bot/signal-bot-v2.ts` (needs completion)
