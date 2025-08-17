import { NextResponse } from 'next/server';

export async function GET() {
  const results: any = {
    environment: {
      signal: {
        configured: !!(process.env.SIGNAL_CLI_REST_API_BASE_URL && process.env.SIGNAL_BOT_PHONE_NUMBER),
        apiUrl: process.env.SIGNAL_CLI_REST_API_BASE_URL,
      },
      matrix: {
        configured: !!(process.env.MATRIX_HOMESERVER && process.env.MATRIX_ACCESS_TOKEN && process.env.MATRIX_USER_ID),
        homeserver: process.env.MATRIX_HOMESERVER,
      }
    },
    services: {}
  };

  try {
    // Test Signal Community Service
    const { SignalCommunityService } = await import('@/lib/community/signal-community-service');
    const signalService = new SignalCommunityService();
    
    results.services.signal = {
      isConfigured: signalService.isConfigured(),
      platform: signalService.platform,
      name: signalService.name,
    };

    if (signalService.isConfigured()) {
      results.services.signal.isAvailable = await signalService.isAvailable();
    }
  } catch (error: any) {
    results.services.signal = { error: error.message };
  }

  try {
    // Test Matrix Community Service
    const { MatrixCommunityService } = await import('@/lib/community/matrix-community-service');
    const matrixService = new MatrixCommunityService();
    
    results.services.matrix = {
      isConfigured: matrixService.isConfigured(),
      platform: matrixService.platform,
      name: matrixService.name,
    };

    if (matrixService.isConfigured()) {
      results.services.matrix.isAvailable = await matrixService.isAvailable();
    }
  } catch (error: any) {
    results.services.matrix = { error: error.message };
  }

  try {
    // Test Community Manager
    const { communityServiceFactory, communityManager } = await import('@/lib/community');
    
    results.factory = {
      signalService: communityServiceFactory.getSignalService() ? 'AVAILABLE' : 'NOT AVAILABLE',
      matrixService: communityServiceFactory.getMatrixService() ? 'AVAILABLE' : 'NOT AVAILABLE',
      primaryService: communityServiceFactory.getPrimaryService()?.platform || 'NONE',
      allServices: communityServiceFactory.getAllServices().map(s => s.platform),
    };

    const availableServices = await communityManager.getAvailableServices();
    results.manager = {
      availableServices: availableServices.map(s => s.platform),
      count: availableServices.length,
    };
  } catch (error: any) {
    results.communityError = error.message;
  }

  return NextResponse.json(results);
}