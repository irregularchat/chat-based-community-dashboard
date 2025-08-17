import { NextResponse } from 'next/server';

export async function GET() {
  const results: any = {
    timestamp: new Date().toISOString(),
    database: {},
    auth: {},
    environment: {}
  };

  try {
    // Test database connection
    const { prisma } = await import('@/lib/db');
    
    // Check if admin user exists
    const adminUser = await prisma.user.findFirst({
      where: { username: 'admin' },
      select: { id: true, username: true, isActive: true, isAdmin: true }
    });
    
    results.database.adminUserExists = !!adminUser;
    results.database.adminUser = adminUser;
    
    // Count total users
    const userCount = await prisma.user.count();
    results.database.totalUsers = userCount;
    
    // Don't disconnect global instance
    
    results.database.status = 'connected';
  } catch (error: any) {
    results.database.error = error.message;
    results.database.status = 'failed';
  }

  // Check environment variables
  results.environment = {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? 'SET' : 'NOT SET',
    ENABLE_LOCAL_AUTH: process.env.ENABLE_LOCAL_AUTH,
    DEFAULT_ADMIN_USERNAME: process.env.DEFAULT_ADMIN_USERNAME,
    DEFAULT_ADMIN_PASSWORD: process.env.DEFAULT_ADMIN_PASSWORD ? 'SET' : 'NOT SET'
  };

  return NextResponse.json(results);
}