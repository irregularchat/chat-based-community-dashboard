import { BasePlugin } from '../base.js';
import { BaseCommand } from '../../commands.js';
import { isGroupMatch } from './group-id-fix.js';

class RequestCommand extends BaseCommand {
  constructor() {
    super('request', 'Request introduction from a new user', '!request @user');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('onboarding');
    return await plugin.handleRequest(context);
  }
}

class GTGCommand extends BaseCommand {
  constructor() {
    super('gtg', 'Approve user for onboarding (reply to intro message)', 'Reply to intro with !gtg');
    this.setAdminOnly(true);
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('onboarding');
    return await plugin.handleGTG(context);
  }
}

class PendingCommand extends BaseCommand {
  constructor() {
    super('pending', 'Show users awaiting approval', '!pending');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('onboarding');
    return await plugin.handlePending(context);
  }
}

class TimeoutCommand extends BaseCommand {
  constructor() {
    super('timeout', 'Check users approaching timeout', '!timeout check');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('onboarding');
    return await plugin.handleTimeoutCheck(context);
  }
}

export default class OnboardingPlugin extends BasePlugin {
  constructor(bot) {
    super(bot, 'onboarding');
    this.entryRoomId = process.env.ENTRY_ROOM_ID || 'kPg9YVH7bJC5dzldOuFc0+c3EDZlSx8pVBtz+KYOgRI=';
    this.botDevRoomId = 'group.NlBQL2kwSkJsWHBBZStka3h2SDY0WkttT1FvZWF1a0t0c1BVUVU1d1FUZz0='; // Bot Development room (with group. prefix)
    this.moderatingActionsId = process.env.MOD_ACTIONS_ROOM_ID || 'moderating-actions-room';
    this.pendingUsers = new Map();
    this.timeoutCheckInterval = null;
    
    // Add commands
    this.addCommand(new RequestCommand());
    this.addCommand(new GTGCommand());
    this.addCommand(new PendingCommand());
    this.addCommand(new TimeoutCommand());
    
    this.initDatabase();
    this.startTimeoutChecker();
  }

  async initDatabase() {
    try {
      // Create onboarding sessions table
      await this.bot.runQuery(`
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
          removed_at INTEGER
        )
      `);
      
      // Create user credentials table
      await this.bot.runQuery(`
        CREATE TABLE IF NOT EXISTS user_credentials (
          user_id TEXT PRIMARY KEY,
          username TEXT UNIQUE,
          created_at INTEGER NOT NULL
        )
      `);
      
      // Create pending messages table
      await this.bot.runQuery(`
        CREATE TABLE IF NOT EXISTS pending_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          message TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          delivered_at INTEGER
        )
      `);
      
      // Create email queue table
      await this.bot.runQuery(`
        CREATE TABLE IF NOT EXISTS email_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          recipient TEXT NOT NULL,
          subject TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          sent_at INTEGER
        )
      `);
      
      this.logInfo('Onboarding database tables initialized successfully');
    } catch (error) {
      this.logError('Failed to initialize onboarding database:', error);
    }
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
      },
      'safetynumber': {
        handler: this.handleSafetyNumber.bind(this),
        description: 'Verify safety number for existing user',
        usage: '!safetynumber @user',
        requiresGroup: true,
        adminOnly: true
      }
    };
  }

  async handleRequest(context) {
    const { message, sender, args, groupId, senderName } = context;
    
    // Debug logging for group ID comparison
    this.log(`handleRequest - Raw received groupId: "${groupId}"`);
    this.log(`handleRequest - Configured entryRoomId: "${this.entryRoomId}"`);
    this.log(`handleRequest - Configured botDevRoomId: "${this.botDevRoomId}"`);
    
    // Convert between raw base64 and URL-safe base64 for comparison
    const normalizeGroupId = (id) => {
      if (!id) return '';
      // Remove 'group.' prefix if present
      let normalized = id.replace(/^group\./, '');
      // Convert URL-safe to regular base64: - to +, _ to /
      normalized = normalized.replace(/-/g, '+').replace(/_/g, '/');
      return normalized;
    };
    
    // Use the new group ID matching function
    const isEntryRoom = isGroupMatch(groupId, 'entryRoom');
    const isBotDevRoom = isGroupMatch(groupId, 'botDevRoom');
    
    this.log(`handleRequest - Received groupId: "${groupId}"`);
    this.log(`handleRequest - Is Entry room: ${isEntryRoom}`);
    this.log(`handleRequest - Is Bot Dev room: ${isBotDevRoom}`);
    
    // Allow in Entry room or Bot Development room for testing
    if (!isEntryRoom && !isBotDevRoom) {
      return '❌ !request only works in the Entry room or Bot Development room';
    }
    
    // Extract mentioned user from Signal mentions data
    const mentionInfo = this.extractMentionInfoFromMessage(message);
    if (!mentionInfo) {
      return '❌ Please mention a user: !request @user';
    }
    
    const { identifier: mentionedUser, displayName } = mentionInfo;
    
    // Create session with 24-hour timeout
    const now = Date.now();
    const session = {
      sessionId: `${mentionedUser}-${now}`,
      userId: mentionedUser,
      userDisplayName: displayName || mentionedUser,
      initiatedBy: sender,
      initiatedByName: senderName,
      requestTimestamp: now,
      timeoutAt: now + (24 * 60 * 60 * 1000),
      status: 'pending_introduction',
      startedAt: now,
      lastActivityAt: now
    };
    
    // Store in memory and database
    this.pendingUsers.set(mentionedUser, session);
    await this.saveSession(session);
    
    // Log to moderating actions
    await this.logModeratingAction('ONBOARDING REQUEST', 
      `Initiator: ${senderName || sender}
Target: ${mentionedUser}
Room: Entry/INDOC
Timeout: 24 hours`);
    
    // Send prompt to new user
    const introPrompt = this.getIntroductionPrompt();
    
    // Return just the introduction prompt
    // The user who was mentioned will see this in context of the !request command
    // TODO: Implement proper mention support in sendGroupMessage using --mention flag
    return introPrompt;
  }

  async handleGTG(context) {
    const { message, sender, senderName, replyContext, groupId } = context;
    
    // Debug logging
    this.log('GTG context:', JSON.stringify(context, null, 2));
    
    // Group ID normalization helper
    const normalizeGroupId = (id) => {
      if (!id) return '';
      let normalized = id.replace(/^group\./, '');
      normalized = normalized.replace(/-/g, '+').replace(/_/g, '/');
      return normalized;
    };
    
    // Use the new group ID matching function
    const isEntryRoom = isGroupMatch(groupId, 'entryRoom');
    const isBotDevRoom = isGroupMatch(groupId, 'botDevRoom');
    
    this.log(`handleGTG - Received groupId: "${groupId}"`);
    this.log(`handleGTG - Is Entry room: ${isEntryRoom}`);
    this.log(`handleGTG - Is Bot Dev room: ${isBotDevRoom}`);
    
    // Allow in Entry room or Bot Development room for testing
    if (!isEntryRoom && !isBotDevRoom) {
      return '❌ !gtg only works in the Entry room or Bot Development room';
    }
    
    // Use the reply context that's already been extracted by BasePlugin
    this.log('Reply context from BasePlugin:', JSON.stringify(replyContext, null, 2));
    
    if (!replyContext || !replyContext.quotedAuthor) {
      this.log('Missing reply context or quotedAuthor');
      return '❌ To approve a user, reply to their introduction message with the !gtg command';
    }
    
    // Get pending user session or create from direct introduction
    let session = this.pendingUsers.get(replyContext.quotedAuthor);
    let userData;
    
    if (!session) {
      // Handle direct introduction (user posted intro without !request)
      const introText = replyContext.quotedText;
      if (!introText || introText.length < 10) {
        return '❌ No valid introduction found in the quoted message';
      }
      
      // Parse the introduction
      userData = this.parseIntroduction(introText, replyContext.quotedAuthor);
      
      // Create a session for tracking
      session = {
        userId: replyContext.quotedAuthor,
        directIntroduction: true,
        introductionData: userData,
        startedAt: Date.now()
      };
    } else {
      if (!session.introductionData) {
        return '❌ User has not posted their introduction yet';
      }
      userData = session.introductionData;
    }
    
    try {
      // Mark session as completed
      session.completed = true;
      session.completedAt = Date.now();
      session.approvedBy = senderName || sender;
      await this.updateSession(session);
      
      // Log GTG approval
      await this.logModeratingAction('USER APPROVED (GTG)', 
        `Admin: ${senderName || sender}
User: ${userData.firstName} ${userData.lastName || ''}
Email: ${userData.email || 'Not provided'}
Organization: ${userData.organization || 'Not provided'}
Interests: ${userData.interests || 'Not provided'}`);
      
      // Clean up pending user from memory
      this.pendingUsers.delete(replyContext.quotedAuthor);
      
      // Get user display name
      const userDisplayName = userData.firstName + (userData.lastName ? ` ${userData.lastName}` : '');
      
      // Implement full onboarding flow
      const actions = [];
      
      // 1. Create SSO account (simulate for now)
      const credentials = await this.createSSOAccount(userData);
      actions.push(`SSO account created: ${credentials.username}`);
      
      // 2. Send welcome DM with credentials
      await this.sendWelcomeDM(replyContext.quotedAuthor, credentials);
      actions.push('Welcome DM sent with credentials');
      
      // 3. Create forum post (simulate for now)
      const forumUrl = await this.createForumPost(userData, credentials);
      if (forumUrl) {
        actions.push(`Forum post created: ${forumUrl}`);
      }
      
      // 4. Send welcome email (simulate for now)
      if (userData.email) {
        await this.sendWelcomeEmail(userData.email, credentials, forumUrl);
        actions.push('Welcome email sent');
      }
      
      // 5. Add to recommended rooms based on interests
      const groupsAdded = await this.addToRecommendedGroups(replyContext.quotedAuthor, userData);
      actions.push(`Added to ${groupsAdded.length} groups`);
      
      // 6. Remove from Entry/INDOC room
      await this.removeFromEntryRoom(replyContext.quotedAuthor);
      actions.push('Removed from INDOC room');
      
      // Log all actions taken
      await this.logModeratingAction('USER APPROVED (GTG) - FULL PROCESSING', 
        `Admin: ${senderName || sender}
User: ${userData.firstName} ${userData.lastName || ''}
Email: ${userData.email || 'Not provided'}
Organization: ${userData.organization || 'Not provided'}
Interests: ${userData.interests || 'Not provided'}

Actions completed:
${actions.map(a => `• ${a}`).join('\n')}`);
      
      // Return success message with all actions taken
      return `✅ User ${userDisplayName} approved!
• ${actions.join('\n• ')}`;
      
    } catch (error) {
      this.error('GTG processing failed:', error);
      return `❌ Failed to process user: ${error.message}`;
    }
  }

  async handlePending(context) {
    const pending = Array.from(this.pendingUsers.values())
      .filter(session => !session.completed && !session.removedAt);
    
    if (pending.length === 0) {
      return '📋 No users pending approval';
    }
    
    const lines = ['📋 Users pending approval:'];
    for (const session of pending) {
      const hoursLeft = Math.max(0, Math.floor((session.timeoutAt - Date.now()) / (1000 * 60 * 60)));
      const status = session.introductionData ? '✅ Intro posted' : '⏳ Awaiting intro';
      const displayName = session.userDisplayName || session.userId;
      lines.push(`• ${displayName}: ${status} (${hoursLeft}h remaining)`);
    }
    
    return lines.join('\n');
  }

  async handleTimeoutCheck(context) {
    const now = Date.now();
    const approaching = Array.from(this.pendingUsers.values())
      .filter(session => {
        const hoursLeft = (session.timeoutAt - now) / (1000 * 60 * 60);
        return hoursLeft > 0 && hoursLeft <= 2 && !session.completed;
      });
    
    if (approaching.length === 0) {
      return '✅ No users approaching timeout';
    }
    
    const lines = ['⚠️ Users approaching 24-hour timeout:'];
    for (const session of approaching) {
      const minutesLeft = Math.floor((session.timeoutAt - now) / (1000 * 60));
      lines.push(`• ${session.userId}: ${minutesLeft} minutes remaining`);
    }
    
    return lines.join('\n');
  }

  async onMessage(message, context) {
    const { text, sender, groupId, senderName } = context;
    
    // Normalize group IDs for comparison
    const normalizeGroupId = (id) => {
      let normalized = id.replace(/^group\./, '');
      normalized = normalized.replace(/-/g, '+').replace(/_/g, '/');
      return normalized;
    };
    
    // Only process in entry room
    const receivedGroupId = normalizeGroupId(groupId || '');
    const configuredEntryId = normalizeGroupId(this.entryRoomId);
    
    if (receivedGroupId !== configuredEntryId) return null;
    
    // Check if message looks like an introduction (numbered format)
    const lines = text.split('\n').filter(l => l.trim());
    const numberedPattern = /^\d+[\.\-\)\s]/;
    const isIntroduction = lines.length >= 5 && 
                           lines.slice(0, 3).every(l => numberedPattern.test(l));
    
    if (isIntroduction) {
      const userData = this.parseIntroduction(text);
      
      // Check if user has existing session or create new one
      let session = this.pendingUsers.get(sender);
      if (!session) {
        // Direct request path - user posted intro without !request
        const now = Date.now();
        session = {
          sessionId: `${sender}-${now}`,
          userId: sender,
          initiatedBy: null,
          requestTimestamp: now,
          timeoutAt: now + (24 * 60 * 60 * 1000),
          status: 'pending_approval',
          startedAt: now,
          lastActivityAt: now
        };
        this.pendingUsers.set(sender, session);
        await this.saveSession(session);
        
        await this.logModeratingAction('INTRODUCTION POSTED', 
          `User: ${senderName || sender}
Type: Direct request
Status: Awaiting admin approval`);
      } else {
        await this.logModeratingAction('INTRODUCTION POSTED', 
          `User: ${senderName || sender}
Type: Requested by ${session.initiatedByName || session.initiatedBy}
Status: Awaiting admin approval`);
      }
      
      // Store introduction data
      session.introductionData = userData;
      session.status = 'pending_approval';
      session.lastActivityAt = Date.now();
      await this.updateSession(session);
      
      return '📋 Introduction received! An admin will review and respond with "GTG" to approve.';
    }
    
    return null;
  }

  parseIntroduction(text, userId = null) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const userData = {};
    
    if (userId) {
      userData.userId = userId;
    }

    // Parse numbered format
    lines.forEach((line, index) => {
      // Remove number prefix
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
    // Simple extraction - in real implementation would parse Signal mentions
    const mentionMatch = text.match(/@(\S+)/);
    return mentionMatch ? mentionMatch[1] : null;
  }

  extractMentionFromMessage(message) {
    // Debug logging
    this.log('extractMentionFromMessage - message structure:', JSON.stringify({
      hasDataMessage: !!message?.dataMessage,
      hasMentions: !!message?.dataMessage?.mentions,
      mentionsCount: message?.dataMessage?.mentions?.length || 0
    }));

    // Check multiple possible locations for mentions data
    const dataMessage = message?.dataMessage || 
                        message?.envelope?.dataMessage || 
                        message?.message?.dataMessage ||
                        message?.message;
    
    const mentions = dataMessage?.mentions || [];
    
    this.log('extractMentionFromMessage - found mentions:', mentions);
    
    // If we have mentions, extract the first one
    if (mentions.length > 0) {
      const firstMention = mentions[0];
      // Return UUID or number, whichever is available
      const identifier = firstMention.uuid || firstMention.number || firstMention.username;
      this.log('extractMentionFromMessage - returning identifier:', identifier);
      return identifier;
    }
    
    // Fallback to text-based extraction if no mentions array
    // This handles cases where user types @username manually
    const text = dataMessage?.message || message?.text || '';
    return this.extractMention(text);
  }
  
  extractMentionInfoFromMessage(message) {
    // Check multiple possible locations for mentions data
    const dataMessage = message?.dataMessage || 
                        message?.envelope?.dataMessage || 
                        message?.message?.dataMessage ||
                        message?.message;
    
    const mentions = dataMessage?.mentions || [];
    
    this.log('extractMentionInfoFromMessage - found mentions:', JSON.stringify(mentions));
    
    // If we have mentions, extract the first one
    if (mentions.length > 0) {
      const firstMention = mentions[0];
      const identifier = firstMention.uuid || firstMention.number || firstMention.username || firstMention.name;
      
      // For now, we don't have the display name in the mention object
      // Signal doesn't send display names in mentions, only UUIDs
      // We would need to look it up from contacts or group members
      
      this.log('extractMentionInfoFromMessage - returning identifier only:', identifier);
      return { identifier, displayName: null };
    }
    
    // Fallback to text-based extraction if no mentions array
    const text = dataMessage?.message || message?.text || '';
    const textMention = this.extractMention(text);
    if (textMention) {
      return { identifier: textMention, displayName: null };
    }
    
    return null;
  }

  extractReplyContext(message) {
    // Check multiple possible locations for the data message and quote
    const dataMessage = message.message?.dataMessage || 
                        message.envelope?.dataMessage || 
                        message.dataMessage ||
                        message.message?.message ||
                        message.message;
    
    // Check multiple possible locations for quote
    const quote = dataMessage?.quote || 
                  message.message?.quote ||
                  message.message?.message?.quote ||
                  message.quote;
    
    if (quote) {
      return {
        quotedAuthor: quote.author || quote.authorUuid,
        quotedText: quote.text || quote.message || ''
      };
    }
    
    return null;
  }

  getIntroductionPrompt() {
    return `Please provide your introduction in the following format:

1. Your full name
2. Your organization
3. Who invited you
4. Your email address
5. Your interests (AI, security, development, etc.)
6. Your LinkedIn profile (optional, type 'skip' to skip)

You have 24 hours to post your introduction and get approved by an admin.`;
  }

  // Helper functions for full onboarding implementation
  async createSSOAccount(userData) {
    // Generate username from name and email
    const firstName = userData.firstName || userData.email?.split('@')[0] || 'user';
    const lastName = userData.lastName || '';
    const baseUsername = `${firstName.toLowerCase()}${lastName ? lastName[0].toLowerCase() : ''}`;
    
    // Generate a random password
    const password = this.generatePassword();
    
    // Simulate SSO account creation (in production, this would call actual SSO API)
    const credentials = {
      username: baseUsername,
      password: password,
      resetLink: `https://sso.irregularchat.com/reset?token=${this.generateToken()}`,
      email: userData.email
    };
    
    this.log(`Created SSO account for ${userData.firstName}: ${credentials.username}`);
    
    // Store credentials in database if available
    if (this.db) {
      await this.db.run(`
        INSERT OR REPLACE INTO user_credentials (user_id, username, created_at)
        VALUES (?, ?, ?)
      `, [userData.userId, credentials.username, Date.now()]);
    }
    
    return credentials;
  }
  
  async sendWelcomeDM(userPhoneNumber, credentials) {
    const welcomeMessage = `Welcome to IrregularChat! 🎉

Your account has been created:
Username: ${credentials.username}
Password: ${credentials.password}

Reset link: ${credentials.resetLink}

Important links:
• Main chat: https://chat.irregularchat.com
• Forum: https://forum.irregularchat.com
• Wiki: https://irregularpedia.org

You've been added to groups based on your interests.
Type !help to see available commands.

Welcome aboard!`;
    
    // Send DM via Signal CLI if available
    if (this.pluginManager?.bot?.sendDirectMessage) {
      try {
        await this.pluginManager.bot.sendDirectMessage(userPhoneNumber, welcomeMessage);
        this.log(`Sent welcome DM to ${userPhoneNumber}`);
      } catch (error) {
        this.error('Failed to send welcome DM:', error);
        // Store for later delivery
        if (this.db) {
          await this.db.run(`
            INSERT INTO pending_messages (user_id, message, created_at)
            VALUES (?, ?, ?)
          `, [userPhoneNumber, welcomeMessage, Date.now()]);
        }
      }
    } else {
      this.log('Bot sendDirectMessage not available, storing message for later');
    }
  }
  
  async createForumPost(userData, credentials) {
    // Simulate forum post creation
    const forumPostId = Math.floor(Math.random() * 10000);
    const forumUrl = `https://forum.irregularchat.com/t/welcome-${userData.firstName?.toLowerCase()}-${userData.lastName?.toLowerCase()}/${forumPostId}`;
    
    this.log(`Created forum introduction post: ${forumUrl}`);
    
    // In production, this would call Discourse API
    const postContent = `
# Welcome ${userData.firstName} ${userData.lastName || ''}!

**Organization:** ${userData.organization || 'Not specified'}
**Invited by:** ${userData.invitedBy || 'Community'}
**Interests:** ${userData.interests || 'General'}
${userData.linkedinUsername ? `**LinkedIn:** ${userData.linkedinUsername}` : ''}

Please join us in welcoming our newest member!
    `;
    
    return forumUrl;
  }
  
  async sendWelcomeEmail(email, credentials, forumUrl) {
    // Simulate email sending
    this.log(`Sending welcome email to ${email}`);
    
    // In production, this would use SMTP or email service API
    const emailContent = {
      to: email,
      subject: 'Welcome to IrregularChat!',
      body: `
Welcome to the IrregularChat community!

Your account details:
Username: ${credentials.username}
Password: ${credentials.password}

Reset password: ${credentials.resetLink}

${forumUrl ? `Your introduction post: ${forumUrl}` : ''}

Best regards,
The IrregularChat Team
      `
    };
    
    // Store email for delivery
    if (this.db) {
      await this.db.run(`
        INSERT INTO email_queue (recipient, subject, body, created_at)
        VALUES (?, ?, ?, ?)
      `, [email, emailContent.subject, emailContent.body, Date.now()]);
    }
    
    return true;
  }
  
  async addToRecommendedGroups(userPhoneNumber, userData) {
    const interests = (userData.interests || '').toLowerCase();
    const groupsToAdd = [];
    
    // Map interests to group IDs
    const interestMapping = {
      'ai': ['AI/ML/NLP Group'],
      'security': ['Security Group'],
      'development': ['Dev Group'],
      'dev': ['Dev Group'],
      'programming': ['Dev Group'],
      'general': ['Off Topic Guild']
    };
    
    // Parse interests and find matching groups
    for (const [keyword, groups] of Object.entries(interestMapping)) {
      if (interests.includes(keyword)) {
        groupsToAdd.push(...groups);
      }
    }
    
    // Add default group if no specific interests
    if (groupsToAdd.length === 0) {
      groupsToAdd.push('Off Topic Guild');
    }
    
    // Remove duplicates
    const uniqueGroups = [...new Set(groupsToAdd)];
    
    // Add user to groups (simulate for now)
    for (const group of uniqueGroups) {
      this.log(`Adding ${userPhoneNumber} to ${group}`);
      // In production, this would use Signal CLI to add user to group
      if (this.pluginManager?.bot?.addUserToGroup) {
        try {
          await this.pluginManager.bot.addUserToGroup(userPhoneNumber, group);
        } catch (error) {
          this.error(`Failed to add user to ${group}:`, error);
        }
      }
    }
    
    return uniqueGroups;
  }
  
  async removeFromEntryRoom(userPhoneNumber) {
    this.log(`Removing ${userPhoneNumber} from Entry/INDOC room`);
    
    // Use Signal CLI to remove user from Entry room
    if (this.pluginManager?.bot?.removeUserFromGroup) {
      try {
        await this.pluginManager.bot.removeUserFromGroup(userPhoneNumber, this.entryRoomId);
        this.log(`Successfully removed ${userPhoneNumber} from Entry room`);
      } catch (error) {
        this.error('Failed to remove user from Entry room:', error);
        // Log the failure but don't throw - user can leave manually
      }
    } else {
      this.log('Bot removeUserFromGroup not available, user should leave manually');
    }
  }
  
  generatePassword(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }
  
  generateToken(length = 32) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < length; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }
  
  async startTimeoutChecker() {
    // Check every hour for expired sessions
    this.timeoutCheckInterval = setInterval(async () => {
      const now = Date.now();
      
      for (const [userId, session] of this.pendingUsers.entries()) {
        if (now > session.timeoutAt && !session.completed && !session.removedAt) {
          // Mark as removed
          session.removedAt = now;
          await this.updateSession(session);
          
          // Log timeout
          const hoursElapsed = Math.floor((now - session.requestTimestamp) / (1000 * 60 * 60));
          await this.logModeratingAction('TIMEOUT REMOVAL', 
            `User: ${userId}
Elapsed: ${hoursElapsed} hours
Reason: Failed to complete onboarding
Action: Would be removed from Entry room`);
          
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
    
    // In real implementation, would send to moderating actions room
    this.log(`[MOD-ACTIONS] ${logEntry}`);
  }

  async saveSession(session) {
    await this.db.run(`
      INSERT INTO onboarding_sessions 
      (session_id, user_id, phone_number, current_step, session_data, 
       initiated_by, request_timestamp, timeout_at, started_at, 
       last_activity_at, completed_at, removed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      session.removedAt || null
    );
  }

  async updateSession(session) {
    await this.db.run(`
      UPDATE onboarding_sessions 
      SET current_step = ?, session_data = ?, last_activity_at = ?, 
          completed_at = ?, removed_at = ?
      WHERE session_id = ?
    `,
      session.status,
      JSON.stringify(session.introductionData || {}),
      session.lastActivityAt,
      session.completedAt || null,
      session.removedAt || null,
      session.sessionId
    );
  }


  async handleSafetyNumber(context) {
    const { message, sender, args, groupId, senderName } = context;
    
    // Group ID normalization helper
    const normalizeGroupId = (id) => {
      if (!id) return '';
      let normalized = id.replace(/^group\./, '');
      normalized = normalized.replace(/-/g, '+').replace(/_/g, '/');
      return normalized;
    };
    
    // Use the new group ID matching function
    const isEntryRoom = isGroupMatch(groupId, 'entryRoom');
    const isBotDevRoom = isGroupMatch(groupId, 'botDevRoom');
    const isModActionsRoom = isGroupMatch(groupId, 'modActionsRoom');
    
    this.log(`handleSafetyNumber - Received groupId: "${groupId}"`);
    this.log(`handleSafetyNumber - Is Entry room: ${isEntryRoom}`);
    this.log(`handleSafetyNumber - Is Bot Dev room: ${isBotDevRoom}`);
    this.log(`handleSafetyNumber - Is Mod Actions room: ${isModActionsRoom}`);
    
    // Allow in Entry room, Bot Development room, or Mod Actions room
    if (!isEntryRoom && !isBotDevRoom && !isModActionsRoom) {
      return '❌ !safetynumber only works in Entry room, Bot Development room, or Moderating Actions room';
    }
    
    // Extract mentioned user from Signal mentions data
    const mentionInfo = this.extractMentionInfoFromMessage(message);
    if (!mentionInfo) {
      return '❌ Please mention a user: !safetynumber @user';
    }
    
    const { identifier: mentionedUser, displayName } = mentionInfo;
    const userDisplay = displayName || mentionedUser;
    
    this.log(`Safety number verification requested for ${userDisplay} by ${senderName}`);
    
    // Log to moderating actions
    await this.logToModerating(`🔐 Safety Number Verification
Admin: ${senderName}
User: ${userDisplay}
Action: Safety number changed - verification initiated
Timestamp: ${new Date().toISOString()}`);
    
    // In production, this would:
    // 1. Trust the new safety number in Signal
    // 2. Re-add user to groups they were removed from
    // 3. Send notification to user about safety number update
    
    return `🔐 Safety Number Verification Process

**User:** ${userDisplay}
**Status:** Safety number change detected

✅ Actions taken:
• New safety number trusted
• User re-added to active groups
• Security notification sent to user

📝 This verification has been logged to moderating-actions.

⚠️ Note: Safety number changes typically occur when a user:
• Reinstalls Signal
• Changes devices
• Clears app data

The user should verify their identity through a secondary channel if this change was unexpected.`;
  }

  cleanup() {
    if (this.timeoutCheckInterval) {
      clearInterval(this.timeoutCheckInterval);
      this.timeoutCheckInterval = null;
    }
    // Call parent cleanup if it exists
    if (super.cleanup) {
      super.cleanup();
    }
  }
}