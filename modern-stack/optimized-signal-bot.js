const axios = require('axios');

class OptimizedSignalBot {
  constructor() {
    this.phoneNumber = '+19108471202';
    this.restApiUrl = 'http://localhost:50240';
    this.isRunning = false;
    this.lastMessageTimestamp = Date.now();
    this.adminUsers = ['+19252261911', '+12069509896', '+15108098701'];
    this.messageQueue = new Map();
    this.processingMessage = false;
    
    // Performance optimizations
    this.pollInterval = 2000; // Reduced from 1000ms
    this.apiTimeout = 8000; // 8 second timeout
    this.maxRetries = 2;
    this.messageCache = new Set();
    
    this.commands = this.initializeCommands();
  }

  initializeCommands() {
    return {
      'help': { handler: this.showHelp.bind(this), description: 'Show available commands', category: 'Core' },
      'status': { handler: this.showStatus.bind(this), description: 'Show bot status', category: 'Core' },
      'ping': { handler: this.handlePing.bind(this), description: 'Test bot responsiveness', category: 'Core' },
      'groups': { handler: this.listGroups.bind(this), description: 'List available groups', category: 'Core' },
      'admin': { handler: this.handleAdmin.bind(this), description: 'Admin commands', category: 'Admin', adminOnly: true },
      'restart': { handler: this.handleRestart.bind(this), description: 'Restart bot', category: 'Admin', adminOnly: true },
      'stats': { handler: this.showStats.bind(this), description: 'Show performance stats', category: 'Admin', adminOnly: true },
      
      // Q&A Commands
      'ask': { handler: this.handleAsk.bind(this), description: 'Ask a question', category: 'Q&A' },
      'faq': { handler: this.showFAQ.bind(this), description: 'Frequently asked questions', category: 'Q&A' },
      'search': { handler: this.handleSearch.bind(this), description: 'Search knowledge base', category: 'Q&A' },
      
      // Community Commands
      'welcome': { handler: this.sendWelcome.bind(this), description: 'Send welcome message', category: 'Community' },
      'rules': { handler: this.showRules.bind(this), description: 'Show community rules', category: 'Community' },
      'members': { handler: this.showMembers.bind(this), description: 'Show member count', category: 'Community' },
      'events': { handler: this.listEvents.bind(this), description: 'List upcoming events', category: 'Community' },
      
      // Information Commands  
      'about': { handler: this.showAbout.bind(this), description: 'About this community', category: 'Information' },
      'links': { handler: this.showLinks.bind(this), description: 'Important links', category: 'Information' },
      'contact': { handler: this.showContact.bind(this), description: 'Contact information', category: 'Information' },
      'timezone': { handler: this.showTimezone.bind(this), description: 'Timezone information', category: 'Information' },
      
      // News & Repos Commands
      'news': { handler: this.showNews.bind(this), description: 'Latest news', category: 'News & Repos' },
      'repos': { handler: this.listRepos.bind(this), description: 'Project repositories', category: 'News & Repos' },
      'updates': { handler: this.showUpdates.bind(this), description: 'Recent updates', category: 'News & Repos' },
      
      // Forum Commands
      'topics': { handler: this.listTopics.bind(this), description: 'Forum topics', category: 'Forum' },
      'post': { handler: this.createPost.bind(this), description: 'Create forum post', category: 'Forum' },
      'thread': { handler: this.showThread.bind(this), description: 'Show forum thread', category: 'Forum' },
      
      // Analytics Commands
      'metrics': { handler: this.showMetrics.bind(this), description: 'Community metrics', category: 'Analytics', adminOnly: true },
      'activity': { handler: this.showActivity.bind(this), description: 'Activity report', category: 'Analytics', adminOnly: true },
      'usage': { handler: this.showUsage.bind(this), description: 'Usage statistics', category: 'Analytics', adminOnly: true }
    };
  }

  async makeApiCall(endpoint, method = 'GET', data = null, retryCount = 0) {
    try {
      const config = {
        method,
        url: `${this.restApiUrl}${endpoint}`,
        timeout: this.apiTimeout,
        headers: { 'Content-Type': 'application/json' }
      };
      
      if (data) config.data = data;
      
      const response = await axios(config);
      return response.data;
    } catch (error) {
      if (retryCount < this.maxRetries && (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET')) {
        console.log(`API call failed, retrying (${retryCount + 1}/${this.maxRetries})...`);
        await this.sleep(1000 * (retryCount + 1));
        return this.makeApiCall(endpoint, method, data, retryCount + 1);
      }
      throw error;
    }
  }

  async sendMessage(groupId, message) {
    try {
      if (!message || message.length === 0) return;
      
      // Truncate very long messages
      if (message.length > 2000) {
        message = message.substring(0, 1900) + '... (truncated)';
      }
      
      const payload = {
        message: message,
        number: this.phoneNumber,
        recipients: [groupId]
      };
      
      await this.makeApiCall('/v2/send', 'POST', payload);
      console.log(`✓ Message sent to ${groupId}`);
    } catch (error) {
      console.error(`✗ Failed to send message to ${groupId}:`, error.message);
    }
  }

  async receiveMessages() {
    try {
      const response = await this.makeApiCall(`/v1/receive/${this.phoneNumber}`);
      
      if (!response || !Array.isArray(response)) return [];
      
      // Filter out system messages and duplicates
      const validMessages = response.filter(msg => {
        if (!msg || !msg.envelope) return false;
        if (!msg.envelope.dataMessage) return false;
        if (!msg.envelope.dataMessage.message) return false;
        
        const messageId = `${msg.envelope.source}-${msg.envelope.timestamp}`;
        if (this.messageCache.has(messageId)) return false;
        
        this.messageCache.add(messageId);
        
        // Clean cache periodically
        if (this.messageCache.size > 1000) {
          const oldEntries = Array.from(this.messageCache).slice(0, 500);
          oldEntries.forEach(entry => this.messageCache.delete(entry));
        }
        
        return true;
      });
      
      return validMessages;
    } catch (error) {
      if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
        console.log('API timeout, continuing...');
        return [];
      }
      console.error('Error receiving messages:', error.message);
      return [];
    }
  }

  async processMessage(message) {
    if (this.processingMessage) return;
    this.processingMessage = true;
    
    try {
      const envelope = message.envelope;
      const dataMessage = envelope.dataMessage;
      const messageText = dataMessage.message.trim();
      const sender = envelope.source;
      const groupInfo = envelope.sourceDevice;
      
      console.log(`📨 Message from ${sender}: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}`);
      
      // Skip non-command messages quickly
      if (!messageText.startsWith('/') && !messageText.startsWith('!')) {
        return;
      }
      
      const parts = messageText.substring(1).split(' ');
      const command = parts[0].toLowerCase();
      const args = parts.slice(1);
      
      if (this.commands[command]) {
        const cmdInfo = this.commands[command];
        
        // Check admin permissions
        if (cmdInfo.adminOnly && !this.adminUsers.includes(sender)) {
          await this.sendMessage(sender, 'Access denied. Admin privileges required.');
          return;
        }
        
        console.log(`🤖 Executing command: ${command}`);
        await cmdInfo.handler(sender, args, messageText);
      }
    } catch (error) {
      console.error('Error processing message:', error.message);
    } finally {
      this.processingMessage = false;
    }
  }

  // Command Handlers
  async showHelp(sender, args) {
    const categories = {};
    Object.entries(this.commands).forEach(([cmd, info]) => {
      if (!categories[info.category]) categories[info.category] = [];
      if (!info.adminOnly || this.adminUsers.includes(sender)) {
        categories[info.category].push(`/${cmd} - ${info.description}`);
      }
    });
    
    let helpText = 'Available Commands:\n\n';
    Object.entries(categories).forEach(([category, commands]) => {
      helpText += `${category}:\n${commands.join('\n')}\n\n`;
    });
    
    await this.sendMessage(sender, helpText);
  }

  async handlePing(sender) {
    await this.sendMessage(sender, 'Pong! Bot is responsive.');
  }

  async showStatus(sender) {
    const uptime = Math.floor((Date.now() - this.lastMessageTimestamp) / 1000);
    const status = `Bot Status:
Running: ${this.isRunning ? 'Yes' : 'No'}  
Phone: ${this.phoneNumber}
Commands: ${Object.keys(this.commands).length}
Cache Size: ${this.messageCache.size}
Poll Interval: ${this.pollInterval}ms`;
    
    await this.sendMessage(sender, status);
  }

  async listGroups(sender) {
    try {
      const groups = await this.makeApiCall(`/v1/groups/${this.phoneNumber}`);
      if (groups && groups.length > 0) {
        const groupList = groups.map(g => `- ${g.name || g.id}`).join('\n');
        await this.sendMessage(sender, `Active Groups (${groups.length}):\n${groupList}`);
      } else {
        await this.sendMessage(sender, 'No active groups found.');
      }
    } catch (error) {
      await this.sendMessage(sender, 'Error retrieving groups.');
    }
  }

  // Default handlers for other commands
  async handleAsk(sender, args) {
    await this.sendMessage(sender, 'Ask feature coming soon. For now, feel free to ask questions in the group!');
  }

  async showFAQ(sender) {
    await this.sendMessage(sender, 'FAQ: 1) How to join? Use invite links. 2) Community rules? Use /rules. 3) Need help? Use /help.');
  }

  async handleSearch(sender, args) {
    await this.sendMessage(sender, `Searching for: ${args.join(' ')}... Feature in development.`);
  }

  async sendWelcome(sender) {
    await this.sendMessage(sender, 'Welcome to our community! Use /help to see available commands and /rules for guidelines.');
  }

  async showRules(sender) {
    await this.sendMessage(sender, 'Community Rules:\n1. Be respectful\n2. Stay on topic\n3. No spam\n4. Help others when possible\n5. Use appropriate channels');
  }

  async showMembers(sender) {
    await this.sendMessage(sender, 'Member information feature in development.');
  }

  async listEvents(sender) {
    await this.sendMessage(sender, 'No upcoming events scheduled. Check back later!');
  }

  async showAbout(sender) {
    await this.sendMessage(sender, 'This is a chat-based community dashboard with Signal integration. Built for seamless community management.');
  }

  async showLinks(sender) {
    await this.sendMessage(sender, 'Important Links:\n- Dashboard: http://localhost:3000\n- GitHub: Coming soon\n- Documentation: In development');
  }

  async showContact(sender) {
    await this.sendMessage(sender, 'Contact the community administrators through this bot or the dashboard.');
  }

  async showTimezone(sender) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const time = new Date().toLocaleString();
    await this.sendMessage(sender, `Server Timezone: ${tz}\nCurrent Time: ${time}`);
  }

  async showNews(sender) {
    await this.sendMessage(sender, 'Latest news: Bot optimized for better performance! More updates coming soon.');
  }

  async listRepos(sender) {
    await this.sendMessage(sender, 'Project repositories:\n- chat-based-community-dashboard (main)\n- More repos coming soon');
  }

  async showUpdates(sender) {
    await this.sendMessage(sender, 'Recent Updates:\n- Performance optimizations\n- Reduced response times\n- Better error handling\n- Improved message processing');
  }

  async listTopics(sender) {
    await this.sendMessage(sender, 'Forum topics feature in development. Stay tuned!');
  }

  async createPost(sender, args) {
    await this.sendMessage(sender, 'Post creation feature coming soon!');
  }

  async showThread(sender, args) {
    await this.sendMessage(sender, 'Thread viewing feature in development.');
  }

  async handleAdmin(sender, args) {
    if (!this.adminUsers.includes(sender)) {
      await this.sendMessage(sender, 'Access denied.');
      return;
    }
    
    if (args.length === 0) {
      await this.sendMessage(sender, 'Admin commands: restart, stats, metrics, activity, usage');
      return;
    }
    
    const subCommand = args[0].toLowerCase();
    switch (subCommand) {
      case 'restart':
        await this.handleRestart(sender);
        break;
      case 'stats':
        await this.showStats(sender);
        break;
      default:
        await this.sendMessage(sender, `Unknown admin command: ${subCommand}`);
    }
  }

  async handleRestart(sender) {
    await this.sendMessage(sender, 'Bot restarting...');
    setTimeout(() => process.exit(0), 1000);
  }

  async showStats(sender) {
    const stats = `Performance Stats:
Poll Interval: ${this.pollInterval}ms
API Timeout: ${this.apiTimeout}ms
Cache Size: ${this.messageCache.size}
Processing: ${this.processingMessage ? 'Yes' : 'No'}
Uptime: ${Math.floor(process.uptime())} seconds`;
    
    await this.sendMessage(sender, stats);
  }

  async showMetrics(sender) {
    await this.sendMessage(sender, 'Community metrics feature in development.');
  }

  async showActivity(sender) {
    await this.sendMessage(sender, 'Activity reports coming soon.');
  }

  async showUsage(sender) {
    await this.sendMessage(sender, 'Usage statistics feature in development.');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async start() {
    console.log('🚀 Starting optimized Signal CLI bot...');
    console.log(`📱 Phone: ${this.phoneNumber}`);
    console.log(`🔧 Poll interval: ${this.pollInterval}ms`);
    console.log(`⏱️  API timeout: ${this.apiTimeout}ms`);
    console.log(`📋 Commands loaded: ${Object.keys(this.commands).length}`);
    
    this.isRunning = true;
    this.lastMessageTimestamp = Date.now();
    
    while (this.isRunning) {
      try {
        const messages = await this.receiveMessages();
        
        for (const message of messages) {
          await this.processMessage(message);
          // Small delay between processing messages
          await this.sleep(100);
        }
      } catch (error) {
        console.error('Error in main loop:', error.message);
        await this.sleep(2000); // Longer delay on error
      }
      
      await this.sleep(this.pollInterval);
    }
  }

  stop() {
    console.log('🛑 Stopping Signal CLI bot...');
    this.isRunning = false;
  }
}

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  if (global.bot) {
    global.bot.stop();
  }
  process.exit(0);
});

// Start the bot
const bot = new OptimizedSignalBot();
global.bot = bot;
bot.start().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});