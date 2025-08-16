/**
 * Signal CLI Bot Service Types
 * Type definitions for Signal CLI REST API integration
 */

export interface SignalBotConfig {
  enabled: boolean;
  apiUrl: string;
  phoneNumber?: string;
  timeout: number;
  registrationPin?: string;
  deviceName: string;
}

export interface SignalMessage {
  message: string;
  recipients: string[];
  attachments?: string[];
  mentions?: string[];
}

export interface SignalResult {
  success: boolean;
  messageId?: string;
  timestamp: Date;
  error?: string;
  details?: any;
}

export interface SignalAccount {
  phoneNumber: string;
  uuid?: string;
  deviceId?: number;
  isRegistered: boolean;
  registrationTime?: Date;
  lastSeen?: Date;
}

export interface SignalRegistration {
  phoneNumber: string;
  verificationCode?: string;
  captcha?: string;
  pin?: string;
  useVoice?: boolean;
}

export interface SignalHealth {
  containerStatus: 'running' | 'stopped' | 'error';
  apiResponseTime?: number;
  registrationStatus: 'registered' | 'unregistered' | 'expired' | 'unknown';
  lastMessageSent?: Date;
  messagesSentToday: number;
  version?: string;
}

export interface SignalApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: Date;
}

export interface SignalContact {
  number: string;
  uuid?: string;
  name?: string;
  profileName?: string;
  blocked?: boolean;
  messageExpirationTime?: number;
}

export interface SignalGroup {
  id: string;
  name?: string;
  description?: string;
  members: string[];
  admins: string[];
  blocked?: boolean;
  messageExpirationTime?: number;
}

export class SignalBotError extends Error {
  public readonly code: string;
  public readonly details?: any;

  constructor(message: string, code: string = 'SIGNAL_ERROR', details?: any) {
    super(message);
    this.name = 'SignalBotError';
    this.code = code;
    this.details = details;
  }
}

export class SignalRegistrationError extends SignalBotError {
  constructor(message: string, details?: any) {
    super(message, 'REGISTRATION_ERROR', details);
    this.name = 'SignalRegistrationError';
  }
}

export class SignalConnectionError extends SignalBotError {
  constructor(message: string, details?: any) {
    super(message, 'CONNECTION_ERROR', details);
    this.name = 'SignalConnectionError';
  }
}

export class SignalMessageError extends SignalBotError {
  constructor(message: string, details?: any) {
    super(message, 'MESSAGE_ERROR', details);
    this.name = 'SignalMessageError';
  }
}