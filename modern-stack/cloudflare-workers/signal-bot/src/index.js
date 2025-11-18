/**
 * Cloudflare Worker for Signal CLI Bot
 *
 * This Worker acts as a simple proxy to the signal-cli-rest-api container.
 * All business logic remains in the Next.js app.
 *
 * Responsibilities:
 * - Forward requests to container
 * - Basic authentication (optional)
 * - Rate limiting
 * - Health monitoring
 * - Request logging
 */

import { Container, getContainer } from "@cloudflare/containers";

/**
 * Signal Bot Container Class
 */
export class SignalBotContainer extends Container {
  defaultPort = 8080; // Signal CLI REST API port
  sleepAfter = "10m"; // Stop container after 10 minutes of inactivity
}

/**
 * Main Worker Entry Point
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Worker health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({
        status: "healthy",
        worker: "signal-cli-bot-proxy",
        version: "2.0.0",
        timestamp: new Date().toISOString(),
        role: "proxy",
        architecture: "hybrid"
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Version": "2.0.0"
        }
      });
    }

    // Worker + Container combined status
    if (url.pathname === "/status") {
      return handleStatus(request, env);
    }

    // Authentication check (optional - enable if needed)
    // Uncomment to require authentication:
    // const authResult = await checkAuthentication(request, env);
    // if (!authResult.authenticated && !isPublicEndpoint(url.pathname)) {
    //   return new Response("Unauthorized", {
    //     status: 401,
    //     headers: { "WWW-Authenticate": "Bearer realm=\"Signal CLI API\"" }
    //   });
    // }

    // Rate limiting
    const rateLimitResult = await checkRateLimit(request, env);
    if (!rateLimitResult.allowed) {
      return new Response(JSON.stringify({
        error: "Rate limit exceeded",
        limit: rateLimitResult.limit,
        retryAfter: rateLimitResult.retryAfter
      }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "X-RateLimit-Limit": rateLimitResult.limit.toString(),
          "X-RateLimit-Remaining": "0",
          "Retry-After": rateLimitResult.retryAfter.toString()
        }
      });
    }

    try {
      // Get container instance (single instance for all requests)
      const containerInstance = getContainer(
        env.SIGNAL_BOT_CONTAINER,
        "primary-bot"
      );

      // Clone the request for forwarding
      const modifiedRequest = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: "manual"
      });

      // Forward to container
      const startTime = Date.now();
      const response = await containerInstance.fetch(modifiedRequest);
      const duration = Date.now() - startTime;

      // Add custom headers to response
      const modifiedResponse = new Response(response.body, response);
      modifiedResponse.headers.set("X-Powered-By", "Cloudflare-Workers");
      modifiedResponse.headers.set("X-Container-Instance", "primary-bot");
      modifiedResponse.headers.set("X-Response-Time", `${duration}ms`);
      modifiedResponse.headers.set("X-Worker-Version", "2.0.0");

      // Log request (for debugging)
      logRequest(request, response.status, duration, env);

      return modifiedResponse;

    } catch (error) {
      console.error("Container error:", error);

      // Return error response
      return new Response(JSON.stringify({
        error: "Container error",
        message: error.message,
        timestamp: new Date().toISOString(),
        help: "Check Worker logs for details"
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "X-Error": "container-error"
        }
      });
    }
  }
};

/**
 * Check if endpoint is public (no auth required)
 */
function isPublicEndpoint(pathname) {
  const publicEndpoints = [
    "/health",
    "/status",
    "/v1/health",
    "/v1/about"
  ];
  return publicEndpoints.includes(pathname);
}

/**
 * Authentication check (optional)
 * Uncomment and configure if you want to require auth
 */
async function checkAuthentication(request, env) {
  // Example: Bearer token authentication
  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { authenticated: false };
  }

  const token = authHeader.substring(7);

  // Check against environment variable
  const validToken = env.API_AUTH_TOKEN;
  if (!validToken) {
    // No auth configured, allow all
    return { authenticated: true };
  }

  return {
    authenticated: token === validToken
  };
}

/**
 * Rate limiting using KV
 *
 * Default: 100 requests per minute per IP
 * Configure in environment variables:
 * - RATE_LIMIT_PER_MINUTE (default: 100)
 * - RATE_LIMIT_WINDOW_SECONDS (default: 60)
 */
async function checkRateLimit(request, env) {
  // Skip if KV not configured
  if (!env.SIGNAL_CACHE) {
    return { allowed: true };
  }

  // Get client IP
  const ip = request.headers.get("CF-Connecting-IP") ||
             request.headers.get("X-Forwarded-For") ||
             "unknown";

  // Configuration
  const limit = parseInt(env.RATE_LIMIT_PER_MINUTE) || 100;
  const window = parseInt(env.RATE_LIMIT_WINDOW_SECONDS) || 60;

  const key = `ratelimit:${ip}`;

  try {
    // Get current count
    const currentStr = await env.SIGNAL_CACHE.get(key);
    const current = currentStr ? parseInt(currentStr) : 0;

    if (current >= limit) {
      return {
        allowed: false,
        limit: limit,
        retryAfter: window
      };
    }

    // Increment counter
    await env.SIGNAL_CACHE.put(key, (current + 1).toString(), {
      expirationTtl: window
    });

    return { allowed: true };

  } catch (error) {
    console.error("Rate limit error:", error);
    // Fail open - allow request on error
    return { allowed: true };
  }
}

/**
 * Handle status endpoint
 * Returns combined Worker + Container status
 */
async function handleStatus(request, env) {
  const workerStatus = {
    status: "healthy",
    version: "2.0.0",
    role: "proxy",
    architecture: "hybrid",
    timestamp: new Date().toISOString()
  };

  try {
    // Try to ping container
    const containerInstance = getContainer(
      env.SIGNAL_BOT_CONTAINER,
      "primary-bot"
    );

    const healthCheck = await containerInstance.fetch(
      new Request("http://container/v1/health", {
        method: "GET"
      })
    );

    const containerHealthy = healthCheck.ok;
    let containerDetails = null;

    if (containerHealthy) {
      try {
        containerDetails = await healthCheck.json();
      } catch (e) {
        // Ignore JSON parse errors
      }
    }

    return new Response(JSON.stringify({
      worker: workerStatus,
      container: {
        status: containerHealthy ? "healthy" : "unhealthy",
        instance: "primary-bot",
        details: containerDetails,
        lastChecked: new Date().toISOString()
      },
      overall: containerHealthy ? "healthy" : "degraded"
    }), {
      status: containerHealthy ? 200 : 503,
      headers: {
        "Content-Type": "application/json",
        "X-Overall-Status": containerHealthy ? "healthy" : "degraded"
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      worker: workerStatus,
      container: {
        status: "error",
        instance: "primary-bot",
        error: error.message,
        lastChecked: new Date().toISOString()
      },
      overall: "unhealthy"
    }), {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "X-Overall-Status": "unhealthy"
      }
    });
  }
}

/**
 * Log request for monitoring
 * Optional: Send to analytics service
 */
function logRequest(request, status, duration, env) {
  const url = new URL(request.url);

  // Log to console (visible in wrangler tail)
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    method: request.method,
    path: url.pathname,
    status: status,
    duration: `${duration}ms`,
    ip: request.headers.get("CF-Connecting-IP") || "unknown",
    userAgent: request.headers.get("User-Agent")?.substring(0, 100)
  }));

  // Optional: Send to KV for analytics
  // if (env.SIGNAL_CACHE) {
  //   const key = `log:${Date.now()}:${Math.random()}`;
  //   env.SIGNAL_CACHE.put(key, JSON.stringify(logData), {
  //     expirationTtl: 86400 // 24 hours
  //   });
  // }
}
