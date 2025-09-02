import { BasePlugin } from '../base.js';
import { BaseCommand } from '../../commands.js';

// User Management Commands
class ProfileCommand extends BaseCommand {
  constructor() {
    super('profile', 'Show your profile information', '!profile');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('user');
    return await plugin.handleProfile(context);
  }
}

class SetBioCommand extends BaseCommand {
  constructor() {
    super('setbio', 'Set your profile bio', '!setbio <bio-text>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('user');
    return await plugin.handleSetBio(context);
  }
}

class PronounsCommand extends BaseCommand {
  constructor() {
    super('pronouns', 'Set your pronouns', '!pronouns <pronouns>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('user');
    return await plugin.handlePronouns(context);
  }
}

class ContactCommand extends BaseCommand {
  constructor() {
    super('contact', 'Update your contact information', '!contact <email|linkedin|github>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('user');
    return await plugin.handleContact(context);
  }
}

class WhoAmICommand extends BaseCommand {
  constructor() {
    super('whoami', 'Show your Signal and community info', '!whoami');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('user');
    return await plugin.handleWhoAmI(context);
  }
}

class WhoIsCommand extends BaseCommand {
  constructor() {
    super('whois', 'Show user information', '!whois <@user>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('user');
    return await plugin.handleWhoIs(context);
  }
}

export default class UserPlugin extends BasePlugin {
  constructor(bot) {
    super(bot, 'user');
    
    // Initialize user data cache
    this.userProfiles = new Map();
    
    // Register commands
    this.addCommand(new ProfileCommand());
    this.addCommand(new SetBioCommand());
    this.addCommand(new PronounsCommand());
    this.addCommand(new ContactCommand());
    this.addCommand(new WhoAmICommand());
    this.addCommand(new WhoIsCommand());
    
    this.initDatabase();
    this.logInfo('User management plugin initialized');
  }

  async initDatabase() {
    try {
      await this.bot.runQuery(`
        CREATE TABLE IF NOT EXISTS user_profiles (
          user_id TEXT PRIMARY KEY,
          phone_number TEXT,
          display_name TEXT,
          bio TEXT,
          timezone TEXT,
          pronouns TEXT,
          email TEXT,
          linkedin TEXT,
          github TEXT,
          joined_at INTEGER,
          last_seen INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      
      await this.bot.runQuery(`
        CREATE TABLE IF NOT EXISTS user_groups (
          user_id TEXT,
          group_id TEXT,
          group_name TEXT,
          joined_at INTEGER,
          role TEXT DEFAULT 'member',
          PRIMARY KEY (user_id, group_id)
        )
      `);
      
      this.logInfo('User database tables initialized');
    } catch (error) {
      this.logError('Failed to initialize user database:', error);
    }
  }

  async handleProfile(context) {
    const { sender, senderName } = context;
    
    try {
      const profile = await this.getUserProfile(sender);
      
      if (!profile) {
        return `👤 **Your Profile**

**Signal Number:** ${sender}
**Display Name:** ${senderName || 'Not set'}

📝 **Profile not found.** Use these commands to set up your profile:
• \`!setbio <text>\` - Set profile bio
• \`!timezone <tz>\` - Set timezone  
• \`!pronouns <pronouns>\` - Set pronouns
• \`!contact <email>\` - Set contact info

💡 Setting up your profile helps other community members connect with you!`;
      }
      
      const groups = await this.getUserGroups(sender);
      
      return `👤 **Your Profile**

**Basic Info:**
• Signal: ${sender}
• Name: ${profile.display_name || senderName || 'Not set'}
• Bio: ${profile.bio || 'Not set'}
• Pronouns: ${profile.pronouns || 'Not set'}
• Timezone: ${profile.timezone || 'Not set'}

**Contact:**
• Email: ${profile.email || 'Not set'}
• LinkedIn: ${profile.linkedin || 'Not set'}
• GitHub: ${profile.github || 'Not set'}

**Community:**
• Groups: ${groups.length} groups
• Member since: ${profile.joined_at ? new Date(profile.joined_at).toLocaleDateString() : 'Unknown'}
• Last seen: ${profile.last_seen ? new Date(profile.last_seen).toLocaleDateString() : 'Now'}

💡 Use \`!setbio\`, \`!timezone\`, \`!pronouns\`, or \`!contact\` to update your profile.`;
      
    } catch (error) {
      this.logError('Profile lookup failed:', error);
      return `❌ Failed to get profile: ${error.message}`;
    }
  }

  async handleSetBio(context) {
    const { args, sender, senderName } = context;
    
    if (!args) {
      return '❌ Please provide a bio: `!setbio <your-bio>`\n\nExample: `!setbio Software engineer interested in AI and security`';
    }
    
    if (args.length > 200) {
      return '❌ Bio too long. Please keep it under 200 characters.';
    }
    
    try {
      await this.updateUserProfile(sender, { 
        bio: args,
        display_name: senderName 
      });
      
      return `✅ **Bio Updated**

**Your new bio:**
"${args}"

💡 Use \`!profile\` to see your complete profile.`;
      
    } catch (error) {
      this.logError('Set bio failed:', error);
      return `❌ Failed to update bio: ${error.message}`;
    }
  }

  async handleTimezone(context) {
    const { args, sender, senderName } = context;
    
    if (!args) {
      return `🌍 **Timezone Management**

**Usage:** \`!timezone <timezone>\`

**Examples:**
• \`!timezone EST\` or \`!timezone America/New_York\`
• \`!timezone UTC\` or \`!timezone GMT\`
• \`!timezone PST\` or \`!timezone America/Los_Angeles\`
• \`!timezone CET\` or \`!timezone Europe/Berlin\`

**Common Timezones:**
• UTC, GMT, EST, CST, MST, PST
• America/New_York, America/Chicago, America/Denver, America/Los_Angeles
• Europe/London, Europe/Berlin, Asia/Tokyo

💡 This helps coordinate meetings and events across time zones.`;
    }
    
    const timezone = args.toUpperCase();
    
    // Validate common timezones
    const validTimezones = [
      'UTC', 'GMT', 'EST', 'CST', 'MST', 'PST', 'EDT', 'CDT', 'MDT', 'PDT',
      'CET', 'JST', 'AEST', 'BST'
    ];
    
    const isValidShort = validTimezones.includes(timezone);
    const isValidLong = args.includes('/') && args.length > 5; // Basic validation for full timezone names
    
    if (!isValidShort && !isValidLong) {
      return `❌ Invalid timezone "${args}". Use common abbreviations (UTC, EST, PST) or full names (America/New_York).`;
    }
    
    try {
      await this.updateUserProfile(sender, { 
        timezone: args,
        display_name: senderName 
      });
      
      // Get current time in their timezone (simplified)
      const currentTime = new Date().toLocaleString('en-US', { 
        timeZone: isValidLong ? args : undefined 
      });
      
      return `✅ **Timezone Updated**

**Your timezone:** ${args}
**Current time:** ${currentTime}

💡 Use \`!profile\` to see your complete profile.`;
      
    } catch (error) {
      this.logError('Set timezone failed:', error);
      return `❌ Failed to update timezone: ${error.message}`;
    }
  }

  async handlePronouns(context) {
    const { args, sender, senderName } = context;
    
    if (!args) {
      return `👤 **Pronouns**

**Usage:** \`!pronouns <your-pronouns>\`

**Examples:**
• \`!pronouns he/him\`
• \`!pronouns she/her\`  
• \`!pronouns they/them\`
• \`!pronouns he/they\`

💡 Sharing pronouns helps create an inclusive community environment.`;
    }
    
    const pronouns = args.toLowerCase();
    
    try {
      await this.updateUserProfile(sender, { 
        pronouns: pronouns,
        display_name: senderName 
      });
      
      return `✅ **Pronouns Updated**

**Your pronouns:** ${pronouns}

💡 Use \`!profile\` to see your complete profile.`;
      
    } catch (error) {
      this.logError('Set pronouns failed:', error);
      return `❌ Failed to update pronouns: ${error.message}`;
    }
  }

  async handleContact(context) {
    const { args, sender, senderName } = context;
    
    if (!args) {
      return `📧 **Contact Information**

**Usage:** \`!contact <type> <value>\`

**Examples:**
• \`!contact email john@example.com\`
• \`!contact linkedin john-doe\`
• \`!contact github johndoe\`

**Supported Types:**
• email - Your email address
• linkedin - LinkedIn username  
• github - GitHub username

💡 Contact info helps community members connect with you professionally.`;
    }
    
    const parts = args.split(' ');
    if (parts.length < 2) {
      return '❌ Please specify both type and value: `!contact <type> <value>`';
    }
    
    const contactType = parts[0].toLowerCase();
    const contactValue = parts.slice(1).join(' ');
    
    const validTypes = ['email', 'linkedin', 'github'];
    if (!validTypes.includes(contactType)) {
      return `❌ Invalid contact type "${contactType}". Valid types: ${validTypes.join(', ')}`;
    }
    
    // Basic validation
    if (contactType === 'email' && !contactValue.includes('@')) {
      return '❌ Please provide a valid email address.';
    }
    
    try {
      const updateData = { display_name: senderName };
      updateData[contactType] = contactValue;
      
      await this.updateUserProfile(sender, updateData);
      
      return `✅ **Contact Updated**

**${contactType.charAt(0).toUpperCase() + contactType.slice(1)}:** ${contactValue}

💡 Use \`!profile\` to see your complete profile.`;
      
    } catch (error) {
      this.logError('Contact update failed:', error);
      return `❌ Failed to update contact: ${error.message}`;
    }
  }

  async handleWhoAmI(context) {
    const { sender, senderName, groupId } = context;
    
    try {
      const profile = await this.getUserProfile(sender);
      const groups = await this.getUserGroups(sender);
      
      // Get current group info if in a group
      let currentGroupInfo = '';
      if (groupId) {
        const currentGroup = groups.find(g => g.group_id === groupId);
        if (currentGroup) {
          currentGroupInfo = `\n**Current Group:** ${currentGroup.group_name} (${currentGroup.role})`;
        }
      }
      
      return `🔍 **Who Am I?**

**Signal Identity:**
• Number: ${sender}
• Display Name: ${profile?.display_name || senderName || 'Not set'}${currentGroupInfo}

**Community Status:**
• Groups: Member of ${groups.length} groups
• Profile: ${profile ? 'Complete' : 'Incomplete - use !profile to set up'}
• Admin: ${this.isFromAdmin(context) ? 'Yes 🔒' : 'No'}

**Technical Info:**
• User ID: ${sender}
• Session: Active
• Last Activity: Now

💡 Use \`!profile\` for detailed profile information.`;
      
    } catch (error) {
      this.logError('WhoAmI failed:', error);
      return `❌ Failed to get user info: ${error.message}`;
    }
  }

  async handleWhoIs(context) {
    const { args, message, sender } = context;
    
    if (!args) {
      return '❌ Please mention a user: `!whois @username`';
    }
    
    const mentionInfo = this.extractMentionInfoFromMessage(message);
    if (!mentionInfo) {
      return '❌ Please mention a user: `!whois @username`';
    }
    
    const { identifier: targetUser } = mentionInfo;
    
    if (targetUser === sender) {
      return '💡 That\'s you! Use `!profile` or `!whoami` to see your own information.';
    }
    
    try {
      const profile = await this.getUserProfile(targetUser);
      const groups = await this.getUserGroups(targetUser);
      
      if (!profile) {
        return `👤 **User Information**

**Signal Number:** ${targetUser}
**Profile Status:** Not found in community database

💡 User may not have set up their profile yet.`;
      }
      
      // Get shared groups
      const myGroups = await this.getUserGroups(sender);
      const sharedGroups = groups.filter(g1 => 
        myGroups.some(g2 => g2.group_id === g1.group_id)
      );
      
      return `👤 **User Information**

**Basic Info:**
• Name: ${profile.display_name || 'Not set'}
• Pronouns: ${profile.pronouns || 'Not set'}
• Bio: ${profile.bio || 'Not set'}
• Timezone: ${profile.timezone || 'Not set'}

**Community:**
• Groups: Member of ${groups.length} groups
• Shared groups: ${sharedGroups.length}
• Member since: ${profile.joined_at ? new Date(profile.joined_at).toLocaleDateString() : 'Unknown'}

**Contact:**
${profile.email ? `• Email: ${profile.email}` : ''}
${profile.linkedin ? `• LinkedIn: ${profile.linkedin}` : ''}
${profile.github ? `• GitHub: ${profile.github}` : ''}

${sharedGroups.length > 0 ? `**Shared Groups:** ${sharedGroups.map(g => g.group_name).join(', ')}` : ''}`;
      
    } catch (error) {
      this.logError('WhoIs failed:', error);
      return `❌ Failed to get user info: ${error.message}`;
    }
  }

  // Database helper methods
  async getUserProfile(userId) {
    try {
      const rows = await this.bot.queryDatabase(
        'SELECT * FROM user_profiles WHERE user_id = ?',
        [userId]
      );
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      this.logError('Failed to get user profile:', error);
      return null;
    }
  }

  async updateUserProfile(userId, data) {
    try {
      const now = Date.now();
      const profile = await this.getUserProfile(userId);
      
      if (profile) {
        // Update existing profile
        const updateFields = [];
        const updateValues = [];
        
        for (const [key, value] of Object.entries(data)) {
          if (key !== 'user_id') {
            updateFields.push(`${key} = ?`);
            updateValues.push(value);
          }
        }
        
        updateFields.push('updated_at = ?');
        updateValues.push(now);
        updateValues.push(userId);
        
        await this.bot.runQuery(
          `UPDATE user_profiles SET ${updateFields.join(', ')} WHERE user_id = ?`,
          updateValues
        );
      } else {
        // Create new profile
        await this.bot.runQuery(`
          INSERT INTO user_profiles 
          (user_id, display_name, bio, timezone, pronouns, email, linkedin, github, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          userId,
          data.display_name || null,
          data.bio || null,
          data.timezone || null,
          data.pronouns || null,
          data.email || null,
          data.linkedin || null,
          data.github || null,
          now,
          now
        ]);
      }
      
      return true;
    } catch (error) {
      this.logError('Failed to update user profile:', error);
      throw error;
    }
  }

  async getUserGroups(userId) {
    try {
      const rows = await this.bot.queryDatabase(
        'SELECT * FROM user_groups WHERE user_id = ? ORDER BY joined_at DESC',
        [userId]
      );
      return rows || [];
    } catch (error) {
      this.logError('Failed to get user groups:', error);
      return [];
    }
  }

  // Utility method to extract mentions (shared with other plugins)
  extractMentionInfoFromMessage(message) {
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
    
    const text = dataMessage?.message || message?.text || '';
    const mentionMatch = text.match(/@(\S+)/);
    if (mentionMatch) {
      return { identifier: mentionMatch[1], displayName: null };
    }
    
    return null;
  }
}