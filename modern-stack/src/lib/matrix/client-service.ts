import { MatrixConfig, MatrixConnectionError } from './types';

/**
 * MatrixClientService - Responsible for Matrix client initialization, 
 * authentication, and connection management
 */
export class MatrixClientService {
  private config: MatrixConfig | null = null;
  private client: any | null = null; // Use any to avoid static import
  private isInitialized = false;

  /**
   * Initialize the Matrix client service with configuration
   */
  public async initialize(config?: MatrixConfig): Promise<void> {
    try {
      if (config) {
        this.config = config;
      } else {
        await this.initializeFromEnv();
      }

      if (!this.config) {
        throw new MatrixConnectionError('Matrix configuration not provided');
      }

      await this.createClient();
      this.isInitialized = true;
      
      console.log('Matrix client service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Matrix client service:', error);
      throw new MatrixConnectionError(
        'Failed to initialize Matrix client service',
        { originalError: error }
      );
    }
  }

  /**
   * Initialize configuration from environment variables
   */
  private async initializeFromEnv(): Promise<void> {
    const homeserver = process.env.MATRIX_HOMESERVER;
    const accessToken = process.env.MATRIX_ACCESS_TOKEN;
    const userId = process.env.MATRIX_USER_ID;

    if (!homeserver || !accessToken || !userId) {
      throw new MatrixConnectionError(
        'Missing required Matrix environment variables: MATRIX_HOMESERVER, MATRIX_ACCESS_TOKEN, MATRIX_USER_ID'
      );
    }

    this.config = {
      homeserver,
      accessToken,
      userId,
      welcomeRoomId: process.env.MATRIX_WELCOME_ROOM_ID,
      defaultRoomId: process.env.MATRIX_DEFAULT_ROOM_ID,
      enableEncryption: process.env.MATRIX_ENABLE_ENCRYPTION === 'true',
      deviceId: process.env.MATRIX_DEVICE_ID,
      deviceDisplayName: process.env.MATRIX_DEVICE_DISPLAY_NAME || 'Community Dashboard Bot',
      encryptionKeyFile: process.env.MATRIX_ENCRYPTION_KEY_FILE,
      recoveryKey: process.env.MATRIX_RECOVERY_KEY,
      crossSigningKeysFile: process.env.MATRIX_CROSS_SIGNING_KEYS_FILE,
      olmWasmPath: process.env.MATRIX_OLM_WASM_PATH || '/olm/olm.wasm',
      trustOnFirstUse: process.env.MATRIX_TRUST_ON_FIRST_USE === 'true',
      autoVerifySignalBot: process.env.MATRIX_AUTO_VERIFY_SIGNAL_BOT === 'true',
    };
  }

  /**
   * Create and configure the Matrix client
   */
  private async createClient(): Promise<void> {
    if (!this.config) {
      throw new MatrixConnectionError('Configuration not initialized');
    }

    try {
      // Use shared SDK instance to avoid "Multiple matrix-js-sdk entrypoints detected!" error
      const { createMatrixClient } = await import('./sdk-instance');
      
      this.client = await createMatrixClient({
        baseUrl: this.config.homeserver,
        accessToken: this.config.accessToken,
        userId: this.config.userId,
        deviceId: this.config.deviceId,
        timelineSupport: true,
        // Remove unstableClientRelationAggregation as it's not available in current SDK
      });

      // Set device display name if provided
      if (this.config.deviceDisplayName && this.client) {
        try {
          await this.client.setDisplayName(this.config.deviceDisplayName);
        } catch (error) {
          console.warn('Failed to set device display name:', error);
        }
      }

      console.log('Matrix client created successfully');
    } catch (error) {
      console.error('Failed to create Matrix client:', error);
      throw new MatrixConnectionError(
        'Failed to create Matrix client',
        { homeserver: this.config.homeserver, userId: this.config.userId }
      );
    }
  }

  /**
   * Start the Matrix client and begin syncing
   */
  public async startClient(): Promise<void> {
    if (!this.client) {
      throw new MatrixConnectionError('Client not initialized');
    }

    try {
      await this.client.startClient({ initialSyncLimit: 10 });
      console.log('Matrix client started successfully');
    } catch (error) {
      console.error('Failed to start Matrix client:', error);
      throw new MatrixConnectionError('Failed to start Matrix client', { originalError: error });
    }
  }

  /**
   * Stop the Matrix client
   */
  public async stopClient(): Promise<void> {
    if (this.client) {
      this.client.stopClient();
      console.log('Matrix client stopped');
    }
  }

  /**
   * Ensure the client is initialized before operations
   */
  public async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Check if the service is configured and ready
   */
  public isConfigured(): boolean {
    // Check environment variables directly to follow lessons learned pattern
    const homeserver = process.env.MATRIX_HOMESERVER;
    const accessToken = process.env.MATRIX_ACCESS_TOKEN;
    const userId = process.env.MATRIX_USER_ID;
    
    return !!(homeserver && accessToken && userId);
  }

  /**
   * Get the current configuration
   */
  public getConfig(): MatrixConfig | null {
    return this.config;
  }

  /**
   * Get the Matrix client instance
   */
  public getClient(): any | null {
    return this.client;
  }

  /**
   * Cleanup resources and connections
   */
  public async cleanup(): Promise<void> {
    try {
      await this.stopClient();
      this.client = null;
      this.config = null;
      this.isInitialized = false;
      console.log('Matrix client service cleaned up');
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  /**
   * Get client sync state
   */
  public getSyncState(): string | null {
    return this.client?.getSyncState() || null;
  }

  /**
   * Wait for client to reach a specific sync state
   */
  public async waitForSyncState(
    targetState: string, 
    timeoutMs: number = 30000
  ): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, timeoutMs);

      const checkState = () => {
        const currentState = this.client?.getSyncState();
        if (currentState === targetState) {
          clearTimeout(timeout);
          resolve(true);
        }
      };

      // Check immediately
      checkState();

      // Listen for state changes
      this.client.on('sync', checkState);
    });
  }
}