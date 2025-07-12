import { createTRPCRouter } from './trpc';
import { authRouter } from './routers/auth';
import { userRouter } from './routers/user';
import { matrixRouter } from './routers/matrix';

export const appRouter = createTRPCRouter({
  auth: authRouter,
  user: userRouter,
  matrix: matrixRouter,
});

export type AppRouter = typeof appRouter; 