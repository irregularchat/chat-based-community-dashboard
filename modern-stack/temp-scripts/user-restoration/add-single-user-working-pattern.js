#!/usr/bin/env node

const net = require('net');
const fs = require('fs');

// Read one user from our cleaned list to test with
const cleanedData = JSON.parse(fs.readFileSync('cleaned-removed-users.json', 'utf8'));
const testUser = cleanedData.users[0]; // "John K"

async function addUserWithWorkingPattern() {
  console.log(`🧪 TESTING: Adding ${testUser.name} using working pattern`);
  console.log('=' + '='.repeat(50));
  
  const counterUxvGroupId = 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=';
  const userIdentifier = testUser.identifier;
  
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
          addMembers: [userIdentifier]
          // Note: NOT adding as admin, just as regular member
        },
        id: `add-user-working-${Date.now()}`
      };
      
      console.log(`📤 Adding ${testUser.name} (${userIdentifier}) to Counter UxV...`);
      console.log(`📋 Request: ${JSON.stringify(request, null, 2)}`);
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const lines = responseData.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          console.log('📥 Response:', JSON.stringify(response, null, 2));
          
          if (response.id && response.id.startsWith('add-user-working-')) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result !== undefined) {
                console.log(`✅ Successfully sent add request for ${testUser.name}!`);
                console.log('⚠️ Now check Counter UXV group manually to verify if user actually appeared');
                resolve(true);
              } else if (response.error) {
                console.log(`❌ Error: ${JSON.stringify(response.error, null, 2)}`);
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
        console.log(`🔄 Accumulating response data... (${responseData.length} chars)`);
      }
    });
    
    socket.on('error', (error) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        console.log(`❌ Socket error: ${error.message}`);
        reject(error);
      }
    });
  });
}

async function main() {
  try {
    await addUserWithWorkingPattern();
    console.log(`\n📋 Manual verification required:`);
    console.log(`1. Check Counter UXV group in Signal app`);
    console.log(`2. Look for user: ${testUser.name}`);
    console.log(`3. If user appeared, the pattern works - we can proceed with bulk restore`);
    console.log(`4. If user did NOT appear, there's still an underlying issue`);
  } catch (error) {
    console.error(`💥 Failed to add user: ${error.message}`);
  }
}

main();