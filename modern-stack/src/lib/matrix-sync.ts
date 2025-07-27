import { PrismaClient } from '@prisma/client';

interface SyncResult {
  status: string;
  usersSync?: number;
  roomsSync?: number;
  membershipsSync?: number;
  cacheUpdated?: number;
}

// Stub service for matrix sync - returns mock results since the required models don't exist
export const matrixSyncService = {
  async fullSync(prisma: PrismaClient): Promise<SyncResult> {
    // Return mock sync result since the required models don't exist
    return {
      status: 'completed',
      usersSync: 0,
      roomsSync: 0,
      membershipsSync: 0,
      cacheUpdated: 0
    };
  },

  async incrementalSync(prisma: PrismaClient): Promise<SyncResult> {
    // Return mock sync result since the required models don't exist
    return {
      status: 'completed',
      usersSync: 0,
      roomsSync: 0,
      membershipsSync: 0,
      cacheUpdated: 0
    };
  },

  async getUsersFromPriorityRooms(): Promise<any[]> {
    // Return empty array since the required models don't exist
    return [];
  }
};