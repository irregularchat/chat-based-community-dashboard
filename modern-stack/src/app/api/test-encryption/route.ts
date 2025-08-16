import { NextRequest, NextResponse } from 'next/server';
import { matrixService } from '@/lib/matrix';

export async function GET(request: NextRequest) {
  try {
    // Check Matrix service configuration and encryption status
    const isConfigured = matrixService.isConfigured();
    const config = matrixService.getConfig();
    
    const status = {
      matrixConfigured: isConfigured,
      encryptionEnabled: config?.enableEncryption || false,
      deviceId: config?.deviceId,
      homeserver: config?.homeserver,
      timestamp: new Date().toISOString()
    };

    console.log('Matrix encryption status check:', status);
    
    return NextResponse.json({
      success: true,
      status,
      message: `Matrix encryption is ${config?.enableEncryption ? 'ENABLED' : 'DISABLED'}`
    });
  } catch (error) {
    console.error('Error checking Matrix encryption:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}