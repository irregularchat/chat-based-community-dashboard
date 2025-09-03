#!/usr/bin/env node

const net = require('net');

async function checkCounterUxVStatus() {
  console.log('🔍 Checking Counter UxV group current status via Signal CLI...');
  
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    let responseData = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(new Error('Request timeout'));
      }
    }, 30000);
    
    socket.connect(socketPath, () => {
      console.log('✅ Connected to Signal CLI socket');
      
      const request = {
        jsonrpc: '2.0',
        method: 'listGroups',
        params: {
          account: process.env.SIGNAL_BOT_PHONE_NUMBER || process.env.SIGNAL_PHONE_NUMBER || '+19108471202',
          'get-members': true,
          'get-admins': true
        },
        id: 'check-counter-uxv-' + Date.now()
      };
      
      console.log('📤 Requesting fresh group list with members...');
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const lines = responseData.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          
          if (response.id && response.id.startsWith('check-counter-uxv-')) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result) {
                resolve(response.result);
              } else if (response.error) {
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
        reject(error);
      }
    });
  });
}

async function main() {
  try {
    const groups = await checkCounterUxVStatus();
    
    console.log('📊 Current Signal groups:');
    groups.forEach((group, index) => {
      const memberCount = group.members ? group.members.length : 0;
      const adminCount = group.admins ? group.admins.length : 0;
      console.log(`  ${index + 1}. ${group.name || 'Unnamed'} - ${memberCount} members (${adminCount} admins)`);
      
      if (group.name && group.name.toLowerCase().includes('counter') && group.name.toLowerCase().includes('uxv')) {
        console.log(`🎯 Found Counter UxV: ${memberCount} current members`);
        console.log(`📍 Group ID: ${group.id}`);
        if (group.members && group.members.length > 0) {
          console.log(`👥 Sample members:`, group.members.slice(0, 3).map(m => m.number || m.uuid));
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

main();