# API Security Assessment & Hardening Plan

## 🔍 Security Review Summary

**Date**: 2025-08-31  
**Scope**: Complete API security audit of modern-stack codebase  
**Status**: Critical vulnerabilities identified - immediate action required  

## 🚨 Critical Security Vulnerabilities Identified

### 1. **CRITICAL: Unrestricted Database Migration APIs**
**Risk Level**: CRITICAL  
**Files**: 
- `src/app/api/admin/migrate-schema/route.ts`
- `src/app/api/emergency-schema-fix/route.ts`
- `src/app/api/force-migrate/route.ts`
- `src/app/api/fix-columns-now/route.ts`
- `src/app/api/quick-fix-schema/route.ts`

**Vulnerability**: Direct database schema manipulation endpoints with NO authentication
```typescript
// VULNERABLE: No auth check
export async function POST(_request: NextRequest) {
  await prisma.$executeRaw`ALTER TABLE "community_bookmarks" ADD COLUMN...`;
}
```

**Impact**: 
- Complete database compromise
- Data corruption/deletion
- Schema manipulation by unauthorized users
- DoS attacks via expensive operations

### 2. **HIGH: Debug/Test Endpoints in Production**
**Risk Level**: HIGH  
**Files**:
- `src/app/api/test-signal-debug/route.ts`
- `src/app/api/test-matrix-debug/route.ts`
- `src/app/api/test-configs/route.ts`
- `src/app/api/check-db/route.ts`

**Vulnerability**: Sensitive debug endpoints exposing internal state
```typescript
// VULNERABLE: Exposes environment secrets
debug: {
  environment: {
    signalBridgeRoomId: process.env.MATRIX_SIGNAL_BRIDGE_ROOM_ID,
    signalBotUsername: process.env.MATRIX_SIGNAL_BOT_USERNAME,
  }
}
```

**Impact**:
- Environment variable disclosure
- Internal system reconnaissance  
- Attack surface expansion

### 3. **HIGH: Signal Bot Control API - No Rate Limiting**
**Risk Level**: HIGH  
**File**: `src/app/api/signal-bot/route.ts`

**Vulnerability**: Bot start/stop/restart without authentication or rate limiting
```typescript
// VULNERABLE: No auth, no rate limiting
export async function POST(request: NextRequest) {
  const { action } = await request.json();
  if (action === 'start') {
    // Creates new Signal integration instance
  }
}
```

**Impact**:
- Resource exhaustion attacks
- Service disruption via bot cycling
- Memory leaks from unclosed connections

### 4. **MEDIUM: Authentication Information Disclosure**
**Risk Level**: MEDIUM  
**File**: `src/lib/auth.ts`

**Vulnerability**: Excessive console logging of authentication details
```typescript
// INFORMATION DISCLOSURE
console.log('[LOCAL AUTH] Attempting authorization for:', credentials?.username);
console.log('[LOCAL AUTH] User lookup result:', user ? 'User found' : 'User not found');
```

**Impact**:
- Username enumeration via logs
- Authentication flow reconnaissance
- Sensitive data in log files

### 5. **MEDIUM: tRPC Error Information Disclosure**
**Risk Level**: MEDIUM  
**File**: `src/app/api/trpc/[trpc]/route.ts`

**Vulnerability**: Detailed error messages in development mode
```typescript
// INFORMATION DISCLOSURE in development
onError: process.env.NODE_ENV === 'development' 
  ? ({ path, error }) => {
      console.error(`❌ tRPC failed on ${path ?? '<no-path>'}: ${error.message}`);
    }
  : undefined,
```

**Impact**:
- Stack trace disclosure
- Internal system path exposure
- Database schema inference

## 🛡️ Security Architecture Analysis

### Authentication Mechanisms
✅ **Strengths**:
- NextAuth.js with dual provider support (Authentik OIDC + Local)
- Proper session management with JWT strategy
- Bcrypt password hashing for local auth
- Role-based access control (Admin/Moderator)

❌ **Weaknesses**:
- No session invalidation on role changes
- No account lockout after failed attempts
- Missing CSRF protection on state-changing operations
- No audit logging for failed authentication attempts

### Authorization Implementation  
✅ **Strengths**:
- tRPC middleware-based authorization
- Clear separation: publicProcedure, protectedProcedure, adminProcedure, moderatorProcedure
- Role hierarchy: Admin → Moderator → User

❌ **Weaknesses**:
- No fine-grained permissions system
- Missing resource-level authorization
- API routes bypass tRPC authorization entirely
- No rate limiting on any endpoints

### Input Validation
✅ **Strengths**:
- Zod schemas in tRPC procedures
- Automatic validation with error formatting

❌ **Weaknesses**:
- Direct API routes have minimal validation
- No input sanitization for database queries
- Missing file upload validation
- No request size limits

## 🔧 Comprehensive Hardening Plan

### Phase 1: Critical Security Fixes (IMMEDIATE)

#### 1.1 Secure Database Migration APIs
```typescript
// Add authentication middleware
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

export async function POST(request: NextRequest) {
  // SECURITY: Require admin authentication
  const session = await getServerSession(authOptions);
  if (!session?.user?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // SECURITY: Add audit logging
  await prisma.adminEvent.create({
    data: {
      eventType: 'schema_migration',
      username: session.user.username,
      details: 'Database schema migration executed',
    },
  });
  
  // SECURITY: Add confirmation token requirement
  const confirmationToken = request.headers.get('X-Migration-Confirm');
  if (confirmationToken !== process.env.MIGRATION_CONFIRMATION_TOKEN) {
    return NextResponse.json({ error: 'Missing confirmation token' }, { status: 403 });
  }
}
```

#### 1.2 Remove/Secure Debug Endpoints
- **REMOVE** all test endpoints in production
- **SECURE** remaining debug endpoints with admin auth
- **SANITIZE** environment variable exposure

#### 1.3 Implement Rate Limiting
```typescript
// Rate limiting implementation
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, '1 m'),
});

export async function POST(request: NextRequest) {
  // SECURITY: Rate limiting
  const ip = request.ip || 'unknown';
  const { success, limit, reset, remaining } = await ratelimit.limit(ip);
  
  if (!success) {
    return NextResponse.json(
      { error: 'Too many requests' }, 
      { status: 429, headers: { 'X-RateLimit-Limit': limit.toString() } }
    );
  }
}
```

### Phase 2: Authentication & Authorization Hardening

#### 2.1 Enhanced Session Security
```typescript
// Enhanced session configuration
session: {
  strategy: 'jwt',
  maxAge: 24 * 60 * 60, // Reduce to 24 hours
  updateAge: 60 * 60, // Update every hour
},
callbacks: {
  async jwt({ token, user, account, trigger }) {
    // SECURITY: Force re-authentication on role changes
    if (trigger === 'update') {
      // Fetch fresh user data to check for role changes
      const dbUser = await prisma.user.findUnique({
        where: { id: parseInt(token.sub!) },
      });
      if (dbUser) {
        token.isAdmin = dbUser.isAdmin;
        token.isModerator = dbUser.isModerator;
      }
    }
  }
}
```

#### 2.2 API Route Authentication Middleware
```typescript
// src/lib/api-auth.ts - New authentication helper
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';

export async function requireAuth(req: NextRequest, minRole: 'user' | 'moderator' | 'admin' = 'user') {
  const session = await getServerSession(authOptions);
  
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  if (minRole === 'admin' && !session.user.isAdmin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }
  
  if (minRole === 'moderator' && !session.user.isModerator && !session.user.isAdmin) {
    return NextResponse.json({ error: 'Moderator access required' }, { status: 403 });
  }
  
  return session;
}
```

### Phase 3: Input Validation & Sanitization

#### 3.1 Request Validation Middleware
```typescript
// src/lib/validation.ts
import { z } from 'zod';

export const validateRequest = (schema: z.ZodSchema) => {
  return async (req: NextRequest) => {
    try {
      const body = await req.json();
      const validated = schema.parse(body);
      return { success: true, data: validated };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof z.ZodError ? error.flatten() : 'Validation failed' 
      };
    }
  };
};
```

#### 3.2 Database Query Sanitization
```typescript
// Replace direct string interpolation with parameterized queries
// BEFORE (vulnerable):
await prisma.$executeRaw`ALTER TABLE ${tableName} ADD COLUMN...`;

// AFTER (secure):
await prisma.$executeRaw`ALTER TABLE "community_bookmarks" ADD COLUMN IF NOT EXISTS "icon" TEXT`;
```

### Phase 4: Security Headers & CSRF Protection

#### 4.1 Security Headers Implementation
```typescript
// next.config.js security headers
const securityHeaders = [
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    key: 'Referrer-Policy',
    value: 'origin-when-cross-origin',
  },
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline';",
  },
];
```

#### 4.2 CSRF Protection
```typescript
// CSRF token validation for state-changing operations
import { createHash } from 'crypto';

export function generateCSRFToken(sessionId: string): string {
  return createHash('sha256')
    .update(sessionId + process.env.CSRF_SECRET)
    .digest('hex');
}

export function validateCSRFToken(token: string, sessionId: string): boolean {
  const expected = generateCSRFToken(sessionId);
  return token === expected;
}
```

### Phase 5: Audit Logging & Monitoring

#### 5.1 Enhanced Security Logging
```typescript
// src/lib/security-logger.ts
export async function logSecurityEvent(
  eventType: string,
  userId: string | null,
  details: string,
  severity: 'info' | 'warning' | 'critical' = 'info'
) {
  await prisma.adminEvent.create({
    data: {
      eventType: `security_${eventType}`,
      username: userId || 'anonymous',
      details: `[${severity.toUpperCase()}] ${details}`,
    },
  });
  
  // Critical events should also be logged to external monitoring
  if (severity === 'critical') {
    console.error(`SECURITY ALERT: ${eventType} - ${details}`);
  }
}
```

## 📋 Implementation Priority Matrix

| Priority | Vulnerability | Impact | Effort | Deadline |
|----------|--------------|--------|--------|----------|
| P0 | Database Migration APIs | Critical | Low | Immediate |
| P0 | Debug Endpoints | High | Low | Immediate |
| P1 | Rate Limiting | High | Medium | 3 days |
| P1 | API Authentication | High | Medium | 3 days |
| P2 | Input Validation | Medium | Medium | 1 week |
| P2 | Security Headers | Medium | Low | 1 week |
| P3 | CSRF Protection | Medium | High | 2 weeks |
| P3 | Audit Logging | Low | Medium | 2 weeks |

## 🎯 Success Metrics

### Before Hardening (Current State)
- ❌ 0/24 API routes have authentication
- ❌ 0/24 API routes have rate limiting  
- ❌ 5 critical database manipulation endpoints exposed
- ❌ 4 debug endpoints exposing secrets
- ❌ No security headers implemented
- ❌ No audit logging for API access

### After Hardening (Target State)
- ✅ 24/24 API routes have proper authentication
- ✅ 24/24 API routes have rate limiting
- ✅ 0 critical database endpoints exposed without auth
- ✅ 0 debug endpoints in production
- ✅ Complete security headers implementation
- ✅ Comprehensive audit logging for all security events

## 🚀 Next Steps

1. **Create security hardening branch**: `feature/api-security-hardening`
2. **Implement P0 fixes immediately** (database APIs, debug endpoints)
3. **Deploy rate limiting infrastructure** (Redis/Upstash setup)
4. **Add authentication middleware** to all API routes
5. **Implement comprehensive logging** for security events
6. **Security testing** with penetration testing tools
7. **Update documentation** with security guidelines

---
**Critical Action Required**: The current API security posture presents significant risk to the application and user data. Immediate implementation of P0 fixes is required before any production deployment.