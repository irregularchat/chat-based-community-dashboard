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

#### v0.3.1 - AI Command Awareness & Intelligence ✅ COMPLETED
**🎯 GOAL**: Enable AI (!ai and !lai) to understand all bot commands and execute them intelligently
**📅 STATUS**: 100% Complete - Production ready AI command awareness

**✅ ACHIEVEMENTS COMPLETED (September 2, 2025)**:

1. **🧠 Phase 1: Command Registry Integration** - AI can see and understand all 79 bot commands
2. **🔍 Phase 2: Database Context Queries** - AI queries Q&A, events, bookmarks, and news for relevant information  
3. **🔐 Phase 3: Permission-Aware Execution** - AI respects admin/moderator permissions before executing commands
4. **🤖 Phase 4: Safe Command Executor** - Comprehensive safety wrapper with audit logging, timeouts, and blocklists
5. **📊 Database-Backed Groups** - Implemented fast database caching for groups command with accurate member counts

**PRODUCTION STATUS**: ✅ v0.3.1 Complete - AI can intelligently execute commands with proper security

### 🚧 In Progress - v0.4.0

**📋 Implementation Plan**:

1. **🧠 Command Registry Integration** ✅
   - [x] Expose command registry to AI handlers
   - [x] Create command metadata with descriptions and examples
   - [x] Build command categorization (info, admin, moderation, utility)
   - [x] Generate dynamic help context for AI

2. **🔍 Context & Data Access** ✅
   - [x] Query Q&A database for stored questions/answers
   - [x] Access event database for upcoming events
   - [x] Retrieve shared links and bookmarks
   - [x] View recent message history for context
   - [x] Access news articles and summaries

3. **🔐 Permission-Aware Execution** ✅
   - [x] Check user admin/moderator status before execution
   - [x] Filter available commands by permission level
   - [x] Implement safe command execution wrapper
   - [x] Create audit trail for AI-executed commands
   - [x] Prevent dangerous operations (delete, ban, etc.)

4. **🤖 Natural Language Understanding** ✅
   - [x] Parse user queries for command intent
   - [x] Map natural language to specific commands
   - [x] Handle ambiguous requests with clarification
   - [x] Suggest relevant commands when unsure
   - [ ] Learn from command usage patterns

5. **📊 Implementation Phases**
   - [x] **Phase 1**: Read-only awareness (AI knows all commands)
   - [x] **Phase 2**: Database queries (fetch Q&A, events, links)
   - [x] **Phase 3**: Safe execution (info commands only)
   - [x] **Phase 4**: Admin execution (with permission checks)
   - [ ] **Phase 5**: Learning and optimization

**Technical Architecture**:
```javascript
class AICommandAwareness {
  // Core components AI will access:
  commandRegistry: Map<string, CommandHandler>
  database: PrismaClient
  permissions: PermissionChecker
  executor: SafeCommandExecutor
  
  // AI capabilities:
  - List and explain all commands
  - Query database for context
  - Check user permissions
  - Execute appropriate commands
  - Learn from interactions
}
```

**Example Interactions**:
- **User**: "What events are coming up?"
  - **AI Action**: Query events DB → Format response → Send event list

- **User**: "Show me unanswered questions"
  - **AI Action**: Query Q&A DB → Filter pending → Display questions

- **User**: "Add me to developers group"
  - **AI Action**: Check permissions → Execute !addto → Confirm

- **User**: "What can I do here?"
  - **AI Action**: Check user role → List relevant commands → Provide examples

- **User**: "Find links about React"
  - **AI Action**: Search bookmarks DB → Filter by keyword → Return results

**Success Metrics**:
- ✓ AI correctly identifies command intent 95% of the time
- ✓ Zero unauthorized command executions
- ✓ Response time under 3 seconds
- ✓ 90% user satisfaction with AI assistance
- ✓ Reduces admin workload by 50%

**Security Considerations**:
- No direct database writes without validation
- Rate limiting on command execution
- Audit log for all AI actions
- Rollback capability for mistakes
- Human oversight for critical operations

### 📋 Upcoming Features

#### v0.4.0 - Signal Self-Service Suite
**🎯 GOAL**: Transform admin-only Signal management into complete self-service user experience

**USER WORKFLOW**: *verify Signal → discover groups → join groups → invite friends → automated welcomes*

##### Phase 1: Signal Group Discovery & Status ✅ COMPLETED (Branch: `feature/signal-group-discovery`)
- [x] **Backend APIs**
  - [x] `getMySignalStatus` - User's Signal groups + verification status
  - [x] `getAvailableSignalGroups` - Groups user can join with pagination/search
  - [x] `checkSignalMembership` - Current group memberships
  - [x] `requestSignalGroupJoin` - Submit join requests (Phase 2 preparation)
- [x] **Frontend Dashboard Tab**
  - [x] "Signal Groups" tab in user dashboard
  - [x] Current Signal groups with enhanced names and member counts
  - [x] Available groups with join request buttons
  - [x] Signal verification status indicator with phone number display
- [x] **Database Integration**
  - [x] Uses existing `signal_group_memberships`, `signal_groups`, and `signal_available_groups` tables
  - [x] Database caching for fast responses
  - [x] Real-time data with refresh capability
- [x] **Security Implementation**
  - [x] Rate limiting considerations built into APIs
  - [x] Input validation with Zod schemas
  - [x] Authentication checks on all endpoints (protectedProcedure)
  - [x] Proper error handling and user feedback

**✅ PRODUCTION STATUS**: Phase 1 Complete - Users can now view their Signal status and discover available groups through the dashboard

##### Phase 2: Signal Group Self-Joining ✅ COMPLETED (Branch: `feature/signal-self-join`)
- [x] **Backend APIs**
  - [x] Enhanced `requestSignalGroupJoin` - Automatic approval for authorized users
  - [x] `addUserToGroup` - Direct Signal CLI integration for adding users to groups
  - [x] `getGroupInfo` - Detailed group information retrieval
- [x] **Smart Authorization Logic**
  - [x] Users with existing group memberships are automatically approved (all current groups are authorized)
  - [x] New users still go through manual approval process
  - [x] Instant joining for authorized users with real-time Signal CLI integration
- [x] **Frontend Features**  
  - [x] Enhanced "Join Group" buttons with loading states and animations
  - [x] Smart toast notifications for different join scenarios (auto-approved vs pending)
  - [x] Real-time UI updates with automatic page refresh on successful joins
  - [x] Comprehensive error handling and user feedback
- [x] **Signal CLI Integration**
  - [x] Direct `signal-cli updateGroup` command execution for adding users
  - [x] Proper process management with 30-second timeouts
  - [x] Full logging and error handling for debugging
  - [x] Graceful fallback when Signal operations fail
- [x] **Security & Audit**
  - [x] Admin event logging for all group operations
  - [x] Transaction-based database operations for consistency
  - [x] Comprehensive error handling and rollback capabilities
  - [x] Phone number validation and user verification

**✅ PRODUCTION STATUS**: Phase 2 Complete - Authorized users can now instantly join Signal groups with automatic approval and real-time Signal CLI integration

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

*Last Updated: August 2025*
*Version: 0.2.0*