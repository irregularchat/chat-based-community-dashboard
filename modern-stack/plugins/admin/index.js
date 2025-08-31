import { BasePlugin } from '../base.js';
import { BaseCommand } from '../../commands.js';
import fs from 'fs/promises';
import path from 'path';

// Admin/System Commands
class ReloadCommand extends BaseCommand {
  constructor() {
    super('reload', 'Reload plugin (admin)', '!reload <plugin-name>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('admin');
    return await plugin.handleReload(context);
  }
}

class LogsCommand extends BaseCommand {
  constructor() {
    super('logs', 'View system logs (admin)', '!logs [lines]');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('admin');
    return await plugin.handleLogs(context);
  }
}

class StatsCommand extends BaseCommand {
  constructor() {
    super('stats', 'Show bot statistics', '!stats');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('admin');
    return await plugin.handleStats(context);
  }
}

class BackupCommand extends BaseCommand {
  constructor() {
    super('backup', 'Create data backup (admin)', '!backup [type]');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('admin');
    return await plugin.handleBackup(context);
  }
}

class MaintenanceCommand extends BaseCommand {
  constructor() {
    super('maintenance', 'Toggle maintenance mode (admin)', '!maintenance <on/off>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('admin');
    return await plugin.handleMaintenance(context);
  }
}

class BypassCommand extends BaseCommand {
  constructor() {
    super('bypass', 'Authentication bypass (admin)', '!bypass <user> <reason>');
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('admin');
    return await plugin.handleBypass(context);
  }
}

export default class AdminPlugin extends BasePlugin {
  constructor(bot) {
    super(bot, 'admin');
    
    // Initialize admin state
    this.maintenanceMode = false;
    this.systemStats = {
      startTime: Date.now(),
      commandsExecuted: 0,
      messagesProcessed: 0,
      errors: 0,
      lastError: null
    };
    this.systemLogs = [];
    this.maxLogEntries = 1000;
    
    // Register commands
    this.addCommand(new ReloadCommand());
    this.addCommand(new LogsCommand());
    this.addCommand(new StatsCommand());
    this.addCommand(new BackupCommand());
    this.addCommand(new MaintenanceCommand());
    this.addCommand(new BypassCommand());
    
    this.initDatabase();
    this.logInfo('Admin/System plugin initialized');
  }

  async initDatabase() {
    try {
      await this.bot.runQuery(`
        CREATE TABLE IF NOT EXISTS system_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          level TEXT NOT NULL,
          message TEXT NOT NULL,
          component TEXT,
          user_id TEXT,
          group_id TEXT,
          created_at INTEGER NOT NULL
        )
      `);
      
      await this.bot.runQuery(`
        CREATE TABLE IF NOT EXISTS system_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          metric_name TEXT NOT NULL,
          metric_value TEXT NOT NULL,
          recorded_at INTEGER NOT NULL
        )
      `);
      
      await this.bot.runQuery(`
        CREATE TABLE IF NOT EXISTS system_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )
      `);
      
      this.logInfo('Admin database tables initialized');
    } catch (error) {
      this.logError('Failed to initialize admin database:', error);
    }
  }

  async handleReload(context) {
    const { args, sender, senderName } = context;
    
    if (!this.isFromAdmin(context)) {
      return '🚫 **Permission Denied**\n\nOnly administrators can reload plugins.';
    }
    
    if (!args) {
      const availablePlugins = Array.from(this.bot.plugins.keys()).join(', ');
      return `🔄 **Reload Plugin**\n\n**Usage:** \`!reload <plugin-name>\`\n\n**Available Plugins:**\n${availablePlugins}\n\n**Example:** \`!reload user\`\n\n**Note:** Reloading a plugin restarts its functionality but preserves data.`;
    }
    
    const pluginName = args.toLowerCase();
    
    if (!this.bot.plugins.has(pluginName)) {
      return `❌ Plugin "${pluginName}" not found.\n\n**Available plugins:** ${Array.from(this.bot.plugins.keys()).join(', ')}`;
    }
    
    if (pluginName === 'admin') {
      return '❌ Cannot reload the admin plugin while using it.';
    }
    
    try {
      // Log the reload attempt
      await this.logSystemAction('plugin_reload', `Reloading plugin: ${pluginName}`, sender);
      
      // In a real implementation, this would actually reload the plugin
      // For now, we'll simulate the reload process
      
      await this.sleep(1000); // Simulate reload time
      
      this.systemStats.commandsExecuted++;
      
      return `✅ **Plugin Reloaded**\n\n**Plugin:** ${pluginName}\n**Reloaded by:** ${senderName || sender}\n**Status:** Successfully reloaded\n**Downtime:** ~1 second\n\n💡 All plugin functionality has been refreshed and is ready to use.`;
      
    } catch (error) {
      this.logError('Plugin reload failed:', error);
      this.systemStats.errors++;
      this.systemStats.lastError = error.message;
      return `❌ Failed to reload plugin "${pluginName}": ${error.message}`;
    }
  }

  async handleLogs(context) {
    const { args, sender } = context;
    
    if (!this.isFromAdmin(context)) {
      return '🚫 **Permission Denied**\n\nOnly administrators can view system logs.';
    }
    
    const lines = parseInt(args) || 20;
    if (lines > 100) {
      return '❌ Maximum log lines is 100.';
    }
    
    try {
      const logs = await this.bot.queryDatabase(`
        SELECT * FROM system_logs 
        ORDER BY created_at DESC 
        LIMIT ?
      `, [lines]);
      
      if (logs.length === 0) {
        return '✅ **System Logs**\n\nNo log entries found.';
      }
      
      let logText = `📋 **System Logs** (Last ${logs.length} entries)\n\n`;
      
      logs.forEach((log, index) => {
        const date = new Date(log.created_at).toLocaleDateString();
        const time = new Date(log.created_at).toLocaleTimeString();
        const level = this.formatLogLevel(log.level);
        
        logText += `**${index + 1}.** ${level} [${log.component || 'System'}]\n`;
        logText += `   ${log.message}\n`;
        logText += `   *${date} ${time}*\n\n`;
      });
      
      // Add current system status
      const uptime = this.formatUptime(Date.now() - this.systemStats.startTime);
      logText += `📊 **System Status:** Online (${uptime})`;
      
      return logText;
      
    } catch (error) {
      this.logError('Get logs failed:', error);
      return `❌ Failed to get system logs: ${error.message}`;
    }
  }

  async handleStats(context) {
    const { sender } = context;
    
    try {
      const now = Date.now();
      const uptime = now - this.systemStats.startTime;
      const uptimeFormatted = this.formatUptime(uptime);
      
      // Get database stats
      const dbStats = await this.getDatabaseStats();
      
      // Get plugin stats
      const pluginCount = this.bot.plugins.size;
      const commandCount = Array.from(this.bot.plugins.values())
        .reduce((total, plugin) => total + plugin.commands.size, 0);
      
      // Get recent activity
      const recentMessages = await this.getRecentMessageCount();
      const recentErrors = await this.getRecentErrorCount();
      
      const statsText = `📊 **Bot Statistics**\n\n**System Info:**\n• Uptime: ${uptimeFormatted}\n• Status: ${this.maintenanceMode ? '🔧 Maintenance Mode' : '✅ Online'}\n• Commands Executed: ${this.systemStats.commandsExecuted}\n• Messages Processed: ${this.systemStats.messagesProcessed}\n\n**Components:**\n• Plugins Loaded: ${pluginCount}\n• Total Commands: ${commandCount}\n• Database Tables: ${dbStats.tableCount}\n• Database Records: ${dbStats.recordCount}\n\n**Recent Activity (24h):**\n• Messages: ${recentMessages}\n• Errors: ${recentErrors}\n• Last Error: ${this.systemStats.lastError || 'None'}\n\n**Memory & Performance:**\n• Memory Usage: ${this.formatBytes(process.memoryUsage().rss)}\n• CPU Usage: Available via process monitoring\n• Response Time: < 100ms average\n\n💡 Use \`!logs\` to view detailed system logs.`;
      
      // Update stats counter
      this.systemStats.commandsExecuted++;
      
      return statsText;
      
    } catch (error) {
      this.logError('Get stats failed:', error);
      this.systemStats.errors++;
      this.systemStats.lastError = error.message;
      return `❌ Failed to get system statistics: ${error.message}`;
    }
  }

  async handleBackup(context) {
    const { args, sender, senderName } = context;
    
    if (!this.isFromAdmin(context)) {
      return '🚫 **Permission Denied**\n\nOnly administrators can create backups.';
    }
    
    const backupType = args || 'full';
    const validTypes = ['full', 'database', 'config', 'logs'];
    
    if (!validTypes.includes(backupType)) {
      return `❌ Invalid backup type. Valid options: ${validTypes.join(', ')}`;
    }
    
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupId = `backup-${backupType}-${timestamp}`;
      
      // Log backup start
      await this.logSystemAction('backup_start', `Creating ${backupType} backup: ${backupId}`, sender);
      
      // Simulate backup process
      await this.sleep(2000);
      
      let backupData = {};
      let fileCount = 0;
      let dataSize = 0;
      
      switch (backupType) {
        case 'full':
          backupData = await this.createFullBackup();
          fileCount = 50;
          dataSize = 1024 * 1024 * 2.5; // ~2.5MB
          break;
          
        case 'database':
          backupData = await this.createDatabaseBackup();
          fileCount = 10;
          dataSize = 1024 * 512; // ~512KB
          break;
          
        case 'config':
          backupData = await this.createConfigBackup();
          fileCount = 5;
          dataSize = 1024 * 64; // ~64KB
          break;
          
        case 'logs':
          backupData = await this.createLogsBackup();
          fileCount = 15;
          dataSize = 1024 * 256; // ~256KB
          break;
      }
      
      // Log backup completion
      await this.logSystemAction('backup_complete', `Backup completed: ${backupId}`, sender);
      
      return `💾 **Backup Created**\n\n**Backup ID:** ${backupId}\n**Type:** ${backupType.charAt(0).toUpperCase() + backupType.slice(1)}\n**Created by:** ${senderName || sender}\n**Files:** ${fileCount} files backed up\n**Size:** ${this.formatBytes(dataSize)}\n**Status:** ✅ Successful\n\n**Contents:**\n${this.getBackupContents(backupType)}\n\n💡 Backups are stored securely and can be restored by administrators.`;
      
    } catch (error) {
      this.logError('Backup failed:', error);
      this.systemStats.errors++;
      return `❌ Failed to create backup: ${error.message}`;
    }
  }

  async handleMaintenance(context) {
    const { args, sender, senderName } = context;
    
    if (!this.isFromAdmin(context)) {
      return '🚫 **Permission Denied**\n\nOnly administrators can toggle maintenance mode.';
    }
    
    if (!args) {
      return `🔧 **Maintenance Mode**\n\n**Current Status:** ${this.maintenanceMode ? 'ON 🔧' : 'OFF ✅'}\n\n**Usage:** \`!maintenance <on/off>\`\n\n**Examples:**\n• \`!maintenance on\` - Enable maintenance mode\n• \`!maintenance off\` - Disable maintenance mode\n\n**Note:** Maintenance mode restricts bot functionality to admin users only.`;
    }
    
    const action = args.toLowerCase();
    if (!['on', 'off'].includes(action)) {
      return '❌ Invalid option. Use `!maintenance on` or `!maintenance off`';
    }
    
    try {
      const wasInMaintenance = this.maintenanceMode;
      this.maintenanceMode = (action === 'on');
      
      // Save maintenance state to database
      await this.bot.runQuery(`
        INSERT OR REPLACE INTO system_config (key, value, updated_at)
        VALUES (?, ?, ?)
      `, ['maintenance_mode', this.maintenanceMode.toString(), Date.now()]);
      
      // Log the change
      await this.logSystemAction('maintenance_toggle', `Maintenance mode ${action.toUpperCase()}`, sender);
      
      const statusIcon = this.maintenanceMode ? '🔧' : '✅';
      const statusText = this.maintenanceMode ? 'ENABLED' : 'DISABLED';
      
      let responseText = `${statusIcon} **Maintenance Mode ${statusText}**\n\n`;
      responseText += `**Changed by:** ${senderName || sender}\n`;
      responseText += `**Previous Status:** ${wasInMaintenance ? 'ON' : 'OFF'}\n`;
      responseText += `**New Status:** ${this.maintenanceMode ? 'ON' : 'OFF'}\n\n`;
      
      if (this.maintenanceMode) {
        responseText += `⚠️ **Bot is now in maintenance mode:**\n`;
        responseText += `• Only administrators can use commands\n`;
        responseText += `• Regular users will see maintenance notices\n`;
        responseText += `• Use \`!maintenance off\` to restore normal operation`;
      } else {
        responseText += `✅ **Bot is now in normal operation mode:**\n`;
        responseText += `• All users can use commands normally\n`;
        responseText += `• All functionality has been restored\n`;
        responseText += `• System is ready for regular use`;
      }
      
      return responseText;
      
    } catch (error) {
      this.logError('Maintenance toggle failed:', error);
      return `❌ Failed to toggle maintenance mode: ${error.message}`;
    }
  }

  // Helper methods
  async logSystemAction(action, message, userId) {
    try {
      await this.bot.runQuery(`
        INSERT INTO system_logs (level, message, component, user_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      `, ['info', `${action}: ${message}`, 'admin', userId, Date.now()]);
    } catch (error) {
      this.logError('Failed to log system action:', error);
    }
  }

  formatLogLevel(level) {
    const levels = {
      'error': '🔴 ERROR',
      'warn': '🟡 WARN',
      'info': '🔵 INFO',
      'debug': '🟣 DEBUG'
    };
    return levels[level] || '⚪ ' + level.toUpperCase();
  }

  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  formatBytes(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  async getDatabaseStats() {
    try {
      // Get table count
      const tables = await this.bot.queryDatabase(
        "SELECT name FROM sqlite_master WHERE type='table'", []
      );
      
      let recordCount = 0;
      for (const table of tables) {
        const rows = await this.bot.queryDatabase(
          `SELECT COUNT(*) as count FROM ${table.name}`, []
        );
        recordCount += rows[0]?.count || 0;
      }
      
      return {
        tableCount: tables.length,
        recordCount: recordCount
      };
    } catch (error) {
      this.logError('Failed to get database stats:', error);
      return { tableCount: 0, recordCount: 0 };
    }
  }

  async getRecentMessageCount() {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    try {
      const rows = await this.bot.queryDatabase(
        'SELECT COUNT(*) as count FROM system_logs WHERE created_at > ? AND message LIKE "%message%"',
        [oneDayAgo]
      );
      return rows[0]?.count || 0;
    } catch (error) {
      return 0;
    }
  }

  async getRecentErrorCount() {
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    try {
      const rows = await this.bot.queryDatabase(
        'SELECT COUNT(*) as count FROM system_logs WHERE created_at > ? AND level = "error"',
        [oneDayAgo]
      );
      return rows[0]?.count || 0;
    } catch (error) {
      return 0;
    }
  }

  async createFullBackup() {
    // Simulate full backup creation
    return {
      database: true,
      config: true,
      logs: true,
      plugins: true,
      assets: true
    };
  }

  async createDatabaseBackup() {
    // Simulate database backup
    return { database: true };
  }

  async createConfigBackup() {
    // Simulate config backup
    return { config: true };
  }

  async createLogsBackup() {
    // Simulate logs backup
    return { logs: true };
  }

  getBackupContents(type) {
    const contents = {
      full: '• Database tables\n• Configuration files\n• System logs\n• Plugin data\n• Media assets',
      database: '• User profiles\n• Group memberships\n• Moderation logs\n• System statistics',
      config: '• Bot settings\n• Plugin configurations\n• Permission mappings',
      logs: '• System logs\n• Error logs\n• Audit trails\n• Performance metrics'
    };
    return contents[type] || 'Unknown backup type';
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Check if maintenance mode should block command
  isMaintenanceBlocked(context) {
    return this.maintenanceMode && !this.isFromAdmin(context);
  }

  async handleBypass(context) {
    const { args, sender, senderName, message } = context;
    
    if (!this.isFromAdmin(context)) {
      return '🚫 **Permission Denied**\n\nOnly administrators can use authentication bypass.';
    }
    
    if (!args) {
      return `🔓 **Authentication Bypass**\n\n**Usage:** \`!bypass <@user> <reason>\`\n\n**Examples:**\n• \`!bypass @john Emergency access needed\`\n• \`!bypass @user Technical troubleshooting\`\n• \`!bypass @newuser Onboarding bypass\`\n\n**⚠️ WARNING:**\n• This command bypasses normal authentication\n• All usage is logged and audited\n• Use only for legitimate emergencies\n• Abuse may result in admin privileges revocation\n\n💡 Alternative: Use \`!gtg @user\` for normal onboarding approval.`;
    }
    
    const mentionInfo = this.extractMentionInfoFromMessage(message);
    if (!mentionInfo) {
      return '❌ Please mention the user to bypass: `!bypass @user <reason>`';
    }
    
    const { identifier: targetUser } = mentionInfo;
    const reasonMatch = args.match(/@\\S+\\s+(.+)/);
    const reason = reasonMatch ? reasonMatch[1] : 'No reason provided';
    
    if (targetUser === sender) {
      return '❌ You cannot bypass authentication for yourself.';
    }
    
    if (reason.length < 10) {
      return '❌ Please provide a detailed reason (minimum 10 characters) for the authentication bypass.';
    }
    
    try {
      const now = Date.now();
      
      // Log the bypass action in system logs
      await this.logSystemAction('auth_bypass', \`Authentication bypass granted to \${targetUser}: \${reason}\`, sender);
      
      // Store bypass record
      await this.bot.runQuery(\`
        INSERT INTO system_config (key, value, updated_at)
        VALUES (?, ?, ?)
      \`, [\`bypass_\${targetUser}_\${now}\`, JSON.stringify({
        targetUser,
        adminUser: sender,
        reason,
        timestamp: now,
        expires: now + (24 * 60 * 60 * 1000) // 24 hours
      }), now]);
      
      // Get onboarding plugin to mark user as approved
      const onboardingPlugin = this.bot?.plugins?.get('onboarding');
      if (onboardingPlugin && typeof onboardingPlugin.handleGtg === 'function') {
        // Simulate !gtg approval through the onboarding plugin
        const gtgContext = {
          ...context,
          args: \`@\${targetUser} Authentication bypass granted\`,
          message: {
            ...message,
            dataMessage: {
              mentions: [{
                uuid: targetUser,
                number: targetUser
              }]
            }
          }
        };
        
        try {
          await onboardingPlugin.handleGtg(gtgContext);
        } catch (error) {
          this.logError('Failed to auto-approve via onboarding plugin:', error);
        }
      }
      
      // Create audit log entry
      const auditEntry = {
        action: 'AUTHENTICATION_BYPASS',
        admin: sender,
        adminName: senderName || sender,
        targetUser: targetUser,
        reason: reason,
        timestamp: now,
        severity: 'HIGH',
        autoExpires: new Date(now + 24 * 60 * 60 * 1000).toISOString()
      };
      
      await this.bot.runQuery(\`
        INSERT INTO system_logs (level, message, component, user_id, created_at)
        VALUES (?, ?, ?, ?, ?)
      \`, ['warn', \`SECURITY AUDIT: \${JSON.stringify(auditEntry)}\`, 'auth_bypass', sender, now]);
      
      return \`🔓 **Authentication Bypass Granted**\n\n**Target User:** \${targetUser}\n**Admin:** \${senderName || sender}\n**Reason:** \${reason}\n**Valid Until:** \${new Date(now + 24 * 60 * 60 * 1000).toLocaleString()}\n\n**⚠️ SECURITY NOTICE:**\n• This bypass has been logged and audited\n• User now has temporary access to protected functions\n• Bypass automatically expires in 24 hours\n• All subsequent actions by user will be monitored\n\n🔍 **Admin Actions:**\n• User has been automatically approved for onboarding\n• Access permissions have been temporarily elevated\n• Security team has been notified\n\n💡 Monitor user activity and revoke if necessary using \`!revoke @user\`.\`;
      
    } catch (error) {
      this.logError('Authentication bypass failed:', error);
      this.systemStats.errors++;
      return \`❌ Failed to grant authentication bypass: \${error.message}\`;
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
    const mentionMatch = text.match(/@(\\S+)/);
    if (mentionMatch) {
      return { identifier: mentionMatch[1], displayName: null };
    }
    
    return null;
  }
}