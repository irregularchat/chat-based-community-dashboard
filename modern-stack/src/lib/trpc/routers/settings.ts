import { z } from 'zod';
import { createTRPCRouter, publicProcedure, protectedProcedure, moderatorProcedure, adminProcedure } from '../trpc';
import { TRPCError } from '@trpc/server';

export const settingsRouter = createTRPCRouter({
  // Dashboard Settings
  getDashboardSettings: publicProcedure
    .input(z.object({ key: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      if (input.key) {
        // Get specific setting
        const setting = await ctx.prisma.dashboardSettings.findUnique({
          where: { key: input.key },
        });
        return setting?.value || null;
      }
      
      // Get all settings
      const settings = await ctx.prisma.dashboardSettings.findMany({
        orderBy: { key: 'asc' },
      });
      
      return settings.reduce((acc, setting) => {
        acc[setting.key] = setting.value;
        return acc;
      }, {} as Record<string, any>);
    }),

  updateDashboardSetting: adminProcedure
    .input(
      z.object({
        key: z.string(),
        value: z.any(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const setting = await ctx.prisma.dashboardSettings.upsert({
        where: { key: input.key },
        update: { value: input.value },
        create: { key: input.key, value: input.value },
      });

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'dashboard_setting_updated',
          username: ctx.session.user.username || 'unknown',
          details: `Updated dashboard setting: ${input.key}`,
        },
      });

      return setting;
    }),

  // Community Bookmarks
  getCommunityBookmarks: publicProcedure
    .input(
      z.object({
        category: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = {
        ...(input.category && { category: input.category }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      };

      return await ctx.prisma.communityBookmark.findMany({
        where,
        orderBy: [
          { order: 'asc' },
          { createdAt: 'asc' },
        ],
      });
    }),

  createCommunityBookmark: adminProcedure
    .input(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        url: z.string().url(),
        icon: z.string().optional(),
        category: z.string().default('general'),
        order: z.number().default(0),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const bookmark = await ctx.prisma.communityBookmark.create({
        data: input,
      });

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'community_bookmark_created',
          username: ctx.session.user.username || 'unknown',
          details: `Created community bookmark: ${input.title}`,
        },
      });

      return bookmark;
    }),

  updateCommunityBookmark: adminProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        url: z.string().url().optional(),
        icon: z.string().optional(),
        category: z.string().optional(),
        order: z.number().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;

      const bookmark = await ctx.prisma.communityBookmark.update({
        where: { id },
        data: updateData,
      });

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'community_bookmark_updated',
          username: ctx.session.user.username || 'unknown',
          details: `Updated community bookmark: ${bookmark.title}`,
        },
      });

      return bookmark;
    }),

  deleteCommunityBookmark: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const bookmark = await ctx.prisma.communityBookmark.findUnique({
        where: { id: input.id },
      });

      if (!bookmark) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Bookmark not found',
        });
      }

      await ctx.prisma.communityBookmark.delete({
        where: { id: input.id },
      });

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'community_bookmark_deleted',
          username: ctx.session.user.username || 'unknown',
          details: `Deleted community bookmark: ${bookmark.title}`,
        },
      });

      return { success: true };
    }),

  // Dashboard Announcements
  getDashboardAnnouncements: publicProcedure
    .input(
      z.object({
        isActive: z.boolean().optional(),
        includeExpired: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const where = {
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(!input.includeExpired && {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        }),
      };

      return await ctx.prisma.dashboardAnnouncement.findMany({
        where,
        orderBy: [
          { priority: 'desc' },
          { createdAt: 'desc' },
        ],
      });
    }),

  createDashboardAnnouncement: adminProcedure
    .input(
      z.object({
        title: z.string().min(1),
        content: z.string().min(1),
        type: z.enum(['info', 'warning', 'success', 'error']).default('info'),
        isActive: z.boolean().default(true),
        priority: z.number().default(0),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const announcement = await ctx.prisma.dashboardAnnouncement.create({
        data: {
          ...input,
          createdBy: ctx.session.user.username || 'unknown',
        },
      });

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'dashboard_announcement_created',
          username: ctx.session.user.username || 'unknown',
          details: `Created dashboard announcement: ${input.title}`,
        },
      });

      return announcement;
    }),

  updateDashboardAnnouncement: adminProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(1).optional(),
        content: z.string().min(1).optional(),
        type: z.enum(['info', 'warning', 'success', 'error']).optional(),
        isActive: z.boolean().optional(),
        priority: z.number().optional(),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;

      const announcement = await ctx.prisma.dashboardAnnouncement.update({
        where: { id },
        data: updateData,
      });

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'dashboard_announcement_updated',
          username: ctx.session.user.username || 'unknown',
          details: `Updated dashboard announcement: ${announcement.title}`,
        },
      });

      return announcement;
    }),

  deleteDashboardAnnouncement: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const announcement = await ctx.prisma.dashboardAnnouncement.findUnique({
        where: { id: input.id },
      });

      if (!announcement) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Announcement not found',
        });
      }

      await ctx.prisma.dashboardAnnouncement.delete({
        where: { id: input.id },
      });

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'dashboard_announcement_deleted',
          username: ctx.session.user.username || 'unknown',
          details: `Deleted dashboard announcement: ${announcement.title}`,
        },
      });

      return { success: true };
    }),

  // Bulk operations
  reorderCommunityBookmarks: adminProcedure
    .input(
      z.object({
        bookmarks: z.array(
          z.object({
            id: z.number(),
            order: z.number(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Update all bookmarks in a transaction
      const updates = input.bookmarks.map((bookmark) =>
        ctx.prisma.communityBookmark.update({
          where: { id: bookmark.id },
          data: { order: bookmark.order },
        })
      );

      await ctx.prisma.$transaction(updates);

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'community_bookmarks_reordered',
          username: ctx.session.user.username || 'unknown',
          details: `Reordered ${input.bookmarks.length} community bookmarks`,
        },
      });

      return { success: true };
    }),

  // Get all settings for admin interface
  getAllSettings: adminProcedure.query(async ({ ctx }) => {
    const [settings, bookmarks, announcements] = await Promise.all([
      ctx.prisma.dashboardSettings.findMany({
        orderBy: { key: 'asc' },
      }),
      ctx.prisma.communityBookmark.findMany({
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      }),
      ctx.prisma.dashboardAnnouncement.findMany({
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    return {
      settings: settings.reduce((acc, setting) => {
        acc[setting.key] = setting.value;
        return acc;
      }, {} as Record<string, any>),
      bookmarks,
      announcements,
    };
  }),
}); 