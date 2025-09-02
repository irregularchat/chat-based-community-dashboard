import { z } from 'zod';
import { createTRPCRouter, moderatorProcedure, protectedProcedure } from '../trpc';
import { TRPCError } from '@trpc/server';
import { enhancedSignalClient } from '@/lib/signal/enhanced-api-client';
import { logCommunityEvent, getCategoryForEventType } from '@/lib/community-timeline';
import { NativeSignalBotService } from '@/lib/signal-cli/native-daemon-service';

let nativeBot: NativeSignalBotService | null = null;

function getNativeBot() {
  if (!nativeBot) {
    const config = {
      phoneNumber: process.env.SIGNAL_PHONE_NUMBER || process.env.SIGNAL_BOT_PHONE_NUMBER,
      aiEnabled: process.env.OPENAI_ACTIVE === 'true',
      openAiApiKey: process.env.OPENAI_API_KEY,
      dataDir: process.env.SIGNAL_CLI_DATA_DIR || './signal-data'
    };
    nativeBot = new NativeSignalBotService(config);
  }
  return nativeBot;
}

export const signalRouter = createTRPCRouter({
  // Get Signal groups with enhanced display names
  getGroups: moderatorProcedure
    .input(
      z.object({
        phoneNumber: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        // Set phone number from environment if not provided
        const phoneNumber = input.phoneNumber || process.env.SIGNAL_PHONE_NUMBER;
        if (!phoneNumber) {
          throw new Error('Signal phone number not configured');
        }

        enhancedSignalClient.setPhoneNumber(phoneNumber);
        const groups = await enhancedSignalClient.getGroupsWithNames();
        
        return groups;
      } catch (error) {
        console.error('Error fetching Signal groups:', error);
        throw new Error('Failed to fetch Signal groups');
      }
    }),

  // Get Signal users/contacts with enhanced display names
  getUsers: moderatorProcedure
    .input(
      z.object({
        phoneNumber: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        // Set phone number from environment if not provided
        const phoneNumber = input.phoneNumber || process.env.SIGNAL_PHONE_NUMBER;
        if (!phoneNumber) {
          throw new Error('Signal phone number not configured');
        }

        enhancedSignalClient.setPhoneNumber(phoneNumber);
        const users = await enhancedSignalClient.getUsersWithNames();
        
        return users;
      } catch (error) {
        console.error('Error fetching Signal users:', error);
        throw new Error('Failed to fetch Signal users');
      }
    }),

  // Get display name for a specific identifier
  getDisplayName: moderatorProcedure
    .input(
      z.object({
        identifier: z.string(),
        phoneNumber: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        // Set phone number from environment if not provided
        const phoneNumber = input.phoneNumber || process.env.SIGNAL_PHONE_NUMBER;
        if (!phoneNumber) {
          throw new Error('Signal phone number not configured');
        }

        enhancedSignalClient.setPhoneNumber(phoneNumber);
        // Ensure cache is populated
        await enhancedSignalClient.getUsersWithNames();
        
        const displayName = enhancedSignalClient.getDisplayName(input.identifier);
        return { displayName };
      } catch (error) {
        console.error('Error getting display name:', error);
        return { displayName: input.identifier }; // Fallback to original identifier
      }
    }),

  // Send message with recipient name resolution
  sendMessage: moderatorProcedure
    .input(
      z.object({
        recipients: z.array(z.string()),
        message: z.string(),
        phoneNumber: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Set phone number from environment if not provided
        const phoneNumber = input.phoneNumber || process.env.SIGNAL_PHONE_NUMBER;
        if (!phoneNumber) {
          throw new Error('Signal phone number not configured');
        }

        enhancedSignalClient.setPhoneNumber(phoneNumber);
        const success = await enhancedSignalClient.sendMessage(input.recipients, input.message);

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'signal_message',
            username: ctx.session.user.username || 'unknown',
            details: `Sent Signal message to ${input.recipients.length} recipient(s): ${success ? 'Success' : 'Failed'}`,
          },
        });

        // Log community timeline event
        if (success) {
          await logCommunityEvent({
            eventType: 'signal_message',
            username: ctx.session.user.username || 'unknown',
            details: `Sent Signal message to ${input.recipients.length} recipient(s)`,
            category: getCategoryForEventType('signal_message'),
          });
        }

        return { success };
      } catch (error) {
        console.error('Error sending Signal message:', error);
        throw new Error('Failed to send Signal message');
      }
    }),

  // Clear Signal cache
  clearCache: moderatorProcedure.mutation(async ({ ctx }) => {
    try {
      enhancedSignalClient.clearCache();

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'signal_cache_clear',
          username: ctx.session.user.username || 'unknown',
          details: 'Cleared Signal identity cache',
        },
      });

      return { success: true, message: 'Signal cache cleared successfully' };
    } catch (error) {
      console.error('Error clearing Signal cache:', error);
      throw new Error('Failed to clear Signal cache');
    }
  }),

  // Get Signal configuration status
  getConfig: moderatorProcedure.query(async () => {
    const baseUrl = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
    const phoneNumber = process.env.SIGNAL_PHONE_NUMBER;
    
    return {
      baseUrl,
      phoneNumber,
      isConfigured: !!phoneNumber,
    };
  }),

  // Native bot procedures (new approach)
  startNativeBot: moderatorProcedure.mutation(async ({ ctx }) => {
    try {
      const bot = getNativeBot();
      await bot.startListening();
      
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'signal_bot_start',
          username: ctx.session.user.username || 'unknown',
          details: 'Started native Signal CLI bot daemon',
        },
      });
      
      return { success: true, message: 'Native Signal bot started successfully' };
    } catch (error) {
      console.error('Error starting native bot:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to start native bot'
      });
    }
  }),

  stopNativeBot: moderatorProcedure.mutation(async ({ ctx }) => {
    try {
      const bot = getNativeBot();
      await bot.stopListening();
      
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'signal_bot_stop',
          username: ctx.session.user.username || 'unknown',
          details: 'Stopped native Signal CLI bot daemon',
        },
      });
      
      return { success: true, message: 'Native Signal bot stopped successfully' };
    } catch (error) {
      console.error('Error stopping native bot:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to stop native bot'
      });
    }
  }),

  getNativeBotHealth: moderatorProcedure.query(async () => {
    try {
      const bot = getNativeBot();
      return await bot.getHealth();
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }),

  registerNativeAccount: moderatorProcedure
    .input(z.object({
      phoneNumber: z.string(),
      captcha: z.string()
    }))
    .mutation(async ({ input }) => {
      try {
        const bot = getNativeBot();
        return await bot.registerAccount(input.captcha);
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Registration failed'
        });
      }
    }),

  verifyNativeAccount: moderatorProcedure
    .input(z.object({
      verificationCode: z.string()
    }))
    .mutation(async ({ input }) => {
      try {
        const bot = getNativeBot();
        return await bot.verifyAccount(input.verificationCode);
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Verification failed'
        });
      }
    }),

  getNativeGroups: moderatorProcedure.query(async () => {
    try {
      const bot = getNativeBot();
      return await bot.getGroups();
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to get groups'
      });
    }
  }),

  // Get health status (alias for getServiceStatus for backward compatibility)  
  getHealth: moderatorProcedure.query(async () => {
    const baseUrl = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
    const phoneNumber = process.env.SIGNAL_BOT_PHONE_NUMBER || process.env.SIGNAL_PHONE_NUMBER;
    
    if (!baseUrl || !phoneNumber) {
      return {
        status: 'unhealthy',
        containerStatus: 'unknown',
        registrationStatus: 'unregistered',
        apiResponseTime: null,
        messagesSentToday: undefined
      };
    }

    try {
      const startTime = Date.now();
      const response = await fetch(`${baseUrl}/v1/about`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      const apiResponseTime = Date.now() - startTime;

      if (response.ok) {
        // Check if phone number is registered
        const accountsResponse = await fetch(`${baseUrl}/v1/accounts`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });
        
        let registrationStatus = 'unregistered';
        if (accountsResponse.ok) {
          const accounts = await accountsResponse.json();
          const isRegistered = Array.isArray(accounts) && accounts.some((acc: any) => 
            acc.number === phoneNumber || acc === phoneNumber
          );
          registrationStatus = isRegistered ? 'registered' : 'unregistered';
        }

        return {
          status: 'healthy',
          containerStatus: 'running',
          registrationStatus,
          apiResponseTime,
          messagesSentToday: 0 // TODO: implement message counting
        };
      } else {
        return {
          status: 'unhealthy',
          containerStatus: 'error',
          registrationStatus: 'unknown',
          apiResponseTime,
          messagesSentToday: undefined
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        containerStatus: 'unreachable',
        registrationStatus: 'unknown',
        apiResponseTime: null,
        messagesSentToday: undefined
      };
    }
  }),

  // Get Signal CLI service health and registration status
  getServiceStatus: moderatorProcedure.query(async () => {
    const baseUrl = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
    const phoneNumber = process.env.SIGNAL_PHONE_NUMBER;
    
    if (!baseUrl || !phoneNumber) {
      return {
        isHealthy: false,
        isRegistered: false,
        error: 'Signal CLI not configured - missing base URL or phone number',
        configuration: { baseUrl, phoneNumber }
      };
    }

    try {
      // Check service health
      const healthResponse = await fetch(`${baseUrl}/v1/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });

      const isHealthy = healthResponse.status === 204 || healthResponse.status === 200;
      
      if (!isHealthy) {
        return {
          isHealthy: false,
          isRegistered: false,
          error: `Signal CLI service unhealthy (HTTP ${healthResponse.status})`,
          configuration: { baseUrl, phoneNumber }
        };
      }

      // Check if phone number is registered
      let isRegistered = false;
      let registrationError = null;

      try {
        const accountsResponse = await fetch(`${baseUrl}/v1/accounts`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(5000)
        });

        if (accountsResponse.ok) {
          const accounts = await accountsResponse.json();
          isRegistered = Array.isArray(accounts) && accounts.includes(phoneNumber);
          
          if (!isRegistered) {
            registrationError = `Phone number ${phoneNumber} is not registered with Signal CLI`;
          }
        } else {
          registrationError = `Failed to check account registration (HTTP ${accountsResponse.status})`;
        }
      } catch (regError) {
        registrationError = `Failed to check registration: ${regError instanceof Error ? regError.message : 'Unknown error'}`;
      }

      // Try to get account info for more details if registered
      let accountInfo = null;
      if (isRegistered) {
        try {
          const accountResponse = await fetch(`${baseUrl}/v1/accounts/${encodeURIComponent(phoneNumber)}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(5000)
          });
          
          if (accountResponse.ok) {
            accountInfo = await accountResponse.json();
          }
        } catch (error) {
          // Non-critical error, continue without account info
          console.warn('Could not fetch account info:', error instanceof Error ? error.message : 'Unknown error');
        }
      }

      return {
        isHealthy,
        isRegistered,
        error: registrationError,
        configuration: { baseUrl, phoneNumber },
        accountInfo,
        lastChecked: new Date().toISOString()
      };

    } catch (error) {
      return {
        isHealthy: false,
        isRegistered: false,
        error: `Signal CLI service unavailable: ${error instanceof Error ? error.message : 'Unknown error'}`,
        configuration: { baseUrl, phoneNumber }
      };
    }
  }),

  // Get account information
  getAccountInfo: moderatorProcedure.query(async () => {
    const baseUrl = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
    const phoneNumber = process.env.SIGNAL_BOT_PHONE_NUMBER || process.env.SIGNAL_PHONE_NUMBER;
    
    if (!baseUrl || !phoneNumber) {
      return null;
    }

    try {
      // Check accounts endpoint
      const accountsResponse = await fetch(`${baseUrl}/v1/accounts`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });

      if (accountsResponse.ok) {
        const accounts = await accountsResponse.json();
        const account = Array.isArray(accounts) ? accounts.find((acc: any) => 
          acc.number === phoneNumber || acc === phoneNumber
        ) : null;
        
        if (account || (Array.isArray(accounts) && accounts.includes(phoneNumber))) {
          return {
            phoneNumber: phoneNumber,
            uuid: account?.uuid || null,
            deviceId: account?.deviceId || null,
            registrationTime: account?.registrationTime || null,
            displayName: 'Community Dashboard Bot' // Default name
          };
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error getting account info:', error);
      return null;
    }
  }),

  // Register a phone number with Signal CLI
  registerPhoneNumber: moderatorProcedure
    .input(z.object({
      phoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, 'Invalid phone number format. Must include country code (e.g., +1234567890)'),
      voiceVerification: z.boolean().default(false),
      captcha: z.string().optional()
    }))
    .mutation(async ({ input }) => {
      const baseUrl = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
      
      try {
        // Step 1: Register the phone number
        const registerUrl = `${baseUrl}/v1/register/${encodeURIComponent(input.phoneNumber)}`;
        const registerBody: any = {
          voice: input.voiceVerification
        };
        
        if (input.captcha) {
          registerBody.captcha = input.captcha;
        }
        
        const registerResponse = await fetch(registerUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(registerBody),
          signal: AbortSignal.timeout(30000)
        });
        
        if (!registerResponse.ok) {
          const errorText = await registerResponse.text();
          let errorData;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { error: errorText };
          }
          
          // Provide helpful error messages for common issues
          if (errorData.error?.includes('Invalid captcha given')) {
            throw new Error('Invalid or expired captcha token. Please get a fresh captcha from https://signalcaptchas.org/registration/generate.html');
          } else if (errorData.error?.includes('Captcha required')) {
            throw new Error('Captcha is required for registration. Please get one from https://signalcaptchas.org/registration/generate.html');
          } else {
            throw new Error(`Registration failed: ${errorData.error || `HTTP ${registerResponse.status}`}`);
          }
        }
        
        return {
          success: true,
          message: `Verification code sent to ${input.phoneNumber} via ${input.voiceVerification ? 'voice call' : 'SMS'}`,
          phoneNumber: input.phoneNumber,
          requiresVerification: true
        };
      } catch (error) {
        console.error('Error registering phone number:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to register phone number'
        });
      }
    }),
  
  // Verify the registration with the SMS/voice code
  verifyRegistration: moderatorProcedure
    .input(z.object({
      phoneNumber: z.string(),
      verificationCode: z.string().regex(/^\d{6}$/, 'Verification code must be 6 digits'),
      pin: z.string().optional()
    }))
    .mutation(async ({ input }) => {
      const baseUrl = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
      
      try {
        // Step 2: Verify with the code
        const verifyUrl = `${baseUrl}/v1/register/${encodeURIComponent(input.phoneNumber)}/verify/${input.verificationCode}`;
        const verifyBody: any = {};
        
        if (input.pin) {
          verifyBody.pin = input.pin;
        }
        
        const verifyResponse = await fetch(verifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(verifyBody),
          signal: AbortSignal.timeout(30000)
        });
        
        if (!verifyResponse.ok) {
          const errorText = await verifyResponse.text();
          throw new Error(`Verification failed: ${errorText || `HTTP ${verifyResponse.status}`}`);
        }
        
        // Update environment variable
        process.env.SIGNAL_PHONE_NUMBER = input.phoneNumber;
        
        return {
          success: true,
          message: `Successfully registered ${input.phoneNumber} with Signal CLI`,
          phoneNumber: input.phoneNumber
        };
      } catch (error) {
        console.error('Error verifying registration:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to verify registration'
        });
      }
    }),
  
  // Unregister a phone number
  unregisterPhoneNumber: moderatorProcedure
    .input(z.object({
      phoneNumber: z.string(),
      deleteLocalData: z.boolean().default(false)
    }))
    .mutation(async ({ input }) => {
      const baseUrl = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
      
      try {
        const unregisterUrl = `${baseUrl}/v1/accounts/${encodeURIComponent(input.phoneNumber)}`;
        const unregisterResponse = await fetch(unregisterUrl, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deleteLocalData: input.deleteLocalData }),
          signal: AbortSignal.timeout(30000)
        });
        
        if (!unregisterResponse.ok && unregisterResponse.status !== 404) {
          const errorText = await unregisterResponse.text();
          throw new Error(`Failed to unregister: ${errorText || `HTTP ${unregisterResponse.status}`}`);
        }
        
        return {
          success: true,
          message: `Successfully unregistered ${input.phoneNumber}`
        };
      } catch (error) {
        console.error('Error unregistering phone number:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to unregister phone number'
        });
      }
    }),

  // Phase 2: Group Join Management APIs

  // Get pending join requests for moderation
  getPendingJoinRequests: moderatorProcedure
    .input(z.object({
      page: z.number().default(1),
      limit: z.number().default(25),
      groupId: z.string().optional()
    }))
    .query(async ({ ctx, input }) => {
      try {
        const { page, limit, groupId } = input;
        const skip = (page - 1) * limit;

        const where = {
          status: 'pending' as const,
          ...(groupId && { groupId })
        };

        const [requests, total] = await Promise.all([
          ctx.prisma.signalGroupJoinRequest.findMany({
            where,
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  attributes: true
                }
              }
            },
            orderBy: { requestedAt: 'desc' },
            skip,
            take: limit
          }),
          ctx.prisma.signalGroupJoinRequest.count({ where })
        ]);

        // Get group information
        const groupIds = [...new Set(requests.map(r => r.groupId))];
        const groups = await ctx.prisma.signalAvailableGroup.findMany({
          where: { groupId: { in: groupIds } },
          select: { groupId: true, groupName: true, description: true }
        });
        const groupMap = new Map(groups.map(g => [g.groupId, g]));

        // Enhance requests with group info and user phone numbers
        const enhancedRequests = requests.map(request => {
          const group = groupMap.get(request.groupId);
          const phoneNumber = request.user.attributes && typeof request.user.attributes === 'object'
            ? (request.user.attributes as any).phone_number
            : null;

          return {
            id: request.id,
            groupId: request.groupId,
            groupName: group?.groupName || 'Unknown Group',
            groupDescription: group?.description,
            message: request.message,
            requestedAt: request.requestedAt,
            user: {
              id: request.user.id,
              username: request.user.username,
              displayName: `${request.user.firstName || ''} ${request.user.lastName || ''}`.trim() || request.user.username,
              email: request.user.email,
              phoneNumber
            }
          };
        });

        return {
          requests: enhancedRequests,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        };
      } catch (error) {
        console.error('Error getting pending join requests:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get pending join requests'
        });
      }
    }),

  // Approve a join request and add user to group
  approveJoinRequest: moderatorProcedure
    .input(z.object({
      requestId: z.number(),
      notify: z.boolean().default(true)
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        // Get the join request
        const joinRequest = await ctx.prisma.signalGroupJoinRequest.findUnique({
          where: { id: input.requestId },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                attributes: true
              }
            }
          }
        });

        if (!joinRequest) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Join request not found'
          });
        }

        if (joinRequest.status !== 'pending') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This request has already been processed'
          });
        }

        // Get group information
        const group = await ctx.prisma.signalAvailableGroup.findUnique({
          where: { groupId: joinRequest.groupId }
        });

        if (!group) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Group not found'
          });
        }

        // Start transaction
        await ctx.prisma.$transaction(async (prisma) => {
          // Update the join request
          await prisma.signalGroupJoinRequest.update({
            where: { id: input.requestId },
            data: {
              status: 'approved',
              processedAt: new Date(),
              processedBy: parseInt(ctx.session.user.id)
            }
          });

          // Create or update group membership
          await prisma.signalGroupMembership.upsert({
            where: {
              userId_groupId: {
                userId: joinRequest.userId,
                groupId: joinRequest.groupId
              }
            },
            update: {
              status: 'active',
              joinedAt: new Date(),
              groupName: group.groupName
            },
            create: {
              userId: joinRequest.userId,
              groupId: joinRequest.groupId,
              groupName: group.groupName,
              status: 'active'
            }
          });
        });

        // TODO: Add user to actual Signal group via Signal CLI API
        // This would require implementing the Signal CLI group management functionality

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'signal_group_join_approved',
            username: ctx.session.user.username || 'unknown',
            details: `Approved join request for ${joinRequest.user.username} to join ${group.groupName}`,
          },
        });

        return {
          success: true,
          message: `Successfully approved join request for ${group.groupName}`
        };

      } catch (error) {
        console.error('Error approving join request:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to approve join request'
        });
      }
    }),

  // Deny a join request
  denyJoinRequest: moderatorProcedure
    .input(z.object({
      requestId: z.number(),
      reason: z.string().max(500).optional()
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        // Get the join request
        const joinRequest = await ctx.prisma.signalGroupJoinRequest.findUnique({
          where: { id: input.requestId },
          include: {
            user: {
              select: {
                username: true
              }
            }
          }
        });

        if (!joinRequest) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Join request not found'
          });
        }

        if (joinRequest.status !== 'pending') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This request has already been processed'
          });
        }

        // Update the join request
        await ctx.prisma.signalGroupJoinRequest.update({
          where: { id: input.requestId },
          data: {
            status: 'denied',
            processedAt: new Date(),
            processedBy: parseInt(ctx.session.user.id)
          }
        });

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'signal_group_join_denied',
            username: ctx.session.user.username || 'unknown',
            details: `Denied join request for ${joinRequest.user.username}${input.reason ? ` - Reason: ${input.reason}` : ''}`,
          },
        });

        return {
          success: true,
          message: 'Join request denied successfully'
        };

      } catch (error) {
        console.error('Error denying join request:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to deny join request'
        });
      }
    }),

  // ============================================================================
  // Phase 1: Signal Group Discovery & Status APIs (v0.4.0)
  // ============================================================================

  // Get user's current Signal status and memberships
  getMySignalStatus: protectedProcedure.query(async ({ ctx }) => {
    try {
      const userId = parseInt(ctx.session.user.id);
      
      // Get user's Signal verification status
      const signalIdentity = ctx.session.user.signalIdentity;
      const phoneNumber = ctx.session.user.attributes && typeof ctx.session.user.attributes === 'object'
        ? (ctx.session.user.attributes as any).phone_number
        : null;

      // Get user's current group memberships
      const memberships = await ctx.prisma.signalGroupMembership.findMany({
        where: { 
          userId,
          status: 'active'
        },
        include: {
          group: true // This will include SignalGroup data if it exists
        },
        orderBy: { joinedAt: 'desc' }
      });

      // Get verified Signal groups from the cache (for enhanced names)
      const groupIds = memberships.map(m => m.groupId);
      const cachedGroups = await ctx.prisma.signalGroup.findMany({
        where: { id: { in: groupIds } }
      });
      const groupMap = new Map(cachedGroups.map(g => [g.id, g]));

      // Enhance memberships with cached group data
      const enhancedMemberships = memberships.map(membership => {
        const cachedGroup = groupMap.get(membership.groupId);
        return {
          id: membership.id,
          groupId: membership.groupId,
          groupName: cachedGroup?.name || membership.groupName || 'Unknown Group',
          description: cachedGroup?.description,
          memberCount: cachedGroup?.memberCount,
          joinedAt: membership.joinedAt,
          status: membership.status
        };
      });

      return {
        isSignalVerified: !!signalIdentity,
        signalIdentity,
        phoneNumber,
        groupMemberships: enhancedMemberships,
        totalGroups: enhancedMemberships.length
      };
    } catch (error) {
      console.error('Error getting Signal status:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get Signal status'
      });
    }
  }),

  // Get available Signal groups user can join
  getAvailableSignalGroups: protectedProcedure
    .input(z.object({
      page: z.number().default(1),
      limit: z.number().min(1).max(50).default(25),
      search: z.string().optional()
    }))
    .query(async ({ ctx, input }) => {
      try {
        const userId = parseInt(ctx.session.user.id);
        const { page, limit, search } = input;
        const skip = (page - 1) * limit;

        // Get groups user is NOT already a member of
        const existingMembershipGroupIds = await ctx.prisma.signalGroupMembership.findMany({
          where: { 
            userId,
            status: 'active'
          },
          select: { groupId: true }
        }).then(memberships => memberships.map(m => m.groupId));

        // Build where clause
        const where = {
          isActive: true,
          isPublic: true, // Only show public groups users can join
          ...(existingMembershipGroupIds.length > 0 && {
            groupId: { notIn: existingMembershipGroupIds }
          }),
          ...(search && {
            OR: [
              { groupName: { contains: search, mode: 'insensitive' as const } },
              { description: { contains: search, mode: 'insensitive' as const } }
            ]
          })
        };

        // Get available groups with pagination
        const [groups, total] = await Promise.all([
          ctx.prisma.signalAvailableGroup.findMany({
            where,
            orderBy: [
              { memberCount: 'desc' }, // Show groups with more members first
              { groupName: 'asc' }
            ],
            skip,
            take: limit
          }),
          ctx.prisma.signalAvailableGroup.count({ where })
        ]);

        // Enhance with cached group data for more accurate member counts
        const groupIds = groups.map(g => g.groupId);
        const cachedGroups = await ctx.prisma.signalGroup.findMany({
          where: { id: { in: groupIds } }
        });
        const cachedGroupMap = new Map(cachedGroups.map(g => [g.id, g]));

        const enhancedGroups = groups.map(group => {
          const cachedGroup = cachedGroupMap.get(group.groupId);
          return {
            groupId: group.groupId,
            groupName: cachedGroup?.name || group.groupName,
            description: cachedGroup?.description || group.description,
            memberCount: cachedGroup?.memberCount || group.memberCount || 0,
            isPublic: group.isPublic,
            requiresApproval: group.requiresApproval,
            tags: group.tags || [],
            lastUpdated: cachedGroup?.lastUpdated || group.updatedAt
          };
        });

        return {
          groups: enhancedGroups,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        };
      } catch (error) {
        console.error('Error getting available Signal groups:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to get available Signal groups'
        });
      }
    }),

  // Check specific Signal group membership status
  checkSignalMembership: protectedProcedure
    .input(z.object({
      groupId: z.string()
    }))
    .query(async ({ ctx, input }) => {
      try {
        const userId = parseInt(ctx.session.user.id);
        
        // Check if user is already a member
        const membership = await ctx.prisma.signalGroupMembership.findUnique({
          where: {
            userId_groupId: {
              userId,
              groupId: input.groupId
            }
          }
        });

        // Check if user has a pending join request
        const pendingRequest = await ctx.prisma.signalGroupJoinRequest.findFirst({
          where: {
            userId,
            groupId: input.groupId,
            status: 'pending'
          }
        });

        // Get group information
        const group = await ctx.prisma.signalAvailableGroup.findUnique({
          where: { groupId: input.groupId }
        });

        // Get cached group data for more accurate info
        const cachedGroup = await ctx.prisma.signalGroup.findUnique({
          where: { id: input.groupId }
        });

        return {
          isMember: !!membership && membership.status === 'active',
          membershipStatus: membership?.status || null,
          joinedAt: membership?.joinedAt || null,
          hasPendingRequest: !!pendingRequest,
          pendingRequestId: pendingRequest?.id || null,
          group: group ? {
            groupId: group.groupId,
            groupName: cachedGroup?.name || group.groupName,
            description: cachedGroup?.description || group.description,
            memberCount: cachedGroup?.memberCount || group.memberCount || 0,
            isPublic: group.isPublic,
            requiresApproval: group.requiresApproval
          } : null
        };
      } catch (error) {
        console.error('Error checking Signal membership:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to check Signal membership'
        });
      }
    }),

  // Request to join a Signal group with automatic approval for authorized users
  requestSignalGroupJoin: protectedProcedure
    .input(z.object({
      groupId: z.string(),
      message: z.string().max(500).optional()
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = parseInt(ctx.session.user.id);
        
        // Check if user already has membership or pending request
        const [existingMembership, existingRequest] = await Promise.all([
          ctx.prisma.signalGroupMembership.findUnique({
            where: {
              userId_groupId: {
                userId,
                groupId: input.groupId
              }
            }
          }),
          ctx.prisma.signalGroupJoinRequest.findFirst({
            where: {
              userId,
              groupId: input.groupId,
              status: 'pending'
            }
          })
        ]);

        if (existingMembership?.status === 'active') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'You are already a member of this group'
          });
        }

        if (existingRequest) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'You already have a pending request for this group'
          });
        }

        // Get group information
        const group = await ctx.prisma.signalAvailableGroup.findUnique({
          where: { groupId: input.groupId }
        });

        if (!group) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Group not found'
          });
        }

        if (!group.isActive) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'This group is not currently accepting new members'
          });
        }

        // Check if user is authorized (has existing group memberships = authorized)
        const existingMemberships = await ctx.prisma.signalGroupMembership.findMany({
          where: { 
            userId,
            status: 'active'
          }
        });

        const isAuthorizedUser = existingMemberships.length > 0; // All current groups are authorized

        if (isAuthorizedUser) {
          // Auto-approve and add user directly to the group
          const result = await ctx.prisma.$transaction(async (prisma) => {
            // Create approved join request record
            const joinRequest = await prisma.signalGroupJoinRequest.create({
              data: {
                userId,
                groupId: input.groupId,
                message: input.message,
                status: 'approved',
                processedAt: new Date()
              }
            });

            // Create group membership
            const membership = await prisma.signalGroupMembership.create({
              data: {
                userId,
                groupId: input.groupId,
                groupName: group.groupName,
                status: 'active'
              }
            });

            return { joinRequest, membership };
          });

          // Add user to actual Signal group via native bot
          let signalJoinSuccess = false;
          let signalError = null;
          try {
            const bot = getNativeBot();
            const userPhone = ctx.session.user.attributes && typeof ctx.session.user.attributes === 'object'
              ? (ctx.session.user.attributes as any).phone_number
              : null;

            if (userPhone) {
              // Add user to Signal group
              await bot.addUserToGroup(input.groupId, userPhone);
              signalJoinSuccess = true;
              console.log(`✅ Added user ${userPhone} to Signal group ${input.groupId}`);
            } else {
              signalError = 'No phone number found in user profile';
              console.warn(`⚠️ Cannot add user to Signal group - no phone number`);
            }
          } catch (error) {
            signalError = error instanceof Error ? error.message : 'Unknown Signal error';
            console.error('❌ Failed to add user to Signal group:', error);
          }

          // Log admin event
          await ctx.prisma.adminEvent.create({
            data: {
              eventType: 'signal_group_auto_join',
              username: ctx.session.user.username || 'unknown',
              details: `Auto-approved and joined ${group.groupName}${signalJoinSuccess ? '' : ` (Signal add failed: ${signalError})`}`,
            },
          });

          return {
            success: true,
            autoApproved: true,
            joined: signalJoinSuccess,
            requestId: result.joinRequest.id,
            membershipId: result.membership.id,
            message: signalJoinSuccess 
              ? `Successfully joined ${group.groupName}!` 
              : `Approved for ${group.groupName}, but Signal group add failed. Contact admin.`,
            signalError
          };

        } else {
          // Create pending join request for manual approval
          const joinRequest = await ctx.prisma.signalGroupJoinRequest.create({
            data: {
              userId,
              groupId: input.groupId,
              message: input.message,
              status: 'pending'
            }
          });

          return {
            success: true,
            autoApproved: false,
            joined: false,
            requestId: joinRequest.id,
            message: group.requiresApproval 
              ? 'Join request submitted for admin approval'
              : 'Join request submitted'
          };
        }

      } catch (error) {
        console.error('Error requesting group join:', error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to submit join request'
        });
      }
    }),
});