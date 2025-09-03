#!/usr/bin/env node

const net = require('net');

async function sendPingCommand() {
  console.log('🏓 Sending !ping command to Entry/INDOC room...');
  
  const socket = new net.Socket();
  const socketPath = '/tmp/signal-cli-socket';
  const groupId = 'PjJCT6d4nrF0/BZOs39ECX/lZkcHPbi65JU8B6kgw6s=';
  const message = '!ping';
  
  return new Promise((resolve, reject) => {
    let responseData = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log('⚠️ Request timed out but message may have been sent');
        resolve(true); // Send messages often succeed even if they timeout
      }
    }, 10000);
    
    socket.connect(socketPath, () => {
      console.log('✅ Connected to Signal CLI socket');
      
      // Send the message request
      const request = {
        jsonrpc: '2.0',
        method: 'send',
        params: {
          groupId: groupId,
          message: message
        },
        id: 'ping-test-' + Date.now()
      };
      
      console.log('📤 Sending request:', JSON.stringify(request, null, 2));
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const lines = responseData.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          console.log('📥 Received response:', JSON.stringify(response, null, 2));
          
          if (response.id && response.id.startsWith('ping-test-')) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result !== undefined) {
                console.log('✅ Message sent successfully!');
                resolve(true);
              } else if (response.error) {
                console.log('❌ Error sending message:', response.error);
                reject(new Error(response.error.message || 'Unknown error'));
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
  console.log('Signal Bot Ping Test');
  console.log('=' + '='.repeat(40));
  console.log('Target Group ID: PjJCT6d4nrF0/BZOs39ECX/lZkcHPbi65JU8B6kgw6s=');
  console.log('Command: !ping');
  console.log('');
  
  try {
    await sendPingCommand();
    console.log('\n🎉 Ping command sent to Entry/INDOC room!');
    console.log('Check the Signal group to see if the bot responded.');
  } catch (error) {
    console.log('\n❌ Failed to send ping command:', error.message);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});