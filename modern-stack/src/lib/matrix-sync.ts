import { PrismaClient } from '@prisma/client';
import { matrixService } from './matrix';
import { MatrixClient } from 'matrix-js-sdk';

interface SyncResult {
  status: string;
  usersSync?: number;
  roomsSync?: number;
  membershipsSync?: number;
  cacheUpdated?: number;
  error?: string;
  reason?: string;
}

interface MatrixRoomData {
  room_id: string;
  name?: string;
  topic?: string;
  member_count: number;
  is_direct?: boolean;
  room_type?: string;
}

interface MatrixUserData {
  user_id: string;
  display_name?: string;
  avatar_url?: string;
  is_signal_user?: boolean;
}

class MatrixSyncService {
  private syncInProgress = false;
  private lastManualSync: Date | null = null;
  private prisma: PrismaClient;

  constructor() {
    this.prisma = new PrismaClient();
  }

  async fullSync(force: boolean = false): Promise<SyncResult> {
    if (this.syncInProgress && !force) {
      return { status: 'skipped', reason: 'sync_in_progress' };
    }

    try {
      this.syncInProgress = true;

      // Check if this is a rapid manual sync within 30 seconds
      const now = new Date();
      const isRapidManualSync = this.lastManualSync && 
        (now.getTime() - this.lastManualSync.getTime()) < 30000;

      if (force && !isRapidManualSync) {
        this.lastManualSync = now;
      }

      // Check cache freshness unless forced or rapid manual sync
      if (!force && !isRapidManualSync) {
        if (await this.isCacheFresh(30)) {
          return { status: 'skipped', reason: 'cache_fresh' };
        }
      }

      if (!matrixService.isConfigured()) {
        return { status: 'error', error: 'Matrix not configured' };
      }

      // Start sync operation
      const syncStatus = await this.prisma.matrixSyncStatus.create({
        data: {
          syncType: 'full',
          status: 'running',
        },
      });

      try {
        // Get Matrix client to perform sync operations
        const client = await this.getMatrixClient();
        if (!client) {
          throw new Error('Failed to get Matrix client');
        }

        // Sync rooms first
        const roomResult = await this.syncRooms(client, isRapidManualSync || false);
        
        // Sync users and memberships
        const userResult = await this.syncUsersAndMemberships(client, isRapidManualSync || false);

        // Update denormalized user cache
        const cacheResult = await this.updateUserCache();

        // Update sync status
        await this.prisma.matrixSyncStatus.update({
          where: { id: syncStatus.id },
          data: {
            lastSync: new Date(),
            status: 'completed',
            processedItems: (userResult.usersSync || 0) + (roomResult.roomsSync || 0),
          },
        });

        return {
          status: 'completed',
          usersSync: userResult.usersSync || 0,
          roomsSync: roomResult.roomsSync || 0,
          membershipsSync: userResult.membershipsSync || 0,
          cacheUpdated: cacheResult.cacheUpdated || 0,
        };

      } catch (error) {
        // Update sync status to failed
        await this.prisma.matrixSyncStatus.update({
          where: { id: syncStatus.id },
          data: {
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          },
        });
        throw error;
      }

    } catch (error) {
      console.error('Error in full_sync:', error);
      return { 
        status: 'error', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    } finally {
      this.syncInProgress = false;
    }
  }

  private async getMatrixClient(): Promise<MatrixClient | null> {
    const config = matrixService.getConfig();
    if (!config) return null;

    // Get the Matrix client from the service
    return matrixService.getClient();
  }

  private async syncRooms(client: MatrixClient | null, isRapidManualSync: boolean): Promise<{ roomsSync?: number }> {
    if (!client) {
      // Mock implementation for now
      return { roomsSync: 0 };
    }

    try {
      // Get joined rooms from Matrix client
      const rooms = client.getRooms();
      let roomsSync = 0;
      let roomsSkipped = 0;

      // Define priority rooms for user selection (mod, action, entry rooms)
      const priorityRoomNames = ['mod', 'action', 'entry', 'welcome', 'general', 'main', 'lobby'];
      
      // Sort rooms by priority (priority rooms first)
      const sortedRooms = rooms.sort((a, b) => {
        const aName = (a.name || '').toLowerCase();
        const bName = (b.name || '').toLowerCase();
        
        const aPriority = priorityRoomNames.some(priority => aName.includes(priority));
        const bPriority = priorityRoomNames.some(priority => bName.includes(priority));
        
        if (aPriority && !bPriority) return -1;
        if (!aPriority && bPriority) return 1;
        return 0;
      });

      for (const room of sortedRooms) {
        try {
          const memberCount = room.getJoinedMemberCount();
          
          // Skip rooms with fewer than minimum members (configurable)
          const minRoomMembers = parseInt(process.env.MATRIX_MIN_ROOM_MEMBERS || '3');
          if (memberCount <= minRoomMembers) {
            console.log(`Skipping room ${room.roomId} - only ${memberCount} members`);
            roomsSkipped++;
            continue;
          }

          // Check existing room
          const existingRoom = await this.prisma.matrixRoom.findUnique({
            where: { roomId: room.roomId },
          });

          // Smart sync logic: skip if member count hasn't changed
          if (existingRoom && !isRapidManualSync) {
            if (existingRoom.memberCount === memberCount) {
              console.log(`Skipping room ${room.roomId} - member count unchanged`);
              roomsSkipped++;
              continue;
            }
          }

          // Update or create room
          await this.prisma.matrixRoom.upsert({
            where: { roomId: room.roomId },
            update: {
              name: room.name,
              topic: room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic || '',
              memberCount: memberCount,
              lastSynced: new Date(),
            },
            create: {
              roomId: room.roomId,
              name: room.name,
              topic: room.currentState.getStateEvents('m.room.topic', '')?.getContent()?.topic || '',
              memberCount: memberCount,
              isDirect: room.getMyMembership() === 'join' && memberCount === 2,
              lastSynced: new Date(),
            },
          });

          roomsSync++;

          // Commit every 10 rooms
          if (roomsSync % 10 === 0) {
            console.log(`Synced ${roomsSync} rooms so far...`);
          }

        } catch (error) {
          console.error(`Error syncing room ${room.roomId}:`, error);
          continue;
        }
      }

      console.log(`Room sync completed: ${roomsSync} synced, ${roomsSkipped} skipped`);
      return { roomsSync };

    } catch (error) {
      console.error('Error in syncRooms:', error);
      return { roomsSync: 0 };
    }
  }

  private async syncUsersAndMemberships(client: MatrixClient | null, isRapidManualSync: boolean): Promise<{ usersSync?: number; membershipsSync?: number }> {
    if (!client) {
      // Mock implementation for now
      return { usersSync: 0, membershipsSync: 0 };
    }

    try {
      // Get all rooms to sync memberships for
      const rooms = await this.prisma.matrixRoom.findMany();
      
      let usersSync = 0;
      let membershipsSync = 0;
      let roomsSkipped = 0;

      for (const room of rooms) {
        try {
          const minRoomMembers = parseInt(process.env.MATRIX_MIN_ROOM_MEMBERS || '3');
          if (room.memberCount <= minRoomMembers) {
            console.log(`Skipping membership sync for ${room.roomId} - only ${room.memberCount} members`);
            roomsSkipped++;
            continue;
          }

          // Get current membership count from database
          const currentDbCount = await this.prisma.matrixRoomMembership.count({
            where: { roomId: room.roomId },
          });

          // Smart sync logic: skip if member count matches and not rapid manual sync
          if (!isRapidManualSync && room.memberCount === currentDbCount) {
            console.log(`Skipping membership sync for ${room.roomId} - count unchanged`);
            roomsSkipped++;
            continue;
          }

          // Get room from Matrix client
          const matrixRoom = client.getRoom(room.roomId);
          if (!matrixRoom) continue;

          // Get room members
          const members = matrixRoom.getMembers();

          // Clear existing memberships for this room
          await this.prisma.matrixRoomMembership.deleteMany({
            where: { roomId: room.roomId },
          });

          // Process each member
          for (const member of members) {
            if (member.membership !== 'join') continue;

            // Get homeserver URL for avatar URL generation
            const config = matrixService.getConfig();
            const homeserverUrl = config?.homeserver || '';

            // Update or create user
            await this.prisma.matrixUser.upsert({
              where: { userId: member.userId },
              update: {
                displayName: member.name || member.userId,
                avatarUrl: member.getAvatarUrl(homeserverUrl, 64, 64, 'scale', false, false) || null,
                lastSeen: new Date(),
              },
              create: {
                userId: member.userId,
                displayName: member.name || member.userId,
                avatarUrl: member.getAvatarUrl(homeserverUrl, 64, 64, 'scale', false, false) || null,
                isSignalUser: member.userId.includes('signal_'),
                lastSeen: new Date(),
              },
            });

            // Create membership record
            await this.prisma.matrixRoomMembership.create({
              data: {
                roomId: room.roomId,
                userId: member.userId,
                membershipStatus: 'join',
                joinedAt: new Date(),
              },
            });

            membershipsSync++;
          }

          // Update room member count
          await this.prisma.matrixRoom.update({
            where: { roomId: room.roomId },
            data: {
              memberCount: members.length,
              lastSynced: new Date(),
            },
          });

          usersSync += members.length;

        } catch (error) {
          console.error(`Error syncing memberships for room ${room.roomId}:`, error);
          continue;
        }
      }

      console.log(`User/membership sync completed: ${usersSync} users, ${membershipsSync} memberships, ${roomsSkipped} rooms skipped`);
      return { usersSync, membershipsSync };

    } catch (error) {
      console.error('Error in syncUsersAndMemberships:', error);
      return { usersSync: 0, membershipsSync: 0 };
    }
  }

  private async updateUserCache(): Promise<{ cacheUpdated?: number }> {
    try {
      // Clear existing cache
      await this.prisma.matrixUserCache.deleteMany();

      // Get all users with their room memberships
      const users = await this.prisma.matrixUser.findMany({
        include: {
          memberships: {
            include: {
              room: true,
            },
          },
        },
      });

      let cacheUpdated = 0;
      for (const user of users) {
        await this.prisma.matrixUserCache.create({
          data: {
            userId: user.userId,
            displayName: user.displayName || '',
            roomCount: user.memberships.length,
            isSignalUser: user.userId.startsWith('@signal_'),
          },
        });
        cacheUpdated++;
      }

      console.log(`User cache updated: ${cacheUpdated} entries`);
      return { cacheUpdated };

    } catch (error) {
      console.error('Error updating user cache:', error);
      return { cacheUpdated: 0 };
    }
  }

  async getCachedUsers(signalOnly: boolean = false): Promise<MatrixUserData[]> {
    try {
      const users = await this.prisma.matrixUserCache.findMany({
        where: signalOnly ? { isSignalUser: true } : {},
        orderBy: { displayName: 'asc' },
      });

      return users.map((user: any) => ({
        user_id: user.userId,
        display_name: user.displayName,
        is_signal_user: user.isSignalUser,
      }));

    } catch (error) {
      console.error('Error getting cached users:', error);
      return [];
    }
  }

  // Get users from priority rooms (mod, action, entry rooms)
  async getUsersFromPriorityRooms(): Promise<MatrixUserData[]> {
    try {
      const priorityRoomNames = ['mod', 'action', 'entry', 'welcome', 'general', 'main', 'lobby'];
      
      // Get priority rooms
      const priorityRooms = await this.prisma.matrixRoom.findMany({
        where: {
          OR: priorityRoomNames.map(name => ({
            name: { contains: name, mode: 'insensitive' }
          }))
        },
        orderBy: { memberCount: 'desc' },
      });

      if (priorityRooms.length === 0) {
        console.log('No priority rooms found, falling back to all users');
        return this.getCachedUsers();
      }

      // Get users from these priority rooms
      const roomIds = priorityRooms.map((room: any) => room.roomId);
      const memberships = await this.prisma.matrixRoomMembership.findMany({
        where: {
          roomId: { in: roomIds },
          membershipStatus: 'join',
        },
        include: {
          user: true,
        },
      });

      // Deduplicate users and prioritize by room priority
      const userMap = new Map<string, MatrixUserData>();
      
      for (const membership of memberships) {
        const user = membership.user;
        if (!userMap.has(user.userId)) {
          userMap.set(user.userId, {
            user_id: user.userId,
            display_name: user.displayName || user.userId,
            is_signal_user: user.isSignalUser,
          });
        }
      }

      const users = Array.from(userMap.values());
      
      // Sort users: Signal users first, then by display name
      users.sort((a, b) => {
        if (a.is_signal_user && !b.is_signal_user) return -1;
        if (!a.is_signal_user && b.is_signal_user) return 1;
        return (a.display_name || '').localeCompare(b.display_name || '');
      });

      console.log(`Found ${users.length} users from ${priorityRooms.length} priority rooms`);
      return users;

    } catch (error) {
      console.error('Error getting users from priority rooms:', error);
      return this.getCachedUsers();
    }
  }

  async getCachedRooms(): Promise<MatrixRoomData[]> {
    try {
      const rooms = await this.prisma.matrixRoom.findMany({
        orderBy: { memberCount: 'desc' },
      });

      return rooms.map((room: any) => ({
        room_id: room.roomId,
        name: room.name || '',
        topic: room.topic || '',
        member_count: room.memberCount,
        is_direct: room.isDirect,
        room_type: room.roomType || '',
      }));

    } catch (error) {
      console.error('Error getting cached rooms:', error);
      return [];
    }
  }

  async getUsersInRoom(roomId: string): Promise<{ user_id: string; display_name: string }[]> {
    try {
      const memberships = await this.prisma.matrixRoomMembership.findMany({
        where: { 
          roomId: roomId,
          membershipStatus: 'join',
        },
        include: {
          user: true,
        },
      });

      return memberships.map((membership: any) => ({
        user_id: membership.user.userId,
        display_name: membership.user.displayName || membership.user.userId.split(':')[0].substring(1),
      }));

    } catch (error) {
      console.error(`Error getting users in room ${roomId}:`, error);
      return [];
    }
  }

  async getSyncStatus(): Promise<any> {
    try {
      const latestSync = await this.prisma.matrixSyncStatus.findFirst({
        orderBy: { createdAt: 'desc' },
      });

      if (!latestSync) return null;

      return {
        status: latestSync.status,
        last_sync: latestSync.lastSync,
        processed_items: latestSync.processedItems,
        error_message: latestSync.errorMessage,
      };

    } catch (error) {
      console.error('Error getting sync status:', error);
      return null;
    }
  }

  private async isCacheFresh(maxAgeMinutes: number = 60): Promise<boolean> {
    try {
      const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
      
      const recentSync = await this.prisma.matrixSyncStatus.findFirst({
        where: {
          status: 'completed',
          lastSync: {
            gte: cutoffTime,
          },
        },
      });

      return recentSync !== null;

    } catch (error) {
      console.error('Error checking cache freshness:', error);
      return false;
    }
  }

  async backgroundSync(maxAgeMinutes: number = 30): Promise<void> {
    try {
      if (!(await this.isCacheFresh(maxAgeMinutes))) {
        console.log('Cache is stale, starting background sync');
        const result = await this.fullSync(false);
        console.log('Background sync completed:', result);
      } else {
        console.log('Cache is fresh, skipping background sync');
      }
    } catch (error) {
      console.error('Error in background sync:', error);
    }
  }

  async startupSync(): Promise<SyncResult> {
    try {
      // Check if we need to sync at startup
      if (await this.isCacheFresh(10)) {
        console.log('Cache is fresh at startup, skipping sync');
        return { status: 'skipped', reason: 'cache_fresh_at_startup' };
      }

      // Check if we have any cached data at all
      const userCount = await this.prisma.matrixUserCache.count();
      if (userCount === 0) {
        console.log('No cached data found, performing initial sync');
        return await this.fullSync(true);
      }

      // Cache exists but is stale, perform background sync
      console.log('Cache is stale at startup, performing background sync');
      return await this.fullSync(false);

    } catch (error) {
      console.error('Error in startup sync:', error);
      return { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}

// Export singleton instance
export const matrixSyncService = new MatrixSyncService();