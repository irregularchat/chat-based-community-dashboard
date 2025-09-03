#!/usr/bin/env node

const net = require('net');

async function checkBotStatus() {
  console.log('🔍 Checking Signal bot status...');
  
  const socket = new net.Socket();
  const socketPath = '/tmp/signal-cli-socket';
  
  return new Promise((resolve) => {
    let responseData = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log('❌ Bot is not responding (timeout)');
        resolve(false);
      }
    }, 5000);
    
    socket.connect(socketPath, () => {
      console.log('✅ Connected to Signal CLI socket');
      
      // Send a simple listGroups request to test
      const request = {
        jsonrpc: '2.0',
        method: 'listGroups',
        params: {
          account: '+19108471202'
        },
        id: 'test-' + Date.now()
      };
      
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const lines = responseData.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          if (response.id && response.id.startsWith('test-')) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result) {
                console.log('✅ Bot is responding correctly');
                console.log(`📊 Found ${response.result.length} groups`);
                resolve(true);
              } else if (response.error) {
                console.log('❌ Bot returned error:', response.error);
                resolve(false);
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
        resolve(false);
      }
    });
  });
}

async function main() {
  console.log('Signal Bot Status Check');
  console.log('=' + '='.repeat(40));
  
  const isWorking = await checkBotStatus();
  
  if (isWorking) {
    console.log('\n✅ Signal bot is operational');
    console.log('The bot should be able to process commands.');
  } else {
    console.log('\n❌ Signal bot is not working properly');
    console.log('The bot may need to be restarted.');
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});