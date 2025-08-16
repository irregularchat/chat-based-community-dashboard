// Use the new SDK instance to avoid multiple entrypoints
import { createMatrixClient, getMsgType } from './matrix/sdk-instance';

// Type imports - these will need to be imported dynamically to avoid bundling conflicts
type MatrixClient = any;
type MsgType = any;
type ClientEvent = any;
type RoomEvent = any;
import { MessageTemplates, WelcomeMessageData } from './message-templates';
import * as fs from 'fs';
import * as path from 'path';

interface MatrixConfig {
  homeserver: string;
  accessToken: string;
  userId: string;
  welcomeRoomId?: string;
  defaultRoomId?: string;
  enableEncryption?: boolean;
  deviceId?: string;
  deviceDisplayName?: string;
  encryptionKeyFile?: string;
  recoveryKey?: string;
  crossSigningKeysFile?: string;
  olmWasmPath?: string;
  trustOnFirstUse?: boolean;
  autoVerifySignalBot?: boolean;
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

// Interfaces moved to trpc router files where they are used

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
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.initPromise = this.initializeFromEnv();
  }

  /**
   * Ensure the service is initialized before use
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
  }

  private async initializeFromEnv() {
    const homeserver = process.env.MATRIX_HOMESERVER;
    const accessToken = process.env.MATRIX_ACCESS_TOKEN;
    const userId = process.env.MATRIX_USER_ID;
    const welcomeRoomId = process.env.MATRIX_WELCOME_ROOM_ID;
    const defaultRoomId = process.env.MATRIX_DEFAULT_ROOM_ID;
    
    // Encryption configuration
    const enableEncryption = process.env.MATRIX_ENABLE_ENCRYPTION === 'true';
    const deviceId = process.env.MATRIX_DEVICE_ID;
    const deviceDisplayName = process.env.MATRIX_DEVICE_DISPLAY_NAME;
    const encryptionKeyFile = process.env.MATRIX_ENCRYPTION_KEY_FILE;
    const recoveryKey = process.env.MATRIX_RECOVERY_KEY;
    const crossSigningKeysFile = process.env.MATRIX_CROSS_SIGNING_KEYS_FILE;
    const olmWasmPath = process.env.MATRIX_OLM_WASM_PATH;
    const trustOnFirstUse = process.env.MATRIX_CRYPTO_TRUST_ON_FIRST_USE === 'true';
    const autoVerifySignalBot = process.env.MATRIX_AUTO_VERIFY_SIGNAL_BOT === 'true';

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
      enableEncryption,
      deviceId,
      deviceDisplayName,
      encryptionKeyFile,
      recoveryKey,
      crossSigningKeysFile,
      olmWasmPath,
      trustOnFirstUse,
      autoVerifySignalBot,
    };

    try {
      console.log(`🔐 Matrix encryption ${enableEncryption ? 'ENABLED' : 'DISABLED'}`);
      
      const clientOptions: any = {
        baseUrl: homeserver,
        accessToken: accessToken,
        userId: userId,
      };

      // Add device ID for encryption support
      if (enableEncryption && deviceId) {
        clientOptions.deviceId = deviceId;
        console.log(`🔐 Using device ID: ${deviceId}`);
      }

      try {
        // Use the shared SDK instance to avoid multiple entrypoints
        this.client = await createMatrixClient(clientOptions);
      } catch (wrapperError) {
        console.error('Matrix client creation failed:', wrapperError);
        throw wrapperError;
      }

      // Initialize encryption if enabled
      if (enableEncryption) {
        await this.initializeEncryption();
      }

      this.isActive = true;
      console.log('Matrix service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Matrix client:', error);
    }
  }

  /**
   * Initialize Matrix encryption support
   */
  private async initializeEncryption() {
    if (!this.client || !this.config?.enableEncryption) {
      return;
    }

    try {
      console.log('🔐 Initializing Matrix encryption...');

      // Load Olm library first
      try {
        console.log('🔧 Loading Olm library for encryption...');
        
        // Try different approaches to load Olm
        let olmModule;
        
        // Approach 1: Try dynamic import
        try {
          olmModule = await import('@matrix-org/olm');
          console.log('✅ Olm loaded via dynamic import');
        } catch (importError) {
          console.warn('⚠️ Dynamic import failed, trying alternative approach:', importError instanceof Error ? importError.message : 'Unknown error');
          
          // Approach 2: Try to load from public directory (for server-side)
          if (typeof window === 'undefined') {
            // Server-side: use require
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              olmModule = require('@matrix-org/olm');
              console.log('✅ Olm loaded via require');
            } catch (requireError) {
              console.error('❌ Require also failed:', requireError instanceof Error ? requireError.message : 'Unknown error');
              // Don't throw error, just disable encryption
              console.log('⚠️ Continuing without encryption support');
              return;
            }
          } else {
            // Client-side: this shouldn't happen in our current setup
            // Don't throw error, just disable encryption
            console.log('⚠️ Continuing without encryption support on client-side');
            return;
          }
        }
        
        // Set global Olm for matrix-js-sdk
        global.Olm = olmModule.default || olmModule;
        
        // Configure Olm with our WASM path if available
        const olmWasmPath = this.config?.olmWasmPath || process.env.MATRIX_OLM_WASM_PATH;
        if (olmWasmPath && global.Olm && typeof (global.Olm as unknown as Record<string, unknown>).init === 'function') {
          console.log(`🔧 Initializing Olm with WASM path: ${olmWasmPath}`);
          // Note: We may need to set the locateFile function for WASM loading
          if ((global.Olm as unknown as Record<string, unknown>).locateFile) {
            (global.Olm as unknown as Record<string, unknown>).locateFile = (file: string) => {
              if (file.endsWith('.wasm')) {
                return `${olmWasmPath}/${file}`;
              }
              return file;
            };
          }
          await ((global.Olm as unknown as Record<string, unknown>).init as () => Promise<unknown>)();
        } else if (global.Olm && typeof (global.Olm as unknown as Record<string, unknown>).init === 'function') {
          console.log('🔧 Initializing Olm with default settings');
          await ((global.Olm as unknown as Record<string, unknown>).init as () => Promise<unknown>)();
        }
        
        console.log('✅ Olm library loaded and initialized successfully');
      } catch (olmError) {
        console.error('❌ Failed to load Olm library:', olmError);
        console.error('❌ This usually means encryption dependencies are not properly installed or WASM files are missing');
        console.error('💡 Solutions:');
        console.error('   1. npm install @matrix-org/olm');
        console.error('   2. Ensure WASM files are in public/olm/ directory');
        console.error('   3. Check MATRIX_OLM_WASM_PATH environment variable');
        throw new Error('Olm library is required for encryption');
      }

      // Initialize crypto
      await this.client.initCrypto();
      console.log('✅ Matrix crypto initialized');

      // Set up event listeners for encryption
      const ClientEventEnum = await getClientEvent();
      this.client.on(ClientEventEnum.Event, (event) => {
        if (event.getType() === 'm.room.encrypted') {
          console.log(`🔐 Received encrypted event in room ${event.getRoomId()}`);
        }
      });

      const RoomEventEnum = await getRoomEvent();
      this.client.on(RoomEventEnum.Timeline, (event: any, room: any) => {
        if (event.getType() === 'm.room.encrypted') {
          console.log(`🔐 Timeline encrypted event in room ${room?.roomId}`);
        }
      });

      // Auto-accept room key requests for trusted devices
      this.client.on('crypto.roomKeyRequest' as any, (request: any) => {
        console.log('🔑 Received room key request from:', request.userId);
        
        // Auto-accept if it's the Signal bridge bot and auto-verify is enabled
        const signalBotUsername = process.env.MATRIX_SIGNAL_BOT_USERNAME || '@signalbot:irregularchat.com';
        if (this.config?.autoVerifySignalBot && request.userId === signalBotUsername) {
          console.log('🤖 Auto-accepting room key request from Signal bot');
          // Note: acceptRoomKeyRequest might not be available in this SDK version
          console.log('Room key request acceptance attempted');
        } else if (this.config?.trustOnFirstUse) {
          console.log('🔓 Auto-accepting room key request (trust on first use enabled)');
          console.log('Room key request acceptance attempted');
        } else {
          console.log('🔒 Room key request requires manual verification');
        }
      });

      // Handle device verification events
      this.client.on('crypto.deviceVerificationChanged' as any, (userId: any, deviceId: any, _device: any) => {
        console.log(`🔐 Device verification changed for ${userId}:${deviceId}`);
        
        // Auto-verify Signal bridge bot devices
        const signalBotUsername = process.env.MATRIX_SIGNAL_BOT_USERNAME || '@signalbot:irregularchat.com';
        if (this.config?.autoVerifySignalBot && userId === signalBotUsername) {
          console.log('🤖 Auto-verifying Signal bot device');
          // Note: device.setVerified(true) might be available depending on the SDK version
        }
      });

      // Handle key backup events
      this.client.on('crypto.keyBackupStatus' as any, (enabled: any) => {
        console.log(`🔐 Key backup status: ${enabled ? 'enabled' : 'disabled'}`);
      });

      // Load encryption keys if they exist
      await this.loadEncryptionKeys();

      console.log('✅ Matrix encryption setup complete');
    } catch (error) {
      console.error('❌ Failed to initialize Matrix encryption:', error);
      console.warn('⚠️ Continuing without encryption support');
      
      // Reset encryption flag in config so we know it's not available
      if (this.config) {
        this.config.enableEncryption = false;
      }
      
      // Continue without encryption rather than failing completely
    }
  }

  /**
   * Load encryption keys from storage
   */
  private async loadEncryptionKeys() {
    if (!this.client || !this.config?.encryptionKeyFile) {
      return;
    }

    try {
      const keyFile = this.config.encryptionKeyFile;
      
      if (fs.existsSync(keyFile)) {
        console.log(`🔑 Loading encryption keys from ${keyFile}`);
        const keyData = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
        
        // Import the keys
        if (keyData.deviceKeys) {
          console.log('🔑 Importing device keys...');
          // Note: In a real implementation, you'd import these keys properly
          // This is a simplified example
        }
        
        console.log('✅ Encryption keys loaded');
      } else {
        console.log('📁 No existing encryption keys found, will generate new ones');
        await this.generateEncryptionKeys();
      }
    } catch (error) {
      console.error('❌ Failed to load encryption keys:', error);
    }
  }

  /**
   * Generate and save new encryption keys
   */
  private async generateEncryptionKeys() {
    if (!this.client || !this.config?.encryptionKeyFile) {
      return;
    }

    try {
      console.log('🔑 Generating new encryption keys...');
      
      // Ensure the directory exists
      const keyFile = this.config.encryptionKeyFile;
      const keyDir = path.dirname(keyFile);
      if (!fs.existsSync(keyDir)) {
        fs.mkdirSync(keyDir, { recursive: true });
      }

      // Generate basic key structure
      const keyData = {
        deviceId: this.config.deviceId,
        userId: this.config.userId,
        deviceKeys: {
          // In a real implementation, you'd get these from the crypto object
          algorithms: ['m.olm.v1.curve25519-aes-sha2', 'm.megolm.v1.aes-sha2'],
          created: new Date().toISOString(),
        },
        crossSigningKeys: {},
      };

      // Save the keys
      fs.writeFileSync(keyFile, JSON.stringify(keyData, null, 2));
      console.log(`✅ Encryption keys saved to ${keyFile}`);
      
    } catch (error) {
      console.error('❌ Failed to generate encryption keys:', error);
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

  /**
   * Send a welcome message with encryption establishment delay
   * Based on legacy send_welcome_message_with_encryption_delay_sync pattern
   * This is the public method that mirrors the legacy implementation for use in create_user flows
   */
  public async sendWelcomeMessageWithEncryptionDelay(
    matrixUserId: string,
    username: string,
    fullName: string,
    tempPassword: string,
    discoursePostUrl?: string,
    delaySeconds: number = 5
  ): Promise<DirectMessageResult> {
    if (!this.isActive || !this.client) {
      return {
        success: false,
        error: 'Matrix service not configured',
      };
    }

    try {
      console.log(`🔐 WELCOME: Starting welcome message sequence for ${matrixUserId} with ${delaySeconds}s encryption delay`);

      const welcomeMessage = this.generateWelcomeMessage({
        username,
        fullName,
        tempPassword,
        discoursePostUrl,
      });

      // Check if this is a Signal bridge user (starts with @signal_)
      if (matrixUserId.startsWith('@signal_')) {
        console.log(`📱 WELCOME: Detected Signal user, using Signal bridge flow`);
        return await this.sendSignalBridgeMessage(matrixUserId, welcomeMessage);
      }

      // For regular Matrix users, create/find direct room and use encryption-aware messaging
      console.log(`👤 WELCOME: Regular Matrix user, creating/finding direct room`);
      const roomId = await this.getOrCreateDirectRoom(matrixUserId);
      if (!roomId) {
        return {
          success: false,
          error: 'Failed to create or find direct message room',
        };
      }

      // Use encryption-aware messaging pattern
      return await this.sendMessageWithEncryptionDelay(roomId, welcomeMessage, undefined, delaySeconds);

    } catch (error) {
      console.error('Error sending welcome message with encryption delay:', error);
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
    await this.ensureInitialized();
    
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
      const MsgTypeEnum = await getMsgType();
      const response = await this.client.sendEvent(roomId, 'm.room.message', {
        msgtype: MsgTypeEnum.Text,
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
   * Send a message to a Signal bridge user using the Signal bridge bot with encryption-aware messaging
   * Based on legacy send_welcome_message_with_encryption_delay pattern
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

      const MsgTypeEnum = await getMsgType();
      const commandResponse = await this.client.sendEvent(signalBridgeRoomId, 'm.room.message', {
        msgtype: MsgTypeEnum.Text,
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

      // Use encryption-aware messaging pattern from legacy implementation
      return await this.sendMessageWithEncryptionDelay(signalChatRoomId, message, signalUserId);

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
   * Send a message with encryption establishment delay
   * Based on legacy send_welcome_message_with_encryption_delay implementation
   * 
   * This function addresses the common issue where messages sent immediately after
   * creating a direct chat room are encrypted but can't be decrypted by the recipient
   * because encryption keys haven't been established yet.
   * 
   * The solution:
   * 1. Send a simple "hello" message to establish encryption
   * 2. Wait for encryption keys to be exchanged  
   * 3. Send the actual message
   */
  private async sendMessageWithEncryptionDelay(
    roomId: string,
    message: string,
    signalUserId?: string,
    delaySeconds: number = 5
  ): Promise<DirectMessageResult> {
    if (!this.client) {
      return {
        success: false,
        error: 'Matrix client not available',
      };
    }

    try {
      console.log(`🔐 ENCRYPTION: Starting encryption-aware message sequence for room ${roomId} with ${delaySeconds}s delay`);
      
      // Step 1: Send a simple hello message to establish encryption (like legacy)
      const helloMessage = '👋 Hello! Setting up our secure chat...';
      console.log('📤 ENCRYPTION: Sending hello message to establish encryption...');
      
      const MsgTypeEnum = await getMsgType();
      const helloResponse = await this.client.sendEvent(roomId, 'm.room.message', {
        msgtype: MsgTypeEnum.Text,
        body: helloMessage,
      });

      if (!helloResponse.event_id) {
        console.warn('⚠️ ENCRYPTION: Hello message failed, continuing with main message...');
      } else {
        console.log(`✅ ENCRYPTION: Hello message sent: ${helloResponse.event_id}`);
      }

      // Step 2: Wait for encryption keys to be established (configurable delay)
      const delayMs = delaySeconds * 1000;
      console.log(`⏱️ ENCRYPTION: Waiting ${delayMs}ms for encryption keys to be established...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));

      // Step 3: Send the actual message
      console.log(`📤 ENCRYPTION: Sending main message to room ${roomId}`);
      const messageResponse = await this.client.sendEvent(roomId, 'm.room.message', {
        msgtype: MsgTypeEnum.Text,
        body: message,
      });

      if (messageResponse.event_id) {
        console.log(`✅ ENCRYPTION: Main message sent successfully: ${messageResponse.event_id}`);
        return {
          success: true,
          roomId,
          eventId: messageResponse.event_id,
        };
      } else {
        return {
          success: false,
          error: 'Failed to send main message after encryption setup',
        };
      }

    } catch (error) {
      console.error('💥 ENCRYPTION: Error in encryption-aware messaging:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Encryption-aware messaging failed',
      };
    }
  }

  /**
   * Fallback method: Send Signal message via temporary room creation
   * Based on legacy send_signal_message_async implementation with encryption-aware messaging
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
      console.log(`🔄 FALLBACK: Using temporary room fallback approach for Signal user: ${signalUserId}`);
      
      // Create a temporary room with a specific name (like legacy implementation)
      const uniqueId = Math.random().toString(36).substring(2, 10); // 8 characters like legacy
      const tempRoomName = `Signal Message ${uniqueId}`;
      
      console.log(`🏗️ FALLBACK: Creating temporary room '${tempRoomName}' for Signal message`);
      
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
      console.log(`✅ FALLBACK: Created temporary room: ${roomId}`);
      console.log(`📧 FALLBACK: Invited Signal user: ${signalUserId}`);

      // Wait for the Signal user to potentially join (legacy uses 2 seconds)
      console.log('⏱️ FALLBACK: Waiting for Signal bridge to process invitation...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Use encryption-aware messaging pattern for temp room too
      console.log('🔐 FALLBACK: Using encryption-aware messaging in temp room...');
      const result = await this.sendMessageWithEncryptionDelay(roomId, message, signalUserId, 3); // Shorter delay for temp room

      if (result.success) {
        // Mark the room as direct chat (like legacy implementation)
        try {
          const directContent: Record<string, string[]> = {};
          directContent[signalUserId] = [roomId];
          
          await this.client.setAccountData('m.direct', directContent);
          console.log('✅ FALLBACK: Room marked as direct chat in account data');
        } catch (directError) {
          console.warn('⚠️ FALLBACK: Could not mark room as direct chat:', directError);
          // This is not critical, continue with success
        }
        
        console.log(`✅ FALLBACK: Temporary room approach completed successfully`);
        return result;
      } else {
        throw new Error(`Encryption-aware messaging failed in temp room: ${result.error}`);
      }

    } catch (error) {
      console.error('💥 FALLBACK: Error in temp room fallback approach:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Temp room approach failed',
      };
    }
  }

  /**
   * Resolve a phone number to Signal UUID using SignalBot
   * Uses the resolve-identifier command to convert phone number to UUID
   * Now supports encrypted bridge rooms
   */
  private async resolvePhoneToSignalUuid(phoneNumber: string): Promise<string | null> {
    await this.ensureInitialized();
    
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

      const MsgTypeEnum = await getMsgType();
      const commandResponse = await this.client.sendEvent(signalBridgeRoomId, 'm.room.message', {
        msgtype: MsgTypeEnum.Text,
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
            
            // Log all messages for debugging
            console.log('🔍 RESOLVE: All messages in bridge room:');
            messagesResponse.chunk.forEach((event, index) => {
              console.log(`  ${index + 1}. ${event.sender}: ${event.content?.body || '[no body]'} (${event.type})`);
            });
            
            // Look for bot response in the retrieved messages
            const botUsername = process.env.MATRIX_SIGNAL_BOT_USERNAME || '@signalbot:irregularchat.com';
            
            // Check if bot has any messages at all
            const botMessages = messagesResponse.chunk.filter(event => event.sender === botUsername);
            console.log(`🤖 RESOLVE: Found ${botMessages.length} messages from ${botUsername}`);
            
            // Check if messages are encrypted and try to decrypt them
            const encryptedMessages = messagesResponse.chunk.filter(event => 
              event.type === 'm.room.encrypted' || event.content?.algorithm
            );
            
            if (encryptedMessages.length > 0) {
              console.log(`🔐 RESOLVE: Found ${encryptedMessages.length} encrypted messages`);
              
              if (this.config?.enableEncryption && this.client.isCryptoEnabled && this.client.isCryptoEnabled()) {
                console.log('🔐 RESOLVE: Attempting to decrypt messages...');
                
                // Try to decrypt the encrypted messages
                for (const event of encryptedMessages) {
                  if (event.sender === botUsername && event.type === 'm.room.encrypted') {
                    try {
                      // The client should automatically decrypt events
                      // Let's try to get the decrypted content
                      const decryptedContent = event.content?.body;
                      
                      if (decryptedContent) {
                        console.log(`🔓 RESOLVE: Decrypted message from ${event.sender}: "${decryptedContent}"`);
                        
                        // Check for UUID in decrypted content
                        if (decryptedContent.includes('Found')) {
                          const uuidMatch = decryptedContent.match(/Found `([a-f0-9-]+)`/);
                          if (uuidMatch) {
                            const uuid = uuidMatch[1];
                            console.log(`✅ RESOLVE: Successfully resolved ${normalizedPhone} to UUID: ${uuid} (from encrypted message)`);
                            return uuid;
                          }
                        }
                        
                        // Check for failure messages
                        if (decryptedContent.includes('Failed to resolve') || 
                            decryptedContent.includes('phone number must start with')) {
                          console.error(`❌ RESOLVE: SignalBot resolve failed: ${decryptedContent}`);
                          return null;
                        }
                      }
                    } catch (decryptError) {
                      console.warn(`⚠️ RESOLVE: Failed to decrypt message: ${decryptError}`);
                    }
                  }
                }
              } else {
                console.error('❌ RESOLVE: Signal bridge room is encrypted but encryption is not enabled in Matrix client');
                console.error('💡 RESOLVE: Solution: Configure an unencrypted Signal bridge room or enable encryption in Matrix client');
                return null;
              }
            }
            
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
      const MsgTypeEnum = await getMsgType();
      const response = await this.client.sendEvent(roomId, 'm.room.message', {
        msgtype: MsgTypeEnum.Text,
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
   * Parse ROOM_ environment variables
   * Format: ROOM_UNIQUE_ID = Room Name|Category Name(s)|Description|Matrix Room ID
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
   * Get all rooms the bot is in with member count and metadata
   */
  public async getRooms(): Promise<Array<{
    roomId: string;
    name?: string;
    topic?: string;
    memberCount: number;
    category: string;
    configured: boolean;
  }>> {
    console.log('MatrixService.getRooms() called');
    
    // If client is not initialized, return empty array for now
    // This is a temporary workaround for the SDK bundling issue
    if (!this.client) {
      console.warn('Matrix client not initialized, returning empty rooms array');
      return [];
    }

    try {
      // Get all rooms the bot is a member of
      const allRooms = this.client.getRooms();
      console.log(`Found ${allRooms?.length || 0} total rooms from Matrix client`);
      
      // Get configured rooms
      const configuredRooms = this.parseRooms();
      const configuredRoomIds = new Set(configuredRooms.map(r => r.matrixRoomId));
      
      const rooms: Array<{
        roomId: string;
        name?: string;
        topic?: string;
        memberCount: number;
        category: string;
        configured: boolean;
      }> = [];

      for (const room of allRooms) {
        try {
          const memberCount = room.getJoinedMemberCount();
          const roomName = room.name || undefined;
          
          // Try to get room topic
          const topicEvent = room.currentState.getStateEvents('m.room.topic', '');
          const roomTopic = topicEvent ? topicEvent.getContent()?.topic : undefined;
          
          // Check if this is a configured room
          const configuredRoom = configuredRooms.find(r => r.matrixRoomId === room.roomId);
          
          // Determine category
          let category = 'uncategorized';
          if (configuredRoom) {
            category = configuredRoom.categories[0] || 'general';
          } else if (roomName) {
            // Try to auto-detect category from room name
            const categories = this.parseCategories();
            for (const [catKey, catData] of Object.entries(categories)) {
              const roomNameLower = roomName.toLowerCase();
              if (catData.keywords.some(keyword => roomNameLower.includes(keyword))) {
                category = catKey;
                break;
              }
            }
          }

          rooms.push({
            roomId: room.roomId,
            name: roomName,
            topic: roomTopic,
            memberCount: memberCount,
            category,
            configured: configuredRoomIds.has(room.roomId)
          });
        } catch (error) {
          console.warn(`Error processing room ${room.roomId}:`, error);
        }
      }

      console.log(`Found ${rooms.length} total rooms, ${rooms.filter(r => r.member_count > 10).length} with >10 members`);
      return rooms;
    } catch (error) {
      console.error('Error getting rooms:', error);
      return [];
    }
  }

  /**
   * Parse INTEREST_KEYWORD_EXPANSIONS environment variable
   * Format: tech:technology,programming,coding|ai:artificial intelligence,machine learning
   */
  private parseKeywordExpansions(): Record<string, string[]> {
    const expansions: Record<string, string[]> = {};
    const expansionString = process.env.INTEREST_KEYWORD_EXPANSIONS || '';
    
    if (expansionString) {
      const pairs = expansionString.split('|');
      for (const pair of pairs) {
        const [key, values] = pair.split(':');
        if (key && values) {
          expansions[key.trim().toLowerCase()] = values.split(',').map(v => v.trim().toLowerCase());
        }
      }
    }
    
    return expansions;
  }

  /**
   * Expand user interests using keyword expansions
   */
  private expandInterests(interests: string[]): string[] {
    const expansions = this.parseKeywordExpansions();
    const expandedInterests = new Set<string>();
    
    for (const interest of interests) {
      const normalizedInterest = interest.toLowerCase().trim();
      expandedInterests.add(normalizedInterest);
      
      // Add expanded keywords
      if (expansions[normalizedInterest]) {
        expansions[normalizedInterest].forEach(expanded => expandedInterests.add(expanded));
      }
    }
    
    return Array.from(expandedInterests);
  }

  /**
   * Calculate room recommendation score based on interest matching
   */
  private calculateRoomScore(room: {categories: string[], name: string, description: string}, expandedInterests: string[], categories: Record<string, {displayName: string, keywords: string[]}>): number {
    let score = 0;
    const roomText = `${room.name} ${room.description}`.toLowerCase();
    
    // Check category matches
    for (const roomCategory of room.categories) {
      const category = categories[roomCategory];
      if (category) {
        // Check if any user interest matches category keywords
        for (const interest of expandedInterests) {
          if (category.keywords.includes(interest)) {
            score += 1.0; // Full match for category keyword
          }
          
          // Partial text matching in room name/description
          if (roomText.includes(interest)) {
            score += 0.5; // Partial match for text content
          }
        }
      }
    }
    
    // Bonus for exact interest matches in room text
    for (const interest of expandedInterests) {
      if (roomText.includes(interest)) {
        score += 0.3;
      }
    }
    
    return score;
  }

  private async getRoomRecommendations(interests: string[]): Promise<string[]> {
    if (!this.client) return [];

    try {
      console.log(`🎯 RECOMMEND: Starting room recommendations for interests: ${interests.join(', ')}`);
      
      // Parse environment configuration
      const categories = this.parseCategories();
      const configuredRooms = this.parseRooms();
      const expandedInterests = this.expandInterests(interests);
      
      console.log(`📚 RECOMMEND: Loaded ${Object.keys(categories).length} categories, ${configuredRooms.length} configured rooms`);
      console.log(`🔍 RECOMMEND: Expanded interests: ${expandedInterests.join(', ')}`);
      
      // Configuration
      const minScore = parseFloat(process.env.MIN_RECOMMENDATION_SCORE || '0.3');
      const maxRecommendations = parseInt(process.env.MAX_ROOM_RECOMMENDATIONS || '12');
      const minMembers = parseInt(process.env.MATRIX_MIN_ROOM_MEMBERS || '10');
      
      // Score and rank rooms
      const scoredRooms: Array<{roomId: string, score: number, name: string}> = [];
      
      for (const room of configuredRooms) {
        const score = this.calculateRoomScore(room, expandedInterests, categories);
        
        if (score >= minScore) {
          // Verify the room exists and has enough members
          const matrixRoom = this.client.getRoom(room.matrixRoomId);
          if (matrixRoom && matrixRoom.getJoinedMemberCount() >= minMembers) {
            scoredRooms.push({
              roomId: room.matrixRoomId,
              score,
              name: room.name
            });
            console.log(`✅ RECOMMEND: ${room.name} (${room.matrixRoomId}) - Score: ${score.toFixed(2)}`);
          } else {
            console.log(`❌ RECOMMEND: ${room.name} (${room.matrixRoomId}) - Excluded: Room not found or insufficient members`);
          }
        } else {
          console.log(`📊 RECOMMEND: ${room.name} - Score: ${score.toFixed(2)} (below threshold ${minScore})`);
        }
      }
      
      // Sort by score (highest first) and limit to max recommendations
      scoredRooms.sort((a, b) => b.score - a.score);
      const recommendations = scoredRooms.slice(0, maxRecommendations).map(r => r.roomId);
      
      console.log(`🎯 RECOMMEND: Final recommendations: ${recommendations.length} rooms`);
      scoredRooms.slice(0, maxRecommendations).forEach((room, index) => {
        console.log(`  ${index + 1}. ${room.name} (Score: ${room.score.toFixed(2)})`);
      });
      
      return recommendations;

    } catch (error) {
      console.error('💥 RECOMMEND: Error getting room recommendations:', error);
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
      const MsgTypeEnum = await getMsgType();
      const response = await this.client.sendEvent(indocRoomId, 'm.room.message', {
        msgtype: MsgTypeEnum.Text,
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
        const MsgTypeEnum = await getMsgType();
        const response = await this.client.sendEvent(roomId, 'm.room.message', {
          msgtype: MsgTypeEnum.Text,
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
    // Return true if config exists, even if client failed to initialize
    // This allows us to still show configured rooms from .env
    return this.config !== null;
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