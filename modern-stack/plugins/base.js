import { BaseCommand, HelpCommand, StatusCommand } from '../commands.js';

export class BasePlugin {
    constructor(bot, name = 'Unknown Plugin') {
        this.bot = bot;
        this.name = name;
        this.commands = new Map();
        this.enabled = true;
        
        this.setupDefaultCommands();
    }

    setupDefaultCommands() {
        // Add help command to all plugins
        if (this.name === 'core') {
            this.addCommand(new HelpCommand());
            this.addCommand(new StatusCommand());
        }
    }

    addCommand(command) {
        if (!(command instanceof BaseCommand)) {
            throw new Error('Command must be an instance of BaseCommand');
        }
        
        this.commands.set(command.name, command);
    }

    canHandle(context) {
        const { command } = context;
        return this.enabled && this.commands.has(command);
    }

    async handleCommand(context) {
        const { command } = context;
        
        if (!this.commands.has(command)) {
            return false;
        }

        const commandObj = this.commands.get(command);
        const permission = commandObj.canExecute(context);

        if (!permission.allowed) {
            await this.bot.sendMessage(
                context.sender,
                `❌ ${permission.reason}`,
                context.groupId
            );
            return false;
        }

        try {
            await commandObj.execute(context);
            return true;
        } catch (error) {
            console.error(`❌ Command ${command} execution error:`, error);
            await this.bot.sendMessage(
                context.sender,
                `❌ An error occurred while executing the command.`,
                context.groupId
            );
            return false;
        }
    }

    // Helper methods for plugins
    async sendMessage(recipient, message, groupId = null) {
        return await this.bot.sendMessage(recipient, message, groupId);
    }

    async sendMessageWithMentions(recipient, message, mentions = [], groupId = null) {
        return await this.bot.sendMessageWithMentions(recipient, message, mentions, groupId);
    }

    async getPluginData(key) {
        try {
            const rows = await this.bot.queryDatabase(
                'SELECT data_value FROM plugin_data WHERE plugin_name = ? AND data_key = ?',
                [this.name, key]
            );
            return rows.length > 0 ? JSON.parse(rows[0].data_value) : null;
        } catch (error) {
            console.error(`❌ Error getting plugin data for ${this.name}:`, error);
            return null;
        }
    }

    async setPluginData(key, value) {
        try {
            const jsonValue = JSON.stringify(value);
            await this.bot.runQuery(`
                INSERT OR REPLACE INTO plugin_data (plugin_name, data_key, data_value, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            `, [this.name, key, jsonValue]);
            return true;
        } catch (error) {
            console.error(`❌ Error setting plugin data for ${this.name}:`, error);
            return false;
        }
    }

    async deletePluginData(key) {
        try {
            await this.bot.runQuery(
                'DELETE FROM plugin_data WHERE plugin_name = ? AND data_key = ?',
                [this.name, key]
            );
            return true;
        } catch (error) {
            console.error(`❌ Error deleting plugin data for ${this.name}:`, error);
            return false;
        }
    }

    // Utility methods
    isGroupMessage(context) {
        return !!context.groupId;
    }

    isDMMessage(context) {
        return !context.groupId;
    }

    isFromAdmin(context) {
        const adminUsers = process.env.ADMIN_USERS?.split(',') || [];
        return adminUsers.includes(context.sender);
    }

    extractMentions(message) {
        // Extract @username patterns from message text
        const mentionRegex = /@([a-zA-Z0-9_.-]+)/g;
        const mentions = [];
        let match;
        
        while ((match = mentionRegex.exec(message)) !== null) {
            mentions.push({
                username: match[1],
                start: match.index,
                length: match[0].length
            });
        }
        
        return mentions;
    }

    formatMention(uuid, displayName = null) {
        // Signal uses a special Unicode character for mentions
        return `\uFFFC${displayName || 'User'}`;
    }

    log(level, message, ...args) {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${this.name}] [${level.toUpperCase()}]`;
        console.log(`${prefix} ${message}`, ...args);
    }

    logInfo(message, ...args) {
        this.log('info', message, ...args);
    }

    logError(message, ...args) {
        this.log('error', message, ...args);
    }

    logWarn(message, ...args) {
        this.log('warn', message, ...args);
    }

    logDebug(message, ...args) {
        if (process.env.DEBUG === 'true') {
            this.log('debug', message, ...args);
        }
    }
}

// Core Plugin for basic commands
export class CorePlugin extends BasePlugin {
    constructor(bot) {
        super(bot, 'core');
    }
}

export default BasePlugin;