/**
 * Signal CLI tRPC Router
 * Handles Signal CLI operations including registration, verification, and messaging
 */

import { z } from 'zod';
import { createTRPCRouter, publicProcedure, adminProcedure } from '../trpc';
import { SignalBotService } from '@/lib/signal/signal-bot-service';
import { normalizePhoneNumber } from '@/lib/phone-utils';
import { TRPCError } from '@trpc/server';

export const signalRouter = createTRPCRouter({
  /**
   * Get Signal CLI service health status
   */
  getHealth: publicProcedure
    .query(async () => {
      try {
        const signalBot = new SignalBotService();
        
        if (!signalBot.isConfigured()) {
          return {
            status: 'disabled',
            message: 'Signal CLI is not enabled or configured',
            healthy: false,
          };
        }

        const health = await signalBot.checkServiceHealth();
        
        return {
          status: health.containerStatus === 'running' ? 'healthy' : 'unhealthy',
          containerStatus: health.containerStatus,
          registrationStatus: health.registrationStatus,
          apiResponseTime: health.apiResponseTime,
          messagesSentToday: health.messagesSentToday,
          lastMessageSent: health.lastMessageSent,
          healthy: health.containerStatus === 'running',
        };
      } catch (error) {
        return {
          status: 'error',
          message: error instanceof Error ? error.message : 'Health check failed',
          healthy: false,
        };
      }
    }),

  /**
   * Get Signal CLI configuration (admin only)
   */
  getConfig: adminProcedure
    .query(async () => {
      try {
        const signalBot = new SignalBotService();
        const config = signalBot.getConfig();
        
        // Don't expose sensitive information
        return {
          enabled: config.enabled,
          apiUrl: config.apiUrl,
          hasPhoneNumber: !!config.phoneNumber,
          phoneNumber: config.phoneNumber ? 
            config.phoneNumber.replace(/(\+\d{1,3})\d+(\d{4})/, '$1***$2') : '',
          timeout: config.timeout,
          deviceName: config.deviceName,
        };
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get Signal CLI config',
        });
      }
    }),

  /**
   * Register a phone number with Signal (admin only)
   */
  registerPhoneNumber: adminProcedure
    .input(z.object({
      phoneNumber: z.string().min(10),
      useVoice: z.boolean().default(false),
      captcha: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const signalBot = new SignalBotService();
        
        if (!signalBot.isConfigured()) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Signal CLI is not enabled or configured',
          });
        }

        const normalizedPhone = normalizePhoneNumber(input.phoneNumber);
        if (!normalizedPhone.isValid) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: normalizedPhone.error || 'Invalid phone number format',
          });
        }

        await signalBot.registerPhoneNumber(
          normalizedPhone.normalized,
          input.useVoice,
          input.captcha
        );

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'signal_registration_initiated',
            username: ctx.session.user.username || 'unknown',
            details: `Initiated Signal registration for phone ${normalizedPhone.normalized}`,
          },
        });

        return {
          success: true,
          message: `Registration request sent to ${normalizedPhone.normalized}`,
          phoneNumber: normalizedPhone.normalized,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Registration failed',
        });
      }
    }),

  /**
   * Verify phone number registration (admin only)
   */
  verifyRegistration: adminProcedure
    .input(z.object({
      phoneNumber: z.string().min(10),
      verificationCode: z.string().length(6),
      pin: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const signalBot = new SignalBotService();
        
        if (!signalBot.isConfigured()) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Signal CLI is not enabled or configured',
          });
        }

        const normalizedPhone = normalizePhoneNumber(input.phoneNumber);
        if (!normalizedPhone.isValid) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: normalizedPhone.error || 'Invalid phone number format',
          });
        }

        await signalBot.verifyRegistration(
          normalizedPhone.normalized,
          input.verificationCode,
          input.pin
        );

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'signal_registration_verified',
            username: ctx.session.user.username || 'unknown',
            details: `Verified Signal registration for phone ${normalizedPhone.normalized}`,
          },
        });

        return {
          success: true,
          message: `Phone number ${normalizedPhone.normalized} verified successfully`,
          phoneNumber: normalizedPhone.normalized,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Verification failed',
        });
      }
    }),

  /**
   * Send a Signal message (admin only)
   */
  sendMessage: adminProcedure
    .input(z.object({
      recipients: z.array(z.string()).min(1),
      message: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const signalBot = new SignalBotService();
        
        if (!signalBot.isConfigured()) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Signal CLI is not enabled or configured',
          });
        }

        // Check if phone number is actually registered with Signal
        if (!signalBot.config.phoneNumber) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'No phone number configured for sending messages',
          });
        }

        // Check registration status with Signal API
        const isRegistered = await signalBot.apiClient.isRegistered(signalBot.config.phoneNumber);
        if (!isRegistered) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `Phone number ${signalBot.config.phoneNumber} is not registered with Signal. Please complete registration first.`,
          });
        }

        // Validate all phone numbers
        const normalizedRecipients: string[] = [];
        for (const recipient of input.recipients) {
          const normalized = normalizePhoneNumber(recipient);
          if (!normalized.isValid) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: `Invalid recipient phone number: ${recipient}`,
            });
          }
          normalizedRecipients.push(normalized.normalized);
        }

        let result;
        if (normalizedRecipients.length === 1) {
          result = await signalBot.sendMessage(normalizedRecipients[0], input.message);
        } else {
          result = await signalBot.sendMessageToMultiple(normalizedRecipients, input.message);
        }

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'signal_message_sent',
            username: ctx.session.user.username || 'unknown',
            details: `Sent Signal message to ${normalizedRecipients.length} recipient(s)`,
          },
        });

        return {
          success: result.success,
          messageId: result.messageId,
          timestamp: result.timestamp,
          recipients: normalizedRecipients,
          message: `Message sent to ${normalizedRecipients.length} recipient(s)`,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to send message',
        });
      }
    }),

  /**
   * Send verification code to a user's phone number
   */
  sendVerificationCode: publicProcedure
    .input(z.object({
      phoneNumber: z.string().min(10),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const signalBot = new SignalBotService();
        
        if (!signalBot.isConfigured()) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Signal CLI is not enabled or configured',
          });
        }

        if (!signalBot.isRegistered()) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Signal CLI bot is not registered',
          });
        }

        const normalizedPhone = normalizePhoneNumber(input.phoneNumber);
        if (!normalizedPhone.isValid) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: normalizedPhone.error || 'Invalid phone number format',
          });
        }

        // Generate a 6-digit verification code
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Store verification code in database
        await ctx.prisma.signalVerification.create({
          data: {
            phoneNumber: normalizedPhone.normalized,
            code: verificationCode,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
          },
        });

        // Send verification code via Signal
        const message = `Your verification code is: ${verificationCode}\n\nThis code will expire in 10 minutes.`;
        await signalBot.sendMessage(normalizedPhone.normalized, message);

        return {
          success: true,
          message: `Verification code sent to ${normalizedPhone.normalized}`,
          phoneNumber: normalizedPhone.normalized,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to send verification code',
        });
      }
    }),

  /**
   * Verify a user's phone number with verification code
   */
  verifyPhoneNumber: publicProcedure
    .input(z.object({
      phoneNumber: z.string().min(10),
      verificationCode: z.string().length(6),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const normalizedPhone = normalizePhoneNumber(input.phoneNumber);
        if (!normalizedPhone.isValid) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: normalizedPhone.error || 'Invalid phone number format',
          });
        }

        // Find the verification record
        const verification = await ctx.prisma.signalVerification.findFirst({
          where: {
            phoneNumber: normalizedPhone.normalized,
            code: input.verificationCode,
            expiresAt: {
              gt: new Date(),
            },
            verifiedAt: null,
          },
        });

        if (!verification) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Invalid or expired verification code',
          });
        }

        // Mark as verified
        await ctx.prisma.signalVerification.update({
          where: { id: verification.id },
          data: { verifiedAt: new Date() },
        });

        return {
          success: true,
          message: `Phone number ${normalizedPhone.normalized} verified successfully`,
          phoneNumber: normalizedPhone.normalized,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Verification failed',
        });
      }
    }),

  /**
   * Get account information (admin only)
   */
  getAccountInfo: adminProcedure
    .query(async () => {
      try {
        const signalBot = new SignalBotService();
        
        if (!signalBot.isConfigured()) {
          return null;
        }

        const account = await signalBot.getAccountInfo();
        return account;
      } catch (error) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get account info',
        });
      }
    }),

  /**
   * Generate QR code for device linking (admin only)
   */
  generateQRCode: adminProcedure
    .mutation(async () => {
      try {
        const signalBot = new SignalBotService();
        
        if (!signalBot.isConfigured()) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Signal CLI is not enabled or configured',
          });
        }

        const qrCode = await signalBot.generateQRCode();
        
        if (!qrCode) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to generate QR code',
          });
        }

        return {
          success: true,
          qrCode,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to generate QR code',
        });
      }
    }),

  /**
   * Update profile information (admin only)
   */
  updateProfile: adminProcedure
    .input(z.object({
      displayName: z.string().min(1).max(100).optional(),
      avatarBase64: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const signalBot = new SignalBotService();
        
        if (!signalBot.isConfigured()) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Signal CLI is not enabled or configured',
          });
        }

        const phoneNumber = signalBot.config.phoneNumber;
        if (!phoneNumber) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'No phone number configured',
          });
        }

        const result = await signalBot.apiClient.updateProfile(
          phoneNumber,
          input.displayName,
          input.avatarBase64
        );

        if (!result.success) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: result.error || 'Failed to update profile',
          });
        }

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'signal_profile_updated',
            username: ctx.session.user.username || 'unknown',
            details: `Updated Signal profile${input.displayName ? ` - Name: ${input.displayName}` : ''}${input.avatarBase64 ? ' - Avatar updated' : ''}`,
          },
        });

        return {
          success: true,
          message: 'Profile updated successfully',
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to update profile',
        });
      }
    }),

  /**
   * Get conversation messages (admin only)
   */
  getConversation: adminProcedure
    .input(z.object({
      recipient: z.string().min(1),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input, ctx }) => {
      try {
        const signalBot = new SignalBotService();
        
        if (!signalBot.isConfigured()) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Signal CLI is not enabled or configured',
          });
        }

        const phoneNumber = signalBot.config.phoneNumber;
        if (!phoneNumber) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'No phone number configured',
          });
        }

        // Get received messages
        const messagesResult = await signalBot.apiClient.getMessages(phoneNumber);
        
        if (!messagesResult.success) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: messagesResult.error || 'Failed to get messages',
          });
        }

        // Filter messages for specific conversation
        const conversationMessages = messagesResult.data
          ?.filter(msg => {
            const source = msg.envelope?.source || msg.envelope?.sourceNumber;
            return source === input.recipient || source === normalizePhoneNumber(input.recipient).normalized;
          })
          .slice(0, input.limit)
          .map(msg => ({
            id: msg.envelope?.timestamp?.toString() || Date.now().toString(),
            sender: msg.envelope?.source || msg.envelope?.sourceNumber,
            recipient: phoneNumber,
            message: msg.envelope?.dataMessage?.message || '',
            timestamp: new Date(msg.envelope?.timestamp || Date.now()),
            isDelivered: msg.envelope?.receiptMessage?.isDelivery || false,
            isRead: msg.envelope?.receiptMessage?.isRead || false,
            direction: 'incoming' as const,
          })) || [];

        return {
          success: true,
          messages: conversationMessages,
          recipient: input.recipient,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to get conversation',
        });
      }
    }),

  /**
   * Send message with username support (admin only)
   */
  sendMessageAdvanced: adminProcedure
    .input(z.object({
      recipient: z.string().min(1), // Can be phone number or username
      message: z.string().min(1),
      isUsername: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const signalBot = new SignalBotService();
        
        if (!signalBot.isConfigured()) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'Signal CLI is not enabled or configured',
          });
        }

        let recipientIdentifier = input.recipient;
        
        // Handle username format (ensure it starts with @)
        if (input.isUsername && !recipientIdentifier.startsWith('@')) {
          recipientIdentifier = `@${recipientIdentifier}`;
        }
        
        // If not username, normalize phone number
        if (!input.isUsername) {
          const normalized = normalizePhoneNumber(recipientIdentifier);
          if (!normalized.isValid) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: normalized.error || 'Invalid phone number format',
            });
          }
          recipientIdentifier = normalized.normalized;
        }

        const result = await signalBot.sendMessage(recipientIdentifier, input.message);

        // Log admin event
        await ctx.prisma.adminEvent.create({
          data: {
            eventType: 'signal_message_sent_advanced',
            username: ctx.session.user.username || 'unknown',
            details: `Sent Signal message to ${recipientIdentifier}${input.isUsername ? ' (username)' : ''}`,
          },
        });

        return {
          success: result.success,
          messageId: result.messageId,
          timestamp: result.timestamp,
          recipient: recipientIdentifier,
          message: `Message sent to ${recipientIdentifier}`,
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : 'Failed to send message',
        });
      }
    }),
});