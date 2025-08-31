import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    console.log('🚀 Matrix startup sync triggered');
    
    // Import the matrix sync service
    const { matrixSyncService } = await import('@/lib/matrix-sync');
    
    // Start the background sync process
    const result = await matrixSyncService.startupSync();
    
    console.log('✅ Matrix startup sync completed:', result);
    
    return NextResponse.json({
      success: true,
      message: 'Matrix startup sync completed',
      result
    });
    
  } catch (error) {
    console.error('❌ Matrix startup sync failed:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // Allow GET requests to trigger sync as well for easier testing
  return POST(req);
}