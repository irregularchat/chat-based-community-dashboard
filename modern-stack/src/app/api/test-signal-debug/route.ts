import { NextRequest, NextResponse } from 'next/server';
import { matrixService } from '@/lib/matrix';

export async function GET(request: NextRequest) {
  try {
    console.log('🧪 Starting Signal debug test...');
    
    // Get query params
    const url = new URL(request.url);
    const phoneNumber = url.searchParams.get('phone') || '+12247253276';
    const testMessage = url.searchParams.get('message') || 'Debug test message from Signal verification system';
    
    console.log(`🧪 Testing Signal verification for phone: ${phoneNumber}`);
    
    // Test the Signal verification flow
    const result = await matrixService.sendSignalMessageByPhone(phoneNumber, testMessage);
    
    console.log(`🧪 Signal test result:`, result);
    
    return NextResponse.json({
      success: true,
      testParams: {
        phoneNumber,
        message: testMessage,
      },
      result,
      debug: {
        matrixConfigured: matrixService.isConfigured(),
        environment: {
          signalBridgeRoomId: process.env.MATRIX_SIGNAL_BRIDGE_ROOM_ID,
          signalBotUsername: process.env.MATRIX_SIGNAL_BOT_USERNAME,
          signalBridgeDelay: process.env.SIGNAL_BRIDGE_BOT_RESPONSE_DELAY,
          matrixDomain: process.env.MATRIX_DOMAIN,
        }
      }
    });
  } catch (error) {
    console.error('🧪 Signal debug test error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    }, { status: 500 });
  }
}