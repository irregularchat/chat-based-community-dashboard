#!/usr/bin/env node

const net = require('net');

const SOCKET_PATH = '/tmp/signal-cli-socket';
const GROUP_ID = 'kHSJpz6meH83aAiAdT7TphmICx9c2/LYO6QucWxOjKU='; // IrregularChat: FBNC

// Simple promise wrapper for socket operations
function sendJsonRpcRequest(socket, request) {
  return new Promise((resolve, reject) => {
    const requestStr = JSON.stringify(request) + '\n';
    let responseReceived = false;
    
    const onData = (data) => {
      if (responseReceived) return;
      
      try {
        const lines = data.toString().split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              responseReceived = true;
              socket.off('data', onData);
              clearTimeout(timeoutId);
              
              if (response.error) {
                reject(new Error(response.error.message || 'Unknown error'));
              } else {
                resolve(response);
              }
              return;
            }
          } catch (parseError) {
            // Ignore parse errors for non-JSON lines
          }
        }
      } catch (error) {
        // Ignore errors, might be partial data
      }
    };
    
    const timeoutId = setTimeout(() => {
      if (!responseReceived) {
        responseReceived = true;
        socket.off('data', onData);
        reject(new Error('Request timeout'));
      }
    }, 10000); // 10 second timeout
    
    socket.on('data', onData);
    socket.write(requestStr);
  });
}

async function sendGroupMessage(socket, groupId, message) {
  const request = {
    jsonrpc: '2.0',
    method: 'send',
    params: {
      groupId: groupId,
      message: message
    },
    id: Date.now()
  };
  
  console.log(`📤 Sending message: "${message}"`);
  return sendJsonRpcRequest(socket, request);
}

async function main() {
  const socket = new net.Socket();
  
  try {
    // Connect to Signal CLI socket
    await new Promise((resolve, reject) => {
      socket.connect(SOCKET_PATH, () => {
        console.log('✅ Connected to Signal CLI socket');
        resolve();
      });
      
      socket.on('error', (error) => {
        reject(new Error(`Socket connection failed: ${error.message}`));
      });
    });
    
    console.log('🚀 Starting Signal bot test sequence...\n');
    
    // Step 1: Send ping command to verify bot responsiveness
    console.log('Step 1: Testing bot responsiveness with !ping command');
    await sendGroupMessage(socket, GROUP_ID, '!ping');
    console.log('✅ Ping command sent successfully\n');
    
    // Wait 2 seconds before sending the next command
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 2: Send removeuser command
    console.log('Step 2: Sending !removeuser command');
    const removeCommand = '!removeuser 4 nonadmin goble hedc';
    await sendGroupMessage(socket, GROUP_ID, removeCommand);
    console.log('✅ Remove user command sent successfully\n');
    
    console.log('🎉 Test sequence completed!');
    console.log('Commands sent:');
    console.log('  1. !ping');
    console.log('  2. !removeuser 4 nonadmin goble hedc');
    console.log('\nMonitor the Signal group for bot responses.');
    
  } catch (error) {
    console.error('❌ Error during test sequence:', error.message);
    process.exit(1);
  } finally {
    socket.end();
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Test sequence interrupted');
  process.exit(0);
});

main();