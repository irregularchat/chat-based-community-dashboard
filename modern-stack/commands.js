export class BaseCommand {
    constructor(name, description, usage = '') {
        this.name = name;
        this.description = description;
        this.usage = usage;
        this.adminOnly = false;
        this.groupOnly = false;
        this.dmOnly = false;
    }

    setAdminOnly(adminOnly = true) {
        this.adminOnly = adminOnly;
        return this;
    }

    setGroupOnly(groupOnly = true) {
        this.groupOnly = groupOnly;
        return this;
    }

    setDMOnly(dmOnly = true) {
        this.dmOnly = dmOnly;
        return this;
    }

    canExecute(context) {
        const { sender, groupId, bot } = context;

        // Check admin permission
        if (this.adminOnly) {
            const adminUsers = process.env.ADMIN_USERS?.split(',') || [];
            if (!adminUsers.includes(sender)) {
                return { allowed: false, reason: 'Admin privileges required' };
            }
        }

        // Check group/DM restrictions
        if (this.groupOnly && !groupId) {
            return { allowed: false, reason: 'This command can only be used in groups' };
        }

        if (this.dmOnly && groupId) {
            return { allowed: false, reason: 'This command can only be used in direct messages' };
        }

        return { allowed: true };
    }

    async execute(context) {
        throw new Error('execute() method must be implemented by command subclass');
    }
}

export class HelpCommand extends BaseCommand {
    constructor() {
        super('help', 'Show available commands', '!help [command]');
    }

    async execute(context) {
        const { bot, args, groupId, sender } = context;
        const commandName = args[0];

        if (commandName) {
            // Show specific command help
            for (const [pluginName, plugin] of bot.plugins) {
                if (plugin.commands && plugin.commands.has(commandName)) {
                    const command = plugin.commands.get(commandName);
                    const message = `**${command.name}**
${command.description}
Usage: ${command.usage || `!${command.name}`}`;
                    
                    await bot.sendMessage(sender, message, groupId);
                    return;
                }
            }
            
            await bot.sendMessage(sender, `Command '${commandName}' not found.`, groupId);
        } else {
            // Show all commands
            let helpText = '**Available Commands:**\\n\\n';
            
            for (const [pluginName, plugin] of bot.plugins) {
                if (plugin.commands && plugin.commands.size > 0) {
                    helpText += `**${pluginName} Plugin:**\\n`;
                    for (const [cmdName, cmd] of plugin.commands) {
                        helpText += `• !${cmd.name} - ${cmd.description}\\n`;
                    }
                    helpText += '\\n';
                }
            }
            
            helpText += 'Use `!help <command>` for detailed help on a specific command.';
            await bot.sendMessage(sender, helpText, groupId);
        }
    }
}

export class StatusCommand extends BaseCommand {
    constructor() {
        super('status', 'Show bot status and statistics', '!status');
    }

    async execute(context) {
        const { bot, groupId, sender } = context;
        
        const uptime = process.uptime();
        const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`;
        
        const status = `**Signal CLI Bot Status**

🤖 **Bot:** ${bot.botNumber}
⏰ **Uptime:** ${uptimeStr}
🔌 **WebSocket:** ${bot.isConnected ? '✅ Connected' : '❌ Disconnected'}
📦 **Plugins:** ${bot.plugins.size} loaded
📘 **Groups:** ${bot.groupCache.size} cached
🌐 **API:** ${bot.apiUrl}

**Loaded Plugins:**
${Array.from(bot.plugins.keys()).map(name => `• ${name}`).join('\\n')}`;

        await bot.sendMessage(sender, status, groupId);
    }
}

export default { BaseCommand, HelpCommand, StatusCommand };