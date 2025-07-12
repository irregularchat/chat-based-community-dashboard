import { z } from 'zod';
import { createTRPCRouter, protectedProcedure, adminProcedure, moderatorProcedure } from '../trpc';

export const userRouter = createTRPCRouter({
  // Get paginated list of users
  getUsers: moderatorProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(10),
        search: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, limit, search, isActive } = input;
      const skip = (page - 1) * limit;

      const where = {
        ...(search && {
          OR: [
            { username: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
            { firstName: { contains: search, mode: 'insensitive' as const } },
            { lastName: { contains: search, mode: 'insensitive' as const } },
          ],
        }),
        ...(isActive !== undefined && { isActive }),
      };

      const [users, total] = await Promise.all([
        ctx.prisma.user.findMany({
          where,
          skip,
          take: limit,
          orderBy: { dateJoined: 'desc' },
          include: {
            groups: {
              include: {
                group: true,
              },
            },
            notes: true,
          },
        }),
        ctx.prisma.user.count({ where }),
      ]);

      return {
        users,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }),

  // Get single user by ID
  getUser: moderatorProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      return await ctx.prisma.user.findUnique({
        where: { id: input.id },
        include: {
          groups: {
            include: {
              group: true,
            },
          },
          notes: {
            orderBy: { createdAt: 'desc' },
          },
          moderatorPermissions: true,
        },
      });
    }),

  // Create new user
  createUser: adminProcedure
    .input(
      z.object({
        username: z.string().min(1),
        email: z.string().email(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        password: z.string().min(6).optional(),
        isActive: z.boolean().default(true),
        isAdmin: z.boolean().default(false),
        isModerator: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { password, ...userData } = input;

      const user = await ctx.prisma.user.create({
        data: {
          ...userData,
          ...(password && { password: await hashPassword(password) }),
        },
      });

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'user_created',
          username: ctx.session.user.username || 'unknown',
          details: `Created user: ${user.username}`,
        },
      });

      return user;
    }),

  // Update user
  updateUser: adminProcedure
    .input(
      z.object({
        id: z.number(),
        username: z.string().optional(),
        email: z.string().email().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        isActive: z.boolean().optional(),
        isAdmin: z.boolean().optional(),
        isModerator: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;

      const user = await ctx.prisma.user.update({
        where: { id },
        data: updateData,
      });

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'user_updated',
          username: ctx.session.user.username || 'unknown',
          details: `Updated user: ${user.username}`,
        },
      });

      return user;
    }),

  // Delete user
  deleteUser: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: input.id },
      });

      if (!user) {
        throw new Error('User not found');
      }

      await ctx.prisma.user.delete({
        where: { id: input.id },
      });

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'user_deleted',
          username: ctx.session.user.username || 'unknown',
          details: `Deleted user: ${user.username}`,
        },
      });

      return { success: true };
    }),

  // Add note to user
  addNote: moderatorProcedure
    .input(
      z.object({
        userId: z.number(),
        content: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const note = await ctx.prisma.userNote.create({
        data: {
          userId: input.userId,
          content: input.content,
          createdBy: ctx.session.user.username || 'unknown',
        },
      });

      return note;
    }),

  // Update note
  updateNote: moderatorProcedure
    .input(
      z.object({
        id: z.number(),
        content: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const note = await ctx.prisma.userNote.update({
        where: { id: input.id },
        data: {
          content: input.content,
          lastEditedBy: ctx.session.user.username || 'unknown',
        },
      });

      return note;
    }),

  // Delete note
  deleteNote: moderatorProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.userNote.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),
});

// Helper function for password hashing
async function hashPassword(password: string): Promise<string> {
  const bcrypt = await import('bcryptjs');
  return bcrypt.hash(password, 12);
} 