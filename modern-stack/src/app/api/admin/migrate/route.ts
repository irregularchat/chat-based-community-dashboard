import { NextRequest, NextResponse } from 'next/server';
import { execSync } from 'child_process';

export async function POST(_request: NextRequest) {
  try {
    console.log('Starting database migration...');
    console.log('Database URL available:', !!process.env.DATABASE_URL);
    
    // Generate Prisma client
    console.log('Generating Prisma client...');
    execSync('npx prisma generate', { stdio: 'inherit' });
    
    // Push database schema (creates tables if they don't exist)
    console.log('Pushing database schema...');
    execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
    
    console.log('Database migration completed successfully!');
    
    return NextResponse.json({ 
      success: true, 
      message: 'Database migration completed successfully!' 
    });
  } catch (error) {
    console.error('Migration failed:', error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}