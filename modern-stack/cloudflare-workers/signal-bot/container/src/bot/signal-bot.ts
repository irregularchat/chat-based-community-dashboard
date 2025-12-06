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

    // Pass bot instance to command handler so it can access bot methods like getGroups()
    this.commandHandler.setBotInstance(this);
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
        '--receive-mode', 'manual', // Manual mode - we control receiving via JSON-RPC receive() calls
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

      // Subscribe to receive messages - CRITICAL for message receiving!
      try {
        if (this.rpcClient) {
          await this.rpcClient.subscribeReceive();
          console.log('📬 Subscribed to receive messages');
        }
      } catch (error) {
        console.error('Failed to subscribe to messages:', error);
        this.stats.errors++;
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
      // JSON-RPC notifications from signal-cli subscribeReceive have this format:
      // { params: { subscription: 0, result: { envelope: {...} } } }
      if (notification.params?.result?.envelope) {
        this.handleMessage({ envelope: notification.params.result.envelope });
      } else if (notification.params?.envelope) {
        // Fallback: some notifications might have envelope directly in params
        this.handleMessage({ envelope: notification.params.envelope });
      } else {
        console.log('Received notification without envelope:', JSON.stringify(notification).substring(0, 200));
      }
    } catch (error) {
      console.error('Error handling JSON-RPC notification:', error);
      this.stats.errors++;
    }
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(message: SignalMessage): Promise<void> {
    try {
      const envelope = message.envelope;
      if (!envelope) return;

      // Extract message data
      const sourceNumber = envelope.sourceNumber || envelope.source;
      const sourceName = envelope.sourceName || sourceNumber;
      const sourceUuid = envelope.sourceUuid;
      const timestamp = envelope.dataMessage?.timestamp || envelope.timestamp || Date.now();
      const messageText = envelope.dataMessage?.message;
      const groupInfo = envelope.dataMessage?.groupInfo;
      const groupId = groupInfo?.groupId;

      // Skip if no message text
      if (!messageText) return;

      // Deduplication
      const messageId = `${sourceNumber}-${timestamp}-${messageText.substring(0, 50)}`;
      if (this.processedMessages.has(messageId)) {
        console.log('Skipping duplicate message');
        return;
      }
      this.processedMessages.add(messageId);

      // Clean up old dedup entries
      setTimeout(() => {
        this.processedMessages.delete(messageId);
      }, this.DEDUP_WINDOW);

      this.stats.messagesReceived++;

      console.log(`📨 Message from ${sourceName} (${sourceNumber})${groupId ? ` in group ${groupId}` : ''}: ${messageText}`);

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
      } catch (error) {
        console.error('Failed to save message to D1:', error);
      }

      // Check if it's a command (starts with !)
      if (messageText.startsWith('!')) {
        await this.handleCommand(messageText, {
          sourceNumber: sourceNumber || '',
          sourceName: sourceName || '',
          groupId,
          timestamp,
        });
      }

      this.emit('message', {
        sourceNumber,
        sourceName,
        message: messageText,
        groupId,
        timestamp,
      });

    } catch (error) {
      console.error('Error handling message:', error);
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
          recipient: context.sourceNumber,
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
          recipient: context.sourceNumber,
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
}
