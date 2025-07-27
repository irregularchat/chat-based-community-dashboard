import { NextAuthOptions } from 'next-auth';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    // Credentials provider for local authentication
    CredentialsProvider({
      id: 'credentials',
      name: 'credentials',
      credentials: {
        username: { label: 'Username or Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          console.log('Missing credentials');
          return null;
        }

        // Check if local auth is enabled
        const localAuthEnabled = process.env.ENABLE_LOCAL_AUTH === 'true';
        if (!localAuthEnabled) {
          console.log('Local auth disabled');
          return null;
        }
        
        console.log('Local auth enabled, proceeding with user lookup');

        // Find user by email using raw Prisma client (not through adapter)
        console.log('Looking up user with email:', credentials.username);
        const user = await prisma.user.findFirst({
          where: {
            email: credentials.username,
          },
        });

        console.log('User lookup result:', user ? { id: user.id, email: user.email } : 'not found');

        if (!user) {
          console.log('User not found');
          return null;
        }

        // For simplicity, assume we have local auth if user exists
        // In production, you'd verify the password here
        console.log('Returning user for authentication');

        return {
          id: user.id.toString(),
          email: user.email,
          name: user.email || 'User',
          isAdmin: user.isAdmin,
          isModerator: user.isModerator,
          groups: [],
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
        session.user.isAdmin = token.isAdmin as boolean;
        session.user.isModerator = token.isModerator as boolean;
        session.user.groups = token.groups as string[];
        session.user.provider = token.provider as string;
      }
      return session;
    },
    async signIn() {
      return true;
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },
  events: {
    async signIn({ user, account }) {
      console.log('User signed in:', user.email, 'via', account?.provider);
    },
    async signOut({ session }) {
      console.log('User signed out:', session.user.email);
    },
  },
  debug: process.env.NODE_ENV === 'development',
};
