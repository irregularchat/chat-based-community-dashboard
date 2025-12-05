import { Command, CommandContext, CommandResponse } from './base-command';
import { isAdmin } from '../../utils/auth';
import { authentikClient, generateWelcomeMessage } from '../../utils/authentik-client';
import { parseIntroduction, isIntroMessage, formatIntroSummary, extractEmailFromText } from '../../utils/intro-parser';

export class AdminCommand extends Command {
  public name = 'admin';
  public description = 'Admin commands';
  public aliases = ['gtg', 'pending', 'remove', 'clearroom', 'createuser', 'accountinvite'];

  public async handle(context: CommandContext, args: string): Promise<CommandResponse> {
    const subCommand = context.message?.split(' ')[0].substring(1);
    switch (subCommand) {
      case 'gtg':
        return this.handleGtg(context, args);
      case 'pending':
        return this.handlePending(context);
      case 'remove':
        return this.handleRemove(context, args);
      case 'clearroom':
        return this.handleClearRoom(context, args);
      case 'createuser':
        return this.handleCreateUser(context, args);
      case 'accountinvite':
        return this.handleAccountInvite(context, args);
      default:
        return `❓ Unknown admin command.`;
    }
  }

  private async handleGtg(context: CommandContext, args: string): Promise<string> {
    const isUserAdmin = await isAdmin(this.db, context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
      return '❌ Admin-only command';
    }

    let userPhone: string | undefined;

    if (context.mentions && context.mentions.length > 0) {
      const mention = context.mentions[0];
      userPhone = mention.uuid || mention.number;
      console.log(`📋 GTG: User identified via mention: ${userPhone}`);
    }
    else if (context.quotedAuthor) {
      userPhone = context.quotedAuthor;
      console.log(`📋 GTG: User identified via quoted message author: ${userPhone}`);
    }

    if (!userPhone) {
      return '❌ Please either:\n• Reply to user\'s intro message with !gtg\n• Or mention the user: !gtg @user';
    }

    try {
      let introText = '';
      let parsedIntro: ReturnType<typeof parseIntroduction> | null = null;

      if (context.quotedText && context.quotedText.trim().length > 0) {
        introText = context.quotedText;
        console.log(`📋 Found quoted message (${introText.length} chars) - checking if it\'s an intro`);

        if (isIntroMessage(introText)) {
          parsedIntro = parseIntroduction(introText);
          console.log(`📋 Parsed intro from quoted message: ${formatIntroSummary(parsedIntro)}`);
        }
      }

      if (!parsedIntro?.isValidIntro && context.groupId) {
        try {
          const recentMessages = await this.db.getRecentMessages(context.groupId, 50);
          const userMessages = recentMessages
            .filter((msg: any) => msg.source_number === userPhone || msg.source_uuid === userPhone)
            .slice(0, 10);

          for (const msg of userMessages) {
            const msgText = msg.message || '';
            if (isIntroMessage(msgText)) {
              introText = msgText;
              parsedIntro = parseIntroduction(msgText);
              console.log(`📋 Found intro in user\'s message history: ${formatIntroSummary(parsedIntro)}`);
              break;
            }
          }

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

      if (!parsedIntro?.email && introText) {
        const fallbackEmail = extractEmailFromText(introText);
        if (fallbackEmail) {
          console.log(`📋 Fallback email extraction found: ${fallbackEmail}`);
          if (!parsedIntro) {
            parsedIntro = { isValidIntro: false };
          }
          parsedIntro.email = fallbackEmail;
          if (!parsedIntro.firstName) {
            const nameMatch = introText.match(/(?:^|\n)\s*1[\.\-\:)]\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)/);
            if (nameMatch) {
              const nameParts = nameMatch[1].split(' ');
              parsedIntro.firstName = nameParts[0];
              parsedIntro.lastName = nameParts.slice(1).join(' ');
              parsedIntro.fullName = nameMatch[1];
              console.log(`📋 Extracted name from text: ${parsedIntro.fullName}`);
            }
          }
          parsedIntro.isValidIntro = true;
        }
      }

      let ssoAccountCreated = false;
      let ssoUsername = '';
      let ssoError = '';

      if (parsedIntro?.isValidIntro && parsedIntro.email && authentikClient.isConfigured()) {
        console.log(`🔐 Creating SSO account for ${parsedIntro.firstName} (${parsedIntro.email})`);

        try {
          const username = await authentikClient.generateUsername(parsedIntro.firstName || 'user');

          const result = await authentikClient.createUser({
            username,
            email: parsedIntro.email,
            firstName: parsedIntro.firstName || '',
            lastName: parsedIntro.lastName || '',
          });

          if (result.success && result.temp_password) {
            ssoAccountCreated = true;
            ssoUsername = result.username || username;

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

      const response = ['✅ User Approved (GTG)', ''];

      if (parsedIntro?.isValidIntro) {
        response.push(`👤 ${parsedIntro.fullName || parsedIntro.firstName}`);
        if (parsedIntro.email) response.push(`📧 ${parsedIntro.email}`);
        if (parsedIntro.organization) response.push(`🏢 ${parsedIntro.organization}`);
        response.push('');
      }

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

  private async handlePending(context: CommandContext): Promise<string> {
    const isUserAdmin = await isAdmin(this.db, context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
      return '❌ Admin-only command';
    }

    return this.formatForSignal(
      '📋 Pending User Requests\n\n' +
      'No pending requests at this time.\n\n' +
      '🚧 Full implementation coming soon'
    );
  }

  private async handleRemove(context: CommandContext, args: string): Promise<string> {
    const isUserAdmin = await isAdmin(this.db, context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
      return '❌ Admin-only command';
    }

    if (!context.mentions || context.mentions.length === 0) {
      return '❌ Please mention one or more users\n\nUsage: !remove @user [@user2 @user3 ...]';
    }

    const allGroups = await this.bot?.getGroups() || [];

    const allResults: string[] = [];

    for (const mention of context.mentions) {
      const userIdentifier = mention.uuid || mention.number;

      if (!userIdentifier) {
        allResults.push(`⚠️ Could not resolve one mentioned user - skipping`);
        continue;
      }

      let userDisplayName = 'a member';
      if (this.db) {
        try {
          const result = await this.db.query(
            'SELECT display_name, profile_name, first_name, last_name FROM signal_members WHERE uuid = $1 OR phone_number = $1 LIMIT 1',
            [userIdentifier]
          );
          if (result.results && result.results.length > 0) {
            const row = result.results[0];
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
        const userGroups: Array<{ groupId: string; name: string }> = [];

        for (const group of allGroups) {
          if (!group.members || !Array.isArray(group.members)) continue;

          const isMember = group.members.some((m: any) => {
            const memberId = typeof m === 'string' ? m : (m?.uuid || m?.number);
            return memberId === userIdentifier;
          });

          if (isMember && group.id) {
            userGroups.push({
              groupId: group.id,
              name: group.name || 'Unknown Group'
            });
          }
        }

        if (userGroups.length === 0) {
          allResults.push(`⚠️ ${userDisplayName}: Not found in any groups`);
          continue;
        }

        const removalMessage =
          `⚠️ ${userDisplayName} is being removed for not verifying themselves after their safety number changed.\n\n` +
          `This is done to maintain the integrity of the community. This could mean the number was assigned to a different person or their SIM was put into a different device.\n\n` +
          `They are welcome to request to join anytime but will need to be verified by knowing someone in the community and providing their name and organization.`;

        const removedFrom: string[] = [];
        const failedRemovals: string[] = [];

        for (const group of userGroups) {
          try {
            const groupData = allGroups.find((g: any) => g.id === group.groupId);
            const isBotAdmin = await isAdmin(this.db, this.config.phoneNumber);

            if (!isBotAdmin) {
              failedRemovals.push(`${group.name} (bot not admin)`);
              continue;
            }

            if (this.bot) {
              await this.bot.sendMessage({
                groupId: group.groupId,
                message: removalMessage,
              });
            }

            await new Promise(resolve => setTimeout(resolve, 500));

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

  private async handleClearRoom(context: CommandContext, args: string): Promise<string> {
    const isUserAdmin = await isAdmin(this.db, context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
      return '❌ Admin-only command';
    }

    if (!context.groupId) {
      return '❌ This command must be used in a group chat';
    }

    const isConfirmed = args.trim().toLowerCase() === 'confirm';

    try {
      console.log('🔄 Syncing with Signal servers before clearroom...');
      await this.bot?.syncWithServer(1);

      let currentGroup = await this.bot?.getGroupDirect(context.groupId);

      if (!currentGroup) {
        console.log('⚠️ Direct fetch failed, using cached groups');
        const allGroups = await this.bot?.getGroups(true) || [];
        currentGroup = allGroups.find((g: any) => g.id === context.groupId);
      }

      if (!currentGroup) {
        return '❌ Could not find current group information';
      }

      const allGroups = await this.bot?.getGroups() || [];

      const isBotAdmin = await isAdmin(this.db, this.config.phoneNumber);
      if (!isBotAdmin) {
        return '❌ Bot is not an admin in this group and cannot remove members';
      }

      const members: string[] = currentGroup.members || [];
      const signalAdmins: string[] = currentGroup.admins || [];

      if (members.length === 0) {
        return '❌ No members found in this group';
      }

      const protectedSet = new Set(signalAdmins);

      const botAdminUuids = process.env.ADMIN_UUIDS?.split(',').map(u => u.trim()).filter(Boolean) || [];
      for (const uuid of botAdminUuids) {
        protectedSet.add(uuid);
      }

      const adminGroup = allGroups.find((g: any) =>
        g.name && g.name.toLowerCase().includes('admin') && g.name.includes('**')
      );
      const adminGroupMembers: string[] = adminGroup?.members || [];
      for (const uuid of adminGroupMembers) {
        protectedSet.add(uuid);
      }

      const nonAdminMembers = members.filter((m: string) => !protectedSet.has(m));

      const protectedInRoom = members.filter((m: string) => protectedSet.has(m));
      const signalAdminsInRoom = members.filter((m: string) => signalAdmins.includes(m)).length;
      const botAdminsInRoom = members.filter((m: string) => botAdminUuids.includes(m)).length;
      const adminGroupInRoom = members.filter((m: string) => adminGroupMembers.includes(m)).length;

      console.log(`🛡️ Protected members in room: ${protectedInRoom.length} (Signal admins: ${signalAdminsInRoom}, Bot admins: ${botAdminsInRoom}, Admin group: ${adminGroupInRoom})`);
      console.log(`   Total room members: ${members.length}, To remove: ${nonAdminMembers.length}`);

      if (nonAdminMembers.length === 0) {
        return '✅ No non-admin members to remove. All members are already protected.';
      }

      let displayNames = new Map<string, string>();
      let signalDbNames = new Map<string, string>();
      let contactNames = new Map<string, string>();
      let identityNames = new Map<string, string>();

      try {
        signalDbNames = await this.bot?.getProfileNamesFromSignalDb() || new Map();
        console.log(`📋 Found ${signalDbNames.size} names from Signal CLI database (primary source)`);
      } catch (error) {
        console.error('Error fetching names from Signal CLI database:', error);
      }

      try {
        const rawDbNames = await this.db.getMemberDisplayNamesByUuids(nonAdminMembers);
        for (const [uuid, name] of rawDbNames) {
          if (name && !name.startsWith('+')) {
            displayNames.set(uuid, name);
          }
        }
        console.log(`📝 Found ${displayNames.size} actual names from PostgreSQL (filtered from ${rawDbNames.size})`);
      } catch (error) {
        console.error('Error fetching display names from database:', error);
      }

      try {
        contactNames = await this.bot?.getContactNames() || new Map();
        console.log(`📇 Found ${contactNames.size} names from Signal contacts`);
      } catch (error) {
        console.error('Error fetching contact names:', error);
      }

      try {
        identityNames = await this.bot?.getIdentityNames() || new Map();
        console.log(`🪪 Found ${identityNames.size} names from Signal identities`);
      } catch (error) {
        console.error('Error fetching identity names:', error);
      }

      for (const [uuid, name] of signalDbNames) {
        if (name && !name.startsWith('+')) {
          displayNames.set(uuid, name);
        }
      }

      for (const [uuid, name] of contactNames) {
        if (name && !name.startsWith('+') && !displayNames.has(uuid)) {
          displayNames.set(uuid, name);
        }
      }

      for (const [uuid, name] of identityNames) {
        if (name && !name.startsWith('+') && !displayNames.has(uuid)) {
          displayNames.set(uuid, name);
        }
      }
      console.log(`📋 Total display names available: ${displayNames.size}`);

      if (!isConfirmed) {
        let namesFound = 0;
        const memberList = nonAdminMembers.map(member => {
          const uuid = typeof member === 'string' ? member : (member as any).uuid || String(member);
          const name = displayNames.get(uuid);
          if (name) {
            namesFound++;
            return `• ${name}`;
          } else {
            return `• [${typeof uuid === 'string' ? uuid.substring(0, 6) : String(uuid).substring(0, 6)}]`;
          }
        });

        const MAX_PREVIEW = 20;
        const hasMore = memberList.length > MAX_PREVIEW;
        const displayList = memberList.slice(0, MAX_PREVIEW);
        if (hasMore) {
          displayList.push(`... and ${memberList.length - MAX_PREVIEW} more`);
        }

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

          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

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

  private async handleCreateUser(context: CommandContext, args: string): Promise<string> {
    const isUserAdmin = await isAdmin(this.db, context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
      return '❌ Admin-only command';
    }

    if (!authentikClient.isConfigured()) {
      return '❌ SSO service not configured\n\nRequired environment variables:\n• AUTHENTIK_BASE_URL\n• AUTHENTIK_API_TOKEN';
    }

    let email: string = '';
    let firstName: string = '';
    let lastName: string = '';
    let targetUserUuid: string | undefined;
    let organization: string | undefined;
    let parsedFromIntro = false;

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
    else if (context.mentions && context.mentions.length > 0) {
      const mention = context.mentions[0];
      targetUserUuid = mention.uuid;

      if (targetUserUuid && this.db) {
        try {
          const result = await this.db.query(
            'SELECT display_name, profile_name, first_name, last_name FROM signal_members WHERE uuid = $1 LIMIT 1',
            [targetUserUuid]
          );
          if (result.results && result.results.length > 0) {
            const row = result.results[0];
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

      const emailMatch = args.match(/["']?[\w.-]+@["']?[\w.-]+\.["']?\w+["']?/);
      if (!emailMatch) {
        return '❌ Email required\n\nUsage: !createuser @user email@example.com [FirstName LastName]';
      }
      email = emailMatch[0];

      if (!firstName || firstName === 'User') {
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

      if (!firstName) {
        firstName = 'User';
      }

    }
    else if (args.trim()) {
      const parts = args.trim().split(/\s+/);
      if (parts.length < 2) {
        return '❌ Missing arguments\n\nUsage:\n• Reply to intro: !createuser (reply to user\'s intro message)\n• With mention: !createuser @user email@example.com\n• Manual: !createuser email@example.com FirstName [LastName]';
      }

      const emailMatch = parts[0].match(/["']?[\w.-]+@["']?[\w.-]+\.["']?\w+["']?/);
      if (emailMatch) {
        email = parts[0];
        firstName = parts[1] || 'User';
        lastName = parts.slice(2).join(' ');
      } else {
        email = parts.find(p => p.includes('@')) || '';
        const nonEmailParts = parts.filter(p => !p.includes('@'));
        firstName = nonEmailParts[0] || 'User';
        lastName = nonEmailParts.slice(1).join(' ');
      }

      if (!email || !email.includes('@')) {
        return '❌ Invalid email address\n\nUsage: !createuser email@example.com FirstName [LastName]';
      }
    }
    else {
      return '❌ Usage:\n1️⃣ Reply to intro message with !createuser\n2️⃣ !createuser @user email@example.com\n3️⃣ !createuser email@example.com FirstName';
    }

    try {
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

      const welcomeMessage = generateWelcomeMessage(username, result.temp_password || 'Check with admin');

      const dmRecipient = targetUserUuid || context.sourceUuid || context.sourceNumber;
      let dmSent = false;
      let dmTarget = targetUserUuid ? 'user' : 'admin';
      let dmSentToFallback = false;
      const ADMIN_FALLBACK_NUMBER = '+12247253276';

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

  private async handleAccountInvite(context: CommandContext, args: string): Promise<string | null> {
    const isUserAdmin = await isAdmin(this.db, context.sourceUuid || context.sourceNumber);
    if (!isUserAdmin) {
      return '❌ Admin-only command';
    }

    if (!authentikClient.isConfigured()) {
      if (this.bot && (context.sourceUuid || context.sourceNumber)) {
        await this.bot.sendMessage({
          recipient: context.sourceUuid || context.sourceNumber,
          message: '❌ SSO service not configured',
        });
      }
      return null;
    }

    let expiresInHours = 4;
    let singleUse = false;
    const argLower = args.trim().toLowerCase();

    if (argLower.includes('-c 1') || argLower.includes('-c1')) {
      singleUse = true;
    }

    const hoursMatch = argLower.replace(/-c\s*\d+/g, '').match(/(\d+)/);
    if (hoursMatch) {
      const hours = parseInt(hoursMatch[1], 10);
      if (!isNaN(hours) && hours > 0 && hours <= 168) {
        expiresInHours = hours;
      }
    }

    const requesterName = (context.sourceName || 'admin').replace(/[^a-z0-9]/gi, '').substring(0, 20);
    const label = `signal_${requesterName}_${Date.now()}`;

    console.log(`🎟️ Creating invite: ${expiresInHours}h, singleUse=${singleUse}, by ${context.sourceName}`);

    const result = await authentikClient.createInvite(label, expiresInHours, singleUse);

    if (!result.success) {
      if (this.bot && (context.sourceUuid || context.sourceNumber)) {
        await this.bot.sendMessage({
          recipient: context.sourceUuid || context.sourceNumber,
          message: `❌ Failed to create invite: ${result.error}`,
        });
      }
      return null;
    }

    const expiryTime = new Date(result.expiresAt!);
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

    return this.formatForSignal(response.join('\n'));
  }

  private formatForSignal(text: string): string {
    return text
      .replace(/^#{1,6}\s+(.+)$/gm, (_, content) => content.toUpperCase())
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

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

      const adminGroups = allGroups.filter((g: any) => isAdmin(this.db, g.id));
      console.log(`👑 Bot is admin in ${adminGroups.length} groups`);

      const sampleNames = adminGroups.slice(0, 5).map((g: any) => g.name).join(', ');
      console.log(`📝 Sample admin group names: ${sampleNames}`);

      const coreGroupPatterns = [
        'tech',
        'announcements',
        'off topic',
      ];

      const excludePatterns = [
        'entry',
        'indoc',
        'admin',
        'bot development',
        'solo',
      ];

      const coreGroups = adminGroups
        .filter((g: any) => {
          const name = g.name?.toLowerCase() || '';
          const matchesCore = coreGroupPatterns.some(pattern => name.includes(pattern));
          const matchesExclude = excludePatterns.some(pattern => name.includes(pattern));
          return matchesCore && !matchesExclude;
        })
        .map((g: any) => ({ groupId: g.id, name: g.name }));

      console.log(`🎯 Found ${coreGroups.length} core groups: ${coreGroups.map((g: { groupId: string; name: string }) => g.name).join(', ')}`);

      let interestGroups: Array<{ groupId: string; name: string }> = [];
      if (userIntro) {
        const keywords = this.extractKeywords(userIntro);
        interestGroups = this.getGroupsMatchingKeywords(adminGroups, keywords);

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

      const allRecommended = [...coreGroups];
      for (const ig of interestGroups) {
        if (!allRecommended.find(g => g.groupId === ig.groupId)) {
          allRecommended.push(ig);
        }
      }

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

  private extractKeywords(userIntro: string): Set<string> {
    const keywords = new Set<string>();
    const lowerIntro = userIntro.toLowerCase();

    const GROUP_KEYWORD_MAP: Record<string, string[]> = {
      'suas': ['uas', 'drone', 'suas', 'unmanned aerial', 'quadcopter', 'uav'],
      'uxs': ['uxs', 'unmanned', 'autonomous', 'robotics', 'ugv', 'usv'],
      'counter-uas': ['c-uas', 'counter uas', 'counter-uas', 'counter drone', 'anti-drone', 'blue uas'],
      'military': ['military', 'defense', 'armed forces', 'usaf', 'army', 'navy', 'marines', 'dod'],
      'intel': ['intelligence', 'intel', 'sigint', 'osint', 'humint', 'cia', 'nsa'],
      'cyber': ['cyber', 'cybersecurity', 'infosec', 'netsec', 'hacking', 'security'],
      'tech': ['tech', 'technology', 'software', 'programming', 'coding', 'dev', 'engineer', 'fullstack', 'full stack', 'full-stack', 'frontend', 'backend'],
      'ai': ['ai', 'artificial intelligence', 'machine learning', 'ml', 'gpt', 'llm', 'autonomy', 'autonomous'],
      'dragon': ['dragon', 'rf', 'comms', 'communications', 'radio', 'rf-comms', 'dragon-rf'],
      'comms': ['comms', 'communications', 'radio', 'satcom', 'tactical comms'],
      'news': ['news', 'current events', 'politics', 'geopolitics'],
    };

    for (const [_groupPattern, keywordList] of Object.entries(GROUP_KEYWORD_MAP)) {
      for (const keyword of keywordList) {
        const regex = new RegExp(`\b${keyword.replace(/[-\/]/g, '[-\/]?')}\b`, 'i');
        if (regex.test(lowerIntro)) {
          keywords.add(keyword);
        }
      }
    }

    console.log(`📝 Extracted keywords from intro: ${Array.from(keywords).join(', ')}`);
    return keywords;
  }

  private getGroupsMatchingKeywords(allGroups: any[], keywords: Set<string>): Array<{ groupId: string; name: string }> {
    const matchedGroups: Array<{ groupId: string; name: string }> = [];

    const matchesGroupPattern = (groupName: string, pattern: string): boolean => {
      const name = groupName.toLowerCase();
      const pat = pattern.toLowerCase();
      const escapedPattern = pat.replace(/[.*+?^${}()|[\\]/g, '\\$&');
      const regex = new RegExp(`(^|[^a-z])${escapedPattern}([^a-z]|$)`, 'i');
      return regex.test(name);
    };

    const GROUP_KEYWORD_MAP: Record<string, string[]> = {
      'suas': ['uas', 'drone', 'suas', 'unmanned aerial', 'quadcopter', 'uav'],
      'uxs': ['uxs', 'unmanned', 'autonomous', 'robotics', 'ugv', 'usv'],
      'counter-uas': ['c-uas', 'counter uas', 'counter-uas', 'counter drone', 'anti-drone', 'blue uas'],
      'military': ['military', 'defense', 'armed forces', 'usaf', 'army', 'navy', 'marines', 'dod'],
      'intel': ['intelligence', 'intel', 'sigint', 'osint', 'humint', 'cia', 'nsa'],
      'cyber': ['cyber', 'cybersecurity', 'infosec', 'netsec', 'hacking', 'security'],
      'tech': ['tech', 'technology', 'software', 'programming', 'coding', 'dev', 'engineer', 'fullstack', 'full stack', 'full-stack', 'frontend', 'backend'],
      'ai': ['ai', 'artificial intelligence', 'machine learning', 'ml', 'gpt', 'llm', 'autonomy', 'autonomous'],
      'dragon': ['dragon', 'rf', 'comms', 'communications', 'radio', 'rf-comms', 'dragon-rf'],
      'comms': ['comms', 'communications', 'radio', 'satcom', 'tactical comms'],
      'news': ['news', 'current events', 'politics', 'geopolitics'],
    };

    for (const [groupPattern, keywordList] of Object.entries(GROUP_KEYWORD_MAP)) {
      const hasMatchingKeyword = keywordList.some(kw => keywords.has(kw));

      if (hasMatchingKeyword) {
        const matchingGroups = allGroups.filter((g: any) =>
          g.name && matchesGroupPattern(g.name, groupPattern)
        );

        matchingGroups.forEach((g: any) => {
          if (!matchedGroups.find(mg => mg.groupId === g.id)) {
            matchedGroups.push({ groupId: g.id, name: g.name });
            console.log(`✅ Keyword match: "${groupPattern}" → Group: "${g.name}"`);
          }
        });
      }
    }

    return matchedGroups;
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
    } catch (error) {
      console.error(`Failed to add user via JSON-RPC: ${error}`);
      throw new Error(`Failed to add user to group: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}