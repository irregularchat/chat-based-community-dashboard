# Community Dashboard Roadmap

## Current Version: v0.3.0 (Native Signal CLI with AI Integration)

### ✅ Completed Features

#### v0.1.0 - Foundation
- [x] Next.js 15 with Turbopack setup
- [x] Authentik OIDC authentication
- [x] tRPC API with type safety
- [x] Prisma database integration
- [x] Admin dashboard scaffolding
- [x] User management basics
- [x] Email service integration (SMTP)
- [x] Matrix integration foundation

#### v0.2.0 - Signal CLI Integration
- [x] Signal CLI REST API Docker integration
- [x] Phone number registration workflow
- [x] Message sending capability
- [x] Admin interface for Signal management
- [x] QR code generation for device linking
- [x] Health monitoring and status checks
- [x] Error handling and PIN lock recovery
- [x] Profile management (display name and avatar)
- [x] Profile persistence fixes with propagation delays
- [x] Two-way conversation threads with database storage
- [x] Message history and conversation view
- [x] Signal groups display functionality
- [x] User profile Signal verification with fallback system
- [x] Enhanced security verification messages

#### v0.2.1 - Community Management Foundation
- [x] **MAJOR REFACTOR**: Matrix Management → Community Management  
- [x] Unified messaging interface (Signal CLI + Matrix)
- [x] Service abstraction layer for multi-platform support
- [x] Configuration-aware feature availability
- [x] Cross-platform user management
- [x] Signal bot profile fixes and validation

### 🚧 In Progress
- **v0.2.2**: Signal CLI Bot Integration (Critical Production Fixes)

#### v0.2.2 - Native Signal CLI Bot Architecture ✅ COMPLETED
**🎯 GOAL**: Replace broken REST API with production-grade native signal-cli daemon

**✅ ARCHITECTURAL REVOLUTION COMPLETED**:

1. **🚀 Native Signal CLI Daemon Implementation**
   - **Solution**: Direct signal-cli daemon with JSON-RPC interface
   - **Benefits**: Real-time messaging, reliable group communication, no REST API limitations
   - **Implementation**: `NativeSignalBotService` with UNIX socket communication
   - **Status**: ✅ Complete and ready for production

2. **🔧 Core Components Delivered**
   - **Native Bot Service**: Direct daemon process management with automatic reconnection
   - **JSON-RPC Protocol**: Real-time message notifications through socket interface
   - **Plugin System**: Modular command architecture supporting extensible bot functionality
   - **Group ID Normalization**: Handles Signal's 3 inconsistent group ID formats
   - **tRPC Integration**: Full integration with existing admin interface

3. **📱 Production Setup Scripts**
   - **Setup Script**: `setup-signal-daemon.js` - Environment validation and configuration
   - **Bot Launcher**: `start-native-signal-bot.js` - Production-ready bot with enhanced logging
   - **Health Monitoring**: Real-time daemon status and automatic recovery
   - **Error Handling**: Comprehensive troubleshooting and recovery procedures

4. **🎯 Key Advantages Achieved**
   - ✅ **Real-time messaging** - JSON-RPC notifications replace broken polling
   - ✅ **Group messaging works** - Direct signal-cli bypasses REST API bugs
   - ✅ **Stable connections** - UNIX sockets eliminate WebSocket instability
   - ✅ **Production proven** - Architecture based on working production systems
   - ✅ **Plugin extensible** - Modular command system for future expansion

**IMPLEMENTATION COMPLETE**:
- ✅ Native daemon service with JSON-RPC interface
- ✅ Plugin-based command system with AI integration
- ✅ Group ID normalization for reliable messaging  
- ✅ Production setup and health monitoring scripts
- ✅ Full tRPC integration with admin interface
- ✅ Comprehensive error handling and recovery

**BREAKING CHANGES IMPLEMENTED**:
- Signal CLI binary installation required (replaces Docker dependency)
- UNIX socket communication (replaces HTTP REST API)
- JSON-RPC protocol for all messaging operations
- Native daemon process management with auto-recovery

#### v0.3.0 - AI Integration & Code Cleanup ✅ COMPLETED
**🎯 GOAL**: Complete AI integration with local privacy options and comprehensive codebase cleanup

**✅ ACHIEVEMENTS COMPLETED (August 31, 2025)**:

1. **🤖 Dual AI Integration**
   - ✅ GPT-5 integration with proper model names (gpt-5-mini, gpt-5-nano)
   - ✅ Local AI integration with `irregularbot:latest` model for privacy-focused queries
   - ✅ Context-aware AI responses with community knowledge
   - ✅ Thinking process cleanup (removed `<think>` tags from responses)
   - ✅ Self-message loop prevention to avoid infinite bot responses

2. **💬 Enhanced User Experience**
   - ✅ Display names instead of phone numbers in Q&A system
   - ✅ Cleaned emoji formatting for better readability
   - ✅ Command reorganization: `!summarize` for group messages, `!tldr` for URL content
   - ✅ Message summarization with parameters (`-m 30` for count, `-h 2` for hours)
   - ✅ Safety limits and parameter validation for resource protection

3. **🧹 Major Codebase Cleanup**
   - ✅ Archived 15+ obsolete bot implementations to `/archive/obsolete-bots/`
   - ✅ Archived test files and development utilities to `/archive/test-files/`
   - ✅ Archived experimental plugins to `/archive/experimental/`
   - ✅ Created comprehensive archive documentation
   - ✅ Updated README.md for production-ready presentation
   - ✅ Streamlined project structure for maintainability

4. **🔧 Technical Improvements**  
   - ✅ Fixed API endpoints for local AI (`/api/v1/chat/completions`)
   - ✅ Improved error handling and user-friendly error messages
   - ✅ Enhanced logging with emoji-based visual indicators
   - ✅ 72 total commands working (6 core + 66 plugin)

**PRODUCTION STATUS**: ✅ v0.3.0 Complete - Production ready with dual AI integration

### 🐛 Critical Issues Found (September 2025)

#### High Priority Fixes Required

1. **❌ !removeuser nonadmin Command Critical Bug**
   - **Issue**: Bot attempts to use non-existent `getGroup` API method
   - **Impact**: Command fails with "Could not retrieve member information"
   - **Fix**: Use `listGroups` method instead and properly parse admin data
   - **Status**: Fixed in code but needs testing
   - **Severity**: CRITICAL - Can remove admins instead of protecting them

2. **⚠️ Signal CLI Decryption Errors**
   - **Issue**: Multiple "invalid Whisper message: decryption failed" errors
   - **Impact**: Some messages may not be received properly
   - **Cause**: Missing sender key states and session issues
   - **Fix**: May need to refresh sessions or re-register with groups

3. **🔴 News Scraping Failures**
   - **Issue**: WSJ, American Bar Association sites returning 401/403 errors
   - **Impact**: News summarization feature fails for paywalled content
   - **Workaround**: 12ft.io proxy also failing with ECONNREFUSED
   - **Fix**: Need better paywall bypass or user authentication

4. **📊 Prisma Database Validation Errors**
   - **Issue**: PrismaClientValidationError when tracking news links
   - **Impact**: News tracking feature may not persist data
   - **Fix**: Schema validation needed for news tracking

5. **🔑 Signal UnidentifiedAccess NullPointerException**
   - **Issue**: "Cannot invoke UnidentifiedAccess.getUnidentifiedAccessKey()"
   - **Impact**: Some Signal operations may fail
   - **Fix**: Null checks needed in signal-cli operations

6. **👤 Profile Retrieval Failures**
   - **Issue**: Hundreds of "Failed to retrieve profile: [404] Profile not found"
   - **Impact**: User profiles may not display correctly
   - **Fix**: Implement fallback for missing profiles

#### NEW Signal CLI Infrastructure Issues (September 6, 2025)

7. **🔴 Socket Connection Failures**
   - **Issue**: "Socket timeout" errors in native-daemon-service.js at multiple line numbers (895, 854, 725, 731)
   - **Impact**: Bot fails to start, cannot connect to Signal CLI daemon
   - **Root Cause**: Multiple daemon instances competing for resources
   - **Fix**: Implement proper daemon cleanup and single-instance enforcement
   - **Severity**: CRITICAL - Bot cannot start

8. **⚠️ Module Loading Errors**
   - **Issue**: "Cannot find module './src/lib/signal-cli/rest-bot-service'" in start-signal-bot.js
   - **Impact**: Bot startup failures with MODULE_NOT_FOUND errors
   - **Root Cause**: Broken import path or missing file
   - **Fix**: Update import paths to match actual file structure
   - **Severity**: HIGH - Prevents bot initialization

9. **🔴 Signal CLI API Timeout Issues** 
   - **Issue**: "Request timeout" errors in native-daemon-service.js:2245:16
   - **Impact**: Group operations fail ("Error getting groups", "Error in handleAddTo")
   - **Root Cause**: Signal CLI API calls timing out after default timeout period
   - **Fix**: Increase timeout values, implement retry logic, add circuit breaker
   - **Severity**: HIGH - Core group functionality broken

10. **⚠️ Daemon Process Management**
    - **Issue**: "Config file is in use by another instance, waiting..." conflicts
    - **Impact**: Multiple daemon instances causing resource conflicts at `/tmp/signal-cli-socket`
    - **Root Cause**: Improper daemon cleanup between restarts
    - **Fix**: PID file management, proper process termination, socket cleanup
    - **Severity**: MEDIUM - Affects reliability

11. **📝 Signal CLI Method Compatibility**
    - **Issue**: "Method not implemented" errors in Signal CLI API
    - **Impact**: Some bot commands may fail unexpectedly
    - **Root Cause**: Signal CLI version compatibility or API changes
    - **Fix**: Update to compatible Signal CLI version, implement method fallbacks
    - **Severity**: MEDIUM - Affects feature availability

#### NEW Issues Found from Production Logs (September 6, 2025)

12. **🔴 Database Schema Validation Errors** - CRITICAL
    - **Issue**: Multiple `PrismaClientValidationError` failures across database operations
    - **Impact**: Message tracking, news link tracking, and command usage tracking all broken
    - **Root Cause**: Database schema mismatches and null constraint violations
    - **Examples**: `sourceNumber must not be null`, `prisma.signalMessage.upsert()` invalid
    - **Fix**: Audit and fix database schema, add proper null checks, update Prisma models
    - **Severity**: CRITICAL - Core data persistence broken

13. **❌ !request Command Complete Failure** - HIGH
    - **Issue**: `TypeError: Cannot read properties of undefined (reading 'get')` in handleRequest
    - **Impact**: User onboarding completely broken, prevents community growth
    - **Root Cause**: Missing Map initialization or incorrect context handling in line 5211
    - **Fix**: Fix undefined Map.get() call, add proper initialization and error handling
    - **Severity**: HIGH - Blocks new user onboarding workflow

14. **⚠️ Web Scraping Infrastructure Degradation** - MEDIUM
    - **Issue**: Archive.org failures (404s), paywall bypass failures, scraping timeouts
    - **Impact**: News summarization feature unreliable, content extraction broken
    - **Root Cause**: Third-party service reliability, outdated scraping methods
    - **Fix**: Implement fallback scraping methods, improve error handling, add retry logic
    - **Severity**: MEDIUM - Affects news processing quality

15. **✅ PDF Command Working Correctly** - INFO
    - **Status**: PDF processing functionality confirmed working in production logs
    - **Performance**: Successfully extracted 12,498 chars, compressed to 3,006 chars
    - **No Issues**: No fixes needed for PDF command functionality

### 🔧 Immediate Action Items

#### Legacy Issues
1. **Test and verify !removeuser nonadmin fix**
   - Ensure admins are never removed
   - Add comprehensive logging
   - Create test suite for admin protection

2. **Implement Signal session refresh mechanism**
   - Auto-detect decryption failures
   - Refresh sender key states
   - Re-sync with problematic groups

3. **Enhance news scraping resilience**
   - Add more fallback scraping methods
   - Implement content caching
   - Handle paywalls gracefully

4. **Database schema updates**
   - Fix news tracking schema
   - Add proper constraints
   - Migration scripts needed

5. **Signal-CLI error handling**
   - Add null checks throughout
   - Implement graceful degradation
   - Better error reporting to users

#### NEW Infrastructure Critical Fixes (September 6, 2025)
6. **✅ Fix Socket Connection Issues** - CRITICAL PRIORITY ✅ **COMPLETED**
   - ✅ Implemented single daemon instance enforcement with PID files
   - ✅ Added proper daemon cleanup on startup/shutdown with signal handlers
   - ✅ Implemented retry logic with exponential backoff (1s to 30s)
   - ✅ Added health check endpoints and progress logging
   - **Status**: RESOLVED - Bot now starts reliably in 2-3 seconds

7. **Resolve Module Import Errors** - HIGH PRIORITY
   - Audit and fix broken import paths in start-signal-bot.js
   - Ensure all referenced modules exist
   - Update package.json dependencies if needed
   - Add module existence validation

8. **Fix Signal CLI API Timeouts** - HIGH PRIORITY
   - Increase default timeout values from current settings
   - Implement retry logic for failed API calls
   - Add circuit breaker pattern for failing services
   - Create timeout configuration management

9. **Fix Database Schema Validation Errors** - CRITICAL PRIORITY **NEW**
   - Audit Prisma schema for null constraint violations
   - Fix signalMessage.upsert() sourceNumber null issues
   - Fix newsLink.create() validation failures
   - Add proper null checks and data validation
   - Update database migrations if needed

10. **Fix !request Command Failure** - HIGH PRIORITY **NEW**
    - Debug handleRequest TypeError at line 5211 in native-daemon-service.js
    - Fix undefined Map.get() calls in request handling
    - Add proper Map initialization and error handling
    - Test onboarding workflow end-to-end

11. **Daemon Process Management** - MEDIUM PRIORITY
    - Implement PID file management
    - Add proper signal handlers for cleanup
    - Create daemon status monitoring
    - Add automatic recovery mechanisms

12. **Signal CLI Version Compatibility** - MEDIUM PRIORITY
    - Audit current Signal CLI version vs API usage
    - Update to latest compatible Signal CLI version
    - Implement feature detection and fallbacks
    - Document version requirements

### 📋 Upcoming Features

#### v0.4.0 - Signal Self-Service Suite
**🎯 GOAL**: Transform admin-only Signal management into complete self-service user experience

**USER WORKFLOW**: *verify Signal → discover groups → join groups → invite friends → automated welcomes*

##### Phase 1: Signal Group Discovery & Status (Branch: `feature/signal-group-discovery`)
- [ ] **Backend APIs**
  - [ ] `getMySignalStatus` - User's Signal groups + verification status
  - [ ] `getAvailableSignalGroups` - Groups user can join
  - [ ] `checkSignalMembership` - Current group memberships
- [ ] **Frontend Dashboard Tab**
  - [ ] "Signal Groups" tab in user dashboard
  - [ ] Current Signal groups with enhanced names
  - [ ] Available groups with join buttons
  - [ ] Signal verification status indicator
- [ ] **Database Schema**
  - [ ] `signal_group_memberships` table
  - [ ] `signal_available_groups` table
- [ ] **Security Implementation**
  - [ ] Rate limiting (10 requests/minute)
  - [ ] Input validation with Zod schemas
  - [ ] Authentication checks on all endpoints

##### Phase 2: Signal Group Self-Joining (Branch: `feature/signal-self-join`)
- [ ] **Backend APIs**
  - [ ] `requestSignalGroupJoin` - User join requests
  - [ ] `addUserToGroup` - Bot adds user to group
  - [ ] `approveGroupJoinRequest` - Admin approval workflow
- [ ] **Frontend Features**
  - [ ] "Request to Join" buttons and workflow
  - [ ] Join request status tracking
  - [ ] Admin approval queue interface
- [ ] **Database Schema**
  - [ ] `signal_group_join_requests` table
- [ ] **Security Features**
  - [ ] Join request rate limiting (5/hour per user)
  - [ ] Admin approval for sensitive groups
  - [ ] Audit logging for group operations

##### Phase 3: Signal Welcome Bot Automation (Branch: `feature/signal-welcome-bot`)
- [ ] **Welcome Bot Service**
  - [ ] Automated welcome messages for new members
  - [ ] Group-specific welcome templates
  - [ ] New member announcements
  - [ ] Group rules and orientation messages
- [ ] **Admin Configuration**
  - [ ] Welcome template management interface
  - [ ] Per-group welcome customization
  - [ ] Welcome bot testing tools
- [ ] **Integration**
  - [ ] Hook into group join success events
  - [ ] Configurable delay for welcome messages
  - [ ] User privacy controls (opt-out)

##### Phase 4: User-Generated Signal Invites (Branch: `feature/signal-user-invites`)
- [ ] **Backend APIs**
  - [ ] `createSignalInvite` - Generate Signal invite links
  - [ ] `getSignalInviteTemplate` - Copy-paste templates
  - [ ] `trackInviteUsage` - Analytics and tracking
- [ ] **Frontend Features**
  - [ ] Signal invite creation interface
  - [ ] QR code generation for mobile sharing
  - [ ] Copy-paste invitation templates
  - [ ] Invite tracking and analytics
- [ ] **Database Schema**
  - [ ] `signal_user_invites` table
- [ ] **Security Implementation**
  - [ ] Cryptographically secure invite IDs
  - [ ] Rate limiting (10 invites/day per user)
  - [ ] Invite expiration enforcement

##### Phase 5: Invite Templates & UX Polish (Branch: `feature/invite-templates`)
- [ ] **Template System**
  - [ ] Brief guide: "1. Install Signal 2. Click link 3. Join group"
  - [ ] Platform-specific templates (SMS, email, social)
  - [ ] QR codes with embedded group info
  - [ ] Expiration tracking and indicators
- [ ] **Enhanced UX**
  - [ ] One-click copy to clipboard
  - [ ] Mobile-optimized QR codes
  - [ ] Social sharing buttons
  - [ ] Invite performance analytics
  - [ ] Bulk invite creation

##### Success Metrics
- ✅ Users discover Signal groups without admin assistance
- ✅ Group join requests processed within 24 hours
- ✅ Welcome messages delivered within 30 seconds
- ✅ Users create/share invites in under 1 minute
- ✅ Invite conversion rate > 30%
- ✅ Zero security vulnerabilities in audit

#### v0.4.0 - Unified Community Management System
**🔧 ARCHITECTURAL REFACTOR: Matrix Management → Community Management**

##### Core Infrastructure Changes
- [ ] **Service Abstraction Layer**
  - [ ] `CommunityService` base class with Signal/Matrix implementations
  - [ ] Unified messaging interface across platforms
  - [ ] Configuration-aware service selection
  - [ ] Fallback mechanisms when services unavailable

- [ ] **Frontend Refactor**
  - [ ] Rename `/matrix` → `/community` route
  - [ ] Unified user interface for both Signal CLI and Matrix users
  - [ ] Platform-agnostic user selection and management
  - [ ] Dynamic feature availability based on configured services

##### Unified Operations Support
- [ ] **Cross-Platform Messaging**
  - [ ] Send messages via Signal CLI or Matrix bot (configuration-dependent)
  - [ ] Unified recipient selection (Signal users, Matrix users, or both)
  - [ ] Platform-aware message delivery with fallback options
  
- [ ] **Room/Group Management** 
  - [ ] Invite users to Matrix rooms OR Signal groups
  - [ ] Remove users from Matrix rooms OR Signal groups  
  - [ ] Broadcast messages to entire Matrix room OR Signal group
  - [ ] Create new Matrix rooms OR Signal groups

- [ ] **User Management**
  - [ ] Unified user directory (Matrix + Signal CLI contacts)
  - [ ] Cross-platform user search and filtering
  - [ ] Bulk operations across both platforms
  - [ ] User verification status (Matrix + Signal)

##### Configuration Scenarios
- [ ] **Signal CLI Only**: All operations via Signal CLI REST API
- [ ] **Matrix Only**: All operations via Matrix SDK/bridge
- [ ] **Both Configured**: User choice or intelligent fallback
- [ ] **Neither Configured**: Graceful degradation with clear messaging

##### Implementation Strategy
- [x] **Phase 1**: Service abstraction layer and unified APIs ✅ COMPLETED
- [ ] **Phase 2**: Frontend refactor for unified interface  
- [ ] **Phase 3**: Cross-platform operations and management
- [ ] **Phase 4**: Advanced features (bridging, sync, etc.)

#### v0.4.0 - Advanced Community Features
- [ ] Bidirectional message bridging between Signal and Matrix
- [ ] Room/group synchronization and mapping
- [ ] Cross-platform user presence and activity
- [ ] Unified notification system
- [ ] Community analytics across platforms

#### v0.4.0 - Advanced Messaging
- [ ] Group messaging support
- [ ] File attachments and media sharing
- [ ] Message search and filtering
- [ ] Automated welcome messages
- [ ] Message templates and quick replies
- [ ] Scheduled messages

#### v0.5.0 - User Experience
- [ ] Mobile-responsive admin interface
- [ ] Dark/light theme toggle
- [ ] Fix tab active state highlighting (Issue #101)
- [ ] Real-time message notifications
- [ ] User presence indicators
- [ ] Typing indicators
- [ ] Read receipts visualization

#### v0.6.0 - Analytics & Monitoring
- [ ] Message analytics dashboard
- [ ] User engagement metrics
- [ ] System health monitoring
- [ ] Error tracking and alerting
- [ ] Performance metrics
- [ ] Usage reports

#### v0.7.0 - Automation & Integration
- [ ] Webhook integrations
- [ ] API for external services
- [ ] Automated user onboarding flows
- [ ] Bot commands and responses
- [ ] Integration with Discourse forum
- [ ] Calendar event notifications

#### v0.8.0 - Security & Compliance
- [ ] End-to-end encryption verification
- [ ] Message retention policies
- [ ] Audit logging
- [ ] GDPR compliance tools
- [ ] Data export functionality
- [ ] Security scanning

#### v0.9.0 - Scale & Performance
- [ ] Message queue implementation
- [ ] Caching layer
- [ ] Database optimization
- [ ] Load balancing support
- [ ] Horizontal scaling capability
- [ ] Background job processing

#### v1.0.0 - Production Ready
- [ ] Comprehensive documentation
- [ ] Deployment guides
- [ ] Backup and restore procedures
- [ ] Migration tools
- [ ] Admin training materials
- [ ] Community contribution guidelines

### 🎯 Long-term Vision

#### Future Considerations
- Multi-tenant support
- WhatsApp Business API integration
- Telegram bot integration
- Discord bridge
- AI-powered message suggestions
- Natural language processing for auto-responses
- Voice message support
- Video calling integration
- Community moderation tools
- Reputation system

### 📊 Success Metrics

- **User Adoption**: Number of active users across platforms
- **Message Volume**: Daily/weekly message throughput
- **Response Time**: Average time to first response
- **System Uptime**: 99.9% availability target
- **User Satisfaction**: Feedback and engagement scores
- **Platform Coverage**: Number of integrated messaging platforms

### 🔄 Development Process

1. **Planning**: Feature specification and design
2. **Implementation**: Iterative development with testing
3. **Testing**: Unit, integration, and user acceptance testing
4. **Documentation**: User guides and API documentation
5. **Deployment**: Staged rollout with monitoring
6. **Feedback**: User feedback collection and iteration

### 📝 Notes

- Prioritization may change based on user feedback and community needs
- Security and privacy are core considerations for all features
- Performance and scalability are evaluated at each milestone
- Community input is welcomed and encouraged

---

*Last Updated: September 2025*
*Version: 0.3.0*