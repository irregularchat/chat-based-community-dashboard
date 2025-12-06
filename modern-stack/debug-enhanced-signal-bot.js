#!/usr/bin/env node

/**
 * Debug Enhanced Signal CLI Bot - Comprehensive Logging Version
 * This version includes extensive debugging to track message processing
 */

const axios = require('axios');

class DebugEnhancedSignalBot {
  constructor() {
    this.phoneNumber = '+19108471202';
    this.restApiUrl = 'http://localhost:50240';
    this.isRunning = false;
    
    // Enhanced debugging settings
    this.debugMode = true;
    this.logLevel = 'verbose'; // verbose, debug, info, error
    this.messageCount = 0;
    this.startTime = Date.now();
    
    this.adminUsers = ['+19252261911', '+12069509896', '+15108098701'];
    this.messageCache = new Set();
    
    // Performance settings
    this.pollInterval = 3000; // Increased for debugging
    this.apiTimeout = 15000; // Increased timeout
    this.maxRetries = 3;
    
    this.commands = this.initializeCommands();
    
    this.log('INIT', '🚀 Debug Enhanced Signal CLI Bot Initializing...');
  }

  initializeCommands() {
    return {
      'help': { handler: this.showHelp.bind(this), description: 'Show available commands', category: 'Core' },
      'status': { handler: this.showStatus.bind(this), description: 'Show bot status', category: 'Core' },
      'ping': { handler: this.handlePing.bind(this), description: 'Test bot responsiveness', category: 'Core' },
      'debug': { handler: this.showDebug.bind(this), description: 'Show debug information', category: 'Core' },
      'test': { handler: this.handleTest.bind(this), description: 'Test command processing', category: 'Core' },
      
      // AI commands (simplified for debugging)
      'ai': { handler: this.handleAI.bind(this), description: 'AI assistant', category: 'AI' },
      'lai': { handler: this.handleLocalAI.bind(this), description: 'Local AI assistant', category: 'AI' },
    };
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    
    let logMessage = `[${timestamp}] [${uptime}s] [${level}] ${message}`;
    
    if (data) {
      logMessage += ` | Data: ${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}`;
    }
    
    console.log(logMessage);
    
    // Also log to a debug array for /debug command
    if (!this.debugLogs) this.debugLogs = [];
    this.debugLogs.push({ timestamp, level, message, data, uptime });
    if (this.debugLogs.length > 50) this.debugLogs.shift(); // Keep last 50 logs
  }

  async makeApiCall(endpoint, method = 'GET', data = null, retryCount = 0) {
    const startTime = Date.now();
    
    try {
      this.log('API', `Making ${method} request to ${endpoint}`, { retryCount, hasData: !!data });
      
      const config = {
        method,
        url: `${this.restApiUrl}${endpoint}`,
        timeout: this.apiTimeout,
        headers: { 'Content-Type': 'application/json' }
      };
      
      if (data) config.data = data;
      
      const response = await axios(config);
      const duration = Date.now() - startTime;
      
      this.log('API', `✅ ${method} ${endpoint} completed in ${duration}ms`, { 
        status: response.status, 
        dataSize: response.data ? JSON.stringify(response.data).length : 0 
      });
      
      return response.data;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (retryCount < this.maxRetries && (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET')) {
        this.log('API', `⚠️ ${method} ${endpoint} failed, retrying (${retryCount + 1}/${this.maxRetries}) after ${duration}ms`, { 
          error: error.code 
        });
        await this.sleep(1000 * (retryCount + 1));
        return this.makeApiCall(endpoint, method, data, retryCount + 1);
      }
      
      this.log('ERROR', `❌ ${method} ${endpoint} failed after ${duration}ms`, { 
        error: error.message,
        code: error.code,
        status: error.response?.status 
      });
      throw error;
    }
  }

  async receiveMessages() {
    this.log('POLL', '📡 Polling for messages...');
    
    try {
      const response = await this.makeApiCall(`/v1/receive/${this.phoneNumber}`);
      
      if (!response) {
        this.log('POLL', '📭 No response from receive endpoint');
        return [];
      }
      
      if (!Array.isArray(response)) {
        this.log('POLL', '⚠️ Response is not an array', { responseType: typeof response, response });
        return [];
      }
      
      if (response.length === 0) {
        this.log('POLL', '📭 Empty response array (no new messages)');
        return [];
      }
      
      this.log('POLL', `📨 Received ${response.length} message(s)`, { messageCount: response.length });
      
      // Detailed message analysis
      const validMessages = [];
      for (let i = 0; i < response.length; i++) {
        const msg = response[i];
        this.log('MSG_ANALYZE', `Analyzing message ${i + 1}/${response.length}`, {
          hasEnvelope: !!msg?.envelope,
          hasDataMessage: !!msg?.envelope?.dataMessage,
          hasMessage: !!msg?.envelope?.dataMessage?.message,
          source: msg?.envelope?.source,
          timestamp: msg?.envelope?.timestamp
        });
        
        if (this.isValidMessage(msg)) {
          validMessages.push(msg);
          this.log('MSG_VALID', `✅ Message ${i + 1} is valid for processing`);
        } else {
          this.log('MSG_SKIP', `⏭️ Message ${i + 1} skipped - invalid or duplicate`);
        }
      }
      
      this.log('POLL', `📊 Processing ${validMessages.length}/${response.length} valid messages`);
      return validMessages;
      
    } catch (error) {
      if (error.message.includes('timeout') || error.code === 'ETIMEDOUT') {
        this.log('POLL', '⏱️ Poll timeout (normal when no messages)');
        return [];
      }
      this.log('ERROR', '❌ Error in receiveMessages', { error: error.message });
      return [];
    }
  }

  isValidMessage(msg) {
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
      this.log('CACHE', 'Cleaned message cache', { oldSize: 1000, newSize: this.messageCache.size });
    }
    
    return true;
  }

  async processMessage(message) {
    this.messageCount++;
    const messageId = `msg-${this.messageCount}`;
    
    try {
      const envelope = message.envelope;
      const dataMessage = envelope.dataMessage;
      const messageText = dataMessage.message.trim();
      const sender = envelope.source;
      const groupInfo = envelope.sourceDevice;
      
      this.log('PROCESS', `🔄 Processing ${messageId}`, {
        sender,
        messageLength: messageText.length,
        preview: messageText.substring(0, 100),
        isCommand: messageText.startsWith('/') || messageText.startsWith('!'),
        groupInfo
      });
      
      // Check if it's a command
      if (!messageText.startsWith('/') && !messageText.startsWith('!')) {
        this.log('PROCESS', `⏭️ ${messageId} is not a command, skipping`);
        return;
      }
      
      const parts = messageText.substring(1).split(' ');
      const command = parts[0].toLowerCase();
      const args = parts.slice(1);
      
      this.log('CMD', `🎯 Command detected: /${command}`, {
        messageId,
        sender,
        argsCount: args.length,
        args: args.slice(0, 5) // Show first 5 args
      });
      
      if (this.commands[command]) {
        const cmdInfo = this.commands[command];
        
        // Check admin permissions
        if (cmdInfo.adminOnly && !this.adminUsers.includes(sender)) {
          this.log('CMD', `🔒 Access denied for ${messageId} - admin required`, { sender, command });
          await this.sendMessage(sender, `🔒 Access denied. Command /${command} requires admin privileges.`);
          return;
        }
        
        this.log('CMD', `🚀 Executing /${command} for ${messageId}`, { sender });
        
        const executionStart = Date.now();
        await cmdInfo.handler(sender, args, messageText);
        const executionTime = Date.now() - executionStart;
        
        this.log('CMD', `✅ Command /${command} completed for ${messageId}`, { 
          executionTime: `${executionTime}ms`,
          sender 
        });
      } else {
        this.log('CMD', `❓ Unknown command: /${command} in ${messageId}`, { sender });
        await this.sendMessage(sender, `❓ Unknown command: /${command}. Use /help to see available commands.`);
      }
    } catch (error) {
      this.log('ERROR', `❌ Error processing ${messageId}`, { error: error.message });
    }
  }

  async sendMessage(recipient, message) {
    try {
      this.log('SEND', `📤 Sending message to ${recipient}`, { 
        messageLength: message.length,
        preview: message.substring(0, 100)
      });
      
      if (!message || message.length === 0) {
        this.log('SEND', '⚠️ Attempted to send empty message');
        return;
      }
      
      // Truncate very long messages
      if (message.length > 2000) {
        message = message.substring(0, 1900) + '... (truncated)';
        this.log('SEND', '✂️ Message truncated due to length');
      }
      
      const payload = {
        message: message,
        number: this.phoneNumber,
        recipients: [recipient]
      };
      
      await this.makeApiCall('/v2/send', 'POST', payload);
      this.log('SEND', `✅ Message sent to ${recipient}`);
      
    } catch (error) {
      this.log('ERROR', `❌ Failed to send message to ${recipient}`, { error: error.message });
    }
  }

  // Command Handlers
  async showHelp(sender) {
    const commandList = Object.entries(this.commands).map(([cmd, info]) => 
      `/${cmd} - ${info.description}`
    ).join('\\n');
    
    await this.sendMessage(sender, `🤖 **Debug Enhanced Signal Bot Commands**\\n\\n${commandList}\\n\\n📊 Total Messages Processed: ${this.messageCount}\\n⏱️ Uptime: ${Math.floor((Date.now() - this.startTime) / 1000)}s`);
  }

  async showStatus(sender) {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const status = `🤖 **Debug Bot Status:**
    
✅ Running: ${this.isRunning ? 'Yes' : 'No'}
📱 Phone: ${this.phoneNumber}
📊 Commands: ${Object.keys(this.commands).length}
💾 Cache Size: ${this.messageCache.size}
📨 Messages Processed: ${this.messageCount}
⏱️ Uptime: ${uptime}s
🔧 Poll Interval: ${this.pollInterval}ms
⏰ API Timeout: ${this.apiTimeout}ms
🔍 Debug Mode: ${this.debugMode ? 'ON' : 'OFF'}`;
    
    await this.sendMessage(sender, status);
  }

  async handlePing(sender) {
    const pingTime = Date.now();
    await this.sendMessage(sender, `🏓 Pong! Debug bot is responsive. Response time: ${Date.now() - pingTime}ms`);
  }

  async showDebug(sender) {
    const recentLogs = this.debugLogs?.slice(-10) || [];
    const logText = recentLogs.map(log => 
      `[${log.uptime}s] ${log.level}: ${log.message}`
    ).join('\\n');
    
    await this.sendMessage(sender, `🔍 **Debug Information (Last 10 logs):**\\n\\n${logText}\\n\\n📊 Total Debug Logs: ${this.debugLogs?.length || 0}`);
  }

  async handleTest(sender) {
    await this.sendMessage(sender, `🧪 **Test Response**\\n\\n✅ Command processing working\\n📨 Message ID: test-${Date.now()}\\n👤 Sender: ${sender}\\n⏰ Timestamp: ${new Date().toISOString()}`);
  }

  async handleAI(sender, args) {
    const query = args.join(' ') || 'Hello';
    await this.sendMessage(sender, `🤖 **AI Response (Debug Mode)**\\n\\nQuery: "${query}"\\n\\n🔧 This is a debug response. Real AI integration available in production bot.\\n\\n✅ AI command processing verified`);
  }

  async handleLocalAI(sender, args) {
    const query = args.join(' ') || 'Hello';
    await this.sendMessage(sender, `🧠 **Local AI Response (Debug Mode)**\\n\\nQuery: "${query}"\\n\\n🔧 This is a debug response. Local AI integration available in production bot.\\n\\n✅ Local AI command processing verified`);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async start() {
    this.log('INIT', '🚀 Starting Debug Enhanced Signal CLI bot...');
    this.log('INIT', `📱 Phone: ${this.phoneNumber}`);
    this.log('INIT', `🔧 Poll interval: ${this.pollInterval}ms`);
    this.log('INIT', `⏱️ API timeout: ${this.apiTimeout}ms`);
    this.log('INIT', `📋 Commands loaded: ${Object.keys(this.commands).length}`);
    this.log('INIT', `🔍 Debug mode: ${this.debugMode ? 'ENABLED' : 'DISABLED'}`);
    
    this.isRunning = true;
    
    // Test connectivity first
    try {
      this.log('INIT', '🔍 Testing API connectivity...');
      await this.makeApiCall('/v1/about');
      this.log('INIT', '✅ API connectivity verified');
      
      const groups = await this.makeApiCall(`/v1/groups/${this.phoneNumber}`);
      this.log('INIT', `📊 Connected to ${groups?.length || 0} groups`);
      
    } catch (error) {
      this.log('ERROR', '❌ API connectivity test failed', { error: error.message });
    }
    
    let cycleCount = 0;
    
    while (this.isRunning) {
      cycleCount++;
      this.log('CYCLE', `🔄 Starting polling cycle ${cycleCount}`);
      
      try {
        const messages = await this.receiveMessages();
        
        if (messages.length > 0) {
          this.log('CYCLE', `📨 Processing ${messages.length} messages in cycle ${cycleCount}`);
          
          for (let i = 0; i < messages.length; i++) {
            this.log('CYCLE', `Processing message ${i + 1}/${messages.length}`);
            await this.processMessage(messages[i]);
            
            // Small delay between messages
            if (i < messages.length - 1) {
              await this.sleep(200);
            }
          }
        } else {
          this.log('CYCLE', `📭 No messages in cycle ${cycleCount} (normal)`);
        }
      } catch (error) {
        this.log('ERROR', `❌ Error in cycle ${cycleCount}`, { error: error.message });
        await this.sleep(5000); // Longer delay on error
      }
      
      this.log('CYCLE', `⏱️ Cycle ${cycleCount} complete, waiting ${this.pollInterval}ms...`);
      await this.sleep(this.pollInterval);
    }
  }

  stop() {
    this.log('SHUTDOWN', '🛑 Stopping Debug Enhanced Signal CLI bot...');
    this.isRunning = false;
  }
}

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('\\n🛑 Received SIGINT, shutting down gracefully...');
  if (global.debugBot) {
    global.debugBot.stop();
  }
  process.exit(0);
});

// Start the debug bot
const bot = new DebugEnhancedSignalBot();
global.debugBot = bot;

bot.start().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});