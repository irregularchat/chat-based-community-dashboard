import { BasePlugin } from './base.js';
import { BaseCommand } from '../commands.js';

class HelpCommand extends BaseCommand {
    constructor() {
        super('help', 'Show available commands and their usage', '!help [command]');
    }

    async execute(context) {
        const { bot, args, groupId, sender } = context;
        const commandName = args[0];

        if (commandName) {
            // Show specific command help
            let found = false;
            for (const [pluginName, plugin] of bot.plugins) {
                if (plugin.commands && plugin.commands.has(commandName)) {
                    const command = plugin.commands.get(commandName);
                    const message = `**!${command.name}**

📝 **Description:** ${command.description}
💡 **Usage:** ${command.usage || `!${command.name}`}
${command.adminOnly ? '🔒 **Admin Only**' : ''}
${command.groupOnly ? '👥 **Group Only**' : ''}
${command.dmOnly ? '💬 **DM Only**' : ''}`;
                    
                    await bot.sendMessage(sender, message, groupId);
                    found = true;
                    break;
                }
            }
            
            if (!found) {
                await bot.sendMessage(sender, `❌ Command '!${commandName}' not found. Use !help to see all available commands.`, groupId);
            }
        } else {
            // Show all commands grouped by plugin
            let helpText = '🤖 **Signal Bot Commands**\\n\\n';
            
            // Group commands by plugin
            const pluginCommands = new Map();
            
            for (const [pluginName, plugin] of bot.plugins) {
                if (plugin.commands && plugin.commands.size > 0) {
                    const commands = Array.from(plugin.commands.values())
                        .filter(cmd => !cmd.adminOnly || context.sender && (process.env.ADMIN_USERS?.split(',') || []).includes(context.sender))
                        .sort((a, b) => a.name.localeCompare(b.name));
                    
                    if (commands.length > 0) {
                        pluginCommands.set(pluginName, commands);
                    }
                }
            }
            
            // Format commands by category
            for (const [pluginName, commands] of pluginCommands) {
                if (pluginName !== 'core') {
                    helpText += `📦 **${pluginName.charAt(0).toUpperCase() + pluginName.slice(1)} Plugin:**\\n`;
                } else {
                    helpText += `🔧 **Core Commands:**\\n`;
                }
                
                for (const cmd of commands) {
                    const restrictions = [];
                    if (cmd.adminOnly) restrictions.push('🔒');
                    if (cmd.groupOnly) restrictions.push('👥');
                    if (cmd.dmOnly) restrictions.push('💬');
                    const restrictionText = restrictions.length > 0 ? ` ${restrictions.join('')}` : '';
                    
                    helpText += `• **!${cmd.name}**${restrictionText} - ${cmd.description}\\n`;
                }
                helpText += '\\n';
            }
            
            helpText += '💡 **Usage:** Use `!help <command>` for detailed help on a specific command.\\n';
            helpText += '🔒 = Admin only, 👥 = Group only, 💬 = DM only';
            
            await bot.sendMessage(sender, helpText, groupId);
        }
    }
}

class AboutCommand extends BaseCommand {
    constructor() {
        super('about', 'Show information about this bot', '!about');
    }

    async execute(context) {
        const { bot, groupId, sender } = context;
        
        const aboutText = `🤖 **Signal CLI Bot**

**Purpose:** Community management and automation bot for IrregularChat
**Version:** 1.0.0
**Features:**
• 🎯 Plugin-based command system
• 👥 User onboarding automation
• 🤖 AI integration (GPT-5)
• 📊 Community analytics
• 🔐 Admin management tools
• 📝 Text processing utilities

**Plugins Loaded:** ${bot.plugins.size}
**Groups Connected:** ${bot.groupCache.size}

**Commands:** Type !help to see all available commands
**Support:** Contact administrators for assistance`;

        await bot.sendMessage(sender, aboutText, groupId);
    }
}

export default class HelpPlugin extends BasePlugin {
    constructor(bot) {
        super(bot, 'help');
        
        this.addCommand(new HelpCommand());
        this.addCommand(new AboutCommand());
    }
}