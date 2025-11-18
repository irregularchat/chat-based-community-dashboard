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
        return this.handleHelp();

      case '!ping':
        return this.handlePing();

      case '!ai':
        return this.handleAI(args, context);

      case '!ask':
        return this.handleAsk(args, context);

      case '!questions':
        return this.handleQuestions(context);

      case '!answer':
        return this.handleAnswer(args, context);

      case '!solve':
        return this.handleSolve(args, context);

      case '!whoami':
        return this.handleWhoAmI(context);

      case '!version':
        return this.handleVersion();

      case '!stats':
        return this.handleStats();

      default:
        // Unknown command
        return `❓ Unknown command: ${cmd}\n\nType !help for available commands.`;
    }
  }

  /**
   * !help - Show available commands
   */
  private async handleHelp(): Promise<string> {
    const lines = [
      '🤖 Signal Bot Commands:',
      '',
      '📋 General:',
      '  !help - Show this help message',
      '  !ping - Test bot responsiveness',
      '  !whoami - Show your info',
      '  !version - Bot version',
      '  !stats - Bot statistics',
      '',
    ];

    if (this.openai) {
      lines.push(
        '🤖 AI Features:',
        '  !ai <question> - Ask AI a question',
        ''
      );
    }

    lines.push(
      '❓ Q&A System:',
      '  !ask <question> - Ask a question',
      '  !questions - List recent questions',
      '  !answer <id> <answer> - Answer a question',
      '  !solve <id> - Mark question as solved',
      ''
    );

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
   * Format text for Signal (line breaks, etc.)
   */
  private formatForSignal(text: string): string {
    // Signal uses simple line breaks
    // No special formatting needed for now
    return text;
  }
}
