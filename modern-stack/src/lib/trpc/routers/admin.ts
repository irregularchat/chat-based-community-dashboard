import { z } from 'zod';
import { createTRPCRouter, adminProcedure } from '../trpc';

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
      totalSessions,
      recentSessions,
      totalMatrixRooms,
      totalModeratorPermissions,
    ] = await Promise.all([
      // Total users
      ctx.prisma.user.count(),
      
      // Active users (using updatedAt as proxy - updated in last 30 days)
      ctx.prisma.user.count({
        where: { 
          updatedAt: {
            gte: thirtyDaysAgo
          }
        },
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
          createdAt: {
            gte: thirtyDaysAgo,
          },
        },
      }),
      
      // New users this week
      ctx.prisma.user.count({
        where: {
          createdAt: {
            gte: sevenDaysAgo,
          },
        },
      }),
      
      // Recent logins (last 24 hours) - using updatedAt as proxy
      ctx.prisma.user.count({
        where: {
          updatedAt: {
            gte: oneDayAgo,
          },
        },
      }),
      
      // Total sessions
      ctx.prisma.session.count(),
      
      // Recent sessions (last 7 days)
      ctx.prisma.session.count({
        where: {
          expires: {
            gte: sevenDaysAgo,
          },
        },
      }),
      
      // Total Matrix Rooms
      ctx.prisma.matrixRoom.count(),
      
      // Total moderator permissions
      ctx.prisma.moderatorPermission.count(),
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
      sessions: {
        total: totalSessions,
        recent: recentSessions,
      },
      matrix: {
        rooms: totalMatrixRooms,
      },
      moderation: {
        permissions: totalModeratorPermissions,
      },
      timestamp: now.toISOString(),
    };
  }),

  // Get user growth chart data
  getUserGrowthData: adminProcedure
    .input(z.object({
      days: z.number().min(7).max(365).default(30),
    }))
    .query(async ({ ctx, input }) => {
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - input.days * 24 * 60 * 60 * 1000);

      const users = await ctx.prisma.user.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        select: {
          createdAt: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      // Group users by date
      const usersByDate: Record<string, number> = {};
      users.forEach((user) => {
        const date = user.createdAt.toISOString().split('T')[0];
        usersByDate[date] = (usersByDate[date] || 0) + 1;
      });

      // Create array of all dates in range with counts
      const chartData = [];
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        chartData.push({
          date: dateStr,
          users: usersByDate[dateStr] || 0,
        });
        currentDate.setDate(currentDate.getDate() + 1);
      }

      return chartData;
    }),

  // Additional functions for compatibility with admin page
  getUserRegistrationTrends: adminProcedure.query(async ({ ctx: _ctx }) => {
    // Return mock registration trend data
    const trends = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      trends.push({
        date: date.toISOString(),
        count: Math.floor(Math.random() * 20) + 1,
      });
    }
    return trends;
  }),

  getEventTypeDistribution: adminProcedure.query(async ({ ctx: _ctx }) => {
    // Return mock event type distribution data for now
    return [
      { eventType: 'Community Events', count: 45 },
      { eventType: 'User Activities', count: 32 },
      { eventType: 'Matrix Sync', count: 28 },
      { eventType: 'Admin Actions', count: 15 },
      { eventType: 'System Events', count: 12 }
    ];
  }),

  getMostActiveUsers: adminProcedure
    .input(z.object({
      limit: z.number().default(10),
      days: z.number().default(30),
    }))
    .query(async ({ ctx, input }) => {
      // Return recent users as proxy for most active
      const users = await ctx.prisma.user.findMany({
        where: {
          updatedAt: {
            gte: new Date(Date.now() - input.days * 24 * 60 * 60 * 1000)
          }
        },
        select: {
          id: true,
          name: true,
          email: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: input.limit,
      });

      return users.map(user => ({
        ...user,
        activity: Math.floor(Math.random() * 100), // Mock activity score
      }));
    }),

  getAdminEvents: adminProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(50),
      eventType: z.string().optional(),
      username: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Filter by username if provided
      const userFilter = input.username ? {
        user: {
          OR: [
            { name: { contains: input.username, mode: 'insensitive' as const } },
            { email: { contains: input.username, mode: 'insensitive' as const } },
          ]
        }
      } : {};

      // Return sessions as proxy for admin events
      const [sessions, total] = await Promise.all([
        ctx.prisma.session.findMany({
          where: userFilter,
          include: {
            user: {
              select: {
                name: true,
                email: true,
              },
            },
          },
          orderBy: {
            expires: 'desc',
          },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        ctx.prisma.session.count({ where: userFilter }),
      ]);

      const activities = sessions.map((session) => ({
        id: session.id,
        timestamp: session.expires,
        type: input.eventType || 'session_activity',
        description: `User session for ${session.user?.name || session.user?.email || 'Unknown'}`,
        user: session.user,
      }));

      return {
        events: activities,
        total,
        page: input.page,
        totalPages: Math.ceil(total / input.limit),
      };
    }),

  exportAdminData: adminProcedure
    .input(z.object({
      format: z.enum(['csv', 'json']).default('csv'),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Return basic export data
      const users = await ctx.prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          isAdmin: true,
          isModerator: true,
        },
      });

      if (input.format === 'json') {
        return { data: users, format: 'json' };
      }

      // Simple CSV format
      const csv = [
        'ID,Name,Email,Created,Admin,Moderator',
        ...users.map(u => `${u.id},${u.name || ''},${u.email || ''},${u.createdAt.toISOString()},${u.isAdmin},${u.isModerator}`)
      ].join('\n');

      return { data: csv, format: 'csv' };
    }),

  // Get users with enhanced filtering and pagination
  getUsers: adminProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
      search: z.string().optional(),
      role: z.enum(['all', 'admin', 'moderator', 'user']).default('all'),
      sortBy: z.enum(['createdAt', 'updatedAt', 'name', 'email']).default('createdAt'),
      sortOrder: z.enum(['asc', 'desc']).default('desc'),
    }))
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {};

      // Add search filter
      if (input.search) {
        where.OR = [
          { name: { contains: input.search, mode: 'insensitive' } },
          { email: { contains: input.search, mode: 'insensitive' } },
        ];
      }

      // Add role filter
      if (input.role === 'admin') {
        where.isAdmin = true;
      } else if (input.role === 'moderator') {
        where.isModerator = true;
      } else if (input.role === 'user') {
        where.isAdmin = false;
        where.isModerator = false;
      }

      const [users, total] = await Promise.all([
        ctx.prisma.user.findMany({
          where,
          select: {
            id: true,
            name: true,
            email: true,
            isAdmin: true,
            isModerator: true,
            createdAt: true,
            updatedAt: true,
            matrixUsername: true,
            signalIdentity: true,
          },
          orderBy: {
            [input.sortBy]: input.sortOrder,
          },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        ctx.prisma.user.count({ where }),
      ]);

      return {
        users,
        total,
        page: input.page,
        totalPages: Math.ceil(total / input.limit),
      };
    }),

  // Get recent activities (placeholder for admin events)
  getRecentActivities: adminProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      // Since adminEvent model is not available, return session activity as proxy
      const [sessions, total] = await Promise.all([
        ctx.prisma.session.findMany({
          include: {
            user: {
              select: {
                name: true,
                email: true,
              },
            },
          },
          orderBy: {
            expires: 'desc',
          },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        ctx.prisma.session.count(),
      ]);

      // Transform sessions to activity-like format
      const activities = sessions.map((session) => ({
        id: session.id,
        timestamp: session.expires,
        type: 'session_activity',
        description: `User session for ${session.user?.name || session.user?.email || 'Unknown'}`,
        user: session.user,
      }));

      return {
        activities,
        total,
        page: input.page,
        totalPages: Math.ceil(total / input.limit),
      };
    }),

  // System health check
  getSystemHealth: adminProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    try {
      const [
        activeSessions,
        totalUsers,
        recentUsers,
      ] = await Promise.all([
        ctx.prisma.session.count({
          where: {
            expires: { gt: now }
          }
        }),
        ctx.prisma.user.count(),
        ctx.prisma.user.count({
          where: {
            updatedAt: { gte: oneHourAgo }
          }
        })
      ]);

      return {
        database: {
          status: 'healthy',
          activeSessions,
          totalUsers,
          recentUsers,
        },
        timestamp: now.toISOString(),
      };
    } catch (error) {
      return {
        database: {
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: now.toISOString(),
      };
    }
  }),

  // User management operations
  updateUserPermissions: adminProcedure
    .input(z.object({
      userId: z.string(),
      isAdmin: z.boolean().optional(),
      isModerator: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Don't allow changing own admin status
      if (input.userId === ctx.session?.user?.id && input.isAdmin === false) {
        throw new Error('Cannot remove your own admin privileges');
      }

      const updateData: Record<string, boolean> = {};
      if (input.isAdmin !== undefined) updateData.isAdmin = input.isAdmin;
      if (input.isModerator !== undefined) updateData.isModerator = input.isModerator;

      const updatedUser = await ctx.prisma.user.update({
        where: { id: input.userId },
        data: updateData,
        select: {
          id: true,
          name: true,
          email: true,
          isAdmin: true,
          isModerator: true,
        },
      });

      return updatedUser;
    }),

  // Delete user account
  deleteUser: adminProcedure
    .input(z.object({
      userId: z.string(),
      confirmation: z.string().refine(val => val === 'DELETE', {
        message: 'Must type DELETE to confirm',
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      // Don't allow deleting own account
      if (input.userId === ctx.session?.user?.id) {
        throw new Error('Cannot delete your own account');
      }

      // Get user info before deletion
      const targetUser = await ctx.prisma.user.findUnique({
        where: { id: input.userId },
        select: {
          name: true,
          email: true,
        },
      });

      if (!targetUser) {
        throw new Error('User not found');
      }

      // Delete user (this will cascade to related records)
      await ctx.prisma.user.delete({
        where: { id: input.userId },
      });

      return {
        success: true,
        message: `User ${targetUser.name || targetUser.email} has been deleted`,
      };
    }),

  // Matrix room management
  getMatrixRooms: adminProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const [rooms, total] = await Promise.all([
        ctx.prisma.matrixRoom.findMany({
          orderBy: {
            id: 'desc',
          },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        ctx.prisma.matrixRoom.count(),
      ]);

      return {
        rooms,
        total,
        page: input.page,
        totalPages: Math.ceil(total / input.limit),
      };
    }),

  // Moderator permissions management
  getModeratorPermissions: adminProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const [permissions, total] = await Promise.all([
        ctx.prisma.moderatorPermission.findMany({
          orderBy: {
            id: 'desc',
          },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        ctx.prisma.moderatorPermission.count(),
      ]);

      return {
        permissions,
        total,
        page: input.page,
        totalPages: Math.ceil(total / input.limit),
      };
    }),
});
