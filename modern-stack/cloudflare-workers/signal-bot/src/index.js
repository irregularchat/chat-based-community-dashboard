/**
 * Cloudflare Worker for Signal CLI Bot
 * Routes requests to Signal CLI container
 * Handles authentication, rate limiting, and health monitoring
 */

import { Container, getContainer } from "@cloudflare/containers";

/**
 * Signal Bot Container Class
 * Defines container behavior and lifecycle
 */
export class SignalBotContainer extends Container {
  defaultPort = 8080; // Signal CLI REST API port
  sleepAfter = "10m"; // Stop container after 10 minutes of inactivity
}

/**
 * Main Worker Entry Point
 * Handles all incoming HTTP requests
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({
        status: "healthy",
        worker: "signal-cli-bot",
        timestamp: new Date().toISOString()
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Worker status endpoint
    if (url.pathname === "/status") {
      return handleStatus(request, env);
    }

    // Authentication check (basic - enhance based on your needs)
    const authHeader = request.headers.get("Authorization");
    if (!authHeader && !isPublicEndpoint(url.pathname)) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" }
      });
    }

    // Rate limiting (basic implementation)
    const rateLimitResult = await checkRateLimit(request, env);
    if (!rateLimitResult.allowed) {
      return new Response("Rate limit exceeded", {
        status: 429,
        headers: {
          "X-RateLimit-Limit": rateLimitResult.limit,
          "X-RateLimit-Remaining": "0",
          "Retry-After": rateLimitResult.retryAfter
        }
      });
    }

    try {
      // Get container instance
      // Use a single instance for the bot (not session-based)
      const containerInstance = getContainer(
        env.SIGNAL_BOT_CONTAINER,
        "primary-bot"
      );

      // Forward request to container
      const response = await containerInstance.fetch(request);

      // Add custom headers
      const modifiedResponse = new Response(response.body, response);
      modifiedResponse.headers.set("X-Powered-By", "Cloudflare-Workers");
      modifiedResponse.headers.set("X-Container-Instance", "primary-bot");

      return modifiedResponse;

    } catch (error) {
      console.error("Container error:", error);

      return new Response(JSON.stringify({
        error: "Container error",
        message: error.message,
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
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
    "/v1/health"
  ];
  return publicEndpoints.includes(pathname);
}

/**
 * Basic rate limiting using KV
 * Limits: 100 requests per minute per IP
 */
async function checkRateLimit(request, env) {
  // Skip if KV not configured
  if (!env.SIGNAL_CACHE) {
    return { allowed: true };
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `ratelimit:${ip}`;
  const limit = 100; // requests per minute
  const window = 60; // seconds

  try {
    const current = await env.SIGNAL_CACHE.get(key);
    const count = current ? parseInt(current) : 0;

    if (count >= limit) {
      return {
        allowed: false,
        limit: limit,
        retryAfter: window
      };
    }

    // Increment counter
    await env.SIGNAL_CACHE.put(key, (count + 1).toString(), {
      expirationTtl: window
    });

    return { allowed: true };

  } catch (error) {
    console.error("Rate limit error:", error);
    // Allow on error (fail open)
    return { allowed: true };
  }
}

/**
 * Handle status endpoint
 * Returns worker and container status
 */
async function handleStatus(request, env) {
  try {
    const containerInstance = getContainer(
      env.SIGNAL_BOT_CONTAINER,
      "primary-bot"
    );

    // Try to ping the container
    const healthCheck = await containerInstance.fetch(
      new Request("http://container/v1/health")
    );

    const containerHealthy = healthCheck.ok;

    return new Response(JSON.stringify({
      worker: {
        status: "healthy",
        version: "1.0.0",
        timestamp: new Date().toISOString()
      },
      container: {
        status: containerHealthy ? "healthy" : "unhealthy",
        instance: "primary-bot",
        lastChecked: new Date().toISOString()
      }
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({
      worker: {
        status: "healthy",
        version: "1.0.0"
      },
      container: {
        status: "error",
        error: error.message
      }
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
