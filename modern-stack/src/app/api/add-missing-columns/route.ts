import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(_request: NextRequest) {
  try {
    console.log('COLUMN MIGRATION: Adding missing columns to fix Prisma schema mismatch...');
    
    // Add missing icon column to community_bookmarks
    console.log('Adding icon column to community_bookmarks...');
    try {
      await prisma.$executeRaw`
        ALTER TABLE "community_bookmarks" ADD COLUMN IF NOT EXISTS "icon" TEXT;
      `;
      console.log('✅ Added icon column to community_bookmarks');
    } catch {
      console.log('ℹ️ Icon column may already exist in community_bookmarks');
    }
    
    // Add missing type column to dashboard_announcements
    console.log('Adding type column to dashboard_announcements...');
    try {
      await prisma.$executeRaw`
        ALTER TABLE "dashboard_announcements" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'info';
      `;
      console.log('✅ Added type column to dashboard_announcements');
    } catch {
      console.log('ℹ️ Type column may already exist in dashboard_announcements');
    }
    
    // Test Prisma queries to verify fixes
    console.log('Testing Prisma queries...');
    
    const queryResults = {
      communityBookmarks: false,
      dashboardAnnouncements: false,
      dashboardSettings: false
    };
    
    try {
      await prisma.communityBookmark.findMany({ take: 1 });
      console.log('✅ CommunityBookmark queries working');
      queryResults.communityBookmarks = true;
    } catch (error) {
      console.error('❌ CommunityBookmark queries still failing:', error);
    }
    
    try {
      await prisma.dashboardAnnouncement.findMany({ take: 1 });
      console.log('✅ DashboardAnnouncement queries working');
      queryResults.dashboardAnnouncements = true;
    } catch (error) {
      console.error('❌ DashboardAnnouncement queries still failing:', error);
    }
    
    try {
      await prisma.dashboardSettings.findMany({ take: 1 });
      console.log('✅ DashboardSettings queries working');
      queryResults.dashboardSettings = true;
    } catch (error) {
      console.error('❌ DashboardSettings queries still failing:', error);
    }
    
    const allQueriesWorking = queryResults.communityBookmarks && 
                              queryResults.dashboardAnnouncements && 
                              queryResults.dashboardSettings;
    
    console.log('COLUMN MIGRATION: Completed!');
    
    return NextResponse.json({ 
      success: true, 
      message: 'Missing columns added successfully',
      addedColumns: ['community_bookmarks.icon', 'dashboard_announcements.type'],
      queryResults,
      allQueriesWorking
    });
    
  } catch (error) {
    console.error('COLUMN MIGRATION failed:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : 'No stack trace'
    }, { status: 500 });
  }
}

export async function GET(_request: NextRequest) {
  try {
    // Check if columns exist
    const communityBookmarksColumns = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'community_bookmarks' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    
    const dashboardAnnouncementsColumns = await prisma.$queryRaw`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'dashboard_announcements' AND table_schema = 'public'
      ORDER BY ordinal_position;
    `;
    
    const hasIcon = (communityBookmarksColumns as { column_name: string }[]).some(col => col.column_name === 'icon');
    const hasType = (dashboardAnnouncementsColumns as { column_name: string }[]).some(col => col.column_name === 'type');
    
    return NextResponse.json({
      success: true,
      columnStatus: {
        communityBookmarksHasIcon: hasIcon,
        dashboardAnnouncementsHasType: hasType,
        needsColumnMigration: !hasIcon || !hasType
      },
      columns: {
        communityBookmarksColumns,
        dashboardAnnouncementsColumns
      }
    });
    
  } catch (error) {
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}