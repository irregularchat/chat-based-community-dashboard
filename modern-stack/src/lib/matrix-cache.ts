import { PrismaClient } from '@prisma/client';

interface MatrixUserCache {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  lastSeen: Date;
  isActive: boolean;
  roomMemberships: any[];
}

interface SearchOptions {
  search?: string;
  includeSignalUsers?: boolean;
  includeRegularUsers?: boolean;
  [key: string]: any; // Allow any additional properties
}

// Stub service for matrix cache - returns empty results since the required models don't exist
export function createMatrixCacheService(prisma: PrismaClient) {
  return {
    async getCachedUsers(options: SearchOptions): Promise<MatrixUserCache[]> {
      // Return empty array since the matrixUser model doesn't exist
      return [];
    },

    async updateUserCache(userId: string, userData: any): Promise<void> {
      // No-op since the models don't exist
      return;
    },

    async syncFromMatrix(): Promise<any> {
      // Return mock sync result
      return {
        status: 'completed',
        usersSync: 0,
        roomsSync: 0,
        membershipsSync: 0,
        cacheUpdated: 0
      };
    }
  };
}