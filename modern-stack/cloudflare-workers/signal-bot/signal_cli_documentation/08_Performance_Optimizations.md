# Performance Optimizations

### Message Send Time

| Version | Method | Time | Notes |
|---------|--------|------|-------|
| V1 | spawn-based | ~5s | Process spawn overhead |
| V2 | JSON-RPC | ~2s | TCP socket, no spawn |

**Improvement**: **60% faster**

### Memory Usage

| Version | Memory | Notes |
|---------|--------|-------|
| V1 | ~420MB | Multiple processes |
| V2 | ~380MB | Single daemon |

**Improvement**: **10% reduction**

### CPU Usage (idle)

| Version | CPU | Notes |
|---------|-----|-------|
| V1 | ~5% | Periodic spawns |
| V2 | ~2% | Event-driven |

**Improvement**: **60% reduction**

### Startup Time

| Version | Time | Notes |
|---------|------|-------|
| V1 | ~20s | Multiple initializations |
| V2 | ~15s | Single daemon start |

**Improvement**: **25% faster**

### Lesson

✅ **JSON-RPC provides significant performance gains**
✅ **Event-driven architecture** reduces CPU usage
✅ **Single long-running process** is more efficient
✅ **Profile before optimizing** - measure real impact
