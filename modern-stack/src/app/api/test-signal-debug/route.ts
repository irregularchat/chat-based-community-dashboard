import { NextRequest, NextResponse } from 'next/server';
import { matrixService } from '@/lib/matrix';
import { requireAuth, logSecurityEvent, isDangerousOperationsAllowed } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  try {
    // SECURITY: Require admin authentication for debug endpoints
    const authResult = await requireAuth(request, 'admin');
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    
    // SECURITY: Only allow debug operations in development
    if (!isDangerousOperationsAllowed()) {
      await logSecurityEvent(
        'debug_endpoint_blocked',
        authResult.user.id,
        'Debug endpoint access blocked in production',
        'warning'
      );
      return NextResponse.json({
        success: false,
        error: 'Debug endpoints not available in production'
      }, { status: 403 });
    }
    
    // SECURITY: Log debug access
    await logSecurityEvent(
      'debug_endpoint_accessed',
      authResult.user.id,
      'Signal debug endpoint accessed',
      'info'
    );
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
        phoneNumber: phoneNumber.replace(/\d(?=\d{4})/g, '*'), // Mask phone number
        message: testMessage.substring(0, 50) + '...', // Truncate message
      },
      result,
      debug: {
        matrixConfigured: matrixService.isConfigured(),
        environment: {
          // SECURITY: Mask sensitive environment variables
          signalBridgeRoomId: process.env.MATRIX_SIGNAL_BRIDGE_ROOM_ID ? '[SET]' : '[NOT_SET]',
          signalBotUsername: process.env.MATRIX_SIGNAL_BOT_USERNAME ? '[SET]' : '[NOT_SET]',
          signalBridgeDelay: process.env.SIGNAL_BRIDGE_BOT_RESPONSE_DELAY || 'default',
          matrixDomain: process.env.MATRIX_DOMAIN ? '[SET]' : '[NOT_SET]',
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