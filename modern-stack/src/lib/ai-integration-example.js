/**
 * AI Integration Usage Example
 * 
 * This example demonstrates how to integrate the AIIntegration module
 * into your Signal bot to provide OpenAI, Local AI, and URL summarization capabilities.
 */

const AIIntegration = require('./ai-integration');
const { PrismaClient } = require('@prisma/client');

// Example usage in a Signal bot
class SignalBotWithAI {
  constructor() {
    // Initialize Prisma client for database operations
    this.prisma = new PrismaClient();
    
    // Initialize command plugins map (your existing commands)
    this.plugins = new Map();
    
    // Initialize AI integration
    this.aiIntegration = new AIIntegration({
      // API Keys - these should come from environment variables
      openAiApiKey: process.env.OPENAI_API_KEY,
      localAiUrl: process.env.LOCAL_AI_URL,
      localAiApiKey: process.env.LOCAL_AI_API_KEY,
      
      // Dependencies
      prisma: this.prisma,
      plugins: this.plugins,
      isAdmin: (userIdentifier, groupId) => this.isAdmin(userIdentifier, groupId),
      isModerator: (userIdentifier, groupId) => this.isModerator(userIdentifier, groupId),
      
      // Community context
      communityContext: {
        description: 'IrregularChat is a privacy-focused community focused on technology, security, and digital rights.',
        rules: [
          'Be respectful and kind',
          'Stay on topic',
          'No spam or excessive promotion',
          'Respect privacy and security practices',
          'Follow the Chatham House Rule when appropriate'
        ]
      },
      
      // URLs
      wikiUrl: 'https://wiki.irregularchat.com',
      forumUrl: 'https://forum.irregularchat.com',
      
      // News summaries map (initialize as needed)
      newsSummaries: new Map()
    });
    
    this.setupCommands();
  }
  
  setupCommands() {
    // Add OpenAI chat command
    this.plugins.set('ai', {
      name: 'ai',
      description: 'Context-aware AI responses using OpenAI GPT-5-mini',
      adminOnly: false,
      moderatorOnly: false,
      execute: async (context) => {
        return await this.aiIntegration.handleOpenAIChat(context);
      }
    });
    
    // Add Local AI chat command  
    this.plugins.set('lai', {
      name: 'lai',
      description: 'Context-aware Local AI responses (privacy-focused)',
      adminOnly: false,
      moderatorOnly: false,
      execute: async (context) => {
        return await this.aiIntegration.handleLocalAIChat(context);
      }
    });
    
    // Add URL summarization command
    this.plugins.set('tldr', {
      name: 'tldr',
      description: 'Summarize URL content with AI',
      adminOnly: false,
      moderatorOnly: false,
      execute: async (context) => {
        const url = context.args.join(' ');
        return await this.aiIntegration.summarizeUrl(url, context);
      }
    });
    
    // Add other commands as needed...
    this.plugins.set('help', {
      name: 'help',
      description: 'Show available commands',
      execute: async (context) => {
        const registry = this.aiIntegration.getCommandRegistry(context);
        let helpText = `Available Commands (${registry.totalAvailable}/${registry.totalCommands}):\n\n`;
        
        for (const [category, commands] of Object.entries(registry.categorized)) {
          if (commands.length > 0) {
            helpText += `**${category}:**\n`;
            commands.forEach(cmd => {
              helpText += `!${cmd.name} - ${cmd.description}\n`;
            });
            helpText += '\n';
          }
        }
        
        return helpText;
      }
    });
  }
  
  // Mock admin check - implement your actual admin logic
  isAdmin(userIdentifier, groupId) {
    // Example: check against a list of admin phone numbers or UUIDs
    const adminUsers = process.env.ADMIN_USERS?.split(',') || [];
    return adminUsers.includes(userIdentifier);
  }
  
  // Mock moderator check - implement your actual moderator logic
  isModerator(userIdentifier, groupId) {
    // Example: check against a list of moderator phone numbers or UUIDs
    const moderatorUsers = process.env.MODERATOR_USERS?.split(',') || [];
    return moderatorUsers.includes(userIdentifier) || this.isAdmin(userIdentifier, groupId);
  }
  
  // Handle incoming messages
  async handleMessage(message) {
    // Parse command from message
    const text = message.text || '';
    if (!text.startsWith('!')) {
      return; // Not a command
    }
    
    const [command, ...args] = text.slice(1).split(' ');
    const commandName = command.toLowerCase();
    
    // Create context object
    const context = {
      sourceNumber: message.sourceNumber,
      sourceUuid: message.sourceUuid,
      groupId: message.groupId,
      sender: message.sourceName || message.sourceNumber,
      args: args,
      // Add other context fields as needed
    };
    
    // Execute command
    const plugin = this.plugins.get(commandName);
    if (plugin) {
      try {
        const response = await plugin.execute(context);
        return response;
      } catch (error) {
        console.error(`Error executing command ${commandName}:`, error);
        return `Error executing command: ${error.message}`;
      }
    } else {
      return `Unknown command: !${commandName}. Type !help for available commands.`;
    }
  }
  
  // Cleanup method to clear old thread context
  startCleanupTimer() {
    // Clean up old AI thread context every hour
    setInterval(() => {
      this.aiIntegration.clearOldThreadContext();
    }, 60 * 60 * 1000);
  }
}

// Usage example
async function main() {
  const bot = new SignalBotWithAI();
  bot.startCleanupTimer();
  
  // Example message handling
  const exampleMessage = {
    text: '!ai what is quantum computing?',
    sourceNumber: '+1234567890',
    sourceUuid: 'user-uuid-123',
    sourceName: 'John Doe',
    groupId: 'group-123'
  };
  
  const response = await bot.handleMessage(exampleMessage);
  console.log('AI Response:', response);
}

// Environment variables needed:
console.log(`
Required Environment Variables:
- OPENAI_API_KEY: Your OpenAI API key
- LOCAL_AI_URL: URL of your local AI server (optional)
- LOCAL_AI_API_KEY: API key for local AI server (optional)  
- ADMIN_USERS: Comma-separated list of admin user identifiers
- MODERATOR_USERS: Comma-separated list of moderator user identifiers
- DATABASE_URL: PostgreSQL connection string for Prisma

Example .env file:
OPENAI_API_KEY=sk-your-openai-api-key-here
LOCAL_AI_URL=http://localhost:8080
LOCAL_AI_API_KEY=your-local-ai-key
ADMIN_USERS=+1234567890,admin-uuid-123
MODERATOR_USERS=+0987654321,mod-uuid-456
DATABASE_URL=postgresql://username:password@localhost:5432/database
`);

module.exports = SignalBotWithAI;

// Uncomment to run example
// main().catch(console.error);