# Community Dashboard Roadmap

## Current Version: v0.2.0 (Signal CLI Integration)

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
- **v0.3.0**: Signal Self-Service Suite (Phase 1-5 implementation)

### 📋 Upcoming Features

#### v0.3.0 - Signal Self-Service Suite
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

*Last Updated: August 2025*
*Version: 0.2.0*