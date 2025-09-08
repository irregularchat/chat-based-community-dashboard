import { spawn } from 'child_process';
import { readdir, stat, access, copyFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

export interface SignalCliHealthStatus {
  isHealthy: boolean;
  databaseIntegrity: 'ok' | 'corrupted' | 'missing';
  databaseSize: number;
  recipientCount: number;
  lastBackup?: Date;
  backupSize?: number;
  errorMessages: string[];
  recommendations: string[];
  performance: {
    integrityCheckDuration: number;
    queryResponseTime: number;
  };
}

export interface SignalCliBackupResult {
  success: boolean;
  backupPath?: string;
  backupSize?: number;
  duration: number;
  errorMessage?: string;
}

export class SignalCliHealthMonitor {
  private dataDir: string;
  private backupDir: string;

  constructor(dataDir = './signal-data', backupDir = './signal-cli-backups') {
    this.dataDir = dataDir;
    this.backupDir = backupDir;
  }

  /**
   * Comprehensive health check of Signal CLI database
   */
  async checkHealth(): Promise<SignalCliHealthStatus> {
    const status: SignalCliHealthStatus = {
      isHealthy: true,
      databaseIntegrity: 'ok',
      databaseSize: 0,
      recipientCount: 0,
      errorMessages: [],
      recommendations: [],
      performance: {
        integrityCheckDuration: 0,
        queryResponseTime: 0
      }
    };

    try {
      // Find Signal CLI database
      const dbPath = await this.findSignalDatabase();
      if (!dbPath) {
        status.isHealthy = false;
        status.databaseIntegrity = 'missing';
        status.errorMessages.push('Signal CLI database not found');
        status.recommendations.push('Initialize Signal CLI or verify data directory path');
        return status;
      }

      // Check database file stats
      const dbStats = await stat(dbPath);
      status.databaseSize = dbStats.size;

      // Test database integrity
      const integrityStart = Date.now();
      const integrityResult = await this.checkDatabaseIntegrity(dbPath);
      status.performance.integrityCheckDuration = Date.now() - integrityStart;

      if (integrityResult.isCorrupted) {
        status.isHealthy = false;
        status.databaseIntegrity = 'corrupted';
        status.errorMessages.push('Database integrity check failed');
        status.errorMessages.push(...integrityResult.errors);
        status.recommendations.push('Restore from backup immediately');
        status.recommendations.push('Check available space and database permissions');
      }

      // Test database query performance
      const queryStart = Date.now();
      const recipientCount = await this.getRecipientCount(dbPath);
      status.performance.queryResponseTime = Date.now() - queryStart;
      status.recipientCount = recipientCount;

      // Check for recent backups
      const backupInfo = await this.getLastBackupInfo();
      if (backupInfo) {
        status.lastBackup = backupInfo.date;
        status.backupSize = backupInfo.size;

        // Recommend backup if older than 24 hours
        const hoursSinceBackup = (Date.now() - backupInfo.date.getTime()) / (1000 * 60 * 60);
        if (hoursSinceBackup > 24) {
          status.recommendations.push('Create fresh backup (last backup is over 24 hours old)');
        }
      } else {
        status.recommendations.push('No backups found - create initial backup');
      }

      // Performance recommendations
      if (status.performance.queryResponseTime > 1000) {
        status.recommendations.push('Database queries are slow - consider optimizing or rebuilding database');
      }

      if (status.databaseSize > 50 * 1024 * 1024) { // 50MB
        status.recommendations.push('Database is large - monitor for performance issues');
      }

      return status;

    } catch (error) {
      status.isHealthy = false;
      status.errorMessages.push(`Health check failed: ${error}`);
      status.recommendations.push('Review Signal CLI configuration and permissions');
      return status;
    }
  }

  /**
   * Create a backup of the Signal CLI database
   */
  async createBackup(): Promise<SignalCliBackupResult> {
    const startTime = Date.now();
    const result: SignalCliBackupResult = {
      success: false,
      duration: 0
    };

    try {
      const dbPath = await this.findSignalDatabase();
      if (!dbPath) {
        result.errorMessage = 'Signal CLI database not found';
        result.duration = Date.now() - startTime;
        return result;
      }

      // Ensure backup directory exists
      await mkdir(this.backupDir, { recursive: true });

      // Create timestamped backup
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `signal-cli-backup-${timestamp}.db`;
      const backupPath = join(this.backupDir, backupFileName);

      // Copy database file
      await copyFile(dbPath, backupPath);

      // Also create SQL dump for maximum compatibility
      const sqlDumpPath = join(this.backupDir, `signal-cli-backup-${timestamp}.sql`);
      await this.createSqlDump(dbPath, sqlDumpPath);

      // Verify backup
      const backupStats = await stat(backupPath);
      
      result.success = true;
      result.backupPath = backupPath;
      result.backupSize = backupStats.size;
      result.duration = Date.now() - startTime;

      return result;

    } catch (error) {
      result.errorMessage = `Backup failed: ${error}`;
      result.duration = Date.now() - startTime;
      return result;
    }
  }

  /**
   * Find the Signal CLI database file
   */
  private async findSignalDatabase(): Promise<string | null> {
    try {
      // Look for account.db files in the data directory
      const dataPath = join(this.dataDir, 'data');
      const entries = await readdir(dataPath);
      
      for (const entry of entries) {
        const entryPath = join(dataPath, entry);
        const entryStat = await stat(entryPath);
        
        if (entryStat.isDirectory() && entry.endsWith('.d')) {
          const dbPath = join(entryPath, 'account.db');
          try {
            await access(dbPath);
            return dbPath;
          } catch {
            // Continue searching
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error finding Signal database:', error);
      return null;
    }
  }

  /**
   * Check SQLite database integrity
   */
  private async checkDatabaseIntegrity(dbPath: string): Promise<{isCorrupted: boolean, errors: string[]}> {
    try {
      const { stdout, stderr } = await execAsync(`sqlite3 "${dbPath}" "PRAGMA integrity_check;"`);
      
      if (stderr) {
        return {
          isCorrupted: true,
          errors: [`SQLite error: ${stderr}`]
        };
      }

      const result = stdout.trim();
      if (result === 'ok') {
        return { isCorrupted: false, errors: [] };
      } else {
        // Parse integrity check errors
        const errors = result.split('\n').filter(line => line && line !== 'ok');
        return {
          isCorrupted: true,
          errors: errors.slice(0, 10) // Limit to first 10 errors
        };
      }

    } catch (error) {
      return {
        isCorrupted: true,
        errors: [`Integrity check failed: ${error}`]
      };
    }
  }

  /**
   * Get count of recipients in database
   */
  private async getRecipientCount(dbPath: string): Promise<number> {
    try {
      const { stdout } = await execAsync(`sqlite3 "${dbPath}" "SELECT COUNT(*) FROM recipient;"`);
      return parseInt(stdout.trim()) || 0;
    } catch (error) {
      console.error('Error getting recipient count:', error);
      return 0;
    }
  }

  /**
   * Get information about the most recent backup
   */
  private async getLastBackupInfo(): Promise<{date: Date, size: number} | null> {
    try {
      const files = await readdir(this.backupDir);
      const backupFiles = files.filter(f => f.startsWith('signal-cli-backup-') && f.endsWith('.db'));
      
      if (backupFiles.length === 0) {
        return null;
      }

      // Sort by timestamp (newest first)
      backupFiles.sort().reverse();
      const latestBackup = backupFiles[0];
      const backupPath = join(this.backupDir, latestBackup);
      
      const stats = await stat(backupPath);
      
      // Extract timestamp from filename
      const timestampMatch = latestBackup.match(/signal-cli-backup-(.+)\.db$/);
      let backupDate = stats.mtime;
      
      if (timestampMatch) {
        try {
          // Convert back from ISO format
          const isoString = timestampMatch[1].replace(/-/g, ':').replace(/-/g, '.');
          backupDate = new Date(isoString);
        } catch {
          // Use file modification time as fallback
        }
      }

      return {
        date: backupDate,
        size: stats.size
      };
      
    } catch (error) {
      console.error('Error checking backup info:', error);
      return null;
    }
  }

  /**
   * Create SQL dump of the database
   */
  private async createSqlDump(dbPath: string, outputPath: string): Promise<void> {
    try {
      await execAsync(`sqlite3 "${dbPath}" .dump > "${outputPath}"`);
    } catch (error) {
      console.error('Error creating SQL dump:', error);
      // Don't throw - SQL dump is optional
    }
  }

  /**
   * Restore database from backup
   */
  async restoreFromBackup(backupPath: string): Promise<{success: boolean, errorMessage?: string}> {
    try {
      const dbPath = await this.findSignalDatabase();
      if (!dbPath) {
        return { success: false, errorMessage: 'Signal CLI database path not found' };
      }

      // Create backup of current corrupted database
      const corruptedBackupPath = `${dbPath}.corrupted.${Date.now()}`;
      await copyFile(dbPath, corruptedBackupPath);

      // Restore from backup
      await copyFile(backupPath, dbPath);

      // Verify restored database
      const integrityResult = await this.checkDatabaseIntegrity(dbPath);
      if (integrityResult.isCorrupted) {
        return { 
          success: false, 
          errorMessage: `Restored database is still corrupted: ${integrityResult.errors.join(', ')}` 
        };
      }

      return { success: true };

    } catch (error) {
      return { success: false, errorMessage: `Restore failed: ${error}` };
    }
  }
}

// Export singleton instance
export const signalCliHealthMonitor = new SignalCliHealthMonitor();