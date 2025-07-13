import { z } from 'zod';
import { createTRPCRouter, publicProcedure, protectedProcedure, moderatorProcedure, adminProcedure } from '../trpc';
import { authentikService } from '@/lib/authentik';
import { emailService } from '@/lib/email';
import { matrixService } from '@/lib/matrix';
import { discourseService } from '@/lib/discourse';
import { logCommunityEvent, getCategoryForEventType } from '@/lib/community-timeline';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { TRPCError } from '@trpc/server';

export const userRouter = createTRPCRouter({
  // Get paginated list of users from Authentik SSO
  getUsers: moderatorProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(25),
        search: z.string().optional(),
        isActive: z.boolean().optional(),
        source: z.enum(['authentik', 'local', 'both']).default('local'),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, limit, search, isActive, source } = input;

      if (source === 'authentik' || source === 'both') {
        // Fetch users from Authentik SSO
        try {
          const authentikResult = await authentikService.listUsers(search, page, limit);
          
          // Get local user data for additional info (notes, etc.)
          const localUsers = await ctx.prisma.user.findMany({
            where: {
              authentikId: { in: authentikResult.users.map(u => u.pk) },
            },
            include: {
              groups: {
                include: {
                  group: true,
                },
              },
              notes: true,
            },
          });

          // Create a map of authentik users to local users
          const localUserMap = new Map(localUsers.map(u => [u.authentikId, u]));

          // Transform Authentik users to match our UI format
          const transformedUsers = authentikResult.users
            .filter(user => {
              // Apply active filter if specified
              if (isActive !== undefined && user.is_active !== isActive) {
                return false;
              }
              return true;
            })
            .map(user => {
              const localUser = localUserMap.get(user.pk);
              const [firstName, ...lastNameParts] = user.name?.split(' ') || [];
              
              return {
                id: parseInt(user.pk),
                username: user.username,
                email: user.email,
                firstName: firstName || '',
                lastName: lastNameParts.join(' ') || '',
                isActive: user.is_active,
                isAdmin: user.groups.includes('admin'),
                isModerator: user.groups.includes('moderator'),
                dateJoined: localUser?.dateJoined || new Date(),
                lastLogin: user.last_login ? new Date(user.last_login) : null,
                authentikId: user.pk,
                groups: localUser?.groups || [],
                notes: localUser?.notes || [],
                attributes: user.attributes || {},
              };
            });

          return {
            users: transformedUsers,
            total: authentikResult.total,
            page: authentikResult.page,
            limit: authentikResult.pageSize,
            totalPages: Math.ceil(authentikResult.total / authentikResult.pageSize),
            source: 'authentik' as const,
          };
        } catch (error) {
          console.error('Error fetching users from Authentik:', error);
          
          // Fall back to local database if Authentik fails
          if (source === 'authentik') {
            console.log('Falling back to local database users');
          }
        }
      }

      // Fetch from local database (fallback or when source is 'local' or 'both')
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
        source: 'local' as const,
      };
    }),

  // Sync users from Authentik to local database
  syncUsers: adminProcedure
    .input(
      z.object({
        forceSync: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        console.log('Starting user sync from Authentik...');
        
        // Fetch all users from Authentik
        const authentikUsers = await authentikService.listAllUsers();
        
        if (authentikUsers.length === 0) {
          throw new Error('No users found in Authentik or service not configured');
        }

        let created = 0;
        let updated = 0;
        let errors = 0;

        // Process each user
        for (const authentikUser of authentikUsers) {
          try {
            const [firstName, ...lastNameParts] = authentikUser.name?.split(' ') || [];
            
            // Check if user exists locally
            const existingUser = await ctx.prisma.user.findUnique({
              where: { authentikId: authentikUser.pk },
            });

            const userData = {
              username: authentikUser.username,
              email: authentikUser.email,
              firstName: firstName || '',
              lastName: lastNameParts.join(' ') || '',
              isActive: authentikUser.is_active,
              isAdmin: authentikUser.groups.includes('admin'),
              isModerator: authentikUser.groups.includes('moderator'),
              lastLogin: authentikUser.last_login ? new Date(authentikUser.last_login) : null,
              attributes: authentikUser.attributes || {},
            };

            if (existingUser) {
              // Update existing user
              await ctx.prisma.user.update({
                where: { authentikId: authentikUser.pk },
                data: userData,
              });
              updated++;
            } else {
              // Create new user
              await ctx.prisma.user.create({
                data: {
                  ...userData,
                  authentikId: authentikUser.pk,
                },
              });
              created++;
            }
          } catch (error) {
            console.error(`Error syncing user ${authentikUser.username}:`, error);
            errors++;
          }
        }

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'user_sync',
            username: ctx.session.user.username || 'unknown',
            details: `Synced ${authentikUsers.length} users from Authentik: ${created} created, ${updated} updated, ${errors} errors`,
          },
        });

        console.log(`User sync completed: ${created} created, ${updated} updated, ${errors} errors`);

        return {
          success: true,
          total: authentikUsers.length,
          created,
          updated,
          errors,
        };
      } catch (error) {
        console.error('Error syncing users from Authentik:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to sync users: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // Get sync status (compare local vs Authentik user counts)
  getSyncStatus: moderatorProcedure.query(async ({ ctx }) => {
    try {
      const localCount = await ctx.prisma.user.count();
      
      let authentikCount = 0;
      let authentikConfigured = authentikService.isConfigured();
      let authentikError = null;
      
      if (authentikConfigured) {
        try {
          const authentikResult = await authentikService.listUsers(undefined, 1, 1);
          authentikCount = authentikResult.total;
        } catch (error) {
          console.error('Error getting Authentik user count:', error);
          authentikError = error instanceof Error ? error.message : 'Unknown error';
          authentikConfigured = false; // Treat as not configured if we can't connect
        }
      }

      return {
        localCount,
        authentikCount,
        inSync: localCount === authentikCount,
        authentikConfigured,
        error: authentikError,
      };
    } catch (error) {
      console.error('Error getting sync status:', error);
      
      // Try to at least get local count
      let localCount = 0;
      try {
        localCount = await ctx.prisma.user.count();
      } catch (dbError) {
        console.error('Error getting local user count:', dbError);
      }
      
      return {
        localCount,
        authentikCount: 0,
        inSync: false,
        authentikConfigured: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
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

      // Log community timeline event
      await logCommunityEvent({
        eventType: 'user_created',
        username: ctx.session.user.username || 'unknown',
        details: `Created user: ${user.username}`,
        category: getCategoryForEventType('user_created'),
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

  // Get user profile for dashboard
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.prisma.user.findUnique({
      where: { id: parseInt(ctx.session.user.id) },
      select: {
        id: true,
        username: true,
        email: true,
        firstName: true,
        lastName: true,
        matrixUsername: true,
        attributes: true,
      },
    });

    return user;
  }),

  // Change password
  changePassword: protectedProcedure
    .input(
      z.object({
        newPassword: z.string().min(8, 'Password must be at least 8 characters'),
        confirmPassword: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.newPassword !== input.confirmPassword) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Passwords do not match',
        });
      }

      try {
        // Note: Password update via Authentik API would require additional implementation
        // For now, we'll just log the request and inform user to use SSO password reset
        
        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'password_change_requested',
            username: ctx.session.user.username || 'unknown',
            details: 'User requested password change from dashboard - redirect to SSO',
          },
        });

        // Return instruction to use SSO password reset
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Please use the SSO password reset feature at https://sso.irregularchat.com to change your password',
        });
      } catch (error) {
        console.error('Error with password change request:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to process password change request',
        });
      }
    }),

  // Request phone verification (simplified version)
  requestPhoneVerification: protectedProcedure
    .input(
      z.object({
        phoneNumber: z.string().min(1, 'Phone number is required'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Generate verification hash
        const verificationHash = Math.random().toString(36).substring(2, 15) + 
                                Math.random().toString(36).substring(2, 15);

        // Store verification hash in database with expiration
        const expirationTime = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        await ctx.prisma.user.update({
          where: { id: parseInt(ctx.session.user.id) },
          data: {
            attributes: {
              ...((ctx.session.user as any).attributes || {}),
              pendingPhoneVerification: {
                phoneNumber: input.phoneNumber,
                hash: verificationHash,
                expiresAt: expirationTime.toISOString(),
              },
            },
          },
        });

        // Send verification hash via Matrix
        if (matrixService.isConfigured()) {
          const matrixUserId = `@${ctx.session.user.username}:${process.env.MATRIX_DOMAIN || 'matrix.org'}`;
          
          const verificationMessage = `🔐 Phone Verification Code\n\nYou requested to update your phone number to: ${input.phoneNumber}\n\nVerification Hash: ${verificationHash}\n\nCopy this hash and paste it into the dashboard to complete verification.\n\nThis code expires in 15 minutes.`;
          
          await matrixService.sendDirectMessage(matrixUserId, verificationMessage);
        }

        return { success: true };
      } catch (error) {
        console.error('Error requesting phone verification:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to send verification code',
        });
      }
    }),

  // Verify phone number (simplified version)
  verifyPhone: protectedProcedure
    .input(
      z.object({
        phoneNumber: z.string(),
        verificationHash: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const user = await ctx.prisma.user.findUnique({
          where: { id: parseInt(ctx.session.user.id) },
        });

        if (!user) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'User not found',
          });
        }

        const pendingVerification = (user.attributes as any)?.pendingPhoneVerification;
        
        if (!pendingVerification) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'No pending phone verification found',
          });
        }

        // Check if verification hash matches and hasn't expired
        if (pendingVerification.hash !== input.verificationHash) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Invalid verification code',
          });
        }

        if (new Date(pendingVerification.expiresAt) < new Date()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Verification code has expired',
          });
        }

        if (pendingVerification.phoneNumber !== input.phoneNumber) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Phone number mismatch',
          });
        }

        // Update attributes to store phone and clear pending verification
        const updatedAttributes = { ...(user.attributes as any) };
        updatedAttributes.phone = input.phoneNumber;
        delete updatedAttributes.pendingPhoneVerification;

        await ctx.prisma.user.update({
          where: { id: parseInt(ctx.session.user.id) },
          data: {
            attributes: updatedAttributes,
          },
        });

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'phone_updated',
            username: ctx.session.user.username || 'unknown',
            details: `Phone number updated to ${input.phoneNumber}`,
          },
        });

        return { success: true };
      } catch (error) {
        console.error('Error verifying phone:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to verify phone number',
        });
      }
    }),

  // Update email (simplified version)
  updateEmail: protectedProcedure
    .input(
      z.object({
        email: z.string().email('Invalid email address'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Update email in database
        await ctx.prisma.user.update({
          where: { id: parseInt(ctx.session.user.id) },
          data: { email: input.email },
        });

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'email_updated',
            username: ctx.session.user.username || 'unknown',
            details: `Email updated to ${input.email}`,
          },
        });

        return { success: true };
      } catch (error) {
        console.error('Error updating email:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to update email',
        });
      }
    }),

  // Send message to admin
  sendAdminMessage: protectedProcedure
    .input(
      z.object({
        message: z.string().min(1, 'Message cannot be empty'),
        subject: z.string().default('User Dashboard Message'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Send email to admin using email service
        if (emailService.isConfigured()) {
          const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_FROM_EMAIL;
          if (adminEmail) {
            const emailContent = `User: ${ctx.session.user.username} (${ctx.session.user.email})\n\nMessage:\n${input.message}`;
            
            await emailService.sendEmail(
              adminEmail,
              `${input.subject} - from ${ctx.session.user.username}`,
              emailContent.replace(/\n/g, '<br>')
            );
          }
        }

        // Also send via Matrix if configured
        if (matrixService.isConfigured()) {
          const adminMatrixRoom = process.env.MATRIX_ADMIN_ROOM_ID;
          if (adminMatrixRoom) {
            const matrixMessage = `📨 **Message from User Dashboard**\n\n**User:** ${ctx.session.user.username} (${ctx.session.user.email})\n**Subject:** ${input.subject}\n\n**Message:**\n${input.message}`;
            
            await matrixService.sendRoomMessage(adminMatrixRoom, matrixMessage);
          }
        }

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'user_message_to_admin',
            username: ctx.session.user.username || 'unknown',
            details: `User sent message: ${input.subject}`,
          },
        });

        return { success: true };
      } catch (error) {
        console.error('Error sending admin message:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to send message to admin',
        });
      }
    }),

  // Create user invitation (for normal users)
  createUserInvitation: protectedProcedure
    .input(
      z.object({
        inviteeEmail: z.string().email('Valid email is required'),
        inviteeName: z.string().min(1, 'Name is required'),
        message: z.string().optional(),
        expiryDays: z.number().min(1).max(30).default(7),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Check if user has phone number (required for Signal integration)
        const inviter = await ctx.prisma.user.findUnique({
          where: { id: parseInt(ctx.session.user.id) },
          select: { 
            attributes: true,
            username: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        });

        if (!inviter) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Inviter user not found',
          });
        }

        // Check if phone number is set (stored in attributes)
        const phoneNumber = inviter.attributes && typeof inviter.attributes === 'object' 
          ? (inviter.attributes as any).phoneNumber || (inviter.attributes as any).phone_number
          : null;

        if (!phoneNumber) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'You must have a phone number on file to invite users. Please update your phone number in Account settings first.',
          });
        }

        // Check if email is already invited or exists as user
        const existingInvitation = await ctx.prisma.userInvitation.findFirst({
          where: {
            inviteeEmail: input.inviteeEmail,
            status: 'pending',
          },
        });

        if (existingInvitation) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This email already has a pending invitation',
          });
        }

        // Check if user already exists in Authentik
        const existingUsers = await authentikService.searchUsers(input.inviteeEmail);
        if (existingUsers.length > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A user with this email already exists',
          });
        }

        // Calculate expiry date
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + input.expiryDays);

        // Generate invite token
        const inviteToken = crypto.randomBytes(32).toString('hex');

        // Create invitation record
        const invitation = await ctx.prisma.userInvitation.create({
          data: {
            inviterUserId: parseInt(ctx.session.user.id),
            inviteeEmail: input.inviteeEmail,
            inviteeName: input.inviteeName,
            message: input.message,
            inviteToken,
            expiresAt: expiryDate,
          },
        });

        // Create Authentik invite
        const authentikInvite = await authentikService.createInvite({
          label: `Invitation for ${input.inviteeName}`,
          expires: expiryDate,
          email: input.inviteeEmail,
          name: input.inviteeName,
          createdBy: inviter.username || 'unknown',
        });

        if (authentikInvite.success && authentikInvite.invite_link) {
          // Update invitation with Authentik invite token
          await ctx.prisma.userInvitation.update({
            where: { id: invitation.id },
            data: { inviteToken: authentikInvite.invite_id || inviteToken },
          });

          // Send invitation email
          if (emailService.isConfigured()) {
            const inviterName = `${inviter.firstName || ''} ${inviter.lastName || ''}`.trim() || inviter.username;
            
            const inviteMessage = input.message 
              ? `\n\nPersonal message from ${inviterName}:\n"${input.message}"`
              : '';

            const emailContent = `Hi ${input.inviteeName},

${inviterName} has invited you to join the IrregularChat community!

You can accept this invitation by clicking the link below:
${authentikInvite.invite_link}

This invitation expires on ${expiryDate.toLocaleDateString()}.${inviteMessage}

Welcome to the community!

Best regards,
The IrregularChat Team`;

            try {
              await emailService.sendEmail(
                input.inviteeEmail,
                `You've been invited to join IrregularChat by ${inviterName}`,
                emailContent.replace(/\n/g, '<br>')
              );
            } catch (emailError) {
              console.error('Error sending invitation email:', emailError);
              // Don't fail the invitation if email sending fails
            }
          }

          // Send Signal notification to inviter (via Matrix bot)
          if (matrixService.isConfigured()) {
            try {
              const matrixUserId = `@${inviter.username}:${process.env.MATRIX_DOMAIN || 'matrix.org'}`;
              const signalMessage = `✅ Invitation sent successfully!

You invited: ${input.inviteeName} (${input.inviteeEmail})
Expires: ${expiryDate.toLocaleDateString()}

The invitation email has been sent. You'll be notified when they accept the invitation.`;

              await matrixService.sendDirectMessage(matrixUserId, signalMessage);
            } catch (matrixError) {
              console.error('Error sending Signal notification:', matrixError);
            }
          }
        }

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'user_invitation_created',
            username: inviter.username || 'unknown',
            details: `Created invitation for ${input.inviteeName} (${input.inviteeEmail})`,
          },
        });

        // Log community timeline event
        await logCommunityEvent({
          eventType: 'user_invitation_created',
          username: inviter.username || 'unknown',
          details: `Invited ${input.inviteeName} (${input.inviteeEmail}) to join the community`,
          category: getCategoryForEventType('user_invitation_created'),
        });

        return {
          success: true,
          invitation,
          inviteLink: authentikInvite.invite_link,
          expiresAt: expiryDate,
        };
      } catch (error) {
        console.error('Error creating user invitation:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create invitation',
        });
      }
    }),

  // Get user's sent invitations
  getMyInvitations: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(10),
        status: z.enum(['pending', 'accepted', 'expired', 'cancelled']).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, limit, status } = input;
      const skip = (page - 1) * limit;

      const where = {
        inviterUserId: parseInt(ctx.session.user.id),
        ...(status && { status }),
      };

      const [invitations, total] = await Promise.all([
        ctx.prisma.userInvitation.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            inviter: {
              select: {
                username: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
        ctx.prisma.userInvitation.count({ where }),
      ]);

      return {
        invitations,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }),

  // Get invitation timeline (for admins/moderators)
  getInvitationTimeline: moderatorProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        inviterUserId: z.number().optional(),
        status: z.enum(['pending', 'accepted', 'expired', 'cancelled']).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, limit, inviterUserId, status } = input;
      const skip = (page - 1) * limit;

      const where = {
        ...(inviterUserId && { inviterUserId }),
        ...(status && { status }),
      };

      const [invitations, total] = await Promise.all([
        ctx.prisma.userInvitation.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            inviter: {
              select: {
                username: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        }),
        ctx.prisma.userInvitation.count({ where }),
      ]);

      return {
        invitations,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }),

  // Cancel invitation
  cancelInvitation: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const invitation = await ctx.prisma.userInvitation.findUnique({
        where: { id: input.id },
        include: { inviter: true },
      });

      if (!invitation) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invitation not found',
        });
      }

      // Check if user can cancel this invitation
      if (invitation.inviterUserId !== parseInt(ctx.session.user.id) && !ctx.session.user.isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only cancel your own invitations',
        });
      }

      if (invitation.status !== 'pending') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot cancel an invitation that is not pending',
        });
      }

      await ctx.prisma.userInvitation.update({
        where: { id: input.id },
        data: { status: 'cancelled' },
      });

      return { success: true };
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

        // Log community timeline event
        await logCommunityEvent({
          eventType: 'password_reset',
          username: ctx.session.user.username || 'unknown',
          details: `Reset password for user: ${user.username}`,
          category: getCategoryForEventType('password_reset'),
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