/**
 * Command Handler
 *
 * Processes all bot commands (!help, !ping, !ai, !ask, etc.)
 * Uses PostgreSQL for all database operations.
 */

import { BotConfig } from './signal-bot-v2.js';
import { PostgresClient } from '../db/postgres-client.js';
import OpenAI from 'openai';
import { scrapeUrl, extractUrls, containsUrl } from '../utils/url-scraper.js';
import { scrapePdf, scrapePdfFromPath, isPdfUrl } from '../utils/pdf-scraper.js';
import { getRateLimiter, formatRateLimitMessage } from '../utils/rate-limiter.js';
import { AnnouncementHandler } from './announcement-handler.js';
import { formatScheduledTime } from '../utils/time-parser.js';
import {
  searchWiki,
  parallelSearch,
  fetchArticles,
  generateSearchQueries,
  WikiSearchResult,
  getKeywordResultsForHybrid,
  getWikiIndex,
  fetchArticleContent,
} from '../utils/wiki-search.js';
import { WikiEmbeddingsManager } from '../utils/wiki-embeddings.js';
import {
  organizeFile,
  getDirectoryForGroup,
  listCategories,
  normalizeFilename,
  suggestCategoryWithAI,
  getBasePath,
} from '../utils/file-organizer.js';
import {
  getRandomMeme,
  getMemeById,
  listMemes,
  getMemeFilePath,
  memeFileExists,
  getMemeStats,
  MemeDefinition,
} from '../utils/meme-reactions.js';
import {
  createGame,
  createGameInGroup,
  getGame,
  getGameByGroupId,
  setGameGroupId,
  startBetting,
  placeBet,
  shooterRoll,
  setShooterStake,
  getGameStatus,
  getPlayerPoints,
  removePlayer,
  endGame,
  getGameRules,
  getBetSummary,
  playerSkipBetting,
  shooterReadyToRoll,
  checkAllPlayersReady,
  areAllPlayersReady,
  isBettingTimeExpired,
  getBettingTimeRemaining,
  setHoldBet,
  applyHeldBets,
  getHoldsSummary,
  GameState,
} from '../utils/dice-game.js';
import {
  searchByFilename,
  searchDirectories,
  smartSearch,
  grepFiles,
  listCategories as listFileCategories,
  getFilesInCategory,
  formatSearchResults,
  getPCloudUrl,
  getDirectDownloadLink,
  getSearchSession,
  getFileFromSession,
  getLastSession,
  FileInfo,
  SearchResult,
  GrepResult,
  DirInfo,
} from '../utils/file-search.js';
import { authentikClient, generateWelcomeMessage } from '../utils/authentik-client.js';
import { parseIntroduction, isIntroMessage, formatIntroSummary, extractEmailFromText } from '../utils/intro-parser.js';
import { getNextDicho, getDichosCount, formatDicho } from '../utils/dichos.js';
import { BreakoutManager, ROOM_TYPES, PRIVACY_MODES, RoomType, PrivacyMode } from '../utils/breakout-manager.js';

export interface Mention {
  start: number;
  length: number;
  uuid?: string;
  number?: string;
}

export interface SignalAttachment {
  contentType?: string;
  filename?: string;
  id?: string;
  storedFilename?: string;
  size?: number;
  width?: number;
  height?: number;
  caption?: string;
}

export interface CommandContext {
  sourceNumber: string;
  sourceUuid?: string; // Signal UUID (ACI) - used for admin checks
  sourceName: string;
  groupId?: string;
  timestamp: number;
  quotedText?: string;
  quotedAttachments?: SignalAttachment[]; // Attachments from the quoted/replied message
  quotedAuthor?: string; // UUID of the user who wrote the quoted message
  mentions?: Mention[];
  message?: string; // Full original message text for mention extraction
}

/**
 * Command response can be:
 * - string: Simple text response
 * - object with text + attachment: Response with media attachment
 * - null: No response (silent)
 */
export interface CommandResponseWithAttachment {
  text: string;
  attachment?: string; // Path to attachment file
}

export type CommandResponse = string | CommandResponseWithAttachment | null;

/**
 * Check if a string looks like a UUID or truncated UUID fallback
 * These patterns should NOT be used as display names
 */
function looksLikeUuid(str: string): boolean {
  if (!str) return false;
  // Match full UUID format
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) return true;
  // Match truncated UUID format (6-8 hex chars + ...)
  if (/^[0-9a-f]{6,8}\.\.\.?$/i.test(str)) return true;
  // Match bracketed UUID prefix [abc123] or [abc123...]
  if (/^\[[0-9a-f]{6,8}\]$/i.test(str)) return true;
  if (/^\[[0-9a-f]{6,8}\.\.\.?\]$/i.test(str)) return true;
  // Match pure hex strings 6-8 chars (likely truncated UUIDs stored as names)
  if (/^[0-9a-f]{6,8}$/i.test(str)) return true;
  return false;
}

export class CommandHandler {
  private config: BotConfig;
  private dbClient: PostgresClient;
  private openai: OpenAI | null = null;
  private questionCounter = 0;
  private bot: any | null = null; // SignalBot instance for accessing bot methods
  private announcementHandler: AnnouncementHandler | null = null;
  private breakoutManager: BreakoutManager | null = null;
  private wikiEmbeddings: WikiEmbeddingsManager | null = null;

  constructor(config: BotConfig, dbClient: PostgresClient) {
    this.config = config;
    this.dbClient = dbClient;

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

    // Initialize announcement handler
    this.announcementHandler = new AnnouncementHandler(this.dbClient, bot);
    console.log('📢 Announcement handler initialized');

    // Initialize breakout manager with OpenAI for AI summaries
    this.breakoutManager = new BreakoutManager(this.dbClient, bot, this.config.openAiApiKey);
    this.breakoutManager.startTimerLoop(60000); // Check every minute
    if (this.config.openAiApiKey) {
      console.log('🚀 Breakout room manager initialized (with AI summaries)');
    } else {
      console.log('🚀 Breakout room manager initialized (no AI - missing OPENAI_API_KEY)');
    }

    // Initialize wiki embeddings manager for semantic search
    this.wikiEmbeddings = new WikiEmbeddingsManager(this.dbClient, this.config.openAiApiKey);
    if (this.wikiEmbeddings.isEnabled()) {
      console.log('📚 Wiki embeddings manager initialized (semantic search enabled)');
    } else {
      console.log('📚 Wiki embeddings manager initialized (no AI - keyword search only)');
    }
  }

  /**
   * Check if user is admin
   *
   * SECURITY: Admin identifiers are loaded from environment variables
   * to prevent hardcoded credential exposure (CVE-2025-001)
   *
   * Supports both phone numbers and UUIDs:
   * - ADMIN_PHONE_NUMBERS: comma-separated phone numbers (+12247253276) or UUIDs
   * - ADMIN_UUIDS: comma-separated UUIDs (for explicit UUID matching)
   *
   * If a UUID is provided and not in the direct admin list, looks up
   * the phone number from database before checking.
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
      .map(p => p.trim().toLowerCase())
      .filter(p => p.length > 0);

    // Also check ADMIN_UUIDS env var for direct UUID matches
    const adminUuids = (process.env.ADMIN_UUIDS || '')
      .split(',')
      .map(p => p.trim().toLowerCase())
      .filter(p => p.length > 0);

    if (admins.length === 0 && adminUuids.length === 0) {
      console.error('⚠️  SECURITY WARNING: No admin identifiers configured in ADMIN_PHONE_NUMBERS or ADMIN_UUIDS');
      return false;
    }

    // Direct match in admin list (phone number or UUID)
    const identifierLower = identifier.toLowerCase();
    if (admins.includes(identifierLower) || adminUuids.includes(identifierLower)) {
      console.log(`✅ Admin check passed for direct match: ${identifier}`);
      return true;
    }

    // If identifier looks like a UUID, also check for matching phone number
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    const isUuid = identifier.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    if (isUuid && this.dbClient) {
      try {
        console.log(`🔍 Looking up phone number for UUID: ${identifier}`);
        const result = await this.dbClient.query(
          'SELECT phone_number FROM signal_members WHERE uuid = $1 LIMIT 1',
          [identifier]
        );

        if (result.results && result.results.length > 0 && result.results[0].phone_number) {
          const phoneNumber = result.results[0].phone_number;
          console.log(`📱 Found phone number for UUID: ${phoneNumber}`);

          if (admins.includes(phoneNumber.toLowerCase())) {
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
  async handle(command: string, context: CommandContext): Promise<CommandResponse> {
    const trimmedCommand = command.trim();
    const contextId = context.groupId || context.sourceNumber || context.sourceUuid;

    // Check for "tldr <number>" pattern - summarize PDF from search session
    const tldrMatch = trimmedCommand.match(/^tldr\s+(\d+)$/i);
    if (tldrMatch && contextId) {
      const lastSession = getLastSession(contextId);
      if (lastSession) {
        const fileNum = parseInt(tldrMatch[1], 10);
        return this.handleTldrFromSession(lastSession.id, fileNum, context);
      }
    }

    // Check for bare number replies (file selection from !files search)
    // Pattern: just numbers and commas like "11" or "1,3,5"
    if (/^[\d,\s]+$/.test(trimmedCommand) && !trimmedCommand.startsWith('!')) {
      if (contextId) {
        const lastSession = getLastSession(contextId);
        if (lastSession) {
          // Parse numbers from the reply
          const numbers = trimmedCommand
            .split(/[,\s]+/)
            .map(s => parseInt(s.trim(), 10))
            .filter(n => !isNaN(n) && n > 0);

          if (numbers.length > 0) {
            return await this.handleFileGetFromSession(lastSession.id, numbers);
          }
        }
      }
    }

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

      case '!archive':
      case '!save':
        return this.handleArchive(args, context);

      case '!scan':
      case '!virus':
      case '!clamav':
        return this.handleVirusScan(args, context);

      case '!files':
      case '!search':
      case '!find':
        return this.handleFileSearch(args, context);

      case '!get':
        return this.handleFileGet(args, context);

      case '!lai':
        return this.handleLocalAI(args, context);

      case '!cleaner':
        return this.handleCleaner(args);

      // Utility Commands
      case '!time':
        return this.handleTime();

      case '!flip':
        return this.handleFlip();

      case '!meme':
      case '!gif':
        return this.handleMeme(args, context);

      case '!joke':
        return this.handleJoke();

      case '!quote':
        return this.handleQuote();

      case '!dichos':
      case '!dicho':
        return this.handleDichos();

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

      // Dice Game Commands
      case '!dice':
        return this.handleDiceGame(args, context);

      case '!roll':
        return this.handleDiceRoll(args, context);

      case '!pass':
        return this.handleDiceBet('pass', args, context);

      case '!fade':
        return this.handleDiceBet('fade', args, context);

      case '!stake':
        return this.handleDiceStake(args, context);

      case '!skip':
        return this.handleDiceSkip(context);

      case '!go':
        return this.handleDiceGo(context);

      case '!hold':
        return this.handleDiceHold(args, context);

      case '!points':
        return this.handleDicePoints(context);

      case '!gamestatus':
      case '!gs':
        return this.handleDiceStatus(context);

      case '!leave':
        return this.handleDiceLeave(context);

      case '!rematch':
      case '!again':
        return this.handleDiceRematch(context);

      // Information Commands
      case '!wiki':
        return this.handleWiki();

      case '!wikisearch':
      case '!ws':
        return this.handleWikiSearch(args, context);

      case '!wikiask':
      case '!wa':
        return this.handleWikiAsk(args, context);

      case '!wikiindex':
        return this.handleWikiIndex(context);

      case '!wikistats':
        return this.handleWikiStats();

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

      case '!remove':
        return this.handleRemove(args, context);

      case '!clearroom':
        return this.handleClearRoom(args, context);

      case '!createuser':
        return this.handleCreateUser(args, context);

      case '!accountinvite':
      case '!invite':
        return this.handleAccountInvite(args, context);

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
        return this.handleRequest(args, context);

      // Discourse/Forum Commands
      case '!fpost':
        return this.handleForumPost(args, context);

      case '!flatest':
        return this.handleForumLatest();

      case '!fsearch':
        return this.handleForumSearch(args);

      case '!categories':
        return this.handleForumCategories();

      // Breakout Room Commands
      case '!breakout':
        return this.handleBreakout(args, context);

      case '!endbreakout':
      case '!end':
        return this.handleEndBreakout(context);

      case '!breakouts':
        return this.handleBreakouts(context);

      case '!decision':
        return this.handleBreakoutAnnotation('decision', args, context);

      case '!action':
      case '!task':
        return this.handleGlobalTask(args, context);

      case '!park':
      case '!parkinglot':
      case '!parking':
      case '!pl':
        return this.handleBreakoutAnnotation('park', args, context);

      case '!parked':
      case '!listparked':
      case '!parkinglist':
        return this.handleListParked(context);

      case '!unpark':
        return this.handleUnpark(args, context);

      case '!complete':
      case '!done':
        return this.handleCompleteTask(args, context);

      case '!tasks':
      case '!mytasks':
        return this.handleListTasks(args, context);

      case '!cancel':
        return this.handleTaskStatusChange('cancelled', args, context);

      case '!start':
        return this.handleTaskStatusChange('in_progress', args, context);

      case '!block':
        return this.handleTaskStatusChange('blocked', args, context);

      case '!reopen':
        return this.handleTaskStatusChange('open', args, context);

      case '!priority':
        return this.handleTaskPriority(args, context);

      case '!assign':
        return this.handleTaskAssign(args, context);

      case '!extend':
        return this.handleBreakoutExtend(args, context);

      // Today I Learned
      case '!til':
      case '!todayilearned':
      case '!learned':
        return this.handleTil(args, context);

      case '!tils':
      case '!listtil':
        return this.handleListTils(args, context);

      default:
        // Unknown command
        return `❓ Unknown command: ${cmd}\n\nType !help for available commands.`;
    }
  }

  /**
   * !help - Show available commands (with random meme)
   */
  private async handleHelp(context: CommandContext): Promise<string | { text: string; attachment?: string }> {
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
      '🎰 Dice Game (Street Craps):',
      '  !dice @user1 @user2 - Start multiplayer game',
      '  !roll, !pass, !fade, !points, !leave',
      '',
      '👤 User:',
      '  !req, !request - Join community request',
      '',
      '🚀 Breakout Rooms:',
      '  !breakout <topic> - Create focused discussion group',
      '  !breakouts - List active breakout rooms',
      '  !action @person <task> - Assign action item',
      '  !complete - Mark action as done (reply to action)',
      '  !endbreakout - End your breakout room',
      ''
    );

    if (isAdmin) {
      lines.push(
        '🔐 Admin:',
        '  !gtg @user - Approve user (Good To Go)',
        '  !pending - Show pending users',
        '  !remove @user - Remove from all groups (safety number)',
        '  !clearroom confirm - Remove all non-admins from current group',
        '  !createuser @user email - Create SSO account for mentioned user',
        '  !createuser email name - Create SSO account with name',
        '  !accountinvite [hours] [-c 1] - Create SSO invite link',
        '',
        '📢 Announcements:',
        '  !announce [groups] [-t time] [-dm] message',
        '  !announcements - List pending',
        '  !cancelannounce <id> - Cancel scheduled',
        ''
      );
    }

    lines.push('💡 Use any command to get started!');

    if (isAdmin) {
      lines.push('🔒 You have admin access to restricted commands');
    }

    const helpText = this.formatForSignal(lines.join('\n'));

    // Add a random meme to the help response
    const meme = getRandomMeme();
    const filePath = getMemeFilePath(meme);
    const exists = await memeFileExists(meme);

    if (exists) {
      return {
        text: helpText,
        attachment: filePath,
      };
    }

    // Fallback to just text if meme not available
    return helpText;
  }

  /**
   * !ping - Test bot responsiveness
   */
  private async handlePing(): Promise<string> {
    return '🏓 Pong! Bot is responsive.\n\n✅ All systems operational.';
  }

  /**
   * !ai - Ask AI a question
   * @param question - The user's question
   * @param context - Command context
   * @param previousAIResponse - Optional previous AI response for conversation context
   */
  private async handleAI(question: string, context: CommandContext, previousAIResponse?: string): Promise<string> {
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
      // Build messages array - include previous context if this is a reply
      const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
        {
          role: 'system',
          content: 'You are a helpful assistant in a Signal group chat. Keep responses concise and friendly.',
        },
      ];

      // If there's a previous AI response, include it for context
      if (previousAIResponse) {
        console.log(`🤖 AI reply continuation from ${context.sourceName}`);
        // Extract the actual response content (remove the "🤖 AI Response:\n\n" prefix)
        const previousContent = previousAIResponse.replace(/^🤖 AI Response:\n\n/, '').trim();
        messages.push({
          role: 'assistant',
          content: previousContent,
        });
      } else {
        console.log(`🤖 AI request from ${context.sourceName}: ${question}`);
      }

      messages.push({
        role: 'user',
        content: question,
      });

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
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
   * Handle AI reply - when user replies to an AI response without using !ai prefix
   * This continues the conversation with context from the previous response
   */
  public async handleAIReply(userMessage: string, previousAIResponse: string, context: CommandContext): Promise<string | null> {
    // Only handle if the quoted message contains our AI response signature
    if (!previousAIResponse.includes('🤖 AI Response:')) {
      return null;
    }

    return this.handleAI(userMessage, context, previousAIResponse);
  }

  /**
   * !ask - Ask a question (Q&A system)
   * If asked inside a breakout room, links the question to the breakout
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
      const questionId = await this.dbClient.getNextQuestionId(context.groupId);

      // Extract title from first sentence if possible
      const sentences = question.split(/[.!?]/);
      const title = sentences[0]?.trim().substring(0, 100) || question.substring(0, 100);

      // Check if we're inside a breakout room
      let breakoutId: number | undefined;
      let annotationId: number | undefined;
      let breakoutInfo = '';

      const breakout = await this.dbClient.getActiveBreakoutByGroupId(context.groupId);
      if (breakout) {
        breakoutId = breakout.id;

        // Create a breakout annotation for this question
        annotationId = await this.dbClient.createBreakoutAnnotation({
          breakoutId: breakout.id,
          annotationType: 'question',
          content: question,
          createdByUuid: context.sourceUuid,
          createdByName: context.sourceName,
        });

        breakoutInfo = '\n\n📋 This question is linked to the current breakout room.';
      }

      const questionData = {
        questionId,
        question,
        title,
        asker: context.sourceName,
        askerPhone: context.sourceNumber,
        groupId: context.groupId,
        breakoutId,
        annotationId,
      };

      await this.dbClient.saveQuestion(questionData);

      return this.formatForSignal(
        `✅ Question #${questionId} recorded!\n\n` +
        `Question: ${question}\n\n` +
        `📝 Others can answer with: !answer ${questionId} <answer>\n` +
        `   Or reply to this message with: !a <answer>\n\n` +
        `✔️  Mark answer(s) as solved: !solved ${questionId} <answer_ids>` +
        breakoutInfo
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
      const questions = await this.dbClient.getQuestions(context.groupId, false);

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

    // Support multiple formats:
    // 1. "!answer <id> <answer>" - explicit ID
    // 2. "!answer <answer>" - defaults to most recent unanswered question
    // 3. Reply to question message with "!answer <answer>"
    let questionId: number | undefined;
    let answer: string;

    if (parts.length >= 2 && !isNaN(parseInt(parts[0]))) {
      // Format: !answer 123 <answer>
      questionId = parseInt(parts[0]);
      answer = parts.slice(1).join(' ');
    } else if (args.trim().length > 0) {
      // Format: !answer <answer> - default to most recent unanswered question
      answer = args.trim();

      // Check if replying to a question - use quoted text context
      if (context.quotedText) {
        // Try to extract question ID from quoted text like "❓ Question #123:"
        const quotedMatch = context.quotedText.match(/Question #(\d+)/);
        if (quotedMatch) {
          questionId = parseInt(quotedMatch[1]);
        }
      }

      // If still no ID, get most recent unanswered question in this group
      if (!questionId) {
        const recentQuestion = await this.dbClient.getMostRecentUnansweredQuestion(context.groupId);
        if (recentQuestion) {
          questionId = recentQuestion.question_id;
        } else {
          return '❌ No unanswered questions found in this group.\n\nUse !question to ask a new question.';
        }
      }
    } else {
      return '❌ Please provide an answer.\n\nUsage: !answer <answer> (answers most recent question)\n   or: !answer <id> <answer> (answers specific question)';
    }

    if (!answer || answer.trim().length === 0) {
      return '❌ Please provide an answer.\n\nUsage: !answer <id> <answer>';
    }

    // Ensure questionId is defined at this point
    if (questionId === undefined) {
      return '❌ Could not determine which question to answer.';
    }

    try {
      // Get question to validate it exists
      const questionData = await this.dbClient.getQuestionWithAnswers(questionId, context.groupId);

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

      const answerId = await this.dbClient.saveAnswer(answerData);

      // If this question is linked to a breakout room, update the annotation as answered
      let breakoutInfo = '';
      if (questionData.question.annotation_id) {
        try {
          await this.dbClient.updateBreakoutAnnotationAnswered(
            questionData.question.annotation_id,
            context.sourceUuid || context.sourceNumber,
            context.sourceName
          );
          breakoutInfo = '\n\n📋 Breakout annotation marked as answered.';
        } catch (e) {
          console.error('Failed to update breakout annotation:', e);
        }
      }

      const answerCount = questionData.answers.length + 1;

      return this.formatForSignal(
        `✅ Answer #${answerId} added to question #${questionId}!\n\n` +
        `❓ Question: ${questionData.question.question}\n\n` +
        `💬 Your answer: ${answer}\n\n` +
        `📊 Total answers: ${answerCount}\n\n` +
        `To mark this as the solution: !solved ${questionId} ${answerId}` +
        breakoutInfo
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
      const questionData = await this.dbClient.getQuestionWithAnswers(questionId, context.groupId);

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
      await this.dbClient.markAnswersAsSolution(questionId, validAnswerIds);

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
        const discourseResult = await this.dbClient.postQuestionToDiscourse(questionId);

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
      const allGroups = await this.bot.getGroups();

      // Filter out temporary dice game groups (they start with "🎲" and have patterns like "Dice Game -" or "'s Neon Room")
      const groups = allGroups.filter((g: any) => {
        const name = g.name || '';
        // Exclude dice game groups
        if (name.startsWith('🎲')) return false;
        if (name.includes('Dice Game -')) return false;
        if (name.includes("'s Neon Room")) return false;
        return true;
      });

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

    // Parse format: !addto 2,4,6,9,14 @user (comma-separated group numbers)
    // OR: !addto tech,cyber,ai @user (keyword search)
    // OR: !addto 2,tech,5,cyber @user (mixed numbers and keywords)
    // OR: !addto 11 @user1 @user2 (single group)
    const parts = args.trim().split(/\s+/);
    let groupSelector = '';

    // Helper to check if a string looks like a group selector (not a UUID or phone)
    const isGroupSelector = (s: string): boolean => {
      if (!s || s.length === 0) return false;
      if (s.startsWith('+')) return false; // Phone number
      // UUID pattern: 8-4-4-4-12 hex chars
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return false;
      // Signal mention placeholder (Unicode Object Replacement Character)
      if (s.includes('\uFFFC')) return false;
      // Should contain at least one alphanumeric
      if (!/[a-zA-Z0-9]/.test(s)) return false;
      return true;
    };

    // Check if first part contains group selector (numbers, keywords, or mixed)
    if (parts.length > 0 && isGroupSelector(parts[0])) {
      groupSelector = parts[0];
    }
    // Check if last part contains group selector
    else if (parts.length > 0 && isGroupSelector(parts[parts.length - 1])) {
      groupSelector = parts[parts.length - 1];
    }

    if (!groupSelector) {
      return '❌ Please provide group number(s) or keyword(s)\n\n' +
        'Usage:\n' +
        '  !addto <group#> @user\n' +
        '  !addto 2,4,6 @user (multiple groups by number)\n' +
        '  !addto tech,cyber @user (by keyword search)\n' +
        '  !addto 2,tech,5 @user (mixed)\n\n' +
        'Example: !addto 11 @Jason';
    }

    // Try to extract user identifiers
    const userIdentifiers: string[] = [];

    // APPROACH 1: Use Signal protocol mentions (if available)
    if (context.mentions && context.mentions.length > 0) {
      for (const mention of context.mentions) {
        const identifier = mention.uuid || mention.number;
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
        'Usage:\n' +
        '  !addto <group#> @user\n' +
        '  !addto 2,4,6 @user (multiple groups by number)\n' +
        '  !addto tech,cyber @user (by keyword search)\n\n' +
        'Examples:\n' +
        '  !addto 11 @Jason\n' +
        '  !addto 2,4,6,9 @Jason\n' +
        '  !addto tech,cyber,ai @Jason\n' +
        '  !addto 11 +19105551234\n\n' +
        'Note: Use Signal protocol mentions (@ menu) for best results.';
    }

    try {
      const groups = await this.bot.getGroups();

      // Sort groups by member count (same as !groups) to match numbering
      const sortedGroups = [...groups].sort((a: any, b: any) => {
        const countA = a.members?.length || 0;
        const countB = b.members?.length || 0;
        return countB - countA;
      });

      // Parse selector into numbers and keywords
      const selectorParts = groupSelector.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0);

      // Collect target groups (deduplicated by groupId)
      const targetGroups: Map<string, { group: any; matchedBy: string }> = new Map();
      const unmatchedSelectors: string[] = [];
      const skippedShort: string[] = [];

      for (const part of selectorParts) {
        // Check if it's a number
        const num = parseInt(part);
        if (!isNaN(num) && num > 0) {
          const group = sortedGroups[num - 1];
          if (group && !targetGroups.has(group.id)) {
            targetGroups.set(group.id, { group, matchedBy: `#${num}` });
          } else if (!group) {
            unmatchedSelectors.push(`#${num}`);
          }
        } else {
          // It's a keyword - require minimum 3 chars to avoid matching everything
          if (part.length < 3) {
            skippedShort.push(part);
            continue;
          }
          // Search group names
          let foundMatch = false;
          for (const group of sortedGroups) {
            const groupName = (group.name || '').toLowerCase();
            if (groupName.includes(part) && !targetGroups.has(group.id)) {
              targetGroups.set(group.id, { group, matchedBy: `"${part}"` });
              foundMatch = true;
            }
          }
          if (!foundMatch) {
            unmatchedSelectors.push(`"${part}"`);
          }
        }
      }

      if (targetGroups.size === 0) {
        let errorMsg = `❌ No groups found matching: ${groupSelector}\n\n`;
        if (skippedShort.length > 0) {
          errorMsg += `⚠️ Keywords must be 3+ chars (skipped: ${skippedShort.join(', ')})\n\n`;
        }
        errorMsg += 'Use !groups to see available groups and their numbers.\n' +
          'Keywords search group names (e.g., "tech" matches "IrregularChat: Tech")';
        return errorMsg;
      }

      const allResults: string[] = [];
      let successCount = 0;

      for (const [_groupId, { group, matchedBy }] of targetGroups) {
        // Check if bot is admin in this group (use async version)
        const isAdmin = await this.isBotAdminAsync(group);
        if (!isAdmin) {
          allResults.push(`❌ ${group.name} (${matchedBy}): Bot not admin`);
          continue;
        }

        const groupResults: string[] = [];
        let groupSuccess = true;

        for (const identifier of userIdentifiers) {
          try {
            await this.addUserToGroup(identifier, group.id);
            groupResults.push(`✅`);
          } catch (error) {
            console.error(`Failed to add ${identifier} to group ${group.name}:`, error);
            groupResults.push(`❌`);
            groupSuccess = false;
          }
        }

        if (groupSuccess) successCount++;
        allResults.push(`${groupSuccess ? '✅' : '⚠️'} ${group.name} (${matchedBy}): ${groupResults.join(' ')}`);
      }

      const userCount = userIdentifiers.length;
      const groupCount = targetGroups.size;

      // Build response with warnings for unmatched selectors
      let response = `📱 Adding ${userCount} User${userCount > 1 ? 's' : ''} to ${groupCount} Group${groupCount > 1 ? 's' : ''}\n\n`;
      response += allResults.join('\n') + '\n\n';

      if (unmatchedSelectors.length > 0) {
        response += `⚠️ No match: ${unmatchedSelectors.join(', ')}\n`;
      }
      if (skippedShort.length > 0) {
        response += `⚠️ Too short (3+ chars): ${skippedShort.join(', ')}\n`;
      }
      if (unmatchedSelectors.length > 0 || skippedShort.length > 0) {
        response += '\n';
      }

      response += `✨ ${successCount}/${groupCount} groups successful.`;

      return this.formatForSignal(response);
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

      // Build joinability info for each group (use async admin check like !groups)
      const groupInfo: Array<{
        group: any;
        index: number;
        canJoin: boolean;
        isAdmin: boolean;
        userInGroup: boolean;
      }> = [];

      for (let i = 0; i < sortedGroups.length; i++) {
        const g = sortedGroups[i];
        const isAdmin = await this.isBotAdminAsync(g);
        const userInGroup = g.members?.some((m: any) => {
          const memberId = typeof m === 'string' ? m : m?.uuid;
          return memberId === userUuid;
        });
        groupInfo.push({
          group: g,
          index: i + 1, // 1-based numbering (same as !groups)
          canJoin: isAdmin && !userInGroup,
          isAdmin,
          userInGroup,
        });
      }

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

      const userName = context.sourceName || 'Member';
      let response = `📱 ${userName} - Joining Groups\n\nResults:\n${results.join('\n')}`;
      if (errors.length > 0) {
        response += `\n\nSkipped:\n${errors.join('\n')}`;
      }
      response += `\n\n✨ Groups with ✅ have been joined.\n${userName}, you should receive invites shortly.`;

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

      try {
        // Fetch messages from database
        const messages = await this.dbClient.getMessagesWithConstraints(context.groupId, count, hours);

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
              content: `You are a helpful assistant that creates concise, topic-focused summaries of group conversations.

IMPORTANT RULES:
1. Focus on TOPICS, IDEAS, and INFORMATION discussed - NOT who said what
2. DO NOT include people's names in the summary unless absolutely essential (e.g., someone volunteering for a task)
3. Group related topics together
4. Highlight key insights, decisions, resources/links shared, and action items
5. Format as plain text only - NO markdown, NO asterisks, NO hashtags
6. Use line breaks and dashes for lists

Structure your summary as:
- Topics Discussed: (main themes/subjects)
- Key Information: (important facts, insights, resources)
- Decisions/Outcomes: (if any were made)
- Action Items: (tasks to be done, can include who if someone volunteered)`,
            },
            {
              role: 'user',
              content: `Summarize this conversation${timeDesc}, focusing on the topics and information rather than attributing to individuals:\n\n${conversationText}`,
            },
          ],
          max_tokens: 2000,  // Allow longer summaries for large conversations
          temperature: 0.5,
        });

        const summary = response.choices[0]?.message?.content || 'No summary available';
        return this.formatForSignal(`📝 Summary${countDesc}:\n\n${summary}`);
      } catch (error) {
        console.error('Conversation summarization error:', error);
        return `❌ Summarization failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    // Original behavior: summarize provided text/URL
    // First check for PDF attachments in quoted message (highest priority)
    const pdfAttachment = context.quotedAttachments?.find(att =>
      att.contentType === 'application/pdf' ||
      att.filename?.toLowerCase().endsWith('.pdf')
    );

    if (pdfAttachment && (!remainingArgs || remainingArgs.length === 0)) {
      console.log('📎 Found PDF attachment in quoted message:', JSON.stringify(pdfAttachment));

      // CVE-2025-005: Rate limit PDF summarization (20 calls/hour)
      const rateLimiter = getRateLimiter();
      const limit = await rateLimiter.checkLimit(`summarize:${context.sourceNumber}`, 20, 3600);

      if (!limit.allowed) {
        return formatRateLimitMessage('!summarize', limit.resetIn);
      }

      const dataDir = this.config.dataDir || '/app/signal-data';
      const attachmentsDir = `${dataDir}/attachments`;
      const fs = await import('fs/promises');

      let pdfPath: string | null = null;
      let pdfResult: any = { success: false };

      // If we have an attachment ID, try that first
      const attachmentId = pdfAttachment.id || pdfAttachment.storedFilename;
      if (attachmentId) {
        const directPaths = [
          `${attachmentsDir}/${attachmentId}`,
          `${attachmentsDir}/${attachmentId}.pdf`,
        ];

        for (const path of directPaths) {
          console.log(`📄 Trying direct path: ${path}`);
          const result = await scrapePdfFromPath(path, pdfAttachment.filename);
          if (result.success) {
            pdfPath = path;
            pdfResult = result;
            break;
          }
        }
      }

      // If no ID or direct path failed, search for recent PDF files
      if (!pdfResult.success) {
        console.log('📂 Searching attachments directory for recent PDFs...');
        try {
          const files = await fs.readdir(attachmentsDir);
          const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));

          // Get file stats and sort by modification time (newest first)
          const fileStats = await Promise.all(
            pdfFiles.map(async (f) => {
              const fullPath = `${attachmentsDir}/${f}`;
              try {
                const stat = await fs.stat(fullPath);
                return { name: f, path: fullPath, mtime: stat.mtime };
              } catch {
                return null;
              }
            })
          );

          const validFiles = fileStats.filter(Boolean) as { name: string; path: string; mtime: Date }[];
          validFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

          console.log(`📂 Found ${validFiles.length} PDF files, checking most recent...`);

          // Try the most recent PDF files (up to 5)
          for (const file of validFiles.slice(0, 5)) {
            console.log(`📄 Trying recent PDF: ${file.name} (modified: ${file.mtime.toISOString()})`);
            const result = await scrapePdfFromPath(file.path, pdfAttachment.filename);
            if (result.success) {
              pdfPath = file.path;
              pdfResult = result;
              console.log(`✅ Found valid PDF: ${file.path}`);
              break;
            }
          }
        } catch (err) {
          console.error('Error searching attachments directory:', err);
        }
      }

      if (!pdfResult.success) {
        return `❌ Could not read PDF attachment: ${pdfResult.error || 'File not found'}\n\n💡 The PDF may not have been downloaded yet. Try saving the file and sharing it again.`;
      }

      // Build content for summarization
      let contentToSummarize = '';
      if (pdfResult.title) {
        contentToSummarize += `Title: ${pdfResult.title}\n\n`;
      }
      contentToSummarize += `Document: ${pdfResult.pageCount} pages (${pdfResult.extractionMethod} extraction)\n\n`;
      if (pdfResult.content) {
        contentToSummarize += pdfResult.content;
      }

      // Use enhanced prompt for PDF documents - request PLAIN TEXT (no markdown)
      const systemPrompt = pdfResult.isLargePdf
        ? 'You are a helpful assistant that creates concise summaries of PDF documents. The content has been smart-extracted from a large document, including the table of contents, key sections, and conclusion. Focus on identifying the main purpose, key findings, and important recommendations. IMPORTANT: Format your response as plain text only - NO markdown, NO asterisks for bold, NO hashtags for headers. Use line breaks and dashes for lists.'
        : 'You are a helpful assistant that creates concise summaries of PDF documents. Focus on the main points, key findings, and important recommendations. IMPORTANT: Format your response as plain text only - NO markdown, NO asterisks for bold, NO hashtags for headers. Use line breaks and dashes for lists.';

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: `Summarize this PDF document:\n\n${contentToSummarize}`,
          },
        ],
        max_tokens: 1000,
        temperature: 0.5,
      });

      const summary = response.choices[0]?.message?.content || 'No summary available';
      const filename = pdfAttachment.filename || 'PDF Document';

      return this.formatForSignal(`📄 ${filename}\n${pdfResult.pageCount} pages • ${pdfResult.extractionMethod} extraction\n\n📝 Summary:\n${summary}`);
    }

    if (!remainingArgs || remainingArgs.length === 0) {
      // Check if there's a URL in quoted/replied message
      if (context.quotedText && containsUrl(context.quotedText)) {
        remainingArgs = context.quotedText;
        console.log('📌 Using URL from quoted message');
      } else {
        return '❌ Please provide content or URL to summarize, or use flags for conversation summary.\n\nUsage:\n  !summarize <text or URL>  (or !tldr <URL>)\n  !tldr  (reply to a message with PDF)\n  !summarize -h 2       (summarize last 2 hours)\n  !summarize -n 20      (summarize last 20 messages)\n  !summarize -h 1 -n 50 (last 50 messages from past hour)';
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

        // Check if URL is a PDF - handle differently
        if (isPdfUrl(url)) {
          console.log(`📄 PDF detected, using PDF scraper`);

          const pdfResult = await scrapePdf(url);

          if (!pdfResult.success) {
            return `❌ Failed to process PDF: ${pdfResult.error || 'Unknown error'}\n\nTip: Some PDFs are image-only and cannot be text-extracted.`;
          }

          // Build content for summarization
          let contentToSummarize = '';
          if (pdfResult.title) {
            contentToSummarize += `Title: ${pdfResult.title}\n\n`;
          }
          contentToSummarize += `Document: ${pdfResult.pageCount} pages (${pdfResult.extractionMethod} extraction)\n\n`;
          if (pdfResult.content) {
            contentToSummarize += pdfResult.content;
          }

          // Use enhanced prompt for PDF documents - request PLAIN TEXT (no markdown)
          const systemPrompt = pdfResult.isLargePdf
            ? 'You are a helpful assistant that creates concise summaries of PDF documents. The content has been smart-extracted from a large document, including the table of contents, key sections, and conclusion. Focus on identifying the main purpose, key findings, and important recommendations. IMPORTANT: Format your response as plain text only - NO markdown, NO asterisks for bold, NO hashtags for headers. Use line breaks and dashes for lists.'
            : 'You are a helpful assistant that creates concise summaries of PDF documents. Focus on the main points, key findings, and important recommendations. IMPORTANT: Format your response as plain text only - NO markdown, NO asterisks for bold, NO hashtags for headers. Use line breaks and dashes for lists.';

          const response = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: systemPrompt,
              },
              {
                role: 'user',
                content: `Summarize this PDF document:\n\n${contentToSummarize}`,
              },
            ],
            max_tokens: 700, // Slightly more for PDFs
            temperature: 0.5,
          });

          const summary = response.choices[0]?.message?.content || 'No summary available';
          const pdfInfo = pdfResult.isLargePdf
            ? `📄 PDF Summary (${pdfResult.pageCount} pages, smart extraction)`
            : `📄 PDF Summary (${pdfResult.pageCount} pages)`;

          return this.formatForSignal(`${pdfInfo}\n${pdfResult.title ? `📑 ${pdfResult.title}\n` : ''}\n${summary}`);
        }

        // Regular HTML/web page scraping
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
              content: 'You are a helpful assistant that creates concise summaries of web articles and content. Focus on the main points and key takeaways. IMPORTANT: Format your response as plain text only - NO markdown, NO asterisks for bold, NO hashtags for headers. Use line breaks and dashes for lists.',
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
              content: 'You are a helpful assistant that creates concise summaries. IMPORTANT: Format your response as plain text only - NO markdown, NO asterisks for bold, NO hashtags for headers. Use line breaks and dashes for lists.',
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
   * !archive / !save - Archive files to IrregularChat shared directory
   *
   * Archives attachments from quoted messages to the appropriate topic directory
   * based on the Signal group. Files sync to pCloud via rclone.
   *
   * Usage:
   *   !archive                    - Archive quoted attachment to auto-detected directory
   *   !archive --category Tech    - Override the target category
   *   !archive --scan             - Run virus scan before archiving
   *   !archive --list             - List available categories
   */
  private async handleArchive(args: string, context: CommandContext): Promise<string> {
    // Parse flags
    const listFlag = args.includes('--list') || args.includes('-l');
    const scanFlag = args.includes('--scan') || args.includes('-s');
    const categoryMatch = args.match(/--category\s+(\S+)/i) || args.match(/-c\s+(\S+)/i);
    const customCategory = categoryMatch ? categoryMatch[1] : undefined;

    // List available categories
    if (listFlag) {
      const categories = listCategories();
      const lines = [
        '📁 Available Archive Categories:',
        '',
        ...categories.map(c => `  • ${c}`),
        '',
        'Files are auto-categorized based on group name.',
        'Use --category <name> to override.',
      ];
      return lines.join('\n');
    }

    // Check for attachment in quoted message
    const attachment = context.quotedAttachments?.find(att =>
      att.filename || att.contentType
    );

    if (!attachment) {
      return `❌ No attachment found. Reply to a message with a file and use !archive

Usage:
  !archive              - Archive to auto-detected category
  !archive --scan       - Scan for viruses first
  !archive --category X - Override category
  !archive --list       - Show all categories

The file will be organized into the IrregularChat shared drive based on this group's topic.`;
    }

    // Find the attachment file
    const attachmentsDir = '/app/signal-data/attachments';
    const filename = attachment.filename || 'unknown';
    const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '';

    console.log(`📁 Archive request: ${filename} from group ${context.groupId || 'DM'}`);

    // Get group name for categorization
    let groupName = 'Unknown';
    if (context.groupId) {
      // Try database first
      try {
        const groupResult = await this.dbClient.query(
          `SELECT name FROM signal_groups WHERE group_id = $1`,
          [context.groupId]
        );
        if (groupResult.results.length > 0) {
          groupName = groupResult.results[0].name;
          console.log(`📁 Group name from DB: ${groupName}`);
        }
      } catch (err) {
        console.error('Failed to get group name from DB:', err);
      }

      // If database lookup failed, try bot.getGroups() as fallback
      if (groupName === 'Unknown' && this.bot) {
        try {
          const groups = await this.bot.getGroups();
          const matchingGroup = groups.find((g: any) => g.id === context.groupId);
          if (matchingGroup?.name) {
            groupName = matchingGroup.name;
            console.log(`📁 Group name from bot API: ${groupName}`);
          }
        } catch (err) {
          console.error('Failed to get group name from bot:', err);
        }
      }
    }
    console.log(`📁 Final group name for categorization: ${groupName}`);

    // Search for recent matching files in attachments directory
    try {
      const fs = await import('fs/promises');
      const files = await fs.readdir(attachmentsDir);

      // Filter files by extension if known
      const matchingFiles = ext
        ? files.filter(f => f.toLowerCase().endsWith(ext.toLowerCase()))
        : files;

      if (matchingFiles.length === 0) {
        return '❌ Could not locate the attachment file. It may not have been downloaded yet.';
      }

      // Get file stats and sort by mtime
      const fileStats = await Promise.all(
        matchingFiles.map(async (f) => {
          try {
            const stat = await fs.stat(`${attachmentsDir}/${f}`);
            return { name: f, path: `${attachmentsDir}/${f}`, mtime: stat.mtime };
          } catch {
            return null;
          }
        })
      );

      const validFiles = fileStats.filter(Boolean) as { name: string; path: string; mtime: Date }[];
      validFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      if (validFiles.length === 0) {
        return '❌ Could not access attachment files.';
      }

      // Use the most recent matching file
      const sourceFile = validFiles[0];
      console.log(`📂 Found attachment: ${sourceFile.path}`);

      // Organize the file
      const result = await organizeFile(sourceFile.path, {
        groupName,
        scanVirus: scanFlag,
        customSubdir: customCategory,
      });

      if (!result.success) {
        if (result.scanResult === 'infected') {
          return `🚨 VIRUS DETECTED - File not archived\n\nThe file "${filename}" was flagged as potentially malicious and was not saved.`;
        }
        return `❌ Archive failed: ${result.error}`;
      }

      // Build success response
      const lines = [
        `✅ File Archived Successfully`,
        '',
        `📄 File: ${filename}`,
        `📁 Category: ${result.category}${result.subcategory ? '/' + result.subcategory : ''}`,
        `💾 Saved as: ${result.normalizedFilename}`,
      ];

      if (scanFlag && result.scanResult === 'clean') {
        lines.push('🛡️ Virus scan: Clean');
      }

      // Upload to pCloud using rclone and get direct file link
      let pcloudFileLink: string | null = null;
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);

        if (result.destinationPath && result.normalizedFilename) {
          // Build pCloud remote path (e.g., pcloud:IrregularChat/Tech/Documents/filename.pdf)
          const pcloudRemote = process.env.RCLONE_PCLOUD_REMOTE || 'pcloud';
          const pcloudBasePath = process.env.PCLOUD_BASE_PATH || 'IrregularChat';
          const pcloudFolder = result.subcategory
            ? `${pcloudBasePath}/${result.category}/${result.subcategory}`
            : `${pcloudBasePath}/${result.category}`;
          const pcloudPath = `${pcloudRemote}:${pcloudFolder}/${result.normalizedFilename}`;

          console.log(`☁️ Uploading to pCloud: ${pcloudPath}`);

          // Upload file using rclone copy
          const uploadCmd = `rclone copy "${result.destinationPath}" "${pcloudRemote}:${pcloudFolder}/" --config /app/config/rclone.conf 2>&1`;
          try {
            await execAsync(uploadCmd, { timeout: 60000 });
            console.log(`✅ rclone upload successful`);

            // Get public link using rclone link
            const linkCmd = `rclone link "${pcloudPath}" --config /app/config/rclone.conf 2>&1`;
            const { stdout } = await execAsync(linkCmd, { timeout: 30000 });
            const link = stdout.trim();

            if (link && link.startsWith('http')) {
              pcloudFileLink = link;
              console.log(`☁️ pCloud direct link: ${pcloudFileLink}`);
            }
          } catch (rcloneErr: any) {
            console.error('rclone error:', rcloneErr.message || rcloneErr);
          }
        }
      } catch (uploadError) {
        console.error('pCloud upload error:', uploadError);
        // Continue without pCloud link - local save still worked
      }

      // Add pCloud link to response
      if (pcloudFileLink) {
        lines.push(
          '',
          '☁️ Uploaded to pCloud:',
          '',
          `📎 ${pcloudFileLink}`
        );
      } else {
        // Fallback to folder link if rclone upload failed
        const pcloudBaseUrl = process.env.PCLOUD_PUBLIC_URL || 'https://u.pcloud.link/publink/show?code=kZ8boiVZ2peBXyioGY8yJSqlMyacwHfa6RLV';
        const relativePath = result.category + (result.subcategory ? '/' + result.subcategory : '');
        const pcloudUrl = `${pcloudBaseUrl}#folder=${encodeURIComponent(relativePath)}`;
        lines.push(
          '',
          '☁️ Syncing to pCloud...',
          '',
          `📂 View folder: ${pcloudUrl}`
        );
      }

      return lines.join('\n');

    } catch (error) {
      console.error('Archive error:', error);
      return `❌ Archive failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !scan / !virus / !clamav - Scan file for viruses using ClamAV
   *
   * Scans attachments from quoted messages without archiving them.
   *
   * Usage:
   *   !scan  - Reply to a message with an attachment to scan it
   */
  private async handleVirusScan(args: string, context: CommandContext): Promise<string> {
    // Check for attachment in quoted message
    const attachment = context.quotedAttachments?.find(att =>
      att.filename || att.contentType
    );

    if (!attachment) {
      return `❌ No attachment found. Reply to a message with a file and use !scan

Usage: Reply to a file and type !scan to check it for viruses.

The scan uses ClamAV antivirus to detect malware, trojans, and other threats.`;
    }

    const filename = attachment.filename || 'unknown file';
    const ext = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '';
    const attachmentsDir = '/app/signal-data/attachments';

    console.log(`🔍 Virus scan requested: ${filename}`);

    try {
      const fs = await import('fs/promises');
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      // Find the attachment file
      const files = await fs.readdir(attachmentsDir);
      const matchingFiles = ext
        ? files.filter(f => f.toLowerCase().endsWith(ext.toLowerCase()))
        : files;

      if (matchingFiles.length === 0) {
        return '❌ Could not locate the attachment file. It may not have been downloaded yet.';
      }

      // Get most recent matching file
      const fileStats = await Promise.all(
        matchingFiles.map(async (f) => {
          try {
            const stat = await fs.stat(`${attachmentsDir}/${f}`);
            return { name: f, path: `${attachmentsDir}/${f}`, mtime: stat.mtime, size: stat.size };
          } catch {
            return null;
          }
        })
      );

      const validFiles = fileStats.filter(Boolean) as { name: string; path: string; mtime: Date; size: number }[];
      validFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      if (validFiles.length === 0) {
        return '❌ Could not access attachment files.';
      }

      const targetFile = validFiles[0];
      const fileSizeKB = Math.round(targetFile.size / 1024);

      console.log(`🔍 Scanning: ${targetFile.path} (${fileSizeKB} KB)`);

      // Run ClamAV scan
      try {
        const { stdout, stderr } = await execAsync(`clamscan --no-summary "${targetFile.path}"`, {
          timeout: 60000, // 60 second timeout
        });

        if (stdout.includes('OK')) {
          return `🛡️ ClamAV Scan Complete

📄 File: ${filename}
📦 Size: ${fileSizeKB} KB
🔍 Result: No known threats detected

Note: ClamAV checked against its virus signature database. No scanner catches 100% of threats - always exercise caution with files from unknown sources.`;
        } else if (stdout.includes('FOUND')) {
          // Extract threat name
          const threatMatch = stdout.match(/: (.+) FOUND/);
          const threatName = threatMatch ? threatMatch[1] : 'Unknown threat';

          return `🚨 THREAT DETECTED!

📄 File: ${filename}
📦 Size: ${fileSizeKB} KB
🛡️ Scanner: ClamAV
⚠️ Threat: ${threatName}

DO NOT open this file! It may contain malware.`;
        }

        // Ambiguous result
        return `⚠️ Scan completed with warnings

📄 File: ${filename}
📦 Size: ${fileSizeKB} KB
🛡️ Scanner: ClamAV
📋 Output: ${stdout.substring(0, 200)}

Exercise caution with this file.`;

      } catch (scanError: any) {
        // Exit code 1 means virus found
        if (scanError.code === 1 && scanError.stdout?.includes('FOUND')) {
          const threatMatch = scanError.stdout.match(/: (.+) FOUND/);
          const threatName = threatMatch ? threatMatch[1] : 'Unknown threat';

          return `🚨 THREAT DETECTED!

📄 File: ${filename}
📦 Size: ${fileSizeKB} KB
🛡️ Scanner: ClamAV
⚠️ Threat: ${threatName}

DO NOT open this file! It may contain malware.`;
        }

        // ClamAV not installed or other error
        if (scanError.message?.includes('not found') || scanError.code === 127) {
          return `⚠️ ClamAV not available

The virus scanner (ClamAV) is not installed on this system.
Unable to scan: ${filename}

Consider installing ClamAV for file scanning capabilities.`;
        }

        throw scanError;
      }

    } catch (error) {
      console.error('Virus scan error:', error);
      return `❌ Scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !files / !search / !find - Search the IrregularChat file archive
   *
   * Searches files in the community shared archive directory.
   * Supports filename search, content grep, and smart AI-powered search.
   *
   * Usage:
   *   !files drone                - Search filenames for "drone"
   *   !files -g keyword          - Grep file contents for keyword
   *   !files -s query            - Smart search with AI keywords
   *   !files --cat Tech          - List files in Tech category
   *   !files --list              - List all categories
   */
  private async handleFileSearch(args: string, context: CommandContext): Promise<string> {
    // Parse flags
    const listFlag = args.includes('--list') || args.includes('-l');
    const categoryMatch = args.match(/--cat(?:egory)?\s+(\S+)/i) || args.match(/-c\s+(\S+)/i);
    const grepFlag = args.includes('-g') || args.includes('--grep');
    const smartFlag = args.includes('-s') || args.includes('--smart');

    // Remove flags from search query
    let query = args
      .replace(/--list|-l/gi, '')
      .replace(/--cat(?:egory)?\s+\S+/gi, '')
      .replace(/-c\s+\S+/gi, '')
      .replace(/-g|--grep/gi, '')
      .replace(/-s|--smart/gi, '')
      .trim();

    // List categories
    if (listFlag) {
      try {
        const categories = await listFileCategories();
        if (categories.length === 0) {
          return '📁 No categories found in archive.';
        }

        const lines = [
          '📁 Archive Categories:',
          '',
          ...categories.map(c => `  • ${c}`),
          '',
          'Use !files --cat <name> to browse a category',
          'Use !files <query> to search all files',
        ];
        return lines.join('\n');
      } catch (error) {
        return `❌ Failed to list categories: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    // Browse category
    if (categoryMatch) {
      const category = categoryMatch[1];
      try {
        const files = await getFilesInCategory(category, 20);
        if (files.length === 0) {
          return `📁 No files found in "${category}"`;
        }

        const lines = [
          `📁 Files in ${category}:`,
          '',
        ];

        for (const file of files.slice(0, 10)) {
          const size = this.formatFileSizeShort(file.size);
          const date = file.modified.toISOString().split('T')[0];
          lines.push(`  • ${file.name} (${size}, ${date})`);
        }

        if (files.length > 10) {
          lines.push(`  ... and ${files.length - 10} more files`);
        }

        lines.push('', `📂 Browse: ${getPCloudUrl(category, true)}`);

        return lines.join('\n');
      } catch (error) {
        return `❌ Failed to list category: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }
    }

    // Need a search query for other operations
    if (!query) {
      return `🔍 File Search - Search the IrregularChat archive

Usage:
  !files <query>         - Search filenames
  !files -g <keyword>    - Search file contents (grep)
  !files -s <query>      - Smart AI-powered search
  !files --cat <name>    - Browse a category
  !files --list          - List all categories

Examples:
  !files drone           - Find files with "drone" in name
  !files -g FPV manual   - Find content mentioning "FPV manual"
  !files -s UAV tactics  - Smart search with AI synonyms`;
    }

    try {
      // Get context ID for session tracking (group or sender)
      const contextId = context.groupId || context.sourceNumber || context.sourceUuid;

      // Smart search with AI keywords
      if (smartFlag && this.openai) {
        console.log(`🔍 Smart file search: "${query}"`);
        const { filenameResults, contentResults, keywords } = await smartSearch(
          this.openai,
          query,
          20
        );

        const result = formatSearchResults(filenameResults, contentResults, contextId);

        const lines: string[] = [];
        if (keywords.length > 0) {
          lines.push(`🤖 Search expanded with: ${keywords.slice(0, 3).join(', ')}`);
          lines.push('');
        }
        lines.push(result.message);

        return lines.join('\n');
      }

      // Grep content search
      if (grepFlag) {
        console.log(`🔍 Grep file search: "${query}"`);
        const grepResults = await grepFiles(query, {
          maxMatches: 20,
          caseInsensitive: true,
        });

        if (grepResults.matches.length === 0) {
          return `🔍 No content matches found for "${query}"`;
        }

        // Use formatSearchResults for consistent formatting
        const emptyFileResults: SearchResult = {
          files: [],
          totalCount: 0,
          truncated: false,
          query,
          searchType: 'content',
        };

        const result = formatSearchResults(emptyFileResults, grepResults, contextId);
        return result.message;
      }

      // Basic filename search + directory search
      console.log(`🔍 Filename search: "${query}"`);
      const [results, matchingDirs] = await Promise.all([
        searchByFilename(query, 50),
        searchDirectories(query, 5),
      ]);

      const result = formatSearchResults(results, undefined, contextId);

      // Add matching directories to the output
      if (matchingDirs.length > 0) {
        const dirLines = [
          '',
          `📂 Matching folders:`,
          ...matchingDirs.map(d => `  • ${d.relativePath} → ${getPCloudUrl(d.relativePath, true)}`),
        ];
        return result.message + dirLines.join('\n');
      }

      return result.message;

    } catch (error) {
      console.error('File search error:', error);
      return `❌ Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !get - Get file links from a search session
   *
   * Usage:
   *   !get <sessionId> <numbers>  - Get links for files by number
   *   !get abc123 1,3,5           - Get files 1, 3, 5 from session abc123
   */
  private async handleFileGet(args: string, context: CommandContext): Promise<string> {
    const parts = args.trim().split(/\s+/);

    if (parts.length < 2) {
      return `❌ Usage: !get <sessionId> <number(s)>

Example: !get abc123 1,3,5

Reply to a !files search result with the session ID and file numbers.`;
    }

    const sessionId = parts[0];
    const numbersPart = parts.slice(1).join(',');

    // Parse numbers (support "1,2,3" or "1 2 3" or "1, 2, 3")
    const numbers = numbersPart
      .split(/[\s,]+/)
      .map(n => parseInt(n.trim(), 10))
      .filter(n => !isNaN(n) && n > 0);

    if (numbers.length === 0) {
      return '❌ Please provide valid file numbers (e.g., 1,3,5)';
    }

    const session = getSearchSession(sessionId);
    if (!session) {
      return `❌ Search session "${sessionId}" not found or expired.

Sessions last 10 minutes. Run a new search with !files`;
    }

    const lines: string[] = [];
    lines.push(`📁 Files from search "${session.query}":`);
    lines.push('');

    for (const num of numbers) {
      const file = getFileFromSession(sessionId, num);
      if (file) {
        const url = getPCloudUrl(file.relativePath);
        lines.push(`${num}. ${file.name}`);
        lines.push(`   ${file.category} • ${this.formatFileSizeShort(file.size)}`);
        lines.push(`   ${url}`);
        lines.push('');
      } else {
        lines.push(`${num}. (not found - out of range)`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Helper to get file links from a session (used by both !get and bare number replies)
   * Now async to fetch direct download links from pCloud API
   */
  private async handleFileGetFromSession(sessionId: string, numbers: number[]): Promise<string> {
    const session = getSearchSession(sessionId);
    if (!session) {
      return `❌ Search session expired. Run a new search with !files`;
    }

    const lines: string[] = [];
    lines.push(`📁 Files from search "${session.query}":`);
    lines.push('');

    for (const num of numbers) {
      const file = getFileFromSession(sessionId, num);
      if (file) {
        // Try to get a direct download link
        const linkResult = await getDirectDownloadLink(file.relativePath);
        const url = linkResult.success && linkResult.link
          ? linkResult.link
          : getPCloudUrl(file.relativePath); // Fallback to browse URL

        lines.push(`${num}. ${file.name}`);
        lines.push(`   ${file.category} • ${this.formatFileSizeShort(file.size)}`);
        lines.push(`   ${url}`);
        lines.push('');
      } else {
        lines.push(`${num}. (not found - max is ${session.files.length})`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Handle "tldr <number>" - Summarize a PDF from search session
   */
  private async handleTldrFromSession(
    sessionId: string,
    fileNum: number,
    context: CommandContext
  ): Promise<string> {
    const session = getSearchSession(sessionId);
    if (!session) {
      return `❌ Search session expired. Run a new search with !files`;
    }

    const file = getFileFromSession(sessionId, fileNum);
    if (!file) {
      return `❌ File #${fileNum} not found (max is ${session.files.length})`;
    }

    // Check if it's a PDF
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return `❌ File #${fileNum} (${file.name}) is not a PDF. TLDR only works on PDFs.`;
    }

    if (!this.openai) {
      return '❌ OpenAI not configured. Cannot summarize PDFs.';
    }

    try {
      // Scrape and summarize the PDF
      console.log(`📄 TLDR summarizing PDF: ${file.path}`);

      const pdfResult = await scrapePdfFromPath(file.path, file.name);

      if (!pdfResult.success || !pdfResult.content || pdfResult.content.length < 50) {
        return `❌ Could not extract text from ${file.name}. PDF may be image-based or corrupted.`;
      }

      // Truncate if too long
      const maxChars = 15000;
      const truncatedContent = pdfResult.content.length > maxChars
        ? pdfResult.content.substring(0, maxChars) + '\n[...truncated...]'
        : pdfResult.content;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a concise summarizer. Provide a clear TLDR summary of the document.
Format:
📄 **Title**: [document title if found]
📋 **Summary**: 2-3 sentences capturing the key points
🎯 **Key Points**: 3-5 bullet points with the most important information`,
          },
          {
            role: 'user',
            content: `Summarize this document:\n\n${truncatedContent}`,
          },
        ],
        max_tokens: 500,
        temperature: 0.3,
      });

      const summary = response.choices[0]?.message?.content || 'Unable to generate summary';
      const url = getPCloudUrl(file.relativePath);

      return `📄 TLDR: ${file.name}\n\n${summary}\n\n📂 Link: ${url}`;

    } catch (error) {
      console.error('TLDR error:', error);
      return `❌ Failed to summarize: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Format file size for compact display
   */
  private formatFileSizeShort(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
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
   * !meme / !gif - Post a random meme or specific meme
   *
   * Usage:
   *   !meme       - Random meme
   *   !meme list  - Show available memes
   *   !meme potato - Post specific meme
   *
   * Returns: Object with text and attachment path for Signal to send
   */
  private async handleMeme(args: string, context: CommandContext): Promise<string | { text: string; attachment?: string }> {
    const subCommand = args.trim().toLowerCase();

    // List available memes
    if (subCommand === 'list' || subCommand === 'help') {
      const memes = listMemes();
      const stats = getMemeStats();
      const lines = [
        '🎭 Available Memes:',
        '',
        ...memes.map(m => `  • ${m.id} - ${m.description}`),
        '',
        `Total: ${stats.total} | Available: ${stats.available}`,
        '',
        'Usage: !meme <name> or !meme for random',
      ];
      return lines.join('\n');
    }

    // Get specific or random meme
    let meme: MemeDefinition | undefined;
    if (subCommand) {
      meme = getMemeById(subCommand);
      if (!meme) {
        // Try fuzzy match
        const memes = listMemes();
        meme = memes.find(m =>
          m.id.includes(subCommand) ||
          m.description.toLowerCase().includes(subCommand) ||
          m.triggers.some(t => t.includes(subCommand))
        );
      }
      if (!meme) {
        return `❌ Meme "${subCommand}" not found. Use !meme list to see available memes.`;
      }
    } else {
      meme = getRandomMeme();
    }

    // Check if file exists
    const filePath = getMemeFilePath(meme);
    const exists = await memeFileExists(meme);

    if (!exists) {
      console.error(`Meme file not found: ${filePath}`);
      return `❌ Meme file not found. Please contact admin.`;
    }

    // Return with attachment only (no text caption)
    return {
      text: '',
      attachment: filePath,
    };
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
   * !dichos - Spanish proverbs (dichos)
   * Cycles through traditional Spanish sayings from Refranero Mexicano
   */
  private async handleDichos(): Promise<string> {
    const dicho = getNextDicho();
    const total = getDichosCount();
    return this.formatForSignal(formatDicho(dicho));
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
          // NEVER use phone_number as name - privacy concern
          senderName = row.display_name || row.profile_name ||
                      (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name) ||
                      senderName;
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
            // NEVER use phone_number as name - privacy concern
            userName = row.display_name || row.profile_name ||
                      (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name) ||
                      userName;
          }
        } catch (error) {
          // Database lookup failed, continue with fallbacks
          console.log('Could not look up member name:', error);
        }
      }

      // Fallback: Shortened UUID (NEVER use phone number - privacy concern)
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
      // Step 1: Use hybrid search (keyword + semantic) if embeddings available
      console.log(`🤖 WikiAsk: "${question}"`);

      let articleUrls: string[] = [];
      let searchMethod = 'keyword';

      // Try hybrid search if wiki embeddings are enabled
      if (this.wikiEmbeddings?.isEnabled()) {
        try {
          // Get keyword results
          const keywordResults = await getKeywordResultsForHybrid(question, 10);

          // Run hybrid search
          const hybridResults = await this.wikiEmbeddings.hybridSearch(keywordResults, question, 5);

          if (hybridResults.length > 0) {
            // Get articles from hybrid results
            const wikiIndex = await getWikiIndex();
            const articleMap = new Map(wikiIndex.map(a => [a.filePath, a]));

            articleUrls = hybridResults
              .map(r => articleMap.get(r.filePath)?.url)
              .filter((url): url is string => !!url);

            searchMethod = 'hybrid';
            console.log(`📚 Hybrid search: ${hybridResults.length} results (${hybridResults.filter(r => r.source === 'both').length} from both)`);
          }
        } catch (error) {
          console.error('Hybrid search failed, falling back to keyword:', error);
        }
      }

      // Fallback to keyword-only search
      if (articleUrls.length === 0) {
        const queries = generateSearchQueries(question);
        const searchResults = await parallelSearch(queries, 5);
        articleUrls = searchResults.slice(0, 3).map(r => r.article.url);
        searchMethod = 'keyword';
      }

      if (articleUrls.length === 0) {
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

      // Step 2: Fetch content from top articles
      console.log(`📄 Fetching ${articleUrls.length} wiki articles for context...`);
      const articles = await fetchArticles(articleUrls);

      // Step 3: Build context from wiki articles with better formatting
      let wikiContext = '';
      const sources: string[] = [];

      for (const article of articles) {
        // Use full excerpt for better context
        wikiContext += `\n\n=== ARTICLE: ${article.title} ===\n${article.excerpt}`;
        sources.push(`• ${article.title}: ${article.url}`);
      }

      // Step 4: Ask AI with wiki context - improved prompt engineering
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a knowledgeable assistant for the IrregularChat community wiki (Irregularpedia).
Your role is to answer questions using the wiki content provided.

INSTRUCTIONS:
1. Answer based ONLY on the wiki content when relevant information exists
2. Be helpful and provide actionable information
3. If the wiki has related content but doesn't directly answer, explain what's available and suggest next steps
4. If no relevant content exists, say so clearly and offer general guidance
5. Keep answers concise but complete (2-4 paragraphs max)
6. Use bullet points for lists when appropriate
7. Reference specific articles when helpful

WIKI CONTENT:${wikiContext}`,
          },
          {
            role: 'user',
            content: question,
          },
        ],
        max_tokens: 800,
        temperature: 0.5,  // Lower temperature for more factual responses
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
   * !wikiindex - Index all wiki articles for semantic search (admin only)
   */
  private async handleWikiIndex(context: CommandContext): Promise<string> {
    // Admin only
    if (!this.isAdmin(context.sourceNumber)) {
      return this.formatForSignal('❌ Admin only command');
    }

    if (!this.wikiEmbeddings) {
      return this.formatForSignal('❌ Wiki embeddings not initialized');
    }

    if (!this.wikiEmbeddings.isEnabled()) {
      return this.formatForSignal(
        '❌ Semantic search disabled\n\n' +
        'OpenAI API key required for embeddings.\n' +
        'Set OPENAI_API_KEY environment variable.'
      );
    }

    try {
      // Start indexing (this takes a while)
      // Send initial message (best effort - don't wait)
      if (this.bot && context.groupId) {
        this.bot.sendMessage({
          groupId: context.groupId,
          message: '📚 Starting wiki index... This may take a few minutes.',
        }).catch((err: Error) => console.error('Failed to send index start message:', err));
      }

      const result = await this.wikiEmbeddings.indexAllArticles();

      return this.formatForSignal(
        '✅ Wiki Index Complete\n\n' +
        `📊 Articles indexed: ${result.indexed}\n` +
        `❌ Errors: ${result.errors}\n\n` +
        'Semantic search now available via !wikiask'
      );
    } catch (error) {
      console.error('Error in handleWikiIndex:', error);
      return `❌ Index failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !wikistats - Show wiki embedding statistics
   */
  private async handleWikiStats(): Promise<string> {
    if (!this.wikiEmbeddings) {
      return this.formatForSignal('❌ Wiki embeddings not initialized');
    }

    try {
      const stats = await this.wikiEmbeddings.getStats();

      const lastIndexStr = stats.lastIndex
        ? new Date(stats.lastIndex).toLocaleDateString()
        : 'Never';

      return this.formatForSignal(
        '📊 Wiki Embedding Stats\n\n' +
        `📚 Articles indexed: ${stats.articlesIndexed}\n` +
        `🔢 Total embeddings: ${stats.totalEmbeddings}\n` +
        `📅 Last full index: ${lastIndexStr}\n` +
        `🔍 Semantic search: ${this.wikiEmbeddings.isEnabled() ? 'Enabled' : 'Disabled'}\n\n` +
        'Use !wikiindex to reindex (admin only)'
      );
    } catch (error) {
      console.error('Error in handleWikiStats:', error);
      return `❌ Failed to get stats: ${error instanceof Error ? error.message : 'Unknown error'}`;
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

    // Route to git repos handler if -git flag is set
    if (options.showGit) {
      return this.handleLinksGit(options, context);
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
    showGit?: boolean;
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

    // Parse -git (show git repositories instead of news)
    if (remaining.match(/-git\b/i)) {
      options.showGit = true;
      remaining = remaining.replace(/-git\b/i, '');
    }

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
   * Handle !links -git - Browse shared git repositories
   */
  private async handleLinksGit(options: {
    timePeriod?: string;
    keyword?: string;
    groupId?: string;
    limit?: number;
    currentGroupOnly?: boolean;
    noStats?: boolean;
  }, context: CommandContext): Promise<string> {
    if (!this.dbClient) {
      return this.formatForSignal('❌ Database not available');
    }

    try {
      // Build query for repository_links
      let sql = `
        SELECT r.url, r.platform, r.repository_name, r.owner, r.name, r.description,
               r.language, r.stars, r.forks, r.open_issues, r.license, r.topics,
               r.is_archived, r.is_fork, r.last_updated, r.post_count,
               r.first_posted_at, r.last_posted_at, r.posted_by_name,
               r.group_id, COALESCE(g.name, 'Unknown Group') as group_display_name
        FROM repository_links r
        LEFT JOIN signal_groups g ON r.group_id = g.id
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIndex = 1;

      // Filter by group if specified
      if (options.groupId) {
        sql += ` AND r.group_id = $${paramIndex++}`;
        params.push(options.groupId);
      }

      // Current group only
      if (options.currentGroupOnly && context.groupId) {
        sql += ` AND r.group_id = $${paramIndex++}`;
        params.push(context.groupId);
      }

      // Time period filter
      if (options.timePeriod) {
        const cutoff = this.calculateTimeCutoff(options.timePeriod);
        if (cutoff) {
          sql += ` AND r.first_posted_at >= $${paramIndex++}`;
          params.push(cutoff.toISOString());
        }
      }

      // Keyword search in repo name, owner, or description
      if (options.keyword) {
        sql += ` AND (r.repository_name ILIKE $${paramIndex++} OR r.owner ILIKE $${paramIndex++} OR r.description ILIKE $${paramIndex++})`;
        params.push(`%${options.keyword}%`, `%${options.keyword}%`, `%${options.keyword}%`);
      }

      // Order by stars (most popular first), then by most recently posted
      sql += ` ORDER BY r.stars DESC, r.last_posted_at DESC LIMIT $${paramIndex++}`;
      const limit = Math.min(options.limit || 15, 30);
      params.push(limit);

      // Execute query
      const result = await this.dbClient.query(sql, params);
      const repos = result.results || [];

      if (repos.length === 0) {
        let noResultsMsg = '📭 No repositories found';
        if (options.timePeriod) noResultsMsg += ` in last ${options.timePeriod}`;
        if (options.keyword) noResultsMsg += ` matching "${options.keyword}"`;
        return this.formatForSignal(noResultsMsg);
      }

      // Group repos by Signal group
      const reposByGroup = new Map<string, any[]>();
      const languageCounts = new Map<string, number>();
      let totalStars = 0;

      for (const repo of repos) {
        const groupKey = repo.group_display_name || 'Unknown Group';
        if (!reposByGroup.has(groupKey)) {
          reposByGroup.set(groupKey, []);
        }
        reposByGroup.get(groupKey)!.push(repo);

        // Track language statistics
        const lang = repo.language || 'Unknown';
        languageCounts.set(lang, (languageCounts.get(lang) || 0) + 1);
        totalStars += repo.stars || 0;
      }

      // Build response
      let response = `🐙 Git Repositories (${repos.length})\n\n`;

      for (const [groupName, groupRepos] of reposByGroup) {
        response += `📁 ${groupName}\n`;

        for (const repo of groupRepos) {
          try {
            // Format date
            const dateObj = repo.last_posted_at ? new Date(repo.last_posted_at) : null;
            const date = dateObj && !isNaN(dateObj.getTime())
              ? dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : '?';

            // Repo name with stats
            const name = repo.repository_name || `${repo.owner}/${repo.name}`;
            const stars = repo.stars > 0 ? `⭐${this.formatCompactNumber(repo.stars)}` : '';
            const shares = repo.post_count > 1 ? `(${repo.post_count}x)` : '';
            const lang = repo.language ? `[${repo.language}]` : '';
            const archived = repo.is_archived ? '🗄️' : '';
            const fork = repo.is_fork ? '🍴' : '';

            response += `• ${name} ${stars} ${lang}${archived}${fork}${shares}\n`;

            // Description (truncated)
            if (repo.description) {
              response += `  ${this.truncate(repo.description, 60)}\n`;
            }

            response += `  ${date} • ${repo.url}\n\n`;
          } catch (repoError) {
            console.warn('Skipping malformed repo entry:', repoError);
            continue;
          }
        }
      }

      // Language Statistics (compact)
      if (languageCounts.size > 1 && !options.noStats) {
        response += '💻 ';
        const sortedLangs = Array.from(languageCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4);
        response += sortedLangs.map(([l, c]) => `${l}(${c})`).join(' • ');
        response += '\n';
      }

      // Footer
      response += `\n⭐ Total: ${this.formatCompactNumber(totalStars)} stars`;

      return this.formatForSignal(response);
    } catch (error) {
      console.error('Error in handleLinksGit:', error);
      return this.formatForSignal('❌ Error searching repositories');
    }
  }

  /**
   * Format number compactly (1K, 1.5M, etc.)
   */
  private formatCompactNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return num.toString();
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
      '📰 !links - Browse Shared Links\n\n' +
      'Shows recent news articles or git repositories.\n\n' +
      'Usage: !links [options] [search]\n\n' +
      'Mode:\n' +
      '  (default)   News articles\n' +
      '  -git        Git repositories (GitHub/GitLab)\n\n' +
      'URL Options (news only):\n' +
      '  -f          Show forum discussion URL\n' +
      '  -a          Show archive.org URL\n\n' +
      'Filters:\n' +
      '  -c          This group only\n' +
      '  -t <time>   Time period (24h, 7d, 1w)\n' +
      '  -d <domain> Filter by domain (news)\n' +
      '  -n <count>  Results (max 30)\n\n' +
      'Examples:\n' +
      '  !links           Recent news\n' +
      '  !links -git      Recent repos\n' +
      '  !links -git rust Search repos\n' +
      '  !links -t 7d     News last 7 days\n' +
      '  !links ukraine   Search news'
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

    // Determine user identifier: either from mention OR from quoted message author
    let userPhone: string | undefined;

    // Priority 1: Use mention if provided
    if (context.mentions && context.mentions.length > 0) {
      const mention = context.mentions[0];
      userPhone = mention.uuid || mention.number;
      console.log(`📋 GTG: User identified via mention: ${userPhone}`);
    }
    // Priority 2: If replying to a message, use the quoted message's author
    else if (context.quotedAuthor) {
      userPhone = context.quotedAuthor;
      console.log(`📋 GTG: User identified via quoted message author: ${userPhone}`);
    }

    if (!userPhone) {
      return '❌ Please either:\n• Reply to user\'s intro message with !gtg\n• Or mention the user: !gtg @user';
    }

    try {
      // ========================================
      // STEP 1: Parse intro from quoted message or user's recent messages
      // ========================================
      let introText = '';
      let parsedIntro: ReturnType<typeof parseIntroduction> | null = null;

      // Priority 1: Check if admin replied to an intro message (quotedText)
      if (context.quotedText && context.quotedText.trim().length > 0) {
        introText = context.quotedText;
        console.log(`📋 Found quoted message (${introText.length} chars) - checking if it's an intro`);

        if (isIntroMessage(introText)) {
          parsedIntro = parseIntroduction(introText);
          console.log(`📋 Parsed intro from quoted message: ${formatIntroSummary(parsedIntro)}`);
        }
      }

      // Priority 2: If no quoted intro, try to find intro from user's recent messages
      if (!parsedIntro?.isValidIntro && context.groupId) {
        try {
          const recentMessages = await this.dbClient.getRecentMessages(context.groupId, 50);
          const userMessages = recentMessages
            .filter((msg: any) => msg.source_number === userPhone || msg.source_uuid === userPhone)
            .slice(0, 10); // Get up to 10 recent messages from user

          // Look for a message that looks like an intro
          for (const msg of userMessages) {
            const msgText = msg.message || '';
            if (isIntroMessage(msgText)) {
              introText = msgText;
              parsedIntro = parseIntroduction(msgText);
              console.log(`📋 Found intro in user's message history: ${formatIntroSummary(parsedIntro)}`);
              break;
            }
          }

          // If no intro found, use combined text for group recommendations
          if (!parsedIntro?.isValidIntro) {
            introText = userMessages
              .map((msg: any) => msg.message || '')
              .filter((m: string) => m.trim().length > 0)
              .join(' ');
            console.log(`📋 No intro format found, using ${introText.length} chars for keyword analysis`);
          }
        } catch (error) {
          console.error('Error fetching user messages:', error);
        }
      }

      // ========================================
      // STEP 1.5: Fallback email extraction from raw text
      // ========================================
      // If parseIntroduction didn't find an email but we have intro text,
      // try to extract the first email directly from the text
      if (!parsedIntro?.email && introText) {
        const fallbackEmail = extractEmailFromText(introText);
        if (fallbackEmail) {
          console.log(`📋 Fallback email extraction found: ${fallbackEmail}`);
          // Create or update parsedIntro with the extracted email
          if (!parsedIntro) {
            parsedIntro = { isValidIntro: false };
          }
          parsedIntro.email = fallbackEmail;
          // Try to extract first name from the text if we don't have one
          if (!parsedIntro.firstName) {
            // Look for a name pattern at the start of a numbered line
            const nameMatch = introText.match(/(?:^|\n)\s*1[\.\-\)\:]\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)/);
            if (nameMatch) {
              const nameParts = nameMatch[1].split(' ');
              parsedIntro.firstName = nameParts[0];
              parsedIntro.lastName = nameParts.slice(1).join(' ');
              parsedIntro.fullName = nameMatch[1];
              console.log(`📋 Extracted name from text: ${parsedIntro.fullName}`);
            }
          }
          // Mark as valid for SSO creation if we have email
          parsedIntro.isValidIntro = true;
        }
      }

      // ========================================
      // STEP 2: Create SSO account if intro has valid email
      // ========================================
      let ssoAccountCreated = false;
      let ssoUsername = '';
      let ssoError = '';

      if (parsedIntro?.isValidIntro && parsedIntro.email && authentikClient.isConfigured()) {
        console.log(`🔐 Creating SSO account for ${parsedIntro.firstName} (${parsedIntro.email})`);

        try {
          // Generate unique username
          const username = await authentikClient.generateUsername(parsedIntro.firstName || 'user');

          // Create user in Authentik
          const result = await authentikClient.createUser({
            username,
            email: parsedIntro.email,
            firstName: parsedIntro.firstName || '',
            lastName: parsedIntro.lastName || '',
          });

          if (result.success && result.temp_password) {
            ssoAccountCreated = true;
            ssoUsername = result.username || username;

            // Send credentials DM to the user
            const credentialsMessage = generateWelcomeMessage(ssoUsername, result.temp_password);

            if (this.bot) {
              await this.bot.sendMessage({
                recipient: userPhone,
                message: credentialsMessage,
              });
              console.log(`📨 SSO credentials sent to user: ${userPhone}`);
            }
          } else {
            ssoError = result.error || 'Unknown error';
            console.error(`❌ Failed to create SSO account: ${ssoError}`);
          }
        } catch (error) {
          ssoError = error instanceof Error ? error.message : 'Unknown error';
          console.error('❌ Error creating SSO account:', error);
        }
      } else if (parsedIntro?.isValidIntro && !parsedIntro.email) {
        console.log('📋 Valid intro but no email found - skipping SSO account creation');
      } else if (!authentikClient.isConfigured()) {
        console.log('📋 Authentik not configured - skipping SSO account creation');
      }

      // ========================================
      // STEP 3: Send GTG welcome message (if SSO not sent)
      // ========================================
      // Only send generic GTG message if SSO credentials weren't sent
      // (SSO welcome message already includes instructions)
      if (!ssoAccountCreated && this.bot) {
        const gtgMessage =
          'Good to go. Thanks for verifying. This is how we keep the community safe.\n' +
          '1. Please leave this chat\n' +
          '2. You\'ll receive a direct message with your IrregularChat Login and a Link to all the chats.\n' +
          '3. Join all the Chats that interest you when you get your login\n' +
          '4. Until then, Learn about the community https://forum.irregularchat.com/t/irregularchat-forum-start-here-faqs/84\n' +
          'See you out there!';

        await this.bot.sendMessage({
          recipient: userPhone,
          message: gtgMessage,
        });
      }

      // ========================================
      // STEP 4: Add user to recommended groups
      // ========================================
      const recommendedGroups = await this.getRecommendedGroups(introText);

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

      // ========================================
      // STEP 5: Build response
      // ========================================
      const response = ['✅ User Approved (GTG)', ''];

      // Include parsed intro info if available
      if (parsedIntro?.isValidIntro) {
        response.push(`👤 ${parsedIntro.fullName || parsedIntro.firstName}`);
        if (parsedIntro.email) response.push(`📧 ${parsedIntro.email}`);
        if (parsedIntro.organization) response.push(`🏢 ${parsedIntro.organization}`);
        response.push('');
      }

      // SSO account status
      if (ssoAccountCreated) {
        response.push(`🔐 SSO Account Created: ${ssoUsername}`);
        response.push('📨 Credentials sent to user via DM');
      } else if (parsedIntro?.email && ssoError) {
        response.push(`⚠️ SSO creation failed: ${ssoError}`);
        response.push('📨 Sent generic welcome message');
      } else if (!parsedIntro?.email) {
        response.push('ℹ️ No email in intro - manual SSO setup needed');
        response.push('📨 Sent generic welcome message');
      } else {
        response.push('📨 Sent welcome message');
      }

      response.push('');
      response.push('📱 Group Additions:');

      if (addedGroups.length > 0) {
        response.push(`✅ Added to ${addedGroups.length} group(s):`);
        addedGroups.forEach(g => response.push(`   • ${g}`));
      }

      if (failedGroups.length > 0) {
        response.push('');
        response.push(`⚠️  Failed to add to ${failedGroups.length} group(s):`);
        failedGroups.forEach(g => response.push(`   • ${g}`));
      }

      // ========================================
      // STEP 6: Remove user from entry room
      // ========================================
      // If the command was issued in a group (entry room), remove the user from it
      let removedFromEntry = false;
      if (context.groupId && this.bot) {
        try {
          console.log(`🚪 Removing user ${userPhone} from entry room ${context.groupId}`);
          await this.bot.updateGroup({
            groupId: context.groupId,
            removeMember: [userPhone],
          });
          removedFromEntry = true;
          console.log(`✅ User removed from entry room`);
        } catch (error) {
          console.error('Failed to remove user from entry room:', error);
          // Don't fail the whole operation - this is a nice-to-have
        }
      }

      if (removedFromEntry) {
        response.push('');
        response.push('🚪 Removed from entry room');
      }

      return this.formatForSignal(response.join('\n'));
    } catch (error) {
      console.error('Error in handleGtg:', error);
      return `❌ Failed to process GTG: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !remove - Remove user(s) from ALL groups (admin only)
   *
   * Used when a user fails to verify their safety number after it changed.
   * Posts a notification to each group before removing them.
   * Requires confirmation to prevent accidental removals.
   *
   * Usage:
   *   !remove @user           - Preview which groups they'll be removed from
   *   !remove @user confirm   - Actually remove them after reviewing preview
   */
  private async handleRemove(args: string, context: CommandContext): Promise<string> {
    const isUserAdmin = await this.isAdmin(context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
      return '❌ Admin-only command';
    }

    if (!context.mentions || context.mentions.length === 0) {
      return '❌ Please mention a user\n\nUsage:\n  !remove @user         - Preview groups\n  !remove @user confirm - Execute removal';
    }

    // Check if confirmation was provided
    const hasConfirm = args.toLowerCase().includes('confirm');

    // Get all groups the bot is in (fetch once for all users)
    const allGroups = await this.bot?.getGroups() || [];

    // Process each mentioned user
    const allResults: string[] = [];
    const allPreviews: string[] = [];

    for (const mention of context.mentions) {
      const userIdentifier = mention.uuid || mention.number;

      if (!userIdentifier) {
        allResults.push(`⚠️ Could not resolve one mentioned user - skipping`);
        continue;
      }

      // Try to get user's display name from database
      // NEVER use phone numbers or raw identifiers in public messages - privacy concern
      let userDisplayName = 'a member';  // Safe default that doesn't reveal identity
      if (this.dbClient) {
        try {
          const result = await this.dbClient.query(
            'SELECT display_name, profile_name, first_name, last_name FROM signal_members WHERE uuid = $1 OR phone_number = $1 LIMIT 1',
            [userIdentifier]
          );
          if (result.results && result.results.length > 0) {
            const row = result.results[0];
            // NEVER use phone_number as name - privacy concern
            const foundName = row.display_name || row.profile_name ||
                             (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name);
            if (foundName) {
              userDisplayName = foundName;
            }
          }
        } catch (error) {
          console.error('Error looking up user display name:', error);
        }
      }

      try {
        // Find all groups where this user is a member
        const userGroups: Array<{ groupId: string; name: string; botIsAdmin: boolean }> = [];

        for (const group of allGroups) {
          if (!group.members || !Array.isArray(group.members)) continue;

          const isMember = group.members.some((m: any) => {
            const memberId = typeof m === 'string' ? m : (m?.uuid || m?.number);
            return memberId === userIdentifier;
          });

          if (isMember && group.id) {
            const isBotAdmin = await this.isBotAdminAsync(group);
            userGroups.push({
              groupId: group.id,
              name: group.name || 'Unknown Group',
              botIsAdmin: isBotAdmin,
            });
          }
        }

        if (userGroups.length === 0) {
          allResults.push(`⚠️ ${userDisplayName}: Not found in any groups`);
          allPreviews.push(`⚠️ ${userDisplayName}: Not found in any groups`);
          continue;
        }

        // PREVIEW MODE - Show which groups they'll be removed from
        if (!hasConfirm) {
          const canRemove = userGroups.filter(g => g.botIsAdmin);
          const cantRemove = userGroups.filter(g => !g.botIsAdmin);

          allPreviews.push(`👤 ${userDisplayName} is in ${userGroups.length} group(s):`);
          allPreviews.push('');

          if (canRemove.length > 0) {
            allPreviews.push(`✅ Will be removed from (${canRemove.length}):`);
            canRemove.forEach((g, i) => {
              allPreviews.push(`   ${i + 1}. ${g.name}`);
            });
          }

          if (cantRemove.length > 0) {
            allPreviews.push('');
            allPreviews.push(`⚠️ Cannot remove from (bot not admin):`);
            cantRemove.forEach((g, i) => {
              allPreviews.push(`   ${i + 1}. ${g.name}`);
            });
          }

          continue;
        }

        // EXECUTE MODE - Actually remove the user
        const removalMessage =
          `⚠️ ${userDisplayName} is being removed for not verifying themselves after their safety number changed.\n\n` +
          `This is done to maintain the integrity of the community. This could mean the number was assigned to a different person or their SIM was put into a different device.\n\n` +
          `They are welcome to request to join anytime but will need to be verified by knowing someone in the community and providing their name and organization.`;

        const removedFrom: string[] = [];
        const failedRemovals: string[] = [];

        // Process each group for this user
        for (const group of userGroups) {
          try {
            if (!group.botIsAdmin) {
              failedRemovals.push(`${group.name} (bot not admin)`);
              continue;
            }

            // First, send the removal notice to the group
            if (this.bot) {
              await this.bot.sendMessage({
                groupId: group.groupId,
                message: removalMessage,
              });
            }

            // Small delay to ensure message is sent before removal
            await new Promise(resolve => setTimeout(resolve, 500));

            // Then remove the user from the group
            if (this.bot) {
              await this.bot.updateGroup({
                groupId: group.groupId,
                removeMember: [userIdentifier],
              });
            }

            removedFrom.push(group.name);
            console.log(`✅ Removed ${userDisplayName} from ${group.name}`);
          } catch (error) {
            console.error(`Failed to remove ${userDisplayName} from ${group.name}:`, error);
            failedRemovals.push(`${group.name} (${error instanceof Error ? error.message : 'error'})`);
          }
        }

        // Build result for this user
        if (removedFrom.length > 0) {
          allResults.push(`✅ ${userDisplayName}: Removed from ${removedFrom.length} group(s)`);
        }
        if (failedRemovals.length > 0) {
          allResults.push(`⚠️ ${userDisplayName}: Failed for ${failedRemovals.length} group(s)`);
        }

      } catch (error) {
        console.error(`Error processing removal for ${userDisplayName}:`, error);
        allResults.push(`❌ ${userDisplayName}: Error - ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }

    // PREVIEW RESPONSE
    if (!hasConfirm) {
      const response = [
        '⚠️ REMOVAL PREVIEW',
        '',
        ...allPreviews,
        '',
        '────────────────',
        '⚠️ This is a DESTRUCTIVE action!',
        '',
        'To confirm removal, run:',
        '  !remove @user confirm',
      ];
      return this.formatForSignal(response.join('\n'));
    }

    // EXECUTION RESPONSE
    const response = [
      '🚫 User Removal Complete',
      '',
      `Users processed: ${context.mentions.length}`,
      `Reason: Safety number verification failure`,
      '',
      '📋 Results:',
      ...allResults,
      '',
      '📝 Removal notices were posted to each group before removal.',
    ];

    return this.formatForSignal(response.join('\n'));
  }

  /**
   * !clearroom - Remove all non-admin members from the current group (admin only)
   *
   * Designed for Entry/INDOC room cleanup. Protected users (from Admin group, bot admins,
   * and Signal group admins) are NEVER removed.
   *
   * Usage:
   *   !clearroom         - Show preview of who will be removed
   *   !clearroom confirm - Actually remove members after reviewing preview
   */
  private async handleClearRoom(args: string, context: CommandContext): Promise<string> {
    // 1. Admin check
    const isUserAdmin = await this.isAdmin(context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
      return '❌ Admin-only command';
    }

    // 2. Must be in a group
    if (!context.groupId) {
      return '❌ This command must be used in a group chat';
    }

    const isConfirmed = args.trim().toLowerCase() === 'confirm';

    try {
      // 3. Sync with server and get fresh group data
      console.log('🔄 Syncing with Signal servers before clearroom...');
      await this.bot?.syncWithServer(1);

      // 4. Get the current group directly (bypasses cache for fresher data)
      let currentGroup = await this.bot?.getGroupDirect(context.groupId);

      // Fall back to cached groups if direct fetch fails
      if (!currentGroup) {
        console.log('⚠️ Direct fetch failed, using cached groups');
        const allGroups = await this.bot?.getGroups(true) || [];
        currentGroup = allGroups.find((g: any) => g.id === context.groupId);
      }

      if (!currentGroup) {
        return '❌ Could not find current group information';
      }

      // Also get all groups for admin group lookup
      const allGroups = await this.bot?.getGroups() || [];

      // 4. Check if bot is admin in this group
      const isBotAdmin = await this.isBotAdminAsync(currentGroup);
      if (!isBotAdmin) {
        return '❌ Bot is not an admin in this group and cannot remove members';
      }

      // 5. Get members and admins
      const members: string[] = currentGroup.members || [];
      const signalAdmins: string[] = currentGroup.admins || [];

      if (members.length === 0) {
        return '❌ No members found in this group';
      }

      // 6. Build protected set: Signal group admins + Bot admins (ADMIN_UUIDS) + Admin group members
      //    This is DYNAMIC - queries the Admin group from Signal, not hardcoded!
      const protectedSet = new Set(signalAdmins);

      // Also protect bot admins from ADMIN_UUIDS environment variable
      const botAdminUuids = process.env.ADMIN_UUIDS?.split(',').map(u => u.trim()).filter(Boolean) || [];
      for (const uuid of botAdminUuids) {
        protectedSet.add(uuid);
      }

      // CRITICAL: Protect all members of the Admin group (by name pattern "**Admin**")
      // This queries the live Signal group - NOT hardcoded UUIDs
      const adminGroup = allGroups.find((g: any) =>
        g.name && g.name.toLowerCase().includes('admin') && g.name.includes('**')
      );
      const adminGroupMembers: string[] = adminGroup?.members || [];
      for (const uuid of adminGroupMembers) {
        protectedSet.add(uuid);
      }

      // Find non-protected members to remove
      const nonAdminMembers = members.filter((m: string) => !protectedSet.has(m));

      // Count how many protected members are ACTUALLY in this room (for accurate reporting)
      const protectedInRoom = members.filter((m: string) => protectedSet.has(m));
      const signalAdminsInRoom = members.filter((m: string) => signalAdmins.includes(m)).length;
      const botAdminsInRoom = members.filter((m: string) => botAdminUuids.includes(m)).length;
      const adminGroupInRoom = members.filter((m: string) => adminGroupMembers.includes(m)).length;

      console.log(`🛡️ Protected members in room: ${protectedInRoom.length} (Signal admins: ${signalAdminsInRoom}, Bot admins: ${botAdminsInRoom}, Admin group: ${adminGroupInRoom})`);
      console.log(`   Total room members: ${members.length}, To remove: ${nonAdminMembers.length}`);

      if (nonAdminMembers.length === 0) {
        return '✅ No non-admin members to remove. All members are already protected.';
      }

      // 7. Get display names from multiple sources
      // Priority order: Signal CLI database (2160+) > PostgreSQL > contacts > identities
      let displayNames = new Map<string, string>();
      let signalDbNames = new Map<string, string>();
      let contactNames = new Map<string, string>();
      let identityNames = new Map<string, string>();

      try {
        // PRIMARY SOURCE: Signal CLI's internal SQLite database (account.db)
        // This has 2160+ profile names vs ~123 in our PostgreSQL database
        signalDbNames = await this.bot?.getProfileNamesFromSignalDb() || new Map();
        console.log(`📋 Found ${signalDbNames.size} names from Signal CLI database (primary source)`);
      } catch (error) {
        console.error('Error fetching names from Signal CLI database:', error);
      }

      try {
        // SECONDARY SOURCE: PostgreSQL database (backup for any not in Signal CLI db)
        const rawDbNames = await this.dbClient.getMemberDisplayNamesByUuids(nonAdminMembers);
        // Filter out UUID-style names that were stored as fallbacks
        for (const [uuid, name] of rawDbNames) {
          if (name && !looksLikeUuid(name)) {
            displayNames.set(uuid, name);
          }
        }
        console.log(`📝 Found ${displayNames.size} actual names from PostgreSQL (filtered from ${rawDbNames.size})`);
      } catch (error) {
        console.error('Error fetching display names from database:', error);
      }

      try {
        // Also get names from Signal contacts
        contactNames = await this.bot?.getContactNames() || new Map();
        console.log(`📇 Found ${contactNames.size} names from Signal contacts`);
      } catch (error) {
        console.error('Error fetching contact names:', error);
      }

      try {
        // Also get names from Signal identities (users who have sent messages)
        identityNames = await this.bot?.getIdentityNames() || new Map();
        console.log(`🪪 Found ${identityNames.size} names from Signal identities`);
      } catch (error) {
        console.error('Error fetching identity names:', error);
      }

      // Start with Signal CLI database as the PRIMARY source (highest priority)
      for (const [uuid, name] of signalDbNames) {
        if (name && !looksLikeUuid(name)) {
          displayNames.set(uuid, name);
        }
      }

      // Merge contact names (fill in gaps not in Signal CLI db)
      for (const [uuid, name] of contactNames) {
        if (name && !looksLikeUuid(name) && !displayNames.has(uuid)) {
          displayNames.set(uuid, name);
        }
      }

      // Merge identity names (lowest priority)
      for (const [uuid, name] of identityNames) {
        if (name && !looksLikeUuid(name) && !displayNames.has(uuid)) {
          displayNames.set(uuid, name);
        }
      }
      console.log(`📋 Total display names available: ${displayNames.size}`);

      // 8. If not confirmed, show preview of who will be removed
      if (!isConfirmed) {
        let namesFound = 0;
        const memberList = nonAdminMembers.map(member => {
          // Handle both string UUIDs and member objects
          const uuid = typeof member === 'string' ? member : (member as any).uuid || String(member);
          const name = displayNames.get(uuid);
          if (name) {
            namesFound++;
            return `• ${name}`;
          } else {
            // Show shorter UUID prefix for unknown members
            return `• [${typeof uuid === 'string' ? uuid.substring(0, 6) : String(uuid).substring(0, 6)}]`;
          }
        });

        // Limit preview to first 20 members to avoid message being too long
        const MAX_PREVIEW = 20;
        const hasMore = memberList.length > MAX_PREVIEW;
        const displayList = memberList.slice(0, MAX_PREVIEW);
        if (hasMore) {
          displayList.push(`... and ${memberList.length - MAX_PREVIEW} more`);
        }

        // Sanity check: remove + protected should equal total
        const sanityCheck = nonAdminMembers.length + protectedInRoom.length;

        const response = [
          '⚠️ Clear Room - Preview',
          '',
          `📊 Members in local cache: ${members.length}`,
          `   (${namesFound}/${nonAdminMembers.length} names identified)`,
          `   ⚠️ Count may differ from actual - some may have already left`,
        ];

        response.push(
          '',
          `📋 ${nonAdminMembers.length} member${nonAdminMembers.length !== 1 ? 's' : ''} will be REMOVED:`,
          displayList.join('\n'),
          '',
          `🛡️ ${protectedInRoom.length} protected member${protectedInRoom.length !== 1 ? 's' : ''} will be KEPT`,
          `   (Signal admins: ${signalAdminsInRoom}, Bot admins: ${botAdminsInRoom}, Admin group: ${adminGroupInRoom})`,
          '',
          '⚠️ This action cannot be undone!',
          '',
          'To proceed, type: !clearroom confirm',
        );

        return this.formatForSignal(response.join('\n'));
      }

      // 9. CONFIRMED - Remove non-admin members in batches
      console.log(`🧹 Clearing room: Removing ${nonAdminMembers.length} non-admin members`);
      console.log(`   Total members: ${members.length}, Protected: ${protectedSet.size}`);

      const BATCH_SIZE = 10;
      let removedCount = 0;
      let failedCount = 0;
      const removedNames: string[] = [];
      const failedRemovals: string[] = [];

      for (let i = 0; i < nonAdminMembers.length; i += BATCH_SIZE) {
        const batch = nonAdminMembers.slice(i, i + BATCH_SIZE);

        for (const memberUuid of batch) {
          try {
            if (this.bot) {
              await this.bot.updateGroup({
                groupId: context.groupId,
                removeMember: [memberUuid],
              });
              removedCount++;
              const name = displayNames.get(memberUuid) || `[${memberUuid.substring(0, 6)}]`;
              removedNames.push(name);
              console.log(`✅ Removed member ${removedCount}/${nonAdminMembers.length}: ${name}`);
            }
          } catch (error) {
            failedCount++;
            const name = displayNames.get(memberUuid) || `[${memberUuid.substring(0, 6)}]`;
            failedRemovals.push(name);
            console.error(`Failed to remove member ${name}:`, error);
          }

          // Small delay between removals to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // 10. Build response
      const response = [
        '🧹 Room Cleared',
        '',
        `✅ Actually removed: ${removedCount} member${removedCount !== 1 ? 's' : ''}`,
        `🛡️ Protected: ${protectedInRoom.length} member${protectedInRoom.length !== 1 ? 's' : ''}`,
      ];

      if (failedCount > 0) {
        response.push(`📤 Already gone: ${failedCount} (stale cache entries)`);
      }

      return this.formatForSignal(response.join('\n'));

    } catch (error) {
      console.error('Error in clearroom:', error);
      return `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !createuser - Create SSO user in Authentik (admin only)
   *
   * Supports two formats:
   * 1. !createuser @user email@example.com - Uses mentioned user's Signal profile name
   * 2. !createuser email@example.com FirstName [LastName] - Manual name entry
   *
   * After creation:
   * - If @mention: DM with credentials sent to the mentioned user
   * - If no @mention: DM with credentials sent to the admin who ran the command
   *
   * SECURITY: Password is NEVER shown in group chat response
   */
  private async handleCreateUser(args: string, context: CommandContext): Promise<string> {
    // 1. Admin check
    const isUserAdmin = await this.isAdmin(context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
      return '❌ Admin-only command';
    }

    // 2. Check if Authentik is configured
    if (!authentikClient.isConfigured()) {
      return '❌ SSO service not configured\n\nRequired environment variables:\n• AUTHENTIK_BASE_URL\n• AUTHENTIK_API_TOKEN';
    }

    // 3. Parse arguments - supports multiple modes
    let email: string = '';
    let firstName: string = '';
    let lastName: string = '';
    let targetUserUuid: string | undefined;
    let organization: string | undefined;
    let parsedFromIntro = false;

    // MODE 1: Reply to intro message (parse intro for email/name, use quotedAuthor for target)
    if (context.quotedText && context.quotedAuthor && isIntroMessage(context.quotedText)) {
      const parsedIntro = parseIntroduction(context.quotedText);
      console.log(`📋 CreateUser: Parsing intro from quoted message: ${formatIntroSummary(parsedIntro)}`);

      if (parsedIntro.isValidIntro && parsedIntro.email) {
        email = parsedIntro.email;
        firstName = parsedIntro.firstName || 'User';
        lastName = parsedIntro.lastName || '';
        organization = parsedIntro.organization;
        targetUserUuid = context.quotedAuthor;
        parsedFromIntro = true;
        console.log(`📋 CreateUser: User identified via quoted message author: ${targetUserUuid}`);
      } else {
        return '❌ Could not parse intro message - no valid email found\n\nExpected format:\n1. Full Name\n2. Organization\n3. Who invited you\n4. Email';
      }
    }
    // MODE 2: @mention with email
    else if (context.mentions && context.mentions.length > 0) {
      // Format: !createuser @user email@example.com
      const mention = context.mentions[0];
      targetUserUuid = mention.uuid;

      // Get name from database
      if (targetUserUuid && this.dbClient) {
        try {
          const result = await this.dbClient.query(
            'SELECT display_name, profile_name, first_name, last_name FROM signal_members WHERE uuid = $1 LIMIT 1',
            [targetUserUuid]
          );
          if (result.results && result.results.length > 0) {
            const row = result.results[0];
            // Try to get first name from various fields
            firstName = row.first_name ||
              (row.profile_name ? row.profile_name.split(' ')[0] : '') ||
              (row.display_name ? row.display_name.split(' ')[0] : '') ||
              'User';
            lastName = row.last_name ||
              (row.profile_name ? row.profile_name.split(' ').slice(1).join(' ') : '') ||
              '';
          }
        } catch (error) {
          console.error('Error fetching user profile:', error);
        }
      }

      // Extract email from remaining args (remove mention text)
      const emailMatch = args.match(/[\w.-]+@[\w.-]+\.\w+/);
      if (!emailMatch) {
        return '❌ Email required\n\nUsage: !createuser @user email@example.com [FirstName LastName]';
      }
      email = emailMatch[0];

      // If no name from database, try to extract from args after the email
      // Format: !createuser @mention email@example.com FirstName LastName
      if (!firstName || firstName === 'User') {
        // Get text after the email
        const emailIndex = args.indexOf(email);
        if (emailIndex >= 0) {
          const afterEmail = args.substring(emailIndex + email.length).trim();
          if (afterEmail) {
            const nameParts = afterEmail.split(/\s+/).filter(p => p.length > 0);
            if (nameParts.length > 0) {
              firstName = nameParts[0];
              lastName = nameParts.slice(1).join(' ');
              console.log(`📋 CreateUser: Extracted name from args: ${firstName} ${lastName}`);
            }
          }
        }
      }

      // Final fallback
      if (!firstName) {
        firstName = 'User';
      }

    }
    // MODE 3: Manual entry: !createuser email FirstName [LastName]
    else if (args.trim()) {
      // Format: !createuser email@example.com FirstName [LastName]
      const parts = args.trim().split(/\s+/);
      if (parts.length < 2) {
        return '❌ Missing arguments\n\nUsage:\n• Reply to intro: !createuser (reply to user\'s intro message)\n• With mention: !createuser @user email@example.com\n• Manual: !createuser email@example.com FirstName [LastName]';
      }

      // First part should be email
      const emailMatch = parts[0].match(/[\w.-]+@[\w.-]+\.\w+/);
      if (emailMatch) {
        email = parts[0];
        firstName = parts[1] || 'User';
        lastName = parts.slice(2).join(' ');
      } else {
        // Email might be second - try to find it
        email = parts.find(p => p.includes('@')) || '';
        const nonEmailParts = parts.filter(p => !p.includes('@'));
        firstName = nonEmailParts[0] || 'User';
        lastName = nonEmailParts.slice(1).join(' ');
      }

      if (!email || !email.includes('@')) {
        return '❌ Invalid email address\n\nUsage: !createuser email@example.com FirstName [LastName]';
      }
    }
    // No valid input
    else {
      return '❌ Usage:\n1️⃣ Reply to intro message with !createuser\n2️⃣ !createuser @user email@example.com\n3️⃣ !createuser email@example.com FirstName';
    }

    try {
      // 4. Generate unique username
      let username = await authentikClient.generateUsername(firstName);
      let attempts = 0;
      while (await authentikClient.checkUsernameExists(username) && attempts < 10) {
        username = await authentikClient.generateUsername(firstName);
        attempts++;
      }

      if (attempts >= 10) {
        return '❌ Failed to generate unique username. Please try again.';
      }

      console.log(`🔐 Creating SSO account: ${username} (${email}) for ${firstName} ${lastName}`);

      // 5. Create user in Authentik
      const result = await authentikClient.createUser({
        username,
        email,
        firstName,
        lastName,
        attributes: {
          created_by: 'signal_bot',
          created_via: 'signal_createuser_command',
          signal_uuid: targetUserUuid || null,
        },
      });

      if (!result.success) {
        return `❌ Failed to create user: ${result.error}`;
      }

      // 6. Generate welcome message with credentials
      const welcomeMessage = generateWelcomeMessage(username, result.temp_password || 'Check with admin');

      // 7. Send DM with credentials
      // If @mention: send to target user
      // If no @mention: send to admin who ran command (for manual forwarding)
      const dmRecipient = targetUserUuid || context.sourceUuid || context.sourceNumber;
      let dmSent = false;
      let dmTarget = targetUserUuid ? 'user' : 'admin';
      let dmSentToFallback = false;
      const ADMIN_FALLBACK_NUMBER = '+12247253276'; // sac's admin account for fallback

      if (dmRecipient && this.bot) {
        try {
          await this.bot.sendMessage({
            recipient: dmRecipient,
            message: welcomeMessage,
          });
          dmSent = true;
          console.log(`📨 Credentials DM sent to ${dmTarget}: ${dmRecipient}`);
        } catch (dmError) {
          console.error('Failed to send DM to target:', dmError);

          // Fallback: send to admin account if DM to target fails
          try {
            const fallbackMessage = `📨 FORWARDING CREDENTIALS (DM to user failed)\n\nUser: ${firstName} ${lastName}\nEmail: ${email}\n\n${welcomeMessage}`;
            await this.bot.sendMessage({
              recipient: ADMIN_FALLBACK_NUMBER,
              message: fallbackMessage,
            });
            dmSentToFallback = true;
            console.log(`📨 Credentials sent to admin fallback: ${ADMIN_FALLBACK_NUMBER}`);
          } catch (fallbackError) {
            console.error('Failed to send to admin fallback:', fallbackError);
          }
        }
      }

      // 8. Return success (NO PASSWORD in group response!)
      const response = [
        '✅ SSO Account Created',
        '',
        `📧 Email: ${email}`,
        `👤 Username: ${username}`,
        `📛 Name: ${firstName} ${lastName}`.trim(),
      ];

      if (dmSent) {
        if (targetUserUuid) {
          response.push('', '📨 Credentials sent to user via DM');
        } else {
          response.push('', '📨 Credentials sent to you via DM (forward to user)');
        }
      } else if (dmSentToFallback) {
        response.push('', '📨 Credentials sent to admin (forward to user manually)');
      } else {
        response.push('', '⚠️ Could not send DM - contact user manually');
      }

      return this.formatForSignal(response.join('\n'));

    } catch (error) {
      console.error('Error in handleCreateUser:', error);
      return `❌ Failed to create user: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * !accountinvite - Generate SSO invite link (admin only)
   *
   * Creates an invite URL for Authentik SSO registration.
   * Default: 4 hours, unlimited uses.
   *
   * Usage:
   * - !accountinvite - Creates 4-hour unlimited-use invite
   * - !accountinvite 24 - Creates 24-hour unlimited-use invite
   * - !accountinvite -c 1 - Creates 4-hour single-use invite
   * - !accountinvite 24 -c 1 - Creates 24-hour single-use invite
   */
  private async handleAccountInvite(args: string, context: CommandContext): Promise<string | null> {
    // Admin check
    const isUserAdmin = await this.isAdmin(context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
      return '❌ Admin-only command';
    }

    // Check if Authentik is configured
    if (!authentikClient.isConfigured()) {
      // Send error as DM to admin, not to group
      if (this.bot && (context.sourceUuid || context.sourceNumber)) {
        await this.bot.sendMessage({
          recipient: context.sourceUuid || context.sourceNumber,
          message: '❌ SSO service not configured',
        });
      }
      return null;
    }

    // Parse args - supports: "24", "-c 1", "24 -c 1", etc.
    let expiresInHours = 4;
    let singleUse = false; // Default: unlimited uses
    const argLower = args.trim().toLowerCase();

    // Check for -c option (single use)
    if (argLower.includes('-c 1') || argLower.includes('-c1')) {
      singleUse = true;
    }

    // Extract hours (first number that's not after -c)
    const hoursMatch = argLower.replace(/-c\s*\d+/g, '').match(/(\d+)/);
    if (hoursMatch) {
      const hours = parseInt(hoursMatch[1], 10);
      if (!isNaN(hours) && hours > 0 && hours <= 168) { // Max 1 week
        expiresInHours = hours;
      }
    }

    // Create label with requester info
    const requesterName = (context.sourceName || 'admin').replace(/[^a-z0-9]/gi, '').substring(0, 20);
    const label = `signal_${requesterName}_${Date.now()}`;

    console.log(`🎟️ Creating invite: ${expiresInHours}h, singleUse=${singleUse}, by ${context.sourceName}`);

    const result = await authentikClient.createInvite(label, expiresInHours, singleUse);

    if (!result.success) {
      // Send error as DM to admin, not to group
      if (this.bot && (context.sourceUuid || context.sourceNumber)) {
        await this.bot.sendMessage({
          recipient: context.sourceUuid || context.sourceNumber,
          message: `❌ Failed to create invite: ${result.error}`,
        });
      }
      return null; // No group message for errors
    }

    const expiryTime = new Date(result.expiresAt!);
    // Format time in Eastern timezone
    const easternTime = expiryTime.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    const response = [
      '🎟️ IrregularChat Account Invite',
      '',
      'Create your account to access community services:',
      '• forum.irregularchat.com',
      '• cryptpad.irregularchat.com',
      '• git.irregularchat.com',
      '• videos.irregularchat.com',
      '• and more self-hosted tools',
      '',
      `🔗 ${result.inviteUrl}`,
      '',
      `⏰ Expires: ${easternTime} ET (${expiresInHours}h)`,
      `🔄 Uses: ${singleUse ? 'Single use' : 'Unlimited'}`,
    ];

    // Success - post invite to the group chat
    return this.formatForSignal(response.join('\n'));
  }

  /**
   * Keyword-to-group mapping for intelligent recommendations
   * Maps interest keywords to group name patterns
   *
   * NOTE: Group pattern matching now uses word boundaries to avoid false positives
   * (e.g., "ai" won't match "Hawaii"). See getGroupsMatchingKeywords().
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
    'tech': ['tech', 'technology', 'software', 'programming', 'coding', 'dev', 'engineer', 'fullstack', 'full stack', 'full-stack', 'frontend', 'backend'],
    'ai': ['ai', 'artificial intelligence', 'machine learning', 'ml', 'gpt', 'llm', 'autonomy', 'autonomous'],

    // Communications/RF
    'dragon': ['dragon', 'rf', 'comms', 'communications', 'radio', 'rf-comms', 'dragon-rf'],
    'comms': ['comms', 'communications', 'radio', 'satcom', 'tactical comms'],

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
   *
   * Uses word boundary matching to avoid false positives like "ai" matching "Hawaii"
   */
  private getGroupsMatchingKeywords(allGroups: any[], keywords: Set<string>): Array<{ groupId: string; name: string }> {
    const matchedGroups: Array<{ groupId: string; name: string }> = [];

    // Helper: Check if group name contains pattern as a whole word (not substring)
    const matchesGroupPattern = (groupName: string, pattern: string): boolean => {
      const name = groupName.toLowerCase();
      const pat = pattern.toLowerCase();

      // Use word boundary regex: pattern must be preceded/followed by non-word char or string boundary
      // Escape special regex chars in pattern
      const escapedPattern = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(^|[^a-z])${escapedPattern}([^a-z]|$)`, 'i');
      return regex.test(name);
    };

    // For each keyword category, check if we have matching keywords
    for (const [groupPattern, keywordList] of Object.entries(this.GROUP_KEYWORD_MAP)) {
      // Check if any of the category's keywords were found
      const hasMatchingKeyword = keywordList.some(kw => keywords.has(kw));

      if (hasMatchingKeyword) {
        // Find groups matching this pattern (using word boundary, not substring)
        const matchingGroups = allGroups.filter((g: any) =>
          g.name && matchesGroupPattern(g.name, groupPattern)
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
   * !req / !request - Community join request and verification tracking
   *
   * Usage:
   * - !req (no args): Show help/request template
   * - !req @user: Admin initiates verification for mentioned user (creates tracking)
   */
  private async handleRequest(args: string, context: CommandContext): Promise<string> {
    // If no mention, show the standard request template
    if (!context.mentions || context.mentions.length === 0) {
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

    // Admin-only: create verification request for mentioned user
    const isUserAdmin = await this.isAdmin(context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
      return '❌ Admin-only command. Use !req without mentions to see the request template.';
    }

    if (!context.groupId) {
      return '❌ This command must be used in a group chat (Entry/INDOC chat).';
    }

    const mention = context.mentions[0];
    const userUuid = mention.uuid || mention.number;

    if (!userUuid) {
      return '❌ Could not identify the mentioned user.';
    }

    // Check for existing active verification request
    const existingRequest = await this.dbClient.hasActiveVerificationRequest(userUuid, context.groupId);
    if (existingRequest) {
      return '⚠️ This user already has an active verification request. Please wait for them to complete it or for the 24-hour timeout.';
    }

    // Get user's display name from database
    let userDisplayName = 'New User';
    try {
      const result = await this.dbClient.query(
        'SELECT display_name, profile_name, first_name FROM signal_members WHERE uuid = $1 OR phone_number = $1 LIMIT 1',
        [userUuid]
      );
      if (result.results && result.results.length > 0) {
        const row = result.results[0];
        userDisplayName = row.display_name || row.profile_name || row.first_name || 'New User';
      }
    } catch (error) {
      console.error('Error looking up user display name:', error);
    }

    try {
      // Create verification request in database
      const verificationResult = await this.dbClient.createVerificationRequest({
        userUuid,
        userName: userDisplayName,
        entryGroupId: context.groupId,
        requestedByUuid: context.sourceUuid || context.sourceNumber,
        requestedByName: context.sourceName,
        expiresInHours: 24,
      });

      const expiryTime = new Date(verificationResult.expiresAt);
      const expiryFormatted = expiryTime.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      console.log(`📋 Verification request created for ${userDisplayName} (${userUuid}), expires: ${expiryFormatted} ET`);

      // Build welcome message for the new user with structured format
      const welcomeMessage = this.formatForSignal(
        `📝 Welcome to IrregularChat Entry!\n\n` +
        `${userDisplayName}, you've requested to join the IrregularChat Community.\n\n` +
        `🔑 Bonafides: Everyone in the chat has been invited by an IrregularChat member. ` +
        `So that we can add you to the right groups, we need to know:\n\n` +
        `1. NAME\n` +
        `2. YOUR_ORGANIZATION\n` +
        `3. Who invited you (Add & @mention them in this chat)\n` +
        `4. EMAIL_OR_EMAIL_ALIAS\n` +
        `5. YOUR_INTERESTS\n` +
        `6. LinkedIn profile link (optional - helps others endorse your skills)\n\n` +
        `📮 Please reply with your info in numbered format!\n\n` +
        `Example:\n` +
        `1. John Smith\n` +
        `2. ABC Corp\n` +
        `3. @JaneDoe invited me\n` +
        `4. john@example.com\n` +
        `5. Cyber, OSINT, AI\n` +
        `6. linkedin.com/in/johnsmith (or "skip")\n\n` +
        `⏰ You have 24 hours to complete verification.\n` +
        `Expires: ${expiryFormatted} ET`
      );

      return welcomeMessage;
    } catch (error) {
      console.error('Error creating verification request:', error);
      return `❌ Failed to create verification request: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Handle non-command messages for verification flow detection
   * Called from signal-bot-v2.ts message handler
   */
  async handleVerificationMessage(
    message: string,
    context: CommandContext
  ): Promise<string | null> {
    if (!context.groupId || !context.sourceUuid) {
      return null;
    }

    // Check if sender has an active verification request (pending_intro)
    const activeRequest = await this.dbClient.getActiveVerificationRequest(
      context.sourceUuid,
      context.groupId
    );

    if (activeRequest && activeRequest.status === 'pending_intro') {
      // Check if message contains a mention (voucher)
      if (context.mentions && context.mentions.length > 0) {
        const voucherMention = context.mentions[0];
        const voucherUuid = voucherMention.uuid || voucherMention.number;

        if (!voucherUuid) {
          return null;
        }

        // Verify voucher is an existing community member (not just in entry chat)
        // For now, we'll trust the mention since they're in the group

        // Get voucher's display name
        let voucherDisplayName = 'Community Member';
        try {
          const result = await this.dbClient.query(
            'SELECT display_name, profile_name, first_name FROM signal_members WHERE uuid = $1 OR phone_number = $1 LIMIT 1',
            [voucherUuid]
          );
          if (result.results && result.results.length > 0) {
            const row = result.results[0];
            voucherDisplayName = row.display_name || row.profile_name || row.first_name || 'Community Member';
          }
        } catch (error) {
          console.error('Error looking up voucher display name:', error);
        }

        // Get user's display name
        let userDisplayName = activeRequest.user_name || 'New User';

        // Update verification request to pending_vouch
        await this.dbClient.updateVerificationStatus(activeRequest.id, 'pending_vouch', {
          voucherUuid,
          voucherName: voucherDisplayName,
          introText: message,
          voucherAskedAt: new Date(),
        });

        console.log(`📋 Verification: ${userDisplayName} mentioned ${voucherDisplayName} as voucher`);

        // Send vouch request message
        return this.formatForSignal(
          `🤝 Verification Request\n\n` +
          `${voucherDisplayName}, ${userDisplayName} is requesting to join IrregularChat and mentioned you as their connection.\n\n` +
          `Do you trust and vouch for ${userDisplayName} to join the IrregularChat community?\n\n` +
          `Reply with:\n` +
          `• "yes" or "1" to approve\n` +
          `• "no" or "2" to deny\n\n` +
          `ℹ️ By vouching, you confirm they understand the community rules at forum.irregularchat.com`
        );
      }
    }

    // Check if sender is a voucher for any pending requests
    const pendingVouchRequests = await this.dbClient.getPendingVouchRequests(context.sourceUuid);

    if (pendingVouchRequests.length > 0) {
      const lowerMessage = message.toLowerCase().trim();

      // Check for yes/no response
      const isYes = ['yes', 'y', '1', 'approve', 'approved', 'vouch', 'vouched'].includes(lowerMessage);
      const isNo = ['no', 'n', '2', 'deny', 'denied', 'reject', 'rejected'].includes(lowerMessage);

      if (isYes || isNo) {
        // Process the most recent pending vouch request
        const request = pendingVouchRequests[0];
        const userDisplayName = request.user_name || 'New User';

        if (isYes) {
          // Mark as approved
          await this.dbClient.updateVerificationStatus(request.id, 'approved', {
            completedAt: new Date(),
          });

          console.log(`✅ Verification approved: ${userDisplayName} vouched by ${context.sourceName}`);

          // Process GTG flow - create a synthetic context for GTG
          const gtgContext: CommandContext = {
            sourceNumber: context.sourceNumber,
            sourceUuid: context.sourceUuid,
            sourceName: context.sourceName,
            groupId: context.groupId,
            timestamp: Date.now(),
            mentions: [{ start: 0, length: 0, uuid: request.user_uuid }],
          };

          // Run GTG flow in background (don't await - let it process)
          this.processVerifiedUser(request.user_uuid, userDisplayName, context.groupId, gtgContext)
            .catch(error => console.error('Error processing verified user:', error));

          return this.formatForSignal(
            `✅ Good to go! ${userDisplayName} has been verified.\n\n` +
            `Thanks for keeping the community safe.\n\n` +
            `${userDisplayName} - you'll receive:\n` +
            `1. A DM with your IrregularChat login\n` +
            `2. Group invites based on your interests\n\n` +
            `Learn about the community: https://forum.irregularchat.com/t/irregularchat-forum-start-here-faqs/84\n\n` +
            `See you out there!`
          );
        } else {
          // Mark as denied
          await this.dbClient.updateVerificationStatus(request.id, 'denied', {
            completedAt: new Date(),
          });

          console.log(`❌ Verification denied: ${userDisplayName} by ${context.sourceName}`);

          // Remove user from entry chat
          await this.removeUserFromEntryChat(request.user_uuid, request.entry_group_id, 'denied');

          return this.formatForSignal(
            `❌ Verification Denied\n\n` +
            `${userDisplayName} was not vouched for and has been removed from the Entry chat.\n\n` +
            `They can try again by having a community member add them directly to this chat.`
          );
        }
      }
    }

    return null;
  }

  /**
   * Process a verified user (called after vouch approval)
   */
  private async processVerifiedUser(
    userUuid: string,
    userName: string,
    entryGroupId: string,
    context: CommandContext
  ): Promise<void> {
    try {
      // Run GTG flow to create account and add to groups
      const gtgResult = await this.handleGtg('', context);
      console.log(`GTG result for ${userName}:`, gtgResult);

      // Remove user from entry chat after processing
      await this.removeUserFromEntryChat(userUuid, entryGroupId, 'verified');
    } catch (error) {
      console.error(`Error processing verified user ${userName}:`, error);
    }
  }

  /**
   * Remove user from entry chat with appropriate message
   */
  private async removeUserFromEntryChat(
    userUuid: string,
    groupId: string,
    reason: 'verified' | 'denied' | 'expired'
  ): Promise<void> {
    if (!this.bot) return;

    try {
      // Get user display name for logging
      let userDisplayName = 'User';
      try {
        const result = await this.dbClient.query(
          'SELECT display_name, profile_name, first_name FROM signal_members WHERE uuid = $1 LIMIT 1',
          [userUuid]
        );
        if (result.results && result.results.length > 0) {
          const row = result.results[0];
          userDisplayName = row.display_name || row.profile_name || row.first_name || 'User';
        }
      } catch (error) {
        console.error('Error looking up user display name:', error);
      }

      // Small delay before removal
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Remove user from group
      await this.bot.updateGroup({
        groupId,
        removeMember: [userUuid],
      });

      console.log(`🚪 Removed ${userDisplayName} from entry chat (reason: ${reason})`);
    } catch (error) {
      console.error(`Failed to remove user from entry chat:`, error);
    }
  }

  /**
   * Process expired verification requests
   * Called periodically from signal-bot-v2.ts
   */
  async processExpiredVerifications(): Promise<void> {
    try {
      const expiredRequests = await this.dbClient.getExpiredVerificationRequests();

      for (const request of expiredRequests) {
        const userDisplayName = request.user_name || 'User';

        console.log(`⏰ Verification expired for ${userDisplayName}`);

        // Update status to expired
        await this.dbClient.updateVerificationStatus(request.id, 'expired', {
          completedAt: new Date(),
        });

        // Send timeout message to entry chat
        if (this.bot) {
          const timeoutMessage = this.formatForSignal(
            `⏰ Verification Timeout\n\n` +
            `${userDisplayName} failed to complete verification within 24 hours and has been removed.\n\n` +
            `They can try again by having a community member add them directly to this chat.`
          );

          await this.bot.sendMessage({
            groupId: request.entry_group_id,
            message: timeoutMessage,
          });
        }

        // Remove user from entry chat
        await this.removeUserFromEntryChat(request.user_uuid, request.entry_group_id, 'expired');
      }

      if (expiredRequests.length > 0) {
        console.log(`⏰ Processed ${expiredRequests.length} expired verification request(s)`);
      }
    } catch (error) {
      console.error('Error processing expired verifications:', error);
    }
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
   * Usage: !announce [groups] [-t time] [-dm] message
   * Groups can be numbers (13), keywords (tech), or mixed (13,tech,cyber)
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

  // ============================================
  // DICE GAME HANDLERS
  // ============================================

  /**
   * !dice - Start a new dice game with mentioned players
   *
   * Usage: !dice @user1 @user2 @user3
   *
   * This creates a new Signal group for the game and invites players.
   * The game runs in the new group with street craps rules.
   */
  private async handleDiceGame(args: string, context: CommandContext): Promise<string | { text: string; attachment?: string }> {
    // Check if we have mentions
    if (!context.mentions || context.mentions.length === 0) {
      const helpText = this.formatForSignal(
        '🎰 STREET CRAPS\n\n' +
        'Start a multiplayer dice game!\n\n' +
        'Usage:\n' +
        '  !dice @user1 @user2 @user3\n\n' +
        'Mention 1-5 other players to start.\n' +
        'A game room will be created with rules posted.\n\n' +
        'Commands during game:\n' +
        '  !roll - Shooter rolls dice\n' +
        '  !pass [amount] - Bet WITH shooter\n' +
        '  !fade [amount] - Bet AGAINST shooter\n' +
        '  !points - Check your balance\n' +
        '  !leave - Leave the game'
      );

      // Add a random meme to the dice help response
      const meme = getRandomMeme();
      const filePath = getMemeFilePath(meme);
      const exists = await memeFileExists(meme);

      if (exists) {
        return {
          text: helpText,
          attachment: filePath,
        };
      }

      return helpText;
    }

    if (context.mentions.length > 11) {
      return '❌ Maximum 11 other players allowed (12 total)';
    }

    // Get sender's info - prefer sourceName from message envelope (most reliable)
    let creatorName = context.sourceName || 'Player';
    const creatorIdentifier = context.sourceUuid || context.sourceNumber;

    // Only do database lookup if sourceName wasn't available
    if ((!creatorName || creatorName === 'Player') && this.dbClient && creatorIdentifier) {
      try {
        const senderInfo = await this.dbClient.query(
          'SELECT display_name, profile_name, first_name, last_name FROM signal_members WHERE phone_number = $1 OR uuid = $1 LIMIT 1',
          [creatorIdentifier]
        );
        if (senderInfo.results && senderInfo.results.length > 0) {
          const row = senderInfo.results[0];
          creatorName = row.display_name || row.profile_name ||
                       (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name) ||
                       creatorName;
        }
      } catch (error) {
        console.log('Could not look up creator name:', error);
      }
    }
    console.log(`📛 Creator name: "${creatorName}" (from sourceName: ${context.sourceName})`)

    // Build player list - extract names from the original message text using mention positions
    const players: Array<{uuid: string; name: string; phoneNumber?: string}> = [];
    const originalMessage = context.message || '';

    for (const mention of context.mentions) {
      let playerName = 'Player';
      const playerUuid = mention.uuid || mention.number || '';

      // Extract name from message text using mention position
      // The mention has start (position) and length in the message
      if (originalMessage && typeof mention.start === 'number' && typeof mention.length === 'number') {
        const extractedName = originalMessage.substring(mention.start, mention.start + mention.length);
        // Remove the @ prefix if present
        playerName = extractedName.startsWith('@') ? extractedName.substring(1).trim() : extractedName.trim();
        // Also handle the unicode mention character (U+FFFC) that Signal uses
        playerName = playerName.replace(/\uFFFC/g, '').trim();
        console.log(`📛 Extracted player name from mention: "${playerName}" (start: ${mention.start}, length: ${mention.length})`);
      }

      // If we couldn't extract from message, try database lookup as fallback
      if ((!playerName || playerName === 'Player' || playerName.length === 0) && this.dbClient && playerUuid) {
        try {
          const memberInfo = await this.dbClient.query(
            'SELECT display_name, profile_name, first_name, last_name, phone_number FROM signal_members WHERE uuid = $1 OR phone_number = $1 LIMIT 1',
            [playerUuid]
          );
          if (memberInfo.results && memberInfo.results.length > 0) {
            const row = memberInfo.results[0];
            // NEVER use phone_number as name - privacy concern
            playerName = row.display_name || row.profile_name ||
                        (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name) ||
                        playerName;
          }
        } catch (error) {
          console.log('Could not look up player name:', error);
        }
      }

      // Final fallback: use a shortened UUID
      if (!playerName || playerName === 'Player' || playerName.length === 0) {
        playerName = playerUuid ? `Player-${playerUuid.substring(0, 4)}` : 'Player';
      }

      players.push({
        uuid: playerUuid,
        name: playerName,
        phoneNumber: mention.number
      });
    }

    // Create the game
    const creatorUuid = context.sourceUuid || context.sourceNumber || '';
    const game = createGame(creatorUuid, creatorName, players);

    // Create a new Signal group for the game
    if (!this.bot) {
      return '❌ Bot not available. Cannot create game room.';
    }

    try {
      // Gather member identifiers (UUIDs or phone numbers)
      const memberIds: string[] = [];

      // Add the creator
      if (context.sourceUuid) {
        memberIds.push(context.sourceUuid);
      } else if (context.sourceNumber) {
        memberIds.push(context.sourceNumber);
      }

      // Add mentioned players
      for (const mention of context.mentions) {
        if (mention.uuid) {
          memberIds.push(mention.uuid);
        } else if (mention.number) {
          memberIds.push(mention.number);
        }
      }

      // Generate a unique, fun group name
      const groupName = this.generateDiceGameName(creatorName);
      const result = await this.bot.createGroup({
        name: groupName,
        members: memberIds,
        description: 'Street Craps Dice Game'
      });

      if (result && result.groupId) {
        setGameGroupId(game.id, result.groupId);

        // Build player list for the welcome message WITH Signal mentions
        // Signal CLI mention format: "start:length:uuid"
        const mentions: string[] = [];
        let playerListText = '';
        const headerText = '🎰 STREET CRAPS GAME STARTED! 🎰\n\n👥 Players:\n';
        let currentPosition = headerText.length;

        const playersArray = Array.from(game.players.values());
        for (let i = 0; i < playersArray.length; i++) {
          const p = playersArray[i];
          const prefix = '  • ';
          currentPosition += prefix.length;

          // Use a placeholder character for the mention (Signal replaces with display name)
          const mentionPlaceholder = '\uFFFC'; // Object Replacement Character
          const suffix = p.isShooter ? ' 🎯 (shooter)' : '';

          // Add mention in format start:length:uuid
          // Length is 1 for the placeholder character
          mentions.push(`${currentPosition}:1:${p.uuid}`);

          playerListText += `${prefix}${mentionPlaceholder}${suffix}\n`;
          currentPosition += 1 + suffix.length + 1; // placeholder + suffix + newline
        }

        // Send welcome message to the new group with mentions
        // startBetting now returns { message, mentions } so we need to handle both
        const bettingResult = startBetting(game);
        const welcomeHeader = `${headerText}${playerListText}\n` +
          `Each player starts with 100 points.\n\n` +
          getGameRules() + '\n\n' +
          `━━━━━━━━━━━━━━━━━━━━━━\n`;

        // Adjust betting mentions positions based on welcome header length
        const adjustedBettingMentions = (bettingResult.mentions || []).map(m => {
          const [start, len, uuid] = m.split(':');
          return `${parseInt(start) + welcomeHeader.length}:${len}:${uuid}`;
        });

        const welcomeMessage = welcomeHeader + bettingResult.message;
        const allMentions = [...mentions, ...adjustedBettingMentions];

        console.log(`📛 Sending welcome message with ${allMentions.length} mentions:`, allMentions);

        // Send the welcome message to the new group with mentions
        await this.bot.sendMessage({
          groupId: result.groupId,
          message: welcomeMessage,
          mention: allMentions
        });

        // Reply to the original message
        return `🎲 Game room created! Check your groups for "${groupName}"`;
      } else {
        return '❌ Failed to create game room. Please try again.';
      }
    } catch (error) {
      console.error('Error creating dice game room:', error);
      return `❌ Error creating game room: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Helper: Update player's name from Signal envelope if available
   * Signal sends the current display name with each message, so use it to keep names fresh
   */
  private updatePlayerNameFromContext(game: GameState, playerUuid: string, context: CommandContext): void {
    const player = game.players.get(playerUuid);
    if (player && context.sourceName && context.sourceName !== 'Player') {
      player.name = context.sourceName;
    }
  }

  /**
   * !roll [stake] - Shooter rolls the dice (optionally setting stake first)
   * Examples: !roll (uses current stake), !roll 20 (sets stake to 20 then rolls)
   */
  private async handleDiceRoll(args: string, context: CommandContext): Promise<string> {
    // Find active game for this group
    const game = context.groupId ? getGameByGroupId(context.groupId) : undefined;

    if (!game) {
      return '❌ No active dice game in this group!\nUse !dice @user1 @user2 to start one.';
    }

    const playerUuid = context.sourceUuid || context.sourceNumber || '';
    this.updatePlayerNameFromContext(game, playerUuid, context);

    // If a number was provided, set stake first
    const stakeMatch = args.trim().match(/^(\d+)/);
    if (stakeMatch) {
      const stakeAmount = parseInt(stakeMatch[1]);
      const stakeResult = setShooterStake(game, playerUuid, stakeAmount);
      // If setting stake failed (not shooter, invalid amount, etc.), return error
      if (stakeResult.message.startsWith('❌')) {
        return stakeResult.message;
      }
    }

    const result = shooterRoll(game, playerUuid);

    // Check if game is over
    if (game.phase === 'finished') {
      const gameId = game.id;
      endGame(gameId);
      return result.message + '\n\n🎮 GAME OVER! Thanks for playing!\n\n🔄 Type !rematch to play again\n👋 Or leave this group';
    }

    // If new round, add betting prompt
    if (result.nextPhase === 'betting') {
      const bettingResult = startBetting(game);
      return result.message + '\n\n' + bettingResult.message;
    }

    return result.message;
  }

  /**
   * !pass / !fade - Place a bet
   */
  private async handleDiceBet(betType: 'pass' | 'fade', args: string, context: CommandContext): Promise<string> {
    const game = context.groupId ? getGameByGroupId(context.groupId) : undefined;

    if (!game) {
      return '❌ No active dice game in this group!';
    }

    const playerUuid = context.sourceUuid || context.sourceNumber || '';
    this.updatePlayerNameFromContext(game, playerUuid, context);

    // Parse bet amount
    let amount = 10;  // Default bet
    const amountMatch = args.trim().match(/^(\d+)/);
    if (amountMatch) {
      amount = parseInt(amountMatch[1]);
    }

    const result = placeBet(game, playerUuid, betType, amount);

    return result.message;
  }

  /**
   * !stake - Shooter sets their stake for the round
   */
  private async handleDiceStake(args: string, context: CommandContext): Promise<string> {
    const game = context.groupId ? getGameByGroupId(context.groupId) : undefined;

    if (!game) {
      return '❌ No active dice game in this group!';
    }

    const playerUuid = context.sourceUuid || context.sourceNumber || '';
    this.updatePlayerNameFromContext(game, playerUuid, context);

    // Parse stake amount
    let amount = 10;  // Default
    const amountMatch = args.trim().match(/^(\d+)/);
    if (amountMatch) {
      amount = parseInt(amountMatch[1]);
    }

    const result = setShooterStake(game, playerUuid, amount);

    return result.message;
  }

  /**
   * !skip - Player skips betting for this round
   */
  private async handleDiceSkip(context: CommandContext): Promise<string> {
    const game = context.groupId ? getGameByGroupId(context.groupId) : undefined;

    if (!game) {
      return '❌ No active dice game in this group!';
    }

    const playerUuid = context.sourceUuid || context.sourceNumber || '';
    this.updatePlayerNameFromContext(game, playerUuid, context);
    const result = playerSkipBetting(game, playerUuid);

    return result.message;
  }

  /**
   * !go - Shooter signals ready to roll early (before timer expires)
   */
  private async handleDiceGo(context: CommandContext): Promise<string> {
    const game = context.groupId ? getGameByGroupId(context.groupId) : undefined;

    if (!game) {
      return '❌ No active dice game in this group!';
    }

    const playerUuid = context.sourceUuid || context.sourceNumber || '';
    this.updatePlayerNameFromContext(game, playerUuid, context);
    const result = shooterReadyToRoll(game, playerUuid);

    return result.message;
  }

  /**
   * !hold - Set or clear a persistent bet
   * !hold pass 20 - Auto-bet pass 20 each round
   * !hold fade 15 - Auto-bet fade 15 each round
   * !hold off - Clear hold
   * !hold - Show current hold status
   */
  private async handleDiceHold(args: string, context: CommandContext): Promise<string> {
    const game = context.groupId ? getGameByGroupId(context.groupId) : undefined;

    if (!game) {
      return '❌ No active dice game in this group!';
    }

    const playerUuid = context.sourceUuid || context.sourceNumber || '';
    this.updatePlayerNameFromContext(game, playerUuid, context);

    // Parse args: "pass 20", "fade 15", "off", or empty
    const parts = args.trim().toLowerCase().split(/\s+/);
    const betTypeArg = parts[0];
    const amountArg = parts[1];

    let betType: 'pass' | 'fade' | 'off' | undefined;
    let amount: number | undefined;

    if (betTypeArg === 'pass' || betTypeArg === 'fade') {
      betType = betTypeArg;
      amount = amountArg ? parseInt(amountArg) : undefined;
      if (amount && isNaN(amount)) {
        return '❌ Invalid amount! Usage: !hold pass 20 or !hold fade 15';
      }
    } else if (betTypeArg === 'off' || betTypeArg === 'clear') {
      betType = 'off';
    } else if (betTypeArg && betTypeArg !== '') {
      return '❌ Invalid hold type! Use: !hold pass [amt], !hold fade [amt], or !hold off';
    }

    const result = setHoldBet(game, playerUuid, betType, amount);
    return result.message;
  }

  /**
   * !points - Check your current points
   */
  private async handleDicePoints(context: CommandContext): Promise<string> {
    const game = context.groupId ? getGameByGroupId(context.groupId) : undefined;

    if (!game) {
      return '❌ No active dice game in this group!';
    }

    const playerUuid = context.sourceUuid || context.sourceNumber || '';
    this.updatePlayerNameFromContext(game, playerUuid, context);
    return getPlayerPoints(game, playerUuid);
  }

  /**
   * !gamestatus / !gs - Check game status
   */
  private async handleDiceStatus(context: CommandContext): Promise<string> {
    const game = context.groupId ? getGameByGroupId(context.groupId) : undefined;

    if (!game) {
      return '❌ No active dice game in this group!';
    }

    return getGameStatus(game);
  }

  /**
   * !leave - Leave the current game
   */
  private async handleDiceLeave(context: CommandContext): Promise<string> {
    const game = context.groupId ? getGameByGroupId(context.groupId) : undefined;

    if (!game) {
      return '❌ No active dice game in this group!';
    }

    const playerUuid = context.sourceUuid || context.sourceNumber || '';
    this.updatePlayerNameFromContext(game, playerUuid, context);
    const result = removePlayer(game, playerUuid);

    // Check if game should end
    if (result.gameOver) {
      endGame(game.id);
    }

    return result.message;
  }

  /**
   * !rematch / !again - Start a new game in the same group with current group members
   */
  private async handleDiceRematch(context: CommandContext): Promise<string> {
    if (!context.groupId) {
      return '❌ Rematch can only be used in a dice game group!';
    }

    if (!this.bot) {
      return '❌ Bot not available.';
    }

    // Get bot's UUID to filter it out from players
    let botUuid: string | null = null;
    if (this.dbClient) {
      try {
        const result = await this.dbClient.query(
          'SELECT uuid FROM signal_members WHERE phone_number = $1 LIMIT 1',
          [this.config.phoneNumber]
        );
        if (result.results && result.results.length > 0) {
          botUuid = result.results[0].uuid;
        }
      } catch (e) {
        // Bot UUID lookup failed, will use phone number fallback
      }
    }

    // Get group members from signal-cli
    let groupMembers: Array<{uuid: string; name: string}> = [];
    try {
      const groups = await this.bot.getGroups();
      const thisGroup = groups.find((g: any) => g.id === context.groupId);
      if (thisGroup && thisGroup.members) {
        // Members can be strings (UUIDs) or objects
        for (const member of thisGroup.members) {
          const memberUuid = typeof member === 'string' ? member : member.uuid;
          if (memberUuid) {
            // Skip the bot itself
            if (botUuid && memberUuid === botUuid) {
              continue;
            }
            // Also skip if it matches the bot's phone number
            if (memberUuid === this.config.phoneNumber) {
              continue;
            }

            // Try to get name from database
            let memberName = memberUuid.substring(0, 8) + '...';
            if (this.dbClient) {
              try {
                const memberInfo = await this.dbClient.query(
                  'SELECT display_name, profile_name, first_name, last_name FROM signal_members WHERE uuid = $1 LIMIT 1',
                  [memberUuid]
                );
                if (memberInfo.results && memberInfo.results.length > 0) {
                  const row = memberInfo.results[0];
                  memberName = row.display_name || row.profile_name ||
                              (row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name) ||
                              memberName;
                }
              } catch (e) {
                // Use fallback name
              }
            }
            groupMembers.push({ uuid: memberUuid, name: memberName });
          }
        }
      }
    } catch (error) {
      console.error('Error getting group members for rematch:', error);
    }

    // Need at least 2 players (not counting the bot)
    if (groupMembers.length < 2) {
      return '❌ Need at least 2 players in the group for a rematch!';
    }

    // Get creator info
    const creatorUuid = context.sourceUuid || context.sourceNumber || '';
    const creatorName = context.sourceName || 'Player';

    // Create players array (exclude creator since createGameInGroup adds them)
    const otherPlayers = groupMembers.filter(m => m.uuid !== creatorUuid);

    // Create new game in this group
    const game = createGameInGroup(context.groupId, creatorUuid, creatorName, otherPlayers);

    // Build player list WITH Signal mentions
    const mentions: string[] = [];
    const headerText = '🎰 REMATCH! 🎰\n\n👥 Players:\n';
    let currentPosition = headerText.length;
    let playerListText = '';

    const playersArray = Array.from(game.players.values());
    for (let i = 0; i < playersArray.length; i++) {
      const p = playersArray[i];
      const prefix = '  • ';
      currentPosition += prefix.length;

      // Use a placeholder character for the mention
      const mentionPlaceholder = '\uFFFC';
      const suffix = p.isShooter ? ' 🎯 (shooter)' : '';

      // Add mention in format start:length:uuid
      mentions.push(`${currentPosition}:1:${p.uuid}`);

      playerListText += `${prefix}${mentionPlaceholder}${suffix}\n`;
      currentPosition += 1 + suffix.length + 1; // placeholder + suffix + newline
    }

    const introText = '\nEach player starts with 100 points.\n\n';
    currentPosition = headerText.length + playerListText.length + introText.length;

    // Get betting result with mentions
    const bettingResult = startBetting(game);

    // Adjust betting mentions positions
    const adjustedBettingMentions = (bettingResult.mentions || []).map(m => {
      const [start, len, uuid] = m.split(':');
      return `${parseInt(start) + currentPosition}:${len}:${uuid}`;
    });

    const allMentions = [...mentions, ...adjustedBettingMentions];
    const fullMessage = `${headerText}${playerListText}${introText}${bettingResult.message}`;

    // Return object to signal that this response needs mentions
    // Since the standard return is a string, we need to send directly with mentions
    if (this.bot && context.groupId) {
      await this.bot.sendMessage({
        groupId: context.groupId,
        message: fullMessage,
        mention: allMentions
      });
      return ''; // Empty string so no duplicate message is sent
    }

    // Fallback without mentions
    return fullMessage;
  }

  /**
   * Generate a unique, fun name for a dice game group
   */
  private generateDiceGameName(creatorName: string): string {
    const adjectives = [
      'Lucky', 'Hot', 'Rolling', 'High', 'Wild', 'Golden', 'Midnight',
      'Vegas', 'Street', 'Big', 'Royal', 'Smoky', 'Electric', 'Neon'
    ];
    const nouns = [
      'Rollers', 'Stakes', 'Bones', 'Dice', 'Table', 'Alley', 'Corner',
      'Club', 'Pit', 'Den', 'Room', 'Spot'
    ];

    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];

    // Get short identifier from timestamp (last 4 chars in base36)
    const shortId = Date.now().toString(36).slice(-4).toUpperCase();

    // Get first name only if it's a full name
    const firstName = creatorName.split(' ')[0];

    return `🎲 ${firstName}'s ${adj} ${noun} #${shortId}`;
  }

  /**
   * Format text for Signal (strip markdown, clean formatting)
   * Signal doesn't render markdown, so we convert to plain text
   */
  private formatForSignal(text: string): string {
    return text
      // Remove headers (### Header -> HEADER)
      .replace(/^#{1,6}\s+(.+)$/gm, (_, content) => content.toUpperCase())
      // Remove bold/italic markers (**bold** or *italic* -> text)
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      // Remove inline code (`code` -> code)
      .replace(/`([^`]+)`/g, '$1')
      // Remove links [text](url) -> text (url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      // Clean up multiple blank lines
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ============================================================================
  // BREAKOUT ROOM HANDLERS
  // ============================================================================

  /**
   * !breakout - Create a new breakout room
   * Usage: !breakout <topic> @person1 @person2 [30m|1h|2h] [type:brainstorm] [privacy:public]
   */
  private async handleBreakout(args: string, context: CommandContext): Promise<string> {
    if (!this.breakoutManager) {
      return '❌ Breakout rooms are not available. Bot not fully initialized.';
    }

    if (!context.groupId) {
      return '❌ Breakout rooms can only be created from within a group.';
    }

    if (!args.trim()) {
      return `🚀 Breakout Rooms

Create a temporary focused discussion group.

Usage: !breakout <topic> [@mentions] [duration] [type:...] [privacy:...]

Examples:
  !breakout API Design 30m
  !breakout Sprint Planning @alice @bob 1h type:planning
  !breakout Bug Triage 45m type:problem privacy:private

Duration: 15m, 30m, 45m, 1h, 2h (default: 1h)

Types: general, brainstorm, decision, planning, retro, problem, review, sync

Privacy: public, private, summary_only (default), internal

Joining: @mentions are optional - react with any emoji to the room announcement to join!

Commands:
  !breakouts - List active rooms
  !endbreakout - End your room (AI summary generated)`;
    }

    // Parse the command - filter mentions to only those with valid UUIDs
    const validMentions = (context.mentions || [])
      .filter((m): m is { uuid: string; start: number; length: number } => !!m.uuid);
    const parsed = this.breakoutManager.parseBreakoutCommand(args, validMentions);

    // Mentions are optional - room starts with creator, others can join via emoji reaction
    // Get member names from database for display (if any mentioned)
    const memberNames = parsed.mentionedUuids.length > 0
      ? await this.dbClient.getMemberDisplayNamesByUuids(parsed.mentionedUuids)
      : new Map<string, string>();

    // Get parent group name
    let parentGroupName: string | undefined;
    if (this.bot) {
      try {
        const groups = this.bot.getGroups();
        const parentGroup = groups.find((g: any) => g.id === context.groupId);
        parentGroupName = parentGroup?.name;
      } catch (err) {
        // Ignore errors getting group name
      }
    }

    // Create the breakout
    const result = await this.breakoutManager.createBreakout(
      context.groupId,
      parentGroupName,
      context.sourceUuid || context.sourceNumber,
      context.sourceName,
      {
        topic: parsed.topic,
        members: parsed.mentionedUuids,
        memberNames,
        roomType: parsed.roomType,
        durationMinutes: parsed.durationMinutes,
        privacyMode: parsed.privacyMode,
      }
    );

    if (!result.success) {
      return `❌ Failed to create breakout room: ${result.error}`;
    }

    const typeInfo = ROOM_TYPES[parsed.roomType];
    const hours = Math.floor(parsed.durationMinutes / 60);
    const mins = parsed.durationMinutes % 60;
    const durationStr = hours > 0
      ? (mins > 0 ? `${hours}h ${mins}m` : `${hours}h`)
      : `${mins}m`;

    const invitedNames = parsed.mentionedUuids
      .map(uuid => memberNames.get(uuid) || uuid.substring(0, 8) + '...')
      .join(', ');

    const invitedText = invitedNames ? `\nInvited: ${invitedNames}` : '';

    return `${typeInfo.icon} Breakout Room Created!

Topic: ${parsed.topic}
Type: ${typeInfo.name}
Duration: ${durationStr}
Privacy: ${PRIVACY_MODES[parsed.privacyMode]}${invitedText}

React with any emoji to join this breakout!
The invitees have been added to a new Signal group for the discussion.`;
  }

  /**
   * !endbreakout - End the current breakout room
   */
  private async handleEndBreakout(context: CommandContext): Promise<string> {
    if (!this.breakoutManager) {
      return '❌ Breakout rooms are not available.';
    }

    if (!context.groupId) {
      return '❌ This command must be used within a group.';
    }

    const result = await this.breakoutManager.endBreakout(
      context.groupId,
      context.sourceUuid || context.sourceNumber,
      context.sourceName
    );

    if (!result.success) {
      return result.message;
    }

    return result.message;
  }

  /**
   * !breakouts - List active breakout rooms from parent group
   */
  private async handleBreakouts(context: CommandContext): Promise<string> {
    if (!this.breakoutManager) {
      return '❌ Breakout rooms are not available.';
    }

    if (!context.groupId) {
      return '❌ This command must be used within a group.';
    }

    // Check if this is a breakout room
    const isBreakout = await this.breakoutManager.isBreakoutRoom(context.groupId);

    if (isBreakout) {
      // Get the breakout info
      const breakout = await this.breakoutManager.getActiveBreakout(context.groupId);
      if (breakout) {
        const expiresAt = new Date(breakout.expires_at);
        const minutesLeft = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 60000));

        // Format time remaining in multiple timezones
        const etTime = expiresAt.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true });
        const ctTime = expiresAt.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true });
        const ptTime = expiresAt.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', hour12: true });

        return `🚀 Breakout Room Status

Topic: ${breakout.topic}
Time remaining: ${minutesLeft} minutes
Ends at: ${etTime} ET / ${ctTime} CT / ${ptTime} PT
Messages: ${breakout.total_messages || 0}
Participants: ${breakout.unique_participants || 0}

Commands:
  !decision <text> - Record a decision
  !action <text> - Record an action item
  !park <text> - Park a topic
  !extend 15m - Request extension
  !endbreakout - End session`;
      }
    }

    // List active breakouts from this parent group
    return await this.breakoutManager.getActiveBreakouts(context.groupId);
  }

  /**
   * Use AI to extract a clean, actionable task from conversational text
   */
  private async extractTaskWithAI(rawText: string, assigneeName?: string): Promise<string> {
    if (!this.openai) {
      // Fallback: just return the raw text if AI is not available
      return rawText;
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a task extraction assistant. Convert conversational text into a clear, actionable task description.

Rules:
- Output ONLY the task description, nothing else
- Start with an action verb (Review, Update, Create, Fix, Send, etc.)
- Be concise but include key details (what, where, when if mentioned)
- Remove conversational filler ("I think", "maybe", "we should", etc.)
- Keep technical terms and specifics intact
- If there's a deadline mentioned, include it
- Max 100 characters unless more detail is essential

Examples:
Input: "hey can you look at the PR I submitted yesterday for the auth changes"
Output: "Review auth changes PR submitted yesterday"

Input: "we need someone to update the docs with the new API endpoints"
Output: "Update documentation with new API endpoints"

Input: "the login page is broken on mobile, needs fixing asap"
Output: "Fix mobile login page (urgent)"`
          },
          {
            role: 'user',
            content: rawText
          }
        ],
        temperature: 0.3,
        max_tokens: 150,
      });

      const extracted = response.choices[0]?.message?.content?.trim();
      if (extracted && extracted.length > 0 && extracted.length < 500) {
        console.log(`🤖 AI extracted task: "${extracted}" from: "${rawText.substring(0, 50)}..."`);
        return extracted;
      }
    } catch (error) {
      console.error('AI task extraction failed:', error);
    }

    // Fallback to raw text
    return rawText;
  }

  /**
   * !decision, !action, !park - Add annotation to breakout room
   *
   * For !action:
   * - Can be used by replying to a message (quoted text becomes the task)
   * - @mentions the person to assign the task
   * - Sends a DM to the assigned person with the task
   * - Uses AI to extract clean task from conversational quoted messages
   */
  private async handleBreakoutAnnotation(
    type: 'decision' | 'action' | 'park',
    args: string,
    context: CommandContext
  ): Promise<string> {
    if (!this.breakoutManager) {
      return '❌ Breakout rooms are not available.';
    }

    if (!context.groupId) {
      return '❌ This command must be used within a group.';
    }

    // Build content from args and/or quoted message
    let content = args.trim();
    let quotedContent = context.quotedText?.trim();
    let usedAI = false;

    // If replying to a message, use quoted text as context
    if (quotedContent) {
      if (type === 'action') {
        // Extract assignee name for AI context
        let assigneeName: string | undefined;
        if (context.mentions && context.mentions.length > 0) {
          const firstMention = context.mentions[0];
          if (firstMention.uuid) {
            const names = await this.dbClient.getMemberDisplayNamesByUuids([firstMention.uuid]);
            assigneeName = names.get(firstMention.uuid);
          }
        }

        if (content) {
          // User provided additional context: "!action @person <extra instructions>"
          // Use AI to combine quoted message + user's instructions into clean task
          const combinedText = `${quotedContent}\n\nAdditional instructions: ${content}`;
          content = await this.extractTaskWithAI(combinedText, assigneeName);
          usedAI = true;
        } else {
          // Just the quoted message - use AI to extract clean task
          content = await this.extractTaskWithAI(quotedContent, assigneeName);
          usedAI = true;
        }
      } else if (type === 'decision' || type === 'park') {
        // For decision/park: use quoted text as content if no args provided
        if (!content) {
          content = quotedContent;
        } else {
          // If args provided, combine: "quoted text - user's note"
          content = `${quotedContent} — ${content}`;
        }
      }
    }

    if (!content) {
      const examples = {
        decision: '!decision We will use TypeScript for the new project\n\nOr reply to a message with just: !decision',
        action: '!action @alice Review the PR by Friday\n\nOr reply to a message with: !action @alice',
        park: '!park Discuss budget allocation in next meeting\n\nOr reply to a message with just: !park',
      };
      return `❌ Please provide content for the ${type}.\n\nExample: ${examples[type]}`;
    }

    // Extract assignee for action items (if not already extracted above)
    let assignedToUuid: string | undefined;
    let assignedToName: string | undefined;
    if (type === 'action' && context.mentions && context.mentions.length > 0) {
      const firstMention = context.mentions[0];
      if (firstMention.uuid) {
        assignedToUuid = firstMention.uuid;
        // Check if we already looked up the name
        if (!assignedToName) {
          const names = await this.dbClient.getMemberDisplayNamesByUuids([assignedToUuid]);
          assignedToName = names.get(assignedToUuid);
        }
      }
    }

    // Get breakout room info for context
    const breakout = await this.breakoutManager.getActiveBreakout(context.groupId);

    const result = await this.breakoutManager.handleAnnotation(
      context.groupId,
      type,
      content,
      context.sourceUuid || context.sourceNumber,
      context.sourceName,
      assignedToUuid,
      assignedToName
    );

    // For action items, send DM to assigned person
    if (type === 'action' && assignedToUuid && result.success && this.bot) {
      try {
        const breakoutTopic = breakout?.topic || 'Breakout Room';
        const assignerName = context.sourceName || 'Someone';

        const dmMessage = `📋 New Action Item Assigned

From: ${assignerName}
Breakout: ${breakoutTopic}

Task: ${content}

Reply to this message if you have questions.`;

        await this.bot.sendMessage({
          recipient: assignedToUuid,
          message: dmMessage,
        });
        console.log(`✅ Sent action item DM to ${assignedToName || assignedToUuid}`);

        // Build response with AI indicator if used
        let response = result.message;
        if (usedAI) {
          response += '\n\n🤖 Task extracted by AI from quoted message.';
        }
        response += `\n\n📬 ${assignedToName || 'Assignee'} has been notified via DM.`;
        return response;
      } catch (dmError) {
        console.error('Failed to send action item DM:', dmError);
        // Still return success, but note that DM failed
        let response = result.message;
        if (usedAI) {
          response += '\n\n🤖 Task extracted by AI from quoted message.';
        }
        response += '\n\n⚠️ Could not send DM notification.';
        return response;
      }
    }

    // Add AI indicator for non-action types or actions without DM
    if (usedAI) {
      return `${result.message}\n\n🤖 Task extracted by AI from quoted message.`;
    }

    return result.message;
  }

  /**
   * !parked / !listparked - List all parked items in the breakout room
   */
  private async handleListParked(context: CommandContext): Promise<string> {
    if (!context.groupId) {
      return '❌ This command must be used within a group.';
    }

    if (!this.breakoutManager) {
      return '❌ Breakout rooms are not available.';
    }

    // Get active breakout for this group
    const breakout = await this.dbClient.getActiveBreakoutByGroupId(context.groupId);
    if (!breakout) {
      return '❌ No active breakout room in this group.\n\nParking lot is available during active breakout sessions.';
    }

    // Get all parked items
    const annotations = await this.dbClient.getBreakoutAnnotations(breakout.id);
    const parkedItems = annotations.filter((a: any) => a.annotation_type === 'park' && a.status !== 'done');

    if (parkedItems.length === 0) {
      return '🅿️ Parking Lot is Empty\n\nUse !park <topic> to add items for later discussion.';
    }

    let response = `🅿️ Parking Lot (${parkedItems.length} item${parkedItems.length !== 1 ? 's' : ''})\n\n`;

    parkedItems.forEach((item: any, index: number) => {
      const creator = item.created_by_name || 'Someone';
      response += `${index + 1}. ${item.content}\n`;
      response += `   └ parked by ${creator}\n`;
    });

    response += '\n━━━━━━━━━━━━━━━━━━━━━━━━\n';
    response += 'Use !unpark <number> to address and remove an item';

    return response;
  }

  /**
   * !unpark - Remove an item from the parking lot (mark as addressed)
   */
  private async handleUnpark(args: string, context: CommandContext): Promise<string> {
    if (!context.groupId) {
      return '❌ This command must be used within a group.';
    }

    if (!this.breakoutManager) {
      return '❌ Breakout rooms are not available.';
    }

    // Get active breakout for this group
    const breakout = await this.dbClient.getActiveBreakoutByGroupId(context.groupId);
    if (!breakout) {
      return '❌ No active breakout room in this group.';
    }

    const trimmedArgs = args.trim();

    // Get all parked items
    const annotations = await this.dbClient.getBreakoutAnnotations(breakout.id);
    const parkedItems = annotations.filter((a: any) => a.annotation_type === 'park' && a.status !== 'done');

    if (parkedItems.length === 0) {
      return '🅿️ Parking lot is empty. Nothing to unpark.';
    }

    // Parse the number
    const itemNumber = parseInt(trimmedArgs);
    if (isNaN(itemNumber) || itemNumber < 1 || itemNumber > parkedItems.length) {
      return `❌ Please provide a valid item number (1-${parkedItems.length}).\n\nUsage: !unpark <number>\nUse !parked to see the list.`;
    }

    const itemToUnpark = parkedItems[itemNumber - 1];

    try {
      // Mark as done/addressed
      await this.dbClient.updateBreakoutAnnotationStatus(itemToUnpark.id, 'done');

      return `✅ Unparked: "${itemToUnpark.content}"\n\n` +
        `Item has been marked as addressed and removed from the parking lot.`;
    } catch (error) {
      console.error('Error unparking item:', error);
      return '❌ Failed to unpark item. Please try again.';
    }
  }

  /**
   * !complete / !done - Mark an action item as completed
   *
   * Usage:
   * - Reply to an action message with !complete
   * - !complete (marks most recent action assigned to you)
   * - !complete <content match> (marks action matching text)
   */
  private async handleCompleteAction(args: string, context: CommandContext): Promise<string> {
    if (!context.groupId) {
      return '❌ This command must be used within a group.';
    }

    // Get active breakout for this group
    const breakout = await this.dbClient.getActiveBreakoutByGroupId(context.groupId);
    if (!breakout) {
      return '❌ No active breakout room in this group.';
    }

    const completedBy = context.sourceName || context.sourceUuid || 'Someone';
    const completedByUuid = context.sourceUuid || context.sourceNumber;

    // If replying to a message, try to find the action from quoted text
    if (context.quotedText) {
      // Look for action in breakout annotations that matches quoted text
      const annotations = await this.dbClient.getBreakoutAnnotations(breakout.id);
      const actionAnnotations = annotations.filter(
        (a: any) => a.annotation_type === 'action' && a.status === 'open'
      );

      // Find action that matches quoted text (partial match)
      const quotedLower = context.quotedText.toLowerCase().trim();
      const matchingAction = actionAnnotations.find((a: any) =>
        a.content.toLowerCase().includes(quotedLower) ||
        quotedLower.includes(a.content.toLowerCase().substring(0, 30))
      );

      if (matchingAction) {
        await this.dbClient.updateBreakoutAnnotationStatus(matchingAction.id, 'done');

        // Notify the assigner if different from completer
        if (matchingAction.created_by_uuid && matchingAction.created_by_uuid !== completedByUuid && this.bot) {
          try {
            await this.bot.sendMessage({
              recipient: matchingAction.created_by_uuid,
              message: `✅ Action completed by ${completedBy}!\n\nTask: ${matchingAction.content}\n\nBreakout: ${breakout.topic}`,
            });
          } catch (e) {
            console.error('Failed to notify action creator:', e);
          }
        }

        return `✅ Action marked as complete!\n\nTask: ${matchingAction.content}\n\nCompleted by: ${completedBy}`;
      }
    }

    // If args provided, search for matching action
    if (args.trim()) {
      const annotations = await this.dbClient.getBreakoutAnnotations(breakout.id);
      const actionAnnotations = annotations.filter(
        (a: any) => a.annotation_type === 'action' && a.status === 'open'
      );

      const searchLower = args.toLowerCase().trim();
      const matchingAction = actionAnnotations.find((a: any) =>
        a.content.toLowerCase().includes(searchLower)
      );

      if (matchingAction) {
        await this.dbClient.updateBreakoutAnnotationStatus(matchingAction.id, 'done');

        return `✅ Action marked as complete!\n\nTask: ${matchingAction.content}\n\nCompleted by: ${completedBy}`;
      }

      return `❌ No open action found matching: "${args}"\n\nTry replying to the action message with !complete`;
    }

    // No args and no quote - try to find most recent action assigned to this user
    const annotations = await this.dbClient.getBreakoutAnnotations(breakout.id);
    const myActions = annotations.filter(
      (a: any) =>
        a.annotation_type === 'action' &&
        a.status === 'open' &&
        a.assigned_to_uuid === completedByUuid
    );

    if (myActions.length === 0) {
      // List open actions
      const openActions = annotations.filter(
        (a: any) => a.annotation_type === 'action' && a.status === 'open'
      );

      if (openActions.length === 0) {
        return '✅ No open actions in this breakout room.';
      }

      let msg = '📋 Open actions in this breakout:\n\n';
      for (let i = 0; i < Math.min(openActions.length, 5); i++) {
        const a = openActions[i];
        msg += `${i + 1}. ${a.content}`;
        if (a.assigned_to_name) msg += ` (assigned to ${a.assigned_to_name})`;
        msg += '\n';
      }
      msg += '\nReply to an action message with !complete to mark it done.';
      return msg;
    }

    // Complete the most recent action assigned to this user
    const mostRecent = myActions[myActions.length - 1];
    await this.dbClient.updateBreakoutAnnotationStatus(mostRecent.id, 'done');

    // Notify creator
    if (mostRecent.created_by_uuid && mostRecent.created_by_uuid !== completedByUuid && this.bot) {
      try {
        await this.bot.sendMessage({
          recipient: mostRecent.created_by_uuid,
          message: `✅ Action completed by ${completedBy}!\n\nTask: ${mostRecent.content}\n\nBreakout: ${breakout.topic}`,
        });
      } catch (e) {
        console.error('Failed to notify action creator:', e);
      }
    }

    return `✅ Action marked as complete!\n\nTask: ${mostRecent.content}\n\nCompleted by: ${completedBy}`;
  }

  /**
   * !action / !task - Create a task or view task details
   *
   * Usage:
   * - !task #123 - View task details
   * - !task @person Do the thing - Create and assign task
   * - !action @person Review the PR
   * - Reply to a message with: !task @person
   */
  private async handleGlobalTask(args: string, context: CommandContext): Promise<string> {
    // Check if viewing a task by ID (e.g., "!task #123" or "!task 123")
    const viewMatch = args.trim().match(/^#?(\d+)$/);
    if (viewMatch) {
      const taskId = parseInt(viewMatch[1]);
      const task = await this.dbClient.getTaskById(taskId);
      if (!task) {
        return `❌ Task #${taskId} not found.`;
      }

      // Build detailed view
      const statusEmojis: Record<string, string> = {
        'open': '🔵',
        'in_progress': '▶️',
        'done': '✅',
        'cancelled': '❌',
        'blocked': '🚫',
      };
      const priorityEmojis: Record<string, string> = {
        'low': '🔵',
        'normal': '⚪',
        'high': '🟠',
        'urgent': '🔴',
      };

      let msg = `📋 Task #${task.id}\n\n`;
      msg += `${statusEmojis[task.status] || '⚪'} Status: ${task.status.toUpperCase()}\n`;
      if (task.priority !== 'normal') {
        msg += `${priorityEmojis[task.priority]} Priority: ${task.priority.toUpperCase()}\n`;
      }
      msg += `\n📝 ${task.content}\n`;

      if (task.assigned_to_name) {
        msg += `\n👤 Assigned to: ${task.assigned_to_name}`;
      }
      if (task.created_by_name) {
        msg += `\n👤 Created by: ${task.created_by_name}`;
      }
      if (task.group_name) {
        msg += `\n📍 Group: ${task.group_name}`;
      }
      if (task.breakout_topic) {
        msg += `\n🔀 Breakout: ${task.breakout_topic}`;
      }

      const createdAt = new Date(task.created_at);
      msg += `\n📅 Created: ${createdAt.toLocaleDateString()}`;

      if (task.status === 'done' && task.completed_at) {
        const completedAt = new Date(task.completed_at);
        msg += `\n✅ Completed: ${completedAt.toLocaleDateString()}`;
        if (task.completed_by_name) {
          msg += ` by ${task.completed_by_name}`;
        }
      }

      if (task.due_date) {
        msg += `\n⏰ Due: ${new Date(task.due_date).toLocaleDateString()}`;
      }

      if (task.completion_notes) {
        msg += `\n\n📝 Notes: ${task.completion_notes}`;
      }

      // Add available actions
      if (task.status === 'open' || task.status === 'in_progress') {
        msg += '\n\n📌 Actions:';
        msg += `\n• !complete #${task.id} - Mark done`;
        msg += `\n• !cancel #${task.id} - Cancel`;
        msg += `\n• !priority #${task.id} high - Set priority`;
        msg += `\n• !assign #${task.id} @person - Reassign`;
      } else if (task.status === 'done' || task.status === 'cancelled') {
        msg += `\n\n📌 Use !reopen #${task.id} to reopen this task`;
      }

      return msg;
    }

    // Build content from args and/or quoted message
    let content = args.trim();
    let quotedContent = context.quotedText?.trim();
    let rawContent = content;
    let usedAI = false;

    // Extract ALL assignees from mentions (support multiple!)
    const assignees: Array<{ uuid: string; name?: string }> = [];
    if (context.mentions && context.mentions.length > 0) {
      const mentionUuids = context.mentions
        .filter(m => m.uuid)
        .map(m => m.uuid as string);

      if (mentionUuids.length > 0) {
        const names = await this.dbClient.getMemberDisplayNamesByUuids(mentionUuids);
        for (const uuid of mentionUuids) {
          assignees.push({ uuid, name: names.get(uuid) });
        }
      }
    }

    // For AI extraction, use first assignee name as context
    const firstAssigneeName = assignees.length > 0 ? assignees[0].name : undefined;

    // If replying to a message, use quoted text as context
    if (quotedContent) {
      if (content) {
        // User provided additional context: "!task @person <extra instructions>"
        const combinedText = `${quotedContent}\n\nAdditional instructions: ${content}`;
        rawContent = combinedText;
        content = await this.extractTaskWithAI(combinedText, firstAssigneeName);
        usedAI = true;
      } else {
        // Just the quoted message - use AI to extract clean task
        rawContent = quotedContent;
        content = await this.extractTaskWithAI(quotedContent, firstAssigneeName);
        usedAI = true;
      }
    }

    if (!content) {
      return `❌ Please provide a task description.

Usage:
• !task @person Do the thing
• !action @user1 @user2 Review the PR - assigns to multiple people
• Reply to a message with !task @person to convert it to a task`;
    }

    // Get breakout info if in a breakout room
    let breakoutId: number | undefined;
    let breakoutTopic: string | undefined;
    if (this.breakoutManager && context.groupId) {
      const breakout = await this.breakoutManager.getActiveBreakout(context.groupId);
      if (breakout) {
        breakoutId = breakout.id;
        breakoutTopic = breakout.topic;
      }
    }

    // Get group info
    let groupName: string | undefined;
    if (context.groupId) {
      const group = await this.dbClient.getGroupById(context.groupId);
      groupName = group?.name;
    }

    // Create task(s) - one for each assignee if multiple, or one unassigned if none
    try {
      const createdTasks: Array<{ id: number; assigneeName?: string }> = [];
      const dmsSent: string[] = [];
      const dmsFailed: string[] = [];

      // If no assignees, create single unassigned task
      if (assignees.length === 0) {
        const task = await this.dbClient.createTask({
          content,
          rawContent: usedAI ? rawContent : undefined,
          breakoutId,
          groupId: context.groupId,
          groupName,
          createdByUuid: context.sourceUuid || context.sourceNumber,
          createdByName: context.sourceName,
          aiExtracted: usedAI,
          sourceMessageTimestamp: context.timestamp,
        });
        createdTasks.push({ id: task.id });
      } else {
        // Create a task for EACH assignee
        for (const assignee of assignees) {
          const task = await this.dbClient.createTask({
            content,
            rawContent: usedAI ? rawContent : undefined,
            breakoutId,
            groupId: context.groupId,
            groupName,
            createdByUuid: context.sourceUuid || context.sourceNumber,
            createdByName: context.sourceName,
            assignedToUuid: assignee.uuid,
            assignedToName: assignee.name,
            aiExtracted: usedAI,
            sourceMessageTimestamp: context.timestamp,
          });
          createdTasks.push({ id: task.id, assigneeName: assignee.name });

          // Also create breakout annotation if in a breakout
          if (breakoutId && this.breakoutManager) {
            await this.breakoutManager.handleAnnotation(
              context.groupId!,
              'action',
              content,
              context.sourceUuid || context.sourceNumber,
              context.sourceName,
              assignee.uuid,
              assignee.name
            );
          }

          // Send DM to assignee
          if (this.bot) {
            try {
              const assignerName = context.sourceName || 'Someone';
              const contextInfo = breakoutTopic
                ? `Breakout: ${breakoutTopic}`
                : groupName
                  ? `Group: ${groupName}`
                  : 'Direct Message';

              const dmMessage = `📋 New Task Assigned

From: ${assignerName}
${contextInfo}

Task: ${content}

Reply to this message if you have questions.`;

              await this.bot.sendMessage({
                recipient: assignee.uuid,
                message: dmMessage,
              });
              await this.dbClient.markTaskDmSent(task.id);
              dmsSent.push(assignee.name || assignee.uuid);
              console.log(`✅ Sent task DM to ${assignee.name || assignee.uuid}`);
            } catch (dmError) {
              console.error('Failed to send task DM:', dmError);
              dmsFailed.push(assignee.name || assignee.uuid);
            }
          }
        }
      }

      // Build response
      let response: string;

      if (createdTasks.length === 1 && !createdTasks[0].assigneeName) {
        // Single unassigned task
        response = `✅ Task #${createdTasks[0].id} created\n\n📋 ${content}`;
      } else if (createdTasks.length === 1) {
        // Single assigned task
        response = `✅ Task #${createdTasks[0].id} created and assigned to ${createdTasks[0].assigneeName}\n\n📋 ${content}`;
      } else {
        // Multiple tasks created
        const taskIds = createdTasks.map(t => `#${t.id}`).join(', ');
        const assigneeNames = createdTasks.map(t => t.assigneeName).filter(Boolean).join(', ');
        response = `✅ ${createdTasks.length} tasks created (${taskIds})\n\n📋 ${content}\n\n👥 Assigned to: ${assigneeNames}`;
      }

      if (usedAI) {
        response += '\n\n🤖 Task extracted by AI';
      }

      if (dmsSent.length > 0) {
        if (dmsSent.length === 1) {
          response += `\n\n📬 ${dmsSent[0]} has been notified via DM.`;
        } else {
          response += `\n\n📬 ${dmsSent.length} people notified via DM.`;
        }
      }

      if (dmsFailed.length > 0) {
        response += `\n\n⚠️ Failed to DM: ${dmsFailed.join(', ')}`;
      }

      return response;
    } catch (error) {
      console.error('Failed to create task:', error);
      return '❌ Failed to create task. Please try again.';
    }
  }

  /**
   * !complete / !done - Mark a task as completed
   *
   * Usage:
   * - !complete #123 (complete by task ID - most reliable)
   * - Reply to a task message with !complete
   * - !complete (marks most recent task assigned to you)
   * - !complete <content match> (marks task matching text)
   */
  private async handleCompleteTask(args: string, context: CommandContext): Promise<string> {
    const completedBy = context.sourceName || context.sourceUuid || 'Someone';
    const completedByUuid = context.sourceUuid || context.sourceNumber;

    // First try global tasks table
    let task: any = null;

    // Check for #ID syntax (e.g., "!complete #123" or "!complete 123")
    const idMatch = args.trim().match(/^#?(\d+)$/);
    if (idMatch) {
      const taskId = parseInt(idMatch[1]);
      task = await this.dbClient.getTaskById(taskId);
      if (!task) {
        return `❌ Task #${taskId} not found.`;
      }
      if (task.status === 'done') {
        return `ℹ️ Task #${taskId} is already completed.`;
      }
      if (task.status === 'cancelled') {
        return `ℹ️ Task #${taskId} was cancelled. Use !reopen #${taskId} first.`;
      }
    }

    // If replying to a message, try to find the task from quoted text
    if (!task && context.quotedText) {
      task = await this.dbClient.findTaskByContent(
        context.quotedText.substring(0, 50),
        undefined,
        context.groupId
      );
    }

    // If args provided (not an ID), search for matching task
    if (!task && args.trim() && !idMatch) {
      task = await this.dbClient.findTaskByContent(
        args.trim(),
        completedByUuid,
        context.groupId
      );
    }

    // If no specific task found, get most recent task assigned to this user
    if (!task && completedByUuid) {
      task = await this.dbClient.getMostRecentOpenTask(completedByUuid, context.groupId);
    }

    if (task) {
      await this.dbClient.updateTaskStatus(task.id, 'done', completedByUuid, completedBy);

      // Notify the task creator if different from completer
      if (task.created_by_uuid && task.created_by_uuid !== completedByUuid && this.bot) {
        try {
          const contextInfo = task.breakout_topic
            ? `Breakout: ${task.breakout_topic}`
            : task.group_name
              ? `Group: ${task.group_name}`
              : '';

          await this.bot.sendMessage({
            recipient: task.created_by_uuid,
            message: `✅ Task completed by ${completedBy}!\n\nTask: ${task.content}${contextInfo ? `\n${contextInfo}` : ''}`,
          });
        } catch (e) {
          console.error('Failed to notify task creator:', e);
        }
      }

      return `✅ Task #${task.id} marked as complete!\n\nTask: ${task.content}\n\nCompleted by: ${completedBy}`;
    }

    // Fallback to breakout annotations if in a breakout room
    if (context.groupId && this.breakoutManager) {
      const breakout = await this.dbClient.getActiveBreakoutByGroupId(context.groupId);
      if (breakout) {
        // Use the old breakout-specific completion logic
        return this.handleCompleteAction(args, context);
      }
    }

    // List open tasks for this user
    if (completedByUuid) {
      const openTasks = await this.dbClient.getOpenTasksByAssignee(completedByUuid);

      if (openTasks.length === 0) {
        return '✅ You have no open tasks.';
      }

      let msg = '📋 Your open tasks:\n\n';
      for (let i = 0; i < Math.min(openTasks.length, 5); i++) {
        const t = openTasks[i];
        msg += `${i + 1}. [#${t.id}] ${t.content}`;
        if (t.group_name) msg += ` (${t.group_name})`;
        msg += '\n';
      }
      msg += '\nUse !complete <text> to mark a specific task done.';
      return msg;
    }

    return '❌ No task found to complete.';
  }

  /**
   * !tasks / !mytasks - List tasks
   *
   * Usage:
   * - !tasks - Show open tasks in current group
   * - !tasks @user1 @user2 - Show tasks for mentioned users
   * - !mytasks - Show your assigned tasks
   */
  private async handleListTasks(args: string, context: CommandContext): Promise<string> {
    const userUuid = context.sourceUuid || context.sourceNumber;

    // Check if users are mentioned - show tasks for those users
    if (context.mentions && context.mentions.length > 0) {
      const mentionedUuids = context.mentions
        .filter(m => m.uuid)
        .map(m => m.uuid as string);

      if (mentionedUuids.length === 0) {
        return '❌ Could not identify mentioned users.';
      }

      // Get display names for mentioned users
      const names = await this.dbClient.getMemberDisplayNamesByUuids(mentionedUuids);

      // Get tasks for all mentioned users
      const allTasks: any[] = [];
      for (const uuid of mentionedUuids) {
        const tasks = await this.dbClient.getOpenTasksByAssignee(uuid);
        allTasks.push(...tasks);
      }

      if (allTasks.length === 0) {
        const userNames = mentionedUuids
          .map(uuid => names.get(uuid) || 'Unknown')
          .join(', ');
        return `✅ No open tasks for ${userNames}.`;
      }

      // Build header with user names
      const userNames = mentionedUuids
        .map(uuid => names.get(uuid) || 'Unknown')
        .join(', ');

      let msg = `📋 Open tasks for ${userNames} (${allTasks.length}):\n\n`;

      // Group tasks by assignee if multiple users
      if (mentionedUuids.length > 1) {
        for (const uuid of mentionedUuids) {
          const userTasks = allTasks.filter(t => t.assigned_to_uuid === uuid);
          if (userTasks.length === 0) continue;

          const userName = names.get(uuid) || 'Unknown';
          msg += `👤 ${userName}:\n`;

          for (let i = 0; i < Math.min(userTasks.length, 5); i++) {
            const t = userTasks[i];
            const priority = t.priority !== 'normal' ? ` [${t.priority.toUpperCase()}]` : '';
            msg += `  ${i + 1}. [#${t.id}]${priority} ${t.content}\n`;
          }
          if (userTasks.length > 5) {
            msg += `  ... and ${userTasks.length - 5} more\n`;
          }
          msg += '\n';
        }
      } else {
        // Single user - show detailed view
        for (let i = 0; i < Math.min(allTasks.length, 10); i++) {
          const t = allTasks[i];
          const priority = t.priority !== 'normal' ? ` [${t.priority.toUpperCase()}]` : '';
          msg += `${i + 1}. [#${t.id}]${priority} ${t.content}`;
          if (t.group_name) msg += `\n   📍 ${t.group_name}`;
          if (t.breakout_topic) msg += ` → ${t.breakout_topic}`;
          if (t.created_by_name) msg += `\n   👤 From: ${t.created_by_name}`;
          msg += '\n\n';
        }
        if (allTasks.length > 10) {
          msg += `... and ${allTasks.length - 10} more tasks.`;
        }
      }

      msg += '\nUse !complete #ID to mark tasks done.';
      return msg;
    }

    // Check if looking for personal tasks or group tasks
    const isPersonal = args.toLowerCase().includes('my') || args.toLowerCase().includes('mine');

    if (isPersonal || !context.groupId) {
      // Show tasks assigned to this user
      if (!userUuid) {
        return '❌ Could not identify you.';
      }

      const tasks = await this.dbClient.getOpenTasksByAssignee(userUuid);

      if (tasks.length === 0) {
        return '✅ You have no open tasks assigned to you.';
      }

      let msg = `📋 Your open tasks (${tasks.length}):\n\n`;
      for (let i = 0; i < Math.min(tasks.length, 10); i++) {
        const t = tasks[i];
        const priority = t.priority !== 'normal' ? ` [${t.priority.toUpperCase()}]` : '';
        msg += `${i + 1}. [#${t.id}]${priority} ${t.content}`;
        if (t.group_name) msg += `\n   📍 ${t.group_name}`;
        if (t.breakout_topic) msg += ` → ${t.breakout_topic}`;
        if (t.created_by_name) msg += `\n   👤 From: ${t.created_by_name}`;
        msg += '\n\n';
      }

      if (tasks.length > 10) {
        msg += `... and ${tasks.length - 10} more tasks.`;
      }

      msg += '\nUse !complete to mark tasks done.';
      return msg;
    }

    // Show tasks in current group
    const tasks = await this.dbClient.getOpenTasksByGroup(context.groupId);

    if (tasks.length === 0) {
      return '✅ No open tasks in this group.';
    }

    let msg = `📋 Open tasks in this group (${tasks.length}):\n\n`;
    for (let i = 0; i < Math.min(tasks.length, 10); i++) {
      const t = tasks[i];
      msg += `${i + 1}. [#${t.id}] ${t.content}`;
      if (t.assigned_to_name) msg += `\n   👤 Assigned to: ${t.assigned_to_name}`;
      if (t.created_by_name) msg += ` | From: ${t.created_by_name}`;
      msg += '\n\n';
    }

    if (tasks.length > 10) {
      msg += `... and ${tasks.length - 10} more tasks.`;
    }

    return msg;
  }

  /**
   * Change task status (!cancel, !start, !block, !reopen)
   *
   * Usage:
   * - !cancel #123 - Cancel a task
   * - !start #123 - Mark task as in progress
   * - !block #123 reason - Mark task as blocked
   * - !reopen #123 - Reopen a completed/cancelled task
   */
  private async handleTaskStatusChange(
    newStatus: 'open' | 'in_progress' | 'done' | 'cancelled' | 'blocked',
    args: string,
    context: CommandContext
  ): Promise<string> {
    const userUuid = context.sourceUuid || context.sourceNumber;
    const userName = context.sourceName || 'Someone';

    // Parse task ID from args (e.g., "#123" or "123" or "#123 reason")
    const idMatch = args.trim().match(/^#?(\d+)(?:\s+(.*))?$/);
    if (!idMatch) {
      const statusNames: Record<string, string> = {
        'open': 'reopen',
        'in_progress': 'start',
        'cancelled': 'cancel',
        'blocked': 'block',
      };
      return `❌ Please specify a task ID.\n\nUsage: !${statusNames[newStatus] || newStatus} #123`;
    }

    const taskId = parseInt(idMatch[1]);
    const reason = idMatch[2]?.trim() || undefined;

    const task = await this.dbClient.getTaskById(taskId);
    if (!task) {
      return `❌ Task #${taskId} not found.`;
    }

    // Validate status transitions
    if (task.status === newStatus) {
      const statusLabels: Record<string, string> = {
        'open': 'already open',
        'in_progress': 'already in progress',
        'done': 'already completed',
        'cancelled': 'already cancelled',
        'blocked': 'already blocked',
      };
      return `ℹ️ Task #${taskId} is ${statusLabels[newStatus]}.`;
    }

    // Update the task status
    await this.dbClient.updateTaskStatus(
      taskId,
      newStatus,
      newStatus === 'done' ? userUuid : undefined,
      newStatus === 'done' ? userName : undefined,
      reason
    );

    // Build response
    const statusEmojis: Record<string, string> = {
      'open': '🔄',
      'in_progress': '▶️',
      'done': '✅',
      'cancelled': '❌',
      'blocked': '🚫',
    };
    const statusLabels: Record<string, string> = {
      'open': 'reopened',
      'in_progress': 'started',
      'done': 'completed',
      'cancelled': 'cancelled',
      'blocked': 'blocked',
    };

    let response = `${statusEmojis[newStatus]} Task #${taskId} ${statusLabels[newStatus]}!\n\n📋 ${task.content}`;

    if (reason && newStatus === 'blocked') {
      response += `\n\n🚧 Reason: ${reason}`;
    }

    // Notify relevant people
    if (this.bot) {
      // Notify assignee if different from actor
      if (task.assigned_to_uuid && task.assigned_to_uuid !== userUuid) {
        try {
          await this.bot.sendMessage({
            recipient: task.assigned_to_uuid,
            message: `${statusEmojis[newStatus]} Task ${statusLabels[newStatus]} by ${userName}\n\nTask #${taskId}: ${task.content}${reason ? `\n\nReason: ${reason}` : ''}`,
          });
        } catch (e) {
          console.error('Failed to notify assignee:', e);
        }
      }

      // Notify creator if different from actor and assignee
      if (task.created_by_uuid && task.created_by_uuid !== userUuid && task.created_by_uuid !== task.assigned_to_uuid) {
        try {
          await this.bot.sendMessage({
            recipient: task.created_by_uuid,
            message: `${statusEmojis[newStatus]} Task ${statusLabels[newStatus]} by ${userName}\n\nTask #${taskId}: ${task.content}${reason ? `\n\nReason: ${reason}` : ''}`,
          });
        } catch (e) {
          console.error('Failed to notify creator:', e);
        }
      }
    }

    return response;
  }

  /**
   * !priority - Set task priority
   *
   * Usage:
   * - !priority #123 high - Set priority to high
   * - !priority #123 urgent - Set priority to urgent
   */
  private async handleTaskPriority(args: string, context: CommandContext): Promise<string> {
    // Parse: #123 high OR 123 urgent
    const match = args.trim().match(/^#?(\d+)\s+(low|normal|high|urgent)$/i);
    if (!match) {
      return `❌ Please specify task ID and priority level.

Usage: !priority #123 <level>

Levels: low, normal, high, urgent`;
    }

    const taskId = parseInt(match[1]);
    const priority = match[2].toLowerCase();

    const task = await this.dbClient.getTaskById(taskId);
    if (!task) {
      return `❌ Task #${taskId} not found.`;
    }

    // Update priority in database
    await this.dbClient.updateTaskPriority(taskId, priority);

    const priorityEmojis: Record<string, string> = {
      'low': '🔵',
      'normal': '⚪',
      'high': '🟠',
      'urgent': '🔴',
    };

    return `${priorityEmojis[priority]} Task #${taskId} priority set to ${priority.toUpperCase()}\n\n📋 ${task.content}`;
  }

  /**
   * !assign - Assign or reassign a task
   *
   * Usage:
   * - !assign #123 @person - Assign task to person
   * - !assign #123 - Remove assignment (unassign)
   */
  private async handleTaskAssign(args: string, context: CommandContext): Promise<string> {
    const actorName = context.sourceName || 'Someone';

    // Parse: #123 @mention OR just #123
    const idMatch = args.trim().match(/^#?(\d+)/);
    if (!idMatch) {
      return `❌ Please specify a task ID.

Usage:
• !assign #123 @person - Assign to someone
• !assign #123 - Remove assignment`;
    }

    const taskId = parseInt(idMatch[1]);

    const task = await this.dbClient.getTaskById(taskId);
    if (!task) {
      return `❌ Task #${taskId} not found.`;
    }

    // Check for mention
    let newAssigneeUuid: string | null = null;
    let newAssigneeName: string | null = null;

    if (context.mentions && context.mentions.length > 0) {
      const mention = context.mentions[0];
      if (mention.uuid) {
        newAssigneeUuid = mention.uuid;
        const names = await this.dbClient.getMemberDisplayNamesByUuids([mention.uuid]);
        newAssigneeName = names.get(mention.uuid) || null;
      }
    }

    const previousAssignee = task.assigned_to_name || task.assigned_to_uuid;

    // Update assignment in database
    await this.dbClient.updateTaskAssignment(taskId, newAssigneeUuid, newAssigneeName);

    let response: string;

    if (newAssigneeUuid) {
      response = `✅ Task #${taskId} assigned to ${newAssigneeName || 'user'}\n\n📋 ${task.content}`;

      // Notify the new assignee via DM
      if (this.bot) {
        try {
          const contextInfo = task.group_name
            ? `Group: ${task.group_name}`
            : task.breakout_topic
              ? `Breakout: ${task.breakout_topic}`
              : '';

          await this.bot.sendMessage({
            recipient: newAssigneeUuid,
            message: `📋 Task Assigned to You

From: ${actorName}
${contextInfo}

Task #${taskId}: ${task.content}

Reply to this message if you have questions.`,
          });
          response += `\n\n📬 ${newAssigneeName || 'Assignee'} has been notified via DM.`;
        } catch (e) {
          console.error('Failed to notify new assignee:', e);
        }
      }

      // Notify previous assignee if different
      if (previousAssignee && task.assigned_to_uuid !== newAssigneeUuid && this.bot) {
        try {
          await this.bot.sendMessage({
            recipient: task.assigned_to_uuid,
            message: `ℹ️ Task #${taskId} has been reassigned to ${newAssigneeName || 'someone else'} by ${actorName}.\n\n📋 ${task.content}`,
          });
        } catch (e) {
          console.error('Failed to notify previous assignee:', e);
        }
      }
    } else {
      response = `✅ Task #${taskId} unassigned\n\n📋 ${task.content}`;

      if (previousAssignee) {
        response += `\n\nPreviously assigned to: ${previousAssignee}`;
      }
    }

    return response;
  }

  /**
   * !extend - Extend breakout room duration
   */
  private async handleBreakoutExtend(args: string, context: CommandContext): Promise<string> {
    if (!this.breakoutManager) {
      return '❌ Breakout rooms are not available.';
    }

    if (!context.groupId) {
      return '❌ This command must be used within a group.';
    }

    // Parse extension time (default 15 minutes)
    let additionalMinutes = 15;
    const match = args.match(/(\d+)(m|h)?/i);
    if (match) {
      const value = parseInt(match[1]);
      const unit = (match[2] || 'm').toLowerCase();
      additionalMinutes = unit === 'h' ? value * 60 : value;
      // Clamp to reasonable values
      additionalMinutes = Math.min(60, Math.max(5, additionalMinutes));
    }

    const result = await this.breakoutManager.extendDuration(
      context.groupId,
      additionalMinutes,
      context.sourceUuid || context.sourceNumber,
      context.sourceName
    );

    return result.message;
  }

  // ============================================================================
  // TODAY I LEARNED (TIL) HANDLERS
  // ============================================================================

  /**
   * !til - Save something you learned today
   *
   * Usage:
   * - Reply to a message with !til - saves that message as TIL
   * - !til 5 - saves last 5 messages as a TIL
   * - !til <text> - saves custom text as TIL
   * - !til (no args, no reply) - shows recent TILs (same as !tils)
   */
  private async handleTil(args: string, context: CommandContext): Promise<string> {
    if (!context.groupId) {
      return '❌ TIL command must be used within a group.';
    }

    const trimmedArgs = args.trim();
    const createdByUuid = context.sourceUuid || context.sourceNumber || 'unknown';
    const createdByName = context.sourceName || 'Someone';

    // Case 1: Reply to a message - save quoted message as TIL
    if (context.quotedText) {
      const originalMessages = context.quotedText;
      const totalChars = originalMessages.length;
      let aiSummary: string | undefined;

      // Generate AI summary if content > 300 characters
      if (totalChars > 300 && this.openai) {
        try {
          aiSummary = await this.generateTilSummary(originalMessages);
        } catch (err) {
          console.error('Failed to generate TIL summary:', err);
        }
      }

      const tilId = await this.dbClient.createTil({
        groupId: context.groupId,
        createdByUuid,
        createdByName,
        originalMessages,
        aiSummary,
        messageCount: 1,
        totalCharacters: totalChars,
      });

      let response = `💡 TIL #${tilId} saved!\n\n`;
      response += `"${originalMessages.substring(0, 200)}${originalMessages.length > 200 ? '...' : ''}"\n\n`;
      if (aiSummary) {
        response += `Summary: ${aiSummary}\n\n`;
      }
      response += `— Learned by ${createdByName}`;

      return response;
    }

    // Case 2: Number argument - get last N messages
    const numMatch = trimmedArgs.match(/^(\d+)$/);
    if (numMatch) {
      const count = Math.min(parseInt(numMatch[1]), 20); // Max 20 messages
      if (count < 1) {
        return '❌ Please specify a positive number (1-20).';
      }

      // Get recent messages from the group
      const recentMessages = await this.dbClient.getRecentMessages(context.groupId, count);
      if (recentMessages.length === 0) {
        return '❌ No recent messages found in this group.';
      }

      // Format messages into a transcript
      const transcript = recentMessages.map((msg: any) => {
        const name = msg.sender_name || msg.sender_number || 'Unknown';
        const text = msg.message_text || '';
        return `${name}: ${text}`;
      }).join('\n');

      const totalChars = transcript.length;
      let aiSummary: string | undefined;

      // Generate AI summary if content > 300 characters
      if (totalChars > 300 && this.openai) {
        try {
          aiSummary = await this.generateTilSummary(transcript);
        } catch (err) {
          console.error('Failed to generate TIL summary:', err);
        }
      }

      const tilId = await this.dbClient.createTil({
        groupId: context.groupId,
        createdByUuid,
        createdByName,
        originalMessages: transcript,
        aiSummary,
        messageCount: recentMessages.length,
        totalCharacters: totalChars,
      });

      let response = `💡 TIL #${tilId} saved from ${recentMessages.length} message${recentMessages.length !== 1 ? 's' : ''}!\n\n`;
      if (aiSummary) {
        response += `Summary: ${aiSummary}\n\n`;
      } else {
        response += `Preview:\n"${transcript.substring(0, 200)}${transcript.length > 200 ? '...' : ''}"\n\n`;
      }
      response += `— Learned by ${createdByName}`;

      return response;
    }

    // Case 3: Text argument - save custom TIL
    if (trimmedArgs.length > 0) {
      const originalMessages = trimmedArgs;
      const totalChars = originalMessages.length;
      let aiSummary: string | undefined;

      // Generate AI summary if content > 300 characters
      if (totalChars > 300 && this.openai) {
        try {
          aiSummary = await this.generateTilSummary(originalMessages);
        } catch (err) {
          console.error('Failed to generate TIL summary:', err);
        }
      }

      const tilId = await this.dbClient.createTil({
        groupId: context.groupId,
        createdByUuid,
        createdByName,
        originalMessages,
        aiSummary,
        messageCount: 1,
        totalCharacters: totalChars,
      });

      let response = `💡 TIL #${tilId} saved!\n\n`;
      response += `"${originalMessages.substring(0, 200)}${originalMessages.length > 200 ? '...' : ''}"\n\n`;
      if (aiSummary) {
        response += `Summary: ${aiSummary}\n\n`;
      }
      response += `— Learned by ${createdByName}`;

      return response;
    }

    // Case 4: No args, no reply - show recent TILs
    return this.handleListTils('', context);
  }

  /**
   * Generate AI summary for TIL content
   */
  private async generateTilSummary(content: string): Promise<string> {
    if (!this.openai) {
      throw new Error('OpenAI not configured');
    }

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that creates concise summaries of things people learned. Create a 1-2 sentence summary that captures the key insight or learning. Be direct and informative. Do not use markdown formatting.',
        },
        {
          role: 'user',
          content: `Summarize this TIL (Today I Learned) in 1-2 sentences:\n\n${content}`,
        },
      ],
      max_tokens: 150,
      temperature: 0.3,
    });

    return response.choices[0]?.message?.content || '';
  }

  /**
   * !tils / !listtil - List recent TILs
   *
   * Usage:
   * - !tils - shows last 5 TILs
   * - !tils 10 - shows last 10 TILs
   * - !tils #<id> - shows specific TIL
   * - !tils search <term> - search TILs
   */
  private async handleListTils(args: string, context: CommandContext): Promise<string> {
    if (!context.groupId) {
      return '❌ This command must be used within a group.';
    }

    const trimmedArgs = args.trim();

    // Case 1: Show specific TIL by ID
    const idMatch = trimmedArgs.match(/^#?(\d+)$/);
    if (idMatch) {
      const tilId = parseInt(idMatch[1]);
      const til = await this.dbClient.getTilById(tilId);

      if (!til) {
        return `❌ TIL #${tilId} not found.`;
      }

      if (til.group_id !== context.groupId) {
        return `❌ TIL #${tilId} is from a different group.`;
      }

      let response = `💡 TIL #${til.id}\n\n`;
      response += `${til.original_messages}\n\n`;
      if (til.ai_summary) {
        response += `Summary: ${til.ai_summary}\n\n`;
      }
      response += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      response += `Learned by: ${til.created_by_name || 'Unknown'}\n`;
      response += `Date: ${new Date(til.created_at).toLocaleDateString()}\n`;
      response += `Messages: ${til.message_count} | Characters: ${til.total_characters}`;

      return response;
    }

    // Case 2: Search TILs
    if (trimmedArgs.toLowerCase().startsWith('search ')) {
      const searchTerm = trimmedArgs.substring(7).trim();
      if (searchTerm.length < 2) {
        return '❌ Search term must be at least 2 characters.';
      }

      const tils = await this.dbClient.searchTils(context.groupId, searchTerm, 10);

      if (tils.length === 0) {
        return `❌ No TILs found matching "${searchTerm}".`;
      }

      let response = `🔍 Found ${tils.length} TIL${tils.length !== 1 ? 's' : ''} matching "${searchTerm}":\n\n`;

      for (const til of tils) {
        const preview = til.ai_summary || til.original_messages.substring(0, 80);
        const date = new Date(til.created_at).toLocaleDateString();
        response += `#${til.id} [${date}] ${til.created_by_name || 'Unknown'}:\n`;
        response += `  ${preview}${preview.length >= 80 ? '...' : ''}\n\n`;
      }

      response += `Use !tils #<id> to view full TIL`;

      return response;
    }

    // Case 3: List recent TILs (default or with count)
    let limit = 5;
    const countMatch = trimmedArgs.match(/^(\d+)$/);
    if (countMatch) {
      limit = Math.min(parseInt(countMatch[1]), 20);
    }

    const tils = await this.dbClient.getTilsForGroup(context.groupId, limit);
    const totalCount = await this.dbClient.getTilCount(context.groupId);

    if (tils.length === 0) {
      return '💡 No TILs saved yet in this group.\n\nUse !til to save something you learned:\n• Reply to a message with !til\n• !til 5 (save last 5 messages)\n• !til <your learning>';
    }

    let response = `💡 Recent TILs (${tils.length} of ${totalCount})\n\n`;

    for (const til of tils) {
      const preview = til.ai_summary || til.original_messages.substring(0, 80);
      const date = new Date(til.created_at).toLocaleDateString();
      response += `#${til.id} [${date}] ${til.created_by_name || 'Unknown'}:\n`;
      response += `  ${preview}${preview.length >= 80 ? '...' : ''}\n\n`;
    }

    response += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    response += `!tils #<id> - view full TIL\n`;
    response += `!tils search <term> - search TILs`;

    return response;
  }

  /**
   * Get the breakout manager instance (for message interception)
   */
  getBreakoutManager(): BreakoutManager | null {
    return this.breakoutManager;
  }
}
