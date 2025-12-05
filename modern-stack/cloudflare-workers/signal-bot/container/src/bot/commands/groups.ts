import { Command, CommandContext, CommandResponse } from './base-command';
import { isAdmin } from '../../utils/auth';

export class GroupsCommand extends Command {
  public name = 'groups';
  public description = 'Group management commands';
  public aliases = ['refreshgroups', 'addto', 'join', 'leave'];

  public async handle(context: CommandContext, args: string): Promise<CommandResponse> {
    const subCommand = context.message?.split(' ')[0].substring(1);
    switch (subCommand) {
      case 'groups':
        return this.handleGroups(context);
      case 'refreshgroups':
        return this.handleRefreshGroups(context);
      case 'addto':
        return this.handleAddTo(context, args);
      case 'join':
        return this.handleJoin(context, args);
      case 'leave':
        return this.handleLeave(context, args);
      default:
        return `❓ Unknown group command.`;
    }
  }

  private async handleGroups(context: CommandContext): Promise<string> {
    if (!this.bot) {
      return '❌ Bot instance not available';
    }

    try {
      const allGroups = await this.bot.getGroups();

      const groups = allGroups.filter((g: any) => {
        const name = g.name || '';
        if (name.startsWith('🎲')) return false;
        if (name.includes('Dice Game -')) return false;
        if (name.includes("'s Neon Room")) return false;
        return true;
      });

      if (groups.length === 0) {
        return '📱 No Signal groups found';
      }

      groups.sort((a: any, b: any) => (b.members?.length || 0) - (a.members?.length || 0));

      const lines = [
        '📱 Signal Groups (Sorted by Size):',
        '',
      ];

      const uniqueMembers = new Set<string>();
      let totalSlots = 0;
      let adminGroupCount = 0;

      for (let index = 0; index < groups.length; index++) {
        const group = groups[index];
        const memberCount = group.members?.length || 0;
        totalSlots += memberCount;

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

        const adminBadge = await this.isBotAdminAsync(group) ? ' 👑' : ' 👤';
        if (adminBadge === ' 👑') adminGroupCount++;

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

  private async handleRefreshGroups(context: CommandContext): Promise<string> {
    if (!this.bot) {
      return '❌ Bot instance not available';
    }

    try {
      console.log('🔄 Force refreshing groups from signal-cli...');
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

  private async handleAddTo(context: CommandContext, args: string): Promise<string> {
    const isUserAdmin = await isAdmin(this.db, context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
      return '❌ Admin-only command';
    }

    if (!this.bot) {
      return '❌ Bot instance not available';
    }

    const parts = args.trim().split(/\s+/);
    let groupSelector = '';

    const isGroupSelector = (s: string): boolean => {
      if (!s || s.length === 0) return false;
      if (s.startsWith('+')) return false;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return false;
      if (s.includes('\uFFFC')) return false;
      if (!/[a-zA-Z0-9]/.test(s)) return false;
      return true;
    };

    if (parts.length > 0 && isGroupSelector(parts[0])) {
      groupSelector = parts[0];
    }
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

    const userIdentifiers: string[] = [];

    if (context.mentions && context.mentions.length > 0) {
      for (const mention of context.mentions) {
        const identifier = mention.uuid || mention.number;
        if (identifier) {
          userIdentifiers.push(identifier);
        }
      }
    }

    if (userIdentifiers.length === 0) {
      const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
      const uuids = args.match(uuidRegex);
      if (uuids) {
        userIdentifiers.push(...uuids);
      }

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

      const sortedGroups = [...groups].sort((a: any, b: any) => {
        const countA = a.members?.length || 0;
        const countB = b.members?.length || 0;
        return countB - countA;
      });

      const selectorParts = groupSelector.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0);

      const targetGroups: Map<string, { group: any; matchedBy: string }> = new Map();
      const unmatchedSelectors: string[] = [];
      const skippedShort: string[] = [];

      for (const part of selectorParts) {
        const num = parseInt(part);
        if (!isNaN(num) && num > 0) {
          const group = sortedGroups[num - 1];
          if (group && !targetGroups.has(group.id)) {
            targetGroups.set(group.id, { group, matchedBy: `#${num}` });
          } else if (!group) {
            unmatchedSelectors.push(`#${num}`);
          }
        } else {
          if (part.length < 3) {
            skippedShort.push(part);
            continue;
          }
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

  private async handleJoin(context: CommandContext, args: string): Promise<string> {
    if (!this.bot) {
      return '❌ Bot instance not available';
    }

    const userUuid = context.sourceUuid;

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

      const sortedGroups = [...groups].sort((a: any, b: any) => {
        const countA = a.members?.length || 0;
        const countB = b.members?.length || 0;
        return countB - countA;
      });

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
          index: i + 1,
          canJoin: isAdmin && !userInGroup,
          isAdmin,
          userInGroup,
        });
      }

      const joinableGroups = groupInfo.filter(g => g.canJoin);

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

      const parts = args.trim().toLowerCase().split(/\s+/);
      const selectedGroups: typeof groupInfo = [];
      const errors: string[] = [];

      for (const part of parts) {
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

        const matches = groupInfo.filter((g) =>
          g.group.name?.toLowerCase().includes(part) &&
          g.canJoin &&
          !selectedGroups.some(s => s.index === g.index)
        );
        if (matches.length === 0) {
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

  private async handleLeave(context: CommandContext, args: string): Promise<string> {
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

  private async isBotAdminAsync(group: any): Promise<boolean> {
    // This function can be moved to a utility file
    return false;
  }
  
  private async addUserToGroup(userPhone: string, groupId: string): Promise<void> {
    if (!this.bot) {
      throw new Error('Bot instance not available');
    }

    try {
      await this.bot.updateGroup({
        groupId: groupId,
        member: [userPhone],
      });

      console.log(`✅ Added ${userPhone} to group ${groupId} via JSON-RPC`);
    } catch (error) {
      console.error(`Failed to add user via JSON-RPC: ${error}`);
      throw new Error(`Failed to add user to group: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  private async isVerifiedCommunityMember(userUuid: string | undefined): Promise<{
    isVerified: boolean;
    memberGroups: string[];
    reason?: string;
  }> {
    if (!userUuid) {
      return { isVerified: false, memberGroups: [], reason: 'No user UUID provided' };
    }

    if (!this.db) {
      return { isVerified: false, memberGroups: [], reason: 'Database not available' };
    }

    try {
      const result = await this.db.query(
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

  private formatForSignal(text: string): string {
    return text
      .replace(/^#{1,6}\s+(.+)$/gm, (_, content) => content.toUpperCase())
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
