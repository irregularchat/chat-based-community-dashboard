#!/usr/bin/env node

const net = require('net');

// Let's try adding the user's phone number (+12247253276) back to the group
// We know this worked before, so this should definitely work if the bot has proper permissions
const counterUxvGroupId = 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=';
const socketPath = '/tmp/signal-cli-socket';

function sendCommand(command, description) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let responseData = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log(`⚠️ ${description} timed out`);
        resolve({ timeout: true });
      }
    }, 15000);
    
    socket.connect(socketPath, () => {
      console.log(`📡 ${description}...`);
      socket.write(JSON.stringify(command) + '\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      if (responseData.includes('"jsonrpc":"2.0"') && responseData.includes(`"id":"${command.id}"`)) {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          socket.destroy();
          
          try {
            const lines = responseData.split('\n');
            for (const line of lines) {
              if (line.includes('"jsonrpc":"2.0"') && line.includes(`"id":"${command.id}"`)) {
                const response = JSON.parse(line.trim());
                resolve(response);
                return;
              }
            }
            resolve({ rawResponse: responseData });
          } catch (e) {
            resolve({ rawResponse: responseData, parseError: e.message });
          }
        }
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

async function testWithKnownWorkingUser() {
  console.log('🧪 Testing with a known working user (Sac)');
  console.log('=' + '='.repeat(45));
  
  // Try to remove and re-add Sac to test if the mechanism is working at all
  const sacPhone = '+12247253276';
  
  console.log('Step 1: Remove Sac from group (to test removal works)');
  try {
    const removeResult = await sendCommand({
      jsonrpc: '2.0',
      method: 'updateGroup', 
      params: {
        account: '+19108471202',
        groupId: counterUxvGroupId,
        removeMembers: [sacPhone]
      },
      id: 'test-remove-sac'
    }, 'Removing Sac temporarily');
    
    console.log(`   Remove result: ${removeResult.error ? '❌ ' + removeResult.error.message : removeResult.result !== undefined ? '✅ Success' : '⚠️ Unknown'}`);
    
    if (removeResult.error) {
      console.log('❌ Cannot even remove users - group operations may not be working at all');
      return;
    }
  } catch (e) {
    console.log(`   ❌ Remove exception: ${e.message}`);
    return;
  }
  
  await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
  
  console.log('\nStep 2: Re-add Sac to group (to test addition works)');
  try {
    const addResult = await sendCommand({
      jsonrpc: '2.0',
      method: 'updateGroup',
      params: {
        account: '+19108471202',
        groupId: counterUxvGroupId,
        addMembers: [sacPhone],
        addAdmins: [sacPhone]
      },
      id: 'test-add-sac-back'
    }, 'Re-adding Sac as admin');
    
    console.log(`   Add result: ${addResult.error ? '❌ ' + addResult.error.message : addResult.result !== undefined ? '✅ Success' : '⚠️ Unknown'}`);
  } catch (e) {
    console.log(`   ❌ Add exception: ${e.message}`);
  }
  
  console.log('\n📋 Verification:');
  console.log('1. Check if Sac was temporarily removed from Counter UXV (should have gotten removal notification)');
  console.log('2. Check if Sac was re-added back (should have gotten addition notification)');
  console.log('3. If both work, then group operations ARE working - the issue is with the removed user list');
  console.log('4. If neither work, then group operations are fundamentally broken despite admin permissions');
}

testWithKnownWorkingUser().catch(console.error);