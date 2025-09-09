#!/usr/bin/env node

/**
 * Production Signal CLI Bot - Standalone version
 * Contains the full command set from the native daemon service
 * Optimized for production use with minimal dependencies
 */

const { spawn } = require('child_process');
const net = require('net');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const axios = require('axios').default || require('axios');

class ProductionSignalBot extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.phoneNumber = config.phoneNumber || '+19108471202';
    this.socketPath = config.socketPath || '/tmp/signal-cli-socket';
    this.dataDir = config.dataDir || './signal-data';
    this.aiEnabled = config.aiEnabled || false;
    this.openAiApiKey = config.openAiApiKey;
    this.localAiUrl = config.localAiUrl || 'https://ai.untitledstartup.xyz';
    
    // Bot state
    this.isListening = false;
    this.daemon = null;
    this.socket = null;
    this.instanceId = Math.random().toString(36).substring(7);
    
    // Message deduplication
    this.processedMessages = new Set();
    this.messageTimestamps = new Map();
    this.duplicateDetectionWindow = 30000;
    
    // AI thread tracking
    this.userAiPreference = new Map();
    
    // Q&A System
    this.questions = new Map();
    this.questionCounter = 0;
    this.userQuestions = new Map();
    
    // URL Cleaner System
    this.cleanedUrls = new Map();
    
    // Cache for groups
    this.cachedGroups = null;
    this.groupsCacheTime = 0;
    this.groupsCacheDuration = 5 * 60 * 1000; // 5 minutes
    
    // Initialize commands
    this.commands = this.initializeCommands();
    
    console.log('🚀 Production Signal CLI Bot initialized');
    console.log(`📱 Phone: ${this.phoneNumber}`);
    console.log(`📂 Data Dir: ${this.dataDir}`);
    console.log(`🔌 Socket: ${this.socketPath}`);
    console.log(`🔒 Instance ID: ${this.instanceId}`);
  }
  
  initializeCommands() {
    return [
      // Core Commands
      { name: 'help', description: 'Show available commands', handler: this.handleHelp.bind(this) },
      { name: 'ping', description: 'Test bot responsiveness', handler: this.handlePing.bind(this) },
      { name: 'ai', description: 'Chat with OpenAI', handler: this.handleAI.bind(this) },
      { name: 'lai', description: 'Chat with LocalAI', handler: this.handleLocalAI.bind(this) },
      { name: 'status', description: 'Show bot status', handler: this.handleStatus.bind(this) },
      
      // Q&A System Commands
      { name: 'q', description: 'Ask a question', handler: this.handleQuestion.bind(this) },
      { name: 'question', description: 'Ask a question', handler: this.handleQuestion.bind(this) },
      { name: 'questions', description: 'List recent questions', handler: this.handleQuestions.bind(this) },
      { name: 'answer', description: 'Answer a question', handler: this.handleAnswer.bind(this) },
      { name: 'a', description: 'Answer a question (short)', handler: this.handleAnswer.bind(this) },
      { name: 'solved', description: 'Mark question as solved', handler: this.handleSolved.bind(this) },
      
      // Community Commands
      { name: 'groups', description: 'List available groups', handler: this.handleGroups.bind(this) },
      { name: 'join', description: 'Join a group', handler: this.handleJoin.bind(this) },
      { name: 'invite', description: 'Generate invite link', handler: this.handleInvite.bind(this) },
      
      // Information Commands
      { name: 'wiki', description: 'Search wiki', handler: this.handleWiki.bind(this) },
      { name: 'forum', description: 'Search forum', handler: this.handleForum.bind(this) },
      { name: 'events', description: 'Show upcoming events', handler: this.handleEvents.bind(this) },
      { name: 'faq', description: 'Get FAQ answers', handler: this.handleFAQ.bind(this) },
      { name: 'docs', description: 'Search documentation', handler: this.handleDocs.bind(this) },
      { name: 'links', description: 'Show important links', handler: this.handleLinks.bind(this) },
      
      // News & Repository Commands
      { name: 'news', description: 'Get latest news', handler: this.handleNews.bind(this) },
      { name: 'repo', description: 'Analyze repository', handler: this.handleRepo.bind(this) },
      { name: 'tldr', description: 'TLDR summary', handler: this.handleTLDR.bind(this) },
      { name: 'wayback', description: 'Wayback machine lookup', handler: this.handleWayback.bind(this) },
      { name: 'archive', description: 'Archive a URL', handler: this.handleArchive.bind(this) },
      { name: 'bypass', description: 'Generate bypass links', handler: this.handleBypass.bind(this) },
      
      // Forum Commands
      { name: 'fpost', description: 'Create forum post', handler: this.handleForumPost.bind(this) },
      { name: 'flatest', description: 'Latest forum posts', handler: this.handleForumLatest.bind(this) },
      { name: 'fsearch', description: 'Search forum', handler: this.handleForumSearch.bind(this) },
      { name: 'categories', description: 'Forum categories', handler: this.handleCategories.bind(this) },
      
      // Utility Commands
      { name: 'summarize', description: 'Summarize messages', handler: this.handleSummarize.bind(this) },
      { name: 'cleaner', description: 'Clean tracking URLs', handler: this.handleCleaner.bind(this) },
      { name: 'zeroeth', description: 'Show the zeroeth law', handler: this.handleZeroeth.bind(this) },
      
      // Admin Commands (will check permissions)
      { name: 'admin', description: 'Admin commands', handler: this.handleAdmin.bind(this) },
      { name: 'addto', description: 'Add user to group', handler: this.handleAddTo.bind(this) },
      { name: 'gtg', description: 'Good to go approval', handler: this.handleGTG.bind(this) },
      { name: 'sngtg', description: 'Safety number good to go', handler: this.handleSNGTG.bind(this) }
    ];
  }
  
  async startListening() {
    console.log('🔄 Starting signal-cli daemon...');
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    
    // Remove existing socket if it exists
    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }
    
    // Start signal-cli daemon
    this.daemon = spawn('signal-cli', [
      '-a', this.phoneNumber,
      '--config', this.dataDir,
      'daemon',
      '--socket', this.socketPath,
      '--receive-mode', 'on-connection'
    ], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    this.daemon.stdout.on('data', (data) => {
      console.log(`📡 Daemon: ${data.toString().trim()}`);
    });
    
    this.daemon.stderr.on('data', (data) => {
      console.error(`❌ Daemon Error: ${data.toString().trim()}`);
    });
    
    this.daemon.on('close', (code) => {
      console.log(`💀 Daemon exited with code ${code}`);
      this.isListening = false;
      if (code !== 0 && this.isListening) {
        setTimeout(() => this.startListening(), 5000);
      }
    });
    
    // Wait for socket to be created
    await this.waitForSocket();
    
    // Connect to socket
    this.socket = net.createConnection(this.socketPath);
    
    this.socket.on('connect', () => {
      console.log('🔌 Connected to signal-cli daemon socket');
      this.subscribeToMessages();
      this.isListening = true;
    });
    
    this.socket.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      lines.forEach(line => {
        try {
          const message = JSON.parse(line);
          if (message.params?.account === this.phoneNumber) {
            this.processMessage(message.params);
          }
        } catch (error) {
          console.error('Error parsing message:', error.message);
        }
      });
    });
    
    this.socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
    
    this.socket.on('close', () => {
      console.log('🔌 Socket connection closed');
      if (this.isListening) {
        setTimeout(() => this.startListening(), 2000);
      }
    });
  }
  
  async waitForSocket() {
    return new Promise((resolve) => {
      const checkSocket = () => {
        if (fs.existsSync(this.socketPath)) {
          resolve();
        } else {
          setTimeout(checkSocket, 100);
        }
      };
      checkSocket();
    });
  }
  
  subscribeToMessages() {
    const subscribeRequest = {
      jsonrpc: '2.0',
      method: 'subscribe',
      params: {
        account: this.phoneNumber
      },
      id: 1
    };
    
    this.socket.write(JSON.stringify(subscribeRequest) + '\n');
    console.log('📬 Subscribed to message notifications');
  }
  
  isDuplicateMessage(envelope) {
    if (!envelope || !envelope.timestamp) return false;
    
    const messageId = `${envelope.sourceNumber || envelope.sourceUuid}_${envelope.timestamp}_${envelope.dataMessage?.message?.substring(0, 50) || ''}`;
    
    if (this.processedMessages.has(messageId)) return true;
    
    // Temporal deduplication
    const now = Date.now();
    const messageKey = `${envelope.sourceNumber || envelope.sourceUuid}_${envelope.dataMessage?.message || ''}`;
    
    if (this.messageTimestamps.has(messageKey)) {
      const lastSeen = this.messageTimestamps.get(messageKey);
      if (now - lastSeen < this.duplicateDetectionWindow) {
        return true;
      }
    }
    
    // Mark as processed
    this.processedMessages.add(messageId);
    this.messageTimestamps.set(messageKey, now);
    
    // Cleanup old entries
    if (this.processedMessages.size > 1000) {
      const oldEntries = Array.from(this.processedMessages).slice(0, 500);
      oldEntries.forEach(entry => this.processedMessages.delete(entry));
    }
    
    return false;
  }
  
  async processMessage(messageData) {
    try {
      const envelope = messageData.envelope;
      if (!envelope || !envelope.dataMessage) return;
      
      // Check for duplicates
      if (this.isDuplicateMessage(envelope)) {
        console.log(`🔄 [${this.instanceId}] Duplicate message ignored`);
        return;
      }
      
      const dataMessage = envelope.dataMessage;
      const message = dataMessage.message;
      const sender = envelope.sourceNumber || envelope.sourceUuid;
      const groupId = envelope.dataMessage.groupInfo?.groupId;
      
      console.log(`📨 [${this.instanceId}] Message from ${sender}: ${message?.substring(0, 50)}${message?.length > 50 ? '...' : ''}`);
      
      // Ignore messages from bot itself
      if (sender === this.phoneNumber) return;
      
      // Process URLs automatically
      this.processUrls(message, sender, groupId);
      
      // Check for commands
      if (message && (message.startsWith('/') || message.startsWith('!'))) {
        const commandText = message.substring(1);
        const [commandName, ...args] = commandText.split(' ');
        
        const command = this.commands.find(cmd => cmd.name === commandName.toLowerCase());
        if (command) {
          console.log(`🤖 [${this.instanceId}] Executing command: ${commandName}`);
          await command.handler(sender, args, message, envelope, groupId);
        }
      }
      
      // Check for AI continuation
      else if (!message.startsWith('/') && !message.startsWith('!')) {
        await this.checkAIContinuation(message, sender, groupId);
      }
      
    } catch (error) {
      console.error('Error processing message:', error);
    }
  }
  
  async processUrls(message, sender, groupId) {
    if (!message) return;
    
    const urlRegex = /https?:\/\/[^\s]+/g;
    const urls = message.match(urlRegex);
    
    if (urls) {
      urls.forEach(url => {
        setTimeout(() => {
          this.analyzeUrl(url, sender, groupId).catch(error => {
            console.error(`Failed to analyze URL ${url}:`, error.message);
          });
        }, 1000); // Small delay to avoid overwhelming
      });
    }
  }
  
  async analyzeUrl(url, sender, groupId) {
    try {
      // Clean tracking parameters
      const cleanedUrl = this.cleanTrackingParams(url);
      
      if (cleanedUrl !== url) {
        await this.sendMessage(groupId || sender, `🧹 Cleaned URL: ${cleanedUrl}`);
        
        this.cleanedUrls.set(Date.now(), {
          originalUrl: url,
          cleanedUrl: cleanedUrl,
          user: sender,
          groupId: groupId || null,
          trackersRemoved: this.countTrackingParams(url)
        });
      }
      
      // Check if it's a repository URL
      if (this.isRepositoryUrl(cleanedUrl || url)) {
        setTimeout(() => {
          this.analyzeRepository(cleanedUrl || url, sender, groupId);
        }, 2000);
      }
      
    } catch (error) {
      console.error('Error analyzing URL:', error);
    }
  }
  
  cleanTrackingParams(url) {
    try {
      const urlObj = new URL(url);
      const trackingParams = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'fbclid', 'gclid', 'msclkid', 'igshid', 'ref', 'source',
        '_hsenc', '_hsmi', 'mc_cid', 'mc_eid', 'mkt_tok',
        'trk', 'trkEmail', 'trkCampaign', 'trackingId'
      ];
      
      trackingParams.forEach(param => {
        urlObj.searchParams.delete(param);
      });
      
      return urlObj.toString();
    } catch (error) {
      return url;
    }
  }
  
  countTrackingParams(url) {
    try {
      const urlObj = new URL(url);
      const trackingParams = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'fbclid', 'gclid', 'msclkid', 'igshid', 'ref', 'source'
      ];
      
      return trackingParams.filter(param => urlObj.searchParams.has(param)).length;
    } catch (error) {
      return 0;
    }
  }
  
  isRepositoryUrl(url) {
    const patterns = ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'];
    return patterns.some(pattern => url.includes(pattern));
  }
  
  async analyzeRepository(url, sender, groupId) {
    try {
      await this.sendMessage(groupId || sender, `🔍 Analyzing repository: ${url}`);
      
      // Basic repository analysis
      const repoInfo = this.extractRepoInfo(url);
      if (repoInfo) {
        const summary = `📦 Repository: ${repoInfo.owner}/${repoInfo.name}\\nPlatform: ${repoInfo.platform}\\nURL: ${url}`;
        await this.sendMessage(groupId || sender, summary);
      }
    } catch (error) {
      console.error('Error analyzing repository:', error);
    }
  }
  
  extractRepoInfo(url) {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      
      if (pathParts.length >= 2) {
        return {
          platform: urlObj.hostname,
          owner: pathParts[0],
          name: pathParts[1],
          fullName: `${pathParts[0]}/${pathParts[1]}`
        };
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
  
  async checkAIContinuation(message, sender, groupId) {
    const userId = `${groupId || 'dm'}:${sender}`;
    const userPref = this.userAiPreference.get(userId);
    
    if (userPref) {
      const timeSinceLastAi = Date.now() - userPref.timestamp;
      const fiveMinutes = 5 * 60 * 1000;
      
      if (timeSinceLastAi < fiveMinutes) {
        // Check if this looks like a continuation
        const continuationPatterns = [
          /^(what|how|why|when|where|can|could|would|should|tell me|explain)/i,
          /\?$/,
          /(more|continue|elaborate|expand)/i
        ];
        
        if (continuationPatterns.some(pattern => pattern.test(message))) {
          console.log(`🧠 Continuing ${userPref.provider} conversation for ${sender}`);
          
          if (userPref.provider === 'openai') {
            await this.handleAI(sender, [message], `!ai ${message}`, null, groupId);
          } else {
            await this.handleLocalAI(sender, [message], `!lai ${message}`, null, groupId);
          }
        }
      }
    }
  }
  
  async sendMessage(recipient, message) {
    try {
      if (!message || message.length === 0) return;
      
      // Truncate very long messages
      if (message.length > 2000) {
        message = message.substring(0, 1900) + '... (truncated)';
      }
      
      const request = {
        jsonrpc: '2.0',
        method: 'send',
        params: {
          account: this.phoneNumber,
          recipient: recipient,
          message: message
        },
        id: Math.floor(Math.random() * 1000)
      };
      
      this.socket.write(JSON.stringify(request) + '\n');
      console.log(`📤 [${this.instanceId}] Message sent to ${recipient}`);
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`Failed to send message to ${recipient}:`, error.message);
    }
  }
  
  // Command Handlers
  async handleHelp(sender) {
    const userCommandsByCategory = {
      '🔧 Core': ['help', 'ping', 'ai', 'lai', 'status'],
      '❓ Q&A': ['q', 'question', 'questions', 'answer', 'solved'],
      '👥 Community': ['groups', 'join', 'invite'],
      '📰 News & Repos': ['news', 'repo', 'tldr', 'wayback', 'archive', 'bypass'],
      '📚 Information': ['wiki', 'forum', 'events', 'faq', 'docs', 'links'],
      '📄 Forum': ['fpost', 'flatest', 'fsearch', 'categories'],
      '🔧 Utilities': ['summarize', 'cleaner', 'zeroeth']
    };
    
    let helpText = '🤖 Available Commands:\\n\\n';
    Object.entries(userCommandsByCategory).forEach(([category, commands]) => {
      helpText += `${category}:\\n`;
      commands.forEach(cmd => {
        const command = this.commands.find(c => c.name === cmd);
        if (command) {
          helpText += `/${cmd} - ${command.description}\\n`;
        }
      });
      helpText += '\\n';
    });
    
    helpText += 'Use /help <command> for detailed information about a specific command.';
    await this.sendMessage(sender, helpText);
  }
  
  async handlePing(sender) {
    const startTime = Date.now();
    await this.sendMessage(sender, `🏓 Pong! Response time: ${Date.now() - startTime}ms`);
  }
  
  async handleStatus(sender) {
    const uptime = Math.floor(process.uptime());
    const status = `🤖 Bot Status:
Running: ${this.isListening ? 'Yes' : 'No'}
Phone: ${this.phoneNumber}
Commands: ${this.commands.length}
Uptime: ${uptime}s
Questions: ${this.questions.size}
Processed Messages: ${this.processedMessages.size}`;
    
    await this.sendMessage(sender, status);
  }
  
  async handleQuestion(sender, args, fullMessage) {
    if (args.length === 0) {
      await this.sendMessage(sender, 'Usage: /q <your question>');
      return;
    }
    
    const question = args.join(' ');
    this.questionCounter++;
    const questionId = this.questionCounter;
    
    const questionData = {
      id: questionId,
      asker: sender,
      question: question,
      title: question.length > 50 ? question.substring(0, 50) + '...' : question,
      answers: [],
      solved: false,
      timestamp: Date.now(),
      groupId: null
    };
    
    this.questions.set(questionId, questionData);
    
    if (!this.userQuestions.has(sender)) {
      this.userQuestions.set(sender, []);
    }
    this.userQuestions.get(sender).push(questionId);
    
    const response = `❓ Question #${questionId} posted: ${question}\\n\\nOthers can answer with: /answer ${questionId} <answer>`;
    await this.sendMessage(sender, response);
  }
  
  async handleQuestions(sender) {
    if (this.questions.size === 0) {
      await this.sendMessage(sender, 'No questions have been asked yet. Use /q to ask a question!');
      return;
    }
    
    const recentQuestions = Array.from(this.questions.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);
    
    let response = '❓ Recent Questions:\\n\\n';
    recentQuestions.forEach(q => {
      const status = q.solved ? '✅' : (q.answers.length > 0 ? '💬' : '🆕');
      const timeAgo = Math.floor((Date.now() - q.timestamp) / (1000 * 60));
      response += `${status} #${q.id}: ${q.title} (${timeAgo}m ago)\\n`;
    });
    
    response += '\\nUse /answer <id> <answer> to respond to a question.';
    await this.sendMessage(sender, response);
  }
  
  async handleAnswer(sender, args) {
    if (args.length < 2) {
      await this.sendMessage(sender, 'Usage: /answer <question_id> <your answer>');
      return;
    }
    
    const questionId = parseInt(args[0]);
    const answer = args.slice(1).join(' ');
    
    if (!this.questions.has(questionId)) {
      await this.sendMessage(sender, `Question #${questionId} not found.`);
      return;
    }
    
    const question = this.questions.get(questionId);
    question.answers.push({
      answerer: sender,
      answer: answer,
      timestamp: Date.now()
    });
    
    const response = `💬 Answer added to Question #${questionId}:\\n${answer}\\n\\nUse /solved ${questionId} to mark as resolved.`;
    await this.sendMessage(question.asker, response);
    await this.sendMessage(sender, `✅ Your answer has been sent to the question asker.`);
  }
  
  async handleSolved(sender, args) {
    if (args.length === 0) {
      await this.sendMessage(sender, 'Usage: /solved <question_id>');
      return;
    }
    
    const questionId = parseInt(args[0]);
    
    if (!this.questions.has(questionId)) {
      await this.sendMessage(sender, `Question #${questionId} not found.`);
      return;
    }
    
    const question = this.questions.get(questionId);
    
    // Only the asker can mark as solved
    if (question.asker !== sender) {
      await this.sendMessage(sender, 'Only the person who asked the question can mark it as solved.');
      return;
    }
    
    question.solved = true;
    await this.sendMessage(sender, `✅ Question #${questionId} marked as solved!`);
  }
  
  async handleAI(sender, args, fullMessage, envelope, groupId) {
    if (!this.aiEnabled || !this.openAiApiKey) {
      await this.sendMessage(sender, 'OpenAI is not configured.');
      return;
    }
    
    if (args.length === 0) {
      await this.sendMessage(sender, 'Usage: /ai <your message>');
      return;
    }
    
    const userMessage = args.join(' ');
    const userId = `${groupId || 'dm'}:${sender}`;
    
    // Track AI preference
    this.userAiPreference.set(userId, {
      provider: 'openai',
      timestamp: Date.now(),
      lastMessage: userMessage
    });
    
    try {
      await this.sendMessage(groupId || sender, '🤖 Thinking...');
      
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-5-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful AI assistant for the IrregularChat community. Be concise and helpful.'
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        max_completion_tokens: 1000
      }, {
        headers: {
          'Authorization': `Bearer ${this.openAiApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });
      
      const aiResponse = response.data.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
      await this.sendMessage(groupId || sender, `🤖 OpenAI: ${aiResponse}`);
      
    } catch (error) {
      console.error('OpenAI API error:', error.message);
      await this.sendMessage(groupId || sender, '❌ OpenAI API error. Please try again later.');
    }
  }
  
  async handleLocalAI(sender, args, fullMessage, envelope, groupId) {
    if (args.length === 0) {
      await this.sendMessage(sender, 'Usage: /lai <your message>');
      return;
    }
    
    const userMessage = args.join(' ');
    const userId = `${groupId || 'dm'}:${sender}`;
    
    // Track AI preference
    this.userAiPreference.set(userId, {
      provider: 'localai',
      timestamp: Date.now(),
      lastMessage: userMessage
    });
    
    try {
      await this.sendMessage(groupId || sender, '🧠 Thinking locally...');
      
      const response = await axios.post(`${this.localAiUrl}/v1/chat/completions`, {
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful AI assistant for the IrregularChat community. Be concise and helpful.'
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        max_tokens: 500
      }, {
        timeout: 30000
      });
      
      const aiResponse = response.data.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
      await this.sendMessage(groupId || sender, `🧠 LocalAI: ${aiResponse}`);
      
    } catch (error) {
      console.error('LocalAI error:', error.message);
      await this.sendMessage(groupId || sender, '❌ LocalAI error. Please try again later.');
    }
  }
  
  // Placeholder handlers for other commands
  async handleGroups(sender) {
    await this.sendMessage(sender, '👥 Groups feature coming soon! Currently connected to Signal groups.');
  }
  
  async handleNews(sender) {
    await this.sendMessage(sender, '📰 News aggregation feature in development.');
  }
  
  async handleRepo(sender, args) {
    if (args.length === 0) {
      await this.sendMessage(sender, 'Usage: /repo <repository_url>');
      return;
    }
    
    const url = args[0];
    if (this.isRepositoryUrl(url)) {
      await this.analyzeRepository(url, sender, null);
    } else {
      await this.sendMessage(sender, 'Please provide a valid repository URL (GitHub, GitLab, etc.)');
    }
  }
  
  async handleZeroeth(sender) {
    const zeroethLaw = `🔧 The Zeroeth Law of IrregularChat:

"A member may not harm the community or, through inaction, allow the community to come to harm."

This principle guides all interactions and decisions within our community. We prioritize collective wellbeing, constructive discourse, and mutual support.`;
    
    await this.sendMessage(sender, zeroethLaw);
  }
  
  async handleCleaner(sender) {
    if (this.cleanedUrls.size === 0) {
      await this.sendMessage(sender, '🧹 No URLs have been cleaned recently.');
      return;
    }
    
    const recentCleans = Array.from(this.cleanedUrls.values()).slice(-5);
    let response = '🧹 Recent URL cleaning:\\n\\n';
    
    recentCleans.forEach((clean, index) => {
      response += `${index + 1}. Removed ${clean.trackersRemoved} tracker(s)\\n`;
      response += `   Original: ${clean.originalUrl.substring(0, 60)}...\\n`;
      response += `   Cleaned: ${clean.cleanedUrl.substring(0, 60)}...\\n\\n`;
    });
    
    await this.sendMessage(sender, response);
  }
  
  // Admin placeholder handlers
  async handleAdmin(sender) {
    await this.sendMessage(sender, '👨‍💼 Admin features require proper authentication setup.');
  }
  
  async handleAddTo(sender) {
    await this.sendMessage(sender, '➕ Group management features require admin setup.');
  }
  
  async handleGTG(sender) {
    await this.sendMessage(sender, '✅ Approval system requires admin configuration.');
  }
  
  async handleSNGTG(sender) {
    await this.sendMessage(sender, '🔐 Safety number verification requires admin setup.');
  }
  
  // Generic placeholder for other commands
  async handlePlaceholder(commandName, sender) {
    await this.sendMessage(sender, `🚧 ${commandName} feature in development.`);
  }
  
  // Add handlers for remaining commands
  async handleJoin(sender) { await this.handlePlaceholder('Join', sender); }
  async handleInvite(sender) { await this.handlePlaceholder('Invite', sender); }
  async handleWiki(sender) { await this.handlePlaceholder('Wiki', sender); }
  async handleForum(sender) { await this.handlePlaceholder('Forum', sender); }
  async handleEvents(sender) { await this.handlePlaceholder('Events', sender); }
  async handleFAQ(sender) { await this.handlePlaceholder('FAQ', sender); }
  async handleDocs(sender) { await this.handlePlaceholder('Docs', sender); }
  async handleLinks(sender) { await this.handlePlaceholder('Links', sender); }
  async handleTLDR(sender) { await this.handlePlaceholder('TLDR', sender); }
  async handleWayback(sender) { await this.handlePlaceholder('Wayback', sender); }
  async handleArchive(sender) { await this.handlePlaceholder('Archive', sender); }
  async handleBypass(sender) { await this.handlePlaceholder('Bypass', sender); }
  async handleForumPost(sender) { await this.handlePlaceholder('Forum Post', sender); }
  async handleForumLatest(sender) { await this.handlePlaceholder('Forum Latest', sender); }
  async handleForumSearch(sender) { await this.handlePlaceholder('Forum Search', sender); }
  async handleCategories(sender) { await this.handlePlaceholder('Categories', sender); }
  async handleSummarize(sender) { await this.handlePlaceholder('Summarize', sender); }
  
  async stopListening() {
    console.log('🛑 Stopping Signal CLI bot...');
    this.isListening = false;
    
    if (this.socket) {
      this.socket.end();
    }
    
    if (this.daemon) {
      this.daemon.kill('SIGTERM');
    }
    
    console.log('✅ Bot stopped');
  }
}

// Configuration
const config = {
  phoneNumber: '+19108471202',
  socketPath: '/tmp/signal-cli-socket', 
  dataDir: './signal-data',
  aiEnabled: !!process.env.OPENAI_API_KEY,
  openAiApiKey: process.env.OPENAI_API_KEY,
  localAiUrl: process.env.LOCAL_AI_URL || 'https://ai.untitledstartup.xyz'
};

console.log('🚀 Starting Production Signal CLI Bot...');

// Create and start the bot
const bot = new ProductionSignalBot(config);

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down...');
  await bot.stopListening();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down...');
  await bot.stopListening();
  process.exit(0);
});

// Start the bot
bot.startListening().catch(error => {
  console.error('💥 Fatal error starting bot:', error);
  process.exit(1);
});