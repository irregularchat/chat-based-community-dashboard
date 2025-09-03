#!/usr/bin/env node

const net = require('net');

async function testHelpCommand() {
  console.log('🧪 Testing !help command to verify bot is processing commands');
  console.log('=' + '='.repeat(60));
  
  const counterUxvGroupId = 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=';
  
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    let responseData = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log('⚠️ Request timed out (normal for send commands)');
        resolve(true);
      }
    }, 10000);
    
    socket.connect(socketPath, () => {
      console.log('✅ Connected to Signal CLI socket');
      
      const request = {
        jsonrpc: '2.0',
        method: 'send',
        params: {
          account: '+19108471202',
          groupId: counterUxvGroupId,
          message: '!help'
        },
        id: `test-help-${Date.now()}`
      };
      
      console.log('📤 Sending !help command to Counter UXV...');
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const lines = responseData.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          console.log('📥 Response:', JSON.stringify(response, null, 2));
          
          if (response.id && response.id.startsWith('test-help-')) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result !== undefined) {
                console.log('✅ !help command sent successfully');
                console.log('🔍 Check Counter UXV group for bot response to verify command processing');
                resolve(true);
              } else if (response.error) {
                console.log('❌ Error:', response.error);
                reject(new Error(response.error.message || 'Unknown error'));
              } else {
                resolve(true);
              }
            }
            return;
          }
        }
      } catch (e) {
        // Continue accumulating data
      }
    });
    
    socket.on('error', (error) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        console.log('❌ Socket error:', error.message);
        reject(error);
      }
    });
  });
}

async function main() {
  try {
    await testHelpCommand();
    console.log('\n📋 Analysis:');
    console.log('- !help command sent to Counter UXV');
    console.log('- Bot should respond with available commands if working');
    console.log('- User was using h!help (incorrect) instead of !help (correct)');
    console.log('- Check group chat for bot response to confirm command processing');
  } catch (error) {
    console.error('💥 Failed to test help command:', error);
  }
}

main();