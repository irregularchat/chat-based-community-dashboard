#!/usr/bin/env node

/**
 * Signal Bot Manager - Production-grade bot management with auto-restart
 * Features:
 * - Auto-restart on crashes
 * - Health monitoring and recovery
 * - Process management and logging
 * - Graceful shutdown handling
 * - Multiple bot coordination
 * - Performance monitoring
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class SignalBotManager {
  constructor() {
    this.processes = new Map();
    this.healthChecks = new Map();
    this.restartCounts = new Map();
    this.maxRestarts = 5;
    this.restartWindow = 60000; // 1 minute
    this.healthCheckInterval = 30000; // 30 seconds
    this.isShuttingDown = false;
    
    // Bot configurations
    this.botConfigs = [
      {
        name: 'primary-bot',
        script: 'production-ready-signal-bot.js',
        env: {
          DATABASE_URL: 'postgresql://dashboarduser:password_for_db@localhost:5436/dashboarddb',
          OPENAI_API_KEY: 'sk-proj-test-gpt5mini',
          LOCAL_AI_URL: 'http://localhost:8080'
        },
        priority: 1,
        enabled: true
      },
      {
        name: 'member-tracking-bot',
        script: 'member-tracking-signal-bot.js',
        env: {
          DATABASE_URL: 'postgresql://dashboarduser:password_for_db@localhost:5436/dashboarddb',
          OPENAI_API_KEY: 'sk-proj-test-gpt5mini',
          LOCAL_AI_URL: 'http://localhost:8080'
        },
        priority: 2,
        enabled: false // Disabled for now due to DB issues
      }
    ];
    
    // Create logs directory
    this.logDir = path.join(__dirname, 'logs');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    
    console.log('🚀 Signal Bot Manager initialized');
    console.log(`📁 Log directory: ${this.logDir}`);
    console.log(`🔧 Max restarts: ${this.maxRestarts} per ${this.restartWindow/1000}s`);
    console.log(`❤️  Health check interval: ${this.healthCheckInterval/1000}s`);
  }

  // Start a specific bot
  startBot(config) {
    if (this.processes.has(config.name)) {
      console.log(`⚠️  Bot ${config.name} is already running`);
      return;
    }

    console.log(`🚀 Starting bot: ${config.name}`);
    
    const logFile = path.join(this.logDir, `${config.name}.log`);
    const errorFile = path.join(this.logDir, `${config.name}-error.log`);
    
    const process = spawn('node', [config.script], {
      cwd: __dirname,
      env: { ...process.env, ...config.env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Setup logging
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    const errorStream = fs.createWriteStream(errorFile, { flags: 'a' });
    
    process.stdout.pipe(logStream);
    process.stderr.pipe(errorStream);
    
    // Also log to console with timestamps
    process.stdout.on('data', (data) => {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${config.name}] ${data.toString().trim()}`);
    });
    
    process.stderr.on('data', (data) => {
      const timestamp = new Date().toISOString();
      console.error(`[${timestamp}] [${config.name}] ERROR: ${data.toString().trim()}`);
    });

    // Handle process events
    process.on('exit', (code, signal) => {
      console.log(`💥 Bot ${config.name} exited with code ${code}, signal ${signal}`);
      this.processes.delete(config.name);
      
      if (!this.isShuttingDown) {
        this.handleBotCrash(config, code, signal);
      }
    });

    process.on('error', (error) => {
      console.error(`❌ Bot ${config.name} error:`, error);
      this.processes.delete(config.name);
      
      if (!this.isShuttingDown) {
        this.handleBotCrash(config, -1, 'ERROR');
      }
    });

    // Store process info
    this.processes.set(config.name, {
      process: process,
      config: config,
      startTime: Date.now(),
      lastHealthCheck: Date.now(),
      restarts: 0
    });

    console.log(`✅ Bot ${config.name} started with PID ${process.pid}`);
  }

  // Handle bot crashes and restarts
  handleBotCrash(config, code, signal) {
    const now = Date.now();
    
    // Initialize restart tracking
    if (!this.restartCounts.has(config.name)) {
      this.restartCounts.set(config.name, []);
    }
    
    const restarts = this.restartCounts.get(config.name);
    
    // Clean old restart timestamps (outside window)
    const cutoff = now - this.restartWindow;
    const recentRestarts = restarts.filter(timestamp => timestamp > cutoff);
    this.restartCounts.set(config.name, recentRestarts);
    
    // Check if we've exceeded max restarts
    if (recentRestarts.length >= this.maxRestarts) {
      console.error(`🚫 Bot ${config.name} exceeded max restarts (${this.maxRestarts}), disabling`);
      config.enabled = false;
      this.sendAlert(`Bot ${config.name} disabled after ${this.maxRestarts} crashes`);
      return;
    }
    
    // Add current restart timestamp
    recentRestarts.push(now);
    this.restartCounts.set(config.name, recentRestarts);
    
    // Calculate restart delay (exponential backoff)
    const restartDelay = Math.min(5000 * Math.pow(2, recentRestarts.length - 1), 60000);
    
    console.log(`🔄 Restarting bot ${config.name} in ${restartDelay}ms (attempt ${recentRestarts.length}/${this.maxRestarts})`);
    
    setTimeout(() => {
      if (!this.isShuttingDown && config.enabled) {
        this.startBot(config);
      }
    }, restartDelay);
  }

  // Health monitoring
  startHealthMonitoring() {
    setInterval(() => {
      this.checkBotHealth();
    }, this.healthCheckInterval);
    
    console.log(`❤️  Health monitoring started`);
  }

  checkBotHealth() {
    for (const [name, botInfo] of this.processes) {
      const { process: proc, config, startTime, lastHealthCheck } = botInfo;
      
      // Check if process is still running
      if (!proc || proc.killed || proc.exitCode !== null) {
        console.warn(`⚠️  Bot ${name} process died, attempting restart`);
        this.processes.delete(name);
        this.handleBotCrash(config, proc?.exitCode || -1, 'HEALTH_CHECK');
        continue;
      }
      
      // Check memory usage (basic check)
      try {
        const memUsage = process.memoryUsage();
        const botUptime = Date.now() - startTime;
        
        // Log health stats periodically
        if ((Date.now() - lastHealthCheck) > 300000) { // 5 minutes
          console.log(`📊 Bot ${name} health: PID=${proc.pid}, Uptime=${this.formatUptime(botUptime)}, Memory=${this.formatBytes(memUsage.rss)}`);
          botInfo.lastHealthCheck = Date.now();
        }
        
        // Check for memory leaks (simple threshold)
        if (memUsage.rss > 500 * 1024 * 1024) { // 500MB
          console.warn(`🧠 Bot ${name} high memory usage: ${this.formatBytes(memUsage.rss)}`);
        }
        
      } catch (error) {
        console.error(`❌ Health check error for ${name}:`, error.message);
      }
    }
  }

  // Send alerts (can be extended to use webhooks, email, etc.)
  sendAlert(message) {
    const timestamp = new Date().toISOString();
    const alertMessage = `[${timestamp}] ALERT: ${message}`;
    
    console.error(`🚨 ${alertMessage}`);
    
    // Write to alert log
    const alertFile = path.join(this.logDir, 'alerts.log');
    fs.appendFileSync(alertFile, alertMessage + '\n');
    
    // Could extend to send to external monitoring systems
    // this.sendToWebhook(alertMessage);
    // this.sendToSlack(alertMessage);
  }

  // Start all enabled bots
  startAllBots() {
    console.log('🚀 Starting all enabled bots...');
    
    // Sort by priority (lower number = higher priority)
    const sortedConfigs = this.botConfigs
      .filter(config => config.enabled)
      .sort((a, b) => a.priority - b.priority);
    
    for (const config of sortedConfigs) {
      this.startBot(config);
      
      // Small delay between starts to avoid resource contention
      if (sortedConfigs.length > 1) {
        setTimeout(() => {}, 2000);
      }
    }
    
    console.log(`✅ Started ${sortedConfigs.length} bots`);
  }

  // Stop all bots gracefully
  async stopAllBots() {
    console.log('🛑 Stopping all bots...');
    this.isShuttingDown = true;
    
    const stopPromises = [];
    
    for (const [name, botInfo] of this.processes) {
      const { process: proc } = botInfo;
      
      if (proc && !proc.killed) {
        console.log(`🛑 Stopping bot ${name}...`);
        
        const stopPromise = new Promise((resolve) => {
          const timeout = setTimeout(() => {
            console.log(`⚡ Force killing bot ${name}`);
            proc.kill('SIGKILL');
            resolve();
          }, 10000); // 10 second grace period
          
          proc.on('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
          
          // Send SIGTERM first (graceful shutdown)
          proc.kill('SIGTERM');
        });
        
        stopPromises.push(stopPromise);
      }
    }
    
    await Promise.all(stopPromises);
    console.log('✅ All bots stopped');
  }

  // Get status of all bots
  getStatus() {
    const status = {
      running: this.processes.size,
      configured: this.botConfigs.length,
      enabled: this.botConfigs.filter(c => c.enabled).length,
      bots: []
    };
    
    for (const config of this.botConfigs) {
      const botInfo = this.processes.get(config.name);
      const restarts = this.restartCounts.get(config.name) || [];
      
      status.bots.push({
        name: config.name,
        enabled: config.enabled,
        running: !!botInfo,
        pid: botInfo?.process?.pid,
        uptime: botInfo ? Date.now() - botInfo.startTime : 0,
        restarts: restarts.length,
        priority: config.priority
      });
    }
    
    return status;
  }

  // Utility functions
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
  
  formatBytes(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
  }

  // CLI interface
  handleCommand(command, args = []) {
    switch (command) {
      case 'start':
        if (args.length > 0) {
          const config = this.botConfigs.find(c => c.name === args[0]);
          if (config) {
            config.enabled = true;
            this.startBot(config);
          } else {
            console.error(`❌ Bot ${args[0]} not found`);
          }
        } else {
          this.startAllBots();
        }
        break;
        
      case 'stop':
        if (args.length > 0) {
          const botInfo = this.processes.get(args[0]);
          if (botInfo) {
            console.log(`🛑 Stopping bot ${args[0]}...`);
            botInfo.process.kill('SIGTERM');
          } else {
            console.error(`❌ Bot ${args[0]} not running`);
          }
        } else {
          this.stopAllBots();
        }
        break;
        
      case 'status':
        const status = this.getStatus();
        console.log('\n📊 Bot Manager Status:');
        console.log(`Running: ${status.running}/${status.enabled} enabled bots`);
        console.log('\nBots:');
        for (const bot of status.bots) {
          const statusIcon = bot.running ? '✅' : (bot.enabled ? '🔄' : '❌');
          const uptime = bot.uptime > 0 ? ` (${this.formatUptime(bot.uptime)})` : '';
          console.log(`${statusIcon} ${bot.name}: ${bot.running ? 'RUNNING' : (bot.enabled ? 'STOPPED' : 'DISABLED')}${uptime} [${bot.restarts} restarts]`);
        }
        break;
        
      case 'restart':
        if (args.length > 0) {
          const botInfo = this.processes.get(args[0]);
          if (botInfo) {
            console.log(`🔄 Restarting bot ${args[0]}...`);
            botInfo.process.kill('SIGTERM');
          } else {
            console.error(`❌ Bot ${args[0]} not running`);
          }
        } else {
          console.log('🔄 Restarting all bots...');
          this.stopAllBots().then(() => {
            setTimeout(() => this.startAllBots(), 5000);
          });
        }
        break;
        
      case 'logs':
        const botName = args[0] || 'primary-bot';
        const logFile = path.join(this.logDir, `${botName}.log`);
        if (fs.existsSync(logFile)) {
          console.log(`📋 Last 50 lines of ${botName} logs:`);
          const { execSync } = require('child_process');
          try {
            const output = execSync(`tail -n 50 "${logFile}"`, { encoding: 'utf8' });
            console.log(output);
          } catch (error) {
            console.error('❌ Error reading logs:', error.message);
          }
        } else {
          console.error(`❌ Log file not found: ${logFile}`);
        }
        break;
        
      default:
        console.log(`
🤖 Signal Bot Manager Commands:

start [bot-name]     - Start all bots or specific bot
stop [bot-name]      - Stop all bots or specific bot  
restart [bot-name]   - Restart all bots or specific bot
status               - Show status of all bots
logs [bot-name]      - Show recent logs (default: primary-bot)

Examples:
  node signal-bot-manager.js start
  node signal-bot-manager.js status
  node signal-bot-manager.js logs primary-bot
        `);
        break;
    }
  }
}

// Main execution
if (require.main === module) {
  const manager = new SignalBotManager();
  const command = process.argv[2];
  const args = process.argv.slice(3);
  
  if (command) {
    // CLI mode
    manager.handleCommand(command, args);
    
    // Keep process alive for monitoring commands
    if (['start', 'restart'].includes(command)) {
      manager.startHealthMonitoring();
      
      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log('\n🛑 Received SIGINT, shutting down gracefully...');
        await manager.stopAllBots();
        process.exit(0);
      });
      
      process.on('SIGTERM', async () => {
        console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
        await manager.stopAllBots();
        process.exit(0);
      });
      
      // Keep alive
      setInterval(() => {
        // Just keep the process running
      }, 60000);
    }
  } else {
    // Interactive mode - start all and monitor
    manager.startAllBots();
    manager.startHealthMonitoring();
    
    console.log('\n📊 Bot Manager running. Press Ctrl+C to stop all bots and exit.\n');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Received SIGINT, shutting down gracefully...');
      await manager.stopAllBots();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
      await manager.stopAllBots();
      process.exit(0);
    });
  }
}

module.exports = SignalBotManager;