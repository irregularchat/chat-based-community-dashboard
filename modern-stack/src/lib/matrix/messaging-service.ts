// Use shared SDK instance to avoid bundling conflicts
import { getMsgType } from './sdk-instance';
import { MatrixClientService } from './client-service';
import { 
  DirectMessageResult, 
  BulkOperationResult, 
  MatrixServiceError,
  MatrixConnectionError 
} from './types';
import { MessageTemplates, WelcomeMessageData } from '../message-templates';

/**
 * MatrixMessagingService - Responsible for Matrix messaging operations
 * including direct messages, room messaging, and bulk operations
 */
export class MatrixMessagingService {
  private clientService: MatrixClientService;

  constructor(clientService: MatrixClientService) {
    this.clientService = clientService;
  }

  /**
   * Send a direct message to a Matrix user
   */
  public async sendDirectMessage(
    matrixUserId: string,
    message: string
  ): Promise<DirectMessageResult> {
    await this.clientService.ensureInitialized();
    
    const client = this.clientService.getClient();
    if (!client || !this.clientService.isConfigured()) {
      return {
        success: false,
        error: 'Matrix service not configured',
      };
    }

    try {
      console.log(`Sending direct message to ${matrixUserId}`);

      // Check if this is a Signal bridge user (starts with @signal_)
      if (matrixUserId.startsWith('@signal_')) {
        return await this.sendSignalBridgeMessage(matrixUserId, message, client);
      }

      // Normal Matrix user - create or get existing direct message room
      const roomId = await this.getOrCreateDirectRoom(matrixUserId, client);
      if (!roomId) {
        return {
          success: false,
          error: 'Failed to create or find direct message room',
        };
      }

      // Send the message
      const MsgType = await getMsgType();
      const response = await client.sendEvent(roomId, 'm.room.message', {
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

  /**
   * Send a message to a specific room
   */
  public async sendRoomMessage(
    roomId: string,
    message: string,
    msgType: MsgType = MsgType.Text
  ): Promise<DirectMessageResult> {
    await this.clientService.ensureInitialized();
    
    const client = this.clientService.getClient();
    if (!client || !this.clientService.isConfigured()) {
      return {
        success: false,
        error: 'Matrix service not configured',
      };
    }

    try {
      console.log(`Sending message to room ${roomId}`);

      const response = await client.sendEvent(roomId, 'm.room.message', {
        msgtype: msgType,
        body: message,
      });

      console.log(`Message sent successfully to room ${roomId}`);
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

  /**
   * Send welcome message to a Matrix user
   */
  public async sendWelcomeMessage(
    matrixUserId: string,
    welcomeData: WelcomeMessageData
  ): Promise<DirectMessageResult> {
    const welcomeMessage = MessageTemplates.createWelcomeMessage(welcomeData);
    return await this.sendDirectMessage(matrixUserId, welcomeMessage);
  }

  /**
   * Send welcome message with encryption delay for encrypted rooms
   */
  public async sendWelcomeMessageWithDelay(
    matrixUserId: string,
    welcomeData: WelcomeMessageData,
    delaySeconds: number = 5
  ): Promise<DirectMessageResult> {
    const config = this.clientService.getConfig();
    const roomId = config?.welcomeRoomId || config?.defaultRoomId;
    
    if (!roomId) {
      return {
        success: false,
        error: 'No welcome room configured',
      };
    }

    const welcomeMessage = MessageTemplates.createWelcomeMessage(welcomeData);
    return await this.sendMessageWithEncryptionDelay(roomId, welcomeMessage, undefined, delaySeconds);
  }

  /**
   * Send messages to multiple users in bulk
   */
  public async sendBulkDirectMessages(
    messages: Array<{ userId: string; message: string }>
  ): Promise<BulkOperationResult> {
    const results: Record<string, boolean> = {};
    const errors: Record<string, string> = {};
    let totalSuccess = 0;
    let totalFailed = 0;

    for (const { userId, message } of messages) {
      try {
        const result = await this.sendDirectMessage(userId, message);
        if (result.success) {
          results[userId] = true;
          totalSuccess++;
        } else {
          results[userId] = false;
          errors[userId] = result.error || 'Unknown error';
          totalFailed++;
        }
      } catch (error) {
        results[userId] = false;
        errors[userId] = error instanceof Error ? error.message : 'Unknown error';
        totalFailed++;
      }
    }

    return {
      success: totalSuccess > 0,
      results,
      errors,
      totalSuccess,
      totalFailed,
    };
  }

  /**
   * Send a message to multiple rooms
   */
  public async sendMessageToMultipleRooms(
    roomIds: string[],
    message: string
  ): Promise<BulkOperationResult> {
    const results: Record<string, boolean> = {};
    const errors: Record<string, string> = {};
    let totalSuccess = 0;
    let totalFailed = 0;

    for (const roomId of roomIds) {
      try {
        const result = await this.sendRoomMessage(roomId, message);
        if (result.success) {
          results[roomId] = true;
          totalSuccess++;
        } else {
          results[roomId] = false;
          errors[roomId] = result.error || 'Unknown error';
          totalFailed++;
        }
      } catch (error) {
        results[roomId] = false;
        errors[roomId] = error instanceof Error ? error.message : 'Unknown error';
        totalFailed++;
      }
    }

    return {
      success: totalSuccess > 0,
      results,
      errors,
      totalSuccess,
      totalFailed,
    };
  }

  /**
   * Send message to moderators (users with elevated permissions)
   */
  public async sendMessageToModerators(
    message: string,
    roomId?: string
  ): Promise<DirectMessageResult> {
    await this.clientService.ensureInitialized();
    
    const client = this.clientService.getClient();
    const config = this.clientService.getConfig();
    
    if (!client || !config) {
      return {
        success: false,
        error: 'Matrix service not configured',
      };
    }

    const targetRoomId = roomId || config.defaultRoomId;
    if (!targetRoomId) {
      return {
        success: false,
        error: 'No target room specified and no default room configured',
      };
    }

    try {
      // Get room members with power levels
      const powerLevels = await client.getStateEvent(targetRoomId, 'm.room.power_levels', '');
      const moderatorLevel = powerLevels.users_default || 0;
      
      // Find users with moderator privileges (power level > default)
      const moderators = Object.entries(powerLevels.users || {})
        .filter(([_, level]) => (level as number) > moderatorLevel)
        .map(([userId]) => userId);

      if (moderators.length === 0) {
        console.warn('No moderators found in room');
        // Fallback: send to room
        return await this.sendRoomMessage(targetRoomId, `[MODERATOR ALERT] ${message}`);
      }

      // Send direct messages to all moderators
      const bulkResult = await this.sendBulkDirectMessages(
        moderators.map(userId => ({ userId, message: `[MODERATOR ALERT] ${message}` }))
      );

      return {
        success: bulkResult.success,
        error: bulkResult.success ? undefined : `Failed to send to ${bulkResult.totalFailed} moderators`,
      };

    } catch (error) {
      console.error('Error sending message to moderators:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Send a message to a Signal bridge user using the Signal bridge bot
   */
  private async sendSignalBridgeMessage(
    signalUserId: string,
    message: string,
    client: MatrixClient
  ): Promise<DirectMessageResult> {
    try {
      console.log(`🔥 BRIDGE: Starting Signal bridge message flow for ${signalUserId}`);

      // Get Signal bridge room ID from environment
      const signalBridgeRoomId = process.env.MATRIX_SIGNAL_BRIDGE_ROOM_ID;
      if (!signalBridgeRoomId) {
        console.error('❌ BRIDGE: MATRIX_SIGNAL_BRIDGE_ROOM_ID not configured');
        return {
          success: false,
          error: 'MATRIX_SIGNAL_BRIDGE_ROOM_ID not configured',
        };
      }

      // Extract Signal UUID from Matrix user ID (format: @signal_UUID:domain.com)
      const signalUuid = signalUserId.split('_')[1]?.split(':')[0];
      if (!signalUuid) {
        console.error(`❌ BRIDGE: Failed to extract Signal UUID from ${signalUserId}`);
        return {
          success: false,
          error: `Failed to extract Signal UUID from ${signalUserId}`,
        };
      }

      // Get the correct bot username from environment
      const botUsername = process.env.MATRIX_BOT_USERNAME || '@irregular_chat_bot:irregularchat.com';
      
      console.log(`🤖 BRIDGE: Bot username: ${botUsername}`);

      // Send start-chat command to Signal bridge
      const startChatCommand = `start-chat ${signalUuid}`;
      console.log(`📤 BRIDGE: Sending Signal bridge command: ${startChatCommand} to room ${signalBridgeRoomId}`);

      const commandResponse = await client.sendEvent(signalBridgeRoomId, 'm.room.message', {
        msgtype: MsgType.Text,
        body: startChatCommand,
      });

      if (!commandResponse.event_id) {
        console.error('❌ BRIDGE: Failed to send Signal bridge command');
        return {
          success: false,
          error: 'Failed to send Signal bridge command',
        };
      }

      console.log(`✅ BRIDGE: Signal bridge command sent with event ID: ${commandResponse.event_id}`);

      // Wait for bot to respond and create chat room
      const delay = parseFloat(process.env.SIGNAL_BRIDGE_BOT_RESPONSE_DELAY || '3.0') * 1000;
      console.log(`⏱️ BRIDGE: Waiting ${delay}ms for bot response...`);
      await new Promise(resolve => setTimeout(resolve, delay));

      // Find the Signal chat room
      console.log(`🔍 BRIDGE: Searching for Signal chat room for user: ${signalUserId}`);
      let signalChatRoomId = await this.findSignalChatRoom(signalUserId, botUsername, client);
      
      // Retry logic with increasing delays
      if (!signalChatRoomId) {
        console.log('⏱️ BRIDGE: Signal chat room not found immediately, waiting additional 2 seconds...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        signalChatRoomId = await this.findSignalChatRoom(signalUserId, botUsername, client);
      }

      if (!signalChatRoomId) {
        console.log('⏱️ BRIDGE: Still not found, trying one more time with 3 second delay...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        signalChatRoomId = await this.findSignalChatRoom(signalUserId, botUsername, client);
      }
      
      if (!signalChatRoomId) {
        console.error(`❌ BRIDGE: Failed to find Signal chat room for ${signalUserId} after multiple attempts`);
        return {
          success: false,
          error: 'Signal chat room not found after bot command. The Signal bridge may not have created the room yet, or the user may not be available on Signal.',
        };
      }

      console.log(`✅ BRIDGE: Found Signal chat room: ${signalChatRoomId}`);

      // Send message with encryption delay
      return await this.sendMessageWithEncryptionDelay(signalChatRoomId, message, signalUserId);

    } catch (error) {
      console.error('💥 BRIDGE: Error in Signal bridge message flow:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Send a message with encryption establishment delay
   */
  private async sendMessageWithEncryptionDelay(
    roomId: string,
    message: string,
    signalUserId?: string,
    delaySeconds: number = 5
  ): Promise<DirectMessageResult> {
    const client = this.clientService.getClient();
    if (!client) {
      return {
        success: false,
        error: 'Matrix client not available',
      };
    }

    try {
      const userId = signalUserId || 'user';
      console.log(`⏱️ Sending message with ${delaySeconds}s encryption delay to ${userId}`);

      // Check if room is encrypted
      let isEncrypted = false;
      try {
        const encryptionEvent = await client.getStateEvent(roomId, 'm.room.encryption', '');
        isEncrypted = !!encryptionEvent;
        console.log(`🔐 Room ${roomId} encryption status: ${isEncrypted ? 'ENCRYPTED' : 'UNENCRYPTED'}`);
      } catch (error) {
        console.log(`🔐 Room ${roomId} is not encrypted (no encryption state event)`);
      }

      // For encrypted rooms, send a hello message first to establish encryption
      if (isEncrypted) {
        console.log(`🔐 Room is encrypted, sending hello message first...`);
        try {
          await client.sendEvent(roomId, 'm.room.message', {
            msgtype: MsgType.Text,
            body: 'hello',
          });
          console.log(`✅ Hello message sent to establish encryption`);
        } catch (error) {
          console.warn(`⚠️ Failed to send hello message:`, error);
        }

        // Wait for encryption to be established
        console.log(`⏱️ Waiting ${delaySeconds} seconds for encryption establishment...`);
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      }

      // Send the actual message
      console.log(`📤 Sending actual message to ${userId}`);
      const response = await client.sendEvent(roomId, 'm.room.message', {
        msgtype: MsgType.Text,
        body: message,
      });

      console.log(`✅ Message sent successfully to ${userId} in room ${roomId}`);
      return {
        success: true,
        roomId,
        eventId: response.event_id,
      };

    } catch (error) {
      console.error(`❌ Error sending message with encryption delay:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get or create a direct message room with a user
   */
  private async getOrCreateDirectRoom(matrixUserId: string, client: MatrixClient): Promise<string | null> {
    try {
      // Check if we already have a direct room with this user
      const rooms = client.getRooms();
      const directRoom = rooms.find(room => {
        const members = room.getJoinedMembers();
        return members.length === 2 && 
               members.some(member => member.userId === matrixUserId) &&
               room.getDMInviter();
      });

      if (directRoom) {
        console.log(`Found existing direct room: ${directRoom.roomId}`);
        return directRoom.roomId;
      }

      // Create new direct message room
      console.log(`Creating new direct room with ${matrixUserId}`);
      const createResponse = await client.createRoom({
        visibility: 'private',
        is_direct: true,
        invite: [matrixUserId],
        preset: 'trusted_private_chat',
      });

      console.log(`Created direct room: ${createResponse.room_id}`);
      return createResponse.room_id;

    } catch (error) {
      console.error('Error creating/finding direct room:', error);
      return null;
    }
  }

  /**
   * Find Signal chat room created by the bridge bot
   */
  private async findSignalChatRoom(
    signalUserId: string, 
    botUsername: string, 
    client: MatrixClient
  ): Promise<string | null> {
    try {
      console.log(`🔍 BRIDGE: Looking for Signal chat room for ${signalUserId}`);
      console.log(`🤖 BRIDGE: Bot username: ${botUsername}`);

      const rooms = client.getRooms();
      console.log(`🏠 BRIDGE: Total rooms available: ${rooms.length}`);

      // Clean the signal user ID for comparison
      const cleanSignalUserId = signalUserId.replace('@', '').toLowerCase();
      console.log(`🔍 BRIDGE: Cleaned signal user ID for search: ${cleanSignalUserId}`);

      for (const room of rooms) {
        const roomName = room.name?.toLowerCase() || '';
        const roomId = room.roomId;
        
        // Get room members
        const members = room.getJoinedMembers();
        const memberUserIds = members.map(m => m.userId);
        
        console.log(`🏠 BRIDGE: Checking room ${roomId} (${roomName}) with members: ${memberUserIds.join(', ')}`);

        // Check if this room has the bot and the signal user
        const hasBotMember = memberUserIds.some(id => id.toLowerCase().includes(botUsername.replace('@', '').toLowerCase()));
        const hasSignalUserInName = roomName.includes(cleanSignalUserId) || roomName.includes(signalUserId);
        const hasSignalUserAsMember = memberUserIds.some(id => id.toLowerCase().includes(cleanSignalUserId));

        console.log(`🔍 BRIDGE: Room analysis - hasBotMember: ${hasBotMember}, hasSignalUserInName: ${hasSignalUserInName}, hasSignalUserAsMember: ${hasSignalUserAsMember}`);

        // Signal chat rooms typically have the bot as a member and either:
        // 1. The signal user in the room name, or
        // 2. The signal user as a member
        if (hasBotMember && (hasSignalUserInName || hasSignalUserAsMember)) {
          console.log(`✅ BRIDGE: Found matching Signal chat room: ${roomId} (${roomName})`);
          return roomId;
        }
      }

      console.log(`❌ BRIDGE: No Signal chat room found for ${signalUserId}`);
      return null;

    } catch (error) {
      console.error('❌ BRIDGE: Error finding Signal chat room:', error);
      return null;
    }
  }
}