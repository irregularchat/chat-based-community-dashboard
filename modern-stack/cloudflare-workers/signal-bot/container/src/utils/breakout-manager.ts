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
import OpenAI from 'openai';
import {
  analyzeTranscript,
  createMinimalAnalysis,
  mergeWithManualAnnotations,
  convertMessagesToTranscript,
  generateDiscourseReport,
  type BreakoutAnalysis,
  type RawAnnotation,
} from './breakout-analyzer.js';
import { extractURLs } from './url-security.js';

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
  private openai: OpenAI | null = null;
  private timerCheckInterval: NodeJS.Timeout | null = null;

  constructor(db: PostgresClient, bot: SignalBot, openaiApiKey?: string) {
    this.db = db;
    this.bot = bot;
    if (openaiApiKey) {
      this.openai = new OpenAI({ apiKey: openaiApiKey });
    }
  }

  /**
   * Set OpenAI client after construction (useful if API key isn't available at init)
   */
  setOpenAI(openai: OpenAI): void {
    this.openai = openai;
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

    // Format end time in multiple timezones
    const etTime = expiresAt.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true });
    const ctTime = expiresAt.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit', hour12: true });
    const ptTime = expiresAt.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', hour12: true });

    return `${roomTypeConfig.icon} Breakout Room Started

Topic: ${config.topic}
Type: ${roomTypeConfig.name}
Duration: ${durationStr}
Ends at: ${etTime} ET / ${ctTime} CT / ${ptTime} PT
Privacy: ${PRIVACY_MODES[config.privacyMode || 'summary_only']}

Commands:
  !decision <text> - Record a decision
  !action <text> @person - Assign action item
  !park <text> - Park topic for later
  !extend [15|30|60]m - Request extension
  !endbreakout - End session early

Warnings at 15min, 5min, 1min before end.`;
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

    // Extract any URLs from the message
    const urls = extractURLs(messageText);

    await this.db.recordBreakoutMessage({
      breakoutId: room.id,
      signalMessageId: messageId,
      senderUuid,
      senderName,
      messageText,
      timestamp,
      isReply,
      quotedText,
      urls: urls.length > 0 ? urls : undefined,
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

    // Get all data for analysis
    const messages = await this.db.getBreakoutMessages(room.id);
    const annotations = await this.db.getBreakoutAnnotations(room.id);
    const members = await this.db.getBreakoutMembers(room.id);
    const resources = await this.db.getBreakoutResources(room.id);

    // Calculate actual duration
    const startTime = new Date(room.created_at);
    const endTime = new Date();
    const actualDuration = Math.round((endTime.getTime() - startTime.getTime()) / 60000);

    // Generate AI analysis (Phase 3)
    let analysis: BreakoutAnalysis;
    const MIN_MESSAGES_FOR_AI = 3;

    if (this.openai && messages.length >= MIN_MESSAGES_FOR_AI) {
      try {
        console.log(`🤖 Generating AI analysis for breakout ${room.id} (${messages.length} messages)...`);

        // Convert messages to transcript
        const transcript = convertMessagesToTranscript(messages);

        // Run AI analysis
        analysis = await analyzeTranscript(transcript, this.openai, {
          topic: room.topic,
          roomType: room.room_type,
          participantCount: members.filter((m: any) => m.message_count > 0).length,
        });

        // Merge with manual annotations (they take priority)
        analysis = mergeWithManualAnnotations(analysis, annotations as RawAnnotation[]);

        console.log(`✅ AI analysis complete. Confidence: ${Math.round(analysis.summary_confidence_score * 100)}%`);

      } catch (err) {
        console.error('AI analysis failed, falling back to minimal analysis:', err);
        // Fall back to minimal analysis from annotations
        analysis = createMinimalAnalysis(annotations as RawAnnotation[]);
      }
    } else {
      // Not enough messages or no OpenAI - use minimal analysis
      if (!this.openai) {
        console.log('⚠️ OpenAI not configured, using minimal analysis');
      } else {
        console.log(`⚠️ Only ${messages.length} messages, using minimal analysis (need ${MIN_MESSAGES_FOR_AI}+)`);
      }
      analysis = createMinimalAnalysis(annotations as RawAnnotation[]);

      // Add basic summary if none from annotations
      if (!analysis.executive_summary || analysis.executive_summary === 'Summary could not be generated automatically.') {
        const activeParticipants = members.filter((m: any) => m.message_count > 0).length;
        analysis.executive_summary = `Breakout session "${room.topic}" completed with ${messages.length} messages from ${activeParticipants} participants.`;
        analysis.detailed_summary = `This ${room.room_type} session lasted ${actualDuration} minutes. ` +
          `${annotations.filter((a: any) => a.annotation_type === 'decision').length} decisions were recorded and ` +
          `${annotations.filter((a: any) => a.annotation_type === 'action').length} action items were assigned.`;
      }
    }

    // Prepare room info for Discourse report
    const roomTypeConfig = ROOM_TYPES[room.room_type as RoomType] || ROOM_TYPES.general;
    const participants = members
      .filter((m: any) => m.message_count > 0)
      .map((m: any) => ({
        name: m.member_name || 'Unknown',
        messageCount: m.message_count,
        role: m.role,
      }));

    // Generate Discourse report
    const discourseReport = generateDiscourseReport(
      analysis,
      {
        topic: room.topic,
        roomType: room.room_type,
        roomTypeIcon: roomTypeConfig.icon,
        roomTypeName: roomTypeConfig.name,
        parentGroupName: room.parent_group_name,
        facilitatorName: room.facilitator_name,
        duration: room.duration_minutes,
        actualDuration,
        startTime,
        endTime,
        totalMessages: messages.length,
      },
      participants,
      undefined, // conversationHighlights
      resources  // shared resources/URLs
    );

    // End the room with analysis data
    // Note: actualDurationMinutes is calculated automatically in the SQL query
    await this.db.endBreakoutRoom(room.id, {
      executiveSummary: analysis.executive_summary,
      detailedSummary: analysis.detailed_summary,
      summaryConfidenceScore: analysis.summary_confidence_score,
      decisionsJson: analysis.decisions,
      actionItemsJson: analysis.action_items,
      openQuestionsJson: analysis.open_questions,
      parkingLotJson: analysis.parking_lot,
      keyInsightsJson: analysis.key_insights,
    });

    // Post to Discourse first (before removing members) to get the URL
    let summaryUrl: string | undefined;
    if (room.auto_post_to_discourse) {
      try {
        const discourseResult = await this.db.postBreakoutToDiscourse(room.id, discourseReport);
        if (discourseResult.success) {
          summaryUrl = discourseResult.topicUrl;
        }
      } catch (err) {
        console.error('Failed to post to Discourse:', err);
      }
    }

    // Send summary to breakout group BEFORE removing members
    // This ensures all participants see the summary
    const decisionCount = analysis.decisions.length;
    const actionCount = analysis.action_items.length;

    let breakoutSummary = `🏁 Breakout Session Ended: ${room.topic}\n\n`;
    breakoutSummary += `📝 Summary: ${analysis.executive_summary}\n\n`;

    if (analysis.detailed_summary && analysis.detailed_summary !== analysis.executive_summary) {
      breakoutSummary += `${analysis.detailed_summary}\n\n`;
    }

    breakoutSummary += `📊 ${messages.length} messages | ${participants.length} participants | ${actualDuration}m\n`;

    if (decisionCount > 0) {
      breakoutSummary += `\n✅ Decisions (${decisionCount}):\n`;
      analysis.decisions.forEach((d: any, i: number) => {
        const decisionText = d.decision || d.content || d.text || (typeof d === 'string' ? d : JSON.stringify(d));
        breakoutSummary += `  ${i + 1}. ${decisionText}\n`;
      });
    }

    if (actionCount > 0) {
      breakoutSummary += `\n📋 Action Items (${actionCount}):\n`;
      analysis.action_items.forEach((a: any, i: number) => {
        const assignee = a.owner_name || a.assigned_to || a.assignee || '';
        const actionText = a.task || a.content || a.text || a.action || (typeof a === 'string' ? a : JSON.stringify(a));
        breakoutSummary += `  ${i + 1}. ${actionText}${assignee ? ` → ${assignee}` : ''}\n`;
      });
    }

    // Add shared resources/URLs if any
    if (resources.length > 0) {
      breakoutSummary += `\n📎 Resources Shared (${resources.length}):\n`;
      resources.forEach((r: any, i: number) => {
        breakoutSummary += `  ${i + 1}. ${r.url}\n`;
        if (r.context) {
          const contextPreview = r.context.length > 80 ? r.context.substring(0, 80) + '...' : r.context;
          breakoutSummary += `     └ "${contextPreview}"\n`;
        }
      });
    }

    if (summaryUrl) {
      breakoutSummary += `\n🔗 Full report: ${summaryUrl}`;
    }

    try {
      await this.bot.sendMessage({ groupId: room.signal_group_id, message: breakoutSummary });
      console.log(`✅ Summary sent to breakout group ${room.id}`);
    } catch (err) {
      console.error('Failed to send summary to breakout group:', err);
    }

    // Remove all members from the breakout group (except the bot)
    try {
      const memberUuids = members
        .map((m: any) => m.member_uuid)
        .filter((uuid: string) => uuid); // Filter out any null/undefined

      if (memberUuids.length > 0) {
        console.log(`🚪 Removing ${memberUuids.length} members from breakout group...`);
        await this.bot.removeGroupMembers(room.signal_group_id, memberUuids);
        console.log(`✅ Removed all members from breakout group`);
      }
    } catch (err) {
      console.error('Failed to remove members from breakout group:', err);
      // Don't fail the whole operation if member removal fails
    }

    // Notify parent group if configured
    if (room.notify_parent_on_end) {
      let parentMessage = `📋 Breakout Ended: ${room.topic}\n\n`;
      parentMessage += `Summary: ${analysis.executive_summary}\n\n`;
      parentMessage += `📊 ${messages.length} messages | ${participants.length} participants | ${actualDuration}m\n`;

      if (decisionCount > 0 || actionCount > 0) {
        parentMessage += `✅ ${decisionCount} decision${decisionCount !== 1 ? 's' : ''} | `;
        parentMessage += `📋 ${actionCount} action item${actionCount !== 1 ? 's' : ''}\n`;
      }

      if (summaryUrl) {
        parentMessage += `\n🔗 Full report: ${summaryUrl}`;
      }

      try {
        await this.bot.sendMessage({ groupId: room.parent_group_id, message: parentMessage });
      } catch (err) {
        console.error('Failed to notify parent group:', err);
      }
    }

    return {
      success: true,
      message: '🏁 Breakout session ended. Summary has been generated.' +
        (summaryUrl ? `\n\n🔗 Full report: ${summaryUrl}` : ''),
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
      warningMessage = '⏰ 1 minute remaining!\nPlease wrap up your discussion.';
      warningType = '1min';
    } else if (minutesLeft <= 5 && !room.warning_5min_sent) {
      warningMessage = '⏰ 5 minutes remaining!\n' +
        'Start wrapping up. Use !decision to capture final decisions.';
      warningType = '5min';
    } else if (minutesLeft <= 15 && !room.warning_15min_sent) {
      warningMessage = '⏰ 15 minutes remaining!\n' +
        'Consider capturing decisions and action items.\n' +
        'Use !extend 15m if you need more time.';
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
        message: '🏁 Time is up! This breakout session has ended.\n' +
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

    let message = '🚀 Active Breakout Rooms:\n\n';
    for (const room of breakouts) {
      const expiresAt = new Date(room.expires_at);
      const minutesLeft = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 60000));
      const typeIcon = ROOM_TYPES[room.room_type as RoomType]?.icon || '💬';

      message += `${typeIcon} ${room.topic}\n`;
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

    let message = '📋 Recent Breakout Sessions:\n\n';
    for (const room of breakouts) {
      const createdAt = new Date(room.created_at);
      const typeIcon = ROOM_TYPES[room.room_type as RoomType]?.icon || '💬';
      const statusIcon = room.status === 'active' ? '🟢' : room.status === 'ended' ? '✅' : '⚪';

      message += `${statusIcon} ${typeIcon} ${room.topic}\n`;
      message += `   ${createdAt.toLocaleDateString()} - ${room.actual_duration_minutes || room.duration_minutes}m\n`;
      message += `   ${room.unique_participants || 0} participants, ${room.total_messages || 0} messages\n`;

      if (room.discourse_topic_url) {
        message += `   📋 ${room.discourse_topic_url}\n`;
      }
      message += '\n';
    }

    return message;
  }

  /**
   * Handle emoji reaction to join a breakout room
   * Called when someone reacts to a message in a group that has an active breakout
   *
   * @param parentGroupId - The group where the reaction happened
   * @param reactorUuid - UUID of the person who reacted
   * @param reactorName - Name of the person who reacted
   * @param emoji - The emoji they reacted with
   * @returns Result of the join attempt
   */
  async handleReactionJoin(
    parentGroupId: string,
    reactorUuid: string,
    reactorName: string | undefined,
    emoji: string
  ): Promise<{
    success: boolean;
    breakout?: { topic: string; groupId: string };
    alreadyMember?: boolean;
    error?: string;
  }> {
    try {
      // Find active breakout from this parent group
      const breakouts = await this.db.getActiveBreakoutsFromParent(parentGroupId);

      if (breakouts.length === 0) {
        // No active breakout - silently ignore (not an error, just no action needed)
        return { success: false, error: 'no_breakout' };
      }

      // Use the most recent active breakout (usually there's only one)
      const breakout = breakouts[0];

      if (!breakout.signal_group_id) {
        return { success: false, error: 'breakout_no_group' };
      }

      // Check if already a member
      const existingMember = await this.db.getBreakoutMember(breakout.id, reactorUuid);
      if (existingMember) {
        return { success: true, alreadyMember: true, breakout: { topic: breakout.topic, groupId: breakout.signal_group_id } };
      }

      // Add to Signal group
      try {
        await this.bot.addGroupMember(breakout.signal_group_id, reactorUuid);
      } catch (addErr) {
        console.error('Failed to add member to Signal group:', addErr);
        // Continue anyway - they might have joined through another means
      }

      // Add to database
      await this.db.addBreakoutMember({
        breakoutId: breakout.id,
        memberUuid: reactorUuid,
        memberName: reactorName,
        role: 'participant',
      });

      console.log(`✅ ${reactorName || reactorUuid} joined breakout "${breakout.topic}" via ${emoji} reaction`);

      // Send welcome message to the new member in the breakout group
      try {
        await this.bot.sendMessage({
          groupId: breakout.signal_group_id,
          message: `👋 ${reactorName || 'Someone'} has joined the breakout!`,
        });
      } catch (msgErr) {
        console.error('Failed to send join notification:', msgErr);
      }

      // Send catch-up DM to the new member with current session summary
      try {
        const catchUpSummary = await this.generateCatchUpSummary(breakout.id, breakout);
        if (catchUpSummary) {
          await this.bot.sendMessage({ recipient: reactorUuid, message: catchUpSummary });
          console.log(`📨 Sent catch-up DM to ${reactorName || reactorUuid}`);
        }
      } catch (dmErr) {
        console.error('Failed to send catch-up DM:', dmErr);
        // Don't fail the join if DM fails
      }

      return {
        success: true,
        breakout: { topic: breakout.topic, groupId: breakout.signal_group_id },
      };

    } catch (error) {
      console.error('Error handling reaction join:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Generate a catch-up summary for new members joining mid-session
   * Includes: topic, time remaining, decisions, actions, open questions, and key discussion points
   */
  private async generateCatchUpSummary(breakoutId: number, breakout: any): Promise<string | null> {
    try {
      // Get current data
      const messages = await this.db.getBreakoutMessages(breakoutId);
      const annotations = await this.db.getBreakoutAnnotations(breakoutId);
      const members = await this.db.getBreakoutMembers(breakoutId);

      // If no messages yet, just send basic info
      if (messages.length === 0) {
        return null; // No summary needed for empty session
      }

      const roomTypeConfig = ROOM_TYPES[breakout.room_type as RoomType] || ROOM_TYPES.general;
      const expiresAt = new Date(breakout.expires_at);
      const minutesLeft = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 60000));
      const activeParticipants = members.filter((m: any) => m.message_count > 0).length;

      // Build catch-up message (no markdown - Signal doesn't render it)
      let summary = `📋 Breakout Catch-Up: ${breakout.topic}\n\n`;
      summary += `${roomTypeConfig.icon} ${roomTypeConfig.name} | ⏰ ${minutesLeft}m remaining\n`;
      summary += `👥 ${activeParticipants} active participants | 💬 ${messages.length} messages\n\n`;

      // Add decisions
      const decisions = annotations.filter((a: any) => a.annotation_type === 'decision');
      if (decisions.length > 0) {
        summary += `✅ Decisions Made (${decisions.length}):\n`;
        decisions.forEach((d: any, i: number) => {
          summary += `  ${i + 1}. ${d.content}\n`;
        });
        summary += '\n';
      }

      // Add action items
      const actions = annotations.filter((a: any) => a.annotation_type === 'action');
      if (actions.length > 0) {
        summary += `📋 Action Items (${actions.length}):\n`;
        actions.forEach((a: any, i: number) => {
          const assignee = a.assigned_to_name ? ` → ${a.assigned_to_name}` : '';
          summary += `  ${i + 1}. ${a.content}${assignee}\n`;
        });
        summary += '\n';
      }

      // Add open questions
      const questions = annotations.filter((a: any) => a.annotation_type === 'question');
      if (questions.length > 0) {
        summary += `❓ Open Questions (${questions.length}):\n`;
        questions.forEach((q: any, i: number) => {
          summary += `  ${i + 1}. ${q.content}\n`;
        });
        summary += '\n';
      }

      // Add parked items
      const parked = annotations.filter((a: any) => a.annotation_type === 'park');
      if (parked.length > 0) {
        summary += `🅿️ Parked for Later (${parked.length}):\n`;
        parked.forEach((p: any, i: number) => {
          summary += `  ${i + 1}. ${p.content}\n`;
        });
        summary += '\n';
      }

      // Generate AI summary of discussion if we have enough messages and OpenAI is available
      const MIN_MESSAGES_FOR_AI_CATCHUP = 5;
      if (this.openai && messages.length >= MIN_MESSAGES_FOR_AI_CATCHUP) {
        try {
          const transcript = convertMessagesToTranscript(messages);
          const aiSummary = await this.generateQuickSummary(transcript, breakout.topic);
          if (aiSummary) {
            summary += `📝 Discussion Summary:\n${aiSummary}\n\n`;
          }
        } catch (err) {
          console.error('Failed to generate AI catch-up summary:', err);
          // Continue without AI summary
        }
      } else if (messages.length > 0) {
        // Fallback: show recent topic highlights from messages
        const recentMessages = messages.slice(-5);
        summary += `💬 Recent Discussion:\n`;
        recentMessages.forEach((m: any) => {
          const name = m.sender_name || 'Someone';
          const text = m.message_text.substring(0, 100) + (m.message_text.length > 100 ? '...' : '');
          summary += `  • ${name}: "${text}"\n`;
        });
        summary += '\n';
      }

      summary += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      summary += `Commands: !decision, !action, !question, !park, !extend`;

      return summary;

    } catch (error) {
      console.error('Error generating catch-up summary:', error);
      return null;
    }
  }

  /**
   * Generate a quick summary using AI (shorter than full analysis)
   */
  private async generateQuickSummary(transcript: string, topic: string): Promise<string | null> {
    if (!this.openai) return null;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are summarizing an ongoing breakout discussion for someone who just joined.
Be concise (2-3 sentences max). Focus on:
- Main topics being discussed
- Key points of agreement or disagreement
- Current focus of the conversation

Do NOT repeat decisions or action items (those are listed separately).`,
          },
          {
            role: 'user',
            content: `Topic: ${topic}\n\nTranscript so far:\n${transcript}`,
          },
        ],
        max_tokens: 150,
        temperature: 0.3,
      });

      return response.choices[0]?.message?.content?.trim() || null;
    } catch (error) {
      console.error('AI quick summary error:', error);
      return null;
    }
  }
}
