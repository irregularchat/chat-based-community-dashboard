#!/usr/bin/env node

/**
 * Production Signal CLI Bot - Native Daemon Implementation
 * Replaces the broken bbernhard/signal-cli-rest-api approach
 * Uses native signal-cli daemon with JSON-RPC interface
 */

require('dotenv').config({ path: '.env.local' });
const { NativeSignalBotService } = require('./src/lib/signal-cli/native-daemon-service');

console.log('🤖 Starting Native Signal CLI Bot...\n');

const config = {
  phoneNumber: process.env.SIGNAL_PHONE_NUMBER || process.env.SIGNAL_BOT_PHONE_NUMBER,
  dataDir: process.env.SIGNAL_CLI_DATA_DIR || './signal-data',
  socketPath: process.env.SIGNAL_CLI_SOCKET_PATH || '/tmp/signal-cli-socket',
  aiEnabled: process.env.OPENAI_ACTIVE === 'true',
  openAiApiKey: process.env.OPENAI_API_KEY,
};

console.log('📱 Configuration:');
console.log(`   Phone: ${config.phoneNumber}`);
console.log(`   Data Dir: ${config.dataDir}`);
console.log(`   Socket: ${config.socketPath}`);
console.log(`   AI Enabled: ${config.aiEnabled}`);
console.log('');

if (!config.phoneNumber) {
  console.error('❌ SIGNAL_PHONE_NUMBER not configured');
  console.log('💡 Please set SIGNAL_PHONE_NUMBER in .env.local');
  process.exit(1);
}

const bot = new NativeSignalBotService(config);

// Enhanced message logging
bot.on('message', async (message) => {
  console.log(`📨 [${new Date().toLocaleTimeString()}] Message received:`);
  console.log(`   From: ${message.sourceName || message.sourceNumber}`);
  console.log(`   Message: ${message.message}`);
  
  if (message.groupId) {
    console.log(`   Group: ${message.groupName || message.groupId}`);
  }
  console.log('');
});

// Enhanced error handling
bot.on('error', (error) => {
  console.error('🔴 Bot Error:', error);
});

// Start the bot with enhanced error handling
async function startBot() {
  try {
    console.log('🔄 Starting Signal CLI daemon...');
    await bot.startListening();
    
    console.log('✅ Native Signal CLI bot is running!');
    console.log('💬 Bot Commands Available:');
    console.log('   !help     - Show available commands');
    console.log('   !ping     - Test bot responsiveness');
    if (config.aiEnabled) {
      console.log('   !ai <msg> - AI-powered responses');
    }
    console.log('');
    console.log('📱 Send a message to any group the bot is in to test!');
    console.log('🛑 Press Ctrl+C to stop the bot.\n');
    
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    
    if (error.message.includes('not registered')) {
      console.log('');
      console.log('🔧 Account Registration Required:');
      console.log('   1. Get captcha: https://signalcaptchas.org/registration/generate.html');
      console.log('   2. Run: node setup-signal-daemon.js');
      console.log('   3. Or use admin interface at /admin/signal');
    } else if (error.message.includes('signal-cli')) {
      console.log('');
      console.log('🔧 signal-cli Installation Required:');
      console.log('   macOS: brew install signal-cli');
      console.log('   Linux: Download from https://github.com/AsamK/signal-cli/releases');
    }
    
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  console.log('\n🛑 Shutting down Signal bot...');
  try {
    await bot.stopListening();
    console.log('✅ Bot stopped gracefully');
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown();
});

// Start the bot
startBot();