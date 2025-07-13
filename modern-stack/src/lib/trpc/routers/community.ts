import { z } from 'zod';
import { createTRPCRouter, publicProcedure, protectedProcedure, moderatorProcedure } from '../trpc';
import { getCommunityEvents, getEventStats, EVENT_CATEGORIES } from '@/lib/community-timeline';

export const communityRouter = createTRPCRouter({
  // Get community timeline events (public access)
  getTimeline: publicProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(25),
        category: z.string().optional(),
        eventType: z.string().optional(),
        username: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const { page, limit, category, eventType, username } = input;
      const offset = (page - 1) * limit;

      const result = await getCommunityEvents({
        limit,
        offset,
        category,
        eventType,
        username,
        isPublic: true,
      });

      return {
        events: result.events,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit),
        hasMore: result.hasMore,
      };
    }),

  // Get event statistics (public access)
  getStats: publicProcedure
    .input(
      z.object({
        days: z.number().default(7),
      })
    )
    .query(async ({ input }) => {
      return await getEventStats(input.days);
    }),

  // Get available event categories (public access)
  getCategories: publicProcedure.query(() => {
    return Object.values(EVENT_CATEGORIES);
  }),

  // Get recent events for dashboard widget (protected)
  getRecentEvents: protectedProcedure
    .input(
      z.object({
        limit: z.number().default(10),
      })
    )
    .query(async ({ input }) => {
      const result = await getCommunityEvents({
        limit: input.limit,
        offset: 0,
        isPublic: true,
      });

      return result.events;
    }),

  // Get all events including private ones (moderator access)
  getAllEvents: moderatorProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(25),
        category: z.string().optional(),
        eventType: z.string().optional(),
        username: z.string().optional(),
        isPublic: z.boolean().optional(),
      })
    )
    .query(async ({ input }) => {
      const { page, limit, category, eventType, username, isPublic } = input;
      const offset = (page - 1) * limit;

      const result = await getCommunityEvents({
        limit,
        offset,
        category,
        eventType,
        username,
        isPublic,
      });

      return {
        events: result.events,
        total: result.total,
        page,
        limit,
        totalPages: Math.ceil(result.total / limit),
        hasMore: result.hasMore,
      };
    }),
}); 