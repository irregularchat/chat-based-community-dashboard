/**
 * Rate Limiter
 *
 * Provides per-user rate limiting to prevent abuse of expensive operations.
 * Addresses CVE-2025-005: No Rate Limiting on Expensive Operations
 *
 * SECURITY: This is critical for preventing:
 * - OpenAI API bill exploitation ($10,000+ in hours)
 * - Database overload via query spam
 * - Denial of service for legitimate users
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  resetIn: number; // seconds
}

interface RateLimitEntry {
  count: number;
  resetAt: number; // timestamp in ms
}

export class RateLimiter {
  private limits: Map<string, RateLimitEntry>;
  private cleanupInterval: NodeJS.Timeout | null;

  constructor() {
    this.limits = new Map();

    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  /**
   * Check if a request is allowed under the rate limit
   *
   * @param key - Unique identifier (e.g., "ai:+19108471202")
   * @param maxCalls - Maximum number of calls allowed in the window
   * @param windowSeconds - Time window in seconds
   * @returns Rate limit result with allowed status and reset time
   */
  async checkLimit(
    key: string,
    maxCalls: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.limits.get(key);

    // No entry or expired entry - allow and create new
    if (!entry || now >= entry.resetAt) {
      const resetAt = now + windowSeconds * 1000;
      this.limits.set(key, {
        count: 1,
        resetAt,
      });

      return {
        allowed: true,
        remaining: maxCalls - 1,
        resetAt: new Date(resetAt),
        resetIn: windowSeconds,
      };
    }

    // Entry exists and not expired
    const remaining = maxCalls - entry.count;

    // Exceeded limit
    if (remaining <= 0) {
      const resetIn = Math.ceil((entry.resetAt - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(entry.resetAt),
        resetIn,
      };
    }

    // Under limit - increment count
    entry.count++;
    this.limits.set(key, entry);

    return {
      allowed: true,
      remaining: remaining - 1,
      resetAt: new Date(entry.resetAt),
      resetIn: Math.ceil((entry.resetAt - now) / 1000),
    };
  }

  /**
   * Get current status for a key without incrementing
   */
  async getStatus(key: string, maxCalls: number): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.limits.get(key);

    if (!entry || now >= entry.resetAt) {
      return {
        allowed: true,
        remaining: maxCalls,
        resetAt: new Date(now + 3600 * 1000), // Default 1 hour
        resetIn: 3600,
      };
    }

    const remaining = maxCalls - entry.count;
    const resetIn = Math.ceil((entry.resetAt - now) / 1000);

    return {
      allowed: remaining > 0,
      remaining: Math.max(0, remaining),
      resetAt: new Date(entry.resetAt),
      resetIn,
    };
  }

  /**
   * Reset limit for a specific key (admin override)
   */
  async reset(key: string): Promise<void> {
    this.limits.delete(key);
    console.log(`🔄 Rate limit reset for key: ${key}`);
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.limits.entries()) {
      if (now >= entry.resetAt) {
        this.limits.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Rate limiter cleanup: removed ${cleaned} expired entries`);
    }
  }

  /**
   * Get all active rate limits (for debugging/admin)
   */
  async getAll(): Promise<Array<{ key: string; count: number; resetAt: Date }>> {
    const now = Date.now();
    const active: Array<{ key: string; count: number; resetAt: Date }> = [];

    for (const [key, entry] of this.limits.entries()) {
      if (now < entry.resetAt) {
        active.push({
          key,
          count: entry.count,
          resetAt: new Date(entry.resetAt),
        });
      }
    }

    return active;
  }

  /**
   * Stop the cleanup interval (for graceful shutdown)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

/**
 * Singleton instance for shared rate limiting
 */
let rateLimiterInstance: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiter();
  }
  return rateLimiterInstance;
}

/**
 * Format rate limit error message for users
 */
export function formatRateLimitMessage(command: string, resetIn: number): string {
  const minutes = Math.ceil(resetIn / 60);
  const seconds = resetIn % 60;

  let timeStr: string;
  if (minutes > 0) {
    timeStr = `${minutes} minute${minutes > 1 ? 's' : ''}`;
    if (seconds > 0) {
      timeStr += ` ${seconds} second${seconds > 1 ? 's' : ''}`;
    }
  } else {
    timeStr = `${seconds} second${seconds > 1 ? 's' : ''}`;
  }

  return `❌ Rate limit exceeded for ${command}\n\nTry again in ${timeStr}.`;
}
