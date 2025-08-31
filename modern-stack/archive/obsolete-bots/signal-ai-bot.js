#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });

const SIGNAL_API = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
const PHONE = process.env.SIGNAL_PHONE_NUMBER || '+19108471202';
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SOLO_GROUP = 'group.L2NqZm1JN3NuQUFoUlBMRE1sdlc1MEphOGZFOVN1c2xNQkZ1a0ZqbjlpST0=';

console.log('🤖 Signal AI Bot Starting...\n');
console.log('📱 Phone:', PHONE);
console.log('🌐 Signal API:', SIGNAL_API);
console.log('🧠 OpenAI:', OPENAI_KEY ? 'Configured' : 'Not configured');
console.log('');

// Track processed messages to avoid duplicates
const processedMessages = new Set();
let lastReceiveTime = Date.now();

// Send message to group
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
      console.log(`✅ Sent: ${message.substring(0, 100)}...`);
      return true;
    } else {
      console.log('❌ Send failed:', result.error || 'Unknown error');
      return false;
    }
  } catch (error) {
    console.error('❌ Error sending:', error.message);
    return false;
  }
}

// Get AI response using OpenAI
async function getAIResponse(message) {
  if (!OPENAI_KEY) {
    return "AI is not configured. I can only echo your messages.";
  }
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a helpful Signal bot assistant. Keep responses concise and friendly.'
          },
          {
            role: 'user',
            content: message
          }
        ],
        max_tokens: 150,
        temperature: 0.7
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI error:', error);
      return `Echo: ${message}`;
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('AI error:', error.message);
    return `Echo: ${message}`;
  }
}

// Receive and process messages
async function receiveMessages() {
  try {
    const response = await fetch(`${SIGNAL_API}/v1/receive/${encodeURIComponent(PHONE)}`);
    
    if (!response.ok) {
      console.error('Receive failed:', response.status, response.statusText);
      return;
    }
    
    const messages = await response.json();
    
    if (messages && messages.length > 0) {
      console.log(`\n📨 Received ${messages.length} message(s)`);
      
      for (const msg of messages) {
        const envelope = msg.envelope;
        if (!envelope) continue;
        
        const dataMessage = envelope.dataMessage;
        if (!dataMessage || !dataMessage.message) continue;
        
        // Create unique message ID
        const msgId = `${envelope.timestamp}_${envelope.sourceNumber}`;
        
        // Skip if already processed
        if (processedMessages.has(msgId)) continue;
        processedMessages.add(msgId);
        
        // Clean old processed messages (keep last 100)
        if (processedMessages.size > 100) {
          const toDelete = Array.from(processedMessages).slice(0, processedMessages.size - 100);
          toDelete.forEach(id => processedMessages.delete(id));
        }
        
        const text = dataMessage.message;
        const from = envelope.sourceName || envelope.sourceNumber;
        
        console.log(`   From: ${from}`);
        console.log(`   Message: ${text}`);
        
        // Check if it's from the Solo testing group
        if (dataMessage.groupInfo && dataMessage.groupInfo.groupId === SOLO_GROUP) {
          // Don't respond to bot's own messages
          if (!text.startsWith('Bot:')) {
            console.log('   🤖 Generating AI response...');
            const response = await getAIResponse(text);
            const reply = `Bot: ${response}`;
            await sendGroupMessage(reply);
          }
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('⏱️  Receive timeout (normal)');
    } else {
      console.error('Receive error:', error.message);
    }
  }
}

// Main loop
async function main() {
  console.log('🚀 Bot is starting...\n');
  
  // Send startup message
  await sendGroupMessage('Bot: AI-powered Signal bot is now active! 🤖🧠 Ask me anything!');
  
  console.log('\n👂 Listening for messages...');
  console.log('   The bot will respond with AI-generated answers.');
  console.log('   (Press Ctrl+C to stop)\n');
  
  // Main message processing loop
  while (true) {
    await receiveMessages();
    
    // Wait before next receive (adjust based on your needs)
    await new Promise(resolve => setTimeout(resolve, 5000)); // 5 seconds
  }
}

// Start the bot
main().catch(console.error);

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Shutting down...');
  await sendGroupMessage('Bot: Going offline. Goodbye! 👋');
  process.exit(0);
});