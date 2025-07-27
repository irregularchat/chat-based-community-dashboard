# NextAuth.js OAuth Callback Error: State Mismatch with Authentik OIDC (Standard Fixes Not Working)

## 🚨 Problem Summary

Experiencing persistent `OAuthCallbackError: state mismatch, expected undefined, got: ` when using NextAuth.js v4.24.11 with external Authentik OIDC provider. **The issue persists despite implementing ALL standard community-recommended fixes** from GitHub discussions.

### Symptoms
- OAuth flow successfully redirects to Authentik SSO
- User authentication completes successfully on Authentik
- Callback to NextAuth fails with state mismatch error
- User remains on login page instead of being authenticated

## 🔧 Environment Details

### Versions
- **NextAuth.js**: v4.24.11 (NOT v5)
- **Next.js**: 15.3.5  
- **React**: 19.0.0
- **Database Adapter**: PrismaAdapter with PostgreSQL
- **Environment**: Docker containers, localhost:8503 (HTTP, not HTTPS)

### Provider Configuration
- **OAuth Provider**: Authentik (external OIDC)
- **Issuer**: `https://sso.irregularchat.com/application/o/chat-based-community-dashboard/`
- **Callback URL**: `http://localhost:8503/api/auth/callback/authentik`
- **Scopes**: `openid email profile`

## 🔍 Exact Error Log

```
🚨 NextAuth Error: OAUTH_CALLBACK_ERROR {
  error: Error [OAuthCallbackError]: state mismatch, expected undefined, got: 
      at Y.callback (.next/server/chunks/172.js:34:1808)
      at l (.next/server/chunks/172.js:25:25552)
      at async Object.c (.next/server/chunks/172.js:34:71902)
      at async g (.next/server/chunks/172.js:25:55706)
      at async a (.next/server/chunks/172.js:17:26759)
      at async e.length.t (.next/server/chunks/172.js:17:28202) {
    code: undefined
  },
  providerId: 'authentik'
}
```

## 💻 Current Auth Configuration

<details>
<summary>📁 src/lib/auth.ts (Click to expand)</summary>

```typescript
import { NextAuthOptions } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from './prisma';
import * as bcrypt from 'bcryptjs';

// Custom Authentik OAuth Provider
function AuthentikProvider() {
  return {
    id: 'authentik',
    name: 'Authentik',
    type: 'oauth' as const,
    clientId: process.env.AUTHENTIK_CLIENT_ID!,
    clientSecret: process.env.AUTHENTIK_CLIENT_SECRET!,
    issuer: 'https://sso.irregularchat.com/application/o/chat-based-community-dashboard/',
    authorization: {
      url: 'https://sso.irregularchat.com/application/o/authorize/',
      params: {
        scope: 'openid email profile',
      },
    },
    token: 'https://sso.irregularchat.com/application/o/token/',
    userinfo: 'https://sso.irregularchat.com/application/o/userinfo/',
    httpOptions: {
      timeout: 10000, // 10 second timeout instead of default 3.5
    },
    // ❗ COMMUNITY FIX #1: Disable PKCE and state checks
    checks: 'none' as any,
    profile(profile: any) {
      return {
        id: profile.sub,
        email: profile.email,
        name: profile.name || profile.preferred_username,
        image: profile.picture,
      };
    },
  };
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    ...(process.env.AUTHENTIK_CLIENT_ID && process.env.AUTHENTIK_CLIENT_SECRET && process.env.AUTHENTIK_ISSUER
      ? [AuthentikProvider()]
      : []),
    CredentialsProvider({
      id: 'local',
      name: 'Local',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        // Local auth implementation...
        return null;
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    // ❗ COMMUNITY FIX #2: Added redirect callback
    async redirect({ url, baseUrl }) {
      const redirectUrl = url.startsWith('/') ? new URL(url, baseUrl).toString() : baseUrl;
      return redirectUrl;
    },
    async jwt({ token, user, account }) {
      if (account) {
        token.provider = account.provider;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.sub) {
        (session.user as any).id = token.sub;
      }
      return session;
    },
    async signIn({ user, account, profile }) {
      return true; // Allow OAuth flow to complete
    },
  },
  // ❗ COMMUNITY FIX #3: Extended cookie lifetimes and localhost config
  cookies: {
    sessionToken: {
      name: 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: false, // HTTP localhost
      },
    },
    callbackUrl: {
      name: 'next-auth.callback-url',
      options: {
        sameSite: 'lax',
        path: '/',
        secure: false,
      },
    },
    csrfToken: {
      name: 'next-auth.csrf-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: false,
      },
    },
    pkceCodeVerifier: {
      name: 'next-auth.pkce.code_verifier',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: false,
        maxAge: 24 * 60 * 60, // ❗ 24 hours instead of 15 minutes
      },
    },
    state: {
      name: 'next-auth.state',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: false,
        maxAge: 24 * 60 * 60, // ❗ 24 hours instead of 15 minutes
      },
    },
    nonce: {
      name: 'next-auth.nonce',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: false,
      },
    },
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/signin',
  },
  debug: process.env.NODE_ENV === 'development',
};
```

</details>

## 🛠️ What We've Already Tried

### ✅ Standard Community Fixes Applied
Based on research from [NextAuth GitHub Discussion #7491](https://github.com/nextauthjs/next-auth/discussions/7491) and similar issues:

1. **Disabled Security Checks**: Added `checks: 'none'` to disable PKCE/state validation
2. **Extended Cookie Lifetimes**: Set `maxAge: 24 * 60 * 60` (24 hours) for both `state` and `pkceCodeVerifier` cookies
3. **Added Redirect Callback**: Implemented proper redirect handling for OAuth flows
4. **Localhost Cookie Config**: Set all cookies to `secure: false` for HTTP development
5. **Fresh Environment**: Complete Docker container rebuild with fresh database
6. **Increased HTTP Timeout**: Set `httpOptions.timeout: 10000` for slow OIDC endpoints

### 🔄 Environment Reset Steps Taken
- Stopped all containers: `docker-compose down`
- Removed volumes and rebuilt: `docker-compose up --build`
- Verified fresh database with no cached sessions
- Confirmed all environment variables are correctly set

### 📋 Verification Steps Completed
- ✅ OIDC well-known endpoint returns valid configuration
- ✅ Client credentials verified with Authentik admin panel  
- ✅ Redirect URI matches exactly: `http://localhost:8503/api/auth/callback/authentik`
- ✅ NextAuth provider endpoint responds with 302 redirect
- ✅ Authentik authentication completes successfully
- ❌ NextAuth callback fails with state mismatch

## 🎯 Expected vs Actual Behavior

### Expected
1. User clicks "Sign in with Authentik"
2. Redirects to Authentik OIDC provider
3. User authenticates successfully
4. Callback to NextAuth processes OAuth response
5. User is logged into application

### Actual  
1. ✅ User clicks "Sign in with Authentik"
2. ✅ Redirects to Authentik OIDC provider  
3. ✅ User authenticates successfully
4. ❌ Callback fails: `state mismatch, expected undefined, got: `
5. ❌ User remains on login page

## 🔬 Technical Context

### Our Tech Stack
```json
{
  "next": "15.3.5",
  "next-auth": "^4.24.11", 
  "@auth/prisma-adapter": "^2.10.0",
  "react": "^19.0.0",
  "typescript": "^5"
}
```

### Docker Environment
- **App Container**: Next.js on port 8503
- **Database**: PostgreSQL 15 with PrismaAdapter
- **Network**: Docker internal network + localhost port mapping
- **SSL**: HTTP only (development environment)

### Authentik Configuration  
- **External Provider**: Hosted at `sso.irregularchat.com`
- **Application Type**: OAuth2/OIDC
- **Client Type**: Confidential
- **Redirect URIs**: `http://localhost:8503/api/auth/callback/authentik`

## 🤝 Request for Community Help

### What We Need
Since standard fixes haven't resolved this issue, we're seeking:

1. **Advanced Debugging Techniques**: Ways to inspect OAuth state/cookie handling in detail
2. **Edge Case Solutions**: Fixes for scenarios not covered in typical discussions  
3. **NextAuth v4 Specific Issues**: Known problems with v4.24.11 and external OIDC providers
4. **Docker/Environment Issues**: Container-specific OAuth callback problems

### Questions for the Community
1. Are there known issues with NextAuth v4.24.11 and external OIDC providers?
2. Could Docker networking be interfering with cookie/state handling?
3. Are there additional debugging flags or logging we should enable?
4. Should we consider upgrading to NextAuth v5, or are there v4-specific solutions?

## 📁 Files Involved

### Configuration Files
- `src/lib/auth.ts` - NextAuth configuration with Authentik provider
- `docker-compose.yml` - Container and environment setup
- `.env` - OAuth credentials and URLs (properly configured)
- `package.json` - Dependencies including NextAuth v4.24.11

### Database Schema
- Using PrismaAdapter with NextAuth required tables (`Account`, `Session`, `User`, etc.)
- Fresh database with no existing sessions or cached state

## 🏷️ Labels
- `bug` - OAuth callback failing despite proper configuration
- `oauth` - OIDC/OAuth2 authentication flow issue  
- `nextauth` - NextAuth.js specific problem
- `help wanted` - Standard fixes not working, need community expertise
- `external-provider` - Issue with external OIDC provider (Authentik)

---

**Note**: This issue has been thoroughly researched and we've implemented all standard community fixes. We're specifically looking for advanced troubleshooting approaches or edge case solutions that go beyond the typical recommendations.
