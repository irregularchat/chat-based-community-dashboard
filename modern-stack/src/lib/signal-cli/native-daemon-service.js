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
    
    this.daemon = null;
    this.socket = null;
    this.isListening = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    
    // Load plugins
    this.plugins = this.loadPlugins();
    
    console.log('🚀 Native Signal CLI Daemon Service initialized');
    console.log(`📱 Phone: ${this.phoneNumber}`);
    console.log(`📂 Data Dir: ${this.dataDir}`);
    console.log(`🔌 Socket: ${this.socketPath}`);
  }

  loadPlugins() {
    const plugins = new Map();
    const pluginsDir = path.join(__dirname, '../../../plugins');
    
    if (!fs.existsSync(pluginsDir)) {
      console.log('📦 No plugins directory found, creating basic commands...');
      return this.createBasicCommands();
    }

    try {
      const categories = fs.readdirSync(pluginsDir);
      for (const category of categories) {
        const categoryPath = path.join(pluginsDir, category);
        if (fs.statSync(categoryPath).isDirectory()) {
          const indexPath = path.join(categoryPath, 'index.js');
          if (fs.existsSync(indexPath)) {
            const plugin = require(indexPath);
            if (plugin.commands) {
              for (const [name, command] of Object.entries(plugin.commands)) {
                plugins.set(name, command);
              }
            }
          }
        }
      }
      console.log(`📦 Loaded ${plugins.size} plugin commands`);
      return plugins;
    } catch (error) {
      console.error('❌ Failed to load plugins:', error);
      return this.createBasicCommands();
    }
  }

  createBasicCommands() {
    const commands = new Map();
    
    commands.set('help', {
      name: 'help',
      description: 'Show available commands',
      execute: async (context) => {
        const commandList = Array.from(this.plugins.keys()).join(', ');
        return `Available commands: ${commandList}`;
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
        description: 'AI-powered responses',
        execute: async (context) => {
          const { OpenAI } = require('openai');
          const openai = new OpenAI({ apiKey: this.openAiApiKey });
          
          const prompt = context.args.join(' ') || 'Hello';
          const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 150
          });
          
          return response.choices[0].message.content;
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
          }
        } catch (error) {
          console.error('❌ Failed to parse message:', error);
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
    
    const message = {
      sourceNumber: envelope.sourceNumber,
      sourceName: envelope.sourceName,
      message: dataMessage.message,
      timestamp: envelope.timestamp,
      groupId: dataMessage.groupInfo?.groupId,
      groupName: dataMessage.groupInfo?.name
    };
    
    console.log(`📨 Message from ${message.sourceName || message.sourceNumber}: ${message.message}`);
    
    // Process command if it starts with !
    if (message.message.startsWith('!')) {
      await this.processCommand(message);
    }
    
    this.emit('message', message);
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
        account: this.phoneNumber,
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
      method: 'sendGroupMessage',
      params: {
        account: this.phoneNumber,
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
      
      const onData = (data) => {
        try {
          const response = JSON.parse(data.toString());
          if (response.id === request.id) {
            this.socket.off('data', onData);
            if (response.error) {
              reject(new Error(response.error.message || 'JSON-RPC error'));
            } else {
              resolve(response.result);
            }
          }
        } catch (error) {
          // Ignore parse errors for other messages
        }
      };
      
      this.socket.on('data', onData);
      this.socket.write(requestStr);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        this.socket.off('data', onData);
        reject(new Error('Request timeout'));
      }, 10000);
    });
  }

  async checkAccountRegistered() {
    try {
      const accountsFile = path.join(this.dataDir, 'data', 'accounts.json');
      if (!fs.existsSync(accountsFile)) {
        return false;
      }
      
      const accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf8'));
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
}

module.exports = { NativeSignalBotService };