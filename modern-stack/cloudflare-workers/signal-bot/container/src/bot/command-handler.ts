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
import { AnnouncementHandler } from './announcement-handler.js';
import { formatScheduledTime } from '../utils/time-parser.js';
import {
  searchWiki,
  parallelSearch,
  fetchArticles,
  generateSearchQueries,
  WikiSearchResult,
} from '../utils/wiki-search.js';

export interface Mention {
  start: number;
  length: number;
  uuid?: string;
  number?: string;
}

export interface CommandContext {
  sourceNumber: string;
  sourceUuid?: string; // Signal UUID (ACI) - used for admin checks
  sourceName: string;
  groupId?: string;
  timestamp: number;
  quotedText?: string;
  mentions?: Mention[];
  message?: string; // Full original message text for mention extraction
}

export class CommandHandler {
  private config: BotConfig;
  private workerApi: WorkerAPIClient | null = null;
  private dbClient: PostgresClient | null = null;
  private openai: OpenAI | null = null;
  private questionCounter = 0;
  private bot: any | null = null; // SignalBot instance for accessing bot methods
  private announcementHandler: AnnouncementHandler | null = null;

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

    // Initialize announcement handler if dbClient is available
    if (this.dbClient && bot) {
      this.announcementHandler = new AnnouncementHandler(this.dbClient, bot);
      console.log('📢 Announcement handler initialized');
    }
  }

  /**
   * Check if user is admin
   *
   * SECURITY: Admin phone numbers are now loaded from environment variable
   * to prevent hardcoded credential exposure (CVE-2025-001)
   *
   * Supports both phone numbers and UUIDs. If UUID is provided, looks up
   * the phone number from database before checking admin list.
   *
   * @param identifier - Phone number (E.164) or Signal UUID (ACI)
   * @returns true if user is admin, false otherwise
   */
  private async isAdmin(identifier: string | undefined): Promise<boolean> {
    if (!identifier) {
      return false;
    }

    const admins = (process.env.ADMIN_PHONE_NUMBERS || '')
      .split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    if (admins.length === 0) {
      console.error('⚠️  SECURITY WARNING: No admin phone numbers configured in ADMIN_PHONE_NUMBERS');
      return false;
    }

    // Direct phone number match
    if (admins.includes(identifier)) {
      console.log(`✅ Admin check passed for phone number: ${identifier}`);
      return true;
    }

    // UUID lookup - check if this UUID's phone number is in admin list
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    if (this.dbClient && identifier.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      try {
        console.log(`🔍 Looking up phone number for UUID: ${identifier}`);
        const result = await this.dbClient.query(
          'SELECT phone_number FROM signal_members WHERE uuid = $1 LIMIT 1',
          [identifier]
        );

        if (result.results && result.results.length > 0 && result.results[0].phone_number) {
          const phoneNumber = result.results[0].phone_number;
          console.log(`📱 Found phone number for UUID: ${phoneNumber}`);

          if (admins.includes(phoneNumber)) {
            console.log(`✅ Admin check passed for UUID → phone number: ${phoneNumber}`);
            return true;
          } else {
            console.log(`❌ Phone number ${phoneNumber} is not in admin list`);
          }
        } else {
          console.log(`⚠️  No phone number found for UUID: ${identifier}`);
        }
      } catch (error) {
        console.error('❌ Database lookup failed during admin check:', error);
      }
    }

    console.log(`❌ Admin check failed for identifier: ${identifier}`);
    return false;
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

      // Group Management
      case '!groups':
        return this.handleGroups();

      case '!refreshgroups':
        return this.handleRefreshGroups();

      case '!addto':
        return this.handleAddTo(args, context);

      case '!join':
        return this.handleJoin(args, context);

      case '!leave':
        return this.handleLeave(args, context);

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

      case '!cast':
        return this.handleCast(args, context);

      // Information Commands
      case '!wiki':
        return this.handleWiki();

      case '!wikisearch':
      case '!ws':
        return this.handleWikiSearch(args, context);

      case '!wikiask':
      case '!wa':
        return this.handleWikiAsk(args, context);

      case '!forum':
        return this.handleForum();

      case '!links':
        return this.handleLinks(args, context);

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

      // Announcement Commands (Admin)
      case '!announce':
        return this.handleAnnounce(args, context);

      case '!announcements':
        return this.handleListAnnouncements(context);

      case '!cancelannounce':
        return this.handleCancelAnnouncement(args, context);

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
    const isAdmin = await this.isAdmin(context.sourceUuid || context.sourceNumber);

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
      '  !join - Self-service group joining (members only)',
      '  !refreshgroups - Force refresh group cache',
    ];

    if (isAdmin) {
      lines.push('  !addto <group#> @user - Add users to group');
    }

    lines.push(
      '',
      '📚 Wiki & Knowledge:',
      '  !wiki - Wiki links',
      '  !wikisearch, !ws - Search wiki',
      '  !wikiask, !wa - AI-powered wiki Q&A',
      '',
      '📚 Information:',
      '  !forum, !links, !faq, !docs, !events',
      '',
      '💬 Forum:',
      '  !fpost - Create forum post',
      '  !flatest - Latest forum posts',
      '  !fsearch - Search forum',
      '  !categories - Forum categories',
      '',
      '🎲 Utility:',
      '  !time, !flip, !fact, !8ball, !calc, !random, !cast',
      '',
      '👤 User:',
      '  !req, !request - Join community request',
      ''
    );

    if (isAdmin) {
      lines.push(
        '🔐 Admin:',
        '  !gtg, !pending',
        '',
        '📢 Announcements:',
        '  !announce [-t time] [-g groups] [-dm] message',
        '  !announcements - List pending',
        '  !cancelannounce <id> - Cancel scheduled',
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
  // Bot UUID cache - looked up once from database
  private botUuid: string | null = null;

  /**
   * Helper function to check if bot is admin in a group
   *
   * IMPORTANT: signal-cli returns admins as an array of UUID strings,
   * NOT as an array of objects. Example: ["922faebe-03bd-4cee-85a7-6b62ab446e45", ...]
   *
   * This was a bug fixed on 2025-12-01 - see LESSONS_LEARNED_SIGNAL_CLI.md
   */
  private async isBotAdminAsync(group: any): Promise<boolean> {
    if (!group.admins || !Array.isArray(group.admins)) {
      console.log(`❌ No admins array for group: ${group.name}`);
      return false;
    }

    // Look up bot's UUID from database if not cached
    if (!this.botUuid && this.dbClient) {
      try {
        const result = await this.dbClient.query(
          'SELECT uuid FROM signal_members WHERE phone_number = $1 LIMIT 1',
          [this.config.phoneNumber]
        );
        if (result.results && result.results.length > 0) {
          this.botUuid = result.results[0].uuid;
          console.log(`🤖 Bot UUID resolved: ${this.botUuid}`);
        }
      } catch (error) {
        console.error('Failed to look up bot UUID:', error);
      }
    }

    const botPhone = this.config.phoneNumber;
    const normalizedBotPhone = botPhone.startsWith('+') ? botPhone : `+${botPhone}`;

    console.log(`🔍 Checking admin status for ${group.name}`);
    console.log(`   Bot phone: ${normalizedBotPhone}`);
    console.log(`   Bot UUID: ${this.botUuid || 'unknown'}`);
    console.log(`   Admins array length: ${group.admins.length}`);
    if (group.admins.length > 0) {
      console.log(`   First admin (type: ${typeof group.admins[0]}): ${JSON.stringify(group.admins[0])}`);
    }

    // signal-cli returns admins as array of UUID strings, not objects
    const isAdmin = group.admins.some((admin: any) => {
      // Case 1: admin is a string (UUID) - this is the actual format from signal-cli
      if (typeof admin === 'string') {
        // Check against bot's UUID
        if (this.botUuid && admin === this.botUuid) {
          console.log(`   ✅ Match: admin UUID ${admin} === bot UUID ${this.botUuid}`);
          return true;
        }
        // Also check against phone number in case format varies
        if (admin === normalizedBotPhone || admin === botPhone) {
          console.log(`   ✅ Match: admin ${admin} === bot phone`);
          return true;
        }
        return false;
      }

      // Case 2: admin is an object (legacy/fallback support)
      if (admin && typeof admin === 'object') {
        if (admin.number) {
          const normalizedAdminPhone = admin.number.startsWith('+') ? admin.number : `+${admin.number}`;
          if (normalizedAdminPhone === normalizedBotPhone) {
            console.log(`   ✅ Match: admin.number ${normalizedAdminPhone} === bot phone`);
            return true;
          }
        }
        if (admin.uuid && this.botUuid && admin.uuid === this.botUuid) {
          console.log(`   ✅ Match: admin.uuid ${admin.uuid} === bot UUID`);
          return true;
        }
      }

      return false;
    });

    console.log(`   Result: ${isAdmin ? '👑 ADMIN' : '👤 MEMBER'}`);
    return isAdmin;
  }

  /**
   * Synchronous version for backwards compatibility - uses cached UUID
   */
  private isBotAdmin(group: any): boolean {
    if (!group.admins || !Array.isArray(group.admins)) {
      return false;
    }

    const botPhone = this.config.phoneNumber;
    const normalizedBotPhone = botPhone.startsWith('+') ? botPhone : `+${botPhone}`;

    return group.admins.some((admin: any) => {
      if (typeof admin === 'string') {
        return (this.botUuid && admin === this.botUuid) ||
               admin === normalizedBotPhone ||
               admin === botPhone;
      }
      if (admin && typeof admin === 'object') {
        if (admin.number) {
          const normalizedAdminPhone = admin.number.startsWith('+') ? admin.number : `+${admin.number}`;
          if (normalizedAdminPhone === normalizedBotPhone) return true;
        }
        if (admin.uuid && this.botUuid && admin.uuid === this.botUuid) return true;
      }
      return false;
    });
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
      let adminGroupCount = 0;

      // Use for...of to properly await async admin checks
      for (let index = 0; index < groups.length; index++) {
        const group = groups[index];
        const memberCount = group.members?.length || 0;
        totalSlots += memberCount;

        // Add each member's UUID to the set for deduplication
        // members can be strings (UUIDs) or objects {number, uuid}
        if (group.members && Array.isArray(group.members)) {
          for (const member of group.members) {
            let memberId: string | null = null;
            if (typeof member === 'string' && member) {
              memberId = member;
            } else if (member && typeof member === 'object') {
              memberId = member.uuid || member.number || null;
            }
            if (memberId) {
              uniqueMembers.add(memberId);
            }
          }
        }

        // Check if bot is admin using the async helper function (looks up UUID from DB)
        const isAdmin = await this.isBotAdminAsync(group);
        if (isAdmin) adminGroupCount++;
        const adminBadge = isAdmin ? ' 👑' : ' 👤';

        lines.push(`${index + 1}. ${group.name}${adminBadge}`);
        lines.push(`   Members: ${memberCount}`);
        lines.push('');
      }

      lines.push('────────────────');
      lines.push(`📊 Total: ${groups.length} groups`);
      lines.push(`👥 Member slots: ${totalSlots} (${uniqueMembers.size} unique users)`);
      lines.push('👑 = Bot has admin rights');
      lines.push('👤 = Bot is regular member');
      lines.push('');
      lines.push(`✅ Bot can add users to ${adminGroupCount} group(s)`);
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
    // Check admin authorization using UUID (preferred) or phone number fallback
    const isUserAdmin = await this.isAdmin(context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
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

      // Sort groups by member count (same as !groups) to match numbering
      const sortedGroups = [...groups].sort((a: any, b: any) => {
        const countA = a.members?.length || 0;
        const countB = b.members?.length || 0;
        return countB - countA;
      });

      const group = sortedGroups[groupNum - 1];

      if (!group) {
        return `❌ Group #${groupNum} not found\n\nUse !groups to see all groups`;
      }

      // Check if bot is admin in this group
      const isAdmin = this.isBotAdmin(group);
      if (!isAdmin) {
        return `❌ Bot is not admin in group #${groupNum} (${group.name})\n\n` +
          `The bot can only add users to groups where it has admin rights.\n` +
          `Use !groups to see which groups show 👑 (admin).`;
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
   * Check if user is a verified community member
   * Must be in at least one IrregularChat group (excluding Entry/INDOC)
   */
  private async isVerifiedCommunityMember(userUuid: string | undefined): Promise<{
    isVerified: boolean;
    memberGroups: string[];
    reason?: string;
  }> {
    if (!userUuid) {
      return { isVerified: false, memberGroups: [], reason: 'No user UUID provided' };
    }

    if (!this.dbClient) {
      return { isVerified: false, memberGroups: [], reason: 'Database not available' };
    }

    try {
      // Query groups the user is a member of (excluding Entry/INDOC)
      const result = await this.dbClient.query(
        `SELECT g.id, g.name, g.bot_is_admin
         FROM signal_member_group_memberships m
         JOIN signal_groups g ON m.group_id = g.id
         WHERE m.member_id = $1
           AND m.is_active = true
           AND LOWER(g.name) NOT LIKE '%entry%'
           AND LOWER(g.name) NOT LIKE '%indoc%'`,
        [userUuid]
      );

      const memberGroups = result.results?.map((r: any) => r.name) || [];

      if (memberGroups.length === 0) {
        return {
          isVerified: false,
          memberGroups: [],
          reason: 'You must be an existing IrregularChat member to use this command. Contact an admin for access.'
        };
      }

      return { isVerified: true, memberGroups };
    } catch (error) {
      console.error('Error checking community membership:', error);
      return { isVerified: false, memberGroups: [], reason: 'Failed to verify membership' };
    }
  }

  /**
   * !join - Self-service group joining for verified community members
   *
   * Usage:
   *   !join           - Show joinable groups
   *   !join 1 5 12    - Join groups by number (same as !groups numbering)
   *   !join tech ai   - Join groups by name (partial match)
   */
  private async handleJoin(args: string, context: CommandContext): Promise<string> {
    if (!this.bot) {
      return '❌ Bot instance not available';
    }

    const userUuid = context.sourceUuid;

    // Verify user is an existing community member
    const verification = await this.isVerifiedCommunityMember(userUuid);
    if (!verification.isVerified) {
      return this.formatForSignal(
        `❌ Access Denied\n\n` +
        `${verification.reason}\n\n` +
        `The !join command is only available to existing IrregularChat community members.\n\n` +
        `To join the community, please have a current member vouch for you in the Entry/INDOC group.`
      );
    }

    try {
      const groups = await this.bot.getGroups();

      // Sort groups by size (same as !groups command) to maintain consistent numbering
      const sortedGroups = [...groups].sort((a: any, b: any) => {
        const countA = a.members?.length || 0;
        const countB = b.members?.length || 0;
        return countB - countA;
      });

      // Build joinability info for each group
      const groupInfo = sortedGroups.map((g: any, index: number) => {
        const isAdmin = this.isBotAdmin(g);
        const userInGroup = g.members?.some((m: any) => {
          const memberId = typeof m === 'string' ? m : m?.uuid;
          return memberId === userUuid;
        });
        return {
          group: g,
          index: index + 1, // 1-based numbering (same as !groups)
          canJoin: isAdmin && !userInGroup,
          isAdmin,
          userInGroup,
        };
      });

      const joinableGroups = groupInfo.filter(g => g.canJoin);

      // If no args, show joinable groups with their !groups numbering
      if (!args.trim()) {
        if (joinableGroups.length === 0) {
          return this.formatForSignal(
            `📱 No Joinable Groups\n\n` +
            `You're either already in all groups or the bot doesn't have admin rights to add you.\n\n` +
            `Current groups you're in: ${verification.memberGroups.slice(0, 5).join(', ')}${verification.memberGroups.length > 5 ? '...' : ''}`
          );
        }

        const lines = [
          '📱 Joinable Groups:',
          '',
          'Groups you can join (use number from !groups):',
          '',
        ];

        for (const info of joinableGroups) {
          const memberCount = info.group.members?.length || 0;
          lines.push(`${info.index}. ${info.group.name} (${memberCount} members)`);
        }

        lines.push('');
        lines.push('────────────────');
        lines.push('Usage: !join <number> or !join <name>');
        lines.push('  !join 29       - Join group #29');
        lines.push('  !join tech     - Join groups matching "tech"');
        lines.push('  !join 1 3 5    - Join multiple groups');
        lines.push('');
        lines.push(`✅ Verified member in ${verification.memberGroups.length} group(s)`);

        return this.formatForSignal(lines.join('\n'));
      }

      // Parse group selections using !groups numbering
      const parts = args.trim().toLowerCase().split(/\s+/);
      const selectedGroups: typeof groupInfo = [];
      const errors: string[] = [];

      for (const part of parts) {
        // Try as number first (1-based, same as !groups)
        const num = parseInt(part);
        if (!isNaN(num) && num >= 1 && num <= sortedGroups.length) {
          const info = groupInfo[num - 1];
          if (!info) continue;

          if (info.userInGroup) {
            errors.push(`#${num} ${info.group.name}: Already a member`);
            continue;
          }
          if (!info.isAdmin) {
            errors.push(`#${num} ${info.group.name}: Bot is not admin`);
            continue;
          }
          if (!selectedGroups.some(s => s.index === info.index)) {
            selectedGroups.push(info);
          }
          continue;
        }

        // Try as name match
        const matches = groupInfo.filter((g) =>
          g.group.name?.toLowerCase().includes(part) &&
          g.canJoin &&
          !selectedGroups.some(s => s.index === g.index)
        );
        if (matches.length === 0) {
          // Check if name matches but can't join
          const cantJoin = groupInfo.filter((g) =>
            g.group.name?.toLowerCase().includes(part) && !g.canJoin
          );
          if (cantJoin.length > 0) {
            for (const g of cantJoin) {
              if (g.userInGroup) {
                errors.push(`"${part}" → ${g.group.name}: Already a member`);
              } else if (!g.isAdmin) {
                errors.push(`"${part}" → ${g.group.name}: Bot is not admin`);
              }
            }
          }
        }
        selectedGroups.push(...matches);
      }

      if (selectedGroups.length === 0) {
        let msg = `❌ Cannot join the specified group(s)\n\n`;
        if (errors.length > 0) {
          msg += `Reasons:\n${errors.join('\n')}\n\n`;
        }
        msg += `Use !join to see available groups.`;
        return this.formatForSignal(msg);
      }

      // Add user to selected groups
      const results: string[] = [];
      for (const info of selectedGroups) {
        try {
          await this.addUserToGroup(userUuid!, info.group.id);
          results.push(`✅ #${info.index} ${info.group.name}`);
          console.log(`📥 User ${userUuid} self-joined group "${info.group.name}" via !join`);
        } catch (error) {
          console.error(`Failed to add user to ${info.group.name}:`, error);
          results.push(`❌ #${info.index} ${info.group.name} (${error instanceof Error ? error.message : 'failed'})`);
        }
      }

      let response = `📱 Joining Groups\n\nResults:\n${results.join('\n')}`;
      if (errors.length > 0) {
        response += `\n\nSkipped:\n${errors.join('\n')}`;
      }
      response += `\n\n✨ Groups with ✅ have been joined.\nYou should receive invites shortly.`;

      return this.formatForSignal(response);

    } catch (error) {
      console.error('Error in handleJoin:', error);
      return `❌ Failed to join groups: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !leave - Leave groups (self-service)
   *
   * Note: Signal doesn't have a "remove member" API that works for self-removal
   * This command provides guidance on how to leave groups manually
   */
  private async handleLeave(args: string, context: CommandContext): Promise<string> {
    return this.formatForSignal(
      `📱 Leaving Groups\n\n` +
      `To leave a Signal group:\n\n` +
      `1. Open the group chat\n` +
      `2. Tap the group name at the top\n` +
      `3. Scroll down and tap "Leave Group"\n\n` +
      `Note: The bot cannot remove you from groups - you must leave manually through the Signal app.\n\n` +
      `If you want to be removed from all IrregularChat groups, contact an admin.`
    );
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
   * !cast - Roll dice for multiple users
   *
   * Usage:
   * - !cast @user1 @user2 @user3           (rolls 1 die per user)
   * - !cast 6 @user1 @user2 @user3         (rolls 6 dice per user)
   *
   * Shows individual die results and totals, sorted by winner
   */
  private async handleCast(args: string, context: CommandContext): Promise<string> {
    // Parse number of dice (default 1)
    let numDice = 1;
    let mentionText = args;

    // Check if first arg is a number
    const parts = args.trim().split(/\s+/);
    if (parts.length > 0 && /^\d+$/.test(parts[0])) {
      numDice = parseInt(parts[0]);
      mentionText = parts.slice(1).join(' ');
    }

    // Validate dice count
    if (numDice < 1 || numDice > 20) {
      return '❌ Please specify between 1 and 20 dice';
    }

    // Check if we have mentions
    if (!context.mentions || context.mentions.length === 0) {
      return this.formatForSignal(
        '🎲 Cast Dice\n\n' +
        'Usage:\n' +
        '  !cast @user1 @user2 @user3\n' +
        '  !cast 6 @user1 @user2 @user3\n\n' +
        'Mention users to roll dice for them!'
      );
    }

    // Roll dice for each user
    interface PlayerRoll {
      name: string;
      uuid: string;
      rolls: number[];
      total: number;
    }

    const results: PlayerRoll[] = [];

    // Always include the sender/initiator
    let senderName = context.sourceName || 'You';
    if (this.dbClient && context.sourceNumber) {
      try {
        const senderInfo = await this.dbClient.query(
          'SELECT display_name, profile_name, first_name, last_name, phone_number FROM signal_members WHERE phone_number = $1 OR uuid = $1 LIMIT 1',
          [context.sourceNumber]
        );
        if (senderInfo.results && senderInfo.results.length > 0) {
          const row = senderInfo.results[0];
          senderName = row.display_name || row.profile_name ||
                      (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name) ||
                      row.phone_number || senderName;
        }
      } catch (error) {
        console.log('Could not look up sender name:', error);
      }
    }

    // Roll for the sender first
    const senderRolls: number[] = [];
    let senderTotal = 0;
    for (let i = 0; i < numDice; i++) {
      const roll = Math.floor(Math.random() * 6) + 1;
      senderRolls.push(roll);
      senderTotal += roll;
    }
    results.push({
      name: senderName,
      uuid: context.sourceNumber || '',
      rolls: senderRolls,
      total: senderTotal
    });

    // Roll for each mentioned user
    for (const mention of context.mentions) {
      // Signal mentions use Unicode placeholder (￼) in message text, NOT actual names
      // We must use database lookup or phone number/UUID instead
      let userName = 'Unknown';

      // Try database lookup first if available
      if (this.dbClient && mention.uuid) {
        try {
          const memberInfo = await this.dbClient.query(
            'SELECT display_name, profile_name, first_name, last_name, phone_number FROM signal_members WHERE uuid = $1 LIMIT 1',
            [mention.uuid]
          );
          if (memberInfo.results && memberInfo.results.length > 0) {
            const row = memberInfo.results[0];
            userName = row.display_name || row.profile_name ||
                      (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name) ||
                      row.phone_number || userName;
          }
        } catch (error) {
          // Database lookup failed, continue with fallbacks
          console.log('Could not look up member name:', error);
        }
      }

      // Fallback: Use phone number if available
      if (userName === 'Unknown' && mention.number) {
        // Format phone number nicely: +12345678901 -> +1-234-567-8901
        const phone = mention.number;
        if (phone.startsWith('+1') && phone.length === 12) {
          userName = `${phone.substring(0, 2)}-${phone.substring(2, 5)}-${phone.substring(5, 8)}-${phone.substring(8)}`;
        } else {
          userName = phone;
        }
      }

      // Final fallback: Shortened UUID
      if (userName === 'Unknown' && mention.uuid) {
        userName = `User-${mention.uuid.substring(0, 8)}`;
      }

      // Roll dice
      const rolls: number[] = [];
      let total = 0;

      for (let i = 0; i < numDice; i++) {
        const roll = Math.floor(Math.random() * 6) + 1;
        rolls.push(roll);
        total += roll;
      }

      results.push({
        name: userName,
        uuid: mention.uuid || '',
        rolls,
        total
      });
    }

    // Sort by total (highest first)
    results.sort((a, b) => b.total - a.total);

    // Format output
    let output = `🎲 Cast Results (${numDice}d6)\n\n`;

    results.forEach((player, index) => {
      const rank = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
      const diceEmoji = player.rolls.map(d => ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][d - 1]).join(' ');

      output += `${rank} ${player.name}\n`;
      output += `   Rolls: ${diceEmoji}\n`;
      output += `   Total: ${player.total}\n\n`;
    });

    return this.formatForSignal(output.trim());
  }

  /**
   * !wiki - IrregularChat wiki (Irregularpedia)
   */
  private async handleWiki(): Promise<string> {
    return this.formatForSignal(
      '📚 Irregularpedia - Community Wiki\n\n' +
      '🌐 https://irregularpedia.org\n\n' +
      'Community-maintained knowledge base with guides, documentation, and resources.\n\n' +
      '📝 Contribute: https://git.irregularchat.com/irregulars/IrregularChatWiki\n\n' +
      '🔍 Search: !wikisearch <query> or !ws <query>\n' +
      '🤖 Ask AI: !wikiask <question> or !wa <question>'
    );
  }

  /**
   * !wikisearch / !ws - Search wiki with AI-enriched parallel queries
   *
   * Generates multiple search variations and searches in parallel
   * Returns deduplicated, relevance-ranked results
   */
  private async handleWikiSearch(args: string, context: CommandContext): Promise<string> {
    if (!args.trim()) {
      return this.formatForSignal(
        '🔍 Wiki Search\n\n' +
        'Usage: !wikisearch <query>\n' +
        '       !ws <query>\n\n' +
        'Examples:\n' +
        '  !ws drone certification\n' +
        '  !wikisearch osint tools\n' +
        '  !ws privacy hardening\n\n' +
        'Uses AI-enriched parallel search for better results.'
      );
    }

    try {
      // Generate search query variations
      const queries = generateSearchQueries(args.trim());
      console.log(`🔍 Wiki search: "${args}" -> ${queries.length} query variations`);

      // Parallel search with all query variations
      const results = await parallelSearch(queries, 8);

      if (results.length === 0) {
        return this.formatForSignal(
          `🔍 Wiki Search: "${args}"\n\n` +
          `❌ No results found\n\n` +
          `Try different keywords or browse:\n` +
          `🌐 https://irregularpedia.org/tags.html`
        );
      }

      // Format results
      const lines = [
        `🔍 Wiki Search: "${args}"`,
        '',
        `Found ${results.length} result(s):`,
        '',
      ];

      for (let i = 0; i < Math.min(results.length, 6); i++) {
        const r = results[i];
        const tags = r.article.tags.slice(0, 3).join(', ');
        lines.push(`${i + 1}. ${r.article.title}`);
        if (tags) lines.push(`   📑 ${tags}`);
        lines.push(`   🔗 ${r.article.url}`);
        lines.push('');
      }

      if (results.length > 6) {
        lines.push(`... and ${results.length - 6} more results`);
        lines.push('');
      }

      lines.push('💡 For AI-powered answers: !wikiask <your question>');

      return this.formatForSignal(lines.join('\n'));

    } catch (error) {
      console.error('Error in handleWikiSearch:', error);
      return `❌ Wiki search failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !wikiask / !wa - Ask a question with wiki context + AI
   *
   * 1. Extracts keywords from question
   * 2. Searches wiki for relevant articles
   * 3. Fetches article content
   * 4. Passes to AI with context for enriched answer
   */
  private async handleWikiAsk(args: string, context: CommandContext): Promise<string> {
    if (!args.trim()) {
      return this.formatForSignal(
        '🤖 Wiki Ask (AI-Enhanced)\n\n' +
        'Usage: !wikiask <question>\n' +
        '       !wa <question>\n\n' +
        'Examples:\n' +
        '  !wa how do I get drone certified?\n' +
        '  !wikiask what tools are used for osint?\n' +
        '  !wa best practices for server hardening\n\n' +
        'Searches wiki and uses AI to provide enriched answers with sources.'
      );
    }

    if (!this.openai) {
      return this.formatForSignal(
        '❌ AI not configured\n\n' +
        'The !wikiask command requires OpenAI API.\n\n' +
        'Use !wikisearch for regular wiki search.'
      );
    }

    // Rate limit
    const rateLimiter = getRateLimiter();
    const limit = await rateLimiter.checkLimit(`wikiask:${context.sourceNumber}`, 10, 3600);
    if (!limit.allowed) {
      return formatRateLimitMessage('wikiask', limit.resetIn);
    }

    const question = args.trim();

    try {
      // Step 1: Generate search queries and find relevant articles
      console.log(`🤖 WikiAsk: "${question}"`);
      const queries = generateSearchQueries(question);
      const searchResults = await parallelSearch(queries, 5);

      if (searchResults.length === 0) {
        // No wiki results - still try to answer with AI but note no wiki context
        const response = await this.openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant for the IrregularChat community. Answer concisely.',
            },
            {
              role: 'user',
              content: question,
            },
          ],
          max_tokens: 500,
          temperature: 0.7,
        });

        const answer = response.choices[0]?.message?.content || 'No response generated';

        return this.formatForSignal(
          `🤖 WikiAsk: "${question}"\n\n` +
          `📚 No wiki articles found for context\n\n` +
          `${answer}\n\n` +
          `💡 Browse wiki: https://irregularpedia.org`
        );
      }

      // Step 2: Fetch content from top 2-3 articles
      const articleUrls = searchResults.slice(0, 3).map(r => r.article.url);
      console.log(`📄 Fetching ${articleUrls.length} wiki articles for context...`);
      const articles = await fetchArticles(articleUrls);

      // Step 3: Build context from wiki articles
      let wikiContext = '';
      const sources: string[] = [];

      for (const article of articles) {
        // Use excerpt (max 500 chars per article) to stay within token limits
        wikiContext += `\n\n--- ${article.title} ---\n${article.excerpt}`;
        sources.push(`• ${article.title}: ${article.url}`);
      }

      // Step 4: Ask AI with wiki context
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a helpful assistant for the IrregularChat community wiki (Irregularpedia).
Answer the user's question based on the wiki content provided below.
Be concise (2-3 paragraphs max).
If the wiki content doesn't fully answer the question, say so and provide what you can.

WIKI CONTENT:${wikiContext}`,
          },
          {
            role: 'user',
            content: question,
          },
        ],
        max_tokens: 600,
        temperature: 0.7,
      });

      const answer = response.choices[0]?.message?.content || 'No response generated';

      // Format response
      const lines = [
        `🤖 WikiAsk: "${question}"`,
        '',
        answer,
        '',
        '📚 Sources:',
        ...sources,
      ];

      return this.formatForSignal(lines.join('\n'));

    } catch (error) {
      console.error('Error in handleWikiAsk:', error);
      return `❌ WikiAsk failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
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
   * !links - Browse shared news links with grouping and statistics
   *
   * Default behavior: Shows all recent links across all groups,
   * categorized by Signal group, with domain statistics at bottom.
   *
   * Options:
   *   -c           Show only current group's links
   *   -t <time>    Time period (24h, 7d, 30d, etc.)
   *   -d <domain>  Filter by domain
   *   -k <keyword> Search in title/URL
   *   -g <groupId> Filter by specific group ID
   *   -n <count>   Number of results (default 15, max 30)
   */
  private async handleLinks(args: string, context: CommandContext): Promise<string> {
    if (!this.dbClient) {
      return this.formatForSignal('❌ Database not available');
    }

    // Parse options
    const options = this.parseLinksOptions(args);

    // Show help only if explicitly requested
    if (options.help) {
      return this.getLinksHelp();
    }

    try {
      // Build query with JOIN to get human-readable group names
      let sql = `
        SELECT n.url, n.domain, n.title, n.summary, n.forum_url, n.post_count,
               n.first_posted_at, n.last_posted_at, n.posted_by_name,
               n.group_id, COALESCE(g.name, 'Unknown Group') as group_display_name
        FROM news_links n
        LEFT JOIN signal_groups g ON n.group_id = g.id
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIndex = 1;

      // Only filter by group if explicitly specified with -g flag
      if (options.groupId) {
        sql += ` AND n.group_id = $${paramIndex++}`;
        params.push(options.groupId);
      }
      // If -c flag (current group only), filter to current group
      if (options.currentGroupOnly && context.groupId) {
        sql += ` AND n.group_id = $${paramIndex++}`;
        params.push(context.groupId);
      }

      // Filter by time period
      if (options.timePeriod) {
        const cutoff = this.calculateTimeCutoff(options.timePeriod);
        if (cutoff) {
          sql += ` AND n.first_posted_at >= $${paramIndex++}`;
          params.push(cutoff.toISOString());
        }
      }

      // Filter by domain
      if (options.domain) {
        sql += ` AND n.domain ILIKE $${paramIndex++}`;
        params.push(`%${options.domain}%`);
      }

      // Filter by keyword in title or URL
      if (options.keyword) {
        sql += ` AND (n.title ILIKE $${paramIndex++} OR n.url ILIKE $${paramIndex++})`;
        params.push(`%${options.keyword}%`, `%${options.keyword}%`);
      }

      // Order by most recent first
      sql += ` ORDER BY n.last_posted_at DESC LIMIT $${paramIndex++}`;
      const limit = Math.min(options.limit || 15, 30);
      params.push(limit);

      // Execute query
      const result = await this.dbClient.query(sql, params);
      const links = result.results || [];

      if (links.length === 0) {
        let noResultsMsg = '📭 No links found';
        if (options.timePeriod) noResultsMsg += ` in last ${options.timePeriod}`;
        if (options.domain) noResultsMsg += ` from ${options.domain}`;
        if (options.keyword) noResultsMsg += ` matching "${options.keyword}"`;
        return this.formatForSignal(noResultsMsg);
      }

      // Group links by their Signal group for display
      const linksByGroup = new Map<string, any[]>();
      const domainCounts = new Map<string, number>();
      let totalShares = 0;

      for (const link of links) {
        const groupKey = link.group_display_name || 'Unknown Group';
        if (!linksByGroup.has(groupKey)) {
          linksByGroup.set(groupKey, []);
        }
        linksByGroup.get(groupKey)!.push(link);

        // Track domain statistics
        const domain = link.domain || 'unknown';
        domainCounts.set(domain, (domainCounts.get(domain) || 0) + (link.post_count || 1));
        totalShares += link.post_count || 1;
      }

      // Determine which URL to show based on flags
      const showForum = options.showForum;
      const showArchive = options.showArchive;
      // Default: show actual article URL

      // Build response
      let response = `📰 Recent Links (${links.length})\n\n`;

      // Show links grouped by Signal group
      for (const [groupName, groupLinks] of linksByGroup) {
        response += `📁 ${groupName}\n`;

        for (const link of groupLinks) {
          try {
            // Format date nicely
            const dateObj = link.last_posted_at ? new Date(link.last_posted_at) : null;
            const date = dateObj && !isNaN(dateObj.getTime())
              ? dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : '?';

            // Format title with share count
            const title = link.title ? this.truncate(link.title, 50) : link.domain || 'Article';
            const shares = link.post_count > 1 ? ` (${link.post_count}x)` : '';
            const postedBy = link.posted_by_name && link.posted_by_name !== 'Unknown'
              ? ` • ${link.posted_by_name}` : '';

            response += `• ${title}${shares}\n`;
            response += `  ${date}${postedBy}\n`;

            // Choose which URL to display
            if (showForum && link.forum_url) {
              response += `  ${link.forum_url}\n`;
            } else if (showArchive && link.url) {
              // Generate archive.org Wayback Machine URL
              response += `  https://web.archive.org/web/${link.url}\n`;
            } else if (link.url) {
              // Default: show actual article URL
              response += `  ${link.url}\n`;
            }
            response += '\n';
          } catch (linkError) {
            console.warn('Skipping malformed link entry:', linkError);
            continue;
          }
        }
      }

      // Domain Statistics Section (compact)
      if (domainCounts.size > 1 && !options.noStats) {
        response += '📊 ';
        const sortedDomains = Array.from(domainCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4);
        response += sortedDomains.map(([d, c]) => `${d}(${c})`).join(' • ');
        response += '\n';
      }

      // Footer
      response += '\n💡 -f=forum -a=archive -h=help';

      return this.formatForSignal(response);
    } catch (error) {
      console.error('Error in handleLinks:', error);
      return this.formatForSignal('❌ Error searching links');
    }
  }

  /**
   * Parse !links command options
   */
  private parseLinksOptions(args: string): {
    timePeriod?: string;
    domain?: string;
    keyword?: string;
    groupId?: string;
    limit?: number;
    currentGroupOnly?: boolean;
    showForum?: boolean;
    showArchive?: boolean;
    noStats?: boolean;
    help: boolean;
  } {
    const options: any = { help: false };

    // Check for explicit help request
    if (args && (args.trim() === '-h' || args.trim() === '--help' || args.trim() === 'help')) {
      options.help = true;
      return options;
    }

    // Empty args is fine - will show recent links across all groups
    if (!args || args.trim() === '') {
      return options;
    }

    let remaining = args.trim();

    // Parse -c (current group only)
    if (remaining.match(/-c\b/i)) {
      options.currentGroupOnly = true;
      remaining = remaining.replace(/-c\b/i, '');
    }

    // Parse -f (show forum links)
    if (remaining.match(/-f\b/i)) {
      options.showForum = true;
      remaining = remaining.replace(/-f\b/i, '');
    }

    // Parse -a (show archive links)
    if (remaining.match(/-a\b/i)) {
      options.showArchive = true;
      remaining = remaining.replace(/-a\b/i, '');
    }

    // Parse -s (no stats / simple)
    if (remaining.match(/-s\b/i)) {
      options.noStats = true;
      remaining = remaining.replace(/-s\b/i, '');
    }

    // Parse -t (time period)
    const timeMatch = remaining.match(/-t\s+(\S+)/i);
    if (timeMatch) {
      options.timePeriod = timeMatch[1];
      remaining = remaining.replace(timeMatch[0], '');
    }

    // Parse -d (domain)
    const domainMatch = remaining.match(/-d\s+(\S+)/i);
    if (domainMatch) {
      options.domain = domainMatch[1];
      remaining = remaining.replace(domainMatch[0], '');
    }

    // Parse -k (keyword)
    const keywordMatch = remaining.match(/-k\s+(\S+)/i);
    if (keywordMatch) {
      options.keyword = keywordMatch[1];
      remaining = remaining.replace(keywordMatch[0], '');
    }

    // Parse -g (group ID - direct group_id string)
    const groupMatch = remaining.match(/-g\s+(\S+)/i);
    if (groupMatch) {
      options.groupId = groupMatch[1];
      remaining = remaining.replace(groupMatch[0], '');
    }

    // Parse -n (limit)
    const limitMatch = remaining.match(/-n\s+(\d+)/i);
    if (limitMatch) {
      options.limit = parseInt(limitMatch[1], 10);
      remaining = remaining.replace(limitMatch[0], '');
    }

    // Any remaining text is treated as keyword search
    remaining = remaining.trim();
    if (remaining && !options.keyword) {
      options.keyword = remaining;
    }

    return options;
  }

  /**
   * Calculate time cutoff from period string
   */
  private calculateTimeCutoff(period: string): Date | null {
    const now = new Date();
    const match = period.match(/^(\d+)(h|d|w|m)$/i);

    if (!match) return null;

    const [, numStr, unit] = match;
    const num = parseInt(numStr, 10);

    switch (unit.toLowerCase()) {
      case 'h': // hours
        return new Date(now.getTime() - num * 60 * 60 * 1000);
      case 'd': // days
        return new Date(now.getTime() - num * 24 * 60 * 60 * 1000);
      case 'w': // weeks
        return new Date(now.getTime() - num * 7 * 24 * 60 * 60 * 1000);
      case 'm': // months (approximate)
        return new Date(now.getTime() - num * 30 * 24 * 60 * 60 * 1000);
      default:
        return null;
    }
  }

  /**
   * Truncate string to max length
   */
  private truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen - 3) + '...';
  }

  /**
   * Get help text for !links command
   */
  private getLinksHelp(): string {
    return this.formatForSignal(
      '📰 !links - Browse Shared News Links\n\n' +
      'Shows recent links with actual article URLs.\n\n' +
      'Usage: !links [options] [search]\n\n' +
      'URL Options:\n' +
      '  (default)   Show article URL\n' +
      '  -f          Show forum discussion URL\n' +
      '  -a          Show archive.org URL\n\n' +
      'Filters:\n' +
      '  -c          This group only\n' +
      '  -t <time>   Time period (24h, 7d, 1w)\n' +
      '  -d <domain> Filter by domain\n' +
      '  -n <count>  Results (max 30)\n\n' +
      'Examples:\n' +
      '  !links           Recent links\n' +
      '  !links -f        With forum links\n' +
      '  !links -a        With archive links\n' +
      '  !links -t 7d     Last 7 days\n' +
      '  !links ukraine   Search "ukraine"'
    );
  }

  /**
   * !faq - FAQ
   */
  private async handleFaq(): Promise<string> {
    return this.formatForSignal(
      '❓ Frequently Asked Questions\n\n' +
      '🌐 https://forum.irregularchat.com/t/irregularchat-forum-start-here-faqs/84\n\n' +
      'Start here for community FAQ and onboarding info.\n\n' +
      '📚 Wiki: https://irregularpedia.org'
    );
  }

  /**
   * !docs - Documentation
   */
  private async handleDocs(): Promise<string> {
    return this.formatForSignal(
      '📖 Documentation\n\n' +
      '🌐 https://irregularpedia.org\n\n' +
      'Browse Irregularpedia for technical documentation, guides, and community knowledge.'
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
    const isUserAdmin = await this.isAdmin(context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
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
   * Only returns groups where bot is admin (can add members)
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

      // Filter to groups where bot is admin (can add members)
      const adminGroups = allGroups.filter((g: any) => this.isBotAdmin(g));
      console.log(`👑 Bot is admin in ${adminGroups.length} groups`);

      // Log first few group names for debugging
      const sampleNames = adminGroups.slice(0, 5).map((g: any) => g.name).join(', ');
      console.log(`📝 Sample admin group names: ${sampleNames}`);

      // Core groups for new members (actual group name patterns)
      // These are groups every new member should be added to
      const coreGroupPatterns = [
        'tech',           // IrregularChat: Tech - main tech discussion
        'announcements',  // IrrChat: Unmanned Announcements
        'off topic',      // IR: Off Topic Guild
      ];

      // Exclude these groups from auto-add (admin-only, entry, etc.)
      const excludePatterns = [
        'entry',          // Entry/INDOC - they're leaving this
        'indoc',          // Entry/INDOC
        'admin',          // Admin-only groups
        'bot development', // Internal development
        'solo',           // Test groups
      ];

      const coreGroups = adminGroups
        .filter((g: any) => {
          const name = g.name?.toLowerCase() || '';
          // Must match a core pattern
          const matchesCore = coreGroupPatterns.some(pattern => name.includes(pattern));
          // Must NOT match exclude patterns
          const matchesExclude = excludePatterns.some(pattern => name.includes(pattern));
          return matchesCore && !matchesExclude;
        })
        .map((g: any) => ({ groupId: g.id, name: g.name }));

      console.log(`🎯 Found ${coreGroups.length} core groups: ${coreGroups.map((g: { groupId: string; name: string }) => g.name).join(', ')}`);

      // If we have a user intro, add keyword-matched groups
      let interestGroups: Array<{ groupId: string; name: string }> = [];
      if (userIntro) {
        const keywords = this.extractKeywords(userIntro);
        // Only match against groups where bot is admin
        interestGroups = this.getGroupsMatchingKeywords(adminGroups, keywords);

        // Filter out excluded groups from interest matches too
        interestGroups = interestGroups.filter(g => {
          const name = g.name?.toLowerCase() || '';
          return !excludePatterns.some(pattern => name.includes(pattern));
        });

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

      // If no groups found, return empty (don't add to random groups)
      if (allRecommended.length === 0) {
        console.warn('⚠️  No recommended groups found - user intro may not match any interest keywords');
        console.warn('ℹ️  Consider manually adding user to groups with !addto');
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
    const isUserAdmin = await this.isAdmin(context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
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

  // ============================================================================
  // ANNOUNCEMENT COMMANDS
  // ============================================================================

  /**
   * !announce - Send announcement to groups
   *
   * Usage: !announce [-t time] [-g groups] [-dm] message
   */
  private async handleAnnounce(args: string, context: CommandContext): Promise<string> {
    // Check admin
    const isUserAdmin = await this.isAdmin(context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
      return '❌ Admin-only command';
    }

    // Check announcement handler
    if (!this.announcementHandler) {
      return '❌ Announcement handler not initialized (requires PostgreSQL)';
    }

    // Show help if no args
    if (!args || args.trim().length === 0) {
      return this.announcementHandler.getHelp();
    }

    try {
      // Parse command flags
      const parsed = this.announcementHandler.parseCommand(args);

      if (!parsed.message) {
        return '❌ No message provided\n\n' + this.announcementHandler.getHelp();
      }

      // Resolve target groups
      // Force refresh from signal-cli when DM mode is enabled to get actual member UUIDs
      // (database cache only stores member counts, not actual UUIDs)
      const targetGroups = await this.announcementHandler.resolveGroups(
        parsed.groups,
        context.groupId,
        parsed.dm  // forceRefresh when sending DMs
      );

      if (targetGroups.length === 0) {
        return '❌ No target groups found\n\nUse !groups to see available groups, then use -g flag';
      }

      // Calculate total recipients for confirmation
      let totalRecipients = 0;
      if (parsed.dm) {
        for (const group of targetGroups) {
          const members = await this.announcementHandler.getGroupMembers(group.id);
          totalRecipients += members.length || group.memberCount;
        }
      } else {
        totalRecipients = targetGroups.length;
      }

      // If scheduled, save to database
      if (parsed.time) {
        const userId = context.sourceUuid || context.sourceNumber;
        const result = await this.announcementHandler.scheduleAnnouncement(
          parsed.message,
          targetGroups,
          parsed.time.date,
          parsed.dm,
          userId,
          context.sourceName
        );

        if (result.id) {
          const groupNames = targetGroups.map(g => g.name).join(', ');
          const dmNote = parsed.dm ? ' (as DM to each member)' : '';

          return this.formatForSignal([
            '📅 Announcement Scheduled',
            '',
            `ID: ${result.id}`,
            `Time: ${formatScheduledTime(parsed.time.date)}`,
            `Groups: ${groupNames}${dmNote}`,
            `Recipients: ~${totalRecipients}`,
            '',
            `Message: "${parsed.message.substring(0, 100)}${parsed.message.length > 100 ? '...' : ''}"`,
            '',
            'Use !cancelannounce <id> to cancel',
          ].join('\n'));
        } else {
          return `❌ Failed to schedule: ${result.error || 'Unknown error'}`;
        }
      }

      // Immediate send
      const groupNames = targetGroups.map(g => g.name).join(', ');

      if (parsed.dm) {
        // Send DM to each member
        const result = await this.announcementHandler.sendDMsToGroupMembers(
          targetGroups,
          parsed.message
        );

        const lines = [
          '📢 Announcement Sent (DM)',
          '',
          `✅ Sent to: ${result.sent} members`,
          `Groups: ${groupNames}`,
        ];

        if (result.errors.length > 0) {
          lines.push('');
          lines.push(`⚠️  ${result.errors.length} errors (check logs)`);
        }

        return this.formatForSignal(lines.join('\n'));
      } else {
        // Send to groups
        const result = await this.announcementHandler.sendToGroups(
          targetGroups,
          parsed.message
        );

        const lines = [
          '📢 Announcement Sent',
          '',
          `✅ Sent to: ${result.sent.join(', ')}`,
        ];

        if (result.errors.length > 0) {
          lines.push('');
          lines.push(`⚠️  Failed: ${result.errors.join(', ')}`);
        }

        return this.formatForSignal(lines.join('\n'));
      }
    } catch (error) {
      console.error('Announce command error:', error);
      return `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !announcements - List pending scheduled announcements
   */
  private async handleListAnnouncements(context: CommandContext): Promise<string> {
    // Check admin
    const isUserAdmin = await this.isAdmin(context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
      return '❌ Admin-only command';
    }

    if (!this.dbClient) {
      return '❌ Database not available';
    }

    try {
      const userId = context.sourceUuid || context.sourceNumber;
      const pending = await this.dbClient.getUserPendingAnnouncements(userId);

      if (pending.length === 0) {
        return '📭 No pending announcements\n\nUse !announce to create one';
      }

      const lines = [
        '📋 Pending Announcements',
        '',
      ];

      pending.forEach((ann: any) => {
        const scheduledAt = new Date(ann.scheduled_at);
        const groupNames = ann.target_group_names
          ? JSON.parse(ann.target_group_names).join(', ')
          : 'Unknown';
        const dmNote = ann.send_as_dm ? ' [DM]' : '';
        const preview = ann.message.substring(0, 50) + (ann.message.length > 50 ? '...' : '');

        lines.push(`#${ann.id}${dmNote} - ${formatScheduledTime(scheduledAt)}`);
        lines.push(`   Groups: ${groupNames}`);
        lines.push(`   "${preview}"`);
        lines.push('');
      });

      lines.push('Use !cancelannounce <id> to cancel');

      return this.formatForSignal(lines.join('\n'));
    } catch (error) {
      console.error('List announcements error:', error);
      return `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !cancelannounce <id> - Cancel a scheduled announcement
   */
  private async handleCancelAnnouncement(args: string, context: CommandContext): Promise<string> {
    // Check admin
    const isUserAdmin = await this.isAdmin(context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
      return '❌ Admin-only command';
    }

    if (!this.dbClient) {
      return '❌ Database not available';
    }

    const announcementId = parseInt(args.trim(), 10);
    if (isNaN(announcementId)) {
      return '❌ Invalid announcement ID\n\nUsage: !cancelannounce <id>';
    }

    try {
      const userId = context.sourceUuid || context.sourceNumber;
      const success = await this.dbClient.cancelAnnouncement(announcementId, userId);

      if (success) {
        return `✅ Announcement #${announcementId} cancelled`;
      } else {
        return `❌ Could not cancel #${announcementId}\n\nMake sure it exists and is still pending`;
      }
    } catch (error) {
      console.error('Cancel announcement error:', error);
      return `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
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
