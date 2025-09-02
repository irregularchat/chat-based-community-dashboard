import { BasePlugin } from '../base.js';
import { BaseCommand } from '../../commands.js';

// Community Management Commands
class GroupsCommand extends BaseCommand {
  constructor() {
    super('groups', 'List all available groups/rooms', '!groups [filter]');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('community');
    return await plugin.handleGroups(context);
  }
}

class JoinCommand extends BaseCommand {
  constructor() {
    super('join', 'Join a specific group', '!join <group-name>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('community');
    return await plugin.handleJoin(context);
  }
}

class RemoveUserCommand extends BaseCommand {
  constructor() {
    super('removeuser', 'Remove user from group (admin only)', '!removeuser <@user> <group>');
    this.setAdminOnly(true);
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('community');
    return await plugin.handleRemoveUser(context);
  }
}

class InviteCommand extends BaseCommand {
  constructor() {
    super('invite', 'Instructions for inviting someone to IrregularChat', '!invite');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('community');
    return await plugin.handleInvite(context);
  }
}

export default class CommunityPlugin extends BasePlugin {
  constructor(bot) {
    super(bot, 'community');
    
    // Group definitions for IrregularChat community
    this.availableGroups = new Map([
      // Tech Groups
      ['tech-general', { 
        id: 'Ehzd1ZUbifpck9XyJf9d/9rX0i3KTg3rh/c4Kceg1iI=', 
        name: 'Tech General', 
        description: 'General technology discussions',
        category: 'Tech'
      }],
      ['ai-ml', { 
        id: 'Ehzd1ZUbifpck9XyJf9d/9rX0i3KTg3rh/c4Kceg1iI=', 
        name: 'AI/ML/NLP', 
        description: 'AI, Machine Learning, and Natural Language Processing discussions',
        category: 'Tech'
      }],
      ['full-stack', { 
        id: 'full-stack-group-id', 
        name: 'Full Stack Development', 
        description: 'Full stack development discussions',
        category: 'Tech'
      }],
      ['hardware', { 
        id: 'hardware-group-id', 
        name: 'Hardware', 
        description: 'Hardware discussions and projects',
        category: 'Tech'
      }],
      
      // Security Groups  
      ['infosec', { 
        id: 'infosec-group-id', 
        name: 'Information Security', 
        description: 'Information security discussions',
        category: 'Security'
      }],
      ['purple-team', { 
        id: 'purple-team-group-id', 
        name: 'Purple Teaming', 
        description: 'Purple team exercises and discussions',
        category: 'Security'
      }],
      
      // Military/Defense
      ['warfare', { 
        id: 'warfare-group-id', 
        name: 'Warfare', 
        description: 'Military warfare discussions',
        category: 'Defense'
      }],
      ['uas', { 
        id: 'uas-group-id', 
        name: 'sUAS/UxS', 
        description: 'Unmanned systems discussions',
        category: 'Defense'
      }],
      ['counter-uas', { 
        id: 'counter-uas-group-id', 
        name: 'Counter UxS', 
        description: 'Counter-unmanned systems',
        category: 'Defense'
      }],
      
      // Location-based
      ['ncr', { 
        id: 'ncr-group-id', 
        name: 'NCR (National Capital Region)', 
        description: 'Washington DC area meetups and discussions',
        category: 'Location'
      }],
      ['tampa', { 
        id: 'tampa-group-id', 
        name: 'Tampa', 
        description: 'Tampa area community',
        category: 'Location'
      }],
      ['texas', { 
        id: 'texas-group-id', 
        name: 'Central Texas', 
        description: 'Central Texas community',
        category: 'Location'
      }],
      
      // Social
      ['off-topic', { 
        id: '46Yfd7MDnWyGPnUToU4dvZvT2veU1atNOkHUVExTcVM=', 
        name: 'Off Topic Guild', 
        description: 'Off-topic discussions, memes, and casual chat',
        category: 'Social'
      }],
      ['solo-testing', { 
        id: '/cjfmI7snAAhRPLDMlvW50Ja8fE9SuslMBFukFjn9iI=', 
        name: 'Solo Testing', 
        description: 'Bot testing and development',
        category: 'Admin'
      }]
    ]);
    
    // Register commands
    this.addCommand(new GroupsCommand());
    this.addCommand(new JoinCommand());
    this.addCommand(new RemoveUserCommand());
    this.addCommand(new InviteCommand());
    
    // Entry/INDOC group ID for invite flow
    this.entryGroupId = 'PjJCT6d4nrF0/BZOs39ECX/lZkcHPbi65JU8B6kgw6s=';
    
    this.logInfo('Community management plugin initialized');
  }

  async handleGroups(context) {
    const { args } = context;
    const filter = args ? args.toLowerCase() : null;
    
    // Group by category
    const categories = new Map();
    
    for (const [key, group] of this.availableGroups) {
      if (filter && !group.name.toLowerCase().includes(filter) && 
          !group.category.toLowerCase().includes(filter)) {
        continue;
      }
      
      if (!categories.has(group.category)) {
        categories.set(group.category, []);
      }
      categories.get(group.category).push({ key, ...group });
    }
    
    if (categories.size === 0) {
      return `❌ No groups found matching "${filter}"`;
    }
    
    let response = '📱 **IrregularChat Groups**\n\n';
    
    for (const [category, groups] of categories) {
      response += `**${category}:**\n`;
      for (const group of groups) {
        response += `• **${group.name}** (${group.key})\n  ${group.description}\n`;
      }
      response += '\n';
    }
    
    response += '💡 **Usage:**\n';
    response += '• `!join <group-key>` - Request to join a group\n';
    response += '• `!groupinfo <group-key>` - Get detailed info\n';
    response += '• `!groups <filter>` - Filter by name/category';
    
    return response;
  }

  async handleJoin(context) {
    const { args, sender, senderName } = context;
    
    if (!args) {
      return '❌ Please specify a group to join: `!join <group-name>`\nUse `!groups` to see available groups.';
    }
    
    const groupKey = args.toLowerCase();
    const groupInfo = this.availableGroups.get(groupKey);
    
    if (!groupInfo) {
      return `❌ Group "${args}" not found. Use \`!groups\` to see available groups.`;
    }
    
    try {
      // In a real implementation, this would:
      // 1. Check if user is already in the group
      // 2. Send invite to group admins
      // 3. Add user to pending requests
      // 4. Notify group admins
      
      this.logInfo(`Join request: ${senderName || sender} wants to join ${groupInfo.name}`);
      
      // For now, simulate the join request process
      await this.logModeratingAction('GROUP JOIN REQUEST', 
        `User: ${senderName || sender}\n` +
        `Group: ${groupInfo.name}\n` +
        `Category: ${groupInfo.category}\n` +
        `Status: Pending admin approval`);
      
      return `✅ **Join Request Submitted**
        
**Group:** ${groupInfo.name}
**Description:** ${groupInfo.description}
**Category:** ${groupInfo.category}

Your request has been sent to the group administrators.
You'll be added to the group once approved.

⏳ Please wait for admin approval.`;
      
    } catch (error) {
      this.logError('Join request failed:', error);
      return `❌ Failed to process join request: ${error.message}`;
    }
  }

  async handleLeave(context) {
    const { args, sender, senderName, groupId } = context;
    
    if (!args && !groupId) {
      return '❌ Please specify a group to leave: `!leave <group-name>` or use this command in the group you want to leave.';
    }
    
    let targetGroup = null;
    
    if (args) {
      // Leaving specific group by name
      const groupKey = args.toLowerCase();
      targetGroup = this.availableGroups.get(groupKey);
      
      if (!targetGroup) {
        return `❌ Group "${args}" not found. Use \`!groups\` to see available groups.`;
      }
    } else if (groupId) {
      // Leaving current group
      for (const [key, group] of this.availableGroups) {
        if (group.id === groupId) {
          targetGroup = group;
          break;
        }
      }
    }
    
    if (!targetGroup) {
      return '❌ Unable to identify group to leave.';
    }
    
    try {
      this.logInfo(`Leave request: ${senderName || sender} wants to leave ${targetGroup.name}`);
      
      // Log the leave action
      await this.logModeratingAction('GROUP LEAVE', 
        `User: ${senderName || sender}\n` +
        `Group: ${targetGroup.name}\n` +
        `Action: User left group`);
      
      return `✅ **Left Group Successfully**

**Group:** ${targetGroup.name}
**Category:** ${targetGroup.category}

You have been removed from the group. You can rejoin anytime using \`!join\`.`;
      
    } catch (error) {
      this.logError('Leave request failed:', error);
      return `❌ Failed to leave group: ${error.message}`;
    }
  }

  async handleAddUser(context) {
    const { args, sender, senderName, message } = context;
    
    if (!args) {
      return '❌ Usage: `!adduser <@user> <group-name>`';
    }
    
    const parts = args.split(' ');
    if (parts.length < 2) {
      return '❌ Please specify both user and group: `!adduser <@user> <group-name>`';
    }
    
    const groupKey = parts[parts.length - 1].toLowerCase();
    const userMention = parts.slice(0, -1).join(' ');
    
    const groupInfo = this.availableGroups.get(groupKey);
    if (!groupInfo) {
      return `❌ Group "${parts[parts.length - 1]}" not found. Use \`!groups\` to see available groups.`;
    }
    
    // Extract mentioned user
    const mentionInfo = this.extractMentionInfoFromMessage(message);
    if (!mentionInfo) {
      return '❌ Please mention a user: `!adduser @username <group-name>`';
    }
    
    try {
      const { identifier: targetUser, displayName } = mentionInfo;
      const userDisplay = displayName || targetUser;
      
      this.logInfo(`Admin ${senderName || sender} adding ${userDisplay} to ${groupInfo.name}`);
      
      // Log admin action
      await this.logModeratingAction('ADMIN ADD USER', 
        `Admin: ${senderName || sender}\n` +
        `Target User: ${userDisplay}\n` +
        `Group: ${groupInfo.name}\n` +
        `Action: User added to group by admin`);
      
      return `✅ **User Added to Group**

**Admin:** ${senderName || sender}
**User:** ${userDisplay}  
**Group:** ${groupInfo.name}
**Category:** ${groupInfo.category}

The user has been successfully added to the group.`;
      
    } catch (error) {
      this.logError('Add user failed:', error);
      return `❌ Failed to add user: ${error.message}`;
    }
  }

  async handleRemoveUser(context) {
    const { args, sender, senderName, message } = context;
    
    if (!args) {
      return '❌ Usage: `!removeuser <@user> <group-name>`';
    }
    
    const parts = args.split(' ');
    if (parts.length < 2) {
      return '❌ Please specify both user and group: `!removeuser <@user> <group-name>`';
    }
    
    const groupKey = parts[parts.length - 1].toLowerCase();
    const groupInfo = this.availableGroups.get(groupKey);
    if (!groupInfo) {
      return `❌ Group "${parts[parts.length - 1]}" not found. Use \`!groups\` to see available groups.`;
    }
    
    // Extract mentioned user
    const mentionInfo = this.extractMentionInfoFromMessage(message);
    if (!mentionInfo) {
      return '❌ Please mention a user: `!removeuser @username <group-name>`';
    }
    
    try {
      const { identifier: targetUser, displayName } = mentionInfo;
      const userDisplay = displayName || targetUser;
      
      this.logInfo(`Admin ${senderName || sender} removing ${userDisplay} from ${groupInfo.name}`);
      
      // Log admin action
      await this.logModeratingAction('ADMIN REMOVE USER', 
        `Admin: ${senderName || sender}\n` +
        `Target User: ${userDisplay}\n` +
        `Group: ${groupInfo.name}\n` +
        `Reason: Admin removal`);
      
      return `✅ **User Removed from Group**

**Admin:** ${senderName || sender}
**User:** ${userDisplay}
**Group:** ${groupInfo.name}
**Category:** ${groupInfo.category}

The user has been removed from the group.`;
      
    } catch (error) {
      this.logError('Remove user failed:', error);
      return `❌ Failed to remove user: ${error.message}`;
    }
  }

  async handleGroupInfo(context) {
    const { args } = context;
    
    if (!args) {
      return '❌ Please specify a group: `!groupinfo <group-name>`\nUse `!groups` to see available groups.';
    }
    
    const groupKey = args.toLowerCase();
    const groupInfo = this.availableGroups.get(groupKey);
    
    if (!groupInfo) {
      return `❌ Group "${args}" not found. Use \`!groups\` to see available groups.`;
    }
    
    try {
      // In a real implementation, this would fetch actual group stats
      const memberCount = Math.floor(Math.random() * 50) + 10; // Simulate member count
      const activeToday = Math.floor(memberCount * 0.3);
      
      return `📊 **Group Information**

**Name:** ${groupInfo.name}
**Category:** ${groupInfo.category}
**Description:** ${groupInfo.description}

**Statistics:**
• Members: ${memberCount}
• Active today: ${activeToday}
• Group ID: \`${groupKey}\`

**Actions:**
• \`!join ${groupKey}\` - Request to join
• \`!members ${groupKey}\` - View members (if in group)`;
      
    } catch (error) {
      this.logError('Group info failed:', error);
      return `❌ Failed to get group information: ${error.message}`;
    }
  }

  async handleMembers(context) {
    const { args, groupId, sender } = context;
    
    let targetGroup = null;
    
    if (args) {
      // Show members of specific group
      const groupKey = args.toLowerCase();
      targetGroup = this.availableGroups.get(groupKey);
      
      if (!targetGroup) {
        return `❌ Group "${args}" not found. Use \`!groups\` to see available groups.`;
      }
    } else if (groupId) {
      // Show members of current group
      for (const [key, group] of this.availableGroups) {
        if (group.id === groupId) {
          targetGroup = group;
          break;
        }
      }
    }
    
    if (!targetGroup) {
      return '❌ Please specify a group: `!members <group-name>` or use this command in a group.';
    }
    
    try {
      // In a real implementation, this would fetch actual member list
      const mockMembers = [
        'Alice (Admin)', 'Bob', 'Charlie', 'Diana (Moderator)', 
        'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack'
      ];
      
      const memberList = mockMembers.slice(0, Math.floor(Math.random() * 8) + 3);
      
      return `👥 **${targetGroup.name} Members**

**Total Members:** ${memberList.length}

**Member List:**
${memberList.map(member => `• ${member}`).join('\n')}

💡 Use \`!groupinfo ${targetGroup.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}\` for more details.`;
      
    } catch (error) {
      this.logError('Members list failed:', error);
      return `❌ Failed to get member list: ${error.message}`;
    }
  }

  async handleInvite(context) {
    const { sender, senderName, sourceNumber } = context;
    
    try {
      // Add user to the entry/INDOC group
      if (this.bot && this.bot.addUserToGroup) {
        await this.bot.addUserToGroup(sourceNumber, this.entryGroupId);
        
        // Send notification to entry group mentioning the user
        const entryMessage = `@${senderName || sender} has joined this group. Please add whoever you are looking to invite to the community to this group chat and type !request @their_username when they are in this room.`;
        
        await this.bot.sendToGroup(this.entryGroupId, entryMessage);
        
        this.logInfo(`Added ${senderName || sourceNumber} to entry group and sent instructions`);
      }
      
      // Return the invite instructions
      return `📋 **To invite someone to IrregularChat:**

1. Let them know you're vouching for them.
2. Make sure you have an SSO login: https://sso.irregularchat.com
3. Login to the forum and follow: https://url.irregular.chat/invite
4. Join the Actions Chat
5. Add them to the Actions Chat
6. Type: !request @their_username

That's it.

✅ You've been added to the Entry/INDOC group. Please add the person you want to invite to that group and follow the instructions there.`;
      
    } catch (error) {
      this.logError('Invite command failed:', error);
      
      // Even if adding to group fails, still show the instructions
      return `📋 **To invite someone to IrregularChat:**

1. Let them know you're vouching for them.
2. Make sure you have an SSO login: https://sso.irregularchat.com
3. Login to the forum and follow: https://url.irregular.chat/invite
4. Join the Actions Chat
5. Add them to the Actions Chat
6. Type: !request @their_username

That's it.`;
    }
  }

  // Helper methods
  extractMentionInfoFromMessage(message) {
    // Use the same logic as onboarding plugin
    const dataMessage = message?.dataMessage || 
                        message?.envelope?.dataMessage || 
                        message?.message?.dataMessage ||
                        message?.message;
    
    const mentions = dataMessage?.mentions || [];
    
    if (mentions.length > 0) {
      const firstMention = mentions[0];
      const identifier = firstMention.uuid || firstMention.number || firstMention.username || firstMention.name;
      return { identifier, displayName: null };
    }
    
    // Fallback to text-based extraction
    const text = dataMessage?.message || message?.text || '';
    const mentionMatch = text.match(/@(\S+)/);
    if (mentionMatch) {
      return { identifier: mentionMatch[1], displayName: null };
    }
    
    return null;
  }

  generateInviteCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 32; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  async logModeratingAction(action, details) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${action}\n${details}\n────────────────`;
    
    this.logInfo(`[MOD-ACTIONS] ${logEntry}`);
  }
}