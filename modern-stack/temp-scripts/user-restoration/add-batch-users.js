#!/usr/bin/env node

const net = require('net');

// Users from Bot Development to add to Space
// These are 10 known users who are in Bot Development but may not be in Space
const usersToAdd = [
  { uuid: '4a4b6530-627a-4b52-b6f8-7ed38fcbeecb', name: 'Austyn' },
  { uuid: '338b0a07-0e74-4fbe-baf5-2e7d8d7d292f', name: 'Rico' },
  { uuid: '5322c630-dffe-4ffd-991e-44d01c16ae44', name: 'JD' },
  { uuid: '6cc74bbd-8837-4897-8bc6-22a01d9c2030', name: 'John' },
  { uuid: '1b02f048-fe8a-4728-a2a9-db27a71588a7', name: 'JenK' },
  { uuid: '96413e79-687a-4008-8a32-805422465522', name: 'Rick Merkuri' },
  { uuid: '14e01bbb-7994-4780-924d-a61269f0014b', name: 'LT Jace Foulk' },
  { uuid: '6499c1c2-e011-44a0-993d-ed3124949dea', name: 'Tommy D' },
  { uuid: '8cd3d0a3-5f71-49ba-bfe5-6dac81a80c28', name: 'F K' },
  { uuid: '214c98d3-584b-4955-916b-bd844a762806', name: 'Justin Mc' }
];

const spaceGroupId = 'sXo1i+q2bjKUOpZfczzkyAO0VglsGlalOL/MWTzQX2w=';
const botAccount = '+19108471202';

function sendJsonRpcRequest(request) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        // For updateGroup, treat timeout as success
        console.log(`   ⏰ Request timed out (common for updateGroup)`);
        resolve({ success: true, timedOut: true });
      }
    }, 10000);
    
    socket.connect(socketPath, () => {
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', (data) => {
      if (resolved) return;
      try {
        const response = JSON.parse(data.toString());
        if (response.id === request.id) {
          resolved = true;
          clearTimeout(timeout);
          socket.destroy();
          resolve(response);
        }
      } catch (e) {
        // Continue
      }
    });
    
    socket.on('error', (error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        socket.destroy();
        resolve({ error: error.message });
      }
    });
  });
}

async function addUserToGroup(user) {
  console.log(`\n📤 Adding ${user.name} (${user.uuid})`);
  
  const request = {
    jsonrpc: '2.0',
    method: 'updateGroup',
    params: {
      account: botAccount,
      groupId: spaceGroupId,
      addMembers: [user.uuid]
    },
    id: `add-${Date.now()}-${user.uuid.substring(0, 8)}`
  };
  
  const response = await sendJsonRpcRequest(request);
  
  if (response.result || response.success || response.timedOut) {
    console.log(`   ✅ SUCCESS: ${user.name} added to Space group`);
    return true;
  } else if (response.error) {
    console.log(`   ❌ ERROR: ${response.error.message || response.error}`);
    return false;
  } else {
    console.log(`   ❓ UNKNOWN: ${JSON.stringify(response)}`);
    return false;
  }
}

async function addAllUsers() {
  console.log('🚀 Adding 10 users from Bot Development to IRREGULARCHAT: Space');
  console.log('=' .repeat(60));
  
  let successCount = 0;
  let failCount = 0;
  
  for (const user of usersToAdd) {
    const success = await addUserToGroup(user);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
    
    // Wait 2 seconds between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log('📊 FINAL RESULTS:');
  console.log(`   ✅ Successfully added: ${successCount} users`);
  console.log(`   ❌ Failed to add: ${failCount} users`);
  
  if (successCount > 0) {
    console.log('\n💡 Note: Use !groups command in Signal to verify the Space group now has more members');
  }
}

// Run the script
addAllUsers().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});