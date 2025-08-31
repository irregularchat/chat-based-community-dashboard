#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });

const SIGNAL_API_URL = process.env.SIGNAL_CLI_REST_API_BASE_URL || 'http://localhost:50240';
const PHONE_NUMBER = process.env.SIGNAL_PHONE_NUMBER || '+19108471202';

console.log('🧪 Testing Signal Group Communication\n');

async function getGroups() {
  try {
    const response = await fetch(`${SIGNAL_API_URL}/v1/groups/${encodeURIComponent(PHONE_NUMBER)}`);
    const groups = await response.json();
    return groups;
  } catch (error) {
    console.error('Failed to get groups:', error);
    return [];
  }
}

async function sendToGroup(groupId, message) {
  try {
    console.log(`📤 Sending to group...`);
    const response = await fetch(`${SIGNAL_API_URL}/v1/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: message,
        number: PHONE_NUMBER,
        'group-id': groupId
      }),
    });
    
    const result = await response.json();
    console.log('✅ Message sent:', result);
    return result;
  } catch (error) {
    console.error('❌ Failed to send message:', error);
  }
}

async function pollMessages() {
  console.log('👂 Polling for messages...');
  
  try {
    const response = await fetch(`${SIGNAL_API_URL}/v1/receive/${encodeURIComponent(PHONE_NUMBER)}`);
    const messages = await response.json();
    
    if (messages && messages.length > 0) {
      console.log(`📨 Received ${messages.length} messages:`);
      
      for (const msg of messages) {
        const envelope = msg.envelope;
        if (envelope) {
          const dataMessage = envelope.dataMessage;
          if (dataMessage && dataMessage.message) {
            console.log(`   From: ${envelope.sourceName || envelope.sourceNumber}`);
            console.log(`   Message: ${dataMessage.message}`);
            
            // Check if it's a group message
            if (dataMessage.groupInfo) {
              console.log(`   Group: ${dataMessage.groupInfo.groupId}`);
              
              // Auto-reply to group messages
              if (!dataMessage.message.startsWith('Bot:')) {
                const reply = `Bot: I received your message "${dataMessage.message}"`;
                await sendToGroup(dataMessage.groupInfo.groupId, reply);
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('Error polling messages:', error);
  }
}

async function main() {
  // Get groups
  console.log('📋 Getting Signal groups...');
  const groups = await getGroups();
  
  if (groups.length > 0) {
    console.log(`Found ${groups.length} groups:`);
    groups.forEach(g => {
      console.log(`   - ${g.name} (${g.id})`);
    });
    console.log('');
  }
  
  // Find Solo testing group
  const soloTestingGroup = groups.find(g => g.name === 'Solo testing');
  
  if (soloTestingGroup) {
    console.log('✅ Found "Solo testing" group!');
    console.log(`   ID: ${soloTestingGroup.id}\n`);
    
    // Send a test message
    await sendToGroup(soloTestingGroup.id, 'Bot: Signal bot is now active and listening! 🤖');
    
    // Start polling for messages
    console.log('🔄 Starting message polling (every 3 seconds)...');
    console.log('   Send a message to the group to test the bot.');
    console.log('   Press Ctrl+C to stop.\n');
    
    // Poll immediately
    await pollMessages();
    
    // Then poll every 3 seconds
    setInterval(pollMessages, 3000);
    
  } else {
    console.log('❌ "Solo testing" group not found!');
    console.log('   Make sure the bot is added to the group.');
  }
}

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Stopping Signal bot...');
  process.exit(0);
});

main();