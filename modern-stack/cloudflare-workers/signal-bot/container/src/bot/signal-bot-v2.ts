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

  constructor(config: BotConfig, workerApi: WorkerAPIClient) {
    super();
    this.config = config;
    this.workerApi = workerApi;
    this.commandHandler = new CommandHandler(config, workerApi);
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.isRunningFlag) {
      throw new Error('Bot is already running');
    }

    console.log('🚀 Starting Signal bot (V2 - JSON-RPC)...');

    // Start signal-cli daemon in TCP mode
    await this.startDaemon();

    // Connect JSON-RPC client
    await this.connectRpcClient();

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
        '--receive-mode', 'on-connection', // Forward messages to JSON-RPC clients
      ];

      console.log(`Running: signal-cli ${args.join(' ')}`);

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

    this.rpcClient = new SignalJsonRpcClient('localhost', 7583);

    // Handle incoming notifications (messages)
    this.rpcClient.on('notification', (notification) => {
      this.handleJsonRpcNotification(notification);
    });

    // Handle connection events
    this.rpcClient.on('connected', async () => {
      console.log('✅ Connected to signal-cli JSON-RPC');

      // Subscribe to receive messages via JSON-RPC notifications
      try {
        const subscriptionId = await this.rpcClient!.subscribeReceive();
        console.log(`📬 Subscribed to receive messages (subscription: ${subscriptionId})`);
      } catch (error) {
        console.error('Failed to subscribe to receive messages:', error);
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

      console.log('🔍 [ENVELOPE] envelope keys:', Object.keys(envelope));
      console.log('🔍 [ENVELOPE] envelope.dataMessage:', envelope.dataMessage ? 'EXISTS' : 'NULL');
      if (envelope.dataMessage) {
        console.log('🔍 [ENVELOPE] dataMessage keys:', Object.keys(envelope.dataMessage));
      }

      // Extract message data
      const sourceNumber = envelope.sourceNumber || envelope.source;
      const sourceName = envelope.sourceName || sourceNumber;
      const sourceUuid = envelope.sourceUuid;
      const timestamp = envelope.dataMessage?.timestamp || envelope.timestamp || Date.now();
      const messageText = envelope.dataMessage?.message;
      const groupInfo = envelope.dataMessage?.groupInfo;
      const groupId = groupInfo?.groupId;

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

      // Save message to Cloudflare D1 via Worker API
      try {
        await this.workerApi.saveMessage({
          id: this.generateMessageId(),
          groupId,
          groupName: undefined, // Will be populated by group discovery
          sourceNumber,
          sourceName,
          sourceUuid,
          message: messageText,
          timestamp,
          attachments: envelope.dataMessage?.attachments,
          mentions: envelope.dataMessage?.mentions,
          isReply: !!envelope.dataMessage?.quote,
          quotedMessageId: envelope.dataMessage?.quote?.id?.toString(),
          quotedText: envelope.dataMessage?.quote?.text,
        });
        console.log('🔵 [DEBUG] D1 save completed successfully');
      } catch (error) {
        console.error('🔵 [DEBUG] Failed to save message to D1:', error);
      }

      console.log('🔵 [DEBUG] Checking if message is a command...');
      // Check if it's a command (starts with !)
      if (messageText.startsWith('!')) {
        console.log('🔵 [DEBUG] Message is a command, handling...');
        try {
          await this.handleCommand(messageText, {
            sourceNumber: sourceNumber || '',
            sourceName: sourceName || '',
            groupId,
            timestamp,
          });
          console.log('🔵 [DEBUG] Command handling completed');
        } catch (error) {
          console.error('🔵 [DEBUG] Command handling failed (non-critical):', error);
          // Continue to URL checking even if command fails
        }
      } else {
        console.log('🔵 [DEBUG] Message is NOT a command');
      }

      console.log('🔵 [DEBUG] About to check for URLs...');
      // Check for URLs and send security/privacy alerts
      console.log(`🔍 Checking message for URLs: ${messageText}`);
      const urlAlerts = processMessageURLs(messageText);
      console.log(`🔍 Found ${urlAlerts.length} URL alerts`);
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
    }
  }

  /**
   * Handle bot command
   */
  private async handleCommand(
    command: string,
    context: {
      sourceNumber: string;
      sourceName: string;
      groupId?: string;
      timestamp: number;
    }
  ): Promise<void> {
    const startTime = Date.now();

    try {
      console.log(`🤖 Processing command: ${command}`);

      const response = await this.commandHandler.handle(command, context);

      if (response) {
        await this.sendMessage({
          recipient: context.groupId ? undefined : context.sourceNumber,
          groupId: context.groupId,
          message: response,
        });
      }

      this.stats.commandsProcessed++;

      // Log command usage to Cloudflare D1
      await this.workerApi.logCommand({
        command: command.split(' ')[0].substring(1), // Remove ! prefix
        args: command.split(' ').slice(1).join(' ') || undefined,
        groupId: context.groupId,
        userId: context.sourceNumber,
        userName: context.sourceName,
        success: true,
        responseTime: Date.now() - startTime,
      });

    } catch (error) {
      console.error('Command error:', error);
      this.stats.errors++;

      // Log error to Cloudflare D1
      await this.workerApi.logError({
        errorType: 'command_error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        stackTrace: error instanceof Error ? error.stack : undefined,
        command: command.split(' ')[0].substring(1),
        groupId: context.groupId,
        userId: context.sourceNumber,
        userName: context.sourceName,
      });

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
   * Get list of groups using JSON-RPC
   */
  async getGroups(): Promise<any[]> {
    if (!this.rpcClient) {
      throw new Error('JSON-RPC client not connected');
    }

    try {
      const groups = await this.rpcClient.listGroups();
      return groups || [];
    } catch (error) {
      console.error('Failed to list groups via JSON-RPC:', error);
      throw error;
    }
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
    };
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

          // Send immediate acknowledgment
          await this.sendMessage({
            recipient: context.groupId ? undefined : context.sourceNumber,
            groupId: context.groupId,
            message: `📰 News article detected from ${domain}. Processing...`,
          });

          // Scrape and summarize article via Worker API
          const result = await this.workerApi.scrapeAndSummarize({
            url,
            sourceNumber: context.sourceNumber,
            sourceName: context.sourceName,
            groupId: context.groupId,
          });

          // Build comprehensive response message
          if (result.summary) {
            // Generate bypass links
            const bypassLinks = [
              `📎 12ft: https://12ft.io/proxy?q=${encodeURIComponent(url)}`,
              `📎 Archive: https://archive.today/${url}`,
              `📎 Wayback: https://web.archive.org/web/${url}`
            ].join('\n');

            // Build complete message (plain text, no markdown)
            let responseMessage = `📰 ${result.title || 'Article Summary'}\n\n${result.summary}\n\n🔗 ${url}\n\nBypass Links:\n${bypassLinks}`;

            // Add Discourse link if available
            if (result.discourseUrl) {
              responseMessage += `\n\n📝 Forum Discussion:\n${result.discourseUrl}`;
            }

            await this.sendMessage({
              recipient: context.groupId ? undefined : context.sourceNumber,
              groupId: context.groupId,
              message: responseMessage,
            });

            console.log(`✅ Sent article summary for ${url}`);
          }

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

          // Send initial acknowledgment
          await this.sendMessage({
            recipient: context.groupId ? undefined : context.sourceNumber,
            groupId: context.groupId,
            message: `${platform.icon} ${contentType} detected. Processing...`,
          });

          // Check if platform supports downloading
          if (!platform.supportsDownload) {
            await this.sendMessage({
              recipient: context.groupId ? undefined : context.sourceNumber,
              groupId: context.groupId,
              message: `${platform.icon} ${platform.name} - downloading not supported for this platform.\n\n🧹 Clean URL (trackers removed):\n${cleanUrl}`,
            });
            continue;
          }

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
