import { NextAuthOptions } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    // Authentik OIDC Provider (only if configured)
    ...(process.env.AUTHENTIK_CLIENT_ID && process.env.AUTHENTIK_CLIENT_SECRET && process.env.AUTHENTIK_ISSUER
      ? [{
          id: 'authentik',
          name: 'Authentik',
          type: 'oauth' as const,
          clientId: process.env.AUTHENTIK_CLIENT_ID,
          clientSecret: process.env.AUTHENTIK_CLIENT_SECRET,
          issuer: process.env.AUTHENTIK_ISSUER,
          wellKnown: `${process.env.AUTHENTIK_ISSUER}/.well-known/openid-configuration`,
          authorization: {
            params: {
              scope: 'openid email profile',
            },
          },
          profile(profile: any) {
            return {
              id: profile.sub,
              email: profile.email,
              name: profile.name,
              username: profile.preferred_username,
              authentikId: profile.sub,
              firstName: profile.given_name,
              lastName: profile.family_name,
              groups: profile.groups || [],
            };
          },
        }]
      : []),
    // Local Authentication Provider
    CredentialsProvider({
      id: 'local',
      name: 'Local',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null;
        }

        // Check if local auth is enabled
        if (process.env.ENABLE_LOCAL_AUTH !== 'true') {
          return null;
        }

        // Find user by username or email
        const user = await prisma.user.findFirst({
          where: {
            OR: [
              { username: credentials.username },
              { email: credentials.username },
            ],
          },
          include: {
            groups: true,
          },
        });

        if (!user) {
          return null;
        }

        // For local auth, we need to check password
        // In migration, we may need to handle users without passwords
        if (user.password) {
          const isValid = await bcrypt.compare(credentials.password, user.password);
          if (!isValid) {
            return null;
          }
        }

        return {
          id: user.id.toString(),
          email: user.email,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          username: user.username || undefined,
          isAdmin: user.isAdmin,
          isModerator: user.isModerator,
          groups: user.groups.map((g: any) => g.group.name),
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.username = user.username;
        token.isAdmin = user.isAdmin;
        token.isModerator = user.isModerator;
        token.groups = user.groups;
        token.provider = account?.provider;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.sub!;
        session.user.username = token.username as string;
        session.user.isAdmin = token.isAdmin as boolean;
        session.user.isModerator = token.isModerator as boolean;
        session.user.groups = token.groups as string[];
        session.user.provider = token.provider as string;
      }
      return session;
    },
    async signIn({ user, account, profile }) {
      if (account?.provider === 'authentik') {
        try {
          console.log('Authentik signIn callback:', { 
            userId: user.id, 
            email: user.email, 
            username: user.username 
          });
          
          // Handle Authentik OIDC sign-in
          const existingUser = await prisma.user.findUnique({
            where: { authentikId: user.id },
          });

          if (!existingUser) {
            console.log('Creating new user from Authentik profile');
            // Create new user from Authentik profile
            await prisma.user.create({
              data: {
                authentikId: user.id,
                email: user.email || '',
                username: user.username || user.email?.split('@')[0] || `user_${Date.now()}`,
                firstName: user.firstName || '',
                lastName: user.lastName || '',
                isActive: true,
                lastLogin: new Date(),
                isAdmin: user.groups?.includes('admin') || false,
                isModerator: user.groups?.includes('moderator') || false,
              },
            });
            console.log('Successfully created new user');
          } else {
            console.log('Updating existing user');
            // Update existing user
            await prisma.user.update({
              where: { authentikId: user.id },
              data: {
                email: user.email || existingUser.email,
                firstName: user.firstName || existingUser.firstName,
                lastName: user.lastName || existingUser.lastName,
                lastLogin: new Date(),
                isAdmin: user.groups?.includes('admin') || false,
                isModerator: user.groups?.includes('moderator') || false,
              },
            });
            console.log('Successfully updated existing user');
          }
        } catch (error) {
          console.error('SignIn callback error:', error);
          console.error('Error details:', {
            message: error instanceof Error ? error.message : 'Unknown error',
            userId: user.id,
            email: user.email
          });
          return false; // This will cause the callback error page
        }
      }
      return true;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  events: {
    async signIn({ user, account, profile }) {
      // Log sign-in event
      await prisma.adminEvent.create({
        data: {
          eventType: 'user_login',
          username: user.username || user.email || 'unknown',
          details: `User signed in via ${account?.provider || 'unknown'}`,
        },
      });
    },
    async signOut({ session }) {
      // Log sign-out event
      await prisma.adminEvent.create({
        data: {
          eventType: 'user_logout',
          username: session.user.username || session.user.email || 'unknown',
          details: 'User signed out',
        },
      });
    },
  },
  debug: process.env.NODE_ENV === 'development',
}; 