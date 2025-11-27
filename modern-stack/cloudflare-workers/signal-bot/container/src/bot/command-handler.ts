/**
 * Command Handler
 *
 * Processes all bot commands (!help, !ping, !ai, !ask, etc.)
 */

import { BotConfig } from './signal-bot.js';
import { WorkerAPIClient } from '../api/worker-api-client.js';
import { PostgresClient } from '../db/postgres-client.js';
import OpenAI from 'openai';
import { scrapeUrl, extractUrls, containsUrl } from '../utils/url-scraper.js';
import { getRateLimiter, formatRateLimitMessage } from '../utils/rate-limiter.js';

export interface Mention {
  start: number;
  length: number;
  uuid?: string;
  number?: string;
}

export interface CommandContext {
  sourceNumber: string;
  sourceName: string;
  groupId?: string;
  timestamp: number;
  quotedText?: string;
  mentions?: Mention[];
}

export class CommandHandler {
  private config: BotConfig;
  private workerApi: WorkerAPIClient | null = null;
  private dbClient: PostgresClient | null = null;
  private openai: OpenAI | null = null;
  private questionCounter = 0;
  private bot: any | null = null; // SignalBot instance for accessing bot methods

  constructor(config: BotConfig, apiOrDb: WorkerAPIClient | PostgresClient) {
    this.config = config;

    // Detect if it's WorkerAPIClient or PostgresClient
    if ('healthCheck' in apiOrDb && typeof (apiOrDb as any).healthCheck === 'function') {
      // It's a WorkerAPIClient
      this.workerApi = apiOrDb as WorkerAPIClient;
    } else {
      // It's a PostgresClient
      this.dbClient = apiOrDb as PostgresClient;
    }

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
   *
   * SECURITY: Admin phone numbers are now loaded from environment variable
   * to prevent hardcoded credential exposure (CVE-2025-001)
   */
  private isAdmin(phoneNumber: string): boolean {
    const admins = (process.env.ADMIN_PHONE_NUMBERS || '')
      .split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    if (admins.length === 0) {
      console.error('⚠️  SECURITY WARNING: No admin phone numbers configured in ADMIN_PHONE_NUMBERS');
      return false;
    }

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

      case '!refreshgroups':
        return this.handleRefreshGroups();

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

      // Request/Onboarding
      case '!req':
      case '!request':
        return this.handleRequest();

      // Discourse/Forum Commands
      case '!fpost':
        return this.handleForumPost(args, context);

      case '!flatest':
        return this.handleForumLatest();

      case '!fsearch':
        return this.handleForumSearch(args);

      case '!categories':
        return this.handleForumCategories();

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
      '🤖 Signal Bot Commands (40+ available):',
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
      '  !refreshgroups - Force refresh group cache',
    ];

    if (isAdmin) {
      lines.push('  !addto <group#> @user - Add users to group');
    }

    lines.push(
      '',
      '📚 Information:',
      '  !wiki, !forum, !links, !faq, !docs, !events',
      '',
      '💬 Forum:',
      '  !fpost - Create forum post',
      '  !flatest - Latest forum posts',
      '  !fsearch - Search forum',
      '  !categories - Forum categories',
      '',
      '🎲 Utility:',
      '  !time, !flip, !fact, !8ball, !calc, !random',
      '',
      '👤 User:',
      '  !whoami, !version, !stats',
      '  !req, !request - Join community request',
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
      return this.formatForSignal(
        '❌ AI Features Not Configured\n\n' +
        'To enable AI features, add your OpenAI API key to .env.local:\n\n' +
        'OPENAI_API_KEY=sk-proj-...\n\n' +
        'Then rebuild and restart the container.'
      );
    }

    if (!question || question.trim().length === 0) {
      return '❌ Please provide a question.\n\nUsage: !ai <your question>';
    }

    // CVE-2025-005: Rate limit AI requests (20 calls/hour)
    const rateLimiter = getRateLimiter();
    const limit = await rateLimiter.checkLimit(`ai:${context.sourceNumber}`, 20, 3600);

    if (!limit.allowed) {
      return formatRateLimitMessage('!ai', limit.resetIn);
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
      // Get next question ID from database (persisted across restarts)
      let questionId: number;

      if (this.dbClient) {
        questionId = await this.dbClient.getNextQuestionId(context.groupId);
      } else if (this.workerApi) {
        questionId = await this.workerApi.getNextQuestionId(context.groupId);
      } else {
        return '❌ Database not configured';
      }

      // Extract title from first sentence if possible
      const sentences = question.split(/[.!?]/);
      const title = sentences[0]?.trim().substring(0, 100) || question.substring(0, 100);

      const questionData = {
        questionId,
        question,
        title,
        asker: context.sourceName,
        askerPhone: context.sourceNumber,
        groupId: context.groupId,
      };

      if (this.dbClient) {
        await this.dbClient.saveQuestion(questionData);
      } else if (this.workerApi) {
        await this.workerApi.saveQuestion(questionData);
      }

      return this.formatForSignal(
        `✅ Question #${questionId} recorded!\n\n` +
        `Question: ${question}\n\n` +
        `📝 Others can answer with: !answer ${questionId} <answer>\n` +
        `   Or reply to this message with: !a <answer>\n\n` +
        `✔️  Mark answer(s) as solved: !solved ${questionId} <answer_ids>`
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
      let questions: any[];

      if (this.dbClient) {
        // Use PostgreSQL client directly
        questions = await this.dbClient.getQuestions(context.groupId, false);
      } else if (this.workerApi) {
        // Use Worker API client
        questions = await this.workerApi.getQuestions(context.groupId, false);
      } else {
        return '❌ Database not configured';
      }

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
    if (!context.groupId) {
      return '❌ Answers can only be posted in groups.';
    }

    const parts = args.trim().split(/\s+/);

    // Support both "!answer <id> <answer>" and "!a <answer>" (reply to question message)
    let questionId: number;
    let answer: string;

    if (parts.length >= 2 && !isNaN(parseInt(parts[0]))) {
      // Format: !answer 123 <answer>
      questionId = parseInt(parts[0]);
      answer = parts.slice(1).join(' ');
    } else {
      // TODO: Support replying to a question message with just "!a <answer>"
      // This requires tracking which message corresponds to which question
      return '❌ Please provide a question ID and answer.\n\nUsage: !answer <id> <answer>\n   or: !a <id> <answer>';
    }

    if (!answer || answer.trim().length === 0) {
      return '❌ Please provide an answer.\n\nUsage: !answer <id> <answer>';
    }

    try {
      // Get question to validate it exists
      let questionData: { question: any; answers: any[] } | null;

      if (this.dbClient) {
        questionData = await this.dbClient.getQuestionWithAnswers(questionId, context.groupId);
      } else if (this.workerApi) {
        questionData = await this.workerApi.getQuestionWithAnswers(questionId, context.groupId);
      } else {
        return '❌ Database not configured';
      }

      if (!questionData) {
        return `❌ Question #${questionId} not found in this group.`;
      }

      // Save answer to new answers table
      const answerData = {
        questionId,
        answer,
        answerer: context.sourceName,
        answererPhone: context.sourceNumber,
        groupId: context.groupId,
      };

      let answerId: number;

      if (this.dbClient) {
        answerId = await this.dbClient.saveAnswer(answerData);
      } else if (this.workerApi) {
        answerId = await this.workerApi.saveAnswer(answerData);
      } else {
        return '❌ Database not configured';
      }

      const answerCount = questionData.answers.length + 1;

      return this.formatForSignal(
        `✅ Answer #${answerId} added to question #${questionId}!\n\n` +
        `❓ Question: ${questionData.question.question}\n\n` +
        `💬 Your answer: ${answer}\n\n` +
        `📊 Total answers: ${answerCount}\n\n` +
        `To mark this as the solution: !solved ${questionId} ${answerId}`
      );
    } catch (error) {
      console.error('Error adding answer:', error);
      return `❌ Failed to add answer: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !solve / !solved - Mark answer(s) as solution and post to Discourse
   */
  private async handleSolve(args: string, context: CommandContext): Promise<string> {
    if (!context.groupId) {
      return '❌ This command can only be used in groups.';
    }

    let questionId: number;
    let answerIds: number[] = [];

    // Check if this is a reply to an !answer message
    if (context.quotedText && (!args || args.trim() === '')) {
      // Try to extract question and answer IDs from quoted text
      // Format: "Answer #X for Question #Y:"
      const answerMatch = context.quotedText.match(/Answer #(\d+) for Question #(\d+):/);

      if (answerMatch) {
        const answerId = parseInt(answerMatch[1]);
        questionId = parseInt(answerMatch[2]);
        answerIds = [answerId];
        console.log(`📝 Extracted from quote: Question #${questionId}, Answer #${answerId}`);
      } else {
        return '❌ Could not extract question/answer IDs from quoted message.\n\nUsage: Reply to an !answer message with !solved, or use: !solved <question_id> <answer_id>';
      }
    } else {
      // Parse: !solved <question_id> <answer_id1> [answer_id2] [answer_id3]...
      const parts = args.trim().split(/\s+/);

      if (parts.length < 2) {
        return '❌ Please provide question ID and at least one answer ID.\n\nUsage: !solved <question_id> <answer_id> [answer_id2...]\nOr reply to an !answer message with !solved';
      }

      questionId = parseInt(parts[0]);
      answerIds = parts.slice(1).map(id => parseInt(id)).filter(id => !isNaN(id));

      if (isNaN(questionId) || answerIds.length === 0) {
        return '❌ Invalid question or answer IDs.\n\nUsage: !solved <question_id> <answer_id> [answer_id2...]\nOr reply to an !answer message with !solved';
      }
    }

    try {
      // Get question and answers
      let questionData: { question: any; answers: any[] } | null;

      if (this.dbClient) {
        questionData = await this.dbClient.getQuestionWithAnswers(questionId, context.groupId);
      } else if (this.workerApi) {
        questionData = await this.workerApi.getQuestionWithAnswers(questionId, context.groupId);
      } else {
        return '❌ Database not configured';
      }

      if (!questionData) {
        return `❌ Question #${questionId} not found in this group.`;
      }

      // Check if user is the question asker
      if (questionData.question.asker_phone !== context.sourceNumber) {
        return `❌ Only the question asker (${questionData.question.asker}) can mark answers as solved.`;
      }

      // Validate answer IDs exist
      const validAnswerIds: number[] = [];
      const invalidAnswerIds: number[] = [];

      for (const answerId of answerIds) {
        const answerExists = questionData.answers.some(a => a.answer_id === answerId);
        if (answerExists) {
          validAnswerIds.push(answerId);
        } else {
          invalidAnswerIds.push(answerId);
        }
      }

      if (validAnswerIds.length === 0) {
        return `❌ None of the provided answer IDs are valid for question #${questionId}.`;
      }

      // Mark answers as solutions
      if (this.dbClient) {
        await this.dbClient.markAnswersAsSolution(questionId, validAnswerIds);
      } else if (this.workerApi) {
        await this.workerApi.markAnswersAsSolution(questionId, validAnswerIds);
      }

      let response = `✅ Question #${questionId} marked as solved!\n\n`;

      if (validAnswerIds.length === 1) {
        response += `✔️  Answer #${validAnswerIds[0]} marked as the solution.\n\n`;
      } else {
        response += `✔️  Answers marked as solutions: ${validAnswerIds.join(', ')}\n\n`;
      }

      if (invalidAnswerIds.length > 0) {
        response += `⚠️  Invalid answer IDs (skipped): ${invalidAnswerIds.join(', ')}\n\n`;
      }

      // Post to Discourse
      response += `📤 Posting to Discourse forum...`;

      try {
        let discourseResult: { success: boolean; topicUrl?: string; error?: string };

        if (this.dbClient) {
          discourseResult = await this.dbClient.postQuestionToDiscourse(questionId);
        } else if (this.workerApi) {
          discourseResult = await this.workerApi.postQuestionToDiscourse(questionId);
        } else {
          discourseResult = { success: false, error: 'Database not configured' };
        }

        if (discourseResult.success && discourseResult.topicUrl) {
          response += `\n\n✅ Posted to forum:\n${discourseResult.topicUrl}`;
        } else {
          response += `\n\n⚠️  Discourse posting failed: ${discourseResult.error || 'Unknown error'}`;
        }
      } catch (discourseError) {
        console.error('Discourse posting error:', discourseError);
        response += `\n\n⚠️  Discourse posting failed: ${discourseError instanceof Error ? discourseError.message : 'Unknown error'}`;
      }

      return this.formatForSignal(response);
    } catch (error) {
      console.error('Error marking as solved:', error);
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
      if (!this.workerApi) {
        return '❌ Stats not available (Worker API required)';
      }

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
   * Helper function to check if bot is admin in a group
   * Handles different Signal identifier formats (UUID, phone number)
   */
  private isBotAdmin(group: any): boolean {
    if (!group.admins || !Array.isArray(group.admins)) {
      console.log(`❌ No admins array for group: ${group.name}`);
      return false;
    }

    const botPhone = this.config.phoneNumber;
    // Normalize bot's phone number (ensure + prefix)
    const normalizedBotPhone = botPhone.startsWith('+') ? botPhone : `+${botPhone}`;

    console.log(`🔍 Checking admin status for ${group.name}`);
    console.log(`   Bot phone: ${normalizedBotPhone}`);
    console.log(`   Admins array length: ${group.admins.length}`);
    console.log(`   First admin structure: ${JSON.stringify(group.admins[0])}`);

    const isAdmin = group.admins.some((admin: any) => {
      // Check phone number (normalize admin phone too)
      if (admin.number) {
        const normalizedAdminPhone = admin.number.startsWith('+') ? admin.number : `+${admin.number}`;
        console.log(`   Checking admin.number: ${normalizedAdminPhone} === ${normalizedBotPhone}? ${normalizedAdminPhone === normalizedBotPhone}`);
        if (normalizedAdminPhone === normalizedBotPhone) {
          return true;
        }
      }

      // Check UUID if available (less common but possible)
      if (admin.uuid) {
        console.log(`   Checking admin.uuid: ${admin.uuid}`);
        // Match UUID against bot's phone number (UUID might be stored in config as phone)
        if (admin.uuid === normalizedBotPhone || admin.uuid === botPhone) {
          return true;
        }
      }

      return false;
    });

    console.log(`   Result: ${isAdmin ? '👑 ADMIN' : '👤 MEMBER'}`);
    return isAdmin;
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

      // Track unique members across all groups
      const uniqueMembers = new Set<string>();
      let totalSlots = 0;

      groups.forEach((group: any, index: number) => {
        const memberCount = group.members?.length || 0;
        totalSlots += memberCount;

        // Add each member's UUID/number to the set for deduplication
        if (group.members && Array.isArray(group.members)) {
          group.members.forEach((member: any) => {
            // Use UUID if available, otherwise use number
            const memberId = member.uuid || member.number || member;
            if (memberId) {
              uniqueMembers.add(memberId);
            }
          });
        }

        // Check if bot is admin using the helper function
        const isAdmin = this.isBotAdmin(group);
        const adminBadge = isAdmin ? ' 👑' : ' 👤';

        lines.push(`${index + 1}. ${group.name}${adminBadge}`);
        lines.push(`   Members: ${memberCount}`);
        lines.push('');
      });

      lines.push('────────────────');
      lines.push(`📊 Total: ${groups.length} groups`);
      lines.push(`👥 Member slots: ${totalSlots} (${uniqueMembers.size} unique users)`);
      lines.push('👑 = Bot has admin rights');
      lines.push('👤 = Bot is regular member');
      lines.push('');
      const adminGroups = groups.filter((g: any) => this.isBotAdmin(g)).length;
      lines.push(`✅ Bot can add users to ${adminGroups} group(s)`);
      lines.push('Use !addto <group-number> @user to add users');

      return this.formatForSignal(lines.join('\n'));
    } catch (error) {
      console.error('Error listing groups:', error);
      return `❌ Failed to list groups: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !refreshgroups - Force refresh group cache from signal-cli
   */
  private async handleRefreshGroups(): Promise<string> {
    if (!this.bot) {
      return '❌ Bot instance not available';
    }

    try {
      console.log('🔄 Force refreshing groups from signal-cli...');

      // Force refresh by passing true to getGroups
      const groups = await this.bot.getGroups(true);

      return this.formatForSignal(
        `✅ Groups refreshed from signal-cli!\n\n` +
        `📱 Found ${groups.length} groups\n` +
        `💾 Updated database cache\n\n` +
        `Use !groups to see the updated list with correct admin status.`
      );
    } catch (error) {
      console.error('Error refreshing groups:', error);
      return `❌ Failed to refresh groups: ${error instanceof Error ? error.message : 'Unknown error'}`;
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

    // Parse format: !addto @user1 @user2 11
    // OR: !addto 11 @user1 @user2
    // Try to find group number (could be first or last argument)
    const parts = args.trim().split(/\s+/);
    let groupNum: number | null = null;

    // Check if first part is a number
    if (parts.length > 0 && /^\d+$/.test(parts[0])) {
      groupNum = parseInt(parts[0]);
    }
    // Check if last part is a number
    else if (parts.length > 0 && /^\d+$/.test(parts[parts.length - 1])) {
      groupNum = parseInt(parts[parts.length - 1]);
    }

    if (!groupNum || isNaN(groupNum)) {
      return '❌ Please provide a group number\n\nUsage: !addto <group#> <UUID/Phone>\n\nExample: !addto 11 +19105551234';
    }

    // Try to extract user identifiers
    const userIdentifiers: string[] = [];

    // APPROACH 1: Use Signal protocol mentions (if available)
    if (context.mentions && context.mentions.length > 0) {
      for (const mention of context.mentions) {
        const identifier = mention.number || mention.uuid;
        if (identifier) {
          userIdentifiers.push(identifier);
        }
      }
    }

    // APPROACH 2: Parse text for UUIDs and phone numbers
    if (userIdentifiers.length === 0) {
      // Match UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
      const uuids = args.match(uuidRegex);
      if (uuids) {
        userIdentifiers.push(...uuids);
      }

      // Match phone numbers: +1234567890
      const phoneRegex = /\+\d{10,15}/g;
      const phones = args.match(phoneRegex);
      if (phones) {
        userIdentifiers.push(...phones);
      }
    }

    if (userIdentifiers.length === 0) {
      return '❌ No users specified\n\n' +
        'Usage: !addto <group#> <UUID or phone>\n\n' +
        'Examples:\n' +
        '  !addto 11 +19105551234\n' +
        '  !addto 11 a45aa911-6fe4-4dc4-8b33-4bbef344a123\n\n' +
        'Note: Use Signal protocol mentions (@ menu) for best results, or provide UUID/phone directly.';
    }

    try {
      const groups = await this.bot.getGroups();
      const group = groups[groupNum - 1];

      if (!group) {
        return `❌ Group #${groupNum} not found\n\nUse !groups to see all groups`;
      }

      const groupId = group.id;
      const groupName = group.name;

      const results: string[] = [];

      for (const identifier of userIdentifiers) {
        try {
          await this.addUserToGroup(identifier, groupId);
          results.push(`✅ ${identifier}`);
        } catch (error) {
          console.error(`Failed to add ${identifier}:`, error);
          results.push(`❌ ${identifier} (${error instanceof Error ? error.message : 'failed'})`);
        }
      }

      return this.formatForSignal(
        `📱 Adding Users to Group #${groupNum}\n\n` +
        `Group: ${groupName}\n` +
        `Group ID: ${groupId}\n\n` +
        `Results:\n` +
        results.join('\n') + '\n\n' +
        `✨ Process completed. Users with ✅ have been added.`
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

    // Parse flags: -h <hours> or -n <count>
    let hours: number | undefined;
    let count: number | undefined;
    let remainingArgs = args.trim();

    // Parse -h flag
    const hoursMatch = remainingArgs.match(/-h\s+(\d+(?:\.\d+)?)/);
    if (hoursMatch) {
      hours = parseFloat(hoursMatch[1]);
      remainingArgs = remainingArgs.replace(hoursMatch[0], '').trim();
    }

    // Parse -n flag
    const countMatch = remainingArgs.match(/-n\s+(\d+)/);
    if (countMatch) {
      count = parseInt(countMatch[1], 10);
      remainingArgs = remainingArgs.replace(countMatch[0], '').trim();
    }

    // If flags are provided, summarize group messages
    if (hours || count) {
      if (!context.groupId) {
        return '❌ Time/count-based summarization only works in groups.\n\nUsage:\n  !summarize -h 2     (last 2 hours)\n  !summarize -n 20    (last 20 messages)\n  !summarize -h 1 -n 50  (last 50 messages from past hour)';
      }

      if (!this.workerApi && !this.dbClient) {
        return '❌ Message summarization not available (no database connection)';
      }

      try {
        // Fetch messages from database (try workerApi first, then dbClient)
        const messages = this.workerApi
          ? await this.workerApi.getMessagesWithConstraints(context.groupId, count, hours)
          : await this.dbClient!.getMessagesWithConstraints(context.groupId, count, hours);

        if (messages.length === 0) {
          const timeDesc = hours ? `last ${hours} hour${hours !== 1 ? 's' : ''}` : '';
          const countDesc = count ? `${count} messages` : '';
          const desc = [countDesc, timeDesc].filter(Boolean).join(' from ');
          return `❌ No messages found in ${desc}`;
        }

        // Format messages for summarization
        const conversationText = messages
          .map((msg: any) => `${msg.source_name || msg.source_number}: ${msg.message}`)
          .join('\n');

        const timeDesc = hours ? ` from the last ${hours} hour${hours !== 1 ? 's' : ''}` : '';
        const countDesc = count ? ` (${count} messages)` : ` (${messages.length} messages)`;

        // Generate summary
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant that creates concise summaries of group conversations. Identify key topics, decisions, and action items. Keep summaries clear and structured.',
            },
            {
              role: 'user',
              content: `Summarize this conversation${timeDesc}:\n\n${conversationText}`,
            },
          ],
          max_tokens: 500,
          temperature: 0.5,
        });

        const summary = response.choices[0]?.message?.content || 'No summary available';
        return this.formatForSignal(`📝 Conversation Summary${timeDesc}${countDesc}:\n\n${summary}`);
      } catch (error) {
        console.error('Conversation summarization error:', error);
        return `❌ Summarization failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    // Original behavior: summarize provided text/URL
    if (!remainingArgs || remainingArgs.length === 0) {
      // Check if there's a URL in quoted/replied message
      if (context.quotedText && containsUrl(context.quotedText)) {
        remainingArgs = context.quotedText;
        console.log('📌 Using URL from quoted message');
      } else {
        return '❌ Please provide content or URL to summarize, or use flags for conversation summary.\n\nUsage:\n  !summarize <text or URL>  (or !tldr <URL>)\n  !tldr  (reply to a message with URL)\n  !summarize -h 2       (summarize last 2 hours)\n  !summarize -n 20      (summarize last 20 messages)\n  !summarize -h 1 -n 50 (last 50 messages from past hour)';
      }
    }

    try {
      // Check if input contains URL
      const urls = extractUrls(remainingArgs);

      if (urls.length > 0) {
        // URL summarization with scraping
        const url = urls[0]; // Use first URL
        console.log(`📥 Scraping URL for summarization: ${url}`);

        // CVE-2025-005: Rate limit URL summarization (20 calls/hour)
        const rateLimiter = getRateLimiter();
        const limit = await rateLimiter.checkLimit(`summarize:${context.sourceNumber}`, 20, 3600);

        if (!limit.allowed) {
          return formatRateLimitMessage('!summarize', limit.resetIn);
        }

        // CVE-2025-002: Domain allowlist validation
        const allowedDomains = (process.env.SUMMARIZE_ALLOWED_DOMAINS || '').trim();

        if (allowedDomains.length > 0) {
          const domainList = allowedDomains.split(',').map(d => d.trim());
          const urlObj = new URL(url);
          const hostname = urlObj.hostname.toLowerCase();

          const isAllowed = domainList.some(allowed => {
            const normalizedAllowed = allowed.toLowerCase();
            return hostname === normalizedAllowed || hostname.endsWith(`.${normalizedAllowed}`);
          });

          if (!isAllowed) {
            console.warn(`🚨 Domain not in allowlist: ${hostname}`);
            return `❌ Domain not allowed: ${hostname}\n\nAllowed domains: ${domainList.join(', ')}`;
          }
        }

        const scraped = await scrapeUrl(url);

        if (!scraped.success) {
          return `❌ Failed to fetch URL: ${scraped.error || 'Unknown error'}\n\nTip: Some websites block automated access. Try copying the article text instead.`;
        }

        // Build content for summarization
        let contentToSummarize = '';
        if (scraped.title) {
          contentToSummarize += `Title: ${scraped.title}\n\n`;
        }
        if (scraped.description) {
          contentToSummarize += `Description: ${scraped.description}\n\n`;
        }
        if (scraped.content) {
          contentToSummarize += `Content:\n${scraped.content}`;
        }

        if (!contentToSummarize) {
          return '❌ No content found at URL to summarize';
        }

        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant that creates concise summaries of web articles and content. Focus on the main points and key takeaways. Keep summaries brief and clear.',
            },
            {
              role: 'user',
              content: `Summarize this article:\n\n${contentToSummarize}`,
            },
          ],
          max_tokens: 500,
          temperature: 0.5,
        });

        const summary = response.choices[0]?.message?.content || 'No summary available';
        return this.formatForSignal(`📝 Summary of ${scraped.title || url}:\n\n${summary}`);
      } else {
        // Plain text summarization
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant that creates concise summaries. Keep summaries brief and clear.',
            },
            {
              role: 'user',
              content: `Summarize this: ${remainingArgs}`,
            },
          ],
          max_tokens: 300,
          temperature: 0.5,
        });

        const summary = response.choices[0]?.message?.content || 'No summary available';
        return this.formatForSignal(`📝 Summary:\n\n${summary}`);
      }
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
   * !cleaner - Clean URLs and text, provide archive/bypass links
   */
  private async handleCleaner(args: string): Promise<string> {
    if (!args || args.trim().length === 0) {
      return '❌ Please provide a URL or text to clean\n\nUsage: !cleaner <url or text>';
    }

    // Remove tracking parameters
    let cleaned = args.trim();
    const trackingParams = ['utm_', 'fbclid', 'ref=', 'source=', 'campaign=', 'gclid', 'mc_', 'yclid'];

    trackingParams.forEach(param => {
      const regex = new RegExp(`[?&]${param}[^&]*`, 'g');
      cleaned = cleaned.replace(regex, '');
    });

    // Clean up any trailing ? or &
    cleaned = cleaned.replace(/[?&]$/, '');

    // Check if it's a URL
    const urlRegex = /^https?:\/\//i;
    const isUrl = urlRegex.test(cleaned);

    let response = '🧹 URL Cleaner\n\n' +
      `✨ Cleaned URL:\n${cleaned}\n`;

    // If it's a URL, provide archive and bypass options
    if (isUrl) {
      const encodedUrl = encodeURIComponent(cleaned);

      response += '\n📚 Archive Options:\n' +
        `• Archive.is: https://archive.is/?run=1&url=${encodedUrl}\n` +
        `• Wayback Machine: https://web.archive.org/save/${cleaned}\n` +
        '\n🔓 Bypass Paywalls:\n' +
        `• 12ft Ladder: https://12ft.io/${cleaned}\n` +
        `• Archive.ph: https://archive.ph/${cleaned}\n` +
        '\n💡 Tip: Click the links above to archive or bypass paywalls';
    }

    return this.formatForSignal(response);
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
      'Why do programmers hate nature?\n\nIt has too many bugs! 🦟',
      'What\'s a programmer\'s favorite exercise?\n\nBranch pushes! 💪',
      'Why was the JavaScript developer sad?\n\nBecause he didn\'t Node how to Express himself! 😢',
      'How do you comfort a JavaScript bug?\n\nYou console it! 🤗',
      'Why do Python programmers wear sweaters?\n\nBecause they work in cold environments! 🧥',
      'What\'s the object-oriented way to become wealthy?\n\nInheritance! 💰',
      'Why did the database administrator leave his wife?\n\nShe had one-to-many relationships! 💔',
      'What do you call a programmer from Finland?\n\nNerdic! 🇫🇮',
      'Why do programmers mix up Halloween and Christmas?\n\nBecause Oct 31 == Dec 25! 🎃🎄',
      'What\'s the best thing about a Boolean?\n\nEven if you\'re wrong, you\'re only off by a bit! ✨',
      'Why did the function break up with the variable?\n\nIt had constant arguments! 💬',
      'What\'s a pirate\'s favorite programming language?\n\nR! But they also love the C! ☠️',
      'Why don\'t programmers like to go outside?\n\nThe sun causes too much glare on their screens! ☀️',
      'What do you call 8 hobbits?\n\nA hobbyte! 🧙',
      'Why did the programmer quit his job?\n\nBecause he didn\'t get arrays! 🍬',
      'How many programmers does it take to screw in a light bulb?\n\nNone. That\'s a hardware issue! 💡',
      'What\'s the best way to generate random strings?\n\nPut a fresh programmer in front of Vim! ⌨️',
      'Why did the CSS file feel insecure?\n\nBecause it had no class! 🎨',
      'What did the router say to the doctor?\n\nIt hurts when IP! 🏥',
      'Why do programmers always mix up Christmas and Halloween?\n\nBecause Dec 25 = Oct 31! 🎅👻',
    ];

    const joke = jokes[Math.floor(Math.random() * jokes.length)];
    return this.formatForSignal(`😄 Programming Joke\n\n${joke}`);
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
      '"Talk is cheap. Show me the code." - Linus Torvalds',
      '"The most disastrous thing that you can ever learn is your first programming language." - Alan Kay',
      '"Simplicity is the soul of efficiency." - Austin Freeman',
      '"Make it work, make it right, make it fast." - Kent Beck',
      '"Programs must be written for people to read, and only incidentally for machines to execute." - Harold Abelson',
      '"The best error message is the one that never shows up." - Thomas Fuchs',
      '"Fix the cause, not the symptom." - Steve Maguire',
      '"Deleted code is debugged code." - Jeff Sickel',
      '"Walking on water and developing software from a specification are easy if both are frozen." - Edward V. Berard',
      '"Premature optimization is the root of all evil." - Donald Knuth',
      '"Testing leads to failure, and failure leads to understanding." - Burt Rutan',
      '"It\'s not a bug – it\'s an undocumented feature." - Anonymous',
      '"Before software can be reusable it first has to be usable." - Ralph Johnson',
      '"The function of good software is to make the complex appear to be simple." - Grady Booch',
      '"Programming isn\'t about what you know; it\'s about what you can figure out." - Chris Pine',
      '"Code never lies, comments sometimes do." - Ron Jeffries',
      '"The only way to learn a new programming language is by writing programs in it." - Dennis Ritchie',
      '"Measuring programming progress by lines of code is like measuring aircraft building progress by weight." - Bill Gates',
      '"Give someone a program, frustrate them for a day; teach them how to program, frustrate them for a lifetime." - David Leinweber',
      '"Software is a great combination between artistry and engineering." - Bill Gates',
    ];

    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    return this.formatForSignal(`💭 Inspirational Quote\n\n${quote}`);
  }

  /**
   * !fact - Random fact
   */
  private async handleFact(): Promise<string> {
    const facts = [
      'The first computer bug was an actual bug - a moth trapped in a computer in 1947 by Grace Hopper.',
      'The "@" symbol is called an "at sign" in English, but has different names in other languages, like "snail" in Italian and "monkey tail" in Dutch.',
      'A single Google search uses more computing power than it took to send Apollo 11 to the moon.',
      'The first domain name ever registered was symbolics.com on March 15, 1985.',
      'The first 1GB hard drive, released in 1980, weighed over 500 pounds and cost $40,000.',
      'Python was named after Monty Python, not the snake.',
      'The original name for Windows was "Interface Manager".',
      'The average person blinks 15-20 times per minute, but only 7 times per minute when using a computer.',
      'The first computer virus was created in 1983 by a 15-year-old student.',
      'Email existed before the World Wide Web.',
      'The QWERTY keyboard layout was designed to slow typists down to prevent typewriter jams.',
      'The first computer mouse was made of wood and was invented by Doug Engelbart in 1964.',
      'NASA still uses software from the 1970s in some spacecraft.',
      'The first webcam was created at Cambridge University to monitor a coffee pot.',
      'Over 90% of the world\'s currency only exists on computers.',
      'The first Apple computer sold for $666.66.',
      'The term "bug" to describe a programming error predates computers - Thomas Edison used it in 1878.',
      'The most used password is still "123456".',
      'Finland has the most internet users per capita.',
      'The first computer programmer was Ada Lovelace in the 1840s.',
      'There are more possible iterations of a game of chess than there are atoms in the known universe.',
      'The IBM 5150 (first PC) had only 16KB of RAM.',
      'Linux powers 100% of the world\'s top 500 supercomputers.',
      'The first YouTube video was uploaded on April 23, 2005 and was only 18 seconds long.',
      'Octopuses have three hearts and blue blood! (Bonus non-tech fact)',
    ];

    const fact = facts[Math.floor(Math.random() * facts.length)];
    return this.formatForSignal(`💡 Tech Fact\n\n${fact}`);
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
   * !calc - Simple calculator with safe evaluation
   *
   * Security: Uses AST parsing and whitelist approach instead of Function()
   * to prevent code execution attacks
   */
  private async handleCalc(args: string): Promise<string> {
    if (!args || args.trim().length === 0) {
      return '❌ Please provide an expression\n\nUsage: !calc <expression>\n\nExample: !calc 2 + 2';
    }

    try {
      // Strict validation: only allow numbers, operators, parentheses, and decimal points
      const cleaned = args.trim().replace(/\s+/g, '');

      // Validate expression contains only safe characters
      if (!/^[0-9+\-*/().\s]+$/.test(cleaned)) {
        return '❌ Invalid characters in expression. Use only: 0-9 + - * / ( ) .';
      }

      // Additional security: check for suspicious patterns
      if (cleaned.includes('..') || cleaned.includes('//') || cleaned.includes('**')) {
        return '❌ Invalid expression pattern';
      }

      // Prevent extremely long expressions (DoS protection)
      if (cleaned.length > 200) {
        return '❌ Expression too long (max 200 characters)';
      }

      // Safe evaluation using isolated scope
      const result = this.evaluateMathExpression(cleaned);

      // Validate result is a number
      if (typeof result !== 'number' || !isFinite(result)) {
        return '❌ Invalid result';
      }

      return this.formatForSignal(
        '🔢 Calculator:\n\n' +
        `${args} = ${result}`
      );
    } catch (error) {
      console.error('Calculator error:', error);
      return '❌ Invalid expression or calculation error';
    }
  }

  /**
   * Safely evaluate mathematical expressions using recursive descent parser
   * This prevents code execution attacks by parsing the expression manually
   */
  private evaluateMathExpression(expr: string): number {
    let pos = 0;

    const parseNumber = (): number => {
      let num = '';
      while (pos < expr.length && (expr[pos] >= '0' && expr[pos] <= '9' || expr[pos] === '.')) {
        num += expr[pos++];
      }
      return parseFloat(num);
    };

    const parseFactor = (): number => {
      if (expr[pos] === '(') {
        pos++; // skip '('
        const result = parseExpression();
        pos++; // skip ')'
        return result;
      }
      if (expr[pos] === '-') {
        pos++;
        return -parseFactor();
      }
      if (expr[pos] === '+') {
        pos++;
        return parseFactor();
      }
      return parseNumber();
    };

    const parseTerm = (): number => {
      let result = parseFactor();
      while (pos < expr.length && (expr[pos] === '*' || expr[pos] === '/')) {
        const op = expr[pos++];
        const right = parseFactor();
        if (op === '*') {
          result *= right;
        } else {
          if (right === 0) throw new Error('Division by zero');
          result /= right;
        }
      }
      return result;
    };

    const parseExpression = (): number => {
      let result = parseTerm();
      while (pos < expr.length && (expr[pos] === '+' || expr[pos] === '-')) {
        const op = expr[pos++];
        const right = parseTerm();
        if (op === '+') {
          result += right;
        } else {
          result -= right;
        }
      }
      return result;
    };

    return parseExpression();
  }

  /**
   * !random - Generate random number
   * Supports: !random, !random 10, !random 1 100, !random 1-100, !random 1,100
   */
  private async handleRandom(args: string): Promise<string> {
    let min = 1;
    let max = 100;

    if (args && args.trim().length > 0) {
      const trimmed = args.trim();

      // Handle formats: "1-100", "1,100", "1 100"
      const separatorMatch = trimmed.match(/^(\d+)[-,\s]+(\d+)$/);

      if (separatorMatch) {
        // Two numbers with separator: "1-100", "1,100", "1 100"
        min = parseInt(separatorMatch[1]);
        max = parseInt(separatorMatch[2]);
      } else {
        // Single number: "100" means 1-100
        const single = parseInt(trimmed);
        if (!isNaN(single)) {
          min = 1;
          max = single;
        }
      }
    }

    // Ensure min <= max
    if (min > max) {
      [min, max] = [max, min];
    }

    const result = Math.floor(Math.random() * (max - min + 1)) + min;

    return this.formatForSignal(
      `🎲 Random Number\n\n` +
      `Range: ${min}-${max}\n` +
      `Result: ${result}`
    );
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

    if (!context.mentions || context.mentions.length === 0) {
      return '❌ Please mention a user\n\nUsage: !gtg @user';
    }

    // Extract user identifier from first mention
    const mention = context.mentions[0];
    const userPhone = mention.number || mention.uuid;

    if (!userPhone) {
      return '❌ Could not resolve mentioned user\n\nPlease ensure the user has a registered Signal account.';
    }

    try {
      // Fetch user's recent messages to extract their intro
      let userIntro = '';
      if (context.groupId) {
        try {
          // Try workerApi first, then dbClient fallback
          if (this.workerApi) {
            const recentMessages = await this.workerApi.getRecentMessages(context.groupId, 50);
            // Find messages from the mentioned user (look at last 20 messages)
            const userMessages = recentMessages
              .filter((msg: any) => msg.source_number === userPhone || msg.source_uuid === userPhone)
              .slice(0, 5); // Get up to 5 recent messages from user

            // Concatenate their messages to form an intro
            if (userMessages.length > 0) {
              userIntro = userMessages
                .map((msg: any) => msg.message || '')
                .filter((m: string) => m.trim().length > 0)
                .join(' ');
              console.log(`📋 Fetched user intro (${userIntro.length} chars) from workerApi for keyword analysis`);
            }
          } else if (this.dbClient) {
            // Fallback to dbClient
            const recentMessages = await this.dbClient.getRecentMessages(context.groupId, 50);
            const userMessages = recentMessages
              .filter((msg: any) => msg.source_number === userPhone || msg.source_uuid === userPhone)
              .slice(0, 5);

            if (userMessages.length > 0) {
              userIntro = userMessages
                .map((msg: any) => msg.message || '')
                .filter((m: string) => m.trim().length > 0)
                .join(' ');
              console.log(`📋 Fetched user intro (${userIntro.length} chars) from dbClient for keyword analysis`);
            }
          }
        } catch (error) {
          console.error('Error fetching user messages:', error);
          // Continue without user intro - will use core groups only
        }
      }

      // Send GTG message directly to user
      const gtgMessage =
        'Good to go. Thanks for verifying. This is how we keep the community safe.\n' +
        '1. Please leave this chat\n' +
        '2. You\'ll receive a direct message with your IrregularChat Login and a Link to all the chats.\n' +
        '3. Join all the Chats that interest you when you get your login\n' +
        '4. Until then, Learn about the community https://forum.irregularchat.com/t/irregularchat-forum-start-here-faqs/84\n' +
        'See you out there!';

      // Send message via bot's sendMessage method
      if (this.bot) {
        await this.bot.sendMessage({
          recipient: userPhone,
          message: gtgMessage,
        });
      }

      // Get list of recommended groups to add user to
      // Pass user intro for keyword-based recommendations
      const recommendedGroups = await this.getRecommendedGroups(userIntro);

      let addedGroups: string[] = [];
      let failedGroups: string[] = [];

      for (const group of recommendedGroups) {
        try {
          await this.addUserToGroup(userPhone, group.groupId);
          addedGroups.push(group.name);
        } catch (error) {
          console.error(`Failed to add user to ${group.name}:`, error);
          failedGroups.push(group.name);
        }
      }

      const response = [
        '✅ User Approved (GTG)',
        '',
        `User: ${userPhone}`,
        '📨 Sent welcome message with instructions',
        '',
        '📱 Group Additions:',
      ];

      if (addedGroups.length > 0) {
        response.push(`✅ Added to ${addedGroups.length} group(s):`);
        addedGroups.forEach(g => response.push(`   • ${g}`));
      }

      if (failedGroups.length > 0) {
        response.push('');
        response.push(`⚠️  Failed to add to ${failedGroups.length} group(s):`);
        failedGroups.forEach(g => response.push(`   • ${g}`));
      }

      return this.formatForSignal(response.join('\n'));
    } catch (error) {
      console.error('Error in handleGtg:', error);
      return `❌ Failed to process GTG: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Keyword-to-group mapping for intelligent recommendations
   * Maps interest keywords to group name patterns
   */
  private readonly GROUP_KEYWORD_MAP: Record<string, string[]> = {
    // UAS/Drone related
    'suas': ['uas', 'drone', 'suas', 'unmanned aerial', 'quadcopter', 'uav'],
    'uxs': ['uxs', 'unmanned', 'autonomous', 'robotics', 'ugv', 'usv'],
    'counter-uas': ['c-uas', 'counter uas', 'counter-uas', 'counter drone', 'anti-drone', 'blue uas'],

    // Military/Defense topics
    'military': ['military', 'defense', 'armed forces', 'usaf', 'army', 'navy', 'marines', 'dod'],
    'intel': ['intelligence', 'intel', 'sigint', 'osint', 'humint', 'cia', 'nsa'],
    'cyber': ['cyber', 'cybersecurity', 'infosec', 'netsec', 'hacking', 'security'],

    // Technology
    'tech': ['tech', 'technology', 'software', 'programming', 'coding', 'dev', 'engineer'],
    'ai': ['ai', 'artificial intelligence', 'machine learning', 'ml', 'gpt', 'llm'],

    // Other interests
    'news': ['news', 'current events', 'politics', 'geopolitics'],
  };

  /**
   * Extract keywords from user intro message
   */
  private extractKeywords(userIntro: string): Set<string> {
    const keywords = new Set<string>();
    const lowerIntro = userIntro.toLowerCase();

    // Check each keyword category
    for (const [_groupPattern, keywordList] of Object.entries(this.GROUP_KEYWORD_MAP)) {
      for (const keyword of keywordList) {
        // Use word boundary matching to avoid partial matches
        const regex = new RegExp(`\\b${keyword.replace(/[-\/]/g, '[-\/]?')}\\b`, 'i');
        if (regex.test(lowerIntro)) {
          keywords.add(keyword);
        }
      }
    }

    console.log(`📝 Extracted keywords from intro: ${Array.from(keywords).join(', ')}`);
    return keywords;
  }

  /**
   * Get recommended groups based on keywords found in user intro
   */
  private getGroupsMatchingKeywords(allGroups: any[], keywords: Set<string>): Array<{ groupId: string; name: string }> {
    const matchedGroups: Array<{ groupId: string; name: string }> = [];

    // For each keyword category, check if we have matching keywords
    for (const [groupPattern, keywordList] of Object.entries(this.GROUP_KEYWORD_MAP)) {
      // Check if any of the category's keywords were found
      const hasMatchingKeyword = keywordList.some(kw => keywords.has(kw));

      if (hasMatchingKeyword) {
        // Find groups matching this pattern
        const matchingGroups = allGroups.filter((g: any) =>
          g.name?.toLowerCase().includes(groupPattern.toLowerCase())
        );

        matchingGroups.forEach((g: any) => {
          // Avoid duplicates
          if (!matchedGroups.find(mg => mg.groupId === g.id)) {
            matchedGroups.push({ groupId: g.id, name: g.name });
            console.log(`✅ Keyword match: "${groupPattern}" → Group: "${g.name}"`);
          }
        });
      }
    }

    return matchedGroups;
  }

  /**
   * Get list of recommended groups for new users
   * Supports both core groups and keyword-based recommendations
   */
  private async getRecommendedGroups(userIntro?: string): Promise<Array<{ groupId: string; name: string }>> {
    if (!this.bot) {
      console.error('❌ Bot instance not available for getRecommendedGroups');
      return [];
    }

    try {
      console.log('🔄 Fetching groups from bot.getGroups()...');
      const allGroups = await this.bot.getGroups();
      console.log(`📋 Found ${allGroups.length} total groups`);

      if (allGroups.length === 0) {
        console.warn('⚠️  No groups returned from bot.getGroups()');
        return [];
      }

      // Log first few group names for debugging
      const sampleNames = allGroups.slice(0, 5).map((g: any) => g.name).join(', ');
      console.log(`📝 Sample group names: ${sampleNames}`);

      // Always include core groups
      const coreGroupNames = [
        'IrregularChat Main',
        'Announcements',
        'General Discussion',
      ];

      const coreGroups = allGroups
        .filter((g: any) =>
          coreGroupNames.some(name =>
            g.name?.toLowerCase().includes(name.toLowerCase())
          )
        )
        .map((g: any) => ({ groupId: g.id, name: g.name }));

      console.log(`🎯 Found ${coreGroups.length} core groups`);

      // If we have a user intro, add keyword-matched groups
      let interestGroups: Array<{ groupId: string; name: string }> = [];
      if (userIntro) {
        const keywords = this.extractKeywords(userIntro);
        interestGroups = this.getGroupsMatchingKeywords(allGroups, keywords);

        if (interestGroups.length > 0) {
          console.log(`🎯 Found ${interestGroups.length} interest-based group(s) from keywords`);
        } else {
          console.log('ℹ️  No keyword matches found, using core groups only');
        }
      }

      // Combine core + interest groups, removing duplicates
      const allRecommended = [...coreGroups];
      for (const ig of interestGroups) {
        if (!allRecommended.find(g => g.groupId === ig.groupId)) {
          allRecommended.push(ig);
        }
      }

      // If no core groups found, recommend ALL groups as fallback
      if (allRecommended.length === 0) {
        console.warn('⚠️  No core groups found, recommending ALL groups as fallback');
        return allGroups.map((g: any) => ({ groupId: g.id, name: g.name }));
      }

      console.log(`✅ Returning ${allRecommended.length} recommended groups`);
      return allRecommended;
    } catch (error) {
      console.error('❌ Error getting recommended groups:', error);
      return [];
    }
  }

  /**
   * Add user to a Signal group
   */
  /**
   * Add user to group using JSON-RPC (not spawn)
   *
   * Based on lessons learned and proven working implementation from commit 5613326b
   * Uses bot.updateGroup() which internally uses JSON-RPC instead of spawn-based CLI
   * This eliminates config file locking and is 60% faster
   */
  private async addUserToGroup(userPhone: string, groupId: string): Promise<void> {
    if (!this.bot) {
      throw new Error('Bot instance not available');
    }

    try {
      // Use bot's JSON-RPC based updateGroup method
      // The proven working implementation uses singular "member" parameter with array of identifiers
      await this.bot.updateGroup({
        groupId: groupId,
        member: [userPhone],  // Array format, can be phone number or UUID
      });

      console.log(`✅ Added ${userPhone} to group ${groupId} via JSON-RPC`);
    } catch (error) {
      console.error(`Failed to add user via JSON-RPC: ${error}`);
      throw new Error(`Failed to add user to group: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
   * !req / !request - Community join request template
   */
  private async handleRequest(): Promise<string> {
    return this.formatForSignal(
      '📝 IrregularChat Community Join Request\n\n' +
      'You\'ve requested to join the IrregularChat Community!\n\n' +
      '🔑 Bonafides Required:\n' +
      'Everyone in the chat has been invited by an IrregularChat member. ' +
      'To add you to the right groups, we need to know:\n\n' +
      '1️⃣ NAME\n' +
      '2️⃣ YOUR_ORGANIZATION\n' +
      '3️⃣ Who invited you (Add & mention them in this chat)\n' +
      '4️⃣ EMAIL_OR_EMAIL_ALIAS\n' +
      '5️⃣ YOUR_INTERESTS\n' +
      '6️⃣ Link to your LinkedIn profile (if you want others to endorse your skills)\n\n' +
      '📮 Please reply with your information above!\n\n' +
      '💡 Tip: An admin will review and add you to appropriate groups.'
    );
  }

  /**
   * !fpost - Create a forum post
   */
  private async handleForumPost(args: string, context: CommandContext): Promise<string> {
    if (!this.config.discourseApiUrl || !this.config.discourseApiKey) {
      return this.formatForSignal(
        '❌ Forum Integration Not Configured\n\n' +
        'To enable forum features, add these to .env.local:\n' +
        'DISCOURSE_API_URL=https://forum.example.com\n' +
        'DISCOURSE_API_KEY=your_api_key\n' +
        'DISCOURSE_API_USERNAME=bot_username'
      );
    }

    if (!args || args.trim().length === 0) {
      return this.formatForSignal(
        '❌ Usage Error\n\n' +
        'Usage: !fpost <title> | <content>\n\n' +
        'Example:\n' +
        '!fpost My Question | I need help with...'
      );
    }

    // Parse title and content
    const parts = args.split('|');
    if (parts.length < 2) {
      return '❌ Please separate title and content with |\n\nExample: !fpost Title | Content';
    }

    const title = parts[0].trim();
    const content = parts.slice(1).join('|').trim();

    try {
      // Make API call to Discourse
      const response = await fetch(`${this.config.discourseApiUrl}/posts.json`, {
        method: 'POST',
        headers: {
          'Api-Key': this.config.discourseApiKey,
          'Api-Username': this.config.discourseApiUsername || 'system',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          raw: content,
          category: 1, // Default category
        }),
      });

      if (!response.ok) {
        throw new Error(`Forum API error: ${response.status}`);
      }

      const data = await response.json() as any;
      const postUrl = `${this.config.discourseApiUrl}/t/${data.topic_slug}/${data.topic_id}`;

      return this.formatForSignal(
        '✅ Forum Post Created!\n\n' +
        `📝 Title: ${title}\n` +
        `🔗 URL: ${postUrl}\n\n` +
        '💡 View your post in the forum'
      );
    } catch (error) {
      console.error('Forum post error:', error);
      return this.formatForSignal(
        '❌ Failed to Create Forum Post\n\n' +
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
        '🚧 Please check forum API configuration'
      );
    }
  }

  /**
   * !flatest - Show latest forum posts
   */
  private async handleForumLatest(): Promise<string> {
    if (!this.config.discourseApiUrl) {
      return this.formatForSignal(
        '❌ Forum Not Configured\n\n' +
        'Add DISCOURSE_API_URL to .env.local'
      );
    }

    try {
      const response = await fetch(`${this.config.discourseApiUrl}/latest.json`);

      if (!response.ok) {
        throw new Error(`Forum API error: ${response.status}`);
      }

      const data = await response.json() as any;
      const topics = data.topic_list?.topics?.slice(0, 5) || [];

      if (topics.length === 0) {
        return this.formatForSignal('📭 No recent forum posts');
      }

      let result = '📰 Latest Forum Posts:\n\n';

      topics.forEach((topic: any, index: number) => {
        const url = `${this.config.discourseApiUrl}/t/${topic.slug}/${topic.id}`;
        result += `${index + 1}. ${topic.title}\n`;
        result += `   💬 ${topic.posts_count} posts | 👁️ ${topic.views} views\n`;
        result += `   🔗 ${url}\n\n`;
      });

      return this.formatForSignal(result);
    } catch (error) {
      console.error('Forum latest error:', error);
      return this.formatForSignal(
        '❌ Failed to Fetch Forum Posts\n\n' +
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * !fsearch - Search forum
   */
  private async handleForumSearch(args: string): Promise<string> {
    if (!this.config.discourseApiUrl) {
      return this.formatForSignal(
        '❌ Forum Not Configured\n\n' +
        'Add DISCOURSE_API_URL to .env.local'
      );
    }

    if (!args || args.trim().length === 0) {
      return '❌ Please provide a search query\n\nUsage: !fsearch <query>';
    }

    try {
      const query = encodeURIComponent(args.trim());
      const response = await fetch(`${this.config.discourseApiUrl}/search.json?q=${query}`);

      if (!response.ok) {
        throw new Error(`Forum API error: ${response.status}`);
      }

      const data = await response.json() as any;
      const topics = data.topics?.slice(0, 5) || [];

      if (topics.length === 0) {
        return this.formatForSignal(`📭 No results found for "${args}"`);
      }

      let result = `🔍 Forum Search Results for "${args}":\n\n`;

      topics.forEach((topic: any, index: number) => {
        const url = `${this.config.discourseApiUrl}/t/${topic.slug}/${topic.id}`;
        result += `${index + 1}. ${topic.title}\n`;
        result += `   🔗 ${url}\n\n`;
      });

      return this.formatForSignal(result);
    } catch (error) {
      console.error('Forum search error:', error);
      return this.formatForSignal(
        '❌ Forum Search Failed\n\n' +
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * !categories - List forum categories
   */
  private async handleForumCategories(): Promise<string> {
    if (!this.config.discourseApiUrl) {
      return this.formatForSignal(
        '❌ Forum Not Configured\n\n' +
        'Add DISCOURSE_API_URL to .env.local'
      );
    }

    try {
      const response = await fetch(`${this.config.discourseApiUrl}/categories.json`);

      if (!response.ok) {
        throw new Error(`Forum API error: ${response.status}`);
      }

      const data = await response.json() as any;
      const categories = data.category_list?.categories?.slice(0, 10) || [];

      if (categories.length === 0) {
        return this.formatForSignal('📭 No categories found');
      }

      let result = '📚 Forum Categories:\n\n';

      categories.forEach((category: any, index: number) => {
        result += `${index + 1}. ${category.name}\n`;
        if (category.description) {
          const desc = category.description.replace(/<[^>]*>/g, '').substring(0, 60);
          result += `   ${desc}${category.description.length > 60 ? '...' : ''}\n`;
        }
        result += `   📝 ${category.topic_count} topics\n\n`;
      });

      return this.formatForSignal(result);
    } catch (error) {
      console.error('Forum categories error:', error);
      return this.formatForSignal(
        '❌ Failed to Fetch Categories\n\n' +
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
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
