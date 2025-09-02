# Signal Bot Onboarding System - Implementation Roadmap

## Current State Analysis
Based on review of the codebase and lessons learned:
- Bot has basic !gtg, !request, !pending commands but they're not fully automated
- User creation exists in dashboard but not integrated with Signal bot
- No automatic group removal or DM functionality
- No timer system for inactive users
- Missing integration between Signal commands and Authentik/Discourse

## Requirements
1. **!request** - Prompt users for introduction, set removal timer
2. **!gtg** - Fully automate user creation, credential delivery, group management
3. **!pending** - Show pending requests with timer status
4. **Auto-removal** - Remove inactive users after timeout
5. **DM Credentials** - Send login details directly to approved users
6. **Discourse Integration** - Create forum post for new users
7. **Email Integration** - Send welcome email with credentials

## Implementation Phases

### Phase 1: Core Onboarding Flow Enhancement ✅ COMPLETED
**Goal**: Update !request, !gtg commands with proper flow
- [x] Fix !request to prompt for structured introduction
- [x] Update !gtg response message to match requirements
- [x] Add timer tracking for pending requests
- [x] Implement !pending to show timeout status
- [x] Add DM credential delivery functions
- [x] Add group removal functionality
- [x] Generate secure usernames and passwords
- [x] Parse introduction data structure

### Phase 2: User Creation Integration 🚧
**Goal**: Connect Signal bot to existing user creation system
- [ ] Import authentikService in bot
- [ ] Import emailService for credential delivery
- [ ] Import discourseService for forum posts
- [ ] Add Prisma client to bot for database access
- [ ] Create helper functions for user creation workflow

### Phase 3: Direct Message System 🔄
**Goal**: Enable bot to send DMs with credentials
- [ ] Implement sendDirectMessage function using signal-cli
- [ ] Create credential formatting template
- [ ] Add error handling for failed DM delivery
- [ ] Store DM status in database

### Phase 4: Group Management 🔄
**Goal**: Automated group removal and addition
- [ ] Implement removeUserFromGroup function
- [ ] Add user to appropriate groups after approval
- [ ] Handle group membership validation
- [ ] Store group membership in database

### Phase 5: Timer System Implementation 🔄
**Goal**: Auto-remove inactive users
- [ ] Create background timer service
- [ ] Implement 24-hour timeout for !request
- [ ] Auto-remove users who don't complete intro
- [ ] Send warning messages before removal
- [ ] Log removal actions to database

### Phase 6: Testing & Error Handling 🔄
**Goal**: Ensure reliability and proper error recovery
- [ ] Test full onboarding flow end-to-end
- [ ] Add comprehensive error logging
- [ ] Implement rollback for failed user creation
- [ ] Test DM delivery failures
- [ ] Verify timer accuracy

### Phase 7: Production Deployment 🔄
**Goal**: Deploy to production with monitoring
- [ ] Update environment variables
- [ ] Configure production database
- [ ] Set up monitoring for failures
- [ ] Document admin procedures
- [ ] Train admin team

## Technical Components Needed

### 1. Database Schema Updates
```prisma
model OnboardingRequest {
  id          Int      @id @default(autoincrement())
  phoneNumber String   @unique
  username    String?
  introduction String?
  groupId     String?
  requestedAt DateTime @default(now())
  expiresAt   DateTime
  status      String   // pending, approved, expired, removed
  approvedBy  String?
  approvedAt  DateTime?
}
```

### 2. Signal CLI Commands
- `updateGroup` - Add/remove members
- `sendMessage` - Direct messages
- `listGroups` - Get group info
- `getContactInfo` - Get user details

### 3. Integration Points
- Authentik API for SSO user creation
- Discourse API for forum posts
- SMTP for email delivery
- PostgreSQL for data persistence

## Obstacles & Solutions

### Obstacle 1: Signal CLI Group Management
**Issue**: Group IDs in multiple formats (Base64 variations)
**Solution**: Implemented group ID normalization in LESSONS_LEARNED.md

### Obstacle 2: Direct Message Delivery
**Issue**: Need user's UUID for DM, not phone number
**Solution**: Extract UUID from mentions array or group member list

### Obstacle 3: Password Security
**Issue**: Need to securely generate and deliver passwords
**Solution**: Use generateSecurePassphrase() and immediate DM delivery

### Obstacle 4: Timer Persistence
**Issue**: Timers lost on bot restart
**Solution**: Store in database with expiry timestamps, check on startup

## Success Metrics
- Onboarding completion rate > 90%
- Average time to approval < 2 hours
- Zero manual intervention for standard approvals
- All credentials delivered within 1 minute of approval
- No users stuck in pending > 24 hours

## Next Steps
1. Start with Phase 2 - User Creation Integration
2. Import required services into bot
3. Test user creation with mock data
4. Implement DM functionality
5. Add group management
6. Deploy timer system
7. Full integration testing

## Notes
- Prioritize security - never log passwords
- All DMs should be encrypted
- Maintain audit log of all approvals
- Consider rate limiting for spam prevention
- Implement admin override commands