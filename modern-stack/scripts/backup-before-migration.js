#!/usr/bin/env node

/**
 * Pre-Migration Backup Script
 * 
 * Creates comprehensive backups of both SQLite and PostgreSQL databases
 * before performing any migration operations to ensure data safety.
 */

const { PrismaClient } = require('../src/generated/prisma');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

const prisma = new PrismaClient();

class PreMigrationBackup {
  constructor() {
    this.backupDir = path.join(process.cwd(), 'migration-backups');
    this.timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  }

  async createFullBackup() {
    console.log('💾 Creating pre-migration backup...');
    
    try {
      // Create backup directory
      await fs.mkdir(this.backupDir, { recursive: true });
      
      // Backup PostgreSQL database
      const pgBackupResult = await this.backupPostgreSQL();
      
      // Backup SQLite databases
      const sqliteBackups = await this.backupSQLiteDatabases();
      
      // Create backup manifest
      await this.createBackupManifest({
        postgresql: pgBackupResult,
        sqlite: sqliteBackups
      });
      
      console.log(`✅ Pre-migration backup completed`);
      console.log(`📁 Backup location: ${this.backupDir}`);
      
      return {
        success: true,
        backupDir: this.backupDir,
        postgresql: pgBackupResult,
        sqlite: sqliteBackups
      };
      
    } catch (error) {
      console.error('❌ Backup failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  async backupPostgreSQL() {
    console.log('📊 Backing up PostgreSQL database...');
    
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL not configured');
    }

    const url = new URL(databaseUrl);
    const backupPath = path.join(this.backupDir, `postgresql-pre-migration-${this.timestamp}.sql`);
    
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
    console.log(`   ✅ PostgreSQL backup: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
    
    return {
      path: backupPath,
      size: stats.size,
      timestamp: new Date().toISOString()
    };
  }

  async backupSQLiteDatabases() {
    console.log('🗃️ Backing up SQLite databases...');
    
    // Find all SQLite databases
    const sqliteFiles = [
      'data/signal-bot.db',
      // Add other SQLite files as needed
    ].filter(async (file) => {
      try {
        await fs.access(file);
        return true;
      } catch {
        return false;
      }
    });

    const backups = [];
    
    for (const sqliteFile of sqliteFiles) {
      try {
        await fs.access(sqliteFile);
        
        const backupPath = path.join(
          this.backupDir, 
          `sqlite-${path.basename(sqliteFile, '.db')}-${this.timestamp}.db`
        );
        
        // Copy SQLite database file
        await fs.copyFile(sqliteFile, backupPath);
        
        // Get file size
        const stats = await fs.stat(backupPath);
        
        console.log(`   ✅ ${sqliteFile}: ${(stats.size / 1024).toFixed(2)} KB`);
        
        backups.push({
          source: sqliteFile,
          backup: backupPath,
          size: stats.size,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        console.warn(`   ⚠️ Could not backup ${sqliteFile}: ${error.message}`);
      }
    }
    
    return backups;
  }

  async createBackupManifest(backupData) {
    const manifest = {
      timestamp: new Date().toISOString(),
      purpose: 'Pre-migration backup',
      databases: backupData,
      environment: {
        nodeVersion: process.version,
        databaseUrl: process.env.DATABASE_URL?.replace(/:\/\/[^@]+@/, '://***:***@'), // Mask credentials
        pwd: process.cwd()
      }
    };
    
    const manifestPath = path.join(this.backupDir, `backup-manifest-${this.timestamp}.json`);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    
    console.log(`📋 Backup manifest: ${manifestPath}`);
    return manifestPath;
  }

  async validateBackups(backupResult) {
    console.log('🔍 Validating backups...');
    
    // Validate PostgreSQL backup
    if (backupResult.postgresql) {
      try {
        const stats = await fs.stat(backupResult.postgresql.path);
        if (stats.size === 0) {
          throw new Error('PostgreSQL backup file is empty');
        }
        console.log('   ✅ PostgreSQL backup validated');
      } catch (error) {
        console.error('   ❌ PostgreSQL backup validation failed:', error.message);
      }
    }
    
    // Validate SQLite backups
    for (const sqliteBackup of backupResult.sqlite) {
      try {
        const stats = await fs.stat(sqliteBackup.backup);
        if (stats.size === 0) {
          throw new Error(`SQLite backup file is empty: ${sqliteBackup.backup}`);
        }
        console.log(`   ✅ ${path.basename(sqliteBackup.backup)} validated`);
      } catch (error) {
        console.error(`   ❌ SQLite backup validation failed: ${error.message}`);
      }
    }
  }
}

// Command line interface
async function main() {
  const backup = new PreMigrationBackup();
  
  try {
    const result = await backup.createFullBackup();
    
    if (result.success) {
      await backup.validateBackups(result);
      console.log('\n🎯 Ready for migration!');
      console.log('Next steps:');
      console.log('1. Run migration: node scripts/migrate-from-sqlite.js --source=data/signal-bot.db --dry-run');
      console.log('2. Review migration plan');
      console.log('3. Execute migration: node scripts/migrate-from-sqlite.js --source=data/signal-bot.db');
    }
    
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error('❌ Pre-migration backup failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}

module.exports = PreMigrationBackup;