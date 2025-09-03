#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { NativeSignalBotService } = require('./src/lib/signal-cli/native-daemon-service');

async function testAnalyticsCommands() {
  console.log('🧪 Testing Analytics Commands...\n');
  
  const config = {
    phoneNumber: process.env.SIGNAL_BOT_PHONE_NUMBER || '+19108471202',
    dataDir: './signal-data',
    socketPath: '/tmp/signal-cli-socket',
    dbPath: './signal-data/bot.db',
  };
  
  const bot = new NativeSignalBotService(config);
  
  // Create a mock context for testing
  const mockContext = {
    sourceNumber: '+1234567890',
    sender: 'Test User',
    groupId: null,
    args: [],
    bot: bot
  };
  
  console.log('📊 Testing !stats command...');
  try {
    const statsResult = await bot.handleStats(mockContext);
    console.log('Result:', statsResult);
    console.log('✅ Stats command works!\n');
  } catch (error) {
    console.error('❌ Stats command failed:', error.message, '\n');
  }
  
  console.log('🏆 Testing !topcommands command...');
  try {
    const topCommandsResult = await bot.handleTopCommands(mockContext);
    console.log('Result:', topCommandsResult);
    console.log('✅ TopCommands command works!\n');
  } catch (error) {
    console.error('❌ TopCommands command failed:', error.message, '\n');
  }
  
  console.log('👥 Testing !topusers command...');
  try {
    const topUsersResult = await bot.handleTopUsers(mockContext);
    console.log('Result:', topUsersResult);
    console.log('✅ TopUsers command works!\n');
  } catch (error) {
    console.error('❌ TopUsers command failed:', error.message, '\n');
  }
  
  console.log('❌ Testing !errors command...');
  try {
    const errorsResult = await bot.handleErrors(mockContext);
    console.log('Result:', errorsResult);
    console.log('✅ Errors command works!\n');
  } catch (error) {
    console.error('❌ Errors command failed:', error.message, '\n');
  }
  
  console.log('📰 Testing !newsstats command...');
  try {
    const newsStatsResult = await bot.handleNewsStats(mockContext);
    console.log('Result:', newsStatsResult);
    console.log('✅ NewsStats command works!\n');
  } catch (error) {
    console.error('❌ NewsStats command failed:', error.message, '\n');
  }
  
  console.log('💭 Testing !sentiment command...');
  try {
    const sentimentResult = await bot.handleSentiment(mockContext);
    console.log('Result:', sentimentResult);
    console.log('✅ Sentiment command works!\n');
  } catch (error) {
    console.error('❌ Sentiment command failed:', error.message, '\n');
  }
  
  console.log('✨ All analytics command tests complete!');
  process.exit(0);
}

testAnalyticsCommands().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});