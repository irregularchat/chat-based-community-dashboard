/**
 * Community Management tRPC Router
 * Unified interface for Signal CLI and Matrix community operations
 */

import { z } from 'zod';
import { createTRPCRouter, adminProcedure } from '../trpc';
import { TRPCError } from '@trpc/server';

// Input validation schemas
const platformSchema = z.enum(['signal', 'matrix']).optional();

const sendMessageSchema = z.object({
  recipient: z.string().min(1),
  message: z.string().min(1),
  platform: platformSchema,
});

const roomOperationSchema = z.object({
  userId: z.string().min(1),
  roomId: z.string().min(1),
  platform: platformSchema,
});

const broadcastSchema = z.object({
  roomId: z.string().min(1),
  message: z.string().min(1),
  platform: platformSchema,
});

const bulkMessageSchema = z.object({
  userIds: z.array(z.string()).min(1),
  message: z.string().min(1),
  platform: platformSchema,
});

export const communityManagementRouter = createTRPCRouter({
  /**
   * Get service configuration and availability
   */
  getServiceStatus: adminProcedure
    .query(async () => {
      try {
        const { communityServiceFactory, communityManager } = await import('@/lib/community');
        
        const config = communityServiceFactory.getConfig();
        const availableServices = await communityManager.getAvailableServices();
        
        const serviceHealth = await Promise.all(
          communityServiceFactory.getAllServices().map(async (service) => {
            try {
              return await service.getHealth();
            } catch (error) {
              return {
                platform: service.platform,
                isAvailable: false,
                isConfigured: service.isConfigured(),
                lastCheck: new Date(),
                error: error instanceof Error ? error.message : 'Health check failed'
              };
            }
          })
        );

        return {
          config,
          availableServices: availableServices.map(s => s.platform),
          serviceHealth,
          hasServices: availableServices.length > 0,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get service status',
        });
      }
    }),

  /**
   * Get unified user list from all available platforms
   */
  getUsers: adminProcedure
    .input(z.object({
      platforms: z.array(z.enum(['signal', 'matrix'])).optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      try {
        const { communityManager } = await import('@/lib/community');
        let users = await communityManager.getUsers(input.platforms);
        
        // Apply search filter if provided
        if (input.search) {
          const searchLower = input.search.toLowerCase();
          users = users.filter(user =>
            user.displayName.toLowerCase().includes(searchLower) ||
            user.id.toLowerCase().includes(searchLower) ||
            (user.signalNumber && user.signalNumber.toLowerCase().includes(searchLower)) ||
            (user.matrixUserId && user.matrixUserId.toLowerCase().includes(searchLower))
          );
        }

        return {
          success: true,
          users,
          totalCount: users.length,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get users',
        });
      }
    }),

  /**
   * Get unified room/group list from all available platforms
   */
  getRooms: adminProcedure
    .input(z.object({
      platforms: z.array(z.enum(['signal', 'matrix'])).optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      try {
        const { communityManager } = await import('@/lib/community');
        let rooms = await communityManager.getRooms(input.platforms);
        
        // Apply search filter if provided
        if (input.search) {
          const searchLower = input.search.toLowerCase();
          rooms = rooms.filter(room =>
            room.name.toLowerCase().includes(searchLower) ||
            room.id.toLowerCase().includes(searchLower) ||
            (room.displayName && room.displayName.toLowerCase().includes(searchLower)) ||
            (room.topic && room.topic.toLowerCase().includes(searchLower))
          );
        }

        return {
          success: true,
          rooms,
          totalCount: rooms.length,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get rooms',
        });
      }
    }),

  /**
   * Send direct message to a user
   */
  sendMessage: adminProcedure
    .input(sendMessageSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { communityManager } = await import('@/lib/community');
        const result = await communityManager.sendMessage({
          recipient: input.recipient,
          message: input.message,
          platform: input.platform,
        });

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'community_message_sent',
            username: ctx.session.user.username || 'unknown',
            details: `Sent message via ${result.platform} to ${input.recipient}`,
          },
        });

        return result;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to send message',
        });
      }
    }),

  /**
   * Send message to multiple users (bulk operation)
   */
  sendMessageToMultiple: adminProcedure
    .input(bulkMessageSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { communityManager } = await import('@/lib/community');
        const results = await communityManager.sendMessageToMultiple(
          input.userIds,
          input.message,
          input.platform
        );

        const successCount = results.filter(r => r.success).length;
        const platform = results[0]?.platform || input.platform || 'unknown';

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'community_bulk_message_sent',
            username: ctx.session.user.username || 'unknown',
            details: `Sent bulk message via ${platform} to ${input.userIds.length} users (${successCount} successful)`,
          },
        });

        return {
          results,
          totalSent: input.userIds.length,
          successCount,
          failureCount: input.userIds.length - successCount,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to send bulk messages',
        });
      }
    }),

  /**
   * Broadcast message to a room/group
   */
  broadcastToRoom: adminProcedure
    .input(broadcastSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { communityManager } = await import('@/lib/community');
        const result = await communityManager.broadcastToRoom({
          roomId: input.roomId,
          message: input.message,
          platform: input.platform,
        });

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'community_room_broadcast',
            username: ctx.session.user.username || 'unknown',
            details: `Broadcast message via ${result.platform} to room ${input.roomId}`,
          },
        });

        return result;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to broadcast message',
        });
      }
    }),

  /**
   * Invite user to room/group
   */
  inviteToRoom: adminProcedure
    .input(roomOperationSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { communityManager } = await import('@/lib/community');
        const result = await communityManager.inviteToRoom({
          userId: input.userId,
          roomId: input.roomId,
          platform: input.platform,
        });

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'community_user_invited',
            username: ctx.session.user.username || 'unknown',
            details: `Invited user ${input.userId} to room ${input.roomId} via ${result.platform}`,
          },
        });

        return result;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to invite user to room',
        });
      }
    }),

  /**
   * Remove user from room/group
   */
  removeFromRoom: adminProcedure
    .input(roomOperationSchema)
    .mutation(async ({ input, ctx }) => {
      try {
        const { communityManager } = await import('@/lib/community');
        const result = await communityManager.removeFromRoom({
          userId: input.userId,
          roomId: input.roomId,
          platform: input.platform,
        });

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'community_user_removed',
            username: ctx.session.user.username || 'unknown',
            details: `Removed user ${input.userId} from room ${input.roomId} via ${result.platform}`,
          },
        });

        return result;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to remove user from room',
        });
      }
    }),
});