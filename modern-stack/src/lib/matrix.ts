import { MatrixClient, createClient, MsgType } from 'matrix-js-sdk';
import { MessageTemplates, WelcomeMessageData } from './message-templates';

interface MatrixConfig {
  homeserver: string;
  accessToken: string;
  userId: string;
  welcomeRoomId?: string;
  defaultRoomId?: string;
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
    return MessageTemplates.createWelcomeMessage(data);
  }

  public async sendWelcomeMessage(
    matrixUserId: string,
    username: string,
    fullName: string,
    tempPassword: string,
    discoursePostUrl?: string
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
        discoursePostUrl,
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

      // Check if this is a Signal bridge user (starts with @signal_)
      if (matrixUserId.startsWith('@signal_')) {
        return await this.sendSignalBridgeMessage(matrixUserId, message);
      }

      // Normal Matrix user - create or get existing direct message room
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

  /**
   * Send a message to a Signal bridge user using the Signal bridge bot
   */
  private async sendSignalBridgeMessage(
    signalUserId: string,
    message: string
  ): Promise<DirectMessageResult> {
    if (!this.isActive || !this.client) {
      console.error('❌ BRIDGE: Matrix service not configured');
      return {
        success: false,
        error: 'Matrix service not configured',
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
      const signalBotUsername = process.env.MATRIX_SIGNAL_BOT_USERNAME || '@signalbot:irregularchat.com';
      
      console.log(`🤖 BRIDGE: Bot username: ${botUsername}`);
      console.log(`📱 BRIDGE: Signal bot username: ${signalBotUsername}`);

      // First, send start-chat command to Signal bridge
      const startChatCommand = `start-chat ${signalUuid}`;
      console.log(`📤 BRIDGE: Sending Signal bridge command: ${startChatCommand} to room ${signalBridgeRoomId}`);

      const commandResponse = await this.client.sendEvent(signalBridgeRoomId, 'm.room.message', {
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

      // Find the Signal chat room - try multiple times with better logging
      console.log(`🔍 BRIDGE: Searching for Signal chat room for user: ${signalUserId}`);
      let signalChatRoomId = await this.findSignalChatRoom(signalUserId, botUsername);
      
      // If we didn't find it immediately, try waiting longer and search again
      if (!signalChatRoomId) {
        console.log('⏱️ BRIDGE: Signal chat room not found immediately, waiting additional 2 seconds...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        signalChatRoomId = await this.findSignalChatRoom(signalUserId, botUsername);
      }

      // Try one more time with an even longer delay
      if (!signalChatRoomId) {
        console.log('⏱️ BRIDGE: Still not found, trying one more time with 3 second delay...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        signalChatRoomId = await this.findSignalChatRoom(signalUserId, botUsername);
      }
      
      if (!signalChatRoomId) {
        console.error(`❌ BRIDGE: Failed to find Signal chat room for ${signalUserId} after multiple attempts`);
        console.log('🔄 BRIDGE: Attempting fallback: temporary room approach...');
        
        // Fallback: Try the temporary room approach from legacy implementation
        try {
          return await this.sendSignalMessageViaTempRoom(signalUserId, message);
        } catch (fallbackError) {
          console.error('❌ BRIDGE: Fallback approach also failed:', fallbackError);
          return {
            success: false,
            error: `Primary approach failed: Signal chat room not found after bot command. The Signal bridge may not have created the room yet, or the user may not be available on Signal. Fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`,
          };
        }
      }

      console.log(`✅ BRIDGE: Found Signal chat room: ${signalChatRoomId}`);

      // Send a preparatory message first to help establish encryption (as suggested by user)
      const preparatoryMessage = '🔐 Securing message...';
      console.log('📤 BRIDGE: Sending preparatory message to establish encryption...');
      
      try {
        const prepResponse = await this.client.sendEvent(signalChatRoomId, 'm.room.message', {
          msgtype: MsgType.Text,
          body: preparatoryMessage,
        });
        console.log(`✅ BRIDGE: Preparatory message sent: ${prepResponse.event_id}`);
        
        // Small delay to let encryption establish
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (prepError) {
        console.warn('⚠️ BRIDGE: Failed to send preparatory message, continuing with main message:', prepError);
      }

      // Send the actual message to the Signal chat room
      console.log(`📤 BRIDGE: Sending verification message to room ${signalChatRoomId}`);
      const messageResponse = await this.client.sendEvent(signalChatRoomId, 'm.room.message', {
        msgtype: MsgType.Text,
        body: message,
      });

      console.log(`✅ BRIDGE: Signal message sent successfully: ${messageResponse.event_id}`);
      return {
        success: true,
        roomId: signalChatRoomId,
        eventId: messageResponse.event_id,
      };

    } catch (error) {
      console.error('💥 BRIDGE: Error in Signal bridge message flow:', error);
      
      // Fallback: Try the temporary room approach from legacy implementation
      console.log('🔄 BRIDGE: Attempting fallback: temporary room approach...');
      try {
        return await this.sendSignalMessageViaTempRoom(signalUserId, message);
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
   * Fallback method: Send Signal message via temporary room creation
   * Based on legacy send_signal_message_async implementation
   */
  private async sendSignalMessageViaTempRoom(
    signalUserId: string,
    message: string
  ): Promise<DirectMessageResult> {
    if (!this.client) {
      return {
        success: false,
        error: 'Matrix client not available',
      };
    }

    try {
      console.log(`🔄 Using temporary room fallback approach for Signal user: ${signalUserId}`);
      
      // Create a temporary room with a specific name (like legacy implementation)
      const uniqueId = Math.random().toString(36).substring(2, 10); // 8 characters like legacy
      const tempRoomName = `Signal Message ${uniqueId}`;
      
      console.log(`🏗️ Creating temporary room '${tempRoomName}' for Signal message`);
      
      const createResponse = await this.client.createRoom({
        visibility: 'private' as any,
        name: tempRoomName,
        topic: 'Temporary room for Signal message',
        invite: [signalUserId], // Invite the Signal user directly
      });

      if (!createResponse.room_id) {
        throw new Error('Failed to create temporary room');
      }

      const roomId = createResponse.room_id;
      console.log(`✅ Created temporary room: ${roomId}`);
      console.log(`📧 Invited Signal user: ${signalUserId}`);

      // Wait for the Signal user to potentially join (legacy uses 2 seconds)
      console.log('⏱️ Waiting for Signal bridge to process invitation...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Send preparatory message for encryption establishment
      console.log('🔐 Sending preparatory message in temp room...');
      try {
        const prepResponse = await this.client.sendEvent(roomId, 'm.room.message', {
          msgtype: MsgType.Text,
          body: '🔐 Securing message...',
        });
        console.log(`✅ Preparatory message sent: ${prepResponse.event_id}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (prepError) {
        console.warn('⚠️ Failed to send preparatory message in temp room:', prepError);
      }

      // Send the actual message
      console.log(`📤 Sending verification message to Signal user via temp room ${roomId}`);
      const sendResponse = await this.client.sendEvent(roomId, 'm.room.message', {
        msgtype: MsgType.Text,
        body: message,
      });

      if (sendResponse.event_id) {
        console.log(`✅ Message sent to Signal user via temp room: ${sendResponse.event_id}`);
        
        // Mark the room as direct chat (like legacy implementation)
        try {
          await this.client.sendEvent(roomId, 'm.room.direct', {
            [signalUserId]: [roomId]
          });
          console.log('✅ Room marked as direct chat');
        } catch (directError) {
          console.warn('⚠️ Could not mark room as direct chat:', directError);
        }
        
        return {
          success: true,
          roomId,
          eventId: sendResponse.event_id,
        };
      } else {
        throw new Error('Failed to send message to temp room');
      }

    } catch (error) {
      console.error('💥 Error in temp room fallback approach:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Temp room approach failed',
      };
    }
  }

  /**
   * Resolve a phone number to Signal UUID using SignalBot
   * Uses the resolve-identifier command to convert phone number to UUID
   */
  private async resolvePhoneToSignalUuid(phoneNumber: string): Promise<string | null> {
    if (!this.isActive || !this.client) {
      console.error('❌ Matrix service not configured for phone resolution');
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

      const commandResponse = await this.client.sendEvent(signalBridgeRoomId, 'm.room.message', {
        msgtype: MsgType.Text,
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

      // Get recent messages from Signal bridge room to find the bot's response
      // Try multiple approaches to get the room data
      let room = this.client.getRoom(signalBridgeRoomId);
      
      // If room not found, try to force sync the room
      if (!room) {
        console.log('⚠️ RESOLVE: Room not found in client, attempting to fetch messages directly...');
        
        try {
          // Use the Matrix HTTP API to get recent messages directly
          const messagesResponse = await this.client.createMessagesRequest(
            signalBridgeRoomId,
            '', // token
            10, // limit
            'b' as any // direction (backwards)
          );
          
          if (messagesResponse && messagesResponse.chunk) {
            console.log(`✅ RESOLVE: Retrieved ${messagesResponse.chunk.length} messages via HTTP API`);
            
            // Look for bot response in the retrieved messages
            const botUsername = process.env.MATRIX_SIGNAL_BOT_USERNAME || '@signalbot:irregularchat.com';
            
            for (const event of messagesResponse.chunk) {
              if (event.type === 'm.room.message' && event.sender === botUsername) {
                console.log(`🤖 RESOLVE: Found bot message from ${event.sender}: "${event.content?.body}"`);
                
                if (event.content?.body?.includes('Found')) {
                  // Extract UUID from message like "Found `770b19f5-389e-444e-8976-551a52136cf6` / Sac"
                  const uuidMatch = event.content.body.match(/Found `([a-f0-9-]+)`/);
                  if (uuidMatch) {
                    const uuid = uuidMatch[1];
                    console.log(`✅ RESOLVE: Successfully resolved ${normalizedPhone} to UUID: ${uuid}`);
                    return uuid;
                  }
                }
                
                // Check for failure messages
                if (event.content?.body?.includes('Failed to resolve') || 
                    event.content?.body?.includes('phone number must start with')) {
                  console.error(`❌ RESOLVE: SignalBot resolve failed: ${event.content.body}`);
                  return null;
                }
              }
            }
            
            console.warn(`⚠️ RESOLVE: No UUID found for phone ${normalizedPhone} in HTTP API response`);
            return null;
          }
        } catch (httpError) {
          console.error('❌ RESOLVE: HTTP API fallback failed:', httpError);
          return null;
        }
      }

      // Original room-based approach (fallback)
      if (!room) {
        console.error('❌ RESOLVE: Room still not available after fallback attempts');
        return null;
      }
      
      const timeline = room.getLiveTimeline();
      const events = timeline.getEvents();
      
      // Look for bot response that contains "Found" and UUID (check last 10 events)
      const botUsername = process.env.MATRIX_SIGNAL_BOT_USERNAME || '@signalbot:irregularchat.com';
      const recentEvents = events.slice(-10);
      
      console.log(`🔍 RESOLVE: Checking last ${recentEvents.length} events for response from ${botUsername}...`);
      
      for (const event of recentEvents) {
        if (event.getType() === 'm.room.message' && 
            event.getSender() === botUsername) {
          
          const content = event.getContent();
          console.log(`🤖 RESOLVE: Found bot message from ${event.getSender()}: "${content.body}"`);
          
          if (content?.body?.includes('Found')) {
            // Extract UUID from message like "Found `770b19f5-389e-444e-8976-551a52136cf6` / Sac"
            const uuidMatch = content.body.match(/Found `([a-f0-9-]+)`/);
            if (uuidMatch) {
              const uuid = uuidMatch[1];
              console.log(`✅ RESOLVE: Successfully resolved ${normalizedPhone} to UUID: ${uuid}`);
              return uuid;
            }
          }
          
          // Check for failure messages
          if (content.body?.includes('Failed to resolve') || 
              content.body?.includes('phone number must start with')) {
            console.error(`❌ RESOLVE: SignalBot resolve failed: ${content.body}`);
            return null;
          }
        }
      }

      console.warn(`⚠️ RESOLVE: No UUID found for phone ${normalizedPhone} in bot responses`);
      console.log(`🔍 RESOLVE: Recent messages from all users:`, recentEvents.map(e => ({
        sender: e.getSender(),
        type: e.getType(),
        body: e.getContent()?.body?.substring(0, 100)
      })));
      return null;

    } catch (error) {
      console.error('💥 RESOLVE: Error resolving phone to Signal UUID:', error);
      return null;
    }
  }

  /**
   * Send a message to a Signal user by phone number
   * This function handles the full phone-to-UUID resolution and messaging flow
   */
  public async sendSignalMessageByPhone(
    phoneNumber: string,
    message: string
  ): Promise<DirectMessageResult> {
    if (!this.isActive || !this.client) {
      return {
        success: false,
        error: 'Matrix service not configured',
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

      // Step 3: Send message using existing SignalBot integration
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
   * Find the Signal chat room created by the bridge bot
   * Based on legacy implementation patterns
   */
  private async findSignalChatRoom(signalUserId: string, botUsername: string): Promise<string | null> {
    if (!this.client) {
      console.error('❌ FIND: Matrix client not available');
      return null;
    }

    try {
      console.log(`🔍 FIND: Searching for Signal chat room with user: ${signalUserId}`);
      const joinedRooms = await this.client.getJoinedRooms();
      console.log(`📋 FIND: Found ${joinedRooms.joined_rooms.length} joined rooms to search`);
      
      // Search through all rooms to find the Signal chat room
      for (const roomId of joinedRooms.joined_rooms) {
        try {
          console.log(`🔍 FIND: Checking room: ${roomId}`);
          const roomState = await this.client.roomState(roomId);
          const members: string[] = [];
          let roomName = '';
          let topic = '';
          let isDirectFlag = false;

          // Parse room state events
          for (const event of roomState) {
            if (event.type === 'm.room.member' && 
                event.state_key && 
                event.content?.membership === 'join') {
              members.push(event.state_key);
            } else if (event.type === 'm.room.name') {
              roomName = event.content?.name || '';
            } else if (event.type === 'm.room.topic') {
              topic = event.content?.topic || '';
            } else if (event.type === 'm.room.dm_prompt' && event.state_key === signalUserId) {
              isDirectFlag = true; // Custom event for prompt (from legacy)
            }
          }

          console.log(`📊 FIND: Room ${roomId}: "${roomName}", Topic: "${topic}", Members: ${members.length}`);
          console.log(`👥 FIND: Members: ${members.join(', ')}`);

          // Check if this room contains the Signal user
          if (members.includes(signalUserId)) {
            console.log(`✅ FIND: Room ${roomId} contains Signal user ${signalUserId}`);
            
            // Check if the bot is also in the room
            const isBotInRoom = members.includes(botUsername);
            console.log(`🤖 FIND: Bot (${botUsername}) in room: ${isBotInRoom}`);
            
            // Criteria for Signal bridge rooms (based on legacy implementation):
            // 1. Contains the Signal user
            // 2. Bot is a member
            // 3. It's likely a DM (small member count OR Signal-related name/topic OR direct flag)
            const hasSmallMemberCount = members.length <= 4;
            const hasSignalInName = roomName.toLowerCase().includes('signal');
            const hasSignalInTopic = topic.toLowerCase().includes('signal');
            
            console.log(`🔍 FIND: Criteria check for room ${roomId}:`);
            console.log(`  - Bot in room: ${isBotInRoom}`);
            console.log(`  - Small member count (≤4): ${hasSmallMemberCount} (${members.length})`);
            console.log(`  - Signal in name: ${hasSignalInName} ("${roomName}")`);
            console.log(`  - Signal in topic: ${hasSignalInTopic} ("${topic}")`);
            console.log(`  - Direct flag: ${isDirectFlag}`);
            
            if (isBotInRoom && (
              hasSmallMemberCount || // Small member count (bot, user, Signal user, maybe admin)
              hasSignalInName || // Signal-related name
              hasSignalInTopic || // Signal-related topic
              isDirectFlag // Custom direct flag
            )) {
              console.log(`🎯 FIND: Selected Signal chat room: ${roomId} (Name: "${roomName}", Members: ${members.length})`);
              return roomId;
            } else {
              console.log(`❌ FIND: Room ${roomId} doesn't meet Signal bridge criteria`);
            }
          } else {
            console.log(`❌ FIND: Room ${roomId} does not contain Signal user ${signalUserId}`);
          }
        } catch (roomError) {
          console.warn(`⚠️ FIND: Error checking room ${roomId}:`, roomError);
          continue;
        }
      }

      console.warn(`❌ FIND: No Signal chat room found for user: ${signalUserId}`);
      return null;
    } catch (error) {
      console.error('💥 FIND: Error finding Signal chat room:', error);
      return null;
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

  /**
   * Send a message to moderators in the INDOC room
   * Based on legacy Streamlit patterns for sending messages to multiple rooms
   */
  public async sendMessageToModerators(
    message: string,
    roomId?: string
  ): Promise<DirectMessageResult> {
    if (!this.isActive || !this.client) {
      return {
        success: false,
        error: 'Matrix service not configured',
      };
    }

    try {
      // Use provided room ID or get from environment
      const indocRoomId = roomId || process.env.MATRIX_INDOC_ROOM_ID || this.config?.defaultRoomId;
      
      if (!indocRoomId) {
        return {
          success: false,
          error: 'INDOC room ID not configured. Set MATRIX_INDOC_ROOM_ID environment variable.',
        };
      }

      console.log(`Sending message to moderators in room: ${indocRoomId}`);

      // Send message to the INDOC room
      const response = await this.client.sendEvent(indocRoomId, 'm.room.message', {
        msgtype: MsgType.Text,
        body: message,
      });

      if (response.event_id) {
        console.log(`Message sent to moderators: ${response.event_id}`);
        return {
          success: true,
          roomId: indocRoomId,
          eventId: response.event_id,
        };
      } else {
        return {
          success: false,
          error: 'Failed to send message to moderators room',
        };
      }

    } catch (error) {
      console.error('Error sending message to moderators:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Send a message to multiple rooms (moderator notification pattern)
   * Based on legacy send_matrix_message_to_multiple_rooms pattern
   */
  public async sendMessageToMultipleRooms(
    roomIds: string[],
    message: string
  ): Promise<BulkOperationResult> {
    if (!this.isActive || !this.client) {
      return {
        success: false,
        results: {},
        errors: {},
        totalSuccess: 0,
        totalFailed: roomIds.length,
      };
    }

    const results: Record<string, boolean> = {};
    const errors: Record<string, string> = {};
    let totalSuccess = 0;
    let totalFailed = 0;

    console.log(`Sending message to ${roomIds.length} rooms`);

    for (const roomId of roomIds) {
      try {
        const response = await this.client.sendEvent(roomId, 'm.room.message', {
          msgtype: MsgType.Text,
          body: message,
        });

        if (response.event_id) {
          results[roomId] = true;
          totalSuccess++;
          console.log(`Message sent to room ${roomId}: ${response.event_id}`);
        } else {
          results[roomId] = false;
          errors[roomId] = 'Failed to send message';
          totalFailed++;
        }
      } catch (error) {
        results[roomId] = false;
        errors[roomId] = error instanceof Error ? error.message : 'Unknown error';
        totalFailed++;
        console.error(`Error sending message to room ${roomId}:`, error);
      }

      // Add small delay between messages to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
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
   * Send a message to a Signal user via the Signal bridge
   * Public wrapper for sendSignalBridgeMessage method
   */
  public async sendSignalMessage(
    signalUserId: string,
    message: string
  ): Promise<DirectMessageResult> {
    return this.sendSignalBridgeMessage(signalUserId, message);
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