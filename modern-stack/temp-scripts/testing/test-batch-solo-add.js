#!/usr/bin/env node

const net = require('net');

// Configuration
const SOCKET_PATH = '/tmp/signal-cli-socket';
const BOT_ACCOUNT = '+19108471202';
const SOLO_TESTING_GROUP_ID = '/cjfmI7snAAhRPLDMlvW50Ja8fE9SuslMBFukFjn9iI=';

// More test users from Bot Development
const testUsers = [
  { uuid: '4a4b6530-627a-4b52-b6f8-7ed38fcbeecb', name: 'Austyn' },
  { uuid: '5322c630-dffe-4ffd-991e-44d01c16ae44', name: 'JD' },
  { uuid: '6cc74bbd-8837-4897-8bc6-22a01d9c2030', name: 'John' },
  { uuid: '1b02f048-fe8a-4728-a2a9-db27a71588a7', name: 'JenK' },
  { uuid: '96413e79-687a-4008-8a32-805422465522', name: 'Rick Merkuri' },
  { uuid: '14e01bbb-7994-4780-924d-a61269f0014b', name: 'LT Jace Foulk' },
  { uuid: '6499c1c2-e011-44a0-993d-ed3124949dea', name: 'Tommy D' },
  { uuid: '8cd3d0a3-5f71-49ba-bfe5-6dac81a80c28', name: 'F K' }
];

function sendRequest(request) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    let buffer = '';
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({ success: true, timedOut: true });
      }
    }, 10000);
    
    socket.connect(SOCKET_PATH, () => {
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', (data) => {
      if (resolved) return;
      buffer += data.toString();
      
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              resolved = true;
              clearTimeout(timeout);
              socket.destroy();
              resolve(response);
              return;
            }
          } catch (e) {
            // Keep accumulating
          }
        }
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

async function addUserToSolo(user) {
  console.log(`\n📤 Adding ${user.name} (${user.uuid.substring(0, 8)}...)`);
  
  // Use the working method: member parameter
  const request = {
    jsonrpc: '2.0',
    method: 'updateGroup',
    params: {
      account: BOT_ACCOUNT,
      groupId: SOLO_TESTING_GROUP_ID,
      member: [user.uuid]  // The working parameter!
    },
    id: `add-${Date.now()}-${user.uuid.substring(0, 8)}`
  };
  
  const response = await sendRequest(request);
  
  if (response.result || response.success || response.timedOut) {
    console.log(`   ✅ Request succeeded for ${user.name}`);
    return true;
  } else if (response.error) {
    console.log(`   ❌ Failed for ${user.name}: ${response.error.message || response.error}`);
    return false;
  } else {
    console.log(`   ❓ Unknown response for ${user.name}`);
    return false;
  }
}

async function verifyGroupMembers() {
  console.log(`\n🔍 Checking Solo testing group membership...`);
  
  const request = {
    jsonrpc: '2.0',
    method: 'listGroups',
    params: { 
      account: BOT_ACCOUNT,
      'get-members': true 
    },
    id: `verify-${Date.now()}`
  };
  
  const response = await sendRequest(request);
  
  if (response.result) {
    const soloGroup = response.result.find(g => g.id === SOLO_TESTING_GROUP_ID);
    if (soloGroup && soloGroup.members) {
      console.log(`\n📊 Solo testing group now has ${soloGroup.members.length} members:`);
      
      const addedUsers = [];
      testUsers.forEach(user => {
        const inGroup = soloGroup.members.some(m => m.uuid === user.uuid);
        console.log(`   ${inGroup ? '✅' : '❌'} ${user.name}`);
        if (inGroup) addedUsers.push(user.name);
      });
      
      console.log(`\n🎯 Successfully added: ${addedUsers.length}/${testUsers.length} users`);
      console.log(`   Added: ${addedUsers.join(', ')}`);
      
      return addedUsers.length;
    }
  }
  
  console.log(`   ❌ Could not verify group membership`);
  return 0;
}

async function main() {
  console.log('🚀 Batch Testing: Adding Multiple Users to Solo Testing');
  console.log('=' .repeat(60));
  console.log(`Target group: Solo testing`);
  console.log(`Users to add: ${testUsers.length}`);
  console.log(`Method: Using "member" parameter (proven working)`);
  
  let successCount = 0;
  let failCount = 0;
  
  // Add users one by one
  for (let i = 0; i < testUsers.length; i++) {
    const user = testUsers[i];
    console.log(`\n[${i + 1}/${testUsers.length}] Processing ${user.name}`);
    
    const success = await addUserToSolo(user);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
    
    // Wait between requests to avoid rate limiting
    if (i < testUsers.length - 1) {
      console.log(`   ⏳ Waiting 3 seconds...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  // Wait before verification
  console.log(`\n⏳ Waiting 5 seconds before verification...`);
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Verify final results
  const actuallyAdded = await verifyGroupMembers();
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 FINAL RESULTS:`);
  console.log(`   Requests sent: ${testUsers.length}`);
  console.log(`   Reported success: ${successCount}`);
  console.log(`   Reported failed: ${failCount}`);
  console.log(`   Actually verified in group: ${actuallyAdded}`);
  
  const successRate = actuallyAdded / testUsers.length;
  console.log(`   Success rate: ${(successRate * 100).toFixed(1)}%`);
  
  if (successRate >= 0.8) {
    console.log(`\n🎉 EXCELLENT! Method is working consistently!`);
    console.log(`   ✅ Confirmed: Use "member: [userUuid]" parameter`);
  } else if (successRate >= 0.5) {
    console.log(`\n⚠️  PARTIAL SUCCESS - Method works but not 100% reliable`);
  } else {
    console.log(`\n❌ LOW SUCCESS RATE - Need to investigate further`);
  }
  
  console.log(`\n💡 Next step: Update bot to use "member" parameter instead of "addMembers"`);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});