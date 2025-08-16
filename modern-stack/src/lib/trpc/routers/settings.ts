import { z } from 'zod';
import { createTRPCRouter, publicProcedure, adminProcedure } from '../trpc';
import { TRPCError } from '@trpc/server';
import { authentikService } from '@/lib/authentik';
import { emailService } from '@/lib/email';

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
      }, {} as Record<string, unknown>);
    }),

  updateDashboardSetting: adminProcedure
    .input(
      z.object({
        key: z.string(),
        value: z.unknown(),
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

  // Initialize settings from environment variables
  initializeFromEnv: adminProcedure.mutation(async ({ ctx }) => {
    // Map of environment variables to dashboard settings
    const envMappings = {
      // NextAuth
      'nextauth_url': process.env.NEXTAUTH_URL,
      
      // Authentik/OIDC Configuration
      'authentik_client_id': process.env.OIDC_CLIENT_ID,
      'authentik_client_secret': process.env.OIDC_CLIENT_SECRET,
      'authentik_issuer': process.env.AUTHENTIK_ISSUER,
      'authentik_base_url': process.env.AUTHENTIK_BASE_URL || process.env.AUTHENTIK_API_URL,
      'authentik_api_token': process.env.AUTHENTIK_API_TOKEN,
      'oidc_authorization_endpoint': process.env.OIDC_AUTHORIZATION_ENDPOINT,
      'oidc_token_endpoint': process.env.OIDC_TOKEN_ENDPOINT,
      'oidc_userinfo_endpoint': process.env.OIDC_USERINFO_ENDPOINT,
      'oidc_end_session_endpoint': process.env.OIDC_END_SESSION_ENDPOINT,
      'oidc_redirect_uri': process.env.OIDC_REDIRECT_URI,
      'oidc_scopes': process.env.OIDC_SCOPES,
      
      // Authentik specific
      'main_group_id': process.env.MAIN_GROUP_ID,
      'flow_id': process.env.FLOW_ID,
      'invite_flow_id': process.env.INVITE_FLOW_ID,
      'invite_label': process.env.INVITE_LABEL,
      
      // Database
      'database_url': process.env.DATABASE_URL,
      'postgres_db': process.env.POSTGRES_DB,
      'postgres_user': process.env.POSTGRES_USER,
      'postgres_password': process.env.POSTGRES_PASSWORD,
      'postgres_port': process.env.POSTGRES_PORT,
      
      // SMTP Configuration
      'smtp_active': process.env.SMTP_ACTIVE,
      'smtp_server': process.env.SMTP_SERVER,
      'smtp_port': process.env.SMTP_PORT,
      'smtp_username': process.env.SMTP_USERNAME,
      'smtp_password': process.env.SMTP_PASSWORD,
      'smtp_from_email': process.env.SMTP_FROM_EMAIL,
      'smtp_bcc': process.env.SMTP_BCC,
      
      // Matrix Configuration
      'matrix_active': process.env.MATRIX_ACTIVE,
      'matrix_url': process.env.MATRIX_URL || process.env.MATRIX_HOMESERVER_URL,
      'matrix_access_token': process.env.MATRIX_ACCESS_TOKEN,
      'matrix_bot_username': process.env.MATRIX_BOT_USERNAME,
      'matrix_bot_display_name': process.env.MATRIX_BOT_DISPLAY_NAME,
      'matrix_default_room_id': process.env.MATRIX_DEFAULT_ROOM_ID,
      'matrix_welcome_room_id': process.env.MATRIX_WELCOME_ROOM_ID,
      'matrix_signal_bridge_room_id': process.env.MATRIX_SIGNAL_BRIDGE_ROOM_ID,
      'matrix_enable_encryption': process.env.MATRIX_ENABLE_ENCRYPTION,
      'matrix_security_key': process.env.MATRIX_SECURITY_KEY,
      'matrix_device_id': process.env.MATRIX_DEVICE_ID,
      'matrix_device_display_name': process.env.MATRIX_DEVICE_DISPLAY_NAME,
      'matrix_room_ids_name_category': process.env.MATRIX_ROOM_IDS_NAME_CATEGORY,
      'matrix_min_room_members': process.env.MATRIX_MIN_ROOM_MEMBERS,
      'matrix_message_notice': process.env.MATRIX_MESSAGE_NOTICE,
      
      // Discourse Configuration
      'discourse_active': process.env.DISCOURSE_ACTIVE,
      'discourse_url': process.env.DISCOURSE_URL,
      'discourse_category_id': process.env.DISCOURSE_CATEGORY_ID,
      'discourse_api_key': process.env.DISCOURSE_API_KEY,
      'discourse_api_username': process.env.DISCOURSE_API_USERNAME,
      'discourse_intro_tag': process.env.DISCOURSE_INTRO_TAG,
      
      // Webhook Configuration
      'webhook_active': process.env.WEBHOOK_ACTIVE,
      'webhook_url': process.env.WEBHOOK_URL,
      'webhook_secret': process.env.WEBHOOK_SECRET,
      
      // OpenAI Configuration
      'openai_api_key': process.env.OPENAI_API_KEY,
      
      // General Settings
      'page_title': process.env.PAGE_TITLE,
      'favicon_url': process.env.FAVICON_URL,
      'base_domain': process.env.BASE_DOMAIN,
      'port': process.env.PORT,
      'login_required': process.env.LOGIN_REQUIRED,
      'theme': process.env.THEME,
      'admin_usernames': process.env.ADMIN_USERNAMES,
      'default_admin_username': process.env.DEFAULT_ADMIN_USERNAME,
      'default_admin_password': process.env.DEFAULT_ADMIN_PASSWORD,
      
      // ShLink Configuration
      'shlink_active': process.env.SHLINK_ACTIVE,
    };

    const updates = [];
    
    for (const [key, value] of Object.entries(envMappings)) {
      if (value) {
        updates.push(
          ctx.prisma.dashboardSettings.upsert({
            where: { key },
            update: { value },
            create: { key, value },
          })
        );
      }
    }

    if (updates.length > 0) {
      await ctx.prisma.$transaction(updates);
      
      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'settings_initialized_from_env',
          username: ctx.session.user.username || 'unknown',
          details: `Initialized ${updates.length} settings from environment variables`,
        },
      });
    }

    return { success: true, initialized: updates.length };
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
      }, {} as Record<string, unknown>),
      bookmarks,
      announcements,
    };
  }),

  // Get service configurations status
  getServicesConfig: adminProcedure.query(async ({ _ctx }) => {
    // Import Matrix service
    const { matrixService } = await import('@/lib/matrix');
    
    // Check Matrix configuration
    const matrixConfig = matrixService.getConfig();
    const matrixConfigured = matrixService.isConfigured();

    // Check Authentik configuration
    const authentikConfig = authentikService.getConfig();
    const authentikConfigured = authentikService.isConfigured();

    // Check Email/SMTP configuration
    const emailConfig = emailService.getConfig();
    const emailConfigured = emailService.isConfigured();

    // Check Discourse configuration from environment
    const discourseConfigured = !!(
      process.env.DISCOURSE_URL &&
      process.env.DISCOURSE_API_KEY &&
      process.env.DISCOURSE_API_USERNAME
    );

    // Check AI configuration from environment
    const aiConfigured = !!(
      process.env.OPENAI_API_KEY ||
      process.env.CLAUDE_API_KEY ||
      process.env.LOCAL_AI_ENDPOINT
    );

    return {
      matrix: {
        isConfigured: matrixConfigured,
        homeserver: matrixConfig?.homeserver,
        userId: matrixConfig?.userId,
        hasAccessToken: !!matrixConfig?.accessToken,
      },
      authentik: {
        isConfigured: authentikConfigured,
        apiUrl: authentikConfig?.apiUrl,
        hasApiToken: !!authentikConfig?.apiToken,
        mainGroupId: authentikConfig?.mainGroupId,
      },
      email: {
        isConfigured: emailConfigured,
        host: emailConfig?.host,
        port: emailConfig?.port,
        from: emailConfig?.from,
        hasBcc: !!emailConfig?.bcc,
      },
      discourse: {
        isConfigured: discourseConfigured,
        url: process.env.DISCOURSE_URL,
        hasApiKey: !!process.env.DISCOURSE_API_KEY,
        apiUsername: process.env.DISCOURSE_API_USERNAME,
      },
      ai: {
        isConfigured: aiConfigured,
        hasOpenAI: !!process.env.OPENAI_API_KEY,
        hasClaude: !!process.env.CLAUDE_API_KEY,
        hasLocal: !!process.env.LOCAL_AI_ENDPOINT,
      },
    };
  }),

  // Room Cards Management
  getRoomCards: publicProcedure
    .input(z.object({ isActive: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      const setting = await ctx.prisma.dashboardSettings.findUnique({
        where: { key: 'room_cards' },
      });
      
      if (!setting?.value) {
        return [];
      }

      try {
        const roomCards = JSON.parse(setting.value as string) || [];
        if (input.isActive !== undefined) {
          return roomCards.filter((card: { isActive: boolean }) => card.isActive === input.isActive);
        }
        return roomCards;
      } catch (_error) {
        console.error('Error parsing room cards:', _error);
        return [];
      }
    }),

  createRoomCard: adminProcedure
    .input(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        category: z.string().default('general'),
        image: z.string().optional(),
        matrixRoomId: z.string().optional(),
        directLink: z.string().optional(),
        forumLink: z.string().optional(),
        wikiLink: z.string().optional(),
        memberCount: z.number().default(0),
        order: z.number().default(0),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get existing room cards
      const setting = await ctx.prisma.dashboardSettings.findUnique({
        where: { key: 'room_cards' },
      });

      let roomCards = [];
      if (setting?.value) {
        try {
          roomCards = JSON.parse(setting.value as string) || [];
        } catch (_error) {
          console.error('Error parsing existing room cards:', error);
        }
      }

      // Create new room card with unique ID
      const newCard = {
        id: Date.now(), // Simple ID generation
        ...input,
        createdAt: new Date().toISOString(),
        createdBy: ctx.session.user.username || 'unknown',
      };

      roomCards.push(newCard);

      // Save back to settings
      await ctx.prisma.dashboardSettings.upsert({
        where: { key: 'room_cards' },
        update: { value: JSON.stringify(roomCards) },
        create: { key: 'room_cards', value: JSON.stringify(roomCards) },
      });

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'room_card_created',
          username: ctx.session.user.username || 'unknown',
          details: `Created room card: ${input.title}`,
        },
      });

      return newCard;
    }),

  updateRoomCard: adminProcedure
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        image: z.string().optional(),
        matrixRoomId: z.string().optional(),
        directLink: z.string().optional(),
        forumLink: z.string().optional(),
        wikiLink: z.string().optional(),
        memberCount: z.number().optional(),
        order: z.number().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;

      // Get existing room cards
      const setting = await ctx.prisma.dashboardSettings.findUnique({
        where: { key: 'room_cards' },
      });

      if (!setting?.value) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Room card not found',
        });
      }

      let roomCards = [];
      try {
        roomCards = JSON.parse(setting.value as string) || [];
      } catch (_error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error parsing room cards data',
        });
      }

      // Find and update the card
      const cardIndex = roomCards.findIndex((card: { id: number }) => card.id === id);
      if (cardIndex === -1) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Room card not found',
        });
      }

      roomCards[cardIndex] = {
        ...roomCards[cardIndex],
        ...updateData,
        updatedAt: new Date().toISOString(),
        updatedBy: ctx.session.user.username || 'unknown',
      };

      // Save back to settings
      await ctx.prisma.dashboardSettings.update({
        where: { key: 'room_cards' },
        data: { value: JSON.stringify(roomCards) },
      });

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'room_card_updated',
          username: ctx.session.user.username || 'unknown',
          details: `Updated room card: ${roomCards[cardIndex].title}`,
        },
      });

      return roomCards[cardIndex];
    }),

  deleteRoomCard: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // Get existing room cards
      const setting = await ctx.prisma.dashboardSettings.findUnique({
        where: { key: 'room_cards' },
      });

      if (!setting?.value) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Room card not found',
        });
      }

      let roomCards = [];
      try {
        roomCards = JSON.parse(setting.value as string) || [];
      } catch (_error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error parsing room cards data',
        });
      }

      // Find and remove the card
      const cardIndex = roomCards.findIndex((card: { id: number }) => card.id === input.id);
      if (cardIndex === -1) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Room card not found',
        });
      }

      const deletedCard = roomCards[cardIndex];
      roomCards.splice(cardIndex, 1);

      // Save back to settings
      await ctx.prisma.dashboardSettings.update({
        where: { key: 'room_cards' },
        data: { value: JSON.stringify(roomCards) },
      });

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'room_card_deleted',
          username: ctx.session.user.username || 'unknown',
          details: `Deleted room card: ${deletedCard.title}`,
        },
      });

      return { success: true };
    }),

  reorderRoomCards: adminProcedure
    .input(z.object({ cards: z.array(z.object({ id: z.number(), order: z.number() })) }))
    .mutation(async ({ ctx, input }) => {
      // Get existing room cards
      const setting = await ctx.prisma.dashboardSettings.findUnique({
        where: { key: 'room_cards' },
      });

      if (!setting?.value) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No room cards found',
        });
      }

      let roomCards = [];
      try {
        roomCards = JSON.parse(setting.value as string) || [];
      } catch (_error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Error parsing room cards data',
        });
      }

      // Update order for each card
      input.cards.forEach(({ id, order }) => {
        const cardIndex = roomCards.findIndex((card: { id: number }) => card.id === id);
        if (cardIndex !== -1) {
          roomCards[cardIndex].order = order;
          roomCards[cardIndex].updatedAt = new Date().toISOString();
        }
      });

      // Sort by order
      roomCards.sort((a: { order: number }, b: { order: number }) => a.order - b.order);

      // Save back to settings
      await ctx.prisma.dashboardSettings.update({
        where: { key: 'room_cards' },
        data: { value: JSON.stringify(roomCards) },
      });

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'room_cards_reordered',
          username: ctx.session.user.username || 'unknown',
          details: `Reordered ${input.cards.length} room cards`,
        },
      });

      return { success: true };
    }),
}); 