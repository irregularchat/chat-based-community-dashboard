#!/usr/bin/env node

const { execSync } = require('child_process');

console.log('Starting database migration...');
console.log('Database URL configured:', !!process.env.DATABASE_URL);

try {
  // Generate and apply the migration
  console.log('Generating Prisma client...');
  execSync('npx prisma generate', { stdio: 'inherit' });
  
  console.log('Pushing database schema...');
  execSync('npx prisma db push', { stdio: 'inherit' });
  
  console.log('Database migration completed successfully!');
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exit(1);
}