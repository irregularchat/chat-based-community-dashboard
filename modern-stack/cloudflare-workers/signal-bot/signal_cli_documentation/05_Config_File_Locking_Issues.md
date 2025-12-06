# Config File Locking Issues

### Problem

**Scenario**: Trying to send a message while daemon is running

**Error**:
```
INFO SignalAccount - Config file is in use by another instance, waiting…
```

**Root Cause**:
- Signal CLI uses file-based locking for the config directory
- Only ONE process can access the config at a time
- Spawn-based approach creates conflicts

### Solution

**Use JSON-RPC (V2)**:
```typescript
// ❌ V1: Each operation locks config
spawn('signal-cli', [..., 'send', ...]);  // Waits for lock
spawn('signal-cli', [..., 'receive']);     // Waits for lock

// ✅ V2: Daemon owns config, clients use TCP
signal-cli daemon --tcp localhost:7583    // Daemon holds lock
rpcClient.sendMessage({...});              // No lock needed (TCP)
rpcClient.subscribeReceive();              // No lock needed (TCP)
```

### Lesson

✅ **JSON-RPC eliminates all locking issues**
✅ **Never spawn multiple signal-cli instances** simultaneously
✅ **If you must use spawn**, ensure sequential execution

**Impact**: V1 had frequent lockups, V2 has ZERO locking issues
