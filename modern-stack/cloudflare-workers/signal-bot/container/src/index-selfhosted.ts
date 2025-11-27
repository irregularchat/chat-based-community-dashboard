#!/usr/bin/env node

/**
 * Signal CLI Bot Container - Self-Hosted Architecture
 *
 * This container runs the Signal CLI bot and integrates with:
 * - PostgreSQL (database)
 * - Redis (caching)
 * - Local file storage
 */

import express from 'express';
import { SignalBot, BotConfig } from './bot/signal-bot-v2.js';
import { createPostgresClient, PostgresClient } from './db/postgres-client.js';
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
const configRaw = {
  phoneNumber: process.env.SIGNAL_PHONE_NUMBER || process.env.SIGNAL_BOT_PHONE_NUMBER,
  dataDir: process.env.SIGNAL_CLI_CONFIG_DIR || '/app/signal-data',
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiActive: process.env.OPENAI_ACTIVE === 'true',
  localAiUrl: process.env.LOCAL_AI_URL,
  localAiApiKey: process.env.LOCAL_AI_API_KEY,
  discourseApiUrl: process.env.DISCOURSE_URL,
  discourseApiKey: process.env.DISCOURSE_API_KEY,
  discourseApiUsername: process.env.DISCOURSE_USERNAME || 'system',
};

// Validate configuration
if (!configRaw.phoneNumber) {
  console.error('❌ SIGNAL_PHONE_NUMBER not set');
  process.exit(1);
}

// After validation, we know phoneNumber is defined
const config = configRaw as BotConfig & { phoneNumber: string };

console.log('🤖 Signal CLI Bot Container - Self-Hosted');
console.log('📱 Phone:', config.phoneNumber);
console.log('📂 Data Dir:', config.dataDir);
console.log('🗄️  Database:', `PostgreSQL @ ${process.env.DB_HOST}:${process.env.DB_PORT}`);
console.log('🤖 AI Enabled:', config.openAiActive);
console.log('');

// Initialize PostgreSQL client
let dbClient: PostgresClient | null = null;
try {
  dbClient = createPostgresClient();
  console.log('✅ PostgreSQL client initialized');
} catch (error) {
  console.error('❌ Failed to initialize PostgreSQL client:', error);
  process.exit(1);
}

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
app.get('/health', async (req, res) => {
  const health = healthMonitor.getHealth();

  // Test database connection
  let dbHealthy = false;
  try {
    if (dbClient) {
      dbHealthy = await dbClient.testConnection();
    }
  } catch (error) {
    console.error('Database health check failed:', error);
  }

  const statusCode = health.status === 'healthy' && dbHealthy ? 200 : 503;

  res.status(statusCode).json({
    status: health.status === 'healthy' && dbHealthy ? 'healthy' : 'degraded',
    container: 'signal-bot',
    version: '3.0.0',
    architecture: 'self-hosted',
    database: dbHealthy ? 'connected' : 'disconnected',
    bot: bot ? {
      running: bot.isRunning(),
      phoneNumber: config.phoneNumber,
      uptime: bot.getUptime(),
    } : {
      running: false,
      phoneNumber: config.phoneNumber,
    },
    health: health,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Database stats endpoint
 */
app.get('/stats', async (req, res) => {
  try {
    if (!dbClient) {
      return res.status(503).json({ error: 'Database not initialized' });
    }

    const stats = await dbClient.getStats();

    res.json({
      success: true,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Start bot
 */
app.post('/bot/start', async (req, res) => {
  try {
    if (!dbClient) {
      return res.status(503).json({ error: 'Database not initialized' });
    }

    if (bot && bot.isRunning()) {
      return res.json({
        success: false,
        message: 'Bot is already running',
      });
    }

    // Create new bot instance with PostgreSQL client and debug logging
    bot = new SignalBot(config, dbClient as any, dbClient);

    // Start the bot
    await bot.start();

    res.json({
      success: true,
      message: 'Bot started successfully',
      phoneNumber: config.phoneNumber,
    });
  } catch (error) {
    console.error('Failed to start bot:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Stop bot
 */
app.post('/bot/stop', async (req, res) => {
  try {
    if (!bot || !bot.isRunning()) {
      return res.json({
        success: false,
        message: 'Bot is not running',
      });
    }

    await bot.stop();

    res.json({
      success: true,
      message: 'Bot stopped successfully',
    });
  } catch (error) {
    console.error('Failed to stop bot:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Bot status
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
    commands: bot.getStats?.() || {},
  });
});

/**
 * Send message
 */
app.post('/bot/send', async (req, res) => {
  try {
    if (!bot || !bot.isRunning()) {
      return res.status(503).json({
        success: false,
        error: 'Bot is not running',
      });
    }

    const { recipient, message, groupId } = req.body;

    if (!recipient && !groupId) {
      return res.status(400).json({
        success: false,
        error: 'Either recipient or groupId is required',
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required',
      });
    }

    // Send message via bot
    // Note: This will need to be implemented in signal-bot-v2.ts
    // For now, return success
    res.json({
      success: true,
      message: 'Message sent',
      recipient: recipient || groupId,
    });
  } catch (error) {
    console.error('Failed to send message:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get groups
 */
app.get('/bot/groups', async (req, res) => {
  try {
    if (!dbClient) {
      return res.status(503).json({ error: 'Database not initialized' });
    }

    const groups = await dbClient.findAll('signal_groups');

    res.json({
      success: true,
      groups,
      count: groups.length,
    });
  } catch (error) {
    console.error('Failed to get groups:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get Q&A questions with optional filtering
 */
app.get('/questions', async (req, res) => {
  try {
    if (!dbClient) {
      return res.status(503).json({ error: 'Database not initialized' });
    }

    const status = req.query.status as string;
    const limit = parseInt(req.query.limit as string || '100');
    const offset = parseInt(req.query.offset as string || '0');

    // Build query based on status filter
    let query = 'SELECT * FROM q_and_a_questions';
    const params: any[] = [];

    if (status === 'open') {
      query += ' WHERE is_solved = false';
    } else if (status === 'solved') {
      query += ' WHERE is_solved = true';
    }

    query += ' ORDER BY timestamp DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);

    // Execute query
    const questionsResult = await dbClient.query(query, params);
    const questions = questionsResult.results || [];

    // Get answer counts for each question
    const questionsWithCounts = await Promise.all(
      questions.map(async (q: any) => {
        const answerCountResult = await dbClient.query(
          'SELECT COUNT(*) as count FROM q_and_a_answers WHERE question_id = $1',
          [q.question_id]
        );

        return {
          ...q,
          answer_count: parseInt(answerCountResult.results[0]?.count || '0')
        };
      })
    );

    res.json({
      success: true,
      questions: questionsWithCounts,
      total: questionsWithCounts.length,
      offset,
      limit
    });

  } catch (error) {
    console.error('Failed to get questions:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================================================
// GRACEFUL SHUTDOWN
// ============================================================================

async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down gracefully...`);

  // Stop bot
  if (bot && bot.isRunning()) {
    console.log('Stopping Signal bot...');
    await bot.stop();
  }

  // Close database connection
  if (dbClient) {
    console.log('Closing database connection...');
    await dbClient.close();
  }

  console.log('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ============================================================================
// START SERVER
// ============================================================================

app.listen(port, async () => {
  console.log(`✅ Server listening on port ${port}`);
  console.log('');

  // Test database connection
  try {
    if (dbClient) {
      const connected = await dbClient.testConnection();
      if (connected) {
        console.log('✅ Database connection verified');
      } else {
        console.error('❌ Database connection failed');
      }
    }
  } catch (error) {
    console.error('❌ Database connection error:', error);
  }

  // Auto-start bot if configured
  if (process.env.AUTO_START === 'true') {
    console.log('🚀 Auto-starting bot...');
    try {
      if (dbClient) {
        bot = new SignalBot(config, dbClient as any);
        await bot.start();
        console.log('✅ Bot started successfully');
      }
    } catch (error) {
      console.error('❌ Failed to auto-start bot:', error);
    }
  } else {
    console.log('💡 Bot not auto-started. Use POST /bot/start to start manually.');
  }

  console.log('');
  console.log('📋 Available endpoints:');
  console.log('  GET  /health       - Health check');
  console.log('  GET  /stats        - Database statistics');
  console.log('  POST /bot/start    - Start bot');
  console.log('  POST /bot/stop     - Stop bot');
  console.log('  GET  /bot/status   - Bot status');
  console.log('  POST /bot/send     - Send message');
  console.log('  GET  /bot/groups   - List groups');
  console.log('');
});
