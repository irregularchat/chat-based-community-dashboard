#!/usr/bin/env node

/**
 * Signal CLI Bot Container - Cloudflare Native
 *
 * This container runs the Signal CLI bot and integrates with:
 * - Cloudflare D1 (database)
 * - Cloudflare R2 (file storage)
 * - Cloudflare Workers (API calls)
 * - Cloudflare Durable Objects (state management)
 */

import express from 'express';
import { SignalBot } from './bot/signal-bot.js';
import { WorkerAPIClient } from './api/worker-api-client.js';
import { HealthMonitor } from './lib/health-monitor.js';

const app = express();
const port = parseInt(process.env.PORT || '8080');

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Configuration
const config = {
  phoneNumber: process.env.SIGNAL_PHONE_NUMBER || process.env.SIGNAL_BOT_PHONE_NUMBER,
  dataDir: process.env.SIGNAL_CLI_CONFIG_DIR || '/app/signal-data',
  workerApiUrl: process.env.WORKER_API_URL,
  workerApiToken: process.env.WORKER_API_TOKEN,
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiActive: process.env.OPENAI_ACTIVE === 'true',
  localAiUrl: process.env.LOCAL_AI_URL,
  localAiApiKey: process.env.LOCAL_AI_API_KEY,
  discourseApiUrl: process.env.DISCOURSE_API_URL,
  discourseApiKey: process.env.DISCOURSE_API_KEY,
  discourseApiUsername: process.env.DISCOURSE_API_USERNAME || 'system',
};

// Validate configuration
if (!config.phoneNumber) {
  console.error('❌ SIGNAL_PHONE_NUMBER not set');
  process.exit(1);
}

if (!config.workerApiUrl) {
  console.error('❌ WORKER_API_URL not set');
  console.error('💡 Set this to your Worker URL for database access');
  process.exit(1);
}

console.log('🤖 Signal CLI Bot Container - Cloudflare Native');
console.log('📱 Phone:', config.phoneNumber);
console.log('📂 Data Dir:', config.dataDir);
console.log('🌐 Worker API:', config.workerApiUrl);
console.log('🤖 AI Enabled:', config.openAiActive);
console.log('');

// Initialize Worker API client
const workerApi = new WorkerAPIClient(config.workerApiUrl, config.workerApiToken);

// Initialize health monitor
const healthMonitor = new HealthMonitor();

// Initialize Signal bot
let bot: SignalBot | null = null;

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  const health = healthMonitor.getHealth();
  const status = health.status === 'healthy' ? 200 : 503;

  res.status(status).json({
    status: health.status,
    container: 'signal-bot',
    version: '3.0.0',
    architecture: 'cloudflare-native',
    bot: bot ? {
      running: bot.isRunning(),
      phoneNumber: config.phoneNumber,
      uptime: bot.getUptime(),
    } : { running: false },
    ...health,
  });
});

/**
 * Start bot endpoint
 */
app.post('/bot/start', async (req, res) => {
  try {
    if (bot?.isRunning()) {
      return res.status(400).json({
        error: 'Bot already running',
      });
    }

    bot = new SignalBot(config, workerApi);
    await bot.start();

    res.json({
      success: true,
      message: 'Bot started successfully',
      phoneNumber: config.phoneNumber,
    });
  } catch (error) {
    console.error('Failed to start bot:', error);
    res.status(500).json({
      error: 'Failed to start bot',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Stop bot endpoint
 */
app.post('/bot/stop', async (req, res) => {
  try {
    if (!bot?.isRunning()) {
      return res.status(400).json({
        error: 'Bot not running',
      });
    }

    await bot.stop();
    bot = null;

    res.json({
      success: true,
      message: 'Bot stopped successfully',
    });
  } catch (error) {
    console.error('Failed to stop bot:', error);
    res.status(500).json({
      error: 'Failed to stop bot',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Bot status endpoint
 */
app.get('/bot/status', (req, res) => {
  if (!bot) {
    return res.json({
      running: false,
      message: 'Bot not initialized',
    });
  }

  res.json({
    running: bot.isRunning(),
    phoneNumber: config.phoneNumber,
    uptime: bot.getUptime(),
    stats: bot.getStats(),
  });
});

/**
 * Send message endpoint
 */
app.post('/bot/send', async (req, res) => {
  try {
    if (!bot?.isRunning()) {
      return res.status(400).json({
        error: 'Bot not running',
      });
    }

    const { recipient, message, groupId } = req.body;

    if (!message) {
      return res.status(400).json({
        error: 'Message required',
      });
    }

    if (!recipient && !groupId) {
      return res.status(400).json({
        error: 'Either recipient or groupId required',
      });
    }

    const result = await bot.sendMessage({
      recipient,
      groupId,
      message,
    });

    res.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error('Failed to send message:', error);
    res.status(500).json({
      error: 'Failed to send message',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * List groups endpoint
 */
app.get('/bot/groups', async (req, res) => {
  try {
    if (!bot?.isRunning()) {
      return res.status(400).json({
        error: 'Bot not running',
      });
    }

    const groups = await bot.getGroups();

    res.json({
      success: true,
      groups,
      count: groups.length,
    });
  } catch (error) {
    console.error('Failed to get groups:', error);
    res.status(500).json({
      error: 'Failed to get groups',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
  });
});

/**
 * Error handler
 */
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message,
  });
});

// ============================================================================
// STARTUP
// ============================================================================

// Start server
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`✅ Server listening on port ${port}`);
  console.log(`🏥 Health check: http://localhost:${port}/health`);
  console.log('');
  console.log('📝 API Endpoints:');
  console.log('  POST /bot/start   - Start the bot');
  console.log('  POST /bot/stop    - Stop the bot');
  console.log('  GET  /bot/status  - Get bot status');
  console.log('  POST /bot/send    - Send a message');
  console.log('  GET  /bot/groups  - List groups');
  console.log('');

  // Auto-start bot if configured
  if (process.env.AUTO_START === 'true') {
    console.log('🚀 Auto-starting bot...');
    bot = new SignalBot(config, workerApi);
    bot.start().catch((error) => {
      console.error('Failed to auto-start bot:', error);
    });
  } else {
    console.log('💡 Bot will start when POST /bot/start is called');
  }
});

// Graceful shutdown
const shutdown = async () => {
  console.log('\n🛑 Shutting down...');

  // Stop accepting new connections
  server.close();

  // Stop bot
  if (bot?.isRunning()) {
    await bot.stop();
  }

  console.log('✅ Shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught exception:', error);
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
  shutdown();
});

console.log('🎉 Container ready!');
console.log('');
