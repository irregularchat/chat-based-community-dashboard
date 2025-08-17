/**
 * Community Service Interface
 * Unified interface for cross-platform community management operations
 */

import {
  CommunityUser,
  CommunityRoom,
  MessageResult,
  RoomOperationResult,
  SendMessageRequest,
  InviteToRoomRequest,
  RemoveFromRoomRequest,
  BroadcastToRoomRequest,
  ServiceHealth,
  Platform
} from './types';

/**
 * Abstract base class for community management services
 * Provides a unified interface for Signal CLI and Matrix operations
 */
export abstract class CommunityService {
  abstract readonly platform: Platform;
  abstract readonly name: string;

  // Configuration and health
  abstract isConfigured(): boolean;
  abstract isAvailable(): Promise<boolean>;
  abstract getHealth(): Promise<ServiceHealth>;

  // User operations
  abstract getUsers(): Promise<CommunityUser[]>;
  abstract getUser(userId: string): Promise<CommunityUser | null>;
  abstract searchUsers(query: string): Promise<CommunityUser[]>;

  // Room/group operations  
  abstract getRooms(): Promise<CommunityRoom[]>;
  abstract getRoom(roomId: string): Promise<CommunityRoom | null>;
  abstract createRoom(name: string, topic?: string): Promise<RoomOperationResult>;

  // Messaging operations
  abstract sendMessage(request: SendMessageRequest): Promise<MessageResult>;
  abstract sendDirectMessage(userId: string, message: string): Promise<MessageResult>;
  abstract broadcastToRoom(request: BroadcastToRoomRequest): Promise<MessageResult>;

  // Member management
  abstract inviteToRoom(request: InviteToRoomRequest): Promise<RoomOperationResult>;
  abstract removeFromRoom(request: RemoveFromRoomRequest): Promise<RoomOperationResult>;
  abstract getRoomMembers(roomId: string): Promise<CommunityUser[]>;

  // Utility methods
  abstract normalizeUserId(userId: string): string;
  abstract normalizeRoomId(roomId: string): string;
}

/**
 * Factory for creating and managing community service instances
 */
export interface CommunityServiceFactory {
  getSignalService(): CommunityService | null;
  getMatrixService(): CommunityService | null;
  getPrimaryService(): CommunityService | null;
  getAllServices(): CommunityService[];
  getAvailableServices(): Promise<CommunityService[]>;
}

/**
 * Unified community manager that coordinates multiple platform services
 */
export interface CommunityManager {
  // Service management
  getAvailableServices(): Promise<CommunityService[]>;
  selectService(platform?: Platform): Promise<CommunityService>;
  
  // Unified operations with intelligent platform selection
  sendMessage(request: SendMessageRequest): Promise<MessageResult>;
  getUsers(platforms?: Platform[]): Promise<CommunityUser[]>;
  getRooms(platforms?: Platform[]): Promise<CommunityRoom[]>;
  
  // Cross-platform operations
  inviteToRoom(request: InviteToRoomRequest): Promise<RoomOperationResult>;
  removeFromRoom(request: RemoveFromRoomRequest): Promise<RoomOperationResult>;
  broadcastToRoom(request: BroadcastToRoomRequest): Promise<MessageResult>;
  
  // Bulk operations
  sendMessageToMultiple(userIds: string[], message: string, platform?: Platform): Promise<MessageResult[]>;
  inviteMultipleToRoom(userIds: string[], roomId: string, platform?: Platform): Promise<RoomOperationResult[]>;
}