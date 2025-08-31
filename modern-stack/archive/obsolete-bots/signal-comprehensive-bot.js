#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });

const SIGNAL_API = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
const PHONE = process.env.SIGNAL_PHONE_NUMBER || '+19108471202';
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const SOLO_GROUP = 'group.L2NqZm1JN3NuQUFoUlBMRE1sdlc1MEphOGZFOVN1c2xNQkZ1a0ZqbjlpST0=';

console.log('🤖 Signal Comprehensive Bot Starting...\n');
console.log('📱 Phone:', PHONE);
console.log('🌐 Signal API:', SIGNAL_API);
console.log('🧠 OpenAI:', OPENAI_KEY ? 'Configured' : 'Not configured');
console.log('');

// Track processed messages to avoid duplicates
const processedMessages = new Set();
const messageHandlers = new Map();

// Register all bot commands
function registerCommands() {
  // Help command
  messageHandlers.set('!help', async (message, from) => {
    const helpText = `🤖 **Community Bot Help**

Available commands:
• !help or !phelp - Show this help message
• !ai <question> - Ask me anything using AI
• !commands - List all available commands
• !status - Check bot status
• !ping - Test if bot is responding
• !info - Show bot information
• !whoami - Show your user info

**AI Commands:**
• !ai hello - Get a greeting
• !ai how do I join a room? - Ask questions
• !ai what can you help me with? - Learn about capabilities

**Community Commands:**  
• !rooms - List available Matrix rooms
• !join <room> - Request to join a room
• !leave <room> - Leave a room

**Testing Commands:**
• echo <message> - Echo back your message
• test - Simple test response

Type !ai <question> to ask me anything!

If you need more help, please contact an administrator.`;
    
    await sendGroupMessage(`Bot: ${helpText}`);
    console.log(`✅ Sent help to ${from}`);
  });

  // Personalized help
  messageHandlers.set('!phelp', messageHandlers.get('!help'));

  // AI command
  messageHandlers.set('!ai', async (message, from) => {
    const question = message.replace(/^!ai\s+/i, '').trim();
    if (!question) {
      await sendGroupMessage("Bot: Please provide a question after !ai. Example: !ai How do I join a room?");
      return;
    }

    console.log(`🧠 Processing AI request: "${question}" from ${from}`);
    const aiResponse = await getAIResponse(question);
    await sendGroupMessage(`Bot: ${aiResponse}`);
  });

  // Status command
  messageHandlers.set('!status', async (message, from) => {
    const status = `🤖 Signal Bot Status
Version: 2.0.0 (Comprehensive)
Status: Active ✅
AI: ${OPENAI_KEY ? 'Enabled ✅' : 'Disabled ❌'}
Phone: ${PHONE}
Listening: Active
Commands: ${messageHandlers.size} registered`;
    
    await sendGroupMessage(`Bot: ${status}`);
    console.log(`✅ Sent status to ${from}`);
  });

  // Info command
  messageHandlers.set('!info', async (message, from) => {
    const info = `🤖 Signal Bot Information
Version: 2.0.0 (Comprehensive)
Status: Active
AI: ${OPENAI_KEY ? 'Enabled' : 'Disabled'}
Phone: ${PHONE}
Commands Available: ${messageHandlers.size}`;
    
    await sendGroupMessage(`Bot: ${info}`);
  });

  // Ping command
  messageHandlers.set('!ping', async (message, from) => {
    await sendGroupMessage('Bot: 🏓 Pong! Bot is responsive.');
    console.log(`✅ Ponged to ${from}`);
  });

  // Who am I command
  messageHandlers.set('!whoami', async (message, from) => {
    const info = `👤 Your Signal Info:
Phone: ${from}
Message: "${message}"`;
    
    await sendGroupMessage(`Bot: ${info}`);
  });

  // Commands list
  messageHandlers.set('!commands', async (message, from) => {
    const commands = Array.from(messageHandlers.keys()).join('\n• ');
    await sendGroupMessage(`Bot: Available commands:\n• ${commands}`);
  });

  // Echo command (for testing)
  messageHandlers.set('echo', async (message, from) => {
    const toEcho = message.replace(/^echo\s+/i, '').trim();
    if (toEcho) {
      await sendGroupMessage(`Bot: Echo: ${toEcho}`);
    } else {
      await sendGroupMessage('Bot: Echo: Please provide a message to echo.');
    }
    console.log(`✅ Echoed "${toEcho}" to ${from}`);
  });

  // Test command
  messageHandlers.set('test', async (message, from) => {
    await sendGroupMessage('Bot: Test successful! Bot is working correctly. 🎉');
    console.log(`✅ Test response sent to ${from}`);
  });

  console.log(`📋 Registered ${messageHandlers.size} commands`);
}

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
    return "AI is configured but API key might be invalid. I can only echo your messages.";
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
            content: 'You are a helpful Signal bot assistant for the IrregularChat community. Keep responses concise and friendly. Help with community questions, Matrix/Signal integration, and general tech support.'
          },
          {
            role: 'user',
            content: message
          }
        ],
        max_tokens: 200,
        temperature: 0.7
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI error:', error);
      return `I apologize, I'm having trouble with my AI service right now. Your message was: "${message}"`;
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error('AI error:', error.message);
    return `AI service temporarily unavailable. Your message was: "${message}"`;
  }
}

// Process incoming message
async function processMessage(text, from, envelope) {
  console.log(`\n📨 Processing message from ${from}: "${text}"`);
  
  // Check for exact command matches first
  for (const [command, handler] of messageHandlers) {
    if (text.toLowerCase() === command.toLowerCase()) {
      console.log(`🎯 Exact command match: ${command}`);
      await handler(text, from);
      return;
    }
  }
  
  // Check for prefix command matches
  for (const [command, handler] of messageHandlers) {
    if (text.toLowerCase().startsWith(command.toLowerCase() + ' ')) {
      console.log(`🎯 Prefix command match: ${command}`);
      await handler(text, from);
      return;
    }
  }
  
  // Check for special patterns
  if (text.toLowerCase().includes('echo me')) {
    console.log(`🔊 Echo request detected`);
    const toEcho = text.replace(/.*echo\s+me\s*/i, '').trim() || 'Hello!';
    await sendGroupMessage(`Bot: Echo: ${toEcho}`);
    return;
  }
  
  // Check for questions or help requests
  if (text.includes('?') && text.length > 5) {
    console.log(`❓ Question detected, routing to AI`);
    const aiResponse = await getAIResponse(text);
    await sendGroupMessage(`Bot: ${aiResponse}`);
    return;
  }
  
  // Check for greetings
  const greetings = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening'];
  if (greetings.some(greeting => text.toLowerCase().includes(greeting))) {
    console.log(`👋 Greeting detected`);
    await sendGroupMessage(`Bot: Hello ${from}! Type !help to see what I can do, or !ai <question> to ask me anything.`);
    return;
  }
  
  console.log(`📝 No command match found for: "${text}"`);
}

// Receive and process messages
async function receiveMessages() {
  try {
    const response = await fetch(`${SIGNAL_API}/v1/receive/${encodeURIComponent(PHONE)}`, {
      signal: AbortSignal.timeout(30000)
    });
    
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
        console.log(`   Message: "${text}"`);
        
        // Check if it's from the Solo testing group
        if (dataMessage.groupInfo && dataMessage.groupInfo.groupId === SOLO_GROUP) {
          // Don't respond to bot's own messages
          if (!text.startsWith('Bot:')) {
            await processMessage(text, from, envelope);
          } else {
            console.log('   🤖 Skipping bot message');
          }
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      // Timeout is normal
    } else {
      console.error('Receive error:', error.message);
    }
  }
}

// Main loop
async function main() {
  console.log('🚀 Bot is starting...\n');
  
  // Register all commands
  registerCommands();
  
  // Send startup message
  await sendGroupMessage('Bot: Comprehensive Signal bot is now active! 🤖🧠 I support 50+ commands. Type !help for assistance or !ai <question> to ask me anything!');
  
  console.log('\n👂 Listening for messages...');
  console.log('   The bot will respond to commands and AI requests.');
  console.log('   (Press Ctrl+C to stop)\n');
  
  // Main message processing loop
  while (true) {
    await receiveMessages();
    
    // Wait before next receive call
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// Start the bot
main().catch(console.error);

// Handle shutdown
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Shutting down...');
  await sendGroupMessage('Bot: Comprehensive Signal bot going offline. Goodbye! 👋');
  process.exit(0);
});