# JSON-RPC vs Spawn-based Architecture

### V1 Architecture (Spawn-based)

**Implementation**:
```typescript
async sendMessage(params) {
  const process = spawn('signal-cli', [
    '-a', this.config.phoneNumber,
    '--config', this.config.dataDir,
    'send',
    '-m', params.message,
    params.recipient
  ]);

  // Wait for process to complete
  return new Promise((resolve, reject) => {
    process.on('exit', code => {
      code === 0 ? resolve() : reject();
    });
  });
}
```

**Problems**:
1. ❌ **Config File Locking**: Each spawn locks the Signal data directory
2. ❌ **Slow Performance**: ~5 seconds per message (spawn overhead)
3. ❌ **No Concurrent Operations**: Can't send while receiving
4. ❌ **Resource Heavy**: New process for every operation
5. ❌ **No Reconnection**: Manual restart required on failure

### V2 Architecture (JSON-RPC)

**Implementation**:
```typescript
// 1. Start daemon once
signal-cli daemon --tcp localhost:7583 --receive-mode manual

// 2. Connect JSON-RPC client
this.rpcClient = new SignalJsonRpcClient('localhost', 7583);
await this.rpcClient.connect();

// 3. Subscribe to receive messages
await this.rpcClient.subscribeReceive();

// 4. Send messages via JSON-RPC
async sendMessage(params) {
  await this.rpcClient.sendMessage({
    message: params.message,
    recipient: [params.recipient],
  });
}
```

**Benefits**:
1. ✅ **No File Locking**: Daemon owns the config, clients use TCP
2. ✅ **Fast Performance**: ~2 seconds per message (60% improvement)
3. ✅ **Concurrent Operations**: Send and receive simultaneously
4. ✅ **Resource Efficient**: Single daemon process
5. ✅ **Auto-Reconnection**: Built-in reconnection logic

### Lesson

✅ **Always use TCP/JSON-RPC mode for production**
✅ **Spawn-based is OK for one-off CLI operations** only
✅ **JSON-RPC enables real-time bi-directional communication**

**Files**:
- `container/src/bot/signal-jsonrpc-client.ts`
- `container/src/bot/signal-bot.ts`
