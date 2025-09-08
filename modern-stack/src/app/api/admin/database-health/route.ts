import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { databaseHealthMonitor } from '@/lib/database-health';

/**
 * Database Health Check API
 * 
 * GET /api/admin/database-health - Get current database health status
 * POST /api/admin/database-health - Trigger manual health check
 */
export async function GET(request: NextRequest) {
  // Require admin authentication
  const authResult = await requireAuth(request, 'admin');
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const healthStatus = await databaseHealthMonitor.checkDatabaseHealth();
    const backupStatus = await databaseHealthMonitor.getBackupStatus();
    const databaseStats = await databaseHealthMonitor.getDatabaseStats();

    return NextResponse.json({
      success: true,
      data: {
        health: healthStatus,
        backup: backupStatus,
        stats: databaseStats,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return NextResponse.json({
      success: false,
      error: 'Failed to check database health',
      details: errorMessage
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // Require admin authentication
  const authResult = await requireAuth(request, 'admin');
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const body = await request.json();
    const action = body.action;

    switch (action) {
      case 'health_check':
        const healthStatus = await databaseHealthMonitor.checkDatabaseHealth();
        return NextResponse.json({
          success: true,
          data: healthStatus
        });

      case 'create_backup':
        const backupResult = await databaseHealthMonitor.createBackup();
        return NextResponse.json({
          success: backupResult.success,
          data: backupResult.success ? {
            message: 'Backup created successfully',
            backupPath: backupResult.backupPath
          } : undefined,
          error: backupResult.error
        });

      case 'get_stats':
        const stats = await databaseHealthMonitor.getDatabaseStats();
        return NextResponse.json({
          success: true,
          data: stats
        });

      default:
        return NextResponse.json({
          success: false,
          error: 'Invalid action'
        }, { status: 400 });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    return NextResponse.json({
      success: false,
      error: 'Database operation failed',
      details: errorMessage
    }, { status: 500 });
  }
}