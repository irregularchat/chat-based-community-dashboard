import { EventEmitter } from 'events';

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
  phoneNumber: string;
  restApiUrl?: string;
  aiEnabled?: boolean;
  openAiApiKey?: string;
}

export class RestSignalBotService extends EventEmitter {
  private config: SignalBotConfig;
  private isListening: boolean = false;
  private messageHandlers: Map<string, (message: SignalMessage) => Promise<void>> = new Map();
  private pollingInterval: NodeJS.Timeout | null = null;

  constructor(config: SignalBotConfig) {
    super();
    this.config = {
      restApiUrl: config.restApiUrl || 'http://localhost:50240',
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
      const helpText = `🤖 **Community Bot Help**

Available commands:
• !help or !phelp - Show this help message
• !ai <question> - Ask me anything using AI
• !commands - List all available commands
• !status - Check bot status
• !ping - Test if bot is responding

**AI Commands:**
• !ai hello - Get a greeting
• !ai how do I join a room? - Ask questions
• !ai what can you help me with? - Learn about capabilities

**Community Commands:**  
• !rooms - List available Matrix rooms
• !join <room> - Request to join a room
• !leave <room> - Leave a room
• !whoami - Show your user info

Type !ai <question> to ask me anything!

If you need more help, please contact an administrator.`;
      
      await this.sendMessage(message.sourceNumber, helpText);
    });

    // Personalized help command (same as help for now)
    this.registerCommand('!phelp', async (message) => {
      await this.messageHandlers.get('!help')!(message);
    });

    // Info command
    this.registerCommand('!info', async (message) => {
      const info = `🤖 Signal Bot Information
Version: 1.0.0
Status: Active
AI: ${this.config.aiEnabled ? 'Enabled' : 'Disabled'}
Connected: ${this.isListening ? 'Yes' : 'No'}
Phone: ${this.config.phoneNumber}`;
      
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
      const info = `👤 Your Signal Info:
Phone: ${message.sourceNumber}
UUID: ${message.sourceUuid}
Name: ${message.sourceName || 'Not set'}`;
      
      await this.sendMessage(message.sourceNumber, info);
    });

    // AI command
    this.registerCommand('!ai', async (message) => {
      if (!this.config.aiEnabled) {
        await this.sendMessage(message.sourceNumber, 
          "AI is enabled but OpenAI API key is not configured. Please contact an administrator.");
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

    // Commands list
    this.registerCommand('!commands', async (message) => {
      const commands = Array.from(this.messageHandlers.keys()).join('\n• ');
      await this.sendMessage(message.sourceNumber, `Available commands:\n• ${commands}`);
    });
  }

  /**
   * Register a command handler
   */
  public registerCommand(command: string, handler: (message: SignalMessage) => Promise<void>): void {
    this.messageHandlers.set(command.toLowerCase(), handler);
  }

  /**
   * Start listening for Signal messages using REST API polling
   */
  public async startListening(): Promise<void> {
    if (this.isListening) {
      console.log('Signal bot is already listening');
      return;
    }

    try {
      console.log('Starting Signal REST bot listener...');
      
      // Check if account exists before starting to poll
      const accountExists = await this.checkAccountRegistered();
      if (!accountExists) {
        console.log('Account not registered, skipping message polling until registration is complete');
        this.isListening = false;
        return;
      }
      
      this.isListening = true;
      
      // Start polling for messages
      this.pollingInterval = setInterval(async () => {
        await this.pollForMessages();
      }, 2000); // Poll every 2 seconds

      console.log('Signal REST bot listener started successfully');
    } catch (error) {
      console.error('Failed to start Signal REST bot listener:', error);
      this.isListening = false;
      throw error;
    }
  }

  /**
   * Stop listening for Signal messages
   */
  public async stopListening(): Promise<void> {
    this.isListening = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    console.log('Signal REST bot listener stopped');
  }

  /**
   * Check if the Signal account is registered with the REST API
   */
  private async checkAccountRegistered(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.restApiUrl}/v1/accounts`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        console.error('Failed to check accounts:', response.statusText);
        return false;
      }
      
      const accounts = await response.json();
      return Array.isArray(accounts) && accounts.some(account => account.number === this.config.phoneNumber);
    } catch (error) {
      console.error('Error checking account registration:', error);
      return false;
    }
  }

  /**
   * Poll the REST API for new messages
   */
  private async pollForMessages(): Promise<void> {
    try {
      const response = await fetch(`${this.config.restApiUrl}/v1/receive/${encodeURIComponent(this.config.phoneNumber)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error('Failed to poll for messages:', response.statusText);
        return;
      }

      const messages = await response.json();
      
      // Process received messages
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          await this.handleIncomingMessage(msg);
        }
      }
    } catch (error) {
      console.error('Error polling for messages:', error);
    }
  }

  /**
   * Handle incoming Signal message
   */
  private async handleIncomingMessage(messageData: any): Promise<void> {
    try {
      // Parse message from REST API format
      const message: SignalMessage = {
        timestamp: messageData.timestamp || Date.now(),
        source: messageData.source || messageData.sourceNumber,
        sourceNumber: messageData.sourceNumber || messageData.source,
        sourceUuid: messageData.sourceUuid || '',
        sourceName: messageData.sourceName || '',
        message: messageData.message || messageData.body || '',
        groupId: messageData.groupId,
        attachments: messageData.attachments
      };

      // Skip empty messages
      if (!message.message.trim()) {
        return;
      }

      console.log(`📱 Received Signal message from ${message.sourceNumber}: ${message.message}`);

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
    } catch (error) {
      console.error('Error handling incoming message:', error);
    }
  }

  /**
   * Send a message via Signal REST API
   */
  public async sendMessage(recipient: string, message: string): Promise<void> {
    try {
      const response = await fetch(`${this.config.restApiUrl}/v1/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          number: this.config.phoneNumber,
          recipients: [recipient],
          message: message
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to send message: ${response.status} ${errorText}`);
      }
      
      console.log(`📤 Message sent to ${recipient}`);
    } catch (error) {
      console.error('Failed to send Signal message:', error);
      throw error;
    }
  }

  /**
   * Get AI response for a specific question
   */
  private async getAIResponse(question: string, message: SignalMessage): Promise<string> {
    if (!this.config.openAiApiKey) {
      return "AI is enabled but OpenAI API key is not configured. Please contact an administrator.";
    }

    try {
      const { OpenAI } = await import('openai');
      const openai = new OpenAI({ apiKey: this.config.openAiApiKey });

      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',  // Using available model
        messages: [
          { 
            role: 'system', 
            content: `You are a helpful AI assistant for a community chat platform. Answer questions concisely and accurately. The user's name is ${message.sourceName || 'Unknown'}.` 
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
      // Check if REST API is accessible
      const response = await fetch(`${this.config.restApiUrl}/v1/about`);
      let apiStatus = 'Unknown';
      
      if (response.ok) {
        const about = await response.json();
        apiStatus = `v${about.version} (${about.mode})`;
      }

      return `✅ Bot Status:
REST API: ${apiStatus}
Listening: ${this.isListening ? 'Yes' : 'No'}
Commands: ${this.messageHandlers.size} registered
AI: ${this.config.aiEnabled ? 'Enabled' : 'Disabled'}
Phone: ${this.config.phoneNumber}`;
    } catch (error) {
      return `❌ Bot Status Check Failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }
}