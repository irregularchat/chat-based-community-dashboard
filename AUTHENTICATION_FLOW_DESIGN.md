# Authentication Flow Design: NextAuth.js Implementation

## Overview

This document outlines the complete authentication flow design for migrating from Streamlit's session-based authentication to a modern NextAuth.js implementation. The new system will support multiple authentication providers while maintaining all existing functionality.

## Current Authentication Analysis

### Current System Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Streamlit     │    │   Session       │    │   Authentik     │
│   Frontend      │◄──►│   State         │◄──►│   OIDC          │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Cookie        │    │   Local Auth    │    │   Database      │
│   Storage       │    │   (Admin)       │    │   Users         │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Current Features
- **Multiple Providers**: OIDC (Authentik) and Local Authentication
- **Session Management**: Streamlit session state with cookie persistence
- **Role-based Access**: Admin, Moderator, Regular User roles
- **Group Integration**: Authentik group membership
- **Persistent Sessions**: Cookie-based session restoration
- **Fallback Authentication**: Local admin authentication when OIDC fails

### Current Limitations
- **Session Instability**: Sessions lost on page refresh
- **No SSR Support**: Client-side only authentication
- **Limited Security**: Basic session management
- **Complex State Management**: Manual session restoration
- **No Token Refresh**: Sessions expire without renewal

## Modern Authentication Architecture

### NextAuth.js Architecture
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Next.js       │    │   NextAuth.js   │    │   Authentik     │
│   App Router    │◄──►│   Session       │◄──►│   OIDC          │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   JWT Tokens    │    │   Credentials   │    │   Prisma        │
│   HTTP-Only     │    │   Provider      │    │   Database      │
│   Cookies       │    │   (Local)       │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Modern Features
- **Server-Side Sessions**: Full SSR support
- **Automatic Token Refresh**: JWT token renewal
- **Secure Cookies**: HTTP-only, signed cookies
- **Multiple Providers**: OIDC, Credentials, and extensible
- **Middleware Protection**: Route-level authentication
- **Type Safety**: Full TypeScript support

## NextAuth.js Configuration

### Main Configuration
```typescript
// app/api/auth/[...nextauth]/route.ts
import NextAuth from 'next-auth'
import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import { prisma } from '@/lib/prisma'
import { validateCredentials, createUser } from '@/lib/auth'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    // OIDC Provider (Authentik)
    {
      id: 'authentik',
      name: 'Authentik',
      type: 'oauth',
      clientId: process.env.AUTHENTIK_CLIENT_ID!,
      clientSecret: process.env.AUTHENTIK_CLIENT_SECRET!,
      issuer: process.env.AUTHENTIK_ISSUER!,
      authorization: {
        params: {
          scope: 'openid profile email groups',
          response_type: 'code',
          redirect_uri: process.env.AUTHENTIK_REDIRECT_URI!
        }
      },
      token: {
        url: `${process.env.AUTHENTIK_ISSUER}/application/o/token/`,
      },
      userinfo: {
        url: `${process.env.AUTHENTIK_ISSUER}/application/o/userinfo/`,
      },
      profile: async (profile, tokens) => {
        // Get user groups from Authentik
        const groups = await fetchAuthentikGroups(tokens.access_token)
        
        // Determine user roles
        const isAdmin = groups.some(g => g.name === 'admin')
        const isModerator = groups.some(g => g.name === 'moderator')
        
        return {
          id: profile.sub,
          username: profile.preferred_username,
          email: profile.email,
          name: profile.name,
          image: profile.picture,
          role: isAdmin ? 'admin' : isModerator ? 'moderator' : 'user',
          groups: groups.map(g => g.name),
          authentikId: profile.sub,
          isAdmin,
          isModerator
        }
      }
    },
    
    // Local Credentials Provider
    CredentialsProvider({
      id: 'credentials',
      name: 'Local Account',
      credentials: {
        username: { label: 'Username', type: 'text' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) {
          return null
        }
        
        const user = await validateCredentials(
          credentials.username,
          credentials.password
        )
        
        if (!user) {
          return null
        }
        
        return {
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.fullName,
          role: user.isAdmin ? 'admin' : user.isModerator ? 'moderator' : 'user',
          isAdmin: user.isAdmin,
          isModerator: user.isModerator,
          authMethod: 'local'
        }
      }
    })
  ],
  
  callbacks: {
    async signIn({ user, account, profile }) {
      // Create or update user in database
      try {
        if (account?.provider === 'authentik') {
          // Handle OIDC sign-in
          await createOrUpdateAuthentikUser(user, profile)
        } else if (account?.provider === 'credentials') {
          // Handle local sign-in
          await updateUserLastLogin(user.id)
        }
        return true
      } catch (error) {
        console.error('Sign-in error:', error)
        return false
      }
    },
    
    async jwt({ token, user, account, trigger, session }) {
      // Initial sign-in
      if (user) {
        token.role = user.role
        token.isAdmin = user.isAdmin
        token.isModerator = user.isModerator
        token.username = user.username
        token.authMethod = user.authMethod || account?.provider
        token.groups = user.groups || []
      }
      
      // Handle session updates
      if (trigger === 'update' && session) {
        token.role = session.role
        token.isAdmin = session.isAdmin
        token.isModerator = session.isModerator
      }
      
      // Token refresh for OIDC
      if (account?.provider === 'authentik' && account.refresh_token) {
        token.refreshToken = account.refresh_token
        token.accessToken = account.access_token
        token.expiresAt = account.expires_at
      }
      
      return token
    },
    
    async session({ session, token }) {
      // Add custom fields to session
      if (token) {
        session.user.id = token.sub!
        session.user.username = token.username as string
        session.user.role = token.role as string
        session.user.isAdmin = token.isAdmin as boolean
        session.user.isModerator = token.isModerator as boolean
        session.user.authMethod = token.authMethod as string
        session.user.groups = token.groups as string[]
      }
      
      return session
    }
  },
  
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // 24 hours
  },
  
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
    verifyRequest: '/auth/verify-request',
  },
  
  events: {
    async signIn(message) {
      // Log sign-in event
      await logAuthEvent('SIGN_IN', message.user.id, {
        provider: message.account?.provider,
        method: message.account?.type
      })
    },
    
    async signOut(message) {
      // Log sign-out event
      await logAuthEvent('SIGN_OUT', message.token.sub!, {
        sessionId: message.token.jti
      })
    }
  },
  
  debug: process.env.NODE_ENV === 'development'
}

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
```

### Custom Authentication Utilities
```typescript
// lib/auth.ts
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'

export async function validateCredentials(username: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      email: true,
      firstName: true,
      lastName: true,
      passwordHash: true,
      isActive: true,
      isAdmin: true,
      isModerator: true
    }
  })
  
  if (!user || !user.isActive) {
    return null
  }
  
  if (!user.passwordHash) {
    // User doesn't have a local password
    return null
  }
  
  const isValid = await bcrypt.compare(password, user.passwordHash)
  if (!isValid) {
    return null
  }
  
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    isAdmin: user.isAdmin,
    isModerator: user.isModerator
  }
}

export async function createOrUpdateAuthentikUser(user: any, profile: any) {
  const existingUser = await prisma.user.findUnique({
    where: { authentikId: user.id }
  })
  
  if (existingUser) {
    // Update existing user
    return await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        email: user.email,
        firstName: user.name?.split(' ')[0] || '',
        lastName: user.name?.split(' ').slice(1).join(' ') || '',
        fullName: user.name || '',
        lastLogin: new Date(),
        isAdmin: user.isAdmin,
        isModerator: user.isModerator
      }
    })
  } else {
    // Create new user
    return await prisma.user.create({
      data: {
        username: user.username,
        email: user.email,
        firstName: user.name?.split(' ')[0] || '',
        lastName: user.name?.split(' ').slice(1).join(' ') || '',
        fullName: user.name || '',
        authentikId: user.id,
        isActive: true,
        isAdmin: user.isAdmin,
        isModerator: user.isModerator,
        lastLogin: new Date()
      }
    })
  }
}

export async function updateUserLastLogin(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { lastLogin: new Date() }
  })
}

export async function fetchAuthentikGroups(accessToken: string) {
  try {
    const response = await fetch(`${process.env.AUTHENTIK_ISSUER}/application/o/userinfo/`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    })
    
    const userInfo = await response.json()
    return userInfo.groups || []
  } catch (error) {
    console.error('Failed to fetch Authentik groups:', error)
    return []
  }
}

export async function logAuthEvent(type: string, userId: string, details: any) {
  await prisma.adminEvent.create({
    data: {
      type: type as any,
      userId,
      performedById: userId,
      details,
      description: `User ${type.toLowerCase()}`
    }
  })
}
```

## Authentication Components

### Sign-In Page
```typescript
// app/auth/signin/page.tsx
'use client'

import { useState } from 'react'
import { signIn, getProviders, getCsrfToken } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function SignInPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [credentials, setCredentials] = useState({ username: '', password: '' })
  
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/'
  
  const handleOIDCSignIn = async () => {
    setIsLoading(true)
    setError('')
    
    try {
      const result = await signIn('authentik', { callbackUrl })
      if (result?.error) {
        setError('Failed to sign in with Authentik')
      }
    } catch (error) {
      setError('An error occurred during sign in')
    } finally {
      setIsLoading(false)
    }
  }
  
  const handleLocalSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    
    try {
      const result = await signIn('credentials', {
        username: credentials.username,
        password: credentials.password,
        callbackUrl,
        redirect: false
      })
      
      if (result?.error) {
        setError('Invalid username or password')
      } else if (result?.ok) {
        router.push(callbackUrl)
      }
    } catch (error) {
      setError('An error occurred during sign in')
    } finally {
      setIsLoading(false)
    }
  }
  
  return (
    <div className="container mx-auto flex items-center justify-center min-h-screen py-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign In</CardTitle>
          <CardDescription>
            Sign in to your account to continue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="oidc" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="oidc">Single Sign-On</TabsTrigger>
              <TabsTrigger value="local">Local Account</TabsTrigger>
            </TabsList>
            
            <TabsContent value="oidc" className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Sign in using your organization account
                </p>
                <Button 
                  onClick={handleOIDCSignIn}
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? 'Signing in...' : 'Sign in with Authentik'}
                </Button>
              </div>
            </TabsContent>
            
            <TabsContent value="local" className="space-y-4">
              <form onSubmit={handleLocalSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    type="text"
                    value={credentials.username}
                    onChange={(e) => setCredentials(prev => ({ ...prev, username: e.target.value }))}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={credentials.password}
                    onChange={(e) => setCredentials(prev => ({ ...prev, password: e.target.value }))}
                    required
                  />
                </div>
                <Button type="submit" disabled={isLoading} className="w-full">
                  {isLoading ? 'Signing in...' : 'Sign In'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
          
          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

### Session Provider
```typescript
// app/providers/SessionProvider.tsx
'use client'

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react'
import { ReactNode } from 'react'

interface SessionProviderProps {
  children: ReactNode
  session?: any
}

export function SessionProvider({ children, session }: SessionProviderProps) {
  return (
    <NextAuthSessionProvider session={session}>
      {children}
    </NextAuthSessionProvider>
  )
}
```

### Authentication Hooks
```typescript
// hooks/useAuth.ts
import { useSession } from 'next-auth/react'

export function useAuth() {
  const { data: session, status } = useSession()
  
  return {
    user: session?.user,
    isLoading: status === 'loading',
    isAuthenticated: status === 'authenticated',
    isAdmin: session?.user?.isAdmin ?? false,
    isModerator: session?.user?.isModerator ?? false,
    role: session?.user?.role ?? 'user',
    authMethod: session?.user?.authMethod,
    groups: session?.user?.groups ?? []
  }
}

export function useRequireAuth() {
  const auth = useAuth()
  
  if (!auth.isAuthenticated && !auth.isLoading) {
    throw new Error('Authentication required')
  }
  
  return auth
}

export function useRequireAdmin() {
  const auth = useRequireAuth()
  
  if (!auth.isAdmin) {
    throw new Error('Admin access required')
  }
  
  return auth
}
```

## Route Protection

### Middleware
```typescript
// middleware.ts
import { withAuth } from 'next-auth/middleware'

export default withAuth(
  function middleware(req) {
    // Additional middleware logic if needed
    console.log('Protected route accessed:', req.nextUrl.pathname)
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // Check if user is authenticated
        if (!token) return false
        
        // Check admin routes
        if (req.nextUrl.pathname.startsWith('/admin')) {
          return token.isAdmin === true
        }
        
        // Check moderator routes
        if (req.nextUrl.pathname.startsWith('/moderator')) {
          return token.isModerator === true || token.isAdmin === true
        }
        
        return true
      }
    }
  }
)

export const config = {
  matcher: [
    '/admin/:path*',
    '/moderator/:path*',
    '/users/:path*',
    '/api/protected/:path*'
  ]
}
```

### Protected Route Component
```typescript
// components/auth/ProtectedRoute.tsx
'use client'

import { useAuth } from '@/hooks/useAuth'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'

interface ProtectedRouteProps {
  children: React.ReactNode
  requireAdmin?: boolean
  requireModerator?: boolean
  fallback?: React.ReactNode
}

export function ProtectedRoute({
  children,
  requireAdmin = false,
  requireModerator = false,
  fallback
}: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, isAdmin, isModerator } = useAuth()
  const router = useRouter()
  
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/auth/signin')
    }
  }, [isAuthenticated, isLoading, router])
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }
  
  if (!isAuthenticated) {
    return fallback || null
  }
  
  if (requireAdmin && !isAdmin) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">
            You need admin privileges to access this page.
          </p>
        </div>
      </div>
    )
  }
  
  if (requireModerator && !isModerator && !isAdmin) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">
            You need moderator privileges to access this page.
          </p>
        </div>
      </div>
    )
  }
  
  return <>{children}</>
}
```

## API Route Protection

### Protected API Routes
```typescript
// lib/api-auth.ts
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { NextRequest, NextResponse } from 'next/server'

export async function withAuth(
  handler: (req: NextRequest, session: any) => Promise<NextResponse>,
  options?: { requireAdmin?: boolean; requireModerator?: boolean }
) {
  return async (req: NextRequest) => {
    const session = await getServerSession(authOptions)
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    if (options?.requireAdmin && !session.user.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }
    
    if (options?.requireModerator && !session.user.isModerator && !session.user.isAdmin) {
      return NextResponse.json({ error: 'Moderator access required' }, { status: 403 })
    }
    
    return handler(req, session)
  }
}

// Usage in API routes
// app/api/admin/users/route.ts
export const GET = withAuth(async (req, session) => {
  // Admin-only endpoint
  const users = await prisma.user.findMany()
  return NextResponse.json(users)
}, { requireAdmin: true })
```

## Session Management

### Session State Management
```typescript
// lib/session.ts
import { create } from 'zustand'

interface SessionState {
  lastActivity: Date
  updateActivity: () => void
  extendSession: () => void
}

export const useSessionStore = create<SessionState>((set) => ({
  lastActivity: new Date(),
  updateActivity: () => set({ lastActivity: new Date() }),
  extendSession: async () => {
    // Trigger session update
    const event = new CustomEvent('session-extend')
    window.dispatchEvent(event)
  }
}))

// Activity tracker component
export function ActivityTracker() {
  const updateActivity = useSessionStore(state => state.updateActivity)
  
  useEffect(() => {
    const handleActivity = () => {
      updateActivity()
    }
    
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart']
    events.forEach(event => {
      document.addEventListener(event, handleActivity, true)
    })
    
    return () => {
      events.forEach(event => {
        document.removeEventListener(event, handleActivity, true)
      })
    }
  }, [updateActivity])
  
  return null
}
```

## Migration Strategy

### Phase 1: NextAuth.js Setup (Week 1)
```bash
# Install NextAuth.js and dependencies
npm install next-auth @next-auth/prisma-adapter
npm install bcryptjs @types/bcryptjs
```

### Phase 2: Provider Configuration (Week 2)
- Configure Authentik OIDC provider
- Set up local credentials provider
- Create authentication pages
- Test authentication flows

### Phase 3: Route Protection (Week 3)
- Implement middleware protection
- Create protected route components
- Add API route protection
- Test authorization levels

### Phase 4: Session Management (Week 4)
- Implement session persistence
- Add activity tracking
- Create session extension logic
- Test session expiration

## Benefits of Modern Authentication

### Security Improvements
- **HTTP-only Cookies**: Prevents XSS attacks
- **CSRF Protection**: Built-in CSRF protection
- **Token Rotation**: Automatic token refresh
- **Secure Defaults**: Industry-standard security practices

### Developer Experience
- **Type Safety**: Full TypeScript support
- **Server-Side Rendering**: Authentication state available server-side
- **Automatic Redirects**: Seamless authentication flows
- **Flexible Providers**: Easy to add new authentication methods

### User Experience
- **Persistent Sessions**: Sessions survive browser restarts
- **Seamless SSO**: Single sign-on integration
- **Fallback Authentication**: Local authentication when SSO fails
- **Responsive Design**: Mobile-friendly authentication

## Testing Strategy

### Unit Tests
```typescript
// __tests__/auth.test.ts
import { validateCredentials } from '@/lib/auth'

describe('Authentication', () => {
  test('validates correct credentials', async () => {
    const user = await validateCredentials('admin', 'password')
    expect(user).toBeTruthy()
    expect(user?.isAdmin).toBe(true)
  })
  
  test('rejects invalid credentials', async () => {
    const user = await validateCredentials('admin', 'wrongpassword')
    expect(user).toBe(null)
  })
})
```

### Integration Tests
```typescript
// __tests__/auth-flow.test.ts
import { render, screen } from '@testing-library/react'
import { signIn } from 'next-auth/react'
import SignInPage from '@/app/auth/signin/page'

describe('Authentication Flow', () => {
  test('renders sign-in page', () => {
    render(<SignInPage />)
    expect(screen.getByText('Sign In')).toBeInTheDocument()
  })
  
  test('handles OIDC sign-in', async () => {
    const mockSignIn = jest.fn()
    jest.mocked(signIn).mockImplementation(mockSignIn)
    
    render(<SignInPage />)
    // Test OIDC sign-in flow
  })
})
```

## Conclusion

This authentication flow design provides a robust, secure, and scalable authentication system that maintains all existing functionality while adding modern security features and improved user experience. The NextAuth.js implementation offers better security, easier maintenance, and full TypeScript support.

The phased migration approach ensures minimal disruption while providing a clear path to modernization. The new system will be more secure, maintainable, and future-proof than the current Streamlit-based authentication.

---

*This authentication design serves as the foundation for the secure, modern Community Dashboard application.* 