/**
 * Matrix Community Service Implementation
 * Provides Matrix operations through the CommunityService interface
 */

import { CommunityService } from './community-service';
import {
  CommunityUser,
  CommunityRoom,
  MessageResult,
  RoomOperationResult,
  SendMessageRequest,
  InviteToRoomRequest,
  RemoveFromRoomRequest,
  BroadcastToRoomRequest,
  ServiceHealth,
  Platform,
  CommunityServiceError,
  PlatformUnavailableError,
  ConfigurationError
} from './types';

export class MatrixCommunityService extends CommunityService {
  readonly platform: Platform = 'matrix';
  readonly name = 'Matrix Community Service';

  isConfigured(): boolean {
    // Check if Matrix environment variables are configured
    const homeserver = process.env.MATRIX_HOMESERVER;
    const accessToken = process.env.MATRIX_ACCESS_TOKEN;
    const userId = process.env.MATRIX_USER_ID;
    
    return !!(homeserver && accessToken && userId);
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    
    try {
      // Dynamic import to avoid bundling issues
      const { matrixService } = await import('@/lib/matrix');
      return matrixService.isConfigured();
    } catch (error) {
      console.warn('Matrix service availability check failed:', error);
      return false;
    }
  }

  async getHealth(): Promise<ServiceHealth> {
    const lastCheck = new Date();
    
    if (!this.isConfigured()) {
      return {
        platform: this.platform,
        isAvailable: false,
        isConfigured: false,
        lastCheck,
        error: 'Matrix service is not configured'
      };
    }

    try {
      const startTime = Date.now();
      const { matrixService } = await import('@/lib/matrix');
      const isConfigured = matrixService.isConfigured();
      const responseTime = Date.now() - startTime;
      
      return {
        platform: this.platform,
        isAvailable: isConfigured,
        isConfigured: true,
        responseTime,
        lastCheck,
        error: !isConfigured ? 'Matrix client not initialized' : undefined
      };
    } catch (error) {
      return {
        platform: this.platform,
        isAvailable: false,
        isConfigured: true,
        lastCheck,
        error: error instanceof Error ? error.message : 'Health check failed'
      };
    }
  }

  async getUsers(): Promise<CommunityUser[]> {
    if (!await this.isAvailable()) {
      throw new PlatformUnavailableError(this.platform);
    }

    try {
      // Use dynamic import to avoid bundling issues
      const { matrixService } = await import('@/lib/matrix');
      
      // Get cached Matrix users from database
      const users = await matrixService.getCachedUsers();
      
      return users.map((user: any) => ({
        id: user.userId || user.user_id,
        platform: this.platform,
        displayName: user.displayName || user.display_name || user.userId || user.user_id,
        avatarUrl: user.avatarUrl || user.avatar_url,
        matrixUserId: user.userId || user.user_id,
        isSignalUser: user.isSignalUser || user.is_signal_user || false,
        isOnline: false, // Would need real-time presence data
        isVerified: false
      }));
    } catch (error) {
      throw new CommunityServiceError(
        'Failed to get Matrix users',
        this.platform,
        'GET_USERS_FAILED',
        error
      );
    }
  }

  async getUser(userId: string): Promise<CommunityUser | null> {
    if (!await this.isAvailable()) {
      throw new PlatformUnavailableError(this.platform);
    }

    try {
      const users = await this.getUsers();
      return users.find(user => user.id === userId || user.matrixUserId === userId) || null;
    } catch (error) {
      throw new CommunityServiceError(
        'Failed to get Matrix user',
        this.platform,
        'GET_USER_FAILED',
        error
      );
    }
  }

  async searchUsers(query: string): Promise<CommunityUser[]> {
    if (!await this.isAvailable()) {
      throw new PlatformUnavailableError(this.platform);
    }

    try {
      const users = await this.getUsers();
      const lowercaseQuery = query.toLowerCase();
      
      return users.filter(user => 
        user.displayName.toLowerCase().includes(lowercaseQuery) ||
        user.id.toLowerCase().includes(lowercaseQuery) ||
        (user.matrixUserId && user.matrixUserId.toLowerCase().includes(lowercaseQuery))
      );
    } catch (error) {
      throw new CommunityServiceError(
        'Failed to search Matrix users',
        this.platform,
        'SEARCH_USERS_FAILED',
        error
      );
    }
  }

  async getRooms(): Promise<CommunityRoom[]> {
    if (!await this.isAvailable()) {
      throw new PlatformUnavailableError(this.platform);
    }

    try {
      // Use dynamic import to avoid bundling issues
      const { matrixService } = await import('@/lib/matrix');
      
      // Get cached Matrix rooms from database
      const rooms = await matrixService.getCachedRooms();
      
      return rooms.map((room: any) => ({
        id: room.roomId || room.room_id,
        platform: this.platform,
        name: room.name || room.displayName || room.display_name || 'Unknown Room',
        displayName: room.displayName || room.display_name || room.name,
        topic: room.topic,
        memberCount: room.memberCount || room.member_count || 0,
        matrixRoomId: room.roomId || room.room_id,
        isEncrypted: room.isEncrypted || room.is_encrypted || false,
        isPublic: !room.isDirect && !room.is_direct,
        lastActivity: room.lastSynced || room.last_synced ? new Date(room.lastSynced || room.last_synced) : undefined
      }));
    } catch (error) {
      throw new CommunityServiceError(
        'Failed to get Matrix rooms',
        this.platform,
        'GET_ROOMS_FAILED',
        error
      );
    }
  }

  async getRoom(roomId: string): Promise<CommunityRoom | null> {
    const rooms = await this.getRooms();
    return rooms.find(room => room.id === roomId || room.matrixRoomId === roomId) || null;
  }

  async createRoom(name: string, topic?: string): Promise<RoomOperationResult> {
    if (!await this.isAvailable()) {
      throw new PlatformUnavailableError(this.platform);
    }

    try {
      const { matrixService } = await import('@/lib/matrix');
      
      const result = await matrixService.createRoom(name, topic);
      
      return {
        success: result.success,
        roomId: result.roomId,
        error: result.success ? undefined : result.error,
        platform: this.platform
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        platform: this.platform
      };
    }
  }

  async sendMessage(request: SendMessageRequest): Promise<MessageResult> {
    if (!await this.isAvailable()) {
      throw new PlatformUnavailableError(this.platform);
    }

    try {
      const { matrixService } = await import('@/lib/matrix');
      
      const result = await matrixService.sendDirectMessage(request.recipient, request.message);
      
      return {
        success: result.success,
        messageId: result.eventId,
        timestamp: new Date(),
        error: result.success ? undefined : result.error,
        platform: this.platform
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        platform: this.platform
      };
    }
  }

  async sendDirectMessage(userId: string, message: string): Promise<MessageResult> {
    return this.sendMessage({ recipient: userId, message });
  }

  async broadcastToRoom(request: BroadcastToRoomRequest): Promise<MessageResult> {
    if (!await this.isAvailable()) {
      throw new PlatformUnavailableError(this.platform);
    }

    try {
      const { matrixService } = await import('@/lib/matrix');
      
      const result = await matrixService.sendRoomMessage(request.roomId, request.message);
      
      return {
        success: result.success,
        messageId: result.eventId,
        timestamp: new Date(),
        error: result.success ? undefined : result.error,
        platform: this.platform
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        platform: this.platform
      };
    }
  }

  async inviteToRoom(request: InviteToRoomRequest): Promise<RoomOperationResult> {
    if (!await this.isAvailable()) {
      throw new PlatformUnavailableError(this.platform);
    }

    try {
      const { matrixService } = await import('@/lib/matrix');
      
      const result = await matrixService.inviteUserToRoom(request.userId, request.roomId);
      
      return {
        success: result.success,
        roomId: request.roomId,
        error: result.success ? undefined : result.error,
        platform: this.platform
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        platform: this.platform
      };
    }
  }

  async removeFromRoom(request: RemoveFromRoomRequest): Promise<RoomOperationResult> {
    if (!await this.isAvailable()) {
      throw new PlatformUnavailableError(this.platform);
    }

    try {
      const { matrixService } = await import('@/lib/matrix');
      
      const result = await matrixService.removeUserFromRoom(request.userId, request.roomId);
      
      return {
        success: result.success,
        roomId: request.roomId,
        error: result.success ? undefined : result.error,
        platform: this.platform
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        platform: this.platform
      };
    }
  }

  async getRoomMembers(roomId: string): Promise<CommunityUser[]> {
    if (!await this.isAvailable()) {
      throw new PlatformUnavailableError(this.platform);
    }

    try {
      const { matrixService } = await import('@/lib/matrix');
      
      const members = await matrixService.getRoomMembers(roomId);
      
      return members.map((member: any) => ({
        id: member.userId || member.user_id,
        platform: this.platform,
        displayName: member.displayName || member.display_name || member.userId || member.user_id,
        avatarUrl: member.avatarUrl || member.avatar_url,
        matrixUserId: member.userId || member.user_id,
        isSignalUser: false,
        isVerified: false
      }));
    } catch (error) {
      throw new CommunityServiceError(
        'Failed to get Matrix room members',
        this.platform,
        'GET_MEMBERS_FAILED',
        error
      );
    }
  }

  normalizeUserId(userId: string): string {
    // Matrix user IDs should already be in the format @user:domain.com
    if (userId.startsWith('@') && userId.includes(':')) {
      return userId;
    }
    // If not properly formatted, return as-is
    return userId;
  }

  normalizeRoomId(roomId: string): string {
    // Matrix room IDs should already be in the format !room:domain.com
    if (roomId.startsWith('!') && roomId.includes(':')) {
      return roomId;
    }
    // If not properly formatted, return as-is
    return roomId;
  }
}