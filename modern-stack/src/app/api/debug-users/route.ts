import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 DEBUG: Testing Matrix and Signal user data');
    
    const results = {
      matrix: {
        configured: false,
        error: null,
        users: 0,
        rooms: 0,
        details: null
      },
      signal: {
        configured: false,
        error: null,
        users: 0,
        groups: 0,
        details: null
      },
      environment: {
        matrixHomeserver: process.env.MATRIX_HOMESERVER || 'NOT_SET',
        matrixUserId: process.env.MATRIX_USER_ID || 'NOT_SET',
        matrixAccessToken: process.env.MATRIX_ACCESS_TOKEN ? 'SET' : 'NOT_SET',
        signalPhoneNumber: process.env.SIGNAL_BOT_PHONE_NUMBER || process.env.SIGNAL_PHONE_NUMBER || 'NOT_SET',
      }
    };

    // Test Matrix
    try {
      console.log('🔍 Testing Matrix service...');
      const { matrixService } = await import('@/lib/matrix');
      
      results.matrix.configured = matrixService.isConfigured();
      console.log('Matrix configured:', results.matrix.configured);
      
      if (results.matrix.configured) {
        // Test getting users
        const users = await matrixService.getUsers();
        results.matrix.users = users?.length || 0;
        console.log('Matrix users found:', results.matrix.users);
        
        // Test getting rooms  
        const rooms = await matrixService.getRooms();
        results.matrix.rooms = rooms?.length || 0;
        console.log('Matrix rooms found:', results.matrix.rooms);
        
        results.matrix.details = {
          sampleUsers: users?.slice(0, 2).map((u: any) => ({
            userId: u.user_id || u.userId,
            displayName: u.display_name || u.displayName
          })),
          sampleRooms: rooms?.slice(0, 2).map((r: any) => ({
            roomId: r.room_id || r.roomId,
            name: r.name,
            memberCount: r.member_count || r.memberCount
          }))
        };
      }
      
    } catch (matrixError) {
      results.matrix.error = matrixError instanceof Error ? matrixError.message : String(matrixError);
      console.error('Matrix error:', results.matrix.error);
    }

    // Test Signal - check both REST API and native daemon
    try {
      console.log('🔍 Testing Signal service...');
      
      // First check if native daemon is working
      const fs = require('fs').promises;
      const socketPath = process.env.SIGNAL_CLI_SOCKET_PATH || '/tmp/signal-cli-socket';
      
      try {
        await fs.access(socketPath);
        results.signal.configured = true;
        console.log('Signal socket found:', socketPath);
        
        // Try to get native bot health and test groups/contacts
        const { NativeSignalBotService } = await import('@/lib/signal-cli/native-daemon-service');
        const config = {
          phoneNumber: process.env.SIGNAL_BOT_PHONE_NUMBER || process.env.SIGNAL_PHONE_NUMBER,
          dataDir: process.env.SIGNAL_CLI_DATA_DIR || './signal-data'
        };
        
        const nativeBot = new NativeSignalBotService(config);
        const health = await nativeBot.getHealth();
        
        // Try to get groups and contacts
        try {
          // Connect to the socket first
          await nativeBot.connectSocket();
          
          // Wait a moment for connection to establish
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const groups = await nativeBot.getGroups();
          const contacts = await nativeBot.getContacts();
          
          results.signal.groups = groups?.length || 0;
          results.signal.users = contacts?.length || 0;
          
          results.signal.details = {
            health,
            socketExists: true,
            phoneNumber: config.phoneNumber,
            sampleGroups: groups?.slice(0, 2),
            sampleContacts: contacts?.slice(0, 2)
          };
        } catch (dataError) {
          results.signal.details = {
            health,
            socketExists: true,
            phoneNumber: config.phoneNumber,
            dataError: dataError.message
          };
        }
        
      } catch (socketError) {
        results.signal.error = `Socket error: ${socketError instanceof Error ? socketError.message : String(socketError)}`;
        console.error('Signal socket error:', results.signal.error);
      }
      
    } catch (signalError) {
      results.signal.error = signalError instanceof Error ? signalError.message : String(signalError);
      console.error('Signal error:', results.signal.error);
    }

    console.log('🔍 DEBUG Results:', JSON.stringify(results, null, 2));
    
    return NextResponse.json(results, { status: 200 });
    
  } catch (error) {
    console.error('❌ Debug endpoint error:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}