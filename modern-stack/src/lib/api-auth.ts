import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export type UserRole = 'user' | 'moderator' | 'admin';

export interface AuthenticatedSession {
  user: {
    id: string;
    username?: string;
    email?: string;
    isAdmin: boolean;
    isModerator: boolean;
  };
}

/**
 * Require authentication for API routes with role-based access control
 * @param req - NextRequest object
 * @param minRole - Minimum role required ('user', 'moderator', 'admin')
 * @returns Authenticated session or NextResponse error
 */
export async function requireAuth(
  req: NextRequest, 
  minRole: UserRole = 'user'
): Promise<AuthenticatedSession | NextResponse> {
  const session = await getServerSession(authOptions);
  
  if (!session?.user) {
    await logSecurityEvent(
      'unauthorized_api_access',
      null,
      `Unauthorized access attempt to ${req.nextUrl.pathname}`,
      'warning'
    );
    return NextResponse.json({ 
      success: false, 
      error: 'Authentication required' 
    }, { status: 401 });
  }
  
  // Check role-based access
  if (minRole === 'admin' && !session.user.isAdmin) {
    await logSecurityEvent(
      'insufficient_privileges',
      session.user.id,
      `User attempted admin operation: ${req.nextUrl.pathname}`,
      'warning'
    );
    return NextResponse.json({ 
      success: false, 
      error: 'Administrator privileges required' 
    }, { status: 403 });
  }
  
  if (minRole === 'moderator' && !session.user.isModerator && !session.user.isAdmin) {
    await logSecurityEvent(
      'insufficient_privileges', 
      session.user.id,
      `User attempted moderator operation: ${req.nextUrl.pathname}`,
      'warning'
    );
    return NextResponse.json({ 
      success: false, 
      error: 'Moderator privileges required' 
    }, { status: 403 });
  }
  
  return session as AuthenticatedSession;
}

/**
 * Validate confirmation token for dangerous operations
 * @param req - NextRequest object
 * @param expectedToken - Environment variable name for expected token
 * @returns boolean indicating if token is valid
 */
export function validateConfirmationToken(req: NextRequest, expectedToken: string): boolean {
  const providedToken = req.headers.get('X-Confirmation-Token');
  const expectedValue = process.env[expectedToken];
  
  if (!providedToken || !expectedValue) {
    return false;
  }
  
  return providedToken === expectedValue;
}

/**
 * Log security events with proper classification
 * @param eventType - Type of security event
 * @param userId - User ID or null for anonymous
 * @param details - Event details
 * @param severity - Event severity level
 */
export async function logSecurityEvent(
  eventType: string,
  userId: string | null,
  details: string,
  severity: 'info' | 'warning' | 'critical' = 'info'
) {
  try {
    await prisma.adminEvent.create({
      data: {
        eventType: `security_${eventType}`,
        username: userId || 'anonymous',
        details: `[${severity.toUpperCase()}] ${details}`,
      },
    });
    
    // Log critical events to console for immediate visibility
    if (severity === 'critical') {
      console.error(`🚨 SECURITY ALERT: ${eventType} - ${details}`);
    } else if (severity === 'warning') {
      console.warn(`⚠️  SECURITY WARNING: ${eventType} - ${details}`);
    }
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
}

/**
 * Check if the current environment allows dangerous operations
 * @returns boolean indicating if dangerous operations are allowed
 */
export function isDangerousOperationsAllowed(): boolean {
  return process.env.NODE_ENV === 'development' || 
         process.env.ALLOW_DANGEROUS_OPERATIONS === 'true';
}

// In-memory rate limit store (use Redis in production)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

/**
 * Rate limiting check with in-memory storage
 * @param req - NextRequest object
 * @param identifier - Rate limiting identifier (IP, user ID, etc.)
 * @param limit - Number of requests allowed
 * @param windowMs - Time window in milliseconds
 * @returns Object with rate limiting result
 */
export async function checkRateLimit(
  req: NextRequest,
  identifier: string,
  limit: number = 60,
  windowMs: number = 60000
): Promise<{ success: boolean; remaining?: number; reset?: number }> {
  const now = Date.now();
  const key = `${identifier}:${Math.floor(now / windowMs)}`;
  
  // Clean up old entries periodically
  if (Math.random() < 0.01) { // 1% chance to cleanup on each call
    for (const [storeKey, data] of rateLimitStore.entries()) {
      if (data.resetTime < now) {
        rateLimitStore.delete(storeKey);
      }
    }
  }
  
  let record = rateLimitStore.get(key);
  
  if (!record) {
    // First request in this window
    record = {
      count: 1,
      resetTime: now + windowMs
    };
    rateLimitStore.set(key, record);
    
    return {
      success: true,
      remaining: limit - 1,
      reset: record.resetTime
    };
  }
  
  if (now > record.resetTime) {
    // Window has expired, reset
    record.count = 1;
    record.resetTime = now + windowMs;
    rateLimitStore.set(key, record);
    
    return {
      success: true,
      remaining: limit - 1,
      reset: record.resetTime
    };
  }
  
  if (record.count >= limit) {
    // Rate limit exceeded
    await logSecurityEvent(
      'rate_limit_exceeded',
      null,
      `Rate limit exceeded for ${identifier}: ${record.count}/${limit} requests in window`,
      'warning'
    );
    
    return {
      success: false,
      remaining: 0,
      reset: record.resetTime
    };
  }
  
  // Increment count
  record.count++;
  rateLimitStore.set(key, record);
  
  return {
    success: true,
    remaining: limit - record.count,
    reset: record.resetTime
  };
}

/**
 * Apply rate limiting to an API route
 * @param req - NextRequest object
 * @param identifier - Rate limiting identifier (defaults to IP address)
 * @param limit - Number of requests allowed (default: 60)
 * @param windowMs - Time window in milliseconds (default: 60000 = 1 minute)
 * @returns NextResponse error if rate limited, null if allowed
 */
export async function applyRateLimit(
  req: NextRequest,
  identifier?: string,
  limit: number = 60,
  windowMs: number = 60000
): Promise<NextResponse | null> {
  // Use IP address as default identifier
  const rateLimitIdentifier = identifier || 
    req.ip || 
    req.headers.get('x-forwarded-for') || 
    req.headers.get('x-real-ip') || 
    'unknown';

  const result = await checkRateLimit(req, rateLimitIdentifier, limit, windowMs);
  
  if (!result.success) {
    return NextResponse.json(
      { 
        success: false, 
        error: 'Rate limit exceeded. Please try again later.',
        remaining: result.remaining,
        reset: result.reset
      }, 
      { 
        status: 429,
        headers: {
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': result.remaining?.toString() || '0',
          'X-RateLimit-Reset': result.reset?.toString() || '',
        }
      }
    );
  }
  
  // Add rate limit headers to successful responses
  return null; // No error, rate limit passed
}