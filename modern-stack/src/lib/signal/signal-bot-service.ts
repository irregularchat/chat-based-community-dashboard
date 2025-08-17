/**
 * Signal Bot Service
 * High-level service for Signal CLI operations
 */

import { SignalApiClient } from './api-client';
import { 
  SignalBotConfig, 
  SignalMessage,
  SignalResult,
  SignalAccount,
  SignalHealth,
  SignalRegistration,
  SignalBotError,
  SignalRegistrationError,
  SignalConnectionError,
  SignalMessageError 
} from './types';
import { normalizePhoneNumber } from '../phone-utils';

export class SignalBotService {
  private apiClient: SignalApiClient;
  private config: SignalBotConfig;
  private isInitialized: boolean = false;

  constructor(config?: SignalBotConfig) {
    this.config = config || this.loadConfigFromEnv();
    this.apiClient = new SignalApiClient(this.config);
  }

  /**
   * Load configuration from environment variables
   */
  private loadConfigFromEnv(): SignalBotConfig {
    return {
      enabled: process.env.SIGNAL_CLI_ENABLED === 'true',
      apiUrl: process.env.SIGNAL_CLI_API_URL || 'http://localhost:8080',
      phoneNumber: process.env.SIGNAL_CLI_PHONE_NUMBER,
      timeout: parseInt(process.env.SIGNAL_CLI_TIMEOUT || '30000'),
      registrationPin: process.env.SIGNAL_CLI_REGISTRATION_PIN,
      deviceName: process.env.SIGNAL_CLI_DEVICE_NAME || 'community-dashboard-bot',
    };
  }

  /**
   * Check if Signal CLI service is enabled and configured
   */
  public isConfigured(): boolean {
    return this.config.enabled && !!this.config.apiUrl;
  }

  /**
   * Check if a phone number is registered
   */
  public isRegistered(): boolean {
    return !!this.config.phoneNumber && this.isInitialized;
  }

  /**
   * Initialize the service and check connectivity
   */
  public async initialize(): Promise<void> {
    if (!this.isConfigured()) {
      throw new SignalBotError('Signal CLI service is not enabled or configured');
    }

    try {
      console.log('🔧 Signal Bot: Initializing service...');
      
      // Check service health
      const healthCheck = await this.checkServiceHealth();
      if (!healthCheck.containerStatus || healthCheck.containerStatus === 'error') {
        throw new SignalConnectionError('Signal CLI REST API service is not available');
      }

      // Check registration status if phone number is configured
      if (this.config.phoneNumber) {
        const isRegistered = await this.apiClient.isRegistered(this.config.phoneNumber);
        if (!isRegistered) {
          console.warn(`⚠️ Signal Bot: Phone number ${this.config.phoneNumber} is not registered`);
        }
      }

      this.isInitialized = true;
      console.log('✅ Signal Bot: Service initialized successfully');
    } catch (error) {
      console.error('❌ Signal Bot: Initialization failed:', error);
      throw new SignalBotError(
        `Signal Bot initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'INITIALIZATION_FAILED',
        error
      );
    }
  }

  /**
   * Register a phone number with Signal
   */
  public async registerPhoneNumber(phoneNumber: string, useVoice = false, captcha?: string): Promise<void> {
    try {
      console.log(`📱 Signal Bot: Registering phone number ${phoneNumber}`);
      
      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      if (!normalizedPhone.isValid) {
        throw new SignalRegistrationError(`Invalid phone number format: ${phoneNumber}`);
      }

      const registration: SignalRegistration = {
        phoneNumber: normalizedPhone.normalized,
        useVoice,
        captcha,
      };

      await this.apiClient.register(registration);
      console.log(`✅ Signal Bot: Registration request sent for ${normalizedPhone.normalized}`);
    } catch (error) {
      console.error('❌ Signal Bot: Phone registration failed:', error);
      throw error instanceof SignalBotError ? error : new SignalRegistrationError(
        `Phone registration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Verify phone number registration with SMS/Voice code
   */
  public async verifyRegistration(phoneNumber: string, verificationCode: string, pin?: string): Promise<void> {
    try {
      console.log(`🔐 Signal Bot: Verifying registration for ${phoneNumber}`);
      
      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      if (!normalizedPhone.isValid) {
        throw new SignalRegistrationError(`Invalid phone number format: ${phoneNumber}`);
      }

      await this.apiClient.verify(normalizedPhone.normalized, verificationCode, pin);
      
      // Update configuration with verified phone number
      this.config.phoneNumber = normalizedPhone.normalized;
      this.apiClient.updateConfig(this.config);
      
      console.log(`✅ Signal Bot: Phone number ${normalizedPhone.normalized} verified successfully`);
    } catch (error) {
      console.error('❌ Signal Bot: Phone verification failed:', error);
      throw error instanceof SignalBotError ? error : new SignalRegistrationError(
        `Phone verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Send a message to a phone number or username
   */
  public async sendMessage(recipient: string, message: string): Promise<SignalResult> {
    try {
      console.log(`📤 Signal Bot: Sending message to ${recipient}`);
      
      if (!this.config.phoneNumber) {
        throw new SignalMessageError('No registered phone number configured for sending messages');
      }

      let finalRecipient: string;
      
      // Check if this is a username (starts with u:) or a phone number
      if (recipient.startsWith('u:')) {
        // Username format - use as is
        finalRecipient = recipient;
        console.log(`📝 Signal Bot: Sending to username: ${finalRecipient}`);
      } else {
        // Phone number format - normalize it
        const normalizedPhone = normalizePhoneNumber(recipient);
        if (!normalizedPhone.isValid) {
          throw new SignalMessageError(`Invalid recipient phone number format: ${recipient}`);
        }
        finalRecipient = normalizedPhone.normalized;
        console.log(`📝 Signal Bot: Sending to phone: ${finalRecipient}`);
      }

      const signalMessage: SignalMessage = {
        message,
        recipients: [finalRecipient],
      };

      const response = await this.apiClient.sendMessage(this.config.phoneNumber, signalMessage);
      
      if (response.success && response.data) {
        console.log(`✅ Signal Bot: Message sent successfully to ${finalRecipient}`);
        return response.data;
      } else {
        throw new SignalMessageError(`Failed to send message: ${response.error}`);
      }
    } catch (error) {
      console.error('❌ Signal Bot: Send message failed:', error);
      throw error instanceof SignalBotError ? error : new SignalMessageError(
        `Send message failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Send a message to multiple recipients
   */
  public async sendMessageToMultiple(phoneNumbers: string[], message: string): Promise<SignalResult> {
    try {
      console.log(`📤 Signal Bot: Sending message to ${phoneNumbers.length} recipients`);
      
      if (!this.config.phoneNumber) {
        throw new SignalMessageError('No registered phone number configured for sending messages');
      }

      const normalizedPhones = phoneNumbers.map(phone => {
        const normalized = normalizePhoneNumber(phone);
        if (!normalized.isValid) {
          throw new SignalMessageError(`Invalid recipient phone number format: ${phone}`);
        }
        return normalized.normalized;
      });

      const signalMessage: SignalMessage = {
        message,
        recipients: normalizedPhones,
      };

      const response = await this.apiClient.sendMessage(this.config.phoneNumber, signalMessage);
      
      if (response.success && response.data) {
        console.log(`✅ Signal Bot: Message sent successfully to ${normalizedPhones.length} recipients`);
        return response.data;
      } else {
        throw new SignalMessageError(`Failed to send message: ${response.error}`);
      }
    } catch (error) {
      console.error('❌ Signal Bot: Send message to multiple failed:', error);
      throw error instanceof SignalBotError ? error : new SignalMessageError(
        `Send message to multiple failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Resolve phone number to Signal UUID (stub for future implementation)
   */
  public async resolvePhoneToUuid(phoneNumber: string): Promise<string | null> {
    try {
      console.log(`🔍 Signal Bot: Resolving phone ${phoneNumber} to UUID`);
      
      // For now, we don't have a direct way to resolve phone to UUID via signal-cli REST API
      // This would need to be implemented based on contacts or identity information
      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      if (!normalizedPhone.isValid) {
        console.warn(`Invalid phone number format: ${phoneNumber}`);
        return null;
      }

      // TODO: Implement UUID resolution logic
      // This might involve checking contacts or using identity endpoint
      console.warn(`📍 Signal Bot: UUID resolution not yet implemented for ${normalizedPhone.normalized}`);
      return null;
    } catch (error) {
      console.error('❌ Signal Bot: Phone to UUID resolution failed:', error);
      return null;
    }
  }

  /**
   * Check service health and status
   */
  public async checkServiceHealth(): Promise<SignalHealth> {
    try {
      const startTime = Date.now();
      const healthResponse = await this.apiClient.healthCheck();
      const responseTime = Date.now() - startTime;

      const health: SignalHealth = {
        containerStatus: healthResponse.success ? 'running' : 'error',
        apiResponseTime: responseTime,
        registrationStatus: 'unknown',
        messagesSentToday: 0, // TODO: Implement message tracking
      };

      // Check registration status if phone number is configured
      if (this.config.phoneNumber) {
        try {
          const isRegistered = await this.apiClient.isRegistered(this.config.phoneNumber);
          health.registrationStatus = isRegistered ? 'registered' : 'unregistered';
        } catch (error) {
          console.warn('Could not check registration status:', error);
          health.registrationStatus = 'unknown';
        }
      } else {
        health.registrationStatus = 'unregistered';
      }

      return health;
    } catch (error) {
      console.error('❌ Signal Bot: Health check failed:', error);
      return {
        containerStatus: 'error',
        registrationStatus: 'unknown',
        messagesSentToday: 0,
      };
    }
  }

  /**
   * Get account information
   */
  public async getAccountInfo(): Promise<SignalAccount | null> {
    try {
      if (!this.config.phoneNumber) {
        return null;
      }

      const response = await this.apiClient.getAccount(this.config.phoneNumber);
      return response.success ? response.data || null : null;
    } catch (error) {
      console.error('❌ Signal Bot: Get account info failed:', error);
      return null;
    }
  }

  /**
   * Generate QR code for device linking
   */
  public async generateQRCode(): Promise<string | null> {
    try {
      const response = await this.apiClient.generateQRCode(this.config.deviceName);
      return response.success ? response.data || null : null;
    } catch (error) {
      console.error('❌ Signal Bot: Generate QR code failed:', error);
      return null;
    }
  }

  /**
   * Get current configuration
   */
  public getConfig(): SignalBotConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<SignalBotConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.apiClient.updateConfig(this.config);
  }

  /**
   * Update Signal profile (name and/or avatar)
   */
  public async updateProfile(displayName?: string, avatarBase64?: string): Promise<void> {
    try {
      if (!this.config.phoneNumber) {
        throw new SignalBotError('No phone number configured for profile update', 'NO_PHONE_NUMBER');
      }

      console.log(`🔄 Signal Bot: Updating profile for ${this.config.phoneNumber}...`);
      
      // Validate inputs
      if (!displayName && !avatarBase64) {
        throw new SignalBotError('Either display name or avatar must be provided', 'INVALID_INPUT');
      }

      // Validate avatar if provided
      if (avatarBase64) {
        // Check if it's valid base64
        try {
          const buffer = Buffer.from(avatarBase64, 'base64');
          if (buffer.length === 0) {
            throw new Error('Empty avatar data');
          }
          console.log(`📸 Signal Bot: Avatar data validated (${buffer.length} bytes)`);
        } catch (error) {
          throw new SignalBotError('Invalid avatar data: must be valid base64', 'INVALID_AVATAR');
        }
      }

      if (displayName) {
        console.log(`👤 Signal Bot: Setting display name to "${displayName}"`);
      }
      
      // Call the API to update profile
      const response = await this.apiClient.updateProfile(
        this.config.phoneNumber, 
        displayName, 
        avatarBase64
      );

      if (!response.success) {
        throw new SignalBotError(
          `Profile update failed: ${response.error}`,
          'PROFILE_UPDATE_FAILED'
        );
      }

      console.log('✅ Signal Bot: Profile updated successfully');
      
      // Add a small delay to allow profile changes to propagate
      // Signal profile updates can take time to be visible to other clients
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('📡 Signal Bot: Profile update propagation delay completed');
      
    } catch (error) {
      console.error('❌ Signal Bot: Profile update failed:', error);
      throw error instanceof SignalBotError ? error : new SignalBotError(
        `Profile update failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'PROFILE_UPDATE_FAILED',
        error
      );
    }
  }

  /**
   * Cleanup resources
   */
  public async cleanup(): Promise<void> {
    try {
      console.log('🧹 Signal Bot: Cleaning up resources...');
      this.isInitialized = false;
      console.log('✅ Signal Bot: Cleanup completed');
    } catch (error) {
      console.error('❌ Signal Bot: Cleanup failed:', error);
    }
  }
}