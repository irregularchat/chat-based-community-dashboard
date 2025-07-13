import { z } from 'zod';
import { createTRPCRouter, publicProcedure, protectedProcedure, moderatorProcedure, adminProcedure } from '../trpc';
import { authentikService } from '@/lib/authentik';
import { emailService } from '@/lib/email';
import { matrixService } from '@/lib/matrix';
import { discourseService } from '@/lib/discourse';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { TRPCError } from '@trpc/server';

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
        firstName: z.string().transform(val => val.trim() || undefined).optional(),
        lastName: z.string().transform(val => val.trim() || undefined).optional(),
        password: z.string().min(6).optional(),
        isActive: z.boolean().default(true),
        isAdmin: z.boolean().default(false),
        isModerator: z.boolean().default(false),
        // New fields from enhanced form
        organization: z.string().optional(),
        interests: z.string().optional(),
        invitedBy: z.string().optional(),
        signalUsername: z.string().optional(),
        linkedinUsername: z.string().optional(),
        introduction: z.string().optional(),
        phoneNumber: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { password, organization, interests, invitedBy, signalUsername, linkedinUsername, introduction, phoneNumber, ...userData } = input;

      // Prepare attributes for additional fields
      const attributes: Record<string, any> = {};
      if (organization) attributes.organization = organization;
      if (interests) attributes.interests = interests;
      if (invitedBy) attributes.invited_by = invitedBy;
      if (signalUsername) attributes.signal_username = signalUsername;
      if (linkedinUsername) attributes.linkedin_username = linkedinUsername;
      if (introduction) attributes.introduction = introduction;
      if (phoneNumber) attributes.phone_number = phoneNumber;

      const user = await ctx.prisma.user.create({
        data: {
          ...userData,
          firstName: userData.firstName || 'User',
          lastName: userData.lastName || '',
          ...(password && { password: await hashPassword(password) }),
          // Store additional fields in notes or attributes if your schema supports it
          ...(Object.keys(attributes).length > 0 && { attributes }),
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
        firstName: z.string().transform(val => val.trim() || undefined).optional(),
        lastName: z.string().transform(val => val.trim() || undefined).optional(),
        username: z.string().optional(),
        phoneNumber: z.string().optional(),
        attributes: z.record(z.string(), z.any()).optional(),
        groups: z.array(z.string()).optional(),
        sendWelcomeEmail: z.boolean().default(true),
        autoGenerateUsername: z.boolean().default(true),
        // New fields from enhanced form
        organization: z.string().optional(),
        interests: z.string().optional(),
        invitedBy: z.string().optional(),
        signalUsername: z.string().optional(),
        linkedinUsername: z.string().optional(),
        introduction: z.string().optional(),
        createDiscoursePost: z.boolean().default(true),
        sendMatrixWelcome: z.boolean().default(true),
        addToRecommendedRooms: z.boolean().default(true),
        skipIndocRemoval: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Generate username if not provided
        let username = input.username;
        if (!username || input.autoGenerateUsername) {
          // Use firstName if available, otherwise derive from email
          const nameForUsername = input.firstName || input.email.split('@')[0];
          username = await authentikService.generateUsername(nameForUsername);
          
          // Check if username exists and generate alternatives if needed
          let attempts = 0;
          while (await authentikService.checkUsernameExists(username) && attempts < 10) {
            username = await authentikService.generateUsername(nameForUsername);
            attempts++;
          }
        }

        // Prepare attributes including all new fields
        const attributes = {
          ...input.attributes,
          ...(input.phoneNumber && { phone_number: input.phoneNumber }),
          ...(input.organization && { organization: input.organization }),
          ...(input.interests && { interests: input.interests }),
          ...(input.invitedBy && { invited_by: input.invitedBy }),
          ...(input.signalUsername && { signal_username: input.signalUsername }),
          ...(input.linkedinUsername && { linkedin_username: input.linkedinUsername }),
          ...(input.introduction && { introduction: input.introduction }),
          created_by: ctx.session.user.username || 'admin',
          created_via: 'community_dashboard',
          // Store Matrix integration preferences
          send_matrix_welcome: input.sendMatrixWelcome,
          add_to_recommended_rooms: input.addToRecommendedRooms,
          skip_indoc_removal: input.skipIndocRemoval,
          create_discourse_post: input.createDiscoursePost,
        };

        // Create user in Authentik SSO
        const authentikResult = await authentikService.createUser({
          username,
          email: input.email,
          firstName: input.firstName || 'User',
          lastName: input.lastName || '',
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
            firstName: input.firstName || 'User',
            lastName: input.lastName || '',
            authentikId: String(authentikResult.user_id),
            isActive: true,
            // Store additional data in attributes if schema supports it
            attributes,
          },
        });

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'sso_user_created',
            username: ctx.session.user.username || 'unknown',
            details: `Created SSO user: ${username} (${input.email}) with enhanced profile data`,
          },
        });

        // Create Discourse introduction post if requested
        let discoursePostUrl: string | undefined;
        if (input.createDiscoursePost && discourseService.isConfigured()) {
          try {
            const discourseResult = await discourseService.createIntroductionPost({
              username,
              intro: input.introduction,
              invitedBy: input.invitedBy,
              organization: input.organization,
              interests: input.interests,
            });

            if (discourseResult.success && discourseResult.postUrl) {
              discoursePostUrl = discourseResult.postUrl;
              console.log(`Discourse introduction post created for ${username} at: ${discoursePostUrl}`);
            } else {
              console.warn(`Failed to create Discourse post for ${username}: ${discourseResult.error}`);
            }
          } catch (discourseError) {
            console.error('Error creating Discourse post:', discourseError);
            // Don't fail the user creation if Discourse post fails
          }
        }

        // Send welcome email if requested and email service is configured
        if (input.sendWelcomeEmail && emailService.isConfigured() && input.email) {
          try {
            const fullName = `${input.firstName || 'User'} ${input.lastName || ''}`.trim();
            await emailService.sendWelcomeEmail({
              to: input.email,
              subject: 'Welcome to IrregularChat!',
              fullName,
              username,
              password: authentikResult.temp_password || '',
              discoursePostUrl: discoursePostUrl,
            });
            console.log(`Welcome email sent to ${input.email}`);
          } catch (emailError) {
            console.error('Error sending welcome email:', emailError);
            // Don't fail the user creation if email fails
          }
        }

        // Send Matrix welcome message if requested and Matrix service is configured
        if (input.sendMatrixWelcome && matrixService.isConfigured()) {
          try {
            // Generate Matrix user ID format (this should be configurable)
            const matrixUserId = `@${username}:${process.env.MATRIX_DOMAIN || 'matrix.org'}`;
            const fullName = `${input.firstName || 'User'} ${input.lastName || ''}`.trim();
            
            await matrixService.sendWelcomeMessage(
              matrixUserId,
              username,
              fullName,
              authentikResult.temp_password || '',
              discoursePostUrl
            );
            console.log(`Matrix welcome message sent to ${matrixUserId}`);
          } catch (matrixError) {
            console.error('Error sending Matrix welcome message:', matrixError);
            // Don't fail the user creation if Matrix fails
          }
        }

        // Invite to recommended rooms if requested and Matrix service is configured
        if (input.addToRecommendedRooms && matrixService.isConfigured() && input.interests) {
          try {
            const matrixUserId = `@${username}:${process.env.MATRIX_DOMAIN || 'matrix.org'}`;
            const interests = input.interests.split(',').map(i => i.trim());
            
            const inviteResult = await matrixService.inviteToRecommendedRooms(matrixUserId, interests);
            console.log(`Room invitations sent: ${inviteResult.invitedRooms.length} successful, ${inviteResult.errors.length} errors`);
          } catch (inviteError) {
            console.error('Error inviting to recommended rooms:', inviteError);
            // Don't fail the user creation if room invitations fail
          }
        }

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
        throw new Error(`Failed to create SSO user: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

  // Generate secure password
  generatePassword: moderatorProcedure
    .input(
      z.object({
        length: z.number().min(8).max(32).default(12),
        includeSymbols: z.boolean().default(true),
        includeNumbers: z.boolean().default(true),
        includeUppercase: z.boolean().default(true),
        includeLowercase: z.boolean().default(true),
      })
    )
    .query(async ({ input }) => {
      const { length, includeSymbols, includeNumbers, includeUppercase, includeLowercase } = input;
      
      let charset = '';
      if (includeLowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
      if (includeUppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      if (includeNumbers) charset += '0123456789';
      if (includeSymbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';
      
      if (charset === '') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'At least one character type must be selected',
        });
      }
      
      let password = '';
      for (let i = 0; i < length; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
      }
      
      return { password };
    }),

  // Reset user password
  resetPassword: adminProcedure
    .input(
      z.object({
        userId: z.number(),
        newPassword: z.string().optional(),
        generatePassword: z.boolean().default(false),
        sendEmail: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: input.userId },
      });

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        });
      }

      let finalPassword = input.newPassword;
      
      // Generate password if requested
      if (input.generatePassword || !finalPassword) {
        const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
        finalPassword = '';
        for (let i = 0; i < 12; i++) {
          finalPassword += charset.charAt(Math.floor(Math.random() * charset.length));
        }
      }

      // Hash the password
      const hashedPassword = await hashPassword(finalPassword);

      // Update user password
      await ctx.prisma.user.update({
        where: { id: input.userId },
        data: {
          password: hashedPassword,
        },
      });

      // Try to reset password in Authentik if user has authentikId
      if (user.authentikId) {
        try {
          await authentikService.resetUserPassword(user.authentikId, finalPassword);
        } catch (error) {
          console.error('Failed to reset password in Authentik:', error);
        }
      }

      // Send email if requested
      if (input.sendEmail && user.email && emailService.isConfigured()) {
        try {
          await emailService.sendPasswordResetEmail({
            to: user.email,
            subject: 'Your Password Has Been Reset',
            fullName: `${user.firstName} ${user.lastName}`.trim(),
            username: user.username || '',
            newPassword: finalPassword,
          });
        } catch (error) {
          console.error('Failed to send password reset email:', error);
        }
      }

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'password_reset',
          username: ctx.session.user.username || 'unknown',
          details: `Reset password for user: ${user.username}`,
        },
      });

      return {
        success: true,
        temporaryPassword: finalPassword,
        emailSent: input.sendEmail && user.email && emailService.isConfigured(),
      };
    }),

  // Send email to user
  sendEmail: moderatorProcedure
    .input(
      z.object({
        userId: z.number().optional(),
        userIds: z.array(z.number()).optional(),
        subject: z.string().min(1),
        message: z.string().min(1),
        useTemplate: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get users to send email to
      const userIds = input.userIds || (input.userId ? [input.userId] : []);
      
      if (userIds.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'At least one user must be specified',
        });
      }

      const users = await ctx.prisma.user.findMany({
        where: { id: { in: userIds } },
      });

      if (users.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No users found',
        });
      }

      if (!emailService.isConfigured()) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Email service is not configured',
        });
      }

      const successful = [];
      const failed = [];

      for (const user of users) {
        if (!user.email) {
          failed.push({ user: user.username, reason: 'No email address' });
          continue;
        }

        try {
          // Variable substitution
          const substitutedSubject = input.subject
            .replace(/\$Username/g, user.username || '')
            .replace(/\$DisplayName/g, `${user.firstName} ${user.lastName}`.trim())
            .replace(/\$FirstName/g, user.firstName || '')
            .replace(/\$LastName/g, user.lastName || '')
            .replace(/\$Email/g, user.email || '');

          const substitutedMessage = input.message
            .replace(/\$Username/g, user.username || '')
            .replace(/\$DisplayName/g, `${user.firstName} ${user.lastName}`.trim())
            .replace(/\$FirstName/g, user.firstName || '')
            .replace(/\$LastName/g, user.lastName || '')
            .replace(/\$Email/g, user.email || '');

          await emailService.sendAdminEmail(
            user.email,
            substitutedSubject,
            substitutedMessage,
            {
              username: user.username || undefined,
              firstName: user.firstName || undefined,
              lastName: user.lastName || undefined,
              email: user.email || undefined,
            },
            false
          );

          successful.push(user.username);
        } catch (error) {
          failed.push({ user: user.username, reason: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'email_sent',
          username: ctx.session.user.username || 'unknown',
          details: `Sent email to ${successful.length} users: ${successful.join(', ')}`,
        },
      });

      return {
        success: successful.length > 0,
        totalUsers: users.length,
        successfulEmails: successful.length,
        failedEmails: failed.length,
        successful,
        failed,
      };
    }),

  // Connect Matrix account
  connectMatrixAccount: moderatorProcedure
    .input(
      z.object({
        userId: z.number(),
        matrixUsername: z.string(),
        verifyConnection: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: input.userId },
      });

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        });
      }

      // Update user with Matrix connection
      const updatedUser = await ctx.prisma.user.update({
        where: { id: input.userId },
        data: {
          matrixUsername: input.matrixUsername,
        },
      });

      // Update in Authentik if user has authentikId
      if (user.authentikId) {
        try {
          // Since updateUser doesn't exist, we'll skip this for now
          // await authentikService.updateUser({
          //   userId: user.authentikId,
          //   attributes: {
          //     matrix_username: input.matrixUsername,
          //   },
          // });
        } catch (error) {
          console.error('Failed to update Matrix connection in Authentik:', error);
        }
      }

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'matrix_account_connected',
          username: ctx.session.user.username || 'unknown',
          details: `Connected Matrix account ${input.matrixUsername} to user: ${user.username}`,
        },
      });

      return {
        success: true,
        user: updatedUser,
      };
    }),

  // Update user details (enhanced version)
  updateUserDetails: moderatorProcedure
    .input(
      z.object({
        userId: z.number(),
        username: z.string().optional(),
        email: z.string().email().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        matrixUsername: z.string().optional(),
        signalIdentity: z.string().optional(),
        isActive: z.boolean().optional(),
        isAdmin: z.boolean().optional(),
        isModerator: z.boolean().optional(),
        attributes: z.record(z.string(), z.any()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userId, attributes, ...updateData } = input;

      // Check if user exists
      const existingUser = await ctx.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!existingUser) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found',
        });
      }

      // Update user in database
      const updatedUser = await ctx.prisma.user.update({
        where: { id: userId },
        data: {
          ...updateData,
          ...(attributes && { attributes }),
        },
      });

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'user_details_updated',
          username: ctx.session.user.username || 'unknown',
          details: `Updated details for user: ${existingUser.username}`,
        },
      });

      return {
        success: true,
        user: updatedUser,
      };
    }),

  // Bulk update users
  bulkUpdateUsers: adminProcedure
    .input(
      z.object({
        userIds: z.array(z.number()).min(1),
        action: z.enum(['activate', 'deactivate', 'delete', 'makeAdmin', 'removeAdmin', 'makeModerator', 'removeModerator']),
        updateData: z.object({
          isActive: z.boolean().optional(),
          isAdmin: z.boolean().optional(),
          isModerator: z.boolean().optional(),
        }).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { userIds, action, updateData } = input;

      // Get users to update
      const users = await ctx.prisma.user.findMany({
        where: { id: { in: userIds } },
      });

      if (users.length === 0) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No users found',
        });
      }

      let dataToUpdate = {};
      let actionDescription = '';

      switch (action) {
        case 'activate':
          dataToUpdate = { isActive: true };
          actionDescription = 'activated';
          break;
        case 'deactivate':
          dataToUpdate = { isActive: false };
          actionDescription = 'deactivated';
          break;
        case 'makeAdmin':
          dataToUpdate = { isAdmin: true };
          actionDescription = 'made admin';
          break;
        case 'removeAdmin':
          dataToUpdate = { isAdmin: false };
          actionDescription = 'removed admin';
          break;
        case 'makeModerator':
          dataToUpdate = { isModerator: true };
          actionDescription = 'made moderator';
          break;
        case 'removeModerator':
          dataToUpdate = { isModerator: false };
          actionDescription = 'removed moderator';
          break;
        case 'delete':
          // Handle delete separately
          break;
        default:
          dataToUpdate = updateData || {};
          actionDescription = 'updated';
      }

      const successful = [];
      const failed = [];

      if (action === 'delete') {
        // Handle bulk delete
        for (const user of users) {
          try {
            await ctx.prisma.user.delete({
              where: { id: user.id },
            });
            successful.push(user.username);
          } catch (error) {
            failed.push({ user: user.username, reason: error instanceof Error ? error.message : 'Unknown error' });
          }
        }
      } else {
        // Handle bulk update
        for (const user of users) {
          try {
            await ctx.prisma.user.update({
              where: { id: user.id },
              data: dataToUpdate,
            });

            successful.push(user.username);
          } catch (error) {
            failed.push({ user: user.username, reason: error instanceof Error ? error.message : 'Unknown error' });
          }
        }
      }

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'bulk_user_update',
          username: ctx.session.user.username || 'unknown',
          details: `Bulk ${actionDescription} ${successful.length} users: ${successful.join(', ')}`,
        },
      });

      return {
        success: successful.length > 0,
        totalUsers: users.length,
        successfulUpdates: successful.length,
        failedUpdates: failed.length,
        successful,
        failed,
        action: actionDescription,
      };
    }),
});

// Helper function for password hashing
async function hashPassword(password: string): Promise<string> {
  const bcrypt = await import('bcryptjs');
  return bcrypt.hash(password, 12);
} 