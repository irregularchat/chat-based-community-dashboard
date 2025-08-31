# Signal CLI Bot Integration - Lessons Learned

## Overview
This document captures lessons learned from implementing Signal CLI bot integration with the modern-stack community dashboard. The implementation went through several iterations and challenges, leading to a robust REST API-based solution.

## Major Issues Resolved

### 1. Signal CLI vs REST API Architecture Decision
**Problem**: Initial approach used signal-cli binary directly, leading to complex process management and reliability issues.

**Solution**: Migrated to bbernhard/signal-cli-rest-api Docker container for better stability and easier integration.

**Lessons**:
- REST APIs are more reliable than managing CLI processes directly
- Docker containers provide better isolation and consistency
- HTTP-based communication is easier to debug and monitor

### 2. tRPC Router Integration Missing
**Problem**: "No procedure found on path 'signal.registerPhoneNumber'" error on frontend.

**Root Cause**: Signal router wasn't integrated into main tRPC router at `/Users/sac/Git/chat-based-community-dashboard/modern-stack/src/lib/trpc/root.ts`

**Solution**: Added missing imports and router integration:
```typescript
import { signalRouter } from './routers/signal';
// ...
export const appRouter = createTRPCRouter({
  // ...
  signal: signalRouter,
});
```

**Lessons**:
- Always check that new routers are properly integrated
- Frontend errors about missing procedures often indicate missing router registration
- Test end-to-end integration after adding new tRPC procedures

### 3. Missing tRPC Procedures
**Problem**: Admin interface expected `getHealth` and `getAccountInfo` procedures that didn't exist.

**Solution**: Implemented missing procedures with proper REST API integration:
```typescript
getHealth: moderatorProcedure.query(async () => {
  const baseUrl = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
  // ... health checking logic with REST API calls
})
```

**Lessons**:
- Frontend and backend API contracts must be synchronized
- Use TypeScript to catch missing procedure implementations early
- Implement comprehensive health checks for external service dependencies

### 4. OpenAI Package Missing
**Problem**: Module not found error for 'openai' package causing bot AI features to fail.

**Solution**: Installed OpenAI package with legacy peer deps flag:
```bash
npm install openai --legacy-peer-deps
```

**Lessons**:
- Check all dependencies are properly installed before implementation
- Use `--legacy-peer-deps` flag when version conflicts occur
- Consider making AI features optional to degrade gracefully

### 5. Account Registration State Management & Docker Volume Issues
**Problem**: Account existed in signal-cli data but wasn't recognized by REST API. The account showed as "not registered" despite existing registration data.

**Root Cause**: 
- Multiple Docker volumes with similar names (`signal-cli-data` vs `signal_cli_data`)
- Container was using the wrong/empty volume instead of the one with account data
- The account data (with UUID) was in `modern-stack_signal_cli_data` but container was mounting `modern-stack_signal-cli-data`

**Solution**: 
- Identified the correct volume containing account data using:
  ```bash
  docker volume ls | grep signal
  docker run --rm -v modern-stack_signal_cli_data:/data alpine cat /data/data/accounts.json
  ```
- Updated docker-compose.yml to use correct volume name with underscores:
  ```yaml
  volumes:
    - signal_cli_data:/home/.local/share/signal-cli
  ```
- Restarted container with correct volume mount

**Lessons**:
- Docker volume naming is critical - hyphens vs underscores matter
- Always check existing volumes before creating new ones
- When account data seems missing, check if it's in a different volume
- Use `docker volume ls` and inspect volume contents to diagnose issues
- Container data persistence requires careful volume name management

### 6. Message Polling Before Registration
**Problem**: Bot tried to poll for messages even when account wasn't registered, causing 400 errors.

**Solution**: Added account registration check before starting message polling:
```typescript
const accountExists = await this.checkAccountRegistered();
if (!accountExists) {
  console.log('Account not registered, skipping message polling until registration is complete');
  this.isListening = false;
  return;
}
```

**Lessons**:
- Check preconditions before starting background services
- Provide clear logging for service state decisions
- Fail gracefully when dependencies aren't ready

### 7. Captcha Token Expiration
**Problem**: User registration failing with "Invalid captcha given" error.

**Solution**: Enhanced error handling to provide specific guidance:
```typescript
if (errorData.error?.includes('Invalid captcha given')) {
  throw new Error('Invalid or expired captcha token. Please get a fresh captcha from https://signalcaptchas.org/registration/generate.html');
}
```

**Lessons**:
- Captcha tokens expire quickly - provide clear instructions for renewal
- Enhance error messages to guide users toward solutions
- Link directly to external services users need to complete workflows

## Technical Architecture

### Signal CLI REST API Integration
- **Container**: `bbernhard/signal-cli-rest-api:latest`
- **Port**: 50240 (host) -> 8080 (container)
- **Volume**: `modern-stack_signal_cli_data:/home/.local/share/signal-cli`
- **Health Check**: `GET /v1/health` returns 204 No Content

### Key Endpoints Used
- `GET /v1/accounts` - List registered accounts
- `POST /v1/register/{phoneNumber}` - Register new account with captcha
- `POST /v1/register/{phoneNumber}/verify/{code}` - Verify registration with SMS code
- `GET /v1/health` - Health check endpoint

### File Structure
```
src/lib/trpc/routers/signal.ts - Main tRPC procedures
src/lib/signal-cli/rest-bot-service.ts - REST API bot service
src/app/admin/signal/page.tsx - Registration interface
src/app/api/signal-bot/start/route.ts - Bot daemon startup
src/app/api/signal-bot/stop/route.ts - Bot daemon shutdown
```

## Environment Variables Required
```
SIGNAL_CLI_REST_API_BASE_URL=http://localhost:50240
SIGNAL_BOT_PHONE_NUMBER=+1234567890
OPENAI_ACTIVE=true
OPENAI_API_KEY=sk-...
```

### 8. Signal Bot Message Reception Approaches (Critical Architecture Decision)
**Problem**: Initial confusion about how to receive messages - polling vs webhooks vs WebSockets.

**🔬 DEEP RESEARCH FINDINGS (August 2025)**:

**📋 signal-cli-rest-api Mode Comparison**:
1. **Normal Mode**: 
   - Uses traditional HTTP GET polling via `/v1/receive/<number>`
   - **CRITICAL ISSUE**: Polling returns immediately with empty results `[]` instead of long-polling
   - No persistent connection - just instant empty responses
   - Works with existing account registrations

2. **JSON-RPC Mode**:
   - **No HTTP polling support**: `/v1/receive` endpoint not available
   - **WebSocket required**: Must use `ws://host:port/v1/receive/<number>` 
   - Messages pushed as JSON-RPC notifications
   - **Registration limitation**: Cannot register new numbers (only works in normal mode)
   - **Account compatibility issues**: May not work with existing account data

3. **WebSocket Implementation Issues**:
   - **Production confirmed**: WebSocket connections unstable (Issue #185)
   - **Error pattern**: `websocket: close sent` and frequent disconnections
   - **Environment specific**: Problems reported in Docker/Synology environments

**❌ POLLING DOESN'T WORK - ROOT CAUSE IDENTIFIED**:
- **Expected behavior**: `/v1/receive` should hold connection until messages arrive (long-polling)
- **Actual behavior**: Returns immediately with `[]` (empty array)
- **Impact**: No real-time message reception possible via polling
- **Confirmed**: Both local and production environments exhibit this behavior

**🚨 FUNDAMENTAL ARCHITECTURAL PROBLEM**:
```bash
# This should hang until messages arrive (long-polling):
curl "http://localhost:50240/v1/receive/+1234567890"
# But actually returns immediately:
[] # Empty results, no waiting
```

**🔧 PRODUCTION ARCHITECTURE IMPLICATIONS**:
- **WebSocket approach**: Required but unstable
- **Polling approach**: Fundamentally broken (no long-polling)
- **Hybrid approach**: Must combine unstable WebSocket with CLI fallbacks
- **Registration workflow**: Must stay in normal mode for phone registration

**ATTEMPTS AND FAILURES**:
1. **❌ Short Polling**: Constant requests return `[]` immediately
2. **❌ Long Polling**: `/v1/receive` doesn't implement true long-polling
3. **❌ WebSocket (Normal Mode)**: `/ws` endpoint returns 404 in normal mode
4. **❌ WebSocket (JSON-RPC Mode)**: Unstable connections, registration issues
5. **❌ Efficient Polling**: Still returns `[]` immediately, no efficiency gained

**✅ ACTUAL PRODUCTION SOLUTION** (Based on GitHub Issues Research):
- **AUTO_RECEIVE_SCHEDULE**: Use environment variable with cron schedule
- **Background processing**: signal-cli-rest-api polls internally, stores messages
- **API retrieval**: Application polls for stored messages, not live polling
- **Hybrid messaging**: WebSocket when stable, CLI commands for critical operations

**LESSONS**:
- **signal-cli-rest-api polling is fundamentally broken** - doesn't implement long-polling
- **"Polling doesn't work"** is accurate - API design flaw, not implementation issue
- **WebSocket instability** forces hybrid approaches in production
- **Mode switching required**: Normal for registration, JSON-RPC for WebSocket (if stable)
- **Production uses workarounds**: AUTO_RECEIVE_SCHEDULE + background processing
- **Real-time messaging**: Currently not reliably achievable with this API

### 9. Production Deployment Critical Insights
**Problem**: Local development bot doesn't match production requirements and architecture.

**CRITICAL PRODUCTION DISCOVERIES** (from remote production analysis):

**🚨 Group Messaging Bug in signal-cli-rest-api**:
- **Issue**: bbernhard/signal-cli-rest-api has a critical bug preventing group messaging
- **Symptoms**: All `/v1/send` and `/v2/send` endpoints return 400 errors for group recipients
- **Tested formats that fail**:
  - `recipients: ["group.ID"]`
  - `recipients: [groupId]` 
  - `group_id: "groupId"` with empty recipients
- **Root cause**: API doesn't properly handle group recipient formatting
- **Production workaround**: Hybrid approach using direct signal-cli commands

**🔧 Production Architecture Pattern**:
```javascript
// Production solution for group messaging
async sendGroupMessage(groupId, message) {
  // 1. Stop REST API container (prevents file locking)
  await docker.stop('signal-cli-rest-api');
  // 2. Execute signal-cli send command directly
  await execCommand(`signal-cli send -g ${groupId} -m "${message}"`);
  // 3. Restart REST API container
  await docker.start('signal-cli-rest-api');
  // 4. Reconnect WebSocket for receiving
  await reconnectWebSocket();
}
```

**📱 WebSocket Architecture Works Perfectly**:
- **Discovery**: WebSocket receiving is stable and reliable
- **Implementation**: Use `ws://localhost:50240/v1/receive/${phone}` for real-time message reception
- **Benefit**: No polling needed, immediate message processing
- **Production usage**: All message reception through WebSocket, group sending through CLI

**🆔 Group ID Format Nightmare** (CRITICAL):
- **Issue**: Signal sends same group ID in 3 different formats randomly
- **Formats**:
  1. Raw Base64: `PjJCT6d4nrF0/BZOs39ECX/lZkcHPbi65JU8B6kgw6s=`
  2. URL-safe Base64: `UGpKQ1Q2ZDRuckYwL0JaT3MzOUVDWC9sWmtjSFBiaTY1SlU4QjZrZ3c2cz0=`
  3. With prefix: `group.UGpKQ1Q2ZDRuckYwL0JaT3MzOUVDWC9sWmtjSFBiaTY1SlU4QjZrZ3c2cz0=`
- **Impact**: Commands randomly fail due to ID mismatches
- **Production solution**: Group ID mapping module with all known formats

**🧩 Plugin-Based Command System**:
- **Architecture**: Modular plugin system with 7 categories
- **Categories**: AI, knowledge, onboarding, utilities, tracking, help, base
- **Storage**: SQLite database for sessions and plugin data
- **Commands**: 50+ commands with permission-based access control
- **Pattern**: BaseCommand class with admin/group/DM restrictions

**Lessons**:
- Signal CLI REST API group messaging is fundamentally broken
- Production requires hybrid WebSocket + direct CLI approach
- Group ID normalization is absolutely critical
- Plugin architecture scales much better than monolithic commands
- SQLite provides better persistence than in-memory storage
- WebSocket reconnection and health monitoring are essential

## Current Status
✅ REST API integration functional for direct messages
❌ REST API group messaging confirmed broken (production blocker)
✅ WebSocket receiving architecture validated by production
✅ Registration workflow working (requires fresh captcha)
✅ Bot daemon startup/shutdown working
✅ Enhanced error messages for user guidance
✅ tRPC procedures fully integrated
✅ Signal bot working with proper volume configuration
✅ AI-powered responses working with OpenAI integration
🔄 Investigating production hybrid architecture implementation

## Next Steps
1. Complete account registration with fresh captcha token
2. Test message polling once account is registered
3. Verify all bot commands work properly (!help, !ping, !ai, etc.)
4. Monitor for any additional edge cases

## Testing Workflow
1. Get fresh captcha from https://signalcaptchas.org/registration/generate.html
2. Use admin interface at /admin/signal to register
3. Enter SMS verification code
4. Start bot daemon through interface
5. Test bot commands via Signal app

## Key Learnings Summary
- Always integrate new routers into main tRPC configuration
- Use Docker containers for external service dependencies
- Implement comprehensive health checks and state validation
- Provide clear error messages with actionable guidance
- Check preconditions before starting background services
- Test end-to-end workflows thoroughly
- Keep captcha tokens fresh for registration processes