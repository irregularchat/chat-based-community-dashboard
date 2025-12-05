import { SignalBot } from '../signal-bot-v2';
import { PostgresClient } from '../../db/postgres-client';
import { OpenAI } from 'openai';
import { BreakoutManager } from '../../utils/breakout-manager';

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
  sourceUuid?: string;
  sourceName: string;
  groupId?: string;
  timestamp: number;
  quotedText?: string;
  quotedAttachments?: SignalAttachment[];
  quotedAuthor?: string;
  mentions?: Mention[];
  message?: string;
}

export interface CommandResponseWithAttachment {
  text: string;
  attachment?: string;
}

export type CommandResponse = string | CommandResponseWithAttachment | null;

export abstract class Command {
  public abstract name: string;
  public abstract description: string;
  public abstract aliases: string[];

  protected bot: SignalBot;
  protected db: PostgresClient;
  protected openai: OpenAI | null;
  protected breakoutManager: BreakoutManager | null;
  protected config: any;

  constructor(bot: SignalBot, db: PostgresClient, openai: OpenAI | null, breakoutManager: BreakoutManager | null, config: any) {
    this.bot = bot;
    this.db = db;
    this.openai = openai;
    this.breakoutManager = breakoutManager;
    this.config = config;
  }

  public abstract handle(context: CommandContext, args: string): Promise<CommandResponse>;
}
