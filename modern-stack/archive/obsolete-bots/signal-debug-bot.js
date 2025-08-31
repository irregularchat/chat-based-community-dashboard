#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });

const SIGNAL_API = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
const PHONE = process.env.SIGNAL_PHONE_NUMBER || '+19108471202';
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SOLO_GROUP = '/cjfmI7snAAhRPLDMlvW50Ja8fE9SuslMBFukFjn9iI=';

console.log('🤖 Signal DEBUG Bot Starting...\n');
console.log('📱 Phone:', PHONE);
console.log('🌐 Signal API:', SIGNAL_API);
console.log('🧠 OpenAI:', OPENAI_KEY ? 'Configured' : 'Not configured');
console.log('🎯 Target Group:', SOLO_GROUP);
console.log('');

// Track processed messages to avoid duplicates
const processedMessages = new Set();
const messageHandlers = new Map();

// Register all bot commands
function registerCommands() {
  // Help command
  messageHandlers.set('!help', async (message, from) => {
    const helpText = `🤖 **Signal Bot Help - Debug Version**

Available commands:
• !help - Show this help message  
• !ping - Test bot response
• !echo <text> - Echo your text
• !ai <question> - Ask AI a question
• !status - Show bot status
• !debug - Show debug information

Debug version is running with enhanced logging.`;
    
    console.log(`📋 Sending help to ${from}`);
    await sendGroupMessage(`Bot: ${helpText}`);
  });

  messageHandlers.set('!ping', async (message, from) => {
    console.log(`🏓 Ping from ${from}`);
    await sendGroupMessage('Bot: 🏓 Pong! Debug bot is working!');
  });

  messageHandlers.set('!echo', async (message, from) => {
    const text = message.replace(/^!echo\s+/i, '').trim();
    console.log(`🔊 Echo request from ${from}: "${text}"`);
    await sendGroupMessage(`Bot: Echo: ${text}`);
  });

  messageHandlers.set('!status', async (message, from) => {
    const status = `🤖 Debug Bot Status:
- Version: Debug 1.0
- Phone: ${PHONE}
- API: ${SIGNAL_API}
- Commands: ${messageHandlers.size}
- Processed Messages: ${processedMessages.size}
- AI: ${OPENAI_KEY ? 'Ready' : 'Not configured'}`;
    
    console.log(`📊 Status request from ${from}`);
    await sendGroupMessage(`Bot: ${status}`);
  });

  messageHandlers.set('!debug', async (message, from) => {
    const debug = `🐛 Debug Information:
- Target Group: ${SOLO_GROUP}
- Message Handlers: ${Array.from(messageHandlers.keys()).join(', ')}
- Last Message Check: ${new Date().toISOString()}`;
    
    console.log(`🐛 Debug request from ${from}`);
    await sendGroupMessage(`Bot: ${debug}`);
  });

  messageHandlers.set('!ai', async (message, from) => {
    const question = message.replace(/^!ai\s+/i, '').trim();
    if (!question) {
      await sendGroupMessage("Bot: Please provide a question after !ai");
      return;
    }
    
    console.log(`🧠 AI request from ${from}: "${question}"`);
    const response = await getAIResponse(question);
    await sendGroupMessage(`Bot: ${response}`);
  });

  console.log(`📋 Registered ${messageHandlers.size} debug commands`);
}

// Send message to group
async function sendGroupMessage(message) {
  try {
    console.log(`📤 Attempting to send: ${message.substring(0, 100)}...`);
    
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
    console.log(`📤 Send response:`, result);
    
    if (result.timestamp) {
      console.log(`✅ SENT SUCCESSFULLY: ${message.substring(0, 50)}...`);
      return true;
    } else {
      console.log('❌ SEND FAILED:', result.error || result);
      return false;
    }
  } catch (error) {
    console.error('❌ SEND ERROR:', error.message);
    return false;
  }
}

// Get AI response
async function getAIResponse(message) {
  if (!OPENAI_KEY) {
    return "AI not configured in debug mode";
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
            content: 'You are a helpful debug Signal bot. Keep responses brief.'
          },
          {
            role: 'user',
            content: message
          }
        ],
        max_tokens: 100,
        temperature: 0.7
      })
    });
    
    if (!response.ok) {
      return `AI error: ${response.status}`;
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    return `AI error: ${error.message}`;
  }
}

// Process incoming message with detailed logging
async function processMessage(text, from, envelope) {
  console.log(`\n🔍 PROCESSING MESSAGE:`);
  console.log(`   From: ${from}`);
  console.log(`   Text: "${text}"`);
  console.log(`   Text Length: ${text.length}`);
  console.log(`   Text Lowercase: "${text.toLowerCase()}"`);
  
  // Check for exact command matches
  for (const [command, handler] of messageHandlers) {
    console.log(`   Checking exact match: "${text.toLowerCase()}" === "${command}"`);
    if (text.toLowerCase() === command.toLowerCase()) {
      console.log(`🎯 EXACT MATCH FOUND: ${command}`);
      await handler(text, from);
      return;
    }
  }
  
  // Check for prefix matches
  for (const [command, handler] of messageHandlers) {
    const commandWithSpace = command.toLowerCase() + ' ';
    console.log(`   Checking prefix match: "${text.toLowerCase()}" starts with "${commandWithSpace}"`);
    if (text.toLowerCase().startsWith(commandWithSpace)) {
      console.log(`🎯 PREFIX MATCH FOUND: ${command}`);
      await handler(text, from);
      return;
    }
  }
  
  // Special patterns
  if (text.toLowerCase().includes('echo me')) {
    console.log(`🔊 ECHO PATTERN DETECTED`);
    const toEcho = text.replace(/.*echo\s+me\s*/i, '').trim() || 'Hello!';
    await sendGroupMessage(`Bot: Echo: ${toEcho}`);
    return;
  }
  
  if (text.includes('?')) {
    console.log(`❓ QUESTION DETECTED - routing to AI`);
    const response = await getAIResponse(text);
    await sendGroupMessage(`Bot: ${response}`);
    return;
  }
  
  if (['hello', 'hi', 'hey'].some(greeting => text.toLowerCase().includes(greeting))) {
    console.log(`👋 GREETING DETECTED`);
    await sendGroupMessage(`Bot: Hello ${from}! Try !help for commands or !ping to test me.`);
    return;
  }
  
  console.log(`❌ NO PATTERN MATCHED for: "${text}"`);
  console.log(`   Available commands: ${Array.from(messageHandlers.keys()).join(', ')}`);
}

// Enhanced message receiving with detailed logging
async function receiveMessages() {
  console.log(`📡 Starting receive poll...`);
  
  try {
    const url = `${SIGNAL_API}/v1/receive/${encodeURIComponent(PHONE)}`;
    console.log(`📡 Polling URL: ${url}`);
    
    const response = await fetch(url, {
      signal: AbortSignal.timeout(25000)
    });
    
    console.log(`📡 Receive response status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      console.error(`❌ RECEIVE FAILED: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.error(`❌ Error body: ${errorText}`);
      return;
    }
    
    const messages = await response.json();
    console.log(`📡 Raw response: ${JSON.stringify(messages, null, 2)}`);
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.log(`📡 No messages received (${messages ? messages.length : 0})`);
      return;
    }
    
    console.log(`\n📨 RECEIVED ${messages.length} MESSAGE(S):`);
    
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      console.log(`\n📨 Processing message ${i + 1}/${messages.length}:`);
      console.log(`   Full message: ${JSON.stringify(msg, null, 2)}`);
      
      const envelope = msg.envelope;
      if (!envelope) {
        console.log(`❌ No envelope in message ${i + 1}`);
        continue;
      }
      
      const dataMessage = envelope.dataMessage;
      if (!dataMessage) {
        console.log(`❌ No dataMessage in message ${i + 1}`);
        continue;
      }
      
      if (!dataMessage.message) {
        console.log(`❌ No message text in message ${i + 1}`);
        continue;
      }
      
      // Create message ID
      const msgId = `${envelope.timestamp}_${envelope.sourceNumber}`;
      console.log(`🆔 Message ID: ${msgId}`);
      
      if (processedMessages.has(msgId)) {
        console.log(`🔄 Message already processed: ${msgId}`);
        continue;
      }
      
      processedMessages.add(msgId);
      
      const text = dataMessage.message;
      const from = envelope.sourceName || envelope.sourceNumber;
      
      console.log(`📝 Message details:`);
      console.log(`   Text: "${text}"`);
      console.log(`   From: "${from}"`);
      console.log(`   Source Number: "${envelope.sourceNumber}"`);
      console.log(`   Timestamp: ${envelope.timestamp}`);
      
      // Check group info
      if (dataMessage.groupInfo) {
        console.log(`👥 Group info:`);
        console.log(`   Group ID: "${dataMessage.groupInfo.groupId}"`);
        console.log(`   Target Group: "${SOLO_GROUP}"`);
        console.log(`   Match: ${dataMessage.groupInfo.groupId === SOLO_GROUP}`);
        
        if (dataMessage.groupInfo.groupId === SOLO_GROUP) {
          if (text.startsWith('Bot:')) {
            console.log(`🤖 Skipping bot's own message`);
          } else {
            console.log(`✅ Processing user message in target group`);
            await processMessage(text, from, envelope);
          }
        } else {
          console.log(`🚫 Message not from target group`);
        }
      } else {
        console.log(`📱 Direct message (no group info)`);
        await processMessage(text, from, envelope);
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`⏰ Receive timeout (normal for long-polling)`);
    } else {
      console.error(`❌ RECEIVE ERROR:`, error);
    }
  }
}

// Main function
async function main() {
  console.log('🚀 DEBUG BOT STARTING...\n');
  
  registerCommands();
  
  // Test API connection
  try {
    const response = await fetch(`${SIGNAL_API}/v1/about`);
    const about = await response.json();
    console.log('✅ API Connection Test:', about);
  } catch (error) {
    console.error('❌ API Connection Failed:', error);
  }
  
  // Send startup message
  console.log('\n📤 Sending startup message...');
  await sendGroupMessage('Bot: 🐛 DEBUG Signal bot is active! Enhanced logging enabled. Try !help, !ping, or !debug');
  
  console.log('\n👂 STARTING MESSAGE LOOP...');
  console.log('   Enhanced debugging is ON');
  console.log('   All message processing will be logged');
  console.log('   (Press Ctrl+C to stop)\n');
  
  // Main message loop
  let loopCount = 0;
  while (true) {
    loopCount++;
    console.log(`\n🔄 Loop ${loopCount}: ${new Date().toISOString()}`);
    
    await receiveMessages();
    
    console.log(`⏳ Waiting 3 seconds before next poll...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 SHUTTING DOWN DEBUG BOT...');
  await sendGroupMessage('Bot: 🐛 Debug bot going offline. Goodbye!');
  process.exit(0);
});

// Start the bot
main().catch(error => {
  console.error('💥 FATAL ERROR:', error);
  process.exit(1);
});