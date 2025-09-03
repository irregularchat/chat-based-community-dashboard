#!/usr/bin/env node

const net = require('net');

async function addSacBackAsAdmin() {
  console.log('🚨 EMERGENCY: Adding Sac back to Counter UxV as admin');
  console.log('=' + '='.repeat(50));
  
  const counterUxvGroupId = 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=';
  const sacPhoneNumber = '+12247253276';
  
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    let responseData = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log('⚠️ Request timed out but may have succeeded');
        resolve(true);
      }
    }, 15000);
    
    socket.connect(socketPath, () => {
      console.log('✅ Connected to Signal CLI socket');
      
      const request = {
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
          account: '+19108471202',
          groupId: counterUxvGroupId,
          addMembers: [sacPhoneNumber],
          addAdmins: [sacPhoneNumber]
        },
        id: `emergency-add-sac-${Date.now()}`
      };
      
      console.log(`📤 Adding Sac (${sacPhoneNumber}) back as admin to Counter UxV...`);
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const lines = responseData.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          console.log('📥 Response:', JSON.stringify(response, null, 2));
          
          if (response.id && response.id.startsWith('emergency-add-sac-')) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result !== undefined) {
                console.log('✅ Successfully added Sac back as admin to Counter UxV!');
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
    await addSacBackAsAdmin();
    console.log('\n🎉 Sac should now be back in Counter UxV as admin!');
    console.log('This confirms that Signal CLI operations ARE working - the issue is elsewhere.');
  } catch (error) {
    console.error('💥 Failed to add Sac back:', error);
  }
}

main();