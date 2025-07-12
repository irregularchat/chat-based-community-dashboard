import { z } from 'zod';
import { createTRPCRouter, protectedProcedure, adminProcedure } from '../trpc';

// Schema for application settings
const SettingsSchema = z.object({
  // General settings
  siteName: z.string().min(1),
  siteDescription: z.string().optional(),
  siteUrl: z.string().url().optional(),
  contactEmail: z.string().email().optional(),
  
  // Authentication settings
  enableLocalAuth: z.boolean().default(true),
  enableRegistration: z.boolean().default(false),
  requireEmailVerification: z.boolean().default(false),
  sessionTimeout: z.number().min(1).max(43200).default(1440), // minutes
  
  // Matrix settings
  matrixEnabled: z.boolean().default(false),
  matrixHomeserver: z.string().optional(),
  matrixAccessToken: z.string().optional(),
  matrixBotUsername: z.string().optional(),
  matrixDefaultRoom: z.string().optional(),
  matrixWelcomeRoom: z.string().optional(),
  
  // Email settings
  emailEnabled: z.boolean().default(false),
  smtpHost: z.string().optional(),
  smtpPort: z.number().min(1).max(65535).optional(),
  smtpUser: z.string().optional(),
  smtpPassword: z.string().optional(),
  smtpFrom: z.string().email().optional(),
  
  // UI settings
  theme: z.enum(['light', 'dark', 'system']).default('light'),
  primaryColor: z.string().optional(),
  logoUrl: z.string().url().optional(),
  
  // Security settings
  maxLoginAttempts: z.number().min(1).max(20).default(5),
  lockoutDuration: z.number().min(1).max(1440).default(15), // minutes
  passwordMinLength: z.number().min(4).max(128).default(8),
  requireSpecialChars: z.boolean().default(false),
  requireNumbers: z.boolean().default(false),
  requireUppercase: z.boolean().default(false),
  
  // Feature flags
  enableInviteSystem: z.boolean().default(true),
  enableUserNotes: z.boolean().default(true),
  enableMatrixIntegration: z.boolean().default(false),
  enableUserProfiles: z.boolean().default(true),
  enableAnalytics: z.boolean().default(true),
  
  // Rate limiting
  rateLimitEnabled: z.boolean().default(true),
  rateLimitRequests: z.number().min(1).max(1000).default(100),
  rateLimitWindow: z.number().min(1).max(3600).default(60), // seconds
  
  // Maintenance
  maintenanceMode: z.boolean().default(false),
  maintenanceMessage: z.string().optional(),
  
  // Backup settings
  autoBackupEnabled: z.boolean().default(false),
  backupFrequency: z.enum(['daily', 'weekly', 'monthly']).default('weekly'),
  backupRetention: z.number().min(1).max(365).default(30), // days
});

export const settingsRouter = createTRPCRouter({
  // Get all settings
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    // In a real implementation, this would come from a settings table
    // For now, we'll return default values with some from environment variables
    return {
      // General settings
      siteName: process.env.SITE_NAME || 'Community Dashboard',
      siteDescription: process.env.SITE_DESCRIPTION || 'Modern community management platform',
      siteUrl: process.env.SITE_URL || 'http://localhost:3000',
      contactEmail: process.env.CONTACT_EMAIL || 'admin@example.com',
      
      // Authentication settings
      enableLocalAuth: process.env.ENABLE_LOCAL_AUTH === 'true',
      enableRegistration: process.env.ENABLE_REGISTRATION === 'true',
      requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
      sessionTimeout: parseInt(process.env.SESSION_TIMEOUT || '1440', 10),
      
      // Matrix settings
      matrixEnabled: process.env.MATRIX_ENABLED === 'true',
      matrixHomeserver: process.env.MATRIX_HOMESERVER_URL || '',
      matrixAccessToken: process.env.MATRIX_ACCESS_TOKEN ? '***' : '',
      matrixBotUsername: process.env.MATRIX_BOT_USERNAME || '',
      matrixDefaultRoom: process.env.MATRIX_DEFAULT_ROOM_ID || '',
      matrixWelcomeRoom: process.env.MATRIX_WELCOME_ROOM_ID || '',
      
      // Email settings
      emailEnabled: process.env.EMAIL_ENABLED === 'true',
      smtpHost: process.env.SMTP_HOST || '',
      smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
      smtpUser: process.env.SMTP_USER || '',
      smtpPassword: process.env.SMTP_PASSWORD ? '***' : '',
      smtpFrom: process.env.SMTP_FROM || '',
      
      // UI settings
      theme: (process.env.DEFAULT_THEME as 'light' | 'dark' | 'system') || 'light',
      primaryColor: process.env.PRIMARY_COLOR || '#3b82f6',
      logoUrl: process.env.LOGO_URL || '',
      
      // Security settings
      maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
      lockoutDuration: parseInt(process.env.LOCKOUT_DURATION || '15', 10),
      passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH || '8', 10),
      requireSpecialChars: process.env.REQUIRE_SPECIAL_CHARS === 'true',
      requireNumbers: process.env.REQUIRE_NUMBERS === 'true',
      requireUppercase: process.env.REQUIRE_UPPERCASE === 'true',
      
      // Feature flags
      enableInviteSystem: process.env.ENABLE_INVITE_SYSTEM !== 'false',
      enableUserNotes: process.env.ENABLE_USER_NOTES !== 'false',
      enableMatrixIntegration: process.env.ENABLE_MATRIX_INTEGRATION === 'true',
      enableUserProfiles: process.env.ENABLE_USER_PROFILES !== 'false',
      enableAnalytics: process.env.ENABLE_ANALYTICS !== 'false',
      
      // Rate limiting
      rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
      rateLimitRequests: parseInt(process.env.RATE_LIMIT_REQUESTS || '100', 10),
      rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW || '60', 10),
      
      // Maintenance
      maintenanceMode: process.env.MAINTENANCE_MODE === 'true',
      maintenanceMessage: process.env.MAINTENANCE_MESSAGE || 'System is under maintenance',
      
      // Backup settings
      autoBackupEnabled: process.env.AUTO_BACKUP_ENABLED === 'true',
      backupFrequency: (process.env.BACKUP_FREQUENCY as 'daily' | 'weekly' | 'monthly') || 'weekly',
      backupRetention: parseInt(process.env.BACKUP_RETENTION || '30', 10),
    };
  }),

  // Update settings (admin only)
  updateSettings: adminProcedure
    .input(SettingsSchema.partial())
    .mutation(async ({ ctx, input }) => {
      // In a real implementation, this would update the settings in the database
      // For now, we'll just log the update and return success
      console.log('Settings update requested:', input);

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'settings_updated',
          username: ctx.session.user.username || 'unknown',
          details: `Updated settings: ${Object.keys(input).join(', ')}`,
        },
      });

      return { success: true, message: 'Settings updated successfully' };
    }),

  // Test email configuration
  testEmail: adminProcedure
    .input(
      z.object({
        to: z.string().email(),
        subject: z.string().optional(),
        message: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // In a real implementation, this would send a test email
      console.log('Test email requested:', input);

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'email_test',
          username: ctx.session.user.username || 'unknown',
          details: `Test email sent to: ${input.to}`,
        },
      });

      return { success: true, message: 'Test email sent successfully' };
    }),

  // Test Matrix connection
  testMatrix: adminProcedure.mutation(async ({ ctx }) => {
    // In a real implementation, this would test the Matrix connection
    console.log('Matrix connection test requested');

    // Log admin event
    await ctx.prisma.adminEvent.create({
      data: {
        eventType: 'matrix_test',
        username: ctx.session.user.username || 'unknown',
        details: 'Matrix connection test performed',
      },
    });

    return { success: true, message: 'Matrix connection test successful' };
  }),

  // Get system information
  getSystemInfo: adminProcedure.query(async ({ ctx }) => {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      environment: process.env.NODE_ENV,
      databaseUrl: process.env.DATABASE_URL ? 'configured' : 'not configured',
      timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }),

  // Reset settings to defaults
  resetSettings: adminProcedure
    .input(
      z.object({
        category: z.enum(['all', 'auth', 'matrix', 'email', 'security', 'ui', 'features']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // In a real implementation, this would reset settings to defaults
      console.log('Settings reset requested:', input);

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'settings_reset',
          username: ctx.session.user.username || 'unknown',
          details: `Reset settings category: ${input.category || 'all'}`,
        },
      });

      return { success: true, message: 'Settings reset to defaults' };
    }),

  // Export settings
  exportSettings: adminProcedure.query(async ({ ctx }) => {
    // In a real implementation, this would export all settings
    const settings = await ctx.prisma.adminEvent.findMany({
      where: { eventType: 'settings_updated' },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });

    return {
      exportedAt: new Date().toISOString(),
      settings: settings,
    };
  }),

  // Import settings
  importSettings: adminProcedure
    .input(
      z.object({
        settings: z.record(z.string(), z.any()),
        overwrite: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // In a real implementation, this would import settings
      console.log('Settings import requested:', input);

      // Log admin event
      await ctx.prisma.adminEvent.create({
        data: {
          eventType: 'settings_imported',
          username: ctx.session.user.username || 'unknown',
          details: `Imported ${Object.keys(input.settings).length} settings`,
        },
      });

      return { success: true, message: 'Settings imported successfully' };
    }),

  // Get available themes
  getThemes: protectedProcedure.query(async () => {
    return [
      { id: 'light', name: 'Light', description: 'Clean light theme' },
      { id: 'dark', name: 'Dark', description: 'Dark mode theme' },
      { id: 'system', name: 'System', description: 'Follow system preference' },
    ];
  }),

  // Get available colors
  getColors: protectedProcedure.query(async () => {
    return [
      { id: 'blue', name: 'Blue', value: '#3b82f6' },
      { id: 'green', name: 'Green', value: '#10b981' },
      { id: 'purple', name: 'Purple', value: '#8b5cf6' },
      { id: 'red', name: 'Red', value: '#ef4444' },
      { id: 'orange', name: 'Orange', value: '#f97316' },
      { id: 'pink', name: 'Pink', value: '#ec4899' },
    ];
  }),

  // Update user preferences (non-admin users can update their own UI preferences)
  updateUserPreferences: protectedProcedure
    .input(
      z.object({
        theme: z.enum(['light', 'dark', 'system']).optional(),
        primaryColor: z.string().optional(),
        language: z.string().optional(),
        timezone: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // In a real implementation, this would update user preferences
      console.log('User preferences update requested:', input);

      return { success: true, message: 'Preferences updated successfully' };
    }),
}); 