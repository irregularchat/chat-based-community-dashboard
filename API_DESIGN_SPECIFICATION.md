# API Design Specification: Modern tRPC-Based API

## Overview

This document outlines the complete API design for the Community Dashboard migration from Streamlit to a modern tRPC-based architecture. The API will replace all current direct API calls, session state management, and data fetching patterns.

## Architecture Overview

### Current Architecture Issues
- Direct API calls scattered throughout Streamlit components
- No type safety between frontend and backend
- Session state used for caching (inefficient)
- Manual error handling in each component
- No centralized data validation

### Modern Architecture Benefits
- **Type Safety**: End-to-end TypeScript types
- **Centralized Logic**: All API logic in tRPC routers
- **Automatic Caching**: React Query handles caching
- **Error Handling**: Consistent error handling across all endpoints
- **Input Validation**: Zod schema validation
- **Real-time Updates**: WebSocket support for live data

## Authentication & Authorization

### Authentication Router
```typescript
// server/api/routers/auth.ts
import { z } from 'zod'
import { createTRPCRouter, publicProcedure, protectedProcedure } from '~/server/api/trpc'

export const authRouter = createTRPCRouter({
  // Login with credentials
  login: publicProcedure
    .input(z.object({
      username: z.string(),
      password: z.string()
    }))
    .mutation(async ({ input, ctx }) => {
      // Validate credentials against Authentik or local auth
      const user = await validateCredentials(input.username, input.password)
      
      if (!user) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid credentials'
        })
      }
      
      // Create session token
      const token = await createSessionToken(user)
      
      return {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          isAdmin: user.isAdmin,
          isModerator: user.isModerator
        },
        token
      }
    }),

  // Get current user session
  me: protectedProcedure
    .query(async ({ ctx }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.session.user.id },
        select: {
          id: true,
          username: true,
          email: true,
          fullName: true,
          role: true,
          isAdmin: true,
          isModerator: true,
          lastLogin: true,
          createdAt: true
        }
      })
      
      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found'
        })
      }
      
      return user
    }),

  // Refresh session
  refresh: protectedProcedure
    .mutation(async ({ ctx }) => {
      const newToken = await refreshSessionToken(ctx.session.user.id)
      return { token: newToken }
    }),

  // Logout
  logout: protectedProcedure
    .mutation(async ({ ctx }) => {
      await invalidateSessionToken(ctx.session.token)
      return { success: true }
    }),

  // OIDC callback handler
  oidcCallback: publicProcedure
    .input(z.object({
      code: z.string(),
      state: z.string()
    }))
    .mutation(async ({ input, ctx }) => {
      // Exchange code for tokens with Authentik
      const tokens = await exchangeCodeForTokens(input.code, input.state)
      
      // Get user info from Authentik
      const userInfo = await fetchUserFromAuthentik(tokens.access_token)
      
      // Create or update user in local database
      const user = await createOrUpdateUser(userInfo)
      
      // Create session
      const sessionToken = await createSessionToken(user)
      
      return {
        user,
        token: sessionToken
      }
    })
})
```

### Permission System
```typescript
// server/api/routers/permissions.ts
export const permissionRouter = createTRPCRouter({
  // Get user permissions
  getUserPermissions: protectedProcedure
    .input(z.object({
      userId: z.string().optional()
    }))
    .query(async ({ input, ctx }) => {
      const userId = input.userId || ctx.session.user.id
      
      // Check if user can view another user's permissions
      if (userId !== ctx.session.user.id && !ctx.session.user.isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot view other user permissions'
        })
      }
      
      const permissions = await ctx.db.userPermission.findMany({
        where: { userId },
        include: {
          permission: true
        }
      })
      
      return permissions
    }),

  // Update user permissions (admin only)
  updateUserPermissions: adminProcedure
    .input(z.object({
      userId: z.string(),
      permissionIds: z.array(z.string())
    }))
    .mutation(async ({ input, ctx }) => {
      // Remove existing permissions
      await ctx.db.userPermission.deleteMany({
        where: { userId: input.userId }
      })
      
      // Add new permissions
      await ctx.db.userPermission.createMany({
        data: input.permissionIds.map(permissionId => ({
          userId: input.userId,
          permissionId
        }))
      })
      
      return { success: true }
    })
})
```

## User Management

### User Router
```typescript
// server/api/routers/users.ts
export const userRouter = createTRPCRouter({
  // List users with pagination and filtering
  list: protectedProcedure
    .input(z.object({
      page: z.number().default(1),
      pageSize: z.number().min(1).max(100).default(50),
      search: z.string().optional(),
      status: z.enum(['active', 'inactive', 'all']).default('all'),
      sortBy: z.enum(['username', 'email', 'createdAt', 'lastLogin']).default('username'),
      sortOrder: z.enum(['asc', 'desc']).default('asc')
    }))
    .query(async ({ input, ctx }) => {
      const where = {
        ...(input.search && {
          OR: [
            { username: { contains: input.search, mode: 'insensitive' } },
            { email: { contains: input.search, mode: 'insensitive' } },
            { fullName: { contains: input.search, mode: 'insensitive' } }
          ]
        }),
        ...(input.status !== 'all' && {
          isActive: input.status === 'active'
        })
      }
      
      const [users, total] = await Promise.all([
        ctx.db.user.findMany({
          where,
          select: {
            id: true,
            username: true,
            email: true,
            fullName: true,
            isActive: true,
            isAdmin: true,
            isModerator: true,
            lastLogin: true,
            createdAt: true
          },
          orderBy: { [input.sortBy]: input.sortOrder },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize
        }),
        ctx.db.user.count({ where })
      ])
      
      return {
        users,
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          total,
          totalPages: Math.ceil(total / input.pageSize)
        }
      }
    }),

  // Get single user
  getById: protectedProcedure
    .input(z.object({
      id: z.string()
    }))
    .query(async ({ input, ctx }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: input.id },
        include: {
          notes: {
            orderBy: { createdAt: 'desc' },
            take: 10
          },
          permissions: {
            include: {
              permission: true
            }
          }
        }
      })
      
      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found'
        })
      }
      
      return user
    }),

  // Create user
  create: protectedProcedure
    .input(z.object({
      username: z.string().min(3).max(50),
      email: z.string().email(),
      fullName: z.string().min(1).max(100),
      password: z.string().min(8).optional(),
      isActive: z.boolean().default(true),
      invitedBy: z.string().optional(),
      intro: z.string().optional()
    }))
    .mutation(async ({ input, ctx }) => {
      // Check if username/email already exists
      const existing = await ctx.db.user.findFirst({
        where: {
          OR: [
            { username: input.username },
            { email: input.email }
          ]
        }
      })
      
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Username or email already exists'
        })
      }
      
      // Create user in local database
      const user = await ctx.db.user.create({
        data: {
          username: input.username,
          email: input.email,
          fullName: input.fullName,
          isActive: input.isActive,
          invitedBy: input.invitedBy,
          intro: input.intro,
          createdById: ctx.session.user.id
        }
      })
      
      // Create user in Authentik if configured
      if (Config.AUTHENTIK_ENABLED) {
        await createAuthentikUser({
          username: input.username,
          email: input.email,
          name: input.fullName,
          password: input.password
        })
      }
      
      // Log admin event
      await ctx.db.adminEvent.create({
        data: {
          type: 'USER_CREATED',
          userId: user.id,
          performedById: ctx.session.user.id,
          details: {
            username: user.username,
            email: user.email
          }
        }
      })
      
      return user
    }),

  // Update user
  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      username: z.string().min(3).max(50).optional(),
      email: z.string().email().optional(),
      fullName: z.string().min(1).max(100).optional(),
      isActive: z.boolean().optional(),
      intro: z.string().optional()
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...updateData } = input
      
      // Check if user exists
      const existingUser = await ctx.db.user.findUnique({
        where: { id }
      })
      
      if (!existingUser) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found'
        })
      }
      
      // Check permissions (can edit own profile or admin)
      if (existingUser.id !== ctx.session.user.id && !ctx.session.user.isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot edit other users'
        })
      }
      
      // Update user
      const user = await ctx.db.user.update({
        where: { id },
        data: updateData
      })
      
      // Log admin event
      await ctx.db.adminEvent.create({
        data: {
          type: 'USER_UPDATED',
          userId: user.id,
          performedById: ctx.session.user.id,
          details: updateData
        }
      })
      
      return user
    }),

  // Delete user
  delete: adminProcedure
    .input(z.object({
      id: z.string()
    }))
    .mutation(async ({ input, ctx }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: input.id }
      })
      
      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found'
        })
      }
      
      // Soft delete (set inactive)
      await ctx.db.user.update({
        where: { id: input.id },
        data: { isActive: false }
      })
      
      // Log admin event
      await ctx.db.adminEvent.create({
        data: {
          type: 'USER_DELETED',
          userId: user.id,
          performedById: ctx.session.user.id,
          details: {
            username: user.username,
            email: user.email
          }
        }
      })
      
      return { success: true }
    }),

  // Bulk operations
  bulkUpdate: adminProcedure
    .input(z.object({
      userIds: z.array(z.string()),
      action: z.enum(['activate', 'deactivate', 'delete']),
      data: z.record(z.any()).optional()
    }))
    .mutation(async ({ input, ctx }) => {
      const { userIds, action, data = {} } = input
      
      let updateData = {}
      let eventType = ''
      
      switch (action) {
        case 'activate':
          updateData = { isActive: true }
          eventType = 'BULK_ACTIVATE'
          break
        case 'deactivate':
          updateData = { isActive: false }
          eventType = 'BULK_DEACTIVATE'
          break
        case 'delete':
          updateData = { isActive: false }
          eventType = 'BULK_DELETE'
          break
      }
      
      // Update users
      const result = await ctx.db.user.updateMany({
        where: { id: { in: userIds } },
        data: updateData
      })
      
      // Log admin event
      await ctx.db.adminEvent.create({
        data: {
          type: eventType,
          performedById: ctx.session.user.id,
          details: {
            userIds,
            action,
            count: result.count
          }
        }
      })
      
      return { success: true, count: result.count }
    })
})
```

## User Notes

### Notes Router
```typescript
// server/api/routers/notes.ts
export const noteRouter = createTRPCRouter({
  // Get notes for a user
  getByUserId: protectedProcedure
    .input(z.object({
      userId: z.string(),
      page: z.number().default(1),
      pageSize: z.number().min(1).max(50).default(20)
    }))
    .query(async ({ input, ctx }) => {
      const notes = await ctx.db.userNote.findMany({
        where: { userId: input.userId },
        include: {
          createdBy: {
            select: {
              id: true,
              username: true,
              fullName: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize
      })
      
      return notes
    }),

  // Create note
  create: protectedProcedure
    .input(z.object({
      userId: z.string(),
      content: z.string().min(1).max(1000),
      isPrivate: z.boolean().default(false)
    }))
    .mutation(async ({ input, ctx }) => {
      const note = await ctx.db.userNote.create({
        data: {
          userId: input.userId,
          content: input.content,
          isPrivate: input.isPrivate,
          createdById: ctx.session.user.id
        },
        include: {
          createdBy: {
            select: {
              id: true,
              username: true,
              fullName: true
            }
          }
        }
      })
      
      return note
    }),

  // Update note
  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      content: z.string().min(1).max(1000),
      isPrivate: z.boolean().optional()
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...updateData } = input
      
      // Check if note exists and user owns it
      const existingNote = await ctx.db.userNote.findUnique({
        where: { id }
      })
      
      if (!existingNote) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Note not found'
        })
      }
      
      if (existingNote.createdById !== ctx.session.user.id && !ctx.session.user.isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot edit other users notes'
        })
      }
      
      const note = await ctx.db.userNote.update({
        where: { id },
        data: updateData
      })
      
      return note
    }),

  // Delete note
  delete: protectedProcedure
    .input(z.object({
      id: z.string()
    }))
    .mutation(async ({ input, ctx }) => {
      const note = await ctx.db.userNote.findUnique({
        where: { id: input.id }
      })
      
      if (!note) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Note not found'
        })
      }
      
      if (note.createdById !== ctx.session.user.id && !ctx.session.user.isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Cannot delete other users notes'
        })
      }
      
      await ctx.db.userNote.delete({
        where: { id: input.id }
      })
      
      return { success: true }
    })
})
```

## Matrix Integration

### Matrix Router
```typescript
// server/api/routers/matrix.ts
export const matrixRouter = createTRPCRouter({
  // Get Matrix rooms
  getRooms: protectedProcedure
    .input(z.object({
      type: z.enum(['all', 'public', 'configured']).default('all')
    }))
    .query(async ({ input, ctx }) => {
      const rooms = await getMatrixRooms(input.type)
      return rooms
    }),

  // Get room recommendations for user
  getRoomRecommendations: protectedProcedure
    .input(z.object({
      userId: z.string()
    }))
    .query(async ({ input, ctx }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: input.userId },
        select: {
          username: true,
          intro: true,
          matrixUsername: true
        }
      })
      
      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found'
        })
      }
      
      // Get room recommendations based on user intro
      const recommendations = await getRoomRecommendations(user)
      
      return recommendations
    }),

  // Invite user to Matrix room
  inviteToRoom: protectedProcedure
    .input(z.object({
      userId: z.string(),
      roomId: z.string(),
      sendWelcomeMessage: z.boolean().default(true)
    }))
    .mutation(async ({ input, ctx }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: input.userId }
      })
      
      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'User not found'
        })
      }
      
      // Invite to Matrix room
      const result = await inviteToMatrixRoom(
        user.matrixUsername,
        input.roomId,
        input.sendWelcomeMessage
      )
      
      // Log the invitation
      await ctx.db.adminEvent.create({
        data: {
          type: 'MATRIX_INVITATION',
          userId: user.id,
          performedById: ctx.session.user.id,
          details: {
            roomId: input.roomId,
            matrixUsername: user.matrixUsername
          }
        }
      })
      
      return result
    }),

  // Send Matrix message
  sendMessage: protectedProcedure
    .input(z.object({
      roomId: z.string(),
      message: z.string().min(1).max(1000),
      messageType: z.enum(['text', 'notice']).default('text')
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await sendMatrixMessage(
        input.roomId,
        input.message,
        input.messageType
      )
      
      return result
    }),

  // Bulk invite users to rooms
  bulkInviteToRooms: protectedProcedure
    .input(z.object({
      userIds: z.array(z.string()),
      roomIds: z.array(z.string()),
      sendWelcomeMessage: z.boolean().default(true)
    }))
    .mutation(async ({ input, ctx }) => {
      const results = []
      
      for (const userId of input.userIds) {
        const user = await ctx.db.user.findUnique({
          where: { id: userId }
        })
        
        if (!user) continue
        
        for (const roomId of input.roomIds) {
          try {
            const result = await inviteToMatrixRoom(
              user.matrixUsername,
              roomId,
              input.sendWelcomeMessage
            )
            
            results.push({
              userId,
              roomId,
              success: result.success,
              error: result.error
            })
          } catch (error) {
            results.push({
              userId,
              roomId,
              success: false,
              error: error.message
            })
          }
        }
      }
      
      // Log bulk invitation
      await ctx.db.adminEvent.create({
        data: {
          type: 'MATRIX_BULK_INVITATION',
          performedById: ctx.session.user.id,
          details: {
            userIds: input.userIds,
            roomIds: input.roomIds,
            results
          }
        }
      })
      
      return { results }
    })
})
```

## Invitations

### Invitation Router
```typescript
// server/api/routers/invitations.ts
export const invitationRouter = createTRPCRouter({
  // Create invitation
  create: protectedProcedure
    .input(z.object({
      type: z.enum(['registration', 'room_invite']),
      expiresAt: z.date().optional(),
      maxUses: z.number().min(1).optional(),
      metadata: z.record(z.any()).optional()
    }))
    .mutation(async ({ input, ctx }) => {
      const invitation = await ctx.db.invitation.create({
        data: {
          type: input.type,
          code: generateInviteCode(),
          expiresAt: input.expiresAt,
          maxUses: input.maxUses,
          metadata: input.metadata,
          createdById: ctx.session.user.id
        }
      })
      
      // Generate invitation URL
      const inviteUrl = `${Config.APP_URL}/invite/${invitation.code}`
      
      return {
        ...invitation,
        url: inviteUrl
      }
    }),

  // Get invitation by code
  getByCode: publicProcedure
    .input(z.object({
      code: z.string()
    }))
    .query(async ({ input, ctx }) => {
      const invitation = await ctx.db.invitation.findUnique({
        where: { code: input.code },
        include: {
          createdBy: {
            select: {
              id: true,
              username: true,
              fullName: true
            }
          }
        }
      })
      
      if (!invitation) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invitation not found'
        })
      }
      
      // Check if invitation is valid
      if (invitation.expiresAt && invitation.expiresAt < new Date()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invitation has expired'
        })
      }
      
      if (invitation.maxUses && invitation.usedCount >= invitation.maxUses) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invitation has reached maximum uses'
        })
      }
      
      return invitation
    }),

  // Use invitation
  use: publicProcedure
    .input(z.object({
      code: z.string(),
      userData: z.record(z.any()).optional()
    }))
    .mutation(async ({ input, ctx }) => {
      const invitation = await ctx.db.invitation.findUnique({
        where: { code: input.code }
      })
      
      if (!invitation) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invitation not found'
        })
      }
      
      // Validate invitation
      if (invitation.expiresAt && invitation.expiresAt < new Date()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invitation has expired'
        })
      }
      
      if (invitation.maxUses && invitation.usedCount >= invitation.maxUses) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invitation has reached maximum uses'
        })
      }
      
      // Update invitation usage
      await ctx.db.invitation.update({
        where: { id: invitation.id },
        data: { usedCount: { increment: 1 } }
      })
      
      return { success: true, invitation }
    }),

  // List invitations
  list: protectedProcedure
    .input(z.object({
      page: z.number().default(1),
      pageSize: z.number().min(1).max(50).default(20),
      status: z.enum(['active', 'expired', 'exhausted', 'all']).default('all')
    }))
    .query(async ({ input, ctx }) => {
      const where = {}
      
      if (input.status === 'active') {
        where.AND = [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
          { OR: [{ maxUses: null }, { usedCount: { lt: ctx.db.invitation.fields.maxUses } }] }
        ]
      } else if (input.status === 'expired') {
        where.expiresAt = { lt: new Date() }
      } else if (input.status === 'exhausted') {
        where.AND = [
          { maxUses: { not: null } },
          { usedCount: { gte: ctx.db.invitation.fields.maxUses } }
        ]
      }
      
      const [invitations, total] = await Promise.all([
        ctx.db.invitation.findMany({
          where,
          include: {
            createdBy: {
              select: {
                id: true,
                username: true,
                fullName: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize
        }),
        ctx.db.invitation.count({ where })
      ])
      
      return {
        invitations,
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          total,
          totalPages: Math.ceil(total / input.pageSize)
        }
      }
    })
})
```

## Admin Features

### Admin Router
```typescript
// server/api/routers/admin.ts
export const adminRouter = createTRPCRouter({
  // Get dashboard stats
  getDashboardStats: adminProcedure
    .query(async ({ ctx }) => {
      const [
        totalUsers,
        activeUsers,
        adminUsers,
        moderatorUsers,
        recentLogins,
        totalEvents
      ] = await Promise.all([
        ctx.db.user.count(),
        ctx.db.user.count({ where: { isActive: true } }),
        ctx.db.user.count({ where: { isAdmin: true } }),
        ctx.db.user.count({ where: { isModerator: true } }),
        ctx.db.user.count({
          where: {
            lastLogin: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days
            }
          }
        }),
        ctx.db.adminEvent.count()
      ])
      
      return {
        totalUsers,
        activeUsers,
        adminUsers,
        moderatorUsers,
        recentLogins,
        totalEvents
      }
    }),

  // Get event history
  getEventHistory: adminProcedure
    .input(z.object({
      page: z.number().default(1),
      pageSize: z.number().min(1).max(100).default(50),
      type: z.string().optional(),
      userId: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional()
    }))
    .query(async ({ input, ctx }) => {
      const where = {
        ...(input.type && { type: input.type }),
        ...(input.userId && { userId: input.userId }),
        ...(input.startDate && { createdAt: { gte: input.startDate } }),
        ...(input.endDate && { createdAt: { lte: input.endDate } }),
        ...(input.startDate && input.endDate && {
          createdAt: { gte: input.startDate, lte: input.endDate }
        })
      }
      
      const [events, total] = await Promise.all([
        ctx.db.adminEvent.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                username: true,
                fullName: true
              }
            },
            performedBy: {
              select: {
                id: true,
                username: true,
                fullName: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize
        }),
        ctx.db.adminEvent.count({ where })
      ])
      
      return {
        events,
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          total,
          totalPages: Math.ceil(total / input.pageSize)
        }
      }
    }),

  // System settings
  getSettings: adminProcedure
    .query(async ({ ctx }) => {
      const settings = await ctx.db.setting.findMany()
      return settings.reduce((acc, setting) => {
        acc[setting.key] = setting.value
        return acc
      }, {})
    }),

  updateSettings: adminProcedure
    .input(z.record(z.any()))
    .mutation(async ({ input, ctx }) => {
      const updates = Object.entries(input).map(([key, value]) => ({
        key,
        value,
        updatedById: ctx.session.user.id
      }))
      
      await ctx.db.setting.createMany({
        data: updates,
        skipDuplicates: true
      })
      
      // Update existing settings
      for (const [key, value] of Object.entries(input)) {
        await ctx.db.setting.upsert({
          where: { key },
          create: { key, value, updatedById: ctx.session.user.id },
          update: { value, updatedById: ctx.session.user.id }
        })
      }
      
      return { success: true }
    })
})
```

## tRPC Context and Configuration

### tRPC Context
```typescript
// server/api/trpc.ts
import { type CreateNextContextOptions } from '@trpc/server/adapters/next'
import { getServerSession } from 'next-auth'
import { authOptions } from '~/server/auth'
import { db } from '~/server/db'

export const createTRPCContext = async (opts: CreateNextContextOptions) => {
  const { req, res } = opts
  
  // Get session
  const session = await getServerSession(req, res, authOptions)
  
  return {
    db,
    session,
    req,
    res
  }
}

// Helper procedures
export const publicProcedure = t.procedure
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session || !ctx.session.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({
    ctx: {
      ...ctx,
      session: { ...ctx.session, user: ctx.session.user }
    }
  })
})

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.session.user.isAdmin) {
    throw new TRPCError({ code: 'FORBIDDEN' })
  }
  return next({ ctx })
})

export const moderatorProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.session.user.isAdmin && !ctx.session.user.isModerator) {
    throw new TRPCError({ code: 'FORBIDDEN' })
  }
  return next({ ctx })
})
```

### Root Router
```typescript
// server/api/root.ts
import { createTRPCRouter } from '~/server/api/trpc'
import { authRouter } from './routers/auth'
import { userRouter } from './routers/users'
import { noteRouter } from './routers/notes'
import { matrixRouter } from './routers/matrix'
import { invitationRouter } from './routers/invitations'
import { adminRouter } from './routers/admin'
import { permissionRouter } from './routers/permissions'

export const appRouter = createTRPCRouter({
  auth: authRouter,
  user: userRouter,
  note: noteRouter,
  matrix: matrixRouter,
  invitation: invitationRouter,
  admin: adminRouter,
  permission: permissionRouter
})

export type AppRouter = typeof appRouter
```

## Client Usage Examples

### User Management
```typescript
// components/UserList.tsx
import { api } from '~/utils/api'

export function UserList() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  
  const { data, isLoading, error } = api.user.list.useQuery({
    page,
    search,
    pageSize: 50
  })
  
  const deleteUser = api.user.delete.useMutation({
    onSuccess: () => {
      toast.success('User deleted')
      // Invalidate and refetch
      utils.user.list.invalidate()
    }
  })
  
  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error.message}</div>
  
  return (
    <div>
      <input 
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search users..."
      />
      
      {data?.users.map(user => (
        <div key={user.id}>
          <span>{user.username}</span>
          <button onClick={() => deleteUser.mutate({ id: user.id })}>
            Delete
          </button>
        </div>
      ))}
      
      <Pagination 
        page={page}
        totalPages={data?.pagination.totalPages || 1}
        onPageChange={setPage}
      />
    </div>
  )
}
```

### Form Handling
```typescript
// components/CreateUserForm.tsx
import { api } from '~/utils/api'

export function CreateUserForm() {
  const utils = api.useUtils()
  
  const createUser = api.user.create.useMutation({
    onSuccess: () => {
      toast.success('User created successfully!')
      form.reset()
      utils.user.list.invalidate()
    },
    onError: (error) => {
      toast.error(error.message)
    }
  })
  
  const form = useForm({
    resolver: zodResolver(userSchema)
  })
  
  const onSubmit = (data) => {
    createUser.mutate(data)
  }
  
  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      {/* Form fields */}
      <button type="submit" disabled={createUser.isLoading}>
        {createUser.isLoading ? 'Creating...' : 'Create User'}
      </button>
    </form>
  )
}
```

## Migration Benefits

### Type Safety
- End-to-end type safety from database to UI
- Compile-time error checking
- IntelliSense support in IDE

### Performance
- Automatic caching with React Query
- Optimistic updates
- Background refetching
- Deduplication of requests

### Developer Experience
- Single source of truth for API
- Automatic API documentation
- Built-in error handling
- Real-time updates via subscriptions

### Maintenance
- Centralized business logic
- Consistent error handling
- Easy to test and mock
- Version control for API changes

---

*This API specification will be implemented in phases according to the migration timeline outlined in the project plan.* 