# Executive Summary

**Key Learnings**:
- ✅ JSON-RPC TCP mode is superior to spawn-based signal-cli invocation
- ✅ Java 21 is required for signal-cli v0.13.22+
- ✅ `subscribeReceive()` is mandatory for receiving messages in manual mode
- ✅ Cloudflare R2 provides excellent persistent storage for Signal data
- ✅ Multi-stage Docker builds optimize image size and security

**Performance Gains (V1 → V2)**:
- Message send time: 5s → 2s (60% faster)
- No more config file locking issues
- Automatic reconnection capability
- Real-time message streaming
