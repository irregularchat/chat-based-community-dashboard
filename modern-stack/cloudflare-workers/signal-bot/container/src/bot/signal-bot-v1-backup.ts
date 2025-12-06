/**
 * Signal Bot
 *
 * Main bot class that handles Signal CLI integration and message processing
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { WorkerAPIClient } from '../api/worker-api-client.js';
import { CommandHandler } from './command-handler.js';

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

export class SignalBot extends EventEmitter {
  private config: BotConfig;
  private workerApi: WorkerAPIClient;
  private commandHandler: CommandHandler;
  private daemonProcess: ChildProcess | null = null;
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

    console.log('🚀 Starting Signal bot...');

    // Check if account is registered
    const registered = await this.isAccountRegistered();
    if (!registered) {
      throw new Error(`Account ${this.config.phoneNumber} is not registered. Please register first.`);
    }

    // Start signal-cli daemon
    await this.startDaemon();

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
   * Start signal-cli daemon
   */
  private async startDaemon(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('📡 Starting signal-cli daemon...');

      const args = [
        '-a', this.config.phoneNumber,
        '--config', this.config.dataDir,
        'daemon',
        '--tcp', 'localhost:7583',
      ];

      console.log(`Running: signal-cli ${args.join(' ')}`);

      this.daemonProcess = spawn('signal-cli', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let started = false;

      // Handle stdout (JSON messages)
      this.daemonProcess.stdout?.on('data', (data) => {
        const lines = data.toString().split('\n').filter((line: string) => line.trim());

        for (const line of lines) {
          try {
            const message: SignalMessage = JSON.parse(line);
            this.handleMessage(message);
          } catch (error) {
            // Not JSON, might be daemon output
            console.log('Signal CLI:', line);

            if (line.includes('Started') && !started) {
              started = true;
              resolve();
            }
          }
        }
      });

      // Handle stderr
      this.daemonProcess.stderr?.on('data', (data) => {
        const message = data.toString();
        console.error('Signal CLI Error:', message);

        if (!started && message.includes('Started')) {
          started = true;
          resolve();
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

      // Timeout if not started within 10 seconds
      setTimeout(() => {
        if (!started) {
          this.daemonProcess?.kill();
          reject(new Error('Signal CLI daemon start timeout'));
        }
      }, 10000);
    });
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

      // Save message to database
      try {
        await this.workerApi.saveMessage({
          id: this.generateMessageId(),
          groupId,
          groupName: undefined, // TODO: Get group name
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
        console.error('Failed to save message:', error);
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

      // Log command usage
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

      // Log error
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
   * Send a message via Signal
   */
  async sendMessage(params: {
    recipient?: string;
    groupId?: string;
    message: string;
  }): Promise<void> {
    if (!this.isRunningFlag) {
      throw new Error('Bot is not running');
    }

    const args = [
      '-a', this.config.phoneNumber,
      '--config', this.config.dataDir,
      'send',
      '-m', params.message,
    ];

    if (params.groupId) {
      args.push('-g', params.groupId);
    } else if (params.recipient) {
      args.push(params.recipient);
    } else {
      throw new Error('Either recipient or groupId must be provided');
    }

    return new Promise((resolve, reject) => {
      const process = spawn('signal-cli', args);

      let output = '';
      let errorOutput = '';

      process.stdout?.on('data', (data) => {
        output += data.toString();
      });

      process.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('exit', (code) => {
        if (code === 0) {
          this.stats.messagesSent++;
          resolve();
        } else {
          reject(new Error(`Failed to send message (exit code ${code}): ${errorOutput}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Get list of groups
   */
  async getGroups(): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const args = [
        '-a', this.config.phoneNumber,
        '--config', this.config.dataDir,
        'listGroups',
        '--detailed',
      ];

      const process = spawn('signal-cli', args);

      let output = '';

      process.stdout?.on('data', (data) => {
        output += data.toString();
      });

      process.on('exit', (code) => {
        if (code === 0) {
          try {
            // Parse output (signal-cli returns various formats)
            const groups: any[] = [];
            const lines = output.split('\n');

            for (const line of lines) {
              if (line.includes('Id:')) {
                // Simple parsing - you may need to adjust based on actual output
                const match = line.match(/Id: ([^\s]+)/);
                if (match) {
                  groups.push({ id: match[1] });
                }
              }
            }

            resolve(groups);
          } catch (error) {
            reject(new Error('Failed to parse groups'));
          }
        } else {
          reject(new Error(`Failed to list groups (exit code ${code})`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Check if account is registered
   */
  private async isAccountRegistered(): Promise<boolean> {
    try {
      await this.getGroups();
      return true;
    } catch {
      return false;
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
    };
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }
}
