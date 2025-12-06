import { PrismaClient } from '../generated/prisma';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Force re-initialization of Prisma client with current DATABASE_URL
// This ensures we use the correct database connection
if (globalForPrisma.prisma) {
  globalForPrisma.prisma.$disconnect().catch(() => {});
  globalForPrisma.prisma = undefined;
}

// Enhanced Prisma configuration based on Signal CLI corruption lessons
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error', 'warn'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  // Connection pool configuration for reliability
  __internal: {
    engine: {
      // Connection pool settings to prevent "too many connections" errors
      connectionLimit: parseInt(process.env.DATABASE_CONNECTION_LIMIT || '10'),
      // Timeout settings to handle slow queries gracefully
      queryTimeout: parseInt(process.env.DATABASE_QUERY_TIMEOUT || '10000'),
    },
  },
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Enhanced initialization with health monitoring
async function initializePrisma() {
  try {
    // Test database connection on startup
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Database connection established successfully');
    
    // Log database configuration
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl?.includes('localhost')) {
      console.log('🏠 Using local database');
    } else if (dbUrl?.includes('postgres')) {
      console.log('☁️ Using PostgreSQL database');
    } else {
      console.log('📊 Database connection configured');
    }

    // Start health monitoring in production
    if (process.env.NODE_ENV === 'production') {
      const { databaseHealthMonitor } = await import('./database-health');
      
      // Perform initial health check
      const health = await databaseHealthMonitor.checkDatabaseHealth();
      if (!health.isHealthy) {
        console.warn('⚠️ Database health issues detected on startup:', health.issues);
      }
      
      // Start continuous monitoring
      databaseHealthMonitor.startHealthMonitoring();
    }
    
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    
    // Specific error handling based on Signal CLI lessons
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes('database') && errorMessage.includes('does not exist')) {
      console.error('💡 Solution: Run "npx prisma db push" or "npx prisma migrate deploy"');
    }
    
    if (errorMessage.includes('authentication failed')) {
      console.error('💡 Solution: Check DATABASE_URL credentials in .env.local');
    }
    
    if (errorMessage.includes('connection refused')) {
      console.error('💡 Solution: Ensure PostgreSQL server is running and accessible');
    }
    
    // Don't exit in development, but log the issue
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
}

// Initialize database connection
initializePrisma();

// Graceful shutdown handling
const gracefulShutdown = async () => {
  console.log('🔄 Gracefully shutting down database connections...');
  try {
    await prisma.$disconnect();
    console.log('✅ Database connections closed successfully');
  } catch (error) {
    console.error('❌ Error during database shutdown:', error);
  }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Export enhanced Prisma client
export { prisma }; 