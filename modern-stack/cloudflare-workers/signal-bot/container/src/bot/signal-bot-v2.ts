/**
 * Signal Bot V2 - JSON-RPC Edition
 *
 * Updated bot implementation using signal-cli's JSON-RPC interface over TCP
 * for better performance and reliability.
 *
 * Key improvements over V1:
 * - Uses JSON-RPC protocol (no config file locking issues)
 * - Automatic reconnection on connection loss
 * - Better error handling and logging
 * - Cloudflare R2 integration for persistent storage
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { WorkerAPIClient } from '../api/worker-api-client.js';
import { CommandHandler } from './command-handler.js';
import { SignalJsonRpcClient } from './signal-jsonrpc-client.js';
import { processMessageURLs } from '../utils/url-security.js';
import { extractURLs } from '../utils/url-security.js';
import { detectNewsUrls, extractDomain } from '../utils/news-detector.js';
import { isSocialMediaUrl, getSocialMediaPlatform, removeTrackers, getContentType, formatUrlForDisplay } from '../utils/social-media-detector.js';
import { downloadContent, isYtDlpInstalled } from '../utils/social-media-downloader.js';
import { EmojiReactionHandler } from '../utils/emoji-reaction-handler.js';
import { DebugLogger } from '../utils/debug-logger.js';
import { PostgresClient } from '../db/postgres-client.js';
import { postNewsArticleToDiscourse, getDiscourseConfig } from '../utils/discourse-poster.js';

/**
 * Get web.archive.org link - checks for existing archive, falls back to save link
 * @param url Original URL to archive
 * @returns Archive URL (existing snapshot or save link)
 */
async function getArchiveLink(url: string): Promise<string> {
  try {
    // Query Web Archive Availability API
    const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const response = await fetch(apiUrl, {
      headers: { 'User-Agent': 'SignalBot/3.0' },
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });

    if (!response.ok) {
      console.log(`⚠️ Web Archive API returned ${response.status}, using save link`);
      return `https://web.archive.org/save/${url}`;
    }

    const data = await response.json() as any;

    // Check if archived snapshots exist
    if (data.archived_snapshots?.closest?.available && data.archived_snapshots.closest.url) {
      const archivedUrl = data.archived_snapshots.closest.url;
      console.log(`✅ Found existing Web Archive snapshot: ${archivedUrl}`);
      return archivedUrl;
    }

    // No archive exists, return save link
    console.log(`📎 No existing Web Archive snapshot, using save link`);
    return `https://web.archive.org/save/${url}`;

  } catch (error) {
    console.error('Web Archive API error:', error);
    // Fallback to save link on error
    return `https://web.archive.org/save/${url}`;
  }
}

export interface BotConfig {
  phoneNumber: string;
  dataDir: string;
  workerApiUrl: string;
  workerApiToken?: string;
  openAiApiKey?: string;
  openAiActive?: boolean;
  localAiUrl?: string;
  localAiApiKey?: string;
  discourseApiUrl?: string;
  discourseApiKey?: string;
  discourseApiUsername?: string;
}

export interface SignalMessage {
  envelope: {
    source?: string;
    sourceNumber?: string;
    sourceUuid?: string;
    sourceName?: string;
    timestamp?: number;
    dataMessage?: {
      timestamp?: number;
      message?: string;
      groupInfo?: {
        groupId?: string;
        type?: string;
      };
      mentions?: any[];
      attachments?: any[];
      quote?: {
        id?: number;
        author?: string;
        text?: string;
      };
    };
    editMessage?: {
      targetSentTimestamp?: number;
      dataMessage?: {
        timestamp?: number;
        message?: string;
        groupInfo?: {
          groupId?: string;
          type?: string;
        };
        mentions?: any[];
        attachments?: any[];
        quote?: {
          id?: number;
          author?: string;
          text?: string;
        };
      };
    };
    receiptMessage?: {
      when?: number;
      isDelivery?: boolean;
      isRead?: boolean;
      isViewed?: boolean;
      timestamps?: number[];
    };
    typingMessage?: {
      action?: string;
      timestamp?: number;
      groupId?: string;
    };
  };
}

/**
 * Signal Bot V2 - Modern JSON-RPC Implementation
 *
 * This bot uses signal-cli's JSON-RPC TCP interface for communication,
 * eliminating config file locking issues and improving reliability.
 *
 * Architecture:
 * 1. Spawns signal-cli daemon in TCP mode (localhost:7583)
 * 2. Connects SignalJsonRpcClient to TCP socket
 * 3. Receives messages via JSON-RPC notifications
 * 4. Sends messages via JSON-RPC requests
 * 5. Stores messages in Cloudflare D1 via Worker API
 * 6. Backs up Signal data to Cloudflare R2
 */
export class SignalBot extends EventEmitter {
  private config: BotConfig;
  private workerApi: WorkerAPIClient;
  private commandHandler: CommandHandler;
  private dbClient?: PostgresClient; // Database client for direct queries
  private daemonProcess: ChildProcess | null = null;
  private rpcClient: SignalJsonRpcClient | null = null;
  private isRunningFlag = false;
  private startTime: number = 0;
  private stats = {
    messagesReceived: 0,
    messagesSent: 0,
    commandsProcessed: 0,
    errors: 0,
  };

  // Message deduplication
  private processedMessages = new Set<string>();
  private readonly DEDUP_WINDOW = 30000; // 30 seconds

  // Group caching to survive restarts
  private cachedGroups: any[] = [];
  private groupsCacheTimestamp: number = 0;
  private readonly GROUPS_CACHE_TTL = 3600000; // 1 hour in milliseconds
  private groupRefreshInterval: NodeJS.Timeout | null = null;

  // Emoji reactions handler
  private emojiReactionHandler: EmojiReactionHandler;

  // Debug logger (optional)
  private debugLogger?: DebugLogger;

  constructor(config: BotConfig, workerApi: WorkerAPIClient, dbClient?: PostgresClient) {
    super();
    this.config = config;
    this.workerApi = workerApi;
    this.dbClient = dbClient; // Store database client
    this.commandHandler = new CommandHandler(config, workerApi);
    // Pass bot instance to command handler for methods like getGroups()
    this.commandHandler.setBotInstance(this);
    // Initialize emoji reaction handler
    this.emojiReactionHandler = new EmojiReactionHandler();

    // Initialize debug logger if PostgreSQL client is available
    if (dbClient) {
      this.debugLogger = new DebugLogger(dbClient, true, true);
      console.log('📊 Debug logging enabled (PostgreSQL)');
    }
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.isRunningFlag) {
      throw new Error('Bot is already running');
    }

    console.log('🚀 Starting Signal bot (V2 - JSON-RPC)...');

    // Log bot start event
    await this.debugLogger?.logBotLifecycle('start', {
      phoneNumber: this.config.phoneNumber,
      dataDir: this.config.dataDir,
      hasOpenAI: !!this.config.openAiApiKey,
      hasLocalAI: !!this.config.localAiUrl,
      hasDiscourse: !!this.config.discourseApiUrl,
    });

    // Start signal-cli daemon in TCP mode
    await this.startDaemon();

    // Connect JSON-RPC client
    await this.connectRpcClient();

    // Initialize group cache from database
    await this.initializeGroupCache();

    // Set up periodic group refresh (every hour)
    this.groupRefreshInterval = setInterval(() => {
      this.refreshGroupCache().catch(err => {
        console.error('Error refreshing group cache:', err);
      });
    }, this.GROUPS_CACHE_TTL);

    this.isRunningFlag = true;
    this.startTime = Date.now();

    console.log('✅ Signal bot started successfully');
    this.emit('started');
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    if (!this.isRunningFlag) {
      return;
    }

    console.log('🛑 Stopping Signal bot...');

    // Log bot stop event
    await this.debugLogger?.logBotLifecycle('stop', {
      uptime: this.getUptime(),
      stats: this.stats,
    });

    // Clear group refresh interval
    if (this.groupRefreshInterval) {
      clearInterval(this.groupRefreshInterval);
      this.groupRefreshInterval = null;
    }

    // Disconnect RPC client
    if (this.rpcClient) {
      this.rpcClient.disconnect();
      this.rpcClient = null;
    }

    // Stop daemon
    if (this.daemonProcess) {
      this.daemonProcess.kill('SIGTERM');
      this.daemonProcess = null;
    }

    this.isRunningFlag = false;

    console.log('✅ Signal bot stopped');
    this.emit('stopped');
  }

  /**
   * Start signal-cli daemon in TCP mode
   */
  private async startDaemon(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('📡 Starting signal-cli daemon in TCP mode...');

      const args = [
        '-a', this.config.phoneNumber,
        '--config', this.config.dataDir,
        'daemon',
        '--tcp', 'localhost:7583',
        '--receive-mode', 'manual', // Manual mode - we'll use subscribeReceive() via JSON-RPC
      ];

      console.log(`🚀 Starting signal-cli daemon: signal-cli ${args.join(' ')}`);

      this.daemonProcess = spawn('signal-cli', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let started = false;

      // Handle stdout
      this.daemonProcess.stdout?.on('data', (data) => {
        const message = data.toString().trim();
        if (message) {
          console.log('Signal CLI:', message);

          if (!started && (message.includes('Started') || message.includes('Listening'))) {
            started = true;
            // Give it a moment to fully initialize
            setTimeout(() => resolve(), 1000);
          }
        }
      });

      // Handle stderr
      this.daemonProcess.stderr?.on('data', (data) => {
        const message = data.toString().trim();
        if (message) {
          console.log('Signal CLI:', message);

          if (!started && (message.includes('Started') || message.includes('Listening'))) {
            started = true;
            setTimeout(() => resolve(), 1000);
          }
        }
      });

      // Handle process exit
      this.daemonProcess.on('exit', (code) => {
        console.log(`Signal CLI daemon exited with code ${code}`);
        this.isRunningFlag = false;
        this.emit('daemon-exit', code);

        if (!started) {
          reject(new Error(`Signal CLI daemon failed to start (exit code ${code})`));
        }
      });

      // Handle errors
      this.daemonProcess.on('error', (error) => {
        console.error('Signal CLI daemon error:', error);
        this.isRunningFlag = false;

        if (!started) {
          reject(error);
        }
      });

      // Timeout if not started within 15 seconds
      setTimeout(() => {
        if (!started) {
          this.daemonProcess?.kill();
          reject(new Error('Signal CLI daemon start timeout'));
        }
      }, 15000);
    });
  }

  /**
   * Connect JSON-RPC client to signal-cli daemon
   */
  private async connectRpcClient(): Promise<void> {
    console.log('🔌 Connecting to signal-cli JSON-RPC interface...');

    this.rpcClient = new SignalJsonRpcClient('localhost', 7583, this.debugLogger);

    // Handle incoming notifications (messages)
    this.rpcClient.on('notification', (notification) => {
      this.handleJsonRpcNotification(notification);
    });

    // Handle connection events
    this.rpcClient.on('connected', async () => {
      console.log('✅ Connected to signal-cli JSON-RPC');

      // Subscribe to receive messages via JSON-RPC notifications
      try {
        console.log('📤 Calling subscribeReceive() to enable message notifications...');
        const subscriptionId = await this.rpcClient!.subscribeReceive();
        console.log(`📬 Successfully subscribed to receive messages (subscription ID: ${subscriptionId})`);
        console.log('🎯 Bot is now ready to receive Signal messages via JSON-RPC notifications');
      } catch (error) {
        console.error('❌ Failed to subscribe to receive messages:', error);
        console.error('   Without subscription, incoming messages will NOT be received!');
      }
    });

    this.rpcClient.on('disconnected', () => {
      console.log('⚠️  Disconnected from signal-cli JSON-RPC');
    });

    this.rpcClient.on('error', (error) => {
      console.error('JSON-RPC Error:', error);
      this.stats.errors++;
    });

    // Connect to daemon
    await this.rpcClient.connect();
  }

  /**
   * Handle JSON-RPC notification (incoming message)
   */
  private handleJsonRpcNotification(notification: any): void {
    try {
      console.log('🔍 [TRACE] Full notification:', JSON.stringify(notification, null, 2));

      // Check for protocol exceptions (UntrustedIdentityException, NoSessionException, etc.)
      if (notification.params?.result?.exception) {
        const exception = notification.params.result.exception;
        const exceptionType = exception.type || 'Unknown';
        const exceptionMessage = exception.message || 'No message';

        console.warn(`⚠️  Signal Protocol Exception: ${exceptionType}`);
        console.warn(`   Message: ${exceptionMessage}`);

        // Handle specific exception types
        if (exceptionType === 'UntrustedIdentityException') {
          console.warn('   💡 This means a contact changed their safety number');
          console.warn('   💡 Messages from this contact will be skipped until trust is re-established');
        } else if (exceptionType === 'ProtocolNoSessionException') {
          console.warn('   💡 This is a missing session key for group messages');
          console.warn('   💡 This usually resolves itself as new messages arrive');
        }

        // Don't process exceptions as messages
        return;
      }

      // Try multiple possible envelope locations
      // signal-cli JSON-RPC format has changed between versions
      let envelope = null;

      // Option 1: notification.params.envelope (most common)
      if (notification.params?.envelope) {
        console.log('📍 Found envelope at notification.params.envelope');
        envelope = notification.params.envelope;
      }
      // Option 2: notification.params.result.envelope (subscription response)
      else if (notification.params?.result?.envelope) {
        console.log('📍 Found envelope at notification.params.result.envelope');
        envelope = notification.params.result.envelope;
      }
      // Option 3: notification.envelope (direct)
      else if (notification.envelope) {
        console.log('📍 Found envelope at notification.envelope');
        envelope = notification.envelope;
      }
      // Option 4: notification.params (params IS the envelope)
      else if (notification.params && (notification.params.source || notification.params.dataMessage)) {
        console.log('📍 notification.params appears to BE the envelope');
        envelope = notification.params;
      }
      else {
        console.error('❌ Could not find envelope in notification structure');
        console.error('Available keys:', Object.keys(notification));
        if (notification.params) {
          console.error('notification.params keys:', Object.keys(notification.params));
        }
        return;
      }

      console.log('✅ Extracted envelope, calling handleMessage');
      this.handleMessage({ envelope });
    } catch (error) {
      console.error('Error handling JSON-RPC notification:', error);
      console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
      this.stats.errors++;
    }
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(message: SignalMessage): Promise<void> {
    try {
      console.log('🔵 [DEBUG] handleMessage() START');
      console.log('🔍 [ENVELOPE] Full envelope:', JSON.stringify(message.envelope, null, 2));

      const envelope = message.envelope;
      if (!envelope) {
        console.log('🔵 [DEBUG] No envelope, returning');
        return;
      }

      // Early return for receipt and typing messages to reduce log spam
      if (envelope.receiptMessage) {
        // Silently ignore delivery/read receipts
        return;
      }

      if (envelope.typingMessage) {
        // Silently ignore typing indicators
        return;
      }

      console.log('🔍 [ENVELOPE] envelope keys:', Object.keys(envelope));

      // Handle both regular messages and edited messages
      // Edit messages have structure: envelope.editMessage.dataMessage
      // Regular messages have structure: envelope.dataMessage
      const dataMessage = envelope.dataMessage || envelope.editMessage?.dataMessage;
      const isEditMessage = !!envelope.editMessage;

      console.log('🔍 [ENVELOPE] envelope.dataMessage:', envelope.dataMessage ? 'EXISTS' : 'NULL');
      console.log('🔍 [ENVELOPE] envelope.editMessage:', envelope.editMessage ? 'EXISTS' : 'NULL');
      if (dataMessage) {
        console.log('🔍 [ENVELOPE] dataMessage keys:', Object.keys(dataMessage));
        if (isEditMessage) {
          console.log('✏️ [EDIT] This is an edited message');
        }
      }

      // Extract message data
      const sourceNumber = envelope.sourceNumber || envelope.source;
      const sourceName = envelope.sourceName || sourceNumber;
      const sourceUuid = envelope.sourceUuid;
      const timestamp = dataMessage?.timestamp || envelope.timestamp || Date.now();
      const messageText = dataMessage?.message;
      const groupInfo = dataMessage?.groupInfo;
      const groupId = groupInfo?.groupId;
      const quotedText = dataMessage?.quote?.text;

      console.log(`🔵 [DEBUG] Message text: "${messageText}", groupId: ${groupId}`);

      // Skip if no message text
      if (!messageText) {
        console.log('🔵 [DEBUG] No message text, returning');
        return;
      }

      // Deduplication
      const messageId = `${sourceNumber}-${timestamp}-${messageText.substring(0, 50)}`;
      if (this.processedMessages.has(messageId)) {
        console.log('🔵 [DEBUG] Skipping duplicate message');
        return;
      }
      this.processedMessages.add(messageId);

      // Clean up old dedup entries
      setTimeout(() => {
        this.processedMessages.delete(messageId);
      }, this.DEDUP_WINDOW);

      this.stats.messagesReceived++;

      console.log(`📨 Message from ${sourceName} (${sourceNumber})${groupId ? ` in group ${groupId}` : ''}: ${messageText}`);
      console.log('🔵 [DEBUG] About to save message to D1...');

      // Save message to database (PostgreSQL for self-hosted, D1 for Cloudflare)
      try {
        if (this.workerApi && typeof this.workerApi.saveMessage === 'function') {
          await this.workerApi.saveMessage({
            id: this.generateMessageId(),
            groupId,
            groupName: undefined, // Will be populated by group discovery
            sourceNumber,
            sourceName,
            sourceUuid,
            message: messageText,
            timestamp,
            attachments: dataMessage?.attachments,
            mentions: dataMessage?.mentions,
            isReply: !!dataMessage?.quote,
            quotedMessageId: dataMessage?.quote?.id?.toString(),
            quotedText: dataMessage?.quote?.text,
          });
          console.log('🔵 [DEBUG] D1 save completed successfully');
        } else {
          console.log('🔵 [DEBUG] Skipping D1 save (self-hosted mode)');
        }
      } catch (error) {
        console.error('🔵 [DEBUG] Failed to save message:', error);
      }

      console.log('🔵 [DEBUG] Checking if message is a command...');
      // Check if it's a command (starts with !)
      if (messageText.startsWith('!')) {
        console.log('🔵 [DEBUG] Message is a command, handling...');
        try {
          await this.handleCommand(messageText, {
            sourceNumber: sourceNumber || '',
            sourceUuid: sourceUuid,
            sourceName: sourceName || '',
            groupId,
            timestamp,
            quotedText,
            mentions: dataMessage?.mentions,
          });
          console.log('🔵 [DEBUG] Command handling completed');
        } catch (error) {
          console.error('🔵 [DEBUG] Command handling failed (non-critical):', error);
          // Continue to URL checking even if command fails
        }
      } else {
        console.log('🔵 [DEBUG] Message is NOT a command');
      }

      // Check for emoji reactions (after command handling)
      if (messageText && sourceNumber && timestamp) {
        const isOwnMessage = sourceNumber === this.config.phoneNumber;
        const isCommand = messageText.startsWith('!');

        const matchingEmojis = this.emojiReactionHandler.findMatchingEmojis(
          messageText,
          isCommand,
          isOwnMessage
        );

        if (matchingEmojis.length > 0) {
          const messageId = `${sourceNumber}-${timestamp}`;
          if (!this.emojiReactionHandler.shouldDebounce(messageId)) {
            for (const emoji of matchingEmojis) {
              try {
                await this.sendReaction({
                  emoji,
                  targetAuthor: sourceNumber,
                  targetTimestamp: timestamp,
                  groupId,
                  recipient: groupId ? undefined : sourceNumber,
                });
                console.log(`✅ Sent ${emoji} reaction to message`);
              } catch (error) {
                console.error(`Failed to send ${emoji} reaction:`, error);
              }
            }
          }
        }
      }

      console.log('🔵 [DEBUG] About to check for URLs...');
      // Check for URLs and send security/privacy alerts
      // Skip alerts for social media URLs that support downloading - those will be handled by checkForSocialMediaUrls
      console.log(`🔍 Checking message for URLs: ${messageText}`);
      const allUrls = extractURLs(messageText);
      const downloadableSocialUrls = allUrls.filter(url => {
        const platform = getSocialMediaPlatform(url);
        return platform?.supportsDownload === true;
      });

      // Filter out downloadable social media URLs from security alerts
      // (they'll get clean URL info in the download response)
      const nonSocialText = downloadableSocialUrls.length > 0
        ? messageText.replace(new RegExp(downloadableSocialUrls.map(u => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g'), '')
        : messageText;

      const urlAlerts = processMessageURLs(nonSocialText);
      console.log(`🔍 Found ${urlAlerts.length} URL alerts (excluded ${downloadableSocialUrls.length} social media URLs)`);
      if (urlAlerts.length > 0) {
        console.log('🔵 [DEBUG] URL alerts detected, sending messages...');
        for (const alert of urlAlerts) {
          console.log(`🚨 Sending URL security alert...`);
          await this.sendMessage({
            recipient: groupId ? undefined : sourceNumber,
            groupId: groupId,
            message: alert,
          });
          console.log(`✅ URL security alert sent`);
        }
        console.log('🔵 [DEBUG] All URL alerts sent');
      } else {
        console.log('🔵 [DEBUG] No URL alerts to send');
      }

      // Check for news URLs (after security checks pass)
      if (sourceNumber) {
        console.log('🔵 [DEBUG] Checking for news URLs...');
        await this.checkForNewsUrls(messageText, {
          sourceNumber,
          sourceName: sourceName || sourceNumber,
          groupId,
          timestamp
        });
      }

      // Check for social media URLs (Instagram, TikTok, etc.)
      if (sourceNumber) {
        console.log('🔵 [DEBUG] Checking for social media URLs...');
        await this.checkForSocialMediaUrls(messageText, {
          sourceNumber,
          sourceName: sourceName || sourceNumber,
          groupId,
          timestamp
        });
      }

      console.log('🔵 [DEBUG] Emitting message event...');
      this.emit('message', {
        sourceNumber,
        sourceName,
        message: messageText,
        groupId,
        timestamp,
      });

      console.log('🔵 [DEBUG] handleMessage() COMPLETE');
    } catch (error) {
      console.error('🔵 [DEBUG] Error handling message:', error);
      this.stats.errors++;

      // Log processing error to database
      if (error instanceof Error) {
        await this.debugLogger?.logProcessingError('signal-bot', error, {
          sourceNumber: message.envelope?.sourceNumber || message.envelope?.source,
          sourceName: message.envelope?.sourceName,
          groupId: message.envelope?.dataMessage?.groupInfo?.groupId,
          timestamp: message.envelope?.dataMessage?.timestamp || message.envelope?.timestamp,
          messagePreview: message.envelope?.dataMessage?.message?.substring(0, 100),
        });
      }
    }
  }

  /**
   * Handle bot command
   */
  private async handleCommand(
    command: string,
    context: {
      sourceNumber: string;
      sourceUuid?: string;
      sourceName: string;
      groupId?: string;
      timestamp: number;
      quotedText?: string;
      mentions?: any[];
    }
  ): Promise<void> {
    const startTime = Date.now();

    try {
      console.log(`🤖 Processing command: ${command}`);

      // Add message to context for mention name extraction
      const contextWithMessage = { ...context, message: command };
      const response = await this.commandHandler.handle(command, contextWithMessage);

      if (response) {
        await this.sendMessage({
          recipient: context.groupId ? undefined : context.sourceNumber,
          groupId: context.groupId,
          message: response,
        });
      }

      this.stats.commandsProcessed++;

      // Log command usage to database (D1 for Cloudflare, PostgreSQL for self-hosted)
      if (this.workerApi && typeof this.workerApi.logCommand === 'function') {
        await this.workerApi.logCommand({
          command: command.split(' ')[0].substring(1), // Remove ! prefix
          args: command.split(' ').slice(1).join(' ') || undefined,
          groupId: context.groupId,
          userId: context.sourceNumber,
          userName: context.sourceName,
          success: true,
          responseTime: Date.now() - startTime,
        });
      } else {
        console.log('🔵 [DEBUG] Skipping command logging (self-hosted mode)');
      }

    } catch (error) {
      console.error('Command error:', error);
      this.stats.errors++;

      // Log error to database (D1 for Cloudflare, PostgreSQL for self-hosted)
      if (this.workerApi && typeof this.workerApi.logError === 'function') {
        await this.workerApi.logError({
          errorType: 'command_error',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          stackTrace: error instanceof Error ? error.stack : undefined,
          command: command.split(' ')[0].substring(1),
          groupId: context.groupId,
          userId: context.sourceNumber,
          userName: context.sourceName,
        });
      } else {
        console.log('🔵 [DEBUG] Skipping error logging (self-hosted mode)');
      }

      // Send error message to user
      try {
        await this.sendMessage({
          recipient: context.groupId ? undefined : context.sourceNumber,
          groupId: context.groupId,
          message: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      } catch (sendError) {
        console.error('Failed to send error message:', sendError);
      }

      // Log command failure
      if (this.workerApi && typeof this.workerApi.logCommand === 'function') {
        await this.workerApi.logCommand({
          command: command.split(' ')[0].substring(1),
          args: command.split(' ').slice(1).join(' ') || undefined,
          groupId: context.groupId,
          userId: context.sourceNumber,
          userName: context.sourceName,
          success: false,
          responseTime: Date.now() - startTime,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        });
      } else {
        console.log('🔵 [DEBUG] Skipping command failure logging (self-hosted mode)');
      }
    }
  }

  /**
   * Send a message via Signal using JSON-RPC
   */
  async sendMessage(params: {
    recipient?: string;
    groupId?: string;
    message: string;
    attachments?: string[];
  }): Promise<void> {
    if (!this.isRunningFlag || !this.rpcClient) {
      throw new Error('Bot is not running');
    }

    try {
      // Use JSON-RPC client to send message
      await this.rpcClient.sendMessage({
        message: params.message,
        recipient: params.recipient ? [params.recipient] : undefined,
        groupId: params.groupId,
        attachment: params.attachments,
      });

      this.stats.messagesSent++;
      console.log(`✉️  Message sent to ${params.recipient || params.groupId}`);
    } catch (error) {
      console.error('Failed to send message via JSON-RPC:', error);
      throw error;
    }
  }

  /**
   * Update group - add or remove members using JSON-RPC
   *
   * Based on proven working implementation from commit 5613326b
   * Uses JSON-RPC instead of spawn-based CLI approach
   */
  async updateGroup(params: {
    groupId: string;
    member?: string[];  // Array of phone numbers or UUIDs to add
    removeMember?: string[];  // Array of phone numbers or UUIDs to remove
    name?: string;
    description?: string;
    avatar?: string;
  }): Promise<void> {
    if (!this.isRunningFlag || !this.rpcClient) {
      throw new Error('Bot is not running');
    }

    try {
      // Use JSON-RPC client to update group
      await this.rpcClient.updateGroup(params);

      console.log(`✅ Group updated: ${params.groupId}`);
      if (params.member && params.member.length > 0) {
        console.log(`   Added members: ${params.member.join(', ')}`);
      }
      if (params.removeMember && params.removeMember.length > 0) {
        console.log(`   Removed members: ${params.removeMember.join(', ')}`);
      }
    } catch (error) {
      console.error('Failed to update group via JSON-RPC:', error);
      throw error;
    }
  }

  /**
   * Send a reaction to a message
   */
  async sendReaction(params: {
    emoji: string;
    targetAuthor: string;
    targetTimestamp: number;
    groupId?: string;
    recipient?: string;
  }): Promise<void> {
    if (!this.rpcClient) {
      throw new Error('Bot is not running');
    }

    await this.rpcClient.sendReaction(params);
    console.log(`🎯 Sent reaction ${params.emoji} to message from ${params.targetAuthor}`);
  }

  /**
   * Get list of groups using cached data (survives restarts)
   */
  async getGroups(forceRefresh: boolean = false): Promise<any[]> {
    // If cache is fresh and not forcing refresh, return cached data
    const cacheAge = Date.now() - this.groupsCacheTimestamp;
    if (!forceRefresh && this.cachedGroups.length > 0 && cacheAge < this.GROUPS_CACHE_TTL) {
      console.log(`📋 Using cached groups (${this.cachedGroups.length} groups, age: ${Math.floor(cacheAge / 1000)}s)`);
      return this.cachedGroups;
    }

    // Cache is stale or empty, refresh from signal-cli
    console.log('🔄 Refreshing groups from signal-cli...');
    await this.refreshGroupCache();
    return this.cachedGroups;
  }

  /**
   * Check if bot is running
   */
  isRunning(): boolean {
    return this.isRunningFlag;
  }

  /**
   * Get bot uptime in seconds
   */
  getUptime(): number {
    if (!this.isRunningFlag) return 0;
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  /**
   * Get bot statistics
   */
  getStats() {
    return {
      ...this.stats,
      uptime: this.getUptime(),
      rpcConnected: this.rpcClient?.isConnected() || false,
      cachedGroups: this.cachedGroups.length,
      groupsCacheAge: Math.floor((Date.now() - this.groupsCacheTimestamp) / 1000),
    };
  }

  /**
   * Initialize group cache on startup
   * Loads from database first, falls back to signal-cli if needed
   * Also refreshes if membership data is missing
   */
  private async initializeGroupCache(): Promise<void> {
    try {
      console.log('📋 Initializing group cache...');

      // Try to load from database first
      const dbGroups = await this.loadGroupsFromDatabase();

      if (dbGroups.length > 0) {
        this.cachedGroups = dbGroups;
        this.groupsCacheTimestamp = Date.now();
        console.log(`✅ Loaded ${dbGroups.length} groups from database`);

        // Check if membership data exists - if not, trigger a refresh
        // This ensures member UUIDs are stored for unique user counting
        try {
          const membershipCheck = await this.workerApi.query(
            'SELECT COUNT(*) as count FROM signal_member_group_memberships'
          );
          // PostgreSQL COUNT returns bigint which may come as string through JSON
          const membershipCount = parseInt(String(membershipCheck.results?.[0]?.count || '0'), 10);
          if (membershipCount === 0 || isNaN(membershipCount)) {
            console.log('📡 Membership data empty, refreshing from signal-cli to populate...');
            await this.refreshGroupCache();
          } else {
            console.log(`✅ Membership data exists: ${membershipCount} records`);
          }
        } catch (membershipError) {
          console.log('Could not check membership data, will refresh to be safe...');
          await this.refreshGroupCache();
        }
      } else {
        // No groups in database, fetch from signal-cli
        console.log('📡 No groups in database, fetching from signal-cli...');
        await this.refreshGroupCache();
      }
    } catch (error) {
      console.error('❌ Error initializing group cache:', error);
      // Try to fetch from signal-cli as fallback
      try {
        await this.refreshGroupCache();
      } catch (fallbackError) {
        console.error('❌ Fallback group fetch also failed:', fallbackError);
      }
    }
  }

  /**
   * Refresh group cache from signal-cli and save to database
   */
  private async refreshGroupCache(): Promise<void> {
    if (!this.rpcClient) {
      throw new Error('JSON-RPC client not connected');
    }

    try {
      // Fetch groups from signal-cli
      const groups = await this.rpcClient.listGroups();

      // DEBUG: Log raw data from signal-cli to diagnose admin detection
      if (groups && groups.length > 0) {
        console.log('🔍 DEBUG: Total groups returned:', groups.length);
        console.log('🔍 DEBUG: Bot phone number:', this.config.phoneNumber);
        console.log('🔍 DEBUG: First group sample:');
        console.log(JSON.stringify(groups[0], null, 2));
        console.log('🔍 DEBUG: First group admins field:', groups[0].admins);
        console.log('🔍 DEBUG: First group admins length:', groups[0].admins?.length);
        console.log('🔍 DEBUG: First group members length:', groups[0].members?.length);

        this.cachedGroups = groups;
        this.groupsCacheTimestamp = Date.now();

        // Save to database for persistence
        await this.saveGroupsToDatabase(groups);

        console.log(`✅ Refreshed ${groups.length} groups from signal-cli and saved to database`);
      } else {
        console.log('⚠️  No groups returned from signal-cli');
      }
    } catch (error) {
      console.error('❌ Error refreshing groups:', error);
      throw error;
    }
  }

  /**
   * Load groups from database
   */
  private async loadGroupsFromDatabase(): Promise<any[]> {
    try {
      // Query the signal_groups table
      const result = await this.workerApi.query(
        'SELECT id, name, description, member_count, bot_is_admin, bot_is_member, last_updated FROM signal_groups ORDER BY name'
      );

      if (result.results && result.results.length > 0) {
        // Get bot's UUID for admin array
        let botUuid: string | null = null;
        if (this.dbClient) {
          try {
            const botResult = await this.dbClient.query(
              'SELECT uuid FROM signal_members WHERE phone_number = $1 LIMIT 1',
              [this.config.phoneNumber]
            );
            if (botResult.results && botResult.results.length > 0) {
              botUuid = botResult.results[0].uuid;
            }
          } catch (e) {
            // Ignore error, will use phone number as fallback
          }
        }

        // For each group, load actual member UUIDs from signal_member_group_memberships
        const groups = [];
        for (const row of result.results) {
          const botIsAdmin = row.bot_is_admin || false;

          // Load actual member UUIDs for this group
          let members: string[] = [];
          try {
            const membersResult = await this.workerApi.query(
              `SELECT member_id FROM signal_member_group_memberships
               WHERE group_id = $1 AND is_active = true`,
              [row.id]
            );
            if (membersResult.results && membersResult.results.length > 0) {
              members = membersResult.results.map((m: any) => m.member_id);
            }
          } catch (memberError) {
            // Fallback to member_count if membership query fails
            console.log(`Could not load members for group ${row.id}, using count fallback`);
            members = new Array(row.member_count || 0).fill('');
          }

          // Use bot's UUID for admin array if it's admin
          const admins = botIsAdmin ? [botUuid || this.config.phoneNumber] : [];

          groups.push({
            id: row.id,
            name: row.name,
            description: row.description,
            members: members,  // Array of actual member UUIDs
            admins: admins,    // Array containing bot UUID if it's admin
            isMember: row.bot_is_member !== false,
            isBlocked: false,
            messageExpirationTime: 0,
            pendingMembers: [],
            requestingMembers: [],
            banned: [],
            permissionAddMember: 'EVERY_MEMBER',
            permissionEditDetails: 'ONLY_ADMINS',
            permissionSendMessage: 'EVERY_MEMBER'
          });
        }

        return groups;
      }

      return [];
    } catch (error) {
      console.error('Error loading groups from database:', error);
      return [];
    }
  }

  /**
   * Save groups to database
   */
  private async saveGroupsToDatabase(groups: any[]): Promise<void> {
    try {
      let adminCount = 0;
      let totalMembersStored = 0;

      // Look up bot's UUID from database for admin comparison
      // IMPORTANT: signal-cli returns admins as an array of UUID strings, NOT objects!
      // This was a bug fixed on 2025-12-01 - see LESSONS_LEARNED_SIGNAL_CLI.md
      let botUuid: string | null = null;
      if (this.dbClient) {
        try {
          const result = await this.dbClient.query(
            'SELECT uuid FROM signal_members WHERE phone_number = $1 LIMIT 1',
            [this.config.phoneNumber]
          );
          if (result.results && result.results.length > 0) {
            botUuid = result.results[0].uuid;
            console.log(`🤖 Bot UUID resolved for admin check: ${botUuid}`);
          }
        } catch (e) {
          console.log('Could not look up bot UUID, will use phone number fallback');
        }
      }

      const normalizedBotPhone = this.config.phoneNumber.startsWith('+')
        ? this.config.phoneNumber
        : `+${this.config.phoneNumber}`;

      for (const group of groups) {
        // Check if bot is admin in this group
        // admins is an array of UUID STRINGS, not objects!
        let botIsAdmin = false;
        if (group.admins && Array.isArray(group.admins)) {
          botIsAdmin = group.admins.some((admin: any) => {
            // Case 1: admin is a string (UUID) - this is the actual format from signal-cli
            if (typeof admin === 'string') {
              return (botUuid && admin === botUuid) ||
                     admin === normalizedBotPhone ||
                     admin === this.config.phoneNumber;
            }
            // Case 2: admin is an object (legacy/fallback support)
            if (admin && typeof admin === 'object') {
              if (admin.number === this.config.phoneNumber || admin.number === normalizedBotPhone) {
                return true;
              }
              if (botUuid && admin.uuid === botUuid) {
                return true;
              }
            }
            return false;
          });
        }

        if (botIsAdmin) {
          adminCount++;
          console.log(`👑 Bot IS admin in group "${group.name}" (${group.id})`);
        }

        // Upsert each group
        await this.workerApi.query(
          `INSERT INTO signal_groups (id, name, description, member_count, bot_is_admin, bot_is_member, last_updated)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (id)
           DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             member_count = EXCLUDED.member_count,
             bot_is_admin = EXCLUDED.bot_is_admin,
             bot_is_member = EXCLUDED.bot_is_member,
             last_updated = NOW()`,
          [
            group.id,
            group.name || 'Unknown Group',
            group.description || null,
            group.members?.length || 0,
            botIsAdmin,
            group.isMember !== false,
          ]
        );

        // Store member UUIDs in signal_member_group_memberships table
        // members can be either:
        // - array of strings (UUIDs) - what we assumed initially
        // - array of objects {number, uuid} - actual format from signal-cli JSON-RPC
        if (group.members && Array.isArray(group.members) && group.members.length > 0) {
          for (const member of group.members) {
            // Extract UUID - handle both string and object formats
            let memberUuid: string | null = null;
            if (typeof member === 'string' && member) {
              memberUuid = member;
            } else if (member && typeof member === 'object' && member.uuid) {
              memberUuid = member.uuid;
            }

            // Skip if no valid UUID
            if (!memberUuid) continue;

            try {
              // First ensure member exists in signal_members (upsert minimal record)
              await this.workerApi.query(
                `INSERT INTO signal_members (id, uuid, created_at, updated_at)
                 VALUES ($1, $1, NOW(), NOW())
                 ON CONFLICT (id) DO NOTHING`,
                [memberUuid]
              );

              // Then upsert membership record
              const membershipId = `${memberUuid}-${group.id}`;
              await this.workerApi.query(
                `INSERT INTO signal_member_group_memberships (id, member_id, group_id, group_name, is_active, joined_at)
                 VALUES ($1, $2, $3, $4, true, NOW())
                 ON CONFLICT (member_id, group_id) DO UPDATE SET
                   is_active = true,
                   group_name = EXCLUDED.group_name`,
                [membershipId, memberUuid, group.id, group.name || 'Unknown Group']
              );
              totalMembersStored++;
            } catch (memberError) {
              // Log but don't fail - some members might have issues
              // console.log(`Could not store member ${memberUuid}: ${memberError}`);
            }
          }
        }
      }

      console.log(`💾 Saved ${groups.length} groups to database (${adminCount} with admin rights, ${totalMembersStored} member records)`);
    } catch (error) {
      console.error('Error saving groups to database:', error);
      // Don't throw - this is not critical, just log the error
    }
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Check message for news URLs and handle them
   */
  private async checkForNewsUrls(messageText: string, context: {
    sourceNumber: string;
    sourceName: string;
    groupId?: string;
    timestamp: number;
  }): Promise<void> {
    try {
      // Extract all URLs from message
      const urls = extractURLs(messageText);

      if (urls.length === 0) {
        console.log('🔵 [DEBUG] No URLs found in message');
        return;
      }

      // Detect which URLs are from news domains
      const newsUrls = detectNewsUrls(messageText, urls);

      if (newsUrls.length === 0) {
        console.log('🔵 [DEBUG] No news URLs detected');
        return;
      }

      console.log(`📰 Detected ${newsUrls.length} news URL(s)`);

      // Process each news URL
      for (const url of newsUrls) {
        try {
          const domain = extractDomain(url);
          console.log(`📰 Processing news URL: ${url} (${domain})`);

          // Generate bypass link (check for existing archive first)
          const archiveUrl = await getArchiveLink(url);
          const bypassLinks = `📎 ${archiveUrl}`;

          // Send immediate acknowledgment with bypass link
          await this.sendMessage({
            recipient: context.groupId ? undefined : context.sourceNumber,
            groupId: context.groupId,
            message: `📰 Processing, in the meantime here's the bypass link:\n\n${bypassLinks}`,
          });

          // Post to Discourse (self-hosted mode with direct API)
          const discourseConfig = getDiscourseConfig();
          let discourseUrl: string | undefined;

          if (discourseConfig) {
            console.log('📝 Posting news article to Discourse...');
            const discourseResult = await postNewsArticleToDiscourse({
              url,
              archiveUrl, // Pass the archive link
              sourceNumber: context.sourceNumber || undefined,
              sourceName: context.sourceName,
              groupId: context.groupId,
            }, discourseConfig, this.dbClient); // Pass database client for duplicate detection

            if (discourseResult.success && discourseResult.discourseUrl) {
              discourseUrl = discourseResult.discourseUrl;

              // Handle duplicate vs new post
              if (discourseResult.isDuplicate && discourseResult.existingPost) {
                console.log(`✅ Duplicate URL - returning existing post (shared ${discourseResult.existingPost.postCount} times)`);

                // Format first posted date
                const firstPosted = discourseResult.existingPost.firstPostedAt
                  ? new Date(discourseResult.existingPost.firstPostedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : 'unknown';

                // Send message about existing post
                await this.sendMessage({
                  recipient: context.groupId ? undefined : context.sourceNumber,
                  groupId: context.groupId,
                  message: `📋 Already shared (${discourseResult.existingPost.postCount}x since ${firstPosted})\n\n📝 Forum: ${discourseUrl}`,
                });
              } else {
                console.log(`✅ Posted to Discourse: ${discourseUrl}`);

                // Send follow-up message with Discourse link
                await this.sendMessage({
                  recipient: context.groupId ? undefined : context.sourceNumber,
                  groupId: context.groupId,
                  message: `📝 Posted to forum: ${discourseUrl}`,
                });
              }
            } else {
              console.error('❌ Failed to post to Discourse:', discourseResult.error);
            }
          } else {
            console.log('⚠️  Discourse not configured, skipping forum post');
          }

          // Skip full scraping in self-hosted mode (already sent archive link + Discourse post)
          continue;

        } catch (error) {
          console.error(`❌ Error processing news URL ${url}:`, error);
          // Don't send error to user - silent failure for news processing
        }
      }

    } catch (error) {
      console.error('❌ Error in checkForNewsUrls:', error);
      // Silent failure - don't interrupt normal message flow
    }
  }

  /**
   * Check message for social media URLs and handle them
   * Inspired by the `dl` function in ~/Git/dotfiles/platforms/macos/config/.zsh_functions
   */
  private async checkForSocialMediaUrls(messageText: string, context: {
    sourceNumber: string;
    sourceName: string;
    groupId?: string;
    timestamp: number;
  }): Promise<void> {
    try {
      // Extract all URLs from message
      const urls = extractURLs(messageText);

      if (urls.length === 0) {
        return;
      }

      // Filter for social media URLs
      const socialMediaUrls = urls.filter(url => isSocialMediaUrl(url));

      if (socialMediaUrls.length === 0) {
        return;
      }

      console.log(`📱 Detected ${socialMediaUrls.length} social media URL(s)`);

      // Process each social media URL
      for (const url of socialMediaUrls) {
        try {
          const platform = getSocialMediaPlatform(url);
          const contentType = getContentType(url);
          const cleanUrl = removeTrackers(url);

          if (!platform) continue;

          console.log(`📱 Processing ${contentType} from ${platform.name}`);
          console.log(`🔗 Original URL: ${url}`);
          console.log(`🧹 Clean URL: ${cleanUrl}`);

          // Check if platform supports downloading - if not, silently skip (no response)
          if (!platform.supportsDownload) {
            console.log(`⏭️  Skipping ${platform.name} - downloads not supported`);
            continue;
          }

          // No "Processing..." message - we'll send ONE consolidated response with the result
          console.log(`📥 Processing ${platform.name} ${contentType}...`);

          // Check if yt-dlp is installed
          if (!(await isYtDlpInstalled())) {
            await this.sendMessage({
              recipient: context.groupId ? undefined : context.sourceNumber,
              groupId: context.groupId,
              message: `${platform.icon} ${contentType}\n\n⚠️ yt-dlp not installed - cannot download content\n\n🧹 Clean URL (trackers removed):\n${cleanUrl}`,
            });
            continue;
          }

          // Download content
          console.log(`📥 Downloading ${contentType}...`);
          const downloadResult = await downloadContent(cleanUrl, {
            quality: '720p', // Default to 720p for Signal compatibility
            maxFileSizeMB: 95, // Signal's cross-platform limit
          });

          if (downloadResult.success && downloadResult.filePath) {
            // Send the downloaded file
            console.log(`📤 Sending downloaded file: ${downloadResult.fileName}`);

            // Build response message
            let responseMessage = `${platform.icon} ${contentType}\n\n`;
            responseMessage += `📎 Downloaded: ${downloadResult.fileName}\n`;

            if (downloadResult.fileSize) {
              const fileSizeMB = (downloadResult.fileSize / (1024 * 1024)).toFixed(2);
              responseMessage += `📊 Size: ${fileSizeMB} MB\n`;
            }

            responseMessage += `\n🧹 Clean URL:\n${cleanUrl}`;

            // Send message with file attachment
            await this.sendMessage({
              recipient: context.groupId ? undefined : context.sourceNumber,
              groupId: context.groupId,
              message: responseMessage,
              attachments: [downloadResult.filePath],
            });

            console.log(`✅ Sent ${contentType} from ${platform.name}`);
          } else {
            // Download failed - send clean URL instead
            const errorMsg = downloadResult.error || 'Unknown error';
            console.error(`❌ Download failed: ${errorMsg}`);

            await this.sendMessage({
              recipient: context.groupId ? undefined : context.sourceNumber,
              groupId: context.groupId,
              message: `${platform.icon} ${contentType}\n\n❌ Download failed: ${errorMsg}\n\n🧹 Clean URL (trackers removed):\n${cleanUrl}`,
            });
          }

        } catch (error) {
          console.error(`❌ Error processing social media URL ${url}:`, error);
          // Silent failure for individual URLs
        }
      }

    } catch (error) {
      console.error('❌ Error in checkForSocialMediaUrls:', error);
      // Silent failure - don't interrupt normal message flow
    }
  }
}
