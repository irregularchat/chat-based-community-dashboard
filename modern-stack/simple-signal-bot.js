#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });

const SIGNAL_API = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
const PHONE = process.env.SIGNAL_PHONE_NUMBER || '+19108471202';
const SOLO_GROUP = 'group.L2NqZm1JN3NuQUFoUlBMRE1sdlc1MEphOGZFOVN1c2xNQkZ1a0ZqbjlpST0=';

console.log('🤖 Signal Bot Starting...\n');
console.log('📱 Phone:', PHONE);
console.log('🌐 API:', SIGNAL_API);
console.log('');

// Send initial message
async function sendGroupMessage(message) {
  try {
    const response = await fetch(`${SIGNAL_API}/v2/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message,
        number: PHONE,
        recipients: [SOLO_GROUP]
      })
    });
    const result = await response.json();
    if (result.timestamp) {
      console.log(`✅ Sent: ${message}`);
    } else {
      console.log('❌ Send failed:', result);
    }
  } catch (error) {
    console.error('❌ Error sending:', error.message);
  }
}

// Poll for messages
async function pollMessages() {
  try {
    const response = await fetch(`${SIGNAL_API}/v1/receive/${encodeURIComponent(PHONE)}`, {
      signal: AbortSignal.timeout(8000) // 8 second timeout
    });
    
    const messages = await response.json();
    
    if (messages && messages.length > 0) {
      console.log(`\n📨 Received ${messages.length} message(s)`);
      
      for (const msg of messages) {
        if (msg.envelope?.dataMessage?.message) {
          const text = msg.envelope.dataMessage.message;
          const from = msg.envelope.sourceName || msg.envelope.sourceNumber;
          
          console.log(`   From: ${from}`);
          console.log(`   Message: ${text}`);
          
          // Only reply to non-bot messages in the Solo testing group
          if (msg.envelope.dataMessage.groupInfo?.groupId === SOLO_GROUP) {
            if (!text.startsWith('Bot:')) {
              const reply = `Bot: You said "${text}"`;
              await sendGroupMessage(reply);
            }
          }
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      // Timeout is normal, just continue
    } else {
      console.error('Poll error:', error.message);
    }
  }
}

// Main loop
async function main() {
  console.log('🚀 Bot is starting...\n');
  
  // Send startup message
  await sendGroupMessage('Bot: Signal bot is now active! 🤖 Send me a message and I will echo it back.');
  
  console.log('\n👂 Listening for messages...');
  console.log('   (Press Ctrl+C to stop)\n');
  
  // Poll continuously
  while (true) {
    await pollMessages();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between polls
  }
}

// Start the bot
main().catch(console.error);

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Bot stopped');
  process.exit(0);
});