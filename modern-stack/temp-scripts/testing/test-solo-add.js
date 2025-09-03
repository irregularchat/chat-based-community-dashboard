#!/usr/bin/env node

const net = require('net');

// Configuration
const SOCKET_PATH = '/tmp/signal-cli-socket';
const BOT_ACCOUNT = '+19108471202';

// Test user from Bot Development
const testUser = { 
  uuid: '338b0a07-0e74-4fbe-baf5-2e7d8d7d292f', 
  name: 'Rico' 
};

// Known group IDs from previous tests
const soloTestingGroupId = 'u2DVZy6i0mQCYxHVJuJOMEHI+Ue0vnGtTRMhIUFTEJU='; // Solo testing (from earlier logs)

function sendRequest(request) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    let buffer = '';
    
    console.log(`📤 Sending ${request.method}...`);
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log(`   ⏰ Timed out (common for updateGroup - often still succeeds)`);
        resolve({ success: true, timedOut: true });
      }
    }, 10000);
    
    socket.connect(SOCKET_PATH, () => {
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', (data) => {
      if (resolved) return;
      buffer += data.toString();
      
      // Try to find complete JSON response
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          try {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              resolved = true;
              clearTimeout(timeout);
              socket.destroy();
              console.log(`   ✅ Got response`);
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
        console.log(`   ❌ Error: ${error.message}`);
        resolve({ error: error.message });
      }
    });
  });
}

async function findGroups() {
  console.log('\n🔍 Finding Solo testing group...');
  
  const request = {
    jsonrpc: '2.0',
    method: 'listGroups',
    params: { account: BOT_ACCOUNT },
    id: 'find-groups'
  };
  
  const response = await sendRequest(request);
  
  if (response.result) {
    const soloGroups = response.result.filter(g => 
      g.name && g.name.toLowerCase().includes('solo')
    );
    
    if (soloGroups.length > 0) {
      console.log('Found Solo groups:');
      soloGroups.forEach(g => {
        console.log(`  - ${g.name}: ${g.id}`);
        if (g.name.toLowerCase().includes('test')) {
          console.log(`    👆 This looks like Solo testing!`);
        }
      });
      return soloGroups[0].id;
    }
  }
  
  return soloTestingGroupId; // Use known ID as fallback
}

async function attemptAdd(groupId, method = 1) {
  console.log(`\n🧪 Attempt ${method}: Adding ${testUser.name} to group`);
  
  let params = {
    account: BOT_ACCOUNT,
    groupId: groupId
  };
  
  // Try different parameter variations
  switch(method) {
    case 1:
      params.addMembers = [testUser.uuid];
      console.log('   Using: addMembers');
      break;
    case 2:
      params['add-members'] = [testUser.uuid];
      console.log('   Using: add-members');
      break;
    case 3:
      params.member = [testUser.uuid];
      console.log('   Using: member');
      break;
  }
  
  const request = {
    jsonrpc: '2.0',
    method: 'updateGroup',
    params: params,
    id: `add-${method}-${Date.now()}`
  };
  
  const response = await sendRequest(request);
  
  if (response.result || response.success || response.timedOut) {
    console.log(`   ✅ Likely succeeded!`);
    return true;
  } else if (response.error) {
    console.log(`   ❌ Failed: ${response.error.message || response.error}`);
    return false;
  } else {
    console.log(`   ❓ Unknown response`);
    return false;
  }
}

async function verifyMembership(groupId) {
  console.log(`\n🔍 Verifying if ${testUser.name} is in group...`);
  
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
    const targetGroup = response.result.find(g => g.id === groupId);
    if (targetGroup && targetGroup.members) {
      const isMember = targetGroup.members.some(m => m.uuid === testUser.uuid);
      console.log(`   ${isMember ? '✅' : '❌'} User ${isMember ? 'IS' : 'IS NOT'} in group`);
      return isMember;
    }
  }
  
  console.log(`   ❓ Could not verify`);
  return false;
}

async function main() {
  console.log('🚀 Testing Direct User Addition to Solo Testing Group');
  console.log('=' .repeat(60));
  
  // Step 1: Find Solo testing group
  const groupId = await findGroups();
  console.log(`\nUsing group ID: ${groupId}`);
  
  // Step 2: Try different methods
  let success = false;
  
  for (let method = 1; method <= 3 && !success; method++) {
    const added = await attemptAdd(groupId, method);
    
    if (added) {
      // Wait a bit then verify
      await new Promise(resolve => setTimeout(resolve, 3000));
      success = await verifyMembership(groupId);
      
      if (success) {
        console.log(`\n🎉 SUCCESS! Method ${method} works!`);
        console.log(`   Parameter used: ${method === 1 ? 'addMembers' : method === 2 ? 'add-members' : 'member'}`);
        break;
      }
    }
    
    // Wait between attempts
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  if (!success) {
    console.log('\n❌ Could not add user with any method');
    console.log('   Check Signal CLI logs for more details');
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log('✅ Test complete');
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});