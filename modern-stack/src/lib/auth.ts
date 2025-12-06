import { NextAuthOptions } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import { prisma } from '@/lib/prisma';
import { getSecretOrEnv } from '@/lib/secrets';
import bcrypt from 'bcryptjs';

// Cache for secrets to avoid repeated calls
let secretsCache: {
  googleClientId?: string;
  googleClientSecret?: string;
  authentikClientId?: string;
  authentikClientSecret?: string;
  authentikIssuer?: string;
} = {};

// Function to load secrets on first access
async function loadSecrets() {
  if (Object.keys(secretsCache).length > 0) {
    return secretsCache;
  }

  try {
    // Try to load from Google Cloud Secret Manager, with fallback to environment
    const [googleClientId, googleClientSecret, authentikClientId, authentikClientSecret, authentikIssuer] = await Promise.allSettled([
      getSecretOrEnv('GOOGLE_CLIENT_ID'),
      getSecretOrEnv('GOOGLE_CLIENT_SECRET'), 
      getSecretOrEnv('AUTHENTIK_CLIENT_ID'),
      getSecretOrEnv('AUTHENTIK_CLIENT_SECRET'),
      getSecretOrEnv('AUTHENTIK_ISSUER')
    ]);

    secretsCache = {
      googleClientId: googleClientId.status === 'fulfilled' ? googleClientId.value : undefined,
      googleClientSecret: googleClientSecret.status === 'fulfilled' ? googleClientSecret.value : undefined,
      authentikClientId: authentikClientId.status === 'fulfilled' ? authentikClientId.value : undefined,
      authentikClientSecret: authentikClientSecret.status === 'fulfilled' ? authentikClientSecret.value : undefined,
      authentikIssuer: authentikIssuer.status === 'fulfilled' ? authentikIssuer.value : undefined,
    };
  } catch (error) {
    console.warn('Failed to load some secrets, falling back to environment variables:', error);
    // Fallback to environment variables
    secretsCache = {
      googleClientId: process.env.GOOGLE_CLIENT_ID,
      googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authentikClientId: process.env.AUTHENTIK_CLIENT_ID,
      authentikClientSecret: process.env.AUTHENTIK_CLIENT_SECRET,
      authentikIssuer: process.env.AUTHENTIK_ISSUER,
    };
  }

  return secretsCache;
}

// Initialize secrets immediately
loadSecrets().catch(console.error);

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    // Google OAuth Provider (only if configured)
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        })]
      : []),
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
        console.log('[LOCAL AUTH] Attempting authorization for:', credentials?.username);
        
        if (!credentials?.username || !credentials?.password) {
          console.log('[LOCAL AUTH] Missing credentials');
          return null;
        }

        // Check if local auth is enabled
        if (process.env.ENABLE_LOCAL_AUTH !== 'true') {
          console.log('[LOCAL AUTH] Local auth is disabled. ENABLE_LOCAL_AUTH:', process.env.ENABLE_LOCAL_AUTH);
          return null;
        }
        
        console.log('[LOCAL AUTH] Local auth is enabled');

        // Find user by username or email
        try {
          const user = await prisma.user.findFirst({
            where: {
              OR: [
                { username: credentials.username },
                { email: credentials.username },
              ],
            },
            include: {
              groups: {
                include: {
                  group: true
                }
              },
            },
          });

          console.log('[LOCAL AUTH] User lookup result:', user ? 'User found' : 'User not found');
          
          if (!user) {
            console.log('[LOCAL AUTH] No user found for:', credentials.username);
            return null;
          }

          // For local auth, we need to check password
          // In migration, we may need to handle users without passwords
          if (user.password) {
            const isValid = await bcrypt.compare(credentials.password, user.password);
            console.log('[LOCAL AUTH] Password validation:', isValid ? 'Valid' : 'Invalid');
            if (!isValid) {
              return null;
            }
          } else {
            console.log('[LOCAL AUTH] User has no password set');
            return null;
          }

          console.log('[LOCAL AUTH] Authentication successful for:', user.username);
          
          return {
            id: user.id.toString(),
            email: user.email,
            name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
            username: user.username || undefined,
            isAdmin: user.isAdmin,
            isModerator: user.isModerator,
            groups: user.groups?.map((g: any) => g.group?.name).filter(Boolean) || [],
          };
        } catch (error) {
          console.error('[LOCAL AUTH] Error during authentication:', error);
          return null;
        }
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
    async signIn({ user, account, profile: _profile }) {
      if (account?.provider === 'google') {
        try {
          console.log('Google signIn callback:', { 
            userId: user.id, 
            email: user.email, 
            name: user.name 
          });
          
          // Check if prisma is available
          if (!prisma) {
            console.error('Prisma client not available in signIn callback');
            return false;
          }
          
          // Handle Google OAuth sign-in
          const existingUser = await prisma.user.findUnique({
            where: { email: user.email || '' },
          });

          if (!existingUser) {
            console.log('Creating new user from Google profile');
            // Create new user from Google profile
            const nameParts = user.name?.split(' ') || [];
            await prisma.user.create({
              data: {
                email: user.email || '',
                username: user.email?.split('@')[0] || `user_${Date.now()}`,
                firstName: nameParts[0] || '',
                lastName: nameParts.slice(1).join(' ') || '',
                isActive: true,
                lastLogin: new Date(),
                isAdmin: false,
                isModerator: false,
              },
            });
            console.log('Successfully created new user');
          } else {
            console.log('Updating existing user');
            // Update existing user
            await prisma.user.update({
              where: { email: user.email || '' },
              data: {
                lastLogin: new Date(),
              },
            });
            console.log('Successfully updated existing user');
          }
        } catch (error) {
          console.error('Google signIn callback error:', error);
          console.error('Error details:', {
            message: error instanceof Error ? error.message : 'Unknown error',
            userId: user.id,
            email: user.email
          });
          return false;
        }
      } else if (account?.provider === 'authentik') {
        try {
          console.log('Authentik signIn callback:', { 
            userId: user.id, 
            email: user.email, 
            username: user.username 
          });
          
          // Check if prisma is available
          if (!prisma) {
            console.error('Prisma client not available in signIn callback');
            return false;
          }
          
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
          console.error('Authentik signIn callback error:', error);
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
    async signIn({ user, account, profile: _profile }) {
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