/**
 * Database Health Monitoring and Recovery System
 * 
 * Inspired by Signal CLI corruption analysis - implements proactive
 * database monitoring, backup management, and recovery procedures.
 */

import { PrismaClient } from '../generated/prisma';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import path from 'path';

export interface DatabaseHealthStatus {
  isHealthy: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'error';
  lastHealthCheck: Date;
  queryResponseTime: number;
  activeConnections?: number;
  issues: string[];
  recommendations: string[];
}

export interface BackupStatus {
  lastBackup: Date | null;
  backupSize: number;
  backupPath: string;
  isScheduled: boolean;
  nextScheduledBackup: Date | null;
}

export class DatabaseHealthMonitor {
  private prisma: PrismaClient;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly BACKUP_RETENTION_DAYS = 7;
  private readonly HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(prismaClient: PrismaClient) {
    this.prisma = prismaClient;
  }

  /**
   * Perform comprehensive database health check
   * Tests connection, query performance, and data integrity
   */
  async checkDatabaseHealth(): Promise<DatabaseHealthStatus> {
    const startTime = Date.now();
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    let connectionStatus: 'connected' | 'disconnected' | 'error' = 'disconnected';
    let queryResponseTime = 0;

    try {
      // Test basic connectivity with a simple query
      const connectionTest = await this.prisma.$queryRaw`SELECT 1 as test`;
      connectionStatus = 'connected';
      queryResponseTime = Date.now() - startTime;
      
      // Performance checks
      if (queryResponseTime > 1000) {
        issues.push(`Slow query response time: ${queryResponseTime}ms`);
        recommendations.push('Consider connection pooling optimization');
      }

      // Test critical table access
      await this.testCriticalTables();
      
      // Check for connection pool exhaustion
      const poolStatus = await this.checkConnectionPool();
      if (poolStatus.warning) {
        issues.push(poolStatus.warning);
        recommendations.push('Monitor connection usage patterns');
      }

      // Test transaction capability
      await this.testTransactionCapability();

    } catch (error) {
      connectionStatus = 'error';
      const errorMessage = error instanceof Error ? error.message : String(error);
      issues.push(`Database connection error: ${errorMessage}`);
      
      // Specific PostgreSQL error analysis
      if (errorMessage.includes('connection terminated')) {
        recommendations.push('Check database server status and network connectivity');
      }
      if (errorMessage.includes('too many connections')) {
        recommendations.push('Increase max_connections or implement connection pooling');
      }
      if (errorMessage.includes('authentication failed')) {
        recommendations.push('Verify database credentials in DATABASE_URL');
      }
    }

    return {
      isHealthy: issues.length === 0,
      connectionStatus,
      lastHealthCheck: new Date(),
      queryResponseTime,
      issues,
      recommendations
    };
  }

  /**
   * Test access to critical application tables
   */
  private async testCriticalTables(): Promise<void> {
    const criticalTables = [
      { name: 'users', test: () => this.prisma.user.findFirst() },
      { name: 'matrix_rooms', test: () => this.prisma.matrixRoom.findFirst() },
      { name: 'signal_messages', test: () => this.prisma.signalMessage.findFirst() },
    ];

    for (const table of criticalTables) {
      try {
        await table.test();
      } catch (error) {
        throw new Error(`Critical table access failed: ${table.name} - ${error}`);
      }
    }
  }

  /**
   * Monitor connection pool status
   */
  private async checkConnectionPool(): Promise<{ warning?: string }> {
    try {
      // PostgreSQL connection monitoring query
      const result = await this.prisma.$queryRaw<Array<{ active_connections: number, max_connections: number }>>`
        SELECT 
          (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
          (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max_connections
      `;

      if (result.length > 0) {
        const { active_connections, max_connections } = result[0];
        const usage_percentage = (active_connections / max_connections) * 100;
        
        if (usage_percentage > 80) {
          return { warning: `High connection pool usage: ${usage_percentage.toFixed(1)}% (${active_connections}/${max_connections})` };
        }
      }
    } catch (error) {
      // Non-critical - some hosted databases restrict pg_stat_activity access
      console.warn('Could not check connection pool status:', error);
    }
    
    return {};
  }

  /**
   * Test database transaction capability
   */
  private async testTransactionCapability(): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Test transaction with a harmless query
        await tx.$queryRaw`SELECT 1`;
        return true;
      });
    } catch (error) {
      throw new Error(`Transaction capability test failed: ${error}`);
    }
  }

  /**
   * Create automated database backup
   */
  async createBackup(): Promise<{ success: boolean; backupPath?: string; error?: string }> {
    try {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error('DATABASE_URL not configured');
      }

      // Parse PostgreSQL URL
      const url = new URL(databaseUrl);
      const backupDir = path.join(process.cwd(), 'backups');
      
      // Ensure backup directory exists
      await fs.mkdir(backupDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `database-backup-${timestamp}.sql`);
      
      // Create PostgreSQL dump
      const pgDumpArgs = [
        '-h', url.hostname,
        '-p', url.port || '5432',
        '-U', url.username,
        '-d', url.pathname.slice(1), // Remove leading slash
        '--no-password',
        '--verbose',
        '--format=custom',
        '--file', backupPath
      ];

      await new Promise<void>((resolve, reject) => {
        const pgDump = spawn('pg_dump', pgDumpArgs, {
          env: { ...process.env, PGPASSWORD: url.password }
        });

        pgDump.stderr.on('data', (data) => {
          console.log(`pg_dump: ${data}`);
        });

        pgDump.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`pg_dump exited with code ${code}`));
          }
        });

        pgDump.on('error', reject);
      });

      // Clean up old backups
      await this.cleanupOldBackups(backupDir);

      return { success: true, backupPath };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Database backup failed:', errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get current backup status
   */
  async getBackupStatus(): Promise<BackupStatus> {
    const backupDir = path.join(process.cwd(), 'backups');
    
    try {
      const files = await fs.readdir(backupDir);
      const backupFiles = files
        .filter(file => file.startsWith('database-backup-') && file.endsWith('.sql'))
        .map(file => ({
          path: path.join(backupDir, file),
          name: file,
          timestamp: this.extractTimestampFromBackup(file)
        }))
        .filter(backup => backup.timestamp)
        .sort((a, b) => b.timestamp!.getTime() - a.timestamp!.getTime());

      if (backupFiles.length === 0) {
        return {
          lastBackup: null,
          backupSize: 0,
          backupPath: '',
          isScheduled: false,
          nextScheduledBackup: null
        };
      }

      const latestBackup = backupFiles[0];
      const stats = await fs.stat(latestBackup.path);

      return {
        lastBackup: latestBackup.timestamp!,
        backupSize: stats.size,
        backupPath: latestBackup.path,
        isScheduled: false, // TODO: Implement backup scheduling
        nextScheduledBackup: null
      };
    } catch (error) {
      console.warn('Could not get backup status:', error);
      return {
        lastBackup: null,
        backupSize: 0,
        backupPath: '',
        isScheduled: false,
        nextScheduledBackup: null
      };
    }
  }

  /**
   * Start continuous health monitoring
   */
  startHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      const health = await this.checkDatabaseHealth();
      
      if (!health.isHealthy) {
        console.error('🔴 Database health issues detected:', {
          issues: health.issues,
          recommendations: health.recommendations
        });
        
        // TODO: Implement alerting system
        // await this.sendHealthAlert(health);
      } else {
        console.log('✅ Database health check passed', {
          responseTime: health.queryResponseTime + 'ms'
        });
      }
    }, this.HEALTH_CHECK_INTERVAL_MS);

    console.log(`🔄 Database health monitoring started (every ${this.HEALTH_CHECK_INTERVAL_MS / 60000} minutes)`);
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log('⏹️ Database health monitoring stopped');
    }
  }

  /**
   * Extract timestamp from backup filename
   */
  private extractTimestampFromBackup(filename: string): Date | null {
    const match = filename.match(/database-backup-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.sql$/);
    if (match) {
      return new Date(match[1].replace(/-/g, ':').replace(/T(\d{2}):(\d{2}):(\d{2}):(\d{3})Z$/, 'T$1:$2:$3.$4Z'));
    }
    return null;
  }

  /**
   * Clean up old backup files
   */
  private async cleanupOldBackups(backupDir: string): Promise<void> {
    try {
      const files = await fs.readdir(backupDir);
      const backupFiles = files
        .filter(file => file.startsWith('database-backup-'))
        .map(file => ({
          path: path.join(backupDir, file),
          timestamp: this.extractTimestampFromBackup(file)
        }))
        .filter(backup => backup.timestamp)
        .sort((a, b) => b.timestamp!.getTime() - a.timestamp!.getTime());

      // Keep only recent backups
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.BACKUP_RETENTION_DAYS);

      const filesToDelete = backupFiles
        .filter(backup => backup.timestamp! < cutoffDate)
        .slice(5); // Always keep at least 5 backups

      for (const backup of filesToDelete) {
        await fs.unlink(backup.path);
        console.log(`🗑️ Cleaned up old backup: ${path.basename(backup.path)}`);
      }
    } catch (error) {
      console.warn('Could not clean up old backups:', error);
    }
  }

  /**
   * Get database statistics for monitoring
   */
  async getDatabaseStats(): Promise<{
    tableStats: Array<{ tableName: string; rowCount: number; size?: string }>;
    totalSize?: string;
  }> {
    try {
      // Get table statistics
      const tableStats = await Promise.all([
        this.getTableStats('users', () => this.prisma.user.count()),
        this.getTableStats('matrix_rooms', () => this.prisma.matrixRoom.count()),
        this.getTableStats('matrix_users', () => this.prisma.matrixUser.count()),
        this.getTableStats('signal_messages', () => this.prisma.signalMessage.count()),
        this.getTableStats('news_links', () => this.prisma.newsLink.count()),
        this.getTableStats('bot_command_usage', () => this.prisma.botCommandUsage.count()),
      ]);

      // Get database size (PostgreSQL specific)
      let totalSize: string | undefined;
      try {
        const sizeResult = await this.prisma.$queryRaw<Array<{ size: string }>>`
          SELECT pg_size_pretty(pg_database_size(current_database())) as size
        `;
        totalSize = sizeResult[0]?.size;
      } catch (error) {
        console.warn('Could not get database size:', error);
      }

      return { tableStats, totalSize };
    } catch (error) {
      console.error('Error getting database stats:', error);
      return { tableStats: [] };
    }
  }

  private async getTableStats(tableName: string, countFn: () => Promise<number>): Promise<{ tableName: string; rowCount: number; size?: string }> {
    try {
      const rowCount = await countFn();
      
      // Get table size (PostgreSQL specific)
      let size: string | undefined;
      try {
        const sizeResult = await this.prisma.$queryRaw<Array<{ size: string }>>`
          SELECT pg_size_pretty(pg_total_relation_size($1)) as size
        ` as any; // Using 'any' to bypass TypeScript parameter validation
        
        size = sizeResult[0]?.size;
      } catch (error) {
        // Size query might fail on some hosted databases
      }

      return { tableName, rowCount, size };
    } catch (error) {
      console.warn(`Could not get stats for table ${tableName}:`, error);
      return { tableName, rowCount: 0 };
    }
  }
}

// Export singleton instance
export const databaseHealthMonitor = new DatabaseHealthMonitor(new PrismaClient());

// Graceful shutdown handling
process.on('SIGTERM', () => {
  databaseHealthMonitor.stopHealthMonitoring();
});

process.on('SIGINT', () => {
  databaseHealthMonitor.stopHealthMonitoring();
});