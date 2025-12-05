/**
 * Command Handler
 *
 * This class is now a command loader and router. It dynamically loads all command
 * modules from the `commands` directory and delegates the `handle` call to the
 * appropriate command module.
 */

import { BotConfig } from './signal-bot-v2.js';
import { PostgresClient } from '../db/postgres-client.js';
import OpenAI from 'openai';
import { BreakoutManager } from '../utils/breakout-manager.js';
import { Command, CommandContext, CommandResponse } from './commands/base-command.js';
import { PingCommand } from './commands/ping.js';
import { HelpCommand } from './commands/help.js';
import { AiCommand } from './commands/ai.js';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class CommandHandler {
  private config: BotConfig;
  private dbClient: PostgresClient;
  private openai: OpenAI | null = null;
  private bot: any | null = null;
  private breakoutManager: BreakoutManager | null = null;
  private commands: Map<string, Command> = new Map();

  constructor(config: BotConfig, dbClient: PostgresClient) {
    this.config = config;
    this.dbClient = dbClient;

    if (config.openAiActive && config.openAiApiKey) {
      this.openai = new OpenAI({
        apiKey: config.openAiApiKey,
      });
    }
  }

  setBotInstance(bot: any): void {
    this.bot = bot;
    this.breakoutManager = new BreakoutManager(this.dbClient, this.bot);
    this.breakoutManager.startTimerLoop(60000); // Check every minute
    console.log('🚀 Breakout room manager initialized');

    this.loadCommands();
  }

  private async loadCommands(): Promise<void> {
    const commandsDir = path.join(__dirname, 'commands');
    const files = fs.readdirSync(commandsDir);

    for (const file of files) {
      if (file.endsWith('.ts') && file !== 'base-command.ts') {
        try {
          const module = await import(path.join(commandsDir, file));
          for (const key in module) {
            const CommandClass = module[key];
            if (typeof CommandClass === 'function' && CommandClass.prototype instanceof Command) {
              const command = new CommandClass(this.bot, this.dbClient, this.openai, this.breakoutManager, this.config);
              this.commands.set(command.name, command);
              for (const alias of command.aliases) {
                this.commands.set(alias, command);
              }
            }
          }
        } catch (error) {
          console.error(`Failed to load command from ${file}:`, error);
        }
      }
    }
    console.log(`Loaded ${this.commands.size} commands`);
  }

  async handle(command: string, context: CommandContext): Promise<CommandResponse> {
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    const commandInstance = this.commands.get(cmd.substring(1));
    if (commandInstance) {
      return commandInstance.handle(context, args);
    }
    else {
      return `❓ Unknown command: ${cmd}\n\nType !help for available commands.`;
    }
  }

  async handleMessage(message: string, context: CommandContext): Promise<CommandResponse> {
    // Check if the message is a reply to an AI response
    if (context.quotedText) {
      const aiCommand = this.commands.get('ai') as AiCommand;
      if (aiCommand) {
        return aiCommand.handleAIReply(message, context.quotedText, context);
      }
    }
    return null;
  }
}
