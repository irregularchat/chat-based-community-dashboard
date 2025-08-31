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

### 5. Account Registration State Management
**Problem**: Account existed in signal-cli data but wasn't recognized by REST API.

**Root Cause**: Container restart issues and data volume mounting problems.

**Solution**: 
- Implemented proper account existence checking before polling
- Added `checkAccountRegistered()` method to verify API state
- Fresh container start resolved data recognition issues

**Lessons**:
- Always verify external service state before starting dependent services
- Container data persistence can be tricky - test thoroughly
- Implement graceful degradation when dependencies aren't ready

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

## Current Status
✅ REST API integration functional
✅ Registration workflow working (requires fresh captcha)
✅ Bot daemon startup/shutdown working
✅ Message polling disabled until account registered
✅ Enhanced error messages for user guidance
✅ tRPC procedures fully integrated

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