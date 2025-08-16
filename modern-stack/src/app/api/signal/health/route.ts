/**
 * Signal CLI Health Check API Endpoint
 * Provides health status for Signal CLI service integration
 */

import { NextRequest, NextResponse } from 'next/server';
import { SignalBotService } from '@/lib/signal/signal-bot-service';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Signal Health: Starting health check...');
    
    const signalBot = new SignalBotService();
    
    // Check if Signal CLI is configured
    if (!signalBot.isConfigured()) {
      return NextResponse.json({
        status: 'disabled',
        message: 'Signal CLI service is not enabled or configured',
        timestamp: new Date().toISOString(),
        healthy: false,
      }, { status: 200 });
    }

    // Perform comprehensive health check
    const healthResult = await signalBot.checkServiceHealth();
    
    const response = {
      status: healthResult.containerStatus === 'running' ? 'healthy' : 'unhealthy',
      containerStatus: healthResult.containerStatus,
      registrationStatus: healthResult.registrationStatus,
      apiResponseTime: healthResult.apiResponseTime,
      messagesSentToday: healthResult.messagesSentToday,
      lastMessageSent: healthResult.lastMessageSent,
      config: {
        enabled: signalBot.getConfig().enabled,
        apiUrl: signalBot.getConfig().apiUrl,
        hasPhoneNumber: !!signalBot.getConfig().phoneNumber,
        deviceName: signalBot.getConfig().deviceName,
      },
      timestamp: new Date().toISOString(),
      healthy: healthResult.containerStatus === 'running',
    };

    console.log(`✅ Signal Health: Check completed - Status: ${response.status}`);
    
    return NextResponse.json(response, { 
      status: response.healthy ? 200 : 503 
    });
    
  } catch (error) {
    console.error('❌ Signal Health: Health check failed:', error);
    
    return NextResponse.json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Health check failed',
      timestamp: new Date().toISOString(),
      healthy: false,
    }, { status: 503 });
  }
}

export async function HEAD(request: NextRequest) {
  try {
    const signalBot = new SignalBotService();
    
    if (!signalBot.isConfigured()) {
      return new NextResponse(null, { status: 503 });
    }

    const healthResult = await signalBot.checkServiceHealth();
    const isHealthy = healthResult.containerStatus === 'running';
    
    return new NextResponse(null, { 
      status: isHealthy ? 200 : 503,
      headers: {
        'X-Signal-Status': healthResult.containerStatus,
        'X-Signal-Registration': healthResult.registrationStatus,
      }
    });
    
  } catch (error) {
    return new NextResponse(null, { status: 503 });
  }
}