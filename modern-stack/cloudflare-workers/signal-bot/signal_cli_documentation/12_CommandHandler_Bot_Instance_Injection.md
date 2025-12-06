# CommandHandler Bot Instance Injection

### Problem: !groups Command Failing

**Symptoms**:
```
!groups
→ ❌ Bot instance not available
```

**Root Cause**:
CommandHandler needs access to bot methods like `getGroups()` and `getGroupInfo()`, but `this.bot` was initialized as `null` and never set.

**Code Structure**:
```typescript
// command-handler.ts
export class CommandHandler {
  private bot: any | null = null;  // ← Initialized as null

  constructor(config: BotConfig, workerApi: WorkerAPIClient) {
    this.config = config;
    this.workerApi = workerApi;
    // bot is still null!
  }

  setBotInstance(bot: any): void {  // ← Method exists but never called!
    this.bot = bot;
  }

  private async handleGroups(): Promise<string> {
    if (!this.bot) {  // ← Always true because bot is null!
      return '❌ Bot instance not available';
    }
    const groups = await this.bot.getGroups();  // Never reached
    // ...
  }
}
```

**signal-bot-v2.ts Constructor**:
```typescript
constructor(config: BotConfig, workerApi: WorkerAPIClient) {
  super();
  this.config = config;
  this.workerApi = workerApi;
  this.commandHandler = new CommandHandler(config, workerApi);
  // ❌ Forgot to call: this.commandHandler.setBotInstance(this);
}
```

### Solution

**Fix Applied**:
```typescript
// signal-bot-v2.ts constructor
constructor(config: BotConfig, workerApi: WorkerAPIClient) {
  super();
  this.config = config;
  this.workerApi = workerApi;
  this.commandHandler = new CommandHandler(config, workerApi);
  // ✅ ADDED: Pass bot instance to command handler
  this.commandHandler.setBotInstance(this);
}
```

**File**: `container/src/bot/signal-bot-v2.ts:103`

### Why This Pattern Exists

**Circular Dependency Prevention**:
- SignalBot creates CommandHandler
- CommandHandler needs SignalBot methods
- Can't pass `this` in constructor (not fully initialized yet)
- Solution: Two-phase initialization with `setBotInstance()`

**Alternative Approaches Considered**:

1. ❌ **Pass bot in constructor**: `this` not ready yet
2. ❌ **Pass methods as callbacks**: Too many methods to pass
3. ✅ **Dependency injection after construction**: Clean and safe

### Affected Commands

Commands that need `this.bot`:
- `!groups` - List all Signal groups
- `!addto <group#> @user` - Add users to groups (admin only)
- Any future commands that interact with Signal groups

**Testing**:
```
!groups
→ 📱 Your Signal Groups:

────────────────
1. IrregularChat Community 👑
   👥 3 members

2. Off Topic Guild 👤
   👥 45 members

────────────────
📊 Total: 2 groups
👥 Member slots: 48 (47 unique users)
👑 = Bot has admin rights
👤 = Bot is regular member
```

### Lesson

✅ **Dependency injection is common pattern** for circular dependencies
✅ **Constructor initialization happens in phases** - be mindful of order
✅ **"Instance not available" usually means** dependency wasn't injected
✅ **Test all command paths** after architectural changes
✅ **Two-phase initialization is OK** when done intentionally

**Detection Steps**:
1. See "Instance not available" error
2. Check if setter method exists (`setBotInstance`)
3. Verify setter is called after construction
4. Ensure called in the right constructor (V1 vs V2!)

**Files**:
- `container/src/bot/command-handler.ts:40-42` - setBotInstance method
- `container/src/bot/signal-bot-v2.ts:103` - Injection call
