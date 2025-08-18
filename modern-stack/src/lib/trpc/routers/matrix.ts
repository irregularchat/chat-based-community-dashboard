import { z } from 'zod';
import { createTRPCRouter, adminProcedure, moderatorProcedure } from '../trpc';
import { matrixService } from '@/lib/matrix';
import { createMatrixCacheService } from '@/lib/matrix-cache';
import { logCommunityEvent, getCategoryForEventType } from '@/lib/community-timeline';

// Define Matrix-related schemas
const _MatrixUserSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
  avatar_url: z.string().optional(),
  is_signal_user: z.boolean().optional(),
});

const _MatrixRoomSchema = z.object({
  room_id: z.string(),
  name: z.string().optional(),
  topic: z.string().optional(),
  member_count: z.number().optional(),
  category: z.string().optional(),
  configured: z.boolean().optional(),
});

const _MessageHistorySchema = z.object({
  sender: z.string(),
  content: z.string(),
  timestamp: z.string(),
  event_id: z.string().optional(),
});

// Helper function to determine room category based on room name/topic
function getRoomCategory(roomName: string): string {
  const name = roomName.toLowerCase();
  if (name.includes('general') || name.includes('main') || name.includes('lobby')) {
    return 'General';
  } else if (name.includes('tech') || name.includes('dev') || name.includes('programming') || name.includes('code')) {
    return 'Technology';
  } else if (name.includes('social') || name.includes('chat') || name.includes('casual')) {
    return 'Social';
  } else if (name.includes('support') || name.includes('help') || name.includes('questions')) {
    return 'Support';
  } else if (name.includes('off') || name.includes('random') || name.includes('misc')) {
    return 'Off-topic';
  }
  return 'Uncategorized';
}

export const matrixRouter = createTRPCRouter({
  // Get Matrix configuration status
  getConfig: moderatorProcedure.query(async ({ ctx: _ctx }) => {
    const config = matrixService.getConfig();
    if (!config) {
      return null;
    }
    
    return {
      homeserver: config.homeserver,
      userId: config.userId,
      isConfigured: matrixService.isConfigured(),
    };
  }),

  // Get list of Matrix users from cache
  getUsers: moderatorProcedure
    .input(
      z.object({
        search: z.string().optional(),
        includeSignalUsers: z.boolean().default(true),
        includeRegularUsers: z.boolean().default(true),
        limit: z.number().default(100),
        offset: z.number().default(0),
        priorityRoomsOnly: z.boolean().default(true), // Default to priority rooms for user selection
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        // Import the Matrix sync service for priority room users
        const { matrixSyncService } = await import('@/lib/matrix-sync');
        
        let users: unknown[] = [];
        
        if (input.priorityRoomsOnly) {
          // Get users from priority rooms (mod, action, entry rooms)
          users = await matrixSyncService.getUsersFromPriorityRooms();
        } else {
          // Get all cached users
          const cacheService = createMatrixCacheService(ctx.prisma);
          users = await cacheService.getCachedUsers({
            search: input.search,
            includeSignalUsers: input.includeSignalUsers,
            includeRegularUsers: input.includeRegularUsers,
            limit: input.limit,
            offset: input.offset,
          });
        }

        // Apply filters
        if (!input.includeSignalUsers) {
          users = users.filter(user => !(user as Record<string, unknown>).is_signal_user);
        }
        if (!input.includeRegularUsers) {
          users = users.filter(user => (user as Record<string, unknown>).is_signal_user);
        }

        // Apply search filter
        if (input.search) {
          const searchLower = input.search.toLowerCase();
          users = users.filter(user => 
            user.user_id.toLowerCase().includes(searchLower) ||
            (user.display_name || '').toLowerCase().includes(searchLower)
          );
        }

        // Apply pagination
        const startIndex = input.offset;
        const endIndex = startIndex + input.limit;
        users = users.slice(startIndex, endIndex);

        // Convert to expected format and enhance Signal user display names
        const formattedUsers = await Promise.all(users.map(async (user) => {
          let displayName = user.display_name || user.user_id;
          
          // If this is a Signal user and we have a phone number configured, get enhanced display name
          if ((user as Record<string, unknown>).is_signal_user && process.env.SIGNAL_PHONE_NUMBER) {
            try {
              const { enhancedSignalClient } = await import('@/lib/signal/enhanced-api-client');
              enhancedSignalClient.setPhoneNumber(process.env.SIGNAL_PHONE_NUMBER);
              
              // Try to get enhanced display name from Signal profile
              const enhancedDisplayName = enhancedSignalClient.getDisplayName(user.user_id);
              
              // Only use enhanced name if it's different from the formatted phone number pattern
              if (enhancedDisplayName && 
                  enhancedDisplayName !== user.user_id && 
                  !enhancedDisplayName.match(/^\(\d{3}\) \d{3}-\d{4}$/) &&
                  !enhancedDisplayName.startsWith('User ')) {
                displayName = enhancedDisplayName;
              }
            } catch (error) {
              console.error('Error getting enhanced Signal display name:', error);
              // Fall back to original display_name
            }
          }
          
          return {
            user_id: user.user_id,
            display_name: displayName,
            avatar_url: user.avatar_url,
            is_signal_user: (user as Record<string, unknown>).is_signal_user as boolean | undefined,
          };
        }));

        return formattedUsers;
      } catch (error) {
        console.error('Error fetching Matrix users:', error);
        return [];
      }
    }),

  // Sync Matrix users to cache
  syncMatrixUsers: moderatorProcedure.mutation(async ({ ctx: _ctx }) => {
    try {
      if (!matrixService.isConfigured()) {
        throw new Error('Matrix service not configured');
      }

      const cacheService = createMatrixCacheService(ctx.prisma);
      const result = await cacheService.incrementalSync();

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'matrix_sync',
          username: ctx.session.user.username || 'unknown',
          details: `Matrix user sync completed. Users: ${result.usersSynced || 0}, Rooms: ${result.roomsSynced || 0}`,
        },
      });

      return { 
        success: true, 
        message: 'Matrix user sync completed',
        usersSynced: result.usersSynced || 0,
        roomsSynced: result.roomsSynced || 0,
      };
    } catch (error) {
      console.error('Error syncing Matrix users:', error);
      throw new Error('Failed to sync Matrix users');
    }
  }),

  // Get list of Matrix rooms from cache and Matrix API
  getRooms: moderatorProcedure
    .input(
      z.object({
        category: z.string().optional(),
        search: z.string().optional(),
        includeConfigured: z.boolean().default(true),
        includeDiscovered: z.boolean().default(true),
        limit: z.number().default(100),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const cacheService = createMatrixCacheService(ctx.prisma);
        let rooms: unknown[] = [];
        
        // Get environment-configured rooms (from .env file)
        if (input.includeConfigured) {
          const envRooms = matrixService.parseRooms();
          const envCategories = matrixService.parseCategories();
          
          for (const envRoom of envRooms) {
            // Map categories to display names
            const categoryDisplayNames = envRoom.categories.map(cat => 
              envCategories[cat]?.displayName || cat
            );
            
            rooms.push({
              room_id: envRoom.matrixRoomId,
              name: envRoom.name,
              topic: envRoom.description,
              member_count: 0, // Unknown member count for env rooms
              category: categoryDisplayNames.join(', ') || 'General',
              configured: true,
            });
          }
        }
        
        // Get rooms from database cache if Matrix is configured
        if (matrixService.isConfigured() && input.includeDiscovered) {
          const cachedRooms = await cacheService.getCachedRooms({
            search: input.search,
            includeDirectRooms: false,
            limit: input.limit,
            offset: input.offset,
          });

          const cacheRoomData = cachedRooms.map(room => ({
            room_id: room.roomId,
            name: room.displayName || room.name || room.roomId,
            topic: room.topic,
            member_count: room.memberCount,
            category: getRoomCategory(room.displayName || room.name || ''),
            configured: false, // These are discovered rooms
          }));

          // Merge with env rooms, avoiding duplicates
          const envRoomIds = new Set(rooms.map(r => r.room_id));
          const newCacheRooms = cacheRoomData.filter(r => !envRoomIds.has(r.room_id));
          rooms = [...rooms, ...newCacheRooms];
        }

        // Apply search filter
        if (input.search) {
          const searchLower = input.search.toLowerCase();
          rooms = rooms.filter(room => 
            room.name.toLowerCase().includes(searchLower) ||
            (room.topic || '').toLowerCase().includes(searchLower) ||
            (room.category || '').toLowerCase().includes(searchLower)
          );
        }

        // Apply category filter
        if (input.category) {
          rooms = rooms.filter(room => 
            room.category && room.category.toLowerCase().includes(input.category!.toLowerCase())
          );
        }

        // Sort by configured status first, then by name
        rooms.sort((a, b) => {
          if (a.configured && !b.configured) return -1;
          if (!a.configured && b.configured) return 1;
          return a.name.localeCompare(b.name);
        });

        // Apply pagination
        const startIndex = input.offset;
        const endIndex = startIndex + input.limit;
        rooms = rooms.slice(startIndex, endIndex);

        return rooms;
      } catch (error) {
        console.error('Error fetching Matrix rooms:', error);
        return [];
      }
    }),

  // Get room categories
  getCategories: moderatorProcedure.query(async ({ ctx: _ctx }) => {
    try {
      // Get environment-configured categories
      const envCategories = matrixService.parseCategories();
      const categoryNames = Object.values(envCategories).map(cat => cat.displayName);
      
      // Add default categories
      const defaultCategories = ['General', 'Technology', 'Social', 'Support', 'Off-topic', 'Uncategorized'];
      
      // Combine and deduplicate
      const allCategories = [...new Set([...categoryNames, ...defaultCategories])];
      
      return allCategories.sort();
    } catch (error) {
      console.error('Error fetching categories:', error);
      return ['General', 'Technology', 'Social', 'Support', 'Off-topic', 'Uncategorized'];
    }
  }),

  // Send direct message to a user
  sendDirectMessage: moderatorProcedure
    .input(
      z.object({
        userId: z.string(),
        message: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await matrixService.sendDirectMessage(input.userId, input.message);
        
        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'matrix_direct_message',
            username: ctx.session.user.username || 'unknown',
            details: `Sent direct message to ${input.userId}: ${result.success ? 'Success' : result.error}`,
          },
        });

        // Log community timeline event
        if (result.success) {
          const displayName = input.userId.split(':')[0].replace('@', '');
          await logCommunityEvent({
            eventType: 'direct_message',
            username: ctx.session.user.username || 'unknown',
            details: `Sent direct message to ${displayName}`,
            category: getCategoryForEventType('direct_message'),
          });
        }

        return result;
      } catch (error) {
        console.error('Error sending direct message:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
      }
    }),

  // Send message to multiple users (enhanced with bulk operations)
  sendMessageToUsers: moderatorProcedure
    .input(
      z.object({
        userIds: z.array(z.string()),
        message: z.string(),
        batchSize: z.number().default(10),
        delayMs: z.number().default(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (matrixService.isConfigured()) {
        // Use the new bulk operation
        const result = await matrixService.bulkSendDirectMessages(
          input.userIds,
          input.message,
          input.batchSize,
          input.delayMs
        );

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'matrix_bulk_message',
            username: ctx.session.user.username || 'unknown',
            details: `Bulk sent messages to ${input.userIds.length} users. Success: ${result.totalSuccess}, Failed: ${result.totalFailed}`,
          },
        });

        return {
          results: result.results,
          errors: result.errors,
          totalSent: result.totalSuccess,
          totalFailed: result.totalFailed,
          batchesProcessed: Math.ceil(input.userIds.length / input.batchSize),
        };
      } else {
        // Mock implementation when Matrix is not configured
        const results: Record<string, boolean> = {};
        const errors: Record<string, string> = {};
        
        for (const userId of input.userIds) {
          console.log(`[MOCK] Sending message to ${userId}: ${input.message}`);
          results[userId] = Math.random() > 0.1;
          if (!results[userId]) {
            errors[userId] = 'Mock failure for demo';
          }
        }

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'matrix_bulk_message',
            username: ctx.session.user.username || 'unknown',
            details: `Mock bulk sent messages to ${input.userIds.length} users`,
          },
        });

        return {
          results,
          errors,
          totalSent: Object.values(results).filter(Boolean).length,
          totalFailed: Object.values(results).filter(success => !success).length,
          batchesProcessed: Math.ceil(input.userIds.length / input.batchSize),
        };
      }
    }),

  // Send message to rooms (enhanced with bulk operations)
  sendMessageToRooms: moderatorProcedure
    .input(
      z.object({
        roomIds: z.array(z.string()),
        message: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (matrixService.isConfigured()) {
        // Use the new bulk operation
        const result = await matrixService.bulkSendRoomMessages(input.roomIds, input.message);

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'matrix_room_message',
            username: ctx.session.user.username || 'unknown',
            details: `Bulk sent messages to ${input.roomIds.length} rooms. Success: ${result.totalSuccess}, Failed: ${result.totalFailed}`,
          },
        });

        return {
          results: result.results,
          errors: result.errors,
          totalSent: result.totalSuccess,
          totalFailed: result.totalFailed,
        };
      } else {
        // Mock implementation
        const results: Record<string, boolean> = {};
        const errors: Record<string, string> = {};
        
        for (const roomId of input.roomIds) {
          console.log(`[MOCK] Sending message to room ${roomId}: ${input.message}`);
          results[roomId] = Math.random() > 0.05;
          if (!results[roomId]) {
            errors[roomId] = 'Mock failure for demo';
          }
        }

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'matrix_room_message',
            username: ctx.session.user.username || 'unknown',
            details: `Mock bulk sent messages to ${input.roomIds.length} rooms`,
          },
        });

        return {
          results,
          errors,
          totalSent: Object.values(results).filter(Boolean).length,
          totalFailed: Object.values(results).filter(success => !success).length,
        };
      }
    }),

  // Invite user to rooms
  inviteUserToRooms: moderatorProcedure
    .input(
      z.object({
        userId: z.string(),
        roomIds: z.array(z.string()),
        sendWelcome: z.boolean().default(false),
        welcomeMessage: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const results: Record<string, boolean> = {};
      const errors: Record<string, string> = {};
      
      if (matrixService.isConfigured()) {
        // Use real Matrix service
        for (const roomId of input.roomIds) {
          try {
            const success = await matrixService.inviteToRoom(roomId, input.userId);
            results[roomId] = success;
            if (!success) {
              errors[roomId] = 'Failed to invite user to room';
            }
          } catch (error) {
            console.error(`Failed to invite ${input.userId} to room ${roomId}:`, error);
            results[roomId] = false;
            errors[roomId] = error instanceof Error ? error.message : 'Unknown error';
          }
        }

        // Send welcome message if requested and at least one invitation succeeded
        if (input.sendWelcome && input.welcomeMessage && Object.values(results).some(Boolean)) {
          try {
            await matrixService.sendDirectMessage(input.userId, input.welcomeMessage);
          } catch (error) {
            console.error(`Failed to send welcome message to ${input.userId}:`, error);
          }
        }
      } else {
        // Mock implementation when Matrix is not configured
        for (const roomId of input.roomIds) {
          console.log(`[MOCK] Inviting ${input.userId} to room ${roomId}`);
          results[roomId] = Math.random() > 0.1;
          if (!results[roomId]) {
            errors[roomId] = 'Mock failure for demo';
          }
        }

        if (input.sendWelcome && input.welcomeMessage) {
          console.log(`[MOCK] Sending welcome message to ${input.userId}: ${input.welcomeMessage}`);
        }
      }

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'matrix_user_invite',
          username: ctx.session.user.username || 'unknown',
          details: `Invited ${input.userId} to ${input.roomIds.length} rooms. Success: ${Object.values(results).filter(Boolean).length}, Failed: ${Object.values(results).filter(success => !success).length}`,
        },
      });

      return {
        results,
        errors,
        totalInvited: Object.values(results).filter(Boolean).length,
        totalFailed: Object.values(results).filter(success => !success).length,
      };
    }),

  // Remove user from rooms
  removeUserFromRooms: moderatorProcedure
    .input(
      z.object({
        userId: z.string(),
        roomIds: z.array(z.string()),
        reason: z.string().optional(),
        sendMessage: z.boolean().default(false),
        message: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const results: Record<string, boolean> = {};
      const errors: Record<string, string> = {};
      
      if (matrixService.isConfigured()) {
        // Send message to rooms before removal if requested
        if (input.sendMessage && input.message) {
          for (const roomId of input.roomIds) {
            try {
              await matrixService.sendRoomMessage(roomId, input.message);
            } catch (error) {
              console.error(`Failed to send removal message to room ${roomId}:`, error);
            }
          }
        }

        // Remove user from rooms
        for (const roomId of input.roomIds) {
          try {
            const success = await matrixService.removeFromRoom(roomId, input.userId, input.reason);
            results[roomId] = success;
            if (!success) {
              errors[roomId] = 'Failed to remove user from room';
            }
          } catch (error) {
            console.error(`Failed to remove ${input.userId} from room ${roomId}:`, error);
            results[roomId] = false;
            errors[roomId] = error instanceof Error ? error.message : 'Unknown error';
          }
        }
      } else {
        // Mock implementation when Matrix is not configured
        if (input.sendMessage && input.message) {
          for (const roomId of input.roomIds) {
            console.log(`[MOCK] Sending removal message to room ${roomId}: ${input.message}`);
          }
        }

        for (const roomId of input.roomIds) {
          console.log(`[MOCK] Removing ${input.userId} from room ${roomId}`);
          results[roomId] = Math.random() > 0.05;
          if (!results[roomId]) {
            errors[roomId] = 'Mock failure for demo';
          }
        }
      }

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'matrix_user_removal',
          username: ctx.session.user.username || 'unknown',
          details: `Removed ${input.userId} from ${input.roomIds.length} rooms. Success: ${Object.values(results).filter(Boolean).length}, Failed: ${Object.values(results).filter(success => !success).length}`,
        },
      });

      return {
        results,
        errors,
        totalRemoved: Object.values(results).filter(Boolean).length,
        totalFailed: Object.values(results).filter(success => !success).length,
      };
    }),

  // Get direct message history with a user
  getMessageHistory: moderatorProcedure
    .input(
      z.object({
        userId: z.string(),
        limit: z.number().default(20),
      })
    )
    .query(async ({ ctx, input }) => {
      // Mock data for demonstration - in real implementation, this would call Matrix API
      const mockHistory = [
        {
          sender: ctx.session.user.username || 'admin',
          content: 'Hello! Welcome to the community.',
          timestamp: new Date(Date.now() - 3600000).toISOString(),
          event_id: '$event_1',
        },
        {
          sender: input.userId,
          content: 'Thank you! Happy to be here.',
          timestamp: new Date(Date.now() - 3000000).toISOString(),
          event_id: '$event_2',
        },
        {
          sender: ctx.session.user.username || 'admin',
          content: 'Let me know if you have any questions.',
          timestamp: new Date(Date.now() - 1800000).toISOString(),
          event_id: '$event_3',
        },
      ];

      return mockHistory.slice(-input.limit);
    }),

  // Get user categories (saved user groups)
  getUserCategories: moderatorProcedure.query(async ({ ctx: _ctx }) => {
    // In real implementation, this would be stored in the database
    return {
      'New Members': [
        '@alice:matrix.irregularchat.com',
        '@bob:matrix.irregularchat.com',
      ],
      'Moderators': [
        '@mod1:matrix.irregularchat.com',
        '@mod2:matrix.irregularchat.com',
      ],
      'Signal Users': [
        '@signal_12345:matrix.irregularchat.com',
        '@signal_67890:matrix.irregularchat.com',
      ],
    };
  }),

  // Enhanced bulk operations for Matrix user management
  bulkInviteToRecommendedRooms: moderatorProcedure
    .input(
      z.object({
        userIds: z.array(z.string()),
        interests: z.array(z.string()).optional(),
        sendWelcome: z.boolean().default(false),
        welcomeMessage: z.string().optional(),
        batchSize: z.number().default(5),
        delayMs: z.number().default(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const results: Record<string, { invitedRooms: string[]; errors: string[] }> = {};
      
      if (matrixService.isConfigured()) {
        // Process in batches to avoid overwhelming the Matrix server
        const batches = [];
        for (let i = 0; i < input.userIds.length; i += input.batchSize) {
          batches.push(input.userIds.slice(i, i + input.batchSize));
        }

        for (const [batchIndex, batch] of batches.entries()) {
          // Add delay between batches
          if (batchIndex > 0) {
            await new Promise(resolve => setTimeout(resolve, input.delayMs));
          }

          // Process batch in parallel
          const batchPromises = batch.map(async (userId) => {
            try {
              const result = await matrixService.inviteToRecommendedRooms(userId, input.interests || []);
              results[userId] = {
                invitedRooms: result.invitedRooms,
                errors: result.errors,
              };

              // Send welcome message if requested and invitations succeeded
              if (input.sendWelcome && input.welcomeMessage && result.invitedRooms.length > 0) {
                try {
                  await matrixService.sendDirectMessage(userId, input.welcomeMessage);
                } catch (error) {
                  console.error(`Failed to send welcome message to ${userId}:`, error);
                  results[userId].errors.push(`Failed to send welcome message: ${error}`);
                }
              }
            } catch (error) {
              console.error(`Failed to invite ${userId} to recommended rooms:`, error);
              results[userId] = {
                invitedRooms: [],
                errors: [error instanceof Error ? error.message : 'Unknown error'],
              };
            }
          });

          await Promise.all(batchPromises);
          console.log(`Completed bulk invite batch ${batchIndex + 1}/${batches.length}`);
        }
      } else {
        // Mock implementation
        for (const userId of input.userIds) {
          console.log(`[MOCK] Inviting ${userId} to recommended rooms based on interests:`, input.interests);
          results[userId] = {
            invitedRooms: ['!general:matrix.example.com', '!tech:matrix.example.com'],
            errors: [],
          };
        }
      }

      // Log admin event
      const totalInvited = Object.values(results).reduce((sum, result) => sum + result.invitedRooms.length, 0);
      const totalErrors = Object.values(results).reduce((sum, result) => sum + result.errors.length, 0);

      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'matrix_bulk_invite_recommended',
          username: ctx.session.user.username || 'unknown',
          details: `Bulk invited ${input.userIds.length} users to recommended rooms. Total invitations: ${totalInvited}, Errors: ${totalErrors}`,
        },
      });

      return {
        results,
        totalUsers: input.userIds.length,
        totalInvitations: totalInvited,
        totalErrors: totalErrors,
        batchesProcessed: Math.ceil(input.userIds.length / input.batchSize),
      };
    }),

  // Enhanced bulk invite to specific rooms
  bulkInviteToRooms: moderatorProcedure
    .input(
      z.object({
        userIds: z.array(z.string()),
        roomIds: z.array(z.string()),
        batchSize: z.number().default(5),
        delayMs: z.number().default(1000),
        sendWelcome: z.boolean().default(false),
        welcomeMessage: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (matrixService.isConfigured()) {
        // Use the new bulk operation
        const result = await matrixService.bulkInviteToRooms(
          input.userIds,
          input.roomIds,
          input.batchSize,
          input.delayMs
        );

        // Send welcome messages if requested
        if (input.sendWelcome && input.welcomeMessage) {
          const welcomeResults = await matrixService.bulkSendDirectMessages(
            input.userIds,
            input.welcomeMessage,
            input.batchSize,
            input.delayMs
          );
          console.log('Welcome messages sent:', welcomeResults);
        }

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'matrix_bulk_invite_rooms',
            username: ctx.session.user.username || 'unknown',
            details: `Bulk invited ${input.userIds.length} users to ${input.roomIds.length} rooms. Success: ${result.totalSuccess}, Failed: ${result.totalFailed}`,
          },
        });

        return {
          results: result.results,
          errors: result.errors,
          totalInvitations: result.totalSuccess,
          totalFailed: result.totalFailed,
          batchesProcessed: Math.ceil(input.userIds.length / input.batchSize),
        };
      } else {
        // Mock implementation
        const results: Record<string, boolean> = {};
        const errors: Record<string, string> = {};
        
        for (const userId of input.userIds) {
          for (const roomId of input.roomIds) {
            const key = `${userId}:${roomId}`;
            console.log(`[MOCK] Inviting ${userId} to room ${roomId}`);
            results[key] = Math.random() > 0.1;
            if (!results[key]) {
              errors[key] = 'Mock failure for demo';
            }
          }
        }

        return {
          results,
          errors,
          totalInvitations: Object.values(results).filter(Boolean).length,
          totalFailed: Object.values(results).filter(success => !success).length,
          batchesProcessed: Math.ceil(input.userIds.length / input.batchSize),
        };
      }
    }),

  // Get cache statistics
  getCacheStats: moderatorProcedure.query(async ({ ctx: _ctx }) => {
    try {
      const cacheService = createMatrixCacheService(ctx.prisma);
      const stats = await cacheService.getCacheStats();
      return stats;
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return null;
    }
  }),

  // Sync Matrix cache data (full sync)
  syncMatrixCache: moderatorProcedure
    .input(
      z.object({
        force: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (!matrixService.isConfigured()) {
          throw new Error('Matrix service not configured');
        }

        const cacheService = createMatrixCacheService(ctx.prisma);
        const result = await cacheService.fullSync(input.force);

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'matrix_cache_sync',
            username: ctx.session.user.username || 'unknown',
            details: `Matrix cache full sync ${result.status}. Users: ${result.usersSynced}, Rooms: ${result.roomsSynced}, Memberships: ${result.membershipsSynced}, Duration: ${result.duration}ms`,
          },
        });

        return result;
      } catch (error) {
        console.error('Error syncing Matrix cache:', error);
        throw new Error('Failed to sync Matrix cache');
      }
    }),

  // Trigger background cache sync
  triggerBackgroundSync: moderatorProcedure
    .input(
      z.object({
        maxAgeMinutes: z.number().default(30),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (!matrixService.isConfigured()) {
          throw new Error('Matrix service not configured');
        }

        const cacheService = createMatrixCacheService(ctx.prisma);
        
        // Trigger background sync (non-blocking)
        cacheService.backgroundSync(input.maxAgeMinutes);

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'matrix_background_sync',
            username: ctx.session.user.username || 'unknown',
            details: `Triggered Matrix background sync with max age ${input.maxAgeMinutes} minutes`,
          },
        });

        return { 
          success: true, 
          message: 'Background sync initiated',
          maxAgeMinutes: input.maxAgeMinutes,
        };
      } catch (error) {
        console.error('Error triggering background sync:', error);
        throw new Error('Failed to trigger background sync');
      }
    }),

  // Matrix health check
  getHealthStatus: moderatorProcedure.query(async ({ ctx: _ctx }) => {
    try {
      const cacheService = createMatrixCacheService(ctx.prisma);
      const health = await cacheService.healthCheck();
      return health;
    } catch (error) {
      console.error('Error getting Matrix health status:', error);
      return {
        status: 'unhealthy' as const,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }),

  // Detect and update Signal users
  detectSignalUsers: moderatorProcedure.mutation(async ({ ctx: _ctx }) => {
    try {
      const cacheService = createMatrixCacheService(ctx.prisma);
      const updatedCount = await cacheService.detectSignalUsers();

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'matrix_signal_detection',
          username: ctx.session.user.username || 'unknown',
          details: `Detected and updated ${updatedCount} Signal users`,
        },
      });

      return {
        success: true,
        updatedCount,
        message: `Updated ${updatedCount} users as Signal users`,
      };
    } catch (error) {
      console.error('Error detecting Signal users:', error);
      throw new Error('Failed to detect Signal users');
    }
  }),

  // Clean up old cache data
  cleanupCache: moderatorProcedure
    .input(
      z.object({
        maxAgeHours: z.number().default(24),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const cacheService = createMatrixCacheService(ctx.prisma);
        const deletedCount = await cacheService.cleanupCache(input.maxAgeHours);

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'matrix_cache_cleanup',
            username: ctx.session.user.username || 'unknown',
            details: `Cleaned up ${deletedCount} old cache records older than ${input.maxAgeHours} hours`,
          },
        });

        return {
          success: true,
          deletedCount,
          message: `Cleaned up ${deletedCount} old cache records`,
        };
      } catch (error) {
        console.error('Error cleaning up cache:', error);
        throw new Error('Failed to clean up cache');
      }
    }),

  // Signal verification endpoints with encryption-aware messaging
  sendSignalVerificationMessage: moderatorProcedure
    .input(
      z.object({
        phoneNumber: z.string(),
        message: z.string(),
        encryptionDelaySeconds: z.number().default(5),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (!matrixService.isConfigured()) {
          return {
            success: false,
            error: 'Matrix service not configured',
          };
        }

        const result = await matrixService.sendSignalMessageByPhone(
          input.phoneNumber,
          input.message
        );

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'signal_verification_message',
            username: ctx.session.user.username || 'unknown',
            details: `Sent Signal verification message to ${input.phoneNumber}: ${result.success ? 'Success' : result.error}`,
          },
        });

        // Log community timeline event
        if (result.success) {
          await logCommunityEvent({
            eventType: 'signal_verification',
            username: ctx.session.user.username || 'unknown',
            details: `Sent Signal verification to ${input.phoneNumber.replace(/\d(?=\d{4})/g, '*')}`, // Mask phone number
            category: getCategoryForEventType('signal_verification'),
          });
        }

        return result;
      } catch (error) {
        console.error('Error sending Signal verification message:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
      }
    }),

  // Send welcome message with encryption delay for user creation flows
  sendWelcomeMessageWithEncryptionDelay: moderatorProcedure
    .input(
      z.object({
        matrixUserId: z.string(),
        username: z.string(),
        fullName: z.string(),
        tempPassword: z.string(),
        discoursePostUrl: z.string().optional(),
        encryptionDelaySeconds: z.number().default(5),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        if (!matrixService.isConfigured()) {
          return {
            success: false,
            error: 'Matrix service not configured',
          };
        }

        const result = await matrixService.sendWelcomeMessageWithEncryptionDelay(
          input.matrixUserId,
          input.username,
          input.fullName,
          input.tempPassword,
          input.discoursePostUrl,
          input.encryptionDelaySeconds
        );

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'welcome_message_encryption_delay',
            username: ctx.session.user.username || 'unknown',
            details: `Sent welcome message with encryption delay to ${input.matrixUserId}: ${result.success ? 'Success' : result.error}`,
          },
        });

        // Log community timeline event
        if (result.success) {
          const displayName = input.matrixUserId.split(':')[0].replace('@', '');
          await logCommunityEvent({
            eventType: 'welcome_message',
            username: ctx.session.user.username || 'unknown',
            details: `Sent welcome message to ${displayName}`,
            category: getCategoryForEventType('welcome_message'),
          });
        }

        return result;
      } catch (error) {
        console.error('Error sending welcome message with encryption delay:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
      }
    }),

  // Bulk send welcome messages with encryption delay for multiple users
  bulkSendWelcomeMessagesWithEncryptionDelay: moderatorProcedure
    .input(
      z.object({
        users: z.array(z.object({
          matrixUserId: z.string(),
          username: z.string(),
          fullName: z.string(),
          tempPassword: z.string(),
          discoursePostUrl: z.string().optional(),
        })),
        encryptionDelaySeconds: z.number().default(5),
        batchSize: z.number().default(5),
        delayMs: z.number().default(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const results: Record<string, boolean> = {};
      const errors: Record<string, string> = {};

      if (!matrixService.isConfigured()) {
        return {
          success: false,
          results: {},
          errors: {},
          totalSuccess: 0,
          totalFailed: input.users.length,
          message: 'Matrix service not configured',
        };
      }

      try {
        // Process in batches to avoid overwhelming the Matrix server
        const batches = [];
        for (let i = 0; i < input.users.length; i += input.batchSize) {
          batches.push(input.users.slice(i, i + input.batchSize));
        }

        for (const [batchIndex, batch] of batches.entries()) {
          // Add delay between batches
          if (batchIndex > 0) {
            await new Promise(resolve => setTimeout(resolve, input.delayMs));
          }

          // Process batch in parallel
          const batchPromises = batch.map(async (user) => {
            try {
              const result = await matrixService.sendWelcomeMessageWithEncryptionDelay(
                user.matrixUserId,
                user.username,
                user.fullName,
                user.tempPassword,
                user.discoursePostUrl,
                input.encryptionDelaySeconds
              );
              
              results[user.matrixUserId] = result.success;
              if (!result.success) {
                errors[user.matrixUserId] = result.error || 'Unknown error';
              }
            } catch (error) {
              results[user.matrixUserId] = false;
              errors[user.matrixUserId] = error instanceof Error ? error.message : 'Unknown error';
            }
          });

          await Promise.all(batchPromises);
          console.log(`Completed welcome message batch ${batchIndex + 1}/${batches.length}`);
        }

        const totalSuccess = Object.values(results).filter(Boolean).length;
        const totalFailed = Object.values(results).filter(success => !success).length;

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'bulk_welcome_messages_encryption_delay',
            username: ctx.session.user.username || 'unknown',
            details: `Bulk sent welcome messages with encryption delay to ${input.users.length} users. Success: ${totalSuccess}, Failed: ${totalFailed}`,
          },
        });

        return {
          success: totalFailed === 0,
          results,
          errors,
          totalSuccess,
          totalFailed,
          batchesProcessed: batches.length,
        };
      } catch (error) {
        console.error('Error sending bulk welcome messages:', error);
        return {
          success: false,
          results: {},
          errors: {},
          totalSuccess: 0,
          totalFailed: input.users.length,
          message: error instanceof Error ? error.message : 'Unknown error occurred',
        };
      }
    }),
}); 