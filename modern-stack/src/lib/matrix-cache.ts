import { PrismaClient } from '@/generated/prisma';

interface MatrixUserCache {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
  isSignalUser: boolean;
  lastSeen?: Date;
}

interface MatrixRoomCache {
  roomId: string;
  name?: string;
  displayName?: string;
  topic?: string;
  memberCount: number;
  roomType?: string;
  isDirect: boolean;
  isEncrypted: boolean;
  lastSynced?: Date;
}

interface MatrixMembershipCache {
  roomId: string;
  userId: string;
  membershipStatus: string;
  joinedAt?: Date;
}

interface SyncResult {
  status: 'completed' | 'failed' | 'partial';
  usersSynced: number;
  roomsSynced: number;
  membershipsSynced: number;
  errors: string[];
  startTime: Date;
  endTime: Date;
  duration: number; // in milliseconds
}

interface CacheStats {
  userCount: number;
  roomCount: number;
  membershipCount: number;
  lastSyncTime?: Date;
  cacheAge: number; // in minutes
  isFresh: boolean;
}

class MatrixCacheService {
  private prisma: PrismaClient;
  private issyncing = false;
  private lastSyncTime?: Date;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  // User cache methods
  public async getCachedUsers(options?: {
    search?: string;
    includeSignalUsers?: boolean;
    includeRegularUsers?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<MatrixUserCache[]> {
    const {
      search,
      includeSignalUsers = true,
      includeRegularUsers = true,
      limit,
      offset,
    } = options || {};

    const where: any = {};

    // Apply signal user filter
    if (!includeSignalUsers && includeRegularUsers) {
      where.isSignalUser = false;
    } else if (includeSignalUsers && !includeRegularUsers) {
      where.isSignalUser = true;
    }

    // Apply search filter
    if (search) {
      where.OR = [
        { userId: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const users = await this.prisma.matrixUser.findMany({
      where,
      orderBy: { displayName: 'asc' },
      take: limit,
      skip: offset,
    });

    return users.map(user => ({
      userId: user.userId,
      displayName: user.displayName || undefined,
      avatarUrl: user.avatarUrl || undefined,
      isSignalUser: user.isSignalUser,
      lastSeen: user.lastSeen || undefined,
    }));
  }

  public async getCachedUser(userId: string): Promise<MatrixUserCache | null> {
    const user = await this.prisma.matrixUser.findUnique({
      where: { userId },
    });

    if (!user) return null;

    return {
      userId: user.userId,
      displayName: user.displayName || undefined,
      avatarUrl: user.avatarUrl || undefined,
      isSignalUser: user.isSignalUser,
      lastSeen: user.lastSeen || undefined,
    };
  }

  public async updateUserCache(user: MatrixUserCache): Promise<void> {
    await this.prisma.matrixUser.upsert({
      where: { userId: user.userId },
      update: {
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isSignalUser: user.isSignalUser,
        lastSeen: user.lastSeen,
        updatedAt: new Date(),
      },
      create: {
        userId: user.userId,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isSignalUser: user.isSignalUser,
        lastSeen: user.lastSeen,
      },
    });
  }

  // Room cache methods
  public async getCachedRooms(options?: {
    search?: string;
    category?: string;
    includeDirectRooms?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<MatrixRoomCache[]> {
    const {
      search,
      includeDirectRooms = false,
      limit,
      offset,
    } = options || {};

    const where: any = {
      isDirect: includeDirectRooms ? undefined : false,
    };

    // Apply search filter
    if (search) {
      where.OR = [
        { roomId: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
        { topic: { contains: search, mode: 'insensitive' } },
      ];
    }

    const rooms = await this.prisma.matrixRoom.findMany({
      where,
      orderBy: { memberCount: 'desc' },
      take: limit,
      skip: offset,
    });

    return rooms.map(room => ({
      roomId: room.roomId,
      name: room.name || undefined,
      displayName: room.displayName || undefined,
      topic: room.topic || undefined,
      memberCount: room.memberCount,
      roomType: room.roomType || undefined,
      isDirect: room.isDirect,
      isEncrypted: room.isEncrypted,
      lastSynced: room.lastSynced || undefined,
    }));
  }

  public async getCachedRoom(roomId: string): Promise<MatrixRoomCache | null> {
    const room = await this.prisma.matrixRoom.findUnique({
      where: { roomId },
    });

    if (!room) return null;

    return {
      roomId: room.roomId,
      name: room.name || undefined,
      displayName: room.displayName || undefined,
      topic: room.topic || undefined,
      memberCount: room.memberCount,
      roomType: room.roomType || undefined,
      isDirect: room.isDirect,
      isEncrypted: room.isEncrypted,
      lastSynced: room.lastSynced || undefined,
    };
  }

  public async updateRoomCache(room: MatrixRoomCache): Promise<void> {
    await this.prisma.matrixRoom.upsert({
      where: { roomId: room.roomId },
      update: {
        name: room.name,
        displayName: room.displayName,
        topic: room.topic,
        memberCount: room.memberCount,
        roomType: room.roomType,
        isDirect: room.isDirect,
        isEncrypted: room.isEncrypted,
        lastSynced: room.lastSynced || new Date(),
        updatedAt: new Date(),
      },
      create: {
        roomId: room.roomId,
        name: room.name,
        displayName: room.displayName,
        topic: room.topic,
        memberCount: room.memberCount,
        roomType: room.roomType,
        isDirect: room.isDirect,
        isEncrypted: room.isEncrypted,
        lastSynced: room.lastSynced || new Date(),
      },
    });
  }

  // Membership cache methods
  public async getCachedMemberships(options?: {
    roomId?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  }): Promise<MatrixMembershipCache[]> {
    const { roomId, userId, limit, offset } = options || {};

    const where: any = {};
    if (roomId) where.roomId = roomId;
    if (userId) where.userId = userId;

    const memberships = await this.prisma.matrixRoomMembership.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return memberships.map(membership => ({
      roomId: membership.roomId,
      userId: membership.userId,
      membershipStatus: membership.membershipStatus,
      joinedAt: membership.joinedAt || undefined,
    }));
  }

  public async updateMembershipCache(membership: MatrixMembershipCache): Promise<void> {
    await this.prisma.matrixRoomMembership.upsert({
      where: {
        roomId_userId: {
          roomId: membership.roomId,
          userId: membership.userId,
        },
      },
      update: {
        membershipStatus: membership.membershipStatus,
        joinedAt: membership.joinedAt,
        updatedAt: new Date(),
      },
      create: {
        roomId: membership.roomId,
        userId: membership.userId,
        membershipStatus: membership.membershipStatus,
        joinedAt: membership.joinedAt,
      },
    });
  }

  // Cache statistics and health
  public async getCacheStats(): Promise<CacheStats> {
    const [userCount, roomCount, membershipCount] = await Promise.all([
      this.prisma.matrixUser.count(),
      this.prisma.matrixRoom.count(),
      this.prisma.matrixRoomMembership.count(),
    ]);

    const cacheAge = this.lastSyncTime 
      ? Math.floor((Date.now() - this.lastSyncTime.getTime()) / (1000 * 60))
      : Infinity;

    return {
      userCount,
      roomCount,
      membershipCount,
      lastSyncTime: this.lastSyncTime,
      cacheAge,
      isFresh: cacheAge < 30, // Consider cache fresh if less than 30 minutes old
    };
  }

  public async isCacheFresh(maxAgeMinutes: number = 30): Promise<boolean> {
    const stats = await this.getCacheStats();
    return stats.cacheAge < maxAgeMinutes;
  }

  // Full sync operations
  public async fullSync(force: boolean = false): Promise<SyncResult> {
    if (this.issyncing && !force) {
      throw new Error('Sync already in progress');
    }

    const { matrixService } = await import('./matrix');
    if (!matrixService.isConfigured()) {
      throw new Error('Matrix service not configured');
    }

    this.issyncing = true;
    const startTime = new Date();
    const errors: string[] = [];
    let usersSynced = 0;
    let roomsSynced = 0;
    let membershipsSynced = 0;

    try {
      console.log('Starting Matrix cache full sync...');

      // Sync users (mock implementation - would call Matrix API)
      try {
        // In a real implementation, this would:
        // 1. Get all users from Matrix API
        // 2. Update user cache with latest data
        // 3. Mark Signal users based on naming patterns
        
        console.log('Syncing Matrix users...');
        // Mock sync - in reality would fetch from Matrix API
        usersSynced = 0; // Would be actual count
      } catch (error) {
        errors.push(`User sync failed: ${error}`);
      }

      // Sync rooms (mock implementation - would call Matrix API)
      try {
        console.log('Syncing Matrix rooms...');
        // In a real implementation, this would:
        // 1. Get all rooms the bot is in
        // 2. Update room metadata (name, topic, member count)
        // 3. Categorize rooms based on configuration
        
        roomsSynced = 0; // Would be actual count
      } catch (error) {
        errors.push(`Room sync failed: ${error}`);
      }

      // Sync memberships (mock implementation - would call Matrix API)
      try {
        console.log('Syncing Matrix memberships...');
        // In a real implementation, this would:
        // 1. For each room, get member list
        // 2. Update membership cache
        // 3. Track join/leave events
        
        membershipsSynced = 0; // Would be actual count
      } catch (error) {
        errors.push(`Membership sync failed: ${error}`);
      }

      this.lastSyncTime = new Date();
      const endTime = new Date();

      const result: SyncResult = {
        status: errors.length === 0 ? 'completed' : errors.length < 3 ? 'partial' : 'failed',
        usersSynced,
        roomsSynced,
        membershipsSynced,
        errors,
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
      };

      console.log(`Matrix sync ${result.status}:`, result);
      return result;

    } catch (error) {
      console.error('Matrix sync failed:', error);
      const endTime = new Date();
      
      return {
        status: 'failed',
        usersSynced,
        roomsSynced,
        membershipsSynced,
        errors: [...errors, error instanceof Error ? error.message : 'Unknown error'],
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
      };
    } finally {
      this.issyncing = false;
    }
  }

  // Background sync (non-blocking)
  public async backgroundSync(maxAgeMinutes: number = 30): Promise<void> {
    try {
      const isFresh = await this.isCacheFresh(maxAgeMinutes);
      if (isFresh) {
        console.log('Cache is fresh, skipping background sync');
        return;
      }

      console.log('Starting background Matrix sync...');
      
      // Run sync in background without blocking
      this.fullSync(false).then(result => {
        console.log('Background sync completed:', result);
      }).catch(error => {
        console.error('Background sync failed:', error);
      });

    } catch (error) {
      console.error('Error initiating background sync:', error);
    }
  }

  // Incremental sync (for frequent updates)
  public async incrementalSync(): Promise<Partial<SyncResult>> {
    const { matrixService } = await import('./matrix');
    if (!matrixService.isConfigured()) {
      throw new Error('Matrix service not configured');
    }

    console.log('Starting incremental Matrix sync...');
    
    try {
      // Import the Matrix sync service
      const { matrixSyncService } = await import('./matrix-sync');
      
      // Perform a full sync to get latest data (force=true for manual sync)
      const syncResult = await matrixSyncService.fullSync(true);
      
      console.log('Matrix sync result:', syncResult);
      
      if (syncResult.status === 'completed') {
        console.log(`Matrix sync completed: ${syncResult.usersSync || 0} users, ${syncResult.roomsSync || 0} rooms, ${syncResult.membershipsSync || 0} memberships`);
        return {
          status: 'completed',
          usersSynced: syncResult.usersSync || 0,
          roomsSynced: syncResult.roomsSync || 0,
          membershipsSynced: syncResult.membershipsSync || 0,
          errors: [],
        };
      } else {
        console.log(`Matrix sync failed/skipped: ${syncResult.status}, reason: ${syncResult.reason || syncResult.error}`);
        return {
          status: 'failed',
          usersSynced: 0,
          roomsSynced: 0,
          membershipsSynced: 0,
          errors: [syncResult.error || syncResult.reason || 'Unknown sync error'],
        };
      }
    } catch (error) {
      console.error('Error in incremental sync:', error);
      return {
        status: 'failed',
        usersSynced: 0,
        roomsSynced: 0,
        membershipsSynced: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      };
    }
  }

  // Cleanup old cache data
  public async cleanupCache(maxAgeHours: number = 24): Promise<number> {
    const cutoffDate = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    
    // Remove old memberships for users no longer in rooms
    const deletedCount = await this.prisma.matrixRoomMembership.deleteMany({
      where: {
        membershipStatus: 'leave',
        updatedAt: {
          lt: cutoffDate,
        },
      },
    });

    console.log(`Cleaned up ${deletedCount.count} old membership records`);
    return deletedCount.count;
  }

  // Signal user detection
  public async updateSignalUserStatus(userId: string, isSignalUser: boolean): Promise<void> {
    await this.prisma.matrixUser.updateMany({
      where: { userId },
      data: { 
        isSignalUser,
        updatedAt: new Date(),
      },
    });
  }

  public async detectSignalUsers(): Promise<number> {
    // Signal users typically have usernames like @signal_12345:domain.com
    const signalPattern = /^@signal_\d+:/;
    
    const updatedCount = await this.prisma.matrixUser.updateMany({
      where: {
        userId: {
          contains: 'signal_',
        },
        isSignalUser: false,
      },
      data: {
        isSignalUser: true,
        updatedAt: new Date(),
      },
    });

    console.log(`Updated ${updatedCount.count} users as Signal users`);
    return updatedCount.count;
  }

  // Room categorization
  public async categorizeRooms(): Promise<void> {
    // This would implement room categorization logic
    // based on room names, topics, and configuration
    console.log('Room categorization would be implemented here');
  }

  // Health check
  public async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    details: Record<string, any>;
  }> {
    try {
      const stats = await this.getCacheStats();
      const { matrixService } = await import('./matrix');
      const isConfigured = matrixService.isConfigured();
      
      let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
      
      if (!isConfigured) {
        status = 'unhealthy';
      } else if (stats.cacheAge > 60) { // More than 1 hour old
        status = 'degraded';
      }

      return {
        status,
        details: {
          matrixConfigured: isConfigured,
          cacheStats: stats,
          syncInProgress: this.issyncing,
          lastSyncTime: this.lastSyncTime,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
}

// Export function to create service instance
export function createMatrixCacheService(prisma: PrismaClient): MatrixCacheService {
  return new MatrixCacheService(prisma);
} 