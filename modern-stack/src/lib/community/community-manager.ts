/**
 * Community Manager and Service Factory
 * Orchestrates multiple platform services with intelligent routing
 */

import { CommunityService, CommunityServiceFactory, CommunityManager } from './community-service';
import {
  Platform,
  CommunityUser,
  CommunityRoom,
  MessageResult,
  RoomOperationResult,
  SendMessageRequest,
  InviteToRoomRequest,
  RemoveFromRoomRequest,
  BroadcastToRoomRequest,
  CommunityServiceConfig,
  CommunityServiceError,
  PlatformUnavailableError
} from './types';
import { SignalCommunityService } from './signal-community-service';
import { MatrixCommunityService } from './matrix-community-service';

/**
 * Factory for creating and managing community service instances
 */
export class DefaultCommunityServiceFactory implements CommunityServiceFactory {
  private signalService: SignalCommunityService | null = null;
  private matrixService: MatrixCommunityService | null = null;

  getSignalService(): CommunityService | null {
    if (!this.signalService) {
      this.signalService = new SignalCommunityService();
    }
    return this.signalService.isConfigured() ? this.signalService : null;
  }

  getMatrixService(): CommunityService | null {
    if (!this.matrixService) {
      this.matrixService = new MatrixCommunityService();
    }
    return this.matrixService.isConfigured() ? this.matrixService : null;
  }

  getPrimaryService(): CommunityService | null {
    // Priority: Signal CLI first (if available), then Matrix
    return this.getSignalService() || this.getMatrixService();
  }

  getAllServices(): CommunityService[] {
    const services: CommunityService[] = [];
    
    const signalService = this.getSignalService();
    if (signalService) services.push(signalService);
    
    const matrixService = this.getMatrixService();
    if (matrixService) services.push(matrixService);
    
    return services;
  }

  async getAvailableServices(): Promise<CommunityService[]> {
    const services = this.getAllServices();
    const availableServices: CommunityService[] = [];
    
    for (const service of services) {
      try {
        if (await service.isAvailable()) {
          availableServices.push(service);
        }
      } catch (error) {
        console.warn(`Service ${service.name} availability check failed:`, error);
      }
    }
    
    return availableServices;
  }

  getConfig(): CommunityServiceConfig {
    const signalService = this.getSignalService();
    const matrixService = this.getMatrixService();
    
    return {
      signalEnabled: !!signalService,
      matrixEnabled: !!matrixService,
      preferredPlatform: signalService ? 'signal' : matrixService ? 'matrix' : undefined,
      fallbackEnabled: !!(signalService && matrixService)
    };
  }
}

/**
 * Unified community manager with intelligent platform selection
 */
export class DefaultCommunityManager implements CommunityManager {
  constructor(private factory: CommunityServiceFactory = new DefaultCommunityServiceFactory()) {}

  async getAvailableServices(): Promise<CommunityService[]> {
    return this.factory.getAvailableServices();
  }

  async selectService(platform?: Platform): Promise<CommunityService> {
    if (platform) {
      const service = platform === 'signal' 
        ? this.factory.getSignalService()
        : this.factory.getMatrixService();
      
      if (!service) {
        throw new PlatformUnavailableError(platform);
      }
      
      if (!await service.isAvailable()) {
        throw new PlatformUnavailableError(platform);
      }
      
      return service;
    }

    // Auto-select best available service
    const availableServices = await this.getAvailableServices();
    if (availableServices.length === 0) {
      throw new CommunityServiceError(
        'No community services are available',
        'signal', // Default platform for error
        'NO_SERVICES_AVAILABLE'
      );
    }

    // Prefer Signal CLI over Matrix
    const signalService = availableServices.find(s => s.platform === 'signal');
    return signalService || availableServices[0];
  }

  async sendMessage(request: SendMessageRequest): Promise<MessageResult> {
    const service = await this.selectService(request.platform);
    return service.sendMessage(request);
  }

  async getUsers(platforms?: Platform[]): Promise<CommunityUser[]> {
    const allUsers: CommunityUser[] = [];
    const availableServices = await this.getAvailableServices();
    
    for (const service of availableServices) {
      if (!platforms || platforms.includes(service.platform)) {
        try {
          const users = await service.getUsers();
          allUsers.push(...users);
        } catch (error) {
          console.warn(`Failed to get users from ${service.platform}:`, error);
        }
      }
    }
    
    return allUsers;
  }

  async getRooms(platforms?: Platform[]): Promise<CommunityRoom[]> {
    const allRooms: CommunityRoom[] = [];
    const availableServices = await this.getAvailableServices();
    
    for (const service of availableServices) {
      if (!platforms || platforms.includes(service.platform)) {
        try {
          const rooms = await service.getRooms();
          allRooms.push(...rooms);
        } catch (error) {
          console.warn(`Failed to get rooms from ${service.platform}:`, error);
        }
      }
    }
    
    return allRooms;
  }

  async inviteToRoom(request: InviteToRoomRequest): Promise<RoomOperationResult> {
    const service = await this.selectService(request.platform);
    return service.inviteToRoom(request);
  }

  async removeFromRoom(request: RemoveFromRoomRequest): Promise<RoomOperationResult> {
    const service = await this.selectService(request.platform);
    return service.removeFromRoom(request);
  }

  async broadcastToRoom(request: BroadcastToRoomRequest): Promise<MessageResult> {
    const service = await this.selectService(request.platform);
    return service.broadcastToRoom(request);
  }

  async sendMessageToMultiple(
    userIds: string[], 
    message: string, 
    platform?: Platform
  ): Promise<MessageResult[]> {
    const service = await this.selectService(platform);
    const results: MessageResult[] = [];
    
    for (const userId of userIds) {
      try {
        const result = await service.sendDirectMessage(userId, message);
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          platform: service.platform
        });
      }
    }
    
    return results;
  }

  async inviteMultipleToRoom(
    userIds: string[], 
    roomId: string, 
    platform?: Platform
  ): Promise<RoomOperationResult[]> {
    const service = await this.selectService(platform);
    const results: RoomOperationResult[] = [];
    
    for (const userId of userIds) {
      try {
        const result = await service.inviteToRoom({ userId, roomId, platform });
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          platform: service.platform
        });
      }
    }
    
    return results;
  }
}

// Export singleton instances for easy use
export const communityServiceFactory = new DefaultCommunityServiceFactory();
export const communityManager = new DefaultCommunityManager(communityServiceFactory);