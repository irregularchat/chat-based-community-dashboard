import { exec } from 'child_process';
import { promisify } from 'util';
import { EventEmitter } from 'events';

const execAsync = promisify(exec);

export interface SignalMessage {
  timestamp: number;
  source: string;
  sourceNumber: string;
  sourceUuid: string;
  sourceName: string;
  message: string;
  groupId?: string;
  attachments?: string[];
}

export interface SignalBotConfig {
  signalCliPath?: string;
  accountPath?: string;
  phoneNumber: string;
  aiEnabled?: boolean;
  openAiApiKey?: string;
}

export class SignalBotService extends EventEmitter {
  private config: SignalBotConfig;
  private isListening: boolean = false;
  private messageHandlers: Map<string, (message: SignalMessage) => Promise<void>> = new Map();

  constructor(config: SignalBotConfig) {
    super();
    this.config = {
      signalCliPath: config.signalCliPath || 'signal-cli',
      accountPath: config.accountPath || '~/.local/share/signal-cli',
      ...config
    };
    this.registerDefaultCommands();
  }

  /**
   * Register default command handlers
   */
  private registerDefaultCommands(): void {
    // Help command
    this.registerCommand('!help', async (message) => {
      const helpText = `
📚 Available Commands:
!help - Show this help message
!phelp - Get personalized AI help
!info - Get information about the bot
!status - Check bot status
!rooms - List available Matrix rooms
!join <room> - Join a Matrix room
!leave <room> - Leave a Matrix room
!ai <question> - Ask the AI assistant
!whoami - Get your Signal account info
!ping - Check if bot is responsive
      `.trim();
      
      await this.sendMessage(message.sourceNumber, helpText);
    });

    // Personalized help command
    this.registerCommand('!phelp', async (message) => {
      if (!this.config.aiEnabled) {
        await this.sendMessage(message.sourceNumber, 
          "AI assistance is currently disabled. Please contact an administrator to enable this feature.");
        return;
      }

      const aiResponse = await this.getAIHelp(message);
      await this.sendMessage(message.sourceNumber, aiResponse);
    });

    // Info command
    this.registerCommand('!info', async (message) => {
      const info = `
🤖 Signal Bot Information
Version: 1.0.0
Status: Active
AI: ${this.config.aiEnabled ? 'Enabled' : 'Disabled'}
Connected: ${this.isListening ? 'Yes' : 'No'}
      `.trim();
      
      await this.sendMessage(message.sourceNumber, info);
    });

    // Status command
    this.registerCommand('!status', async (message) => {
      const status = await this.checkStatus();
      await this.sendMessage(message.sourceNumber, status);
    });

    // Ping command
    this.registerCommand('!ping', async (message) => {
      await this.sendMessage(message.sourceNumber, '🏓 Pong! Bot is responsive.');
    });

    // Who am I command
    this.registerCommand('!whoami', async (message) => {
      const info = `
👤 Your Signal Info:
Phone: ${message.sourceNumber}
UUID: ${message.sourceUuid}
Name: ${message.sourceName || 'Not set'}
      `.trim();
      
      await this.sendMessage(message.sourceNumber, info);
    });

    // AI command
    this.registerCommand('!ai', async (message) => {
      if (!this.config.aiEnabled) {
        await this.sendMessage(message.sourceNumber, 
          "AI assistance is currently disabled. Please contact an administrator to enable this feature.");
        return;
      }

      // Extract the question after !ai command
      const question = message.message.replace(/^!ai\s+/i, '').trim();
      if (!question) {
        await this.sendMessage(message.sourceNumber, 
          "Please provide a question after !ai. Example: !ai How do I join a room?");
        return;
      }

      const aiResponse = await this.getAIResponse(question, message);
      await this.sendMessage(message.sourceNumber, aiResponse);
    });
  }

  /**
   * Register a command handler
   */
  public registerCommand(command: string, handler: (message: SignalMessage) => Promise<void>): void {
    this.messageHandlers.set(command.toLowerCase(), handler);
  }

  /**
   * Start listening for Signal messages
   */
  public async startListening(): Promise<void> {
    if (this.isListening) {
      console.log('Signal bot is already listening');
      return;
    }

    try {
      console.log('Starting Signal bot listener...');
      this.isListening = true;
      
      // Start signal-cli in daemon mode
      
      // Use a child process to continuously listen
      const { spawn } = await import('child_process');
      const signalProcess = spawn(this.config.signalCliPath, [
        '-a', this.config.phoneNumber,
        'daemon', '--json'
      ]);

      signalProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const message = JSON.parse(line) as any;
              if (message.envelope && message.envelope.dataMessage) {
                this.handleIncomingMessage(message.envelope);
              }
            } catch (error) {
              console.error('Error parsing Signal message:', error);
            }
          }
        }
      });

      signalProcess.stderr.on('data', (data) => {
        console.error('Signal CLI error:', data.toString());
      });

      signalProcess.on('close', (code) => {
        console.log(`Signal CLI process exited with code ${code}`);
        this.isListening = false;
        
        // Restart if it wasn't intentionally stopped
        if (code !== 0) {
          setTimeout(() => this.startListening(), 5000);
        }
      });

      console.log('Signal bot listener started successfully');
    } catch (error) {
      console.error('Failed to start Signal bot listener:', error);
      this.isListening = false;
      throw error;
    }
  }

  /**
   * Stop listening for Signal messages
   */
  public async stopListening(): Promise<void> {
    this.isListening = false;
    // Kill any running signal-cli daemon processes
    try {
      await execAsync('pkill -f "signal-cli.*daemon"');
    } catch (_error) {
      // Process might not exist, which is fine
    }
  }

  /**
   * Handle incoming Signal message
   */
  private async handleIncomingMessage(envelope: any): Promise<void> {
    try {
      const message: SignalMessage = {
        timestamp: envelope.timestamp,
        source: envelope.source,
        sourceNumber: envelope.sourceNumber || envelope.source,
        sourceUuid: envelope.sourceUuid || '',
        sourceName: envelope.sourceName || '',
        message: envelope.dataMessage?.message || '',
        groupId: envelope.dataMessage?.groupInfo?.groupId,
        attachments: envelope.dataMessage?.attachments
      };

      console.log(`Received Signal message from ${message.sourceNumber}: ${message.message}`);

      // Check if it's a command
      const commandMatch = message.message.match(/^!(\w+)/);
      if (commandMatch) {
        const command = `!${commandMatch[1]}`.toLowerCase();
        const handler = this.messageHandlers.get(command);
        
        if (handler) {
          await handler(message);
        } else {
          // Unknown command
          await this.sendMessage(message.sourceNumber, 
            `Unknown command: ${command}. Type !help for available commands.`);
        }
      } else {
        // Not a command, emit for other handlers
        this.emit('message', message);
      }
    } catch (_error) {
      console.error('Error handling incoming message:', _error);
    }
  }

  /**
   * Send a message via Signal
   */
  public async sendMessage(recipient: string, message: string, attachments?: string[]): Promise<void> {
    try {
      let cmd = `${this.config.signalCliPath} -a ${this.config.phoneNumber} send -m "${message.replace(/"/g, '\\"')}" ${recipient}`;
      
      if (attachments && attachments.length > 0) {
        const attachmentArgs = attachments.map(a => `-a "${a}"`).join(' ');
        cmd += ` ${attachmentArgs}`;
      }

      const { stderr } = await execAsync(cmd);
      
      if (stderr) {
        console.error('Signal CLI stderr:', stderr);
      }
      
      console.log(`Message sent to ${recipient}`);
    } catch (error) {
      console.error('Failed to send Signal message:', error);
      throw error;
    }
  }

  /**
   * Get AI help response
   */
  private async getAIHelp(_message: SignalMessage): Promise<string> {
    if (!this.config.openAiApiKey) {
      return "AI is enabled but OpenAI API key is not configured. Please contact an administrator.";
    }

    try {
      // Import OpenAI dynamically
      const { OpenAI } = await import('openai');
      const openai = new OpenAI({ apiKey: this.config.openAiApiKey });

      const systemPrompt = `You are a helpful assistant for a community chat platform that integrates Signal and Matrix. 
      Provide personalized help based on the user's question or context. Be concise and friendly.
      The user's name is ${message.sourceName || 'Unknown'} and their phone number is ${message.sourceNumber}.`;

      const userPrompt = `The user needs help with the community platform. 
      Their recent message: "${message.message}"
      Please provide personalized assistance.`;

      const response = await openai.chat.completions.create({
        model: 'gpt-5-mini',  // Using gpt-5-mini as specified in requirements
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 500,
        temperature: 0.7
      });

      return response.choices[0]?.message?.content || "I couldn't generate a help response. Please try again.";
    } catch (error) {
      console.error('AI help generation failed:', error);
      
      // Fallback to non-AI help
      return `Hello ${message.sourceName || 'there'}! 

Here are some things you can do:
• Type !help to see all available commands
• Type !rooms to see available chat rooms
• Type !join <room> to join a room
• Type !ai <question> to ask me anything

If you need more help, please contact an administrator.`;
    }
  }

  /**
   * Get AI response for a specific question
   */
  private async getAIResponse(question: string, _message: SignalMessage): Promise<string> {
    if (!this.config.openAiApiKey) {
      return "AI is enabled but OpenAI API key is not configured. Please contact an administrator.";
    }

    try {
      const { OpenAI } = await import('openai');
      const openai = new OpenAI({ apiKey: this.config.openAiApiKey });

      const response = await openai.chat.completions.create({
        model: 'gpt-5-mini',  // Using gpt-5-mini as specified
        messages: [
          { 
            role: 'system', 
            content: 'You are a helpful AI assistant for a community chat platform. Answer questions concisely and accurately.' 
          },
          { role: 'user', content: question }
        ],
        max_tokens: 500,
        temperature: 0.7
      });

      return response.choices[0]?.message?.content || "I couldn't generate a response. Please try again.";
    } catch (error) {
      console.error('AI response generation failed:', error);
      return "I'm having trouble generating a response right now. Please try again later.";
    }
  }

  /**
   * Check bot status
   */
  private async checkStatus(): Promise<string> {
    try {
      // Check if signal-cli is accessible
      const { stdout } = await execAsync(`${this.config.signalCliPath} --version`);
      const version = stdout.trim();

      // Check if daemon is running
      const { stdout: psOutput } = await execAsync('ps aux | grep -c "[s]ignal-cli.*daemon"').catch(() => ({ stdout: '0' }));
      const daemonRunning = parseInt(psOutput.trim()) > 0;

      return `
✅ Bot Status:
Signal CLI: ${version}
Daemon: ${daemonRunning ? 'Running' : 'Stopped'}
Listening: ${this.isListening ? 'Yes' : 'No'}
Commands: ${this.messageHandlers.size} registered
AI: ${this.config.aiEnabled ? 'Enabled' : 'Disabled'}
      `.trim();
    } catch (error) {
      return `❌ Bot Status Check Failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Resolve phone number to Signal UUID
   */
  public async resolvePhoneToUuid(phoneNumber: string): Promise<string | null> {
    try {
      const cmd = `${this.config.signalCliPath} -a ${this.config.phoneNumber} getUserStatus ${phoneNumber} --json`;
      const { stdout } = await execAsync(cmd);
      
      const data = JSON.parse(stdout);
      return data.uuid || null;
    } catch (error) {
      console.error('Failed to resolve phone to UUID:', error);
      return null;
    }
  }

  /**
   * Get Signal account info
   */
  public async getAccountInfo(): Promise<any> {
    try {
      const cmd = `${this.config.signalCliPath} -a ${this.config.phoneNumber} listAccounts --json`;
      const { stdout } = await execAsync(cmd);
      
      return JSON.parse(stdout);
    } catch (error: any) {
      console.error('Failed to get account info:', error);
      throw error;
    }
  }
}