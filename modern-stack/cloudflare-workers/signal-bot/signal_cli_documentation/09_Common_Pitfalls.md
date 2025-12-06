# Common Pitfalls

### 1. Forgetting to Subscribe

**Mistake**:
```typescript
await this.rpcClient.connect();
// Oops! Didn't call subscribeReceive()
// Messages won't come through!
```

**Fix**:
```typescript
await this.rpcClient.connect();
await this.rpcClient.subscribeReceive();  // Don't forget!
```

### 2. Wrong Recipient Format

**Mistake**:
```typescript
await rpcClient.sendMessage({
  message: "Hello",
  recipient: "+1234567890",  // ❌ String, should be array
});
```

**Fix**:
```typescript
await rpcClient.sendMessage({
  message: "Hello",
  recipient: ["+1234567890"],  // ✅ Array format
});
```

### 3. Not Handling Reconnections

**Mistake**:
```typescript
// Connection lost... bot stops working forever
```

**Fix**:
```typescript
this.rpcClient.on('disconnected', () => {
  console.log('Connection lost, will auto-reconnect...');
  // Auto-reconnection built into SignalJsonRpcClient
});
```

### 4. Ignoring Daemon Errors

**Mistake**:
```typescript
spawn('signal-cli', ['daemon', ...]);
// Daemon crashes... no handling
```

**Fix**:
```typescript
this.daemonProcess.on('exit', (code) => {
  if (code !== 0) {
    console.error(`Daemon exited with code ${code}`);
    this.emit('daemon-exit', code);
    // Trigger restart logic
  }
});
```

### 5. Not Testing Message Receiving

**Mistake**:
- Only test sending messages
- Assume receiving will "just work"

**Fix**:
- Test `!help` command immediately after deployment
- Monitor logs for "📨 Message from" entries
- Verify `subscribeReceive()` succeeds
