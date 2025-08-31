#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { spawn } = require('child_process');

const PHONE_NUMBER = process.env.SIGNAL_PHONE_NUMBER || '+19108471202';
const DATA_DIR = './signal-data';
const SOLO_GROUP_ID = '/cjfmI7snAAhRPLDMlvW50Ja8fE9SuslMBFukFjn9iI='; // Solo testing group

console.log('🧪 Testing Signal Bot in Solo Group...');
console.log(`📱 Phone: ${PHONE_NUMBER}`);  
console.log(`🎯 Group: ${SOLO_GROUP_ID} (Solo testing - bot is admin)`);
console.log('');

async function sendTestMessage() {
  return new Promise((resolve, reject) => {
    console.log('📤 Sending test message: !ping');
    
    const sendMsg = spawn('signal-cli', [
      '-a', PHONE_NUMBER,
      '--config', DATA_DIR,
      'send',
      '-g', SOLO_GROUP_ID,
      '-m', '!ping'
    ]);

    let output = '';
    let error = '';

    sendMsg.stdout.on('data', (data) => {
      output += data.toString();
    });

    sendMsg.stderr.on('data', (data) => {
      error += data.toString();
    });

    sendMsg.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Test message sent successfully');
        resolve(output);
      } else {
        console.error('❌ Failed to send test message:', error);
        reject(new Error(error));
      }
    });
  });
}

async function testBot() {
  try {
    await sendTestMessage();
    console.log('');
    console.log('🔍 Check the bot logs to see if it receives and responds to the !ping command');
    console.log('💡 The bot should respond with a "pong" message if everything is working');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    if (error.message.includes('Config file is in use')) {
      console.log('');  
      console.log('ℹ️  This is expected - the daemon is using the config file.');
      console.log('📱 Try sending the message manually from your Signal app instead:');
      console.log('   1. Open Signal on your phone');
      console.log('   2. Go to the "Solo testing" group');  
      console.log('   3. Send: !ping');
      console.log('   4. Check the bot logs for a response');
    }
  }
}

testBot().catch(console.error);