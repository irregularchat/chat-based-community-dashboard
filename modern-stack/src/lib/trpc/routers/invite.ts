import { z } from 'zod';
import { createTRPCRouter, protectedProcedure, moderatorProcedure } from '../trpc';
import { authentikService } from '@/lib/authentik';
import { emailService } from '@/lib/email';
import { MessageTemplates } from '@/lib/message-templates';

export const inviteRouter = createTRPCRouter({
  // Get available groups for invite assignment
  getGroups: moderatorProcedure.query(async ({ ctx: _ctx }) => {
    try {
      const groups = await authentikService.getGroups();
      return groups;
    } catch (error) {
      console.error('Error fetching groups:', error);
      return [];
    }
  }),

  // Create a general invite link
  createInvite: moderatorProcedure
    .input(
      z.object({
        label: z.string().min(1, 'Label is required'),
        expiryDays: z.number().min(1).max(30).default(7),
        groups: z.array(z.string()).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Calculate expiry date
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + input.expiryDays);

        // Create invite via Authentik
        const result = await authentikService.createInvite({
          label: input.label,
          expires: expiryDate,
          groups: input.groups,
          createdBy: ctx.session.user.username || 'unknown',
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to create invite');
        }

        // Store invite in local database for tracking
        const invite = await ctx.prisma.invite.create({
          data: {
            token: result.invite_id!,
            label: input.label,
            expiresAt: expiryDate,
            createdBy: ctx.session.user.username || 'unknown',
            groups: input.groups.length > 0 ? JSON.stringify(input.groups) : null,
          },
        });

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'invite_created',
            username: ctx.session.user.username || 'unknown',
            details: `Created invite "${input.label}" (expires: ${expiryDate.toISOString()}, groups: ${input.groups.length})`,
          },
        });

        return {
          success: true,
          inviteLink: result.invite_link!,
          expiry: result.expiry!,
          inviteId: invite.id,
        };

      } catch (error) {
        console.error('Error creating invite:', error);
        throw new Error(`Failed to create invite: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }),

  // Create and send personalized invite via email
  createAndSendInvite: moderatorProcedure
    .input(
      z.object({
        name: z.string().min(1, 'Name is required'),
        email: z.string().email('Valid email is required'),
        expiryDays: z.number().min(1).max(30).default(7),
        groups: z.array(z.string()).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Calculate expiry date
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + input.expiryDays);

        // Create invite via Authentik
        const result = await authentikService.createInvite({
          label: input.name,
          expires: expiryDate,
          email: input.email,
          name: input.name,
          groups: input.groups,
          createdBy: ctx.session.user.username || 'unknown',
        });

        if (!result.success) {
          throw new Error(result.error || 'Failed to create invite');
        }

        // Store invite in local database for tracking
        const invite = await ctx.prisma.invite.create({
          data: {
            token: result.invite_id!,
            label: input.name,
            email: input.email,
            name: input.name,
            expiresAt: expiryDate,
            createdBy: ctx.session.user.username || 'unknown',
            groups: input.groups.length > 0 ? JSON.stringify(input.groups) : null,
          },
        });

        // Send email if email service is configured
        let emailSent = false;
        if (emailService.isConfigured()) {
          try {
            emailSent = await emailService.sendInviteEmail(
              input.email,
              "You've been invited to join IrregularChat!",
              input.name,
              result.invite_link!
            );
          } catch (emailError) {
            console.error('Error sending invite email:', emailError);
            // Don't fail the invite creation if email fails
          }
        }

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'invite_sent',
            username: ctx.session.user.username || 'unknown',
            details: `Created and ${emailSent ? 'sent' : 'attempted to send'} invite to ${input.email} (${input.name})`,
          },
        });

        return {
          success: true,
          inviteLink: result.invite_link!,
          expiry: result.expiry!,
          inviteId: invite.id,
          emailSent,
        };

      } catch (error) {
        console.error('Error creating and sending invite:', error);
        throw new Error(`Failed to create and send invite: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }),

  // Get list of created invites
  getInvites: moderatorProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(10),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, limit } = input;
      const skip = (page - 1) * limit;

      const [invites, total] = await Promise.all([
        ctx.prisma.invite.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        ctx.prisma.invite.count(),
      ]);

      return {
        invites: invites.map(invite => ({
          ...invite,
          groups: invite.groups ? JSON.parse(invite.groups) : [],
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }),

  // Mark invite as used (called when someone uses an invite)
  markInviteUsed: protectedProcedure
    .input(
      z.object({
        token: z.string(),
        usedBy: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const invite = await ctx.prisma.invite.findUnique({
          where: { token: input.token },
        });

        if (!invite) {
          throw new Error('Invite not found');
        }

        if (invite.isUsed) {
          throw new Error('Invite already used');
        }

        if (invite.expiresAt < new Date()) {
          throw new Error('Invite expired');
        }

        await ctx.prisma.invite.update({
          where: { token: input.token },
          data: {
            isUsed: true,
            usedBy: input.usedBy,
            usedAt: new Date(),
          },
        });

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'invite_used',
            username: input.usedBy,
            details: `Used invite "${invite.label}" created by ${invite.createdBy}`,
          },
        });

        return { success: true };

      } catch (error) {
        console.error('Error marking invite as used:', error);
        throw new Error(`Failed to mark invite as used: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }),

  // Generate invite message template for copy/paste
  generateInviteMessage: moderatorProcedure
    .input(
      z.object({
        inviteLink: z.string(),
        expiryDate: z.string(),
        recipientName: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { inviteLink, expiryDate, recipientName } = input;
      
      // Convert to timestamp format for MessageTemplates
      const expiry = new Date(expiryDate);
      const expiresAt = Math.floor(expiry.getTime() / 1000);

      // Use MessageTemplates to generate the invite message
      const message = MessageTemplates.createInviteMessage({
        inviteLink,
        expiresAt,
        recipientName,
      });

      return { message };
    }),
}); 