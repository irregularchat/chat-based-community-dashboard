import { PrismaClient } from '../generated/prisma';
import { matrixService } from './matrix';

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

      // Sync users (real Matrix API implementation)
      try {
        console.log('Syncing Matrix users from API...');
        
        // Get all joined rooms first
        const joinedRoomsResponse = await fetch(`${process.env.MATRIX_HOMESERVER}/_matrix/client/v3/joined_rooms`, {
          headers: {
            'Authorization': `Bearer ${process.env.MATRIX_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!joinedRoomsResponse.ok) {
          throw new Error(`Failed to get joined rooms: ${joinedRoomsResponse.statusText}`);
        }
        
        const joinedRooms = await joinedRoomsResponse.json();
        const allUsers = new Set<string>();
        
        // Collect unique users from all rooms
        for (const roomId of joinedRooms.joined_rooms) {
          try {
            const membersResponse = await fetch(`${process.env.MATRIX_HOMESERVER}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/members`, {
              headers: {
                'Authorization': `Bearer ${process.env.MATRIX_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
              }
            });
            
            if (membersResponse.ok) {
              const membersData = await membersResponse.json();
              membersData.chunk?.forEach((event: any) => {
                if (event.content?.membership === 'join' && event.state_key) {
                  allUsers.add(event.state_key);
                }
              });
            }
          } catch (roomError) {
            console.warn(`Failed to sync users from room ${roomId}: ${roomError}`);
          }
        }
        
        // Update user cache in database
        let syncedCount = 0;
        for (const userId of allUsers) {
          try {
            const isSignalUser = userId.startsWith('@signal_');
            await this.prisma.matrixUser.upsert({
              where: { userId },
              update: { 
                lastSeen: new Date(),
                isSignalUser 
              },
              create: {
                userId,
                displayName: userId.split(':')[0].substring(1), // Extract username part
                lastSeen: new Date(),
                isSignalUser
              }
            });
            syncedCount++;
          } catch (userError) {
            console.warn(`Failed to sync user ${userId}: ${userError}`);
          }
        }
        
        usersSynced = syncedCount;
        console.log(`✅ Synced ${usersSynced} Matrix users from API`);
      } catch (error) {
        console.error('User sync failed:', error);
        errors.push(`User sync failed: ${error}`);
      }

      // Sync rooms (real Matrix API implementation)
      try {
        console.log('Syncing Matrix rooms from API...');
        
        // Get all joined rooms
        const joinedRoomsResponse = await fetch(`${process.env.MATRIX_HOMESERVER}/_matrix/client/v3/joined_rooms`, {
          headers: {
            'Authorization': `Bearer ${process.env.MATRIX_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!joinedRoomsResponse.ok) {
          throw new Error(`Failed to get joined rooms: ${joinedRoomsResponse.statusText}`);
        }
        
        const joinedRooms = await joinedRoomsResponse.json();
        let syncedCount = 0;
        
        // Process each room
        for (const roomId of joinedRooms.joined_rooms) {
          try {
            // Get room state to fetch name, topic, and member count
            const stateResponse = await fetch(`${process.env.MATRIX_HOMESERVER}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state`, {
              headers: {
                'Authorization': `Bearer ${process.env.MATRIX_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
              }
            });
            
            if (!stateResponse.ok) {
              console.warn(`Failed to get state for room ${roomId}: ${stateResponse.statusText}`);
              continue;
            }
            
            const stateEvents = await stateResponse.json();
            
            // Extract room information from state events
            let roomName = roomId; // fallback to room ID
            let roomTopic = '';
            let memberCount = 0;
            let isDirect = false;
            
            stateEvents.forEach((event: any) => {
              switch (event.type) {
                case 'm.room.name':
                  if (event.content?.name) {
                    roomName = event.content.name;
                  }
                  break;
                case 'm.room.topic':
                  if (event.content?.topic) {
                    roomTopic = event.content.topic;
                  }
                  break;
                case 'm.room.member':
                  if (event.content?.membership === 'join') {
                    memberCount++;
                  }
                  break;
                case 'm.room.create':
                  if (event.content?.type === 'm.room.create') {
                    isDirect = event.content.is_direct === true;
                  }
                  break;
              }
            });
            
            // Determine if this is a priority room
            const priorityRoomIds = [
              process.env.MATRIX_DEFAULT_ROOM_ID,
              process.env.MATRIX_WELCOME_ROOM_ID,
              process.env.MATRIX_SIGNAL_BRIDGE_ROOM_ID,
              process.env.MATRIX_INDOC_ROOM_ID
            ].filter(Boolean);
            
            // const isPriorityRoom = priorityRoomIds.includes(roomId);
            
            // Update room in database
            await this.prisma.matrixRoom.upsert({
              where: { roomId },
              update: {
                name: roomName,
                topic: roomTopic,
                memberCount,
                isDirect,
                lastSynced: new Date()
              },
              create: {
                roomId,
                name: roomName,
                topic: roomTopic,
                memberCount,
                isDirect,
                lastSynced: new Date()
              }
            });
            
            syncedCount++;
          } catch (roomError) {
            console.warn(`Failed to sync room ${roomId}: ${roomError}`);
          }
        }
        
        roomsSynced = syncedCount;
        console.log(`✅ Synced ${roomsSynced} Matrix rooms from API`);
      } catch (error) {
        console.error('Room sync failed:', error);
        errors.push(`Room sync failed: ${error}`);
      }

      // Sync memberships (real Matrix API implementation)
      try {
        console.log('Syncing Matrix memberships from API...');
        
        // Get all rooms we're tracking
        const trackedRooms = await this.prisma.matrixRoom.findMany({
          select: { roomId: true }
        });
        
        let syncedCount = 0;
        
        // Process memberships for each tracked room
        for (const room of trackedRooms) {
          try {
            // Get members for this room
            const membersResponse = await fetch(`${process.env.MATRIX_HOMESERVER}/_matrix/client/v3/rooms/${encodeURIComponent(room.roomId)}/members`, {
              headers: {
                'Authorization': `Bearer ${process.env.MATRIX_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
              }
            });
            
            if (!membersResponse.ok) {
              console.warn(`Failed to get members for room ${room.roomId}: ${membersResponse.statusText}`);
              continue;
            }
            
            const membersData = await membersResponse.json();
            const currentMembers = new Set<string>();
            
            // Process each membership event
            for (const event of membersData.chunk || []) {
              if (event.state_key && event.content) {
                const userId = event.state_key;
                const membership = event.content.membership;
                const displayName = event.content.displayname || userId.split(':')[0].substring(1);
                const avatarUrl = event.content.avatar_url;
                
                currentMembers.add(userId);
                
                // Ensure user exists in our cache
                await this.prisma.matrixUser.upsert({
                  where: { userId },
                  update: { 
                    displayName,
                    avatarUrl,
                    lastSeen: new Date(),
                    isSignalUser: userId.startsWith('@signal_')
                  },
                  create: {
                    userId,
                    displayName,
                    avatarUrl,
                    lastSeen: new Date(),
                    isSignalUser: userId.startsWith('@signal_')
                  }
                });
                
                // Update or create membership record
                await this.prisma.matrixRoomMembership.upsert({
                  where: {
                    roomId_userId: {
                      roomId: room.roomId,
                      userId: userId
                    }
                  },
                  update: {
                    membershipStatus: membership
                  },
                  create: {
                    roomId: room.roomId,
                    userId: userId,
                    membershipStatus: membership,
                    joinedAt: membership === 'join' ? new Date() : null
                  }
                });
                
                syncedCount++;
              }
            }
            
            // Remove memberships for users no longer in the room
            await this.prisma.matrixRoomMembership.deleteMany({
              where: {
                roomId: room.roomId,
                userId: {
                  notIn: Array.from(currentMembers)
                },
                membershipStatus: 'join'
              }
            });
            
          } catch (roomError) {
            console.warn(`Failed to sync memberships for room ${room.roomId}: ${roomError}`);
          }
        }
        
        membershipsSynced = syncedCount;
        console.log(`✅ Synced ${membershipsSynced} Matrix memberships from API`);
      } catch (error) {
        console.error('Membership sync failed:', error);
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
    if (!matrixService.isConfigured()) {
      throw new Error('Matrix service not configured');
    }

    console.log('Starting incremental Matrix sync...');
    
    try {
      // Import the Matrix sync service
      const { matrixSyncService } = await import('./matrix-sync');
      
      // Perform a full sync to get latest data
      const syncResult = await matrixSyncService.fullSync(false);
      
      if (syncResult.status === 'completed') {
        return {
          status: 'completed',
          usersSynced: syncResult.usersSync || 0,
          roomsSynced: syncResult.roomsSync || 0,
          membershipsSynced: syncResult.membershipsSync || 0,
          errors: [],
        };
      } else {
        return {
          status: 'failed',
          usersSynced: 0,
          roomsSynced: 0,
          membershipsSynced: 0,
          errors: [syncResult.error || 'Unknown sync error'],
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