/**
 * Announcement Scheduler
 *
 * Background service that checks for and processes scheduled announcements
 */

import { PostgresClient } from '../db/postgres-client.js';
import { AnnouncementHandler, GroupInfo } from '../bot/announcement-handler.js';

export class AnnouncementScheduler {
  private dbClient: PostgresClient;
  private bot: any;
  private announcementHandler: AnnouncementHandler;
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private readonly CHECK_INTERVAL_MS = 60000; // Check every 60 seconds

  constructor(dbClient: PostgresClient, bot: any) {
    this.dbClient = dbClient;
    this.bot = bot;
    this.announcementHandler = new AnnouncementHandler(dbClient, bot);
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      console.log('⏰ Announcement scheduler already running');
      return;
    }

    console.log('⏰ Starting announcement scheduler (checking every 60s)');
    this.isRunning = true;

    // Run immediately on start
    this.checkAndProcess().catch(err => {
      console.error('❌ Scheduler initial check failed:', err);
    });

    // Then run periodically
    this.checkInterval = setInterval(() => {
      this.checkAndProcess().catch(err => {
        console.error('❌ Scheduler check failed:', err);
      });
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('⏰ Announcement scheduler stopped');
  }

  /**
   * Check for and process pending announcements
   */
  private async checkAndProcess(): Promise<void> {
    try {
      // Get pending announcements that are due
      const pending = await this.dbClient.getPendingAnnouncements();

      if (pending.length === 0) {
        return;
      }

      console.log(`⏰ Found ${pending.length} pending announcement(s) to process`);

      for (const announcement of pending) {
        await this.processAnnouncement(announcement);
      }
    } catch (error) {
      console.error('❌ Error checking pending announcements:', error);
    }
  }

  /**
   * Process a single announcement
   */
  private async processAnnouncement(announcement: any): Promise<void> {
    const { id, message, target_groups, send_as_dm } = announcement;

    console.log(`📢 Processing announcement #${id}`);

    try {
      // Parse target groups
      const groupIds: string[] = typeof target_groups === 'string'
        ? JSON.parse(target_groups)
        : target_groups || [];

      if (groupIds.length === 0) {
        await this.dbClient.markAnnouncementFailed(id, 'No target groups specified');
        return;
      }

      // Get group info from bot
      const allGroups = await this.bot.getGroups();
      const targetGroups: GroupInfo[] = allGroups
        .filter((g: any) => groupIds.includes(g.id))
        .map((g: any) => ({
          id: g.id,
          name: g.name,
          memberCount: g.members?.length || 0,
          members: g.members,
        }));

      if (targetGroups.length === 0) {
        await this.dbClient.markAnnouncementFailed(id, 'Target groups no longer available');
        return;
      }

      let recipientCount = 0;

      if (send_as_dm) {
        // Send as DM to each member
        const result = await this.announcementHandler.sendDMsToGroupMembers(
          targetGroups,
          message
        );
        recipientCount = result.sent;

        if (result.errors.length > 0) {
          console.warn(`⚠️  Announcement #${id} had ${result.errors.length} DM errors`);
        }
      } else {
        // Send to groups
        const result = await this.announcementHandler.sendToGroups(
          targetGroups,
          message
        );
        recipientCount = result.sent.length;

        if (result.errors.length > 0) {
          console.warn(`⚠️  Announcement #${id} had ${result.errors.length} group errors`);
        }
      }

      // Mark as sent
      await this.dbClient.markAnnouncementSent(id, recipientCount);
      console.log(`✅ Announcement #${id} sent to ${recipientCount} recipients`);

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Announcement #${id} failed:`, error);
      await this.dbClient.markAnnouncementFailed(id, errorMsg);
    }
  }

  /**
   * Get scheduler status
   */
  getStatus(): { running: boolean; intervalMs: number } {
    return {
      running: this.isRunning,
      intervalMs: this.CHECK_INTERVAL_MS,
    };
  }

  /**
   * Manually trigger a check (for testing)
   */
  async triggerCheck(): Promise<void> {
    await this.checkAndProcess();
  }
}
