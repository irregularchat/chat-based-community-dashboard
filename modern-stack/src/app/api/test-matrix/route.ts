import { NextRequest, NextResponse } from 'next/server';
import { matrixSyncService } from '@/lib/matrix-sync';
import { PrismaClient } from '@/generated/prisma';

export async function GET(_request: NextRequest) {
  const prisma = new PrismaClient();

  try {
    console.log('🔄 Testing Matrix Sync via API...');
    
    // Check current cache state
    const userCount = await prisma.matrixUser.count();
    const roomCount = await prisma.matrixRoom.count();
    const membershipCount = await prisma.matrixRoomMembership.count();
    
    console.log(`Current stats - Users: ${userCount}, Rooms: ${roomCount}, Memberships: ${membershipCount}`);
    
    // Perform sync
    console.log('🚀 Starting Matrix sync...');
    const syncResult = await matrixSyncService.fullSync(true);
    
    // Check updated cache state
    const newUserCount = await prisma.matrixUser.count();
    const newRoomCount = await prisma.matrixRoom.count();
    const newMembershipCount = await prisma.matrixRoomMembership.count();
    
    // Get some sample data
    const sampleUsers = await prisma.matrixUser.findMany({ 
      take: 5,
      orderBy: { displayName: 'asc' }
    });
    
    const sampleRooms = await prisma.matrixRoom.findMany({ 
      take: 5,
      orderBy: { memberCount: 'desc' }
    });
    
    const result = {
      syncResult,
      before: {
        users: userCount,
        rooms: roomCount,
        memberships: membershipCount
      },
      after: {
        users: newUserCount,
        rooms: newRoomCount,
        memberships: newMembershipCount
      },
      changes: {
        users: newUserCount - userCount,
        rooms: newRoomCount - roomCount,
        memberships: newMembershipCount - membershipCount
      },
      sampleUsers: sampleUsers.map(u => ({
        userId: u.userId,
        displayName: u.displayName,
        isSignalUser: u.isSignalUser
      })),
      sampleRooms: sampleRooms.map(r => ({
        roomId: r.roomId,
        name: r.name,
        memberCount: r.memberCount
      }))
    };
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('❌ Matrix sync test failed:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}