# Container Deployment

### Multi-Stage Docker Build

**Strategy**:
```dockerfile
# Stage 1: Build TypeScript
FROM node:20-alpine AS builder
RUN npm ci && npm run build

# Stage 2: Install signal-cli
FROM debian:trixie-slim AS signal-cli
RUN apt-get install openjdk-21-jre-headless wget
RUN wget signal-cli && tar xf

# Stage 3: Runtime
FROM node:20-slim
COPY --from=builder /app/dist ./dist
COPY --from=signal-cli /opt/signal-cli ./signal-cli
RUN npm ci --only=production
```

**Benefits**:
- ✅ **Smaller final image**: ~450MB vs ~1.2GB
- ✅ **No build tools in production**
- ✅ **Better security**: Minimal attack surface
- ✅ **Faster deploys**: Less data to transfer

### Health Checks

**Implementation**:
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
  CMD curl -f http://localhost:8080/health || exit 1
```

**Importance**:
- Docker/Kubernetes can auto-restart unhealthy containers
- Load balancers can remove unhealthy instances
- Monitoring systems can alert on health check failures

### Lesson

✅ **Use multi-stage builds** for production images
✅ **Implement health checks** at both container and app level
✅ **Volume mount Signal data** for persistence
✅ **Use restart policies** (`--restart unless-stopped`)

**File**: `container/Dockerfile`

```