#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { NativeSignalBotService } = require('./src/lib/signal-cli/native-daemon-service');

async function testPingCommand() {
  console.log('🏓 Testing !ping command directly through bot service...');
  
  const config = {
    phoneNumber: '+19108471202',
    socketPath: '/tmp/signal-cli-socket',
    aiEnabled: false
  };
  
  const bot = new NativeSignalBotService(config);
  
  try {
    // Initialize the bot
    await bot.init();
    
    const groupId = 'PjJCT6d4nrF0/BZOs39ECX/lZkcHPbi65JU8B6kgw6s=';
    const message = '!ping';
    
    console.log(`📤 Sending "${message}" to group: ${groupId}`);
    
    // Send the message using the bot's sendToGroup method
    await bot.sendToGroup(groupId, message);
    
    console.log('✅ Message sent successfully!');
    console.log('⏱️ Waiting 5 seconds for bot response...');
    
    // Wait a bit to see if there's a response
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('🎉 Test completed. Check the Signal group for bot response.');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    // Clean up
    if (bot.socket) {
      bot.socket.destroy();
    }
    process.exit(0);
  }
}

testPingCommand();