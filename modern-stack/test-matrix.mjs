#!/usr/bin/env node
import { config } from 'dotenv';

// Load environment variables
config({ path: '.env.local' });

console.log('🔍 Testing Matrix service directly...');
console.log('Environment check:');
console.log('MATRIX_HOMESERVER:', process.env.MATRIX_HOMESERVER);
console.log('MATRIX_ACCESS_TOKEN:', process.env.MATRIX_ACCESS_TOKEN ? '[SET]' : '[NOT_SET]');
console.log('MATRIX_USER_ID:', process.env.MATRIX_USER_ID);

try {
  console.log('\n📦 Importing Matrix service...');
  const { matrixService } = await import('./src/lib/matrix.ts');
  
  console.log('✅ Matrix service imported');
  
  // Test configuration
  const isConfigured = matrixService.isConfigured();
  console.log('Is configured:', isConfigured);
  
  if (isConfigured) {
    console.log('\n🔍 Testing Matrix connection...');
    
    // Test getting users
    console.log('Getting users...');
    const users = await matrixService.getUsers();
    console.log('Matrix users found:', users?.length || 0);
    
    if (users && users.length > 0) {
      console.log('Sample users:', users.slice(0, 3).map(u => ({
        userId: u.user_id || u.userId, 
        displayName: u.display_name || u.displayName
      })));
    }
    
    // Test getting rooms
    console.log('Getting rooms...');
    const rooms = await matrixService.getRooms();
    console.log('Matrix rooms found:', rooms?.length || 0);
    
    if (rooms && rooms.length > 0) {
      console.log('Sample rooms:', rooms.slice(0, 3).map(r => ({
        roomId: r.room_id || r.roomId,
        name: r.name,
        memberCount: r.member_count || r.memberCount
      })));
    }
    
  } else {
    console.log('❌ Matrix not properly configured');
  }
  
} catch (error) {
  console.error('❌ Error testing Matrix service:', error.message);
  console.error('Stack:', error.stack);
}