import { NextRequest, NextResponse } from 'next/server';
import { SignalMatrixIntegration } from '@/lib/signal-cli/integration';

// Store the integration instance
let signalIntegration: SignalMatrixIntegration | null = null;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'status') {
      return NextResponse.json({
        success: true,
        status: signalIntegration ? 'running' : 'stopped',
        configured: !!process.env.SIGNAL_BOT_PHONE_NUMBER
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Invalid action. Use ?action=status'
    });
  } catch (error) {
    console.error('Signal bot status error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'start') {
      if (signalIntegration) {
        return NextResponse.json({
          success: false,
          error: 'Signal bot is already running'
        });
      }

      // Check configuration
      const phoneNumber = process.env.SIGNAL_BOT_PHONE_NUMBER;
      if (!phoneNumber) {
        return NextResponse.json({
          success: false,
          error: 'SIGNAL_BOT_PHONE_NUMBER not configured in environment'
        });
      }

      // Create and start integration
      signalIntegration = new SignalMatrixIntegration({
        phoneNumber,
        aiEnabled: process.env.OPENAI_ACTIVE === 'true',
        openAiApiKey: process.env.OPENAI_API_KEY,
        matrixRoomMapping: new Map() // Can be configured later
      });

      await signalIntegration.start();

      return NextResponse.json({
        success: true,
        message: 'Signal bot started successfully'
      });
    }

    if (action === 'stop') {
      if (!signalIntegration) {
        return NextResponse.json({
          success: false,
          error: 'Signal bot is not running'
        });
      }

      await signalIntegration.stop();
      signalIntegration = null;

      return NextResponse.json({
        success: true,
        message: 'Signal bot stopped successfully'
      });
    }

    if (action === 'restart') {
      if (signalIntegration) {
        await signalIntegration.stop();
        signalIntegration = null;
      }

      const phoneNumber = process.env.SIGNAL_BOT_PHONE_NUMBER;
      if (!phoneNumber) {
        return NextResponse.json({
          success: false,
          error: 'SIGNAL_BOT_PHONE_NUMBER not configured'
        });
      }

      signalIntegration = new SignalMatrixIntegration({
        phoneNumber,
        aiEnabled: process.env.OPENAI_ACTIVE === 'true',
        openAiApiKey: process.env.OPENAI_API_KEY,
        matrixRoomMapping: new Map()
      });

      await signalIntegration.start();

      return NextResponse.json({
        success: true,
        message: 'Signal bot restarted successfully'
      });
    }

    return NextResponse.json({
      success: false,
      error: 'Invalid action. Use: start, stop, or restart'
    });
  } catch (error) {
    console.error('Signal bot action error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}