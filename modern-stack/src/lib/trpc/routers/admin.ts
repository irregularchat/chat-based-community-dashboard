import { z } from 'zod';
import { createTRPCRouter, adminProcedure, moderatorProcedure } from '../trpc';

export const adminRouter = createTRPCRouter({
  // Get dashboard overview statistics
  getDashboardOverview: adminProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      adminUsers,
      moderatorUsers,
      newUsersThisMonth,
      newUsersThisWeek,
      recentLogins,
      totalAdminEvents,
      recentAdminEvents,
      totalMatrixUsers,
      totalMatrixRooms,
      totalNotes,
      totalInvites,
      activeInvites,
    ] = await Promise.all([
      // Total users
      ctx.prisma.user.count(),
      
      // Active users
      ctx.prisma.user.count({
        where: { isActive: true },
      }),
      
      // Admin users
      ctx.prisma.user.count({
        where: { isAdmin: true },
      }),
      
      // Moderator users
      ctx.prisma.user.count({
        where: { isModerator: true },
      }),
      
      // New users this month
      ctx.prisma.user.count({
        where: {
          dateJoined: {
            gte: thirtyDaysAgo,
          },
        },
      }),
      
      // New users this week
      ctx.prisma.user.count({
        where: {
          dateJoined: {
            gte: sevenDaysAgo,
          },
        },
      }),
      
      // Recent logins (last 24 hours)
      ctx.prisma.user.count({
        where: {
          lastLogin: {
            gte: oneDayAgo,
          },
        },
      }),
      
      // Total admin events
      ctx.prisma.adminEvent.count(),
      
      // Recent admin events (last 7 days)
      ctx.prisma.adminEvent.count({
        where: {
          timestamp: {
            gte: sevenDaysAgo,
          },
        },
      }),
      
      // Total Matrix users
      ctx.prisma.matrixUser.count(),
      
      // Total Matrix rooms
      ctx.prisma.matrixRoom.count(),
      
      // Total notes
      ctx.prisma.userNote.count(),
      
      // Total invites
      ctx.prisma.invite.count(),
      
      // Active invites (not used and not expired)
      ctx.prisma.invite.count({
        where: {
          isUsed: false,
          expiresAt: {
            gt: now,
          },
        },
      }),
    ]);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        admins: adminUsers,
        moderators: moderatorUsers,
        newThisMonth: newUsersThisMonth,
        newThisWeek: newUsersThisWeek,
        recentLogins: recentLogins,
      },
      activity: {
        totalEvents: totalAdminEvents,
        recentEvents: recentAdminEvents,
        totalNotes: totalNotes,
      },
      matrix: {
        totalUsers: totalMatrixUsers,
        totalRooms: totalMatrixRooms,
      },
      invites: {
        total: totalInvites,
        active: activeInvites,
      },
    };
  }),

  // Get user registration trends (last 30 days)
  getUserRegistrationTrends: adminProcedure.query(async ({ ctx }) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const registrations = await ctx.prisma.user.findMany({
      where: {
        dateJoined: {
          gte: thirtyDaysAgo,
        },
      },
      select: {
        dateJoined: true,
      },
      orderBy: {
        dateJoined: 'asc',
      },
    });

    // Group by date
    const trendsMap = new Map<string, number>();
    registrations.forEach((user) => {
      const date = user.dateJoined.toISOString().split('T')[0];
      trendsMap.set(date, (trendsMap.get(date) || 0) + 1);
    });

    // Create array of last 30 days with counts
    const trends = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateString = date.toISOString().split('T')[0];
      trends.push({
        date: dateString,
        count: trendsMap.get(dateString) || 0,
      });
    }

    return trends;
  }),

  // Get admin event logs with pagination
  getAdminEvents: moderatorProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(50),
        eventType: z.string().optional(),
        username: z.string().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, limit, eventType, username, startDate, endDate } = input;
      const skip = (page - 1) * limit;

      const where = {
        ...(eventType && { eventType }),
        ...(username && { username: { contains: username, mode: 'insensitive' as const } }),
        ...(startDate && endDate && {
          timestamp: {
            gte: startDate,
            lte: endDate,
          },
        }),
      };

      const [events, total] = await Promise.all([
        ctx.prisma.adminEvent.findMany({
          where,
          skip,
          take: limit,
          orderBy: { timestamp: 'desc' },
        }),
        ctx.prisma.adminEvent.count({ where }),
      ]);

      return {
        events,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }),

  // Get activity heatmap data
  getActivityHeatmap: adminProcedure
    .input(
      z.object({
        days: z.number().default(90),
      })
    )
    .query(async ({ ctx, input }) => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);

      const events = await ctx.prisma.adminEvent.findMany({
        where: {
          timestamp: {
            gte: startDate,
          },
        },
        select: {
          timestamp: true,
          eventType: true,
        },
        orderBy: {
          timestamp: 'asc',
        },
      });

      // Group events by date and hour
      const heatmapData = new Map<string, number>();
      events.forEach((event) => {
        const date = event.timestamp.toISOString().split('T')[0];
        const hour = event.timestamp.getHours();
        const key = `${date}-${hour}`;
        heatmapData.set(key, (heatmapData.get(key) || 0) + 1);
      });

      return Array.from(heatmapData.entries()).map(([key, count]) => {
        const [date, hour] = key.split('-');
        return { date, hour: parseInt(hour), count };
      });
    }),

  // Get event type distribution
  getEventTypeDistribution: adminProcedure.query(async ({ ctx }) => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const events = await ctx.prisma.adminEvent.findMany({
      where: {
        timestamp: {
          gte: sevenDaysAgo,
        },
      },
      select: {
        eventType: true,
      },
    });

    const distribution = new Map<string, number>();
    events.forEach((event) => {
      distribution.set(event.eventType, (distribution.get(event.eventType) || 0) + 1);
    });

    return Array.from(distribution.entries()).map(([eventType, count]) => ({
      eventType,
      count,
    }));
  }),

  // Get most active users (by admin events)
  getMostActiveUsers: adminProcedure
    .input(
      z.object({
        limit: z.number().default(10),
        days: z.number().default(30),
      })
    )
    .query(async ({ ctx, input }) => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);

      const events = await ctx.prisma.adminEvent.findMany({
        where: {
          timestamp: {
            gte: startDate,
          },
          username: {
            not: null,
          },
        },
        select: {
          username: true,
        },
      });

      const userActivity = new Map<string, number>();
      events.forEach((event) => {
        if (event.username) {
          userActivity.set(event.username, (userActivity.get(event.username) || 0) + 1);
        }
      });

      return Array.from(userActivity.entries())
        .map(([username, count]) => ({ username, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, input.limit);
    }),

  // Get system health metrics
  getSystemHealth: adminProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      recentErrors,
      recentLogins,
      matrixSyncStatus,
      inviteUsage,
    ] = await Promise.all([
      ctx.prisma.user.count(),
      ctx.prisma.user.count({ where: { isActive: true } }),
      ctx.prisma.adminEvent.count({
        where: {
          eventType: { contains: 'error' },
          timestamp: { gte: oneDayAgo },
        },
      }),
      ctx.prisma.adminEvent.count({
        where: {
          eventType: 'user_login',
          timestamp: { gte: oneDayAgo },
        },
      }),
      ctx.prisma.matrixRoom.count({
        where: {
          lastSynced: { gte: oneDayAgo },
        },
      }),
      ctx.prisma.invite.count({
        where: {
          isUsed: true,
          usedAt: { gte: oneDayAgo },
        },
      }),
    ]);

    return {
      userHealth: {
        totalUsers,
        activeUsers,
        activePercentage: totalUsers > 0 ? (activeUsers / totalUsers) * 100 : 0,
      },
      activityHealth: {
        recentLogins,
        recentErrors,
        errorRate: recentLogins > 0 ? (recentErrors / recentLogins) * 100 : 0,
      },
      matrixHealth: {
        recentlySynced: matrixSyncStatus,
        status: matrixSyncStatus > 0 ? 'healthy' : 'needs_attention',
      },
      inviteHealth: {
        recentUsage: inviteUsage,
        status: 'healthy',
      },
    };
  }),

  // Export admin data (for reports)
  exportAdminData: adminProcedure
    .input(
      z.object({
        type: z.enum(['users', 'events', 'matrix', 'invites']),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { type, startDate, endDate } = input;

      switch (type) {
        case 'users':
          return await ctx.prisma.user.findMany({
            where: {
              ...(startDate && endDate && {
                dateJoined: {
                  gte: startDate,
                  lte: endDate,
                },
              }),
            },
            select: {
              id: true,
              username: true,
              email: true,
              firstName: true,
              lastName: true,
              isActive: true,
              isAdmin: true,
              isModerator: true,
              dateJoined: true,
              lastLogin: true,
            },
            orderBy: { dateJoined: 'desc' },
          });

        case 'events':
          return await ctx.prisma.adminEvent.findMany({
            where: {
              ...(startDate && endDate && {
                timestamp: {
                  gte: startDate,
                  lte: endDate,
                },
              }),
            },
            orderBy: { timestamp: 'desc' },
          });

        case 'matrix':
          return await ctx.prisma.matrixUser.findMany({
            include: {
              memberships: {
                include: {
                  room: {
                    select: {
                      name: true,
                      memberCount: true,
                    },
                  },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          });

        case 'invites':
          return await ctx.prisma.invite.findMany({
            where: {
              ...(startDate && endDate && {
                createdAt: {
                  gte: startDate,
                  lte: endDate,
                },
              }),
            },
            orderBy: { createdAt: 'desc' },
          });

        default:
          throw new Error('Invalid export type');
      }
    }),

  // Sync users from Authentik SSO
  syncUsersFromSSO: adminProcedure.mutation(async ({ ctx }) => {
    const { authentikService } = await import('@/lib/authentik');
    
    if (!authentikService.isConfigured()) {
      throw new Error('Authentik SSO is not configured');
    }

    try {
      // Get all users from Authentik
      const authentikUsers = await authentikService.listAllUsers();
      
      let created = 0;
      let updated = 0;
      let errors = 0;

      for (const authentikUser of authentikUsers) {
        try {
          // Parse name - Authentik provides full name, we need to split it
          const nameParts = authentikUser.name?.split(' ') || [authentikUser.username];
          const firstName = nameParts[0] || authentikUser.username;
          const lastName = nameParts.slice(1).join(' ') || '';

          // Determine user roles based on Authentik groups
          const isAdmin = authentikUser.groups?.includes('admin') || false;
          const isModerator = authentikUser.groups?.includes('moderator') || false;

          // Check if user already exists
          const existingUser = await ctx.prisma.user.findFirst({
            where: {
              OR: [
                { authentikId: authentikUser.pk },
                { username: authentikUser.username },
                { email: authentikUser.email },
              ],
            },
          });

          if (existingUser) {
            // Update existing user
            await ctx.prisma.user.update({
              where: { id: existingUser.id },
              data: {
                authentikId: authentikUser.pk,
                username: authentikUser.username,
                email: authentikUser.email,
                firstName,
                lastName,
                isAdmin,
                isModerator,
                isActive: authentikUser.is_active,
                lastLogin: authentikUser.last_login ? new Date(authentikUser.last_login) : null,
                // Keep existing local data like phone, but update SSO fields
                attributes: {
                  ...(existingUser.attributes as Record<string, unknown> || {}),
                  ssoGroups: authentikUser.groups,
                  lastSyncedFromSSO: new Date().toISOString(),
                },
              },
            });
            updated++;
          } else {
            // Create new user
            await ctx.prisma.user.create({
              data: {
                authentikId: authentikUser.pk,
                username: authentikUser.username,
                email: authentikUser.email,
                firstName,
                lastName,
                password: '', // SSO users don't need local password
                isAdmin,
                isModerator,
                isActive: authentikUser.is_active,
                lastLogin: authentikUser.last_login ? new Date(authentikUser.last_login) : null,
                dateJoined: new Date(), // Set join date to now for new synced users
                attributes: {
                  ssoGroups: authentikUser.groups,
                  syncedFromSSO: true,
                  lastSyncedFromSSO: new Date().toISOString(),
                },
              },
            });
            created++;
          }
        } catch (userError) {
          console.error(`Error syncing user ${authentikUser.username}:`, userError);
          errors++;
        }
      }

      // Log the sync operation
      const { logCommunityEvent } = await import('@/lib/community-timeline');
      await logCommunityEvent({
        eventType: 'user_sync_completed',
        username: ctx.session.user.username || 'admin',
        details: `🔄 SSO user sync completed: ${created} created, ${updated} updated, ${errors} errors`,
        category: 'system',
        isPublic: false,
      });

      return {
        success: true,
        stats: {
          totalProcessed: authentikUsers.length,
          created,
          updated,
          errors,
        },
      };
    } catch (error) {
      console.error('SSO user sync failed:', error);
      throw new Error(`Failed to sync users from SSO: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }),
}); 