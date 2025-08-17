# Lessons Learned

## Signal CLI Integration (2025-08-17)

### Overview
Successfully integrated Signal CLI REST API for sending/receiving Signal messages through the admin dashboard.

### Key Challenges & Solutions

#### 1. Phone Number Registration & PIN Lock Issues
**Problem**: Signal account got PIN locked with message "Account is pin locked, but pin data has been deleted on the server"
**Solution**: 
- Restart Signal CLI container to clear cached state
- Implement better error handling for PIN lock scenarios
- Add user-friendly guidance in UI for recovery

#### 2. QR Code Generation Binary Data Handling
**Problem**: Runtime error "Failed to decode path param(s)" when generating QR codes
**Root Cause**: QR code API returns binary PNG data, but code tried to open it as URL with window.open()
**Solution**:
```typescript
// Convert binary to base64 data URL
const response = await this.httpClient.get(url, { responseType: 'arraybuffer' });
const base64 = Buffer.from(response.data).toString('base64');
const dataUrl = `data:image/png;base64,${base64}`;
```

#### 3. Account Status Checking API Limitations
**Problem**: `/v1/accounts/{number}` endpoint returns 404 even for registered accounts
**Solution**: Fallback to checking accounts list
```typescript
const accountsResponse = await this.httpClient.get('/v1/accounts');
const accounts = accountsResponse.data || [];
const isRegistered = accounts.includes(phoneNumber);
```

#### 4. tRPC Method Type Mismatches
**Problem**: 405 Method Not Allowed - generateQRCode defined as query but called as mutation
**Solution**: Changed from `.query()` to `.mutation()` to match client usage

#### 5. Device Linking vs Direct Registration
**Learning**: Device linking QR codes are for adding Signal CLI as secondary device to existing Signal account. For standalone bot operation, direct phone number registration is needed.

### Best Practices Discovered

1. **Environment Configuration**
   - Keep phone numbers in E.164 format (+1234567890)
   - Use separate phone number for Signal CLI bot
   - Store sensitive configs in .env.local

2. **Error Handling**
   - Provide specific error messages for common scenarios
   - Implement graceful fallbacks for API limitations
   - Add retry logic for transient failures

3. **User Experience**
   - Show clear registration status indicators
   - Provide step-by-step guidance for captcha process
   - Display QR codes inline instead of popups
   - Add visual feedback for all async operations

4. **Docker Container Management**
   - Use health checks to monitor container status
   - Mount volumes for persistent data when needed
   - Implement proper restart policies

### Signal CLI REST API Insights

1. **Available Endpoints**:
   - `/v1/register/{number}` - Register new phone number
   - `/v1/register/{number}/verify/{code}` - Verify with SMS code
   - `/v2/send` - Send messages (supports groups, attachments)
   - `/v1/receive/{number}` - Get received messages
   - `/v1/qrcodelink` - Generate device linking QR code
   - `/v1/profiles/{number}` - Update profile (name, avatar)

2. **API Quirks**:
   - Account details endpoint often returns 404
   - Must include device_name parameter for QR generation
   - Captcha required for new registrations
   - Profile updates use PUT method

3. **Message Sending Requirements**:
   - Phone number must be registered
   - Recipients array for v2/send endpoint
   - International format required for all numbers

### Performance Considerations

- Signal CLI takes 1-8 seconds for operations
- QR code generation ~1.3 seconds
- Message sending ~8 seconds initially (includes encryption setup)
- Subsequent messages faster (~1-2 seconds)

### Security Notes

1. Never expose Signal CLI API directly to internet
2. Use authentication for admin endpoints
3. Validate and normalize all phone numbers
4. Don't log sensitive message content
5. Implement rate limiting for message sending

### Future Improvements Identified

1. **Profile Management**: ✅ Added UI for setting bot name and avatar
2. **Username Support**: ⚠️ Attempted but blocked by Signal CLI limitations (see below)
3. **Two-way Conversations**: ✅ Implemented message threads with history
4. **Message History**: ✅ Store and display conversation history
5. **Bulk Operations**: Support sending to multiple recipients
6. **Media Support**: Handle image/file attachments
7. **Group Management**: Create and manage Signal groups
8. **Delivery Tracking**: Show read receipts and delivery status

### Signal Username Limitation (2025-08-17)

**Issue**: Signal usernames (format: username.123) are not yet supported by signal-cli REST API v0.13.18

**Details**:
- Signal introduced usernames in 2024 as a privacy feature
- The signal-cli documentation mentions `u:` prefix for usernames
- When attempting to send to `u:sac.159`, the API returns:
  ```
  java.lang.NullPointerException: Cannot invoke "RecipientId.id()" because "recipientId" is null
  ```
- This indicates the username resolution is not implemented in signal-cli

**Workaround**: 
- Continue using phone numbers for messaging
- UI shows "not yet supported" message when username toggle is enabled
- Code is prepared for future support (commented out, ready to re-enable)

**Action Items**:
- Monitor signal-cli releases for username support
- Test with newer versions when available
- Re-enable username code when upstream support is added

## Matrix User Search and Multi-Select Implementation (2024-08-16)

### Issue Description
The search functionality in Matrix user dropdowns wasn't working - users could see the list but searching/filtering had no effect. Additionally, there was a need to select and process multiple users at once for bulk operations.

### Root Causes
1. **Data Format Mismatch**: API returned `user_id` (snake_case) but frontend expected `userId` (camelCase)
2. **Event Propagation**: Search input events were being captured by the Select component
3. **Missing Database Columns**: Signal verification fields referenced in code didn't exist in database
4. **Single User Limitation**: Original implementation only supported one user at a time

### Solution Implemented

#### 1. Fixed Data Format Consistency
```typescript
// In matrix router - convert to camelCase for frontend
const formattedUsers = users.map(user => ({
  userId: user.user_id,           // was user_id
  displayName: user.display_name, // was display_name
  avatarUrl: user.avatar_url,     // was avatar_url
  isSignalUser: user.is_signal_user
}));
```

#### 2. Proper Event Handling in Dropdowns
```typescript
// Stop propagation to prevent Select from interfering
<Input
  onChange={(e) => {
    e.stopPropagation();
    setInviteUserSearch(e.target.value);
  }}
  onKeyDown={(e) => {
    e.stopPropagation();
    if (e.key === 'Enter') e.preventDefault();
  }}
/>
```

#### 3. Multi-Select UI Implementation
- Added state arrays for tracking multiple selected users
- Visual badges show selected users with click-to-remove
- Dynamic button text shows count of users being processed
- Automatic switching between single and batch operations

#### 4. Batch API Operations
Created new endpoints for processing multiple users:
- `inviteUsersToRooms`: Invite multiple users to multiple rooms
- `removeUsersFromRooms`: Remove multiple users from multiple rooms

### Key Learning Points

#### API Data Contract Consistency
- **Always maintain consistent naming conventions** between API and frontend
- **Use TypeScript interfaces** to catch mismatches early
- **Transform at API boundary** rather than throughout the codebase

#### React Select Component Event Handling
- **Event bubbling issues** in nested interactive elements require stopPropagation
- **Custom search in Select** needs careful event management
- **Consider alternatives** like Combobox for complex search needs

#### Database Schema Management
- **Always run migrations** before using new fields
- **Use Prisma generate** after schema changes
- **Comment out fields temporarily** if migration isn't ready yet

#### UX Improvements for Bulk Operations
- **Multi-select saves time** for repetitive operations
- **Visual feedback important** - show selected items clearly
- **Batch operations** reduce API calls and improve performance
- **Smart fallback** - use single operation for one item, batch for multiple

### Code Patterns

```typescript
// Good: Handle both single and multiple selections
const usersToProcess = selectedUsers.length > 0 ? selectedUsers : 
                       manualInput ? [manualInput] : [];

if (usersToProcess.length > 1) {
  await batchMutation.mutateAsync({ userIds: usersToProcess });
} else {
  await singleMutation.mutateAsync({ userId: usersToProcess[0] });
}
```

## Matrix Room Display and SDK Bundling Issues (2024-08-16)

### Issue Description
Matrix rooms with >10 members were not displaying in the UI. Additionally, the Matrix SDK was causing "Multiple entrypoints detected" bundling errors, preventing the Matrix client from initializing properly.

### Root Causes
1. **SDK Bundling Issue**: The matrix-js-sdk was being imported multiple times, causing Next.js bundling conflicts
2. **Service Configuration Check**: The `isConfigured()` method returned false when the Matrix client failed to initialize
3. **Room Data Source**: Duplicate rooms were being shown - configured rooms from .env (with 0 members) and cached rooms from database

### Solution Implemented

#### 1. Fixed Matrix SDK Initialization
- Added fallback mechanism when SDK wrapper fails
- Modified `isConfigured()` to return true if config exists, even if client fails
- This allows cached rooms to be fetched from database even when SDK has issues

#### 2. Database Caching Strategy
- Rooms are cached in the MatrixRoom table with:
  - Room ID, name, topic
  - Member count (actual numbers from Matrix server)
  - Last synced timestamp
- Cache is queried first, avoiding repeated Matrix API calls
- Periodic sync (every 12 hours) keeps data fresh

#### 3. Removed .env Room Configurations
- Commented out MATRIX_ROOM_IDS_NAME_CATEGORY variable
- Changed default `includeConfigured` to false
- Now using only cached/indexed rooms from database

### Key Learning Points

#### Database Caching for External Services
- **Cache expensive API calls**: Matrix room queries are cached in database
- **Include metadata**: Store room ID, name, member count for efficient filtering
- **Periodic updates**: Sync every 12 hours to keep data fresh
- **Fallback gracefully**: Use cache when external service fails

#### SDK Bundling in Next.js
- Dynamic imports can cause "multiple entrypoints" errors
- Implement fallback mechanisms for SDK initialization failures
- Service configuration checks should not depend solely on client initialization

#### Room Data Management Pattern
```typescript
// Good: Use cached data with periodic sync
const rooms = await cacheService.getCachedRooms();
if (rooms.length === 0 && matrixClient) {
  // Fallback to direct fetch if cache empty
  const freshRooms = await matrixClient.getRooms();
  await cacheService.updateRooms(freshRooms);
}

// Bad: Always fetching from Matrix API
const rooms = await matrixClient.getRooms(); // Expensive and fails if client not initialized
```

### Results
- Successfully displaying 40+ cached rooms with actual member counts
- Eliminated duplicate rooms with 0 members from .env
- Matrix functionality works even when SDK fails to initialize
- Improved performance by using database cache instead of repeated API calls

---

## Configuration Status Display Fix (Previous Issue)

## Issue Description
The admin configuration page was showing all services (Matrix, Authentik, Discourse, SMTP, AI APIs) as "Not Configured" even though they were properly configured via environment variables and working correctly.

## Root Cause
The configuration page was only checking database settings (`allSettings?.settings?.[configKey]`) rather than checking the actual service status from environment variables and service instances.

## Solution Implemented

### 1. Added Service Configuration Status API
- Created `getServicesConfig` endpoint in settings router
- Checks actual service instances and environment variables
- Returns real-time configuration status for all services

### 2. Updated Configuration Page Logic
- Modified `isServiceConfigured` helper function to check actual service status
- Added service-specific checks:
  - **Matrix**: Uses `matrixConfig?.isConfigured` from Matrix service
  - **Authentik**: Uses `authentikService.isConfigured()`
  - **Discourse**: Checks environment variables directly
  - **SMTP**: Uses `emailService.isConfigured()`
  - **AI APIs**: Checks for API keys in environment

### 3. Enhanced Display Information
- Shows configuration source (Environment Variables vs Database Settings)
- Displays actual configuration values from running services
- Provides real-time status updates

## Key Learning Points

### Environment Variable Configuration Priority
- Services should be configured primarily via environment variables
- Database settings should be secondary/fallback configuration
- Admin UI should reflect actual service status, not just database records

### Service Configuration Patterns
1. **Check actual service instances** for configuration status
2. **Validate environment variables** at runtime
3. **Display configuration source** to users for transparency
4. **Avoid database-only configuration checks** when services use env vars

### Implementation Pattern
```typescript
// Bad: Only checking database
const isConfigured = !!allSettings?.settings?.[configKey];

// Good: Checking actual service status
const isConfigured = serviceInstance.isConfigured();
```

## Files Modified
- `src/lib/trpc/routers/settings.ts` - Added getServicesConfig endpoint
- `src/app/admin/configuration/page.tsx` - Updated configuration status logic
- Configuration display sections for all services

## Testing Approach
- Created test endpoint `/api/test-configs` to verify all services
- Confirmed all services show as configured: ✅
- Verified configuration page displays correct status in browser

## Prevention for Future
1. Always check actual service status rather than just database settings
2. Create API endpoints to verify service configuration in real-time
3. Test configuration display with actual environment variable setup
4. Document configuration sources clearly in the UI

## Related Issues
- Database connection issues required proper `.env.local` setup
- Matrix SDK conflicts in API routes (resolved by avoiding direct imports)
- Authentication setup needed admin user creation script

## Matrix Sync Database Tables Issue

### Problem
Matrix sync failed with error: "The table `public.matrix_rooms` does not exist in the current database"

### Root Cause
Prisma migrations were out of sync, causing Matrix cache tables to not be created in the database despite being defined in the schema.

### Solution
1. Force reset and push schema: `npx prisma db push --force-reset`
2. This created all necessary tables including:
   - `matrix_users`
   - `matrix_rooms`
   - `MatrixRoomMembership`
3. Recreate admin user after database reset

### Prevention
- Always run `npx prisma db push` or `npx prisma migrate dev` after schema changes
- Check migration status before deployment
- Ensure DATABASE_URL is properly set when running migrations

## React State Management Issues

### Problem 1: Infinite Loop in useEffect
Component had `useEffect` that was setting state from query data that gets recreated on every render, causing infinite re-renders.

### Root Cause
The tRPC query returns a new array reference on each render even with the same data, triggering useEffect dependencies.

### Solution
Remove unnecessary state duplication - directly use the query data instead of copying it to local state.

```typescript
// Bad: Causes infinite loop
const { data: matrixUsersData = [] } = trpc.matrix.getUsers.useQuery();
const [matrixUsers, setMatrixUsers] = useState([]);
useEffect(() => {
  setMatrixUsers(matrixUsersData); // Infinite loop!
}, [matrixUsersData]);

// Good: Direct usage
const { data: matrixUsers = [] } = trpc.matrix.getUsers.useQuery();
```

### Problem 2: Select Component Empty String Values
React Select components throw error when using empty string as a value because it's reserved for clearing selection.

### Solution
Use a non-empty string like "all" for the default/all option:

```typescript
// Bad
const [category, setCategory] = useState('');
<SelectItem value="">All Categories</SelectItem>

// Good
const [category, setCategory] = useState('all');
<SelectItem value="all">All Categories</SelectItem>
// Update query to handle 'all' value
category: category === 'all' ? undefined : category
```

### Prevention
- Avoid duplicating query data in local state
- Never use empty strings as Select option values
- Use meaningful default values like 'all', 'none', etc.

## Matrix User Sync Issues

### Problem
Matrix user sync returns 0 users and 0 rooms, showing "No Matrix users found" in the UI.

### Root Cause
The Matrix bot account (@bot.irregularchat:irregularchat.com) needs to be joined to Matrix rooms to be able to see users and room membership. The bot can only sync data from rooms it has access to.

### Solution
1. **Join the bot to Matrix rooms**: The bot account must be invited to and join the Matrix rooms you want to sync users from
2. **Check bot permissions**: Ensure the bot has appropriate permissions in the rooms
3. **Verify room membership**: The sync only processes rooms with more than the minimum member count (default 10)

### Troubleshooting Steps
1. Check if Matrix service is configured: `Matrix service initialized successfully` in logs
2. Verify bot credentials are correct in .env.local
3. Ensure the bot account is joined to at least one room
4. Check the minimum room member setting: `MATRIX_MIN_ROOM_MEMBERS` (default 10)

### Prevention
- Document that the Matrix bot must be joined to rooms before sync will work
- Add a check to warn if bot has no rooms joined
- Consider adding a "join room" feature in the admin panel
- Provide clear error messages when sync finds no rooms

## Matrix Direct Message Encryption Error

### Problem
Direct messages fail with error: "This room is configured to use encryption, but your client does not support encryption." Messages show as "sent successfully" but users don't receive them.

### Root Cause
The Matrix service was configured with encryption disabled (`🔐 Matrix encryption DISABLED`), but Signal bridge rooms require encryption. The client attempts to send messages to encrypted rooms without encryption support, causing silent failures.

### Solution
1. **Disable encryption** in Matrix configuration to avoid encrypted room conflicts:
   ```env
   MATRIX_ENABLE_ENCRYPTION=false
   ```
2. **Use fallback messaging approach** that avoids encrypted Signal bridge rooms
3. **Install encryption dependencies** if encryption is needed:
   ```bash
   npm install @matrix-org/olm
   mkdir -p public/olm
   cp node_modules/@matrix-org/olm/olm.wasm public/olm/
   ```

### Key Success Indicators
When working correctly, logs show:
- `✅ BRIDGE: Found Signal chat room: !roomId`
- `✅ ENCRYPTION: Main message sent successfully: $eventId`
- `Message sent successfully to @user:domain.com in room !roomId`

### Troubleshooting Steps
1. Check Matrix encryption status in logs: `🔐 Matrix encryption ENABLED/DISABLED`
2. Verify Signal bridge room access without encryption conflicts
3. Monitor message sending logs for successful event IDs
4. Test with both Signal users and regular Matrix users

### Prevention
- Configure Matrix encryption consistently with target room requirements
- Implement proper error handling for encryption mismatches
- Add logging for successful message delivery confirmation
- Test direct messaging with both encrypted and non-encrypted scenarios

## Matrix SDK Multiple Entrypoints Bundling Error

### Problem
Matrix sync and other Matrix operations fail with bundling error: "Multiple matrix-js-sdk entrypoints detected!" causing 500 errors on tRPC API calls.

### Root Cause
Both `matrix.ts` and `user.ts` tRPC routers were importing `matrixService` from `@/lib/matrix` at the top level, causing Turbo/Webpack to detect multiple entrypoints for the matrix-js-sdk library during bundling.

### Solution
Use dynamic imports for Matrix service in tRPC routers instead of top-level imports:

```typescript
// Bad: Top-level import causes bundling conflicts
import { matrixService } from '@/lib/matrix';

// Good: Dynamic import avoids bundling conflicts
export const someEndpoint = procedure.query(async ({ ctx }) => {
  const { matrixService } = await import('@/lib/matrix');
  return matrixService.someMethod();
});
```

### Key Success Indicators
When working correctly, logs show:
- `Matrix service initialized successfully` without SDK errors
- API endpoints return proper 401/403 auth errors instead of 500 server errors
- No "Multiple matrix-js-sdk entrypoints detected!" errors in stderr

### Files Modified
- `src/lib/trpc/routers/matrix.ts` - Updated getConfig and syncMatrixUsers functions
- `src/lib/trpc/routers/user.ts` - Updated Matrix welcome message functionality

### Troubleshooting Steps
1. Check for multiple imports of `@/lib/matrix` across tRPC routers
2. Look for "Multiple matrix-js-sdk entrypoints detected!" in build logs
3. Convert top-level Matrix imports to dynamic imports in API routes
4. Test API endpoints return auth errors instead of 500 server errors

### Prevention
- Use dynamic imports for heavy libraries in API routes
- Avoid importing Matrix SDK directly in multiple modules
- Centralize Matrix service access through single entry point
- Test bundling with development server after Matrix-related changes

## Admin Message Import Error Fix (2024-08-16)

### Problem
"Failed to send message to admin" error with 500 status when trying to send messages to the INDOC room. Console showed `ReferenceError: matrixService is not defined`.

### Root Cause
The user router (`src/lib/trpc/routers/user.ts`) was using `matrixService` without importing it. The service was being referenced in the admin message functionality at line 1794 but the import statement was missing.

### Solution
Added dynamic import for matrixService before usage:

```typescript
// Added this line before using matrixService
const { matrixService } = await import('@/lib/matrix');
if (matrixService.isConfigured()) {
  const indocRoom = process.env.MATRIX_INDOC_ROOM_ID || process.env.MATRIX_ADMIN_ROOM_ID;
  if (indocRoom) {
    await matrixService.sendRoomMessage(indocRoom, matrixMessage);
  }
}
```

### Key Learning Points

#### Import Before Use Pattern
- **Always import services** before using them in tRPC procedures
- **Use dynamic imports** for Matrix service to avoid bundling conflicts
- **Check for undefined services** can indicate missing imports

#### Error Diagnosis
- **500 errors in tRPC** often indicate server-side code issues
- **ReferenceError messages** clearly indicate missing imports
- **Check network tab** for detailed error messages in API responses

### Prevention
- Always import required services at the top of procedure functions
- Use TypeScript to catch undefined references during development
- Test admin functionality after Matrix service refactoring
- Review all tRPC procedures that reference external services

## Signal Verification Bypass Fix (2024-08-16)

### Problem
Signal verification was failing with "Failed to send verification code via Signal" and 500 errors. The issue was that `matrixService.isConfigured()` returned false due to Matrix SDK bundling issues ("Multiple matrix-js-sdk entrypoints detected!"), causing Signal verification to be blocked.

### Root Cause
The Signal verification code was checking `matrixService.isConfigured()` which relies on successful Matrix client initialization. However, the SDK bundling conflicts prevented client initialization, even though the environment variables and Signal bridge functionality were properly configured.

### Solution
Bypass the `isConfigured()` check by directly validating environment variables:

```typescript
// Before: Relied on SDK initialization
if (matrixService.isConfigured()) {
  const result = await matrixService.sendSignalMessageByPhone(phoneNumber, message);
}

// After: Check environment variables directly
const homeserver = process.env.MATRIX_HOMESERVER;
const accessToken = process.env.MATRIX_ACCESS_TOKEN;
const userId = process.env.MATRIX_USER_ID;
const signalBridgeRoom = process.env.MATRIX_SIGNAL_BRIDGE_ROOM_ID;

if (homeserver && accessToken && userId && signalBridgeRoom) {
  const result = await matrixService.sendSignalMessageByPhone(phoneNumber, message);
}
```

### Key Learning Points

#### Environment Variable Validation Pattern
- **Check environment variables directly** when SDK initialization is unreliable
- **Validate all required variables** before attempting service operations
- **Provide detailed logging** about missing configuration

#### SDK Bundling Workarounds
- **Don't rely solely on isConfigured()** for service availability
- **Use fallback validation methods** when SDK has initialization issues
- **Service functionality can work** even when client initialization fails

#### Signal Verification Flow
- Signal verification uses Matrix bot → Signal bridge → phone number resolution
- Requires MATRIX_HOMESERVER, MATRIX_ACCESS_TOKEN, MATRIX_USER_ID, MATRIX_SIGNAL_BRIDGE_ROOM_ID
- Bot sends `resolve-identifier +phone` command to Signal bridge room
- Bridge responds with Signal UUID, then bot messages `@signal_{UUID}:domain`

### Prevention
- Always check environment variables directly for critical service operations
- Don't block functionality based solely on SDK initialization status
- Test Signal verification with actual phone numbers during development
- Monitor Signal bridge room for successful phone → UUID resolution

## Signal CLI Direct Integration Implementation (2024-08-16)

### Project Overview
Successfully implemented a comprehensive Signal CLI REST API integration to replace Matrix Signal bridge functions with direct Signal CLI operations. This provides better reliability, control, and independence from Matrix SDK bundling issues.

### Solution Architecture

#### 1. Infrastructure Setup (Phase 1)
- **Docker Compose Integration**: Added `bbernhard/signal-cli-rest-api` container with proper health checks
- **Environment Configuration**: Complete Signal CLI settings in `.env.local`
- **Service Architecture**: Three-layer approach:
  - `SignalBotService` - High-level business logic
  - `SignalApiClient` - HTTP client wrapper with logging
  - Type definitions with proper error classes

```yaml
# Docker Compose configuration
signal-cli-rest-api:
  image: bbernhard/signal-cli-rest-api:latest
  environment:
    - MODE=normal
    - SIGNAL_CLI_UID=1000
    - SIGNAL_CLI_GID=1000
  volumes:
    - signal_cli_data:/home/.local/share/signal-cli
  networks:
    - dashboard-network
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:8080/v1/health"]
    interval: 30s
    timeout: 10s
    retries: 3
```

#### 2. Core Service Development (Phase 2)
- **tRPC Integration**: Comprehensive router with admin and public endpoints
- **Phone Number Management**: Registration, verification, and validation
- **Message Operations**: Single and bulk messaging with proper error handling
- **Health Monitoring**: Real-time service status and configuration checks

### Key Technical Patterns

#### 1. Service Layer Architecture
```typescript
// High-level service class pattern
export class SignalBotService {
  private apiClient: SignalApiClient;
  private config: SignalBotConfig;
  
  constructor(config?: SignalBotConfig) {
    this.config = config || this.loadConfigFromEnv();
    this.apiClient = new SignalApiClient(this.config);
  }
  
  public async sendMessage(phoneNumber: string, message: string): Promise<SignalResult> {
    // Business logic with validation and error handling
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    if (!normalizedPhone.isValid) {
      throw new SignalMessageError(`Invalid phone number: ${phoneNumber}`);
    }
    return await this.apiClient.sendMessage(this.config.phoneNumber, signalMessage);
  }
}
```

#### 2. HTTP Client with Interceptors
```typescript
// API client with comprehensive logging
export class SignalApiClient {
  constructor(config: SignalBotConfig) {
    this.httpClient = axios.create({
      baseURL: config.apiUrl,
      timeout: config.timeout,
    });
    
    // Request/response interceptors for debugging
    this.httpClient.interceptors.request.use(
      (config) => console.log(`📤 Signal API Request: ${config.method?.toUpperCase()} ${config.url}`),
      (error) => Promise.reject(new SignalConnectionError(`Signal API error: ${error.message}`))
    );
  }
}
```

#### 3. tRPC Router Implementation
```typescript
// Comprehensive tRPC endpoints
export const signalRouter = router({
  // Admin endpoints for registration/configuration
  registerPhoneNumber: adminProcedure
    .input(z.object({ phoneNumber: z.string().min(10), useVoice: z.boolean().default(false) }))
    .mutation(async ({ input, ctx }) => {
      const signalBot = new SignalBotService();
      await signalBot.registerPhoneNumber(input.phoneNumber, input.useVoice);
      
      // Log admin event for audit trail
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'signal_registration_initiated',
          username: ctx.session.user.username || 'unknown',
          details: `Initiated Signal registration for phone ${input.phoneNumber}`,
        },
      });
    }),
    
  // Public endpoints for user verification
  sendVerificationCode: publicProcedure
    .input(z.object({ phoneNumber: z.string().min(10) }))
    .mutation(async ({ input, ctx }) => {
      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
      
      // Store in database with expiration
      await ctx.prisma.signalVerification.create({
        data: {
          phoneNumber: normalizedPhone.normalized,
          code: verificationCode,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        },
      });
      
      // Send via Signal CLI
      await signalBot.sendMessage(input.phoneNumber, `Your verification code is: ${verificationCode}`);
    }),
});
```

### Admin Interface Implementation

#### 1. Comprehensive Management UI
- **Real-time Status Monitoring**: Service health, registration status, API response times
- **Registration Workflow**: Phone number registration and verification forms
- **Message Testing**: Send messages to single or multiple recipients
- **Configuration Display**: Current settings and account information

#### 2. Tabbed Interface Pattern
```typescript
// React component with comprehensive tabs
export default function AdminSignalPage() {
  const [activeTab, setActiveTab] = useState('status');
  
  // Auto-refresh health status every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => refetchHealth(), 30000);
    return () => clearInterval(interval);
  }, [refetchHealth]);
  
  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="status">Status</TabsTrigger>
        <TabsTrigger value="registration">Registration</TabsTrigger>
        <TabsTrigger value="messaging">Messaging</TabsTrigger>
        <TabsTrigger value="tools">Tools</TabsTrigger>
      </TabsList>
      {/* Tab content with forms and status displays */}
    </Tabs>
  );
}
```

### Database Schema Integration

#### 1. Verification Table Design
```prisma
// Simple verification for public API
model SignalVerification {
  id          Int       @id @default(autoincrement())
  phoneNumber String    @map("phone_number")
  code        String    // Plain text verification code (short-lived)
  expiresAt   DateTime  @map("expires_at")
  verifiedAt  DateTime? @map("verified_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  
  @@index([phoneNumber])
  @@index([expiresAt])
  @@map("signal_verifications")
}
```

### Key Learning Points

#### 1. Docker Container Integration
- **Health checks are essential** for proper service orchestration
- **Volume mapping required** for Signal CLI data persistence
- **Internal networking** allows services to communicate without exposing ports
- **Port conflicts** need to be handled gracefully in development

#### 2. Service Layer Design Patterns
- **Three-layer architecture** provides clean separation of concerns
- **Configuration loading** should prioritize environment variables
- **Error classes** enable specific error handling at different layers
- **Phone number normalization** is critical for international compatibility

#### 3. tRPC Integration Best Practices
- **Separate admin and public endpoints** with appropriate authentication
- **Input validation** with Zod schemas prevents malformed requests
- **Audit logging** for admin operations provides accountability
- **Error handling** with TRPCError provides proper HTTP status codes

#### 4. Admin UI Patterns
- **Real-time status monitoring** improves operational visibility
- **Auto-refresh mechanisms** keep status information current
- **Tabbed interfaces** organize complex functionality logically
- **Form validation** prevents user errors and improves UX

#### 5. Health Check Implementation
```typescript
// Multi-endpoint health check pattern
export async function GET(request: NextRequest) {
  const healthResults: any = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {},
  };

  // Check database health
  const dbHealth = await checkDatabaseHealth();
  healthResults.services.database = {
    status: dbHealth.healthy ? 'healthy' : 'unhealthy',
    responseTime: dbHealth.responseTime,
  };

  // Check Signal CLI health if enabled
  const signalBot = new SignalBotService();
  if (signalBot.isConfigured()) {
    const signalHealth = await signalBot.checkServiceHealth();
    healthResults.services.signalCli = {
      status: signalHealth.containerStatus === 'running' ? 'healthy' : 'unhealthy',
      containerStatus: signalHealth.containerStatus,
      registrationStatus: signalHealth.registrationStatus,
    };
  }

  // Determine overall health
  const unhealthyServices = Object.entries(healthResults.services)
    .filter(([, service]: [string, any]) => service.status === 'unhealthy')
    .map(([name]) => name);

  if (unhealthyServices.length > 0) {
    healthResults.status = 'degraded';
  }

  return NextResponse.json(healthResults, { 
    status: healthResults.status === 'unhealthy' ? 503 : 200 
  });
}
```

### Success Indicators
- ✅ Signal CLI container starts and responds to health checks
- ✅ Phone number registration sends SMS/voice verification
- ✅ Verification codes are stored and validated correctly  
- ✅ Messages send successfully to verified phone numbers
- ✅ Admin interface provides real-time status monitoring
- ✅ Health check endpoints return proper service status
- ✅ Error handling provides meaningful feedback to users

### Advantages Over Matrix Bridge Approach
1. **Independence**: No dependency on Matrix SDK bundling issues
2. **Direct Control**: Full control over Signal operations without bridge intermediary
3. **Better Error Handling**: Clear error messages from Signal CLI REST API
4. **Scalability**: Dedicated container can be scaled independently
5. **Monitoring**: Direct health checks and status monitoring
6. **Flexibility**: Support for both registration and device linking workflows

### Implementation Files
- `src/lib/signal/signal-bot-service.ts` - High-level service class
- `src/lib/signal/api-client.ts` - HTTP client wrapper  
- `src/lib/signal/types.ts` - TypeScript definitions
- `src/lib/trpc/routers/signal.ts` - tRPC endpoints
- `src/app/admin/signal/page.tsx` - Admin management interface
- `src/app/api/health/route.ts` - Main health check endpoint
- `src/app/api/signal/health/route.ts` - Signal-specific health check
- `docker-compose.yml` - Container orchestration
- `prisma/schema.prisma` - Database schema updates

### Signal Verification Fallback Implementation (2025-08-17)

**Feature**: Signal verification with automatic fallback from Signal CLI to Matrix Signal bridge

**Implementation Details**:
The user profile Signal verification now implements a robust fallback system:

1. **Primary Method - Signal CLI REST API**: 
   - Attempts to send verification via Signal CLI if configured
   - Checks `signalBot.isConfigured()` and `signalBot.config.phoneNumber`
   - Uses the bot's registered phone number to send verification codes

2. **Fallback Method - Matrix Signal Bridge**:
   - Falls back to Matrix Signal bridge if Signal CLI fails or isn't configured  
   - Validates environment variables directly (bypasses SDK initialization issues)
   - Uses phone-to-UUID resolution through Signal bridge room

**Code Pattern**:
```typescript
// 1. First try Signal CLI REST API (preferred method)
const { SignalBotService } = await import('@/lib/signal/signal-bot-service');
const signalBot = new SignalBotService();

if (signalBot.isConfigured() && signalBot.config.phoneNumber) {
  const result = await signalBot.sendMessage(normalizedPhone.normalized, verificationMessage);
  if (result.success) {
    verificationSent = true;
    method = 'signal-cli';
  }
}

// 2. Fallback to Matrix Signal bridge if Signal CLI failed
if (!verificationSent) {
  const homeserver = process.env.MATRIX_HOMESERVER;
  const accessToken = process.env.MATRIX_ACCESS_TOKEN;
  const userId = process.env.MATRIX_USER_ID;
  const signalBridgeRoom = process.env.MATRIX_SIGNAL_BRIDGE_ROOM_ID;
  
  if (homeserver && accessToken && userId && signalBridgeRoom) {
    const result = await matrixService.sendSignalMessageByPhone(normalizedPhone.normalized, verificationMessage);
    if (result.success) {
      method = 'signal-bridge';
    }
  }
}
```

**Key Benefits**:
- **Reliability**: Automatic fallback ensures verification works even if Signal CLI is down
- **Flexibility**: Supports both direct Signal CLI and Matrix bridge workflows
- **User Experience**: Transparent fallback with clear method indication
- **Environment Validation**: Direct environment variable checks bypass SDK initialization issues

**File Location**: `src/lib/trpc/routers/user.ts` (lines 1321-1385)

**Success Indicators**:
- ✅ Signal CLI verification: "Verification code sent via Signal CLI!"
- ✅ Matrix bridge fallback: "Verification code sent via Matrix Signal bridge!"
- ✅ Clear logging shows which method was used
- ✅ Both methods store verification codes in database with proper expiration

### Future Enhancements
- Phone number registration flow in admin UI
- Device linking QR code generation
- Message history and analytics
- Bulk messaging operations
- ✅ Integration with user profile Signal verification (completed with fallback)
- Migration tools from Matrix bridge to Signal CLI