# Database Schema Fix Plan

## Problem Analysis
- Database schema is out of sync with Prisma schema
- Missing columns: `community_bookmarks.icon`, `dashboard_announcements.type`
- No proper migration system causing schema drift
- Configuration saving fails due to schema mismatches

## Proper Solution: Prisma Migrate

### Phase 1: Initialize Migration System
1. **Baseline Current Database**
   ```bash
   npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > baseline.sql
   npx prisma migrate resolve --applied baseline_migration
   ```

2. **Create Migration Directory Structure**
   ```bash
   npx prisma migrate dev --create-only --name init
   ```

### Phase 2: Schema Synchronization
1. **Create Migration for Missing Columns**
   ```sql
   ALTER TABLE "community_bookmarks" ADD COLUMN "icon" TEXT;
   ALTER TABLE "dashboard_announcements" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'info';
   ```

2. **Apply Migration**
   ```bash
   npx prisma migrate deploy
   ```

3. **Regenerate Prisma Client**
   ```bash
   npx prisma generate
   ```

### Phase 3: Production Deployment
1. **Create Migration Endpoint**
   - Safe migration API that runs `prisma migrate deploy`
   - Includes rollback capability
   - Logs all migration activities

2. **Deploy Strategy**
   - Deploy code with migration endpoint
   - Run migration via API call
   - Verify schema synchronization
   - Test configuration saving

### Phase 4: Environment Auto-Population
1. **Fix tRPC Settings Router**
   - Add proper environment variable mapping
   - Create initialization endpoint
   - Handle bulk setting updates

2. **Frontend Integration**
   - Auto-load environment variables on page load
   - Proper error handling and user feedback
   - Save/load configuration state

## Implementation Steps

### Step 1: Create Proper Migration Files
```bash
cd modern-stack
npx prisma migrate dev --create-only --name add_missing_columns
```

### Step 2: Write Migration SQL
```sql
-- Add missing columns with proper defaults
ALTER TABLE "community_bookmarks" ADD COLUMN IF NOT EXISTS "icon" TEXT;
ALTER TABLE "dashboard_announcements" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'info';

-- Ensure all tables match schema.prisma exactly
-- Add any other missing columns or constraints
```

### Step 3: Create Migration Deployment Endpoint
```typescript
// /api/admin/migrate-schema
export async function POST() {
  try {
    // Run prisma migrate deploy
    const result = await exec('npx prisma migrate deploy');
    
    // Regenerate client
    await exec('npx prisma generate');
    
    return { success: true, result };
  } catch (error) {
    return { success: false, error };
  }
}
```

### Step 4: Environment Variable Auto-Population
```typescript
// Enhanced settings router with env population
initializeFromEnv: adminProcedure.mutation(async ({ ctx }) => {
  const envMappings = {
    'nextauth_url': process.env.NEXTAUTH_URL,
    'authentik_client_id': process.env.AUTHENTIK_CLIENT_ID,
    // ... all environment variables
  };

  const updates = await Promise.all(
    Object.entries(envMappings)
      .filter(([_, value]) => value)
      .map(([key, value]) => 
        ctx.prisma.dashboardSettings.upsert({
          where: { key },
          update: { value },
          create: { key, value }
        })
      )
  );

  return { success: true, initialized: updates.length };
});
```

## Rollback Plan
1. Keep backup of current database state
2. Document all applied changes
3. Create rollback migration if needed
4. Test rollback in staging environment

## Testing Strategy
1. **Local Testing**
   - Run migrations on local database
   - Test configuration saving
   - Verify all endpoints work

2. **Staging Testing**
   - Deploy to test environment
   - Run full migration process
   - Test with production-like data

3. **Production Deployment**
   - Deploy during low-traffic period
   - Monitor logs during migration
   - Verify functionality post-migration

## Success Criteria
- [ ] All Prisma queries execute without schema errors
- [ ] Configuration saving works without errors
- [ ] Environment variables auto-populate in admin interface
- [ ] No data loss during migration process
- [ ] All existing functionality continues to work