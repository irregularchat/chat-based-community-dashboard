// Use dynamic imports for matrix-js-sdk to avoid bundling conflicts
import { MatrixClientService } from './client-service';
import { 
  MatrixRoom, 
  MatrixUser, 
  PowerLevelEvent, 
  BulkOperationResult,
  MatrixServiceError 
} from './types';

interface RoomCreationOptions {
  name?: string;
  topic?: string;
  visibility?: 'public' | 'private';
  isDirect?: boolean;
  invite?: string[];
  preset?: 'private_chat' | 'public_chat' | 'trusted_private_chat';
  enableEncryption?: boolean;
}

interface PowerLevelUpdateResult {
  success: boolean;
  roomsUpdated: string[];
  errors: string[];
}

/**
 * MatrixRoomService - Responsible for Matrix room operations
 * including room creation, management, member operations, and power levels
 */
export class MatrixRoomService {
  private clientService: MatrixClientService;

  constructor(clientService: MatrixClientService) {
    this.clientService = clientService;
  }

  /**
   * Get all rooms accessible to the client
   */
  public async getRooms(): Promise<MatrixRoom[]> {
    const client = this.clientService.getClient();
    if (!client) {
      return [];
    }

    try {
      const rooms = client.getRooms();
      const matrixRooms: MatrixRoom[] = [];

      for (const room of rooms) {
        try {
          const memberCount = room.getJoinedMemberCount();
          const encrypted = await this.isRoomEncrypted(room.roomId);
          
          matrixRooms.push({
            roomId: room.roomId,
            name: room.name || undefined,
            topic: room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic,
            memberCount,
            encrypted,
            category: this.getRoomCategory(room.name || ''),
          });
        } catch (error) {
          console.warn(`Error processing room ${room.roomId}:`, error);
        }
      }

      return matrixRooms;
    } catch (error) {
      console.error('Error getting rooms:', error);
      return [];
    }
  }

  /**
   * Get a specific room by ID
   */
  public async getRoom(roomId: string): Promise<MatrixRoom | null> {
    const client = this.clientService.getClient();
    if (!client) {
      return null;
    }

    try {
      const room = client.getRoom(roomId);
      if (!room) {
        return null;
      }

      const memberCount = room.getJoinedMemberCount();
      const encrypted = await this.isRoomEncrypted(roomId);

      return {
        roomId: room.roomId,
        name: room.name || undefined,
        topic: room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic,
        memberCount,
        encrypted,
        category: this.getRoomCategory(room.name || ''),
      };
    } catch (error) {
      console.error(`Error getting room ${roomId}:`, error);
      return null;
    }
  }

  /**
   * Create a new room
   */
  public async createRoom(options: RoomCreationOptions): Promise<string | null> {
    const client = this.clientService.getClient();
    if (!client || !this.clientService.isConfigured()) {
      throw new MatrixServiceError('Matrix service not configured', 'SERVICE_NOT_CONFIGURED');
    }

    try {
      console.log('Creating new Matrix room:', options.name || 'Unnamed room');

      const createOptions: any = {
        visibility: options.visibility || 'private',
        preset: options.preset || 'private_chat',
      };

      if (options.name) {
        createOptions.name = options.name;
      }

      if (options.topic) {
        createOptions.topic = options.topic;
      }

      if (options.isDirect) {
        createOptions.is_direct = true;
      }

      if (options.invite && options.invite.length > 0) {
        createOptions.invite = options.invite;
      }

      // Enable encryption if requested
      if (options.enableEncryption) {
        createOptions.initial_state = [
          {
            type: 'm.room.encryption',
            content: {
              algorithm: 'm.megolm.v1.aes-sha2',
            },
          },
        ];
      }

      const response = await client.createRoom(createOptions);
      console.log(`Room created successfully: ${response.room_id}`);
      
      return response.room_id;
    } catch (error) {
      console.error('Error creating room:', error);
      throw new MatrixServiceError(
        'Failed to create room',
        'ROOM_CREATION_FAILED',
        { options, originalError: error }
      );
    }
  }

  /**
   * Get or create a direct message room with a user
   */
  public async getOrCreateDirectRoom(matrixUserId: string): Promise<string | null> {
    const client = this.clientService.getClient();
    if (!client) {
      return null;
    }

    try {
      // Try to find existing direct room
      const rooms = client.getRooms();
      for (const room of rooms) {
        // Check if room is a direct message room (has exactly 2 members)
        const members = room.getMembers();
        if (members.length === 2 && members.some(member => member.userId === matrixUserId)) {
          console.log(`Found existing direct room: ${room.roomId}`);
          return room.roomId;
        }
      }

      // Create new direct room
      console.log(`Creating new direct room with ${matrixUserId}`);
      const roomId = await this.createRoom({
        isDirect: true,
        invite: [matrixUserId],
        preset: 'trusted_private_chat',
      });

      return roomId;
    } catch (error) {
      console.error('Error getting or creating direct room:', error);
      return null;
    }
  }

  /**
   * Invite a user to a room
   */
  public async inviteToRoom(roomId: string, matrixUserId: string): Promise<boolean> {
    const client = this.clientService.getClient();
    if (!client || !this.clientService.isConfigured()) {
      console.warn('Matrix service not configured');
      return false;
    }

    try {
      await client.invite(roomId, matrixUserId);
      console.log(`Successfully invited ${matrixUserId} to room ${roomId}`);
      return true;
    } catch (error) {
      console.error(`Error inviting ${matrixUserId} to room ${roomId}:`, error);
      return false;
    }
  }

  /**
   * Remove a user from a room
   */
  public async removeFromRoom(roomId: string, matrixUserId: string, reason?: string): Promise<boolean> {
    const client = this.clientService.getClient();
    if (!client || !this.clientService.isConfigured()) {
      console.warn('Matrix service not configured');
      return false;
    }

    try {
      await client.kick(roomId, matrixUserId, reason || 'Removed by admin');
      console.log(`Successfully removed ${matrixUserId} from room ${roomId}`);
      return true;
    } catch (error) {
      console.error(`Error removing ${matrixUserId} from room ${roomId}:`, error);
      return false;
    }
  }

  /**
   * Ban a user from a room
   */
  public async banFromRoom(roomId: string, matrixUserId: string, reason?: string): Promise<boolean> {
    const client = this.clientService.getClient();
    if (!client || !this.clientService.isConfigured()) {
      console.warn('Matrix service not configured');
      return false;
    }

    try {
      await client.ban(roomId, matrixUserId, reason || 'Banned by admin');
      console.log(`Successfully banned ${matrixUserId} from room ${roomId}`);
      return true;
    } catch (error) {
      console.error(`Error banning ${matrixUserId} from room ${roomId}:`, error);
      return false;
    }
  }

  /**
   * Set power level for a user in a room
   */
  public async setPowerLevel(roomId: string, matrixUserId: string, powerLevel: number): Promise<boolean> {
    const client = this.clientService.getClient();
    if (!client || !this.clientService.isConfigured()) {
      console.warn('Matrix service not configured');
      return false;
    }

    try {
      await client.setPowerLevel(roomId, matrixUserId, powerLevel);
      console.log(`Successfully set power level ${powerLevel} for ${matrixUserId} in room ${roomId}`);
      return true;
    } catch (error) {
      console.error(`Error setting power level for ${matrixUserId} in room ${roomId}:`, error);
      return false;
    }
  }

  /**
   * Get power level for a user in a room
   */
  public async getPowerLevel(roomId: string, matrixUserId: string): Promise<number> {
    const client = this.clientService.getClient();
    if (!client) {
      return 0;
    }

    try {
      const powerLevels = await client.getStateEvent(roomId, 'm.room.power_levels', '');
      return powerLevels.users?.[matrixUserId] || powerLevels.users_default || 0;
    } catch (error) {
      console.error(`Error getting power level for ${matrixUserId} in room ${roomId}:`, error);
      return 0;
    }
  }

  /**
   * Get power levels configuration for a room
   */
  public async getRoomPowerLevels(roomId: string): Promise<PowerLevelEvent | null> {
    const client = this.clientService.getClient();
    if (!client) {
      return null;
    }

    try {
      const powerLevels = await client.getStateEvent(roomId, 'm.room.power_levels', '');
      return powerLevels as PowerLevelEvent;
    } catch (error) {
      console.error(`Error getting power levels for room ${roomId}:`, error);
      return null;
    }
  }

  /**
   * Sync moderator power levels across multiple rooms
   */
  public async syncModeratorPowerLevels(
    matrixUserId: string, 
    isModerator: boolean, 
    targetRooms?: string[]
  ): Promise<PowerLevelUpdateResult> {
    const client = this.clientService.getClient();
    if (!client || !this.clientService.isConfigured()) {
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
        // Update all rooms where we're an admin
        const allRooms = client.getRooms();
        for (const room of allRooms) {
          try {
            // Only update rooms where we're an admin (power level 100)
            const myPowerLevel = await this.getPowerLevel(room.roomId, client.getUserId() || '');
            if (myPowerLevel >= 100) {
              roomsToUpdate.push(room.roomId);
            }
          } catch (error) {
            console.warn(`Could not check power level in room ${room.roomId}:`, error);
          }
        }
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

      return {
        success: roomsUpdated.length > 0,
        roomsUpdated,
        errors,
      };

    } catch (error) {
      console.error('Error syncing moderator power levels:', error);
      return {
        success: false,
        roomsUpdated,
        errors: [...errors, error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  /**
   * Get room members
   */
  public async getRoomMembers(roomId: string): Promise<MatrixUser[]> {
    const client = this.clientService.getClient();
    if (!client) {
      return [];
    }

    try {
      const room = client.getRoom(roomId);
      if (!room) {
        return [];
      }

      const members = room.getJoinedMembers();
      return members.map(member => ({
        userId: member.userId,
        displayName: member.name,
        avatarUrl: member.getAvatarUrl(client.getHomeserverUrl(), 32, 32, 'scale', false, false),
        isSignalUser: member.userId.startsWith('@signal_'),
      }));
    } catch (error) {
      console.error(`Error getting members for room ${roomId}:`, error);
      return [];
    }
  }

  /**
   * Join a room
   */
  public async joinRoom(roomIdOrAlias: string): Promise<boolean> {
    const client = this.clientService.getClient();
    if (!client || !this.clientService.isConfigured()) {
      return false;
    }

    try {
      await client.joinRoom(roomIdOrAlias);
      console.log(`Successfully joined room ${roomIdOrAlias}`);
      return true;
    } catch (error) {
      console.error(`Error joining room ${roomIdOrAlias}:`, error);
      return false;
    }
  }

  /**
   * Leave a room
   */
  public async leaveRoom(roomId: string): Promise<boolean> {
    const client = this.clientService.getClient();
    if (!client || !this.clientService.isConfigured()) {
      return false;
    }

    try {
      await client.leave(roomId);
      console.log(`Successfully left room ${roomId}`);
      return true;
    } catch (error) {
      console.error(`Error leaving room ${roomId}:`, error);
      return false;
    }
  }

  /**
   * Check if a room is encrypted
   */
  public async isRoomEncrypted(roomId: string): Promise<boolean> {
    const client = this.clientService.getClient();
    if (!client) {
      return false;
    }

    try {
      const encryptionEvent = await client.getStateEvent(roomId, 'm.room.encryption', '');
      return !!encryptionEvent;
    } catch (error) {
      // No encryption state event means the room is not encrypted
      return false;
    }
  }

  /**
   * Update room topic
   */
  public async setRoomTopic(roomId: string, topic: string): Promise<boolean> {
    const client = this.clientService.getClient();
    if (!client || !this.clientService.isConfigured()) {
      return false;
    }

    try {
      await client.sendStateEvent(roomId, 'm.room.topic', { topic });
      console.log(`Successfully updated topic for room ${roomId}`);
      return true;
    } catch (error) {
      console.error(`Error setting topic for room ${roomId}:`, error);
      return false;
    }
  }

  /**
   * Update room name
   */
  public async setRoomName(roomId: string, name: string): Promise<boolean> {
    const client = this.clientService.getClient();
    if (!client || !this.clientService.isConfigured()) {
      return false;
    }

    try {
      await client.sendStateEvent(roomId, 'm.room.name', { name });
      console.log(`Successfully updated name for room ${roomId}`);
      return true;
    } catch (error) {
      console.error(`Error setting name for room ${roomId}:`, error);
      return false;
    }
  }

  /**
   * Get room statistics
   */
  public async getRoomStats(roomId: string): Promise<{
    memberCount: number;
    messageCount: number;
    encrypted: boolean;
    powerLevels: PowerLevelEvent | null;
  } | null> {
    const client = this.clientService.getClient();
    if (!client) {
      return null;
    }

    try {
      const room = client.getRoom(roomId);
      if (!room) {
        return null;
      }

      const memberCount = room.getJoinedMemberCount();
      const messageCount = room.timeline.length;
      const encrypted = await this.isRoomEncrypted(roomId);
      const powerLevels = await this.getRoomPowerLevels(roomId);

      return {
        memberCount,
        messageCount,
        encrypted,
        powerLevels,
      };
    } catch (error) {
      console.error(`Error getting stats for room ${roomId}:`, error);
      return null;
    }
  }

  /**
   * Invite user to recommended rooms based on interests
   */
  public async inviteToRecommendedRooms(
    matrixUserId: string,
    interests: string[] = []
  ): Promise<{ success: boolean; invitedRooms: string[]; errors: string[] }> {
    const client = this.clientService.getClient();
    if (!client || !this.clientService.isConfigured()) {
      return {
        success: false,
        invitedRooms: [],
        errors: ['Matrix service not configured'],
      };
    }

    const invitedRooms: string[] = [];
    const errors: string[] = [];

    try {
      // Get room recommendations based on interests
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

  /**
   * Get room recommendations based on user interests
   */
  private async getRoomRecommendations(interests: string[]): Promise<string[]> {
    const client = this.clientService.getClient();
    if (!client) {
      return [];
    }

    try {
      const rooms = client.getRooms();
      const recommendations: string[] = [];

      // Get room recommendations based on interests
      for (const room of rooms) {
        const roomName = room.name?.toLowerCase() || '';
        const roomTopic = room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic?.toLowerCase() || '';
        
        // Check if room name or topic matches any interest
        for (const interest of interests) {
          const normalizedInterest = interest.toLowerCase();
          if (roomName.includes(normalizedInterest) || roomTopic.includes(normalizedInterest)) {
            recommendations.push(room.roomId);
            break; // Don't add the same room multiple times
          }
        }
      }

      // Add some default recommended rooms if no specific matches
      if (recommendations.length === 0) {
        const defaultRooms = [
          process.env.MATRIX_WELCOME_ROOM_ID,
          process.env.MATRIX_DEFAULT_ROOM_ID,
        ].filter(Boolean) as string[];
        
        recommendations.push(...defaultRooms);
      }

      return recommendations;
    } catch (error) {
      console.error('Error getting room recommendations:', error);
      return [];
    }
  }

  /**
   * Bulk invite multiple users to multiple rooms
   * Based on legacy implementation pattern
   */
  public async bulkInviteToRooms(
    userIds: string[],
    roomIds: string[],
    batchSize: number = 5,
    delayMs: number = 1000
  ): Promise<BulkOperationResult> {
    const results: Record<string, boolean> = {};
    const errors: Record<string, string> = {};

    if (!this.clientService.isConfigured()) {
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

  /**
   * Determine room category based on name
   */
  private getRoomCategory(roomName: string): string | undefined {
    const name = roomName.toLowerCase();
    
    if (name.includes('general') || name.includes('chat')) {
      return 'general';
    } else if (name.includes('admin') || name.includes('mod')) {
      return 'admin';
    } else if (name.includes('signal') || name.includes('bridge')) {
      return 'bridge';
    } else if (name.includes('announce') || name.includes('news')) {
      return 'announcements';
    } else if (name.includes('support') || name.includes('help')) {
      return 'support';
    }
    
    return undefined;
  }
}