import { createTRPCRouter } from './trpc';
import { authRouter } from './routers/auth';
import { userRouter } from './routers/user';
import { matrixRouter } from './routers/matrix';
import { adminRouter } from './routers/admin';
import { settingsRouter } from './routers/settings';

export const appRouter = createTRPCRouter({
  auth: authRouter,
  user: userRouter,
  matrix: matrixRouter,
  admin: adminRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter; 