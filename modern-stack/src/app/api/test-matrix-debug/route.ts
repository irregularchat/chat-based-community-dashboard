import { NextRequest, NextResponse } from 'next/server';
import { matrixService } from '@/lib/matrix';

export async function GET(_request: NextRequest) {
  try {
    console.log('🔍 Debug Matrix Configuration...');
    
    // Check Matrix service configuration
    const isConfigured = matrixService.isConfigured();
    const config = matrixService.getConfig();
    const client = matrixService.getClient();
    
    let clientStatus = 'null';
    let syncState = 'unknown';
    let roomCount = 0;
    let connectedUserId = 'unknown';
    
    if (client) {
      clientStatus = 'exists';
      syncState = client.getSyncState() || 'null';
      connectedUserId = client.getUserId() || 'unknown';
      
      try {
        const rooms = client.getRooms();
        roomCount = rooms.length;
        console.log(`Matrix client has ${roomCount} rooms`);
        
        if (roomCount > 0) {
          console.log('Sample rooms:', rooms.slice(0, 3).map(r => ({
            id: r.roomId,
            name: r.name,
            members: r.getJoinedMemberCount()
          })));
        }
      } catch (error) {
        console.error('Error getting rooms:', error);
      }
    }
    
    const result = {
      matrixConfig: {
        isConfigured,
        homeserver: config?.homeserver,
        userId: config?.userId,
        hasWelcomeRoom: !!config?.welcomeRoomId,
        hasDefaultRoom: !!config?.defaultRoomId
      },
      clientStatus: {
        exists: client !== null,
        status: clientStatus,
        syncState,
        connectedUserId,
        roomCount
      },
      environment: {
        matrixHomeserver: process.env.MATRIX_HOMESERVER,
        matrixUserId: process.env.MATRIX_USER_ID,
        matrixActive: process.env.MATRIX_ACTIVE,
        hasAccessToken: !!process.env.MATRIX_ACCESS_TOKEN
      }
    };
    
    console.log('Matrix debug result:', result);
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('❌ Matrix debug failed:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}