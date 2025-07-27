import { matrixSyncService } from '@/lib/matrix-sync';
import { PrismaClient } from '@prisma/client';

// Mock Prisma
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    matrixUser: {
      count: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    matrixRoom: {
      count: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    matrixRoomMembership: {
      count: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    $disconnect: jest.fn(),
  })),
}));

// Mock fetch for Matrix API calls
global.fetch = jest.fn();

// Mock environment variables
const mockEnv = {
  MATRIX_HOMESERVER: 'https://matrix.org',
  MATRIX_ACCESS_TOKEN: 'test_token',
  MATRIX_DEFAULT_ROOM_ID: '!test:matrix.org',
  MATRIX_WELCOME_ROOM_ID: '!welcome:matrix.org',
  MATRIX_SIGNAL_BRIDGE_ROOM_ID: '!signal:matrix.org',
  MATRIX_INDOC_ROOM_ID: '!indoc:matrix.org',
};

describe('Matrix Sync Service', () => {
  let mockPrisma: jest.Mocked<PrismaClient>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup environment variables
    Object.entries(mockEnv).forEach(([key, value]) => {
      process.env[key] = value;
    });
    
    // Create mock Prisma instance
    mockPrisma = new PrismaClient() as jest.Mocked<PrismaClient>;
  });

  afterEach(() => {
    // Clean up environment variables
    Object.keys(mockEnv).forEach(key => {
      delete process.env[key];
    });
  });

  describe('fullSync', () => {
    it('should return skipped status when sync is in progress', async () => {
      // First call starts sync
      const syncPromise1 = matrixSyncService.fullSync(false);
      
      // Second call should be skipped
      const result2 = await matrixSyncService.fullSync(false);
      
      expect(result2.status).toBe('skipped');
      expect(result2.reason).toBe('sync_in_progress');
      
      // Wait for first sync to complete
      await syncPromise1;
    });

    it('should successfully sync users from Matrix API', async () => {
      // Mock successful API responses
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            joined_rooms: ['!room1:matrix.org', '!room2:matrix.org']
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            chunk: [
              {
                state_key: '@user1:matrix.org',
                content: { membership: 'join', displayname: 'User One' }
              },
              {
                state_key: '@signal_123:matrix.org',
                content: { membership: 'join', displayname: 'Signal User' }
              }
            ]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            chunk: [
              {
                state_key: '@user2:matrix.org',
                content: { membership: 'join', displayname: 'User Two' }
              }
            ]
          })
        });

      // Mock Prisma responses
      mockPrisma.matrixUser.upsert.mockResolvedValue({} as any);
      mockPrisma.matrixRoom.findMany.mockResolvedValue([]);

      const result = await matrixSyncService.fullSync(true);

      expect(result.status).toBe('success');
      expect(mockPrisma.matrixUser.upsert).toHaveBeenCalledTimes(3);
      
      // Verify Signal user detection
      expect(mockPrisma.matrixUser.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            userId: '@signal_123:matrix.org',
            isSignalUser: true
          })
        })
      );
    });

    it('should handle API errors gracefully', async () => {
      // Mock failed API response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Unauthorized'
      });

      mockPrisma.matrixRoom.findMany.mockResolvedValue([]);

      const result = await matrixSyncService.fullSync(true);

      expect(result.status).toBe('partial_success');
      expect(result.error).toContain('User sync failed');
    });

    it('should sync room metadata correctly', async () => {
      // Mock joined rooms API response
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            joined_rooms: ['!room1:matrix.org']
          })
        })
        // Mock room state API response
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([
            {
              type: 'm.room.name',
              content: { name: 'Test Room' }
            },
            {
              type: 'm.room.topic',
              content: { topic: 'This is a test room' }
            },
            {
              type: 'm.room.member',
              content: { membership: 'join' }
            },
            {
              type: 'm.room.member',
              content: { membership: 'join' }
            }
          ])
        });

      mockPrisma.matrixRoom.upsert.mockResolvedValue({} as any);
      mockPrisma.matrixRoom.findMany.mockResolvedValue([]);

      const result = await matrixSyncService.fullSync(true);

      expect(mockPrisma.matrixRoom.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            roomId: '!room1:matrix.org',
            name: 'Test Room',
            topic: 'This is a test room',
            memberCount: 2,
            isPriorityRoom: false
          })
        })
      );
    });

    it('should identify priority rooms correctly', async () => {
      // Mock joined rooms API response with priority room
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            joined_rooms: ['!test:matrix.org'] // This matches MATRIX_DEFAULT_ROOM_ID
          })
        })
        // Mock room state API response
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([
            {
              type: 'm.room.name',
              content: { name: 'Priority Room' }
            }
          ])
        });

      mockPrisma.matrixRoom.upsert.mockResolvedValue({} as any);
      mockPrisma.matrixRoom.findMany.mockResolvedValue([]);

      const result = await matrixSyncService.fullSync(true);

      expect(mockPrisma.matrixRoom.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            roomId: '!test:matrix.org',
            isPriorityRoom: true
          })
        })
      );
    });

    it('should sync memberships and handle cleanup', async () => {
      // Skip initial user/room sync
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ joined_rooms: [] })
        });

      // Mock tracked rooms
      mockPrisma.matrixRoom.findMany.mockResolvedValue([
        { roomId: '!room1:matrix.org' }
      ] as any);

      // Mock members API response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          chunk: [
            {
              state_key: '@user1:matrix.org',
              content: {
                membership: 'join',
                displayname: 'User One',
                avatar_url: 'mxc://matrix.org/avatar1'
              }
            }
          ]
        })
      });

      mockPrisma.matrixUser.upsert.mockResolvedValue({} as any);
      mockPrisma.matrixRoomMembership.upsert.mockResolvedValue({} as any);
      mockPrisma.matrixRoomMembership.deleteMany.mockResolvedValue({ count: 0 });

      const result = await matrixSyncService.fullSync(true);

      expect(mockPrisma.matrixRoomMembership.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            roomId: '!room1:matrix.org',
            userId: '@user1:matrix.org',
            membershipStatus: 'join',
            displayName: 'User One',
            avatarUrl: 'mxc://matrix.org/avatar1'
          })
        })
      );

      // Verify cleanup is called
      expect(mockPrisma.matrixRoomMembership.deleteMany).toHaveBeenCalled();
    });

    it('should handle rapid sync prevention', async () => {
      // Mock a recent manual sync
      await matrixSyncService.fullSync(false);
      
      // Immediate second sync should be prevented
      const result = await matrixSyncService.fullSync(false);
      
      expect(result.status).toBe('skipped');
      expect(result.reason).toBe('rate_limited');
    });
  });

  describe('getUsersFromPriorityRooms', () => {
    it('should return users from INDOC room when available', async () => {
      const mockUsers = [
        {
          userId: '@user1:matrix.org',
          displayName: 'User One',
          isSignalUser: false
        },
        {
          userId: '@signal_123:matrix.org',
          displayName: 'Signal User',
          isSignalUser: true
        }
      ];

      mockPrisma.matrixRoom.findUnique.mockResolvedValue({
        roomId: '!indoc:matrix.org'
      } as any);

      mockPrisma.matrixRoomMembership.findMany.mockResolvedValue([
        {
          user: mockUsers[0],
          membershipStatus: 'join'
        },
        {
          user: mockUsers[1],
          membershipStatus: 'join'
        }
      ] as any);

      const result = await matrixSyncService.getUsersFromPriorityRooms();

      expect(result).toHaveLength(2);
      expect(result[0].userId).toBe('@user1:matrix.org');
      expect(result[1].isSignalUser).toBe(true);
    });
  });
});