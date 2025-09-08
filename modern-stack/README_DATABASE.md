# Database Management and Reliability

This document outlines the database architecture and reliability improvements implemented based on Signal CLI corruption analysis and lessons learned.

## Architecture Overview

### Database Technology
- **PostgreSQL**: Production-grade relational database
- **Prisma ORM**: Type-safe database access with migrations
- **Connection Pooling**: Automatic connection management
- **Health Monitoring**: Proactive issue detection

### Why PostgreSQL Over SQLite

Based on the Signal CLI SQLite corruption analysis, PostgreSQL provides:

1. **Superior Corruption Resistance**
   - No single-file corruption risks
   - WAL mode without btree page corruption issues
   - ACID transactions with better recovery
   - Built-in replication and backup tools

2. **Production Scalability**
   - Connection pooling to prevent "too many connections" errors
   - Concurrent read/write operations
   - Advanced indexing and query optimization
   - Row-level locking instead of database-level locks

3. **Monitoring and Maintenance**
   - Built-in performance statistics (`pg_stat_statements`)
   - Connection monitoring (`pg_stat_activity`)
   - Database size and table analysis tools
   - Professional backup and restore utilities

## Database Health Monitoring

### Automated Health Checks

The system performs comprehensive health monitoring:

```typescript
// Health check includes:
- Connection availability testing
- Query performance measurement
- Critical table access verification
- Connection pool usage monitoring
- Transaction capability testing
```

### Health Check API

```bash
# Check database health via API
curl -X GET http://localhost:3000/api/admin/database-health \
  -H "Authorization: Bearer <admin-token>"

# Trigger manual backup
curl -X POST http://localhost:3000/api/admin/database-health \
  -H "Content-Type: application/json" \
  -d '{"action": "create_backup"}'
```

### Monitoring Thresholds

- **Query Response Time**: > 1000ms triggers warning
- **Connection Pool Usage**: > 80% triggers alert
- **Health Check Frequency**: Every 5 minutes in production

## Backup System

### Automated Backups

```bash
# Create manual backup
npm run db:backup

# Backup retention policy
- Keep all backups for 7 days
- Always maintain at least 5 recent backups
- Automatic cleanup of old backups
```

### Backup Format

- **PostgreSQL Custom Format**: Efficient, compressed backups
- **Metadata Preserved**: Schemas, indexes, constraints
- **Point-in-Time Recovery**: Transaction-consistent snapshots

### Restore Procedures

```bash
# Restore from backup (example)
pg_restore -h hostname -p 5432 -U username -d database_name backup_file.sql

# For local development
pg_restore -h localhost -p 5432 -U dashboarduser -d dashboarddb backup_file.sql
```

## Maintenance Scripts

### Database Maintenance Commands

```bash
# Health check
npm run db:health          # Check database connectivity and performance

# Backup operations  
npm run db:backup          # Create database backup

# Data cleanup
npm run db:cleanup         # Remove old analytics data (90+ days)

# Performance analysis
npm run db:performance     # Analyze slow queries and table sizes

# Full maintenance cycle
npm run db:maintenance     # Run all maintenance tasks
```

### Automated Cleanup

The system automatically removes:
- Bot command usage records > 90 days old
- URL summaries > 90 days old  
- Bot error logs > 30 days old (shorter retention for debugging)

## Configuration

### Environment Variables

```env
# Database connection
DATABASE_URL="postgresql://user:password@localhost:5432/database"

# Connection pool settings (optional)
DATABASE_CONNECTION_LIMIT=10        # Max connections per instance
DATABASE_QUERY_TIMEOUT=10000        # Query timeout in milliseconds
```

### Connection Pool Configuration

```typescript
// Prisma client configuration
new PrismaClient({
  __internal: {
    engine: {
      connectionLimit: parseInt(process.env.DATABASE_CONNECTION_LIMIT || '10'),
      queryTimeout: parseInt(process.env.DATABASE_QUERY_TIMEOUT || '10000'),
    }
  }
});
```

## Error Handling and Recovery

### Common Issues and Solutions

#### Connection Errors
```
Error: "connection refused"
Solution: Ensure PostgreSQL server is running
Command: brew services start postgresql (macOS)
```

#### Authentication Errors
```
Error: "authentication failed"
Solution: Verify DATABASE_URL credentials
Check: Username, password, hostname, database name
```

#### Migration Errors
```
Error: "database does not exist"
Solution: Run database migrations
Command: npx prisma db push or npx prisma migrate deploy
```

### Recovery Procedures

1. **Database Connection Issues**
   ```bash
   # Check database status
   npm run db:health
   
   # Verify configuration
   echo $DATABASE_URL
   ```

2. **Data Corruption (Rare in PostgreSQL)**
   ```bash
   # Create emergency backup
   npm run db:backup
   
   # Check integrity (PostgreSQL specific)
   psql -c "SELECT * FROM pg_catalog.pg_database;" 
   ```

3. **Performance Degradation**
   ```bash
   # Analyze performance
   npm run db:performance
   
   # Check slow queries and table sizes
   # Review connection pool usage
   ```

## Monitoring Integration

### Production Monitoring

The system includes:
- **Startup Health Checks**: Verify database connectivity on application start
- **Continuous Monitoring**: Background health checks every 5 minutes
- **Graceful Shutdown**: Proper connection cleanup on process termination
- **Error Reporting**: Detailed error messages with solution suggestions

### Alerting (Planned)

Future monitoring improvements:
- Slack/Discord notifications for health issues
- Metrics collection (Prometheus/Grafana)
- Dashboard for database statistics
- Automated failover procedures

## Best Practices

### Development
1. Always run `npm run db:health` after major changes
2. Create backups before destructive operations
3. Use transactions for multi-step operations
4. Monitor query performance during development

### Production
1. Schedule regular backups (daily recommended)
2. Monitor connection pool usage
3. Set up alerting for health check failures
4. Keep backup retention policy appropriate for business needs

### Security
- Use connection pooling to prevent connection exhaustion attacks
- Implement query timeouts to prevent long-running queries
- Regular security updates for PostgreSQL
- Restrict database access to application servers only

## Migration from SQLite

We provide comprehensive migration tools to safely move data from SQLite to PostgreSQL while preserving data integrity and relationships.

### Current Status
✅ **PostgreSQL Active**: Your application is already using PostgreSQL successfully  
✅ **Legacy SQLite Analysis**: Old `data/signal-bot.db` contains no data to migrate  
✅ **Migration Tools Ready**: Complete migration infrastructure implemented

### Migration Scripts

#### 1. Pre-Migration Backup
Always create backups before any migration:
```bash
npm run db:backup-before-migration
```
This creates comprehensive backups of both PostgreSQL and SQLite databases with validation.

#### 2. Migration Analysis (Dry Run)
Analyze what would be migrated without making changes:
```bash
npm run db:migrate-from-sqlite -- --source=path/to/sqlite.db --dry-run
```

#### 3. Execute Migration
Migrate specific tables or entire databases:
```bash
# Full migration
npm run db:migrate-from-sqlite -- --source=path/to/sqlite.db

# Single table migration
npm run db:migrate-from-sqlite -- --source=path/to/sqlite.db --table=users
```

### Migration Features

#### Intelligent Table Mapping
The migration system automatically maps SQLite tables to PostgreSQL/Prisma models:

```typescript
// Example: SQLite message_history -> PostgreSQL signal_messages
'message_history': {
  targetTable: 'signal_messages',
  model: 'signalMessage',
  fieldMappings: {
    'id': 'id',
    'timestamp': 'timestamp',
    'sender': 'sourceNumber',
    'message': 'message',
    'group_id': 'groupId',
    'created_at': 'createdAt'
  },
  transforms: {
    'timestamp': (value) => BigInt(value), // Signal timestamps
    'group_id': (value) => value || null,
    'created_at': (value) => new Date(value)
  }
}
```

#### Data Validation and Transformation
- **Type Conversion**: Automatic conversion of SQLite types to PostgreSQL
- **Constraint Handling**: Respects foreign keys and unique constraints
- **Data Cleaning**: Handles null values and invalid data gracefully
- **Relationship Preservation**: Maintains referential integrity

#### Safety Features
- **Dry Run Mode**: Preview changes before execution
- **Transaction Safety**: All operations wrapped in transactions
- **Error Handling**: Continues migration even if individual records fail
- **Rollback Capability**: Easy restoration from backups
- **Migration Reports**: Detailed logs of all operations

### Migration Workflow

#### Step 1: Assessment
```bash
# Check current database status
npm run db:health

# Analyze SQLite database structure  
sqlite3 old-database.db ".tables"
sqlite3 old-database.db ".schema"
```

#### Step 2: Backup
```bash
# Create comprehensive pre-migration backups
npm run db:backup-before-migration
```

#### Step 3: Planning  
```bash
# Dry run to see migration plan
npm run db:migrate-from-sqlite -- --source=old-database.db --dry-run
```

#### Step 4: Execution
```bash
# Execute migration
npm run db:migrate-from-sqlite -- --source=old-database.db
```

#### Step 5: Validation
```bash
# Verify migration success
npm run db:health
npm run db:performance

# Check record counts match expectations
```

### Migration Report Example

```bash
📊 Migration Summary:
==================================================
message_history:
   Migrated: 1,250
   Skipped: 0
   Total: 1,250

users:
   Migrated: 500
   Skipped: 0
   Total: 500

sessions:
   Migrated: 0
   Skipped: 0
   Total: 0 (NextAuth handles sessions differently)

------------------------------
Total Migrated: 1,750
Total Skipped: 0
```

### Troubleshooting Migration Issues

#### Common Migration Problems

1. **Schema Mismatch**
   ```
   Error: Column 'xyz' doesn't exist in target table
   Solution: Update field mappings in migrate-from-sqlite.js
   ```

2. **Data Type Conflicts**
   ```
   Error: Cannot convert SQLite INTEGER to PostgreSQL BIGINT
   Solution: Add transform function for the field
   ```

3. **Constraint Violations**
   ```
   Error: Unique constraint violated
   Solution: Clean duplicate data or adjust mapping logic
   ```

4. **Large Dataset Performance**
   ```
   Issue: Migration taking too long
   Solution: Use --table= flag to migrate tables individually
   ```

### Recovery Procedures

If migration fails or needs to be reversed:

#### 1. Restore from Pre-Migration Backup
```bash
# Restore PostgreSQL from backup
pg_restore -h hostname -p 5432 -U username -d database_name backup.sql

# Or for local development
pg_restore -h localhost -p 5432 -U dashboarduser -d dashboarddb backup.sql
```

#### 2. Reset and Retry
```bash
# Reset database to clean state
npm run db:reset

# Re-run migration with corrections
npm run db:migrate-from-sqlite -- --source=corrected-database.db
```

### Advanced Migration Options

#### Custom Field Transforms
Add custom data transformation logic:

```typescript
transforms: {
  'old_timestamp': (value) => new Date(value * 1000), // Unix timestamp to Date
  'json_field': (value) => JSON.parse(value || '{}'), // String to JSON
  'enum_field': (value) => value.toLowerCase(),       // Normalize case
}
```

#### Skip Problem Tables
Skip tables that don't need migration:

```typescript
'problem_table': {
  skip: true,
  reason: 'Data no longer needed in new system'
}
```

#### Batch Processing
For large datasets, process in batches:

```bash
# Migrate specific table only
npm run db:migrate-from-sqlite -- --source=large.db --table=big_table
```

This migration system ensures safe, reliable data transfer from any SQLite database to your PostgreSQL infrastructure while maintaining the improved reliability and monitoring capabilities.

## Lessons from Signal CLI Corruption

Key insights applied to this system:

1. **Single File Risk**: PostgreSQL avoids SQLite's single-file corruption risk
2. **WAL Mode Issues**: PostgreSQL's WAL implementation is more robust
3. **Connection Pooling**: Prevents "too many connections" errors
4. **Health Monitoring**: Proactive detection vs reactive recovery
5. **Backup Strategy**: Automated, tested backup and restore procedures
6. **Graceful Shutdown**: Proper connection cleanup prevents corruption

This database management system provides enterprise-grade reliability while maintaining the simplicity needed for rapid development.