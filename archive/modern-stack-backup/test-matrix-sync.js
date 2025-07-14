#!/usr/bin/env node

// Test script to verify Matrix sync functionality
const { PrismaClient } = require('./src/generated/prisma');

async function testMatrixSync() {
  console.log('🔄 Testing Matrix Sync Service...\n');
  
  const prisma = new PrismaClient();
  
  try {
    // Import Matrix sync service (using dynamic import for ES modules)
    const { matrixSyncService } = await import('./src/lib/matrix-sync.js');
    
    console.log('✅ Matrix sync service imported successfully');
    
    // Check current cache state
    console.log('\n📊 Current cache stats:');
    const userCount = await prisma.matrixUser.count();
    const roomCount = await prisma.matrixRoom.count();
    const membershipCount = await prisma.matrixRoomMembership.count();
    
    console.log(`Users: ${userCount}`);
    console.log(`Rooms: ${roomCount}`);
    console.log(`Memberships: ${membershipCount}`);
    
    // Perform sync
    console.log('\n🚀 Starting Matrix sync...');
    const syncResult = await matrixSyncService.fullSync(true);
    
    console.log('\n📈 Sync Results:');
    console.log(`Status: ${syncResult.status}`);
    console.log(`Users synced: ${syncResult.usersSync || 0}`);
    console.log(`Rooms synced: ${syncResult.roomsSync || 0}`);
    console.log(`Memberships synced: ${syncResult.membershipsSync || 0}`);
    
    if (syncResult.error) {
      console.log(`Error: ${syncResult.error}`);
    }
    
    // Check updated cache state
    console.log('\n📊 Updated cache stats:');
    const newUserCount = await prisma.matrixUser.count();
    const newRoomCount = await prisma.matrixRoom.count();
    const newMembershipCount = await prisma.matrixRoomMembership.count();
    
    console.log(`Users: ${newUserCount} (${newUserCount - userCount >= 0 ? '+' : ''}${newUserCount - userCount})`);
    console.log(`Rooms: ${newRoomCount} (${newRoomCount - roomCount >= 0 ? '+' : ''}${newRoomCount - roomCount})`);
    console.log(`Memberships: ${newMembershipCount} (${newMembershipCount - membershipCount >= 0 ? '+' : ''}${newMembershipCount - membershipCount})`);
    
    // Show some sample data
    if (newUserCount > 0) {
      console.log('\n👥 Sample users:');
      const sampleUsers = await prisma.matrixUser.findMany({ 
        take: 5,
        orderBy: { displayName: 'asc' }
      });
      sampleUsers.forEach(user => {
        console.log(`  - ${user.displayName || user.userId} ${user.isSignalUser ? '(Signal)' : ''}`);
      });
    }
    
    if (newRoomCount > 0) {
      console.log('\n🏠 Sample rooms:');
      const sampleRooms = await prisma.matrixRoom.findMany({ 
        take: 5,
        orderBy: { memberCount: 'desc' }
      });
      sampleRooms.forEach(room => {
        console.log(`  - ${room.name || room.roomId} (${room.memberCount} members)`);
      });
    }
    
    console.log('\n✅ Matrix sync test completed!');
    
  } catch (error) {
    console.error('❌ Matrix sync test failed:', error);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

testMatrixSync().catch(console.error);