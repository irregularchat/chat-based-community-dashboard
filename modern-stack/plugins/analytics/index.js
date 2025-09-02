import { BasePlugin } from '../base.js';
import { BaseCommand } from '../../commands.js';

// Analytics Commands for Admins
class StatsCommand extends BaseCommand {
  constructor() {
    super('stats', 'Show bot usage statistics', '!stats [days]', {
      adminOnly: true
    });
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('analytics');
    return await plugin.handleStats(context);
  }
}

class TopCommandsCommand extends BaseCommand {
  constructor() {
    super('topcommands', 'Show most used commands', '!topcommands [limit]', {
      adminOnly: true
    });
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('analytics');
    return await plugin.handleTopCommands(context);
  }
}

class TopUsersCommand extends BaseCommand {
  constructor() {
    super('topusers', 'Show most active users', '!topusers [limit]', {
      adminOnly: true
    });
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('analytics');
    return await plugin.handleTopUsers(context);
  }
}

class ErrorsCommand extends BaseCommand {
  constructor() {
    super('errors', 'Show recent bot errors', '!errors [limit]', {
      adminOnly: true
    });
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('analytics');
    return await plugin.handleErrors(context);
  }
}

class NewsStatsCommand extends BaseCommand {
  constructor() {
    super('newsstats', 'Show news link statistics', '!newsstats [days]', {
      adminOnly: true
    });
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('analytics');
    return await plugin.handleNewsStats(context);
  }
}

class SentimentCommand extends BaseCommand {
  constructor() {
    super('sentiment', 'Show bot feedback sentiment', '!sentiment [days]', {
      adminOnly: true
    });
  }

  async execute(context) {
    const plugin = context.bot.plugins.get('analytics');
    return await plugin.handleSentiment(context);
  }
}

export default class AnalyticsPlugin extends BasePlugin {
  constructor(bot) {
    super(bot, 'analytics');
    
    // Register commands
    this.addCommand(new StatsCommand());
    this.addCommand(new TopCommandsCommand());
    this.addCommand(new TopUsersCommand());
    this.addCommand(new ErrorsCommand());
    this.addCommand(new NewsStatsCommand());
    this.addCommand(new SentimentCommand());
    
    this.logInfo('Analytics plugin initialized');
  }

  async handleStats(context) {
    const { args } = context;
    const days = parseInt(args) || 7;
    
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      
      // Get command usage stats
      const totalCommands = await this.bot.prisma.botCommandUsage.count({
        where: { timestamp: { gte: since } }
      });
      
      const successfulCommands = await this.bot.prisma.botCommandUsage.count({
        where: { 
          timestamp: { gte: since },
          success: true 
        }
      });
      
      const uniqueUsers = await this.bot.prisma.botCommandUsage.findMany({
        where: { timestamp: { gte: since } },
        select: { userId: true },
        distinct: ['userId']
      });
      
      const uniqueGroups = await this.bot.prisma.botCommandUsage.findMany({
        where: { 
          timestamp: { gte: since },
          groupId: { not: null }
        },
        select: { groupId: true },
        distinct: ['groupId']
      });
      
      // Calculate averages
      const avgPerDay = Math.round(totalCommands / days);
      const successRate = totalCommands > 0 
        ? ((successfulCommands / totalCommands) * 100).toFixed(1)
        : 0;
      
      return `📊 Bot Statistics (Last ${days} days)

📈 Usage:
• Total Commands: ${totalCommands}
• Success Rate: ${successRate}%
• Avg/Day: ${avgPerDay}

👥 Activity:
• Active Users: ${uniqueUsers.length}
• Active Groups: ${uniqueGroups.length}

💡 Use !topcommands to see popular commands`;
      
    } catch (error) {
      this.logError('Failed to get stats:', error);
      return '❌ Failed to retrieve statistics';
    }
  }

  async handleTopCommands(context) {
    const { args } = context;
    const limit = Math.min(parseInt(args) || 10, 15); // Max 15 for readability
    
    try {
      const topCommands = await this.bot.prisma.botCommandUsage.groupBy({
        by: ['command'],
        _count: { command: true },
        orderBy: { _count: { command: 'desc' } },
        take: limit
      });
      
      if (topCommands.length === 0) {
        return '📊 No command usage data available yet';
      }
      
      let response = `🏆 Top ${limit} Commands\n\n`;
      
      topCommands.forEach((cmd, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        response += `${medal} !${cmd.command}: ${cmd._count.command} uses\n`;
      });
      
      return response;
      
    } catch (error) {
      this.logError('Failed to get top commands:', error);
      return '❌ Failed to retrieve top commands';
    }
  }

  async handleTopUsers(context) {
    const { args } = context;
    const limit = Math.min(parseInt(args) || 5, 10); // Max 10 for privacy
    
    try {
      const topUsers = await this.bot.prisma.botCommandUsage.groupBy({
        by: ['userName'],
        _count: { userName: true },
        where: { userName: { not: null } },
        orderBy: { _count: { userName: 'desc' } },
        take: limit
      });
      
      if (topUsers.length === 0) {
        return '👥 No user activity data available yet';
      }
      
      let response = `👥 Top ${limit} Active Users\n\n`;
      
      topUsers.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        // Anonymize usernames for privacy (show first name only)
        const firstName = user.userName.split(' ')[0];
        response += `${medal} ${firstName}: ${user._count.userName} commands\n`;
      });
      
      return response;
      
    } catch (error) {
      this.logError('Failed to get top users:', error);
      return '❌ Failed to retrieve top users';
    }
  }

  async handleErrors(context) {
    const { args } = context;
    const limit = Math.min(parseInt(args) || 5, 10);
    
    try {
      const recentErrors = await this.bot.prisma.botError.findMany({
        take: limit,
        orderBy: { timestamp: 'desc' },
        select: {
          errorType: true,
          errorMessage: true,
          command: true,
          timestamp: true
        }
      });
      
      if (recentErrors.length === 0) {
        return '✅ No errors logged (excellent!)';
      }
      
      let response = `❌ Recent Errors (${recentErrors.length})\n\n`;
      
      recentErrors.forEach(error => {
        const timeAgo = this.getTimeAgo(error.timestamp);
        const cmd = error.command ? `!${error.command}` : 'N/A';
        const msg = error.errorMessage.substring(0, 50);
        response += `• ${error.errorType}\n  Cmd: ${cmd}\n  ${timeAgo}\n\n`;
      });
      
      return response;
      
    } catch (error) {
      this.logError('Failed to get errors:', error);
      return '❌ Failed to retrieve error logs';
    }
  }

  async handleNewsStats(context) {
    const { args } = context;
    const days = parseInt(args) || 7;
    
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      
      // Get news stats
      const totalNewsLinks = await this.bot.prisma.newsLink.count({
        where: { firstPostedAt: { gte: since } }
      });
      
      const topNews = await this.bot.prisma.newsLink.findMany({
        where: { firstPostedAt: { gte: since } },
        orderBy: [
          { reactionCount: 'desc' },
          { postCount: 'desc' }
        ],
        take: 5,
        select: {
          domain: true,
          title: true,
          reactionCount: true,
          thumbsUp: true,
          thumbsDown: true,
          postCount: true
        }
      });
      
      let response = `📰 News Statistics (${days} days)\n\n`;
      response += `Total Links: ${totalNewsLinks}\n\n`;
      
      if (topNews.length > 0) {
        response += `🔥 Top News by Engagement:\n\n`;
        
        topNews.forEach((news, index) => {
          const title = news.title ? news.title.substring(0, 30) + '...' : news.domain;
          response += `${index + 1}. ${title}\n`;
          response += `   👍 ${news.thumbsUp} 👎 ${news.thumbsDown} 🔄 ${news.postCount}x\n\n`;
        });
      }
      
      return response;
      
    } catch (error) {
      this.logError('Failed to get news stats:', error);
      return '❌ Failed to retrieve news statistics';
    }
  }

  async handleSentiment(context) {
    const { args } = context;
    const days = parseInt(args) || 30;
    
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      
      // Get reaction stats
      const totalReactions = await this.bot.prisma.botMessageReaction.count({
        where: { timestamp: { gte: since } }
      });
      
      const positiveReactions = await this.bot.prisma.botMessageReaction.count({
        where: { 
          timestamp: { gte: since },
          isPositive: true
        }
      });
      
      const negativeReactions = totalReactions - positiveReactions;
      
      // Get reaction breakdown
      const reactionBreakdown = await this.bot.prisma.botMessageReaction.groupBy({
        by: ['reaction'],
        _count: { reaction: true },
        where: { timestamp: { gte: since } },
        orderBy: { _count: { reaction: 'desc' } },
        take: 5
      });
      
      const sentimentScore = totalReactions > 0 
        ? ((positiveReactions / totalReactions) * 100).toFixed(1)
        : 0;
      
      let response = `💭 Bot Sentiment (${days} days)\n\n`;
      response += `Overall: ${sentimentScore}% Positive\n\n`;
      response += `📊 Breakdown:\n`;
      response += `👍 Positive: ${positiveReactions}\n`;
      response += `👎 Negative: ${negativeReactions}\n\n`;
      
      if (reactionBreakdown.length > 0) {
        response += `🎯 Top Reactions:\n`;
        reactionBreakdown.forEach(r => {
          response += `${r.reaction}: ${r._count.reaction}x\n`;
        });
      }
      
      return response;
      
    } catch (error) {
      this.logError('Failed to get sentiment:', error);
      return '❌ Failed to retrieve sentiment data';
    }
  }

  // Helper method
  getTimeAgo(date) {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}