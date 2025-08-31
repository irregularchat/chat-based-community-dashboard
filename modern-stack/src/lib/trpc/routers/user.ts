import { z } from 'zod';
import { createTRPCRouter, protectedProcedure, moderatorProcedure, adminProcedure } from '../trpc';
import { authentikService } from '@/lib/authentik';
import { emailService } from '@/lib/email';
import { discourseService } from '@/lib/discourse';
import { logCommunityEvent, getCategoryForEventType } from '@/lib/community-timeline';
import { normalizePhoneNumber, formatPhoneForDisplay } from '@/lib/phone-utils';
import { parseAdvancedSearch } from '@/lib/advanced-search';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { TRPCError } from '@trpc/server';

export const userRouter = createTRPCRouter({
  // Get paginated list of users from Authentik SSO and/or local database
  getUsers: moderatorProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(25),
        search: z.string().optional(),
        isActive: z.boolean().optional(),
        source: z.enum(['authentik', 'local', 'both']).default('both'),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, limit, search, isActive, source } = input;

      // Helper function to transform Authentik users to our UI format
      const transformAuthentikUser = (user: { pk: number; name?: string; email: string; is_active: boolean; }, localUser?: { firstName?: string; lastName?: string; phoneNumber?: string; } | null) => {
        const authentikIdString = String(user.pk);
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
          authentikId: authentikIdString,
          groups: localUser?.groups || [],
          notes: localUser?.notes || [],
          attributes: user.attributes || {},
        };
      };

      if (source === 'authentik') {
        // Fetch only from Authentik SSO
        try {
          const authentikResult = await authentikService.listUsers(search, page, limit);
          
          // Get local user data for additional info (notes, etc.)
          const localUsers = await ctx.prisma.user.findMany({
            where: {
              authentikId: { in: authentikResult.users.map(u => String(u.pk)) },
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
            .map(user => transformAuthentikUser(user, localUserMap.get(String(user.pk))));

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
          throw new Error('Failed to fetch users from Authentik SSO');
        }
      }

      if (source === 'local') {
        // Fetch only from local database
        const skip = (page - 1) * limit;
        
        // Parse advanced search query
        const { where: searchWhere } = parseAdvancedSearch(search || '');
        
        const where = {
          ...searchWhere,
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
      }

      if (source === 'both') {
        // Resilient approach: Start with Matrix users and merge Authentik if available
        const startTime = Date.now();
        
        // First, get Matrix users immediately (fast fallback)
        let matrixUsers: any[] = [];
        let authentikUsers: { pk: number; name?: string; email: string; is_active: boolean; username?: string; groups?: string[]; attributes?: any; last_login?: string; }[] = [];
        let authentikError: string | null = null;
        
        try {
          const { matrixService } = await import('@/lib/matrix');
          const { matrixSyncService } = await import('@/lib/matrix-sync');
          if (matrixService.isConfigured()) {
            const cachedUsers = await matrixSyncService.getUsersFromPriorityRooms();
            matrixUsers = cachedUsers
              .filter(user => {
                // Only include users with valid userId
                if (!user.userId) return false;
                
                if (search) {
                  const searchLower = search.toLowerCase();
                  return user.displayName?.toLowerCase().includes(searchLower) ||
                         user.userId?.toLowerCase().includes(searchLower);
                }
                return true;
              })
              .map(user => ({
                id: parseInt(user.userId.replace(/[@:]/g, '').slice(0, 8), 36), // Generate numeric ID
                username: user.userId.split(':')[0].substring(1),
                email: `${user.userId.split(':')[0].substring(1)}@${user.userId.split(':')[1]}`,
                firstName: user.displayName?.split(' ')[0] || '',
                lastName: user.displayName?.split(' ').slice(1).join(' ') || '',
                isActive: true,
                isAdmin: false,
                isModerator: false,
                dateJoined: new Date(),
                lastLogin: null,
                authentikId: null,
                groups: [],
                notes: [],
                attributes: { source: 'matrix', matrixUserId: user.userId },
              }));
          }
        } catch (matrixError) {
          console.warn('Matrix users not available:', matrixError);
        }

        // Try to fetch Authentik users with timeout (non-blocking)
        try {
          const authentikResult = await authentikService.listUsers(search, page, limit);
          authentikUsers = authentikResult.users.filter(user => {
            if (isActive !== undefined && user.is_active !== isActive) {
              return false;
            }
            return true;
          });
          console.log(`✅ Authentik users fetched in ${Date.now() - startTime}ms`);
        } catch (error) {
          authentikError = error instanceof Error ? error.message : 'Unknown error';
          console.warn(`⚠️ Authentik unavailable after ${Date.now() - startTime}ms:`, authentikError);
        }

        // Get local user data for additional info
        const { where: searchWhere } = parseAdvancedSearch(search || '');
        const localWhere = {
          ...searchWhere,
          ...(isActive !== undefined && { isActive }),
        };

        const localUsers = await ctx.prisma.user.findMany({
          where: localWhere,
          orderBy: { dateJoined: 'desc' },
          include: {
            groups: {
              include: {
                group: true,
              },
            },
            notes: true,
          },
        });

        // Create a map of local users by authentikId for merging
        const localUserMap = new Map(localUsers.map(u => [u.authentikId, u]));

        // Transform Authentik users and merge with local data
        const transformedAuthentikUsers = authentikUsers.map(user => 
          transformAuthentikUser(user, localUserMap.get(String(user.pk)))
        );

        // Get local-only users (those without authentikId or Matrix mapping)
        const localOnlyUsers = localUsers.filter(user => !user.authentikId);

        // Combine all users, prioritizing Authentik users if available
        const allUsers = [
          ...transformedAuthentikUsers,
          ...localOnlyUsers,
          // Only include Matrix users if we don't have many Authentik users
          ...(authentikUsers.length < 10 ? matrixUsers : [])
        ];

        // Calculate pagination
        const totalUsers = allUsers.length;
        const totalPages = Math.ceil(totalUsers / limit);
        const skip = (page - 1) * limit;
        const paginatedUsers = allUsers.slice(skip, skip + limit);

        return {
          users: paginatedUsers,
          total: totalUsers,
          page,
          limit,
          totalPages,
          source: 'both' as const,
          loadTime: Date.now() - startTime,
          authentikAvailable: !authentikError,
          authentikError,
          fallbackToMatrix: !!authentikError && matrixUsers.length > 0,
        };
      }

      // This should never be reached, but just in case
      throw new Error('Invalid source specified');
    }),

  // Sync users from Authentik to local database
  syncUsers: adminProcedure
    .input(
      z.object({
        forceSync: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input: _input }) => {
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
            
            // Check if user exists locally (convert pk to string)
            const authentikIdString = String(authentikUser.pk);
            const existingUser = await ctx.prisma.user.findUnique({
              where: { authentikId: authentikIdString },
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

            // Use upsert to handle both create and update cases, handling duplicate usernames
            await ctx.prisma.user.upsert({
              where: { authentikId: authentikIdString },
              update: userData,
              create: {
                ...userData,
                authentikId: authentikIdString,
              },
            });
            
            if (existingUser) {
              updated++;
            } else {
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
      let newUsersCount = 0;
      let pendingUpdatesCount = 0;
      
      if (authentikConfigured) {
        try {
          const authentikResult = await authentikService.listUsers(undefined, 1, 1);
          authentikCount = authentikResult.total;
          
          // Check for new users in Authentik not in local database
          const authentikUsers = await authentikService.listUsers(undefined, 1, 100);
          const authentikIds = authentikUsers.users.map(u => String(u.pk));
          
          const localUsers = await ctx.prisma.user.findMany({
            where: {
              authentikId: { in: authentikIds },
            },
            select: {
              authentikId: true,
              lastLogin: true,
              isActive: true,
              isAdmin: true,
              isModerator: true,
            },
          });
          
          const localAuthentikIds = new Set(localUsers.map(u => u.authentikId));
          newUsersCount = authentikIds.filter(id => !localAuthentikIds.has(id)).length;
          
          // Check for users that might need updates
          pendingUpdatesCount = authentikUsers.users.filter(authentikUser => {
            const localUser = localUsers.find(u => u.authentikId === String(authentikUser.pk));
            if (!localUser) return false;
            
            // Check if there are differences that need syncing
            const hasGroupChanges = 
              (authentikUser.groups?.includes('admin') || false) !== localUser.isAdmin ||
              (authentikUser.groups?.includes('moderator') || false) !== localUser.isModerator;
            
            const hasStatusChange = authentikUser.is_active !== localUser.isActive;
            
            return hasGroupChanges || hasStatusChange;
          }).length;
          
        } catch (error) {
          console.error('Error getting Authentik user count:', error);
          authentikError = error instanceof Error ? error.message : 'Unknown error';
          authentikConfigured = false; // Treat as not configured if we can't connect
        }
      }

      return {
        localCount,
        authentikCount,
        inSync: localCount === authentikCount && newUsersCount === 0 && pendingUpdatesCount === 0,
        authentikConfigured,
        error: authentikError,
        newUsersCount,
        pendingUpdatesCount,
        lastSyncTime: await ctx.prisma.adminEvent.findFirst({
          where: {
            eventType: { in: ['user_sync', 'user_auto_synced'] },
          },
          orderBy: { timestamp: 'desc' },
          select: { timestamp: true },
        }),
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
        newUsersCount: 0,
        pendingUpdatesCount: 0,
        lastSyncTime: null,
      };
    }
  }),

  // Sync specific user from Authentik
  syncUser: moderatorProcedure
    .input(z.object({ authentikId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const authentikUser = await authentikService.getUser(input.authentikId);
        
        if (!authentikUser) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'User not found in Authentik',
          });
        }

        const [firstName, ...lastNameParts] = authentikUser.name?.split(' ') || [];
        const authentikIdString = String(authentikUser.pk);
        
        // Check if user already exists locally
        const existingUser = await ctx.prisma.user.findUnique({
          where: { authentikId: authentikIdString },
        });

        const userData = {
          username: authentikUser.username,
          email: authentikUser.email,
          firstName: firstName || '',
          lastName: lastNameParts.join(' ') || '',
          isActive: authentikUser.is_active,
          isAdmin: authentikUser.groups?.includes('admin') || false,
          isModerator: authentikUser.groups?.includes('moderator') || false,
          lastLogin: authentikUser.last_login ? new Date(authentikUser.last_login) : null,
          attributes: authentikUser.attributes || {},
        };

        // Use upsert to handle both create and update cases
        const syncedUser = await ctx.prisma.user.upsert({
          where: { authentikId: authentikIdString },
          update: userData,
          create: {
            ...userData,
            authentikId: authentikIdString,
          },
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

        // Log the sync event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: existingUser ? 'user_updated' : 'user_synced',
            username: ctx.session.user.username || 'unknown',
            details: `${existingUser ? 'Updated' : 'Synced'} user ${authentikUser.username} from Authentik`,
          },
        });

        return {
          success: true,
          user: syncedUser,
          action: existingUser ? 'updated' : 'created',
        };
      } catch (error) {
        console.error('Error syncing user from Authentik:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to sync user: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }),

  // Check for new users and changes from Authentik
  checkForUpdates: moderatorProcedure.query(async ({ ctx }) => {
    try {
      if (!authentikService.isConfigured()) {
        return {
          newUsers: [],
          updatedUsers: [],
          authentikConfigured: false,
        };
      }

      // Get recent Authentik users (last 100 for efficiency)
      const authentikResult = await authentikService.listUsers(undefined, 1, 100);
      const authentikUsers = authentikResult.users;

      // Get corresponding local users
      const authentikIds = authentikUsers.map(u => String(u.pk));
      const localUsers = await ctx.prisma.user.findMany({
        where: {
          authentikId: { in: authentikIds },
        },
        select: {
          id: true,
          username: true,
          authentikId: true,
          lastLogin: true,
          isActive: true,
          isAdmin: true,
          isModerator: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      });

      const localUserMap = new Map(localUsers.map(u => [u.authentikId, u]));

      // Find new users (in Authentik but not in local database)
      const newUsers = authentikUsers
        .filter(authentikUser => !localUserMap.has(String(authentikUser.pk)))
        .map(authentikUser => {
          const [firstName, ...lastNameParts] = authentikUser.name?.split(' ') || [];
          return {
            authentikId: String(authentikUser.pk),
            username: authentikUser.username,
            email: authentikUser.email,
            firstName: firstName || '',
            lastName: lastNameParts.join(' ') || '',
            isActive: authentikUser.is_active,
            isAdmin: authentikUser.groups?.includes('admin') || false,
            isModerator: authentikUser.groups?.includes('moderator') || false,
            lastLogin: authentikUser.last_login ? new Date(authentikUser.last_login) : null,
          };
        });

      // Find users that need updates
      const updatedUsers = authentikUsers
        .filter(authentikUser => {
          const localUser = localUserMap.get(String(authentikUser.pk));
          if (!localUser) return false;

          // Check for differences
          const hasGroupChanges = 
            (authentikUser.groups?.includes('admin') || false) !== localUser.isAdmin ||
            (authentikUser.groups?.includes('moderator') || false) !== localUser.isModerator;
          
          const hasStatusChange = authentikUser.is_active !== localUser.isActive;
          
          const [firstName, ...lastNameParts] = authentikUser.name?.split(' ') || [];
          const hasNameChange = 
            (firstName || '') !== localUser.firstName ||
            (lastNameParts.join(' ') || '') !== localUser.lastName;
          
          const hasEmailChange = authentikUser.email !== localUser.email;

          return hasGroupChanges || hasStatusChange || hasNameChange || hasEmailChange;
        })
        .map(authentikUser => {
          const localUser = localUserMap.get(String(authentikUser.pk))!;
          const [firstName, ...lastNameParts] = authentikUser.name?.split(' ') || [];
          
          return {
            authentikId: String(authentikUser.pk),
            localId: localUser.id,
            username: authentikUser.username,
            changes: {
              isAdmin: {
                old: localUser.isAdmin,
                new: authentikUser.groups?.includes('admin') || false,
              },
              isModerator: {
                old: localUser.isModerator,
                new: authentikUser.groups?.includes('moderator') || false,
              },
              isActive: {
                old: localUser.isActive,
                new: authentikUser.is_active,
              },
              firstName: {
                old: localUser.firstName,
                new: firstName || '',
              },
              lastName: {
                old: localUser.lastName,
                new: lastNameParts.join(' ') || '',
              },
              email: {
                old: localUser.email,
                new: authentikUser.email,
              },
            },
          };
        });

      return {
        newUsers,
        updatedUsers,
        authentikConfigured: true,
        lastChecked: new Date(),
      };
    } catch (error) {
      console.error('Error checking for updates:', error);
      return {
        newUsers: [],
        updatedUsers: [],
        authentikConfigured: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }),

  // Get single user by ID (with Authentik fallback and auto-sync)
  getUser: moderatorProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      // First, try to find user in local database
      const localUser = await ctx.prisma.user.findUnique({
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

      if (localUser) {
        return localUser;
      }

      // If not found locally, try to find and sync from Authentik
      try {
        // Check if this is an Authentik user ID
        const authentikUser = await authentikService.getUser(String(input.id));
        
        if (authentikUser) {
          // Found in Authentik, sync to local database
          const [firstName, ...lastNameParts] = authentikUser.name?.split(' ') || [];
          const authentikIdString = String(authentikUser.pk);
          
          // Check if user already exists with different ID (by authentikId)
          const existingUser = await ctx.prisma.user.findUnique({
            where: { authentikId: authentikIdString },
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

          if (existingUser) {
            return existingUser;
          }

          // Create new local user record for this Authentik user
          const newUser = await ctx.prisma.user.create({
            data: {
              username: authentikUser.username,
              email: authentikUser.email,
              firstName: firstName || '',
              lastName: lastNameParts.join(' ') || '',
              authentikId: authentikIdString,
              isActive: authentikUser.is_active,
              isAdmin: authentikUser.groups?.includes('admin') || false,
              isModerator: authentikUser.groups?.includes('moderator') || false,
              lastLogin: authentikUser.last_login ? new Date(authentikUser.last_login) : null,
              attributes: authentikUser.attributes || {},
            },
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

          // Log the auto-sync event
          await ctx.prisma.adminEvent.create({
            data: {
              eventType: 'user_auto_synced',
              username: ctx.session.user.username || 'unknown',
              details: `Auto-synced user ${authentikUser.username} from Authentik on access`,
            },
          });

          return newUser;
        }
      } catch (error) {
        console.error('Error fetching user from Authentik:', error);
        // Continue to check Matrix users if Authentik fetch fails
      }

      // Finally, check if this might be a Matrix user
      try {
        const { matrixService } = await import('@/lib/matrix');
        const { matrixSyncService } = await import('@/lib/matrix-sync');
        if (matrixService.isConfigured()) {
          const cachedUsers = await matrixSyncService.getUsersFromPriorityRooms();
          const matrixUser = cachedUsers.find(user => {
            if (!user.userId) return false;
            const generatedId = parseInt(user.userId.replace(/[@:]/g, '').slice(0, 8), 36);
            return generatedId === input.id;
          });

          if (matrixUser) {
            // Return Matrix user in the expected format
            return {
              id: input.id,
              username: matrixUser.userId.split(':')[0].substring(1),
              email: `${matrixUser.userId.split(':')[0].substring(1)}@${matrixUser.userId.split(':')[1]}`,
              firstName: matrixUser.displayName?.split(' ')[0] || '',
              lastName: matrixUser.displayName?.split(' ').slice(1).join(' ') || '',
              isActive: true,
              isAdmin: false,
              isModerator: false,
              dateJoined: new Date(),
              lastLogin: null,
              authentikId: null,
              groups: [],
              notes: [],
              attributes: { source: 'matrix', matrixUserId: matrixUser.userId },
              moderatorPermissions: null,
            };
          }
        }
      } catch (matrixError) {
        console.warn('Matrix users not available:', matrixError);
      }

      // User not found in any source
      return null;
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

        // Use temporary password for immediate return
        let finalPassword = authentikResult.temp_password || '';
        
        // Start password reset in background (non-blocking for faster response)
        if (authentikResult.user_id) {
          const passwordResetOperation = (async () => {
            try {
              const newPassword = await authentikService.generateSecurePassphrase();
              const resetResult = await authentikService.resetUserPassword(String(authentikResult.user_id), newPassword);
              
              if (resetResult.success) {
                console.log(`Password reset successful for user ${username} - new password: ${newPassword}`);
                
                // Update local user record with new password in background
                try {
                  await ctx.prisma.user.update({
                    where: { authentikId: String(authentikResult.user_id) },
                    data: { 
                      attributes: {
                        ...attributes,
                        actualPassword: newPassword
                      }
                    }
                  });
                } catch (updateError) {
                  console.error('Error updating user with new password:', updateError);
                }
              } else {
                console.warn(`Password reset failed for user ${username}: ${resetResult.error}`);
              }
            } catch (passwordResetError) {
              console.error('Error during password reset:', passwordResetError);
            }
          })();
          
          // Don't await - let it run in background
          passwordResetOperation.catch(error => {
            console.error('Background password reset failed:', error);
          });
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
              password: finalPassword,
              discoursePostUrl: discoursePostUrl,
            });
            console.log(`Welcome email sent to ${input.email}`);
          } catch (emailError) {
            console.error('Error sending welcome email:', emailError);
            // Don't fail the user creation if email fails
          }
        }

        // Send Matrix welcome message if requested and Matrix service is configured
        const { matrixService } = await import('@/lib/matrix');
        if (input.sendMatrixWelcome && matrixService.isConfigured()) {
          try {
            // Generate Matrix user ID format (this should be configurable)
            const matrixUserId = `@${username}:${process.env.MATRIX_DOMAIN || 'matrix.org'}`;
            const fullName = `${input.firstName || 'User'} ${input.lastName || ''}`.trim();
            
            await matrixService.sendWelcomeMessage(
              matrixUserId,
              username,
              fullName,
              finalPassword,
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
          tempPassword: finalPassword, // Return the final password that was actually set
          passwordResetLink: authentikResult.password_reset_link,
          credentials: {
            username: authentikResult.username,
            password: finalPassword, // Return the final password that was actually set
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
        // Get current user from database
        const user = await ctx.prisma.user.findUnique({
          where: { id: parseInt(ctx.session.user.id) },
        });

        if (!user) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'User not found',
          });
        }

        // Check if user is using local authentication (has a password set)
        if (!user.password && user.authentikId) {
          // User is using SSO, redirect to SSO password reset
          await ctx.prisma.adminEvent.create({
            data: {
              eventType: 'password_change_requested',
              username: ctx.session.user.username || 'unknown',
              details: 'SSO user requested password change from dashboard - redirect to SSO',
            },
          });

          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Please use the SSO password reset feature at https://sso.irregularchat.com to change your password',
          });
        }

        // User is using local authentication, update password
        const hashedPassword = await bcrypt.hash(input.newPassword, 12);
        
        await ctx.prisma.user.update({
          where: { id: user.id },
          data: {
            password: hashedPassword,
            lastLogin: new Date(),
          },
        });

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'password_changed',
            username: ctx.session.user.username || 'unknown',
            details: 'User successfully changed password via dashboard',
          },
        });

        return { success: true, message: 'Password changed successfully' };
      } catch (error) {
        console.error('Error changing password:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to change password',
        });
      }
    }),

  // Request phone verification with improved parsing and SignalBot integration
  requestPhoneVerification: protectedProcedure
    .input(
      z.object({
        phoneNumber: z.string().min(1, 'Phone number is required'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Normalize and validate the phone number
        const normalizedPhone = normalizePhoneNumber(input.phoneNumber);
        
        if (!normalizedPhone.isValid) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: normalizedPhone.error || 'Invalid phone number format',
          });
        }

        // Generate verification hash (6-digit code for easier typing)
        const verificationHash = Math.floor(100000 + Math.random() * 900000).toString();

        // Store verification hash in database with expiration
        const expirationTime = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

        await ctx.prisma.user.update({
          where: { id: parseInt(ctx.session.user.id) },
          data: {
            attributes: {
              ...((ctx.session.user as any).attributes || {}),
              pendingPhoneVerification: {
                phoneNumber: normalizedPhone.normalized,
                originalInput: input.phoneNumber,
                hash: verificationHash,
                expiresAt: expirationTime.toISOString(),
                country: normalizedPhone.country,
              },
            },
          },
        });

        // Try to send verification via SignalBot first, fallback to Matrix
        let verificationSent = false;
        let method = 'none';

        // Send via SignalBot using direct phone number resolution
        // This will resolve phone -> UUID -> @signal_{UUID}:domain -> send message
        const { matrixService } = await import('@/lib/matrix');
        
        // Check environment variables directly to bypass SDK initialization issues
        const homeserver = process.env.MATRIX_HOMESERVER;
        const accessToken = process.env.MATRIX_ACCESS_TOKEN;
        const userId = process.env.MATRIX_USER_ID;
        const signalBridgeRoom = process.env.MATRIX_SIGNAL_BRIDGE_ROOM_ID;
        
        if (homeserver && accessToken && userId && signalBridgeRoom) {
          try {
            const verificationMessage = `🔐 Phone Verification Code\n\nYou requested to update your phone number to: ${normalizedPhone.normalized}\n\nVerification Code: ${verificationHash}\n\nEnter this 6-digit code in the dashboard to complete verification.\n\nThis code expires in 15 minutes.`;
            
            console.log(`📞 Attempting Signal verification for phone: ${normalizedPhone.normalized}`);
            
            // Use the phone-to-UUID resolution method which creates @signal_{UUID}:domain
            const result = await matrixService.sendSignalMessageByPhone(normalizedPhone.normalized, verificationMessage);
            if (result.success) {
              verificationSent = true;
              method = 'signal';
              console.log(`✅ Phone verification sent via Signal bridge to ${normalizedPhone.normalized}`);
            } else {
              console.warn(`❌ Signal verification failed: ${result.error}`);
              // Don't fall back to regular Matrix user - Signal verification should only go to Signal
            }
          } catch (signalError) {
            console.warn('❌ Signal verification failed with exception:', signalError);
          }
        } else {
          console.warn('⚠️ Matrix service environment not configured for Signal verification');
          console.warn('Missing environment variables:', {
            MATRIX_HOMESERVER: !!homeserver,
            MATRIX_ACCESS_TOKEN: !!accessToken,
            MATRIX_USER_ID: !!userId,
            MATRIX_SIGNAL_BRIDGE_ROOM_ID: !!signalBridgeRoom,
          });
        }

        if (!verificationSent) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to send verification code via Signal. Please ensure your phone number is registered with Signal Messenger and try again.',
          });
        }

        return { 
          success: true, 
          normalizedPhone: normalizedPhone.normalized,
          method,
          message: 'Verification code sent to your Signal account!'
        };
      } catch (error) {
        console.error('Error requesting phone verification:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to send verification code',
        });
      }
    }),

  // Verify phone number with improved validation
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
            message: 'No pending phone verification found. Please request a new verification code.',
          });
        }

        // Check if verification code matches and hasn't expired
        if (pendingVerification.hash !== input.verificationHash.trim()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Invalid verification code. Please check the code and try again.',
          });
        }

        if (new Date(pendingVerification.expiresAt) < new Date()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Verification code has expired. Please request a new code.',
          });
        }

        // Validate the phone number from the form matches the pending verification
        const normalizedInput = normalizePhoneNumber(input.phoneNumber);
        const storedPhone = pendingVerification.phoneNumber;
        
        // Allow verification if either the normalized input matches stored phone
        // or if the original input matches (for backwards compatibility)
        const phoneMatches = normalizedInput.normalized === storedPhone || 
                            input.phoneNumber === pendingVerification.originalInput;

        if (!phoneMatches) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Phone number mismatch. Please verify the phone number is correct.',
          });
        }

        // Update attributes to store the normalized phone and clear pending verification
        const updatedAttributes = { ...(user.attributes as any) };
        updatedAttributes.phoneNumber = storedPhone; // Use the normalized phone from verification
        updatedAttributes.phone_number = storedPhone; // Legacy field name
        updatedAttributes.phoneCountry = pendingVerification.country;
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
            details: `Phone number updated to ${storedPhone}`,
          },
        });

        return { 
          success: true, 
          phoneNumber: storedPhone,
          formattedPhone: formatPhoneForDisplay(storedPhone),
          message: 'Phone number verified and updated successfully!'
        };
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

  // Request email verification with code sent via email
  requestEmailVerification: protectedProcedure
    .input(
      z.object({
        email: z.string().email('Invalid email address'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Validate email format
        if (!input.email.trim()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Email address is required',
          });
        }

        // Check if email is already in use by another user
        const existingUser = await ctx.prisma.user.findFirst({
          where: {
            email: input.email,
            id: { not: parseInt(ctx.session.user.id) },
          },
        });

        if (existingUser) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This email address is already in use by another account',
          });
        }

        // Generate verification code (6-digit code for easier typing)
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

        // Store verification code in database with expiration (15 minutes)
        const expirationTime = new Date(Date.now() + 15 * 60 * 1000);

        await ctx.prisma.user.update({
          where: { id: parseInt(ctx.session.user.id) },
          data: {
            attributes: {
              ...((ctx.session.user as any).attributes || {}),
              pendingEmailVerification: {
                email: input.email,
                code: verificationCode,
                expiresAt: expirationTime.toISOString(),
                requestedAt: new Date().toISOString(),
              },
            },
          },
        });

        // Send verification email
        if (!emailService.isConfigured()) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Email service is not configured. Please contact an administrator.',
          });
        }

        const user = ctx.session.user;
        const fullName = user.name || user.username || 'User';

        const emailContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Email Verification Code</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
    .code-box { background-color: #e3f2fd; border: 2px solid #2196F3; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
    .code { font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1976D2; font-family: 'Courier New', monospace; }
    .warning { background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px; padding: 15px; margin: 20px 0; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <h2>🔐 Email Verification Required</h2>
    <p>Hello ${fullName},</p>
    <p>You requested to update your email address to: <strong>${input.email}</strong></p>
  </div>
  
  <p>To complete this email address change, please enter the verification code below in your dashboard:</p>
  
  <div class="code-box">
    <div class="code">${verificationCode}</div>
    <p style="margin: 10px 0 0 0; font-size: 14px; color: #666;">6-Digit Verification Code</p>
  </div>
  
  <div class="warning">
    <strong>⏰ Important:</strong> This verification code expires in 15 minutes. If you don't receive this email or the code expires, you can request a new one from your dashboard.
  </div>
  
  <p>If you did not request this email address change, please ignore this email or contact an administrator if you're concerned about your account security.</p>
  
  <p>Best regards,<br>The IrregularChat Team</p>
  
  <div class="footer">
    <p>This email verification was sent to ${input.email}. The verification code will only work for the account that requested it.</p>
  </div>
</body>
</html>`;

        const emailSent = await emailService.sendEmail(
          input.email,
          'Email Verification Code - IrregularChat',
          emailContent
        );

        if (!emailSent) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to send verification email. Please check your email address and try again.',
          });
        }

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'email_verification_requested',
            username: ctx.session.user.username || 'unknown',
            details: `Email verification requested for ${input.email}`,
          },
        });

        return {
          success: true,
          email: input.email,
          fromEmail: process.env.SMTP_FROM || 'noreply@irregularchat.com',
          message: 'Verification code sent to your email address!',
        };
      } catch (error) {
        console.error('Error requesting email verification:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to send verification email',
        });
      }
    }),

  // Verify email with verification code
  verifyEmail: protectedProcedure
    .input(
      z.object({
        email: z.string().email('Invalid email address'),
        verificationCode: z.string().min(6, 'Verification code must be 6 digits').max(6, 'Verification code must be 6 digits'),
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

        const pendingVerification = (user.attributes as any)?.pendingEmailVerification;

        if (!pendingVerification) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'No pending email verification found. Please request a new verification code.',
          });
        }

        // Check if verification code matches
        if (pendingVerification.code !== input.verificationCode.trim()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Invalid verification code. Please check your email and try again.',
          });
        }

        // Check if verification code hasn't expired
        if (new Date(pendingVerification.expiresAt) < new Date()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Verification code has expired. Please request a new code.',
          });
        }

        // Validate the email from the form matches the pending verification
        if (pendingVerification.email !== input.email) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Email address mismatch. Please verify the email address is correct.',
          });
        }

        // Check again that email is not in use by another user (race condition protection)
        const existingUser = await ctx.prisma.user.findFirst({
          where: {
            email: input.email,
            id: { not: parseInt(ctx.session.user.id) },
          },
        });

        if (existingUser) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This email address is now in use by another account. Please use a different email.',
          });
        }

        // Update user's email and clear pending verification
        const updatedAttributes = { ...(user.attributes as any) };
        delete updatedAttributes.pendingEmailVerification;

        await ctx.prisma.user.update({
          where: { id: parseInt(ctx.session.user.id) },
          data: {
            email: input.email,
            attributes: updatedAttributes,
          },
        });

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'email_updated',
            username: ctx.session.user.username || 'unknown',
            details: `Email verified and updated to ${input.email}`,
          },
        });

        return {
          success: true,
          email: input.email,
          message: 'Email address verified and updated successfully!',
        };
      } catch (error) {
        console.error('Error verifying email:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to verify email address',
        });
      }
    }),

  // Update email (legacy simplified version - deprecated in favor of verification flow)
  updateEmail: protectedProcedure
    .input(
      z.object({
        email: z.string().email('Invalid email address'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Note: This endpoint is deprecated - use requestEmailVerification + verifyEmail instead
        // Keeping for backwards compatibility only
        
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
            details: `Email updated to ${input.email} (legacy endpoint)`,
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
        const { matrixService } = await import('@/lib/matrix');
        if (matrixService.isConfigured()) {
          const indocRoom = process.env.MATRIX_INDOC_ROOM_ID || process.env.MATRIX_ADMIN_ROOM_ID;
          if (indocRoom) {
            const matrixMessage = `📨 **Message from User Dashboard**\n\n**User:** ${ctx.session.user.username} (${ctx.session.user.email})\n**Subject:** ${input.subject}\n\n**Message:**\n${input.message}`;
            
            await matrixService.sendRoomMessage(indocRoom, matrixMessage);
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

        let matrixSent = false;
        let emailSent = false;
        
        // Check what was actually sent
        if (matrixService.isConfigured() && (process.env.MATRIX_INDOC_ROOM_ID || process.env.MATRIX_ADMIN_ROOM_ID)) {
          matrixSent = true;
        }
        
        if (emailService.isConfigured() && (process.env.ADMIN_EMAIL || process.env.SMTP_FROM_EMAIL)) {
          emailSent = true;
        }

        return { 
          success: true, 
          matrixSent,
          emailSent,
          indocRoom: process.env.MATRIX_INDOC_ROOM_ID ? true : false,
          message: matrixSent 
            ? "Message sent to INDOC room. Join #indoc if you need a direct response, as replies won't come back to this dashboard."
            : "Message sent via email. Check #indoc room for faster responses from moderators."
        };
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
        inviteePhone: z.string().optional(),
        roomIds: z.array(z.string()).default([]),
        message: z.string().optional(),
        expiryDays: z.number().min(1).max(3).default(1),
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
            message: 'Phone number required to send invitations. Go to Dashboard → Account tab → "Update Phone Number" to add your phone number, then try again.',
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
            inviteePhone: input.inviteePhone,
            roomIds: input.roomIds,
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
      // Check if user exists in the database
      const userExists = await ctx.prisma.user.findUnique({
        where: { id: input.userId },
      });

      if (!userExists) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Cannot add notes to Matrix users. Please sync the user to the database first.',
        });
      }

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

  // Get email history analytics
  getEmailAnalytics: moderatorProcedure
    .input(
      z.object({
        dateRange: z.object({
          start: z.date().optional(),
          end: z.date().optional(),
        }).optional(),
        emailType: z.enum(['welcome', 'admin_message', 'invite', 'password_reset', 'custom']).optional(),
        status: z.enum(['sent', 'failed']).optional(),
        recipientId: z.number().optional(),
        senderUsername: z.string().optional(),
        page: z.number().default(1),
        limit: z.number().default(25),
      })
    )
    .query(async ({ ctx, input }) => {
      const { page, limit, dateRange, emailType, status, recipientId, senderUsername } = input;
      const skip = (page - 1) * limit;

      const where: any = {};
      
      if (dateRange?.start || dateRange?.end) {
        where.sentAt = {};
        if (dateRange.start) where.sentAt.gte = dateRange.start;
        if (dateRange.end) where.sentAt.lte = dateRange.end;
      }
      
      if (emailType) where.emailType = emailType;
      if (status) where.status = status;
      if (recipientId) where.recipientId = recipientId;
      if (senderUsername) where.senderUsername = senderUsername;

      const [emails, total] = await Promise.all([
        ctx.prisma.emailHistory.findMany({
          where,
          skip,
          take: limit,
          orderBy: { sentAt: 'desc' },
          include: {
            recipient: {
              select: {
                id: true,
                username: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
        ctx.prisma.emailHistory.count({ where }),
      ]);

      return {
        emails,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }),

  // Get email statistics summary
  getEmailStats: moderatorProcedure
    .input(
      z.object({
        dateRange: z.object({
          start: z.date().optional(),
          end: z.date().optional(),
        }).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { dateRange } = input;
      
      const where: any = {};
      if (dateRange?.start || dateRange?.end) {
        where.sentAt = {};
        if (dateRange.start) where.sentAt.gte = dateRange.start;
        if (dateRange.end) where.sentAt.lte = dateRange.end;
      }

      // Get total counts
      const [totalEmails, sentEmails, failedEmails] = await Promise.all([
        ctx.prisma.emailHistory.count({ where }),
        ctx.prisma.emailHistory.count({ where: { ...where, status: 'sent' } }),
        ctx.prisma.emailHistory.count({ where: { ...where, status: 'failed' } }),
      ]);

      // Get email type breakdown
      const emailTypeStats = await ctx.prisma.emailHistory.groupBy({
        by: ['emailType'],
        where,
        _count: { emailType: true },
        orderBy: { _count: { emailType: 'desc' } },
      });

      // Get daily email counts for the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const dailyStats = await ctx.prisma.emailHistory.groupBy({
        by: ['sentAt'],
        where: {
          ...where,
          sentAt: {
            gte: dateRange?.start || thirtyDaysAgo,
            ...(dateRange?.end && { lte: dateRange.end }),
          },
        },
        _count: { id: true },
        orderBy: { sentAt: 'desc' },
      });

      // Get top senders
      const topSenders = await ctx.prisma.emailHistory.groupBy({
        by: ['senderUsername'],
        where,
        _count: { senderUsername: true },
        orderBy: { _count: { senderUsername: 'desc' } },
        take: 10,
      });

      // Get recent activity (last 24 hours)
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
      
      const recentActivity = await ctx.prisma.emailHistory.count({
        where: {
          ...where,
          sentAt: { gte: twentyFourHoursAgo },
        },
      });

      return {
        totalEmails,
        sentEmails,
        failedEmails,
        successRate: totalEmails > 0 ? (sentEmails / totalEmails) * 100 : 0,
        emailTypeStats: emailTypeStats.map(stat => ({
          emailType: stat.emailType,
          count: stat._count.emailType,
        })),
        dailyStats: dailyStats.map(stat => ({
          date: stat.sentAt,
          count: stat._count.id,
        })),
        topSenders: topSenders.map(sender => ({
          senderUsername: sender.senderUsername,
          count: sender._count.senderUsername,
        })),
        recentActivity,
      };
    }),

  // Get user-specific email history
  getUserEmailHistory: moderatorProcedure
    .input(
      z.object({
        userId: z.number(),
        page: z.number().default(1),
        limit: z.number().default(10),
        emailType: z.enum(['welcome', 'admin_message', 'invite', 'password_reset', 'custom']).optional(),
        status: z.enum(['sent', 'failed']).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { userId, page, limit, emailType, status } = input;
      const skip = (page - 1) * limit;

      const where: any = {
        OR: [
          { recipientId: userId },
          { 
            recipient: {
              id: userId,
            },
          },
        ],
      };
      
      if (emailType) where.emailType = emailType;
      if (status) where.status = status;

      const [emails, total] = await Promise.all([
        ctx.prisma.emailHistory.findMany({
          where,
          skip,
          take: limit,
          orderBy: { sentAt: 'desc' },
          include: {
            recipient: {
              select: {
                id: true,
                username: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
        ctx.prisma.emailHistory.count({ where }),
      ]);

      return {
        emails,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }),

  // Signal account verification endpoints
  initiateSignalVerification: protectedProcedure
    .input(
      z.object({
        phoneNumber: z.string().min(10),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { generateVerificationCode, hashVerificationCode, createExpirationDate, formatPhoneForSignal, validatePhoneNumber, formatVerificationMessage } = await import('@/lib/verification-codes');
      const { matrixService } = await import('@/lib/matrix');
      
      const userId = ctx.session.user.id;
      const phoneNumber = formatPhoneForSignal(input.phoneNumber);
      
      // Validate phone number
      if (!validatePhoneNumber(phoneNumber)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid phone number format',
        });
      }
      
      // Check if user already has a verified Signal account
      const user = await ctx.prisma.user.findUnique({
        where: { id: userId },
        select: { /* signalVerified: true, signalPhoneNumber: true */ },
      });
      
      if (false /* user?.signalVerified && user.signalPhoneNumber === phoneNumber */) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This Signal account is already verified',
        });
      }
      
      // Check for existing pending verification
      const existingCode = await ctx.prisma.signalVerificationCode.findFirst({
        where: {
          userId,
          verified: false,
          expiresAt: { gt: new Date() },
        },
      });
      
      if (existingCode) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A verification code has already been sent. Please wait for it to expire before requesting a new one.',
        });
      }
      
      // Generate verification code
      const code = generateVerificationCode();
      const salt = crypto.randomBytes(16).toString('hex');
      const hashedCode = hashVerificationCode(code, salt);
      const expiresAt = createExpirationDate(10); // 10 minutes
      
      // Store verification code in database
      await ctx.prisma.signalVerificationCode.create({
        data: {
          userId,
          phoneNumber,
          code: hashedCode,
          salt,
          expiresAt,
        },
      });
      
      // Send verification code via Matrix-Signal bridge
      try {
        const message = formatVerificationMessage(code);
        const result = await matrixService.sendSignalMessageByPhone(phoneNumber, message);
        
        if (!result.success) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to send verification code. Please try again.',
          });
        }
        
        // Log the event
        await logCommunityEvent(
          ctx.prisma,
          'signal_verification_initiated',
          ctx.session.user.username || 'Unknown User',
          `Signal verification initiated for phone number ending in ${phoneNumber.slice(-4)}`
        );
        
        return {
          success: true,
          message: 'Verification code sent successfully',
          expiresIn: 600, // 10 minutes in seconds
        };
      } catch (error) {
        console.error('Error sending verification code:', error);
        
        // Clean up the stored code on failure
        await ctx.prisma.signalVerificationCode.deleteMany({
          where: {
            userId,
            phoneNumber,
            verified: false,
          },
        });
        
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to send verification code. Please try again.',
        });
      }
    }),

  verifySignalCode: protectedProcedure
    .input(
      z.object({
        code: z.string().length(6),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { verifyCode, isCodeExpired } = await import('@/lib/verification-codes');
      const userId = ctx.session.user.id;
      
      // Find the most recent verification code for this user
      const verificationRecord = await ctx.prisma.signalVerificationCode.findFirst({
        where: {
          userId,
          verified: false,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
      
      if (!verificationRecord) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No verification code found. Please request a new one.',
        });
      }
      
      // Check if code has expired
      if (isCodeExpired(verificationRecord.expiresAt)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Verification code has expired. Please request a new one.',
        });
      }
      
      // Check attempts
      if (verificationRecord.attempts >= verificationRecord.maxAttempts) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Maximum verification attempts exceeded. Please request a new code.',
        });
      }
      
      // Increment attempts
      await ctx.prisma.signalVerificationCode.update({
        where: { id: verificationRecord.id },
        data: { attempts: { increment: 1 } },
      });
      
      // Verify the code
      const isValid = verifyCode(input.code, verificationRecord.code, verificationRecord.salt);
      
      if (!isValid) {
        const remainingAttempts = verificationRecord.maxAttempts - verificationRecord.attempts - 1;
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid verification code. ${remainingAttempts} attempts remaining.`,
        });
      }
      
      // Mark as verified and update user
      await ctx.prisma.$transaction([
        ctx.prisma.signalVerificationCode.update({
          where: { id: verificationRecord.id },
          data: {
            verified: true,
            verifiedAt: new Date(),
          },
        }),
        ctx.prisma.user.update({
          where: { id: userId },
          data: {
            // signalVerified: true,
            signalPhoneNumber: verificationRecord.phoneNumber,
            // Optionally set signalIdentity if we can resolve it
          },
        }),
      ]);
      
      // Resolve Signal UUID if possible
      const { matrixService } = await import('@/lib/matrix');
      const signalUuid = await matrixService.resolvePhoneToSignalUuid(verificationRecord.phoneNumber);
      
      if (signalUuid) {
        await ctx.prisma.user.update({
          where: { id: userId },
          data: {
            signalIdentity: signalUuid,
          },
        });
      }
      
      // Log the event
      await logCommunityEvent(
        ctx.prisma,
        'signal_verification_completed',
        ctx.session.user.username || 'Unknown User',
        `Signal account successfully verified`
      );
      
      return {
        success: true,
        message: 'Signal account successfully verified',
      };
    }),

  getSignalVerificationStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const userId = ctx.session.user.id;
      
      const user = await ctx.prisma.user.findUnique({
        where: { id: userId },
        select: {
          signalVerified: true,
          signalPhoneNumber: true,
          signalIdentity: true,
        },
      });
      
      // Check for pending verification
      const pendingVerification = await ctx.prisma.signalVerificationCode.findFirst({
        where: {
          userId,
          verified: false,
          expiresAt: { gt: new Date() },
        },
        select: {
          expiresAt: true,
          attempts: true,
          maxAttempts: true,
        },
      });
      
      return {
        isVerified: false, // user?.signalVerified || false,
        phoneNumber: user?.signalPhoneNumber,
        signalIdentity: user?.signalIdentity,
        pendingVerification: pendingVerification ? {
          expiresAt: pendingVerification.expiresAt,
          remainingAttempts: pendingVerification.maxAttempts - pendingVerification.attempts,
        } : null,
      };
    }),

  removeSignalVerification: protectedProcedure
    .mutation(async ({ ctx }) => {
      const userId = ctx.session.user.id;
      
      await ctx.prisma.$transaction([
        // Remove verification records
        ctx.prisma.signalVerificationCode.deleteMany({
          where: { userId },
        }),
        // Update user
        ctx.prisma.user.update({
          where: { id: userId },
          data: {
            // signalVerified: false,
            signalPhoneNumber: null,
            signalIdentity: null,
          },
        }),
      ]);
      
      // Log the event
      await logCommunityEvent(
        ctx.prisma,
        'signal_verification_removed',
        ctx.session.user.username || 'Unknown User',
        `Signal account verification removed`
      );
      
      return {
        success: true,
        message: 'Signal verification removed successfully',
      };
    }),

  requestRoomJoin: protectedProcedure
    .input(
      z.object({
        roomIds: z.array(z.string()).min(1, 'At least one room must be selected'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      
      // Get user profile to check Signal verification
      const user = await ctx.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          signalIdentity: true,
          attributes: true,
        },
      });
      
      if (!user) {
        throw new Error('User not found');
      }
      
      // Check if user has Signal verified
      const userAttributes = user.attributes as Record<string, unknown> || {};
      const phoneNumber = userAttributes.phoneNumber as string;
      const hasSignalVerification = !!user.signalIdentity || !!phoneNumber;
      
      if (!hasSignalVerification) {
        throw new Error('SIGNAL_VERIFICATION_REQUIRED');
      }
      
      // Use Matrix service to invite user to rooms
      const { matrixService } = await import('@/lib/matrix');
      if (!matrixService.isConfigured()) {
        throw new Error('Matrix service not configured');
      }
      
      const results: { roomId: string; success: boolean; error?: string }[] = [];
      
      for (const roomId of input.roomIds) {
        try {
          // For regular users, we'll have the bot invite them using their Matrix username
          // First, resolve user to Matrix username
          let matrixUserId = userAttributes.matrixUsername as string;
          
          if (!matrixUserId && phoneNumber) {
            // Try to resolve via Signal bridge if available
            try {
              const signalUuid = await matrixService.resolvePhoneToSignalUuid(phoneNumber);
              if (signalUuid) {
                // This would be the Signal bridge user ID format
                matrixUserId = `@${signalUuid}:${process.env.MATRIX_HOMESERVER?.replace('https://', '') || 'matrix.org'}`;
              }
            } catch (signalError) {
              console.warn('Could not resolve Signal UUID for user:', signalError);
            }
          }
          
          if (!matrixUserId) {
            // Fallback: construct Matrix ID from username
            const homeserver = process.env.MATRIX_HOMESERVER?.replace('https://', '') || 'matrix.org';
            matrixUserId = `@${user.username}:${homeserver}`;
          }
          
          const success = await matrixService.inviteToRoom(roomId, matrixUserId);
          results.push({ roomId, success });
          
          if (success) {
            // Log the room join request
            await logCommunityEvent(
              ctx.prisma,
              'user_room_join_request',
              user.username || 'Unknown User',
              `Requested to join room: ${roomId}`
            );
          }
          
        } catch (error) {
          console.error(`Failed to invite user ${userId} to room ${roomId}:`, error);
          results.push({ 
            roomId, 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      const failedCount = results.length - successCount;
      
      if (successCount > 0) {
        return {
          success: true,
          message: `Successfully requested to join ${successCount} room${successCount === 1 ? '' : 's'}${failedCount > 0 ? `, ${failedCount} failed` : ''}`,
          results,
        };
      } else {
        throw new Error('Failed to join any rooms. Please try again or contact an administrator.');
      }
    }),

  // Signal Groups Self-Service Suite
  // Get user's Signal status and available groups
  getSignalStatus: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.session?.user?.id) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'You must be logged in to view Signal status'
      });
    }

    try {
      const userId = parseInt(ctx.session.user.id);
      
      // Get user's Signal verification status and current memberships
      const user = await ctx.prisma.user.findUnique({
        where: { id: userId },
        include: {
          signalGroupMemberships: {
            where: { status: 'active' },
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true
                }
              }
            }
          },
          signalGroupJoinRequests: {
            where: { status: 'pending' },
            orderBy: { requestedAt: 'desc' }
          }
        }
      });

      // Get available groups
      const availableGroups = await ctx.prisma.signalAvailableGroup.findMany({
        where: { 
          isActive: true,
          isPublic: true 
        },
        orderBy: { displayOrder: 'asc' },
        include: {
          admin: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true
            }
          },
          _count: {
            select: {
              joinRequests: {
                where: { status: 'pending' }
              }
            }
          }
        }
      });

      return {
        user: {
          id: user?.id,
          username: user?.username,
          signalVerified: !!user?.signalIdentity,
          signalIdentity: user?.signalIdentity
        },
        currentMemberships: user?.signalGroupMemberships || [],
        pendingRequests: user?.signalGroupJoinRequests || [],
        availableGroups: availableGroups.map(group => ({
          ...group,
          userIsMember: user?.signalGroupMemberships.some(m => m.groupId === group.groupId) || false,
          userHasPendingRequest: user?.signalGroupJoinRequests.some(r => r.groupId === group.groupId) || false,
          pendingRequestsCount: group._count.joinRequests
        }))
      };
    } catch (error) {
      console.error('Error fetching Signal status:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch Signal status'
      });
    }
  }),

  // Request to join a Signal group
  requestToJoinSignalGroup: protectedProcedure
    .input(z.object({
      groupId: z.string().min(1, 'Group ID is required'),
      message: z.string().optional()
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.session?.user?.id) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'You must be logged in to join groups'
        });
      }

      const userId = parseInt(ctx.session.user.id);
      
      try {
        // Check if user is verified with Signal
        const user = await ctx.prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            username: true,
            signalIdentity: true,
            signalGroupJoinRequests: {
              where: {
                groupId: input.groupId,
                status: { in: ['pending', 'approved'] }
              }
            }
          }
        });

        if (!user?.signalIdentity) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'You must verify your Signal account before joining groups'
          });
        }

        // Check for existing requests
        if (user.signalGroupJoinRequests.length > 0) {
          const existingRequest = user.signalGroupJoinRequests[0];
          throw new TRPCError({
            code: 'CONFLICT',
            message: existingRequest.status === 'approved' 
              ? 'You are already a member of this group'
              : 'You already have a pending request for this group'
          });
        }

        // Rate limiting: check requests in last hour
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentRequests = await ctx.prisma.signalGroupJoinRequest.count({
          where: {
            userId,
            requestedAt: { gte: oneHourAgo }
          }
        });

        if (recentRequests >= 5) {
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: 'You can only make 5 join requests per hour. Please try again later.'
          });
        }

        // Check if group exists and is available
        const group = await ctx.prisma.signalAvailableGroup.findUnique({
          where: { groupId: input.groupId }
        });

        if (!group || !group.isActive || !group.isPublic) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Group not found or not available for joining'
          });
        }

        // Create join request
        const joinRequest = await ctx.prisma.signalGroupJoinRequest.create({
          data: {
            userId,
            groupId: input.groupId,
            message: input.message,
            status: 'pending'
          }
        });

        // Log the request for community timeline
        await logCommunityEvent(
          ctx.prisma,
          'signal_group_join_request',
          user.username || 'Unknown User',
          `Requested to join Signal group: ${group.name}`
        );

        return {
          success: true,
          message: group.requiresApproval 
            ? `Join request submitted for "${group.name}". Awaiting admin approval.`
            : `Successfully joined "${group.name}"!`,
          requestId: joinRequest.id,
          requiresApproval: group.requiresApproval
        };

      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        console.error('Error creating Signal group join request:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to process join request'
        });
      }
    }),

});

// Helper function for password hashing
async function hashPassword(password: string): Promise<string> {
  const bcrypt = await import('bcryptjs');
  return bcrypt.hash(password, 12);
} 