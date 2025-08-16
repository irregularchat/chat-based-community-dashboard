import { MatrixClientService } from './client-service';
import { MatrixMessagingService } from './messaging-service';
import { MatrixEncryptionService } from './encryption-service';
import { MatrixSignalBridgeService } from './signal-bridge-service';
import { MatrixRoomService } from './room-service';
import { 
  MatrixConfig, 
  DirectMessageResult, 
  BulkOperationResult, 
  CacheStats,
  MatrixRoom,
  MatrixUser,
  PowerLevelEvent,
  MatrixServiceError 
} from './types';
import { WelcomeMessageData } from '../message-templates';

/**
 * Main MatrixService - Coordinates all Matrix functionality through specialized services
 * This maintains the same interface as the original monolithic service for compatibility
 */
export class MatrixService {
  private clientService: MatrixClientService;
  private messagingService: MatrixMessagingService;
  private encryptionService: MatrixEncryptionService;
  private signalBridgeService: MatrixSignalBridgeService;
  private roomService: MatrixRoomService;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.clientService = new MatrixClientService();
    this.messagingService = new MatrixMessagingService(this.clientService);
    this.encryptionService = new MatrixEncryptionService(this.clientService);
    this.signalBridgeService = new MatrixSignalBridgeService(this.clientService);
    this.roomService = new MatrixRoomService(this.clientService);
    // Initialize lazily to avoid blocking server startup
    this.initPromise = null;
  }

  // === Client Management ===

  /**
   * Initialize the Matrix service
   */
  public async initialize(config?: MatrixConfig): Promise<void> {
    try {
      await this.clientService.initialize(config);
      
      // Initialize encryption if enabled
      const serviceConfig = this.clientService.getConfig();
      if (serviceConfig?.enableEncryption) {
        try {
          await this.encryptionService.initializeEncryption();
        } catch (error) {
          console.warn('Failed to initialize encryption:', error);
          // Continue without encryption
        }
      }
    } catch (error) {
      console.warn('Matrix service initialization failed:', error);
      // Continue without Matrix service - non-blocking
    }
  }

  /**
   * Ensure the service is initialized before use
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;
  }

  /**
   * Check if the service is configured and ready
   */
  public isConfigured(): boolean {
    return this.clientService.isConfigured();
  }

  /**
   * Get the current configuration
   */
  public getConfig(): MatrixConfig | null {
    return this.clientService.getConfig();
  }

  /**
   * Start the Matrix client
   */
  public async startClient(): Promise<void> {
    return this.clientService.startClient();
  }

  /**
   * Stop the Matrix client
   */
  public async stopClient(): Promise<void> {
    return this.clientService.stopClient();
  }

  /**
   * Cleanup all services
   */
  public async cleanup(): Promise<void> {
    return this.clientService.cleanup();
  }

  /**
   * Get client sync state
   */
  public getSyncState(): string | null {
    return this.clientService.getSyncState();
  }

  // === Messaging ===

  /**
   * Send a direct message to a Matrix user
   */
  public async sendDirectMessage(matrixUserId: string, message: string): Promise<DirectMessageResult> {
    return this.messagingService.sendDirectMessage(matrixUserId, message);
  }

  /**
   * Send a message to a specific room
   */
  public async sendRoomMessage(roomId: string, message: string): Promise<DirectMessageResult> {
    return this.messagingService.sendRoomMessage(roomId, message);
  }

  /**
   * Send welcome message to a Matrix user
   */
  public async sendWelcomeMessage(
    matrixUserId: string,
    username: string,
    fullName: string,
    tempPassword: string,
    discoursePostUrl?: string
  ): Promise<DirectMessageResult> {
    const welcomeData: WelcomeMessageData = {
      username,
      fullName,
      tempPassword,
      discoursePostUrl,
    };
    return this.messagingService.sendWelcomeMessage(matrixUserId, welcomeData);
  }

  /**
   * Send welcome message with encryption delay
   */
  public async sendWelcomeMessageWithDelay(
    matrixUserId: string,
    welcomeData: WelcomeMessageData,
    delaySeconds?: number
  ): Promise<DirectMessageResult> {
    return this.messagingService.sendWelcomeMessageWithDelay(matrixUserId, welcomeData, delaySeconds);
  }

  /**
   * Legacy compatibility: Send welcome message with encryption delay
   * Expected by tRPC router sendWelcomeMessageWithEncryptionDelay endpoint
   */
  public async sendWelcomeMessageWithEncryptionDelay(
    matrixUserId: string,
    username: string,
    fullName: string,
    tempPassword: string,
    discoursePostUrl?: string,
    delaySeconds: number = 5
  ): Promise<DirectMessageResult> {
    const welcomeData: WelcomeMessageData = {
      username,
      fullName,
      tempPassword,
      discoursePostUrl,
    };
    return this.messagingService.sendWelcomeMessageWithDelay(matrixUserId, welcomeData, delaySeconds);
  }

  /**
   * Send messages to multiple users in bulk
   */
  public async sendBulkDirectMessages(
    messages: Array<{ userId: string; message: string }>
  ): Promise<BulkOperationResult> {
    return this.messagingService.sendBulkDirectMessages(messages);
  }

  /**
   * Legacy compatibility: Send message to multiple users with same message
   * Expected by tRPC router sendMessageToUsers endpoint
   */
  public async bulkSendDirectMessages(
    userIds: string[],
    message: string,
    batchSize: number = 10,
    delayMs: number = 500
  ): Promise<BulkOperationResult> {
    // Convert to the format expected by sendBulkDirectMessages
    const messages = userIds.map(userId => ({ userId, message }));
    return this.messagingService.sendBulkDirectMessages(messages);
  }

  /**
   * Send a message to multiple rooms
   */
  public async sendMessageToMultipleRooms(roomIds: string[], message: string): Promise<BulkOperationResult> {
    return this.messagingService.sendMessageToMultipleRooms(roomIds, message);
  }

  /**
   * Legacy compatibility: Send bulk messages to rooms
   * Expected by tRPC router sendMessageToRooms endpoint
   */
  public async bulkSendRoomMessages(roomIds: string[], message: string): Promise<BulkOperationResult> {
    return this.messagingService.sendMessageToMultipleRooms(roomIds, message);
  }

  /**
   * Send message to moderators
   */
  public async sendMessageToModerators(message: string, roomId?: string): Promise<DirectMessageResult> {
    return this.messagingService.sendMessageToModerators(message, roomId);
  }

  /**
   * Send INDOC graduation message to a room
   * Based on legacy implementation for user graduation flow
   */
  public async sendINDOCGraduationMessage(
    roomId: string,
    matrixUserId: string,
    displayName: string
  ): Promise<DirectMessageResult> {
    await this.ensureInitialized();
    
    if (!this.clientService.isConfigured()) {
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

  // === Signal Bridge ===

  /**
   * Check if a user ID is a Signal bridge user
   */
  public isSignalUser(userId: string): boolean {
    return this.signalBridgeService.isSignalUser(userId);
  }

  /**
   * Extract Signal UUID from Matrix user ID
   */
  public extractSignalUuid(signalUserId: string): string | null {
    return this.signalBridgeService.extractSignalUuid(signalUserId);
  }

  /**
   * Send a message to a Signal bridge user
   */
  public async sendSignalBridgeMessage(signalUserId: string, message: string): Promise<DirectMessageResult> {
    return this.signalBridgeService.sendSignalBridgeMessage(signalUserId, message);
  }

  /**
   * Resolve a phone number to Signal UUID
   */
  public async resolvePhoneToSignalUuid(phoneNumber: string): Promise<string | null> {
    return this.signalBridgeService.resolvePhoneToSignalUuid(phoneNumber);
  }

  /**
   * Send a message to a phone number via Signal bridge
   */
  public async sendSignalMessageByPhone(phoneNumber: string, message: string): Promise<DirectMessageResult> {
    return this.signalBridgeService.sendSignalMessageByPhone(phoneNumber, message);
  }

  /**
   * Get the Signal bridge room status
   */
  public async getBridgeRoomStatus(): Promise<{ configured: boolean; roomId?: string; accessible?: boolean }> {
    return this.signalBridgeService.getBridgeRoomStatus();
  }

  // === Room Management ===

  /**
   * Get all rooms accessible to the client
   */
  public async getRooms(): Promise<MatrixRoom[]> {
    return this.roomService.getRooms();
  }

  /**
   * Get a specific room by ID
   */
  public async getRoom(roomId: string): Promise<MatrixRoom | null> {
    return this.roomService.getRoom(roomId);
  }

  /**
   * Create a new room
   */
  public async createRoom(options: {
    name?: string;
    topic?: string;
    visibility?: 'public' | 'private';
    isDirect?: boolean;
    invite?: string[];
    preset?: 'private_chat' | 'public_chat' | 'trusted_private_chat';
    enableEncryption?: boolean;
  }): Promise<string | null> {
    return this.roomService.createRoom(options);
  }

  /**
   * Get or create a direct message room with a user
   */
  public async getOrCreateDirectRoom(matrixUserId: string): Promise<string | null> {
    return this.roomService.getOrCreateDirectRoom(matrixUserId);
  }

  /**
   * Invite a user to a room
   */
  public async inviteToRoom(roomId: string, matrixUserId: string): Promise<boolean> {
    return this.roomService.inviteToRoom(roomId, matrixUserId);
  }

  /**
   * Remove a user from a room
   */
  public async removeFromRoom(roomId: string, matrixUserId: string, reason?: string): Promise<boolean> {
    return this.roomService.removeFromRoom(roomId, matrixUserId, reason);
  }

  /**
   * Ban a user from a room
   */
  public async banFromRoom(roomId: string, matrixUserId: string, reason?: string): Promise<boolean> {
    return this.roomService.banFromRoom(roomId, matrixUserId, reason);
  }

  /**
   * Set power level for a user in a room
   */
  public async setPowerLevel(roomId: string, matrixUserId: string, powerLevel: number): Promise<boolean> {
    return this.roomService.setPowerLevel(roomId, matrixUserId, powerLevel);
  }

  /**
   * Get power level for a user in a room
   */
  public async getPowerLevel(roomId: string, matrixUserId: string): Promise<number> {
    return this.roomService.getPowerLevel(roomId, matrixUserId);
  }

  /**
   * Legacy compatibility: Get user power level (alternative signature)
   */
  public async getUserPowerLevel(roomId: string, matrixUserId: string): Promise<number | null> {
    try {
      const powerLevel = await this.roomService.getPowerLevel(roomId, matrixUserId);
      return powerLevel;
    } catch (error) {
      console.error(`Error getting power level for ${matrixUserId} in room ${roomId}:`, error);
      return null;
    }
  }

  /**
   * Get power levels configuration for a room
   */
  public async getRoomPowerLevels(roomId: string): Promise<PowerLevelEvent | null> {
    return this.roomService.getRoomPowerLevels(roomId);
  }

  /**
   * Sync moderator power levels across multiple rooms
   */
  public async syncModeratorPowerLevels(
    matrixUserId: string, 
    isModerator: boolean, 
    targetRooms?: string[]
  ): Promise<{ success: boolean; roomsUpdated: string[]; errors: string[] }> {
    return this.roomService.syncModeratorPowerLevels(matrixUserId, isModerator, targetRooms);
  }

  /**
   * Get room members
   */
  public async getRoomMembers(roomId: string): Promise<MatrixUser[]> {
    return this.roomService.getRoomMembers(roomId);
  }

  /**
   * Join a room
   */
  public async joinRoom(roomIdOrAlias: string): Promise<boolean> {
    return this.roomService.joinRoom(roomIdOrAlias);
  }

  /**
   * Leave a room
   */
  public async leaveRoom(roomId: string): Promise<boolean> {
    return this.roomService.leaveRoom(roomId);
  }

  /**
   * Check if a room is encrypted
   */
  public async isRoomEncrypted(roomId: string): Promise<boolean> {
    return this.roomService.isRoomEncrypted(roomId);
  }

  /**
   * Update room topic
   */
  public async setRoomTopic(roomId: string, topic: string): Promise<boolean> {
    return this.roomService.setRoomTopic(roomId, topic);
  }

  /**
   * Update room name
   */
  public async setRoomName(roomId: string, name: string): Promise<boolean> {
    return this.roomService.setRoomName(roomId, name);
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
    return this.roomService.getRoomStats(roomId);
  }

  // === Environment Configuration Parsing ===

  /**
   * Parse CATEGORY_ environment variables
   * Format: CATEGORY_UNIQUE_NAME = Display Name|keyword1,keyword2,keyword3
   */
  public parseCategories(): Record<string, {displayName: string, keywords: string[]}> {
    const categories: Record<string, {displayName: string, keywords: string[]}> = {};
    
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('CATEGORY_') && value) {
        const categoryName = key.replace('CATEGORY_', '').toLowerCase();
        const [displayName, keywordString] = value.split('|');
        const keywords = keywordString ? keywordString.split(',').map(k => k.trim().toLowerCase()) : [];
        
        categories[categoryName] = {
          displayName: displayName?.trim() || categoryName,
          keywords
        };
      }
    }
    
    return categories;
  }

  /**
   * Parse Matrix room configuration from environment variables
   * Supports both ROOM_ prefixed variables and MATRIX_ROOM_IDS_NAME_CATEGORY format
   */
  public parseRooms(): Array<{id: string, name: string, categories: string[], description: string, matrixRoomId: string}> {
    const rooms: Array<{id: string, name: string, categories: string[], description: string, matrixRoomId: string}> = [];
    
    // Parse MATRIX_ROOM_IDS_NAME_CATEGORY format (legacy format)
    const matrixRoomConfig = process.env.MATRIX_ROOM_IDS_NAME_CATEGORY;
    if (matrixRoomConfig) {
      const roomEntries = matrixRoomConfig.split(';').filter(entry => entry.trim());
      
      for (const entry of roomEntries) {
        const parts = entry.split('|');
        if (parts.length >= 3) {
          const [name, categoriesStr, matrixRoomId] = parts;
          if (name && categoriesStr && matrixRoomId) {
            const categories = categoriesStr.split(',').map(c => c.trim().toLowerCase());
            const cleanRoomId = matrixRoomId.trim();
            
            rooms.push({
              id: cleanRoomId.replace(/[!:]/g, '_'), // Create ID from room ID
              name: name.trim(),
              categories,
              description: `${name.trim()} - ${categoriesStr.trim()}`, // Generate description
              matrixRoomId: cleanRoomId
            });
          }
        }
      }
    }
    
    // Also parse ROOM_ prefixed variables (new format)
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('ROOM_') && value) {
        const roomId = key.replace('ROOM_', '').toLowerCase();
        const parts = value.split('|');
        
        if (parts.length >= 4) {
          const [name, categoriesStr, description, matrixRoomId] = parts;
          const categories = categoriesStr.split(',').map(c => c.trim().toLowerCase());
          
          rooms.push({
            id: roomId,
            name: name.trim(),
            categories,
            description: description.trim(),
            matrixRoomId: matrixRoomId.trim()
          });
        }
      }
    }
    
    return rooms;
  }

  /**
   * Invite user to recommended rooms based on interests
   */
  public async inviteToRecommendedRooms(
    matrixUserId: string,
    interests: string[] = []
  ): Promise<{ success: boolean; invitedRooms: string[]; errors: string[] }> {
    return this.roomService.inviteToRecommendedRooms(matrixUserId, interests);
  }

  /**
   * Legacy compatibility: Bulk invite users to specific rooms
   * Expected by tRPC router bulkInviteToRooms endpoint
   */
  public async bulkInviteToRooms(
    userIds: string[],
    roomIds: string[],
    batchSize: number = 5,
    delayMs: number = 1000
  ): Promise<BulkOperationResult> {
    return this.roomService.bulkInviteToRooms(userIds, roomIds, batchSize, delayMs);
  }

  // === Encryption ===

  /**
   * Check if encryption is available and initialized
   */
  public isEncryptionAvailable(): boolean {
    return this.encryptionService.isEncryptionAvailable();
  }

  /**
   * Enable encryption for a room
   */
  public async enableRoomEncryption(roomId: string): Promise<void> {
    return this.encryptionService.enableRoomEncryption(roomId);
  }

  /**
   * Get device verification status
   */
  public async getDeviceVerificationStatus(userId: string, deviceId: string): Promise<boolean> {
    return this.encryptionService.getDeviceVerificationStatus(userId, deviceId);
  }

  /**
   * Auto-verify a device (for trusted users like Signal bot)
   */
  public async autoVerifyDevice(userId: string, deviceId: string): Promise<void> {
    return this.encryptionService.autoVerifyDevice(userId, deviceId);
  }

  /**
   * Export encryption keys for backup
   */
  public async exportKeys(passphrase: string): Promise<string> {
    return this.encryptionService.exportKeys(passphrase);
  }

  /**
   * Import encryption keys from backup
   */
  public async importKeys(keyData: string, passphrase: string): Promise<void> {
    return this.encryptionService.importKeys(keyData, passphrase);
  }

  // === Compatibility Methods ===

  /**
   * Legacy compatibility: ensure initialized
   */
  public async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;
  }

  /**
   * Legacy compatibility: check if active
   */
  public get isActive(): boolean {
    return this.clientService.isConfigured();
  }

  /**
   * Get the Matrix client instance
   */
  public getClient() {
    return this.clientService.getClient();
  }

  /**
   * Legacy compatibility: get client
   */
  public get client() {
    return this.clientService.getClient();
  }

  /**
   * Legacy compatibility: get config
   */
  public get config() {
    return this.clientService.getConfig();
  }
}

// Export the singleton instance for compatibility with defensive initialization
let _matrixService: MatrixService | null = null;

export const matrixService = (() => {
  try {
    if (!_matrixService) {
      _matrixService = new MatrixService();
    }
    return _matrixService;
  } catch (error) {
    console.error('Failed to create MatrixService instance:', error);
    // Return a minimal mock object to prevent crashes
    return {
      isConfigured: () => false,
      getConfig: () => null,
      initialize: async () => {},
      cleanup: async () => {},
      sendDirectMessage: async () => ({ success: false, error: 'Service not available' }),
    } as any;
  }
})();