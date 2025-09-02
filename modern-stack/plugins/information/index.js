import { BasePlugin } from '../base.js';
import { BaseCommand } from '../../commands.js';

// Information and Resource Commands
class WikiCommand extends BaseCommand {
  constructor() {
    super('wiki', 'Search IrregularChat wiki', '!wiki <search-term>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('information');
    return await plugin.handleWiki(context);
  }
}

class ForumCommand extends BaseCommand {
  constructor() {
    super('forum', 'Search forum posts', '!forum <search-term>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('information');
    return await plugin.handleForum(context);
  }
}

class EventsCommand extends BaseCommand {
  constructor() {
    super('events', 'Show upcoming community events', '!events [count]');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('information');
    return await plugin.handleEvents(context);
  }
}

class FAQCommand extends BaseCommand {
  constructor() {
    super('faq', 'Get answers to frequently asked questions', '!faq <topic>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('information');
    return await plugin.handleFAQ(context);
  }
}

class DocsCommand extends BaseCommand {
  constructor() {
    super('docs', 'Search documentation', '!docs <search-term>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('information');
    return await plugin.handleDocs(context);
  }
}

class LinksCommand extends BaseCommand {
  constructor() {
    super('links', 'Show important community links', '!links');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('information');
    return await plugin.handleLinks(context);
  }
}

class ChangelogCommand extends BaseCommand {
  constructor() {
    super('changelog', 'Show recent updates and changes', '!changelog [count]');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('information');
    return await plugin.handleChangelog(context);
  }
}

export default class InformationPlugin extends BasePlugin {
  constructor(bot) {
    super(bot, 'information');
    
    // Community resources database
    this.resources = new Map([
      // Learning Resources
      ['ai-resources', {
        title: 'AI/ML Resources',
        url: 'https://irregularpedia.org/index.php/AI_Resources',
        category: 'Learning',
        description: 'Comprehensive AI and machine learning resources'
      }],
      ['learning', {
        title: 'Learning Hub',
        url: 'https://irregularpedia.org/index.php/Learning',
        category: 'Learning', 
        description: 'Tutorials and learning materials'
      }],
      
      // Technical Resources
      ['wiki', {
        title: 'IrregularPedia',
        url: 'https://irregularpedia.org/index.php/Main_Page',
        category: 'Documentation',
        description: 'Community knowledge base and wiki'
      }],
      ['forum', {
        title: 'Community Forum',
        url: 'https://forum.irregularchat.com',
        category: 'Community',
        description: 'Discussion forum and announcements'
      }],
      ['chat', {
        title: 'Chat Access',
        url: 'https://url.irregular.chat/chats',
        category: 'Communication',
        description: 'Matrix chat access (login required)'
      }],
      
      // Services
      ['sso', {
        title: 'Single Sign-On',
        url: 'https://sso.irregularchat.com',
        category: 'Services',
        description: 'Authentication and account management'
      }],
      ['cryptpad', {
        title: 'CryptPad',
        url: 'https://cryptpad.irregularchat.com',
        category: 'Services',
        description: 'Encrypted collaboration platform'
      }],
      ['search', {
        title: 'Search Proxy',
        url: 'https://search.irregularchat.com',
        category: 'Services',
        description: 'Privacy-focused search proxy'
      }],
      ['matrix', {
        title: 'Matrix Server',
        url: 'https://matrix.irregularchat.com/',
        category: 'Communication',
        description: 'Matrix homeserver'
      }]
    ]);
    
    // FAQ Database
    this.faqs = new Map([
      ['join', {
        question: 'How do I join a group?',
        answer: 'Use `!join <group-name>` to request access to a group. Use `!groups` to see available groups.'
      }],
      ['rules', {
        question: 'What are the community rules?',
        answer: `📜 **IrregularChat Rules:**
1. Leave rank and ego at the door
2. Stay on topic - mark jokes with /j or /s  
3. NEVER joke about classified information
4. Avoid sharing PII or classified data
5. Follow Chatham House Rule
6. Be respectful to all members
7. Contribute to wiki and forum`
      }],
      ['sso', {
        question: 'How do I access SSO/login?',
        answer: 'Visit https://sso.irregularchat.com to access your account. Contact admins if you need account creation.'
      }],
      ['wiki', {
        question: 'How do I contribute to the wiki?',
        answer: 'Visit https://irregularpedia.org and create an account. Follow the contribution guidelines on the main page.'
      }],
      ['matrix', {
        question: 'How do I access Matrix chat?',
        answer: 'Use https://url.irregular.chat/chats (requires SSO login) or connect directly to matrix.irregularchat.com'
      }],
      ['help', {
        question: 'How do I get help?',
        answer: 'Use `!help` for commands, `!faq <topic>` for common questions, or ask in the appropriate group.'
      }]
    ]);
    
    // Register commands
    this.addCommand(new WikiCommand());
    this.addCommand(new ForumCommand());
    this.addCommand(new EventsCommand());
    this.addCommand(new FAQCommand());
    this.addCommand(new DocsCommand());
    this.addCommand(new LinksCommand());
    this.addCommand(new ChangelogCommand());
    
    this.logInfo('Information plugin initialized');
  }

  async handleWiki(context) {
    const { args } = context;
    
    if (!args) {
      return `📚 **IrregularPedia Wiki**

🔍 **Search:** \`!wiki <search-term>\`

**Popular Pages:**
• AI Resources - \`!wiki ai\`
• Learning Hub - \`!wiki learning\`  
• Security - \`!wiki security\`
• Hardware - \`!wiki hardware\`

**Main Wiki:** https://irregularpedia.org/index.php/Main_Page

💡 Use specific search terms to find relevant pages.`;
    }
    
    const searchTerm = args.toLowerCase();
    
    // Mock wiki search results
    const wikiResults = [
      { title: 'AI Resources', url: 'https://irregularpedia.org/index.php/AI_Resources', relevance: searchTerm.includes('ai') ? 95 : 20 },
      { title: 'Learning Hub', url: 'https://irregularpedia.org/index.php/Learning', relevance: searchTerm.includes('learn') ? 90 : 15 },
      { title: 'Security Guidelines', url: 'https://irregularpedia.org/index.php/Security', relevance: searchTerm.includes('security') ? 95 : 10 },
      { title: 'Hardware Projects', url: 'https://irregularpedia.org/index.php/Hardware', relevance: searchTerm.includes('hardware') ? 90 : 5 }
    ].filter(result => result.relevance > 50 || searchTerm.includes(result.title.toLowerCase().split(' ')[0]));
    
    if (wikiResults.length === 0) {
      return `🔍 **Wiki Search: "${args}"**

No direct matches found.

**Suggestions:**
• Try broader search terms
• Visit main wiki: https://irregularpedia.org
• Use \`!resources\` for general resources
• Ask in relevant groups for specific topics`;
    }
    
    let response = `🔍 **Wiki Search: "${args}"**\n\n`;
    
    for (const result of wikiResults.slice(0, 3)) {
      response += `📄 **${result.title}**\n${result.url}\n\n`;
    }
    
    response += '💡 Visit https://irregularpedia.org to browse all pages.';
    
    return response;
  }

  async handleForum(context) {
    const { args } = context;
    
    if (!args) {
      return `💬 **Community Forum**

🔍 **Search:** \`!forum <search-term>\`

**Recent Categories:**
• Announcements
• Technical Discussions  
• Project Showcases
• Q&A
• Community Events

**Forum:** https://forum.irregularchat.com

💡 Use specific keywords to find relevant discussions.`;
    }
    
    return `🔍 **Forum Search: "${args}"**

**Search Results:**
📌 Found discussions related to "${args}" on the forum.

**Visit Forum:** https://forum.irregularchat.com
**Search URL:** https://forum.irregularchat.com/search?q=${encodeURIComponent(args)}

💡 Use the forum for longer discussions and project collaboration.`;
  }

  async handleEvents(context) {
    const { args } = context;
    const count = args ? parseInt(args) || 5 : 5;
    
    // Mock upcoming events
    const events = [
      {
        title: 'AI/ML Study Group',
        date: '2025-09-05',
        time: '19:00 UTC',
        location: 'Virtual - AI/ML Group',
        description: 'Weekly study session on transformer architectures'
      },
      {
        title: 'Security Workshop', 
        date: '2025-09-10',
        time: '20:00 UTC',
        location: 'Virtual - Purple Team Group',
        description: 'Hands-on penetration testing workshop'
      },
      {
        title: 'Tampa Meetup',
        date: '2025-09-15', 
        time: '18:00 EST',
        location: 'Tampa, FL',
        description: 'In-person networking and tech talks'
      },
      {
        title: 'Hardware Hackathon',
        date: '2025-09-20',
        time: '10:00 UTC',
        location: 'Virtual - Hardware Group',
        description: '48-hour hardware development challenge'
      },
      {
        title: 'Career Panel',
        date: '2025-09-25',
        time: '19:30 UTC', 
        location: 'Virtual - Tech General',
        description: 'Industry veterans discuss career paths'
      }
    ];
    
    const upcomingEvents = events.slice(0, count);
    
    let response = `📅 **Upcoming Events** (Next ${count})\n\n`;
    
    for (const event of upcomingEvents) {
      response += `🎯 **${event.title}**\n`;
      response += `📅 ${event.date} at ${event.time}\n`;
      response += `📍 ${event.location}\n`;
      response += `📝 ${event.description}\n\n`;
    }
    
    response += `💡 **More Events:**\n`;
    response += `• Check forum: https://forum.irregularchat.com/c/events\n`;
    response += `• Use \`!events 10\` to see more\n`;
    response += `• Join relevant groups for notifications`;
    
    return response;
  }

  async handleResources(context) {
    const { args } = context;
    const category = args ? args.toLowerCase() : null;
    
    // Filter by category if specified
    const filteredResources = Array.from(this.resources.entries())
      .filter(([key, resource]) => {
        if (!category) return true;
        return resource.category.toLowerCase().includes(category) || 
               resource.title.toLowerCase().includes(category);
      });
    
    if (filteredResources.length === 0) {
      return `❌ No resources found for category "${args}"\n\nAvailable categories: Learning, Documentation, Community, Services, Communication`;
    }
    
    // Group by category
    const categories = new Map();
    
    for (const [key, resource] of filteredResources) {
      if (!categories.has(resource.category)) {
        categories.set(resource.category, []);
      }
      categories.get(resource.category).push(resource);
    }
    
    let response = category ? 
      `📚 **${category.charAt(0).toUpperCase() + category.slice(1)} Resources**\n\n` :
      `📚 **IrregularChat Resources**\n\n`;
    
    for (const [categoryName, resources] of categories) {
      response += `**${categoryName}:**\n`;
      for (const resource of resources) {
        response += `• **${resource.title}**\n  ${resource.url}\n  ${resource.description}\n\n`;
      }
    }
    
    response += `💡 **Tips:**\n`;
    response += `• Use \`!resources <category>\` to filter\n`;
    response += `• Use \`!wiki <term>\` to search wiki\n`;
    response += `• Use \`!forum <term>\` to search forum`;
    
    return response;
  }

  async handleFAQ(context) {
    const { args } = context;
    
    if (!args) {
      const topics = Array.from(this.faqs.keys());
      return `❓ **Frequently Asked Questions**

**Available Topics:**
${topics.map(topic => `• \`!faq ${topic}\``).join('\n')}

**Usage:** \`!faq <topic>\` to get specific answers

💡 Can't find what you're looking for? Ask in the relevant group or use \`!help\`.`;
    }
    
    const topic = args.toLowerCase();
    const faq = this.faqs.get(topic);
    
    if (!faq) {
      const availableTopics = Array.from(this.faqs.keys()).join(', ');
      return `❌ FAQ topic "${args}" not found.\n\nAvailable topics: ${availableTopics}`;
    }
    
    return `❓ **${faq.question}**

${faq.answer}

💡 Use \`!faq\` to see all available topics.`;
  }

  async handleDocs(context) {
    const { args } = context;
    
    if (!args) {
      return `📖 **Documentation Search**

🔍 **Usage:** \`!docs <search-term>\`

**Documentation Categories:**
• API Documentation
• Setup Guides  
• Security Protocols
• Development Standards
• Deployment Procedures

**Main Resources:**
• Wiki: https://irregularpedia.org
• Forum: https://forum.irregularchat.com
• GitHub: https://github.com/irregularchat

💡 Use specific terms to find relevant documentation.`;
    }
    
    const searchTerm = args.toLowerCase();
    
    // Mock documentation search
    const docResults = [
      { title: 'Signal Bot Setup Guide', category: 'Setup', relevance: searchTerm.includes('signal') || searchTerm.includes('bot') ? 95 : 10 },
      { title: 'Matrix Bridge Configuration', category: 'Setup', relevance: searchTerm.includes('matrix') || searchTerm.includes('bridge') ? 90 : 5 },
      { title: 'API Documentation', category: 'Development', relevance: searchTerm.includes('api') || searchTerm.includes('dev') ? 85 : 10 },
      { title: 'Security Guidelines', category: 'Security', relevance: searchTerm.includes('security') || searchTerm.includes('auth') ? 90 : 5 },
      { title: 'Deployment Guide', category: 'Operations', relevance: searchTerm.includes('deploy') || searchTerm.includes('install') ? 85 : 5 }
    ].filter(doc => doc.relevance > 50);
    
    if (docResults.length === 0) {
      return `🔍 **Documentation Search: "${args}"**

No specific documentation found.

**Suggestions:**
• Check wiki: https://irregularpedia.org
• Browse forum: https://forum.irregularchat.com  
• Use \`!resources\` for general resources
• Ask in relevant technical groups`;
    }
    
    let response = `🔍 **Documentation Search: "${args}"**\n\n`;
    
    for (const doc of docResults.slice(0, 3)) {
      response += `📋 **${doc.title}** (${doc.category})\n`;
      response += `📖 Check wiki or forum for detailed documentation\n\n`;
    }
    
    response += `💡 **More Documentation:**\n`;
    response += `• Wiki: https://irregularpedia.org\n`;
    response += `• Forum: https://forum.irregularchat.com`;
    
    return response;
  }

  async handleLinks(context) {
    return `🔗 **Important IrregularChat Links**

**🏠 Main Services:**
• Wiki: https://irregularpedia.org/index.php/Main_Page
• Forum: https://forum.irregularchat.com  
• SSO Login: https://sso.irregularchat.com
• Chat Access: https://url.irregular.chat/chats

**🛠️ Tools & Services:**
• Matrix: https://matrix.irregularchat.com/
• CryptPad: https://cryptpad.irregularchat.com
• Search Proxy: https://search.irregularchat.com

**📚 Learning Resources:**  
• AI Resources: https://irregularpedia.org/index.php/AI_Resources
• Learning Hub: https://irregularpedia.org/index.php/Learning

**💬 Community:**
• Signal Groups: Use \`!groups\` to see available groups
• Matrix Rooms: Login required for access

**🆘 Support:**
• Use \`!help\` for bot commands
• Use \`!faq <topic>\` for common questions
• Contact admins for account issues

💡 Bookmark these links for quick access!`;
  }

  async handleChangelog(context) {
    const { args } = context;
    const count = args ? parseInt(args) || 5 : 5;
    
    // Mock changelog entries
    const changes = [
      {
        date: '2025-08-31',
        version: '1.2.0',
        type: 'Feature',
        description: 'Native Signal CLI daemon implementation'
      },
      {
        date: '2025-08-30', 
        version: '1.1.5',
        type: 'Fix',
        description: 'Fixed group messaging and permission handling'
      },
      {
        date: '2025-08-29',
        version: '1.1.4',
        type: 'Feature', 
        description: 'Added comprehensive plugin system'
      },
      {
        date: '2025-08-28',
        version: '1.1.3',
        type: 'Fix',
        description: 'Improved onboarding automation'
      },
      {
        date: '2025-08-27',
        version: '1.1.2',
        type: 'Feature',
        description: 'Enhanced AI integration with GPT-5 support'
      },
      {
        date: '2025-08-26',
        version: '1.1.1',
        type: 'Fix',
        description: 'Matrix bridge stability improvements'
      },
      {
        date: '2025-08-25',
        version: '1.1.0',
        type: 'Feature',
        description: 'Added community management commands'
      }
    ];
    
    const recentChanges = changes.slice(0, count);
    
    let response = `📝 **Recent Updates** (Last ${count})\n\n`;
    
    for (const change of recentChanges) {
      const icon = change.type === 'Feature' ? '✨' : change.type === 'Fix' ? '🔧' : '📋';
      response += `${icon} **v${change.version}** (${change.date})\n`;
      response += `${change.description}\n\n`;
    }
    
    response += `💡 **More Information:**\n`;
    response += `• Use \`!changelog 10\` to see more updates\n`;
    response += `• Check forum for detailed release notes\n`;
    response += `• Visit wiki for full documentation`;
    
    return response;
  }

  // Utility method to extract mentions (shared with other plugins)
  extractMentionInfoFromMessage(message) {
    const dataMessage = message?.dataMessage || 
                        message?.envelope?.dataMessage || 
                        message?.message?.dataMessage ||
                        message?.message;
    
    const mentions = dataMessage?.mentions || [];
    
    if (mentions.length > 0) {
      const firstMention = mentions[0];
      const identifier = firstMention.uuid || firstMention.number || firstMention.username || firstMention.name;
      return { identifier, displayName: null };
    }
    
    const text = dataMessage?.message || message?.text || '';
    const mentionMatch = text.match(/@(\S+)/);
    if (mentionMatch) {
      return { identifier: mentionMatch[1], displayName: null };
    }
    
    return null;
  }
}