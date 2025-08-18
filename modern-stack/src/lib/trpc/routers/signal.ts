import { z } from 'zod';
import { createTRPCRouter, moderatorProcedure } from '../trpc';
import { enhancedSignalClient } from '@/lib/signal/enhanced-api-client';
import { logCommunityEvent, getCategoryForEventType } from '@/lib/community-timeline';

export const signalRouter = createTRPCRouter({
  // Get Signal groups with enhanced display names
  getGroups: moderatorProcedure
    .input(
      z.object({
        phoneNumber: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        // Set phone number from environment if not provided
        const phoneNumber = input.phoneNumber || process.env.SIGNAL_PHONE_NUMBER;
        if (!phoneNumber) {
          throw new Error('Signal phone number not configured');
        }

        enhancedSignalClient.setPhoneNumber(phoneNumber);
        const groups = await enhancedSignalClient.getGroupsWithNames();
        
        return groups;
      } catch (error) {
        console.error('Error fetching Signal groups:', error);
        throw new Error('Failed to fetch Signal groups');
      }
    }),

  // Get Signal users/contacts with enhanced display names
  getUsers: moderatorProcedure
    .input(
      z.object({
        phoneNumber: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        // Set phone number from environment if not provided
        const phoneNumber = input.phoneNumber || process.env.SIGNAL_PHONE_NUMBER;
        if (!phoneNumber) {
          throw new Error('Signal phone number not configured');
        }

        enhancedSignalClient.setPhoneNumber(phoneNumber);
        const users = await enhancedSignalClient.getUsersWithNames();
        
        return users;
      } catch (error) {
        console.error('Error fetching Signal users:', error);
        throw new Error('Failed to fetch Signal users');
      }
    }),

  // Get display name for a specific identifier
  getDisplayName: moderatorProcedure
    .input(
      z.object({
        identifier: z.string(),
        phoneNumber: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        // Set phone number from environment if not provided
        const phoneNumber = input.phoneNumber || process.env.SIGNAL_PHONE_NUMBER;
        if (!phoneNumber) {
          throw new Error('Signal phone number not configured');
        }

        enhancedSignalClient.setPhoneNumber(phoneNumber);
        // Ensure cache is populated
        await enhancedSignalClient.getUsersWithNames();
        
        const displayName = enhancedSignalClient.getDisplayName(input.identifier);
        return { displayName };
      } catch (error) {
        console.error('Error getting display name:', error);
        return { displayName: input.identifier }; // Fallback to original identifier
      }
    }),

  // Send message with recipient name resolution
  sendMessage: moderatorProcedure
    .input(
      z.object({
        recipients: z.array(z.string()),
        message: z.string(),
        phoneNumber: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Set phone number from environment if not provided
        const phoneNumber = input.phoneNumber || process.env.SIGNAL_PHONE_NUMBER;
        if (!phoneNumber) {
          throw new Error('Signal phone number not configured');
        }

        enhancedSignalClient.setPhoneNumber(phoneNumber);
        const success = await enhancedSignalClient.sendMessage(input.recipients, input.message);

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'signal_message',
            username: ctx.session.user.username || 'unknown',
            details: `Sent Signal message to ${input.recipients.length} recipient(s): ${success ? 'Success' : 'Failed'}`,
          },
        });

        // Log community timeline event
        if (success) {
          await logCommunityEvent({
            eventType: 'signal_message',
            username: ctx.session.user.username || 'unknown',
            details: `Sent Signal message to ${input.recipients.length} recipient(s)`,
            category: getCategoryForEventType('signal_message'),
          });
        }

        return { success };
      } catch (error) {
        console.error('Error sending Signal message:', error);
        throw new Error('Failed to send Signal message');
      }
    }),

  // Clear Signal cache
  clearCache: moderatorProcedure.mutation(async ({ ctx }) => {
    try {
      enhancedSignalClient.clearCache();

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'signal_cache_clear',
          username: ctx.session.user.username || 'unknown',
          details: 'Cleared Signal identity cache',
        },
      });

      return { success: true, message: 'Signal cache cleared successfully' };
    } catch (error) {
      console.error('Error clearing Signal cache:', error);
      throw new Error('Failed to clear Signal cache');
    }
  }),

  // Get Signal configuration status
  getConfig: moderatorProcedure.query(async () => {
    const baseUrl = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
    const phoneNumber = process.env.SIGNAL_PHONE_NUMBER;
    
    return {
      baseUrl,
      phoneNumber,
      isConfigured: !!phoneNumber,
    };
  }),
});