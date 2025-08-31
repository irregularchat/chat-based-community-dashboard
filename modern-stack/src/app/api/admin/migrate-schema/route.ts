import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, validateConfirmationToken, logSecurityEvent, isDangerousOperationsAllowed } from '@/lib/api-auth';

export async function POST(request: NextRequest) {
  try {
    // SECURITY: Require admin authentication
    const authResult = await requireAuth(request, 'admin');
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    
    // SECURITY: Check if dangerous operations are allowed in this environment
    if (!isDangerousOperationsAllowed()) {
      await logSecurityEvent(
        'dangerous_operation_blocked',
        authResult.user.id,
        'Schema migration blocked in production environment',
        'critical'
      );
      return NextResponse.json({
        success: false,
        error: 'Schema migrations not allowed in this environment'
      }, { status: 403 });
    }
    
    // SECURITY: Require confirmation token for database operations
    if (!validateConfirmationToken(request, 'MIGRATION_CONFIRMATION_TOKEN')) {
      await logSecurityEvent(
        'missing_confirmation_token',
        authResult.user.id,
        'Schema migration attempted without confirmation token',
        'critical'
      );
      return NextResponse.json({
        success: false,
        error: 'Confirmation token required for schema migration'
      }, { status: 403 });
    }
    
    // SECURITY: Log the migration attempt
    await logSecurityEvent(
      'schema_migration_started',
      authResult.user.id,
      'Database schema migration initiated',
      'critical'
    );
    
    console.log('SCHEMA MIGRATION: Starting database schema synchronization...');
    
    // Run the migration SQL to add missing columns
    console.log('Adding missing columns to community_bookmarks...');
    await prisma.$executeRaw`
      ALTER TABLE "community_bookmarks" ADD COLUMN IF NOT EXISTS "icon" TEXT;
    `;
    
    console.log('Adding missing columns to dashboard_announcements...');
    await prisma.$executeRaw`
      ALTER TABLE "dashboard_announcements" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'info';
    `;
    
    // Verify the schema is now correct by checking column existence
    console.log('Verifying schema synchronization...');
    
    const communityBookmarksColumns = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'community_bookmarks' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    
    const dashboardAnnouncementsColumns = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'dashboard_announcements' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    
    const dashboardSettingsColumns = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'dashboard_settings' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    
    // Test that Prisma queries now work without errors
    console.log('Testing Prisma queries...');
    
    try {
      // Test community bookmarks query
      await prisma.communityBookmark.findMany({ take: 1 });
      console.log('✅ CommunityBookmark queries working');
      
      // Test dashboard announcements query
      await prisma.dashboardAnnouncement.findMany({ take: 1 });
      console.log('✅ DashboardAnnouncement queries working');
      
      // Test dashboard settings query
      await prisma.dashboardSettings.findMany({ take: 1 });
      console.log('✅ DashboardSettings queries working');
      
    } catch (queryError) {
      console.error('❌ Prisma queries still failing:', queryError);
      return NextResponse.json({ 
        success: false, 
        error: 'Schema migration completed but Prisma queries still failing',
        queryError: queryError instanceof Error ? queryError.message : 'Unknown query error',
        schemas: {
          communityBookmarksColumns,
          dashboardAnnouncementsColumns,
          dashboardSettingsColumns
        }
      }, { status: 500 });
    }
    
    console.log('SCHEMA MIGRATION: Successfully completed!');
    
    // SECURITY: Log successful migration
    await logSecurityEvent(
      'schema_migration_completed',
      authResult.user.id,
      'Database schema migration completed successfully',
      'critical'
    );
    
    return NextResponse.json({ 
      success: true, 
      message: 'Database schema migration completed successfully',
      migratedTables: ['community_bookmarks', 'dashboard_announcements'],
      addedColumns: ['community_bookmarks.icon', 'dashboard_announcements.type'],
      executedBy: authResult.user.username || authResult.user.id
    });
    
  } catch (error) {
    console.error('SCHEMA MIGRATION failed:', error);
    
    // SECURITY: Log failed migration attempt
    try {
      const session = await requireAuth(request, 'admin');
      if (!(session instanceof NextResponse)) {
        await logSecurityEvent(
          'schema_migration_failed',
          session.user.id,
          `Schema migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'critical'
        );
      }
    } catch (logError) {
      console.error('Failed to log migration error:', logError);
    }
    
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    // SECURITY: Require admin authentication for schema inspection
    const authResult = await requireAuth(request, 'admin');
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    // Check current schema state without making changes
    const communityBookmarksColumns = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'community_bookmarks' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    
    const dashboardAnnouncementsColumns = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'dashboard_announcements' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    
    const dashboardSettingsColumns = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'dashboard_settings' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    
    // Check if required columns exist
    const communityBookmarksHasIcon = (communityBookmarksColumns as { column_name: string }[]).some(col => col.column_name === 'icon');
    const dashboardAnnouncementsHasType = (dashboardAnnouncementsColumns as { column_name: string }[]).some(col => col.column_name === 'type');
    const dashboardSettingsHasKey = (dashboardSettingsColumns as { column_name: string }[]).some(col => col.column_name === 'key');
    
    return NextResponse.json({
      success: true,
      schemaStatus: {
        communityBookmarksHasIcon,
        dashboardAnnouncementsHasType,
        dashboardSettingsHasKey,
        needsMigration: !communityBookmarksHasIcon || !dashboardAnnouncementsHasType || !dashboardSettingsHasKey
      },
      schemas: {
        communityBookmarksColumns,
        dashboardAnnouncementsColumns,
        dashboardSettingsColumns
      }
    });
    
  } catch (error) {
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}