/**
 * Breakout Room Manager
 *
 * Handles the lifecycle of breakout rooms:
 * - Creating breakout groups with @mention parsing
 * - Tracking messages and participation
 * - Timer warnings (15min, 5min, 1min)
 * - Auto-end and summarization
 * - Discourse posting
 */

import { PostgresClient } from '../db/postgres-client';
import type { SignalBot } from '../bot/signal-bot-v2';

// Room types with their configurations
export const ROOM_TYPES = {
  general: { icon: '💬', name: 'General Discussion' },
  brainstorm: { icon: '🧠', name: 'Brainstorming' },
  decision: { icon: '🎯', name: 'Decision Making' },
  planning: { icon: '📋', name: 'Planning' },
  retro: { icon: '🔄', name: 'Retrospective' },
  problem: { icon: '🔧', name: 'Problem Solving' },
  review: { icon: '👁️', name: 'Review' },
  sync: { icon: '🔗', name: 'Quick Sync' },
} as const;

export type RoomType = keyof typeof ROOM_TYPES;

// Privacy modes
export const PRIVACY_MODES = {
  public: 'Full transcript shared',
  private: 'No sharing (internal only)',
  summary_only: 'Only AI summary shared (default)',
  internal: 'Summary to parent group only',
} as const;

export type PrivacyMode = keyof typeof PRIVACY_MODES;

interface BreakoutConfig {
  topic: string;
  members: string[];  // UUIDs to invite
  memberNames?: Map<string, string>;  // UUID -> Name mapping
  roomType?: RoomType;
  durationMinutes?: number;
  privacyMode?: PrivacyMode;
  facilitatorUuid?: string;
}

interface ParsedBreakoutCommand {
  topic: string;
  mentionedUuids: string[];
  durationMinutes: number;
  roomType: RoomType;
  privacyMode: PrivacyMode;
}

export class BreakoutManager {
  private db: PostgresClient;
  private bot: SignalBot;
  private timerCheckInterval: NodeJS.Timeout | null = null;

  constructor(db: PostgresClient, bot: SignalBot) {
    this.db = db;
    this.bot = bot;
  }

  /**
   * Parse !breakout command arguments
   * Format: !breakout <topic> @person1 @person2 [30m|1h|2h] [type:brainstorm] [privacy:public]
   */
  parseBreakoutCommand(
    args: string,
    mentions: Array<{ uuid: string; start: number; length: number }> = []
  ): ParsedBreakoutCommand {
    // Extract mentioned UUIDs
    const mentionedUuids = mentions.map(m => m.uuid);

    // Default values
    let durationMinutes = 60;
    let roomType: RoomType = 'general';
    let privacyMode: PrivacyMode = 'summary_only';

    // Parse duration (e.g., 30m, 1h, 2h, 90m)
    const durationMatch = args.match(/(\d+)(m|h)/i);
    if (durationMatch) {
      const value = parseInt(durationMatch[1]);
      const unit = durationMatch[2].toLowerCase();
      durationMinutes = unit === 'h' ? value * 60 : value;
      // Clamp duration between 15 and 240 minutes
      durationMinutes = Math.min(240, Math.max(15, durationMinutes));
    }

    // Parse room type (e.g., type:brainstorm)
    const typeMatch = args.match(/type:(\w+)/i);
    if (typeMatch && typeMatch[1] in ROOM_TYPES) {
      roomType = typeMatch[1] as RoomType;
    }

    // Parse privacy mode (e.g., privacy:public)
    const privacyMatch = args.match(/privacy:(\w+)/i);
    if (privacyMatch && privacyMatch[1] in PRIVACY_MODES) {
      privacyMode = privacyMatch[1] as PrivacyMode;
    }

    // Extract topic (everything that's not a special token)
    let topic = args
      .replace(/(\d+)(m|h)/gi, '')
      .replace(/type:\w+/gi, '')
      .replace(/privacy:\w+/gi, '')
      .replace(/\uFFFC/g, '')  // Remove mention placeholders
      .trim();

    // If topic is empty after parsing, use a default
    if (!topic) {
      topic = 'Breakout Discussion';
    }

    return {
      topic,
      mentionedUuids,
      durationMinutes,
      roomType,
      privacyMode,
    };
  }

  /**
   * Create a new breakout room
   */
  async createBreakout(
    parentGroupId: string,
    parentGroupName: string | undefined,
    creatorUuid: string,
    creatorName: string | undefined,
    config: BreakoutConfig
  ): Promise<{
    success: boolean;
    breakoutId?: number;
    groupId?: string;
    error?: string;
  }> {
    try {
      const roomTypeConfig = ROOM_TYPES[config.roomType || 'general'];

      // Generate room name
      const roomName = `${roomTypeConfig.icon} ${config.topic.substring(0, 50)}`;

      // Create database record first
      const { id: breakoutId, expiresAt } = await this.db.createBreakoutRoom({
        parentGroupId,
        parentGroupName,
        topic: config.topic,
        roomName,
        roomType: config.roomType || 'general',
        creatorUuid,
        creatorName,
        facilitatorUuid: config.facilitatorUuid || creatorUuid,
        facilitatorName: config.facilitatorUuid ? config.memberNames?.get(config.facilitatorUuid) : creatorName,
        durationMinutes: config.durationMinutes || 60,
        privacyMode: config.privacyMode || 'summary_only',
      });

      // Create Signal group
      const members = [creatorUuid, ...config.members.filter(m => m !== creatorUuid)];

      const description = `Breakout: ${config.topic}\n` +
        `Type: ${roomTypeConfig.name}\n` +
        `Ends: ${expiresAt.toLocaleTimeString()}\n` +
        `Privacy: ${PRIVACY_MODES[config.privacyMode || 'summary_only']}`;

      let groupId: string;
      try {
        const result = await this.bot.createGroup({
          name: roomName,
          members,
          description,
        });
        groupId = result.groupId;
      } catch (err) {
        // If group creation fails, clean up the database record
        await this.db.updateBreakoutStatus(breakoutId, 'failed');
        throw err;
      }

      // Update database with Signal group ID
      await this.db.updateBreakoutSignalGroupId(breakoutId, groupId);

      // Add members to database
      await this.db.addBreakoutMember({
        breakoutId,
        memberUuid: creatorUuid,
        memberName: creatorName,
        role: 'creator',
      });

      for (const memberUuid of config.members) {
        if (memberUuid !== creatorUuid) {
          await this.db.addBreakoutMember({
            breakoutId,
            memberUuid,
            memberName: config.memberNames?.get(memberUuid),
            role: memberUuid === config.facilitatorUuid ? 'facilitator' : 'participant',
          });
        }
      }

      // Send welcome message to the breakout group
      const welcomeMessage = this.buildWelcomeMessage(config, expiresAt, roomTypeConfig);
      await this.bot.sendMessage({ groupId, message: welcomeMessage });

      return {
        success: true,
        breakoutId,
        groupId,
      };

    } catch (error) {
      console.error('Failed to create breakout room:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Build welcome message for breakout room
   */
  private buildWelcomeMessage(
    config: BreakoutConfig,
    expiresAt: Date,
    roomTypeConfig: { icon: string; name: string }
  ): string {
    const duration = config.durationMinutes || 60;
    const hours = Math.floor(duration / 60);
    const mins = duration % 60;
    const durationStr = hours > 0
      ? (mins > 0 ? `${hours}h ${mins}m` : `${hours}h`)
      : `${mins}m`;

    return `${roomTypeConfig.icon} **Breakout Room Started**

**Topic:** ${config.topic}
**Type:** ${roomTypeConfig.name}
**Duration:** ${durationStr}
**Ends at:** ${expiresAt.toLocaleTimeString()}
**Privacy:** ${PRIVACY_MODES[config.privacyMode || 'summary_only']}

**Commands available:**
• \`!decision <text>\` - Record a decision
• \`!action <text> @person\` - Assign an action item
• \`!park <text>\` - Park a topic for later
• \`!extend [15|30|60]m\` - Request time extension
• \`!endbreakout\` - End the session early

Warnings will be sent at 15min, 5min, and 1min before end.`;
  }

  /**
   * Check if a group is a breakout room
   */
  async isBreakoutRoom(groupId: string): Promise<boolean> {
    const room = await this.db.getActiveBreakoutByGroupId(groupId);
    return room !== null;
  }

  /**
   * Get active breakout for a group
   */
  async getActiveBreakout(groupId: string): Promise<any | null> {
    return await this.db.getActiveBreakoutByGroupId(groupId);
  }

  /**
   * Record a message in a breakout room
   */
  async recordMessage(
    groupId: string,
    messageId: string,
    senderUuid: string,
    senderName: string | undefined,
    messageText: string,
    timestamp: number,
    isReply: boolean = false,
    quotedText?: string
  ): Promise<boolean> {
    const room = await this.db.getActiveBreakoutByGroupId(groupId);
    if (!room) {
      return false;
    }

    // Ensure member exists in the room
    await this.db.addBreakoutMember({
      breakoutId: room.id,
      memberUuid: senderUuid,
      memberName: senderName,
      wasInvited: false,  // Late joiner
    });

    await this.db.recordBreakoutMessage({
      breakoutId: room.id,
      signalMessageId: messageId,
      senderUuid,
      senderName,
      messageText,
      timestamp,
      isReply,
      quotedText,
    });

    return true;
  }

  /**
   * Handle annotation commands (!decision, !action, !park, !question)
   */
  async handleAnnotation(
    groupId: string,
    annotationType: 'decision' | 'action' | 'park' | 'question',
    content: string,
    creatorUuid: string,
    creatorName: string | undefined,
    assignedToUuid?: string,
    assignedToName?: string
  ): Promise<{ success: boolean; message: string }> {
    const room = await this.db.getActiveBreakoutByGroupId(groupId);
    if (!room) {
      return { success: false, message: 'This is not an active breakout room.' };
    }

    await this.db.createBreakoutAnnotation({
      breakoutId: room.id,
      annotationType,
      content,
      createdByUuid: creatorUuid,
      createdByName: creatorName,
      assignedToUuid,
      assignedToName,
    });

    const icons = {
      decision: '✅',
      action: '📋',
      park: '🅿️',
      question: '❓',
    };

    const labels = {
      decision: 'Decision recorded',
      action: assignedToName ? `Action assigned to ${assignedToName}` : 'Action recorded',
      park: 'Parked for later',
      question: 'Question noted',
    };

    return {
      success: true,
      message: `${icons[annotationType]} ${labels[annotationType]}: "${content}"`,
    };
  }

  /**
   * Extend breakout room duration
   */
  async extendDuration(
    groupId: string,
    additionalMinutes: number,
    requestedByUuid: string,
    requestedByName?: string
  ): Promise<{ success: boolean; message: string }> {
    const room = await this.db.getActiveBreakoutByGroupId(groupId);
    if (!room) {
      return { success: false, message: 'This is not an active breakout room.' };
    }

    const result = await this.db.extendBreakoutDuration(room.id, additionalMinutes);

    if (!result.success) {
      return { success: false, message: result.error || 'Could not extend duration.' };
    }

    const extensionNumber = room.extension_count + 1;
    const remaining = room.max_extensions - extensionNumber;

    return {
      success: true,
      message: `⏰ Time extended by ${additionalMinutes} minutes!\n` +
        `New end time: ${result.newExpiresAt?.toLocaleTimeString()}\n` +
        `(${remaining} extension${remaining !== 1 ? 's' : ''} remaining)`,
    };
  }

  /**
   * End breakout room early
   */
  async endBreakout(
    groupId: string,
    endedByUuid: string,
    endedByName?: string
  ): Promise<{ success: boolean; message: string; summaryUrl?: string }> {
    const room = await this.db.getActiveBreakoutByGroupId(groupId);
    if (!room) {
      return { success: false, message: 'This is not an active breakout room.' };
    }

    // Generate summary (basic for now, AI in Phase 3)
    const messages = await this.db.getBreakoutMessages(room.id);
    const annotations = await this.db.getBreakoutAnnotations(room.id);
    const members = await this.db.getBreakoutMembers(room.id);

    // Basic summary
    const executiveSummary = `Breakout session "${room.topic}" ended.\n` +
      `Duration: ${room.duration_minutes} minutes\n` +
      `Total messages: ${messages.length}\n` +
      `Active participants: ${members.filter((m: any) => m.message_count > 0).length}`;

    // End the room with basic summary
    await this.db.endBreakoutRoom(room.id, {
      executiveSummary,
    });

    // Post to Discourse if configured
    let summaryUrl: string | undefined;
    if (room.auto_post_to_discourse) {
      const discourseResult = await this.db.postBreakoutToDiscourse(room.id);
      if (discourseResult.success) {
        summaryUrl = discourseResult.topicUrl;
      }
    }

    // Notify parent group if configured
    if (room.notify_parent_on_end) {
      const parentMessage = `📋 **Breakout Ended:** ${room.topic}\n` +
        `${messages.length} messages, ${members.filter((m: any) => m.message_count > 0).length} participants\n` +
        `Decisions: ${annotations.filter((a: any) => a.annotation_type === 'decision').length}\n` +
        `Action items: ${annotations.filter((a: any) => a.annotation_type === 'action').length}` +
        (summaryUrl ? `\n\nFull report: ${summaryUrl}` : '');

      try {
        await this.bot.sendMessage({ groupId: room.parent_group_id, message: parentMessage });
      } catch (err) {
        console.error('Failed to notify parent group:', err);
      }
    }

    return {
      success: true,
      message: '🏁 Breakout session ended. Summary has been generated.' +
        (summaryUrl ? `\n\nFull report: ${summaryUrl}` : ''),
      summaryUrl,
    };
  }

  /**
   * Start the timer check loop
   */
  startTimerLoop(intervalMs: number = 60000): void {
    if (this.timerCheckInterval) {
      clearInterval(this.timerCheckInterval);
    }

    this.timerCheckInterval = setInterval(() => {
      this.checkTimers().catch(err => {
        console.error('Error checking breakout timers:', err);
      });
    }, intervalMs);

    console.log('🕐 Breakout timer loop started');
  }

  /**
   * Stop the timer check loop
   */
  stopTimerLoop(): void {
    if (this.timerCheckInterval) {
      clearInterval(this.timerCheckInterval);
      this.timerCheckInterval = null;
      console.log('🕐 Breakout timer loop stopped');
    }
  }

  /**
   * Check all breakouts for warnings and expiration
   */
  async checkTimers(): Promise<void> {
    // Check for warnings
    const needWarnings = await this.db.getBreakoutsNeedingWarnings();
    for (const room of needWarnings) {
      await this.sendTimerWarnings(room);
    }

    // Check for expired
    const expired = await this.db.getExpiredBreakouts();
    for (const room of expired) {
      await this.autoEndBreakout(room);
    }
  }

  /**
   * Send timer warnings to a breakout room
   */
  private async sendTimerWarnings(room: any): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(room.expires_at);
    const minutesLeft = Math.floor((expiresAt.getTime() - now.getTime()) / 60000);

    let warningMessage: string | null = null;
    let warningType: '15min' | '5min' | '1min' | null = null;

    if (minutesLeft <= 1 && !room.warning_1min_sent) {
      warningMessage = '⏰ **1 minute remaining!**\nPlease wrap up your discussion.';
      warningType = '1min';
    } else if (minutesLeft <= 5 && !room.warning_5min_sent) {
      warningMessage = '⏰ **5 minutes remaining!**\n' +
        'Start wrapping up. Use `!decision` to capture final decisions.';
      warningType = '5min';
    } else if (minutesLeft <= 15 && !room.warning_15min_sent) {
      warningMessage = '⏰ **15 minutes remaining!**\n' +
        'Consider capturing decisions and action items.\n' +
        'Use `!extend 15m` if you need more time.';
      warningType = '15min';
    }

    if (warningMessage && warningType && room.signal_group_id) {
      try {
        await this.bot.sendMessage({ groupId: room.signal_group_id, message: warningMessage });
        await this.db.updateBreakoutWarningFlag(room.id, warningType);
      } catch (err) {
        console.error(`Failed to send ${warningType} warning to breakout ${room.id}:`, err);
      }
    }
  }

  /**
   * Automatically end an expired breakout
   */
  private async autoEndBreakout(room: any): Promise<void> {
    if (!room.signal_group_id) {
      // No group created, just mark as expired
      await this.db.updateBreakoutStatus(room.id, 'expired');
      return;
    }

    try {
      // Send final message
      await this.bot.sendMessage({
        groupId: room.signal_group_id,
        message: '🏁 **Time is up!** This breakout session has ended.\n' +
        'A summary is being generated and will be posted to the parent group.'
      });

      // End the breakout
      await this.endBreakout(room.signal_group_id, 'system', 'System (Auto-end)');

    } catch (err) {
      console.error(`Failed to auto-end breakout ${room.id}:`, err);
      await this.db.updateBreakoutStatus(room.id, 'expired');
    }
  }

  /**
   * Get list of active breakouts from a parent group
   */
  async getActiveBreakouts(parentGroupId: string): Promise<string> {
    const breakouts = await this.db.getActiveBreakoutsFromParent(parentGroupId);

    if (breakouts.length === 0) {
      return 'No active breakout rooms.';
    }

    let message = '**Active Breakout Rooms:**\n\n';
    for (const room of breakouts) {
      const expiresAt = new Date(room.expires_at);
      const minutesLeft = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 60000));
      const typeIcon = ROOM_TYPES[room.room_type as RoomType]?.icon || '💬';

      message += `${typeIcon} **${room.topic}**\n`;
      message += `   Time remaining: ${minutesLeft}m\n`;
      message += `   Participants: ${room.unique_participants || 0}\n`;
      message += `   Messages: ${room.total_messages || 0}\n\n`;
    }

    return message;
  }

  /**
   * Get recent breakouts history from a parent group
   */
  async getBreakoutsHistory(parentGroupId: string, limit: number = 5): Promise<string> {
    const breakouts = await this.db.getBreakoutsFromParent(parentGroupId, limit);

    if (breakouts.length === 0) {
      return 'No breakout history.';
    }

    let message = '**Recent Breakout Sessions:**\n\n';
    for (const room of breakouts) {
      const createdAt = new Date(room.created_at);
      const typeIcon = ROOM_TYPES[room.room_type as RoomType]?.icon || '💬';
      const statusIcon = room.status === 'active' ? '🟢' : room.status === 'ended' ? '✅' : '⚪';

      message += `${statusIcon} ${typeIcon} **${room.topic}**\n`;
      message += `   ${createdAt.toLocaleDateString()} - ${room.actual_duration_minutes || room.duration_minutes}m\n`;
      message += `   ${room.unique_participants || 0} participants, ${room.total_messages || 0} messages\n`;

      if (room.discourse_topic_url) {
        message += `   📋 ${room.discourse_topic_url}\n`;
      }
      message += '\n';
    }

    return message;
  }
}
