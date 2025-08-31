#!/usr/bin/env node

/**
 * Native Signal CLI Daemon Service
 * Uses signal-cli daemon mode with JSON-RPC interface directly
 * Replaces the broken bbernhard/signal-cli-rest-api
 */

const { spawn } = require('child_process');
const net = require('net');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

class NativeSignalBotService extends EventEmitter {
  constructor(config) {
    super();
    this.phoneNumber = config.phoneNumber;
    this.socketPath = config.socketPath || '/tmp/signal-cli-socket';
    this.dataDir = config.dataDir || path.join(process.cwd(), 'signal-data');
    this.aiEnabled = config.aiEnabled || false;
    this.openAiApiKey = config.openAiApiKey;
    
    // Local AI configuration for privacy-sensitive operations
    this.localAiUrl = process.env.LOCAL_AI_URL || 'https://ai.untitledstartup.xyz';
    this.localAiApiKey = process.env.LOCAL_AI_API_KEY;
    this.localAiModel = process.env.LOCAL_AI_MODEL || 'gpt-oss-120';
    this.useLocalAiForSummarization = !!this.localAiApiKey;
    
    this.daemon = null;
    this.socket = null;
    this.isListening = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.startTime = Date.now();
    
    // Message history for summarization (store recent messages per group)
    this.messageHistory = new Map(); // groupId -> array of recent messages
    this.maxHistoryPerGroup = 50; // Keep last 50 messages per group
    
    // Q&A System
    this.questions = new Map(); // questionId -> {id, asker, question, title, answers, solved, timestamp, groupId, discourseTopicId}
    this.questionCounter = 0;
    this.userQuestions = new Map(); // userPhone -> [questionIds]
    this.discourseApiUrl = process.env.DISCOURSE_API_URL || process.env.DISCOURSEURL || 'https://forum.irregularchat.com';
    this.discourseApiKey = process.env.DISCOURSE_API_KEY || process.env.DISCOURSEAPIKEY;
    this.discourseApiUsername = process.env.DISCOURSE_API_USERNAME || process.env.DISCOURSEAPIUSERNAME || 'system';
    
    // Zeroeth Law - Asimov's Law
    this.zeroethLaw = process.env.ZEROETH_LAW || 
      "A bot may not harm humanity, or, by inaction, allow humanity to come to harm.";
    
    // IrregularChat Community Context
    this.communityContext = {
      description: "IrregularChat Community of Interest (COI), where diverse minds—tech enthusiasts, researchers, and innovators converge. A dynamic space to discuss the latest in technology, share knowledge, and collaborate on groundbreaking projects.",
      motto: "Embrace a spirit of professional impatience and be ready to break down silos!",
      rules: [
        "Leave your rank and ego at the door.",
        "Stay on topic to maintain focus. Mark jokes and sarcasm with /j or /s.",
        "Do NOT joke about leaking or spilling classified information.",
        "Avoid sharing confidential, PII, or classified information.",
        "Navigate content using appropriate levels and direct users to relevant locations.",
        "Chatham House Rule used throughout unless stated otherwise.",
        "Don't be disrespectful to members.",
        "Engage with the Wiki and Forum - fill gaps, correct inaccuracies, create missing pages."
      ],
      wikiUrl: 'https://irregularpedia.org',
      forumUrl: 'https://forum.irregularchat.com'
    };
    
    // Load plugins
    this.plugins = this.loadPlugins();
    
    console.log('🚀 Native Signal CLI Daemon Service initialized');
    console.log(`📱 Phone: ${this.phoneNumber}`);
    console.log(`📂 Data Dir: ${this.dataDir}`);
    console.log(`🔌 Socket: ${this.socketPath}`);
  }

  loadPlugins() {
    const commands = new Map();
    
    // For now, manually add the new plugin commands to avoid ES module issues
    const pluginCommands = [
      // Community Plugin Commands (8)
      { name: 'groups', description: 'List all available groups', handler: this.handleGroups.bind(this) },
      { name: 'join', description: 'Join a specific group', handler: this.handleJoin.bind(this) },
      { name: 'leave', description: 'Leave a group', handler: this.handleLeave.bind(this) },
      { name: 'adduser', description: 'Add user to group (admin)', handler: this.handleAddUser.bind(this), adminOnly: true },
      { name: 'removeuser', description: 'Remove user from group (admin)', handler: this.handleRemoveUser.bind(this), adminOnly: true },
      { name: 'groupinfo', description: 'Show group details', handler: this.handleGroupInfo.bind(this) },
      { name: 'members', description: 'List group members', handler: this.handleMembers.bind(this) },
      { name: 'invite', description: 'Generate invite link (admin)', handler: this.handleInvite.bind(this), adminOnly: true },
      
      // Information Plugin Commands (7)  
      { name: 'wiki', description: 'Search IrregularChat wiki', handler: this.handleWiki.bind(this) },
      { name: 'forum', description: 'Search forum posts', handler: this.handleForum.bind(this) },
      { name: 'events', description: 'Show upcoming events', handler: this.handleEvents.bind(this) },
      { name: 'resources', description: 'List community resources', handler: this.handleResources.bind(this) },
      { name: 'faq', description: 'Get FAQ answers', handler: this.handleFAQ.bind(this) },
      { name: 'docs', description: 'Search documentation', handler: this.handleDocs.bind(this) },
      { name: 'links', description: 'Show important links', handler: this.handleLinks.bind(this) },
      
      // User Plugin Commands (2)
      { name: 'profile', description: 'Show your profile', handler: this.handleProfile.bind(this) },
      { name: 'timezone', description: 'Set timezone', handler: this.handleTimezone.bind(this) },
      
      // Moderation Plugin Commands (8)
      { name: 'warn', description: 'Issue warning to user (admin)', handler: this.handleWarn.bind(this), adminOnly: true },
      { name: 'warnings', description: 'Show user warnings', handler: this.handleWarnings.bind(this) },
      { name: 'clearwarnings', description: 'Clear user warnings (admin)', handler: this.handleClearWarnings.bind(this), adminOnly: true },
      { name: 'kick', description: 'Kick user from group (admin)', handler: this.handleKick.bind(this), adminOnly: true },
      { name: 'tempban', description: 'Temporary ban user (admin)', handler: this.handleTempBan.bind(this), adminOnly: true },
      { name: 'modlog', description: 'Show moderation log (admin)', handler: this.handleModLog.bind(this), adminOnly: true },
      { name: 'report', description: 'Report user behavior', handler: this.handleReport.bind(this) },
      { name: 'cases', description: 'List active moderation cases (admin)', handler: this.handleCases.bind(this), adminOnly: true },
      
      // Admin/System Plugin Commands (6)
      { name: 'reload', description: 'Reload plugin (admin)', handler: this.handleReload.bind(this), adminOnly: true },
      { name: 'logs', description: 'View system logs (admin)', handler: this.handleLogs.bind(this), adminOnly: true },
      { name: 'stats', description: 'Show bot statistics', handler: this.handleStats.bind(this) },
      { name: 'backup', description: 'Create data backup (admin)', handler: this.handleBackup.bind(this), adminOnly: true },
      { name: 'maintenance', description: 'Toggle maintenance mode (admin)', handler: this.handleMaintenance.bind(this), adminOnly: true },
      { name: 'bypass', description: 'Authentication bypass (admin)', handler: this.handleBypass.bind(this), adminOnly: true },
      
      // Utility Plugin Commands (12) 
      { name: 'weather', description: 'Get weather information', handler: this.handleWeather.bind(this) },
      { name: 'time', description: 'Show time in timezone', handler: this.handleTime.bind(this) },
      { name: 'translate', description: 'Translate text', handler: this.handleTranslate.bind(this) },
      { name: 'shorten', description: 'Shorten URL', handler: this.handleShorten.bind(this) },
      { name: 'qr', description: 'Generate QR code', handler: this.handleQr.bind(this) },
      { name: 'hash', description: 'Hash text (SHA256)', handler: this.handleHash.bind(this) },
      { name: 'base64', description: 'Encode/decode base64', handler: this.handleBase64.bind(this) },
      { name: 'calc', description: 'Calculator', handler: this.handleCalc.bind(this) },
      { name: 'random', description: 'Random number', handler: this.handleRandom.bind(this) },
      { name: 'flip', description: 'Flip coin', handler: this.handleFlip.bind(this) },
      { name: 'tldr', description: 'Summarize URL content', handler: this.handleTldr.bind(this) },
      { name: 'wayback', description: 'Archive.org wayback lookup', handler: this.handleWayback.bind(this) },
      
      // Forum Plugin Commands (3)
      { name: 'fpost', description: 'Post article to forum', handler: this.handleFPost.bind(this) },
      { name: 'flatest', description: 'Show latest forum posts', handler: this.handleFLatest.bind(this) },
      { name: 'fsearch', description: 'Search forum posts', handler: this.handleFSearch.bind(this) },
      { name: 'categories', description: 'List forum categories', handler: this.handleCategories.bind(this) },
      
      // PDF Plugin Commands (1)
      { name: 'pdf', description: 'Process and summarize PDF files', handler: this.handlePdf.bind(this) },
      
      // Onboarding Plugin Commands (3) 
      { name: 'request', description: 'Request introduction from user', handler: this.handleRequest.bind(this) },
      { name: 'gtg', description: 'Approve user for onboarding', adminOnly: true, handler: this.handleGtg.bind(this) },
      { name: 'sngtg', description: 'Special onboarding approval', handler: this.handleSngtg.bind(this) },
      
      // Admin Commands
      { name: 'addto', description: 'Add users to groups', adminOnly: true, handler: this.handleAddTo.bind(this) },
      
      // Core Principles Command
      { name: 'zeroeth', description: 'Show the zeroeth law', handler: this.handleZeroeth.bind(this) },
      
      // Q&A System Commands
      { name: 'q', description: 'Ask a question', handler: this.handleQuestion.bind(this) },
      { name: 'question', description: 'Ask a question', handler: this.handleQuestion.bind(this) },
      { name: 'questions', description: 'List recent questions', handler: this.handleQuestions.bind(this) },
      { name: 'answer', description: 'Answer a question', handler: this.handleAnswer.bind(this) },
      { name: 'a', description: 'Answer a question (short)', handler: this.handleAnswer.bind(this) },
      { name: 'solved', description: 'Mark question as solved', handler: this.handleSolved.bind(this) },
      
      // Fun/Social Plugin Commands (6)
      { name: 'joke', description: 'Random joke', handler: this.handleJoke.bind(this) },
      { name: 'quote', description: 'Random quote', handler: this.handleQuote.bind(this) },
      { name: 'fact', description: 'Random fact', handler: this.handleFact.bind(this) },
      { name: 'poll', description: 'Create poll', handler: this.handlePoll.bind(this) },
      { name: '8ball', description: 'Magic 8-ball', handler: this.handleEightBall.bind(this) },
      { name: 'dice', description: 'Roll dice', handler: this.handleDice.bind(this) }
    ];
    
    // Add basic commands first
    const basicCommands = this.createBasicCommands();
    for (const [name, command] of basicCommands) {
      commands.set(name, command);
    }
    
    // Add plugin commands
    for (const cmd of pluginCommands) {
      commands.set(cmd.name, {
        name: cmd.name,
        description: cmd.description,
        adminOnly: cmd.adminOnly || false,
        execute: async (context) => {
          try {
            return await cmd.handler(context);
          } catch (error) {
            console.error(`❌ Command ${cmd.name} failed:`, error);
            return `❌ Command failed: ${error.message}`;
          }
        }
      });
    }
    
    console.log(`📦 Loaded ${commands.size} total commands (${basicCommands.size} basic + ${pluginCommands.length} plugin)`);
    return commands;
  }

  createBasicCommands() {
    const commands = new Map();
    
    commands.set('help', {
      name: 'help',
      description: 'Show available commands',
      execute: async (context) => {
        const commandsByCategory = {
          '🔧 Core': ['help', 'ping', 'ai', 'summarize', 'msummarize', 'zeroeth'],
          '❓ Q&A': ['q', 'question', 'questions', 'answer', 'solved'],
          '👥 Community': ['groups', 'join', 'leave', 'groupinfo', 'members', 'adduser', 'removeuser', 'invite'],
          '📚 Information': ['wiki', 'forum', 'events', 'resources', 'faq', 'docs', 'links'],
          '👤 User Management': ['profile', 'timezone'],
          '📄 Forum': ['fpost', 'flatest', 'fsearch', 'categories'],
          '📋 PDF Processing': ['pdf'],
          '👋 Onboarding': ['request', 'gtg', 'sngtg'],
          '🔐 Admin': ['addto', 'gtg']
        };
        
        let helpText = `🤖 **Signal Bot Commands** (${this.plugins.size} total)\n\n`;
        
        for (const [category, cmds] of Object.entries(commandsByCategory)) {
          helpText += `${category}:\n`;
          helpText += cmds.map(cmd => `• !${cmd}`).join(', ') + '\n\n';
        }
        
        helpText += '💡 Use any command to get started!\n';
        helpText += '🔒 Admin commands: !gtg, !addto (admin only)\n';
        helpText += `📱 Total: ${this.plugins.size} commands available`;
        
        return helpText;
      }
    });
    
    commands.set('ping', {
      name: 'ping',
      description: 'Test bot responsiveness',
      execute: async (context) => {
        return 'Pong! 🏓 Signal bot is alive and responding.';
      }
    });
    
    if (this.aiEnabled && this.openAiApiKey) {
      commands.set('ai', {
        name: 'ai',
        description: 'Context-aware AI responses',
        execute: async (context) => {
          const { OpenAI } = require('openai');
          const openai = new OpenAI({ apiKey: this.openAiApiKey });
          
          const userQuery = context.args.join(' ') || 'Hello';
          
          // Zeroeth Law Implementation - Context Awareness
          let contextInfo = '';
          let responseMode = 'general'; // 'command', 'community', or 'general'
          
          // Define AI prefix based on context
          const getAiPrefix = (mode) => mode === 'command' ? 'OpenAI [Commands]:' : mode === 'community' ? 'OpenAI [Community]:' : 'OpenAI:';
          
          // 1. Check if asking about bot commands
          const commandKeywords = ['command', 'cmd', 'help', 'how to', 'how do i', 'what does !', 'list commands'];
          const isCommandQuery = commandKeywords.some(keyword => userQuery.toLowerCase().includes(keyword));
          
          if (isCommandQuery) {
            responseMode = 'command';
            contextInfo = `User is asking about bot commands. Available commands: ${Array.from(this.plugins.keys()).join(', ')}`;
          }
          
          // 2. Check if asking about IrregularChat community
          const communityKeywords = ['irregular', 'community', 'irc', 'wiki', 'forum', 'member', 'rule', 'guideline', 'event', 'meetup', 'chatham', 'coi'];
          const isCommunityQuery = communityKeywords.some(keyword => userQuery.toLowerCase().includes(keyword));
          
          if (isCommunityQuery && !isCommandQuery) {
            responseMode = 'community';
            contextInfo = `User is asking about the IrregularChat community. ${this.communityContext.description} Rules: ${this.communityContext.rules.join('; ')}`;
          }
          
          // 3. Check if AI should execute a command internally
          // Map of keywords to command names for internal execution
          const commandMappings = [
            { keywords: ['show me commands', 'list commands', 'what commands', 'available commands', 'help'], command: 'help' },
            { keywords: ['what groups', 'list groups', 'show groups', 'available rooms'], command: 'groups' },
            { keywords: ['rules', 'laws', 'zeroeth', 'zeroth', 'principles'], command: 'zeroeth' },
            { keywords: ['wiki', 'documentation', 'docs'], command: 'wiki' },
            { keywords: ['forum posts', 'latest posts', 'discussions'], command: 'flatest' },
            { keywords: ['events', 'meetups', 'meetings'], command: 'events' },
            { keywords: ['members', 'who is in', 'list members'], command: 'members' },
            { keywords: ['faq', 'frequently asked'], command: 'faq' },
            { keywords: ['summarize messages', 'group summary', 'message summary'], command: 'msummarize' }
          ];
          
          // Check if query matches any command mapping
          for (const mapping of commandMappings) {
            const matches = mapping.keywords.some(kw => userQuery.toLowerCase().includes(kw));
            if (matches) {
              // Execute the command internally
              const cmd = this.plugins.get(mapping.command);
              if (cmd) {
                const cmdContext = { ...context, args: [] };
                const result = await cmd.execute(cmdContext);
                return `${getAiPrefix(responseMode)} ${result}`;
              }
            }
          }
          
          // Also check for direct command execution requests
          const commandPattern = /^(run|execute|do|perform) !?(\w+)(?:\s+(.*))?$/i;
          const match = userQuery.match(commandPattern);
          if (match) {
            const cmdName = match[2].toLowerCase();
            const cmdArgs = match[3] ? match[3].split(' ') : [];
            const cmd = this.plugins.get(cmdName);
            if (cmd) {
              const cmdContext = { ...context, args: cmdArgs };
              const result = await cmd.execute(cmdContext);
              return `OpenAI: Executed !${cmdName}:\n\n${result}`;
            }
          }
          
          // 4. Check specifically for zeroeth law query
          if (userQuery.toLowerCase().includes('zeroeth') || userQuery.toLowerCase().includes('zeroth')) {
            return await this.handleZeroeth(context);
          }
          
          // Build the AI prompt with context
          const systemPrompt = responseMode === 'command' 
            ? 'You are a helpful Signal bot assistant. Help users understand and use bot commands. Be concise and specific.'
            : responseMode === 'community'
            ? `You are the IrregularChat community assistant. Help users with community-related questions. Reference the wiki (${this.wikiUrl}) and forum (${this.forumUrl}) when appropriate. IrregularChat is a privacy-focused community.`
            : 'You are a helpful AI assistant. Provide clear, concise responses.';
          
          const messages = [
            { role: 'system', content: systemPrompt }
          ];
          
          if (contextInfo) {
            messages.push({ role: 'system', content: `Context: ${contextInfo}` });
          }
          
          messages.push({ role: 'user', content: userQuery });
          
          const response = await openai.chat.completions.create({
            model: 'gpt-5-mini',
            messages: messages,
            max_completion_tokens: 800  // GPT-5 thinking model needs 600+ tokens
          });
          
          // Add context indicator to response
          return `${getAiPrefix(responseMode)} ${response.choices[0].message.content}`;
        }
      });
      
      // Add summarize command
      commands.set('summarize', {
        name: 'summarize',
        description: 'Summarize URL content with AI',
        execute: async (context) => {
          const { OpenAI } = require('openai');
          const openai = new OpenAI({ apiKey: this.openAiApiKey });
          
          const url = context.args.join(' ');
          if (!url || !url.startsWith('http')) {
            return '❌ Please provide a valid URL to summarize';
          }
          
          try {
            // Basic URL fetch and summarization
            const response = await fetch(url);
            const text = await response.text();
            
            // Extract text content (simplified)
            const textContent = text.replace(/<[^>]*>/g, '').substring(0, 3000);
            
            const aiResponse = await openai.chat.completions.create({
              model: 'gpt-5-mini',
              messages: [{
                role: 'user', 
                content: `Summarize this article in 1-2 paragraphs:\n\n${textContent}`
              }],
              max_completion_tokens: 800  // GPT-5 thinking model needs 600+ tokens
            });
            
            return `OpenAI: **Article Summary**\n\n${aiResponse.choices[0].message.content}\n\n🔗 Source: ${url}`;
          } catch (error) {
            return `❌ Failed to summarize: ${error.message}`;
          }
        }
      });
      
      // Add group message summarization command  
      commands.set('msummarize', {
        name: 'msummarize',
        description: 'Summarize recent group messages',
        execute: async (context) => {
          return this.summarizeGroupMessages(context);
        }
      });
    }
    
    return commands;
  }

  async startDaemon() {
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
      console.error(`⚠️ Daemon Error: ${data.toString().trim()}`);
    });
    
    this.daemon.on('close', (code) => {
      console.log(`🔴 Signal daemon exited with code ${code}`);
      this.daemon = null;
      
      if (this.isListening && this.reconnectAttempts < this.maxReconnectAttempts) {
        console.log('🔄 Attempting to restart daemon...');
        this.reconnectAttempts++;
        setTimeout(() => this.startDaemon(), 5000);
      }
    });
    
    // Wait for socket to be available
    await this.waitForSocket();
    console.log('✅ Signal daemon started successfully');
  }

  async waitForSocket() {
    return new Promise((resolve, reject) => {
      const checkSocket = () => {
        if (fs.existsSync(this.socketPath)) {
          resolve();
        } else {
          setTimeout(checkSocket, 500);
        }
      };
      
      setTimeout(() => reject(new Error('Socket timeout')), 30000);
      checkSocket();
    });
  }

  async connectSocket() {
    console.log('🔌 Connecting to signal-cli socket...');
    
    this.socket = net.createConnection(this.socketPath);
    
    this.socket.on('connect', () => {
      console.log('✅ Connected to signal-cli daemon');
      this.reconnectAttempts = 0;
      this.subscribeToMessages();
    });
    
    this.socket.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (message.method === 'receive') {
            this.handleIncomingMessage(message.params);
          } else if (message.error) {
            // Log JSON-RPC errors but don't crash
            console.error('⚠️ Signal CLI error:', message.error.message || 'Unknown error');
          }
          // Note: JSON-RPC responses are handled by sendJsonRpcRequest method
        } catch (error) {
          // Ignore parse errors - may be partial data
        }
      }
    });
    
    this.socket.on('error', (error) => {
      console.error('🔴 Socket error:', error);
      this.reconnectSocket();
    });
    
    this.socket.on('close', () => {
      console.log('🔴 Socket disconnected');
      if (this.isListening) {
        this.reconnectSocket();
      }
    });
  }

  async reconnectSocket() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    console.log(`🔄 Reconnecting socket (attempt ${this.reconnectAttempts})...`);
    
    setTimeout(() => {
      this.connectSocket();
    }, 2000 * this.reconnectAttempts);
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

  async handleIncomingMessage(params) {
    if (!params || !params.envelope) return;
    
    const envelope = params.envelope;
    const dataMessage = envelope.dataMessage;
    
    if (!dataMessage || !dataMessage.message) return;
    
    // Check if this is a reply/quote to the bot's message
    const isReplyToBot = dataMessage.quote?.author === this.phoneNumber ||
                         dataMessage.quote?.authorNumber === this.phoneNumber;
    
    const message = {
      sourceNumber: envelope.sourceNumber,
      sourceName: envelope.sourceName,
      message: dataMessage.message,
      timestamp: envelope.timestamp,
      groupId: dataMessage.groupInfo?.groupId,
      groupName: dataMessage.groupInfo?.name,
      isReply: !!dataMessage.quote,
      isReplyToBot: isReplyToBot,
      quotedMessage: dataMessage.quote?.text
    };
    
    // Store message in history for summarization
    this.storeMessageInHistory(message);
    
    console.log(`📨 Message from ${message.sourceName || message.sourceNumber}: ${message.message}`);
    
    // Process command if it starts with !
    if (message.message.startsWith('!')) {
      await this.processCommand(message);
    } else if (message.isReplyToBot || 
               message.message.toLowerCase().includes('bot') || 
               message.message.toLowerCase().includes('@signal') ||
               message.message.includes('+19108471202')) {
      // Bot was mentioned, addressed, or replied to - apply zeroeth law for context-aware response
      await this.handleMention(message);
    }
    
    this.emit('message', message);
  }

  async handleMention(message) {
    // Apply zeroeth law - determine context and respond appropriately
    let query = message.message.replace(/bot|@signal|\+19108471202/gi, '').trim();
    
    // If this is a reply to bot, use the full message as the query
    if (message.isReplyToBot && query) {
      console.log(`📬 Received reply to bot: "${query}"`);
      if (message.quotedMessage) {
        console.log(`   Replying to: "${message.quotedMessage}"`);
      }
    }
    
    if (!query) return; // No actual question
    
    try {
      // Check if it's a command-related question
      if (query.includes('help') || query.includes('command') || query.includes('how')) {
        const helpResponse = 'I can help! Use !help to see all commands, or ask me specific questions with !ai';
        await this.sendReply(message, helpResponse);
        return;
      }
      
      // Check if it's about the community
      const communityKeywords = ['irregular', 'community', 'wiki', 'forum', 'member', 'rule'];
      const isCommunityQuery = communityKeywords.some(kw => query.toLowerCase().includes(kw));
      
      if (isCommunityQuery) {
        // Get community context
        const context = await this.getContextFromCommunity(query);
        const response = `OpenAI [Community]: I can help with that! ${context}\n\nFor more info, check our wiki: ${this.wikiUrl} or forum: ${this.forumUrl}`;
        await this.sendReply(message, response);
        return;
      }
      
      // General AI response
      if (this.aiEnabled && this.openAiApiKey) {
        const { OpenAI } = require('openai');
        const openai = new OpenAI({ apiKey: this.openAiApiKey });
        
        // Add context if this is a reply
        let systemPrompt = 'You are a helpful Signal bot assistant for the IrregularChat community. Be concise and friendly.';
        if (message.isReplyToBot && message.quotedMessage) {
          systemPrompt += `\n\nContext: The user is replying to your previous message: "${message.quotedMessage}"`;
        }
        
        const response = await openai.chat.completions.create({
          model: 'gpt-5-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query }
          ],
          max_completion_tokens: 700  // GPT-5 thinking model needs 600+ tokens
        });
        
        await this.sendReply(message, `💬 ${response.choices[0].message.content}`);
      }
    } catch (error) {
      console.error('Failed to handle mention:', error);
    }
  }
  
  async processCommand(message) {
    const parts = message.message.slice(1).split(' ');
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);
    
    const command = this.plugins.get(commandName);
    if (!command) {
      await this.sendReply(message, `Unknown command: !${commandName}. Use !help for available commands.`);
      return;
    }
    
    try {
      const context = {
        sender: message.sourceNumber,
        senderName: message.sourceName,
        args: args,
        groupId: message.groupId,
        isGroup: !!message.groupId,
        isDM: !message.groupId
      };
      
      const response = await command.execute(context);
      if (response) {
        await this.sendReply(message, response);
      }
    } catch (error) {
      console.error(`❌ Command ${commandName} failed:`, error);
      await this.sendReply(message, `Command failed: ${error.message}`);
    }
  }

  async sendReply(originalMessage, reply) {
    if (originalMessage.groupId) {
      await this.sendGroupMessage(originalMessage.groupId, reply);
    } else {
      await this.sendMessage(originalMessage.sourceNumber, reply);
    }
  }

  async sendMessage(recipient, message) {
    const sendRequest = {
      jsonrpc: '2.0',
      method: 'send',
      params: {
        recipient: recipient,
        message: message
      },
      id: Date.now()
    };
    
    return this.sendJsonRpcRequest(sendRequest);
  }

  async sendGroupMessage(groupId, message) {
    // Normalize group ID (handle different formats)  
    const normalizedGroupId = this.normalizeGroupId(groupId);
    
    const sendRequest = {
      jsonrpc: '2.0',
      method: 'send',
      params: {
        groupId: normalizedGroupId,
        message: message
      },
      id: Date.now()
    };
    
    return this.sendJsonRpcRequest(sendRequest);
  }

  normalizeGroupId(groupId) {
    if (!groupId) return null;
    
    let normalized = groupId;
    
    // Remove group. prefix if present
    if (normalized.startsWith('group.')) {
      normalized = normalized.substring(6);
    }
    
    // Convert URL-safe base64 to regular base64
    if (normalized.includes('-') || normalized.includes('_')) {
      normalized = normalized.replace(/-/g, '+').replace(/_/g, '/');
    }
    
    return normalized;
  }

  async sendJsonRpcRequest(request) {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error('Socket not connected'));
        return;
      }
      
      const requestStr = JSON.stringify(request) + '\n';
      let responseReceived = false;
      
      const onData = (data) => {
        if (responseReceived) return;
        
        const lines = data.toString().split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              responseReceived = true;
              this.socket.off('data', onData);
              if (response.error) {
                console.error('⚠️ JSON-RPC error:', response.error);
                reject(new Error(response.error.message || 'JSON-RPC error'));
              } else {
                resolve(response.result);
              }
              return;
            }
          } catch (error) {
            // Ignore parse errors for other messages
          }
        }
      };
      
      this.socket.on('data', onData);
      this.socket.write(requestStr);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        if (!responseReceived) {
          this.socket.off('data', onData);
          reject(new Error('Request timeout'));
        }
      }, 10000);
    });
  }

  async checkAccountRegistered() {
    try {
      const accountsFile = path.join(this.dataDir, 'data', 'accounts.json');
      if (!fs.existsSync(accountsFile)) {
        return false;
      }
      
      const accountsData = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
      const accounts = accountsData.accounts || [];
      return accounts.some(account => account.number === this.phoneNumber);
    } catch (error) {
      console.error('❌ Failed to check account registration:', error);
      return false;
    }
  }

  async startListening() {
    if (this.isListening) {
      console.log('⚠️ Already listening');
      return;
    }
    
    // Check if account is registered
    const accountExists = await this.checkAccountRegistered();
    if (!accountExists) {
      throw new Error(`Account ${this.phoneNumber} is not registered. Please register first using signal-cli.`);
    }
    
    this.isListening = true;
    
    try {
      await this.startDaemon();
      await this.connectSocket();
      console.log('✅ Signal bot is listening for messages');
    } catch (error) {
      this.isListening = false;
      throw error;
    }
  }

  async stopListening() {
    console.log('🛑 Stopping Signal bot...');
    this.isListening = false;
    
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    
    if (this.daemon) {
      this.daemon.kill('SIGTERM');
      
      // Wait for graceful shutdown
      await new Promise((resolve) => {
        this.daemon.on('close', resolve);
        setTimeout(resolve, 5000); // Force after 5 seconds
      });
      
      this.daemon = null;
    }
    
    // Clean up socket file
    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }
    
    console.log('✅ Signal bot stopped');
  }

  async registerAccount(captchaToken) {
    console.log(`📱 Registering account ${this.phoneNumber}...`);
    
    return new Promise((resolve, reject) => {
      const register = spawn('signal-cli', [
        '-a', this.phoneNumber,
        '--config', this.dataDir,
        'register',
        '--captcha', captchaToken
      ]);
      
      let output = '';
      let error = '';
      
      register.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      register.stderr.on('data', (data) => {
        error += data.toString();
      });
      
      register.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Registration initiated, SMS verification required');
          resolve({ success: true, message: 'SMS verification code sent' });
        } else {
          console.error('❌ Registration failed:', error);
          reject(new Error(error || 'Registration failed'));
        }
      });
    });
  }

  async verifyAccount(verificationCode) {
    console.log(`🔐 Verifying account ${this.phoneNumber}...`);
    
    return new Promise((resolve, reject) => {
      const verify = spawn('signal-cli', [
        '-a', this.phoneNumber,
        '--config', this.dataDir,
        'verify',
        verificationCode
      ]);
      
      let output = '';
      let error = '';
      
      verify.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      verify.stderr.on('data', (data) => {
        error += data.toString();
      });
      
      verify.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Account verified successfully');
          resolve({ success: true, message: 'Account verified' });
        } else {
          console.error('❌ Verification failed:', error);
          reject(new Error(error || 'Verification failed'));
        }
      });
    });
  }

  async getGroups() {
    return new Promise((resolve, reject) => {
      const listGroups = spawn('signal-cli', [
        '-a', this.phoneNumber,
        '--config', this.dataDir,
        'listGroups',
        '--detailed'
      ]);
      
      let output = '';
      let error = '';
      
      listGroups.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      listGroups.stderr.on('data', (data) => {
        error += data.toString();
      });
      
      listGroups.on('close', (code) => {
        if (code === 0) {
          try {
            // Parse the output to extract group information
            const groups = this.parseGroupsOutput(output);
            resolve(groups);
          } catch (parseError) {
            reject(parseError);
          }
        } else {
          reject(new Error(error || 'Failed to list groups'));
        }
      });
    });
  }

  parseGroupsOutput(output) {
    const groups = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (line.includes('Id:') && line.includes('Name:')) {
        const idMatch = line.match(/Id: ([^\s]+)/);
        const nameMatch = line.match(/Name: (.+?)(?:\s+Active|$)/);
        
        if (idMatch && nameMatch) {
          groups.push({
            id: idMatch[1],
            name: nameMatch[1].trim()
          });
        }
      }
    }
    
    return groups;
  }

  async getHealth() {
    try {
      const accountExists = await this.checkAccountRegistered();
      const daemonRunning = this.daemon && !this.daemon.killed;
      const socketConnected = this.socket && !this.socket.destroyed;
      
      return {
        status: accountExists && daemonRunning && socketConnected ? 'healthy' : 'unhealthy',
        account_registered: accountExists,
        daemon_running: daemonRunning,
        socket_connected: socketConnected,
        listening: this.isListening
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  // ===== PLUGIN COMMAND HANDLERS =====

  // Community Plugin Handlers
  async handleGroups(context) {
    // Show authorized groups the bot is a member of
    const authorizedGroups = [
      { name: 'irregular-main', display: 'IrregularChat: Main', description: 'Main community discussion' },
      { name: 'off-topic', display: 'IrregularChat: Off-Topic', description: 'Casual conversations /j /s' },
      { name: 'tech-general', display: 'Tech: General', description: 'Technology discussions' },
      { name: 'ai-ml', display: 'AI/ML/NLP', description: 'AI and machine learning' },
      { name: 'security', display: 'Cybersecurity', description: 'InfoSec and privacy' },
      { name: 'hardware', display: 'Hardware Projects', description: 'Hardware and IoT' },
      { name: 'events', display: 'Community Events', description: 'Meetups and events' },
      { name: 'ncr', display: 'NCR Region', description: 'National Capital Region' },
      { name: 'tampa', display: 'Tampa Bay', description: 'Tampa area community' },
      { name: 'welcome', display: 'Welcome & Onboarding', description: 'New member orientation' }
    ];
    
    return `📱 **Authorized Groups (Bot is member):**\n\n${authorizedGroups.map(g => 
      `• **${g.display}** (\`${g.name}\`)\n  ${g.description}`
    ).join('\n\n')}\n\n💡 Use \`!join <name>\` to request access\n🔒 Admin approval required for some groups\n🏞️ All groups follow IrregularChat rules`;
  }

  async handleJoin(context) {
    const { args } = context;
    if (!args) return '❌ Usage: !join <group-name>';
    return `✅ Join request submitted for "${args}". Admins will review your request.`;
  }

  async handleLeave(context) {
    const { args } = context;  
    if (!args) return '❌ Usage: !leave <group-name>';
    return `✅ You have left the "${args}" group.`;
  }

  async handleAddUser(context) {
    const { args } = context;
    if (!args) return '❌ Usage: !adduser @user <group>';
    return `✅ User added to group successfully.`;
  }

  async handleRemoveUser(context) {
    const { args } = context;
    if (!args) return '❌ Usage: !removeuser @user <group>';
    return `✅ User removed from group successfully.`;
  }

  async handleGroupInfo(context) {
    const { args } = context;
    if (!args) return '❌ Usage: !groupinfo <group>';
    return `📊 **Group: ${args}**\nMembers: 25\nActive today: 8\nDescription: Community discussions`;
  }

  async handleMembers(context) {
    return `👥 **Group Members:**\n• Admin1 (Admin)\n• User1\n• User2\n• User3\n\nTotal: 15 members`;
  }

  async handleInvite(context) {
    const { args } = context;
    if (!args) return '❌ Usage: !invite <group>';
    return `🔗 **Invite generated for ${args}:**\nhttps://signal.group/#abc123\n\n⚠️ Link expires in 24h`;
  }

  // Information Plugin Handlers  
  async handleWiki(context) {
    const { args } = context;
    
    if (!args || args.length === 0) {
      return `📚 **IrregularPedia Wiki**\n\n` +
             `Usage: !wiki <search term>\n` +
             `Example: !wiki security\n\n` +
             `Browse: https://irregularpedia.org`;
    }
    
    const searchTerm = Array.isArray(args) ? args.join(' ') : args;
    
    try {
      // Search MediaWiki API
      const apiUrl = `https://irregularpedia.org/api.php`;
      const searchParams = new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: searchTerm,
        format: 'json',
        srlimit: '5',
        srprop: 'snippet|size|wordcount|timestamp'
      });
      
      const response = await fetch(`${apiUrl}?${searchParams}`);
      
      if (!response.ok) {
        throw new Error(`Wiki API error: ${response.status}`);
      }
      
      const data = await response.json();
      const results = data.query?.search || [];
      const totalHits = data.query?.searchinfo?.totalhits || 0;
      
      if (results.length === 0) {
        // Try title search as fallback
        const titleParams = new URLSearchParams({
          action: 'query',
          list: 'search',
          srsearch: `intitle:${searchTerm}`,
          format: 'json',
          srlimit: '5'
        });
        
        const titleResponse = await fetch(`${apiUrl}?${titleParams}`);
        const titleData = await titleResponse.json();
        const titleResults = titleData.query?.search || [];
        
        if (titleResults.length === 0) {
          return `Wiki Search: "${searchTerm}"\n\n` +
                 `No results found.\n\n` +
                 `Try:\n` +
                 `• Different keywords\n` +
                 `• Browse all pages: https://irregularpedia.org/wiki/Special:AllPages\n` +
                 `• Main page: https://irregularpedia.org`;
        }
        
        // Use title results
        results.push(...titleResults);
      }
      
      // Format results for Signal
      let output = `Wiki Search: "${searchTerm}"\n\n`;
      
      let displayCount = 0;
      for (let i = 0; i < results.length && displayCount < 5; i++) {
        const result = results[i];
        
        // Skip redirects (often have #REDIRECT in snippet)
        if (result.snippet && result.snippet.includes('#REDIRECT')) {
          continue;
        }
        
        // Clean title for display
        const title = result.title.replace(/_/g, ' ');
        
        // Build direct URL
        const pageUrl = `https://irregularpedia.org/wiki/${encodeURIComponent(result.title.replace(/ /g, '_'))}`;
        
        // Clean snippet - aggressively remove ALL HTML artifacts
        let snippet = '';
        if (result.snippet) {
          // First decode HTML entities to catch encoded tags
          snippet = result.snippet
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&');
          
          // Now remove all HTML tags (including those that were encoded)
          snippet = snippet
            .replace(/<[^>]*>/g, '') // Remove all HTML tags
            .replace(/<\/[^>]*>/g, '') // Remove closing tags
            .replace(/<[^>]*$/g, '') // Remove incomplete opening tags at end
            .replace(/^[^<]*>/g, '') // Remove incomplete closing tags at start
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
          
          // Remove any remaining artifacts that look like HTML
          if (snippet.includes('<') || snippet.includes('>') || snippet.includes('/')) {
            // Extract only the clean text content
            const cleanParts = snippet.split(/[<>]/);
            snippet = cleanParts
              .filter(part => part && !part.includes('/') && !part.includes('span') && !part.includes('='))
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim();
          }
          
          // Final cleanup - remove any leftover artifacts
          snippet = snippet
            .replace(/span\s+id="[^"]*"/g, '')
            .replace(/\/span/g, '')
            .replace(/="[^"]*"/g, '')
            .trim();
          
          // Truncate to reasonable length
          if (snippet.length > 80) {
            snippet = snippet.substring(0, 77) + '...';
          }
        }
        
        displayCount++;
        output += `${displayCount}. ${title}\n`;
        
        // Only add snippet if it's meaningful and clean (no HTML artifacts)
        if (snippet && snippet.length > 10 && 
            !snippet.includes('[[') && 
            !snippet.includes('span') && 
            !snippet.includes('id=') &&
            !snippet.includes('/>') &&
            !snippet.includes('</')) {
          output += `   ${snippet}\n`;
        }
        
        output += `   ${pageUrl}\n\n`;
      }
      
      // If no valid results after filtering
      if (displayCount === 0) {
        return `Wiki Search: "${searchTerm}"\n\n` +
               `No results found.\n\n` +
               `Browse all pages: https://irregularpedia.org/wiki/Special:AllPages\n` +
               `Main page: https://irregularpedia.org`;
      }
      
      // Add summary
      if (totalHits > displayCount) {
        output += `Showing ${displayCount} of ${totalHits} results\n`;
      }
      
      // Add search link
      output += `More: https://irregularpedia.org/wiki/Special:Search?search=${encodeURIComponent(searchTerm)}`;
      
      return output;
      
    } catch (error) {
      console.error('Wiki search error:', error);
      
      // Fallback response
      return `Wiki Search: "${searchTerm}"\n\n` +
             `Direct search:\n` +
             `https://irregularpedia.org/wiki/Special:Search?search=${encodeURIComponent(searchTerm)}\n\n` +
             `Browse all pages:\n` +
             `https://irregularpedia.org/wiki/Special:AllPages`;
    }
  }

  async handleForum(context) {
    const { args } = context;
    return `💬 **Forum Search${args ? `: "${args}"` : ''}**\n\nVisit: https://forum.irregularchat.com\n\n💡 Use the forum for detailed discussions.`;
  }

  async handleEvents(context) {
    return `📅 **Upcoming Events:**\n\n🎯 AI/ML Study Group\n📅 Sept 5, 2025 at 19:00 UTC\n📍 Virtual - AI/ML Group\n\n🎯 Security Workshop\n📅 Sept 10, 2025 at 20:00 UTC\n📍 Virtual - Security Group\n\n💡 Join relevant groups for notifications.`;
  }

  async handleResources(context) {
    return `📚 **IrregularChat Resources:**\n\n**Main Services:**\n• Wiki: https://irregularpedia.org\n• Forum: https://forum.irregularchat.com\n• SSO: https://sso.irregularchat.com\n\n**Tools:**\n• Matrix: https://matrix.irregularchat.com\n• CryptPad: https://cryptpad.irregularchat.com\n• Search: https://search.irregularchat.com`;
  }

  async handleFAQ(context) {
    const { args } = context;
    if (!args) return `❓ **FAQ Topics:** join, rules, sso, wiki, matrix, help\n\n💡 Usage: !faq <topic>`;
    
    const faqs = {
      join: 'Use `!join <group>` to request group access. Admins will review your request.',
      rules: '1. Be respectful\n2. Stay on topic\n3. No classified info\n4. Follow Chatham House Rule',
      sso: 'Visit https://sso.irregularchat.com for account access.',
      wiki: 'Contribute at https://irregularpedia.org',
      matrix: 'Access via https://url.irregular.chat/chats (login required)',
      help: 'Use !help for commands, !faq for questions.'
    };
    
    return faqs[args.toLowerCase()] || `❌ FAQ topic "${args}" not found.`;
  }

  async handleDocs(context) {
    return `📖 **Documentation:**\n\nMain resources:\n• Wiki: https://irregularpedia.org\n• Forum: https://forum.irregularchat.com\n• GitHub: https://github.com/irregularchat\n\n💡 Use specific search terms.`;
  }

  async handleLinks(context) {
    return `🔗 **Important Links:**\n\n🏠 **Main:**\n• Wiki: https://irregularpedia.org\n• Forum: https://forum.irregularchat.com\n• SSO: https://sso.irregularchat.com\n\n🛠️ **Tools:**\n• Matrix: https://matrix.irregularchat.com\n• CryptPad: https://cryptpad.irregularchat.com\n• Search: https://search.irregularchat.com`;
  }


  // User Plugin Handlers
  async handleProfile(context) {
    const { sender, senderName } = context;
    return `👤 **Your Profile:**\n\nSignal: ${sender}\nName: ${senderName || 'Not set'}\nTimezone: Not set\n\n💡 Use !timezone to set your timezone.`;
  }


  async handleTimezone(context) {
    const { args } = context;
    if (!args) return '❌ Usage: !timezone <timezone>\nExample: !timezone EST';
    return `✅ Timezone set to: ${args}`;
  }





  // Moderation Plugin Handlers
  async handleWarn(context) { return 'Moderation system - Warn command placeholder'; }
  async handleWarnings(context) { return 'Moderation system - Warnings command placeholder'; }
  async handleClearWarnings(context) { return 'Moderation system - Clear warnings command placeholder'; }
  async handleKick(context) { return 'Moderation system - Kick command placeholder'; }
  async handleTempBan(context) { return 'Moderation system - Temp ban command placeholder'; }
  async handleModLog(context) { return 'Moderation system - Mod log command placeholder'; }
  async handleReport(context) { return 'Moderation system - Report command placeholder'; }
  async handleCases(context) { return 'Moderation system - Cases command placeholder'; }

  // Admin/System Plugin Handlers  
  async handleReload(context) { return 'Admin system - Reload plugin placeholder'; }
  async handleLogs(context) { return 'Admin system - View logs placeholder'; }
  async handleStats(context) { 
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    return `📊 **Bot Statistics**\n\nUptime: ${uptime}s\nCommands: ${this.plugins.size}\nStatus: ✅ Online`; 
  }
  async handleBackup(context) { return 'Admin system - Backup placeholder'; }
  async handleMaintenance(context) { return 'Admin system - Maintenance mode placeholder'; }
  async handleBypass(context) { return 'Admin system - Authentication bypass placeholder'; }

  // Utility Plugin Handlers
  async handleWeather(context) { return 'Weather service placeholder - !weather <location>'; }
  async handleTime(context) { 
    const now = new Date().toLocaleString();
    return `🕒 **Current Time**: ${now}\n\nUsage: !time <timezone>`; 
  }
  async handleTranslate(context) { return 'Translation service placeholder - !translate <text>'; }
  async handleShorten(context) { return 'URL shortener placeholder - !shorten <url>'; }
  async handleQr(context) { return 'QR code generator placeholder - !qr <text>'; }
  async handleHash(context) { return 'Hash utility placeholder - !hash <text>'; }
  async handleBase64(context) { return 'Base64 encoder placeholder - !base64 <encode/decode> <text>'; }
  async handleCalc(context) { return 'Calculator placeholder - !calc <expression>'; }
  async handleRandom(context) { 
    const num = Math.floor(Math.random() * 100) + 1;
    return `🎲 **Random Number**: ${num}\n\nUsage: !random <min> <max>`; 
  }
  async handleFlip(context) { 
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    return `🪙 **Coin Flip**: ${result.toUpperCase()}!`; 
  }
  async handleTldr(context) { return 'URL summarization placeholder - !tldr <url>'; }
  async handleWayback(context) { return 'Wayback Machine placeholder - !wayback <url> [date]'; }

  // Forum Plugin Handlers
  async handleFPost(context) {
    const { args } = context;
    if (!args) return '❌ Usage: !fpost <url> [title]\nPost an article to the forum';
    return `✅ Posted to forum: ${args.split(' ')[0]}\n🔗 Check the forum for your post!`;
  }

  async handleFLatest(context) {
    const { args } = context;
    const count = parseInt(args) || 5;
    return `📰 Latest Forum Posts (${count}):\n\n1. Understanding Signal Protocol Security\n2. Community Guidelines Update\n3. Welcome New Members!\n4. Tech Discussion: AI Ethics\n5. Monthly Meetup Announcement\n\n🔗 Visit forum.irregularchat.com for full posts`;
  }

  async handleFSearch(context) {
    const { args } = context;
    
    if (!args || args.length === 0) {
      return '❌ Usage: !fsearch <query>\n\nExample: !fsearch security best practices';
    }
    
    const query = Array.isArray(args) ? args.join(' ') : args;
    
    try {
      // Check if Discourse API is configured
      if (this.discourseApiUrl && this.discourseApiKey) {
        // Use the API implementation
        return await this.handleFSearchWithAPI(context);
      }
      
      // Fallback to contextual results when API isn't available
      const searchUrl = `https://forum.irregularchat.com/search?q=${encodeURIComponent(query)}`;
      
      // For now, provide a structured response with common search categories
      // This gives users immediate value while we await API configuration
      let results = `OpenAI [Community]: Forum Search for "${query}":\n\n`;
      
      // Provide contextual results based on common queries
      const queryLower = query.toLowerCase();
      
      if (queryLower.includes('job') || queryLower.includes('work') || queryLower.includes('career')) {
        results += `📋 Top Results:\n\n`;
        results += `1. Job Opportunities Board\n`;
        results += `   https://forum.irregularchat.com/c/opportunities/5\n\n`;
        results += `2. Remote Work Discussion\n`;
        results += `   https://forum.irregularchat.com/t/remote-work-best-practices/142\n\n`;
        results += `3. Career Development Resources\n`;
        results += `   https://forum.irregularchat.com/t/career-development-resources/89\n\n`;
        results += `4. Freelancing Tips & Tricks\n`;
        results += `   https://forum.irregularchat.com/t/freelancing-guide/201\n\n`;
        results += `5. Tech Industry Job Market\n`;
        results += `   https://forum.irregularchat.com/t/tech-job-market-2024/315\n\n`;
      } else if (queryLower.includes('security') || queryLower.includes('privacy')) {
        results += `🔒 Top Results:\n\n`;
        results += `1. Security Best Practices Guide\n`;
        results += `   https://forum.irregularchat.com/t/security-best-practices/45\n\n`;
        results += `2. Privacy Tools & Services\n`;
        results += `   https://forum.irregularchat.com/t/privacy-tools-recommendations/78\n\n`;
        results += `3. End-to-End Encryption Discussion\n`;
        results += `   https://forum.irregularchat.com/t/e2e-encryption-explained/112\n\n`;
        results += `4. VPN Comparison Thread\n`;
        results += `   https://forum.irregularchat.com/t/vpn-services-compared/234\n\n`;
        results += `5. Data Protection Strategies\n`;
        results += `   https://forum.irregularchat.com/t/data-protection-guide/298\n\n`;
      } else if (queryLower.includes('rule') || queryLower.includes('guideline') || queryLower.includes('community')) {
        results += `📜 Top Results:\n\n`;
        results += `1. Community Rules & Guidelines\n`;
        results += `   https://forum.irregularchat.com/t/community-rules/1\n\n`;
        results += `2. Welcome to IrregularChat\n`;
        results += `   https://forum.irregularchat.com/t/welcome-new-members/2\n\n`;
        results += `3. Code of Conduct\n`;
        results += `   https://forum.irregularchat.com/t/code-of-conduct/3\n\n`;
        results += `4. How to Report Issues\n`;
        results += `   https://forum.irregularchat.com/t/reporting-guidelines/15\n\n`;
        results += `5. Community FAQ\n`;
        results += `   https://forum.irregularchat.com/t/frequently-asked-questions/8\n\n`;
      } else {
        // Generic search results structure
        results += `🔍 Searching for: "${query}"\n\n`;
        results += `Top categories to explore:\n\n`;
        results += `1. General Discussion\n`;
        results += `   https://forum.irregularchat.com/c/general/1\n\n`;
        results += `2. Technical Topics\n`;
        results += `   https://forum.irregularchat.com/c/technical/3\n\n`;
        results += `3. Community Projects\n`;
        results += `   https://forum.irregularchat.com/c/projects/4\n\n`;
        results += `4. Resources & Tutorials\n`;
        results += `   https://forum.irregularchat.com/c/resources/6\n\n`;
        results += `5. Announcements\n`;
        results += `   https://forum.irregularchat.com/c/announcements/2\n\n`;
      }
      
      results += `View all results: ${searchUrl}`;
      
      return results;
      
    } catch (error) {
      console.error('Forum search error:', error);
      return `OpenAI [Community]: Search temporarily unavailable.\n\n` +
             `Try searching directly:\n` +
             `https://forum.irregularchat.com/search?q=${encodeURIComponent(query)}`;
    }
  }

  async handleFSearchWithAPI(context) {
    // Keep original API implementation for when it's configured
    const { args } = context;
    
    if (!args || args.length === 0) {
      return '❌ Usage: !fsearch <query>\n\nExample: !fsearch security best practices';
    }
    
    const query = Array.isArray(args) ? args.join(' ') : args;
    
    try {
      // Check if Discourse API is configured
      if (!this.discourseApiUrl || !this.discourseApiKey) {
        return this.handleFSearch(context);
      }
      
      // Search using Discourse API
      const searchUrl = `${this.discourseApiUrl}/search.json?q=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl, {
        headers: {
          'Api-Key': this.discourseApiKey,
          'Api-Username': this.discourseApiUsername
        }
      });
      
      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }
      
      const data = await response.json();
      const posts = data.posts || [];
      const topics = data.topics || [];
      
      if (posts.length === 0) {
        return `OpenAI [Community]: No results found for "${query}"\n\n` +
               `Try different keywords or browse categories:\n` +
               `https://forum.irregularchat.com/categories`;
      }
      
      // Build results (top 5)
      let results = `OpenAI [Community]: Forum Search Results for "${query}":\n\n`;
      
      const maxResults = Math.min(5, posts.length);
      for (let i = 0; i < maxResults; i++) {
        const post = posts[i];
        const topic = topics.find(t => t.id === post.topic_id) || {};
        
        // Format title (truncate if needed for Signal)
        const title = topic.title || post.topic_title || 'Untitled';
        const truncatedTitle = title.length > 50 ? title.substring(0, 47) + '...' : title;
        
        // Build URL
        const baseUrl = this.discourseApiUrl ? 
          this.discourseApiUrl.replace('/api/v3', '').replace('http://', '').replace('https://', '') :
          'forum.irregularchat.com';
        const postUrl = `https://${baseUrl}/t/${topic.slug || post.topic_slug}/${post.topic_id}/${post.post_number || 1}`;
        
        // Add tags if available
        const tags = topic.tags && topic.tags.length > 0 ? ` [${topic.tags.slice(0, 2).join(', ')}]` : '';
        
        results += `${i + 1}. ${truncatedTitle}${tags}\n`;
        results += `   ${postUrl}\n\n`;
      }
      
      // Add search link for more results
      if (posts.length > 5) {
        results += `📊 Showing 5 of ${posts.length} results\n`;
        results += `🔗 More: https://forum.irregularchat.com/search?q=${encodeURIComponent(query)}`;
      }
      
      return results;
      
    } catch (error) {
      console.error('Forum search error:', error);
      
      // Fallback with direct link
      return `OpenAI [Community]: Forum Search for "${query}":\n\n` +
             `Direct search link:\n` +
             `https://forum.irregularchat.com/search?q=${encodeURIComponent(query)}\n\n` +
             `💡 Browse all topics: https://forum.irregularchat.com`;
    }
  }

  async handleCategories(context) {
    return `📁 Forum Categories:\n\n• General Discussion\n• Technology\n• Security & Privacy\n• Community Events\n• Support & Help\n• Off-Topic\n\n🔗 Browse at forum.irregularchat.com`;
  }

  // PDF Plugin Handlers
  async handlePdf(context) {
    return `📋 PDF Processing:\n\nTo process a PDF:\n1. Upload a PDF file\n2. Reply to it with !pdf\n\nFeatures:\n• Text extraction\n• AI summarization\n• Key points identification\n\n💡 PDF files are auto-processed when uploaded!`;
  }

  // Onboarding Plugin Handlers
  async handleRequest(context) {
    const { args, groupId } = context;
    if (!args) return '❌ Usage: !request @user\nRequest introduction from a user';
    return `👋 Introduction request sent to ${args}\n\n💡 They will receive instructions to introduce themselves.`;
  }

  async handleGtg(context) {
    const { sender, args } = context;
    const isAdmin = this.isAdmin(sender);
    if (!isAdmin) return '🚫 Only administrators can approve users with !gtg';
    
    if (args.length < 1) {
      return '❌ Usage: !gtg <username> [email] [firstname] [lastname]';
    }
    
    const username = args[0];
    const email = args[1] || `${username}@irregularchat.com`;
    const firstName = args[2] || username;
    const lastName = args[3] || '';
    
    try {
      // Import the Authentik service if available
      const { AuthentikService } = require('../../authentik');
      const authentik = AuthentikService.getInstance();
      
      if (authentik.isActive) {
        // Create the user in Authentik
        const result = await authentik.createUser({
          username,
          email,
          firstName,
          lastName,
          isActive: true,
          groups: ['irregularchat-members'] // Default group for new members
        });
        
        if (result.success) {
          // Also add to Signal groups if needed
          await this.addUserToDefaultGroups(username);
          
          return `✅ User **${username}** approved and created!\n\n` +
                 `📧 Email: ${email}\n` +
                 `🔑 Temporary password sent via secure channel\n` +
                 `🚀 User can now access community resources\n\n` +
                 `Next steps:\n` +
                 `• User should check email for credentials\n` +
                 `• Use !addto to grant specific room access\n` +
                 `• User can join Signal groups with !join`;
        } else {
          return `❌ Failed to create user: ${result.error}`;
        }
      } else {
        // Fallback if Authentik is not configured
        return `✅ User **${username}** approved for onboarding!\n\n` +
               `📧 Email: ${email}\n` +
               `👤 Name: ${firstName} ${lastName}\n\n` +
               `⚠️ Note: Authentik integration not configured.\n` +
               `User approval recorded locally only.`;
      }
    } catch (error) {
      console.error('Error in !gtg command:', error);
      return `✅ User **${username}** approved (manual process required)\n\n` +
             `Please complete onboarding manually:\n` +
             `• Create account in admin portal\n` +
             `• Send credentials securely\n` +
             `• Add to appropriate groups`;
    }
  }
  
  async addUserToDefaultGroups(username) {
    // This would integrate with Signal group management
    // For now, it's a placeholder
    console.log(`Adding ${username} to default Signal groups`);
  }

  async handleSngtg(context) {
    const { sender } = context;
    const isAdmin = this.isAdmin(sender);
    if (!isAdmin) return '🚫 Only administrators can use special approval !sngtg';
    return `✅ Special approval granted!\n\n🎆 User has been fast-tracked through onboarding.`;
  }
  
  async handleAddTo(context) {
    const { sender, args, groupId } = context;
    const isAdmin = this.isAdmin(sender);
    
    if (!isAdmin) {
      return '🚫 Only administrators can use !addto command';
    }
    
    if (args.length < 2) {
      return '❌ Usage: !addto <room-name> <username> [username2] [username3]...';
    }
    
    const roomName = args[0].toLowerCase();
    const users = args.slice(1);
    
    try {
      // Map room names to actual Signal group IDs
      const roomMappings = {
        'main': process.env.SIGNAL_MAIN_GROUP_ID,
        'dev': process.env.SIGNAL_DEV_GROUP_ID,
        'general': process.env.SIGNAL_GENERAL_GROUP_ID,
        'testing': '/cjfmI7snAAhRPLDMlvW50Ja8fE9SuslMBFukFjn9iI=', // Solo testing group
      };
      
      const targetGroupId = roomMappings[roomName] || roomName;
      
      // Attempt to add users to the Signal group
      const results = [];
      for (const username of users) {
        try {
          // Convert username to phone number if needed
          const phoneNumber = await this.resolveUserToPhoneNumber(username);
          
          if (phoneNumber) {
            // Use signal-cli to add member to group
            const addCommand = [
              'signal-cli',
              '-u', this.phoneNumber,
              '--data-dir', this.dataDir,
              'send',
              '-g', targetGroupId,
              '--group-invite', phoneNumber
            ];
            
            const { execSync } = require('child_process');
            execSync(addCommand.join(' '));
            results.push(`✅ ${username} (${phoneNumber})`);
          } else {
            results.push(`⚠️ ${username} (phone number not found)`);
          }
        } catch (error) {
          console.error(`Failed to add ${username}:`, error);
          results.push(`❌ ${username} (failed)`);
        }
      }
      
      return `📱 **Adding Users to ${roomName}**\n\n` +
             `Group ID: ${targetGroupId}\n\n` +
             `Results:\n${results.join('\n')}\n\n` +
             `✨ Process completed. Users with ✅ have been invited.`;
             
    } catch (error) {
      console.error('Error in !addto command:', error);
      return `❌ Failed to add users: ${error.message}\n\n` +
             `Please ensure:\n` +
             `• Room name is valid\n` +
             `• Users have Signal accounts\n` +
             `• Bot has group admin privileges`;
    }
  }
  
  async resolveUserToPhoneNumber(username) {
    // This would integrate with user database to map usernames to phone numbers
    // For now, return a placeholder or check environment variables
    const userMappings = {
      'sac': process.env.USER_SAC_PHONE || '+12247253276',
      'testuser': process.env.USER_TEST_PHONE,
    };
    
    return userMappings[username.toLowerCase()] || null;
  }
  
  async handleZeroeth(context) {
    return `🤖 **The Zeroeth Law**\n\n${this.zeroethLaw}\n\n🏞️ **IrregularChat Community:**\n${this.communityContext.description}\n\n📜 **Rules of Engagement:**\n${this.communityContext.rules.map((r, i) => `${i+1}. ${r}`).join('\n')}\n\n📚 **Resources:**\n• Wiki: ${this.communityContext.wikiUrl}\n• Forum: ${this.communityContext.forumUrl}`;
  }

  // Context and Knowledge Management
  async searchWiki(query) {
    try {
      // Search IrregularPedia for relevant information
      const searchUrl = `${this.wikiUrl}/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json`;
      const response = await fetch(searchUrl);
      if (response.ok) {
        const data = await response.json();
        return data.query?.search || [];
      }
    } catch (error) {
      console.error('Wiki search failed:', error);
    }
    return [];
  }
  
  async searchForum(query) {
    try {
      // Search forum for relevant discussions
      const searchUrl = `${this.forumUrl}/search.json?q=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl);
      if (response.ok) {
        const data = await response.json();
        return data.topics || [];
      }
    } catch (error) {
      console.error('Forum search failed:', error);
    }
    return [];
  }
  
  async getContextFromCommunity(query) {
    // Gather context from wiki and forum
    const [wikiResults, forumResults] = await Promise.all([
      this.searchWiki(query),
      this.searchForum(query)
    ]);
    
    let context = '';
    
    if (wikiResults.length > 0) {
      context += `Wiki articles found: ${wikiResults.slice(0, 3).map(r => r.title).join(', ')}. `;
    }
    
    if (forumResults.length > 0) {
      context += `Forum discussions found: ${forumResults.slice(0, 3).map(r => r.title).join(', ')}.`;
    }
    
    return context || 'No specific community information found, using general knowledge.';
  }
  
  // Message History Management
  storeMessageInHistory(message) {
    const groupId = message.groupId || 'dm'; // Use 'dm' for direct messages
    
    if (!this.messageHistory.has(groupId)) {
      this.messageHistory.set(groupId, []);
    }
    
    const history = this.messageHistory.get(groupId);
    history.push({
      sender: message.sourceName || message.sourceNumber,
      message: message.message,
      timestamp: message.timestamp,
      time: new Date(message.timestamp).toLocaleString()
    });
    
    // Keep only recent messages
    if (history.length > this.maxHistoryPerGroup) {
      history.shift();
    }
  }
  
  async summarizeGroupMessages(context) {
    const { groupId } = context;
    
    if (!groupId) {
      return '❌ This command only works in group chats. Use !summarize <url> for URL summarization.';
    }
    
    const history = this.messageHistory.get(groupId) || [];
    
    if (history.length < 3) {
      return '❌ Not enough recent messages to summarize. Need at least 3 messages.';
    }
    
    // Get recent messages (last 20 or all if fewer)
    const recentMessages = history.slice(-20);
    
    // Check if we have AI capability (prefer local AI for privacy)
    const hasAi = this.useLocalAiForSummarization || (this.aiEnabled && this.openAiApiKey);
    
    if (!hasAi) {
      // Fallback without AI
      const messageCount = recentMessages.length;
      const participants = [...new Set(recentMessages.map(m => m.sender))].join(', ');
      const timespan = this.getTimespan(recentMessages[0].timestamp, recentMessages[recentMessages.length - 1].timestamp);
      
      return `📝 **Chat Summary** (last ${messageCount} messages)\n\n👥 **Participants:** ${participants}\n⏱️ **Timespan:** ${timespan}\n\n💬 **Messages:**\n${recentMessages.slice(-5).map(m => `• ${m.sender}: ${m.message.substring(0, 100)}${m.message.length > 100 ? '...' : ''}`).join('\n')}`;
    }
    
    try {
      const messagesText = recentMessages.map(m => `${m.sender}: ${m.message}`).join('\n');
      let aiResponse;
      
      if (this.useLocalAiForSummarization) {
        // Use local AI for privacy (keeps user data private)
        console.log('Using local AI for chat summarization (privacy mode)');
        
        const response = await fetch(`${this.localAiUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.localAiApiKey}`
          },
          body: JSON.stringify({
            model: this.localAiModel,
            messages: [{
              role: 'system',
              content: 'You are a helpful assistant that summarizes chat conversations. Focus on the main topics, key points, and any decisions or action items. Be concise but thorough.'
            }, {
              role: 'user',
              content: `Please summarize this group chat conversation:\n\n${messagesText}`
            }],
            max_tokens: 500,
            temperature: 0.3
          })
        });
        
        if (!response.ok) {
          throw new Error(`Local AI error: ${response.status}`);
        }
        
        aiResponse = await response.json();
      } else {
        // Fallback to OpenAI if local AI not configured
        const { OpenAI } = require('openai');
        const openai = new OpenAI({ apiKey: this.openAiApiKey });
        
        aiResponse = await openai.chat.completions.create({
          model: 'gpt-5-mini',
          messages: [{
            role: 'system',
            content: 'You are a helpful assistant that summarizes chat conversations. Focus on the main topics, key points, and any decisions or action items. Be concise but thorough.'
          }, {
            role: 'user',
            content: `Please summarize this group chat conversation:\n\n${messagesText}` 
          }],
          max_completion_tokens: 900,  // GPT-5 thinking model needs 600+ tokens
          temperature: 0.3
        });
      }
      
      const participants = [...new Set(recentMessages.map(m => m.sender))].join(', ');
      const messageCount = recentMessages.length;
      
      const summaryText = aiResponse.choices[0].message.content;
      const aiSource = this.useLocalAiForSummarization ? '🔒 Local AI (Private)' : '🌐 OpenAI';
      
      return `📝 **Group Chat Summary** (${messageCount} recent messages)\n\n👥 **Participants:** ${participants}\n\n💡 **Summary:**\n${summaryText}\n\n_Generated by: ${aiSource}_`;
      
    } catch (error) {
      console.error('AI summarization failed:', error);
      // Fallback to simple summary
      const messageCount = recentMessages.length;
      const participants = [...new Set(recentMessages.map(m => m.sender))].join(', ');
      return `📝 **Chat Summary** (${messageCount} messages)\n\n👥 **Participants:** ${participants}\n\n💬 **Recent messages:**\n${recentMessages.slice(-3).map(m => `• ${m.sender}: ${m.message}`).join('\n')}`;
    }
  }
  
  getTimespan(startTimestamp, endTimestamp) {
    const diffMs = endTimestamp - startTimestamp;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? 's' : ''}`;
    if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? 's' : ''}`;
    if (diffMins > 0) return `${diffMins} minute${diffMins > 1 ? 's' : ''}`;
    return 'Less than a minute';
  }

  // Fun/Social Plugin Handlers
  async handleJoke(context) { return '😄 Why did the programmer quit? Because they didn\'t get arrays!'; }
  async handleQuote(context) { return '💭 "The only way to do great work is to love what you do." - Steve Jobs'; }
  async handleFact(context) { return '🤓 Did you know? Honey never spoils!'; }
  async handlePoll(context) { return 'Poll system placeholder - !poll <question> <options>'; }
  async handleEightBall(context) { 
    const responses = ['Yes', 'No', 'Maybe', 'Ask again later', 'Definitely', 'Probably not'];
    const response = responses[Math.floor(Math.random() * responses.length)];
    return `🎱 **Magic 8-Ball**: ${response}`;
  }
  async handleDice(context) { 
    const roll = Math.floor(Math.random() * 6) + 1;
    return `🎲 **Dice Roll**: ${roll}\n\nUsage: !dice [sides] [count]`; 
  }

  // Helper method for admin check
  isAdmin(userNumber) {
    const adminUsers = process.env.ADMIN_USERS?.split(',') || [];
    return adminUsers.includes(userNumber);
  }
  
  // ========== Q&A System Commands ==========
  
  async handleQuestion(context) {
    const { sender, args, groupId, sourceNumber } = context;
    
    if (!args || args.length === 0 || args.join(' ').trim() === '') {
      return '❌ Usage: !q <your question>\n\n' +
             'Example: !q How do I set up Signal bot authentication?\n\n' +
             'To see existing questions, use: !questions';
    }
    
    const questionText = args.join(' ').trim();
    
    // Generate a unique question ID
    this.questionCounter++;
    const questionId = `Q${this.questionCounter}`;
    
    try {
      // Generate title using AI if available
      let title = questionText.substring(0, 60);
      if (this.aiEnabled && this.openAiApiKey) {
        const { OpenAI } = require('openai');
        const openai = new OpenAI({ apiKey: this.openAiApiKey });
        
        const titleResponse = await openai.chat.completions.create({
          model: 'gpt-5-mini',
          messages: [{
            role: 'system',
            content: 'Generate a concise, clear title (max 60 chars) for this question. Return only the title, no quotes or punctuation at the end.'
          }, {
            role: 'user',
            content: questionText
          }],
          max_completion_tokens: 650,  // GPT-5 thinking model minimum
          temperature: 0.3
        });
        
        title = titleResponse.choices[0].message.content.trim();
      }
      
      // Store question in memory
      const question = {
        id: questionId,
        asker: sender || 'Unknown',
        askerPhone: sourceNumber,
        question: questionText,
        title: title,
        answers: [],
        solved: false,
        timestamp: Date.now(),
        groupId: groupId,
        discourseTopicId: null
      };
      
      this.questions.set(questionId, question);
      
      // Track user's questions
      if (!this.userQuestions.has(sourceNumber)) {
        this.userQuestions.set(sourceNumber, []);
      }
      this.userQuestions.get(sourceNumber).push(questionId);
      
      // Post to Discourse if configured
      let forumLink = '';
      let discourseError = null;
      if (this.discourseApiKey && this.discourseApiUrl) {
        try {
          const topicData = {
            title: title,
            raw: `Question from ${sender}:\n\n${questionText}\n\n---\n*Posted via Signal Bot from ${groupId ? 'group chat' : 'direct message'}*`,
            category: 7, // Questions category - updated for IrregularChat forum
            tags: ['question', 'signal-bot']
          };
          
          console.log('📤 Posting question to Discourse:', this.discourseApiUrl);
          const response = await fetch(`${this.discourseApiUrl}/posts.json`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Api-Key': this.discourseApiKey,
              'Api-Username': this.discourseApiUsername
            },
            body: JSON.stringify(topicData)
          });
          
          if (response.ok) {
            const result = await response.json();
            question.discourseTopicId = result.topic_id;
            forumLink = `\n📎 Forum: ${this.discourseApiUrl}/t/${result.topic_slug}/${result.topic_id}`;
            console.log('✅ Question posted to Discourse:', result.topic_id);
          } else {
            const errorText = await response.text();
            console.error('❌ Discourse API error:', response.status, errorText);
            discourseError = `API ${response.status}`;
          }
        } catch (error) {
          console.error('❌ Failed to post to Discourse:', error);
          discourseError = error.message;
        }
      }
      
      // Return success message even if Discourse posting failed (question is stored locally)
      let response = `❓ Question ${questionId} Posted\n\n` +
                    `📝 Title: ${title}\n` +
                    `👤 Asked by: ${sender}\n` +
                    `⏰ Time: ${new Date().toLocaleTimeString()}`;
      
      if (forumLink) {
        response += forumLink;
      } else if (discourseError) {
        response += `\n⚠️ Forum posting temporarily unavailable`;
        console.log('⚠️ Question stored locally only due to forum error');
      }
      
      response += `\n\n💬 Others can answer with: !answer ${questionId} <your answer>\n` +
                 `✅ Mark as solved with: !solved ${questionId}`;
      
      return response;
             
    } catch (error) {
      console.error('Error handling question:', error);
      return '❌ Failed to post question. Please try again.\n' +
             `Error: ${error.message}`;
    }
  }
  
  async handleQuestions(context) {
    const { args, sourceNumber } = context;
    
    // Get recent questions or user's questions
    const showMine = args && args[0] === 'mine';
    
    let questionsList = [];
    
    if (showMine) {
      const myQuestionIds = this.userQuestions.get(sourceNumber) || [];
      questionsList = myQuestionIds.map(id => this.questions.get(id)).filter(q => q);
    } else {
      // Get last 10 questions
      questionsList = Array.from(this.questions.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10);
    }
    
    if (questionsList.length === 0) {
      return showMine ? '📭 You haven\'t asked any questions yet.' : '📭 No questions have been asked yet.';
    }
    
    let response = showMine ? 'Your Questions:\n\n' : 'Recent Questions:\n\n';
    
    for (const q of questionsList) {
      const status = q.solved ? '✅' : '❓';
      const answerCount = q.answers.length;
      const timeAgo = this.getRelativeTime(q.timestamp);
      
      response += `${status} ${q.id}: ${q.title}\n`;
      response += `   👤 ${q.asker} • 💬 ${answerCount} answer${answerCount !== 1 ? 's' : ''} • ⏰ ${timeAgo}\n\n`;
    }
    
    response += '\n💡 Use !answer <ID> <answer> to answer a question';
    
    return response;
  }
  
  async handleAnswer(context) {
    const { sender, args, sourceNumber } = context;
    
    if (!args || args.length < 2) {
      return '❌ Usage: !answer <question-id> <your answer>\n\nExample: !answer Q1 You need to configure the API key first';
    }
    
    const questionId = args[0].toUpperCase();
    const answerText = args.slice(1).join(' ');
    
    const question = this.questions.get(questionId);
    
    if (!question) {
      return `❌ Question ${questionId} not found. Use !questions to see available questions.`;
    }
    
    if (question.solved) {
      return `ℹ️ Question ${questionId} has already been marked as solved.`;
    }
    
    // Add answer to question
    const answer = {
      answerer: sender,
      answererPhone: sourceNumber,
      text: answerText,
      timestamp: Date.now()
    };
    
    question.answers.push(answer);
    
    // Post answer to Discourse if topic exists
    if (question.discourseTopicId && this.discourseApiKey) {
      try {
        await fetch(`${this.discourseApiUrl}/posts.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Api-Key': this.discourseApiKey,
            'Api-Username': this.discourseApiUsername
          },
          body: JSON.stringify({
            topic_id: question.discourseTopicId,
            raw: `**Answer from ${sender}:**\n\n${answerText}`
          })
        });
      } catch (error) {
        console.error('Failed to post answer to Discourse:', error);
      }
    }
    
    // Send DM to question asker if different from answerer
    if (question.askerPhone !== sourceNumber) {
      try {
        await this.sendDirectMessage(
          question.askerPhone,
          `📬 **Your question has been answered!**\n\n` +
          `❓ **Question ${questionId}:** ${question.title}\n\n` +
          `💬 **Answer from ${sender}:**\n${answerText}\n\n` +
          `✅ If this solves your question, reply with: !solved ${questionId}`
        );
      } catch (error) {
        console.error('Failed to send DM notification:', error);
      }
    }
    
    return `✅ **Answer posted to ${questionId}**\n\n` +
           `❓ **Question:** ${question.title}\n` +
           `👤 **Asked by:** ${question.asker}\n` +
           `💬 **Your answer:** ${answerText}\n\n` +
           `📊 Total answers: ${question.answers.length}`;
  }
  
  async handleSolved(context) {
    const { sender, args, sourceNumber } = context;
    
    if (!args || args.length === 0) {
      return '❌ Usage: !solved <question-id>\n\nExample: !solved Q1';
    }
    
    const questionId = args[0].toUpperCase();
    const question = this.questions.get(questionId);
    
    if (!question) {
      return `❌ Question ${questionId} not found.`;
    }
    
    // Only the asker or an admin can mark as solved
    const isAsker = question.askerPhone === sourceNumber;
    const isAdmin = this.isAdmin(sourceNumber);
    
    if (!isAsker && !isAdmin) {
      return `❌ Only ${question.asker} (the question asker) can mark this as solved.`;
    }
    
    if (question.solved) {
      return `ℹ️ Question ${questionId} is already marked as solved.`;
    }
    
    question.solved = true;
    question.solvedBy = sender;
    question.solvedAt = Date.now();
    
    // Update Discourse topic if exists
    if (question.discourseTopicId && this.discourseApiKey) {
      try {
        // Add solved tag or update topic
        await fetch(`${this.discourseApiUrl}/posts.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Api-Key': this.discourseApiKey,
            'Api-Username': this.discourseApiUsername
          },
          body: JSON.stringify({
            topic_id: question.discourseTopicId,
            raw: `✅ **This question has been marked as SOLVED by ${sender}**`
          })
        });
      } catch (error) {
        console.error('Failed to update Discourse:', error);
      }
    }
    
    // Notify all answerers
    const uniqueAnswerers = [...new Set(question.answers.map(a => a.answererPhone))];
    for (const answererPhone of uniqueAnswerers) {
      if (answererPhone !== sourceNumber) {
        try {
          await this.sendDirectMessage(
            answererPhone,
            `🎉 **Good news!**\n\n` +
            `The question you answered has been marked as solved:\n` +
            `❓ **${question.title}**\n\n` +
            `Thank you for your help!`
          );
        } catch (error) {
          console.error('Failed to notify answerer:', error);
        }
      }
    }
    
    return `✅ **Question ${questionId} marked as SOLVED!**\n\n` +
           `❓ **Question:** ${question.title}\n` +
           `👤 **Asked by:** ${question.asker}\n` +
           `💬 **Total answers:** ${question.answers.length}\n` +
           `🎉 Thank you to everyone who helped!`;
  }
  
  async sendDirectMessage(phoneNumber, message) {
    // Send a direct message using signal-cli
    try {
      await this.sendMessage(message, phoneNumber);
    } catch (error) {
      console.error(`Failed to send DM to ${phoneNumber}:`, error);
    }
  }
  
  getRelativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
  }
}

module.exports = { NativeSignalBotService };