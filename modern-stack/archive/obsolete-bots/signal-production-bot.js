import dotenv from 'dotenv';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

class SignalBot {
    constructor() {
        this.apiUrl = process.env.SIGNAL_API_URL || 'http://localhost:50240';
        this.botNumber = process.env.SIGNAL_BOT_NUMBER || process.env.SIGNAL_PHONE_NUMBER;
        this.dbPath = process.env.SIGNAL_BOT_DATABASE_PATH || './data/signal-bot.db';
        this.plugins = new Map();
        this.groupCache = new Map();
        this.isConnected = false;
        
        this.initDatabase();
        this.loadPlugins();
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
            CREATE TABLE IF NOT EXISTS plugin_data (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plugin_name TEXT,
                data_key TEXT,
                data_value TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    async loadPlugins() {
        const pluginsDir = path.join(__dirname, 'plugins');
        if (!fs.existsSync(pluginsDir)) {
            console.log('⚠️ Plugins directory not found, creating it...');
            fs.mkdirSync(pluginsDir, { recursive: true });
            return;
        }

        const pluginFolders = fs.readdirSync(pluginsDir, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);

        for (const folderName of pluginFolders) {
            try {
                const pluginPath = path.join(pluginsDir, folderName, 'index.js');
                if (!fs.existsSync(pluginPath)) {
                    console.log(`⚠️ Plugin ${folderName} missing index.js, skipping...`);
                    continue;
                }

                const { default: PluginClass } = await import(`file://${pluginPath}`);
                if (PluginClass && typeof PluginClass === 'function') {
                    const plugin = new PluginClass(this);
                    this.plugins.set(folderName, plugin);
                    console.log(`✅ Loaded plugin: ${folderName}`);
                } else {
                    console.log(`⚠️ Invalid plugin format: ${folderName}`);
                }
            } catch (error) {
                console.error(`❌ Failed to load plugin ${folderName}:`, error.message);
            }
        }

        console.log(`📦 Loaded ${this.plugins.size} plugins total`);
    }

    async connectWebSocket() {
        const wsUrl = this.apiUrl.replace('http', 'ws') + '/ws';
        console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

        this.ws = new WebSocket(wsUrl);

        this.ws.on('open', () => {
            console.log('🎉 WebSocket connected successfully');
            this.isConnected = true;
        });

        this.ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());
                await this.handleIncomingMessage(message);
            } catch (error) {
                console.error('❌ Error parsing WebSocket message:', error);
            }
        });

        this.ws.on('close', () => {
            console.log('🔌 WebSocket connection closed, attempting to reconnect...');
            this.isConnected = false;
            setTimeout(() => this.connectWebSocket(), 5000);
        });

        this.ws.on('error', (error) => {
            console.error('❌ WebSocket error:', error);
            this.isConnected = false;
        });
    }

    async handleIncomingMessage(message) {
        try {
            // Handle different message types
            if (message.envelope && message.envelope.dataMessage) {
                const dataMessage = message.envelope.dataMessage;
                const sender = message.envelope.source || message.envelope.sourceNumber;
                const text = dataMessage.message;
                
                if (text && text.startsWith('!')) {
                    await this.handleCommand(message);
                }
            } else if (message.envelope && message.envelope.syncMessage) {
                // Handle sync messages (messages from other devices)
                console.log('📱 Received sync message');
            }
        } catch (error) {
            console.error('❌ Error handling incoming message:', error);
        }
    }

    async handleCommand(message) {
        const dataMessage = message.envelope.dataMessage;
        const sender = message.envelope.source || message.envelope.sourceNumber;
        const groupId = dataMessage.groupInfo?.groupId;
        const text = dataMessage.message;
        
        if (!text) return;

        const [command, ...args] = text.slice(1).split(' ');
        console.log(`📝 Command received: !${command} from ${sender}`);

        // Create context object for plugins
        const context = {
            message,
            sender,
            groupId,
            command: command.toLowerCase(),
            args,
            text,
            dataMessage,
            mentions: dataMessage.mentions || [],
            bot: this
        };

        // Try to handle command with plugins
        for (const [pluginName, plugin] of this.plugins) {
            try {
                if (plugin.canHandle && plugin.canHandle(context)) {
                    console.log(`🔌 Plugin ${pluginName} handling command: !${command}`);
                    await plugin.handleCommand(context);
                    return;
                }
            } catch (error) {
                console.error(`❌ Plugin ${pluginName} error:`, error);
            }
        }

        console.log(`❓ No plugin handled command: !${command}`);
    }

    async sendMessage(recipient, message, groupId = null) {
        try {
            const payload = {
                message,
                number: this.botNumber,
                recipients: groupId ? [] : [recipient]
            };

            if (groupId) {
                payload.groupId = groupId;
            }

            const response = await fetch(`${this.apiUrl}/v2/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            console.log(`📤 Message sent to ${recipient || groupId}`);
            return true;
        } catch (error) {
            console.error('❌ Failed to send message:', error);
            return false;
        }
    }

    async sendMessageWithMentions(recipient, message, mentions = [], groupId = null) {
        try {
            const payload = {
                message,
                number: this.botNumber,
                recipients: groupId ? [] : [recipient],
                mentions: mentions.map(mention => ({
                    start: mention.start,
                    length: mention.length,
                    uuid: mention.uuid
                }))
            };

            if (groupId) {
                payload.groupId = groupId;
            }

            const response = await fetch(`${this.apiUrl}/v2/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            console.log(`📤 Message with mentions sent to ${recipient || groupId}`);
            return true;
        } catch (error) {
            console.error('❌ Failed to send message with mentions:', error);
            return false;
        }
    }

    async getGroups() {
        try {
            const response = await fetch(`${this.apiUrl}/v1/groups/${this.botNumber}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const groups = await response.json();
            
            // Update group cache
            for (const group of groups) {
                this.groupCache.set(group.id, group);
            }

            console.log(`📘 Found ${groups.length} Signal groups`);
            
            // Log groups for debugging
            groups.forEach(group => {
                console.log(`🔍 Group: ${group.name} (${group.id})`);
            });

            return groups;
        } catch (error) {
            console.error('❌ Failed to fetch groups:', error);
            return [];
        }
    }

    async start() {
        console.log('🚀 Starting Signal CLI Bot...');
        
        // Fetch groups periodically
        setInterval(() => {
            this.getGroups();
        }, 30000); // Every 30 seconds

        // Initial group fetch
        await this.getGroups();

        // Connect to WebSocket for real-time messages
        await this.connectWebSocket();

        console.log('✅ Signal CLI Bot is running and ready for commands!');
        console.log(`📞 Bot number: ${this.botNumber}`);
        console.log(`🌐 API URL: ${this.apiUrl}`);
        console.log(`🔌 Plugins loaded: ${Array.from(this.plugins.keys()).join(', ')}`);
    }
}

// Start the bot
const bot = new SignalBot();
bot.start().catch(error => {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('👋 Shutting down Signal CLI Bot...');
    if (bot.ws) {
        bot.ws.close();
    }
    if (bot.db) {
        bot.db.close();
    }
    process.exit(0);
});

export default SignalBot;