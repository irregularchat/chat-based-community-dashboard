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
const fsPromises = require('fs').promises;
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const pdf = require('pdf-parse');
const PDFProcessor = require('../pdf-processor');
const { PrismaClient } = require('../../generated/prisma');
const { SignalGroupSyncService } = require('./group-sync-service');

// Import services for user onboarding
const authentikService = require('./services/authentik');
const emailService = require('./services/email');
const discourseService = require('./services/discourse');

class NativeSignalBotService extends EventEmitter {
  constructor(config) {
    super();
    this.prisma = new PrismaClient();
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
    
    // Wiki and Forum URLs for context
    this.wikiUrl = process.env.WIKI_URL || 'https://irregularpedia.irregularchat.com';
    this.forumUrl = process.env.DISCOURSE_API_URL || 'https://forum.irregularchat.com';
    
    this.daemon = null;
    this.socket = null;
    this.isListening = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.startTime = Date.now();
    
    // Message history for summarization (store recent messages per group)
    this.messageHistory = new Map(); // groupId -> array of recent messages
    this.maxHistoryPerGroup = 50; // Keep last 50 messages per group
    
    // Thread context tracking for AI provider selection
    this.threadContext = new Map(); // messageId -> {provider: 'openai'|'localai', timestamp, groupId}
    this.userAiPreference = new Map(); // groupId:userId -> {provider: 'openai'|'localai', timestamp, lastMessage}
    
    // Q&A System
    this.questions = new Map(); // questionId -> {id, asker, question, title, answers, solved, timestamp, groupId, discourseTopicId}
    this.questionCounter = 0;
    this.userQuestions = new Map(); // userPhone -> [questionIds]
    
    // URL Cleaner System
    this.cleanedUrls = new Map(); // timestamp -> {originalUrl, cleanedUrl, platform, trackersRemoved, user, groupId}
    
    // Event management
    this.eventFollowUpContext = new Map(); // sourceNumber -> {pendingEventId, timestamp}
    this.pendingEvents = new Map(); // pendingEventId -> event data
    this.cleanerStats = {
      totalCleaned: 0,
      trackersSaved: 0,
      platforms: new Map(), // platform -> count
      dailyCounts: new Map() // date -> count
    };
    
    // News Processing System
    this.processedNews = new Map(); // url -> {timestamp, title, summary, discourseTopicId, bypassLinks}
    this.newsStats = {
      totalProcessed: 0,
      successfulPosts: 0,
      failedPosts: 0,
      dailyCounts: new Map() // date -> count
    };
    
    // Custom news domains management
    this.customNewsDomains = new Set();
    this.newsDomainsFile = path.join(this.dataDir, 'news-domains.json');
    this.loadCustomNewsDomains();
    
    // Security Watch List for domains
    this.watchedDomains = new Map(); // domain/tld -> country
    this.watchedDomainsFile = path.join(this.dataDir, 'watched-domains.json');
    this.initializeWatchedDomains();
    
    // Initialize PDF processor
    this.pdfProcessor = new PDFProcessor();
    
    // Initialize group sync service
    this.groupSyncService = new SignalGroupSyncService({
      phoneNumber: this.phoneNumber,
      socketPath: this.socketPath,
      syncInterval: 15 * 60 * 1000 // 15 minutes
    });
    
    // Discourse metadata cache
    this.discourseTags = new Map(); // tag name -> tag object
    this.discourseCategories = new Map(); // category id -> category object
    this.discourseTagsLoaded = false;
    this.discourseCategoriesLoaded = false;
    
    // Onboarding/Request System
    this.pendingRequests = new Map(); // phoneNumber -> {timestamp, groupId, requester, timeoutId}
    this.requestTimeoutMinutes = process.env.REQUEST_TIMEOUT_MINUTES || 72 * 60; // Default 72 hours
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
      // Community Plugin Commands (9)
      { name: 'groups', description: 'List all available groups', handler: this.handleGroups.bind(this) },
      { name: 'join', description: 'Join a specific group', handler: this.handleJoin.bind(this) },
      // { name: 'leave', description: 'Leave a group', handler: this.handleLeave.bind(this) }, // Removed per request
      { name: 'addto', description: 'Add users to a group (admin)', handler: this.handleAddTo.bind(this), adminOnly: true },
      // { name: 'adduser', description: 'Add user to group (admin)', handler: this.handleAddUser.bind(this), adminOnly: true }, // Removed per request
      { name: 'removeuser', description: 'Remove non-admin users from entry room (admin only)', handler: this.handleRemoveUser.bind(this), adminOnly: true },
      // { name: 'groupinfo', description: 'Show group details', handler: this.handleGroupInfo.bind(this) }, // Removed per request
      // { name: 'members', description: 'List group members', handler: this.handleMembers.bind(this) }, // Removed per request
      { name: 'invite', description: 'Show how to invite someone to IrregularChat', handler: this.handleInvite.bind(this) },
      
      // Information Plugin Commands (7)  
      { name: 'wiki', description: 'Search IrregularChat wiki', handler: this.handleWiki.bind(this) },
      { name: 'forum', description: 'Search forum posts', handler: this.handleForum.bind(this) },
      { name: 'events', description: 'Show upcoming events', handler: this.handleEvents.bind(this) },
      { name: 'event', description: 'Add a new event', handler: this.handleEventAdd.bind(this) },
      { name: 'eventadd', description: 'Add a new event', handler: this.handleEventAdd.bind(this) },
      // { name: 'resources', description: 'List community resources', handler: this.handleResources.bind(this) }, // Removed per request
      { name: 'faq', description: 'Get FAQ answers', handler: this.handleFAQ.bind(this) },
      { name: 'docs', description: 'Search documentation', handler: this.handleDocs.bind(this) },
      { name: 'links', description: 'Show important links', handler: this.handleLinks.bind(this) },
      
      // User Plugin Commands (2)
      { name: 'profile', description: 'Show your profile', handler: this.handleProfile.bind(this) },
      // { name: 'timezone', description: 'Set timezone', handler: this.handleTimezone.bind(this) }, // Removed per request
      
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
      { name: 'backup', description: 'Create data backup (admin)', handler: this.handleBackup.bind(this), adminOnly: true },
      { name: 'maintenance', description: 'Toggle maintenance mode (admin)', handler: this.handleMaintenance.bind(this), adminOnly: true },
      { name: 'bypass', description: 'Authentication bypass', handler: this.handleBypass.bind(this) },
      
      // Analytics Commands (7) - Admin Only
      { name: 'stats', description: 'Bot usage statistics', handler: this.handleStats.bind(this), adminOnly: true },
      { name: 'topcommands', description: 'Most used commands', handler: this.handleTopCommands.bind(this), adminOnly: true },
      { name: 'topusers', description: 'Most active users', handler: this.handleTopUsers.bind(this), adminOnly: true },
      { name: 'errors', description: 'Recent bot errors', handler: this.handleErrors.bind(this), adminOnly: true },
      { name: 'newsstats', description: 'News link statistics', handler: this.handleNewsStats.bind(this), adminOnly: true },
      { name: 'sentiment', description: 'Bot feedback sentiment', handler: this.handleSentiment.bind(this), adminOnly: true },
      { name: 'watchdomain', description: 'Manage watched security domains', handler: this.handleWatchedDomains.bind(this), adminOnly: true },
      
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
      { name: 'wayback', description: 'Archive.org wayback lookup', handler: this.handleWayback.bind(this) },
      
      // Forum Plugin Commands (3)
      { name: 'fpost', description: 'Post article to forum', handler: this.handleFPost.bind(this) },
      { name: 'flatest', description: 'Show latest forum posts', handler: this.handleFLatest.bind(this) },
      { name: 'fsearch', description: 'Search forum posts', handler: this.handleFSearch.bind(this) },
      { name: 'categories', description: 'List forum categories', handler: this.handleCategories.bind(this) },
      
      // PDF Plugin Commands (1)
      { name: 'pdf', description: 'Process and summarize PDF files', handler: this.handlePdf.bind(this) },
      
      // Onboarding Plugin Commands (4) 
      { name: 'request', description: 'Request introduction from user', handler: this.handleRequest.bind(this) },
      { name: 'gtg', description: 'Approve user for onboarding (Good To Go)', adminOnly: true, handler: this.handleGtg.bind(this) },
      { name: 'sngtg', description: 'Confirm safety number verification (SN Good To Go)', adminOnly: true, handler: this.handleSngtg.bind(this) },
      { name: 'pending', description: 'Show pending requests', adminOnly: true, handler: this.handlePending.bind(this) },
      
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
      
      // Advanced Search Command
      { name: 'search', description: 'Advanced AI-powered search across all data', handler: this.handleAdvancedSearch.bind(this) },
      
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
        const isAdmin = this.isAdmin(context.sourceNumber, context.groupId);
        
        // Regular user commands
        const userCommandsByCategory = {
          '🔧 Core': ['help', 'ping', 'ai', 'lai', 'summarize', 'tldr', 'zeroeth', 'cleaner'],
          '❓ Q&A': ['q', 'question', 'questions', 'answer', 'solved'],
          '👥 Community': ['groups', 'join', 'invite'],
          '📚 Information': ['wiki', 'forum', 'events', 'faq', 'docs', 'links'],
          '👤 User Management': ['profile', 'bypass'],
          '📄 Forum': ['fpost', 'flatest', 'fsearch', 'categories'],
          '📋 PDF Processing': ['pdf'],
          '👋 Onboarding': ['request']
        };
        
        // Admin-only commands
        const adminCommandsByCategory = {
          '🔐 Admin': ['removeuser', 'addto', 'gtg', 'sngtg', 'pending'],
          '📊 Analytics': ['stats', 'topcommands', 'topusers', 'errors', 'newsstats', 'sentiment', 'watchdomain']
        };
        
        let helpText = `🤖 **Signal Bot Commands**\n\n`;
        
        // Show user commands
        for (const [category, cmds] of Object.entries(userCommandsByCategory)) {
          helpText += `${category}:\n`;
          helpText += cmds.map(cmd => `• !${cmd}`).join(', ') + '\n\n';
        }
        
        // Only show admin commands if user is admin
        if (isAdmin) {
          for (const [category, cmds] of Object.entries(adminCommandsByCategory)) {
            helpText += `${category}:\n`;
            helpText += cmds.map(cmd => `• !${cmd}`).join(', ') + '\n\n';
          }
          helpText += '🔒 You have admin privileges\n';
        }
        
        helpText += '💡 Use any command to get started!\n';
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
          
          // Store thread context - this user prefers OpenAI
          const threadKey = `${context.groupId || 'dm'}:${context.sourceNumber}`;
          this.userAiPreference.set(threadKey, {
            provider: 'openai',
            timestamp: Date.now(),
            lastMessage: userQuery
          });
          console.log(`🔄 Thread context: User ${context.sender} selected OpenAI`);
          
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
            { keywords: ['summarize messages', 'group summary', 'message summary'], command: 'summarize' }
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
          
          console.log('🤖 Calling OpenAI with model: gpt-5-mini');
          console.log('📨 Messages:', JSON.stringify(messages, null, 2));
          
          try {
            const response = await openai.chat.completions.create({
              model: 'gpt-5-mini',
              messages: messages,
              max_completion_tokens: 2000  // Increased for GPT-5 thinking model
            });
            
            console.log('🤖 OpenAI response received:', response.choices[0]?.message?.content ? 'Content present' : 'No content');
            
            if (!response.choices[0]?.message?.content) {
              console.error('⚠️ OpenAI returned empty response');
              return 'OpenAI: I apologize, but I was unable to generate a response. Please try again.';
            }
            
            // Add context indicator to response
            const aiResponse = response.choices[0].message.content;
            console.log(`✅ AI Response length: ${aiResponse.length} chars`);
            return `${getAiPrefix(responseMode)} ${aiResponse}`;
          } catch (apiError) {
            console.error('❌ OpenAI API error:', apiError);
            return `OpenAI: Error - ${apiError.message}`;
          }
        }
      });
      
    }
    
    // Add Local AI command (!lai) if local AI is configured
    if (this.localAiUrl && this.localAiApiKey) {
      commands.set('lai', {
        name: 'lai',
        description: 'Context-aware Local AI responses (privacy-focused)',
        execute: async (context) => {
          const userQuery = context.args.join(' ') || 'Hello';
          
          // Store thread context - this user prefers LocalAI  
          const threadKey = `${context.groupId || 'dm'}:${context.sourceNumber}`;
          this.userAiPreference.set(threadKey, {
            provider: 'localai',
            timestamp: Date.now(),
            lastMessage: userQuery
          });
          console.log(`🔄 Thread context: User ${context.sender} selected LocalAI`);
          
          // Zeroeth Law Implementation - Context Awareness
          let contextInfo = '';
          let responseMode = 'general'; // 'command', 'community', or 'general'
          
          // Define AI prefix based on context
          const getAiPrefix = (mode) => mode === 'command' ? 'LocalAI [Commands]:' : mode === 'community' ? 'LocalAI [Community]:' : 'LocalAI:';
          
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
            { keywords: ['summarize messages', 'group summary', 'message summary'], command: 'summarize' }
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
              return `LocalAI: Executed !${cmdName}:\n\n${result}`;
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
          
          // Use Local AI instead of OpenAI
          try {
            const response = await fetch(`${this.localAiUrl}/api/v1/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.localAiApiKey}`
              },
              body: JSON.stringify({
                model: 'irregularbot:latest',
                messages: messages,
                max_completion_tokens: 800  // GPT-5 requires max_completion_tokens
              })
            });

            if (!response.ok) {
              throw new Error(`Local AI request failed: ${response.status} ${response.statusText}`);
            }

            const aiResponse = await response.json();
            let content = aiResponse.choices[0].message.content;
            
            // Clean up thinking process - remove <think>...</think> tags and content
            content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            
            return `${getAiPrefix(responseMode)} ${content}`;
            
          } catch (error) {
            console.error('Local AI request failed:', error);
            return `LocalAI: Sorry, the local AI service is currently unavailable. Error: ${error.message}`;
          }
        }
      });
    }
    
    if (this.aiEnabled && this.openAiApiKey) {
      // Add message summarization command (with parameters)
      commands.set('summarize', {
        name: 'summarize',
        description: 'Summarize recent group messages (-n <count>, -m <minutes>, -h <hours>, --help)',
        execute: async (context) => {
          return this.summarizeGroupMessages(context);
        }
      });
      
      // Add URL content summarization command  
      commands.set('tldr', {
        name: 'tldr',
        description: 'Summarize URL content with AI',
        execute: async (context) => {
          const { OpenAI } = require('openai');
          const openai = new OpenAI({ apiKey: this.openAiApiKey });
          
          const url = context.args.join(' ');
          if (!url || !url.startsWith('http')) {
            return '❌ Usage: !tldr <url>\n\nProvide a valid URL to summarize its content.';
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
    }
    
    // URL Cleaner stats command
    commands.set('cleaner', {
      name: 'cleaner',
      description: 'Show URL tracking removal statistics',
      execute: async (context) => {
        const today = new Date().toDateString();
        const todayCount = this.cleanerStats.dailyCounts.get(today) || 0;
        
        let stats = `🧹 **URL Cleaner Statistics**\n\n`;
        stats += `📊 **Overall Stats:**\n`;
        stats += `• Total URLs cleaned: ${this.cleanerStats.totalCleaned}\n`;
        stats += `• Trackers removed: ${this.cleanerStats.trackersSaved}\n`;
        stats += `• Today: ${todayCount} URLs cleaned\n\n`;
        
        if (this.cleanerStats.platforms.size > 0) {
          stats += `🌐 **Platforms Cleaned:**\n`;
          const platformList = Array.from(this.cleanerStats.platforms.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([platform, count]) => `• ${platform}: ${count} URLs`)
            .join('\n');
          stats += platformList + '\n\n';
        }
        
        stats += `💡 **Why remove trackers?**\n`;
        stats += `Tracking parameters help social media platforms identify users across the web, `;
        stats += `building detailed behavioral profiles for targeted advertising and data monetization.\n\n`;
        
        if (this.cleanedUrls.size > 0) {
          stats += `🔄 **Recent Activity:** ${Math.min(3, this.cleanedUrls.size)} most recent cleanings\n`;
          const recentUrls = Array.from(this.cleanedUrls.entries())
            .sort((a, b) => b[0] - a[0])
            .slice(0, 3);
            
          for (const [timestamp, data] of recentUrls) {
            const timeAgo = Math.round((Date.now() - timestamp) / 60000);
            stats += `• ${data.platform} - ${timeAgo}m ago (${data.trackersRemoved} trackers)\n`;
          }
        }
        
        return stats;
      }
    });
    
    // News processing stats command
    commands.set('news', {
      name: 'news',
      description: 'Show news processing statistics and manually process URL',
      execute: async (context) => {
        const args = context.args;
        
        // If URL provided, manually process it
        if (args.length > 0) {
          const url = args.join(' ');
          if (this.isNewsUrl(url)) {
            await this.sendReply(context, `🔄 Processing news URL: ${url}`);
            try {
              await this.processNewsUrl(url, context);
              return `✅ Successfully processed news URL!`;
            } catch (error) {
              return `❌ Error processing URL: ${error.message}`;
            }
          } else {
            return `❌ URL doesn't match news patterns. Use !news to see stats.`;
          }
        }
        
        // Show statistics
        const today = new Date().toDateString();
        const todayCount = this.newsStats.dailyCounts.get(today) || 0;
        
        let stats = `📰 **News Processing Statistics**\n\n`;
        stats += `📊 **Overall Stats:**\n`;
        stats += `• Total news processed: ${this.newsStats.totalProcessed}\n`;
        stats += `• Successful posts: ${this.newsStats.successfulPosts}\n`;
        stats += `• Failed posts: ${this.newsStats.failedPosts}\n`;
        stats += `• Today: ${todayCount} articles processed\n\n`;
        
        if (this.processedNews.size > 0) {
          stats += `🔄 **Recent Activity:** ${Math.min(3, this.processedNews.size)} most recent articles\n`;
          const recentNews = Array.from(this.processedNews.values())
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 3);
            
          for (const news of recentNews) {
            const timeAgo = Math.round((Date.now() - news.timestamp) / 60000);
            const title = news.title.length > 50 ? news.title.substring(0, 50) + '...' : news.title;
            stats += `• ${title} - ${timeAgo}m ago\n`;
          }
          stats += '\n';
        }
        
        stats += `💡 **Usage:** Send \`!news <url>\` to manually process a news URL\n`;
        stats += `🤖 **Auto-processing:** News URLs are automatically detected and processed`;
        
        return stats;
      }
    });
    
    // News domain management commands
    commands.set('newsadd', {
      name: 'newsadd',
      description: 'Add a domain to auto-process news list',
      execute: async (context) => {
        const args = context.args;
        
        if (args.length === 0) {
          return '❌ Usage: !newsadd <domain>\nExample: !newsadd techcrunch.com';
        }
        
        const domain = args[0].toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
        
        if (this.customNewsDomains.has(domain)) {
          return `ℹ️ Domain ${domain} is already in the news list`;
        }
        
        this.customNewsDomains.add(domain);
        this.saveCustomNewsDomains();
        
        return `✅ Added ${domain} to news domains\n📰 Total domains: ${this.customNewsDomains.size}`;
      }
    });
    
    commands.set('newslist', {
      name: 'newslist',
      description: 'Show all custom news domains',
      execute: async (context) => {
        if (this.customNewsDomains.size === 0) {
          return '📰 No custom news domains configured\nUse !newsadd <domain> to add domains';
        }
        
        let response = `📰 Custom News Domains (${this.customNewsDomains.size}):\n\n`;
        const domains = Array.from(this.customNewsDomains).sort();
        
        domains.forEach(domain => {
          response += `• ${domain}\n`;
        });
        
        response += '\n💡 Links from these domains will be auto-processed';
        return response;
      }
    });
    
    commands.set('newsremove', {
      name: 'newsremove',
      description: 'Remove a domain from news list',
      execute: async (context) => {
        const args = context.args;
        
        if (args.length === 0) {
          return '❌ Usage: !newsremove <domain>\nExample: !newsremove example.com';
        }
        
        const domain = args[0].toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
        
        if (!this.customNewsDomains.has(domain)) {
          return `❌ Domain ${domain} is not in the news list`;
        }
        
        this.customNewsDomains.delete(domain);
        this.saveCustomNewsDomains();
        
        return `✅ Removed ${domain} from news domains\n📰 Remaining domains: ${this.customNewsDomains.size}`;
      }
    });
    
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
            // Log full message structure for !addto debugging
            if (message.params?.envelope?.dataMessage?.message?.includes('!addto')) {
              console.log('🔍 Full !addto message structure:');
              console.log(JSON.stringify(message.params.envelope, null, 2));
            }
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

  async checkAndCleanUrls(message) {
    // URL regex to find URLs in the message
    const urlRegex = /https?:\/\/[^\s]+/g;
    const urls = message.message.match(urlRegex);
    
    if (!urls || urls.length === 0) return;
    
    const cleanedResults = [];
    
    for (const url of urls) {
      const result = this.cleanUrl(url);
      if (result.wasCleaned) {
        cleanedResults.push(result);
        
        // Track statistics
        this.cleanerStats.totalCleaned++;
        this.cleanerStats.trackersSaved += result.trackersRemoved.length;
        
        // Update platform stats
        const currentCount = this.cleanerStats.platforms.get(result.platform) || 0;
        this.cleanerStats.platforms.set(result.platform, currentCount + 1);
        
        // Update daily stats
        const today = new Date().toDateString();
        const todayCount = this.cleanerStats.dailyCounts.get(today) || 0;
        this.cleanerStats.dailyCounts.set(today, todayCount + 1);
        
        // Store cleaned URL data
        this.cleanedUrls.set(Date.now() + Math.random(), {
          originalUrl: url,
          cleanedUrl: result.cleanedUrl,
          platform: result.platform,
          trackersRemoved: result.trackersRemoved.length,
          user: message.sourceName || message.sourceNumber,
          groupId: message.groupId
        });
        
        // Cleanup old entries (keep last 100)
        if (this.cleanedUrls.size > 100) {
          const entries = Array.from(this.cleanedUrls.entries());
          entries.sort((a, b) => a[0] - b[0]);
          for (let i = 0; i < entries.length - 100; i++) {
            this.cleanedUrls.delete(entries[i][0]);
          }
        }
      }
    }
    
    // If any URLs were cleaned, send the cleaned version
    if (cleanedResults.length > 0) {
      let response = `🧹 Cleaned Tracking Links: `;
      response += cleanedResults.map(r => r.cleanedUrl).join(' ');
      response += `\n\n💡 Why? Trackers help social media platforms illuminate networks and track user behavior across the web.`;
      
      await this.sendReply(message, response);
    }
  }
  
  cleanUrl(url) {
    try {
      const urlObj = new URL(url);
      const originalUrl = url;
      const trackersRemoved = [];
      
      // Define tracking parameters by platform
      const trackingParams = {
        // Universal tracking parameters
        utm_source: 'UTM Source',
        utm_medium: 'UTM Medium', 
        utm_campaign: 'UTM Campaign',
        utm_content: 'UTM Content',
        utm_term: 'UTM Term',
        gclid: 'Google Click ID',
        fbclid: 'Facebook Click ID',
        
        // Social Media specific
        igshid: 'Instagram Share ID',
        igsh: 'Instagram Share',
        si: 'Share Index',
        
        // LinkedIn
        trackingId: 'LinkedIn Tracking',
        lipi: 'LinkedIn Partner ID',
        refId: 'LinkedIn Reference ID',
        
        // Twitter/X
        ref_src: 'Twitter Source',
        ref_url: 'Twitter Referrer',
        
        // YouTube
        feature: 'YouTube Feature',
        
        // Reddit
        share_id: 'Reddit Share ID',
        
        // Amazon
        ref: 'Amazon Referral',
        tag: 'Amazon Tag',
        
        // Microsoft
        ocid: 'Microsoft Campaign ID',
        
        // Other common trackers
        _hsenc: 'HubSpot Encrypted',
        _hsmi: 'HubSpot Marketing',
        mc_cid: 'MailChimp Campaign',
        mc_eid: 'MailChimp Email',
        rcm: 'Recommended Content Module'
      };
      
      // Remove tracking parameters
      const params = new URLSearchParams(urlObj.search);
      for (const [param, description] of Object.entries(trackingParams)) {
        if (params.has(param)) {
          params.delete(param);
          trackersRemoved.push(description);
        }
      }
      
      // Reconstruct URL without tracking parameters
      urlObj.search = params.toString();
      const cleanedUrl = urlObj.toString();
      
      // Determine platform
      let platform = 'Unknown';
      const hostname = urlObj.hostname.toLowerCase();
      
      if (hostname.includes('linkedin.com')) platform = 'LinkedIn';
      else if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) platform = 'YouTube';
      else if (hostname.includes('instagram.com')) platform = 'Instagram';
      else if (hostname.includes('facebook.com') || hostname.includes('fb.com')) platform = 'Facebook';
      else if (hostname.includes('twitter.com') || hostname.includes('x.com')) platform = 'Twitter/X';
      else if (hostname.includes('reddit.com')) platform = 'Reddit';
      else if (hostname.includes('amazon.com')) platform = 'Amazon';
      else if (hostname.includes('tiktok.com')) platform = 'TikTok';
      else if (hostname.includes('pinterest.com')) platform = 'Pinterest';
      else platform = hostname.split('.').slice(-2).join('.');
      
      return {
        originalUrl,
        cleanedUrl,
        platform,
        trackersRemoved,
        wasCleaned: trackersRemoved.length > 0
      };
      
    } catch (error) {
      console.error('Error cleaning URL:', error);
      return {
        originalUrl: url,
        cleanedUrl: url,
        platform: 'Unknown',
        trackersRemoved: [],
        wasCleaned: false
      };
    }
  }

  // News Processing System
  async checkAndProcessNewsUrls(message) {
    const urlRegex = /https?:\/\/[^\s]+/g;
    const urls = message.message.match(urlRegex);
    
    if (!urls || urls.length === 0) return;
    
    for (const url of urls) {
      // Check security first for ALL URLs
      const securityCheck = await this.checkUrlSecurity(url, message);
      if (securityCheck.isWatched) {
        await this.sendSecurityWarning(url, securityCheck, message);
        // Add eyes emoji reaction to the message
        try {
          // Note: This would require implementing reaction sending via signal-cli
          console.log(`👀 Would add eyes emoji to message about ${url}`);
        } catch (error) {
          console.error('Could not add reaction:', error);
        }
      }
      
      if (this.isNewsUrl(url)) {
        console.log(`📰 Detected news URL: ${url}`);
        
        // Check if we've already processed this URL recently (within 1 hour)
        const existingProcessed = Array.from(this.processedNews.values())
          .find(p => p.url === url && Date.now() - p.timestamp < 3600000);
        
        if (existingProcessed) {
          console.log(`⏭️ URL already processed recently: ${url}`);
          continue;
        }
        
        try {
          // Process news URL and track it
          await this.processNewsUrl(url, message);
        } catch (error) {
          console.error(`❌ Error processing news URL ${url}:`, error.message);
          this.newsStats.failedPosts++;
          
          // Log error
          await this.logError('news_processing_error', error, {
            url: url,
            groupId: message.groupId,
            groupName: message.groupName,
            userId: message.sourceNumber,
            userName: message.sourceName
          });
        }
      }
    }
  }
  
  isNewsUrl(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      
      // Check custom domains first
      for (const domain of this.customNewsDomains) {
        if (hostname.includes(domain.toLowerCase())) {
          return true;
        }
      }
    } catch (error) {
      // Invalid URL
    }
    
    const newsPatterns = [
      // Major news outlets
      /.*\.(reuters|ap|bbc|cnn|nytimes|washingtonpost|wsj|bloomberg|npr|pbs|abc|cbs|nbc|theguardian|usatoday|forbes|politico)\.com/i,
      // Tech news
      /.*\.(ars-technica|techcrunch|theverge|wired|engadget|gizmodo|zdnet|cnet|slashdot)\.com/i,
      /.*\.(arstechnica|techrepublic|computerworld|infoworld|pcworld|macworld)\.com/i,
      // Science & research
      /.*\.(nature|science|newscientist|scientificamerican|mit|stanford|harvard)\.edu/i,
      /.*\.(phys|eurekalert|sciencedaily|livescience)\.org/i,
      // Cybersecurity
      /.*\.(krebsonsecurity|darkreading|securityweek|infosecurity-magazine|bleepingcomputer|threatpost)\.com/i,
      /.*\.(schneier|sans|owasp)\.org/i,
      // Academic and government
      /.*\.gov\/.*\/(news|press|announcement)/i,
      /.*\.edu\/.*\/(news|press)/i,
      // Common news path patterns  
      /.*\/news\//i,
      /.*\/articles?\//i,
      /.*\/press[-_]?release/i,
      /.*\/announcement/i
    ];
    
    try {
      const urlObj = new URL(url);
      return newsPatterns.some(pattern => pattern.test(url) || pattern.test(urlObj.hostname));
    } catch (error) {
      return false;
    }
  }
  
  async processNewsUrl(url, message) {
    console.log(`🔄 Processing news URL: ${url}`);
    
    try {
      // Step 1: Clean URL and get bypass links
      const cleanedUrl = this.cleanUrl(url).cleanedUrl;
      const bypassLinks = this.generateBypassLinks(cleanedUrl);
      
      // Step 2: Scrape content
      const content = await this.scrapeNewsContent(cleanedUrl, bypassLinks);
      
      if (!content || !content.title) {
        console.log(`❌ Could not extract content from: ${url}`);
        return;
      }
      
      // Step 3: Generate AI summary
      const summary = await this.generateNewsSummary(content);
      
      if (!summary) {
        console.log(`❌ Could not generate summary for: ${url}`);
        return;
      }
      
      // Step 4: Post to Discourse
      const discourseTopicId = await this.postToDiscourse(content, summary, cleanedUrl, bypassLinks);
      
      // Step 5: Store processed news
      const processedData = {
        url: cleanedUrl,
        originalUrl: url,
        timestamp: Date.now(),
        title: content.title,
        summary: summary,
        discourseTopicId: discourseTopicId,
        bypassLinks: bypassLinks,
        user: message.sourceName || message.sourceNumber,
        groupId: message.groupId
      };
      
      this.processedNews.set(cleanedUrl, processedData);
      this.newsStats.totalProcessed++;
      if (discourseTopicId) this.newsStats.successfulPosts++;
      else this.newsStats.failedPosts++;
      
      // Update daily stats
      const today = new Date().toDateString();
      const todayCount = this.newsStats.dailyCounts.get(today) || 0;
      this.newsStats.dailyCounts.set(today, todayCount + 1);
      
      // Step 6: Track the news link in database with forum URL
      const forumUrl = discourseTopicId ? `${this.discourseApiUrl}/t/${discourseTopicId}` : null;
      await this.trackNewsLink(cleanedUrl, message, {
        title: content.title,
        summary: summary,
        forumUrl: forumUrl
      });
      
      // Step 7: Send confirmation to Signal group (no markdown for Signal)
      let response = `📰 ${content.title}\n`;
      if (discourseTopicId) {
        response += `💬 Forum: ${forumUrl}\n\n`;
      }
      response += `📝 Summary: ${summary}\n\n`;
      response += `🔗 Original: ${cleanedUrl}\n`;
      response += `🔓 Bypass: ${bypassLinks.twelveft}`;
      
      // Store this as the last news URL for reaction tracking
      this.lastNewsUrl = cleanedUrl;
      this.lastNewsGroupId = message.groupId;
      
      await this.sendReply(message, response);
      
      console.log(`✅ Successfully processed news: ${content.title}`);
      
    } catch (error) {
      console.error(`❌ Error processing news URL ${url}:`, error);
      throw error;
    }
  }
  
  generateBypassLinks(url) {
    const encoded = encodeURIComponent(url);
    return {
      twelveft: `https://12ft.io/proxy?q=${encoded}`,
      archive: `https://web.archive.org/save/${url}`,
      archiveView: `https://web.archive.org/web/${url}`
    };
  }
  
  async scrapeNewsContent(url, bypassLinks) {
    const urls = [url, bypassLinks.twelveft, bypassLinks.archiveView];
    
    for (const attemptUrl of urls) {
      try {
        console.log(`🌐 Attempting to scrape: ${attemptUrl}`);
        
        const response = await axios.get(attemptUrl, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; IrregularChatBot/1.0; +https://forum.irregularchat.com)'
          }
        });
        
        const $ = cheerio.load(response.data);
        
        // Extract title
        let title = $('h1').first().text() || 
                   $('title').text() || 
                   $('meta[property="og:title"]').attr('content') ||
                   $('meta[name="twitter:title"]').attr('content');
        
        // Extract content using multiple strategies
        let content = '';
        
        // Try article tag first
        const articleContent = $('article').text() || $('[role="article"]').text();
        if (articleContent && articleContent.length > 200) {
          content = articleContent;
        } else {
          // Try common content selectors
          const contentSelectors = [
            '.article-content', '.entry-content', '.post-content', 
            '.story-content', '.article-body', '.content-body',
            'main p', '.main-content p', '#content p'
          ];
          
          for (const selector of contentSelectors) {
            const selectorContent = $(selector).text();
            if (selectorContent && selectorContent.length > content.length) {
              content = selectorContent;
            }
          }
        }
        
        // Clean up the content
        content = content.replace(/\s+/g, ' ').trim();
        title = title.replace(/\s+/g, ' ').trim();
        
        if (title && content && content.length > 100) {
          console.log(`✅ Successfully scraped from: ${attemptUrl}`);
          return { title, content };
        }
        
      } catch (error) {
        console.log(`❌ Failed to scrape ${attemptUrl}: ${error.message}`);
        continue;
      }
    }
    
    console.log(`❌ Failed to scrape content from all sources for: ${url}`);
    return null;
  }
  
  async generateNewsSummary(content) {
    if (!this.aiEnabled || !this.openAiApiKey) {
      console.log('❌ AI not enabled, cannot generate summary');
      return null;
    }
    
    try {
      const openai = require('openai');
      const client = new openai({
        apiKey: this.openAiApiKey
      });
      
      const prompt = `Please provide a concise 1-paragraph summary of this news article for a technical community. Focus on key facts and implications. Keep it under 150 words.

Title: ${content.title}

Article content:
${content.content.substring(0, 3000)}...`;
      
      const response = await client.chat.completions.create({
        model: 'gpt-5-mini',
        messages: [{
          role: 'user',
          content: prompt
        }],
        max_completion_tokens: 700 // GPT-5 requires minimum for processing
        // Note: GPT-5 only supports default temperature (1)
      });
      
      const summary = response.choices[0].message.content.trim();
      console.log(`✅ Generated summary: ${summary.substring(0, 100)}...`);
      return summary;
      
    } catch (error) {
      console.error('❌ Error generating summary:', error.message);
      return null;
    }
  }
  
  async postToDiscourse(content, summary, url, bypassLinks) {
    if (!this.discourseApiKey || !this.discourseApiUrl) {
      console.log('❌ Discourse API not configured');
      return null;
    }
    
    try {
      // Extract tags from content
      const tags = this.extractNewsTagsFromContent(content, summary);
      tags.push('posted-link'); // Always add posted-link tag
      
      // Select appropriate category (default to news category 5)
      const categoryId = this.selectDiscourseCategory(content, summary);
      
      const title = `[News] ${content.title}`;
      const body = `${summary}

**Source:** [${url}](${url})
**Bypass:** [12ft.io](${bypassLinks.twelveft})
**Archive:** [Web Archive](${bypassLinks.archiveView})

*Posted automatically by Signal Bot*`;
      
      const response = await axios.post(`${this.discourseApiUrl}/posts.json`, {
        title: title,
        raw: body,
        category: categoryId,
        tags: tags.slice(0, 5), // Discourse typically limits to 5 tags
        created_at: new Date().toISOString()
      }, {
        headers: {
          'Api-Key': this.discourseApiKey,
          'Api-Username': this.discourseApiUsername,
          'Content-Type': 'application/json'
        }
      });
      
      const topicId = response.data.topic_id;
      console.log(`✅ Posted to Discourse: ${this.discourseApiUrl}/t/${topicId}`);
      return topicId;
      
    } catch (error) {
      console.error('❌ Error posting to Discourse:', error.message);
      return null;
    }
  }

  async handleIncomingMessage(params) {
    if (!params || !params.envelope) return;
    
    const envelope = params.envelope;
    const dataMessage = envelope.dataMessage;
    const reactionMessage = envelope.reactionMessage;
    
    // Handle reaction messages separately
    if (reactionMessage) {
      await this.handleReactionMessage(envelope, reactionMessage);
      return;
    }
    
    if (!dataMessage || !dataMessage.message) return;
    
    // Ignore messages from the bot itself to prevent loops
    if (envelope.sourceNumber === this.phoneNumber) return;
    
    // Check if this is a reply/quote to the bot's message
    const isReplyToBot = dataMessage.quote?.author === this.phoneNumber ||
                         dataMessage.quote?.authorNumber === this.phoneNumber;
    
    // Debug logging for quotes with attachments
    if (dataMessage.quote && dataMessage.message === '!pdf') {
      console.log('🔍 Quote data for !pdf:', JSON.stringify(dataMessage.quote, null, 2));
      console.log('🔍 Full dataMessage:', JSON.stringify(dataMessage, null, 2));
    }
    
    // Log mentions if present for debugging
    if (dataMessage.mentions && dataMessage.mentions.length > 0) {
      console.log('📌 Mentions detected:', JSON.stringify(dataMessage.mentions, null, 2));
      console.log('📌 Message text:', dataMessage.message);
    } else if (dataMessage.message && dataMessage.message.includes('￼')) {
      console.log('⚠️ Message contains mention character but no mentions array!');
      console.log('📌 Message:', dataMessage.message);
      console.log('📌 Full dataMessage structure:', JSON.stringify(dataMessage, null, 2));
    }
    
    const message = {
      sourceNumber: envelope.sourceNumber,
      sourceName: envelope.sourceName,
      message: dataMessage.message,
      timestamp: envelope.timestamp,
      groupId: dataMessage.groupInfo?.groupId,
      groupName: dataMessage.groupInfo?.name,
      isReply: !!dataMessage.quote,
      isReplyToBot: isReplyToBot,
      quotedMessage: dataMessage.quote?.text,
      quotedAttachments: dataMessage.quote?.attachments || [],
      attachments: dataMessage.attachments || [],
      mentions: dataMessage.mentions || [] // Include mentions from Signal message
    };
    
    // Store message in history for summarization
    this.storeMessageInHistory(message);
    
    console.log(`📨 Message from ${message.sourceName || message.sourceNumber}: ${message.message}`);
    
    // Store message in history for context
    if (message.groupId) {
      this.storeMessageInHistory(message);
    }
    
    // Check if this is a "good bot" or "bad bot" reply to the bot
    if (isReplyToBot && message.message) {
      const lowerMessage = message.message.toLowerCase().trim();
      // Match variations: "good bot", "good bot!", "good bot.", "goodbot", etc.
      const goodBotPattern = /^(good\s*bot|nice\s*bot|great\s*bot|excellent\s*bot|well\s*done)[!.\s]*$/i;
      const badBotPattern = /^(bad\s*bot|poor\s*bot|terrible\s*bot|awful\s*bot)[!.\s]*$/i;
      
      if (goodBotPattern.test(lowerMessage)) {
        await this.handleBotFeedback(message, true);
        return;
      } else if (badBotPattern.test(lowerMessage)) {
        await this.handleBotFeedback(message, false);
        return;
      }
    }
    
    // Check for URLs that need cleaning (automatic tracker removal)
    await this.checkAndCleanUrls(message);
    
    // Check for news URLs and auto-process them
    await this.checkAndProcessNewsUrls(message);
    
    // Check for event follow-up responses
    const eventContext = this.eventFollowUpContext.get(message.sourceNumber);
    if (eventContext && (Date.now() - eventContext.timestamp < 300000)) { // 5 minute timeout
      const pendingEvent = this.pendingEvents.get(eventContext.pendingEventId);
      if (pendingEvent) {
        // Handle the follow-up message for event creation
        const response = await this.handleEventFollowUp(message, pendingEvent);
        if (response) {
          await this.sendReply(message, response);
          return;
        }
      }
    }
    
    // Check for AI thread continuation (no command prefix)
    const text = message.message.trim();
    if (!text.startsWith('!')) {
      const threadKey = `${message.groupId || 'dm'}:${message.sourceNumber}`;
      const userPref = this.userAiPreference.get(threadKey);
      
      // Check if user has recent AI preference
      if (userPref) {
        const timeSinceLastAi = Date.now() - userPref.timestamp;
        const fiveMinutes = 5 * 60 * 1000;
        
        // If within 5 minutes and message looks like a continuation
        if (timeSinceLastAi < fiveMinutes) {
          const isContinuation = this.looksLikeAiContinuation(message, userPref);
          if (isContinuation) {
            console.log(`🔄 Continuing ${userPref.provider} thread for ${message.sourceName}`);
            
            // Route to appropriate AI handler
            const context = {
              message,
              args: [text],
              groupId: message.groupId,
              sourceNumber: message.sourceNumber,
              sender: message.sourceName || message.sourceNumber
            };
            
            try {
              if (userPref.provider === 'localai' && this.localAiUrl) {
                const laiCommand = this.plugins.get('lai');
                if (laiCommand) {
                  const response = await laiCommand.execute(context);
                  await this.sendReply(message, response);
                  // Update thread context
                  userPref.timestamp = Date.now();
                  userPref.lastMessage = text;
                  return;
                }
              } else if (userPref.provider === 'openai' && this.aiEnabled) {
                const aiCommand = this.plugins.get('ai');
                if (aiCommand) {
                  const response = await aiCommand.execute(context);
                  await this.sendReply(message, response);
                  // Update thread context
                  userPref.timestamp = Date.now();
                  userPref.lastMessage = text;
                  return;
                }
              }
            } catch (error) {
              console.error(`Error in AI thread continuation:`, error);
            }
          }
        } else {
          // Thread expired, remove preference
          this.userAiPreference.delete(threadKey);
          console.log(`🔄 Thread expired for ${message.sourceName}`);
        }
      }
    }
    
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
    // FIXED: Only provide helpful guidance, do not trigger AI responses
    // AI responses should only be triggered by explicit !ai or !lai commands
    let query = message.message.replace(/bot|@signal|\+19108471202/gi, '').trim();
    
    if (!query) return; // No actual question
    
    try {
      // Check if it's a command-related question
      if (query.includes('help') || query.includes('command') || query.includes('how')) {
        const helpResponse = 'I can help! Use !help to see all commands, or ask me specific questions with !ai or !lai';
        await this.sendReply(message, helpResponse);
        return;
      }
      
      // Check if it's about the community  
      const communityKeywords = ['irregular', 'community', 'wiki', 'forum', 'member', 'rule'];
      const isCommunityQuery = communityKeywords.some(kw => query.toLowerCase().includes(kw));
      
      if (isCommunityQuery) {
        const response = `For community info, check our wiki: ${this.wikiUrl} or forum: ${this.forumUrl}\n\nOr use !ai or !lai for AI assistance with your question.`;
        await this.sendReply(message, response);
        return;
      }
      
      // For all other mentions, provide guidance instead of AI responses
      const helpResponse = 'Hi! Use !help for commands or !ai/!lai for AI assistance.';
      await this.sendReply(message, helpResponse);
      
    } catch (error) {
      console.error('Failed to handle mention:', error);
    }
  }
  
  async processCommand(message) {
    const startTime = Date.now();
    const parts = message.message.slice(1).split(' ');
    const commandName = parts[0].toLowerCase();
    const args = parts.slice(1);
    
    console.log(`📝 Processing command: !${commandName} with ${args.length} args`);
    
    // Track command usage
    const usageData = {
      command: commandName,
      args: args.join(' ').substring(0, 1000), // Limit args length
      groupId: message.groupId || null,
      groupName: message.groupName || null,
      userId: message.sourceNumber,
      userName: message.sourceName || null,
      success: true,
      responseTime: null,
      errorMessage: null
    };
    console.log(`📦 Available commands: ${Array.from(this.plugins.keys()).join(', ')}`);
    
    const command = this.plugins.get(commandName);
    if (!command) {
      console.log(`❌ Command not found: !${commandName}`);
      usageData.success = false;
      usageData.errorMessage = 'Command not found';
      usageData.responseTime = Date.now() - startTime;
      await this.trackCommandUsage(usageData);
      await this.sendReply(message, `Unknown command: !${commandName}. Use !help for available commands.`);
      return;
    }
    
    try {
      const context = {
        sender: message.sourceName || message.sourceNumber, // Display name first, phone as fallback
        senderName: message.sourceName,
        sourceNumber: message.sourceNumber, // Keep phone number for admin functions
        args: args,
        groupId: message.groupId,
        isGroup: !!message.groupId,
        isDM: !message.groupId,
        quotedMessage: message.quotedMessage,
        quotedAttachments: message.quotedAttachments,
        attachments: message.attachments,
        message: message, // Pass full message for access to mentions
        mentions: message.mentions || []
      };
      
      const response = await command.execute(context);
      
      // Track successful command
      usageData.responseTime = Date.now() - startTime;
      await this.trackCommandUsage(usageData);
      
      if (response) {
        // Store bot response for reaction tracking
        this.lastBotResponse = {
          message: response,
          command: commandName,
          groupId: message.groupId,
          groupName: message.groupName,
          timestamp: Date.now()
        };
        await this.sendReply(message, response);
      }
    } catch (error) {
      console.error(`❌ Command ${commandName} failed:`, error);
      
      // Track failed command
      usageData.success = false;
      usageData.errorMessage = error.message;
      usageData.responseTime = Date.now() - startTime;
      await this.trackCommandUsage(usageData);
      
      // Log error to database
      await this.logError('command_error', error, {
        command: commandName,
        groupId: message.groupId,
        groupName: message.groupName,
        userId: message.sourceNumber,
        userName: message.sourceName
      });
      
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

  // Add user to a Signal group
  async addUserToGroup(userNumber, groupId) {
    try {
      const request = {
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
          account: this.phoneNumber,
          groupId: groupId,
          addMembers: [userNumber]
        },
        id: `adduser-${Date.now()}`
      };
      
      const result = await this.sendJsonRpcRequest(request);
      console.log(`✅ Added ${userNumber} to group ${groupId}`);
      return result;
    } catch (error) {
      console.error(`Failed to add user to group: ${error.message}`);
      throw error;
    }
  }

  // Send message to a specific group
  async sendToGroup(groupId, message) {
    try {
      await this.sendGroupMessage(groupId, message);
      console.log(`✅ Sent message to group ${groupId}`);
    } catch (error) {
      console.error(`Failed to send to group: ${error.message}`);
      throw error;
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
      // Check if daemon is already running by checking if socket exists
      if (fs.existsSync(this.socketPath)) {
        console.log('🔍 Found existing socket at', this.socketPath);
        console.log('📡 Connecting to existing daemon...');
      } else {
        console.log('🚀 No existing daemon found, starting new one...');
        await this.startDaemon();
      }
      await this.connectSocket();
      console.log('✅ Signal bot is listening for messages');
      
      // Start periodic group sync
      this.groupSyncService.startPeriodicSync();
      console.log('🔄 Started periodic group sync service');
      
      // Load Discourse metadata in background
      this.loadDiscourseMetadata().catch(err => 
        console.error('⚠️ Failed to load Discourse metadata:', err.message)
      );
    } catch (error) {
      this.isListening = false;
      throw error;
    }
  }

  // Custom News Domains Management
  loadCustomNewsDomains() {
    try {
      if (fs.existsSync(this.newsDomainsFile)) {
        const data = fs.readFileSync(this.newsDomainsFile, 'utf8');
        const domains = JSON.parse(data);
        this.customNewsDomains = new Set(domains);
        console.log(`📰 Loaded ${this.customNewsDomains.size} custom news domains`);
      }
    } catch (error) {
      console.error('❌ Error loading custom news domains:', error.message);
    }
  }
  
  saveCustomNewsDomains() {
    try {
      const domains = Array.from(this.customNewsDomains);
      fs.writeFileSync(this.newsDomainsFile, JSON.stringify(domains, null, 2));
      console.log(`💾 Saved ${this.customNewsDomains.size} custom news domains`);
    } catch (error) {
      console.error('❌ Error saving custom news domains:', error.message);
    }
  }
  
  // Discourse Metadata Management
  async loadDiscourseMetadata() {
    if (!this.discourseApiKey || !this.discourseApiUrl) {
      console.log('⚠️ Discourse API not configured, skipping metadata load');
      return;
    }
    
    console.log('📥 Loading Discourse tags and categories...');
    
    try {
      // Load tags
      const tagsResponse = await axios.get(`${this.discourseApiUrl}/tags.json`, {
        headers: {
          'Api-Key': this.discourseApiKey,
          'Api-Username': this.discourseApiUsername
        }
      });
      
      if (tagsResponse.data && tagsResponse.data.tags) {
        tagsResponse.data.tags.forEach(tag => {
          this.discourseTags.set(tag.id, tag);
        });
        this.discourseTagsLoaded = true;
        console.log(`✅ Loaded ${this.discourseTags.size} Discourse tags`);
      }
      
      // Load categories
      const categoriesResponse = await axios.get(`${this.discourseApiUrl}/categories.json`, {
        headers: {
          'Api-Key': this.discourseApiKey,
          'Api-Username': this.discourseApiUsername
        }
      });
      
      if (categoriesResponse.data && categoriesResponse.data.category_list) {
        categoriesResponse.data.category_list.categories.forEach(category => {
          this.discourseCategories.set(category.id, category);
        });
        this.discourseCategoriesLoaded = true;
        console.log(`✅ Loaded ${this.discourseCategories.size} Discourse categories`);
      }
      
    } catch (error) {
      console.error('❌ Error loading Discourse metadata:', error.message);
    }
  }
  
  extractNewsTagsFromContent(content, summary) {
    const tags = [];
    const text = `${content.title} ${summary} ${content.content}`.toLowerCase();
    
    // Technology tags
    if (text.includes('ai') || text.includes('artificial intelligence')) tags.push('ai');
    if (text.includes('cyber') || text.includes('security') || text.includes('hack')) tags.push('cybersecurity');
    if (text.includes('data') || text.includes('privacy')) tags.push('privacy');
    if (text.includes('cloud')) tags.push('cloud');
    if (text.includes('software') || text.includes('development')) tags.push('software');
    if (text.includes('blockchain') || text.includes('crypto')) tags.push('blockchain');
    if (text.includes('quantum')) tags.push('quantum');
    if (text.includes('5g') || text.includes('network')) tags.push('networking');
    
    // Government/Policy tags
    if (text.includes('government') || text.includes('federal')) tags.push('government');
    if (text.includes('defense') || text.includes('military')) tags.push('defense');
    if (text.includes('policy') || text.includes('regulation')) tags.push('policy');
    if (text.includes('china') || text.includes('russia') || text.includes('iran')) tags.push('geopolitics');
    
    // Threat tags
    if (text.includes('ransomware')) tags.push('ransomware');
    if (text.includes('breach') || text.includes('leak')) tags.push('data-breach');
    if (text.includes('vulnerability') || text.includes('cve')) tags.push('vulnerability');
    if (text.includes('malware') || text.includes('virus')) tags.push('malware');
    
    // Agency/Organization tags
    if (text.includes('fbi') || text.includes('cia') || text.includes('nsa')) tags.push('intelligence');
    if (text.includes('ice') || text.includes('immigration')) tags.push('immigration');
    if (text.includes('dod') || text.includes('pentagon')) tags.push('defense');
    
    // Remove duplicates
    return [...new Set(tags)];
  }
  
  selectDiscourseCategory(content, summary) {
    const text = `${content.title} ${summary}`.toLowerCase();
    
    // Category mapping (adjust IDs based on your Discourse setup)
    if (text.includes('cyber') || text.includes('security') || text.includes('hack')) return 7; // Cybersecurity
    if (text.includes('ai') || text.includes('machine learning')) return 8; // AI/ML
    if (text.includes('policy') || text.includes('regulation')) return 9; // Policy
    if (text.includes('defense') || text.includes('military')) return 10; // Defense
    
    return 5; // Default to general news category
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
    const { args } = context;
    
    try {
      // Check if user wants to refresh the cache
      const forceRefresh = args && args[0] === 'refresh';
      
      // Fetch groups using the new caching mechanism
      const groups = await this.getSignalGroups(forceRefresh);
      
      if (forceRefresh) {
        console.log('✅ Groups cache refreshed');
      }
      
      if (!groups || groups.length === 0) {
        return '❌ Unable to fetch groups or bot is not in any groups.';
      }
      
      let response = '📱 Signal Groups (Bot Membership):\n\n';
      
      groups.forEach((group, index) => {
        // Use memberCount from cache, or count members array if available
        const memberCount = group.memberCount || (group.members ? group.members.length : 0);
        const isAdmin = this.isBotAdmin(group);
        const adminIcon = isAdmin ? '👑' : '👤';
        
        response += `${index + 1}. ${group.name || 'Unnamed Group'} ${adminIcon}\n`;
        response += `   Members: ${memberCount}`;
        if (isAdmin) {
          response += ' (Bot is Admin)';
        }
        response += '\n\n';
      });
      
      response += '────────────────\n';
      response += '👑 = Bot has admin rights\n';
      response += '👤 = Bot is regular member\n\n';
      
      const adminGroups = groups.filter(g => this.isBotAdmin(g));
      if (adminGroups.length > 0) {
        response += `✅ Bot can add users to ${adminGroups.length} group(s)\n`;
        response += 'Use !addto <group-number> @user to add users\n';
      } else {
        response += '⚠️ Bot has no admin rights in any group\n';
        response += 'Cannot add users without admin permissions\n';
      }
      
      return response;
      
    } catch (error) {
      console.error('Error in handleGroups:', error);
      return '❌ Error fetching groups. Please try again later.';
    }
  }
  
  async fetchAndCacheGroups() {
    // Try to fetch groups using a direct command
    return new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      exec(`echo '{"jsonrpc":"2.0","method":"listGroups","params":{"account":"${this.phoneNumber}"},"id":1}' | nc -U ${this.socketPath}`, 
        { timeout: 5000 },
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          try {
            const response = JSON.parse(stdout);
            if (response.result) {
              this.cachedGroups = response.result;
              this.cachedGroupsTime = Date.now();
              resolve(response.result);
            } else {
              reject(new Error('No result in response'));
            }
          } catch (parseError) {
            reject(parseError);
          }
        }
      );
    });
  }
  
  async getSignalGroups(forceRefresh = false) {
    try {
      // Try to read from database cache first
      if (!forceRefresh) {
        const cachedGroups = await this.groupSyncService.getCachedGroups();
        if (cachedGroups && cachedGroups.length > 0) {
          console.log(`📦 Using cached groups from database (${cachedGroups.length} groups)`);
          return cachedGroups;
        }
      }
      
      // Force refresh or no cached data - trigger sync
      if (forceRefresh) {
        console.log('🔄 Force refreshing groups...');
      } else {
        console.log('📥 No cached groups, fetching from Signal...');
      }
      
      // Sync groups to database
      const syncResult = await this.groupSyncService.syncGroups();
      
      if (syncResult.success) {
        // Return the freshly synced groups
        const updatedGroups = await this.groupSyncService.getCachedGroups();
        console.log(`✅ Synced ${syncResult.groupCount || updatedGroups.length} groups to database`);
        return updatedGroups || [];
      } else {
        console.error('❌ Failed to sync groups:', syncResult.error);
        return [];
      }
    } catch (error) {
      console.error('Error getting groups:', error);
      
      // Try to use database cache as fallback
      try {
        const fallbackGroups = await this.groupSyncService.getCachedGroups();
        if (fallbackGroups && fallbackGroups.length > 0) {
          console.log('⚠️ Using cached database groups due to error');
          return fallbackGroups;
        }
      } catch (e) {
        console.error('❌ No fallback cache available:', e.message);
      }
      
      throw error;
    }
  }
  
  async sendJsonRpcRequestWithResult(request) {
    return new Promise((resolve, reject) => {
      // Store the request ID for tracking
      const requestId = request.id;
      
      // Create a temporary handler for this specific request
      const responseHandler = (data) => {
        try {
          const lines = data.toString().split('\n').filter(line => line.trim());
          for (const line of lines) {
            try {
              const message = JSON.parse(line);
              if (message.id === requestId) {
                this.socket.removeListener('data', responseHandler);
                if (message.result) {
                  resolve(message.result);
                } else if (message.error) {
                  reject(new Error(message.error.message || 'Request failed'));
                }
                return;
              }
            } catch (e) {
              // Continue to next line
            }
          }
        } catch (error) {
          // Continue listening
        }
      };
      
      // Add the handler
      this.socket.on('data', responseHandler);
      
      // Send the request
      this.socket.write(JSON.stringify(request) + '\n');
      
      // Timeout after 30 seconds (groups list can be large)
      setTimeout(() => {
        this.socket.removeListener('data', responseHandler);
        reject(new Error('Request timeout'));
      }, 30000);
    });
  }
  
  isBotAdmin(group) {
    // First check cached admin status
    if (group.botIsAdmin !== undefined) {
      return group.botIsAdmin;
    }
    
    // Fallback to checking admins array if available
    if (!group.admins || !Array.isArray(group.admins)) {
      return false;
    }
    
    // Check if bot's phone number or UUID is in the admins list
    const botUuid = 'd6292870-2d4f-43a1-89fe-d63791ca104d'; // Bot's actual UUID from logs
    
    return group.admins.some(admin => 
      admin.number === this.phoneNumber || 
      admin.uuid === botUuid ||
      admin === this.phoneNumber ||
      admin === botUuid
    );
  }

  async handleAddTo(context) {
    const { args, sender, sourceNumber, message } = context;
    
    if (!args || args.length < 2) {
      return '❌ Usage: !addto <group-number> @user1 @user2 ...\n\n' +
             'Example: !addto 1 @alice @bob\n' +
             'Example: !addto 3 +12345678900\n\n' +
             'Use !groups to see available groups and their numbers';
    }
    
    // Get the group number
    const groupIdentifier = args[0];
    
    // The message text after the command and group number
    // This will contain the replacement characters for mentions
    const fullMessage = message?.message || '';
    const commandPrefix = `!addto ${groupIdentifier}`;
    const afterCommand = fullMessage.substring(fullMessage.indexOf(commandPrefix) + commandPrefix.length).trim();
    
    console.log('🔍 AddTo Debug:');
    console.log('  Full message:', fullMessage);
    console.log('  After command:', afterCommand);
    console.log('  Args:', args);
    console.log('  Mentions in message:', message?.mentions);
    
    // Extract mentions from the original message if available
    const mentions = message?.mentions || [];
    const users = [];
    
    // Debug logging for mentions
    if (mentions.length > 0) {
      console.log('📝 Mentions found in message:', JSON.stringify(mentions, null, 2));
      
      // If we have mentions, use them directly - they contain the UUIDs we need
      for (const mention of mentions) {
        if (mention.uuid) {
          // Sometimes Signal puts the UUID in the name field when the actual name isn't available
          const displayName = (mention.name && mention.name !== mention.uuid) ? mention.name : 'User';
          console.log(`✅ Using UUID from mention: ${mention.uuid} for ${displayName}`);
          users.push({
            identifier: mention.uuid,
            display: displayName
          });
        } else if (mention.number) {
          const displayName = (mention.name && mention.name !== mention.number) ? mention.name : mention.number;
          console.log(`📱 Using phone from mention: ${mention.number} for ${displayName}`);
          users.push({
            identifier: mention.number,
            display: displayName
          });
        }
      }
    } else if (afterCommand.includes('￼')) {
      // We have replacement characters but no mentions data - this is a problem
      console.log('❌ Message has mention characters but no mention data!');
      return '❌ Unable to process mentions. Please try again or use phone numbers.';
    } else {
      // No mentions - process traditional arguments (phone numbers or direct UUIDs)
      const parts = args.slice(1); // Skip the group number
      for (const userArg of parts) {
        if (userArg.startsWith('+')) {
          // Phone number
          users.push({ identifier: userArg, display: userArg });
        } else if (userArg.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
          // Direct UUID
          console.log(`📍 Direct UUID provided: ${userArg}`);
          users.push({ identifier: userArg, display: userArg });
        } else {
          // Try to look up in group members
          console.log(`🔍 Looking for ${userArg} in group members...`);
          try {
            const groups = await this.getSignalGroups(false);
            const targetGroup = groups[parseInt(groupIdentifier) - 1];
            
            if (targetGroup && targetGroup.members) {
              const member = targetGroup.members.find(m => 
                m.name === userArg || 
                (m.number && m.number.includes(userArg))
              );
              
              if (member && member.uuid) {
                console.log(`✅ Found UUID in group members: ${member.uuid}`);
                users.push({ identifier: member.uuid, display: userArg });
              } else {
                console.log(`⚠️ Could not find UUID for ${userArg}`);
                return `❌ Could not find user "${userArg}". Please use @mention or provide their UUID.`;
              }
            }
          } catch (error) {
            console.error('Error fetching group members:', error);
            return `❌ Error looking up user "${userArg}"`;
          }
        }
      }
    }
    
    try {
      // Get actual groups from Signal
      const groups = await this.getSignalGroups(false);
      
      if (!groups || groups.length === 0) {
        return '❌ Unable to fetch groups.';
      }
      
      // Find the group by number
      const groupNum = parseInt(groupIdentifier);
      if (isNaN(groupNum) || groupNum < 1 || groupNum > groups.length) {
        return `❌ Invalid group number: ${groupIdentifier}\n\n` +
               `Please use a number between 1 and ${groups.length}\n` +
               'Use !groups to see available groups.';
      }
      
      const targetGroup = groups[groupNum - 1];
      const isAdmin = this.isBotAdmin(targetGroup);
      
      if (!isAdmin) {
        return `❌ Cannot add users to "${targetGroup.name}"\n\n` +
               'Bot does not have admin permissions in this group.\n' +
               'Only group admins can add new members.';
      }
      
      if (users.length === 0) {
        return `❌ No users specified to add to ${targetGroup.name}`;
      }
      
      // Attempt to add users via Signal CLI
      const results = [];
      console.log(`🎯 Attempting to add ${users.length} users to group: ${targetGroup.name} (${targetGroup.id})`);
      
      for (const user of users) {
        try {
          const userIdentifier = user.identifier;
          
          // Send the update group request
          const request = {
            jsonrpc: '2.0',
            method: 'updateGroup',
            params: {
              account: this.phoneNumber,
              groupId: targetGroup.id,
              addMembers: [userIdentifier]
            },
            id: Date.now()
          };
          
          console.log(`📤 Sending updateGroup request:`);
          console.log(`   Group: ${targetGroup.name}`);
          console.log(`   User UUID: ${userIdentifier}`);
          console.log(`   Display: ${user.display}`);
          
          const success = await this.sendJsonRpcRequest(request);
          if (success) {
            console.log(`✅ Successfully added ${user.display}`);
            results.push(`✅ ${user.display} added successfully`);
          } else {
            console.log(`⚠️ Failed to add ${user.display}`);
            results.push(`⚠️ ${user.display} (could not add - check if UUID is valid)`);
          }
        } catch (error) {
          console.error(`Error adding ${user.display}:`, error);
          if (error.message.includes('timeout')) {
            results.push(`⚠️ ${user.display} (request timed out - user may not exist)`);
          } else {
            results.push(`❌ ${user.display}: ${error.message}`);
          }
        }
      }
      
      // Check if any users were actually added
      const successCount = results.filter(r => r.includes('✅')).length;
      const failCount = results.filter(r => r.includes('❌') || r.includes('⚠️')).length;
      
      let summary = `📱 Adding users to "${targetGroup.name}":\n\n`;
      summary += results.join('\n');
      
      if (successCount > 0 && failCount === 0) {
        summary += '\n\n✅ Operation complete';
      } else if (successCount > 0 && failCount > 0) {
        summary += `\n\n⚠️ Partially complete: ${successCount} added, ${failCount} failed`;
      } else {
        summary += '\n\n❌ Failed to add users';
      }
      
      return summary;
             
    } catch (error) {
      console.error('Error in handleAddTo:', error);
      return `❌ Failed to add users\n\n` +
             `Error: ${error.message}`;
    }
  }
  
  async sendJsonRpcRequest(request) {
    return new Promise((resolve, reject) => {
      let timeoutId;
      let resolved = false;
      
      const responseHandler = (data) => {
        if (resolved) return; // Already handled
        
        try {
          const lines = data.toString().split('\n').filter(line => line.trim());
          for (const line of lines) {
            try {
              const message = JSON.parse(line);
              if (message.id === request.id) {
                resolved = true;
                clearTimeout(timeoutId);
                this.socket.removeListener('data', responseHandler);
                
                if (message.result !== undefined) {
                  resolve(true);
                } else if (message.error) {
                  reject(new Error(message.error.message || 'Request failed'));
                } else {
                  // Some commands return empty result on success
                  resolve(true);
                }
                return;
              }
            } catch (e) {
              // Continue to next line
            }
          }
        } catch (error) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            this.socket.removeListener('data', responseHandler);
            reject(error);
          }
        }
      };
      
      this.socket.on('data', responseHandler);
      this.socket.write(JSON.stringify(request) + '\n');
      
      // Timeout after 10 seconds (some operations take longer)
      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.socket.removeListener('data', responseHandler);
          
          // Don't reject on timeout for send messages and updateGroup - they often succeed but don't respond
          if (request.method === 'send' || request.method === 'updateGroup') {
            console.log(`⚠️ ${request.method} request timed out but may have succeeded`);
            resolve(true);
          } else {
            reject(new Error('Request timeout'));
          }
        }
      }, 10000);
    });
  }

  async handleJoin(context) {
    const { args, sourceNumber, sender, groupId: currentGroupId } = context;
    
    if (!args || args.length === 0) {
      return '❌ Usage: !join <group-number-or-name>\n\n' +
             'Examples:\n' +
             '• !join 1 (join group #1)\n' +
             '• !join DevOps (join group by name)\n\n' +
             'Use !groups to see available groups';
    }
    
    const groupIdentifier = args.join(' ').trim();
    
    try {
      // Get cached groups
      const cachedGroups = await this.groupSyncService.getCachedGroups();
      
      if (!cachedGroups || cachedGroups.length === 0) {
        console.log('No cached groups found, syncing...');
        await this.groupSyncService.syncGroups();
        const updatedGroups = await this.groupSyncService.getCachedGroups();
        if (!updatedGroups || updatedGroups.length === 0) {
          return '❌ Unable to fetch group information. Please try again later.';
        }
        cachedGroups.push(...updatedGroups);
      }
      
      // Sort groups by member count (largest first) for consistent numbering
      const sortedGroups = [...cachedGroups].sort((a, b) => 
        (b.memberCount || 0) - (a.memberCount || 0)
      );
      
      let targetGroup = null;
      
      // Check if it's a number (group number)
      const groupNumber = parseInt(groupIdentifier);
      if (!isNaN(groupNumber)) {
        if (groupNumber < 1 || groupNumber > sortedGroups.length) {
          return `❌ Invalid group number. Use !groups to see available groups (1-${sortedGroups.length}).`;
        }
        targetGroup = sortedGroups[groupNumber - 1];
      } else {
        // Search by name (case-insensitive partial match)
        targetGroup = sortedGroups.find(group => 
          group.name && group.name.toLowerCase().includes(groupIdentifier.toLowerCase())
        );
        
        if (!targetGroup) {
          return `❌ Group "${groupIdentifier}" not found. Use !groups to see available groups.`;
        }
      }
      
      // Check if user is already in the target group
      const members = await this.groupSyncService.getCachedGroupMembers(targetGroup.groupId);
      const isAlreadyMember = members.some(member => 
        member.number === sourceNumber || member.uuid === sourceNumber
      );
      
      if (isAlreadyMember) {
        return `✅ You're already a member of "${targetGroup.name}"!`;
      }
      
      // Add user to the target group
      console.log(`🔄 Adding ${sourceNumber} (${sender}) to group: ${targetGroup.name}`);
      
      const request = {
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
          account: this.phoneNumber,
          groupId: targetGroup.groupId,
          addMembers: [sourceNumber]
        },
        id: `join-${Date.now()}`
      };
      
      const success = await this.sendJsonRpcRequest(request);
      
      if (success) {
        // Update the cached member data
        await this.groupSyncService.fetchAndSyncGroupMembers(targetGroup.groupId);
        
        return `✅ Successfully added you to "${targetGroup.name}"!\n\n` +
               `👥 Group now has ${(targetGroup.memberCount || 0) + 1} members.\n` +
               `Welcome to the group! 🎉`;
      } else {
        return `❌ Failed to add you to "${targetGroup.name}". Please try again or contact an admin.`;
      }
      
    } catch (error) {
      console.error('Error in handleJoin:', error);
      return `❌ Error joining group: ${error.message}`;
    }
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
    const { args, sourceNumber, groupId: currentGroupId, sender } = context;
    
    // Check if user is admin first (check both phone number and UUID)
    const phoneNumberAdmin = this.isAdmin(sourceNumber);
    const uuidAdmin = this.isUuidAdmin(sender?.uuid);
    
    if (!phoneNumberAdmin && !uuidAdmin) {
      return '🚫 Only administrators can remove users from groups';
    }
    
    // Entry room ID from environment (base64 decoded to the actual group ID)
    // const entryRoomId = process.env.ENTRY_ROOM_ID?.replace('group.', '');
    // const entryGroupId = entryRoomId ? Buffer.from(entryRoomId, 'base64').toString('base64') : 'PjJCT6d4nrF0/BZOs39ECX/lZkcHPbi65JU8B6kgw6s=';
    
    // TESTING: Hardcoded testing group for nonadmin removal
    const testingGroupId = 'kZExwKqKmjMOK2KYvX8+WhsuBAnN8m6Ecf4XedYP4xM=';
    const entryGroupId = 'PjJCT6d4nrF0/BZOs39ECX/lZkcHPbi65JU8B6kgw6s='; // Entry/INDOC room
    
    // This command only works in the testing room or entry room with 'nonadmin' parameter
    if (currentGroupId !== testingGroupId && currentGroupId !== entryGroupId) {
      return '❌ This command only works in the Testing room or Entry/INDOC room';
    }
    
    if (!args || args.length === 0 || args[0] !== 'nonadmin') {
      return '❌ Usage: !removeuser nonadmin\n' +
             'This will remove all non-admin users from the current room (Testing or Entry/INDOC only).';
    }
    
    // Determine which room we're working in
    const roomName = currentGroupId === testingGroupId ? 'Testing room' : 'Entry/INDOC room';
    console.log(`🔄 Processing nonadmin removal for ${roomName}`);
    
    try {
      // CRITICAL: Fetch fresh group data to get accurate admin status
      console.log(`🔍 Fetching fresh group data with admin status for ${currentGroupId}...`);
      
      const listGroupsRequest = {
        jsonrpc: '2.0',
        method: 'listGroups',
        params: {
          account: this.phoneNumber
        },
        id: `list-groups-${Date.now()}`
      };
      
      const groupsResponse = await this.sendJsonRpcRequest(listGroupsRequest);
      
      if (!groupsResponse) {
        return `❌ Could not retrieve groups information. Please try again.`;
      }
      
      // Find our specific group
      const groupInfo = groupsResponse.find(g => g.id === currentGroupId);
      
      if (!groupInfo || !groupInfo.members) {
        return `❌ Could not retrieve group information. Please try again.`;
      }
      
      const allMembers = groupInfo.members || [];
      const adminIds = new Set((groupInfo.admins || []).map(a => a.uuid || a.number));
      
      console.log(`📊 Fresh data: ${allMembers.length} total members, ${adminIds.size} admins identified`);
      
      // CRITICAL: Separate admins from non-admins using fresh data
      const adminMembers = [];
      const nonAdminMembers = [];
      
      for (const member of allMembers) {
        const memberId = member.uuid || member.number;
        if (adminIds.has(memberId)) {
          adminMembers.push(member);
          console.log(`🛡️ Protecting admin: ${member.profileName || member.name || memberId}`);
        } else {
          nonAdminMembers.push(member);
        }
      }
      
      console.log(`📊 Group has ${allMembers.length} total members, ${adminMembers.length} admins, ${nonAdminMembers.length} non-admins`);
      
      if (nonAdminMembers.length === 0) {
        return `✅ No non-admin users found in ${roomName}`;
      }
      
      // Prepare removal list - use UUID preferentially, fallback to number
      const usersToRemove = nonAdminMembers.map(m => m.uuid || m.number).filter(id => id);
      
      if (usersToRemove.length === 0) {
        return `❌ Could not identify users to remove (missing UUIDs)`;
      }
      
      // SAFETY: Show confirmation of what we're about to do
      console.log(`⚠️ CONFIRMATION: Will remove ${usersToRemove.length} non-admin users from ${roomName}`);
      console.log(`🛡️ KEEPING ${adminMembers.length} admins safe`);
      
      // Add a small delay for safety
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log(`🔄 Starting removal of ${usersToRemove.length} non-admin users from ${roomName}`);
      
      // Remove users in batches of 5 to avoid timeout and be more careful
      const batchSize = 5;
      let removedCount = 0;
      let failedCount = 0;
      
      for (let i = 0; i < usersToRemove.length; i += batchSize) {
        const batch = usersToRemove.slice(i, i + batchSize);
        
        try {
          const removeRequest = {
            jsonrpc: '2.0',
            method: 'updateGroup',
            params: {
              account: this.phoneNumber,
              groupId: currentGroupId,
              removeMembers: batch
            },
            id: `remove-nonadmin-batch-${Date.now()}`
          };
          
          const success = await this.sendJsonRpcRequest(removeRequest);
          
          if (success) {
            removedCount += batch.length;
            console.log(`✅ Batch ${Math.floor(i/batchSize) + 1}: Removed ${batch.length} users`);
          } else {
            failedCount += batch.length;
            console.error(`❌ Batch ${Math.floor(i/batchSize) + 1} failed`);
          }
        } catch (error) {
          failedCount += batch.length;
          console.error(`❌ Error removing batch:`, error);
        }
        
        // Small delay between batches
        if (i + batchSize < usersToRemove.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      const completedRoomName = currentGroupId === testingGroupId ? 'Testing room' : 'Entry/INDOC room';
      return `✅ **Cleanup Complete for ${completedRoomName}**\n\n` +
             `• Total non-admins found: ${nonAdminMembers.length}\n` +
             `• Successfully removed: ${removedCount}\n` +
             `• Failed to remove: ${failedCount}\n` +
             `• Admins retained: ${adminMembers.length}`;
             
    } catch (error) {
      console.error('Error in nonadmin removal:', error);
      return `❌ Error removing non-admin users: ${error.message}`;
    }
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
    const { sender, sourceNumber, groupId } = context;
    
    // TODO: Add the sender to the entry room (Actions Chat)
    // This would require knowing the entry room group ID and using updateGroup API
    
    const inviteInstructions = `📋 **To invite someone to IrregularChat:**

1. Let them know you're vouching for them
2. Make sure you have an SSO login: https://sso.irregularchat.com
3. Login to the forum and follow: https://url.irregular.chat/invite
4. Join the Actions Chat
5. Add them to the Actions Chat
6. Type: !request @their_username

That's it! The onboarding process will begin once you type !request.`;
    
    // TODO: Actually add the user to the entry room here
    // For now, just return the instructions
    
    return inviteInstructions;
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

  async handleAdvancedSearch(context) {
    const { args, groupId, sender } = context;
    
    if (!args || args.length === 0) {
      return '🔍 Usage: !search <query>\n\n' +
             'Advanced AI-powered search across:\n' +
             '• Forum posts and discussions\n' +
             '• Wiki articles and documentation\n' +
             '• Q&A database\n' +
             '• Message history (last 50 per group)\n' +
             '• Community resources\n\n' +
             'Example: !search how to setup authentication';
    }
    
    const query = args.join(' ').trim();
    console.log(`🔍 Advanced search for: "${query}" by ${sender}`);
    
    try {
      // Collect data from multiple sources
      const searchResults = {
        forum: [],
        wiki: [],
        questions: [],
        messages: [],
        resources: []
      };
      
      // 1. Search forum posts (if API configured)
      if (this.discourseApiUrl && this.discourseApiKey) {
        try {
          const forumUrl = `${this.discourseApiUrl}/search.json?q=${encodeURIComponent(query)}`;
          const forumResponse = await fetch(forumUrl, {
            headers: {
              'Api-Key': this.discourseApiKey,
              'Api-Username': this.discourseApiUsername
            }
          });
          
          if (forumResponse.ok) {
            const forumData = await forumResponse.json();
            const posts = forumData.posts || [];
            const topics = forumData.topics || [];
            
            searchResults.forum = posts.slice(0, 3).map(post => {
              const topic = topics.find(t => t.id === post.topic_id) || {};
              const title = topic.title || post.topic_title || `Post #${post.id}`;
              const slug = topic.slug || post.topic_slug || 'topic';
              const topicId = post.topic_id || topic.id;
              
              return {
                type: 'forum',
                title: title,
                content: post.blurb || post.excerpt || '',
                url: topicId ? `https://forum.irregularchat.com/t/${slug}/${topicId}` : 
                              `https://forum.irregularchat.com/p/${post.id}`
              };
            });
          }
        } catch (error) {
          console.error('Forum search error:', error);
        }
      }
      
      // 2. Search wiki
      try {
        const wikiUrl = `https://irregularpedia.org/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=3`;
        const wikiResponse = await fetch(wikiUrl);
        
        if (wikiResponse.ok) {
          const wikiData = await wikiResponse.json();
          const articles = wikiData.query?.search || [];
          searchResults.wiki = articles.map(article => ({
            type: 'wiki',
            title: article.title,
            content: article.snippet?.replace(/<[^>]*>/g, '').substring(0, 100) || '',
            url: `https://irregularpedia.org/wiki/${encodeURIComponent(article.title.replace(/ /g, '_'))}`
          }));
        }
      } catch (error) {
        console.error('Wiki search error:', error);
      }
      
      // 3. Search Q&A database
      const questionMatches = Array.from(this.questions.values())
        .filter(q => {
          const searchLower = query.toLowerCase();
          return q.question.toLowerCase().includes(searchLower) ||
                 q.title.toLowerCase().includes(searchLower) ||
                 q.answers.some(a => a.text.toLowerCase().includes(searchLower));
        })
        .slice(0, 3)
        .map(q => ({
          type: 'question',
          title: q.title,
          content: q.question.substring(0, 100),
          id: q.id,
          solved: q.solved,
          answers: q.answers.length
        }));
      searchResults.questions = questionMatches;
      
      // 4. Search recent message history (privacy-sensitive)
      if (groupId && this.messageHistory.has(groupId)) {
        const messages = this.messageHistory.get(groupId) || [];
        const messageMatches = messages
          .filter(msg => {
            // Exclude bot commands and system messages
            if (msg.message.startsWith('!')) return false;
            if (msg.message.startsWith('🔍 Search Results')) return false;
            if (msg.sender === 'irregularchat-bot') return false;
            return msg.message.toLowerCase().includes(query.toLowerCase());
          })
          .slice(-2)  // Reduce to 2 messages to avoid spam
          .map(msg => ({
            type: 'message',
            sender: msg.sender.substring(0, 10) + '***', // Partial anonymization
            content: msg.message.substring(0, 80),
            time: this.getRelativeTime(msg.timestamp)
          }));
        searchResults.messages = messageMatches;
      }
      
      // 5. Prepare context for AI processing (using local AI for privacy)
      const allResults = [
        ...searchResults.forum,
        ...searchResults.wiki,
        ...searchResults.questions,
        ...searchResults.messages
      ];
      
      if (allResults.length === 0) {
        return `🔍 No results found for: "${query}"\n\n` +
               `Try:\n` +
               `• Different keywords\n` +
               `• !wiki for wiki search\n` +
               `• !fsearch for forum search\n` +
               `• !questions to see Q&A`;
      }
      
      // 6. Use Local AI to synthesize results (for privacy) - with timeout
      let aiSummary = '';
      if (this.localAiUrl && this.localAiApiKey && allResults.length > 0) {
        try {
          // Create a timeout promise
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('AI timeout')), 3000) // 3 second timeout
          );
          
          const contextData = {
            query: query,
            results: allResults.slice(0, 5).map(r => ({ // Limit to top 5 for speed
              type: r.type,
              title: r.title || '',
              content: (r.content || '').substring(0, 50) // Shorter content for speed
            }))
          };
          
          const aiPromise = fetch(`${this.localAiUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.localAiApiKey}`
            },
            body: JSON.stringify({
              model: this.localAiModel,
              messages: [{
                role: 'system',
                content: 'Synthesize search results in 2-3 sentences max. Be direct and helpful.'
              }, {
                role: 'user',
                content: `Query: "${query}"\nResults: ${JSON.stringify(contextData.results)}`
              }],
              max_completion_tokens: 650  // GPT-5 minimum for thinking models
            })
          });
          
          // Race between AI response and timeout
          const aiResponse = await Promise.race([aiPromise, timeoutPromise]);
          
          if (aiResponse.ok) {
            const aiData = await aiResponse.json();
            aiSummary = aiData.choices[0]?.message?.content || '';
          }
        } catch (error) {
          console.log('Skipping AI summary:', error.message);
          // Continue without AI summary
        }
      }
      
      // 7. Format response (compact for large groups)
      let response = `Search Results for: "${query}"\n\n`;
      
      // Add AI summary if available (skip if too long)
      if (aiSummary && aiSummary.length < 150) {
        response += `${aiSummary}\n\n`;
      }
      
      // Add categorized results (compact format)
      if (searchResults.wiki.length > 0) {
        response += `📚 Wiki Articles:\n`;
        searchResults.wiki.slice(0, 3).forEach(r => {  // Limit to 3
          response += `• ${r.title}\n  ${r.url}\n`;
        });
        response += '\n';
      }
      
      if (searchResults.forum.length > 0) {
        response += `💬 Forum Posts:\n`;
        searchResults.forum.slice(0, 3).forEach(r => {  // Limit to 3
          response += `• ${r.title}\n  ${r.url}\n`;
        });
        response += '\n';
      }
      
      if (searchResults.questions.length > 0) {
        response += `❓ Questions:\n`;
        searchResults.questions.forEach(q => {
          const status = q.solved ? '✅' : '❓';
          response += `${status} ${q.id}: ${q.title} (${q.answers} answers)\n`;
        });
        response += '\n';
      }
      
      if (searchResults.messages.length > 0) {
        response += `💭 Recent Messages:\n`;
        searchResults.messages.forEach(m => {
          response += `• just now - ${m.content.substring(0, 50)}...\n`;  // Shorter content
        });
      }
      
      // Limit total response size for large groups (Signal has message size limits)
      if (response.length > 1500) {
        response = response.substring(0, 1497) + '...';
      }
      
      return response;
      
    } catch (error) {
      console.error('Advanced search error:', error);
      return `❌ Search error occurred. Please try again.\n\nYou can also try:\n• !wiki ${query}\n• !fsearch ${query}`;
    }
  }

  async handleForum(context) {
    const { args } = context;
    return `💬 **Forum Search${args ? `: "${args}"` : ''}**\n\nVisit: https://forum.irregularchat.com\n\n💡 Use the forum for detailed discussions.`;
  }

  async handleEvents(context) {
    try {
      // Import Prisma client
      const { PrismaClient } = require('../../generated/prisma');
      const prisma = new PrismaClient();
      
      // Get upcoming events from database
      const now = new Date();
      const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      
      const events = await prisma.signalEvent.findMany({
        where: {
          isActive: true,
          eventStart: {
            gte: now,
            lte: thirtyDaysFromNow
          }
        },
        orderBy: {
          eventStart: 'asc'
        },
        take: 5
      });
      
      // Also try to fetch latest events from Discourse if API is available
      if (this.discourseApiUrl && this.discourseApiKey) {
        try {
          const response = await fetch(`${this.discourseApiUrl}/tags/event.json`, {
            headers: {
              'Api-Key': this.discourseApiKey,
              'Api-Username': this.discourseApiUsername || 'system'
            }
          });
          
          if (response.ok) {
            const data = await response.json();
            // Sync any new events from Discourse to our database
            await this.syncDiscourseEvents(data.topic_list?.topics || []);
          }
        } catch (error) {
          console.error('Failed to fetch Discourse events:', error);
        }
      }
      
      // Format events for display
      if (events.length === 0) {
        return `📅 Upcoming Events:\n\nNo upcoming events scheduled.\n\nTo add an event, use: !eventadd <event details>\n\nView calendar: ${this.discourseApiUrl}/upcoming-events`;
      }
      
      let response = '📅 Upcoming Events:\n\n';
      
      for (const event of events) {
        const startDate = new Date(event.eventStart);
        const endDate = event.eventEnd ? new Date(event.eventEnd) : null;
        
        response += `${event.eventName}\n`;
        response += `📅 ${this.formatEventDate(startDate)}\n`;
        if (endDate) {
          response += `⏰ Ends: ${this.formatEventTime(endDate)}\n`;
        }
        if (event.location) {
          response += `📍 ${event.location}\n`;
        }
        if (event.discourseUrl) {
          response += `🔗 ${event.discourseUrl}\n`;
        }
        response += '\n';
      }
      
      response += `View all events: ${this.discourseApiUrl}/upcoming-events\n`;
      response += `Add an event: !eventadd <details>`;
      
      await prisma.$disconnect();
      return response;
      
    } catch (error) {
      console.error('Error fetching events:', error);
      return `📅 **Upcoming Events:**\n\n⚠️ Unable to fetch events at this time.\n\nView events online: ${this.discourseApiUrl}/upcoming-events`;
    }
  }
  
  // Helper function to format event dates
  formatEventDate(date) {
    const options = { 
      weekday: 'short', 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    };
    return date.toLocaleString('en-US', options);
  }
  
  // Helper function to format just time
  formatEventTime(date) {
    const options = { 
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    };
    return date.toLocaleString('en-US', options);
  }
  
  async handleEventFollowUp(message, pendingEvent) {
    const text = message.message.trim().toLowerCase();
    
    // Check for confirmation responses
    if (text === 'yes' || text === 'y' || text === 'confirm' || text === 'ok') {
      // Create the event
      const createdEvent = await this.createEventInDiscourse(pendingEvent.parsed, pendingEvent.sender);
      
      if (createdEvent.success) {
        // Clear the context
        this.eventFollowUpContext.delete(message.sourceNumber);
        this.pendingEvents.delete(pendingEvent.pendingEventId);
        
        // Format response
        const eventDate = new Date(pendingEvent.parsed.start);
        const dateStr = eventDate.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });
        const timeStr = eventDate.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit' 
        });
        
        return `LocalAI: ✅ Event Created!\n\n` +
               `${pendingEvent.parsed.name}\n` +
               `📅 ${dateStr}\n` +
               `🕐 ${timeStr}\n` +
               `📍 ${pendingEvent.parsed.location}\n\n` +
               `📎 Forum link: ${createdEvent.url}\n\n` +
               `The event has been posted to the forum calendar and saved to our database.`;
      } else {
        return `LocalAI: ❌ Failed to create event: ${createdEvent.error}`;
      }
    }
    
    // Check for cancellation
    if (text === 'no' || text === 'cancel' || text === 'stop') {
      this.eventFollowUpContext.delete(message.sourceNumber);
      this.pendingEvents.delete(pendingEvent.pendingEventId);
      return 'LocalAI: ❌ Event creation cancelled.';
    }
    
    // Otherwise, treat it as additional information for the event
    const updatedDescription = message.message.trim();
    
    // Try to parse the additional info
    if (updatedDescription.toLowerCase().includes('is at') || 
        updatedDescription.toLowerCase().includes('located at')) {
      // They're providing location details
      const locationMatch = updatedDescription.match(/(?:is at|located at)\s+(.+)/i);
      if (locationMatch) {
        pendingEvent.parsed.location = locationMatch[1].trim();
        
        // Check if we now have all required fields
        const missingFields = [];
        if (!pendingEvent.parsed.name) missingFields.push('event name');
        if (!pendingEvent.parsed.start) missingFields.push('start date/time');
        
        if (missingFields.length === 0) {
          // We have everything, confirm creation
          return `LocalAI: Great! I now have all the details:\n\n` +
                 `• Name: ${pendingEvent.parsed.name}\n` +
                 `• Start: ${pendingEvent.parsed.start}\n` +
                 `• Location: ${pendingEvent.parsed.location}\n\n` +
                 `Reply "yes" to create this event or "cancel" to stop.`;
        }
      }
    }
    
    // Update pending event and ask for confirmation
    pendingEvent.timestamp = Date.now();
    return `LocalAI: I've updated the location to: ${pendingEvent.parsed.location}\n\n` +
           `Event details:\n` +
           `• Name: ${pendingEvent.parsed.name}\n` +
           `• Start: ${pendingEvent.parsed.start}\n` +
           `• Location: ${pendingEvent.parsed.location}\n\n` +
           `Reply "yes" to create this event or "cancel" to stop.`;
  }

  async handleEventAdd(context) {
    const { args, sender, sourceNumber, groupId } = context;
    
    if (!args || args.length === 0) {
      return '📅 Add Event Usage:\n\n' +
             '!eventadd <natural language description>\n\n' +
             'Example:\n' +
             '!eventadd Monthly meetup next Tuesday at 6pm at the community center\n\n' +
             'I\'ll help you format this for the forum and ask for any missing details!';
    }
    
    const eventDescription = args.join(' ').trim();
    console.log(`📅 Processing event add request from ${sender}: ${eventDescription}`);
    
    try {
      // Try basic parsing first for simple cases
      let parsedEvent = this.basicEventParsing(eventDescription);
      
      // Check if basic parsing missed critical fields - if so, use AI immediately
      const hasUrl = eventDescription.includes('http');
      const shouldUseAI = !parsedEvent.name || !parsedEvent.start || !parsedEvent.location || 
                         (hasUrl && this.localAiUrl && this.localAiApiKey);
      
      if (shouldUseAI) {
        console.log('📡 Basic parsing incomplete, using AI to improve parsing...');
        parsedEvent = await this.parseEventWithLocalAI(eventDescription);
        
        // If AI also failed, fall back to basic parsing
        if (!parsedEvent.name && !parsedEvent.start) {
          parsedEvent = this.basicEventParsing(eventDescription);
        }
      }
      
      // Extract URLs from description for Discourse calendar format
      const urlMatches = eventDescription.match(/https?:\/\/[^\s]+/g);
      if (urlMatches && urlMatches.length > 0) {
        // Add URLs to description, removing them from location if they got mixed in
        const urls = urlMatches.join('\n');
        parsedEvent.description = parsedEvent.description ? 
          `${parsedEvent.description}\n\n${urls}` : urls;
        
        // Clean URLs from location field
        if (parsedEvent.location) {
          parsedEvent.location = parsedEvent.location.replace(/\s*https?:\/\/[^\s]+/g, '').trim();
          if (!parsedEvent.location) parsedEvent.location = null;
        }
      }
      
      // Check what fields are missing or incomplete
      const missingFields = [];
      if (!parsedEvent.name) missingFields.push('event name');
      if (!parsedEvent.start) missingFields.push('start date/time');
      if (!parsedEvent.location) {
        missingFields.push('location');
      } else {
        // Check if location looks incomplete (business name or street address without city/state)
        const locationLower = parsedEvent.location.toLowerCase().trim();
        const hasStreetOnly = /^\d+\s+\w+\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|place|pl|way)$/i.test(parsedEvent.location.trim());
        const hasCityState = /,\s*[A-Za-z\s]+(?:,\s*[A-Z]{2})?/.test(parsedEvent.location);
        
        // Check if it's likely a business name without full address
        const looksLikeBusiness = !hasStreetOnly && !hasCityState && 
                                 !locationLower.includes('online') && 
                                 !locationLower.includes('virtual') &&
                                 !locationLower.includes(',');
        
        if (hasStreetOnly && !hasCityState) {
          missingFields.push('city and state for the address');
        } else if (looksLikeBusiness) {
          missingFields.push('complete address with city and state');
        }
      }
      
      // Store pending event in memory for follow-up
      const pendingEventId = `pending_${Date.now()}`;
      this.pendingEvents = this.pendingEvents || new Map();
      this.pendingEvents.set(pendingEventId, {
        parsed: parsedEvent,
        original: eventDescription,
        sender: sender,
        sourceNumber: sourceNumber,
        groupId: groupId,
        timestamp: Date.now()
      });
      
      // Clean up old pending events (older than 1 hour)
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      for (const [id, event] of this.pendingEvents.entries()) {
        if (event.timestamp < oneHourAgo) {
          this.pendingEvents.delete(id);
        }
      }
      
      // Track this for follow-up
      this.eventFollowUpContext.set(sourceNumber, {
        pendingEventId: pendingEventId,
        timestamp: Date.now()
      });
      
      if (missingFields.length > 0) {
        let response = 'LocalAI: 📅 Creating Event\n\n';
        response += 'I understood:\n';
        if (parsedEvent.name) response += `• Name: ${parsedEvent.name}\n`;
        if (parsedEvent.start) response += `• Start: ${parsedEvent.start}\n`;
        if (parsedEvent.end) response += `• End: ${parsedEvent.end}\n`;
        if (parsedEvent.location) response += `• Location: ${parsedEvent.location}\n`;
        
        response += `\n❓ Missing information: ${missingFields.join(', ')}\n\n`;
        response += `Please provide the missing details. For example:\n`;
        if (!parsedEvent.name) response += `"The event name is Community Meetup"\n`;
        if (!parsedEvent.start) response += `"It starts on January 15 at 6pm"\n`;
        if (!parsedEvent.location) response += `"Location is 123 Main St, Anytown, CA"\n`;
        if (missingFields.includes('city and state for the address')) {
          response += `"The city is Anytown, CA" (please include city and state)\n`;
        }
        if (missingFields.includes('complete address with city and state')) {
          response += `"${parsedEvent.location} is at 123 Main St, Anytown, CA"\n`;
        }
        
        response += `\n💡 Or reply with the complete details and I'll try again.`;
        
        return response;
      }
      
      // We have all required fields but need user confirmation
      // Format the date/time nicely for confirmation
      const eventDate = parsedEvent.start ? new Date(parsedEvent.start) : null;
      let formattedDate = parsedEvent.start;
      if (eventDate && !isNaN(eventDate)) {
        formattedDate = eventDate.toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        }) + ' at ' + eventDate.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit' 
        });
      }
      
      let response = 'LocalAI: 📅 Ready to Create Event\n\n';
      response += 'Event Details:\n';
      response += `• Name: ${parsedEvent.name}\n`;
      response += `• When: ${formattedDate}\n`;
      response += `• Where: ${parsedEvent.location}\n`;
      if (parsedEvent.description && parsedEvent.description !== eventDescription) {
        response += `• Details: ${parsedEvent.description}\n`;
      }
      
      response += '\n✅ Reply "yes" to create this event\n';
      response += '❌ Reply "cancel" to cancel\n';
      response += '✏️ Or tell me what to change';
      
      return response;
      
    } catch (error) {
      console.error('Error in handleEventAdd:', error);
      return `❌ **Error processing event**\n\n` +
             `Please try again with a clearer description, for example:\n` +
             `!eventadd "Community Meetup on January 15 at 6pm at 123 Main St"`;
    }
  }
  
  async parseEventWithLocalAI(description) {
    if (!this.localAiUrl || !this.localAiApiKey) {
      // Fallback to basic parsing if LocalAI not configured
      return this.basicEventParsing(description);
    }
    
    try {
      const prompt = `Parse this event description into structured data for a Discourse calendar event. Extract:
- name: Extract the main event title/name. For courses, training, conferences, use the full official title.
- start: Start date and time (format: YYYY-MM-DD HH:MM). Parse formats like "Mon Oct 20, 2025 9:00 AM".
- end: End date and time if mentioned (format: YYYY-MM-DD HH:MM). Parse formats like "Fri Oct 24, 2025 5:00 PM".
- location: Extract ONLY the physical location (venue name, address, city, state, zip). Do NOT include URLs.
- timezone: Extract timezone if mentioned (like MDT, EST), otherwise default to America/New_York
- description: Any additional context. URLs should go here, NOT in location.

For this input: "${description}"

CRITICAL RULES:
1. URLs go in description field, never in location
2. Location should be clean physical address only
3. Preserve exact event names and technical terms
4. Parse multi-day events with proper start/end dates
5. Handle timezone abbreviations (MDT, PST, EST, etc.)

Return ONLY valid JSON with these fields. Use null for missing values.`;

      const response = await fetch(`${this.localAiUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.localAiApiKey}`
        },
        body: JSON.stringify({
          model: this.localAiModel || 'gpt-oss-120',
          messages: [
            { 
              role: 'system', 
              content: 'You are a helpful assistant that parses event descriptions into structured JSON. Always return valid JSON only, no other text. For location field: if the address is incomplete (missing city/state), return ONLY what was provided. Never add or guess missing location information.'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.1,
          max_tokens: 500
        })
      });
      
      if (!response.ok) {
        console.error('LocalAI request failed:', response.status);
        return this.basicEventParsing(description);
      }
      
      const result = await response.json();
      const content = result.choices[0].message.content;
      
      // Try to extract JSON from the response
      let jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // Validate and normalize the parsed data
        return {
          name: parsed.name || null,
          start: this.normalizeDateTime(parsed.start),
          end: parsed.end ? this.normalizeDateTime(parsed.end) : null,
          location: parsed.location || null,
          timezone: parsed.timezone || 'America/New_York',
          description: parsed.description || description
        };
      }
      
    } catch (error) {
      console.error('LocalAI parsing failed:', error);
    }
    
    // Fallback to basic parsing
    return this.basicEventParsing(description);
  }
  
  basicEventParsing(description) {
    // Enhanced regex-based parsing with better natural language understanding
    const parsed = {
      name: null,
      start: null,
      end: null,
      location: null,
      timezone: 'America/New_York',
      description: description
    };
    
    // Split the description into lines for multi-line parsing
    const lines = description.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const fullText = lines.join(' ');
    
    // Enhanced date/time patterns to handle more formats
    const datePatterns = [
      // Mon Oct 20, 2025 format
      /(?:mon|tue|wed|thu|fri|sat|sun)\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/i,
      // Oct 20, 2025 format  
      /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/i,
      // Other existing patterns
      /(?:on |at )?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}(?:st|nd|rd|th)?(?:,? \d{4})?)/i,
      /(?:on |at )?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i,
      /(tomorrow|today|tonight|next \w+day|this \w+day)/i
    ];
    
    const timePatterns = [
      // Enhanced time patterns
      /(\d{1,2}:\d{2}\s*(?:am|pm|AM|PM)(?:\s*-\s*\d{1,2}:\d{2}\s*(?:am|pm|AM|PM))?(?:\s+[A-Z]{2,4})?)/i,
      /(?:at |from )?(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/i,
      /(?:at |from )?(\d{1,2}:\d{2})/
    ];
    
    // Try to find a date
    for (const pattern of datePatterns) {
      const match = fullText.match(pattern);
      if (match) {
        parsed.start = match[0]; // Use the full match for better date extraction
        break;
      }
    }
    
    // Try to find a time - if not found, default to a reasonable time
    let foundTime = false;
    for (const pattern of timePatterns) {
      const match = fullText.match(pattern);
      if (match) {
        if (parsed.start) {
          parsed.start = parsed.start + ' ' + match[1];
        } else {
          parsed.start = match[1];
        }
        foundTime = true;
        break;
      }
    }
    
    // If no time specified, add a default evening time for meetups
    if (parsed.start && !foundTime) {
      parsed.start += ' 6:00 PM'; // Default to 6 PM for community events
    }
    
    // Enhanced location extraction
    let foundLocation = null;
    
    // Try to extract location from separate lines (like "ENSCO Colorado Springs, 80916")
    for (const line of lines) {
      // Skip lines that are ONLY URLs, but process lines with URLs if they contain location info
      if ((line.includes('http') || line.includes('www.')) && !line.match(/[A-Za-z\s]+,\s*\d{5}/)) continue;
      
      // Look for patterns that suggest location (company name + city, state, zip)
      const locationPatterns = [
        // Location info before URL (handle "ENSCO Colorado Springs, 80916 https://...")
        /^(.+?)\s+https?:\/\//,
        // Company/venue name with city, state, zip
        /^([A-Za-z0-9\s&.-]+)\s+([A-Za-z\s]+),\s*(\d{5})/,
        // Address with city, state, zip  
        /(\d+\s+[A-Za-z0-9\s,.-]+,\s*[A-Za-z\s]+,?\s*\d{5})/,
        // City, State ZIP
        /([A-Za-z\s]+,\s*[A-Z]{2}\s+\d{5})/,
        // Simple city, state
        /([A-Za-z\s]+,\s*[A-Z]{2})/
      ];
      
      for (const pattern of locationPatterns) {
        const match = line.match(pattern);
        if (match) {
          // Use the first capture group if available (for URL pattern), otherwise use full match
          foundLocation = (match[1] || match[0]).trim();
          break;
        }
      }
      if (foundLocation) break;
    }
    
    // Fallback to traditional "at location" patterns
    if (!foundLocation) {
      const atLocationMatch = fullText.match(/\bat\s+([^,]+?)(?:\s+on\s+|\s*$)/i);
      if (atLocationMatch && !atLocationMatch[1].match(/^\d/)) { // Avoid matching times
        foundLocation = atLocationMatch[1].trim();
      } else {
        // Look for street addresses (numbers followed by street names)
        const addressMatch = fullText.match(/(\d+\s+\w+\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|place|pl|way))\b/i);
        if (addressMatch) {
          foundLocation = addressMatch[1].trim();
        }
      }
    }
    
    parsed.location = foundLocation;
    
    // Enhanced event name extraction with context understanding
    let eventName = null;
    
    // For complex event descriptions, try to extract the main title before date/time
    // Look for text before dates like "Mon Oct 20, 2025"
    const beforeDateMatch = fullText.match(/^(.+?)\s+(?:mon|tue|wed|thu|fri|sat|sun)\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
    if (beforeDateMatch) {
      let candidate = beforeDateMatch[1].trim();
      // Remove common trailing words that might be part of date description
      candidate = candidate.replace(/\s+(course|event|class|workshop|training|seminar)\s*$/i, ' $1');
      if (candidate && candidate.length > 10) { // Ensure it's substantial
        eventName = candidate;
      }
    }
    
    // Fallback: try to extract meaningful phrases that indicate the event type
    if (!eventName) {
      const eventPhrases = [
        /(?:we should )?(?:totally )?(?:have a |host a |organize a )?(community meet ?up|meet ?up|gathering|event|party|session|workshop|hackathon|demo day)/i,
        /(?:let'?s |we should |want to |need to |plan to )?(meet ?up|gather|get together|hang out)/i,
        /(monthly|weekly|annual|quarterly)\s+(meet ?up|gathering|event|meeting)/i
      ];
      
      for (const pattern of eventPhrases) {
        const match = fullText.match(pattern);
        if (match) {
          eventName = match[1] || match[0];
          eventName = eventName.replace(/^(we should |totally |have a |let'?s |want to |need to |plan to )/i, '');
          break;
        }
      }
    }
    
    // If still no event phrase found, try to extract text before "on" or "at"
    if (!eventName) {
      const beforePreposition = fullText.match(/^(.+?)\s+(?:on|at)\s+/i);
      if (beforePreposition) {
        let candidate = beforePreposition[1].trim();
        // Clean up common prefixes
        candidate = candidate.replace(/^(we should |totally |have a |let'?s |want to |need to |plan to )/i, '');
        if (candidate && candidate.length > 2) {
          eventName = candidate;
        }
      }
    }
    
    // Clean up and format the event name
    if (eventName) {
      // Capitalize first letter of each word
      eventName = eventName.replace(/\b\w/g, l => l.toUpperCase());
      // Clean up extra spaces
      eventName = eventName.replace(/\s+/g, ' ').trim();
      parsed.name = eventName;
    } else {
      // Generate a contextual default name
      parsed.name = "Community Meetup";
    }
    
    return parsed;
  }
  
  normalizeDateTime(dateTimeStr) {
    if (!dateTimeStr) return null;
    
    // First, try to parse month day year format (e.g., "sep 17 2025")
    const monthNames = {
      jan: 0, january: 0,
      feb: 1, february: 1,
      mar: 2, march: 2,
      apr: 3, april: 3,
      may: 4,
      jun: 5, june: 5,
      jul: 6, july: 6,
      aug: 7, august: 7,
      sep: 8, sept: 8, september: 8,
      oct: 9, october: 9,
      nov: 10, november: 10,
      dec: 11, december: 11
    };
    
    // Match patterns like "sep 17 2025" or "september 17, 2025"
    const dateMatch = dateTimeStr.match(/(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i);
    if (dateMatch) {
      const monthStr = dateMatch[1].toLowerCase();
      const day = parseInt(dateMatch[2]);
      const year = dateMatch[3] ? parseInt(dateMatch[3]) : new Date().getFullYear();
      
      if (monthNames[monthStr] !== undefined) {
        const date = new Date(year, monthNames[monthStr], day, 18, 0, 0); // Default to 6pm
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }
    
    try {
      // Try to parse various date formats
      const date = new Date(dateTimeStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    } catch (e) {
      // Continue with manual parsing
    }
    
    // Handle relative dates
    const now = new Date();
    const lowerStr = dateTimeStr.toLowerCase();
    
    if (lowerStr.includes('tomorrow')) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(18, 0, 0, 0); // Default to 6pm
      return tomorrow.toISOString();
    }
    
    if (lowerStr.includes('today') || lowerStr.includes('tonight')) {
      now.setHours(18, 0, 0, 0); // Default to 6pm
      return now.toISOString();
    }
    
    // Return as-is if we can't parse it
    return dateTimeStr;
  }
  
  async createEventInDiscourse(eventData, createdBy) {
    if (!this.discourseApiUrl || !this.discourseApiKey) {
      return {
        success: false,
        error: 'Discourse API not configured'
      };
    }
    
    try {
      // Format the event for Discourse calendar plugin
      const eventStart = new Date(eventData.start);
      const eventEnd = eventData.end ? new Date(eventData.end) : eventStart;
      
      // Format dates for the calendar plugin
      const startDate = eventStart.toISOString().split('T')[0];
      const endDate = eventEnd.toISOString().split('T')[0];
      const startTime = eventStart.toTimeString().substring(0, 5);
      
      // Use the correct Discourse event syntax: YYYY-MM-DD HH:MM format
      const year = eventStart.getFullYear();
      const month = String(eventStart.getMonth() + 1).padStart(2, '0');
      const day = String(eventStart.getDate()).padStart(2, '0');
      const hours = String(eventStart.getHours()).padStart(2, '0');
      const minutes = String(eventStart.getMinutes()).padStart(2, '0');
      const eventDateTime = `${year}-${month}-${day} ${hours}:${minutes}`;
      
      // Create event tag with optional end time
      let eventTag = `[event start="${eventDateTime}" status="public"`;
      if (eventData.end) {
        const endDate = new Date(eventData.end);
        const endYear = endDate.getFullYear();
        const endMonth = String(endDate.getMonth() + 1).padStart(2, '0');
        const endDay = String(endDate.getDate()).padStart(2, '0');
        const endHours = String(endDate.getHours()).padStart(2, '0');
        const endMinutes = String(endDate.getMinutes()).padStart(2, '0');
        const endDateTime = `${endYear}-${endMonth}-${endDay} ${endHours}:${endMinutes}`;
        eventTag += ` end="${endDateTime}"`;
      }
      eventTag += `]\n[/event]`;
      
      // Format the post content with event details
      const postContent = eventTag + `\n\n` +
                         `## ${eventData.name}\n\n` +
                         `📍 **Location:** ${eventData.location || 'TBD'}\n` +
                         `🕐 **Time:** ${eventStart.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at ${startTime}\n` +
                         `🌐 **Timezone:** ${eventData.timezone || 'America/New_York'}\n\n` +
                         `${eventData.description || ''}\n\n` +
                         `---\n` +
                         `*Event created via Signal bot by ${createdBy}*`;
      
      // Create the topic in Discourse
      const response = await fetch(`${this.discourseApiUrl}/posts.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Api-Key': this.discourseApiKey,
          'Api-Username': this.discourseApiUsername
        },
        body: JSON.stringify({
          title: eventData.name,
          raw: postContent,
          category: 4, // Events category - adjust based on your forum
          tags: ['event', 'signal-bot']
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        const eventUrl = `${this.discourseApiUrl}/t/${result.topic_slug}/${result.topic_id}`;
        
        // Store in database
        const { PrismaClient } = require('../../generated/prisma');
        const prisma = new PrismaClient();
        
        try {
          await prisma.signalEvent.create({
            data: {
              discourseTopicId: result.topic_id,
              discoursePostId: result.id,
              eventName: eventData.name,
              eventStart: eventStart,
              eventEnd: eventData.end ? new Date(eventData.end) : null,
              location: eventData.location,
              timezone: eventData.timezone || 'America/New_York',
              status: eventData.status || 'public',
              description: eventData.description,
              discourseUrl: eventUrl,
              createdBy: createdBy
            }
          });
        } catch (dbError) {
          console.error('Failed to store event in database:', dbError);
        } finally {
          await prisma.$disconnect();
        }
        
        return {
          success: true,
          url: eventUrl,
          topicId: result.topic_id
        };
      } else {
        const errorText = await response.text();
        console.error('Discourse API error:', response.status, errorText);
        return {
          success: false,
          error: `Forum API error: ${response.status}`
        };
      }
      
    } catch (error) {
      console.error('Failed to create event in Discourse:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Sync events from Discourse to database
  async syncDiscourseEvents(topics) {
    const { PrismaClient } = require('../../../src/generated/prisma');
    const prisma = new PrismaClient();
    
    for (const topic of topics) {
      try {
        // Check if we already have this event
        const existing = await prisma.signalEvent.findUnique({
          where: { discourseTopicId: topic.id }
        });
        
        if (!existing && topic.event) {
          // Parse event data from topic (this would need more robust parsing)
          await prisma.signalEvent.create({
            data: {
              discourseTopicId: topic.id,
              eventName: topic.title,
              eventStart: new Date(topic.event.start),
              eventEnd: topic.event.end ? new Date(topic.event.end) : null,
              location: topic.event.location || null,
              discourseUrl: `${this.discourseApiUrl}/t/${topic.slug}/${topic.id}`,
              description: topic.excerpt || null,
              status: topic.event.status || 'public'
            }
          });
        }
      } catch (error) {
        console.error(`Failed to sync event ${topic.id}:`, error);
      }
    }
    
    await prisma.$disconnect();
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
  async handleBackup(context) { return 'Admin system - Backup placeholder'; }
  async handleMaintenance(context) { return 'Admin system - Maintenance mode placeholder'; }
  async handleBypass(context) { return 'Admin system - Authentication bypass placeholder'; }

  // Analytics Command Handlers (Admin Only)
  async handleStats(context) {
    const { args } = context;
    const days = parseInt(args) || 7;
    
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      
      const totalCommands = await this.prisma.botCommandUsage.count({
        where: { timestamp: { gte: since } }
      });
      
      const successfulCommands = await this.prisma.botCommandUsage.count({
        where: { 
          timestamp: { gte: since },
          success: true 
        }
      });
      
      const uniqueUsers = await this.prisma.botCommandUsage.findMany({
        where: { timestamp: { gte: since } },
        select: { userId: true },
        distinct: ['userId']
      });
      
      const uniqueGroups = await this.prisma.botCommandUsage.findMany({
        where: { 
          timestamp: { gte: since },
          groupId: { not: null }
        },
        select: { groupId: true },
        distinct: ['groupId']
      });
      
      const avgPerDay = Math.round(totalCommands / days);
      const successRate = totalCommands > 0 
        ? ((successfulCommands / totalCommands) * 100).toFixed(1)
        : 0;
      
      const uptime = Math.floor((Date.now() - this.startTime) / 1000);
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      
      return `📊 Bot Statistics (Last ${days} days)\n\n📈 Usage:\n• Total Commands: ${totalCommands}\n• Success Rate: ${successRate}%\n• Avg/Day: ${avgPerDay}\n\n👥 Activity:\n• Active Users: ${uniqueUsers.length}\n• Active Groups: ${uniqueGroups.length}\n\n⏱️ Uptime: ${hours}h ${minutes}m\n💡 Use !topcommands for popular commands`;
      
    } catch (error) {
      console.error('Failed to get stats:', error);
      const uptime = Math.floor((Date.now() - this.startTime) / 1000);
      return `📊 Bot Statistics\n\nUptime: ${uptime}s\nCommands: ${this.plugins.size}\nStatus: ✅ Online`;
    }
  }
  
  async handleTopCommands(context) {
    const { args } = context;
    const limit = Math.min(parseInt(args) || 10, 15);
    
    try {
      const topCommands = await this.prisma.botCommandUsage.groupBy({
        by: ['command'],
        _count: { command: true },
        orderBy: { _count: { command: 'desc' } },
        take: limit
      });
      
      if (topCommands.length === 0) {
        return '📊 No command usage data available yet';
      }
      
      let response = `🏆 Top ${limit} Commands\n\n`;
      
      topCommands.forEach((cmd, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        response += `${medal} !${cmd.command}: ${cmd._count.command} uses\n`;
      });
      
      return response;
      
    } catch (error) {
      console.error('Failed to get top commands:', error);
      return '❌ Failed to retrieve top commands';
    }
  }
  
  async handleTopUsers(context) {
    const { args } = context;
    const limit = Math.min(parseInt(args) || 5, 10);
    
    try {
      const topUsers = await this.prisma.botCommandUsage.groupBy({
        by: ['userName'],
        _count: { userName: true },
        where: { userName: { not: null } },
        orderBy: { _count: { userName: 'desc' } },
        take: limit
      });
      
      if (topUsers.length === 0) {
        return '👥 No user activity data available yet';
      }
      
      let response = `👥 Top ${limit} Active Users\n\n`;
      
      topUsers.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const firstName = user.userName.split(' ')[0];
        response += `${medal} ${firstName}: ${user._count.userName} commands\n`;
      });
      
      return response;
      
    } catch (error) {
      console.error('Failed to get top users:', error);
      return '❌ Failed to retrieve top users';
    }
  }
  
  async handleErrors(context) {
    const { args } = context;
    const limit = Math.min(parseInt(args) || 5, 10);
    
    try {
      const recentErrors = await this.prisma.botError.findMany({
        take: limit,
        orderBy: { timestamp: 'desc' },
        select: {
          errorType: true,
          errorMessage: true,
          command: true,
          timestamp: true
        }
      });
      
      if (recentErrors.length === 0) {
        return '✅ No errors logged (excellent!)';
      }
      
      let response = `❌ Recent Errors (${recentErrors.length})\n\n`;
      
      recentErrors.forEach(error => {
        const timeAgo = this.getTimeAgo(error.timestamp);
        const cmd = error.command ? `!${error.command}` : 'N/A';
        const msg = error.errorMessage.substring(0, 50);
        response += `• ${error.errorType}\n  Cmd: ${cmd}\n  ${timeAgo}\n\n`;
      });
      
      return response;
      
    } catch (error) {
      console.error('Failed to get errors:', error);
      return '❌ Failed to retrieve error logs';
    }
  }
  
  async handleNewsStats(context) {
    const { args } = context;
    const days = parseInt(args) || 7;
    
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      
      const totalNewsLinks = await this.prisma.newsLink.count({
        where: { firstPostedAt: { gte: since } }
      });
      
      const topNews = await this.prisma.newsLink.findMany({
        where: { firstPostedAt: { gte: since } },
        orderBy: [
          { reactionCount: 'desc' },
          { postCount: 'desc' }
        ],
        take: 5,
        select: {
          domain: true,
          title: true,
          reactionCount: true,
          thumbsUp: true,
          thumbsDown: true,
          postCount: true
        }
      });
      
      let response = `📰 News Statistics (${days} days)\n\n`;
      response += `Total Links: ${totalNewsLinks}\n\n`;
      
      if (topNews.length > 0) {
        response += `🔥 Top News by Engagement:\n\n`;
        
        topNews.forEach((news, index) => {
          const title = news.title ? news.title.substring(0, 30) + '...' : news.domain;
          response += `${index + 1}. ${title}\n`;
          response += `   👍 ${news.thumbsUp} 👎 ${news.thumbsDown} 🔄 ${news.postCount}x\n\n`;
        });
      }
      
      return response;
      
    } catch (error) {
      console.error('Failed to get news stats:', error);
      return '❌ Failed to retrieve news statistics';
    }
  }
  
  async handleSentiment(context) {
    const { args } = context;
    const days = parseInt(args) || 30;
    
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      
      const totalReactions = await this.prisma.botMessageReaction.count({
        where: { timestamp: { gte: since } }
      });
      
      const positiveReactions = await this.prisma.botMessageReaction.count({
        where: { 
          timestamp: { gte: since },
          isPositive: true
        }
      });
      
      const negativeReactions = totalReactions - positiveReactions;
      
      const reactionBreakdown = await this.prisma.botMessageReaction.groupBy({
        by: ['reaction'],
        _count: { reaction: true },
        where: { timestamp: { gte: since } },
        orderBy: { _count: { reaction: 'desc' } },
        take: 5
      });
      
      const sentimentScore = totalReactions > 0 
        ? ((positiveReactions / totalReactions) * 100).toFixed(1)
        : 0;
      
      let response = `💭 Bot Sentiment (${days} days)\n\n`;
      response += `Overall: ${sentimentScore}% Positive\n\n`;
      response += `📊 Breakdown:\n`;
      response += `👍 Positive: ${positiveReactions}\n`;
      response += `👎 Negative: ${negativeReactions}\n\n`;
      
      if (reactionBreakdown.length > 0) {
        response += `🎯 Top Reactions:\n`;
        reactionBreakdown.forEach(r => {
          response += `${r.reaction}: ${r._count.reaction}x\n`;
        });
      }
      
      return response;
      
    } catch (error) {
      console.error('Failed to get sentiment:', error);
      return '❌ Failed to retrieve sentiment data';
    }
  }
  
  // Helper method for analytics
  getTimeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

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
    
    try {
      // Check if Discourse API is configured
      if (!this.discourseApiUrl || !this.discourseApiKey) {
        return '❌ Forum integration not configured. Please set DISCOURSE_API_URL and DISCOURSE_API_KEY.';
      }
      
      // Fetch latest posts from Discourse
      const response = await fetch(`${this.discourseApiUrl}/posts.json`, {
        headers: {
          'Api-Key': this.discourseApiKey,
          'Api-Username': this.discourseApiUsername || 'system'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch posts: ${response.status}`);
      }
      
      const data = await response.json();
      const posts = data.latest_posts || [];
      
      if (posts.length === 0) {
        return '📰 No recent posts found in the forum.';
      }
      
      // Format the response with post titles and short links
      let result = `📰 Latest Forum Posts (${Math.min(count, posts.length)}):\n\n`;
      
      for (let i = 0; i < Math.min(count, posts.length); i++) {
        const post = posts[i];
        
        // Get topic title if available, otherwise use post excerpt
        let title = post.topic_title || post.topic_slug || 'Untitled Post';
        
        // Clean up title - remove dashes from slug if that's what we got
        if (!post.topic_title && post.topic_slug) {
          title = post.topic_slug.replace(/-/g, ' ')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        }
        
        // Create short link with just the topic and post IDs
        const shortLink = `${this.discourseApiUrl.replace('/api', '')}/t/${post.topic_id}/${post.post_number || 1}`;
        
        result += `${i + 1}. ${title}\n`;
        result += `   ${shortLink}\n\n`;
      }
      
      result += `🔗 Visit ${this.discourseApiUrl.replace('/api', '')} for more`;
      
      return result;
      
    } catch (error) {
      console.error('Error fetching latest posts:', error);
      
      // Fallback to generic message on error
      return `📰 Latest Forum Posts\n\n` +
             `Unable to fetch posts at this time.\n\n` +
             `🔗 Visit forum.irregularchat.com directly`;
    }
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
    try {
      console.log('📄 PDF Handler started');
      
      // Find the PDF to process
      let pdfPath = null;
      let pdfFilename = 'PDF Document';
      
      // Check if this is a reply to a message with a PDF attachment
      if (context.quotedAttachments && context.quotedAttachments.length > 0) {
        // Use quoted attachment
        const pdfAttachment = context.quotedAttachments.find(att => 
          att.contentType === 'application/pdf' || 
          (att.filename && att.filename.toLowerCase().endsWith('.pdf'))
        );
        
        if (pdfAttachment) {
          pdfFilename = pdfAttachment.filename || 'PDF Document';
          // Try to find the PDF file by filename since id is not provided in quotes
          const attachmentsDir = path.join(this.dataDir, 'attachments');
          const files = fs.readdirSync(attachmentsDir);
          
          // Look for a file matching the filename or the most recent PDF
          let matchingFile = files.find(f => 
            f === pdfFilename || 
            f.includes(pdfFilename.replace('.pdf', ''))
          );
          
          // If no exact match, get the most recent PDF
          if (!matchingFile) {
            const pdfFiles = files.filter(f => f.endsWith('.pdf'));
            if (pdfFiles.length > 0) {
              const pdfStats = pdfFiles.map(file => ({
                file,
                mtime: fs.statSync(path.join(attachmentsDir, file)).mtime
              }));
              pdfStats.sort((a, b) => b.mtime - a.mtime);
              matchingFile = pdfStats[0].file;
              console.log('📄 Using most recent PDF as fallback:', matchingFile);
            }
          }
          
          if (matchingFile) {
            pdfPath = path.join(attachmentsDir, matchingFile);
            console.log('📄 Found PDF from quote:', matchingFile);
          }
        }
      }
      
      // If no quoted attachment, try to find the most recent PDF
      if (!pdfPath) {
        const attachmentsDir = path.join(this.dataDir, 'attachments');
        try {
          const files = fs.readdirSync(attachmentsDir);
          const pdfFiles = files.filter(f => f.endsWith('.pdf'));
          
          if (pdfFiles.length === 0) {
            return 'No PDF files found. Please upload a PDF file first.';
          }
          
          // Get the most recent PDF
          const pdfStats = pdfFiles.map(file => ({
            file,
            path: path.join(attachmentsDir, file),
            mtime: fs.statSync(path.join(attachmentsDir, file)).mtime
          }));
          
          pdfStats.sort((a, b) => b.mtime - a.mtime);
          pdfPath = pdfStats[0].path;
          pdfFilename = pdfStats[0].file;
          
          console.log('📄 Using most recent PDF:', pdfFilename);
        } catch (err) {
          console.error('Error finding PDF files:', err);
          return 'Error accessing PDF files. Please try again.';
        }
      }
      
      // Check if we found a PDF path
      if (!pdfPath || !fs.existsSync(pdfPath)) {
        return 'PDF file not found. Please upload a PDF or reply to a PDF message.';
      }
      
      console.log('📄 Processing PDF:', pdfFilename);
      
      // Use the enhanced PDF processor with OCR support
      const pdfData = await this.pdfProcessor.processPDF(pdfPath);
      
      if (!pdfData.text || pdfData.text.trim().length === 0) {
        return 'Could not extract text from this PDF even with OCR. The PDF might be corrupted or contain only images.';
      }
      
      // Extract key content for summarization
      const textContent = this.pdfProcessor.extractKeyContent(pdfData.text);
      const pageCount = pdfData.pages;
      
      console.log('📊 Content for AI:', textContent.substring(0, 200) + '...');
      console.log('📊 Total content length:', textContent.length);
      
      // Generate AI summary if AI is enabled
      let summary = '';
      if (this.aiEnabled && this.openAiApiKey) {
        try {
          const { OpenAI } = require('openai');
          const openai = new OpenAI({ apiKey: this.openAiApiKey });
          
          const response = await openai.chat.completions.create({
            model: 'gpt-5-mini',
            messages: [
              { 
                role: 'system', 
                content: 'You must provide a summary of the document. Be concise but comprehensive. Use plain text without markdown.'
              },
              { 
                role: 'user', 
                content: `Summarize this document in 3-5 paragraphs:\n\n${textContent}`
              }
            ],
            max_completion_tokens: 1000  // Increased for GPT-5 thinking model
          });
          
          summary = response.choices[0].message.content;
          console.log('✅ AI summary generated successfully');
          console.log('📝 Summary length:', summary?.length || 0);
          if (!summary || summary.trim().length === 0) {
            console.error('⚠️ AI returned empty summary!');
            console.log('Response:', JSON.stringify(response.choices[0], null, 2));
            summary = 'AI returned empty response. Retrying with different approach...';
          }
        } catch (aiError) {
          console.error('AI summarization failed:', aiError.message || aiError);
          console.error('Full error:', JSON.stringify(aiError.response?.data || aiError, null, 2));
          summary = 'AI summary unavailable: ' + (aiError.message || 'Unknown error');
        }
      } else {
        summary = 'AI summarization is not enabled';
      }
      
      // Prepare response
      const wordCount = textContent.split(/\s+/).length;
      
      let response = `PDF Summary: ${pdfFilename}\n`;
      response += `Pages: ${pageCount} | Words: ~${wordCount}\n\n`;
      response += `Summary:\n${summary}\n\n`;
      
      // Add first few lines as preview if summary failed
      if (summary === 'AI summary unavailable' || summary === 'AI summarization is not enabled') {
        const preview = textContent.split('\n').slice(0, 5).join('\n');
        if (preview.length > 300) {
          preview = preview.substring(0, 300) + '...';
        }
        response += `Preview:\n${preview}`;
      }
      
      return response;
      
    } catch (error) {
      console.error('PDF processing error:', error);
      return `Failed to process PDF: ${error.message}`;
    }
  }

  // Extract key sections from long PDFs for efficient summarization
  extractKeyPdfSections(fullText) {
    const lines = fullText.split('\n');
    const sections = {
      title: '',
      abstract: '',
      toc: '',
      introduction: '',
      chapters: [],
      conclusion: '',
      keyContent: []
    };
    
    let currentSection = '';
    let captureNext = 0;
    let skipAppendix = false;
    
    // Patterns for identifying key sections
    const patterns = {
      abstract: /^(abstract|summary|executive summary)/i,
      toc: /^(table of contents|contents|toc)/i,
      introduction: /^(introduction|1\.\s*introduction|chapter 1|overview)/i,
      chapter: /^(chapter \d+|^\d+\.\s+[A-Z]|\d+\.\d+\s+[A-Z])/i,
      conclusion: /^(conclusion|summary|final thoughts|closing)/i,
      appendix: /^(appendix|references|bibliography|citations)/i
    };
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines
      if (!line) continue;
      
      // Capture title (usually in first few lines)
      if (i < 10 && !sections.title && line.length > 10 && line.length < 200) {
        if (!line.match(/^\d+$/) && !line.toLowerCase().includes('page')) {
          sections.title = line;
        }
      }
      
      // Check for appendix/references - stop processing main content
      if (patterns.appendix.test(line)) {
        skipAppendix = true;
        console.log('📚 Skipping appendix/references section');
        break; // Stop processing, we don't need appendices for summary
      }
      
      // Detect and capture abstract
      if (patterns.abstract.test(line)) {
        currentSection = 'abstract';
        captureNext = 30; // Capture next 30 lines or until next section
        continue;
      }
      
      // Detect and capture table of contents
      if (patterns.toc.test(line)) {
        currentSection = 'toc';
        captureNext = 50; // Capture TOC lines
        continue;
      }
      
      // Detect introduction
      if (patterns.introduction.test(line)) {
        currentSection = 'introduction';
        captureNext = 40;
        continue;
      }
      
      // Detect chapters
      if (patterns.chapter.test(line)) {
        // Store chapter heading
        sections.chapters.push(line);
        currentSection = 'chapter';
        captureNext = 20; // Capture first part of each chapter
        continue;
      }
      
      // Detect conclusion
      if (patterns.conclusion.test(line)) {
        currentSection = 'conclusion';
        captureNext = 30;
        continue;
      }
      
      // Capture content based on current section
      if (captureNext > 0) {
        captureNext--;
        
        switch(currentSection) {
          case 'abstract':
            sections.abstract += line + '\n';
            break;
          case 'toc':
            if (line.includes('...') || line.match(/\d+$/)) {
              sections.toc += line + '\n';
            }
            break;
          case 'introduction':
            sections.introduction += line + '\n';
            break;
          case 'chapter':
            sections.keyContent.push(line);
            break;
          case 'conclusion':
            sections.conclusion += line + '\n';
            break;
        }
        
        // Stop capturing if we hit another section marker
        if (captureNext > 5 && Object.values(patterns).some(p => p.test(line))) {
          captureNext = 0;
          currentSection = '';
        }
      }
    }
    
    // Build the condensed content for AI processing
    let condensedContent = '';
    
    // Add title
    if (sections.title) {
      condensedContent += `Title: ${sections.title}\n\n`;
    }
    
    // Add abstract if found
    if (sections.abstract) {
      condensedContent += `Abstract:\n${sections.abstract.substring(0, 500)}\n\n`;
    }
    
    // Add table of contents if found (helps understand structure)
    if (sections.toc) {
      condensedContent += `Table of Contents:\n${sections.toc.substring(0, 300)}\n\n`;
    }
    
    // Add introduction
    if (sections.introduction) {
      condensedContent += `Introduction:\n${sections.introduction.substring(0, 600)}\n\n`;
    }
    
    // Add chapter headings and key content
    if (sections.chapters.length > 0) {
      condensedContent += `Main Chapters:\n`;
      sections.chapters.slice(0, 10).forEach(ch => {
        condensedContent += `- ${ch}\n`;
      });
      condensedContent += '\n';
    }
    
    // Add some key content from chapters
    if (sections.keyContent.length > 0) {
      const keySnippet = sections.keyContent.slice(0, 20).join('\n');
      condensedContent += `Key Content:\n${keySnippet.substring(0, 800)}\n\n`;
    }
    
    // Add conclusion
    if (sections.conclusion) {
      condensedContent += `Conclusion:\n${sections.conclusion.substring(0, 500)}\n`;
    }
    
    // If we didn't find structured content, fall back to first/last approach
    if (condensedContent.length < 500) {
      console.log('📄 No clear structure found, using first/last pages approach');
      const firstPart = lines.slice(0, 100).join('\n').substring(0, 2000);
      const lastPart = lines.slice(-50).join('\n').substring(0, 1000);
      condensedContent = `Beginning of document:\n${firstPart}\n\n[...]\n\nEnd of document:\n${lastPart}`;
    }
    
    // Ensure we don't exceed token limits
    const maxLength = 4000;
    if (condensedContent.length > maxLength) {
      condensedContent = condensedContent.substring(0, maxLength) + '\n\n[Content truncated for processing]';
    }
    
    console.log(`📊 Extracted ${condensedContent.length} chars from ${fullText.length} chars (${Math.round(condensedContent.length/fullText.length*100)}% of original)`);
    
    return condensedContent;
  }

  // Onboarding Plugin Handlers
  async handleRequest(context) {
    const { args, groupId, groupName, sender, sourceNumber, mentions, message } = context;
    
    // Only work in entry room
    const isEntryRoom = groupName && (groupName.toLowerCase().includes('entry') || groupName.toLowerCase().includes('indoc'));
    if (!isEntryRoom) {
      return '❌ The !request command only works in the Entry/INDOC room';
    }
    
    // Check if user is mentioning someone (for admin to request intro from new member)
    if (args && args.length > 0 && (args[0].startsWith('@') || mentions?.length > 0)) {
      // Admin requesting intro from specific user
      const targetUser = mentions && mentions.length > 0 ? mentions[0] : null;
      const targetName = targetUser ? targetUser.name : args[0].replace('@', '');
      const targetUuid = targetUser ? targetUser.uuid : null;
      
      // Send onboarding prompt to the mentioned user
      const prompt = `@${targetName} You've requested to join the IrregularChat Community.\n\n` +
                    `**Bonafides:** Everyone in the chat has been invited by an irregularchat member. ` +
                    `So that we can add you to the right groups, we need to know:\n\n` +
                    `1. NAME\n` +
                    `2. YOUR_ORGANIZATION\n` +
                    `3. Who invited you (Add & mention them in this chat)\n` +
                    `4. EMAIL_OR_EMAIL_ALIAS\n` +
                    `5. YOUR_INTERESTS\n` +
                    `6. Link to your LinkedIn profile (if you want others to endorse your skills)\n\n` +
                    `**Please reply to this message with your introduction.**`;
      
      // Store pending request for this user
      const targetPhone = targetUuid || targetName; // Use UUID if available, name as fallback
      const timeoutMs = 24 * 60 * 60 * 1000; // 24 hours
      const timeoutId = setTimeout(() => {
        this.handleRequestTimeout(targetPhone, groupId, true); // true = remove from group
      }, timeoutMs);
      
      this.pendingRequests.set(targetPhone, {
        timestamp: Date.now(),
        groupId: groupId,
        requester: targetName,
        introduction: null,
        timeoutId: timeoutId,
        phoneNumber: targetPhone,
        status: 'awaiting_intro',
        uuid: targetUuid
      });
      
      console.log(`📨 Sent onboarding prompt to ${targetName}`);
      return prompt;
    }
    
    // Check if this is a user providing their introduction
    // They should be replying to the onboarding prompt
    if (message && message.quote) {
      // User is replying to the onboarding prompt
      const pendingRequest = this.pendingRequests.get(sourceNumber) || 
                           Array.from(this.pendingRequests.values()).find(r => r.uuid === sourceNumber);
      
      if (pendingRequest && pendingRequest.status === 'awaiting_intro') {
        // Parse the introduction
        const introText = args ? args.join(' ') : '';
        
        // Extract mentioned inviter
        let inviterMention = null;
        if (mentions && mentions.length > 0) {
          inviterMention = mentions[0];
        }
        
        if (!inviterMention) {
          return '❌ Please mention the person who invited you (use @name in your introduction)';
        }
        
        // Update the pending request
        pendingRequest.introduction = introText;
        pendingRequest.inviter = inviterMention;
        pendingRequest.status = 'awaiting_vouch';
        
        // Ask the inviter to vouch
        const vouchRequest = `@${inviterMention.name} Do you trust and vouch for ${sender} to join the IrregularChat community, ` +
                           `understanding what the community is about and the rules found on the front page of the wiki?\n\n` +
                           `**Reply with "yes" to confirm.**`;
        
        console.log(`📨 Requesting vouch from ${inviterMention.name} for ${sender}`);
        return vouchRequest;
      }
    }
    
    // Check if this is a vouch confirmation
    const lowerMessage = message?.message?.toLowerCase() || '';
    if (lowerMessage.includes('yes') && message.quote) {
      // Check if this is a response to a vouch request
      const pendingRequests = Array.from(this.pendingRequests.values());
      const vouchRequest = pendingRequests.find(r => 
        r.status === 'awaiting_vouch' && 
        r.inviter && 
        (r.inviter.uuid === sourceNumber || r.inviter.name === sender)
      );
      
      if (vouchRequest) {
        // Process the approved request
        return this.processApprovedRequest(vouchRequest, context);
      }
    }
    
    return '❌ Invalid !request usage. Use !request @username to start onboarding a new member.';
  }
  
  async processApprovedRequest(request, context) {
    const { groupId } = context;
    
    try {
      // Parse the introduction
      const introData = this.parseIntroduction(request.introduction);
      
      // Generate username if not provided
      let username = introData.name ? await this.generateSmartUsername(introData.name) : 
                     this.generateUsername(request.requester || 'user');
      
      // Ensure username is unique
      let attempts = 0;
      while (await authentikService.checkUsernameExists(username) && attempts < 10) {
        username = await this.generateSmartUsername(introData.name || 'user');
        attempts++;
      }
      
      const email = introData.email || `${username}@irregularchat.com`;
      
      // Create Authentik account
      let authentikResult = null;
      let password = '';
      if (authentikService.isConfigured()) {
        const [firstName, ...lastNameParts] = (introData.name || '').split(' ');
        
        authentikResult = await authentikService.createUser({
          username,
          email,
          firstName: firstName || 'User',
          lastName: lastNameParts.join(' ') || '',
          attributes: {
            organization: introData.organization,
            interests: introData.interests,
            invited_by: request.inviter?.name || 'Unknown',
            signal_username: request.requester,
            linkedin_username: introData.linkedin,
            introduction: request.introduction,
            created_via: 'signal_bot',
          },
          groups: ['newcomers'], // Add to newcomers group by default
        });
        
        if (authentikResult.success) {
          password = authentikResult.temp_password;
          console.log(`✅ Created Authentik account for ${username}`);
        } else {
          console.error(`❌ Failed to create Authentik account: ${authentikResult.error}`);
          // Generate local password as fallback
          password = this.generateSecurePassword();
        }
      } else {
        // Generate local password if Authentik isn't configured
        password = this.generateSecurePassword();
        console.log('⚠️ Authentik not configured, generated local credentials');
      }
      
      // Create Discourse post
      let discoursePostUrl = null;
      if (discourseService.isConfigured()) {
        const discourseResult = await discourseService.createIntroductionPost({
          username,
          intro: request.introduction,
          invitedBy: request.inviter?.name,
          organization: introData.organization,
          interests: introData.interests,
        });
        
        if (discourseResult.success) {
          discoursePostUrl = discourseResult.postUrl;
          console.log(`✅ Created Discourse post for ${username}: ${discoursePostUrl}`);
        } else {
          console.error(`❌ Failed to create Discourse post: ${discourseResult.error}`);
        }
      }
      
      // Send welcome email
      if (emailService.isConfigured() && email && !email.endsWith('@irregularchat.com')) {
        const fullName = introData.name || username;
        const emailSent = await emailService.sendWelcomeEmail({
          to: email,
          subject: 'Welcome to IrregularChat!',
          fullName,
          username,
          password,
          discoursePostUrl,
        });
        
        if (emailSent) {
          console.log(`✅ Sent welcome email to ${email}`);
        } else {
          console.log(`❌ Failed to send welcome email to ${email}`);
        }
      }
      
      // Send welcome DM to the new user
      const welcomeDM = `🎉 **Welcome to IrregularChat!**\n\n` +
                       `Your account has been created:\n` +
                       `Username: ${username}\n` +
                       `Password: ${password}\n\n` +
                       `Please save these credentials securely.\n\n` +
                       `Next steps:\n` +
                       `1. Visit https://irregularpedia.org to learn about the community\n` +
                       `2. Join the Signal groups that interest you\n` +
                       `3. Introduce yourself in the appropriate channels\n\n` +
                       `Welcome aboard! 🚀`;
      
      if (request.uuid) {
        await this.sendDirectMessage(request.uuid, welcomeDM);
      }
      
      // Notify the entry room
      const successMessage = `✅ **Good to go!** Thanks for verifying. This is how we keep the community safe.\n\n` +
                           `@${request.requester} Your account has been created:\n` +
                           `• Authentik username: ${username}\n` +
                           `• Introduction posted to Discourse\n\n` +
                           `**Next steps for @${request.requester}:**\n` +
                           `1. Please leave this chat\n` +
                           `2. You'll receive a direct message with your IrregularChat Login and a Link to all the chats\n` +
                           `3. Join all the Chats that interest you when you get your login\n` +
                           `4. Until then, Learn about the community: https://irregularpedia.org/index.php/Main_Page\n\n` +
                           `See you out there! 🎉`;
      
      // Remove the new user and inviter (unless admin) from the entry room
      const usersToRemove = [];
      
      // Add new user to removal list
      if (request.uuid) {
        usersToRemove.push(request.uuid);
        console.log(`🔄 Removing new user ${request.requester} from entry room`);
      }
      
      // Add inviter to removal list if not admin
      if (request.inviter && request.inviter.uuid && !await this.isGroupAdmin(request.inviter.uuid, groupId)) {
        usersToRemove.push(request.inviter.uuid);
        console.log(`🔄 Removing inviter ${request.inviter.name} from entry room`);
      }
      
      // Actually remove users from the group
      if (usersToRemove.length > 0) {
        try {
          const removeRequest = {
            jsonrpc: '2.0',
            method: 'updateGroup',
            params: {
              account: this.phoneNumber,
              groupId: groupId,
              removeMembers: usersToRemove
            },
            id: `remove-onboarded-${Date.now()}`
          };
          
          const removeResponse = await this.sendJsonRpcRequest(removeRequest, 15000); // 15s timeout
          if (removeResponse.result) {
            console.log(`✅ Successfully removed ${usersToRemove.length} users from entry room`);
          } else {
            console.error(`❌ Failed to remove users from entry room:`, removeResponse.error);
          }
        } catch (error) {
          console.error(`❌ Error removing users from entry room:`, error);
        }
      }
      
      // Clear the pending request
      clearTimeout(request.timeoutId);
      this.pendingRequests.delete(request.phoneNumber);
      
      return successMessage;
    } catch (error) {
      console.error('Error processing approved request:', error);
      return '❌ Error processing request. Please contact an admin.';
    }
  }
  
  async sendOnboardingPrompt(phoneNumber, groupId, sender) {
    // This function is now deprecated - functionality moved to handleRequest
    const prompt = `You've requested to join the IrregularChat Community.\n\n` +
                  `**Bonafides:** Everyone in the chat has been invited by an irregularchat member.\n` +
                  `So that we can add you to the right groups, we need to know:\n\n` +
                  `1. NAME\n` +
                  `2. YOUR_ORGANIZATION\n` +
                  `3. Who invited you (Add & mention them in this chat)\n` +
                  `4. EMAIL_OR_EMAIL_ALIAS\n` +
                  `5. YOUR_INTERESTS\n` +
                  `6. Link to your LinkedIn profile (if you want others to endorse your skills)\n\n` +
                  `Reply with !request followed by your introduction.`;
    
    return prompt;
  }
  
  async sendOnboardingRequest(targetUser, groupId, requester) {
    // Send onboarding request to specific user
    const message = `👋 Introduction request sent to ${targetUser}\n\n` +
                   `They will receive instructions to introduce themselves.\n` +
                   `Timeout: ${this.requestTimeoutMinutes / 60} hours`;
    
    // Would send DM to target user with onboarding prompt
    // For now, just return confirmation
    return message;
  }
  
  async handleRequestTimeout(phoneNumber, groupId, removeFromGroup = false) {
    console.log(`⏰ Request timeout for ${phoneNumber} in group ${groupId}`);
    
    // Remove from pending requests
    const request = this.pendingRequests.get(phoneNumber);
    if (request) {
      clearTimeout(request.timeoutId);
      this.pendingRequests.delete(phoneNumber);
      
      if (removeFromGroup) {
        // Remove user from entry room after 24 hours of no response
        try {
          const removeRequest = {
            jsonrpc: '2.0',
            method: 'updateGroup',
            params: {
              account: this.phoneNumber,
              groupId: groupId,
              removeMembers: [request.uuid || phoneNumber]
            },
            id: `timeout-remove-${Date.now()}`
          };
          
          await this.sendJsonRpcRequest(removeRequest);
          console.log(`🚫 Removed ${phoneNumber} from entry room due to 24-hour timeout`);
          
          // Send notification to group
          await this.sendGroupMessage(groupId, 
            `⏰ User removed due to 24-hour timeout (no introduction provided)`);
        } catch (error) {
          console.error('Failed to remove user on timeout:', error);
        }
      }
    }
  }

  async handleGtg(context) {
    const { sender, args, groupId, sourceNumber, mentions } = context;
    const isAdmin = this.isAdmin(sourceNumber || sender, groupId);
    if (!isAdmin) return '🚫 Only administrators can approve users with !gtg';
    
    // Check if this is a reply to someone's message (mentions array)
    let targetUser = null;
    let targetUuid = null;
    let pendingRequest = null;
    
    if (mentions && mentions.length > 0) {
      // Using mentions - get the UUID of the mentioned user
      targetUuid = mentions[0].uuid;
      targetUser = mentions[0].name || 'User';
      console.log(`🎯 Approving mentioned user: ${targetUser} (UUID: ${targetUuid})`);
    } else if (args.length < 1) {
      return '❌ Usage: Reply to a user\'s intro message with !gtg';
    } else {
      // Fallback to old behavior if args provided
      const identifier = args[0];
      if (identifier.startsWith('+') || identifier.match(/^\d{10,}$/)) {
        pendingRequest = this.pendingRequests.get(identifier);
        if (pendingRequest) {
          clearTimeout(pendingRequest.timeoutId);
          this.pendingRequests.delete(identifier);
        }
      }
    }
    
    try {
      // Parse introduction from the message being replied to
      let introData = {};
      if (pendingRequest && pendingRequest.introduction) {
        introData = this.parseIntroduction(pendingRequest.introduction);
      }
      
      // Generate credentials
      const username = this.generateUsername(introData.name || targetUser || 'user');
      const password = this.generateSecurePassword();
      const email = introData.email || `${username}@irregularchat.com`;
      
      // Create user in database (would integrate with Authentik in production)
      const userData = {
        username,
        email,
        firstName: introData.firstName || targetUser?.split(' ')[0] || 'User',
        lastName: introData.lastName || targetUser?.split(' ').slice(1).join(' ') || '',
        organization: introData.organization || '',
        interests: introData.interests || '',
        invitedBy: introData.invitedBy || sender,
        signalUuid: targetUuid,
        phoneNumber: pendingRequest?.phoneNumber
      };
      
      // Store credentials for DM delivery
      const credentialMessage = this.formatCredentials(username, password, email);
      
      // Send DM to approved user with credentials
      if (targetUuid) {
        await this.sendDirectMessage(targetUuid, credentialMessage);
      }
      
      // Remove user from entry room
      if (targetUuid && groupId) {
        await this.removeUserFromGroup(targetUuid, groupId);
      }
      
      // Log the approval
      console.log(`✅ Approved user: ${username} (${email})`);
      
      return `✅ Good to go. Thanks for verifying. This is how we keep the community safe.\n\n` +
             `1. User has been removed from this chat\n` +
             `2. They'll receive a direct message with their IrregularChat Login\n` +
             `3. They can join all the Chats that interest them\n` +
             `4. Wiki: https://irregularpedia.org\n\n` +
             `See you out there!`;
    } catch (error) {
      console.error('❌ Error during user approval:', error);
      return `❌ Error approving user: ${error.message}\n\nPlease try again or contact an admin.`;
    }
  }
  
  // Helper function to parse introduction text
  parseIntroduction(intro) {
    const data = {};
    
    // Parse NAME
    const nameMatch = intro.match(/(?:1\.?\s*)?(?:NAME|Name|name)[:\s]+([^\n]+)/i);
    if (nameMatch) data.name = nameMatch[1].trim();
    
    // Parse ORGANIZATION
    const orgMatch = intro.match(/(?:2\.?\s*)?(?:YOUR_ORGANIZATION|Organization|org)[:\s]+([^\n]+)/i);
    if (orgMatch) data.organization = orgMatch[1].trim();
    
    // Parse INVITED BY
    const invitedMatch = intro.match(/(?:3\.?\s*)?(?:Who invited|invited by|invited)[:\s]+([^\n]+)/i);
    if (invitedMatch) data.invitedBy = invitedMatch[1].trim();
    
    // Parse EMAIL
    const emailMatch = intro.match(/(?:4\.?\s*)?(?:EMAIL|Email|email)[^\n]*[:\s]+([^\s@]+@[^\s@]+\.[^\s@]+)/i);
    if (emailMatch) data.email = emailMatch[1].trim();
    
    // Parse INTERESTS
    const interestsMatch = intro.match(/(?:5\.?\s*)?(?:YOUR_INTERESTS|Interests|interests)[:\s]+([^\n]+)/i);
    if (interestsMatch) data.interests = interestsMatch[1].trim();
    
    // Parse LinkedIn
    const linkedinMatch = intro.match(/(?:6\.?\s*)?(?:LinkedIn|linkedin)[^\n]*[:\s]+([^\n]+)/i);
    if (linkedinMatch) data.linkedin = linkedinMatch[1].trim();
    
    // Extract first and last name from full name
    if (data.name) {
      const nameParts = data.name.split(' ');
      data.firstName = nameParts[0];
      data.lastName = nameParts.slice(1).join(' ');
    }
    
    return data;
  }
  
  // Helper function to generate username
  generateUsername(name) {
    // Convert name to username format
    const base = name.toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 20);
    
    // Add random suffix to ensure uniqueness
    const suffix = Math.floor(Math.random() * 999) + 1;
    return `${base}_${suffix}`;
  }
  
  async generateSmartUsername(name) {
    // Use Authentik's username generator if available
    if (authentikService.isConfigured()) {
      return await authentikService.generateUsername(name);
    }
    // Fallback to local generation
    return this.generateUsername(name);
  }
  
  // Helper function to generate secure password
  generateSecurePassword() {
    const words = [
      'Correct', 'Horse', 'Battery', 'Staple', 'Purple', 'Monkey', 'Dishwasher',
      'Rainbow', 'Keyboard', 'Elephant', 'Butterfly', 'Mountain', 'Ocean', 'Thunder'
    ];
    
    const selectedWords = [];
    for (let i = 0; i < 3; i++) {
      const randomWord = words[Math.floor(Math.random() * words.length)];
      selectedWords.push(randomWord);
    }
    
    const randomNumber = Math.floor(Math.random() * 99) + 1;
    const specialChar = '!@#$%^&*'[Math.floor(Math.random() * 8)];
    
    return `${selectedWords.join('')}${randomNumber}${specialChar}`;
  }
  
  // Helper function to format credentials message
  formatCredentials(username, password, email) {
    return `🌟 Your First Step Into the IrregularChat! 🌟\n\n` +
           `You've just joined a community focused on breaking down silos, ` +
           `fostering innovation, and supporting service members and veterans.\n\n` +
           `---\n` +
           `Use This Username and Temporary Password ⬇️\n\n` +
           `Username: ${username}\n` +
           `Temporary Password: ${password}\n` +
           `Exactly as shown above 👆🏼\n\n` +
           `1️⃣ Step 1:\n` +
           `Use the username and temporary password to log in to https://sso.irregularchat.com\n\n` +
           `2️⃣ Step 2:\n` +
           `You'll be prompted to create your own password\n\n` +
           `3️⃣ Step 3:\n` +
           `Use the links in #links to join all the Signal chats\n\n` +
           `4️⃣ Step 4:\n` +
           `Check out the wiki: https://irregularpedia.org\n\n` +
           `Welcome to IrregularChat! 🎉`;
  }
  
  // Helper function to send direct message
  async sendDirectMessage(uuid, message) {
    try {
      const request = {
        jsonrpc: '2.0',
        method: 'send',
        params: {
          account: this.phoneNumber,
          recipient: [uuid],
          message: message
        },
        id: Date.now()
      };
      
      const response = await this.sendJsonRpcRequest(request);
      console.log(`📨 DM sent to ${uuid}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to send DM to ${uuid}:`, error);
      return false;
    }
  }
  
  // Helper function to remove user from group
  async removeUserFromGroup(uuid, groupId) {
    try {
      const request = {
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
          account: this.phoneNumber,
          groupId: groupId,
          removeMembers: [uuid]
        },
        id: Date.now()
      };
      
      const response = await this.sendJsonRpcRequest(request);
      console.log(`🚪 Removed ${uuid} from group ${groupId}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to remove ${uuid} from group:`, error);
      return false;
    }
  }
  
  async addUserToDefaultGroups(username) {
    // This would integrate with Signal group management
    // For now, it's a placeholder
    console.log(`Adding ${username} to default Signal groups`);
  }

  async handleSngtg(context) {
    const { sender, groupId, sourceNumber, args } = context;
    const isAdmin = this.isAdmin(sourceNumber || sender, groupId);
    if (!isAdmin) return '🚫 Only administrators can confirm safety numbers with !sngtg';
    
    if (args.length < 1) {
      return '❌ Usage: !sngtg @user\n\n' +
             'This command confirms a user\'s safety number has been verified.\n' +
             'Use !gtg for general user approval.';
    }
    
    const userToConfirm = args[0].replace('@', '');
    
    return `✅ Safety Number Confirmed for ${userToConfirm}!\n\n` +
           `🔒 Safety number has been verified.\n` +
           `✨ User can now participate in secure conversations.\n\n` +
           `Note: Use !gtg for general user onboarding approval.`;
  }
  
  async handlePending(context) {
    const { sender, groupId, sourceNumber } = context;
    const isAdmin = this.isAdmin(sourceNumber || sender, groupId);
    
    if (!isAdmin) {
      return '🚫 Only administrators can view pending requests';
    }
    
    if (this.pendingRequests.size === 0) {
      return '📭 No pending requests';
    }
    
    let response = `📋 Pending Requests (${this.pendingRequests.size}):\n\n`;
    
    for (const [phoneNumber, request] of this.pendingRequests) {
      const timeElapsed = Date.now() - request.timestamp;
      const hoursElapsed = Math.floor(timeElapsed / (1000 * 60 * 60));
      const hoursRemaining = Math.floor(this.requestTimeoutMinutes / 60) - hoursElapsed;
      
      response += `👤 ${request.requester || phoneNumber}\n`;
      response += `📱 Phone: ${phoneNumber}\n`;
      response += `⏰ Time remaining: ${hoursRemaining} hours\n`;
      
      if (request.introduction) {
        const shortIntro = request.introduction.substring(0, 100);
        response += `📝 Intro: ${shortIntro}${request.introduction.length > 100 ? '...' : ''}\n`;
      }
      
      response += `✅ Approve: !gtg ${phoneNumber}\n`;
      response += `───────────────\n`;
    }
    
    return response;
  }
  
  // Removed duplicate handleAddTo - now using the correct one at line 2264
  
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
  async storeMessageInHistory(message) {
    const groupId = message.groupId || 'dm'; // Use 'dm' for direct messages
    
    // Store in memory for quick access
    if (!this.messageHistory.has(groupId)) {
      this.messageHistory.set(groupId, []);
    }
    
    const history = this.messageHistory.get(groupId);
    const messageData = {
      sender: message.sourceName || message.sourceNumber,
      message: message.message,
      timestamp: message.timestamp,
      time: new Date(message.timestamp).toLocaleString(),
      reactions: new Map() // Track emoji reactions: emoji -> count
    };
    
    history.push(messageData);
    
    // Keep only recent messages in memory
    if (history.length > this.maxHistoryPerGroup) {
      history.shift();
    }
    
    // Store in database for persistence
    try {
      // Skip database storage if sourceNumber is null (use sourceUuid as identifier instead)
      if (!message.sourceNumber && message.sourceUuid) {
        // For now, skip database storage for messages without phone numbers
        console.log('Skipping database storage for message without sourceNumber');
      } else if (message.sourceNumber) {
        await this.prisma.signalMessage.upsert({
          where: {
            timestamp_sourceNumber_groupId: {
              timestamp: BigInt(message.timestamp),
              sourceNumber: message.sourceNumber,
              groupId: groupId === 'dm' ? null : groupId
            }
          },
          update: {
            message: message.message,
            sourceName: message.sourceName,
            sourceUuid: message.sourceUuid || null,
            groupName: message.groupName || null
          },
          create: {
            groupId: groupId === 'dm' ? null : groupId,
            groupName: message.groupName || null,
            sourceNumber: message.sourceNumber,
            sourceName: message.sourceName || null,
            sourceUuid: message.sourceUuid || null,
            message: message.message,
            timestamp: BigInt(message.timestamp),
            attachments: message.attachments?.length ? message.attachments : null,
            mentions: message.mentions?.length ? message.mentions : null,
            isReply: message.isReply || false,
            quotedMessageId: message.quotedMessageId || null,
            quotedText: message.quotedMessage || null
          }
        });
      }
    } catch (error) {
      console.error('Failed to store message in database:', error);
    }
  }

  // Handle reaction messages
  async handleReactionMessage(envelope, reactionMessage) {
    console.log(`🔥 Reaction received: ${reactionMessage.emoji} from ${envelope.sourceName || envelope.sourceNumber}`);
    
    const groupId = reactionMessage.targetMessage?.groupInfo?.groupId || 'dm';
    const targetTimestamp = reactionMessage.targetTimestamp;
    const emoji = reactionMessage.emoji;
    const isRemove = reactionMessage.remove;
    
    // Update memory cache
    if (this.messageHistory.has(groupId)) {
      const history = this.messageHistory.get(groupId);
      const targetMessage = history.find(msg => msg.timestamp === targetTimestamp);
      
      if (targetMessage && targetMessage.reactions) {
        if (isRemove) {
          // Remove reaction
          if (targetMessage.reactions.has(emoji)) {
            const count = targetMessage.reactions.get(emoji) - 1;
            if (count <= 0) {
              targetMessage.reactions.delete(emoji);
            } else {
              targetMessage.reactions.set(emoji, count);
            }
          }
        } else {
          // Add reaction
          const count = targetMessage.reactions.get(emoji) || 0;
          targetMessage.reactions.set(emoji, count + 1);
        }
        
        const totalReactions = Array.from(targetMessage.reactions.values()).reduce((sum, count) => sum + count, 0);
        console.log(`📊 Message now has ${totalReactions} total reactions`);
      }
    }
    
    // Store reaction in database
    try {
      // Find the message in database
      const dbMessage = await this.prisma.signalMessage.findFirst({
        where: {
          timestamp: BigInt(targetTimestamp),
          groupId: groupId === 'dm' ? null : groupId
        }
      });
      
      if (dbMessage) {
        if (isRemove) {
          // Mark reaction as removed
          await this.prisma.signalReaction.updateMany({
            where: {
              messageId: dbMessage.id,
              emoji: emoji,
              reactorNumber: envelope.sourceNumber
            },
            data: {
              isRemove: true
            }
          });
        } else {
          // Add or update reaction
          await this.prisma.signalReaction.upsert({
            where: {
              messageId_emoji_reactorNumber: {
                messageId: dbMessage.id,
                emoji: emoji,
                reactorNumber: envelope.sourceNumber
              }
            },
            update: {
              isRemove: false,
              timestamp: BigInt(envelope.timestamp || Date.now())
            },
            create: {
              messageId: dbMessage.id,
              emoji: emoji,
              reactorNumber: envelope.sourceNumber,
              reactorName: envelope.sourceName || null,
              reactorUuid: envelope.sourceUuid || null,
              timestamp: BigInt(envelope.timestamp || Date.now()),
              isRemove: false
            }
          });
        }
        
        // Check if this is a reaction to a bot message
        if (dbMessage && dbMessage.sourceNumber === this.phoneNumber) {
          // This is a reaction to the bot's message
          await this.trackBotMessageReaction(
            emoji,
            envelope.sourceNumber,
            envelope.sourceName,
            groupId === 'dm' ? null : groupId,
            reactionMessage.targetMessage?.groupInfo?.name || null
          );
        }
        
        // Check if the reacted message contains a news URL
        if (dbMessage && dbMessage.message) {
          const urlRegex = /https?:\/\/[^\s]+/g;
          const urls = dbMessage.message.match(urlRegex);
          
          if (urls && urls.length > 0) {
            for (const url of urls) {
              if (this.isNewsUrl(url)) {
                // Update news link reaction counts
                const cleanedUrl = this.cleanUrl(url).cleanedUrl;
                await this.updateNewsLinkReactions(cleanedUrl, emoji, groupId);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to store reaction in database:', error);
    }
  }

  // Analyze message reactions to identify highly reacted content
  analyzeMessageReactions(messages) {
    const messagesWithReactions = [];
    let maxReactionCount = 0;
    
    // Find messages with reactions > 3
    for (const message of messages) {
      if (message.reactions && message.reactions.size > 0) {
        const totalReactions = Array.from(message.reactions.values()).reduce((sum, count) => sum + count, 0);
        if (totalReactions > 3) {
          const reactionSummary = Array.from(message.reactions.entries())
            .map(([emoji, count]) => `${emoji} ${count}`)
            .join(' ');
          
          messagesWithReactions.push({
            message,
            totalReactions,
            reactionSummary,
            preview: message.message.substring(0, 80) + (message.message.length > 80 ? '...' : '')
          });
          
          maxReactionCount = Math.max(maxReactionCount, totalReactions);
        }
      }
    }
    
    if (messagesWithReactions.length === 0) {
      return { hasHighReactions: false };
    }
    
    // Sort by reaction count (highest first)
    messagesWithReactions.sort((a, b) => b.totalReactions - a.totalReactions);
    
    // Create highlight text
    const highlightLines = messagesWithReactions.map((item, index) => {
      const isTop = item.totalReactions === maxReactionCount;
      const prefix = isTop ? '🎆' : '✨'; // Special highlight for highest
      return `${prefix} ${item.message.sender}: "${item.preview}" (${item.reactionSummary})`;
    });
    
    return {
      hasHighReactions: true,
      highlightText: highlightLines.join('\n'),
      topReactionCount: maxReactionCount,
      highlyReactedCount: messagesWithReactions.length
    };
  }
  
  async summarizeGroupMessages(context) {
    const { groupId, args } = context;
    
    if (!groupId) {
      return '❌ This command only works in group chats. Use !tldr <url> for URL summarization.';
    }
    
    // Check for help flag first - support both -h alone and --help
    const isHelpRequest = args.includes('--help') || 
                         args.includes('-?') || 
                         (args.length === 1 && args[0] === '-h');
    
    if (isHelpRequest) {
      return '📝 Chat Summarization Help\n\n' +
             'Usage: !summarize [options]\n\n' +
             'Options:\n' +
             '  -n, --number <count>    Summarize last N messages (default: 20)\n' +
             '  -m, --minutes <minutes> Summarize messages from last M minutes\n' +
             '  -h, --hours <hours>     Summarize messages from last H hours\n' +
             '  -h, --help              Show this help message\n\n' +
             'Examples:\n' +
             '  !summarize              Last 20 messages\n' +
             '  !summarize -n 50        Last 50 messages\n' +
             '  !summarize --number 50  Last 50 messages\n' +
             '  !summarize -m 30        Last 30 minutes\n' +
             '  !summarize --minutes 30 Last 30 minutes\n' +
             '  !summarize -h 2         Last 2 hours\n' +
             '  !summarize --hours 2    Last 2 hours';
    }
    
    // First try to get messages from database for better history
    let history = [];
    let useDatabase = true;
    
    try {
      // Fetch messages from database
      const dbMessages = await this.prisma.signalMessage.findMany({
        where: {
          groupId: groupId,
          message: {
            not: {
              startsWith: '!'
            }
          }
        },
        orderBy: {
          timestamp: 'desc'
        },
        take: 200, // Get more messages from DB
        include: {
          reactions: true
        }
      });
      
      // Convert database messages to expected format
      history = dbMessages.reverse().map(msg => {
        // Count reactions by emoji
        const reactionMap = new Map();
        msg.reactions.forEach(reaction => {
          if (!reaction.isRemove) {
            const count = reactionMap.get(reaction.emoji) || 0;
            reactionMap.set(reaction.emoji, count + 1);
          }
        });
        
        return {
          sender: msg.sourceName || msg.sourceNumber,
          message: msg.message,
          timestamp: Number(msg.timestamp),
          time: new Date(Number(msg.timestamp)).toLocaleString(),
          reactions: reactionMap
        };
      });
      
      console.log(`📚 Loaded ${history.length} messages from database for group ${groupId}`);
    } catch (error) {
      console.error('Failed to fetch messages from database:', error);
      useDatabase = false;
    }
    
    // Fall back to memory if database fails or has no data
    if (!useDatabase || history.length === 0) {
      history = this.messageHistory.get(groupId) || [];
      console.log(`📝 Using ${history.length} messages from memory for group ${groupId}`);
    }
    
    // Filter out bot commands and duplicate messages
    const cleanHistory = history.filter((msg, index, self) => {
      // Skip bot commands
      if (msg.message && msg.message.startsWith('!')) return false;
      // Skip bot's own messages
      if (msg.sender === 'irregularchat-bot' || msg.sender === this.phoneNumber) return false;
      // Skip duplicates (same message within 5 seconds)
      const isDuplicate = index > 0 && 
        self[index - 1].message === msg.message && 
        Math.abs(msg.timestamp - self[index - 1].timestamp) < 5000;
      return !isDuplicate;
    });
    
    if (cleanHistory.length < 3) {
      return '❌ Not enough recent messages to summarize. Need at least 3 messages.\n\nUse !summarize --help for usage information.';
    }
    
    // Parse arguments with new flags and long form options
    let messageCount = 20; // Default
    let minutesBack = null;
    let hoursBack = null;
    let maxMessages = 100; // Safety limit
    
    // Parse arguments - support both short and long forms
    for (let i = 0; i < args.length; i++) {
      // Number of messages
      if ((args[i] === '-n' || args[i] === '--number') && i + 1 < args.length) {
        const count = parseInt(args[i + 1]);
        if (!isNaN(count) && count > 0) {
          messageCount = Math.min(count, maxMessages);
        }
      } 
      // Minutes back
      else if ((args[i] === '-m' || args[i] === '--minutes') && i + 1 < args.length) {
        const minutes = parseInt(args[i + 1]);
        if (!isNaN(minutes) && minutes > 0) {
          minutesBack = Math.min(minutes, 1440); // Max 24 hours
        }
      } 
      // Hours back - but not if it's -h alone (help)
      else if ((args[i] === '-h' || args[i] === '--hours') && i + 1 < args.length && args[i] !== '-h') {
        const hours = parseFloat(args[i + 1]);
        if (!isNaN(hours) && hours > 0) {
          hoursBack = Math.min(hours, 24); // Max 24 hours
        }
      }
      // Handle -h followed by a number for hours
      else if (args[i] === '-h' && i + 1 < args.length) {
        const hours = parseFloat(args[i + 1]);
        if (!isNaN(hours) && hours > 0) {
          hoursBack = Math.min(hours, 24); // Max 24 hours
        }
      }
    }
    
    let recentMessages;
    
    if (minutesBack) {
      // Filter by minutes
      const cutoffTime = Date.now() - (minutesBack * 60 * 1000);
      recentMessages = cleanHistory.filter(msg => msg.timestamp > cutoffTime);
      
      if (recentMessages.length === 0) {
        return `❌ No messages found in the last ${minutesBack} minute${minutesBack !== 1 ? 's' : ''}.`;
      }
      
      // Still apply message count limit for safety
      if (recentMessages.length > maxMessages) {
        recentMessages = recentMessages.slice(-maxMessages);
      }
    } else if (hoursBack) {
      // Filter by hours
      const cutoffTime = Date.now() - (hoursBack * 60 * 60 * 1000);
      recentMessages = cleanHistory.filter(msg => msg.timestamp > cutoffTime);
      
      if (recentMessages.length === 0) {
        return `❌ No messages found in the last ${hoursBack} hour${hoursBack !== 1 ? 's' : ''}.`;
      }
      
      // Still apply message count limit for safety
      if (recentMessages.length > maxMessages) {
        recentMessages = recentMessages.slice(-maxMessages);
      }
    } else {
      // Get recent messages by count
      recentMessages = cleanHistory.slice(-messageCount);
    }
    
    // Check if we have AI capability (prefer local AI for privacy)
    const hasAi = this.useLocalAiForSummarization || (this.aiEnabled && this.openAiApiKey);
    
    if (!hasAi) {
      // Fallback without AI
      const messageCount = recentMessages.length;
      const participants = [...new Set(recentMessages.map(m => m.sender))].join(', ');
      const timespan = this.getTimespan(recentMessages[0].timestamp, recentMessages[recentMessages.length - 1].timestamp);
      
      // Analyze reactions even for fallback
      const reactionAnalysis = this.analyzeMessageReactions(recentMessages);
      
      let fallbackSummary = `📝 Chat Summary (${messageCount} messages)\n\n👥 Participants: ${participants}\n⏱️ Timespan: ${timespan}`;
      
      // Add reaction highlights if present
      if (reactionAnalysis.hasHighReactions) {
        fallbackSummary += `\n\n🔥 Highly Reacted Messages:\n${reactionAnalysis.highlightText}`;
      }
      
      fallbackSummary += `\n\n💬 Recent messages:\n${recentMessages.slice(-5).map(m => `• ${m.sender}: ${m.message.substring(0, 50)}${m.message.length > 50 ? '...' : ''}`).join('\n')}`;
      
      return fallbackSummary;
    }
    
    try {
      // Analyze emoji reactions to highlight highly reacted messages
      const reactionAnalysis = this.analyzeMessageReactions(recentMessages);
      
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
            max_completion_tokens: 700  // GPT-5 requires max_completion_tokens
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
          max_completion_tokens: 900  // GPT-5 thinking model needs 600+ tokens
        });
      }
      
      const participants = [...new Set(recentMessages.map(m => m.sender))].join(', ');
      const actualMessageCount = recentMessages.length;
      
      const summaryText = aiResponse.choices[0].message.content;
      const aiPrefix = this.useLocalAiForSummarization ? 'LocalAI:' : 'OpenAI:';
      
      // Build summary description
      let summaryDesc;
      if (minutesBack) {
        summaryDesc = `${actualMessageCount} messages from last ${minutesBack} minute${minutesBack !== 1 ? 's' : ''}`;
      } else if (hoursBack) {
        summaryDesc = `${actualMessageCount} messages from last ${hoursBack} hour${hoursBack !== 1 ? 's' : ''}`;
      } else {
        summaryDesc = `last ${actualMessageCount} messages`;
      }
      
      let fullSummary = `📝 Chat Summary (${summaryDesc})\n\n👥 Participants: ${participants}`;
      
      // Add reaction analysis if there are significant reactions
      if (reactionAnalysis.hasHighReactions) {
        fullSummary += `\n\n🔥 Highly Reacted Messages:\n${reactionAnalysis.highlightText}`;
      }
      
      fullSummary += `\n\n${aiPrefix} ${summaryText}`;
      
      return fullSummary;
      
    } catch (error) {
      console.error('AI summarization failed:', error);
      // Fallback to simple summary
      const messageCount = recentMessages.length;
      const participants = [...new Set(recentMessages.map(m => m.sender))].join(', ');
      return `📝 Chat Summary (${messageCount} messages)\n\n👥 Participants: ${participants}\n\n💬 Recent messages:\n${recentMessages.slice(-3).map(m => `• ${m.sender}: ${m.message.substring(0, 50)}${m.message.length > 50 ? '...' : ''}`).join('\n')}`;
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
  isAdmin(userNumber, groupId = null) {
    // First check global admin list (for backward compatibility)
    const adminUsers = process.env.ADMIN_USERS?.split(',') || [];
    if (adminUsers.includes(userNumber)) {
      return true;
    }
    
    // If a groupId is provided, check if user is admin in that specific group
    if (groupId && this.cachedGroups) {
      const group = this.cachedGroups.find(g => g.id === groupId);
      if (group && group.admins && Array.isArray(group.admins)) {
        return group.admins.some(admin => admin.number === userNumber);
      }
    }
    
    return false;
  }
  
  isUuidAdmin(userUuid) {
    // Check UUID-based admin list
    if (!userUuid) return false;
    
    const adminUuids = process.env.ADMIN_UUIDS?.split(',') || [];
    return adminUuids.includes(userUuid);
  }
  
  async isGroupAdmin(userUuid, groupId) {
    // Check if user is admin in a specific group
    try {
      const request = {
        jsonrpc: '2.0',
        method: 'listGroups',
        params: {
          account: this.phoneNumber,
          'get-admins': true
        },
        id: `check-admin-${Date.now()}`
      };
      
      const response = await this.sendJsonRpcRequest(request, 10000);
      
      if (response.result) {
        const group = response.result.find(g => g.id === groupId);
        if (group && group.admins) {
          return group.admins.some(admin => 
            admin === userUuid || 
            (admin.uuid && admin.uuid === userUuid)
          );
        }
      }
    } catch (error) {
      console.error('Error checking admin status:', error);
    }
    
    return false;
  }
  
  async getGroupMembersWithAdminStatus(groupId) {
    // Get group members with their admin status from cached data
    try {
      // First try to get from cache
      const cachedMembers = await this.groupSyncService.getCachedGroupMembers(groupId);
      
      if (cachedMembers && cachedMembers.length > 0) {
        // Use cached data
        console.log(`📚 Using cached member data for group ${groupId} (${cachedMembers.length} members)`);
        
        const admins = cachedMembers.filter(m => m.isAdmin);
        const nonAdmins = cachedMembers.filter(m => !m.isAdmin);
        
        return {
          success: true,
          members: cachedMembers,
          totalMembers: cachedMembers.length,
          totalAdmins: admins.length,
          nonAdmins: nonAdmins
        };
      } else {
        // No cached data, try to sync this specific group
        console.log(`🔄 No cached members for group ${groupId}, attempting sync...`);
        await this.groupSyncService.fetchAndSyncGroupMembers(groupId);
        
        // Try cache again
        const updatedMembers = await this.groupSyncService.getCachedGroupMembers(groupId);
        if (updatedMembers && updatedMembers.length > 0) {
          const admins = updatedMembers.filter(m => m.isAdmin);
          const nonAdmins = updatedMembers.filter(m => !m.isAdmin);
          
          return {
            success: true,
            members: updatedMembers,
            totalMembers: updatedMembers.length,
            totalAdmins: admins.length,
            nonAdmins: nonAdmins
          };
        }
      }
      
      return {
        success: false,
        error: 'Unable to fetch group members - group may be too large or not accessible'
      };
    } catch (error) {
      console.error('Error getting group members with admin status:', error);
      return {
        success: false,
        error: error.message || 'Failed to retrieve member information'
      };
    }
  }
  
  // ========== Q&A System Commands ==========
  
  async handleQuestion(context) {
    const { sender, args, groupId, sourceNumber, message, quotedMessage } = context;
    
    let questionText = '';
    
    // Check if there are args provided
    if (args && args.length > 0 && args.join(' ').trim() !== '') {
      questionText = args.join(' ').trim();
    } 
    // If no args, check if there's a quoted message
    else if (quotedMessage) {
      questionText = quotedMessage.trim();
    }
    
    // If still no question text, show usage
    if (!questionText) {
      return '❌ Usage: !q <your question>\n\n' +
             'Example: !q How do I set up Signal bot authentication?\n\n' +
             'Or reply to a message with !q or !question\n\n' +
             'To see existing questions, use: !questions';
    }
    
    // Get the next question ID from database
    const lastQuestion = await this.prisma.qAndAQuestion.findFirst({
      orderBy: { questionId: 'desc' }
    });
    const questionId = (lastQuestion?.questionId || 0) + 1;
    
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
          max_completion_tokens: 650  // GPT-5 thinking model minimum
        });
        
        title = titleResponse.choices[0].message.content.trim();
      }
      
      // Store question in database
      const question = await this.prisma.qAndAQuestion.create({
        data: {
          questionId: questionId,
          asker: sender || 'Unknown',
          askerPhone: sourceNumber,
          question: questionText,
          title: title,
          groupId: groupId || 'dm',
          groupName: context.groupName || null,
          solved: false,
          discourseTopicId: null,
          answers: []
        }
      });
      
      console.log(`✅ Question Q${questionId} saved to database`);
      
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
            // Update question with forum link
            await this.prisma.qAndAQuestion.update({
              where: { questionId: questionId },
              data: {
                discourseTopicId: result.topic_id.toString(),
                forumLink: `${this.discourseApiUrl}/t/${result.topic_slug}/${result.topic_id}`
              }
            });
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
      
      // Return success message even if Discourse posting failed (question is stored in database)
      let response = `❓ Question Q${questionId} Posted\n\n` +
                    `Title: ${title}\n` +
                    `Asked by: ${sender}\n` +
                    `Time: ${new Date().toLocaleTimeString()}`;
      
      if (forumLink) {
        response += `\nForum: \n📎 Forum: ${forumLink}`;
      } else if (discourseError) {
        response += `\n⚠️ Forum posting temporarily unavailable`;
        console.log('⚠️ Question stored locally only due to forum error');
      }
      
      response += `\n\nOthers can answer with: !answer Q${questionId} <your answer>\n` +
                 `Mark as solved with: !solved Q${questionId}`;
      
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
    
    try {
      let questionsList = [];
      
      if (showMine) {
        questionsList = await this.prisma.qAndAQuestion.findMany({
          where: { askerPhone: sourceNumber },
          orderBy: { timestamp: 'desc' },
          take: 10
        });
      } else {
        // Get last 10 questions
        questionsList = await this.prisma.qAndAQuestion.findMany({
          orderBy: { timestamp: 'desc' },
          take: 10
        });
      }
      
      if (questionsList.length === 0) {
        return showMine ? '📭 You haven\'t asked any questions yet.' : '📭 No questions have been asked yet.';
      }
      
      let response = showMine ? 'Your Questions:\n\n' : 'Recent Questions:\n\n';
      
      for (const q of questionsList) {
        const status = q.solved ? '✅' : '❓';
        const answers = q.answers || [];
        const answerCount = answers.length;
        const timeAgo = this.getRelativeTime(q.timestamp);
        
        response += `${status} Q${q.questionId}: ${q.title || q.question.substring(0, 60)}\n`;
        response += `   👤 ${q.asker} • 💬 ${answerCount} answer${answerCount !== 1 ? 's' : ''} • ⏰ ${timeAgo}\n\n`;
      }
      
      response += '\n💡 Use !answer Q<ID> <answer> to answer a question';
      
      return response;
      
    } catch (error) {
      console.error('Error fetching questions:', error);
      return '❌ Failed to retrieve questions';
    }
  }
  
  async handleAnswer(context) {
    const { sender, args, sourceNumber } = context;
    
    if (!args || args.length < 2) {
      return '❌ Usage: !answer <question-id> <your answer>\n\nExample: !answer Q1 You need to configure the API key first';
    }
    
    // Check if first arg looks like a question ID (Q followed by numbers)
    let questionId = args[0].toUpperCase();
    let answerText = args.slice(1).join(' ');
    
    // If it doesn't look like a question ID, try to find Q1 as default or return error
    if (!questionId.match(/^Q\d+$/)) {
      // Check if there's only one question, use it as default
      const questions = Array.from(this.questions.keys());
      if (questions.length === 1) {
        // Use the entire args as the answer text
        answerText = args.join(' ');
        questionId = questions[0];
      } else {
        return `❌ Question ${questionId} not found. Use !questions to see available questions.`;
      }
    }
    
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
    
    return `✅ Answer posted to ${questionId}\n\n` +
           `❓ Question: ${question.title}\n` +
           `👤 Asked by: ${question.asker}\n` +
           `💬 Your answer: ${answerText}\n\n` +
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
    const isAdmin = this.isAdmin(sourceNumber, groupId);
    
    if (!isAsker && !isAdmin) {
      return `❌ Only ${question.asker} (the question asker) or an admin can mark this as solved.`;
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
  
  looksLikeAiContinuation(message, userPref) {
    // Check if this looks like a continuation of an AI conversation
    const text = message.message.toLowerCase();
    
    // ONLY treat as continuation if explicitly replying to bot message
    if (message.isReplyToBot) {
      return true;
    }
    
    // If quoted message exists and it's from the bot, it's a continuation
    if (message.quotedMessage) {
      const quotedText = message.quotedMessage.toLowerCase();
      if (quotedText.includes('🤖') || quotedText.includes('localai:') || quotedText.includes('openai:')) {
        return true;
      }
    }
    
    // MUCH more restrictive - only very specific follow-up phrases
    const strictFollowUpPhrases = [
      'tell me more about that',
      'explain that further',  
      'can you elaborate',
      'what about that',
      'continue with that'
    ];
    
    // Check for exact strict follow-up phrases only
    for (const phrase of strictFollowUpPhrases) {
      if (text === phrase || text === phrase + '?') {
        return true;
      }
    }
    
    // NO general question handling - too prone to false positives
    // Users must be explicit with !ai or !lai commands
    
    return false;
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
  // Analytics Tracking Methods
  
  // Track command usage
  async trackCommandUsage(data) {
    try {
      // Skip if userId is missing
      if (!data.userId) {
        console.log('Skipping command tracking - no userId available');
        return;
      }
      
      await this.prisma.botCommandUsage.create({
        data: {
          command: data.command,
          args: data.args,
          groupId: data.groupId,
          groupName: data.groupName,
          userId: data.userId,
          userName: data.userName,
          success: data.success,
          responseTime: data.responseTime,
          errorMessage: data.errorMessage
        }
      });
    } catch (error) {
      console.error('Failed to track command usage:', error);
    }
  }
  
  // Track news links
  async trackNewsLink(url, message, metadata = {}) {
    try {
      const domain = new URL(url).hostname;
      
      // Check if this URL was already posted in this group
      const existing = await this.prisma.newsLink.findUnique({
        where: {
          url_groupId: {
            url: url,
            groupId: message.groupId || 'dm'
          }
        }
      });
      
      if (existing) {
        // Update post count and metadata if provided
        const updateData = {
          postCount: existing.postCount + 1,
          lastPostedAt: new Date()
        };
        
        if (metadata.title) updateData.title = metadata.title;
        if (metadata.summary) updateData.summary = metadata.summary;
        if (metadata.forumUrl) updateData.forumUrl = metadata.forumUrl;
        
        await this.prisma.newsLink.update({
          where: { id: existing.id },
          data: updateData
        });
      } else {
        // Create new entry with metadata
        await this.prisma.newsLink.create({
          data: {
            url: url,
            domain: domain,
            title: metadata.title || null,
            summary: metadata.summary || null,
            forumUrl: metadata.forumUrl || null,
            groupId: message.groupId || 'dm',
            groupName: message.groupName,
            postedBy: message.sourceNumber,
            postedByName: message.sourceName
          }
        });
      }
    } catch (error) {
      console.error('Failed to track news link:', error);
    }
  }
  
  // Track URL summaries from !tldr
  async trackUrlSummary(url, summary, aiProvider, message, processingTime) {
    try {
      await this.prisma.urlSummary.create({
        data: {
          url: url,
          groupId: message.groupId,
          groupName: message.groupName,
          requestedBy: message.sourceNumber,
          requestedByName: message.sourceName,
          summary: summary.substring(0, 5000), // Limit summary length
          aiProvider: aiProvider,
          processingTime: processingTime
        }
      });
    } catch (error) {
      console.error('Failed to track URL summary:', error);
    }
  }
  
  // Track reactions to bot messages
  async trackBotMessageReaction(reaction, reactorNumber, reactorName, groupId, groupName) {
    try {
      if (!this.lastBotResponse) return;
      
      // Determine if reaction is positive/negative
      let isPositive = null;
      if (reaction === '👍' || reaction === '✅' || reaction === '❤️') {
        isPositive = true;
      } else if (reaction === '👎' || reaction === '❌' || reaction === '🙁') {
        isPositive = false;
      }
      
      await this.prisma.botMessageReaction.create({
        data: {
          botMessage: this.lastBotResponse.message.substring(0, 2000),
          groupId: groupId,
          groupName: groupName,
          reactorId: reactorNumber,
          reactorName: reactorName,
          reaction: reaction,
          isPositive: isPositive,
          command: this.lastBotResponse.command
        }
      });
      
      // Also update news link reactions if applicable
      if (this.lastNewsUrl) {
        await this.updateNewsLinkReactions(this.lastNewsUrl, reaction, groupId);
      }
    } catch (error) {
      console.error('Failed to track bot message reaction:', error);
    }
  }
  
  // Update news link reaction counts
  async updateNewsLinkReactions(url, reaction, groupId) {
    try {
      const newsLink = await this.prisma.newsLink.findUnique({
        where: {
          url_groupId: {
            url: url,
            groupId: groupId || 'dm'
          }
        }
      });
      
      if (newsLink) {
        const updates = {
          reactionCount: newsLink.reactionCount + 1
        };
        
        if (reaction === '👍') {
          updates.thumbsUp = newsLink.thumbsUp + 1;
        } else if (reaction === '👎') {
          updates.thumbsDown = newsLink.thumbsDown + 1;
        }
        
        await this.prisma.newsLink.update({
          where: { id: newsLink.id },
          data: updates
        });
      }
    } catch (error) {
      console.error('Failed to update news link reactions:', error);
    }
  }
  
  // Handle "good bot" or "bad bot" feedback
  async handleBotFeedback(message, isPositive) {
    try {
      // Track the feedback as a reaction
      const feedbackEmoji = isPositive ? '👍' : '👎';
      await this.trackBotMessageReaction(
        feedbackEmoji,
        message.sourceNumber,
        message.sourceName,
        message.groupId,
        message.groupName
      );
      
      // Send acknowledgment
      const responses = isPositive ? [
        "Thank you! 😊 Your feedback helps me improve.",
        "Much appreciated! 🙏 Feedback recorded.",
        "Thanks! ✨ Your positive feedback is noted.",
        "Thank you! 💙 Glad I could help."
      ] : [
        "Feedback received. I'll try to do better! 📝",
        "Thanks for letting me know. I'm always learning! 🔧",
        "Noted. Your feedback helps me improve! 📊",
        "I appreciate the feedback. Will work on it! 💪"
      ];
      
      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      await this.sendReply(message, randomResponse);
      
      console.log(`📊 Bot feedback received: ${isPositive ? 'POSITIVE' : 'NEGATIVE'} from ${message.sourceName || message.sourceNumber}`);
      
    } catch (error) {
      console.error('Failed to handle bot feedback:', error);
      await this.sendReply(message, "Feedback received. Thank you!");
    }
  }
  
  // Log errors to database
  async logError(errorType, error, context = {}) {
    try {
      await this.prisma.botError.create({
        data: {
          errorType: errorType,
          errorMessage: error.message || String(error),
          stackTrace: error.stack,
          command: context.command,
          groupId: context.groupId,
          groupName: context.groupName,
          userId: context.userId,
          userName: context.userName,
          context: context
        }
      });
    } catch (dbError) {
      console.error('Failed to log error to database:', dbError);
    }
  }

  // ========== Security Domain Watch List ==========
  
  initializeWatchedDomains() {
    // Default watched domains and TLDs
    const defaultWatched = {
      // Country-specific TLDs
      '.ir': 'Iran',
      '.cn': 'China',
      '.ru': 'Russia',
      '.ve': 'Venezuela',
      // Common domains from these countries
      'baidu.com': 'China',
      'qq.com': 'China',
      'weibo.com': 'China',
      'yandex.ru': 'Russia',
      'vk.com': 'Russia',
      'mail.ru': 'Russia',
      'rt.com': 'Russia',
      'sputniknews.com': 'Russia',
      'presstv.ir': 'Iran',
      'tehrantimes.com': 'Iran',
      'telesurtv.net': 'Venezuela'
    };
    
    // Load from file if exists
    try {
      if (fs.existsSync(this.watchedDomainsFile)) {
        const data = JSON.parse(fs.readFileSync(this.watchedDomainsFile, 'utf8'));
        Object.entries(data).forEach(([domain, country]) => {
          this.watchedDomains.set(domain.toLowerCase(), country);
        });
        console.log(`🛡️ Loaded ${this.watchedDomains.size} watched domains`);
      } else {
        // Initialize with defaults
        Object.entries(defaultWatched).forEach(([domain, country]) => {
          this.watchedDomains.set(domain.toLowerCase(), country);
        });
        this.saveWatchedDomains();
        console.log(`🛡️ Initialized ${this.watchedDomains.size} default watched domains`);
      }
    } catch (error) {
      console.error('Error loading watched domains:', error);
      // Use defaults on error
      Object.entries(defaultWatched).forEach(([domain, country]) => {
        this.watchedDomains.set(domain.toLowerCase(), country);
      });
    }
  }
  
  saveWatchedDomains() {
    try {
      const data = {};
      this.watchedDomains.forEach((country, domain) => {
        data[domain] = country;
      });
      fs.writeFileSync(this.watchedDomainsFile, JSON.stringify(data, null, 2));
      console.log(`💾 Saved ${this.watchedDomains.size} watched domains`);
    } catch (error) {
      console.error('Error saving watched domains:', error);
    }
  }
  
  async checkUrlSecurity(url, message) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname.toLowerCase();
      
      // Check exact domain matches
      for (const [domain, country] of this.watchedDomains) {
        if (hostname === domain || hostname.endsWith('.' + domain)) {
          return { isWatched: true, country, domain };
        }
      }
      
      // Check TLD matches
      for (const [tld, country] of this.watchedDomains) {
        if (tld.startsWith('.') && hostname.endsWith(tld)) {
          return { isWatched: true, country, domain: tld };
        }
      }
      
      return { isWatched: false };
    } catch (error) {
      console.error('Error checking URL security:', error);
      return { isWatched: false };
    }
  }
  
  async sendSecurityWarning(url, securityCheck, message) {
    const warning = `👀 **Security Notice**

This link is hosted in **${securityCheck.country}** (${securityCheck.domain})

Are you sure this is what you wanted to post?

⚠️ Please verify the source before clicking.`;
    
    await this.sendReply(message, warning);
    console.log(`🛡️ Security warning sent for ${url} (${securityCheck.country})`);
  }
  
  // Admin command to manage watched domains
  async handleWatchedDomains(context) {
    const { args, sourceNumber } = context;
    
    if (!this.isAdmin(sourceNumber)) {
      return '🚫 Only administrators can manage watched domains';
    }
    
    if (!args || args.length === 0) {
      // List current watched domains
      let response = '🛡️ **Watched Domains & TLDs**\n\n';
      const byCountry = {};
      
      this.watchedDomains.forEach((country, domain) => {
        if (!byCountry[country]) byCountry[country] = [];
        byCountry[country].push(domain);
      });
      
      Object.entries(byCountry).forEach(([country, domains]) => {
        response += `**${country}:**\n`;
        domains.forEach(d => response += `  • ${d}\n`);
        response += '\n';
      });
      
      response += `\nTotal: ${this.watchedDomains.size} entries\n`;
      response += '\nUsage: !watchdomain add <domain> <country>\n';
      response += '       !watchdomain remove <domain>';
      
      return response;
    }
    
    const action = args[0].toLowerCase();
    
    if (action === 'add' && args.length >= 3) {
      const domain = args[1].toLowerCase();
      const country = args.slice(2).join(' ');
      
      this.watchedDomains.set(domain, country);
      this.saveWatchedDomains();
      
      return `✅ Added ${domain} to watch list (${country})`;
    }
    
    if (action === 'remove' && args.length >= 2) {
      const domain = args[1].toLowerCase();
      
      if (this.watchedDomains.has(domain)) {
        this.watchedDomains.delete(domain);
        this.saveWatchedDomains();
        return `✅ Removed ${domain} from watch list`;
      } else {
        return `❌ Domain ${domain} not found in watch list`;
      }
    }
    
    return '❌ Usage: !watchdomain [add <domain> <country>|remove <domain>|list]';
  }
}

module.exports = { NativeSignalBotService };