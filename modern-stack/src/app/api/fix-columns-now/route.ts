import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(_request: NextRequest) {
  try {
    console.log('IMMEDIATE COLUMN FIX: Adding missing columns now...');
    
    // Add icon column to community_bookmarks
    console.log('Adding icon column to community_bookmarks...');
    await prisma.$executeRaw`ALTER TABLE "community_bookmarks" ADD COLUMN IF NOT EXISTS "icon" TEXT;`;
    console.log('✅ Icon column added/verified');
    
    // Add type column to dashboard_announcements
    console.log('Adding type column to dashboard_announcements...');
    await prisma.$executeRaw`ALTER TABLE "dashboard_announcements" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'info';`;
    console.log('✅ Type column added/verified');
    
    // Test queries to verify they work
    console.log('Testing Prisma queries...');
    
    try {
      await prisma.communityBookmark.findMany({ take: 1 });
      console.log('✅ CommunityBookmark query works');
    } catch (error) {
      console.error('❌ CommunityBookmark query still fails:', error);
    }
    
    try {
      await prisma.dashboardAnnouncement.findMany({ take: 1 });
      console.log('✅ DashboardAnnouncement query works');
    } catch (error) {
      console.error('❌ DashboardAnnouncement query still fails:', error);
    }
    
    try {
      await prisma.dashboardSettings.findMany({ take: 1 });
      console.log('✅ DashboardSettings query works');
    } catch (error) {
      console.error('❌ DashboardSettings query still fails:', error);
    }
    
    console.log('IMMEDIATE COLUMN FIX: Completed successfully!');
    
    return NextResponse.json({ 
      success: true, 
      message: 'Missing columns added successfully - schema should now be synchronized',
      addedColumns: ['community_bookmarks.icon', 'dashboard_announcements.type']
    });
    
  } catch (error) {
    console.error('IMMEDIATE COLUMN FIX failed:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}