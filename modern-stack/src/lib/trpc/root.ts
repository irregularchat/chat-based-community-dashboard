import { createTRPCRouter } from './trpc';
import { authRouter } from './routers/auth';
import { userRouter } from './routers/user';
import { matrixRouter } from './routers/matrix';
import { adminRouter } from './routers/admin';
import { settingsRouter } from './routers/settings';
import { inviteRouter } from './routers/invite';

export const appRouter = createTRPCRouter({
  auth: authRouter,
  user: userRouter,
  matrix: matrixRouter,
  admin: adminRouter,
  settings: settingsRouter,
  invite: inviteRouter,
});

export type AppRouter = typeof appRouter; 