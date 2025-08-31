// Use dynamic imports for matrix-js-sdk to avoid bundling conflicts
import { MatrixClientService } from './client-service';
import { DirectMessageResult, MatrixSignalBridgeError } from './types';

/**
 * MatrixSignalBridgeService - Responsible for Signal bridge integration
 * including Signal user messaging, phone number resolution, and bridge room management
 */
export class MatrixSignalBridgeService {
  private clientService: MatrixClientService;

  constructor(clientService: MatrixClientService) {
    this.clientService = clientService;
  }

  /**
   * Check if a user ID is a Signal bridge user
   */
  public isSignalUser(userId: string): boolean {
    return userId.startsWith('@signal_');
  }

  /**
   * Extract Signal UUID from Matrix user ID
   */
  public extractSignalUuid(signalUserId: string): string | null {
    // Format: @signal_UUID:domain.com
    const signalUuid = signalUserId.split('_')[1]?.split(':')[0];
    return signalUuid || null;
  }

  /**
   * Send a message to a Signal bridge user
   */
  public async sendSignalBridgeMessage(
    signalUserId: string,
    message: string
  ): Promise<DirectMessageResult> {
    const client = this.clientService.getClient();
    if (!client || !this.clientService.isConfigured()) {
      return {
        success: false,
        error: 'Matrix service not configured',
      };
    }

    if (!this.isSignalUser(signalUserId)) {
      return {
        success: false,
        error: 'User ID is not a Signal bridge user',
      };
    }

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

      // Extract Signal UUID
      const signalUuid = this.extractSignalUuid(signalUserId);
      if (!signalUuid) {
        console.error(`❌ BRIDGE: Failed to extract Signal UUID from ${signalUserId}`);
        return {
          success: false,
          error: `Failed to extract Signal UUID from ${signalUserId}`,
        };
      }

      // Get bot usernames from environment
      const botUsername = process.env.MATRIX_BOT_USERNAME || '@irregular_chat_bot:irregularchat.com';
      console.log(`🤖 BRIDGE: Bot username: ${botUsername}`);

      // Send start-chat command to Signal bridge
      const startChatCommand = `start-chat ${signalUuid}`;
      console.log(`📤 BRIDGE: Sending Signal bridge command: ${startChatCommand} to room ${signalBridgeRoomId}`);

      const commandResponse = await client.sendEvent(signalBridgeRoomId, 'm.room.message', {
        msgtype: 'm.text',
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

      // Find the Signal chat room with retry logic
      let signalChatRoomId = await this.findSignalChatRoom(signalUserId, botUsername, client);
      
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
        console.log('🔄 BRIDGE: Attempting fallback: temporary room approach...');
        
        // Fallback to temporary room approach
        try {
          return await this.sendSignalMessageViaTempRoom(signalUserId, message, client);
        } catch (fallbackError) {
          console.error('❌ BRIDGE: Fallback approach also failed:', fallbackError);
          return {
            success: false,
            error: `Primary approach failed: Signal chat room not found. Fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`,
          };
        }
      }

      console.log(`✅ BRIDGE: Found Signal chat room: ${signalChatRoomId}`);

      // Send message to the chat room
      const response = await client.sendEvent(signalChatRoomId, 'm.room.message', {
        msgtype: 'm.text',
        body: message,
      });

      console.log(`✅ BRIDGE: Message sent successfully to Signal user ${signalUserId}`);
      return {
        success: true,
        roomId: signalChatRoomId,
        eventId: response.event_id,
      };

    } catch (error) {
      console.error('💥 BRIDGE: Error in Signal bridge message flow:', error);
      
      // Try fallback approach
      try {
        return await this.sendSignalMessageViaTempRoom(signalUserId, message, client);
      } catch (fallbackError) {
        console.error('❌ BRIDGE: Fallback approach also failed:', fallbackError);
        return {
          success: false,
          error: `Primary approach failed: ${error instanceof Error ? error.message : 'Unknown error'}. Fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`,
        };
      }
    }
  }

  /**
   * Resolve a phone number to Signal UUID using the Signal bridge
   */
  public async resolvePhoneToSignalUuid(phoneNumber: string): Promise<string | null> {
    // Check environment variables directly instead of relying on client service
    const homeserver = process.env.MATRIX_HOMESERVER;
    const accessToken = process.env.MATRIX_ACCESS_TOKEN;
    const userId = process.env.MATRIX_USER_ID;
    const signalBridgeRoomId = process.env.MATRIX_SIGNAL_BRIDGE_ROOM_ID;
    
    if (!homeserver || !accessToken || !userId || !signalBridgeRoomId) {
      console.error('❌ Matrix service environment not configured for phone resolution');
      return null;
    }
    
    // Try to get client from service first, but continue even if it fails
    let client = null;
    try {
      await this.clientService.ensureInitialized();
      client = this.clientService.getClient();
    } catch (error) {
      console.warn(`⚠️ Client service initialization failed for phone resolution, will try direct client creation:`, error);
    }
    
    // If client service failed, try to create client directly
    if (!client) {
      try {
        // Use shared SDK instance to handle encryption properly
        const { createMatrixClient } = await import('./sdk-instance');
        client = await createMatrixClient({
          baseUrl: homeserver,
          accessToken: accessToken,
          userId: userId,
          deviceId: process.env.MATRIX_DEVICE_ID || 'DASHBOARD_BOT_001',
        });
      } catch (directError) {
        console.error(`❌ Direct client creation failed for phone resolution:`, directError);
        return null;
      }
    }
    
    if (!client) {
      console.error('❌ Matrix client unavailable for phone resolution');
      return null;
    }

    try {
      console.log(`🔍 RESOLVE: Starting phone resolution for ${phoneNumber}`);

      // Get Signal bridge room ID from environment
      const signalBridgeRoomId = process.env.MATRIX_SIGNAL_BRIDGE_ROOM_ID;
      if (!signalBridgeRoomId) {
        console.error('❌ RESOLVE: MATRIX_SIGNAL_BRIDGE_ROOM_ID not configured');
        return null;
      }

      // Normalize phone number to ensure it starts with +
      const normalizedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
      console.log(`📞 RESOLVE: Normalized phone number: ${normalizedPhone}`);

      // Send resolve-identifier command to Signal bridge
      const resolveCommand = `resolve-identifier ${normalizedPhone}`;
      console.log(`📤 RESOLVE: Sending command to bridge room ${signalBridgeRoomId}: ${resolveCommand}`);

      const commandResponse = await client.sendEvent(signalBridgeRoomId, 'm.room.message', {
        msgtype: 'm.text',
        body: resolveCommand,
      });

      if (!commandResponse.event_id) {
        console.error('❌ RESOLVE: Failed to send resolve-identifier command');
        return null;
      }

      console.log(`✅ RESOLVE: Command sent successfully, event ID: ${commandResponse.event_id}`);

      // Wait for bot response
      const delay = parseFloat(process.env.SIGNAL_BRIDGE_BOT_RESPONSE_DELAY || '3.0') * 1000;
      console.log(`⏱️ RESOLVE: Waiting ${delay}ms for Signal bot response...`);
      await new Promise(resolve => setTimeout(resolve, delay));

      // Look for bot response in recent messages
      const uuid = await this.parseSignalBotResponse(signalBridgeRoomId, normalizedPhone, client);
      
      if (uuid) {
        console.log(`✅ RESOLVE: Successfully resolved ${normalizedPhone} to UUID: ${uuid}`);
        return uuid;
      } else {
        console.log(`❌ RESOLVE: Could not resolve ${normalizedPhone} to Signal UUID`);
        return null;
      }

    } catch (error) {
      console.error('❌ RESOLVE: Error resolving phone to Signal UUID:', error);
      return null;
    }
  }

  /**
   * Send a message to a phone number via Signal bridge
   */
  public async sendSignalMessageByPhone(phoneNumber: string, message: string): Promise<DirectMessageResult> {
    // Check environment variables directly instead of relying on client service
    const homeserver = process.env.MATRIX_HOMESERVER;
    const accessToken = process.env.MATRIX_ACCESS_TOKEN;
    const userId = process.env.MATRIX_USER_ID;
    const signalBridgeRoomId = process.env.MATRIX_SIGNAL_BRIDGE_ROOM_ID;
    
    console.log(`🔧 DEBUG: Environment check for Signal verification`);
    console.log(`🔧 DEBUG: MATRIX_HOMESERVER=${!!homeserver} (${homeserver})`);
    console.log(`🔧 DEBUG: MATRIX_ACCESS_TOKEN=${!!accessToken} (length: ${accessToken?.length || 0})`);
    console.log(`🔧 DEBUG: MATRIX_USER_ID=${!!userId} (${userId})`);
    console.log(`🔧 DEBUG: MATRIX_SIGNAL_BRIDGE_ROOM_ID=${!!signalBridgeRoomId} (${signalBridgeRoomId})`);
    console.log(`🔧 DEBUG: MATRIX_ENABLE_ENCRYPTION=${process.env.MATRIX_ENABLE_ENCRYPTION}`);
    
    if (!homeserver || !accessToken || !userId || !signalBridgeRoomId) {
      return {
        success: false,
        error: 'Matrix service environment not configured for Signal bridge',
      };
    }
    
    // Try to get client from service first, but continue even if it fails
    let client = null;
    try {
      await this.clientService.ensureInitialized();
      client = this.clientService.getClient();
      console.log(`🔧 DEBUG: Client service client available: ${!!client}`);
    } catch (error) {
      console.warn(`⚠️ Client service initialization failed, will try direct client creation:`, error);
    }
    
    // If client service failed, try to create client directly
    if (!client) {
      try {
        console.log(`🔧 DEBUG: Attempting direct Matrix client creation`);
        console.log(`🔧 DEBUG: Import path: ./sdk-instance`);
        // Use shared SDK instance to handle encryption properly
        const { createMatrixClient } = await import('./sdk-instance');
        console.log(`🔧 DEBUG: SDK instance imported successfully`);
        
        console.log(`🔧 DEBUG: Creating client with config:`, {
          baseUrl: homeserver,
          accessTokenLength: accessToken?.length,
          userId: userId,
          deviceId: process.env.MATRIX_DEVICE_ID || 'DASHBOARD_BOT_001',
        });
        
        client = await createMatrixClient({
          baseUrl: homeserver,
          accessToken: accessToken,
          userId: userId,
          deviceId: process.env.MATRIX_DEVICE_ID || 'DASHBOARD_BOT_001',
        });
        console.log(`✅ DEBUG: Direct client creation successful`);
        console.log(`✅ DEBUG: Client available: ${!!client}`);
      } catch (directError) {
        console.error(`❌ DEBUG: Direct client creation failed:`, directError);
        return {
          success: false,
          error: `Failed to create Matrix client for Signal verification: ${directError instanceof Error ? directError.message : String(directError)}`,
          details: directError instanceof Error ? directError.stack : String(directError),
        };
      }
    }
    
    if (!client) {
      return {
        success: false,
        error: 'Matrix client unavailable for Signal verification',
      };
    }

    try {
      console.log(`📞 Sending Signal message to phone ${phoneNumber}`);

      // Step 1: Resolve phone number to Signal UUID
      console.log(`🔍 Step 1: Resolving phone number to Signal UUID...`);
      const signalUuid = await this.resolvePhoneToSignalUuid(phoneNumber);
      if (!signalUuid) {
        console.error(`❌ Step 1 failed: Could not resolve phone ${phoneNumber} to Signal UUID`);
        return {
          success: false,
          error: `Failed to resolve phone number ${phoneNumber} to Signal UUID. User may not have Signal or number may be invalid.`,
        };
      }
      console.log(`✅ Step 1 complete: Resolved phone ${phoneNumber} to UUID: ${signalUuid}`);

      // Step 2: Create Signal user ID from UUID
      const signalUserId = `@signal_${signalUuid}:${process.env.MATRIX_DOMAIN || 'irregularchat.com'}`;
      console.log(`🏗️ Step 2: Created Signal user ID: ${signalUserId}`);

      // Step 3: Send message using existing Signal bridge integration
      console.log(`📤 Step 3: Sending message to Signal user ID: ${signalUserId}`);
      const result = await this.sendSignalBridgeMessage(signalUserId, message);
      
      if (result.success) {
        console.log(`✅ Successfully sent message to ${phoneNumber} via Signal (${signalUserId})`);
      } else {
        console.error(`❌ Failed to send message to ${phoneNumber} via Signal (${signalUserId}): ${result.error}`);
      }

      return result;

    } catch (error) {
      console.error('💥 Error sending Signal message by phone:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get the Signal bridge room status
   */
  public async getBridgeRoomStatus(): Promise<{ configured: boolean; roomId?: string; accessible?: boolean }> {
    const signalBridgeRoomId = process.env.MATRIX_SIGNAL_BRIDGE_ROOM_ID;
    
    if (!signalBridgeRoomId) {
      return { configured: false };
    }

    const client = this.clientService.getClient();
    if (!client) {
      return { configured: true, roomId: signalBridgeRoomId, accessible: false };
    }

    try {
      const room = client.getRoom(signalBridgeRoomId);
      return {
        configured: true,
        roomId: signalBridgeRoomId,
        accessible: !!room,
      };
    } catch (error) {
      return {
        configured: true,
        roomId: signalBridgeRoomId,
        accessible: false,
      };
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

  /**
   * Send a message via temporary room (fallback approach)
   */
  private async sendSignalMessageViaTempRoom(
    signalUserId: string,
    message: string,
    client: MatrixClient
  ): Promise<DirectMessageResult> {
    try {
      console.log(`🔄 FALLBACK: Using temporary room fallback approach for Signal user: ${signalUserId}`);
      
      // Create a temporary room with a specific name
      const uniqueId = Math.random().toString(36).substring(2, 10); // 8 characters
      const tempRoomName = `Signal Message ${uniqueId}`;
      
      console.log(`🏗️ FALLBACK: Creating temporary room '${tempRoomName}' for Signal message`);
      
      const createResponse = await client.createRoom({
        visibility: 'private' as any,
        name: tempRoomName,
        topic: 'Temporary room for Signal message',
        invite: [signalUserId], // Invite the Signal user directly
      });

      if (!createResponse.room_id) {
        throw new MatrixSignalBridgeError('Failed to create temporary room');
      }

      const roomId = createResponse.room_id;
      console.log(`✅ FALLBACK: Created temporary room: ${roomId}`);
      console.log(`📧 FALLBACK: Invited Signal user: ${signalUserId}`);

      // Wait for the Signal user to potentially join
      console.log('⏱️ FALLBACK: Waiting for Signal bridge to process invitation...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Send the message
      console.log('📤 FALLBACK: Sending message in temp room...');
      const response = await client.sendEvent(roomId, 'm.room.message', {
        msgtype: 'm.text',
        body: message,
      });

      // Mark the room as direct chat
      try {
        const directContent: Record<string, string[]> = {};
        directContent[signalUserId] = [roomId];
        
        await client.setAccountData('m.direct', directContent);
        console.log('✅ FALLBACK: Room marked as direct chat in account data');
      } catch (directError) {
        console.warn('⚠️ FALLBACK: Could not mark room as direct chat:', directError);
        // This is not critical, continue with success
      }
      
      console.log(`✅ FALLBACK: Temporary room approach completed successfully`);
      return {
        success: true,
        roomId,
        eventId: response.event_id,
      };

    } catch (error) {
      console.error('💥 FALLBACK: Error in temp room fallback approach:', error);
      throw new MatrixSignalBridgeError(
        'Temp room approach failed',
        { signalUserId, originalError: error }
      );
    }
  }

  /**
   * Parse Signal bot response to extract UUID
   */
  private async parseSignalBotResponse(
    signalBridgeRoomId: string,
    phoneNumber: string,
    client: MatrixClient
  ): Promise<string | null> {
    try {
      // Get recent messages from Signal bridge room
      let room = client.getRoom(signalBridgeRoomId);
      
      // If room not found, try to get messages via HTTP API
      if (!room) {
        console.log('⚠️ RESOLVE: Room not found in client, attempting to fetch messages directly...');
        
        try {
          // Use the Matrix HTTP API to get recent messages directly
          const messagesResponse = await client.createMessagesRequest(
            signalBridgeRoomId,
            '', // token
            10, // limit
            'b' as any // direction (backwards)
          );
          
          if (messagesResponse && messagesResponse.chunk) {
            console.log(`✅ RESOLVE: Retrieved ${messagesResponse.chunk.length} messages via HTTP API`);
            
            const botUsername = process.env.MATRIX_SIGNAL_BOT_USERNAME || '@signalbot:irregularchat.com';
            
            // Look for UUID in bot messages
            for (const event of messagesResponse.chunk) {
              if (event.sender === botUsername && event.content?.body) {
                const uuid = this.extractUuidFromBotMessage(event.content.body, phoneNumber);
                if (uuid) {
                  return uuid;
                }
              }
            }
          }
        } catch (apiError) {
          console.error('❌ RESOLVE: Error fetching messages via HTTP API:', apiError);
        }
      } else {
        // Room found, get timeline events
        const timeline = room.getUnfilteredTimelineSet().getLiveTimeline();
        const events = timeline.getEvents();
        
        const botUsername = process.env.MATRIX_SIGNAL_BOT_USERNAME || '@signalbot:irregularchat.com';
        
        // Look for UUID in recent bot messages
        for (const event of events.slice(-10)) { // Check last 10 messages
          if (event.getSender() === botUsername) {
            const content = event.getContent();
            if (content?.body) {
              const uuid = this.extractUuidFromBotMessage(content.body, phoneNumber);
              if (uuid) {
                return uuid;
              }
            }
          }
        }
      }
      
      console.log(`❌ RESOLVE: No valid UUID response found for ${phoneNumber}`);
      return null;
      
    } catch (error) {
      console.error('❌ RESOLVE: Error parsing Signal bot response:', error);
      return null;
    }
  }

  /**
   * Extract UUID from Signal bot message
   */
  private extractUuidFromBotMessage(message: string, phoneNumber: string): string | null {
    // Look for UUID patterns in the message
    // Signal UUIDs are typically in the format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    const uuidPattern = /[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/g;
    const matches = message.match(uuidPattern);
    
    if (matches && matches.length > 0) {
      // Return the first UUID found
      console.log(`✅ RESOLVE: Found UUID in bot message: ${matches[0]}`);
      return matches[0];
    }
    
    // Also check for specific resolve response patterns
    if (message.includes(phoneNumber) && message.toLowerCase().includes('uuid')) {
      console.log(`🔍 RESOLVE: Bot message mentions phone number and UUID: ${message}`);
      // Try to extract UUID from this specific context
      const contextualMatches = message.match(uuidPattern);
      if (contextualMatches) {
        return contextualMatches[0];
      }
    }
    
    return null;
  }
}