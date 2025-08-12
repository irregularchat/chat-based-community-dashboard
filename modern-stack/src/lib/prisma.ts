import { PrismaClient } from '../generated/prisma';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Add debugging to ensure prisma is properly initialized
console.log('Prisma client initialized:', !!prisma);
console.log('Database URL available:', !!process.env.DATABASE_URL); 