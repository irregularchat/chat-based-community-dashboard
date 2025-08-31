#!/usr/bin/env node

// Import the comprehensive bot service
const { RestSignalBotService } = require('./src/lib/signal-cli/rest-bot-service.ts');
require('dotenv').config({ path: '.env.local' });

const PHONE = process.env.SIGNAL_PHONE_NUMBER || '+19108471202';
const SIGNAL_API = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
const OPENAI_KEY = process.env.OPENAI_API_KEY;

console.log('🤖 Comprehensive Signal Bot Starting...\n');
console.log('📱 Phone:', PHONE);
console.log('🌐 Signal API:', SIGNAL_API);
console.log('🧠 OpenAI:', OPENAI_KEY ? 'Configured' : 'Not configured');
console.log('');

// Create bot service instance
const botService = new RestSignalBotService({
  phoneNumber: PHONE,
  restApiUrl: SIGNAL_API,
  aiEnabled: !!OPENAI_KEY,
  openAiApiKey: OPENAI_KEY
});

// Start the bot
async function startBot() {
  try {
    console.log('🚀 Starting comprehensive Signal bot with full command support...');
    
    await botService.startListening();
    
    console.log('✅ Comprehensive Signal bot is now active!');
    console.log('   Bot supports 55+ commands including !help, !ai, !ping, etc.');
    console.log('   (Press Ctrl+C to stop)');
    
  } catch (error) {
    console.error('❌ Failed to start bot:', error.message);
    process.exit(1);
  }
}

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Shutting down comprehensive Signal bot...');
  await botService.stopListening();
  process.exit(0);
});

// Start the bot
startBot();