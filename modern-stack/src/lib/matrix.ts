import { MatrixClient, createClient, MsgType } from 'matrix-js-sdk';

interface MatrixConfig {
  homeserver: string;
  accessToken: string;
  userId: string;
  welcomeRoomId?: string;
  defaultRoomId?: string;
}

interface WelcomeMessageData {
  username: string;
  fullName: string;
  tempPassword: string;
  discourseUrl?: string;
}

interface DirectMessageResult {
  success: boolean;
  roomId?: string;
  eventId?: string;
  error?: string;
}

interface BulkOperationResult {
  success: boolean;
  results: Record<string, boolean>;
  errors: Record<string, string>;
  totalSuccess: number;
  totalFailed: number;
}

interface MatrixUser {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
  isSignalUser?: boolean;
  lastSeen?: Date;
}

interface MatrixRoom {
  roomId: string;
  name?: string;
  displayName?: string;
  topic?: string;
  memberCount: number;
  roomType?: string;
  isDirect: boolean;
  isEncrypted: boolean;
}

interface CacheStats {
  userCount: number;
  roomCount: number;
  membershipCount: number;
  lastSyncTime?: Date;
  cacheAge: number; // in minutes
}

class MatrixService {
  private config: MatrixConfig | null = null;
  private client: MatrixClient | null = null;
  private isActive = false;

  constructor() {
    this.initializeFromEnv();
  }

  private initializeFromEnv() {
    const homeserver = process.env.MATRIX_HOMESERVER;
    const accessToken = process.env.MATRIX_ACCESS_TOKEN;
    const userId = process.env.MATRIX_USER_ID;
    const welcomeRoomId = process.env.MATRIX_WELCOME_ROOM_ID;
    const defaultRoomId = process.env.MATRIX_DEFAULT_ROOM_ID;

    if (!homeserver || !accessToken || !userId) {
      console.warn('Matrix not configured. Required: MATRIX_HOMESERVER, MATRIX_ACCESS_TOKEN, MATRIX_USER_ID');
      return;
    }

    this.config = {
      homeserver,
      accessToken,
      userId,
      welcomeRoomId,
      defaultRoomId,
    };

    try {
      this.client = createClient({
        baseUrl: homeserver,
        accessToken: accessToken,
        userId: userId,
      });

      this.isActive = true;
      console.log('Matrix service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Matrix client:', error);
    }
  }

  private generateWelcomeMessage(data: WelcomeMessageData): string {
    const { username, fullName, tempPassword, discourseUrl } = data;

    let message = `🌟 Your First Step Into the IrregularChat! 🌟
You've just joined a community focused on breaking down silos, fostering innovation, 
and supporting service members and veterans.
---
Use This Username and Temporary Password ⬇️
Username: ${username}
Temporary Password: ${tempPassword}
Exactly as shown above 👆🏼

1️⃣ Step 1:
- Use the username and temporary password to log in to https://sso.irregularchat.com

2️⃣ Step 2:
- Update your email, important to be able to recover your account and verify your identity
- Save your Login Username and New Password to a Password Manager
- Visit the welcome page while logged in https://forum.irregularchat.com/t/84`;

    if (discourseUrl) {
      message += `

3️⃣ Step 3:
- We posted an intro about you, but you can complete or customize it:
${discourseUrl}`;
    }

    message += `

Please take a moment to learn about the community before you jump in.

If you have any questions or need assistance, feel free to reach out to the community admins.

Welcome aboard!`;

    return message;
  }

  public async sendWelcomeMessage(
    matrixUserId: string,
    username: string,
    fullName: string,
    tempPassword: string,
    discourseUrl?: string
  ): Promise<DirectMessageResult> {
    if (!this.isActive || !this.client) {
      return {
        success: false,
        error: 'Matrix service not configured',
      };
    }

    try {
      const welcomeMessage = this.generateWelcomeMessage({
        username,
        fullName,
        tempPassword,
        discourseUrl,
      });

      return await this.sendDirectMessage(matrixUserId, welcomeMessage);
    } catch (error) {
      console.error('Error sending welcome message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  public async sendDirectMessage(
    matrixUserId: string,
    message: string
  ): Promise<DirectMessageResult> {
    if (!this.isActive || !this.client) {
      return {
        success: false,
        error: 'Matrix service not configured',
      };
    }

    try {
      console.log(`Sending direct message to ${matrixUserId}`);

      // Create or get existing direct message room
      const roomId = await this.getOrCreateDirectRoom(matrixUserId);
      if (!roomId) {
        return {
          success: false,
          error: 'Failed to create or find direct message room',
        };
      }

      // Send the message
      const response = await this.client.sendEvent(roomId, 'm.room.message', {
        msgtype: MsgType.Text,
        body: message,
      });

      console.log(`Message sent successfully to ${matrixUserId} in room ${roomId}`);
      return {
        success: true,
        roomId,
        eventId: response.event_id,
      };
    } catch (error) {
      console.error('Error sending direct message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async getOrCreateDirectRoom(matrixUserId: string): Promise<string | null> {
    if (!this.client) return null;

    try {
      // Try to find existing direct room
      const rooms = this.client.getRooms();
      for (const room of rooms) {
        // Check if room is a direct message room (has exactly 2 members)
        const members = room.getMembers();
        if (members.length === 2 && members.some(member => member.userId === matrixUserId)) {
          return room.roomId;
        }
      }

      // Create new direct room
      const response = await this.client.createRoom({
        is_direct: true,
        invite: [matrixUserId],
      });

      return response.room_id;
    } catch (error) {
      console.error('Error getting or creating direct room:', error);
      return null;
    }
  }

  public async sendRoomMessage(roomId: string, message: string): Promise<DirectMessageResult> {
    if (!this.isActive || !this.client) {
      return {
        success: false,
        error: 'Matrix service not configured',
      };
    }

    try {
      const response = await this.client.sendEvent(roomId, 'm.room.message', {
        msgtype: MsgType.Text,
        body: message,
      });

      return {
        success: true,
        roomId,
        eventId: response.event_id,
      };
    } catch (error) {
      console.error('Error sending room message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  public async inviteToRoom(roomId: string, matrixUserId: string): Promise<boolean> {
    if (!this.isActive || !this.client) {
      console.warn('Matrix service not configured');
      return false;
    }

    try {
      await this.client.invite(roomId, matrixUserId);
      console.log(`Successfully invited ${matrixUserId} to room ${roomId}`);
      return true;
    } catch (error) {
      console.error(`Error inviting ${matrixUserId} to room ${roomId}:`, error);
      return false;
    }
  }

  public async removeFromRoom(roomId: string, matrixUserId: string, reason?: string): Promise<boolean> {
    if (!this.isActive || !this.client) {
      console.warn('Matrix service not configured');
      return false;
    }

    try {
      await this.client.kick(roomId, matrixUserId, reason || 'Removed by admin');
      console.log(`Successfully removed ${matrixUserId} from room ${roomId}`);
      return true;
    } catch (error) {
      console.error(`Error removing ${matrixUserId} from room ${roomId}:`, error);
      return false;
    }
  }

  public async banFromRoom(roomId: string, matrixUserId: string, reason?: string): Promise<boolean> {
    if (!this.isActive || !this.client) {
      console.warn('Matrix service not configured');
      return false;
    }

    try {
      await this.client.ban(roomId, matrixUserId, reason || 'Banned by admin');
      console.log(`Successfully banned ${matrixUserId} from room ${roomId}`);
      return true;
    } catch (error) {
      console.error(`Error banning ${matrixUserId} from room ${roomId}:`, error);
      return false;
    }
  }

  public async setPowerLevel(roomId: string, matrixUserId: string, powerLevel: number): Promise<boolean> {
    if (!this.isActive || !this.client) {
      console.warn('Matrix service not configured');
      return false;
    }

    try {
      await this.client.setPowerLevel(roomId, matrixUserId, powerLevel);
      console.log(`Successfully set power level ${powerLevel} for ${matrixUserId} in room ${roomId}`);
      return true;
    } catch (error) {
      console.error(`Error setting power level for ${matrixUserId} in room ${roomId}:`, error);
      return false;
    }
  }

  public async syncModeratorPowerLevels(
    matrixUserId: string, 
    isModerator: boolean, 
    targetRooms?: string[]
  ): Promise<{ success: boolean; roomsUpdated: string[]; errors: string[] }> {
    if (!this.isActive || !this.client) {
      return {
        success: false,
        roomsUpdated: [],
        errors: ['Matrix service not configured'],
      };
    }

    const roomsUpdated: string[] = [];
    const errors: string[] = [];
    const powerLevel = isModerator ? 50 : 0; // 50 = moderator, 0 = normal user

    try {
      // Get rooms to update
      let roomsToUpdate: string[] = [];
      
      if (targetRooms && targetRooms.length > 0) {
        roomsToUpdate = targetRooms;
      } else {
        // Update all joined rooms where we have permission
        const allRooms = this.client.getRooms();
        roomsToUpdate = allRooms
          .filter(room => {
            // Only update rooms where we're an admin (power level 100)
            const myPowerLevel = room.getMember(this.config?.userId || '')?.powerLevel || 0;
            return myPowerLevel >= 100;
          })
          .map(room => room.roomId);
      }

      // Update power level in each room
      for (const roomId of roomsToUpdate) {
        try {
          const success = await this.setPowerLevel(roomId, matrixUserId, powerLevel);
          if (success) {
            roomsUpdated.push(roomId);
          } else {
            errors.push(`Failed to update power level in room ${roomId}`);
          }
        } catch (error) {
          errors.push(`Error updating power level in room ${roomId}: ${error}`);
        }
      }

      console.log(`Power level sync completed for ${matrixUserId}: ${roomsUpdated.length} rooms updated, ${errors.length} errors`);
      
      return {
        success: errors.length === 0,
        roomsUpdated,
        errors,
      };

    } catch (error) {
      console.error('Error in syncModeratorPowerLevels:', error);
      return {
        success: false,
        roomsUpdated: [],
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  public async getUserPowerLevel(roomId: string, matrixUserId: string): Promise<number | null> {
    if (!this.isActive || !this.client) {
      return null;
    }

    try {
      const room = this.client.getRoom(roomId);
      if (!room) return null;

      const member = room.getMember(matrixUserId);
      return member?.powerLevel || 0;
    } catch (error) {
      console.error(`Error getting power level for ${matrixUserId} in room ${roomId}:`, error);
      return null;
    }
  }

  public async inviteToRecommendedRooms(
    matrixUserId: string,
    interests: string[] = []
  ): Promise<{ success: boolean; invitedRooms: string[]; errors: string[] }> {
    if (!this.isActive || !this.client) {
      return {
        success: false,
        invitedRooms: [],
        errors: ['Matrix service not configured'],
      };
    }

    const invitedRooms: string[] = [];
    const errors: string[] = [];

    try {
      // Get room recommendations based on interests and cached rooms
      const recommendations = await this.getRoomRecommendations(interests);
      
      console.log(`Found ${recommendations.length} room recommendations for interests: ${interests.join(', ')}`);

      // Send invitations to recommended rooms
      for (const roomId of recommendations) {
        try {
          const success = await this.inviteToRoom(roomId, matrixUserId);
          if (success) {
            invitedRooms.push(roomId);
            console.log(`Successfully invited ${matrixUserId} to ${roomId}`);
          } else {
            errors.push(`Failed to invite to room ${roomId}`);
          }
        } catch (error) {
          errors.push(`Error inviting to room ${roomId}: ${error}`);
          console.error(`Error inviting to room ${roomId}:`, error);
        }
      }

      return {
        success: errors.length === 0,
        invitedRooms,
        errors,
      };
    } catch (error) {
      console.error('Error in inviteToRecommendedRooms:', error);
      return {
        success: false,
        invitedRooms: [],
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  private async getRoomRecommendations(interests: string[]): Promise<string[]> {
    if (!this.client) return [];

    try {
      // Get all available rooms from Matrix client
      const allRooms = this.client.getRooms();
      const recommendations: string[] = [];

      // Default rooms everyone should be invited to (based on room names)
      const defaultRoomPatterns = [
        /announcements?/i,
        /welcome/i,
        /general/i,
        /main/i,
        /lobby/i,
        /community/i,
      ];

      // Add default rooms
      for (const room of allRooms) {
        const roomName = room.name || '';
        if (defaultRoomPatterns.some(pattern => pattern.test(roomName))) {
          recommendations.push(room.roomId);
        }
      }

      // Interest-based room mapping
      const interestMappings: Record<string, RegExp[]> = {
        'security': [/security/i, /cybersecurity/i, /infosec/i, /sec/i, /privacy/i],
        'ai': [/ai/i, /artificial.intelligence/i, /machine.learning/i, /ml/i, /data.science/i],
        'development': [/dev/i, /programming/i, /coding/i, /software/i, /tech/i],
        'networking': [/network/i, /sysadmin/i, /infrastructure/i, /devops/i],
        'research': [/research/i, /academic/i, /science/i, /study/i],
        'crypto': [/crypto/i, /blockchain/i, /bitcoin/i, /ethereum/i],
        'gaming': [/gam/i, /game/i, /esports/i],
        'art': [/art/i, /design/i, /creative/i, /media/i],
        'music': [/music/i, /audio/i, /sound/i],
        'business': [/business/i, /entrepreneur/i, /startup/i, /finance/i],
        'education': [/education/i, /learning/i, /teaching/i, /tutorial/i],
        'social': [/social/i, /chat/i, /random/i, /offtopic/i, /casual/i],
      };

      // Add interest-based rooms
      for (const interest of interests) {
        const patterns = interestMappings[interest.toLowerCase()];
        if (patterns) {
          for (const room of allRooms) {
            const roomName = room.name || '';
            const roomTopic = room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic || '';
            
            if (patterns.some(pattern => pattern.test(roomName) || pattern.test(roomTopic))) {
              // Avoid duplicates
              if (!recommendations.includes(room.roomId)) {
                recommendations.push(room.roomId);
              }
            }
          }
        }
      }

      // Filter out small rooms (less than minimum members)
      const minMembers = parseInt(process.env.MATRIX_MIN_ROOM_MEMBERS || '3');
      const filteredRecommendations = recommendations.filter(roomId => {
        const room = this.client?.getRoom(roomId);
        return room && room.getJoinedMemberCount() > minMembers;
      });

      console.log(`Room recommendations: ${filteredRecommendations.length} rooms after filtering`);
      return filteredRecommendations;

    } catch (error) {
      console.error('Error getting room recommendations:', error);
      return [];
    }
  }

  // Bulk operations
  public async bulkSendDirectMessages(
    userIds: string[],
    message: string,
    batchSize: number = 10,
    delayMs: number = 500
  ): Promise<BulkOperationResult> {
    const results: Record<string, boolean> = {};
    const errors: Record<string, string> = {};

    if (!this.isActive || !this.client) {
      return {
        success: false,
        results,
        errors: { general: 'Matrix service not configured' },
        totalSuccess: 0,
        totalFailed: userIds.length,
      };
    }

    // Process in batches
    const batches = [];
    for (let i = 0; i < userIds.length; i += batchSize) {
      batches.push(userIds.slice(i, i + batchSize));
    }

    for (const [batchIndex, batch] of batches.entries()) {
      // Add delay between batches
      if (batchIndex > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      // Process batch in parallel
      const batchPromises = batch.map(async (userId) => {
        try {
          const result = await this.sendDirectMessage(userId, message);
          results[userId] = result.success;
          if (!result.success) {
            errors[userId] = result.error || 'Unknown error';
          }
        } catch (error) {
          results[userId] = false;
          errors[userId] = error instanceof Error ? error.message : 'Unknown error';
        }
      });

      await Promise.all(batchPromises);
      console.log(`Completed bulk DM batch ${batchIndex + 1}/${batches.length}`);
    }

    const totalSuccess = Object.values(results).filter(Boolean).length;
    const totalFailed = Object.values(results).filter(success => !success).length;

    return {
      success: totalFailed === 0,
      results,
      errors,
      totalSuccess,
      totalFailed,
    };
  }

  public async bulkSendRoomMessages(
    roomIds: string[],
    message: string
  ): Promise<BulkOperationResult> {
    const results: Record<string, boolean> = {};
    const errors: Record<string, string> = {};

    if (!this.isActive || !this.client) {
      return {
        success: false,
        results,
        errors: { general: 'Matrix service not configured' },
        totalSuccess: 0,
        totalFailed: roomIds.length,
      };
    }

    for (const roomId of roomIds) {
      try {
        const result = await this.sendRoomMessage(roomId, message);
        results[roomId] = result.success;
        if (!result.success) {
          errors[roomId] = result.error || 'Unknown error';
        }
      } catch (error) {
        results[roomId] = false;
        errors[roomId] = error instanceof Error ? error.message : 'Unknown error';
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    const totalSuccess = Object.values(results).filter(Boolean).length;
    const totalFailed = Object.values(results).filter(success => !success).length;

    return {
      success: totalFailed === 0,
      results,
      errors,
      totalSuccess,
      totalFailed,
    };
  }

  public async bulkInviteToRooms(
    userIds: string[],
    roomIds: string[],
    batchSize: number = 5,
    delayMs: number = 1000
  ): Promise<BulkOperationResult> {
    const results: Record<string, boolean> = {};
    const errors: Record<string, string> = {};

    if (!this.isActive || !this.client) {
      return {
        success: false,
        results,
        errors: { general: 'Matrix service not configured' },
        totalSuccess: 0,
        totalFailed: userIds.length * roomIds.length,
      };
    }

    // Process users in batches
    const batches = [];
    for (let i = 0; i < userIds.length; i += batchSize) {
      batches.push(userIds.slice(i, i + batchSize));
    }

    for (const [batchIndex, batch] of batches.entries()) {
      // Add delay between batches
      if (batchIndex > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      // Process batch in parallel
      const batchPromises = batch.map(async (userId) => {
        for (const roomId of roomIds) {
          const key = `${userId}:${roomId}`;
          try {
            const success = await this.inviteToRoom(roomId, userId);
            results[key] = success;
            if (!success) {
              errors[key] = 'Failed to invite user to room';
            }
          } catch (error) {
            results[key] = false;
            errors[key] = error instanceof Error ? error.message : 'Unknown error';
          }

          // Small delay between room invitations for same user
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      });

      await Promise.all(batchPromises);
      console.log(`Completed bulk invite batch ${batchIndex + 1}/${batches.length}`);
    }

    const totalSuccess = Object.values(results).filter(Boolean).length;
    const totalFailed = Object.values(results).filter(success => !success).length;

    return {
      success: totalFailed === 0,
      results,
      errors,
      totalSuccess,
      totalFailed,
    };
  }

  // Cache management methods
  public async getCacheStats(): Promise<CacheStats> {
    // This would integrate with Prisma to get cache statistics
    // For now, return mock data
    return {
      userCount: 0,
      roomCount: 0,
      membershipCount: 0,
      lastSyncTime: undefined,
      cacheAge: 0,
    };
  }

  public async isCacheFresh(maxAgeMinutes: number = 30): Promise<boolean> {
    const stats = await this.getCacheStats();
    return stats.cacheAge < maxAgeMinutes;
  }

  public async sendINDOCGraduationMessage(
    roomId: string,
    matrixUserId: string,
    displayName: string
  ): Promise<DirectMessageResult> {
    if (!this.isActive || !this.client) {
      return {
        success: false,
        error: 'Matrix service not configured',
      };
    }

    const graduationMessage = `🎓 **Congratulations ${displayName}!**

You have successfully completed the introduction process and are now a full member of our community!

🌟 **What's Next:**
• Explore all the community rooms
• Join conversations that interest you
• Share your expertise and learn from others
• Check out our resources and documentation

Welcome to the full community! 🚀`;

    try {
      return await this.sendRoomMessage(roomId, graduationMessage);
    } catch (error) {
      console.error('Error sending INDOC graduation message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  public isConfigured(): boolean {
    return this.isActive && this.config !== null;
  }

  public getConfig(): MatrixConfig | null {
    return this.config;
  }

  public getClient(): MatrixClient | null {
    return this.client;
  }
}

// Export singleton instance
export const matrixService = new MatrixService();