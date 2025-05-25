# 🛣️ Project Roadmap: Chat-Based Community Dashboard

> **Our mission**: Make community management simple, accessible, and powerful for organizers of all technical backgrounds.

This roadmap is organized by timeline and shows how contributors at different skill levels can help. Whether you have 15 minutes or 15 hours, there's a way to contribute!

## 🔥 Current Sprint (Next 2-4 weeks)

### High Priority Fixes
- [ ] **Fix List of Users** ⚡ *Good for: Entry-level developers*
   - Fix the user list to allow bulk actions on selected users
   - **Actions needed**: 
     - ✅ Activate / Deactivate users
     - ✅ Change passwords in bulk
     - ✅ Delete multiple users
     - ✅ Safety number verification
     - ✅ Add intro messages
     - ✅ Add email addresses
   - **Skills needed**: Python, Streamlit UI components
   - **Time estimate**: 4-8 hours
   - **Impact**: High - Core functionality for community managers

- [ ] **Admin Email to User Email** 📧 *Good for: Mid-level developers*
   - Add direct email functionality from dashboard to users
   - **Features**: 
     - Send emails from admin SMTP account
     - Email templates for common scenarios
     - Email history tracking
   - **Skills needed**: SMTP integration, email templating
   - **Time estimate**: 6-10 hours
   - **Impact**: High - Essential communication tool

### User Experience Improvements
- [ ] **User Accounts on Dashboard** 👥 *Good for: Mid-level developers*
   - Add admin user accounts to track who performed which actions
   - **Features**:
     - Admin login system
     - Action audit logs
     - Permission levels (super admin, moderator, etc.)
   - **Skills needed**: Authentication, database design
   - **Time estimate**: 8-12 hours
   - **Impact**: Medium - Important for accountability

## 🚀 This Quarter (Next 2-3 months)

### Core Platform Features
- [ ] **Verification Email Process** ✉️ *Good for: Mid-level developers*
   - Automated email verification for user onboarding
   - **Current**: Using AWS SES for email sending
   - **Goal**: Integrate with Authentik's verification flow
   - **Skills needed**: AWS SES, Authentik API, email workflows
   - **Time estimate**: 10-15 hours
   - **Impact**: High - Streamlines onboarding

- [ ] **Signal Bot Launch** 🤖 *Good for: Advanced developers*
   - Customizable Signal bot for announcements and interactions
   - **Features**:
     - Automated announcements
     - User interaction commands
     - Integration with dashboard
   - **Skills needed**: Signal API, bot development, async programming
   - **Time estimate**: 20-30 hours
   - **Impact**: Very High - Major new capability

### Matrix Integration
- [ ] **Enhanced Matrix Room Management** 🏠 *Good for: Mid to advanced developers*
   - **Room Management Tools**:
     - List and track all rooms
     - Add/remove users programmatically
     - Admin announcements to all rooms
     - Create rooms and invite users
   - **Skills needed**: Matrix API, async programming
   - **Time estimate**: 15-25 hours
   - **Impact**: High - Essential for Matrix communities

- [ ] **Quick Creation of Conflict Rooms** ⚖️ *Good for: Entry to mid-level developers*
   - One-click creation of moderation/conflict resolution rooms
   - **Features**:
     - Auto-add all moderators
     - Add relevant individuals
     - Private space setup
   - **Skills needed**: Matrix API, UI design
   - **Time estimate**: 6-10 hours
   - **Impact**: Medium - Helpful for moderation

### Communication Features
- [ ] **Chat-Based Account Management** 💬 *Good for: Advanced developers*
   - Allow admin accounts to manage users via chat commands
   - **Features**:
     - Create accounts via chat
     - Reset passwords via chat
     - Update credentials via chat
   - **Skills needed**: Chat bot development, command parsing
   - **Time estimate**: 15-20 hours
   - **Impact**: Medium - Power user feature

- [ ] **Direct Messaging for Account Support** 📱 *Good for: Mid-level developers*
   - Send users direct messages with account details
   - **Features**:
     - Account creation notifications
     - Verification step instructions
     - Password reset links
   - **Skills needed**: Messaging APIs, templating
   - **Time estimate**: 8-12 hours
   - **Impact**: High - Improves user experience

## 🌟 Future Vision (6+ months)

### Platform Expansion
- [ ] **Integration of Other Identity Managers** 🔐 *Good for: Advanced developers*
   - Support beyond Authentik (Keycloak, Auth0, etc.)
   - **Skills needed**: Multiple API integrations, abstraction layers
   - **Time estimate**: 30-50 hours
   - **Impact**: Very High - Broader adoption

- [ ] **Maubot Integration** 🤖 *Good for: Advanced developers*
   - Enable Maubot for Matrix automation
   - **Skills needed**: Maubot development, Matrix ecosystem
   - **Time estimate**: 20-30 hours
   - **Impact**: Medium - Advanced Matrix features

### Advanced Features
- [ ] **Global Announcements via API/Webhooks** 📢 *Good for: Mid to advanced developers*
   - Send announcements across all platforms
   - **Skills needed**: Webhook development, API design
   - **Time estimate**: 12-18 hours
   - **Impact**: High - Essential for large communities

- [ ] **Mobile-Friendly Interface** 📱 *Good for: Frontend developers*
   - Responsive design for mobile community management
   - **Skills needed**: CSS, responsive design, Streamlit customization
   - **Time estimate**: 15-25 hours
   - **Impact**: High - Accessibility improvement

- [ ] **Advanced Analytics and Reporting** 📊 *Good for: Data-focused developers*
   - Community growth metrics, engagement analytics
   - **Skills needed**: Data visualization, analytics, database queries
   - **Time estimate**: 20-30 hours
   - **Impact**: Medium - Insights for community growth

## 🎯 How to Choose What to Work On

### 🕐 Got 15-30 minutes?
- **Documentation improvements** - Fix typos, clarify setup instructions
- **Bug reports** - Test features and report issues
- **Feature suggestions** - Share ideas based on your community needs

### 🕐 Got 1-3 hours?
- **UI/UX improvements** - Better error messages, clearer workflows
- **Small bug fixes** - Fix issues marked as "good first issue"
- **Test coverage** - Add tests for existing features

### 🕐 Got 4-8 hours?
- **User list fixes** - Core functionality improvements
- **Email features** - Communication tools
- **Matrix room management** - Platform integration

### 🕐 Got 8+ hours?
- **Signal bot development** - Major new features
- **Authentication systems** - Core platform improvements
- **New platform integrations** - Expand ecosystem support

## 🏷️ Skill Level Guide

### 🟢 Entry Level (New to open source)
- **Good for**: Documentation, UI improvements, simple bug fixes
- **Skills**: Basic Python, willingness to learn
- **Support**: Detailed mentoring available

### 🟡 Mid Level (Some experience)
- **Good for**: Feature development, API integrations, database work
- **Skills**: Python, web development, API usage
- **Support**: Code review and guidance provided

### 🔴 Advanced (Experienced developers)
- **Good for**: Architecture decisions, complex integrations, bot development
- **Skills**: Advanced Python, async programming, multiple APIs
- **Support**: Collaborative design discussions

## 📈 Success Metrics

**For Community Builders:**
- Time to onboard new members: < 5 minutes
- Platform management overhead: < 30 minutes/week
- Member satisfaction with onboarding: > 90%

**For Developers:**
- Setup time for new contributors: < 15 minutes
- Test coverage: > 80%
- Documentation completeness: All features documented

---

**Want to contribute?** Check our [Contributing Guide](CONTRIBUTING.md) or [join our community forum](https://forum.irregularchat.com/) to get started!