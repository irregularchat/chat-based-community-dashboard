/**
 * Service Configuration Test Endpoint
 * Tests all service configurations and connections
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const testResults: any = {
    timestamp: new Date().toISOString(),
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      hasEnvFile: !!process.env.DATABASE_URL
    },
    services: {},
    errors: []
  };

  // Test 1: Environment Variables
  console.log('🔍 Testing Environment Variables...');
  testResults.services.environment = {
    signal: {
      SIGNAL_CLI_REST_API_BASE_URL: process.env.SIGNAL_CLI_REST_API_BASE_URL || 'NOT SET',
      SIGNAL_BOT_PHONE_NUMBER: process.env.SIGNAL_BOT_PHONE_NUMBER || 'NOT SET',
      SIGNAL_ACTIVE: process.env.SIGNAL_ACTIVE || 'NOT SET',
      configured: !!(process.env.SIGNAL_CLI_REST_API_BASE_URL && process.env.SIGNAL_BOT_PHONE_NUMBER)
    },
    matrix: {
      MATRIX_HOMESERVER: process.env.MATRIX_HOMESERVER || 'NOT SET',
      MATRIX_ACCESS_TOKEN: process.env.MATRIX_ACCESS_TOKEN ? 'SET (hidden)' : 'NOT SET',
      MATRIX_USER_ID: process.env.MATRIX_USER_ID || 'NOT SET',
      MATRIX_ACTIVE: process.env.MATRIX_ACTIVE || 'NOT SET',
      configured: !!(process.env.MATRIX_HOMESERVER && process.env.MATRIX_ACCESS_TOKEN && process.env.MATRIX_USER_ID)
    }
  };

  // Test 2: Signal CLI Service
  console.log('🔍 Testing Signal CLI Service...');
  try {
    const { SignalBotService } = await import('@/lib/signal/signal-bot-service');
    const signalBot = new SignalBotService();
    
    testResults.services.signalCli = {
      serviceExists: true,
      isConfigured: signalBot.isConfigured(),
      config: signalBot.isConfigured() ? {
        apiUrl: signalBot.config.apiUrl,
        phoneNumber: signalBot.config.phoneNumber,
        displayName: signalBot.config.displayName
      } : null
    };

    // Test Signal CLI health if configured
    if (signalBot.isConfigured()) {
      try {
        const health = await signalBot.checkServiceHealth();
        testResults.services.signalCli.health = health;
        testResults.services.signalCli.connectionStatus = 'SUCCESS';
      } catch (error: any) {
        testResults.services.signalCli.connectionStatus = 'FAILED';
        testResults.services.signalCli.connectionError = error.message;
      }
    }
  } catch (error: any) {
    testResults.services.signalCli = {
      serviceExists: false,
      error: error.message
    };
    testResults.errors.push(`Signal CLI Service: ${error.message}`);
  }

  // Test 3: Matrix Service
  console.log('🔍 Testing Matrix Service...');
  try {
    const { matrixService } = await import('@/lib/matrix');
    
    testResults.services.matrix = {
      serviceExists: true,
      isConfigured: matrixService.isConfigured(),
      config: matrixService.getConfig()
    };

    // Test Matrix connection if configured
    if (matrixService.isConfigured()) {
      try {
        await matrixService.ensureInitialized();
        testResults.services.matrix.connectionStatus = 'SUCCESS';
        testResults.services.matrix.client = {
          initialized: !!matrixService.getClient(),
          userId: matrixService.getClient()?.getUserId() || null
        };
      } catch (error: any) {
        testResults.services.matrix.connectionStatus = 'FAILED';
        testResults.services.matrix.connectionError = error.message;
      }
    }
  } catch (error: any) {
    testResults.services.matrix = {
      serviceExists: false,
      error: error.message
    };
    testResults.errors.push(`Matrix Service: ${error.message}`);
  }

  // Test 4: Community Services
  console.log('🔍 Testing Community Services...');
  try {
    const { SignalCommunityService } = await import('@/lib/community/signal-community-service');
    const { MatrixCommunityService } = await import('@/lib/community/matrix-community-service');
    
    // Test Signal Community Service
    const signalCommunity = new SignalCommunityService();
    testResults.services.signalCommunity = {
      serviceExists: true,
      isConfigured: signalCommunity.isConfigured(),
      platform: signalCommunity.platform,
      name: signalCommunity.name
    };

    if (signalCommunity.isConfigured()) {
      const isAvailable = await signalCommunity.isAvailable();
      testResults.services.signalCommunity.isAvailable = isAvailable;
      
      if (isAvailable) {
        const health = await signalCommunity.getHealth();
        testResults.services.signalCommunity.health = health;
      }
    }

    // Test Matrix Community Service
    const matrixCommunity = new MatrixCommunityService();
    testResults.services.matrixCommunity = {
      serviceExists: true,
      isConfigured: matrixCommunity.isConfigured(),
      platform: matrixCommunity.platform,
      name: matrixCommunity.name
    };

    if (matrixCommunity.isConfigured()) {
      const isAvailable = await matrixCommunity.isAvailable();
      testResults.services.matrixCommunity.isAvailable = isAvailable;
      
      if (isAvailable) {
        const health = await matrixCommunity.getHealth();
        testResults.services.matrixCommunity.health = health;
      }
    }
  } catch (error: any) {
    testResults.services.communityServices = {
      error: error.message
    };
    testResults.errors.push(`Community Services: ${error.message}`);
  }

  // Test 5: Community Manager
  console.log('🔍 Testing Community Manager...');
  try {
    const { CommunityManagerImpl } = await import('@/lib/community/community-manager');
    const manager = new CommunityManagerImpl();
    
    const availableServices = await manager.getAvailableServices();
    testResults.services.communityManager = {
      serviceExists: true,
      availableServices: availableServices.map(s => ({
        platform: s.platform,
        name: s.name,
        isConfigured: s.isConfigured()
      })),
      signalService: manager.getSignalService() ? 'AVAILABLE' : 'NOT AVAILABLE',
      matrixService: manager.getMatrixService() ? 'AVAILABLE' : 'NOT AVAILABLE',
      primaryService: manager.getPrimaryService()?.platform || 'NONE'
    };
  } catch (error: any) {
    testResults.services.communityManager = {
      error: error.message
    };
    testResults.errors.push(`Community Manager: ${error.message}`);
  }

  // Test 6: Database Connection
  console.log('🔍 Testing Database Connection...');
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const startTime = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const responseTime = Date.now() - startTime;
    await prisma.$disconnect();
    
    testResults.services.database = {
      status: 'CONNECTED',
      responseTime: `${responseTime}ms`
    };
  } catch (error: any) {
    testResults.services.database = {
      status: 'FAILED',
      error: error.message
    };
    testResults.errors.push(`Database: ${error.message}`);
  }

  // Summary
  const signalConfigured = testResults.services.environment.signal.configured;
  const matrixConfigured = testResults.services.environment.matrix.configured;
  const signalConnected = testResults.services.signalCli?.connectionStatus === 'SUCCESS';
  const matrixConnected = testResults.services.matrix?.connectionStatus === 'SUCCESS';
  const dbConnected = testResults.services.database?.status === 'CONNECTED';

  testResults.summary = {
    signalStatus: signalConfigured ? (signalConnected ? '✅ Configured & Connected' : '⚠️ Configured but not connected') : '❌ Not configured',
    matrixStatus: matrixConfigured ? (matrixConnected ? '✅ Configured & Connected' : '⚠️ Configured but not connected') : '❌ Not configured',
    databaseStatus: dbConnected ? '✅ Connected' : '❌ Not connected',
    overallStatus: (signalConfigured || matrixConfigured) && dbConnected ? 'OPERATIONAL' : 'DEGRADED',
    totalErrors: testResults.errors.length
  };

  // Log results for debugging
  console.log('📊 Test Results:', JSON.stringify(testResults, null, 2));

  return NextResponse.json(testResults, {
    status: testResults.errors.length > 0 ? 500 : 200
  });
}