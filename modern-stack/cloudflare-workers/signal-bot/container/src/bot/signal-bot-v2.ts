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
 * - PostgreSQL for persistent storage
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { CommandHandler } from './command-handler.js';
import { SignalJsonRpcClient } from './signal-jsonrpc-client.js';
import { processMessageURLs } from '../utils/url-security.js';
import { extractURLs } from '../utils/url-security.js';
import { detectNewsUrls, detectProcessableUrls, extractDomain } from '../utils/news-detector.js';
import { isSocialMediaUrl, getSocialMediaPlatform, removeTrackers, getContentType, formatUrlForDisplay } from '../utils/social-media-detector.js';
import { downloadContent, isYtDlpInstalled } from '../utils/social-media-downloader.js';
import { EmojiReactionHandler } from '../utils/emoji-reaction-handler.js';
import { DebugLogger } from '../utils/debug-logger.js';
import { PostgresClient } from '../db/postgres-client.js';
import { postNewsArticleToDiscourse, getDiscourseConfig } from '../utils/discourse-poster.js';
import { detectGitRepoUrls, fetchRepoMetadata, formatRepoForSignalWithSummary, ParsedRepoUrl, RepoMetadata } from '../utils/git-repo-detector.js';
import { organizeFile, getDirectoryForGroup, FileOrganizeResult } from '../utils/file-organizer.js';
import { selectMemeForEvent, markEventMemeUsed, getEventMemeFilePath, MemeEventType, selectMemeForMessage, markMemeUsed, getMemeFilePath } from '../utils/meme-reactions.js';
import OpenAI from 'openai';

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
      // GroupV2 update info (for member changes)
      groupV2?: {
        id?: string;
        groupId?: string;
        revision?: number;
        type?: string;  // "UPDATE", "DELIVER", etc.
        // Member change info
        addedMembers?: Array<{ uuid?: string; number?: string; }>;
        removedMembers?: Array<{ uuid?: string; number?: string; }>;
        newMembers?: string[];  // UUIDs of new members
        deletedMembers?: string[];  // UUIDs of deleted members
      };
      mentions?: any[];
      attachments?: any[];
      quote?: {
        id?: number;
        author?: string;
        text?: string;
        attachments?: any[];
      };
      reaction?: {
        emoji?: string;
        targetAuthor?: string;
        targetAuthorNumber?: string;
        targetAuthorUuid?: string;
        targetSentTimestamp?: number;
        isRemove?: boolean;
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
          attachments?: any[];
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
    // Sync messages (can contain group membership updates)
    syncMessage?: {
      sentMessage?: {
        groupInfo?: {
          groupId?: string;
          type?: string;
        };
        groupV2?: {
          id?: string;
          groupId?: string;
          revision?: number;
          type?: string;
          addedMembers?: Array<{ uuid?: string; number?: string; }>;
          removedMembers?: Array<{ uuid?: string; number?: string; }>;
        };
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
 * 5. Stores messages in PostgreSQL database
 */
export class SignalBot extends EventEmitter {
  private config: BotConfig;
  private commandHandler: CommandHandler;
  private dbClient: PostgresClient; // PostgreSQL database client
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

  // Verification request timeout checking (every 30 minutes)
  private verificationCheckInterval: NodeJS.Timeout | null = null;
  private readonly VERIFICATION_CHECK_INTERVAL = 1800000; // 30 minutes in milliseconds

  // Safety number verification auto-removal check (every 15 minutes)
  private safetyNumberCheckInterval: NodeJS.Timeout | null = null;
  private readonly SAFETY_NUMBER_CHECK_INTERVAL = 900000; // 15 minutes in milliseconds

  // Entry/INDOC group ID for safety number verification
  private readonly ENTRY_INDOC_GROUP_ID = 'PjJCT6d4nrF0/BZOs39ECX/lZkcHPbi65JU8B6kgw6s=';

  // Actions chat group ID for admin notifications
  private readonly ACTIONS_CHAT_GROUP_ID = 'an0pin2q61hkx4UycDQ0nXZ9w29sAdS7Pgb2SDqGMwc=';

  // Emoji reactions handler
  private emojiReactionHandler: EmojiReactionHandler;

  // Debug logger (optional)
  private debugLogger?: DebugLogger;

  // OpenAI client for AI features (README summaries, etc.)
  private openai?: OpenAI;

  constructor(config: BotConfig, dbClient: PostgresClient) {
    super();
    this.config = config;
    this.dbClient = dbClient;
    this.commandHandler = new CommandHandler(config, dbClient);
    // Pass bot instance to command handler for methods like getGroups()
    this.commandHandler.setBotInstance(this);
    // Initialize emoji reaction handler
    this.emojiReactionHandler = new EmojiReactionHandler();

    // Initialize debug logger
    this.debugLogger = new DebugLogger(dbClient, true, true);
    console.log('📊 Debug logging enabled (PostgreSQL)');

    // Initialize OpenAI if API key available
    if (config.openAiApiKey) {
      this.openai = new OpenAI({ apiKey: config.openAiApiKey });
      console.log('🤖 OpenAI client initialized for git repo summaries');
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

    // Set up periodic verification timeout check (every 30 minutes)
    this.verificationCheckInterval = setInterval(() => {
      this.commandHandler.processExpiredVerifications().catch(err => {
        console.error('Error processing expired verifications:', err);
      });
    }, this.VERIFICATION_CHECK_INTERVAL);
    console.log('📋 Verification timeout check interval started (every 30 minutes)');

    // Set up periodic safety number verification check (every 15 minutes)
    this.safetyNumberCheckInterval = setInterval(() => {
      this.processExpiredSafetyNumberVerifications().catch(err => {
        console.error('Error processing expired safety number verifications:', err);
      });
    }, this.SAFETY_NUMBER_CHECK_INTERVAL);
    console.log('🔐 Safety number verification check interval started (every 15 minutes)');

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

    // Clear verification check interval
    if (this.verificationCheckInterval) {
      clearInterval(this.verificationCheckInterval);
      this.verificationCheckInterval = null;
    }

    // Clear safety number check interval
    if (this.safetyNumberCheckInterval) {
      clearInterval(this.safetyNumberCheckInterval);
      this.safetyNumberCheckInterval = null;
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
          console.warn('   💡 Starting automated safety number verification process...');

          // Extract the affected user identifier from the exception
          const affectedIdentifier = exception.identifier ||
                                    exception.address ||
                                    exception.recipient ||
                                    exception.name;

          if (affectedIdentifier) {
            // Handle the safety number change asynchronously
            this.handleSafetyNumberChange(affectedIdentifier, exception.message).catch(err => {
              console.error('Error handling safety number change:', err);
            });
          } else {
            console.warn('   ⚠️ Could not extract user identifier from UntrustedIdentityException');
            console.warn('   Exception data:', JSON.stringify(exception));
          }
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

      // Handle emoji reactions for breakout room joining
      const reaction = envelope.dataMessage?.reaction;
      if (reaction && !reaction.isRemove && envelope.dataMessage?.groupInfo?.groupId) {
        const reactorUuid = envelope.sourceUuid;
        const reactorName = envelope.sourceName;
        const groupId = envelope.dataMessage.groupInfo.groupId;
        const emoji = reaction.emoji;

        if (reactorUuid && emoji) {
          // Check if there's a breakout manager and handle the reaction
          const breakoutManager = this.commandHandler?.getBreakoutManager?.();
          if (breakoutManager) {
            try {
              const result = await breakoutManager.handleReactionJoin(
                groupId,
                reactorUuid,
                reactorName,
                emoji
              );

              if (result.success && !result.alreadyMember && result.breakout) {
                console.log(`🎉 ${reactorName || reactorUuid} joined breakout "${result.breakout.topic}" via ${emoji}`);
              }
            } catch (err) {
              console.error('Error handling reaction join:', err);
            }
          }
        }
        // Don't return - reactions can also have other purposes
      }

      // Handle group membership events (joins/leaves) for event-based memes
      await this.handleGroupMembershipEvent(envelope);

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
      const quotedAttachments = dataMessage?.quote?.attachments;
      const quotedAuthor = dataMessage?.quote?.author; // UUID of the person who wrote the quoted message

      console.log(`🔵 [DEBUG] Message text: "${messageText}", groupId: ${groupId}`);

      // Check for attachments in the message (for automatic virus scanning)
      const attachments = dataMessage?.attachments;
      const hasAttachments = attachments && attachments.length > 0;

      if (hasAttachments) {
        console.log(`📎 [ATTACHMENT] Message has ${attachments.length} attachment(s), will auto-scan`);
        // Trigger automatic virus scan for attachments
        await this.autoScanAttachments(attachments, {
          sourceNumber: sourceNumber || '',
          sourceUuid,
          sourceName: sourceName || '',
          groupId,
          timestamp,
        });
      }

      // Skip if no message text (but attachments were already processed above)
      if (!messageText) {
        console.log('🔵 [DEBUG] No message text, returning (attachments handled above)');
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
      console.log('🔵 [DEBUG] About to save message to PostgreSQL...');

      // Save message to PostgreSQL database
      try {
        const messageData = {
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
        };

        await this.dbClient.saveMessage(messageData);
        console.log('🔵 [DEBUG] PostgreSQL save completed successfully');

        // Update member profile name from incoming message for better display names
        if (sourceUuid && sourceName && sourceName !== sourceNumber) {
          await this.dbClient.updateMemberProfileName(sourceUuid, sourceName, sourceNumber);
        }
      } catch (error) {
        console.error('🔵 [DEBUG] Failed to save message:', error);
      }

      // BREAKOUT ROOM MESSAGE INTERCEPTION
      // Record messages in breakout rooms for summarization
      if (groupId && sourceUuid && messageText) {
        try {
          const breakoutManager = this.commandHandler.getBreakoutManager();
          if (breakoutManager) {
            const isBreakout = await breakoutManager.isBreakoutRoom(groupId);
            if (isBreakout) {
              console.log(`🏠 [BREAKOUT] Recording message in breakout room: ${groupId}`);
              const recorded = await breakoutManager.recordMessage(
                groupId,
                this.generateMessageId(),
                sourceUuid,
                sourceName || undefined,
                messageText,
                timestamp,
                !!dataMessage?.quote,
                quotedText || undefined
              );
              if (recorded) {
                console.log('✅ [BREAKOUT] Message recorded for summarization');
              }
            }
          }
        } catch (error) {
          console.error('⚠️ [BREAKOUT] Failed to record breakout message:', error);
          // Non-critical - continue processing
        }
      }

      // TASK/ACTION DM REPLY FORWARDING
      // When someone replies to a task notification DM, forward their message to the task creator
      const isTaskReply = !groupId && quotedText && (
        quotedText.includes('📋 New Task Assigned') ||
        quotedText.includes('📋 New Action Item Assigned')
      );

      if (isTaskReply) {
        try {
          // Parse task details from the quoted text
          // Format: "📋 New Task Assigned\n\nFrom: CreatorName\nGroup: GroupName OR Breakout: TopicName\n\nTask: TaskContent"
          const fromMatch = quotedText.match(/From:\s*(.+)/);
          const taskMatch = quotedText.match(/Task:\s*(.+)/);
          const breakoutMatch = quotedText.match(/Breakout:\s*(.+)/);
          const groupMatch = quotedText.match(/Group:\s*(.+)/);

          if (fromMatch && taskMatch) {
            const creatorName = fromMatch[1].trim();
            const taskContent = taskMatch[1].trim();
            const contextInfo = breakoutMatch
              ? `Breakout: ${breakoutMatch[1].trim()}`
              : groupMatch
                ? `Group: ${groupMatch[1].trim()}`
                : '';

            // Find the creator's UUID by looking up their name in the database
            const creatorInfo = await this.dbClient.findMemberByName(creatorName);

            if (creatorInfo && creatorInfo.uuid) {
              const responderName = sourceName || 'Someone';

              const forwardMessage = `💬 Reply about task

From: ${responderName}
Regarding: ${taskContent}${contextInfo ? `\n${contextInfo}` : ''}

Message: ${messageText}

Reply to this DM to continue the conversation.`;

              await this.sendMessage({
                recipient: creatorInfo.uuid,
                message: forwardMessage,
              });

              // Confirm to the responder
              await this.sendMessage({
                recipient: sourceUuid || sourceNumber || '',
                message: `✅ Your message has been forwarded to ${creatorName}.`,
              });

              console.log(`📬 Forwarded task reply from ${responderName} to ${creatorName}`);
            } else {
              console.log(`⚠️ Could not find creator "${creatorName}" to forward task reply`);
            }
          }
        } catch (forwardError) {
          console.error('Failed to forward task DM reply:', forwardError);
        }
      }

      console.log('🔵 [DEBUG] Checking if message is a command...');
      // Check if it's a command (starts with !) or a special reply pattern (tldr, bare numbers)
      const trimmedText = messageText.trim();
      const isCommand = trimmedText.startsWith('!');
      const isTldrReply = /^tldr\s+\d+$/i.test(trimmedText);
      const isBareNumberReply = /^[\d,\s]+$/.test(trimmedText);

      if (isCommand || isTldrReply || isBareNumberReply) {
        console.log('🔵 [DEBUG] Message is a command, handling...');
        try {
          await this.handleCommand(messageText, {
            sourceNumber: sourceNumber || '',
            sourceUuid: sourceUuid,
            sourceName: sourceName || '',
            groupId,
            timestamp,
            quotedText,
            quotedAttachments,
            quotedAuthor, // UUID of the user who wrote the quoted message
            mentions: dataMessage?.mentions,
          });
          console.log('🔵 [DEBUG] Command handling completed');
        } catch (error) {
          console.error('🔵 [DEBUG] Command handling failed (non-critical):', error);
          // Continue to URL checking even if command fails
        }
      } else {
        console.log('🔵 [DEBUG] Message is NOT a command');

        // Check if this is a reply to an AI response (for conversation continuation)
        if (quotedText && quotedText.includes('🤖 AI Response:')) {
          console.log('🤖 Detected reply to AI response, continuing conversation...');
          try {
            const aiReplyResponse = await this.commandHandler.handleAIReply(
              messageText,
              quotedText,
              {
                sourceNumber: sourceNumber || '',
                sourceUuid,
                sourceName: sourceName || '',
                groupId,
                timestamp,
                quotedText,
                quotedAttachments,
                quotedAuthor,
                mentions: dataMessage?.mentions,
                message: messageText,
              }
            );

            if (aiReplyResponse) {
              if (groupId) {
                await this.sendMessage({
                  groupId,
                  message: aiReplyResponse,
                });
              } else if (sourceNumber) {
                await this.sendMessage({
                  recipient: sourceNumber,
                  message: aiReplyResponse,
                });
              }
              console.log('🤖 AI reply continuation sent');
            }
          } catch (error) {
            console.error('Error handling AI reply:', error);
          }
        }

        // Check for verification flow messages (intro with mention, vouch response)
        if (groupId && sourceUuid) {
          try {
            const verificationResponse = await this.commandHandler.handleVerificationMessage(
              messageText,
              {
                sourceNumber: sourceNumber || '',
                sourceUuid,
                sourceName: sourceName || '',
                groupId,
                timestamp,
                mentions: dataMessage?.mentions,
                message: messageText,
              }
            );

            // If verification handler returned a response, send it to the group
            if (verificationResponse) {
              await this.sendMessage({
                groupId,
                message: verificationResponse,
              });
              console.log('📋 Verification flow response sent');
            }
          } catch (error) {
            console.error('Error handling verification message:', error);
          }
        }
      }

      // Check for emoji reactions (after command handling)
      if (messageText && sourceNumber && timestamp) {
        const isOwnMessage = sourceNumber === this.config.phoneNumber;
        // isCommand, isTldrReply, isBareNumberReply already computed above

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
      // Skip if this is the bot's own message to avoid infinite loops
      const isBotMessage = sourceNumber === this.config.phoneNumber;
      if (sourceNumber && !isBotMessage) {
        console.log('🔵 [DEBUG] Checking for news URLs...');
        await this.checkForNewsUrls(messageText, {
          sourceNumber,
          sourceName: sourceName || sourceNumber,
          groupId,
          timestamp
        });
      } else if (isBotMessage) {
        console.log('🔵 [DEBUG] Skipping news URL check for bot\'s own message');
      }

      // Check for social media URLs (Instagram, TikTok, etc.)
      if (sourceNumber && !isBotMessage) {
        console.log('🔵 [DEBUG] Checking for social media URLs...');
        await this.checkForSocialMediaUrls(messageText, {
          sourceNumber,
          sourceName: sourceName || sourceNumber,
          groupId,
          timestamp
        });
      }

      // Check for git repository URLs (GitHub, GitLab, etc.)
      if (sourceNumber && !isBotMessage) {
        console.log('🔵 [DEBUG] Checking for git repo URLs...');
        await this.checkForGitRepoUrls(messageText, {
          sourceNumber,
          sourceName: sourceName || sourceNumber,
          groupId,
          timestamp
        });
      }

      // Check for text-triggered memes (only in groups, not from bot)
      if (groupId && !isBotMessage && messageText) {
        console.log('🔵 [DEBUG] Checking for meme triggers...');
        await this.checkForMemeReaction(messageText, groupId);
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
   * Handle group membership events (joins/leaves) and trigger event-based memes
   */
  private async handleGroupMembershipEvent(envelope: SignalMessage['envelope']): Promise<void> {
    try {
      const dataMessage = envelope.dataMessage;
      const groupV2 = dataMessage?.groupV2;
      const groupInfo = dataMessage?.groupInfo;
      const syncGroupV2 = envelope.syncMessage?.sentMessage?.groupV2;

      // Get group ID from various possible locations
      const groupId = groupV2?.groupId || groupV2?.id || groupInfo?.groupId || syncGroupV2?.groupId || syncGroupV2?.id;

      if (!groupId) {
        return; // Not a group message
      }

      // Check for member changes in groupV2 or syncMessage
      const addedMembers = groupV2?.addedMembers || groupV2?.newMembers || syncGroupV2?.addedMembers || [];
      const removedMembers = groupV2?.removedMembers || groupV2?.deletedMembers || syncGroupV2?.removedMembers || [];

      // Also check groupInfo.type for "UPDATE" which might indicate a membership change
      const isGroupUpdate = groupInfo?.type === 'UPDATE' || groupV2?.type === 'UPDATE';

      // Log for debugging
      if (isGroupUpdate || addedMembers.length > 0 || removedMembers.length > 0) {
        console.log(`🎭 [GROUP_EVENT] Group update detected in ${groupId}`);
        console.log(`🎭 [GROUP_EVENT] Added members: ${JSON.stringify(addedMembers)}`);
        console.log(`🎭 [GROUP_EVENT] Removed members: ${JSON.stringify(removedMembers)}`);
        console.log(`🎭 [GROUP_EVENT] isGroupUpdate: ${isGroupUpdate}`);
      }

      // Look up group name from database for targeted memes
      let groupName: string | undefined;
      try {
        const groupData = await this.dbClient.getGroupById(groupId);
        groupName = groupData?.name;
      } catch (err) {
        // Group might not be in DB yet
      }

      // Handle member joins/leaves
      // Signal CLI doesn't expose addedMembers/removedMembers in JSON, but sends UPDATE type
      // We detect join vs leave by checking if the source user is still in the group
      const messageText = envelope.dataMessage?.message;
      const hasAddedMembers = addedMembers.length > 0;
      const hasRemovedMembers = removedMembers.length > 0;
      const isMembershipUpdate = isGroupUpdate && !messageText && !hasAddedMembers && !hasRemovedMembers;
      const sourceUuid = envelope.sourceUuid;

      if (hasAddedMembers) {
        // Explicit addedMembers from signal-cli (if available)
        console.log(`🎭 [GROUP_EVENT] Processing ${addedMembers.length} member join(s) in ${groupName || groupId} (via addedMembers)`);
        const eventMeme = selectMemeForEvent('member_join', groupId, groupName);
        if (eventMeme) {
          console.log(`🎭 [GROUP_EVENT] Sending join meme: ${eventMeme.id}`);
          await this.sendEventMeme(eventMeme, groupId);
          markEventMemeUsed(eventMeme.id, groupId);
        }
      } else if (hasRemovedMembers) {
        // Explicit removedMembers from signal-cli (if available)
        console.log(`🎭 [GROUP_EVENT] Processing ${removedMembers.length} member leave(s) in ${groupName || groupId} (via removedMembers)`);
        const eventMeme = selectMemeForEvent('member_leave', groupId, groupName);
        if (eventMeme) {
          console.log(`🎭 [GROUP_EVENT] Sending leave meme: ${eventMeme.id}`);
          await this.sendEventMeme(eventMeme, groupId);
          markEventMemeUsed(eventMeme.id, groupId);
        }
      } else if (isMembershipUpdate && sourceUuid) {
        // UPDATE type without explicit member data - detect join vs leave
        // by checking if the source user is still in the group
        console.log(`🎭 [GROUP_EVENT] Detecting join vs leave for ${sourceUuid} in ${groupName || groupId}`);

        try {
          // Get current group members to check if source is still a member
          const groupDetails = await this.rpcClient?.getGroup(groupId);
          const members = groupDetails?.members || [];
          const isMember = members.some((m: any) =>
            m.uuid === sourceUuid || m === sourceUuid
          );

          if (isMember) {
            // Source is still a member = they just joined
            console.log(`🎭 [GROUP_EVENT] ${sourceUuid} is now a member - treating as JOIN`);
            const eventMeme = selectMemeForEvent('member_join', groupId, groupName);
            if (eventMeme) {
              console.log(`🎭 [GROUP_EVENT] Sending join meme: ${eventMeme.id}`);
              await this.sendEventMeme(eventMeme, groupId);
              markEventMemeUsed(eventMeme.id, groupId);
            }
          } else {
            // Source is not a member = they just left
            console.log(`🎭 [GROUP_EVENT] ${sourceUuid} is NOT a member - treating as LEAVE`);
            const eventMeme = selectMemeForEvent('member_leave', groupId, groupName);
            if (eventMeme) {
              console.log(`🎭 [GROUP_EVENT] Sending leave meme: ${eventMeme.id}`);
              await this.sendEventMeme(eventMeme, groupId);
              markEventMemeUsed(eventMeme.id, groupId);
            }
          }
        } catch (err) {
          // If we can't determine, default to join (most common case)
          console.log(`🎭 [GROUP_EVENT] Could not determine join vs leave, defaulting to JOIN`);
          const eventMeme = selectMemeForEvent('member_join', groupId, groupName);
          if (eventMeme) {
            console.log(`🎭 [GROUP_EVENT] Sending join meme: ${eventMeme.id}`);
            await this.sendEventMeme(eventMeme, groupId);
            markEventMemeUsed(eventMeme.id, groupId);
          }
        }
      }

    } catch (error) {
      console.error('🎭 [GROUP_EVENT] Error handling group membership event:', error);
    }
  }

  /**
   * Send an event-based meme to a group
   */
  private async sendEventMeme(meme: { id: string; filename: string; }, groupId: string): Promise<void> {
    const fs = await import('fs/promises');
    const memePath = getEventMemeFilePath(meme as any);

    try {
      // Verify file exists
      await fs.access(memePath);

      // Send the meme using sendMessage with groupId and attachment
      await this.rpcClient?.sendMessage({
        groupId,
        message: '',  // No text, just the meme
        attachment: [memePath],  // attachment can be array
      });

      console.log(`🎭 [EVENT_MEME] Sent ${meme.id} to group ${groupId}`);
    } catch (error) {
      console.error(`🎭 [EVENT_MEME] Failed to send ${meme.id}:`, error);
    }
  }

  /**
   * Check message for text-triggered meme reactions
   * Sends a meme GIF when trigger words are detected (with probability and cooldown)
   */
  private async checkForMemeReaction(messageText: string, groupId: string): Promise<void> {
    try {
      const meme = selectMemeForMessage(messageText, groupId);

      if (!meme) {
        // No meme selected (no match, cooldown, or probability failed)
        return;
      }

      console.log(`🎭 [TEXT_MEME] Matched trigger in "${messageText.substring(0, 50)}..." - selected: ${meme.id}`);

      const fs = await import('fs/promises');
      const memePath = getMemeFilePath(meme);

      // Verify file exists
      try {
        await fs.access(memePath);
      } catch {
        console.error(`🎭 [TEXT_MEME] File not found: ${memePath}`);
        return;
      }

      // Send the meme
      await this.rpcClient?.sendMessage({
        groupId,
        message: '',  // No text, just the meme
        attachment: [memePath],
      });

      // Mark as used (updates cooldown)
      markMemeUsed(meme.id, groupId);
      console.log(`🎭 [TEXT_MEME] Sent ${meme.id} to group ${groupId}`);

    } catch (error) {
      console.error('🎭 [TEXT_MEME] Error checking for meme reaction:', error);
    }
  }

  /**
   * Handle safety number change - automated verification flow
   *
   * When a contact's safety number changes:
   * 1. Auto-trust the new identity (allows messages to flow)
   * 2. Add user to Entry/INDOC group
   * 3. Create verification request in database (24h expiry)
   * 4. Send verification message to Entry/INDOC
   * 5. Notify admins in Actions chat
   */
  private async handleSafetyNumberChange(userIdentifier: string, exceptionMessage?: string): Promise<void> {
    console.log(`🔐 [SAFETY_NUMBER] Starting verification process for ${userIdentifier}`);

    try {
      // 1. Auto-trust the new identity so we can communicate with them
      try {
        await this.rpcClient?.trustIdentity({
          recipient: userIdentifier,
          trustAllKnownKeys: true,
        });
        console.log(`🔐 [SAFETY_NUMBER] Trusted new identity for ${userIdentifier}`);
      } catch (trustError) {
        console.error(`🔐 [SAFETY_NUMBER] Failed to auto-trust ${userIdentifier}:`, trustError);
        // Continue anyway - the user might still be able to respond
      }

      // 2. Get user info from database for display name
      let userDisplayName = 'Unknown User';
      let userPhone: string | undefined;
      try {
        const result = await this.dbClient.query(
          'SELECT display_name, profile_name, first_name, phone_number FROM signal_members WHERE uuid = $1 OR phone_number = $1 LIMIT 1',
          [userIdentifier]
        );
        if (result.results && result.results.length > 0) {
          const row = result.results[0];
          userDisplayName = row.display_name || row.profile_name || row.first_name || 'Unknown User';
          userPhone = row.phone_number;
        }
      } catch (dbError) {
        console.error('Error looking up user info:', dbError);
      }

      // 3. Check if user already has an active verification request
      const existingRequest = await this.dbClient.hasActiveVerificationRequest(
        userIdentifier,
        this.ENTRY_INDOC_GROUP_ID
      );

      if (existingRequest) {
        console.log(`🔐 [SAFETY_NUMBER] ${userDisplayName} already has active verification request`);
        return;
      }

      // 4. Capture ALL groups the user is currently a member of (BEFORE any changes)
      const allGroups = await this.getGroups();
      const userGroupsAtDetection: Array<{ id: string; name: string }> = [];

      for (const group of allGroups) {
        if (!group.members || !Array.isArray(group.members)) continue;

        const isMember = group.members.some((m: any) => {
          const memberId = typeof m === 'string' ? m : (m?.uuid || m?.number);
          return memberId === userIdentifier;
        });

        if (isMember && group.id) {
          userGroupsAtDetection.push({
            id: group.id,
            name: group.name || 'Unknown'
          });
        }
      }

      console.log(`🔐 [SAFETY_NUMBER] User ${userDisplayName} is in ${userGroupsAtDetection.length} groups at detection`);

      // 5. Add user to Entry/INDOC group
      try {
        await this.rpcClient?.updateGroup({
          groupId: this.ENTRY_INDOC_GROUP_ID,
          member: [userIdentifier],
        });
        console.log(`🔐 [SAFETY_NUMBER] Added ${userDisplayName} to Entry/INDOC group`);
      } catch (groupError) {
        console.error(`🔐 [SAFETY_NUMBER] Failed to add user to Entry/INDOC:`, groupError);
        // They might already be in the group - continue
      }

      // 6. Create verification request in database
      const verificationResult = await this.dbClient.createVerificationRequest({
        userUuid: userIdentifier,
        userName: userDisplayName,
        userPhone: userPhone,
        entryGroupId: this.ENTRY_INDOC_GROUP_ID,
        requestedByUuid: 'bot-auto-safety-number',
        requestedByName: 'Bot (Safety Number Change)',
        expiresInHours: 24,
        requestType: 'safety_number_change',
        originalSafetyNumber: exceptionMessage,
      });

      const expiryTime = new Date(verificationResult.expiresAt);
      const expiryFormatted = expiryTime.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      console.log(`🔐 [SAFETY_NUMBER] Created verification request for ${userDisplayName}, expires: ${expiryFormatted} ET`);

      // 6a. Save the groups the user was in at detection time
      if (userGroupsAtDetection.length > 0) {
        await this.dbClient.updateVerificationGroupsMemberOf(verificationResult.id, userGroupsAtDetection);
        console.log(`🔐 [SAFETY_NUMBER] Saved ${userGroupsAtDetection.length} groups to verification request`);
      }

      // 7. Send verification message to Entry/INDOC
      const verificationMessage =
        `🔐 Safety Number Change Detected\n\n` +
        `${userDisplayName}, your Signal safety number has changed. This happens when you:\n` +
        `• Reinstalled Signal\n` +
        `• Switched devices\n` +
        `• Reset your phone\n\n` +
        `For community security, please verify yourself:\n\n` +
        `**IrregularChat Username** (sso.irregularchat.com)\n\n` +
        `--- OR ---\n\n` +
        `1. NAME\n` +
        `2. ORGANIZATION\n` +
        `3. Who invited you (@mention them in this chat)\n` +
        `4. EMAIL\n\n` +
        `⏰ You have 24 hours to respond.\n` +
        `Expires: ${expiryFormatted} ET\n\n` +
        `** If you don't reply in 24 hours, you will be automatically removed from all community chats.`;

      await this.rpcClient?.sendMessage({
        groupId: this.ENTRY_INDOC_GROUP_ID,
        message: verificationMessage,
      });

      console.log(`🔐 [SAFETY_NUMBER] Sent verification message to Entry/INDOC`);

      // 8. Notify admins in Actions chat (include groups list)
      const groupsList = userGroupsAtDetection.length > 0
        ? userGroupsAtDetection.map(g => `  • ${g.name}`).join('\n')
        : '  (no groups found)';

      const adminNotification =
        `⚠️ Safety Number Change Alert\n\n` +
        `User: ${userDisplayName}\n` +
        `Identifier: ${userIdentifier}\n` +
        `Status: Added to Entry/INDOC for verification\n` +
        `Expires: ${expiryFormatted} ET\n\n` +
        `📋 Member of ${userGroupsAtDetection.length} group(s):\n` +
        `${groupsList}\n\n` +
        `The user has 24 hours to verify. If they don't respond, they will be automatically removed from all groups.`;

      await this.rpcClient?.sendMessage({
        groupId: this.ACTIONS_CHAT_GROUP_ID,
        message: adminNotification,
      });

      // Mark admin as notified
      await this.dbClient.markAdminNotified(verificationResult.id);

      console.log(`🔐 [SAFETY_NUMBER] Notified admins in Actions chat`);
      console.log(`🔐 [SAFETY_NUMBER] Safety number verification process complete for ${userDisplayName}`);

    } catch (error) {
      console.error(`🔐 [SAFETY_NUMBER] Error in safety number change handler:`, error);
    }
  }

  /**
   * Process expired safety number verifications - auto-remove users
   *
   * Called periodically (every 15 minutes) to check for expired
   * safety number verification requests and auto-remove users
   * who failed to verify within 24 hours.
   */
  private async processExpiredSafetyNumberVerifications(): Promise<void> {
    console.log('🔐 [SAFETY_NUMBER] Checking for expired safety number verifications...');

    try {
      const expiredRequests = await this.dbClient.getExpiredSafetyNumberVerifications();

      if (expiredRequests.length === 0) {
        console.log('🔐 [SAFETY_NUMBER] No expired safety number verifications found');
        return;
      }

      console.log(`🔐 [SAFETY_NUMBER] Found ${expiredRequests.length} expired verifications to process`);

      for (const request of expiredRequests) {
        const userIdentifier = request.user_uuid;
        const userDisplayName = request.user_name || 'Unknown User';

        console.log(`🔐 [SAFETY_NUMBER] Processing expired verification for ${userDisplayName}`);

        try {
          // Get all groups the user is in
          const allGroups = await this.getGroups();
          const userGroups: Array<{ id: string; name: string }> = [];
          const removedFrom: Array<{ id: string; name: string }> = [];
          const failedRemovals: Array<{ id: string; name: string; reason: string }> = [];

          // Find groups where this user is a member
          for (const group of allGroups) {
            if (!group.members || !Array.isArray(group.members)) continue;

            const isMember = group.members.some((m: any) => {
              const memberId = typeof m === 'string' ? m : (m?.uuid || m?.number);
              return memberId === userIdentifier;
            });

            if (isMember && group.id) {
              userGroups.push({ id: group.id, name: group.name || 'Unknown' });
            }
          }

          if (userGroups.length === 0) {
            console.log(`🔐 [SAFETY_NUMBER] ${userDisplayName} not found in any groups`);
            await this.dbClient.markVerificationAutoRemoved(request.id, []);
            continue;
          }

          // Removal message (same as !remove command)
          const removalMessage =
            `⚠️ ${userDisplayName} is being removed for not verifying themselves after their safety number changed.\n\n` +
            `This is done to maintain the integrity of the community. This could mean the number was assigned to a different person or their SIM was put into a different device.\n\n` +
            `They are welcome to request to join anytime but will need to be verified by knowing someone in the community and providing their name and organization.`;

          // Remove from each group
          for (const group of userGroups) {
            try {
              // Check if bot is admin in this group
              const groupDetails = await this.rpcClient?.getGroup(group.id);
              const botUuid = this.config.phoneNumber; // Bot's identifier
              const isAdmin = groupDetails?.admins?.includes(botUuid);

              if (!isAdmin) {
                failedRemovals.push({ ...group, reason: 'bot not admin' });
                continue;
              }

              // Send removal notice to the group
              await this.rpcClient?.sendMessage({
                groupId: group.id,
                message: removalMessage,
              });

              // Small delay to ensure message is sent before removal
              await new Promise(resolve => setTimeout(resolve, 500));

              // Remove the user
              await this.rpcClient?.updateGroup({
                groupId: group.id,
                removeMember: [userIdentifier],
              });

              removedFrom.push(group);
              console.log(`🔐 [SAFETY_NUMBER] Removed ${userDisplayName} from ${group.name}`);

            } catch (removeError) {
              console.error(`🔐 [SAFETY_NUMBER] Failed to remove from ${group.name}:`, removeError);
              failedRemovals.push({ ...group, reason: String(removeError) });
            }
          }

          // Update database record
          await this.dbClient.markVerificationAutoRemoved(request.id, removedFrom);

          // Parse groups_member_of from the request (groups at detection time)
          let groupsAtDetection: Array<{ id: string; name: string }> = [];
          if (request.groups_member_of) {
            try {
              groupsAtDetection = typeof request.groups_member_of === 'string'
                ? JSON.parse(request.groups_member_of)
                : request.groups_member_of;
            } catch (e) {
              console.error('Error parsing groups_member_of:', e);
            }
          }

          // Log to user_removals audit table
          await this.dbClient.logUserRemoval({
            userUuid: userIdentifier,
            userName: userDisplayName,
            userPhone: request.user_phone,
            removalReason: 'safety_number_change',
            removalType: 'auto',
            groupsRemovedFrom: removedFrom,
            groupsAtDetection: groupsAtDetection,
            verificationRequestId: request.id,
            notes: `Auto-removed after 24h expiry. Failed to verify after safety number change.`,
          });

          console.log(`🔐 [SAFETY_NUMBER] Logged removal to audit table`);

          // Notify admins of the auto-removal
          const adminSummary =
            `🗑️ Auto-Removal Complete\n\n` +
            `User: ${userDisplayName}\n` +
            `Reason: Failed to verify after safety number change (24h expired)\n\n` +
            `Removed from ${removedFrom.length} group(s):\n` +
            removedFrom.map((g, i) => `${i + 1}. ${g.name}`).join('\n') +
            (failedRemovals.length > 0 ? `\n\n⚠️ Failed to remove from ${failedRemovals.length} group(s):\n` +
              failedRemovals.map((g, i) => `${i + 1}. ${g.name} (${g.reason})`).join('\n') : '');

          await this.rpcClient?.sendMessage({
            groupId: this.ACTIONS_CHAT_GROUP_ID,
            message: adminSummary,
          });

          console.log(`🔐 [SAFETY_NUMBER] Auto-removal complete for ${userDisplayName}`);

        } catch (processError) {
          console.error(`🔐 [SAFETY_NUMBER] Error processing ${userDisplayName}:`, processError);
        }
      }

    } catch (error) {
      console.error('🔐 [SAFETY_NUMBER] Error in processExpiredSafetyNumberVerifications:', error);
    }
  }

  /**
   * Automatically scan attachments for viruses using ClamAV
   */
  private async autoScanAttachments(
    attachments: any[],
    context: {
      sourceNumber: string;
      sourceUuid?: string;
      sourceName: string;
      groupId?: string;
      timestamp: number;
    }
  ): Promise<void> {
    const fs = await import('fs/promises');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const attachmentsDir = '/app/signal-data/attachments';
    const results: string[] = [];

    // Wait a moment for attachments to be downloaded
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // File types that should be scanned (documents, archives, executables)
    const SCANNABLE_EXTENSIONS = new Set([
      // Documents
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.odt', '.ods', '.odp', '.rtf', '.csv',
      // Archives
      '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tgz',
      // Executables and scripts
      '.exe', '.msi', '.dll', '.bat', '.cmd', '.ps1', '.sh', '.py', '.js',
      '.apk', '.dmg', '.pkg', '.deb', '.rpm',
      // Other potentially dangerous
      '.iso', '.img', '.vhd', '.vmdk',
      '.html', '.htm', '.svg', '.xml',
      // Non-threatening file types for auto-archive (also scan these)
      '.md', '.json', '.yaml', '.yml', '.txt', '.stl', '.gcode', '.step', '.stp', '.iges', '.igs',
      '.scad', '.obj', '.3mf', '.amf', '.dxf', '.dwg',
    ]);

    // File types safe for auto-archive after virus scan
    const AUTO_ARCHIVE_EXTENSIONS = new Set([
      // Documents (safe to archive)
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.odt', '.ods', '.odp', '.rtf', '.csv',
      // Text/code files
      '.md', '.json', '.yaml', '.yml', '.txt',
      // Fabrication/3D files
      '.stl', '.gcode', '.step', '.stp', '.iges', '.igs',
      '.scad', '.obj', '.3mf', '.amf', '.dxf', '.dwg',
    ]);

    // Track clean files for auto-archiving
    interface CleanFileInfo {
      filename: string;
      filePath: string;
      ext: string;
      fileSizeKB: number;
    }
    const cleanFiles: CleanFileInfo[] = [];

    // Content types to skip (media files)
    const SKIP_CONTENT_TYPES = [
      'image/', 'video/', 'audio/',
    ];

    for (const attachment of attachments) {
      const filename = attachment.filename || `attachment.${attachment.contentType?.split('/')[1] || 'unknown'}`;
      const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')).toLowerCase() : '';
      const contentType = attachment.contentType || '';

      // Skip media files
      if (SKIP_CONTENT_TYPES.some((type) => contentType.startsWith(type))) {
        console.log(`⏭️ [AUTO-SCAN] Skipping media file: ${filename} (${contentType})`);
        continue;
      }

      // Only scan specific file types
      if (ext && !SCANNABLE_EXTENSIONS.has(ext)) {
        console.log(`⏭️ [AUTO-SCAN] Skipping non-scannable extension: ${filename} (${ext})`);
        continue;
      }

      console.log(`🔍 [AUTO-SCAN] Scanning attachment: ${filename} (type: ${contentType})`);

      try {
        // Find the attachment file (most recent matching file)
        const files = await fs.readdir(attachmentsDir);
        const matchingFiles = ext
          ? files.filter((f) => f.toLowerCase().endsWith(ext.toLowerCase()))
          : files;

        if (matchingFiles.length === 0) {
          console.log(`⚠️ [AUTO-SCAN] No files found matching extension: ${ext}`);
          continue;
        }

        // Get file stats and find most recent
        const fileStats = await Promise.all(
          matchingFiles.map(async (f) => {
            try {
              const stat = await fs.stat(`${attachmentsDir}/${f}`);
              return { name: f, path: `${attachmentsDir}/${f}`, mtime: stat.mtime, size: stat.size };
            } catch {
              return null;
            }
          })
        );

        const validFiles = fileStats.filter(Boolean) as { name: string; path: string; mtime: Date; size: number }[];
        validFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

        if (validFiles.length === 0) {
          console.log(`⚠️ [AUTO-SCAN] Could not access files`);
          continue;
        }

        const targetFile = validFiles[0];
        const fileSizeKB = Math.round(targetFile.size / 1024);

        console.log(`🔍 [AUTO-SCAN] Scanning: ${targetFile.path} (${fileSizeKB} KB)`);

        // Run ClamAV scan
        try {
          const { stdout } = await execAsync(`clamscan --no-summary "${targetFile.path}"`, {
            timeout: 60000,
          });

          if (stdout.includes('OK')) {
            results.push(`✅ ${filename} (${fileSizeKB} KB) - Clean`);
            // Track clean file for auto-archive if it's a safe extension
            if (AUTO_ARCHIVE_EXTENSIONS.has(ext)) {
              cleanFiles.push({ filename, filePath: targetFile.path, ext, fileSizeKB });
            }
          } else if (stdout.includes('FOUND')) {
            const threatMatch = stdout.match(/: (.+) FOUND/);
            const threatName = threatMatch ? threatMatch[1] : 'Unknown threat';
            results.push(`🚨 ${filename} (${fileSizeKB} KB) - THREAT DETECTED: ${threatName}`);
          }
        } catch (scanError: any) {
          // Exit code 1 means virus found
          if (scanError.code === 1 && scanError.stdout?.includes('FOUND')) {
            const threatMatch = scanError.stdout.match(/: (.+) FOUND/);
            const threatName = threatMatch ? threatMatch[1] : 'Unknown threat';
            results.push(`🚨 ${filename} (${fileSizeKB} KB) - THREAT DETECTED: ${threatName}`);
          } else if (scanError.message?.includes('not found') || scanError.code === 127) {
            console.log('⚠️ [AUTO-SCAN] ClamAV not installed, skipping scan');
            return; // Don't send any message if ClamAV isn't available
          } else {
            console.error(`⚠️ [AUTO-SCAN] Scan error: ${scanError.message}`);
          }
        }
      } catch (error) {
        console.error(`❌ [AUTO-SCAN] Error processing ${filename}:`, error);
      }
    }

    // Send scan results if we have any
    if (results.length > 0) {
      const hasThreats = results.some((r) => r.includes('THREAT DETECTED'));
      const cleanResults = results.filter((r) => !r.includes('THREAT DETECTED'));
      const threatResults = results.filter((r) => r.includes('THREAT DETECTED'));

      // For clean files: auto-archive if eligible, then post results
      if (cleanResults.length > 0) {
        const archiveResults: string[] = [];

        // Auto-archive clean files that have safe extensions
        if (cleanFiles.length > 0) {
          console.log(`📁 [AUTO-ARCHIVE] Processing ${cleanFiles.length} clean file(s) for auto-archive`);

          // Get group name for categorization
          let groupName = 'Unknown';
          if (context.groupId) {
            try {
              const groupResult = await this.dbClient.query(
                `SELECT name FROM signal_groups WHERE group_id = $1`,
                [context.groupId]
              );
              if (groupResult.results.length > 0) {
                groupName = groupResult.results[0].name;
              }
            } catch (err) {
              console.error('Failed to get group name from DB:', err);
            }
          }

          for (const cleanFile of cleanFiles) {
            try {
              console.log(`📁 [AUTO-ARCHIVE] Archiving: ${cleanFile.filename} from group "${groupName}"`);

              // Process PDF files before archiving (compress, OCR, sanitize metadata)
              let fileToArchive = cleanFile.filePath;
              if (cleanFile.ext === '.pdf') {
                console.log(`📄 [AUTO-ARCHIVE] Processing PDF before archive...`);
                const pdfResult = await this.processPdfFile(cleanFile.filePath);
                fileToArchive = pdfResult.processedPath;
                if (pdfResult.wasProcessed) {
                  console.log(`✅ [AUTO-ARCHIVE] PDF processed: compressed, OCR'd, metadata sanitized`);
                }
              }

              // Organize the file using file-organizer (dryRun to get category without copying)
              const result = await organizeFile(fileToArchive, {
                groupName,
                scanVirus: false, // Already scanned
                dryRun: true, // Don't copy locally, just determine category
              });

              if (!result.success) {
                console.error(`❌ [AUTO-ARCHIVE] Failed to organize ${cleanFile.filename}: ${result.error}`);
                continue;
              }

              // Upload directly to pCloud using rclone (skip local organization)
              let pcloudLink: string | null = null;
              if (result.normalizedFilename) {
                const pcloudRemote = process.env.RCLONE_PCLOUD_REMOTE || 'pcloud';
                const pcloudBasePath = process.env.PCLOUD_BASE_PATH || 'IrregularChat/Topics';
                const pcloudFolder = result.subcategory
                  ? `${pcloudBasePath}/${result.category}/${result.subcategory}`
                  : `${pcloudBasePath}/${result.category}`;
                const pcloudPath = `${pcloudRemote}:${pcloudFolder}/${result.normalizedFilename}`;

                console.log(`☁️ [AUTO-ARCHIVE] Uploading to pCloud: ${pcloudPath}`);

                try {
                  // Upload file directly from attachment path using rclone copyto (renamed)
                  const uploadCmd = `rclone copyto "${fileToArchive}" "${pcloudPath}" --config /app/config/rclone.conf 2>&1`;
                  await execAsync(uploadCmd, { timeout: 60000 });
                  console.log(`✅ [AUTO-ARCHIVE] rclone upload successful`);

                  // Get public link using rclone link
                  const linkCmd = `rclone link "${pcloudPath}" --config /app/config/rclone.conf 2>&1`;
                  const { stdout: linkOut } = await execAsync(linkCmd, { timeout: 30000 });
                  const link = linkOut.trim();

                  if (link && link.startsWith('http')) {
                    pcloudLink = link;
                    console.log(`☁️ [AUTO-ARCHIVE] pCloud link: ${pcloudLink}`);
                  }
                } catch (rcloneErr: any) {
                  console.error('[AUTO-ARCHIVE] rclone error:', rcloneErr.message || rcloneErr);
                  // Fallback to folder URL
                  const pcloudBaseUrl = process.env.PCLOUD_PUBLIC_URL || 'https://u.pcloud.link/publink/show?code=kZKptL5ZWUI9x4hFrtQq523yqzdsUpMNDSD7';
                  const relativePath = result.category + (result.subcategory ? '/' + result.subcategory : '');
                  pcloudLink = `${pcloudBaseUrl}#folder=${encodeURIComponent(relativePath)}`;
                }
              }

              // Build archive result
              const category = result.category + (result.subcategory ? '/' + result.subcategory : '');
              if (pcloudLink) {
                archiveResults.push(`📁 ${cleanFile.filename} → ${category}\n   ☁️ ${pcloudLink}`);
              } else {
                archiveResults.push(`📁 ${cleanFile.filename} → ${category}`);
              }

            } catch (archiveError) {
              console.error(`❌ [AUTO-ARCHIVE] Error archiving ${cleanFile.filename}:`, archiveError);
            }
          }
        }

        // Build combined message
        const messageLines = [
          '🛡️ Auto-Scan Results',
          '',
          ...cleanResults,
          '',
          '✓ Files scanned with ClamAV',
        ];

        if (archiveResults.length > 0) {
          messageLines.push(
            '',
            '📂 Auto-Archived to pCloud:',
            '',
            ...archiveResults
          );
        }

        const cleanMessage = messageLines.join('\n');

        try {
          await this.sendMessage({
            recipient: context.groupId ? undefined : context.sourceNumber,
            groupId: context.groupId,
            message: cleanMessage,
          });
        } catch (sendError) {
          console.error('❌ [AUTO-SCAN] Failed to send clean scan results:', sendError);
        }
      }

      // For threats: DM the sender privately
      if (hasThreats && context.sourceNumber) {
        const threatMessage = `🚨 Virus Scan Alert - Private Notice

A file you posted was flagged by our virus scanner:

${threatResults.join('\n')}

⚠️ Please remove this file from the group immediately.

This could be a false positive, but please investigate:
1. Scan the file with your own antivirus software
2. Check the file source - was it from a trusted location?
3. If you believe this is a false positive, contact an admin

Your file has been flagged but NOT automatically deleted. Please take action.`;

        try {
          console.log(`📩 [AUTO-SCAN] Sending private threat notification to ${context.sourceNumber}`);
          await this.sendMessage({
            recipient: context.sourceNumber,
            message: threatMessage,
          });
        } catch (sendError) {
          console.error('❌ [AUTO-SCAN] Failed to send private threat notification:', sendError);
          // Fallback: post to group if DM fails
          try {
            await this.sendMessage({
              recipient: context.groupId ? undefined : context.sourceNumber,
              groupId: context.groupId,
              message: `🚨 A file was flagged by virus scan. The sender has been notified privately.`,
            });
          } catch (fallbackError) {
            console.error('❌ [AUTO-SCAN] Failed to send fallback message:', fallbackError);
          }
        }
      }
    }
  }

  /**
   * Process a PDF file with Ghostscript compression, OCR, and metadata sanitization
   * Based on handle_pdf from dotfiles
   */
  private async processPdfFile(filePath: string): Promise<{ processedPath: string; wasProcessed: boolean; error?: string }> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const fs = await import('fs/promises');
    const path = await import('path');
    const execAsync = promisify(exec);

    const originalSize = (await fs.stat(filePath)).size;
    const basename = path.basename(filePath, '.pdf');
    const dirname = path.dirname(filePath);
    const tempDir = `/tmp/pdf-process-${Date.now()}`;

    try {
      // Create temp directory
      await fs.mkdir(tempDir, { recursive: true });

      const tempOutput = `${tempDir}/processed.pdf`;
      let currentFile = filePath;

      console.log(`📄 [PDF-PROCESS] Processing: ${filePath} (${Math.round(originalSize / 1024)} KB)`);

      // Step 1: Compress with Ghostscript
      try {
        const gsCmd = `gs -q -dSAFER -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -dPDFSETTINGS=/ebook -dCompatibilityLevel=1.4 -sOutputFile="${tempOutput}" "${currentFile}" 2>&1`;
        await execAsync(gsCmd, { timeout: 120000 });

        if (await this.fileExists(tempOutput)) {
          const compressedSize = (await fs.stat(tempOutput)).size;
          console.log(`🗜️ [PDF-PROCESS] Ghostscript compressed: ${Math.round(originalSize / 1024)} KB → ${Math.round(compressedSize / 1024)} KB`);
          currentFile = tempOutput;
        }
      } catch (gsError: any) {
        console.log(`⚠️ [PDF-PROCESS] Ghostscript compression skipped: ${gsError.message?.substring(0, 100) || 'Unknown error'}`);
      }

      // Step 2: OCR with ocrmypdf (skip if already has text)
      const ocrOutput = `${tempDir}/ocr.pdf`;
      try {
        const ocrCmd = `ocrmypdf --skip-text --optimize 1 --quiet "${currentFile}" "${ocrOutput}" 2>&1`;
        await execAsync(ocrCmd, { timeout: 180000 });

        if (await this.fileExists(ocrOutput)) {
          console.log(`🔍 [PDF-PROCESS] OCR applied successfully`);
          currentFile = ocrOutput;
        }
      } catch (ocrError: any) {
        // ocrmypdf exit code 6 means "already has text" - that's fine
        if (!ocrError.message?.includes('exit code 6') && !ocrError.message?.includes('PriorOcrFoundError')) {
          console.log(`⚠️ [PDF-PROCESS] OCR skipped: ${ocrError.message?.substring(0, 100) || 'Unknown error'}`);
        } else {
          console.log(`📝 [PDF-PROCESS] PDF already has text, OCR skipped`);
        }
      }

      // Step 3: Sanitize metadata with exiftool
      try {
        const exifCmd = `exiftool -overwrite_original -all:all= -m -f "${currentFile}" 2>&1`;
        await execAsync(exifCmd, { timeout: 30000 });
        console.log(`🧹 [PDF-PROCESS] Metadata sanitized with exiftool`);
      } catch (exifError: any) {
        console.log(`⚠️ [PDF-PROCESS] Metadata sanitization skipped: ${exifError.message?.substring(0, 100) || 'Unknown error'}`);
      }

      // Copy processed file back to original location
      if (currentFile !== filePath && await this.fileExists(currentFile)) {
        await fs.copyFile(currentFile, filePath);
        const finalSize = (await fs.stat(filePath)).size;
        console.log(`✅ [PDF-PROCESS] Complete: ${Math.round(originalSize / 1024)} KB → ${Math.round(finalSize / 1024)} KB (${Math.round((1 - finalSize / originalSize) * 100)}% reduction)`);

        // Cleanup temp directory
        await fs.rm(tempDir, { recursive: true, force: true });
        return { processedPath: filePath, wasProcessed: true };
      }

      // Cleanup temp directory
      await fs.rm(tempDir, { recursive: true, force: true });
      return { processedPath: filePath, wasProcessed: false };
    } catch (error: any) {
      console.error(`❌ [PDF-PROCESS] Error processing PDF: ${error.message}`);
      // Cleanup temp directory on error
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {}
      return { processedPath: filePath, wasProcessed: false, error: error.message };
    }
  }

  /**
   * Helper to check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const fs = await import('fs/promises');
      await fs.access(filePath);
      return true;
    } catch {
      return false;
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
      quotedAttachments?: any[];
      quotedAuthor?: string; // UUID of the user who wrote the quoted message
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
        // Handle response with attachment (e.g., memes)
        if (typeof response === 'object' && 'text' in response) {
          await this.sendMessage({
            recipient: context.groupId ? undefined : context.sourceNumber,
            groupId: context.groupId,
            message: response.text,
            attachments: response.attachment ? [response.attachment] : undefined,
          });
        } else {
          await this.sendMessage({
            recipient: context.groupId ? undefined : context.sourceNumber,
            groupId: context.groupId,
            message: response,
          });
        }
      }

      this.stats.commandsProcessed++;

      // Log command usage to PostgreSQL
      try {
        await this.dbClient.logCommand({
          command: command.split(' ')[0].substring(1), // Remove ! prefix
          args: command.split(' ').slice(1).join(' ') || undefined,
          groupId: context.groupId,
          userId: context.sourceNumber,
          userName: context.sourceName,
          success: true,
          responseTime: Date.now() - startTime,
        });
      } catch (logError) {
        console.error('Failed to log command:', logError);
      }

    } catch (error) {
      console.error('Command error:', error);
      this.stats.errors++;

      // Log error to PostgreSQL
      try {
        await this.dbClient.logError({
          errorType: 'command_error',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          stackTrace: error instanceof Error ? error.stack : undefined,
          command: command.split(' ')[0].substring(1),
          groupId: context.groupId,
          userId: context.sourceNumber,
          userName: context.sourceName,
        });
      } catch (logError) {
        console.error('Failed to log error:', logError);
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
      try {
        await this.dbClient.logCommand({
          command: command.split(' ')[0].substring(1),
          args: command.split(' ').slice(1).join(' ') || undefined,
          groupId: context.groupId,
          userId: context.sourceNumber,
          userName: context.sourceName,
          success: false,
          responseTime: Date.now() - startTime,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        });
      } catch (logError) {
        console.error('Failed to log command failure:', logError);
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
    mention?: string[];  // Signal CLI mention format: "start:length:uuid"
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
        mention: params.mention,
      });

      this.stats.messagesSent++;
      const mentionInfo = params.mention?.length ? ` with ${params.mention.length} mentions` : '';
      console.log(`✉️  Message sent to ${params.recipient || params.groupId}${mentionInfo}`);
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
   * Add a member to a group
   * Convenience wrapper around updateGroup
   */
  async addGroupMember(groupId: string, memberUuid: string): Promise<void> {
    await this.updateGroup({
      groupId,
      member: [memberUuid],
    });
  }

  /**
   * Remove member(s) from a group
   */
  async removeGroupMembers(groupId: string, memberUuids: string[]): Promise<void> {
    if (memberUuids.length === 0) return;

    await this.updateGroup({
      groupId,
      removeMember: memberUuids,
    });
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
   * Create a new Signal group
   */
  async createGroup(params: {
    name: string;
    members: string[];
    description?: string;
  }): Promise<{ groupId: string }> {
    if (!this.rpcClient) {
      throw new Error('Bot is not running');
    }

    try {
      const result = await this.rpcClient.createGroup(params);
      console.log(`✅ Created group: ${params.name}`);
      console.log(`   Group ID: ${result?.groupId}`);
      console.log(`   Members: ${params.members.join(', ')}`);

      // Refresh groups cache
      await this.getGroups(true);

      return result;
    } catch (error) {
      console.error('Failed to create group:', error);
      throw error;
    }
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
   * Get a specific group directly from signal-cli (may trigger server sync)
   * This bypasses the cache and can provide fresher data
   */
  async getGroupDirect(groupId: string): Promise<any> {
    if (!this.rpcClient) {
      throw new Error('JSON-RPC client not connected');
    }

    try {
      console.log(`📋 Fetching group directly from signal-cli: ${groupId}`);
      const group = await this.rpcClient.getGroup(groupId);
      return group;
    } catch (error) {
      console.error('Error fetching group directly:', error);
      // Fall back to cached data
      const cachedGroup = this.cachedGroups.find(g => g.id === groupId);
      return cachedGroup || null;
    }
  }

  /**
   * Get Signal contacts with profile names
   * Returns a Map of UUID -> profile name
   */
  async getContactNames(): Promise<Map<string, string>> {
    if (!this.rpcClient) {
      return new Map();
    }

    const nameMap = new Map<string, string>();

    try {
      // Try to get contacts
      const contacts = await this.rpcClient.listContacts();
      for (const contact of contacts) {
        if (contact.uuid && (contact.name || contact.profileName)) {
          const name = contact.name || contact.profileName;
          nameMap.set(contact.uuid, name);
        }
      }
      console.log(`📇 Loaded ${nameMap.size} contact names from signal-cli`);
    } catch (error) {
      console.error('Error fetching contacts:', error);
    }

    return nameMap;
  }

  /**
   * Get Signal identities with profile names
   * Identities are users who have exchanged messages with this account
   * Returns a Map of UUID -> profile name
   */
  async getIdentityNames(): Promise<Map<string, string>> {
    if (!this.rpcClient) {
      return new Map();
    }

    const nameMap = new Map<string, string>();

    try {
      const identities = await this.rpcClient.listIdentities();
      for (const identity of identities) {
        // Signal-cli identities include uuid and may have profileName
        if (identity.uuid && identity.name) {
          nameMap.set(identity.uuid, identity.name);
        }
      }
      console.log(`🪪 Loaded ${nameMap.size} identity names from signal-cli`);
    } catch (error) {
      console.error('Error fetching identities:', error);
    }

    return nameMap;
  }

  /**
   * Get member profile names from cached Signal groups
   * This extracts profile names from the memberDetails in cached group data
   * Returns a Map of UUID -> profile name
   */
  async getMemberNamesFromGroups(): Promise<Map<string, string>> {
    const nameMap = new Map<string, string>();

    try {
      // Get all groups (uses cache)
      const groups = await this.getGroups();

      for (const group of groups) {
        // Check if group has memberDetails (detailed member info)
        if (group.memberDetails && Array.isArray(group.memberDetails)) {
          for (const member of group.memberDetails) {
            if (member.uuid && member.profileName && !this.looksLikeUuid(member.profileName)) {
              nameMap.set(member.uuid, member.profileName);
            }
          }
        }
        // Also check members array for inline profile names
        if (group.members && Array.isArray(group.members)) {
          for (const member of group.members) {
            if (typeof member === 'object' && member.uuid && member.profileName) {
              if (!this.looksLikeUuid(member.profileName)) {
                nameMap.set(member.uuid, member.profileName);
              }
            }
          }
        }
      }
      console.log(`👥 Loaded ${nameMap.size} member names from cached groups`);
    } catch (error) {
      console.error('Error extracting member names from groups:', error);
    }

    return nameMap;
  }

  /**
   * Check if a string looks like a UUID or truncated UUID fallback
   * These patterns should NOT be used as display names
   */
  private looksLikeUuid(str: string): boolean {
    if (!str) return false;
    // Match full UUID format
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) return true;
    // Match truncated UUID format (8 hex chars + ...)
    if (/^[0-9a-f]{6,8}\.\.\.?$/i.test(str)) return true;
    // Match bracketed UUID prefix [abc123]
    if (/^\[[0-9a-f]{6,8}\]$/i.test(str)) return true;
    return false;
  }

  /**
   * Get profile names directly from Signal CLI's internal SQLite database (account.db)
   * This is the most reliable source for profile names (2160+ entries vs ~123 in PostgreSQL)
   * Uses child_process to exec sqlite3 command
   */
  async getProfileNamesFromSignalDb(): Promise<Map<string, string>> {
    const nameMap = new Map<string, string>();

    try {
      const { execSync } = await import('child_process');
      const configDir = process.env.SIGNAL_CLI_CONFIG_DIR || '/app/signal-data';

      // Find account database - it's in a numbered subdirectory
      const fs = await import('fs');
      const dataDir = `${configDir}/data`;

      if (!fs.existsSync(dataDir)) {
        console.log('📁 Signal data directory not found');
        return nameMap;
      }

      // Find the account directory (e.g., 813876.d)
      const entries = fs.readdirSync(dataDir);
      const accountDir = entries.find(e => e.endsWith('.d'));

      if (!accountDir) {
        console.log('📁 No account directory found in Signal data');
        return nameMap;
      }

      const dbPath = `${dataDir}/${accountDir}/account.db`;

      if (!fs.existsSync(dbPath)) {
        console.log(`📁 account.db not found at ${dbPath}`);
        return nameMap;
      }

      // Query the recipient table for profile names
      // Format: aci|profile_given_name|profile_family_name (pipe-separated)
      const query = `SELECT aci, profile_given_name, profile_family_name FROM recipient WHERE aci IS NOT NULL AND profile_given_name IS NOT NULL`;
      const result = execSync(`sqlite3 -separator '|' "${dbPath}" "${query}"`, {
        encoding: 'utf-8',
        timeout: 5000,
      });

      // Parse the results
      const lines = result.trim().split('\n');
      for (const line of lines) {
        if (!line) continue;
        const [aci, givenName, familyName] = line.split('|');
        if (aci && givenName) {
          // Combine given and family name
          const fullName = familyName ? `${givenName} ${familyName}`.trim() : givenName.trim();
          if (fullName && !this.looksLikeUuid(fullName)) {
            nameMap.set(aci, fullName);
          }
        }
      }

      console.log(`📋 Loaded ${nameMap.size} profile names from Signal CLI database`);
    } catch (error) {
      console.error('Error querying Signal CLI database:', error);
    }

    return nameMap;
  }

  /**
   * Sync with Signal servers by processing any pending messages
   * This can update group membership info from recent events
   */
  async syncWithServer(timeout: number = 1): Promise<void> {
    if (!this.rpcClient) {
      return;
    }

    try {
      console.log('🔄 Syncing with Signal servers...');
      await this.rpcClient.receive(timeout);
      // Invalidate group cache after sync
      this.groupsCacheTimestamp = 0;
      console.log('✅ Sync complete, cache invalidated');
    } catch (error) {
      console.error('Error syncing with server:', error);
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
          const membershipCheck = await this.dbClient.query(
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
      const result = await this.dbClient.query(
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
            const membersResult = await this.dbClient.query(
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
        await this.dbClient.query(
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
              await this.dbClient.query(
                `INSERT INTO signal_members (id, uuid, created_at, updated_at)
                 VALUES ($1, $1, NOW(), NOW())
                 ON CONFLICT (id) DO NOTHING`,
                [memberUuid]
              );

              // Then upsert membership record
              const membershipId = `${memberUuid}-${group.id}`;
              await this.dbClient.query(
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
   * Check message for processable URLs (news, articles, etc.) and handle them
   * Uses exclusion-based detection: processes any URL that is NOT social media, community, or file hosting
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

      // Detect which URLs should be processed (exclusion-based)
      // Skips: community domains, social media, file hosting
      const processableUrls = detectProcessableUrls(messageText, urls);

      if (processableUrls.length === 0) {
        console.log('🔵 [DEBUG] No processable URLs detected (all excluded)');
        return;
      }

      console.log(`📰 Detected ${processableUrls.length} processable URL(s)`);

      // Process each URL
      for (const url of processableUrls) {
        try {
          const domain = extractDomain(url);
          console.log(`📰 Processing URL: ${url} (${domain})`);

          // Generate bypass link (12ft.io)
          const bypassUrl = `https://12ft.io/${url}`;

          // Post to Discourse (self-hosted mode with direct API)
          // Generate archive link in parallel with Discourse posting
          const discourseConfig = getDiscourseConfig();
          const archiveUrl = await getArchiveLink(url);

          if (discourseConfig) {
            console.log('📝 Posting article to Discourse...');
            const discourseResult = await postNewsArticleToDiscourse({
              url,
              archiveUrl, // Pass the archive link
              sourceNumber: context.sourceNumber || undefined,
              sourceName: context.sourceName,
              groupId: context.groupId,
            }, discourseConfig, this.dbClient); // Pass database client for duplicate detection

            if (discourseResult.success && discourseResult.discourseUrl) {
              const discourseUrl = discourseResult.discourseUrl;

              // Handle duplicate vs new post - send ONE consolidated message
              if (discourseResult.isDuplicate && discourseResult.existingPost) {
                console.log(`✅ Duplicate URL - returning existing post (shared ${discourseResult.existingPost.postCount} times)`);

                // Format first posted date
                const firstPosted = discourseResult.existingPost.firstPostedAt
                  ? new Date(discourseResult.existingPost.firstPostedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : 'unknown';

                // Get title from existing post
                const title = discourseResult.existingPost.title || 'Article';

                // Send ONE consolidated message for duplicate
                await this.sendMessage({
                  recipient: context.groupId ? undefined : context.sourceNumber,
                  groupId: context.groupId,
                  message: `📋 "${title}"\nAlready shared (${discourseResult.existingPost.postCount}x since ${firstPosted})\n\n📝 Forum: ${discourseUrl}\n🔓 Bypass: ${bypassUrl}`,
                });
              } else {
                console.log(`✅ Posted to Discourse: ${discourseUrl}`);

                // Get title and summary from result
                const title = discourseResult.title || 'Article';
                const summary = discourseResult.summary || '';

                // Build ONE consolidated message: title, summary, forum link, bypass link
                let message = `📝 "${title}"`;
                if (summary && summary.length > 10) {
                  // Truncate summary to ~200 chars for Signal
                  const shortSummary = summary.length > 200 ? summary.substring(0, 197) + '...' : summary;
                  message += `\n\n${shortSummary}`;
                }
                message += `\n\n📝 Forum: ${discourseUrl}`;
                message += `\n🔓 Bypass: ${bypassUrl}`;

                await this.sendMessage({
                  recipient: context.groupId ? undefined : context.sourceNumber,
                  groupId: context.groupId,
                  message,
                });
              }
            } else if (discourseResult.scrapingFailed) {
              // Scraping failed - send multiple bypass and archive links
              console.log(`⚠️  Scraping failed for ${url} - sending bypass/archive links instead`);
              const encodedUrl = encodeURIComponent(url);

              const message = `⚠️ Couldn't extract article content for summary\n\n` +
                `🔓 Bypass Paywalls:\n` +
                `• 12ft: ${bypassUrl}\n` +
                `• Archive.ph: https://archive.ph/${url}\n\n` +
                `📚 Save to Archive:\n` +
                `• Archive.is: https://archive.is/?run=1&url=${encodedUrl}\n` +
                `• Wayback: https://web.archive.org/save/${url}`;

              await this.sendMessage({
                recipient: context.groupId ? undefined : context.sourceNumber,
                groupId: context.groupId,
                message,
              });
            } else {
              console.error('❌ Failed to post to Discourse:', discourseResult.error);
              // If Discourse fails, still send bypass link
              await this.sendMessage({
                recipient: context.groupId ? undefined : context.sourceNumber,
                groupId: context.groupId,
                message: `🔓 Bypass: ${bypassUrl}`,
              });
            }
          } else {
            console.log('⚠️  Discourse not configured, skipping forum post');
            // No Discourse, just send bypass link
            await this.sendMessage({
              recipient: context.groupId ? undefined : context.sourceNumber,
              groupId: context.groupId,
              message: `🔓 Bypass: ${bypassUrl}`,
            });
          }

          // Skip full scraping in self-hosted mode (already sent archive link + Discourse post)
          continue;

        } catch (error) {
          console.error(`❌ Error processing URL ${url}:`, error);
          // Don't send error to user - silent failure for URL processing
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

  /**
   * Check message for git repository URLs and handle them
   * Shows repo metadata and stores in database for !links -git queries
   */
  private async checkForGitRepoUrls(messageText: string, context: {
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

      // Detect git repository URLs
      const repoUrls = detectGitRepoUrls(urls);

      if (repoUrls.length === 0) {
        return;
      }

      console.log(`🐙 Detected ${repoUrls.length} git repository URL(s)`);

      // Get GitHub token from environment (optional, for higher rate limits)
      const githubToken = process.env.GITHUB_TOKEN;

      // Process each git repo URL
      for (const parsedUrl of repoUrls) {
        try {
          console.log(`🐙 Processing ${parsedUrl.platform.name} repo: ${parsedUrl.fullName}`);

          // Fetch repository metadata
          const metadata = await fetchRepoMetadata(parsedUrl, githubToken);

          // Format and send response (with AI summary if OpenAI available)
          const response = await formatRepoForSignalWithSummary(
            parsedUrl,
            metadata,
            this.openai,
            githubToken
          );

          await this.sendMessage({
            recipient: context.groupId ? undefined : context.sourceNumber,
            groupId: context.groupId,
            message: response,
          });

          console.log(`✅ Sent ${parsedUrl.platform.name} repo info for ${parsedUrl.fullName}`);

          // Save to database for !links -git queries
          await this.saveRepoToDatabase(parsedUrl, metadata, context);

        } catch (error) {
          console.error(`❌ Error processing git repo URL ${parsedUrl.cleanUrl}:`, error);
          // Silent failure for individual URLs
        }
      }

    } catch (error) {
      console.error('❌ Error in checkForGitRepoUrls:', error);
      // Silent failure - don't interrupt normal message flow
    }
  }

  /**
   * Save repository info to database for !links -git queries
   */
  private async saveRepoToDatabase(
    parsedUrl: ParsedRepoUrl,
    metadata: RepoMetadata | null,
    context: {
      sourceNumber: string;
      sourceName: string;
      groupId?: string;
      timestamp: number;
    }
  ): Promise<void> {
    if (!this.dbClient || !context.groupId) {
      return;
    }

    try {
      const id = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
      const now = new Date().toISOString();

      // Check if repo already exists for this group
      const existing = await this.dbClient.query(
        'SELECT id, post_count FROM repository_links WHERE url = $1 AND group_id = $2',
        [parsedUrl.cleanUrl, context.groupId]
      );

      if (existing.results && existing.results.length > 0) {
        // Update existing record
        await this.dbClient.query(
          `UPDATE repository_links SET
            post_count = post_count + 1,
            last_posted_at = $1,
            stars = COALESCE($2, stars),
            forks = COALESCE($3, forks),
            open_issues = COALESCE($4, open_issues),
            last_updated = COALESCE($5, last_updated)
          WHERE url = $6 AND group_id = $7`,
          [
            now,
            metadata?.stars ?? null,
            metadata?.forks ?? null,
            metadata?.openIssues ?? null,
            metadata?.updatedAt ?? null,
            parsedUrl.cleanUrl,
            context.groupId,
          ]
        );
        console.log(`📊 Updated existing repo record: ${parsedUrl.fullName}`);
      } else {
        // Insert new record
        await this.dbClient.query(
          `INSERT INTO repository_links (
            id, url, platform, repository_name, owner, name, description,
            language, stars, forks, open_issues, license, topics,
            is_private, is_fork, is_archived, last_updated,
            group_id, posted_by, posted_by_name, post_count,
            first_posted_at, last_posted_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
          [
            id,
            parsedUrl.cleanUrl,
            parsedUrl.platform.name,
            parsedUrl.fullName,
            parsedUrl.owner,
            parsedUrl.repo,
            metadata?.description ?? null,
            metadata?.language ?? null,
            metadata?.stars ?? 0,
            metadata?.forks ?? 0,
            metadata?.openIssues ?? 0,
            metadata?.license ?? null,
            metadata?.topics ? JSON.stringify(metadata.topics) : null,
            metadata?.isPrivate ?? false,
            metadata?.isFork ?? false,
            metadata?.isArchived ?? false,
            metadata?.updatedAt ?? null,
            context.groupId,
            context.sourceNumber,
            context.sourceName,
            1,
            now,
            now,
          ]
        );
        console.log(`💾 Saved new repo to database: ${parsedUrl.fullName}`);
      }
    } catch (error) {
      console.error('Error saving repo to database:', error);
      // Don't throw - database save failure shouldn't break the flow
    }
  }
}
