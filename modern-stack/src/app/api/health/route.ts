/**
 * Main Application Health Check API Endpoint
 * Provides comprehensive health status for the entire application
 */

import { NextRequest, NextResponse } from 'next/server';
import { SignalBotService } from '@/lib/signal/signal-bot-service';

// Simple database health check function
async function checkDatabaseHealth(): Promise<{ healthy: boolean; message?: string; responseTime?: number }> {
  try {
    const startTime = Date.now();
    
    // Use a simple database query to check connectivity
    // This will work with the Prisma setup
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    
    await prisma.$queryRaw`SELECT 1`;
    await prisma.$disconnect();
    
    const responseTime = Date.now() - startTime;
    
    return {
      healthy: true,
      responseTime,
    };
  } catch (error) {
    return {
      healthy: false,
      message: error instanceof Error ? error.message : 'Database connection failed',
    };
  }
}

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Health Check: Starting comprehensive health check...');
    
    const healthResults: any = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || 'unknown',
      environment: process.env.NODE_ENV || 'development',
      services: {},
    };

    // Check database health
    const dbHealth = await checkDatabaseHealth();
    healthResults.services.database = {
      status: dbHealth.healthy ? 'healthy' : 'unhealthy',
      responseTime: dbHealth.responseTime,
      message: dbHealth.message,
    };

    // Check Signal CLI health if enabled
    try {
      const signalBot = new SignalBotService();
      
      if (signalBot.isConfigured()) {
        const signalHealth = await signalBot.checkServiceHealth();
        healthResults.services.signalCli = {
          status: signalHealth.containerStatus === 'running' ? 'healthy' : 'unhealthy',
          containerStatus: signalHealth.containerStatus,
          registrationStatus: signalHealth.registrationStatus,
          responseTime: signalHealth.apiResponseTime,
          messagesSentToday: signalHealth.messagesSentToday,
        };
      } else {
        healthResults.services.signalCli = {
          status: 'disabled',
          message: 'Signal CLI service is not enabled or configured',
        };
      }
    } catch (error) {
      healthResults.services.signalCli = {
        status: 'error',
        message: error instanceof Error ? error.message : 'Signal CLI health check failed',
      };
    }

    // Check environment variables and configuration
    healthResults.services.configuration = {
      status: 'healthy',
      hasDatabase: !!process.env.DATABASE_URL,
      hasAuthentikConfig: !!(process.env.AUTHENTIK_CLIENT_ID && process.env.AUTHENTIK_CLIENT_SECRET),
      hasMatrixConfig: !!(process.env.MATRIX_ACCESS_TOKEN && process.env.MATRIX_HOMESERVER_URL),
      hasSignalConfig: !!(process.env.SIGNAL_CLI_ENABLED === 'true' && process.env.SIGNAL_CLI_API_URL),
    };

    // Determine overall health status
    const unhealthyServices = Object.entries(healthResults.services)
      .filter(([, service]: [string, any]) => service.status === 'unhealthy' || service.status === 'error')
      .map(([name]) => name);

    if (unhealthyServices.length > 0) {
      healthResults.status = 'degraded';
      healthResults.issues = unhealthyServices;
    }

    // Critical services that make the app completely unhealthy
    const criticalServices = ['database'];
    const criticalIssues = unhealthyServices.filter(service => criticalServices.includes(service));
    
    if (criticalIssues.length > 0) {
      healthResults.status = 'unhealthy';
    }

    console.log(`✅ Health Check: Overall status - ${healthResults.status}`);
    
    return NextResponse.json(healthResults, { 
      status: healthResults.status === 'unhealthy' ? 503 : 200 
    });
    
  } catch (error) {
    console.error('❌ Health Check: Failed:', error);
    
    return NextResponse.json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Health check failed',
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}

export async function HEAD(request: NextRequest) {
  try {
    // Simple HEAD request for basic health check
    const dbHealth = await checkDatabaseHealth();
    
    return new NextResponse(null, { 
      status: dbHealth.healthy ? 200 : 503,
      headers: {
        'X-Health-Status': dbHealth.healthy ? 'healthy' : 'unhealthy',
        'X-Health-Database': dbHealth.healthy ? 'ok' : 'error',
      }
    });
    
  } catch (error) {
    return new NextResponse(null, { status: 503 });
  }
}