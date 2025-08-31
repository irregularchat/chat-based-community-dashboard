import { NextResponse } from 'next/server';
import { RestSignalBotService } from '@/lib/signal-cli/rest-bot-service';

// This needs to access the same global instance from start route
// In a real production app, you'd want a proper service manager
let signalBot: RestSignalBotService | null = null;

export async function POST() {
  try {
    console.log('🛑 Stopping Signal bot daemon...');

    if (!signalBot) {
      return NextResponse.json({
        success: true,
        message: 'Signal bot is not running',
        status: 'stopped'
      });
    }

    await signalBot.stopListening();
    signalBot = null;

    console.log('✅ Signal bot daemon stopped successfully');

    return NextResponse.json({
      success: true,
      message: 'Signal bot stopped successfully',
      status: 'stopped'
    });

  } catch (error) {
    console.error('❌ Failed to stop Signal bot:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}