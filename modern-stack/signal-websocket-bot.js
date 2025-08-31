#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });

const WebSocket = require('ws');

const SIGNAL_API = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
const PHONE = process.env.SIGNAL_PHONE_NUMBER || '+19108471202';
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SOLO_GROUP = 'group.L2NqZm1JN3NuQUFoUlBMRE1sdlc1MEphOGZFOVN1c2xNQkZ1a0ZqbjlpST0=';

console.log('🤖 Signal WebSocket Bot Starting...\n');
console.log('📱 Phone:', PHONE);
console.log('🌐 Signal API:', SIGNAL_API);
console.log('🧠 OpenAI:', OPENAI_KEY ? 'Configured' : 'Not configured');
console.log('');

// Track processed messages to avoid duplicates
const processedMessages = new Set();

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

// Process incoming message
async function processMessage(data) {
  try {
    const msg = JSON.parse(data);
    
    if (!msg.envelope) return;
    
    const envelope = msg.envelope;
    const dataMessage = envelope.dataMessage;
    
    if (!dataMessage || !dataMessage.message) return;
    
    // Create unique message ID
    const msgId = `${envelope.timestamp}_${envelope.sourceNumber}`;
    
    // Skip if already processed
    if (processedMessages.has(msgId)) return;
    processedMessages.add(msgId);
    
    // Clean old processed messages (keep last 100)
    if (processedMessages.size > 100) {
      const toDelete = Array.from(processedMessages).slice(0, processedMessages.size - 100);
      toDelete.forEach(id => processedMessages.delete(id));
    }
    
    const text = dataMessage.message;
    const from = envelope.sourceName || envelope.sourceNumber;
    
    console.log(`\n📨 Message received`);
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
  } catch (error) {
    console.error('Error processing message:', error);
  }
}

// Connect to WebSocket
function connectWebSocket() {
  const wsUrl = `${SIGNAL_API.replace('http', 'ws')}/v1/receive/${encodeURIComponent(PHONE)}`;
  console.log(`🔌 Connecting to WebSocket: ${wsUrl}\n`);
  
  const ws = new WebSocket(wsUrl);
  
  ws.on('open', async () => {
    console.log('✅ WebSocket connected!');
    console.log('👂 Listening for real-time messages...\n');
    
    // Send startup message
    await sendGroupMessage('Bot: AI-powered Signal bot is now active! 🤖🧠 Using WebSocket for real-time responses. Ask me anything!');
  });
  
  ws.on('message', (data) => {
    processMessage(data.toString());
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error.message);
  });
  
  ws.on('close', (code, reason) => {
    console.log(`⚠️ WebSocket closed: ${code} - ${reason}`);
    console.log('🔄 Reconnecting in 5 seconds...');
    setTimeout(connectWebSocket, 5000);
  });
  
  ws.on('ping', () => {
    console.log('🏓 Received ping from server');
  });
  
  ws.on('pong', () => {
    console.log('🏓 Received pong from server');
  });
  
  return ws;
}

// Main function
async function main() {
  console.log('🚀 Bot is starting...\n');
  
  // Connect to WebSocket
  const ws = connectWebSocket();
  
  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n🛑 Shutting down...');
    await sendGroupMessage('Bot: Going offline. Goodbye! 👋');
    ws.close();
    process.exit(0);
  });
}

// Start the bot
main().catch(console.error);