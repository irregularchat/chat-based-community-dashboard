import { z } from 'zod';
import { createTRPCRouter, protectedProcedure, adminProcedure, moderatorProcedure } from '../trpc';
import { authentikService } from '@/lib/authentik';
import bcrypt from 'bcryptjs';

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

  // Create SSO user with Authentik integration
  createSSOUser: adminProcedure
    .input(
      z.object({
        email: z.string().email(),
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        username: z.string().optional(),
        phoneNumber: z.string().optional(),
        attributes: z.record(z.string(), z.any()).optional(),
        groups: z.array(z.string()).optional(),
        sendWelcomeEmail: z.boolean().default(true),
        autoGenerateUsername: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Generate username if not provided
        let username = input.username;
        if (!username || input.autoGenerateUsername) {
          username = await authentikService.generateUsername(input.firstName);
          
          // Check if username exists and generate alternatives if needed
          let attempts = 0;
          while (await authentikService.checkUsernameExists(username) && attempts < 10) {
            username = await authentikService.generateUsername(input.firstName);
            attempts++;
          }
        }

        // Prepare attributes including phone number if provided
        const attributes = {
          ...input.attributes,
          ...(input.phoneNumber && { phone_number: input.phoneNumber }),
          created_by: ctx.session.user.username || 'admin',
          created_via: 'community_dashboard',
        };

        // Create user in Authentik SSO
        const authentikResult = await authentikService.createUser({
          username,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          attributes,
          groups: input.groups,
        });

        if (!authentikResult.success) {
          throw new Error(`SSO user creation failed: ${authentikResult.error}`);
        }

        // Create local user record for synchronization
        const localUser = await ctx.prisma.user.create({
          data: {
            username,
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName,
            authentikId: authentikResult.user_id,
            isActive: true,
          },
        });

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'sso_user_created',
            username: ctx.session.user.username || 'unknown',
            details: `Created SSO user: ${username} (${input.email})`,
          },
        });

        return {
          success: true,
          user: localUser,
          ssoUserId: authentikResult.user_id,
          username: authentikResult.username,
          tempPassword: authentikResult.temp_password,
          passwordResetLink: authentikResult.password_reset_link,
          credentials: {
            username: authentikResult.username,
            password: authentikResult.temp_password,
            resetLink: authentikResult.password_reset_link,
          }
        };

      } catch (error) {
        console.error('Error creating SSO user:', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to create SSO user');
      }
    }),

  // Generate username suggestions
  generateUsername: moderatorProcedure
    .input(
      z.object({
        firstName: z.string().min(1),
        count: z.number().default(3),
      })
    )
    .query(async ({ input }) => {
      const suggestions = [];
      
      for (let i = 0; i < input.count; i++) {
        const username = await authentikService.generateUsername(input.firstName);
        const exists = await authentikService.checkUsernameExists(username);
        
        suggestions.push({
          username,
          available: !exists,
        });
      }
      
      return suggestions;
    }),

  // Check username availability
  checkUsername: moderatorProcedure
    .input(z.object({ username: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const existsInSSO = await authentikService.checkUsernameExists(input.username);
      const existsLocally = await ctx.prisma.user.findUnique({
        where: { username: input.username },
      });
      
      return {
        available: !existsInSSO && !existsLocally,
        existsInSSO,
        existsLocally: !!existsLocally,
      };
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