/**
 * Signal CLI API Client
 * Low-level wrapper for Signal CLI REST API endpoints
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { 
  SignalBotConfig, 
  SignalApiResponse, 
  SignalRegistration,
  SignalMessage,
  SignalResult,
  SignalAccount,
  SignalContact,
  SignalGroup,
  SignalConnectionError,
  SignalBotError 
} from './types';

export class SignalApiClient {
  private httpClient: AxiosInstance;
  private config: SignalBotConfig;

  constructor(config: SignalBotConfig) {
    this.config = config;
    this.httpClient = axios.create({
      baseURL: config.apiUrl,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request/response interceptors for logging and error handling
    this.httpClient.interceptors.request.use(
      (config) => {
        console.log(`📤 Signal API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('❌ Signal API Request Error:', error);
        return Promise.reject(error);
      }
    );

    this.httpClient.interceptors.response.use(
      (response) => {
        console.log(`📥 Signal API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        console.error('❌ Signal API Response Error:', error?.response?.status, error?.response?.data);
        return Promise.reject(new SignalConnectionError(
          `Signal API error: ${error.message}`,
          error.response?.data
        ));
      }
    );
  }

  /**
   * Health check endpoint
   */
  async healthCheck(): Promise<SignalApiResponse<any>> {
    try {
      const response = await this.httpClient.get('/v1/health');
      return {
        success: true,
        data: response.data,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Health check failed',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Register a phone number with Signal
   */
  async register(registration: SignalRegistration): Promise<SignalApiResponse<void>> {
    try {
      const url = `/v1/register/${registration.phoneNumber}`;
      const payload: any = {};
      
      if (registration.useVoice) {
        payload.use_voice = true;
      }
      
      if (registration.captcha) {
        payload.captcha = registration.captcha;
      }

      await this.httpClient.post(url, payload);
      
      return {
        success: true,
        timestamp: new Date(),
      };
    } catch (error) {
      throw new SignalBotError(
        `Registration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'REGISTRATION_FAILED',
        error
      );
    }
  }

  /**
   * Verify registration with SMS/Voice code
   */
  async verify(phoneNumber: string, verificationCode: string, pin?: string): Promise<SignalApiResponse<void>> {
    try {
      const url = `/v1/register/${phoneNumber}/verify/${verificationCode}`;
      const payload: any = {};
      
      if (pin) {
        payload.pin = pin;
      }

      await this.httpClient.post(url, payload);
      
      return {
        success: true,
        timestamp: new Date(),
      };
    } catch (error) {
      throw new SignalBotError(
        `Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'VERIFICATION_FAILED',
        error
      );
    }
  }

  /**
   * Send message to recipients
   */
  async sendMessage(phoneNumber: string, message: SignalMessage): Promise<SignalApiResponse<SignalResult>> {
    try {
      const url = '/v2/send';
      const payload = {
        number: phoneNumber,
        recipients: message.recipients,
        message: message.message,
        ...(message.attachments && { base64_attachments: message.attachments }),
        ...(message.mentions && { mentions: message.mentions }),
      };

      const response = await this.httpClient.post(url, payload);
      
      return {
        success: true,
        data: {
          success: true,
          messageId: response.data?.messageId || response.data?.timestamp,
          timestamp: new Date(),
        },
        timestamp: new Date(),
      };
    } catch (error) {
      throw new SignalBotError(
        `Send message failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'SEND_MESSAGE_FAILED',
        error
      );
    }
  }

  /**
   * Get account information
   */
  async getAccount(phoneNumber: string): Promise<SignalApiResponse<SignalAccount>> {
    try {
      const url = `/v1/accounts/${phoneNumber}`;
      const response = await this.httpClient.get(url);
      
      return {
        success: true,
        data: {
          phoneNumber,
          uuid: response.data?.uuid,
          deviceId: response.data?.deviceId,
          isRegistered: true,
          registrationTime: response.data?.registrationTime ? new Date(response.data.registrationTime) : undefined,
        },
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get account info',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Get contacts for a phone number
   */
  async getContacts(phoneNumber: string): Promise<SignalApiResponse<SignalContact[]>> {
    try {
      const url = `/v1/identities/${phoneNumber}`;
      const response = await this.httpClient.get(url);
      
      return {
        success: true,
        data: response.data || [],
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get contacts',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Get groups for a phone number
   */
  async getGroups(phoneNumber: string): Promise<SignalApiResponse<SignalGroup[]>> {
    try {
      const url = `/v1/groups/${phoneNumber}`;
      const response = await this.httpClient.get(url);
      
      return {
        success: true,
        data: response.data || [],
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get groups',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Generate QR code for linking as secondary device
   */
  async generateQRCode(deviceName?: string): Promise<SignalApiResponse<string>> {
    try {
      const params = deviceName ? `?device_name=${encodeURIComponent(deviceName)}` : '';
      const url = `/v1/qrcodelink${params}`;
      const response = await this.httpClient.get(url);
      
      return {
        success: true,
        data: response.data?.qrcode || response.request?.responseURL,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate QR code',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Check if a phone number is registered with Signal
   */
  async isRegistered(phoneNumber: string): Promise<boolean> {
    try {
      const accountResponse = await this.getAccount(phoneNumber);
      return accountResponse.success && accountResponse.data?.isRegistered === true;
    } catch (error) {
      console.warn(`Could not check registration status for ${phoneNumber}:`, error);
      return false;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<SignalBotConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.httpClient.defaults.baseURL = this.config.apiUrl;
    this.httpClient.defaults.timeout = this.config.timeout;
  }
}