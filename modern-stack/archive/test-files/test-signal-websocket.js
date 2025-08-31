#!/usr/bin/env node

/**
 * WebSocket Signal CLI Test
 * Tests if WebSocket approach works with existing Docker container
 */

require('dotenv').config({ path: '.env.local' });
const WebSocket = require('ws');

const SIGNAL_API_URL = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
const PHONE_NUMBER = process.env.SIGNAL_PHONE_NUMBER || process.env.SIGNAL_BOT_PHONE_NUMBER;

console.log('🧪 Testing Signal WebSocket Connection\n');

if (!PHONE_NUMBER) {
  console.error('❌ SIGNAL_PHONE_NUMBER not configured in .env.local');
  process.exit(1);
}

console.log(`📱 Phone: ${PHONE_NUMBER}`);
console.log(`🔗 API URL: ${SIGNAL_API_URL}`);

// Start REST API container first
console.log('\n🔄 Starting Signal CLI REST API container...');
const { spawn } = require('child_process');

const startContainer = spawn('docker', ['start', 'signal-cli-rest-api']);

startContainer.on('close', (code) => {
  if (code === 0) {
    console.log('✅ Container started, waiting for health check...');
    
    // Wait a moment for container to be ready
    setTimeout(testWebSocket, 5000);
  } else {
    console.error('❌ Failed to start container');
    process.exit(1);
  }
});

startContainer.on('error', (error) => {
  console.error('❌ Error starting container:', error);
  process.exit(1);
});

function testWebSocket() {
  console.log('\n🔌 Testing WebSocket connection...');
  
  // Try WebSocket connection
  const wsUrl = SIGNAL_API_URL.replace('http://', 'ws://') + `/v1/receive/${encodeURIComponent(PHONE_NUMBER)}`;
  console.log(`🔗 WebSocket URL: ${wsUrl}`);
  
  try {
    const ws = new WebSocket(wsUrl);
    
    ws.on('open', () => {
      console.log('✅ WebSocket connected! Listening for messages...');
      console.log('💬 Send a message to test: !ping or !help');
      console.log('🛑 Press Ctrl+C to stop\n');
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('📨 Received message:', JSON.stringify(message, null, 2));
        
        // Check if it's a command
        if (message.envelope?.dataMessage?.message?.startsWith('!')) {
          const command = message.envelope.dataMessage.message;
          console.log(`🤖 Processing command: ${command}`);
          
          // Simple response test
          if (command === '!ping') {
            sendTestResponse(message.envelope.dataMessage.groupInfo?.groupId, 'Pong! 🏓 WebSocket test successful!');
          } else if (command === '!help') {
            sendTestResponse(message.envelope.dataMessage.groupInfo?.groupId, 'WebSocket Help:\n!ping - Test connectivity\n!help - Show this help');
          }
        }
      } catch (error) {
        console.error('❌ Error parsing message:', error);
      }
    });
    
    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
      console.log('\n💡 WebSocket approach not available in normal mode');
      console.log('   This requires JSON-RPC mode which has registration limitations');
      testPolling();
    });
    
    ws.on('close', () => {
      console.log('🔴 WebSocket connection closed');
    });
    
  } catch (error) {
    console.error('❌ Failed to create WebSocket:', error);
    testPolling();
  }
}

async function sendTestResponse(groupId, message) {
  console.log(`📤 Sending test response: ${message}`);
  
  try {
    const response = await fetch(`${SIGNAL_API_URL}/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message,
        number: PHONE_NUMBER,
        'group-id': groupId
      })
    });
    
    if (response.ok) {
      console.log('✅ Response sent successfully');
    } else {
      console.error('❌ Failed to send response:', await response.text());
    }
  } catch (error) {
    console.error('❌ Error sending response:', error);
  }
}

function testPolling() {
  console.log('\n📡 Testing polling approach (known to be broken)...');
  
  const testPoll = async () => {
    try {
      const response = await fetch(`${SIGNAL_API_URL}/v1/receive/${encodeURIComponent(PHONE_NUMBER)}`);
      const messages = await response.json();
      
      if (messages && messages.length > 0) {
        console.log(`📨 Received ${messages.length} messages via polling:`, messages);
      } else {
        console.log('📭 Polling returned empty array (expected - this is the known bug)');
      }
    } catch (error) {
      console.error('❌ Polling failed:', error.message);
    }
  };
  
  // Test polling once
  testPoll();
  
  console.log('\n🔧 Next Steps:');
  console.log('1. Install signal-cli: brew install signal-cli');
  console.log('2. Test native daemon: node setup-signal-daemon.js');
  console.log('3. Start native bot: node start-native-signal-bot.js');
}

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Stopping test...');
  process.exit(0);
});