/**
 * Cloudflare Worker for Signal CLI Bot - Cloudflare Native Architecture
 *
 * This Worker provides:
 * - D1 database API for container (container can't bind to D1 directly)
 * - R2 storage API for container (container can't bind to R2 directly)
 * - Container proxy for bot control endpoints
 * - Authentication and rate limiting
 * - Health monitoring
 *
 * Architecture:
 * Container (signal-cli + bot logic) → Worker (D1/R2 access) → D1/R2
 */

import { Container, getContainer } from '@cloudflare/containers';
import * as DBHandler from './api/db-handler';
import * as R2Handler from './api/r2-handler';

export interface Env {
  // D1 Database
  DB: D1Database;

  // R2 Storage
  SIGNAL_DATA: R2Bucket;

  // KV Cache
  SIGNAL_CACHE: KVNamespace;

  // Container
  SIGNAL_BOT_CONTAINER: any;

  // Environment variables
  WORKER_API_TOKEN?: string;
  API_AUTH_TOKEN?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;

  // Durable Objects (for future use)
  BOT_COORDINATOR?: DurableObjectNamespace;
  MESSAGE_QUEUE?: DurableObjectNamespace;
  WEBSOCKET_MANAGER?: DurableObjectNamespace;
}

/**
 * Signal Bot Container Class
 */
export class SignalBotContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '10m';
}

/**
 * Main Worker Entry Point
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Enable CORS for development
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }

    // ========================================================================
    // PUBLIC ENDPOINTS (no auth required)
    // ========================================================================

    // Worker health check
    if (pathname === '/health' || pathname === '/') {
      return new Response(JSON.stringify({
        status: 'healthy',
        service: 'signal-bot-worker',
        version: '3.0.0',
        architecture: 'cloudflare-native',
        timestamp: new Date().toISOString(),
        components: {
          worker: 'active',
          d1: env.DB ? 'bound' : 'missing',
          r2: env.SIGNAL_DATA ? 'bound' : 'missing',
          kv: env.SIGNAL_CACHE ? 'bound' : 'missing',
          container: env.SIGNAL_BOT_CONTAINER ? 'bound' : 'missing',
        }
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Worker-Version': '3.0.0',
        }
      });
    }

    // Combined status (Worker + Container)
    if (pathname === '/status') {
      return handleStatus(request, env);
    }

    // ========================================================================
    // AUTHENTICATED API ENDPOINTS
    // ========================================================================

    // Check authentication for API endpoints
    if (pathname.startsWith('/api/')) {
      const authResult = await checkAuthentication(request, env);
      if (!authResult.authenticated) {
        return new Response(JSON.stringify({
          error: 'Unauthorized',
          message: 'Valid Bearer token required'
        }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer realm="Signal Bot API"'
          }
        });
      }
    }

    // D1 Database API
    if (pathname === '/api/db/query' && request.method === 'POST') {
      return DBHandler.handleQuery(request, env);
    }

    if (pathname === '/api/db/batch' && request.method === 'POST') {
      return DBHandler.handleBatch(request, env);
    }

    if (pathname === '/api/db/stats' && request.method === 'GET') {
      return DBHandler.handleStats(request, env);
    }

    // R2 Storage API
    if (pathname === '/api/r2/upload' && request.method === 'POST') {
      return R2Handler.handleUpload(request, env);
    }

    if (pathname.startsWith('/api/r2/download/')) {
      const key = decodeURIComponent(pathname.substring('/api/r2/download/'.length));
      return R2Handler.handleDownload(request, env, key);
    }

    if (pathname.startsWith('/api/r2/delete/')) {
      const key = decodeURIComponent(pathname.substring('/api/r2/delete/'.length));
      return R2Handler.handleDelete(request, env, key);
    }

    if (pathname === '/api/r2/list' && request.method === 'GET') {
      return R2Handler.handleList(request, env);
    }

    if (pathname.startsWith('/api/r2/head/')) {
      const key = decodeURIComponent(pathname.substring('/api/r2/head/'.length));
      return R2Handler.handleHead(request, env, key);
    }

    if (pathname === '/api/r2/stats' && request.method === 'GET') {
      return R2Handler.handleStats(request, env);
    }

    // ========================================================================
    // CONTAINER PROXY (for bot control endpoints)
    // ========================================================================

    // Bot control endpoints are proxied to container
    if (pathname.startsWith('/bot/')) {
      return proxyToContainer(request, env);
    }

    // ========================================================================
    // 404 NOT FOUND
    // ========================================================================

    return new Response(JSON.stringify({
      error: 'Not found',
      path: pathname,
      availableEndpoints: [
        'GET  /health',
        'GET  /status',
        'POST /api/db/query',
        'POST /api/db/batch',
        'GET  /api/db/stats',
        'POST /api/r2/upload',
        'GET  /api/r2/download/:key',
        'DELETE /api/r2/delete/:key',
        'GET  /api/r2/list',
        'GET  /api/r2/head/:key',
        'GET  /api/r2/stats',
        'POST /bot/start',
        'POST /bot/stop',
        'GET  /bot/status',
        'POST /bot/send',
        'GET  /bot/groups',
      ]
    }), {
      status: 404,
      headers: {
        'Content-Type': 'application/json',
      }
    });
  }
};

/**
 * Check authentication
 */
async function checkAuthentication(request: Request, env: Env): Promise<{ authenticated: boolean }> {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authenticated: false };
  }

  const token = authHeader.substring(7);

  // Check against environment variable
  const validToken = env.WORKER_API_TOKEN || env.API_AUTH_TOKEN;

  // If no token configured, deny all (security by default)
  if (!validToken) {
    console.warn('No WORKER_API_TOKEN configured - denying all API requests');
    return { authenticated: false };
  }

  return { authenticated: token === validToken };
}

/**
 * Handle CORS preflight
 */
function handleCORS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    }
  });
}

/**
 * Proxy request to container
 */
async function proxyToContainer(request: Request, env: Env): Promise<Response> {
  try {
    if (!env.SIGNAL_BOT_CONTAINER) {
      return new Response(JSON.stringify({
        error: 'Container not configured',
        message: 'SIGNAL_BOT_CONTAINER binding missing'
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get container instance
    const containerInstance = getContainer(
      env.SIGNAL_BOT_CONTAINER,
      'primary-bot'
    );

    // Forward request to container
    const startTime = Date.now();
    const response = await containerInstance.fetch(request);
    const duration = Date.now() - startTime;

    // Add headers
    const modifiedResponse = new Response(response.body, response);
    modifiedResponse.headers.set('X-Powered-By', 'Cloudflare-Workers');
    modifiedResponse.headers.set('X-Container-Instance', 'primary-bot');
    modifiedResponse.headers.set('X-Response-Time', `${duration}ms`);

    return modifiedResponse;

  } catch (error) {
    console.error('Container proxy error:', error);

    return new Response(JSON.stringify({
      error: 'Container error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Handle status endpoint
 */
async function handleStatus(request: Request, env: Env): Promise<Response> {
  const workerStatus = {
    status: 'healthy',
    version: '3.0.0',
    architecture: 'cloudflare-native',
    timestamp: new Date().toISOString(),
    bindings: {
      d1: !!env.DB,
      r2: !!env.SIGNAL_DATA,
      kv: !!env.SIGNAL_CACHE,
      container: !!env.SIGNAL_BOT_CONTAINER,
    }
  };

  // Try to get container status
  let containerStatus: any = {
    status: 'unknown',
    message: 'Not checked'
  };

  try {
    if (env.SIGNAL_BOT_CONTAINER) {
      const containerInstance = getContainer(
        env.SIGNAL_BOT_CONTAINER,
        'primary-bot'
      );

      const healthCheck = await containerInstance.fetch(
        new Request('http://container/health', { method: 'GET' })
      );

      if (healthCheck.ok) {
        containerStatus = await healthCheck.json();
      } else {
        containerStatus = {
          status: 'unhealthy',
          statusCode: healthCheck.status
        };
      }
    }
  } catch (error) {
    containerStatus = {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }

  // Try to get D1 stats
  let dbStats: any = null;
  try {
    if (env.DB) {
      const result = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM signal_messages'
      ).first();
      dbStats = {
        messages: result?.count || 0
      };
    }
  } catch (error) {
    dbStats = { error: 'Failed to query D1' };
  }

  // Try to get R2 stats
  let r2Stats: any = null;
  try {
    if (env.SIGNAL_DATA) {
      const listed = await env.SIGNAL_DATA.list({ limit: 1 });
      r2Stats = {
        configured: true,
        canList: true
      };
    }
  } catch (error) {
    r2Stats = { error: 'Failed to access R2' };
  }

  const overallHealthy = containerStatus.status === 'healthy' ||
                         containerStatus.status === 'unknown';

  return new Response(JSON.stringify({
    worker: workerStatus,
    container: containerStatus,
    database: dbStats,
    storage: r2Stats,
    overall: overallHealthy ? 'healthy' : 'degraded'
  }), {
    status: overallHealthy ? 200 : 503,
    headers: {
      'Content-Type': 'application/json',
      'X-Overall-Status': overallHealthy ? 'healthy' : 'degraded'
    }
  });
}

// ============================================================================
// DURABLE OBJECTS EXPORTS
// ============================================================================

export { BotCoordinator } from './durable-objects/bot-coordinator';
export { MessageQueue } from './durable-objects/message-queue';
export { WebSocketManager } from './durable-objects/websocket-manager';
