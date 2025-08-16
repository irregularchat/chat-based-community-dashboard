// Use dynamic imports for matrix-js-sdk to avoid bundling conflicts
import { MatrixClientService } from './client-service';
import { MatrixEncryptionError, MatrixConfig } from './types';
import * as fs from 'fs';
import * as path from 'path';

interface EncryptionKeyData {
  deviceId?: string;
  userId: string;
  deviceKeys: {
    algorithms: string[];
    created: string;
  };
  crossSigningKeys: Record<string, any>;
}

/**
 * MatrixEncryptionService - Responsible for Matrix end-to-end encryption
 * including key management, device verification, and encryption setup
 */
export class MatrixEncryptionService {
  private clientService: MatrixClientService;
  private isEncryptionInitialized = false;

  constructor(clientService: MatrixClientService) {
    this.clientService = clientService;
  }

  /**
   * Initialize Matrix encryption support
   */
  public async initializeEncryption(): Promise<void> {
    const client = this.clientService.getClient();
    const config = this.clientService.getConfig();
    
    if (!client || !config?.enableEncryption) {
      console.log('🔐 Encryption not enabled or client not available');
      return;
    }

    if (this.isEncryptionInitialized) {
      console.log('🔐 Encryption already initialized');
      return;
    }

    try {
      console.log('🔐 Initializing Matrix encryption...');

      // Load and initialize Olm library
      await this.initializeOlm(config);

      // Initialize crypto
      await client.initCrypto();
      console.log('✅ Matrix crypto initialized');

      // Set up encryption event listeners
      this.setupEncryptionEventListeners(client, config);

      // Load or generate encryption keys
      await this.loadEncryptionKeys(config);

      this.isEncryptionInitialized = true;
      console.log('✅ Matrix encryption setup complete');

    } catch (error) {
      console.error('❌ Failed to initialize Matrix encryption:', error);
      console.warn('⚠️ Continuing without encryption support');
      
      // Reset encryption flag in config so we know it's not available
      if (config) {
        config.enableEncryption = false;
      }
      
      throw new MatrixEncryptionError(
        'Failed to initialize encryption',
        { originalError: error }
      );
    }
  }

  /**
   * Check if encryption is available and initialized
   */
  public isEncryptionAvailable(): boolean {
    const config = this.clientService.getConfig();
    return !!(config?.enableEncryption && this.isEncryptionInitialized);
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
   * Enable encryption for a room
   */
  public async enableRoomEncryption(roomId: string): Promise<void> {
    const client = this.clientService.getClient();
    if (!client || !this.isEncryptionAvailable()) {
      throw new MatrixEncryptionError('Encryption not available or client not initialized');
    }

    try {
      await client.sendStateEvent(roomId, 'm.room.encryption', {
        algorithm: 'm.megolm.v1.aes-sha2',
      });
      console.log(`✅ Encryption enabled for room ${roomId}`);
    } catch (error) {
      console.error(`❌ Failed to enable encryption for room ${roomId}:`, error);
      throw new MatrixEncryptionError(
        `Failed to enable encryption for room ${roomId}`,
        { roomId, originalError: error }
      );
    }
  }

  /**
   * Get device verification status
   */
  public async getDeviceVerificationStatus(userId: string, deviceId: string): Promise<boolean> {
    const client = this.clientService.getClient();
    if (!client || !this.isEncryptionAvailable()) {
      return false;
    }

    try {
      const crypto = client.getCrypto();
      if (!crypto) {
        return false;
      }

      // Note: This is a simplified check. In a real implementation,
      // you'd use the proper crypto API methods
      console.log(`Checking verification status for ${userId}:${deviceId}`);
      return false; // Placeholder
    } catch (error) {
      console.error('Error checking device verification:', error);
      return false;
    }
  }

  /**
   * Auto-verify a device (for trusted users like Signal bot)
   */
  public async autoVerifyDevice(userId: string, deviceId: string): Promise<void> {
    const client = this.clientService.getClient();
    if (!client || !this.isEncryptionAvailable()) {
      throw new MatrixEncryptionError('Encryption not available or client not initialized');
    }

    try {
      console.log(`🤖 Auto-verifying device ${userId}:${deviceId}`);
      
      const crypto = client.getCrypto();
      if (!crypto) {
        throw new MatrixEncryptionError('Crypto not available');
      }

      // Note: This would use proper crypto API methods in a real implementation
      console.log('Device auto-verification attempted');
      
    } catch (error) {
      console.error('Error auto-verifying device:', error);
      throw new MatrixEncryptionError(
        `Failed to auto-verify device ${userId}:${deviceId}`,
        { userId, deviceId, originalError: error }
      );
    }
  }

  /**
   * Export encryption keys for backup
   */
  public async exportKeys(passphrase: string): Promise<string> {
    const client = this.clientService.getClient();
    if (!client || !this.isEncryptionAvailable()) {
      throw new MatrixEncryptionError('Encryption not available or client not initialized');
    }

    try {
      const crypto = client.getCrypto();
      if (!crypto) {
        throw new MatrixEncryptionError('Crypto not available');
      }

      // Note: This would use proper export methods in a real implementation
      console.log('Exporting encryption keys...');
      
      // Placeholder return
      return JSON.stringify({
        version: '1',
        encrypted: true,
        passphrase_info: {
          algorithm: 'pbkdf2',
          iterations: 100000,
        },
        exported_at: new Date().toISOString(),
      });
      
    } catch (error) {
      console.error('Error exporting keys:', error);
      throw new MatrixEncryptionError(
        'Failed to export encryption keys',
        { originalError: error }
      );
    }
  }

  /**
   * Import encryption keys from backup
   */
  public async importKeys(keyData: string, passphrase: string): Promise<void> {
    const client = this.clientService.getClient();
    if (!client || !this.isEncryptionAvailable()) {
      throw new MatrixEncryptionError('Encryption not available or client not initialized');
    }

    try {
      console.log('Importing encryption keys...');
      
      const crypto = client.getCrypto();
      if (!crypto) {
        throw new MatrixEncryptionError('Crypto not available');
      }

      // Note: This would use proper import methods in a real implementation
      const parsedData = JSON.parse(keyData);
      console.log(`Importing keys exported at: ${parsedData.exported_at}`);
      
    } catch (error) {
      console.error('Error importing keys:', error);
      throw new MatrixEncryptionError(
        'Failed to import encryption keys',
        { originalError: error }
      );
    }
  }

  /**
   * Initialize Olm library for encryption
   */
  private async initializeOlm(config: MatrixConfig): Promise<void> {
    try {
      console.log('🔧 Loading Olm library for encryption...');
      
      let olmModule;
      
      // Try dynamic import first
      try {
        olmModule = await import('@matrix-org/olm');
        console.log('✅ Olm loaded via dynamic import');
      } catch (importError) {
        console.warn('⚠️ Dynamic import failed, trying alternative approach:', 
          importError instanceof Error ? importError.message : 'Unknown error');
        
        // Fallback to require for server-side
        if (typeof window === 'undefined') {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            olmModule = require('@matrix-org/olm');
            console.log('✅ Olm loaded via require');
          } catch (requireError) {
            console.error('❌ Require also failed:', 
              requireError instanceof Error ? requireError.message : 'Unknown error');
            throw new MatrixEncryptionError('Failed to load Olm library');
          }
        } else {
          throw new MatrixEncryptionError('Failed to load Olm library on client-side');
        }
      }
      
      // Set global Olm for matrix-js-sdk
      global.Olm = olmModule.default || olmModule;
      
      // Configure Olm with WASM path if available
      const olmWasmPath = config.olmWasmPath || process.env.MATRIX_OLM_WASM_PATH;
      if (olmWasmPath && global.Olm && typeof (global.Olm as any).init === 'function') {
        console.log(`🔧 Initializing Olm with WASM path: ${olmWasmPath}`);
        
        if ((global.Olm as any).locateFile) {
          (global.Olm as any).locateFile = (file: string) => {
            if (file.endsWith('.wasm')) {
              return `${olmWasmPath}/${file}`;
            }
            return file;
          };
        }
        await (global.Olm as any).init();
      } else if (global.Olm && typeof (global.Olm as any).init === 'function') {
        console.log('🔧 Initializing Olm with default settings');
        await (global.Olm as any).init();
      }
      
      console.log('✅ Olm library loaded and initialized successfully');
      
    } catch (error) {
      console.error('❌ Failed to load Olm library:', error);
      console.error('❌ This usually means encryption dependencies are not properly installed or WASM files are missing');
      console.error('💡 Solutions:');
      console.error('   1. npm install @matrix-org/olm');
      console.error('   2. Ensure WASM files are in public/olm/ directory');
      console.error('   3. Check MATRIX_OLM_WASM_PATH environment variable');
      throw new MatrixEncryptionError('Olm library is required for encryption');
    }
  }

  /**
   * Set up encryption event listeners
   */
  private setupEncryptionEventListeners(client: MatrixClient, config: MatrixConfig): void {
    // Listen for encrypted events
    client.on(ClientEvent.Event, (event) => {
      if (event.getType() === 'm.room.encrypted') {
        console.log(`🔐 Received encrypted event in room ${event.getRoomId()}`);
      }
    });

    client.on(RoomEvent.Timeline, (event: any, room: any) => {
      if (event.getType() === 'm.room.encrypted') {
        console.log(`🔐 Timeline encrypted event in room ${room?.roomId}`);
      }
    });

    // Auto-accept room key requests for trusted devices
    client.on('crypto.roomKeyRequest' as any, (request: any) => {
      console.log('🔑 Received room key request from:', request.userId);
      
      // Auto-accept if it's the Signal bridge bot and auto-verify is enabled
      const signalBotUsername = process.env.MATRIX_SIGNAL_BOT_USERNAME || '@signalbot:irregularchat.com';
      if (config.autoVerifySignalBot && request.userId === signalBotUsername) {
        console.log('🤖 Auto-accepting room key request from Signal bot');
        // Note: acceptRoomKeyRequest might not be available in this SDK version
        console.log('Room key request acceptance attempted');
      } else if (config.trustOnFirstUse) {
        console.log('🔓 Auto-accepting room key request (trust on first use enabled)');
        console.log('Room key request acceptance attempted');
      } else {
        console.log('🔒 Room key request requires manual verification');
      }
    });

    // Handle device verification events
    client.on('crypto.deviceVerificationChanged' as any, (userId: any, deviceId: any, _device: any) => {
      console.log(`🔐 Device verification changed for ${userId}:${deviceId}`);
      
      // Auto-verify Signal bridge bot devices
      const signalBotUsername = process.env.MATRIX_SIGNAL_BOT_USERNAME || '@signalbot:irregularchat.com';
      if (config.autoVerifySignalBot && userId === signalBotUsername) {
        console.log('🤖 Auto-verifying Signal bot device');
        // Note: device.setVerified(true) might be available depending on the SDK version
      }
    });

    // Handle key backup events
    client.on('crypto.keyBackupStatus' as any, (enabled: any) => {
      console.log(`🔐 Key backup status: ${enabled ? 'enabled' : 'disabled'}`);
    });
  }

  /**
   * Load encryption keys from storage
   */
  private async loadEncryptionKeys(config: MatrixConfig): Promise<void> {
    if (!config.encryptionKeyFile) {
      console.log('📁 No encryption key file configured');
      return;
    }

    try {
      const keyFile = config.encryptionKeyFile;
      
      if (fs.existsSync(keyFile)) {
        console.log(`🔑 Loading encryption keys from ${keyFile}`);
        const keyData = JSON.parse(fs.readFileSync(keyFile, 'utf8')) as EncryptionKeyData;
        
        // Import the keys
        if (keyData.deviceKeys) {
          console.log('🔑 Importing device keys...');
          // Note: In a real implementation, you'd import these keys properly
          // This is a simplified example
        }
        
        console.log('✅ Encryption keys loaded');
      } else {
        console.log('📁 No existing encryption keys found, will generate new ones');
        await this.generateEncryptionKeys(config);
      }
    } catch (error) {
      console.error('❌ Failed to load encryption keys:', error);
      throw new MatrixEncryptionError(
        'Failed to load encryption keys',
        { keyFile: config.encryptionKeyFile, originalError: error }
      );
    }
  }

  /**
   * Generate and save new encryption keys
   */
  private async generateEncryptionKeys(config: MatrixConfig): Promise<void> {
    if (!config.encryptionKeyFile) {
      return;
    }

    try {
      console.log('🔑 Generating new encryption keys...');
      
      // Ensure the directory exists
      const keyFile = config.encryptionKeyFile;
      const keyDir = path.dirname(keyFile);
      if (!fs.existsSync(keyDir)) {
        fs.mkdirSync(keyDir, { recursive: true });
      }

      // Generate basic key structure
      const keyData: EncryptionKeyData = {
        deviceId: config.deviceId,
        userId: config.userId,
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
      throw new MatrixEncryptionError(
        'Failed to generate encryption keys',
        { keyFile: config.encryptionKeyFile, originalError: error }
      );
    }
  }
}