#!/usr/bin/env node

/**
 * Database Maintenance Script
 * 
 * Automated database maintenance tasks based on Signal CLI corruption lessons:
 * - Health checks
 * - Backup creation
 * - Old data cleanup
 * - Performance monitoring
 * 
 * Usage:
 *   npm run db:health          - Check database health
 *   npm run db:backup          - Create backup
 *   npm run db:cleanup         - Clean old data
 *   npm run db:maintenance     - Full maintenance cycle
 */

const { PrismaClient } = require('../src/generated/prisma');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const prisma = new PrismaClient();

class DatabaseMaintenance {
  constructor() {
    this.BACKUP_RETENTION_DAYS = 7;
    this.OLD_DATA_RETENTION_DAYS = 90;
  }

  async checkHealth() {
    console.log('🔍 Checking database health...');
    
    try {
      // Test basic connectivity
      const startTime = Date.now();
      await prisma.$queryRaw`SELECT 1 as test`;
      const queryTime = Date.now() - startTime;
      
      console.log(`✅ Database connectivity: OK (${queryTime}ms)`);
      
      // Check critical tables
      const tables = [
        { name: 'users', count: await prisma.user.count() },
        { name: 'matrix_rooms', count: await prisma.matrixRoom.count() },
        { name: 'signal_messages', count: await prisma.signalMessage.count() },
        { name: 'news_links', count: await prisma.newsLink.count() },
      ];
      
      console.log('📊 Table statistics:');
      tables.forEach(table => {
        console.log(`   ${table.name}: ${table.count.toLocaleString()} records`);
      });
      
      // Performance check
      if (queryTime > 1000) {
        console.warn(`⚠️ Slow query response: ${queryTime}ms (threshold: 1000ms)`);
      }
      
      return { healthy: true, queryTime, tables };
      
    } catch (error) {
      console.error('❌ Database health check failed:', error.message);
      return { healthy: false, error: error.message };
    }
  }

  async createBackup() {
    console.log('💾 Creating database backup...');
    
    try {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error('DATABASE_URL not configured');
      }

      const url = new URL(databaseUrl);
      const backupDir = path.join(process.cwd(), 'backups');
      
      // Ensure backup directory exists
      await fs.mkdir(backupDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupDir, `database-backup-${timestamp}.sql`);
      
      console.log(`📁 Backup location: ${backupPath}`);
      
      // Create PostgreSQL dump
      const pgDumpArgs = [
        '-h', url.hostname,
        '-p', url.port || '5432',
        '-U', url.username,
        '-d', url.pathname.slice(1),
        '--no-password',
        '--verbose',
        '--format=custom',
        '--file', backupPath
      ];

      await new Promise((resolve, reject) => {
        const pgDump = spawn('pg_dump', pgDumpArgs, {
          env: { ...process.env, PGPASSWORD: url.password }
        });

        pgDump.stderr.on('data', (data) => {
          process.stdout.write(`   ${data}`);
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

      // Get backup file size
      const stats = await fs.stat(backupPath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      
      console.log(`✅ Backup created successfully: ${sizeMB} MB`);
      
      // Clean up old backups
      await this.cleanupOldBackups(backupDir);
      
      return { success: true, backupPath, size: stats.size };
      
    } catch (error) {
      console.error('❌ Database backup failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async cleanupOldData() {
    console.log('🧹 Cleaning up old data...');
    
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.OLD_DATA_RETENTION_DAYS);
      
      console.log(`🗓️ Removing data older than ${cutoffDate.toISOString().split('T')[0]}`);
      
      // Clean up old bot command usage records
      const deletedCommands = await prisma.botCommandUsage.deleteMany({
        where: {
          timestamp: {
            lt: cutoffDate
          }
        }
      });
      
      // Clean up old URL summaries
      const deletedSummaries = await prisma.urlSummary.deleteMany({
        where: {
          createdAt: {
            lt: cutoffDate
          }
        }
      });
      
      // Clean up old bot errors (keep recent for debugging)
      const errorCutoffDate = new Date();
      errorCutoffDate.setDate(errorCutoffDate.getDate() - 30); // Keep 30 days
      
      const deletedErrors = await prisma.botError.deleteMany({
        where: {
          timestamp: {
            lt: errorCutoffDate
          }
        }
      });
      
      console.log(`✅ Cleanup completed:`);
      console.log(`   📞 Bot commands: ${deletedCommands.count} records`);
      console.log(`   🔗 URL summaries: ${deletedSummaries.count} records`);
      console.log(`   ⚠️ Bot errors: ${deletedErrors.count} records`);
      
      return {
        success: true,
        deleted: {
          commands: deletedCommands.count,
          summaries: deletedSummaries.count,
          errors: deletedErrors.count
        }
      };
      
    } catch (error) {
      console.error('❌ Data cleanup failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async analyzePerformance() {
    console.log('📈 Analyzing database performance...');
    
    try {
      // Get slow queries (PostgreSQL specific)
      const slowQueries = await prisma.$queryRaw`
        SELECT 
          query,
          calls,
          total_time,
          mean_time,
          rows
        FROM pg_stat_statements 
        WHERE mean_time > 100 
        ORDER BY mean_time DESC 
        LIMIT 10
      `.catch(() => {
        console.log('   ℹ️ pg_stat_statements not available (requires extension)');
        return [];
      });
      
      if (slowQueries.length > 0) {
        console.log('🐌 Slow queries detected:');
        slowQueries.forEach((query, index) => {
          console.log(`   ${index + 1}. ${query.mean_time.toFixed(2)}ms avg - ${query.calls} calls`);
        });
      } else {
        console.log('✅ No slow queries detected');
      }
      
      // Get database size information
      const dbSize = await prisma.$queryRaw`
        SELECT pg_size_pretty(pg_database_size(current_database())) as size
      `.catch(() => [{ size: 'Unknown' }]);
      
      console.log(`💾 Database size: ${dbSize[0].size}`);
      
      // Get largest tables
      const tableSizes = await prisma.$queryRaw`
        SELECT 
          schemaname,
          tablename,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
        FROM pg_tables 
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
        LIMIT 5
      `.catch(() => []);
      
      if (tableSizes.length > 0) {
        console.log('📊 Largest tables:');
        tableSizes.forEach((table, index) => {
          console.log(`   ${index + 1}. ${table.tablename}: ${table.size}`);
        });
      }
      
      return {
        success: true,
        slowQueries: slowQueries.length,
        databaseSize: dbSize[0].size,
        largestTables: tableSizes
      };
      
    } catch (error) {
      console.error('❌ Performance analysis failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async cleanupOldBackups(backupDir) {
    try {
      const files = await fs.readdir(backupDir);
      const backupFiles = files
        .filter(file => file.startsWith('database-backup-'))
        .map(file => ({
          path: path.join(backupDir, file),
          name: file,
          timestamp: this.extractTimestampFromBackup(file)
        }))
        .filter(backup => backup.timestamp)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.BACKUP_RETENTION_DAYS);

      const filesToDelete = backupFiles
        .filter(backup => backup.timestamp < cutoffDate)
        .slice(5); // Always keep at least 5 backups

      for (const backup of filesToDelete) {
        await fs.unlink(backup.path);
        console.log(`   🗑️ Removed old backup: ${backup.name}`);
      }

      if (filesToDelete.length === 0) {
        console.log('   ✅ No old backups to clean up');
      }
    } catch (error) {
      console.warn('   ⚠️ Could not clean up old backups:', error.message);
    }
  }

  extractTimestampFromBackup(filename) {
    const match = filename.match(/database-backup-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.sql$/);
    if (match) {
      return new Date(match[1].replace(/-/g, ':').replace(/T(\d{2}):(\d{2}):(\d{2}):(\d{3})Z$/, 'T$1:$2:$3.$4Z'));
    }
    return null;
  }

  async runFullMaintenance() {
    console.log('🔧 Starting full database maintenance cycle...\n');
    
    const results = {
      health: await this.checkHealth(),
      backup: await this.createBackup(),
      cleanup: await this.cleanupOldData(),
      performance: await this.analyzePerformance()
    };
    
    console.log('\n📋 Maintenance Summary:');
    console.log(`   Health Check: ${results.health.healthy ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Backup: ${results.backup.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`   Cleanup: ${results.cleanup.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`   Performance: ${results.performance.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    
    return results;
  }
}

// Command line interface
async function main() {
  const command = process.argv[2];
  const maintenance = new DatabaseMaintenance();
  
  try {
    switch (command) {
      case 'health':
        await maintenance.checkHealth();
        break;
      case 'backup':
        await maintenance.createBackup();
        break;
      case 'cleanup':
        await maintenance.cleanupOldData();
        break;
      case 'performance':
        await maintenance.analyzePerformance();
        break;
      case 'maintenance':
      default:
        await maintenance.runFullMaintenance();
        break;
    }
  } catch (error) {
    console.error('❌ Maintenance operation failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = DatabaseMaintenance;