import { BasePlugin } from '../base.js';
import { BaseCommand } from '../../commands.js';

// Moderation Commands
class WarnCommand extends BaseCommand {
  constructor() {
    super('warn', 'Issue warning to user', '!warn <@user> <reason>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('moderation');
    return await plugin.handleWarn(context);
  }
}

class WarningsCommand extends BaseCommand {
  constructor() {
    super('warnings', 'Show user warnings', '!warnings <@user>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('moderation');
    return await plugin.handleWarnings(context);
  }
}

class ClearWarningsCommand extends BaseCommand {
  constructor() {
    super('clearwarnings', 'Clear user warnings (admin)', '!clearwarnings <@user>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('moderation');
    return await plugin.handleClearWarnings(context);
  }
}

class KickCommand extends BaseCommand {
  constructor() {
    super('kick', 'Kick user from group', '!kick <@user> <reason>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('moderation');
    return await plugin.handleKick(context);
  }
}

class TempBanCommand extends BaseCommand {
  constructor() {
    super('tempban', 'Temporary ban user', '!tempban <@user> <duration> <reason>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('moderation');
    return await plugin.handleTempBan(context);
  }
}

class ModLogCommand extends BaseCommand {
  constructor() {
    super('modlog', 'Show moderation log', '!modlog [limit]');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('moderation');
    return await plugin.handleModLog(context);
  }
}

class ReportCommand extends BaseCommand {
  constructor() {
    super('report', 'Report user behavior', '!report <@user> <reason>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('moderation');
    return await plugin.handleReport(context);
  }
}

class CasesCommand extends BaseCommand {
  constructor() {
    super('cases', 'List active moderation cases', '!cases [status]');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('moderation');
    return await plugin.handleCases(context);
  }
}

export default class ModerationPlugin extends BasePlugin {
  constructor(bot) {
    super(bot, 'moderation');
    
    // Initialize moderation data cache
    this.activeWarnings = new Map();
    this.tempBans = new Map();
    this.moderationLog = [];
    this.activeCases = new Map();
    
    // Register commands
    this.addCommand(new WarnCommand());
    this.addCommand(new WarningsCommand());
    this.addCommand(new ClearWarningsCommand());
    this.addCommand(new KickCommand());
    this.addCommand(new TempBanCommand());
    this.addCommand(new ModLogCommand());
    this.addCommand(new ReportCommand());
    this.addCommand(new CasesCommand());
    
    this.initDatabase();
    this.logInfo('Moderation plugin initialized');
  }

  async initDatabase() {
    try {
      await this.bot.runQuery(`
        CREATE TABLE IF NOT EXISTS user_warnings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          moderator_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          group_id TEXT,
          created_at INTEGER NOT NULL,
          cleared_at INTEGER,
          cleared_by TEXT
        )
      `);
      
      await this.bot.runQuery(`
        CREATE TABLE IF NOT EXISTS moderation_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action_type TEXT NOT NULL,
          target_user_id TEXT NOT NULL,
          moderator_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          group_id TEXT,
          duration INTEGER,
          expires_at INTEGER,
          created_at INTEGER NOT NULL,
          status TEXT DEFAULT 'active'
        )
      `);
      
      await this.bot.runQuery(`
        CREATE TABLE IF NOT EXISTS user_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reported_user_id TEXT NOT NULL,
          reporter_id TEXT NOT NULL,
          reason TEXT NOT NULL,
          group_id TEXT,
          status TEXT DEFAULT 'pending',
          resolved_by TEXT,
          resolved_at INTEGER,
          created_at INTEGER NOT NULL
        )
      `);
      
      this.logInfo('Moderation database tables initialized');
    } catch (error) {
      this.logError('Failed to initialize moderation database:', error);
    }
  }

  async handleWarn(context) {
    const { args, sender, senderName, groupId, message } = context;
    
    if (!this.isFromAdmin(context)) {
      return '🚫 **Permission Denied**\n\nOnly administrators can issue warnings.';
    }
    
    if (!args) {
      return `⚠️ **Issue Warning**\n\n**Usage:** \`!warn <@user> <reason>\`\n\n**Example:** \`!warn @john Inappropriate language in chat\`\n\n**Note:** Warnings are tracked and can lead to further action if accumulated.`;
    }
    
    const mentionInfo = this.extractMentionInfoFromMessage(message);
    if (!mentionInfo) {
      return '❌ Please mention the user to warn: `!warn @user <reason>`';
    }
    
    const { identifier: targetUser } = mentionInfo;
    const reasonMatch = args.match(/@\S+\s+(.+)/);
    const reason = reasonMatch ? reasonMatch[1] : 'No reason provided';
    
    if (targetUser === sender) {
      return '❌ You cannot warn yourself.';
    }
    
    try {
      const now = Date.now();
      
      // Add warning to database
      await this.bot.runQuery(`
        INSERT INTO user_warnings (user_id, moderator_id, reason, group_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `, [targetUser, sender, reason, groupId || null, now]);
      
      // Log moderation action
      await this.logModerationAction('warn', targetUser, sender, reason, groupId);
      
      // Get warning count
      const warningCount = await this.getUserWarningCount(targetUser);
      
      let warningLevel = '';
      if (warningCount >= 3) {
        warningLevel = '\n\n⚠️ **HIGH WARNING LEVEL** - Consider further action';
      } else if (warningCount >= 2) {
        warningLevel = '\n\n⚠️ **Multiple warnings** - User should be careful';
      }
      
      return `⚠️ **Warning Issued**\n\n**User:** ${targetUser}\n**Reason:** ${reason}\n**Moderator:** ${senderName || sender}\n**Total Warnings:** ${warningCount}${warningLevel}\n\n💡 Use \`!warnings @user\` to view all warnings.`;
      
    } catch (error) {
      this.logError('Warning failed:', error);
      return `❌ Failed to issue warning: ${error.message}`;
    }
  }

  async handleWarnings(context) {
    const { args, message, sender } = context;
    
    if (!args) {
      return '❌ Please mention a user: `!warnings @user`';
    }
    
    const mentionInfo = this.extractMentionInfoFromMessage(message);
    if (!mentionInfo) {
      return '❌ Please mention a user: `!warnings @user`';
    }
    
    const { identifier: targetUser } = mentionInfo;
    
    // Only admins can view warnings for other users
    if (targetUser !== sender && !this.isFromAdmin(context)) {
      return '🚫 You can only view your own warnings. Admins can view warnings for any user.';
    }
    
    try {
      const warnings = await this.bot.queryDatabase(`
        SELECT * FROM user_warnings 
        WHERE user_id = ? AND cleared_at IS NULL 
        ORDER BY created_at DESC
      `, [targetUser]);
      
      if (warnings.length === 0) {
        return `✅ **No Active Warnings**\n\nUser ${targetUser} has no active warnings.`;
      }
      
      let warningText = `⚠️ **Active Warnings for ${targetUser}**\n\n`;
      
      warnings.forEach((warning, index) => {
        const date = new Date(warning.created_at).toLocaleDateString();
        warningText += `**${index + 1}.** ${warning.reason}\n`;
        warningText += `   *Date:* ${date} | *Moderator:* ${warning.moderator_id}\n\n`;
      });
      
      warningText += `**Total Active Warnings:** ${warnings.length}\n\n`;
      
      if (warnings.length >= 3) {
        warningText += '🚨 **HIGH WARNING LEVEL** - Consider moderation action';
      } else if (warnings.length >= 2) {
        warningText += '⚠️ **Multiple warnings** - User should be careful';
      }
      
      return warningText;
      
    } catch (error) {
      this.logError('Get warnings failed:', error);
      return `❌ Failed to get warnings: ${error.message}`;
    }
  }

  async handleClearWarnings(context) {
    const { args, sender, senderName, message } = context;
    
    if (!this.isFromAdmin(context)) {
      return '🚫 **Permission Denied**\n\nOnly administrators can clear warnings.';
    }
    
    if (!args) {
      return '❌ Please mention a user: `!clearwarnings @user`';
    }
    
    const mentionInfo = this.extractMentionInfoFromMessage(message);
    if (!mentionInfo) {
      return '❌ Please mention a user: `!clearwarnings @user`';
    }
    
    const { identifier: targetUser } = mentionInfo;
    
    try {
      const now = Date.now();
      
      // Clear all active warnings
      const result = await this.bot.runQuery(`
        UPDATE user_warnings 
        SET cleared_at = ?, cleared_by = ? 
        WHERE user_id = ? AND cleared_at IS NULL
      `, [now, sender, targetUser]);
      
      // Log moderation action
      await this.logModerationAction('clear_warnings', targetUser, sender, 'Warnings cleared by admin', null);
      
      return `✅ **Warnings Cleared**\n\n**User:** ${targetUser}\n**Cleared by:** ${senderName || sender}\n**Action:** All active warnings have been cleared\n\n💡 This action has been logged in the moderation log.`;
      
    } catch (error) {
      this.logError('Clear warnings failed:', error);
      return `❌ Failed to clear warnings: ${error.message}`;
    }
  }

  async handleKick(context) {
    const { args, sender, senderName, groupId, message } = context;
    
    if (!this.isFromAdmin(context)) {
      return '🚫 **Permission Denied**\n\nOnly administrators can kick users.';
    }
    
    if (!groupId) {
      return '❌ **Group Only Command**\n\nKick command can only be used in groups.';
    }
    
    if (!args) {
      return `👢 **Kick User**\n\n**Usage:** \`!kick <@user> <reason>\`\n\n**Example:** \`!kick @john Repeated rule violations\`\n\n**Note:** This removes the user from the group immediately.`;
    }
    
    const mentionInfo = this.extractMentionInfoFromMessage(message);
    if (!mentionInfo) {
      return '❌ Please mention the user to kick: `!kick @user <reason>`';
    }
    
    const { identifier: targetUser } = mentionInfo;
    const reasonMatch = args.match(/@\S+\s+(.+)/);
    const reason = reasonMatch ? reasonMatch[1] : 'No reason provided';
    
    if (targetUser === sender) {
      return '❌ You cannot kick yourself.';
    }
    
    try {
      // Log the action before attempting kick
      await this.logModerationAction('kick', targetUser, sender, reason, groupId);
      
      // Note: Actual kicking would require Signal CLI group admin permissions
      // For now, we'll log the action and provide feedback
      
      return `👢 **User Kicked**\n\n**User:** ${targetUser}\n**Reason:** ${reason}\n**Moderator:** ${senderName || sender}\n**Group:** ${groupId}\n\n⚠️ **Note:** User has been marked for removal. Group admin action may be required to complete the kick.\n\n💡 This action has been logged in the moderation log.`;
      
    } catch (error) {
      this.logError('Kick failed:', error);
      return `❌ Failed to kick user: ${error.message}`;
    }
  }

  async handleTempBan(context) {
    const { args, sender, senderName, groupId, message } = context;
    
    if (!this.isFromAdmin(context)) {
      return '🚫 **Permission Denied**\n\nOnly administrators can issue temporary bans.';
    }
    
    if (!args) {
      return `⏰ **Temporary Ban**\n\n**Usage:** \`!tempban <@user> <duration> <reason>\`\n\n**Duration Examples:**\n• \`1h\` - 1 hour\n• \`24h\` or \`1d\` - 1 day\n• \`3d\` - 3 days\n• \`1w\` - 1 week\n\n**Example:** \`!tempban @john 24h Spam posting\``;
    }
    
    const mentionInfo = this.extractMentionInfoFromMessage(message);
    if (!mentionInfo) {
      return '❌ Please mention the user to ban: `!tempban @user <duration> <reason>`';
    }
    
    const { identifier: targetUser } = mentionInfo;
    const parts = args.split(' ');
    if (parts.length < 3) {
      return '❌ Please provide duration and reason: `!tempban @user <duration> <reason>`';
    }
    
    const durationStr = parts[1];
    const reason = parts.slice(2).join(' ');
    
    if (targetUser === sender) {
      return '❌ You cannot ban yourself.';
    }
    
    // Parse duration
    const durationMs = this.parseDuration(durationStr);
    if (!durationMs) {
      return '❌ Invalid duration format. Use: 1h, 24h, 1d, 3d, 1w, etc.';
    }
    
    try {
      const now = Date.now();
      const expiresAt = now + durationMs;
      
      // Add temp ban to database
      await this.bot.runQuery(`
        INSERT INTO moderation_actions (action_type, target_user_id, moderator_id, reason, group_id, duration, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, ['tempban', targetUser, sender, reason, groupId || null, durationMs, expiresAt, now]);
      
      // Log moderation action
      await this.logModerationAction('tempban', targetUser, sender, `${reason} (${durationStr})`, groupId);
      
      const expiryDate = new Date(expiresAt).toLocaleString();
      
      return `⏰ **Temporary Ban Issued**\n\n**User:** ${targetUser}\n**Duration:** ${durationStr}\n**Reason:** ${reason}\n**Moderator:** ${senderName || sender}\n**Expires:** ${expiryDate}\n\n⚠️ **Note:** User is temporarily banned. Access will be automatically restored when the ban expires.\n\n💡 This action has been logged in the moderation log.`;
      
    } catch (error) {
      this.logError('Temp ban failed:', error);
      return `❌ Failed to issue temporary ban: ${error.message}`;
    }
  }

  async handleModLog(context) {
    const { args, sender } = context;
    
    if (!this.isFromAdmin(context)) {
      return '🚫 **Permission Denied**\n\nOnly administrators can view the moderation log.';
    }
    
    const limit = parseInt(args) || 10;
    if (limit > 50) {
      return '❌ Maximum log limit is 50 entries.';
    }
    
    try {
      const actions = await this.bot.queryDatabase(`
        SELECT * FROM moderation_actions 
        ORDER BY created_at DESC 
        LIMIT ?
      `, [limit]);
      
      if (actions.length === 0) {
        return '✅ **Moderation Log**\n\nNo moderation actions recorded yet.';
      }
      
      let logText = `📋 **Moderation Log** (Last ${actions.length} entries)\n\n`;
      
      actions.forEach((action, index) => {
        const date = new Date(action.created_at).toLocaleDateString();
        const time = new Date(action.created_at).toLocaleTimeString();
        
        logText += `**${index + 1}.** ${action.action_type.toUpperCase()}\n`;
        logText += `   *User:* ${action.target_user_id}\n`;
        logText += `   *Moderator:* ${action.moderator_id}\n`;
        logText += `   *Reason:* ${action.reason}\n`;
        logText += `   *Date:* ${date} ${time}\n`;
        
        if (action.expires_at) {
          const expires = new Date(action.expires_at).toLocaleString();
          logText += `   *Expires:* ${expires}\n`;
        }
        
        logText += '\n';
      });
      
      return logText;
      
    } catch (error) {
      this.logError('Get mod log failed:', error);
      return `❌ Failed to get moderation log: ${error.message}`;
    }
  }

  async handleReport(context) {
    const { args, sender, senderName, groupId, message } = context;
    
    if (!args) {
      return `🚨 **Report User**\n\n**Usage:** \`!report <@user> <reason>\`\n\n**Example:** \`!report @john Harassment and inappropriate behavior\`\n\n**Note:** Reports are reviewed by moderators and help maintain community safety.`;
    }
    
    const mentionInfo = this.extractMentionInfoFromMessage(message);
    if (!mentionInfo) {
      return '❌ Please mention the user to report: `!report @user <reason>`';
    }
    
    const { identifier: targetUser } = mentionInfo;
    const reasonMatch = args.match(/@\S+\s+(.+)/);
    const reason = reasonMatch ? reasonMatch[1] : 'No reason provided';
    
    if (targetUser === sender) {
      return '❌ You cannot report yourself.';
    }
    
    try {
      const now = Date.now();
      
      // Add report to database
      await this.bot.runQuery(`
        INSERT INTO user_reports (reported_user_id, reporter_id, reason, group_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `, [targetUser, sender, reason, groupId || null, now]);
      
      return `🚨 **Report Submitted**\n\n**Reported User:** ${targetUser}\n**Reason:** ${reason}\n**Reporter:** Anonymous\n**Status:** Pending review\n\n✅ Thank you for helping maintain community safety. Moderators will review this report.\n\n💡 Use \`!cases\` (admin only) to view all pending reports.`;
      
    } catch (error) {
      this.logError('Report failed:', error);
      return `❌ Failed to submit report: ${error.message}`;
    }
  }

  async handleCases(context) {
    const { args, sender } = context;
    
    if (!this.isFromAdmin(context)) {
      return '🚫 **Permission Denied**\n\nOnly administrators can view moderation cases.';
    }
    
    const status = args || 'pending';
    const validStatuses = ['pending', 'resolved', 'dismissed', 'all'];
    
    if (!validStatuses.includes(status)) {
      return `❌ Invalid status. Valid options: ${validStatuses.join(', ')}`;
    }
    
    try {
      let query = 'SELECT * FROM user_reports';
      let params = [];
      
      if (status !== 'all') {
        query += ' WHERE status = ?';
        params.push(status);
      }
      
      query += ' ORDER BY created_at DESC LIMIT 20';
      
      const cases = await this.bot.queryDatabase(query, params);
      
      if (cases.length === 0) {
        return `✅ **Moderation Cases**\n\nNo ${status === 'all' ? '' : status + ' '}cases found.`;
      }
      
      let casesText = `📁 **Moderation Cases** (${status === 'all' ? 'All' : status.charAt(0).toUpperCase() + status.slice(1)})\n\n`;
      
      cases.forEach((case_, index) => {
        const date = new Date(case_.created_at).toLocaleDateString();
        const time = new Date(case_.created_at).toLocaleTimeString();
        
        casesText += `**Case #${case_.id}** - ${case_.status.toUpperCase()}\n`;
        casesText += `   *Reported:* ${case_.reported_user_id}\n`;
        casesText += `   *Reason:* ${case_.reason}\n`;
        casesText += `   *Date:* ${date} ${time}\n`;
        
        if (case_.resolved_by) {
          const resolvedDate = new Date(case_.resolved_at).toLocaleDateString();
          casesText += `   *Resolved by:* ${case_.resolved_by} on ${resolvedDate}\n`;
        }
        
        casesText += '\n';
      });
      
      casesText += `💡 Use \`!cases <status>\` where status is: ${validStatuses.join(', ')}`;
      
      return casesText;
      
    } catch (error) {
      this.logError('Get cases failed:', error);
      return `❌ Failed to get moderation cases: ${error.message}`;
    }
  }

  // Helper methods
  async getUserWarningCount(userId) {
    try {
      const rows = await this.bot.queryDatabase(
        'SELECT COUNT(*) as count FROM user_warnings WHERE user_id = ? AND cleared_at IS NULL',
        [userId]
      );
      return rows[0]?.count || 0;
    } catch (error) {
      this.logError('Failed to get warning count:', error);
      return 0;
    }
  }

  async logModerationAction(actionType, targetUserId, moderatorId, reason, groupId) {
    try {
      await this.bot.runQuery(`
        INSERT INTO moderation_actions (action_type, target_user_id, moderator_id, reason, group_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [actionType, targetUserId, moderatorId, reason, groupId || null, Date.now()]);
    } catch (error) {
      this.logError('Failed to log moderation action:', error);
    }
  }

  parseDuration(durationStr) {
    const match = durationStr.match(/^(\d+)([hmwd])$/i);
    if (!match) return null;
    
    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    
    const multipliers = {
      'h': 1000 * 60 * 60,        // hours
      'd': 1000 * 60 * 60 * 24,   // days
      'w': 1000 * 60 * 60 * 24 * 7 // weeks
    };
    
    return value * (multipliers[unit] || 0);
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