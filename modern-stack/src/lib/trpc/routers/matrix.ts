import { z } from 'zod';
import { createTRPCRouter, protectedProcedure, adminProcedure, moderatorProcedure } from '../trpc';

// Define Matrix-related schemas
const MatrixUserSchema = z.object({
  user_id: z.string(),
  display_name: z.string(),
  avatar_url: z.string().optional(),
  is_signal_user: z.boolean().optional(),
});

const MatrixRoomSchema = z.object({
  room_id: z.string(),
  name: z.string().optional(),
  topic: z.string().optional(),
  member_count: z.number().optional(),
  category: z.string().optional(),
  configured: z.boolean().optional(),
});

const MessageHistorySchema = z.object({
  sender: z.string(),
  content: z.string(),
  timestamp: z.string(),
  event_id: z.string().optional(),
});

export const matrixRouter = createTRPCRouter({
  // Get Matrix configuration status
  getConfig: protectedProcedure.query(async ({ ctx }) => {
    // This would normally come from environment variables or config
    // For now, return mock data to demonstrate the structure
    return {
      isActive: process.env.MATRIX_ACTIVE === 'true',
      homeserverUrl: process.env.MATRIX_HOMESERVER_URL || '',
      botUsername: process.env.MATRIX_BOT_USERNAME || '',
      defaultRoomId: process.env.MATRIX_DEFAULT_ROOM_ID || '',
      welcomeRoomId: process.env.MATRIX_WELCOME_ROOM_ID || '',
    };
  }),

  // Get list of Matrix users
  getUsers: moderatorProcedure
    .input(
      z.object({
        search: z.string().optional(),
        includeSignalUsers: z.boolean().default(true),
        includeRegularUsers: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      // Mock data for demonstration - in real implementation, this would call Matrix API
      const mockUsers = [
        {
          user_id: '@admin:matrix.irregularchat.com',
          display_name: 'Admin User',
          avatar_url: null,
          is_signal_user: false,
        },
        {
          user_id: '@signal_12345:matrix.irregularchat.com',
          display_name: 'Signal User',
          avatar_url: null,
          is_signal_user: true,
        },
        {
          user_id: '@moderator:matrix.irregularchat.com',
          display_name: 'Moderator User',
          avatar_url: null,
          is_signal_user: false,
        },
      ];

      let filteredUsers = mockUsers;

      // Apply user type filters
      if (!input.includeSignalUsers) {
        filteredUsers = filteredUsers.filter(user => !user.is_signal_user);
      }
      if (!input.includeRegularUsers) {
        filteredUsers = filteredUsers.filter(user => user.is_signal_user);
      }

      // Apply search filter
      if (input.search) {
        const searchLower = input.search.toLowerCase();
        filteredUsers = filteredUsers.filter(
          user =>
            user.display_name.toLowerCase().includes(searchLower) ||
            user.user_id.toLowerCase().includes(searchLower)
        );
      }

      return filteredUsers;
    }),

  // Get list of Matrix rooms
  getRooms: moderatorProcedure
    .input(
      z.object({
        category: z.string().optional(),
        search: z.string().optional(),
        includeConfigured: z.boolean().default(true),
        includeDiscovered: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      // Mock data for demonstration - in real implementation, this would call Matrix API
      const mockRooms = [
        {
          room_id: '!general:matrix.irregularchat.com',
          name: 'General Chat',
          topic: 'General discussion room',
          member_count: 25,
          category: 'General',
          configured: true,
        },
        {
          room_id: '!tech:matrix.irregularchat.com',
          name: 'Tech Discussion',
          topic: 'Technology and development chat',
          member_count: 15,
          category: 'Technology',
          configured: true,
        },
        {
          room_id: '!random:matrix.irregularchat.com',
          name: 'Random',
          topic: 'Random conversations',
          member_count: 30,
          category: 'Social',
          configured: false,
        },
      ];

      let filteredRooms = mockRooms;

      // Apply filters
      if (input.category) {
        filteredRooms = filteredRooms.filter(room => room.category === input.category);
      }

      if (!input.includeConfigured) {
        filteredRooms = filteredRooms.filter(room => !room.configured);
      }
      if (!input.includeDiscovered) {
        filteredRooms = filteredRooms.filter(room => room.configured);
      }

      if (input.search) {
        const searchLower = input.search.toLowerCase();
        filteredRooms = filteredRooms.filter(
          room =>
            room.name?.toLowerCase().includes(searchLower) ||
            room.room_id.toLowerCase().includes(searchLower) ||
            room.topic?.toLowerCase().includes(searchLower)
        );
      }

      return filteredRooms;
    }),

  // Get room categories
  getCategories: moderatorProcedure.query(async ({ ctx }) => {
    // Mock data - in real implementation, this would be derived from room data
    return ['General', 'Technology', 'Social', 'Support', 'Off-topic'];
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
      // Mock implementation - in real implementation, this would call Matrix API
      console.log(`Sending DM to ${input.userId}: ${input.message}`);
      
      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'matrix_direct_message',
          username: ctx.session.user.username || 'unknown',
          details: `Sent direct message to ${input.userId}`,
        },
      });

      return {
        success: true,
        roomId: `!dm_${Date.now()}:matrix.irregularchat.com`,
        eventId: `$event_${Date.now()}`,
      };
    }),

  // Send message to multiple users
  sendMessageToUsers: moderatorProcedure
    .input(
      z.object({
        userIds: z.array(z.string()),
        message: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Mock implementation - in real implementation, this would call Matrix API for each user
      const results: Record<string, boolean> = {};
      
      for (const userId of input.userIds) {
        console.log(`Sending message to ${userId}: ${input.message}`);
        // Simulate success/failure
        results[userId] = Math.random() > 0.1; // 90% success rate for demo
      }

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'matrix_bulk_message',
          username: ctx.session.user.username || 'unknown',
          details: `Sent message to ${input.userIds.length} users`,
        },
      });

      return {
        results,
        totalSent: Object.values(results).filter(Boolean).length,
        totalFailed: Object.values(results).filter(success => !success).length,
      };
    }),

  // Send message to rooms
  sendMessageToRooms: moderatorProcedure
    .input(
      z.object({
        roomIds: z.array(z.string()),
        message: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Mock implementation - in real implementation, this would call Matrix API for each room
      const results: Record<string, boolean> = {};
      
      for (const roomId of input.roomIds) {
        console.log(`Sending message to room ${roomId}: ${input.message}`);
        // Simulate success/failure
        results[roomId] = Math.random() > 0.05; // 95% success rate for demo
      }

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'matrix_room_message',
          username: ctx.session.user.username || 'unknown',
          details: `Sent message to ${input.roomIds.length} rooms`,
        },
      });

      return {
        results,
        totalSent: Object.values(results).filter(Boolean).length,
        totalFailed: Object.values(results).filter(success => !success).length,
      };
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
      // Mock implementation - in real implementation, this would call Matrix API
      const results: Record<string, boolean> = {};
      
      for (const roomId of input.roomIds) {
        console.log(`Inviting ${input.userId} to room ${roomId}`);
        // Simulate success/failure
        results[roomId] = Math.random() > 0.1; // 90% success rate for demo
      }

      // Send welcome message if requested
      if (input.sendWelcome && input.welcomeMessage) {
        console.log(`Sending welcome message to ${input.userId}: ${input.welcomeMessage}`);
      }

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'matrix_user_invite',
          username: ctx.session.user.username || 'unknown',
          details: `Invited ${input.userId} to ${input.roomIds.length} rooms`,
        },
      });

      return {
        results,
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
      // Mock implementation - in real implementation, this would call Matrix API
      const results: Record<string, boolean> = {};
      
      // Send message to rooms before removal if requested
      if (input.sendMessage && input.message) {
        for (const roomId of input.roomIds) {
          console.log(`Sending removal message to room ${roomId}: ${input.message}`);
        }
      }

      // Remove user from rooms
      for (const roomId of input.roomIds) {
        console.log(`Removing ${input.userId} from room ${roomId}`);
        // Simulate success/failure
        results[roomId] = Math.random() > 0.05; // 95% success rate for demo
      }

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'matrix_user_removal',
          username: ctx.session.user.username || 'unknown',
          details: `Removed ${input.userId} from ${input.roomIds.length} rooms`,
        },
      });

      return {
        results,
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
  getUserCategories: moderatorProcedure.query(async ({ ctx }) => {
    // In real implementation, this would be stored in the database
    // For now, return mock data
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

  // Save user category
  saveUserCategory: moderatorProcedure
    .input(
      z.object({
        categoryName: z.string(),
        userIds: z.array(z.string()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // In real implementation, this would be stored in the database
      console.log(`Saving category '${input.categoryName}' with ${input.userIds.length} users`);

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'matrix_category_saved',
          username: ctx.session.user.username || 'unknown',
          details: `Saved category '${input.categoryName}' with ${input.userIds.length} users`,
        },
      });

      return { success: true };
    }),

  // Delete user category
  deleteUserCategory: moderatorProcedure
    .input(
      z.object({
        categoryName: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // In real implementation, this would be removed from the database
      console.log(`Deleting category '${input.categoryName}'`);

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'matrix_category_deleted',
          username: ctx.session.user.username || 'unknown',
          details: `Deleted category '${input.categoryName}'`,
        },
      });

      return { success: true };
    }),
}); 