import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
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
    
    return NextResponse.json({ 
      success: true, 
      message: 'Database schema migration completed successfully',
      migratedTables: ['community_bookmarks', 'dashboard_announcements'],
      addedColumns: ['community_bookmarks.icon', 'dashboard_announcements.type'],
      schemas: {
        communityBookmarksColumns,
        dashboardAnnouncementsColumns,
        dashboardSettingsColumns
      }
    });
    
  } catch (error) {
    console.error('SCHEMA MIGRATION failed:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : 'No stack trace'
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
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
    const communityBookmarksHasIcon = (communityBookmarksColumns as any[]).some(col => col.column_name === 'icon');
    const dashboardAnnouncementsHasType = (dashboardAnnouncementsColumns as any[]).some(col => col.column_name === 'type');
    const dashboardSettingsHasKey = (dashboardSettingsColumns as any[]).some(col => col.column_name === 'key');
    
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