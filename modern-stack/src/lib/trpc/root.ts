import { createTRPCRouter } from './trpc';
import { authRouter } from './routers/auth';
import { userRouter } from './routers/user';
import { matrixRouter } from './routers/matrix';
import { adminRouter } from './routers/admin';
import { settingsRouter } from './routers/settings';
import { inviteRouter } from './routers/invite';
import { communityRouter } from './routers/community';
import { signalRouter } from './routers/signal';

export const appRouter = createTRPCRouter({
  auth: authRouter,
  user: userRouter,
  matrix: matrixRouter,
  admin: adminRouter,
  settings: settingsRouter,
  invite: inviteRouter,
  community: communityRouter,
  signal: signalRouter,
});

export type AppRouter = typeof appRouter; 