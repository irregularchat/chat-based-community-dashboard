#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { spawn, exec } = require('child_process');

console.log('🤖 Signal Hybrid Bot Starting (Production Architecture)...\n');

class SignalHybridBot {
    constructor() {
        this.apiUrl = process.env.SIGNAL_API_URL || process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
        this.botNumber = process.env.SIGNAL_BOT_NUMBER || process.env.SIGNAL_PHONE_NUMBER || '+19108471202';
        this.dbPath = process.env.SIGNAL_BOT_DATABASE_PATH || './data/signal-bot.db';
        this.isConnected = false;
        this.processedMessages = new Set();
        this.commands = new Map();
        this.wsReconnectDelay = 5000;
        this.maxReconnectDelay = 30000;
        
        // Group ID normalization - critical for production
        this.groupIdMappings = new Map();
        this.targetGroup = process.env.ENTRY_ROOM_ID || 'group.UGpKQ1Q2ZDRuckYwL0JaT3MzOUVDWC9sWmtjSFBiaTY1SlU4QjZrZ3c2cz0=';
        
        console.log('📱 Bot Number:', this.botNumber);
        console.log('🌐 API URL:', this.apiUrl);
        console.log('🎯 Target Group:', this.targetGroup);
        console.log('💾 Database Path:', this.dbPath);
        
        this.initDatabase();
        this.registerCommands();
    }

    async initDatabase() {
        const dbDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        this.db = new sqlite3.Database(this.dbPath);
        
        // Initialize tables
        await this.runQuery(`
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_uuid TEXT,
                session_data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await this.runQuery(`
            CREATE TABLE IF NOT EXISTS message_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER,
                sender TEXT,
                message TEXT,
                group_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ Database initialized successfully');
    }

    runQuery(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
    }

    queryDatabase(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    registerCommands() {
        // Help command
        this.commands.set('help', async (message, from, groupId) => {
            const helpText = `🤖 **Signal Hybrid Bot Help**

Available commands:
• !help - Show this help message
• !ai <question> - Ask AI anything
• !ping - Test bot response
• !status - Show bot status
• !groups - List available groups
• !echo <text> - Echo your message
• !uptime - Show bot uptime

**AI Commands:**
• !ai hello - Get a greeting
• !ai how do I join a room? - Ask questions

Production features:
✅ WebSocket real-time receiving
✅ SQLite database storage
✅ Group ID normalization
✅ Hybrid CLI fallback for sending

Type !ai <question> to ask me anything!`;
            
            await this.sendMessage(from, helpText, groupId);
        });

        // AI command with OpenAI integration
        this.commands.set('ai', async (message, from, groupId) => {
            const question = message.replace(/^!ai\s+/i, '').trim();
            if (!question) {
                await this.sendMessage(from, "Please provide a question after !ai. Example: !ai How do I join a room?", groupId);
                return;
            }

            console.log(`🧠 AI request: "${question}" from ${from}`);
            const response = await this.getAIResponse(question, from);
            await this.sendMessage(from, response, groupId);
        });

        // Status command
        this.commands.set('status', async (message, from, groupId) => {
            const uptime = process.uptime();
            const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`;
            
            const status = `🤖 **Signal Hybrid Bot Status**

Version: Production Hybrid 1.0
Uptime: ${uptimeStr}
WebSocket: ${this.isConnected ? '✅ Connected' : '❌ Disconnected'}
Bot Number: ${this.botNumber}
API URL: ${this.apiUrl}
Commands: ${this.commands.size} registered
Target Group: ${this.targetGroup}

**Architecture:**
✅ Production-based WebSocket receiving
✅ SQLite database integration  
✅ Group ID normalization system
✅ Hybrid CLI fallback for group messaging
✅ Enhanced error handling`;
            
            await this.sendMessage(from, status, groupId);
        });

        // Ping command
        this.commands.set('ping', async (message, from, groupId) => {
            await this.sendMessage(from, '🏓 Pong! Hybrid bot is responsive.', groupId);
        });

        // Echo command
        this.commands.set('echo', async (message, from, groupId) => {
            const text = message.replace(/^!echo\s+/i, '').trim();
            if (text) {
                await this.sendMessage(from, `Echo: ${text}`, groupId);
            } else {
                await this.sendMessage(from, 'Please provide text to echo.', groupId);
            }
        });

        // Groups command
        this.commands.set('groups', async (message, from, groupId) => {
            try {
                const groups = await this.getGroups();
                if (groups.length === 0) {
                    await this.sendMessage(from, 'No Signal groups found.', groupId);
                } else {
                    let groupList = '📘 **Available Signal Groups:**\n\n';
                    groups.forEach((group, index) => {
                        groupList += `${index + 1}. ${group.name || 'Unnamed Group'}\n`;
                        groupList += `   ID: ${group.id.substring(0, 20)}...\n\n`;
                    });
                    await this.sendMessage(from, groupList, groupId);
                }
            } catch (error) {
                await this.sendMessage(from, `Error fetching groups: ${error.message}`, groupId);
            }
        });

        // Uptime command
        this.commands.set('uptime', async (message, from, groupId) => {
            const uptime = process.uptime();
            const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`;
            await this.sendMessage(from, `🕐 Bot uptime: ${uptimeStr}`, groupId);
        });

        console.log(`📋 Registered ${this.commands.size} commands`);
    }

    // Normalize group ID to handle the 3 different formats Signal uses
    normalizeGroupId(groupId) {
        if (!groupId) return null;
        
        // Check if already normalized and cached
        if (this.groupIdMappings.has(groupId)) {
            return this.groupIdMappings.get(groupId);
        }
        
        let normalized = groupId;
        
        // Remove 'group.' prefix if present
        if (normalized.startsWith('group.')) {
            normalized = normalized.substring(6);
        }
        
        // Convert from URL-safe base64 to regular base64 if needed
        try {
            // If it's URL-safe base64, convert to regular
            if (normalized.includes('-') || normalized.includes('_')) {
                normalized = normalized.replace(/-/g, '+').replace(/_/g, '/');
                // Add padding if needed
                while (normalized.length % 4) {
                    normalized += '=';
                }
            }
        } catch (error) {
            console.log(`⚠️ Could not normalize group ID: ${groupId}`);
        }
        
        // Cache the mapping
        this.groupIdMappings.set(groupId, normalized);
        
        return normalized;
    }

    async connectWebSocket() {
        try {
            const wsUrl = `${this.apiUrl.replace('http', 'ws')}/v1/receive/${encodeURIComponent(this.botNumber)}`;
            console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

            this.ws = new WebSocket(wsUrl);

            this.ws.on('open', () => {
                console.log('🎉 WebSocket connected successfully');
                this.isConnected = true;
                this.wsReconnectDelay = 5000; // Reset delay on successful connection
            });

            this.ws.on('message', async (data) => {
                try {
                    const messages = JSON.parse(data.toString());
                    if (Array.isArray(messages)) {
                        for (const message of messages) {
                            await this.handleIncomingMessage(message);
                        }
                    } else if (messages.envelope) {
                        await this.handleIncomingMessage(messages);
                    }
                } catch (error) {
                    console.error('❌ Error parsing WebSocket message:', error);
                }
            });

            this.ws.on('close', () => {
                console.log('🔌 WebSocket connection closed, attempting to reconnect...');
                this.isConnected = false;
                setTimeout(() => {
                    this.connectWebSocket();
                }, this.wsReconnectDelay);
                // Increase delay for next reconnection, but cap it
                this.wsReconnectDelay = Math.min(this.wsReconnectDelay * 1.5, this.maxReconnectDelay);
            });

            this.ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error);
                this.isConnected = false;
            });

        } catch (error) {
            console.error('❌ Failed to create WebSocket connection:', error);
            setTimeout(() => this.connectWebSocket(), this.wsReconnectDelay);
        }
    }

    async handleIncomingMessage(message) {
        try {
            if (!message.envelope || !message.envelope.dataMessage) return;

            const envelope = message.envelope;
            const dataMessage = envelope.dataMessage;
            
            if (!dataMessage.message) return;

            // Create unique message ID
            const msgId = `${envelope.timestamp}_${envelope.sourceNumber}`;
            if (this.processedMessages.has(msgId)) return;
            
            this.processedMessages.add(msgId);
            
            // Clean old processed messages (keep last 1000)
            if (this.processedMessages.size > 1000) {
                const toDelete = Array.from(this.processedMessages).slice(0, 500);
                toDelete.forEach(id => this.processedMessages.delete(id));
            }

            const text = dataMessage.message;
            const from = envelope.sourceName || envelope.sourceNumber;
            const groupId = dataMessage.groupInfo?.groupId;
            const normalizedGroupId = this.normalizeGroupId(groupId);

            console.log(`📨 Message from ${from}: "${text}"`);
            if (groupId) {
                console.log(`   Group ID: ${groupId}`);
                console.log(`   Normalized: ${normalizedGroupId}`);
            }

            // Store message in database
            await this.storeMessage(envelope.timestamp, from, text, normalizedGroupId);

            // Skip bot's own messages
            if (text.startsWith('Bot:')) {
                console.log('   🤖 Skipping bot message');
                return;
            }

            // Process the message if it's a command or from target group
            if (text.startsWith('!')) {
                await this.handleCommand(text, from, groupId);
            } else {
                await this.handleNaturalLanguage(text, from, groupId);
            }

        } catch (error) {
            console.error('❌ Error handling incoming message:', error);
        }
    }

    async storeMessage(timestamp, sender, message, groupId) {
        try {
            await this.runQuery(
                'INSERT INTO message_history (timestamp, sender, message, group_id) VALUES (?, ?, ?, ?)',
                [timestamp, sender, message, groupId]
            );
        } catch (error) {
            console.error('❌ Error storing message:', error);
        }
    }

    async handleCommand(text, from, groupId) {
        const [command, ...args] = text.slice(1).split(' ');
        const commandLower = command.toLowerCase();
        
        console.log(`🎯 Command: !${commandLower} from ${from}`);
        
        if (this.commands.has(commandLower)) {
            try {
                await this.commands.get(commandLower)(text, from, groupId);
            } catch (error) {
                console.error(`❌ Command ${commandLower} error:`, error);
                await this.sendMessage(from, `❌ Error executing command: ${error.message}`, groupId);
            }
        } else {
            await this.sendMessage(from, `❓ Unknown command: !${command}. Type !help for available commands.`, groupId);
        }
    }

    async handleNaturalLanguage(text, from, groupId) {
        // Check for greetings or questions
        const lowerText = text.toLowerCase();
        
        if (['hello', 'hi', 'hey'].some(greeting => lowerText.includes(greeting))) {
            await this.sendMessage(from, `Hello ${from}! I'm the Signal hybrid bot. Type !help for commands or !ai <question> to ask me anything.`, groupId);
        } else if (text.includes('?') && text.length > 10) {
            // Auto-route questions to AI
            console.log(`❓ Question detected, routing to AI: "${text}"`);
            const response = await this.getAIResponse(text, from);
            await this.sendMessage(from, response, groupId);
        }
    }

    // Hybrid messaging: Try REST API first, fallback to CLI if needed
    async sendMessage(recipient, message, groupId = null) {
        try {
            console.log(`📤 Sending message to ${recipient || groupId}: ${message.substring(0, 100)}...`);
            
            // Try REST API first
            const success = await this.sendViaRestAPI(recipient, message, groupId);
            if (success) {
                return true;
            }
            
            // Fallback to CLI for group messages (production pattern)
            if (groupId) {
                console.log('🔧 REST API failed for group message, trying CLI fallback...');
                return await this.sendViaCLI(message, groupId);
            }
            
            return false;
        } catch (error) {
            console.error('❌ Error sending message:', error);
            return false;
        }
    }

    async sendViaRestAPI(recipient, message, groupId = null) {
        try {
            const payload = {
                message: `Bot: ${message}`,
                number: this.botNumber,
                recipients: groupId ? [] : [recipient]
            };

            if (groupId) {
                payload.recipients = [this.normalizeGroupId(groupId)];
            }

            const response = await fetch(`${this.apiUrl}/v2/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const result = await response.json();
                console.log(`✅ REST API send successful`);
                return true;
            } else {
                const error = await response.text();
                console.log(`❌ REST API send failed: ${response.status} ${error}`);
                return false;
            }
        } catch (error) {
            console.error('❌ REST API error:', error);
            return false;
        }
    }

    // Production CLI fallback pattern (hybrid approach)
    async sendViaCLI(message, groupId) {
        return new Promise((resolve) => {
            try {
                const normalizedGroupId = this.normalizeGroupId(groupId);
                const command = `signal-cli --config=/home/.local/share/signal-cli send -g "${normalizedGroupId}" -m "Bot: ${message.replace(/"/g, '\\"')}"`;
                
                console.log(`🔧 Executing CLI command: ${command.substring(0, 100)}...`);
                
                exec(command, (error, stdout, stderr) => {
                    if (error) {
                        console.error('❌ CLI send error:', error);
                        resolve(false);
                    } else {
                        console.log('✅ CLI send successful');
                        resolve(true);
                    }
                });
            } catch (error) {
                console.error('❌ CLI execution error:', error);
                resolve(false);
            }
        });
    }

    async getAIResponse(question, from) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return "🤖 AI is configured but OpenAI API key is not set. Please contact an administrator.";
        }

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-5-mini',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a helpful Signal bot for the IrregularChat community. Keep responses concise and friendly. Help with community questions and general support.'
                        },
                        {
                            role: 'user',
                            content: question
                        }
                    ],
                    max_completion_tokens: 500,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const error = await response.text();
                console.error('OpenAI error:', error);
                return `🤖 I'm having trouble with my AI service. Your question was: "${question}"`;
            }

            const data = await response.json();
            const aiResponse = data.choices[0].message.content;
            console.log(`🧠 AI response generated (${aiResponse.length} chars)`);
            return aiResponse;
        } catch (error) {
            console.error('AI error:', error.message);
            return `🤖 AI service temporarily unavailable. Your question: "${question}"`;
        }
    }

    async getGroups() {
        try {
            const response = await fetch(`${this.apiUrl}/v1/groups/${encodeURIComponent(this.botNumber)}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const groups = await response.json();
            console.log(`📘 Found ${groups.length} Signal groups`);
            
            return groups || [];
        } catch (error) {
            console.error('❌ Failed to fetch groups:', error);
            return [];
        }
    }

    async start() {
        console.log('🚀 Starting Signal Hybrid Bot...\n');
        
        // Connect WebSocket for receiving messages
        await this.connectWebSocket();
        
        // Send startup message to target group
        setTimeout(async () => {
            await this.sendMessage(null, '🤖 Signal Hybrid Bot is active! Production architecture with WebSocket + CLI fallback. Type !help for commands or !ai <question> to ask me anything!', this.targetGroup);
        }, 2000);

        console.log('✅ Signal Hybrid Bot is running!');
        console.log(`📞 Bot number: ${this.botNumber}`);
        console.log(`🔌 WebSocket connection active`);
        console.log(`💾 SQLite database ready`);
        console.log(`🎯 Target group: ${this.targetGroup}`);
        console.log(`🤖 Commands registered: ${Array.from(this.commands.keys()).join(', ')}`);
    }

    async stop() {
        console.log('🛑 Stopping Signal Hybrid Bot...');
        
        if (this.ws) {
            this.ws.close();
        }
        
        if (this.db) {
            this.db.close();
        }
        
        // Send goodbye message
        await this.sendMessage(null, '🤖 Signal Hybrid Bot going offline. Goodbye! 👋', this.targetGroup);
    }
}

// Start the bot
const bot = new SignalHybridBot();
bot.start().catch(error => {
    console.error('💥 Failed to start bot:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down Signal Hybrid Bot...');
    await bot.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n👋 Shutting down Signal Hybrid Bot...');
    await bot.stop();
    process.exit(0);
});