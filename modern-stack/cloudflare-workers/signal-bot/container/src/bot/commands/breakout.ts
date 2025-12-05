import { Command, CommandContext, CommandResponse } from './base-command';
import { ROOM_TYPES, PRIVACY_MODES, RoomType, PrivacyMode } from '../../utils/breakout-manager';

export class BreakoutCommand extends Command {
  public name = 'breakout';
  public description = 'Breakout room commands';
  public aliases = ['endbreakout', 'end', 'breakouts', 'invitebreakout', 'summary', 'decision', 'action', 'park', 'extend'];

  public async handle(context: CommandContext, args: string): Promise<CommandResponse> {
    const subCommand = context.message?.split(' ')[0].substring(1);
    switch (subCommand) {
      case 'breakout':
        return this.handleBreakout(context, args);
      case 'endbreakout':
      case 'end':
        return this.handleEndBreakout(context);
      case 'breakouts':
        return this.handleBreakouts(context);
      case 'invitebreakout':
        return this.handleInvite(context, args);
      case 'summary':
        return this.handleSummary(context);
      case 'decision':
        return this.handleBreakoutAnnotation('decision', context, args);
      case 'action':
        return this.handleBreakoutAnnotation('action', context, args);
      case 'park':
        return this.handleBreakoutAnnotation('park', context, args);
      case 'extend':
        return this.handleBreakoutExtend(context, args);
      default:
        return `❓ Unknown breakout command.`;
    }
  }

  private async handleBreakout(context: CommandContext, args: string): Promise<string> {
    if (!this.breakoutManager) {
      return '❌ Breakout rooms are not available. Bot not fully initialized.';
    }

    if (!context.groupId) {
      return '❌ Breakout rooms can only be created from within a group.';
    }

    if (!args.trim()) {
      return `🚀 **Breakout Rooms**

Create a temporary focused discussion group.

**Usage:** \`!breakout <topic> @person1 @person2 [duration] [type:...] [privacy:...]\`

**Examples:**
• \`!breakout API Design @alice @bob 30m\`
• \`!breakout Sprint Planning @team 1h type:planning\`
• \`!breakout Bug Triage @devs 45m type:problem privacy:private\`

**Duration:** 15m, 30m, 45m, 1h, 2h (default: 1h)

**Types:** general, brainstorm, decision, planning, retro, problem, review, sync

**Privacy:** public, private, summary_only (default), internal

Type \`!breakouts\` to see active breakout rooms.`;
    }

    const validMentions = (context.mentions || [])
      .filter((m): m is { uuid: string; start: number; length: number } => !!m.uuid);
    const parsed = this.breakoutManager.parseBreakoutCommand(args, validMentions);

    if (parsed.mentionedUuids.length === 0) {
      return '❌ Please @mention at least one person to invite to the breakout room.\n\nExample: `!breakout API Design @alice @bob 30m`';
    }

    const memberNames = await this.db.getMemberDisplayNamesByUuids(parsed.mentionedUuids);

    let parentGroupName: string | undefined;
    if (this.bot) {
      try {
        const groups = await this.bot.getGroups();
        const parentGroup = groups.find((g: any) => g.id === context.groupId);
        parentGroupName = parentGroup?.name;
      } catch (err) {
        // Ignore
      }
    }

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

    return `${typeInfo.icon} **Breakout Room Created!**

**Topic:** ${parsed.topic}
**Type:** ${typeInfo.name}
**Duration:** ${durationStr}
**Privacy:** ${PRIVACY_MODES[parsed.privacyMode]}
**Invited:** ${invitedNames}

The invitees have been added to a new Signal group for this discussion.`;
  }

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

  private async handleBreakouts(context: CommandContext): Promise<string> {
    if (!this.breakoutManager) {
      return '❌ Breakout rooms are not available.';
    }

    if (!context.groupId) {
      return '❌ This command must be used within a group.';
    }

    const isBreakout = await this.breakoutManager.isBreakoutRoom(context.groupId);

    if (isBreakout) {
      const breakout = await this.breakoutManager.getActiveBreakout(context.groupId);
      if (breakout) {
        const expiresAt = new Date(breakout.expires_at);
        const minutesLeft = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 60000));
        const typeIcon = ROOM_TYPES[breakout.room_type as RoomType]?.icon || '💬';

        const members = await this.db.getBreakoutMembers(breakout.id);
        const participantNames = members
          .filter((m: any) => m.message_count > 0)
          .sort((a: any, b: any) => b.message_count - a.message_count)
          .map((m: any) => {
            const role = m.role === 'creator' ? '👑' : m.role === 'facilitator' ? '🤝' : '';
            return `${m.member_name || 'Anonymous'}${role} (${m.message_count} msg)`;
          })
          .join(', ');

        return `${typeIcon} CURRENT BREAKOUT ROOM

Topic: ${breakout.topic}
Type: ${ROOM_TYPES[breakout.room_type as RoomType]?.name || 'General'}
Time remaining: ${minutesLeft} minutes
Messages: ${breakout.total_messages || 0}
Participants: ${breakout.unique_participants || 0}

Active Participants: ${participantNames || 'None'}

Commands:
• !decision <text> - Record a decision
• !action <text> - Record an action item
• !park <text> - Park a topic
• !extend 15m - Request extension
• !endbreakout - End session`;
      }
    }

    const detailedBreakouts = await this.breakoutManager.getDetailedActiveBreakouts(context.groupId);

    if (detailedBreakouts.length === 0) {
      return 'No active breakout rooms in this group.';
    }

    let response = 'ACTIVE BREAKOUT ROOMS:\n\n';
    for (const room of detailedBreakouts) {
      const expiresAt = new Date(room.expires_at);
      const minutesLeft = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 60000));
      const typeIcon = ROOM_TYPES[room.room_type as RoomType]?.icon || '💬';

      response += `${typeIcon} ${room.topic}\n`;
      response += `   Type: ${ROOM_TYPES[room.room_type as RoomType]?.name || 'General'}\n`;
      response += `   Time remaining: ${minutesLeft}m\n`;
      response += `   Messages: ${room.total_messages || 0}\n`;

      const participantNames = room.members
        .filter((m: any) => m.message_count > 0)
        .sort((a: any, b: any) => b.message_count - a.message_count)
        .map((m: any) => m.member_name || 'Anonymous')
        .join(', ');
      
      response += `   Active Participants: ${participantNames || 'None'}\n\n`;
    }

    return response;
  }

  private async handleInvite(context: CommandContext, args: string): Promise<string> {
    if (!this.breakoutManager) {
      return '❌ Breakout rooms are not available.';
    }

    if (!context.groupId) {
      return '❌ This command can only be used in a group.';
    }

    const isBreakout = await this.breakoutManager.isBreakoutRoom(context.groupId);
    if (!isBreakout) {
      return '❌ This command can only be used from within an active breakout room.';
    }

    const mentions = (context.mentions || []).filter((m): m is { uuid: string; start: number; length: number } => !!m.uuid);
    if (mentions.length === 0) {
      return '❌ Please @mention one or more users to invite.';
    }

    const memberUuids = mentions.map(m => m.uuid);
    const memberNames = await this.db.getMemberDisplayNamesByUuids(memberUuids);

    const result = await this.breakoutManager.inviteToBreakout(
      context.groupId,
      context.sourceUuid || context.sourceNumber,
      memberUuids,
      memberNames
    );

    if (!result.success) {
      return `❌ Failed to invite users: ${result.error}`;
    }

    const invitedNames = memberUuids
      .map(uuid => memberNames.get(uuid) || uuid.substring(0, 8) + '...')
      .join(', ');

    return `📨 Invites sent to: ${invitedNames}`;
  }

  private async handleSummary(context: CommandContext): Promise<string> {
    if (!this.breakoutManager) {
      return '❌ Breakout rooms are not available.';
    }

    if (!context.groupId) {
      return '❌ This command can only be used in a group.';
    }

    const isBreakout = await this.breakoutManager.isBreakoutRoom(context.groupId);
    if (!isBreakout) {
      return '❌ This command can only be used from within an active breakout room.';
    }

    const summary = await this.breakoutManager.generateMidSessionSummary(context.groupId);

    if (!summary) {
      return '❌ Could not generate summary. Not enough messages or AI is not configured.';
    }

    return `📝 **Mid-Session Summary**\n\n${summary}`;
  }

  private async handleBreakoutAnnotation(
    type: 'decision' | 'action' | 'park' | 'question',
    context: CommandContext,
    args: string
  ): Promise<string> {
    if (!this.breakoutManager) {
      return '❌ Breakout rooms are not available.';
    }

    if (!context.groupId) {
      return '❌ This command must be used within a group.';
    }

    if (!args.trim()) {
      const examples = {
        decision: '`!decision We will use TypeScript for the new project`',
        action: '`!action @alice Review the PR by Friday`',
        park: '`!park Discuss budget allocation in next meeting`',
        question: '`!question What is the scope of this project?`'
      };
      return `❌ Please provide content for the ${type}.\n\nExample: ${examples[type]}`;
    }

    let assignedToUuid: string | undefined;
    let assignedToName: string | undefined;
    if (type === 'action' && context.mentions && context.mentions.length > 0) {
      const firstMention = context.mentions[0];
      if (firstMention.uuid) {
        assignedToUuid = firstMention.uuid;
        const names = await this.db.getMemberDisplayNamesByUuids([assignedToUuid]);
        assignedToName = names.get(assignedToUuid);
      }
    }

    const result = await this.breakoutManager.handleAnnotation(
      context.groupId,
      type,
      args.trim(),
      context.sourceUuid || context.sourceNumber,
      context.sourceName,
      assignedToUuid,
      assignedToName
    );

    return result.message;
  }

  private async handleBreakoutExtend(context: CommandContext, args: string): Promise<string> {
    if (!this.breakoutManager) {
      return '❌ Breakout rooms are not available.';
    }

    if (!context.groupId) {
      return '❌ This command must be used within a group.';
    }

    let additionalMinutes = 15;
    const match = args.match(/(\d+)(m|h)?/i);
    if (match) {
      const value = parseInt(match[1]);
      const unit = (match[2] || 'm').toLowerCase();
      additionalMinutes = unit === 'h' ? value * 60 : value;
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
}
