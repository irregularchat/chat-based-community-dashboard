// Shared Matrix types and interfaces

export interface MatrixConfig {
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

export interface DirectMessageResult {
  success: boolean;
  roomId?: string;
  eventId?: string;
  error?: string;
}

export interface BulkOperationResult {
  success: boolean;
  results: Record<string, boolean>;
  errors: Record<string, string>;
  totalSuccess: number;
  totalFailed: number;
}

export interface CacheStats {
  userCount: number;
  roomCount: number;
  membershipCount: number;
  lastSyncTime?: Date;
  cacheAge: number; // in minutes
}

export interface MatrixUser {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
  isSignalUser?: boolean;
}

export interface MatrixRoom {
  roomId: string;
  name?: string;
  topic?: string;
  memberCount?: number;
  encrypted?: boolean;
  category?: string;
}

export interface PowerLevelEvent {
  users: Record<string, number>;
  users_default: number;
  events: Record<string, number>;
  events_default: number;
  state_default: number;
  ban: number;
  kick: number;
  redact: number;
  invite: number;
}

// Error classes for better error handling
export class MatrixServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'MatrixServiceError';
  }
}

export class MatrixConnectionError extends MatrixServiceError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'CONNECTION_ERROR', context);
    this.name = 'MatrixConnectionError';
  }
}

export class MatrixEncryptionError extends MatrixServiceError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'ENCRYPTION_ERROR', context);
    this.name = 'MatrixEncryptionError';
  }
}

export class MatrixSignalBridgeError extends MatrixServiceError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'SIGNAL_BRIDGE_ERROR', context);
    this.name = 'MatrixSignalBridgeError';
  }
}