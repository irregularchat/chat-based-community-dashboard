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

export const prisma = new PrismaClient({
  log: ['error', 'warn'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Add debugging to ensure prisma is properly initialized
console.log('Prisma client initialized:', !!prisma);
console.log('Database URL:', process.env.DATABASE_URL?.includes('localhost') ? 'Using local database' : 'Using Cloud SQL'); 