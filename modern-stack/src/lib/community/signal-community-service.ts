/**
 * Signal Community Service Implementation
 * Provides Signal CLI operations through the CommunityService interface
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
import { SignalBotService } from '@/lib/signal/signal-bot-service';
import { normalizePhoneNumber } from '@/lib/phone-utils';

export class SignalCommunityService extends CommunityService {
  readonly platform: Platform = 'signal';
  readonly name = 'Signal CLI Community Service';
  
  private signalBot: SignalBotService;

  constructor() {
    super();
    this.signalBot = new SignalBotService();
  }

  isConfigured(): boolean {
    return this.signalBot.isConfigured();
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isConfigured()) return false;
    
    try {
      const health = await this.signalBot.checkServiceHealth();
      return health.containerStatus === 'running';
    } catch (error) {
      console.warn('Signal service availability check failed:', error);
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
        error: 'Signal CLI is not configured'
      };
    }

    try {
      const startTime = Date.now();
      const health = await this.signalBot.checkServiceHealth();
      const responseTime = Date.now() - startTime;
      
      return {
        platform: this.platform,
        isAvailable: health.containerStatus === 'running',
        isConfigured: true,
        responseTime,
        lastCheck,
        error: health.containerStatus !== 'running' ? 'Container not running' : undefined
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
      // Signal CLI doesn't have a direct "get contacts" API, so we'll return empty array for now
      // In a real implementation, this would fetch from Signal CLI contacts
      return [];
    } catch (error) {
      throw new CommunityServiceError(
        'Failed to get Signal users',
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

    const normalizedPhone = normalizePhoneNumber(userId);
    if (!normalizedPhone.isValid) {
      return null;
    }

    // For Signal, we create a basic user representation
    return {
      id: normalizedPhone.normalized,
      platform: this.platform,
      displayName: normalizedPhone.normalized,
      signalNumber: normalizedPhone.normalized,
      isSignalUser: true,
      isVerified: false // Would need to check against actual Signal data
    };
  }

  async searchUsers(query: string): Promise<CommunityUser[]> {
    // For Signal CLI, we can try to normalize the query as a phone number
    const normalizedPhone = normalizePhoneNumber(query);
    if (normalizedPhone.isValid) {
      const user = await this.getUser(normalizedPhone.normalized);
      return user ? [user] : [];
    }
    return [];
  }

  async getRooms(): Promise<CommunityRoom[]> {
    if (!await this.isAvailable()) {
      throw new PlatformUnavailableError(this.platform);
    }

    try {
      const phoneNumber = this.signalBot.config.phoneNumber;
      if (!phoneNumber) {
        throw new ConfigurationError(this.platform, 'No phone number configured');
      }

      const groupsResult = await this.signalBot.apiClient.getGroups(phoneNumber);
      if (!groupsResult.success) {
        throw new CommunityServiceError(
          'Failed to get Signal groups',
          this.platform,
          'GET_GROUPS_FAILED',
          groupsResult.error
        );
      }

      return (groupsResult.data || []).map((group: any) => ({
        id: group.id || group.groupId,
        platform: this.platform,
        name: group.name || 'Unknown Group',
        displayName: group.name || 'Unknown Group',
        memberCount: group.members?.length || 0,
        signalGroupId: group.id || group.groupId,
        isEncrypted: true, // Signal groups are always encrypted
        isPublic: false,
        lastActivity: group.lastActivity ? new Date(group.lastActivity) : undefined
      }));
    } catch (error) {
      if (error instanceof CommunityServiceError) throw error;
      throw new CommunityServiceError(
        'Failed to get Signal rooms',
        this.platform,
        'GET_ROOMS_FAILED',
        error
      );
    }
  }

  async getRoom(roomId: string): Promise<CommunityRoom | null> {
    const rooms = await this.getRooms();
    return rooms.find(room => room.id === roomId || room.signalGroupId === roomId) || null;
  }

  async createRoom(name: string, topic?: string): Promise<RoomOperationResult> {
    throw new CommunityServiceError(
      'Creating Signal groups is not yet supported',
      this.platform,
      'CREATE_ROOM_NOT_SUPPORTED'
    );
  }

  async sendMessage(request: SendMessageRequest): Promise<MessageResult> {
    if (!await this.isAvailable()) {
      throw new PlatformUnavailableError(this.platform);
    }

    try {
      const result = await this.signalBot.sendMessage(request.recipient, request.message);
      
      return {
        success: result.success,
        messageId: result.messageId,
        timestamp: result.timestamp ? new Date(result.timestamp) : new Date(),
        error: result.success ? undefined : 'Message sending failed',
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
    throw new CommunityServiceError(
      'Broadcasting to Signal groups is not yet supported',
      this.platform,
      'BROADCAST_NOT_SUPPORTED'
    );
  }

  async inviteToRoom(request: InviteToRoomRequest): Promise<RoomOperationResult> {
    throw new CommunityServiceError(
      'Inviting to Signal groups is not yet supported',
      this.platform,
      'INVITE_NOT_SUPPORTED'
    );
  }

  async removeFromRoom(request: RemoveFromRoomRequest): Promise<RoomOperationResult> {
    throw new CommunityServiceError(
      'Removing from Signal groups is not yet supported',
      this.platform,
      'REMOVE_NOT_SUPPORTED'
    );
  }

  async getRoomMembers(roomId: string): Promise<CommunityUser[]> {
    throw new CommunityServiceError(
      'Getting Signal group members is not yet supported',
      this.platform,
      'GET_MEMBERS_NOT_SUPPORTED'
    );
  }

  normalizeUserId(userId: string): string {
    const normalized = normalizePhoneNumber(userId);
    return normalized.isValid ? normalized.normalized : userId;
  }

  normalizeRoomId(roomId: string): string {
    return roomId; // Signal group IDs are already normalized
  }
}