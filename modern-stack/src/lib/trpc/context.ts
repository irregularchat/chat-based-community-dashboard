import { type CreateNextContextOptions } from '@trpc/server/adapters/next';
import { type FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { Session } from 'next-auth';

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
export const createTRPCContextApp = async ({ req: _req }: FetchCreateContextFnOptions) => {
  const session = await getServerSession(authOptions);

  return createInnerTRPCContext({
    session,
  });
};

export type Context = Awaited<ReturnType<typeof createTRPCContext>>; 