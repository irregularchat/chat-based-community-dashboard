#!/usr/bin/env node

/**
 * Member Tracking Signal CLI Bot
 * Enhanced bot with proper UUID-based member tracking and deduplication
 * Features:
 * - Real member tracking with UUID deduplication
 * - Database integration with SignalMember tables
 * - Accurate member count analytics
 * - Group membership tracking
 * - Member activity monitoring
 * - Complete Signal bot functionality
 */

const axios = require('axios');

class MemberTrackingSignalBot {
  constructor() {
    // Signal Configuration
    this.phoneNumber = '+19108471202';
    this.restApiUrl = 'http://localhost:50240';
    this.isRunning = false;
    this.lastMessageTimestamp = Date.now();
    
    // Admin Users
    this.adminUsers = ['+19252261911', '+12069509896', '+15108098701'];
    
    // Message handling
    this.messageQueue = new Map();
    this.processingMessage = false;
    this.processedMessages = new Set();
    this.messageTimestamps = new Map();
    this.duplicateDetectionWindow = 30000;
    
    // Performance optimizations
    this.pollInterval = 2000;
    this.apiTimeout = 10000;
    this.maxRetries = 3;
    this.messageCache = new Set();
    
    // AI Configuration
    this.openAiApiKey = process.env.OPENAI_API_KEY;
    this.localAiUrl = process.env.LOCAL_AI_URL || 'http://localhost:8080';
    
    // Database
    this.prisma = null;
    this.initializeDatabase();
    
    // Member tracking
    this.memberCache = new Map(); // Cache for recent member lookups
    this.groupMemberCache = new Map(); // Cache for group memberships
    this.memberStats = {
      totalTracked: 0,
      newMembersToday: 0,
      activeGroups: 0,
      lastStatsUpdate: new Date()
    };
    
    // Q&A System
    this.questions = new Map();
    this.questionCounter = 0;
    this.userQuestions = new Map();
    
    // URL Processing
    this.cleanedUrls = new Map();
    this.newsSummaries = new Map();
    
    // Initialize commands
    this.commands = this.initializeCommands();
    
    console.log('🚀 Member Tracking Signal Bot initialized');
    console.log(`📱 Phone: ${this.phoneNumber}`);
    console.log(`🤖 OpenAI: ${this.openAiApiKey ? 'Configured' : 'Not configured'}`);
    console.log(`🧠 LocalAI: ${this.localAiUrl}`);
    console.log(`🗄️  Database: ${this.prisma ? 'Connected' : 'Not connected'}`);
    console.log(`📋 Commands loaded: ${Object.keys(this.commands).length}`);
  }

  async initializeDatabase() {
    try {
      const { PrismaClient } = require('./src/generated/prisma');
      this.prisma = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL || 'postgresql://dashboarduser:password_for_db@localhost:5436/dashboarddb'
          }
        }
      });
      
      await this.prisma.$connect();
      console.log('✅ Database connected successfully');
      
      // Load initial member stats
      await this.loadMemberStats();
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      this.prisma = null;
    }
  }

  async loadMemberStats() {
    if (!this.prisma) return;
    
    try {
      const totalMembers = await this.prisma.signalMember.count();
      const activeGroups = await this.prisma.signalMember.count({
        where: { totalGroups: { gt: 0 } }
      });
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const newToday = await this.prisma.signalMember.count({
        where: { 
          firstSeenAt: { gte: today }
        }
      });
      
      this.memberStats = {
        totalTracked: totalMembers,
        newMembersToday: newToday,
        activeGroups,
        lastStatsUpdate: new Date()
      };
      
      console.log(`📊 Member Stats: ${totalMembers} total, ${newToday} new today, ${activeGroups} active`);
    } catch (error) {
      console.error('❌ Failed to load member stats:', error.message);
    }
  }

  // Member tracking functions
  async trackMember(sourceUuid, phoneNumber = null, displayName = null, groupId = null, groupName = null) {
    if (!this.prisma) return null;
    
    try {
      // Check cache first
      const cacheKey = sourceUuid || phoneNumber;
      if (this.memberCache.has(cacheKey)) {
        const cachedMember = this.memberCache.get(cacheKey);
        // Update activity timestamp
        await this.updateMemberActivity(cachedMember.id, groupId);
        return cachedMember;
      }
      
      // Find or create member
      let member = await this.prisma.signalMember.upsert({
        where: { uuid: sourceUuid || 'phone:' + phoneNumber },
        update: {
          phoneNumber: phoneNumber,
          displayName: displayName,
          lastSeenAt: new Date(),
          totalMessages: { increment: 1 }
        },
        create: {
          uuid: sourceUuid || 'phone:' + phoneNumber,
          phoneNumber: phoneNumber,
          displayName: displayName,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          totalMessages: 1,
          totalGroups: 0
        }
      });
      
      // Cache the member
      this.memberCache.set(cacheKey, member);
      
      // Track group membership if provided
      if (groupId) {
        await this.trackGroupMembership(member.id, groupId, groupName);
      }
      
      return member;
    } catch (error) {
      console.error('❌ Failed to track member:', error.message);
      return null;
    }
  }

  async trackGroupMembership(memberId, groupId, groupName = null) {
    if (!this.prisma) return;
    
    try {
      const membershipKey = `${memberId}:${groupId}`;
      
      // Check if membership already exists
      const existingMembership = await this.prisma.signalMemberGroupMembership.findUnique({
        where: {
          memberId_groupId: {
            memberId: memberId,
            groupId: groupId
          }
        }
      });
      
      if (existingMembership) {
        // Update activity and message count
        await this.prisma.signalMemberGroupMembership.update({
          where: { id: existingMembership.id },
          data: {
            lastActiveAt: new Date(),
            messageCount: { increment: 1 }
          }
        });
      } else {
        // Create new membership
        await this.prisma.signalMemberGroupMembership.create({
          data: {
            memberId: memberId,
            groupId: groupId,
            groupName: groupName,
            joinedAt: new Date(),
            lastActiveAt: new Date(),
            messageCount: 1,
            isActive: true
          }
        });
        
        // Update member's total group count
        await this.prisma.signalMember.update({
          where: { id: memberId },
          data: { totalGroups: { increment: 1 } }
        });
        
        console.log(`✅ New member tracked: ${groupName || groupId}`);
      }
    } catch (error) {
      console.error('❌ Failed to track group membership:', error.message);
    }
  }

  async updateMemberActivity(memberId, groupId = null) {
    if (!this.prisma) return;
    
    try {
      // Update member activity
      await this.prisma.signalMember.update({
        where: { id: memberId },
        data: { lastSeenAt: new Date() }
      });
      
      // Update group membership activity if provided
      if (groupId) {
        await this.prisma.signalMemberGroupMembership.updateMany({
          where: {
            memberId: memberId,
            groupId: groupId
          },
          data: {
            lastActiveAt: new Date(),
            messageCount: { increment: 1 }
          }
        });
      }
    } catch (error) {
      console.error('❌ Failed to update member activity:', error.message);
    }
  }

  async getAccurateMemberCount() {
    if (!this.prisma) return { total: 0, breakdown: {} };
    
    try {
      const totalUnique = await this.prisma.signalMember.count();
      
      const groupBreakdown = await this.prisma.signalMemberGroupMembership.groupBy({
        by: ['groupId', 'groupName'],
        where: { isActive: true },
        _count: { memberId: true }
      });
      
      const breakdown = {};
      for (const group of groupBreakdown) {
        breakdown[group.groupName || group.groupId] = group._count.memberId;
      }
      
      return {
        total: totalUnique,
        breakdown,
        lastUpdated: new Date()
      };
    } catch (error) {
      console.error('❌ Failed to get member count:', error.message);
      return { total: 0, breakdown: {}, error: error.message };
    }
  }

  initializeCommands() {
    return {
      // Member tracking commands
      members: async (sender, args, groupId, groupName) => {
        const stats = await this.getAccurateMemberCount();
        let response = `👥 **Member Statistics (Deduplicated)**\n\n`;
        response += `📊 **Total Unique Members:** ${stats.total}\n`;
        response += `📅 **New Today:** ${this.memberStats.newMembersToday}\n`;
        response += `🏘️ **Active Groups:** ${Object.keys(stats.breakdown).length}\n\n`;
        
        if (Object.keys(stats.breakdown).length > 0) {
          response += `**Group Breakdown:**\n`;
          for (const [groupName, count] of Object.entries(stats.breakdown)) {
            response += `• ${groupName}: ${count} members\n`;
          }
        }
        
        response += `\n_Last updated: ${stats.lastUpdated.toLocaleString()}_`;
        await this.sendMessage(sender, response);
      },

      stats: async (sender, args, groupId, groupName) => {
        if (!this.prisma) {
          await this.sendMessage(sender, '❌ Database not available for stats');
          return;
        }
        
        try {
          const memberCount = await this.prisma.signalMember.count();
          const totalMessages = await this.prisma.signalMember.aggregate({
            _sum: { totalMessages: true }
          });
          const activeToday = await this.prisma.signalMember.count({
            where: { 
              lastSeenAt: { 
                gte: new Date(Date.now() - 24 * 60 * 60 * 1000) 
              } 
            }
          });
          
          let response = `📈 **Community Statistics**\n\n`;
          response += `👥 **Total Members:** ${memberCount}\n`;
          response += `💬 **Total Messages:** ${totalMessages._sum.totalMessages || 0}\n`;
          response += `⚡ **Active Today:** ${activeToday}\n`;
          response += `🤖 **Bot Uptime:** ${this.formatUptime()}\n`;
          
          await this.sendMessage(sender, response);
        } catch (error) {
          console.error('❌ Error getting stats:', error);
          await this.sendMessage(sender, '❌ Failed to retrieve statistics');
        }
      },

      // Basic bot commands
      help: async (sender) => {
        const response = `🤖 **Member Tracking Signal Bot - Help**

**👥 Member Commands:**
• \`!members\` - Show accurate member count
• \`!stats\` - Community statistics

**🔧 Utility Commands:**
• \`!help\` - This help message
• \`!ping\` - Check bot status
• \`!uptime\` - Bot uptime

**🤖 AI Commands:**
• \`!ai <question>\` - Ask OpenAI
• \`!lai <question>\` - Ask Local AI

**📋 Q&A Commands:**
• \`!ask <question>\` - Ask the community
• \`!answer <id> <answer>\` - Answer a question

_This bot tracks unique members across all groups to provide accurate analytics._`;
        
        await this.sendMessage(sender, response);
      },

      ping: async (sender) => {
        const uptime = this.formatUptime();
        await this.sendMessage(sender, `🏓 Pong! Bot is running.\n⏰ Uptime: ${uptime}\n📊 Tracking ${this.memberStats.totalTracked} unique members`);
      },

      uptime: async (sender) => {
        await this.sendMessage(sender, `⏰ Bot uptime: ${this.formatUptime()}`);
      },

      // AI Commands
      ai: async (sender, args) => {
        if (!args || args.length === 0) {
          await this.sendMessage(sender, '❓ Please provide a question for AI. Example: `!ai What is quantum computing?`');
          return;
        }
        await this.handleAI(sender, args.join(' '), 'openai');
      },

      lai: async (sender, args) => {
        if (!args || args.length === 0) {
          await this.sendMessage(sender, '❓ Please provide a question for Local AI. Example: `!lai Explain machine learning`');
          return;
        }
        await this.handleAI(sender, args.join(' '), 'local');
      },

      // Q&A System
      ask: async (sender, args, groupId, groupName) => {
        if (!args || args.length === 0) {
          await this.sendMessage(sender, '❓ Please provide a question. Example: `!ask How do I set up a VPN?`');
          return;
        }
        
        const question = args.join(' ');
        await this.handleAsk(sender, question, groupId, groupName);
      },

      answer: async (sender, args) => {
        if (!args || args.length < 2) {
          await this.sendMessage(sender, '❓ Usage: `!answer <question_id> <your_answer>`');
          return;
        }
        
        const questionId = parseInt(args[0]);
        const answer = args.slice(1).join(' ');
        await this.handleAnswer(sender, questionId, answer);
      }
    };
  }

  async handleMessage(message) {
    try {
      // Track the member who sent this message
      const member = await this.trackMember(
        message.envelope?.sourceUuid,
        message.envelope?.sourceNumber,
        message.envelope?.sourceName,
        message.envelope?.dataMessage?.groupInfo?.groupId,
        message.envelope?.dataMessage?.groupInfo?.name
      );
      
      if (member) {
        console.log(`👤 Tracked member: ${member.displayName || member.phoneNumber || member.uuid} in ${message.envelope?.dataMessage?.groupInfo?.name || 'DM'}`);
      }
      
      // Process commands
      const messageText = message.envelope?.dataMessage?.message || '';
      if (messageText.startsWith('!')) {
        await this.processCommand(message);
      }
      
      // Store message for analytics if database is available
      if (this.prisma && messageText) {
        await this.storeMessage(message);
      }
      
    } catch (error) {
      console.error('❌ Error handling message:', error);
    }
  }

  async storeMessage(message) {
    if (!this.prisma) return;
    
    try {
      await this.prisma.signalMessage.create({
        data: {
          groupId: message.envelope?.dataMessage?.groupInfo?.groupId,
          groupName: message.envelope?.dataMessage?.groupInfo?.name,
          sourceNumber: message.envelope?.sourceNumber,
          sourceName: message.envelope?.sourceName,
          sourceUuid: message.envelope?.sourceUuid,
          message: message.envelope?.dataMessage?.message || '',
          timestamp: BigInt(message.envelope?.timestamp || Date.now()),
          attachments: message.envelope?.dataMessage?.attachments || null,
          mentions: message.envelope?.dataMessage?.mentions || null,
          isReply: !!message.envelope?.dataMessage?.quote,
          quotedMessageId: message.envelope?.dataMessage?.quote?.id || null,
          quotedText: message.envelope?.dataMessage?.quote?.text || null
        }
      });
    } catch (error) {
      // Ignore duplicate message errors
      if (!error.message.includes('Unique constraint')) {
        console.error('❌ Failed to store message:', error.message);
      }
    }
  }

  async processCommand(message) {
    const messageText = message.envelope?.dataMessage?.message || '';
    const sender = message.envelope?.sourceNumber || message.envelope?.sourceUuid;
    const groupId = message.envelope?.dataMessage?.groupInfo?.groupId;
    const groupName = message.envelope?.dataMessage?.groupInfo?.name;
    
    if (!messageText.startsWith('!')) return;
    
    const parts = messageText.slice(1).trim().split(' ');
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);
    
    console.log(`🤖 Executing command: ${command}`, args);
    
    if (this.commands[command]) {
      try {
        await this.commands[command](sender, args, groupId, groupName);
      } catch (error) {
        console.error(`❌ Command ${command} failed:`, error);
        await this.sendMessage(sender, `❌ Command failed: ${error.message}`);
      }
    }
  }

  // AI handling methods
  async handleAI(sender, question, provider = 'openai') {
    try {
      let response;
      
      if (provider === 'openai' && this.openAiApiKey) {
        response = await this.askOpenAI(question);
      } else if (provider === 'local') {
        response = await this.askLocalAI(question);
      } else {
        await this.sendMessage(sender, '❌ AI provider not available');
        return;
      }
      
      await this.sendMessage(sender, response);
    } catch (error) {
      console.error(`❌ AI ${provider} error:`, error);
      await this.sendMessage(sender, '❌ AI request failed. Please try again later.');
    }
  }

  async askOpenAI(question) {
    if (!this.openAiApiKey) throw new Error('OpenAI API key not configured');
    
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-5-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant for IrregularChat, a privacy-focused tech community. Be concise and helpful.' },
        { role: 'user', content: question }
      ],
      max_tokens: 500,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${this.openAiApiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    return `🤖 **OpenAI Response:**\n\n${response.data.choices[0].message.content}`;
  }

  async askLocalAI(question) {
    const response = await axios.post(`${this.localAiUrl}/v1/chat/completions`, {
      model: 'local-model',
      messages: [
        { role: 'system', content: 'You are a helpful assistant for IrregularChat, a privacy-focused tech community. Be concise and helpful.' },
        { role: 'user', content: question }
      ],
      max_tokens: 500,
      temperature: 0.7
    }, {
      timeout: 30000
    });
    
    return `🧠 **Local AI Response:**\n\n${response.data.choices[0].message.content}`;
  }

  // Q&A System methods
  async handleAsk(sender, question, groupId, groupName) {
    if (!this.prisma) {
      await this.sendMessage(sender, '❌ Q&A system requires database connection');
      return;
    }
    
    try {
      this.questionCounter++;
      
      const qaQuestion = await this.prisma.qAndAQuestion.create({
        data: {
          questionId: this.questionCounter,
          question: question,
          asker: sender.startsWith('+') ? 'User' : 'Member',
          askerPhone: sender,
          groupId: groupId || 'dm',
          groupName: groupName || 'Direct Message',
          timestamp: new Date()
        }
      });
      
      this.questions.set(this.questionCounter, qaQuestion);
      
      const response = `❓ **Question #${this.questionCounter} Submitted**\n\n` +
                     `**Q:** ${question}\n\n` +
                     `Anyone can answer using: \`!answer ${this.questionCounter} <your_answer>\``;
      
      await this.sendMessage(sender, response);
      
      console.log(`❓ Q&A Question ${this.questionCounter}: ${question}`);
    } catch (error) {
      console.error('❌ Failed to submit question:', error);
      await this.sendMessage(sender, '❌ Failed to submit question');
    }
  }

  async handleAnswer(sender, questionId, answer) {
    if (!this.prisma) {
      await this.sendMessage(sender, '❌ Q&A system requires database connection');
      return;
    }
    
    try {
      const question = await this.prisma.qAndAQuestion.findUnique({
        where: { questionId: questionId }
      });
      
      if (!question) {
        await this.sendMessage(sender, `❌ Question #${questionId} not found`);
        return;
      }
      
      // Update question with answer
      const existingAnswers = question.answers || [];
      existingAnswers.push({
        answerer: sender,
        answer: answer,
        timestamp: new Date().toISOString()
      });
      
      await this.prisma.qAndAQuestion.update({
        where: { id: question.id },
        data: { answers: existingAnswers }
      });
      
      const response = `✅ **Answer submitted for Question #${questionId}**\n\n` +
                     `**Original Q:** ${question.question}\n\n` +
                     `**Your A:** ${answer}\n\n` +
                     `Thank you for helping the community!`;
      
      await this.sendMessage(sender, response);
      
      console.log(`✅ Answer submitted for Q${questionId}: ${answer}`);
    } catch (error) {
      console.error('❌ Failed to submit answer:', error);
      await this.sendMessage(sender, '❌ Failed to submit answer');
    }
  }

  // Utility methods
  formatUptime() {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  async sendMessage(recipient, message) {
    try {
      const response = await axios.post(`${this.restApiUrl}/v2/send`, {
        message: message,
        number: this.phoneNumber,
        recipients: [recipient]
      }, {
        timeout: this.apiTimeout,
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      console.log(`✓ Message sent to ${recipient}`);
      return response.data;
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        console.log('⏰ Send timeout, message may have been delivered');
      } else {
        console.error('❌ Failed to send message:', error.message);
        throw error;
      }
    }
  }

  async pollMessages() {
    try {
      const response = await axios.get(`${this.restApiUrl}/v1/receive/${this.phoneNumber}`, {
        timeout: this.apiTimeout
      });
      
      if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        for (const message of response.data) {
          if (message.envelope?.dataMessage?.message) {
            const messageId = `${message.envelope.timestamp}-${message.envelope.sourceNumber}-${message.envelope?.dataMessage?.message?.substring(0, 50)}`;
            
            if (!this.processedMessages.has(messageId)) {
              this.processedMessages.add(messageId);
              const sender = message.envelope.sourceNumber || message.envelope.sourceUuid;
              console.log(`📨 Message from ${sender}: ${message.envelope.dataMessage.message}`);
              await this.handleMessage(message);
            }
          }
        }
      }
    } catch (error) {
      if (error.code === 'ECONNABORTED') {
        console.log('API timeout, continuing...');
      } else {
        console.error('❌ Polling error:', error.message);
      }
    }
  }

  async start() {
    if (this.isRunning) {
      console.log('⚠️ Bot is already running');
      return;
    }
    
    this.isRunning = true;
    this.startTime = Date.now();
    
    console.log('🚀 Starting Member Tracking Signal bot...');
    console.log(`📱 Phone: ${this.phoneNumber}`);
    console.log(`🔧 Poll interval: ${this.pollInterval}ms`);
    console.log(`⏱️  API timeout: ${this.apiTimeout}ms`);
    console.log(`📋 Commands loaded: ${Object.keys(this.commands).length}`);
    console.log(`🤖 OpenAI: ${this.openAiApiKey ? 'Ready' : 'Not configured'}`);
    console.log(`🧠 LocalAI: ${this.localAiUrl}`);
    console.log(`🗄️  Database: ${this.prisma ? 'Connected' : 'Not connected'}`);
    
    // Refresh member stats every hour
    setInterval(async () => {
      await this.loadMemberStats();
    }, 60 * 60 * 1000);
    
    while (this.isRunning) {
      await this.pollMessages();
      await new Promise(resolve => setTimeout(resolve, this.pollInterval));
    }
  }

  stop() {
    this.isRunning = false;
    console.log('🛑 Bot stopped');
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down bot...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down bot...');
  process.exit(0);
});

// Start the bot
const bot = new MemberTrackingSignalBot();
bot.start().catch(console.error);