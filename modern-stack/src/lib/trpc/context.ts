import { type CreateNextContextOptions } from '@trpc/server/adapters/next';
import { type FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { Session } from 'next-auth';
import { headers } from 'next/headers';

interface CreateContextOptions {
  session: Session | null;
}

export const createInnerTRPCContext = ({ session }: CreateContextOptions) => {
  return {
    session,
    prisma,
  };
};

// For Next.js Pages Router
export const createTRPCContext = async ({ req: _req, res: _res }: CreateNextContextOptions) => {
  const session = await getServerSession(authOptions);

  return createInnerTRPCContext({
    session,
  });
};

// For Next.js App Router  
export const createTRPCContextApp = async ({ req }: FetchCreateContextFnOptions) => {
  try {
    // Use NextAuth's getServerSession for App Router
    const session = await getServerSession(authOptions);
    
    console.log('[tRPC Context] NextAuth session check:', {
      hasSession: !!session,
      userId: session?.user?.id || null,
    });
    
    return createInnerTRPCContext({
      session,
    });
  } catch (error) {
    console.error('[tRPC Context] Error getting session:', error);
    return createInnerTRPCContext({
      session: null,
    });
  }
};

export type Context = Awaited<ReturnType<typeof createTRPCContext>>; 