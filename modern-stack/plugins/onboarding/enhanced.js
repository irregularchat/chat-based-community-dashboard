// Enhanced Onboarding Plugin with Service Integration
import BasePlugin from '../base.js';
import onboardingService from '../../services/onboarding-service.js';

export default class EnhancedOnboardingPlugin extends BasePlugin {
  constructor(pluginManager) {
    super('onboarding');
    this.pluginManager = pluginManager;
    this.entryRoomId = process.env.ENTRY_ROOM_ID || 'kPg9YVH7bJC5dzldOuFc0+c3EDZlSx8pVBtz+KYOgRI=';
    this.moderatingActionsId = process.env.MOD_ACTIONS_ROOM_ID || 'moderating-actions-room';
    this.pendingUsers = new Map();
    this.timeoutCheckInterval = null;
    this.db = null;
    this.onboardingService = onboardingService;
  }

  async init() {
    await super.init();
    
    // Initialize onboarding service
    const serviceInitialized = await this.onboardingService.init();
    if (serviceInitialized) {
      this.log('✅ Onboarding services initialized');
    } else {
      this.log('⚠️ Some onboarding services failed to initialize');
    }
    
    // Get database from bot/manager
    if (this.pluginManager && this.pluginManager.bot && this.pluginManager.bot.database) {
      this.db = this.pluginManager.bot.database.db;
      this.log('Connected to bot database');
      await this.initDatabase();
    } else {
      this.log('No database available, plugin functionality limited');
    }
    
    this.startTimeoutChecker();
  }

  async initDatabase() {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS onboarding_sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        phone_number TEXT,
        current_step TEXT NOT NULL,
        session_data TEXT,
        initiated_by TEXT,
        request_timestamp INTEGER,
        timeout_at INTEGER,
        started_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        completed_at INTEGER,
        removed_at INTEGER,
        credentials TEXT
      )
    `);
  }

  getCommands() {
    return {
      'request': {
        handler: this.handleRequest.bind(this),
        description: 'Request introduction from new user',
        usage: '!request @user',
        requiresGroup: true
      },
      'gtg': {
        handler: this.handleGTG.bind(this),
        description: 'Approve user for onboarding (admin only)',
        usage: 'Reply to user intro with GTG',
        requiresGroup: true,
        adminOnly: true
      },
      'pending': {
        handler: this.handlePending.bind(this),
        description: 'Show users awaiting approval',
        usage: '!pending',
        requiresGroup: true
      },
      'timeout': {
        handler: this.handleTimeoutCheck.bind(this),
        description: 'Check users approaching timeout',
        usage: '!timeout check',
        requiresGroup: true
      }
    };
  }

  async handleGTG(context) {
    const { message, sender, senderName } = context;
    
    // Extract reply context
    const replyContext = this.extractReplyContext(message);
    if (!replyContext || !replyContext.quotedAuthor) {
      return '❌ Please reply to a user introduction with GTG';
    }
    
    // Get pending user session
    const session = this.pendingUsers.get(replyContext.quotedAuthor);
    if (!session) {
      return '❌ No pending introduction found for this user';
    }
    
    if (!session.introductionData) {
      return '❌ User has not posted their introduction yet';
    }
    
    const userData = session.introductionData;
    userData.userId = replyContext.quotedAuthor;
    userData.phoneNumber = session.phoneNumber || replyContext.quotedAuthor;
    
    // Validate user data
    const validation = this.onboardingService.validateUserData(userData);
    if (!validation.valid) {
      return `❌ Invalid user data: ${validation.errors.join(', ')}`;
    }
    
    try {
      this.log(`Processing GTG approval for ${userData.firstName} ${userData.lastName}`);
      
      // Process full onboarding
      const onboardingResult = await this.onboardingService.processUserOnboarding(userData);
      
      if (onboardingResult.success) {
        // Mark session as completed
        session.completed = true;
        session.completedAt = Date.now();
        session.credentials = JSON.stringify(onboardingResult.credentials);
        await this.updateSession(session);
        
        // Send welcome DM if we have Signal API access
        if (this.pluginManager?.bot?.sendDirectMessage) {
          const welcomeMessage = this.onboardingService.generateWelcomeMessage(onboardingResult.credentials);
          await this.pluginManager.bot.sendDirectMessage(userData.phoneNumber, welcomeMessage);
        }
        
        // Log successful approval
        await this.logModeratingAction('USER APPROVED (GTG)', 
          `Admin: ${senderName || sender}
User: ${userData.firstName} ${userData.lastName}
Username: ${onboardingResult.credentials?.username}
Actions completed:
${this.formatCompletedSteps(onboardingResult.steps)}`);
        
        // Remove from INDOC room if we have Signal API
        if (this.pluginManager?.bot?.removeUserFromGroup) {
          await this.pluginManager.bot.removeUserFromGroup(userData.phoneNumber, this.entryRoomId);
        }
        
        // Clean up pending user
        this.pendingUsers.delete(replyContext.quotedAuthor);
        
        return `✅ User ${userData.firstName} ${userData.lastName} approved!
• SSO account created: ${onboardingResult.credentials?.username}
• Welcome DM sent with credentials
${onboardingResult.forumUrl ? `• Forum post created: ${onboardingResult.forumUrl}` : ''}
• Added to ${onboardingResult.steps.groups?.groupsAssigned?.length || 0} groups
• Removed from INDOC room
${onboardingResult.errors.length > 0 ? `\n⚠️ Some steps had issues:\n${onboardingResult.errors.join('\n')}` : ''}`;
        
      } else {
        // Handle failure
        await this.logModeratingAction('USER APPROVAL FAILED', 
          `Admin: ${senderName || sender}
User: ${userData.firstName} ${userData.lastName}
Errors: ${onboardingResult.errors.join(', ')}`);
        
        return `❌ Failed to process user approval:
${onboardingResult.errors.join('\n')}

Please check the logs and try again or process manually.`;
      }
      
    } catch (error) {
      this.error('GTG processing failed:', error);
      await this.logModeratingAction('SYSTEM ERROR', 
        `Failed to process GTG for ${userData.firstName} ${userData.lastName}: ${error.message}`);
      return `❌ System error during approval: ${error.message}`;
    }
  }

  formatCompletedSteps(steps) {
    const lines = [];
    
    if (steps.sso?.success) {
      lines.push('• ✅ SSO account created');
    } else if (steps.sso) {
      lines.push('• ❌ SSO account failed');
    }
    
    if (steps.forum?.success) {
      lines.push('• ✅ Forum introduction posted');
    } else if (steps.forum) {
      lines.push('• ❌ Forum post failed');
    }
    
    if (steps.email?.success) {
      lines.push('• ✅ Welcome email sent');
    } else if (steps.email) {
      lines.push('• ❌ Email failed');
    }
    
    if (steps.groups?.success) {
      lines.push(`• ✅ Added to ${steps.groups.groupsAssigned?.length || 0} groups`);
    }
    
    return lines.join('\n');
  }

  async startTimeoutChecker() {
    this.timeoutCheckInterval = setInterval(async () => {
      const now = Date.now();
      
      for (const [userId, session] of this.pendingUsers.entries()) {
        if (now > session.timeoutAt && !session.completed && !session.removedAt) {
          // Process timeout
          await this.onboardingService.handleUserTimeout({
            userId: userId,
            ...session.introductionData
          });
          
          // Mark as removed
          session.removedAt = now;
          await this.updateSession(session);
          
          // Log timeout
          const hoursElapsed = Math.floor((now - session.requestTimestamp) / (1000 * 60 * 60));
          await this.logModeratingAction('TIMEOUT REMOVAL', 
            `User: ${userId}
Elapsed: ${hoursElapsed} hours
Reason: Failed to complete onboarding
Action: Removed from Entry room`);
          
          // Remove from INDOC room if we have Signal API
          if (this.pluginManager?.bot?.removeUserFromGroup) {
            await this.pluginManager.bot.removeUserFromGroup(userId, this.entryRoomId);
          }
          
          // Clean up session
          this.pendingUsers.delete(userId);
        }
      }
    }, 60 * 60 * 1000); // Every hour
  }

  async logModeratingAction(action, details) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${action}
${details}
────────────────`;
    
    // Log to console
    this.log(`[MOD-ACTIONS] ${logEntry}`);
    
    // Send to moderating actions room if we have Signal API
    if (this.pluginManager?.bot?.sendMessage && this.moderatingActionsId) {
      try {
        await this.pluginManager.bot.sendMessage(this.moderatingActionsId, logEntry);
      } catch (error) {
        this.error('Failed to send to moderating actions room:', error);
      }
    }
  }

  // Include all other methods from the original plugin...
  // (handleRequest, handlePending, handleTimeoutCheck, onMessage, parseIntroduction, etc.)
  // These remain largely the same as the original implementation

  async handleRequest(context) {
    const { message, sender, args, groupId, senderName } = context;
    
    if (groupId !== this.entryRoomId) {
      return '❌ !request only works in the Entry room';
    }
    
    const mentionedUser = this.extractMention(args);
    if (!mentionedUser) {
      return '❌ Please mention a user: !request @user';
    }
    
    const now = Date.now();
    const session = {
      sessionId: `${mentionedUser}-${now}`,
      userId: mentionedUser,
      initiatedBy: sender,
      initiatedByName: senderName,
      requestTimestamp: now,
      timeoutAt: now + (24 * 60 * 60 * 1000),
      status: 'pending_introduction',
      startedAt: now,
      lastActivityAt: now
    };
    
    this.pendingUsers.set(mentionedUser, session);
    await this.saveSession(session);
    
    await this.logModeratingAction('ONBOARDING REQUEST', 
      `Initiator: ${senderName || sender}
Target: ${mentionedUser}
Room: Entry/INDOC
Timeout: 24 hours`);
    
    const introPrompt = this.getIntroductionPrompt();
    
    // Send DM if we have Signal API
    if (this.pluginManager?.bot?.sendDirectMessage) {
      await this.pluginManager.bot.sendDirectMessage(mentionedUser, introPrompt);
    }
    
    return `✅ Introduction request sent to user. They have 24 hours to post introduction and get approved.`;
  }

  parseIntroduction(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const userData = {};

    lines.forEach((line, index) => {
      const content = line.replace(/^\d+[\.\:\-\)\(\]\[\}\{_\s\@]*\s*/, '').trim();
      
      switch(index) {
        case 0: // Name
          const nameParts = content.split(' ');
          userData.firstName = nameParts[0];
          userData.lastName = nameParts.slice(1).join(' ');
          break;
        case 1: // Organization
          userData.organization = content;
          break;
        case 2: // Invited by
          userData.invitedBy = content;
          break;
        case 3: // Email
          if (content.includes('@')) userData.email = content;
          break;
        case 4: // Interests
          userData.interests = content;
          break;
        case 5: // LinkedIn (optional)
          if (content.toLowerCase() !== 'skip') {
            userData.linkedinUsername = content;
          }
          break;
      }
    });
    
    return userData;
  }

  extractMention(text) {
    if (!text) return null;
    const mentionMatch = text.match(/@(\S+)/);
    return mentionMatch ? mentionMatch[1] : null;
  }

  extractReplyContext(message) {
    if (message.quote) {
      return {
        quotedAuthor: message.quote.author,
        quotedText: message.quote.text
      };
    }
    return null;
  }

  getIntroductionPrompt() {
    return `Welcome! Please provide your introduction in the following format:

1. Your full name
2. Your organization
3. Who invited you
4. Your email address
5. Your interests (AI, security, development, etc.)
6. Your LinkedIn profile (optional, type 'skip' to skip)

You have 24 hours to post your introduction and get approved by an admin.`;
  }

  async saveSession(session) {
    await this.db.run(`
      INSERT INTO onboarding_sessions 
      (session_id, user_id, phone_number, current_step, session_data, 
       initiated_by, request_timestamp, timeout_at, started_at, 
       last_activity_at, completed_at, removed_at, credentials)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      session.sessionId,
      session.userId,
      session.phoneNumber || null,
      session.status,
      JSON.stringify(session.introductionData || {}),
      session.initiatedBy,
      session.requestTimestamp,
      session.timeoutAt,
      session.startedAt,
      session.lastActivityAt,
      session.completedAt || null,
      session.removedAt || null,
      session.credentials || null
    );
  }

  async updateSession(session) {
    await this.db.run(`
      UPDATE onboarding_sessions 
      SET current_step = ?, session_data = ?, last_activity_at = ?, 
          completed_at = ?, removed_at = ?, credentials = ?
      WHERE session_id = ?
    `,
      session.status,
      JSON.stringify(session.introductionData || {}),
      session.lastActivityAt,
      session.completedAt || null,
      session.removedAt || null,
      session.credentials || null,
      session.sessionId
    );
  }

  cleanup() {
    if (this.timeoutCheckInterval) {
      clearInterval(this.timeoutCheckInterval);
      this.timeoutCheckInterval = null;
    }
    if (super.cleanup) {
      super.cleanup();
    }
  }
}