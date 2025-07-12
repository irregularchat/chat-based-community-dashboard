import { z } from 'zod';
import { createTRPCRouter, publicProcedure, protectedProcedure } from '../trpc';

export const authRouter = createTRPCRouter({
  // Get current session
  getSession: publicProcedure.query(({ ctx }) => {
    return ctx.session;
  }),

  // Get current user profile
  getCurrentUser: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.session.user.id) {
      return null;
    }

    const user = await ctx.prisma.user.findUnique({
      where: { id: parseInt(ctx.session.user.id) },
      include: {
        groups: {
          include: {
            group: true,
          },
        },
        notes: true,
      },
    });

    return user;
  }),

  // Update current user profile
  updateProfile: protectedProcedure
    .input(
      z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.string().email().optional(),
        matrixUsername: z.string().optional(),
        signalIdentity: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session.user.id) {
        throw new Error('User not authenticated');
      }

      const user = await ctx.prisma.user.update({
        where: { id: parseInt(ctx.session.user.id) },
        data: {
          ...input,
        },
      });

      return user;
    }),
}); 