#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { RestSignalBotService } = require('./src/lib/signal-cli/rest-bot-service');

console.log('🤖 Starting Signal Bot Service...\n');

const config = {
  phoneNumber: process.env.SIGNAL_PHONE_NUMBER || '+19108471202',
  restApiUrl: process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240',
  aiEnabled: process.env.OPENAI_ACTIVE === 'true',
  openAiApiKey: process.env.OPENAI_API_KEY,
};

console.log('📱 Configuration:');
console.log(`   Phone: ${config.phoneNumber}`);
console.log(`   API URL: ${config.restApiUrl}`);
console.log(`   AI Enabled: ${config.aiEnabled}`);
console.log('');

const bot = new RestSignalBotService(config);

// Add message handler
bot.on('message', async (message) => {
  console.log(`📨 Received message from ${message.sourceName || message.sourceNumber}:`);
  console.log(`   Message: ${message.message}`);
  
  if (message.groupId) {
    console.log(`   Group: ${message.groupId}`);
  }
  
  // Simple echo bot for testing
  if (message.message && !message.message.startsWith('Echo:')) {
    const reply = `Echo: ${message.message}`;
    console.log(`   Replying: ${reply}`);
    
    try {
      if (message.groupId) {
        await bot.sendGroupMessage(message.groupId, reply);
      } else {
        await bot.sendMessage(message.sourceNumber, reply);
      }
    } catch (error) {
      console.error('Failed to send reply:', error);
    }
  }
});

// Start the bot
bot.startListening()
  .then(() => {
    console.log('✅ Signal bot is running and listening for messages!');
    console.log('   Send a message to the bot to test it.');
    console.log('   Press Ctrl+C to stop.\n');
  })
  .catch((error) => {
    console.error('❌ Failed to start Signal bot:', error);
    process.exit(1);
  });

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down Signal bot...');
  await bot.stopListening();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await bot.stopListening();
  process.exit(0);
});