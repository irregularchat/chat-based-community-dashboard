/**
 * Emoji Reaction Handler
 *
 * Automatically reacts to messages containing specific keywords with configured emojis
 */

import * as fs from 'fs';
import * as path from 'path';

export interface EmojiReactionRule {
  keywords: string[];
  emoji: string;
  description: string;
  caseSensitive: boolean;
}

export interface EmojiReactionSettings {
  matchWholeWord: boolean;
  maxReactionsPerMessage: number;
  reactToOwnMessages: boolean;
  reactToCommands: boolean;
  debounceMs: number;
}

export interface EmojiReactionConfig {
  enabled: boolean;
  reactions: EmojiReactionRule[];
  settings: EmojiReactionSettings;
}

export class EmojiReactionHandler {
  private config: EmojiReactionConfig;
  private configPath: string;
  private lastReactionTimes: Map<string, number> = new Map();

  constructor(configPath?: string) {
    // Use absolute path in containerized environment, or relative path for development
    this.configPath = configPath || process.env.NODE_ENV === 'production'
      ? '/app/config/emoji-reactions.json'
      : path.join(process.cwd(), 'config/emoji-reactions.json');
    this.config = this.loadConfig();
  }

  /**
   * Load emoji reactions configuration from JSON file
   */
  private loadConfig(): EmojiReactionConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(configData) as EmojiReactionConfig;
        console.log(`✅ Loaded emoji reaction config: ${config.reactions.length} rules, enabled=${config.enabled}`);
        return config;
      } else {
        console.warn(`⚠️  Emoji reaction config not found at ${this.configPath}, using defaults`);
        return this.getDefaultConfig();
      }
    } catch (error) {
      console.error('Failed to load emoji reaction config:', error);
      return this.getDefaultConfig();
    }
  }

  /**
   * Default configuration if file doesn't exist
   */
  private getDefaultConfig(): EmojiReactionConfig {
    return {
      enabled: false,
      reactions: [],
      settings: {
        matchWholeWord: false,
        maxReactionsPerMessage: 3,
        reactToOwnMessages: false,
        reactToCommands: false,
        debounceMs: 1000,
      },
    };
  }

  /**
   * Reload configuration from disk
   */
  reloadConfig(): void {
    console.log('🔄 Reloading emoji reaction config...');
    this.config = this.loadConfig();
  }

  /**
   * Find matching emojis for a message
   */
  findMatchingEmojis(messageText: string, isCommand: boolean, isOwnMessage: boolean): string[] {
    if (!this.config.enabled) {
      return [];
    }

    // Skip commands if configured
    if (isCommand && !this.config.settings.reactToCommands) {
      return [];
    }

    // Skip own messages if configured
    if (isOwnMessage && !this.config.settings.reactToOwnMessages) {
      return [];
    }

    const matchedEmojis: string[] = [];
    const messageLower = this.config.settings.matchWholeWord
      ? messageText.toLowerCase()
      : messageText.toLowerCase();

    for (const rule of this.config.reactions) {
      // Stop if we've reached max reactions
      if (matchedEmojis.length >= this.config.settings.maxReactionsPerMessage) {
        break;
      }

      // Check if any keyword matches
      const matchText = rule.caseSensitive ? messageText : messageLower;

      for (const keyword of rule.keywords) {
        const searchKeyword = rule.caseSensitive ? keyword : keyword.toLowerCase();

        if (this.config.settings.matchWholeWord) {
          // Match whole words only
          const wordRegex = new RegExp(`\\b${this.escapeRegex(searchKeyword)}\\b`, 'i');
          if (wordRegex.test(matchText)) {
            matchedEmojis.push(rule.emoji);
            console.log(`🎯 Matched keyword "${keyword}" -> ${rule.emoji}`);
            break; // Only add emoji once per rule
          }
        } else {
          // Match anywhere in text
          if (matchText.includes(searchKeyword)) {
            matchedEmojis.push(rule.emoji);
            console.log(`🎯 Matched keyword "${keyword}" -> ${rule.emoji}`);
            break; // Only add emoji once per rule
          }
        }
      }
    }

    return matchedEmojis;
  }

  /**
   * Check if we should debounce this reaction
   */
  shouldDebounce(messageId: string): boolean {
    const now = Date.now();
    const lastTime = this.lastReactionTimes.get(messageId);

    if (lastTime && (now - lastTime) < this.config.settings.debounceMs) {
      return true;
    }

    this.lastReactionTimes.set(messageId, now);

    // Clean up old entries (older than 1 minute)
    for (const [id, time] of this.lastReactionTimes.entries()) {
      if (now - time > 60000) {
        this.lastReactionTimes.delete(id);
      }
    }

    return false;
  }

  /**
   * Get current configuration (for debugging/display)
   */
  getConfig(): EmojiReactionConfig {
    return this.config;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
