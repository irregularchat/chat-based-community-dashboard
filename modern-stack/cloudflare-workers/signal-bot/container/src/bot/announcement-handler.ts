/**
 * Announcement Handler
 *
 * Handles !announce command for broadcasting messages to Signal groups
 * Supports immediate and scheduled delivery, group messages and DMs
 */

import { PostgresClient } from '../db/postgres-client.js';
import { parseTimeSpec, formatScheduledTime, getTimeFormatHelp, ParsedTime } from '../utils/time-parser.js';

export interface AnnouncementFlags {
  time: ParsedTime | null;
  groups: string[];        // Group numbers from !groups list (e.g., ["1", "5"])
  dm: boolean;             // Send as DM to each member
  message: string;
}

export interface GroupInfo {
  id: string;
  name: string;
  memberCount: number;
  members?: any[];
}

export interface GroupMember {
  uuid: string;
  phone_number: string | null;
  display_name: string | null;
}

export interface AnnouncementResult {
  success: boolean;
  message: string;
  scheduled?: boolean;
  scheduledTime?: Date;
  announcementId?: number;
  groupsSent?: string[];
  membersSent?: number;
  errors?: string[];
}

export class AnnouncementHandler {
  private dbClient: PostgresClient;
  private bot: any;

  constructor(dbClient: PostgresClient, bot: any) {
    this.dbClient = dbClient;
    this.bot = bot;
  }

  /**
   * Parse !announce command arguments
   *
   * Syntax (new, simplified):
   *   !announce <groups> <message>          # Specific groups
   *   !announce <message>                   # ALL groups (default)
   *   !announce -t time <groups> <message>  # Scheduled
   *   !announce -dm <groups> <message>      # DM to members
   *
   * Groups can be:
   *   - Numbers: 13 or 1,5,13
   *   - Keywords: tech or tech,cyber
   *   - Mixed: 1,tech,5,cyber
   *   - "all" for all groups (default)
   *
   * Also supports legacy -g flag syntax for backwards compatibility
   */
  parseCommand(args: string): AnnouncementFlags {
    const result: AnnouncementFlags = {
      time: null,
      groups: [],
      dm: false,
      message: '',
    };

    if (!args || args.trim().length === 0) {
      return result;
    }

    let remaining = args.trim();

    // Keep parsing flags until no more flags found
    let foundFlag = true;
    while (foundFlag && remaining.length > 0) {
      foundFlag = false;

      // Parse -t flag (time)
      const timeMatch = remaining.match(/^-t\s+(\S+)\s*/);
      if (timeMatch) {
        result.time = parseTimeSpec(timeMatch[1]);
        remaining = remaining.slice(timeMatch[0].length);
        foundFlag = true;
        continue;
      }

      // Parse -g flag (groups) - legacy syntax
      const groupMatch = remaining.match(/^-g\s+(\S+)\s*/);
      if (groupMatch) {
        const groupSpec = groupMatch[1];
        if (groupSpec.toLowerCase() === 'all') {
          result.groups = ['all'];
        } else {
          result.groups = groupSpec.split(',').map(g => g.trim()).filter(g => g.length > 0);
        }
        remaining = remaining.slice(groupMatch[0].length);
        foundFlag = true;
        continue;
      }

      // Parse -dm flag
      const dmMatch = remaining.match(/^-dm\s*/i);
      if (dmMatch) {
        result.dm = true;
        remaining = remaining.slice(dmMatch[0].length);
        foundFlag = true;
        continue;
      }
    }

    // If no groups specified yet via -g flag, check if first word looks like a group selector
    if (result.groups.length === 0 && remaining.length > 0) {
      const parts = remaining.split(/\s+/);
      const firstPart = parts[0];

      // Check if first part looks like a group selector (numbers, keywords, or mixed)
      // Group selectors: "13", "1,5,13", "tech", "tech,cyber", "1,tech,5"
      // NOT group selectors: Normal message words, URLs, sentences
      if (this.looksLikeGroupSelector(firstPart)) {
        if (firstPart.toLowerCase() === 'all') {
          result.groups = ['all'];
        } else {
          result.groups = firstPart.split(',').map(g => g.trim()).filter(g => g.length > 0);
        }
        remaining = parts.slice(1).join(' ').trim();
      }
    }

    // Rest is the message
    result.message = remaining.trim();

    return result;
  }

  /**
   * Check if a string looks like a group selector (number, keyword, or comma-separated)
   * Returns false for things that look like message content
   */
  private looksLikeGroupSelector(str: string): boolean {
    if (!str || str.length === 0) return false;

    // "all" is a valid selector
    if (str.toLowerCase() === 'all') return true;

    // If it contains commas, check each part
    const parts = str.split(',').map(s => s.trim()).filter(s => s.length > 0);
    if (parts.length === 0) return false;

    for (const part of parts) {
      // Numbers are valid (group numbers)
      if (/^\d+$/.test(part)) continue;

      // Short alphanumeric strings without spaces (keywords)
      // Keywords should be at least 3 chars and contain only alphanumeric
      if (/^[a-zA-Z][a-zA-Z0-9_-]{2,}$/.test(part)) continue;

      // Single word "all"
      if (part.toLowerCase() === 'all') continue;

      // Doesn't look like a valid selector part
      return false;
    }

    return true;
  }

  /**
   * Resolve group selectors (numbers or keywords) to actual group IDs
   *
   * @param groupSelectors - Array of group numbers or keywords (e.g., ["1", "5", "tech", "cyber"]) or ["all"]
   * @param currentGroupId - Current group ID if no groups specified
   * @param forceRefresh - Force refresh from signal-cli (needed for DM to get actual member UUIDs)
   * @returns Array of GroupInfo objects with matched info
   */
  async resolveGroups(groupSelectors: string[], currentGroupId?: string, forceRefresh: boolean = false): Promise<GroupInfo[]> {
    // Get all groups from bot
    // forceRefresh=true bypasses database cache which only stores member counts, not actual UUIDs
    const allGroups = await this.bot.getGroups(forceRefresh);

    if (!allGroups || allGroups.length === 0) {
      return [];
    }

    // Sort by member count (same as !groups command)
    allGroups.sort((a: any, b: any) => (b.members?.length || 0) - (a.members?.length || 0));

    // If "all" specified OR no groups specified, return all groups (default behavior)
    if (groupSelectors.length === 0 || (groupSelectors.length === 1 && groupSelectors[0].toLowerCase() === 'all')) {
      return allGroups.map((g: any) => ({
        id: g.id,
        name: g.name,
        memberCount: g.members?.length || 0,
        members: g.members,
      }));
    }

    // Resolve specific group numbers and keywords (deduplicated by group ID)
    const resolvedMap: Map<string, GroupInfo> = new Map();

    for (const selector of groupSelectors) {
      const selectorLower = selector.toLowerCase().trim();

      // Check if it's a number
      const num = parseInt(selector, 10);
      if (!isNaN(num) && num > 0 && num <= allGroups.length) {
        const group = allGroups[num - 1]; // 1-indexed
        if (!resolvedMap.has(group.id)) {
          resolvedMap.set(group.id, {
            id: group.id,
            name: group.name,
            memberCount: group.members?.length || 0,
            members: group.members,
          });
        }
      } else if (selectorLower.length >= 3) {
        // It's a keyword - search group names (minimum 3 chars)
        for (const group of allGroups) {
          const groupName = (group.name || '').toLowerCase();
          if (groupName.includes(selectorLower) && !resolvedMap.has(group.id)) {
            resolvedMap.set(group.id, {
              id: group.id,
              name: group.name,
              memberCount: group.members?.length || 0,
              members: group.members,
            });
          }
        }
      }
    }

    return Array.from(resolvedMap.values());
  }

  /**
   * Get members of a group from database
   */
  async getGroupMembers(groupId: string): Promise<GroupMember[]> {
    try {
      const result = await this.dbClient.query(`
        SELECT
          m.uuid,
          m.phone_number,
          COALESCE(m.display_name, m.profile_name, m.phone_number) as display_name
        FROM signal_members m
        INNER JOIN signal_member_group_memberships mgm ON m.id = mgm.member_id
        WHERE mgm.group_id = $1
          AND mgm.is_active = true
          AND (m.is_bot = false OR m.is_bot IS NULL)
        ORDER BY m.display_name
      `, [groupId]);

      return (result.results || []) as GroupMember[];
    } catch (error) {
      console.error('Error fetching group members:', error);
      return [];
    }
  }

  /**
   * Send announcement immediately to groups
   */
  async sendToGroups(groups: GroupInfo[], message: string): Promise<{ sent: string[], errors: string[] }> {
    const sent: string[] = [];
    const errors: string[] = [];

    for (const group of groups) {
      try {
        await this.bot.sendMessage({
          groupId: group.id,
          message: message,
        });
        sent.push(group.name);
        console.log(`[announce] Sent to group: ${group.name}`);

        // Small delay to avoid rate limiting
        await this.delay(300);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${group.name}: ${errorMsg}`);
        console.error(`[announce] Failed to send to ${group.name}:`, error);
      }
    }

    return { sent, errors };
  }

  /**
   * Send announcement as DM to each member of specified groups
   */
  async sendDMsToGroupMembers(groups: GroupInfo[], message: string): Promise<{ sent: number, errors: string[] }> {
    const errors: string[] = [];
    let sentCount = 0;
    const sentTo = new Set<string>(); // Avoid duplicate DMs

    for (const group of groups) {
      // Get members from database
      const members = await this.getGroupMembers(group.id);

      if (members.length === 0) {
        // Fallback to group.members if database is empty
        // Note: signal-cli returns members as string[] (UUIDs), not objects
        if (group.members && Array.isArray(group.members)) {
          console.log(`[announce] Using signal-cli members: ${group.members.length} members for ${group.name}`);
          for (const member of group.members) {
            // Handle both string UUIDs (from signal-cli) and objects (from database)
            const recipient = typeof member === 'string' ? member : (member.number || member.uuid);
            if (!recipient || sentTo.has(recipient)) continue;

            try {
              await this.bot.sendMessage({
                recipient: recipient,
                message: message,
              });
              sentCount++;
              sentTo.add(recipient);
              console.log(`[announce] DM sent to: ${recipient}`);

              // Rate limit: 500ms between DMs
              await this.delay(500);
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Unknown error';
              errors.push(`DM to ${recipient}: ${errorMsg}`);
            }
          }
        }
      } else {
        // Use database members
        for (const member of members) {
          const recipient = member.phone_number || member.uuid;
          if (!recipient || sentTo.has(recipient)) continue;

          try {
            await this.bot.sendMessage({
              recipient: recipient,
              message: message,
            });
            sentCount++;
            sentTo.add(recipient);
            console.log(`[announce] DM sent to: ${member.display_name || recipient}`);

            // Rate limit: 500ms between DMs
            await this.delay(500);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            errors.push(`DM to ${member.display_name || recipient}: ${errorMsg}`);
          }
        }
      }
    }

    return { sent: sentCount, errors };
  }

  /**
   * Schedule an announcement for later delivery
   */
  async scheduleAnnouncement(
    message: string,
    groups: GroupInfo[],
    scheduledAt: Date,
    dm: boolean,
    createdBy: string,
    createdByName?: string
  ): Promise<{ id: number | null, error?: string }> {
    try {
      const groupIds = groups.map(g => g.id);
      const groupNames = groups.map(g => g.name);

      const result = await this.dbClient.query(`
        INSERT INTO scheduled_announcements
          (message, target_groups, target_group_names, send_as_dm, scheduled_at, created_by, created_by_name, status)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, 'pending')
        RETURNING id
      `, [
        message,
        JSON.stringify(groupIds),
        JSON.stringify(groupNames),
        dm,
        scheduledAt.toISOString(),
        createdBy,
        createdByName || null,
      ]);

      if (result.results && result.results.length > 0) {
        return { id: result.results[0].id };
      }
      return { id: null, error: 'Failed to insert announcement' };
    } catch (error) {
      console.error('Error scheduling announcement:', error);
      return { id: null, error: error instanceof Error ? error.message : 'Database error' };
    }
  }

  /**
   * Get pending announcements for a user
   */
  async getPendingAnnouncements(userId?: string): Promise<any[]> {
    try {
      let query = `
        SELECT id, message, target_group_names, send_as_dm, scheduled_at, status, created_by_name
        FROM scheduled_announcements
        WHERE status = 'pending'
      `;
      const params: any[] = [];

      if (userId) {
        query += ' AND created_by = $1';
        params.push(userId);
      }

      query += ' ORDER BY scheduled_at ASC LIMIT 20';

      const result = await this.dbClient.query(query, params);
      return result.results || [];
    } catch (error) {
      console.error('Error fetching pending announcements:', error);
      return [];
    }
  }

  /**
   * Cancel a scheduled announcement
   */
  async cancelAnnouncement(id: number, userId: string): Promise<{ success: boolean, error?: string }> {
    try {
      const result = await this.dbClient.query(`
        UPDATE scheduled_announcements
        SET status = 'cancelled'
        WHERE id = $1 AND created_by = $2 AND status = 'pending'
        RETURNING id
      `, [id, userId]);

      if (result.results && result.results.length > 0) {
        return { success: true };
      }
      return { success: false, error: 'Announcement not found or already processed' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Database error' };
    }
  }

  /**
   * Process and send a scheduled announcement
   */
  async processScheduledAnnouncement(announcement: any): Promise<void> {
    const { id, message, target_groups, send_as_dm } = announcement;

    try {
      // Parse target groups
      const groupIds: string[] = typeof target_groups === 'string'
        ? JSON.parse(target_groups)
        : target_groups;

      // Get group info
      const allGroups = await this.bot.getGroups();
      const targetGroups = allGroups.filter((g: any) => groupIds.includes(g.id));

      const groups: GroupInfo[] = targetGroups.map((g: any) => ({
        id: g.id,
        name: g.name,
        memberCount: g.members?.length || 0,
        members: g.members,
      }));

      let recipientCount = 0;

      if (send_as_dm) {
        const result = await this.sendDMsToGroupMembers(groups, message);
        recipientCount = result.sent;
      } else {
        const result = await this.sendToGroups(groups, message);
        recipientCount = result.sent.length;
      }

      // Mark as sent
      await this.dbClient.query(`
        UPDATE scheduled_announcements
        SET status = 'sent', sent_at = NOW(), recipient_count = $2
        WHERE id = $1
      `, [id, recipientCount]);

      console.log(`[scheduler] Announcement ${id} sent to ${recipientCount} recipients`);
    } catch (error) {
      // Mark as failed
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await this.dbClient.query(`
        UPDATE scheduled_announcements
        SET status = 'failed', error_message = $2
        WHERE id = $1
      `, [id, errorMsg]);

      console.error(`[scheduler] Announcement ${id} failed:`, error);
    }
  }

  /**
   * Get usage help
   */
  getHelp(): string {
    return [
      '📢 Announcement Command (Admin Only)',
      '',
      'Usage: !announce [groups] [flags] message',
      '',
      'Groups (optional, default=ALL):',
      '  13           Single group by number',
      '  1,5,13       Multiple groups by number',
      '  tech         Groups matching keyword',
      '  tech,cyber   Multiple keywords',
      '  1,tech,5     Mixed numbers and keywords',
      '  all          All groups (default)',
      '',
      'Flags:',
      '  -t <time>    Schedule for later',
      '  -dm          Send as DM to each member',
      '',
      'Examples:',
      '  !announce 13 Check out this CVE!       # Group 13 only',
      '  !announce tech,cyber Security alert!   # Groups with "tech" or "cyber"',
      '  !announce Hello everyone!              # ALL groups',
      '  !announce -t 24h Reminder tomorrow     # Scheduled, ALL groups',
      '  !announce -dm 5 Check your email       # DM members of group 5',
      '',
      getTimeFormatHelp(),
      '',
      'Related:',
      '  !announcements - List pending',
      '  !cancelannounce <id> - Cancel scheduled',
      '  !groups - See group numbers',
    ].join('\n');
  }

  /**
   * Format the result of an announcement action
   */
  formatResult(result: AnnouncementResult): string {
    const lines: string[] = [];

    if (result.scheduled) {
      lines.push('');
      lines.push(`Scheduled for: ${formatScheduledTime(result.scheduledTime!)}`);
      lines.push(`Announcement ID: ${result.announcementId}`);
      lines.push('');
      lines.push('Use !cancelannounce <id> to cancel');
    } else if (result.success) {
      lines.push('');
      if (result.membersSent !== undefined) {
        lines.push(`Sent to: ${result.membersSent} members`);
      }
      if (result.groupsSent && result.groupsSent.length > 0) {
        lines.push(`Groups: ${result.groupsSent.join(', ')}`);
      }
    }

    if (result.errors && result.errors.length > 0) {
      lines.push('');
      lines.push(`Errors (${result.errors.length}):`);
      result.errors.slice(0, 5).forEach(e => lines.push(`  - ${e}`));
      if (result.errors.length > 5) {
        lines.push(`  ... and ${result.errors.length - 5} more`);
      }
    }

    return result.message + lines.join('\n');
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
