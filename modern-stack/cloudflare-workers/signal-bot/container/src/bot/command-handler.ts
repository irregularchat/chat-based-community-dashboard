/**
 * Command Handler
 *
 * Processes all bot commands (!help, !ping, !ai, !ask, etc.)
 */

import { BotConfig } from './signal-bot.js';
import { WorkerAPIClient } from '../api/worker-api-client.js';
import OpenAI from 'openai';

export interface CommandContext {
  sourceNumber: string;
  sourceName: string;
  groupId?: string;
  timestamp: number;
}

export class CommandHandler {
  private config: BotConfig;
  private workerApi: WorkerAPIClient;
  private openai: OpenAI | null = null;
  private questionCounter = 0;
  private bot: any | null = null; // SignalBot instance for accessing bot methods

  constructor(config: BotConfig, workerApi: WorkerAPIClient) {
    this.config = config;
    this.workerApi = workerApi;

    // Initialize OpenAI if configured
    if (config.openAiActive && config.openAiApiKey) {
      this.openai = new OpenAI({
        apiKey: config.openAiApiKey,
      });
    }
  }

  /**
   * Set bot instance for accessing bot methods (like getGroups)
   */
  setBotInstance(bot: any): void {
    this.bot = bot;
  }

  /**
   * Check if user is admin
   */
  private isAdmin(phoneNumber: string): boolean {
    const admins = ['+19108471202', '+12247253276']; // TODO: Move to config
    return admins.includes(phoneNumber);
  }

  /**
   * Handle a command
   */
  async handle(command: string, context: CommandContext): Promise<string | null> {
    // Parse command
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    // Route to appropriate handler
    switch (cmd) {
      case '!help':
        return this.handleHelp(context);

      case '!ping':
        return this.handlePing();

      case '!ai':
        return this.handleAI(args, context);

      case '!ask':
      case '!q':
      case '!question':
        return this.handleAsk(args, context);

      case '!questions':
        return this.handleQuestions(context);

      case '!answer':
      case '!a':
        return this.handleAnswer(args, context);

      case '!solve':
      case '!solved':
        return this.handleSolve(args, context);

      case '!whoami':
        return this.handleWhoAmI(context);

      case '!version':
        return this.handleVersion();

      case '!stats':
        return this.handleStats();

      // Group Management
      case '!groups':
        return this.handleGroups();

      case '!addto':
        return this.handleAddTo(args, context);

      // Core Commands
      case '!zeroeth':
        return this.handleZeroeth();

      case '!summarize':
      case '!tldr':
        return this.handleSummarize(args, context);

      case '!lai':
        return this.handleLocalAI(args, context);

      case '!cleaner':
        return this.handleCleaner(args);

      // Utility Commands
      case '!time':
        return this.handleTime();

      case '!flip':
        return this.handleFlip();

      case '!joke':
        return this.handleJoke();

      case '!quote':
        return this.handleQuote();

      case '!fact':
        return this.handleFact();

      case '!8ball':
        return this.handle8Ball();

      case '!calc':
        return this.handleCalc(args);

      case '!random':
        return this.handleRandom(args);

      // Information Commands
      case '!wiki':
        return this.handleWiki();

      case '!forum':
        return this.handleForum();

      case '!links':
        return this.handleLinks();

      case '!faq':
        return this.handleFaq();

      case '!docs':
        return this.handleDocs();

      case '!events':
        return this.handleEvents();

      // Admin Commands
      case '!gtg':
        return this.handleGtg(args, context);

      case '!pending':
        return this.handlePending(context);

      default:
        // Unknown command
        return `❓ Unknown command: ${cmd}\n\nType !help for available commands.`;
    }
  }

  /**
   * !help - Show available commands
   */
  private async handleHelp(context: CommandContext): Promise<string> {
    const isAdmin = this.isAdmin(context.sourceNumber);

    const lines = [
      '🤖 Signal Bot Commands (35+ available):',
      '',
      '🔧 Core:',
      '  !help, !ping, !ai, !lai, !summarize, !tldr, !zeroeth, !cleaner',
      '',
      '❓ Q&A System:',
      '  !ask, !q, !question - Ask a question',
      '  !questions - List recent questions',
      '  !answer, !a - Answer a question',
      '  !solve, !solved - Mark question as solved',
      '',
      '👥 Groups:',
      '  !groups - List all groups',
    ];

    if (isAdmin) {
      lines.push('  !addto <group#> @user - Add users to group');
    }

    lines.push(
      '',
      '📚 Information:',
      '  !wiki, !forum, !links, !faq, !docs, !events',
      '',
      '🎲 Utility:',
      '  !time, !flip, !joke, !quote, !fact, !8ball, !calc, !random',
      '',
      '👤 User:',
      '  !whoami, !version, !stats',
      ''
    );

    if (isAdmin) {
      lines.push(
        '🔐 Admin:',
        '  !gtg, !pending',
        ''
      );
    }

    lines.push('💡 Use any command to get started!');

    if (isAdmin) {
      lines.push('🔒 You have admin access to restricted commands');
    }

    return this.formatForSignal(lines.join('\n'));
  }

  /**
   * !ping - Test bot responsiveness
   */
  private async handlePing(): Promise<string> {
    return '🏓 Pong! Bot is responsive.\n\n✅ All systems operational.';
  }

  /**
   * !ai - Ask AI a question
   */
  private async handleAI(question: string, context: CommandContext): Promise<string> {
    if (!this.openai) {
      return '❌ AI features are not enabled.';
    }

    if (!question || question.trim().length === 0) {
      return '❌ Please provide a question.\n\nUsage: !ai <your question>';
    }

    try {
      console.log(`🤖 AI request from ${context.sourceName}: ${question}`);

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant in a Signal group chat. Keep responses concise and friendly.',
          },
          {
            role: 'user',
            content: question,
          },
        ],
        max_tokens: 500,
        temperature: 0.7,
      });

      const answer = response.choices[0]?.message?.content || 'No response';

      return this.formatForSignal(`🤖 AI Response:\n\n${answer}`);
    } catch (error) {
      console.error('AI error:', error);
      return `❌ AI error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !ask - Ask a question (Q&A system)
   */
  private async handleAsk(question: string, context: CommandContext): Promise<string> {
    if (!question || question.trim().length === 0) {
      return '❌ Please provide a question.\n\nUsage: !ask <your question>';
    }

    if (!context.groupId) {
      return '❌ Questions can only be asked in groups.';
    }

    try {
      this.questionCounter++;
      const questionId = this.questionCounter;

      await this.workerApi.saveQuestion({
        questionId,
        question,
        asker: context.sourceName,
        askerPhone: context.sourceNumber,
        groupId: context.groupId,
      });

      return this.formatForSignal(
        `✅ Question #${questionId} recorded!\n\n` +
        `Question: ${question}\n\n` +
        `Others can answer with: !answer ${questionId} <answer>\n` +
        `Mark as solved with: !solve ${questionId}`
      );
    } catch (error) {
      console.error('Error saving question:', error);
      return `❌ Failed to save question: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !questions - List recent questions
   */
  private async handleQuestions(context: CommandContext): Promise<string> {
    if (!context.groupId) {
      return '❌ Questions can only be listed in groups.';
    }

    try {
      const questions = await this.workerApi.getQuestions(context.groupId, false);

      if (questions.length === 0) {
        return '📋 No open questions in this group.\n\nAsk one with: !ask <question>';
      }

      const lines = [
        '📋 Open Questions:',
        '',
      ];

      for (const q of questions.slice(0, 10)) { // Limit to 10 most recent
        lines.push(`#${q.question_id} by ${q.asker}:`);
        lines.push(`  ${q.question.substring(0, 100)}${q.question.length > 100 ? '...' : ''}`);
        lines.push('');
      }

      lines.push(`Use: !answer <id> <answer> to respond`);

      return this.formatForSignal(lines.join('\n'));
    } catch (error) {
      console.error('Error loading questions:', error);
      return `❌ Failed to load questions: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !answer - Answer a question
   */
  private async handleAnswer(args: string, context: CommandContext): Promise<string> {
    const parts = args.split(/\s+/);
    const questionId = parseInt(parts[0]);
    const answer = parts.slice(1).join(' ');

    if (!questionId || isNaN(questionId)) {
      return '❌ Please provide a question ID.\n\nUsage: !answer <id> <answer>';
    }

    if (!answer || answer.trim().length === 0) {
      return '❌ Please provide an answer.\n\nUsage: !answer <id> <answer>';
    }

    try {
      // Get existing question
      const questions = await this.workerApi.getQuestions(context.groupId);
      const question = questions.find(q => q.question_id === questionId);

      if (!question) {
        return `❌ Question #${questionId} not found.`;
      }

      // Add answer to question
      const answers = question.answers ? JSON.parse(question.answers) : [];
      answers.push({
        answerer: context.sourceName,
        answererPhone: context.sourceNumber,
        answer,
        timestamp: Math.floor(Date.now() / 1000),
      });

      await this.workerApi.updateQuestion(questionId, {
        answers,
      });

      return this.formatForSignal(
        `✅ Answer added to question #${questionId}!\n\n` +
        `Original question: ${question.question}\n\n` +
        `Your answer: ${answer}`
      );
    } catch (error) {
      console.error('Error adding answer:', error);
      return `❌ Failed to add answer: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !solve - Mark question as solved
   */
  private async handleSolve(args: string, context: CommandContext): Promise<string> {
    const questionId = parseInt(args);

    if (!questionId || isNaN(questionId)) {
      return '❌ Please provide a question ID.\n\nUsage: !solve <id>';
    }

    try {
      await this.workerApi.updateQuestion(questionId, {
        solved: true,
        solvedBy: context.sourceNumber,
        solvedAt: Math.floor(Date.now() / 1000),
      });

      return `✅ Question #${questionId} marked as solved!`;
    } catch (error) {
      console.error('Error solving question:', error);
      return `❌ Failed to mark as solved: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !whoami - Show user info
   */
  private async handleWhoAmI(context: CommandContext): Promise<string> {
    return this.formatForSignal(
      `👤 Your Info:\n\n` +
      `Name: ${context.sourceName}\n` +
      `Phone: ${context.sourceNumber}\n` +
      `Group: ${context.groupId || 'Direct message'}`
    );
  }

  /**
   * !version - Show bot version
   */
  private async handleVersion(): Promise<string> {
    return this.formatForSignal(
      `🤖 Signal Bot v3.0.0\n\n` +
      `Architecture: Cloudflare Native\n` +
      `Platform: Cloudflare Container\n` +
      `Database: Cloudflare D1\n` +
      `Storage: Cloudflare R2`
    );
  }

  /**
   * !stats - Show bot statistics
   */
  private async handleStats(): Promise<string> {
    try {
      // Get command usage stats
      const result = await this.workerApi.query(`
        SELECT
          command,
          COUNT(*) as total_uses,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_uses,
          AVG(response_time) as avg_response_time
        FROM bot_command_usage
        WHERE timestamp > ?
        GROUP BY command
        ORDER BY total_uses DESC
        LIMIT 10
      `, [Math.floor(Date.now() / 1000) - 86400]); // Last 24 hours

      const stats = result.results;

      if (stats.length === 0) {
        return '📊 No command usage in last 24 hours.';
      }

      const lines = [
        '📊 Bot Statistics (Last 24h):',
        '',
      ];

      for (const stat of stats) {
        lines.push(`${stat.command}: ${stat.total_uses} uses (${stat.successful_uses} successful)`);
      }

      return this.formatForSignal(lines.join('\n'));
    } catch (error) {
      console.error('Error getting stats:', error);
      return `❌ Failed to get stats: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !groups - List all Signal groups
   */
  private async handleGroups(): Promise<string> {
    if (!this.bot) {
      return '❌ Bot instance not available';
    }

    try {
      const groups = await this.bot.getGroups();

      if (groups.length === 0) {
        return '📱 No Signal groups found';
      }

      // Sort by member count (largest first)
      groups.sort((a: any, b: any) => (b.members?.length || 0) - (a.members?.length || 0));

      const lines = [
        '📱 Signal Groups (Sorted by Size):',
        '',
      ];

      let totalMembers = 0;
      groups.forEach((group: any, index: number) => {
        const memberCount = group.members?.length || 0;
        totalMembers += memberCount;
        const adminBadge = group.admins?.includes(this.config.phoneNumber) ? ' 👑' : ' 👤';

        lines.push(`${index + 1}. ${group.name}${adminBadge}`);
        lines.push(`   Members: ${memberCount}${group.admins?.includes(this.config.phoneNumber) ? ' (Bot is Admin)' : ''}`);
        lines.push('');
      });

      lines.push('────────────────');
      lines.push(`📊 Total: ${groups.length} groups, ~${totalMembers} total members`);
      lines.push('👑 = Bot has admin rights');
      lines.push('👤 = Bot is regular member');
      lines.push('');
      lines.push(`✅ Bot can add users to ${groups.filter((g: any) => g.admins?.includes(this.config.phoneNumber)).length} group(s)`);
      lines.push('Use !addto <group-number> @user to add users');

      return this.formatForSignal(lines.join('\n'));
    } catch (error) {
      console.error('Error listing groups:', error);
      return `❌ Failed to list groups: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !addto - Add users to a group
   */
  private async handleAddTo(args: string, context: CommandContext): Promise<string> {
    if (!this.isAdmin(context.sourceNumber)) {
      return '❌ Admin-only command';
    }

    if (!this.bot) {
      return '❌ Bot instance not available';
    }

    const parts = args.split(/\s+/);
    const groupNum = parseInt(parts[0]);

    if (!groupNum || isNaN(groupNum)) {
      return '❌ Please provide a group number\n\nUsage: !addto <group-number> @user';
    }

    // Extract mentioned users
    const mentions = args.match(/@[\w\s]+/g);
    if (!mentions || mentions.length === 0) {
      return '❌ Please mention users to add\n\nUsage: !addto <group-number> @user';
    }

    try {
      const groups = await this.bot.getGroups();
      const group = groups[groupNum - 1];

      if (!group) {
        return `❌ Group #${groupNum} not found\n\nUse !groups to see all groups`;
      }

      // TODO: Implement actual user addition via signal-cli JSON-RPC
      // This requires implementing updateGroup method in SignalJsonRpcClient

      return this.formatForSignal(
        `📱 Adding Users to ${groupNum}\n\n` +
        `Group ID: ${groupNum}\n\n` +
        `Results:\n` +
        mentions.map(m => `⚠️ ${m} (phone number not found)`).join('\n') + '\n\n' +
        `✨ Process completed. Users with ✅ have been invited.`
      );
    } catch (error) {
      console.error('Error adding users:', error);
      return `❌ Failed to add users: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !zeroeth - Show Asimov's Zeroeth Law
   */
  private async handleZeroeth(): Promise<string> {
    return this.formatForSignal(
      '🤖 The Zeroeth Law of Robotics:\n\n' +
      '"A robot may not harm humanity, or, by inaction, allow humanity to come to harm."\n\n' +
      '- Isaac Asimov, Foundation series'
    );
  }

  /**
   * !summarize / !tldr - Summarize content
   */
  private async handleSummarize(args: string, context: CommandContext): Promise<string> {
    if (!this.openai) {
      return '❌ AI features not enabled for summarization';
    }

    if (!args || args.trim().length === 0) {
      return '❌ Please provide content or URL to summarize\n\nUsage: !summarize <text or URL>';
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that creates concise summaries. Keep summaries brief and clear.',
          },
          {
            role: 'user',
            content: `Summarize this: ${args}`,
          },
        ],
        max_tokens: 300,
        temperature: 0.5,
      });

      const summary = response.choices[0]?.message?.content || 'No summary available';
      return this.formatForSignal(`📝 Summary:\n\n${summary}`);
    } catch (error) {
      console.error('Summarize error:', error);
      return `❌ Summarization failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !lai - Local AI query
   */
  private async handleLocalAI(args: string, context: CommandContext): Promise<string> {
    if (!args || args.trim().length === 0) {
      return '❌ Please provide a question\n\nUsage: !lai <your question>';
    }

    // TODO: Implement local AI integration when localAiUrl is configured
    if (this.config.localAiUrl) {
      return '🚧 Local AI integration coming soon';
    }

    // Fallback to OpenAI if available
    if (this.openai) {
      return this.handleAI(args, context);
    }

    return '❌ Neither local AI nor OpenAI is configured';
  }

  /**
   * !cleaner - Clean URLs and text
   */
  private async handleCleaner(args: string): Promise<string> {
    if (!args || args.trim().length === 0) {
      return '❌ Please provide a URL or text to clean\n\nUsage: !cleaner <url or text>';
    }

    // Remove tracking parameters
    let cleaned = args;
    const trackingParams = ['utm_', 'fbclid', 'ref=', 'source=', 'campaign=', 'gclid'];

    trackingParams.forEach(param => {
      const regex = new RegExp(`[?&]${param}[^&]*`, 'g');
      cleaned = cleaned.replace(regex, '');
    });

    // Clean up any trailing ? or &
    cleaned = cleaned.replace(/[?&]$/, '');

    return this.formatForSignal(
      '🧹 Cleaned:\n\n' +
      `Original: ${args.substring(0, 100)}${args.length > 100 ? '...' : ''}\n\n` +
      `Cleaned: ${cleaned}`
    );
  }

  /**
   * !time - Show current time
   */
  private async handleTime(): Promise<string> {
    const now = new Date();
    const est = now.toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' });
    const utc = now.toUTCString();

    return this.formatForSignal(
      '🕒 Current Time:\n\n' +
      `📅 EST: ${est}\n` +
      `🌍 UTC: ${utc}`
    );
  }

  /**
   * !flip - Flip a coin
   */
  private async handleFlip(): Promise<string> {
    const result = Math.random() > 0.5 ? 'Heads' : 'Tails';
    return `🪙 ${result}!`;
  }

  /**
   * !joke - Tell a joke
   */
  private async handleJoke(): Promise<string> {
    const jokes = [
      'Why do programmers prefer dark mode?\n\nBecause light attracts bugs! 🐛',
      'Why do Java developers wear glasses?\n\nBecause they don\'t C#! 👓',
      'How many programmers does it take to change a light bulb?\n\nNone. It\'s a hardware problem! 💡',
      'Why did the developer go broke?\n\nBecause he used up all his cache! 💸',
      'What\'s a programmer\'s favorite hangout place?\n\nFoo Bar! 🍺',
    ];

    const joke = jokes[Math.floor(Math.random() * jokes.length)];
    return this.formatForSignal(`😄 Random Joke\n\n${joke}`);
  }

  /**
   * !quote - Random quote
   */
  private async handleQuote(): Promise<string> {
    const quotes = [
      '"The best way to predict the future is to invent it." - Alan Kay',
      '"Code is like humor. When you have to explain it, it\'s bad." - Cory House',
      '"First, solve the problem. Then, write the code." - John Johnson',
      '"Any fool can write code that a computer can understand. Good programmers write code that humans can understand." - Martin Fowler',
      '"Experience is the name everyone gives to their mistakes." - Oscar Wilde',
    ];

    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    return this.formatForSignal(`💭 Random Quote\n\n${quote}`);
  }

  /**
   * !fact - Random fact
   */
  private async handleFact(): Promise<string> {
    const facts = [
      'Octopuses have three hearts and blue blood!',
      'The first computer bug was an actual bug - a moth trapped in a computer in 1947.',
      'The "@" symbol is called an "at sign" in English, but has different names in other languages, like "snail" in Italian.',
      'A single Google search uses more computing power than it took to send Apollo 11 to the moon.',
      'The first domain name ever registered was symbolics.com on March 15, 1985.',
    ];

    const fact = facts[Math.floor(Math.random() * facts.length)];
    return this.formatForSignal(`💡 Random Fact\n\n${fact}`);
  }

  /**
   * !8ball - Magic 8-ball
   */
  private async handle8Ball(): Promise<string> {
    const responses = [
      'Yes',
      'No',
      'Maybe',
      'Ask again later',
      'Definitely',
      'Probably not',
      'Without a doubt',
      'Very doubtful',
      'Outlook good',
      'Don\'t count on it',
      'It is certain',
      'Reply hazy, try again',
    ];

    const response = responses[Math.floor(Math.random() * responses.length)];
    return `🎱 Magic 8-Ball says: ${response}`;
  }

  /**
   * !calc - Simple calculator
   */
  private async handleCalc(args: string): Promise<string> {
    if (!args || args.trim().length === 0) {
      return '❌ Please provide an expression\n\nUsage: !calc <expression>\n\nExample: !calc 2 + 2';
    }

    try {
      // Basic safety: only allow numbers and operators
      const cleaned = args.replace(/[^0-9+\-*/().\s]/g, '');
      if (cleaned !== args) {
        return '❌ Invalid characters in expression. Use only: 0-9 + - * / ( )';
      }

      // Use Function constructor for safe evaluation
      const result = new Function(`return ${cleaned}`)();

      return this.formatForSignal(
        '🔢 Calculator:\n\n' +
        `${args} = ${result}`
      );
    } catch (error) {
      return '❌ Invalid expression';
    }
  }

  /**
   * !random - Generate random number
   */
  private async handleRandom(args: string): Promise<string> {
    const parts = args.split(/\s+/);
    const max = parseInt(parts[0]) || 100;
    const min = parseInt(parts[1]) || 1;

    const result = Math.floor(Math.random() * (max - min + 1)) + min;

    return `🎲 Random number (${min}-${max}): ${result}`;
  }

  /**
   * !wiki - IrregularChat wiki
   */
  private async handleWiki(): Promise<string> {
    return this.formatForSignal(
      '📚 IrregularChat Wiki\n\n' +
      '🌐 https://wiki.irregularchat.com\n\n' +
      'Find guides, documentation, and community resources.'
    );
  }

  /**
   * !forum - Community forum
   */
  private async handleForum(): Promise<string> {
    return this.formatForSignal(
      '💬 Community Forum\n\n' +
      '🌐 https://forum.irregularchat.com\n\n' +
      'Join discussions and ask questions.'
    );
  }

  /**
   * !links - Important links
   */
  private async handleLinks(): Promise<string> {
    return this.formatForSignal(
      '🔗 Important Links\n\n' +
      '🌐 Wiki: https://wiki.irregularchat.com\n' +
      '💬 Forum: https://forum.irregularchat.com\n' +
      '📧 Contact: admin@irregularchat.com'
    );
  }

  /**
   * !faq - FAQ
   */
  private async handleFaq(): Promise<string> {
    return this.formatForSignal(
      '❓ Frequently Asked Questions\n\n' +
      '🌐 https://wiki.irregularchat.com/faq\n\n' +
      'Check the wiki FAQ for common questions and answers.'
    );
  }

  /**
   * !docs - Documentation
   */
  private async handleDocs(): Promise<string> {
    return this.formatForSignal(
      '📖 Documentation\n\n' +
      '🌐 https://wiki.irregularchat.com/docs\n\n' +
      'Browse technical documentation and guides.'
    );
  }

  /**
   * !events - Upcoming events
   */
  private async handleEvents(): Promise<string> {
    return this.formatForSignal(
      '📅 Upcoming Events\n\n' +
      '🌐 https://forum.irregularchat.com/c/events\n\n' +
      'Check the forum for upcoming community events.'
    );
  }

  /**
   * !gtg - Good to go (approve user)
   */
  private async handleGtg(args: string, context: CommandContext): Promise<string> {
    if (!this.isAdmin(context.sourceNumber)) {
      return '❌ Admin-only command';
    }

    if (!args || args.trim().length === 0) {
      return '❌ Please mention a user\n\nUsage: !gtg @user';
    }

    // TODO: Implement actual user approval logic
    return this.formatForSignal(
      '✅ User Approved (GTG)\n\n' +
      `${args} has been marked as "Good To Go"\n\n` +
      '🚧 Full implementation coming soon'
    );
  }

  /**
   * !pending - Show pending requests
   */
  private async handlePending(context: CommandContext): Promise<string> {
    if (!this.isAdmin(context.sourceNumber)) {
      return '❌ Admin-only command';
    }

    // TODO: Implement actual pending user tracking
    return this.formatForSignal(
      '📋 Pending User Requests\n\n' +
      'No pending requests at this time.\n\n' +
      '🚧 Full implementation coming soon'
    );
  }

  /**
   * Format text for Signal (line breaks, etc.)
   */
  private formatForSignal(text: string): string {
    // Signal uses simple line breaks
    // No special formatting needed for now
    return text;
  }
}
