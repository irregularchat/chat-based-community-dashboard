/**
 * Community Service Types
 * Unified types for cross-platform community management
 */

// Platform identifiers
export type Platform = 'signal' | 'matrix';

// Unified user representation
export interface CommunityUser {
  id: string;
  platform: Platform;
  displayName: string;
  avatarUrl?: string;
  isSignalUser?: boolean;
  
  // Platform-specific identifiers
  signalNumber?: string;
  matrixUserId?: string;
  
  // Status and metadata
  isOnline?: boolean;
  lastSeen?: Date;
  isVerified?: boolean;
}

// Unified room/group representation
export interface CommunityRoom {
  id: string;
  platform: Platform;
  name: string;
  displayName?: string;
  topic?: string;
  memberCount: number;
  
  // Platform-specific identifiers
  signalGroupId?: string;
  matrixRoomId?: string;
  
  // Room metadata
  isEncrypted?: boolean;
  isPublic?: boolean;
  avatarUrl?: string;
  lastActivity?: Date;
}

// Message operations
export interface MessageResult {
  success: boolean;
  messageId?: string;
  timestamp?: Date;
  error?: string;
  platform: Platform;
}

export interface SendMessageRequest {
  recipient: string;
  message: string;
  platform?: Platform; // Optional platform preference
}

// Room/group operations
export interface RoomOperationResult {
  success: boolean;
  roomId?: string;
  error?: string;
  platform: Platform;
}

export interface InviteToRoomRequest {
  userId: string;
  roomId: string;
  platform?: Platform;
}

export interface RemoveFromRoomRequest {
  userId: string;
  roomId: string;
  platform?: Platform;
}

export interface BroadcastToRoomRequest {
  roomId: string;
  message: string;
  platform?: Platform;
}

// Service configuration
export interface CommunityServiceConfig {
  signalEnabled: boolean;
  matrixEnabled: boolean;
  preferredPlatform?: Platform;
  fallbackEnabled: boolean;
}

// Service health and status
export interface ServiceHealth {
  platform: Platform;
  isAvailable: boolean;
  isConfigured: boolean;
  responseTime?: number;
  lastCheck: Date;
  error?: string;
}

// Error types
export class CommunityServiceError extends Error {
  constructor(
    message: string,
    public platform: Platform,
    public code: string,
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'CommunityServiceError';
  }
}

export class PlatformUnavailableError extends CommunityServiceError {
  constructor(platform: Platform, originalError?: unknown) {
    super(`${platform} platform is not available`, platform, 'PLATFORM_UNAVAILABLE', originalError);
    this.name = 'PlatformUnavailableError';
  }
}

export class ConfigurationError extends CommunityServiceError {
  constructor(platform: Platform, message: string) {
    super(`${platform} configuration error: ${message}`, platform, 'CONFIGURATION_ERROR');
    this.name = 'ConfigurationError';
  }
}