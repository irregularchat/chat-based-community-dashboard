#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { NativeSignalBotService } = require('./src/lib/signal-cli/native-daemon-service');

console.log('🤖 Starting Native Signal Bot Service...\n');

const config = {
  phoneNumber: process.env.SIGNAL_BOT_PHONE_NUMBER || '+19108471202',
  dataDir: './signal-data',
  socketPath: '/tmp/signal-cli-socket',
  aiEnabled: process.env.OPENAI_ACTIVE === 'true',
  openAiApiKey: process.env.OPENAI_API_KEY,
  localAiUrl: process.env.LOCAL_AI_URL,
  dbPath: './signal-data/bot.db',
  discourseUrl: process.env.DISCOURSE_API_URL,
  discourseApiKey: process.env.DISCOURSE_API_KEY,
  discourseUsername: process.env.DISCOURSE_USERNAME || 'system'
};

console.log('📱 Configuration:');
console.log(`   Phone: ${config.phoneNumber}`);
console.log(`   Data Directory: ${config.dataDir}`);
console.log(`   Socket Path: ${config.socketPath}`);
console.log(`   AI Enabled: ${config.aiEnabled}`);
console.log(`   Local AI: ${config.localAiUrl ? 'Configured' : 'Not configured'}`);
console.log('');

const bot = new NativeSignalBotService(config);

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down Signal bot...');
  await bot.stopListening();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down...');
  await bot.stopListening();
  process.exit(0);
});

// Start the bot
async function start() {
  try {
    console.log('🚀 Starting Signal daemon...');
    await bot.startListening();
    console.log('✅ Bot is running and listening for messages');
    console.log('📡 Press Ctrl+C to stop\n');
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

start();