import { NextResponse } from 'next/server';
import { RestSignalBotService } from '@/lib/signal-cli/rest-bot-service';

// Global instance to keep the bot running
let signalBot: RestSignalBotService | null = null;

export async function POST() {
  try {
    console.log('🚀 Starting Signal bot daemon...');

    // Check if bot is already running
    if (signalBot) {
      return NextResponse.json({
        success: true,
        message: 'Signal bot is already running',
        status: 'running'
      });
    }

    // Get configuration from environment variables
    const phoneNumber = process.env.SIGNAL_BOT_PHONE_NUMBER || process.env.SIGNAL_PHONE_NUMBER;
    const aiEnabled = process.env.OPENAI_ACTIVE === 'true';
    const openAiApiKey = process.env.OPENAI_API_KEY;

    if (!phoneNumber) {
      return NextResponse.json({
        success: false,
        error: 'SIGNAL_BOT_PHONE_NUMBER or SIGNAL_PHONE_NUMBER not configured'
      }, { status: 400 });
    }

    console.log(`📞 Starting bot for phone number: ${phoneNumber}`);
    console.log(`🤖 AI enabled: ${aiEnabled}`);

    // Create and start the Signal bot
    signalBot = new RestSignalBotService({
      phoneNumber,
      aiEnabled,
      openAiApiKey,
      restApiUrl: process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240'
    });

    await signalBot.startListening();

    console.log('✅ Signal bot daemon started successfully');

    return NextResponse.json({
      success: true,
      message: 'Signal bot started successfully',
      status: 'running',
      config: {
        phoneNumber,
        aiEnabled,
        hasOpenAiKey: !!openAiApiKey
      }
    });

  } catch (error) {
    console.error('❌ Failed to start Signal bot:', error);
    signalBot = null;
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}

export async function GET() {
  try {
    const isRunning = signalBot !== null;
    
    return NextResponse.json({
      success: true,
      status: isRunning ? 'running' : 'stopped',
      botInstance: !!signalBot
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}