import { NextResponse } from 'next/server';

export async function GET() {
  const results: any = {
    timestamp: new Date().toISOString(),
    env: {
      signal: !!process.env.SIGNAL_CLI_REST_API_BASE_URL,
      matrix: !!process.env.MATRIX_HOMESERVER,
    }
  };

  // Test 1: Signal Bot Service
  try {
    const { SignalBotService } = await import('@/lib/signal/signal-bot-service');
    const signalBot = new SignalBotService();
    results.signal = {
      configured: signalBot.isConfigured(),
      phoneNumber: signalBot.config?.phoneNumber,
    };
  } catch (e: any) {
    results.signal = { error: e.message };
  }

  // Test 2: Community services WITHOUT Matrix SDK
  try {
    const { SignalCommunityService } = await import('@/lib/community/signal-community-service');
    const signalService = new SignalCommunityService();
    results.signalCommunity = {
      configured: signalService.isConfigured(),
      platform: signalService.platform,
    };
  } catch (e: any) {
    results.signalCommunity = { error: e.message };
  }

  // Test 3: Check if community page would show services
  const hasSignal = results.signal?.configured || false;
  const hasMatrix = false; // Skip Matrix due to encryption issues
  
  results.summary = {
    servicesAvailable: hasSignal || hasMatrix,
    signalReady: hasSignal,
    matrixReady: hasMatrix,
    communityPageShouldWork: hasSignal,
  };

  return NextResponse.json(results);
}