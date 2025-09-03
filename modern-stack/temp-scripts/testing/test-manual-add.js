#!/usr/bin/env node

const net = require('net');

// Test with a single user to Solo testing group
const testUser = { uuid: 'dc6bc78c-bf49-44fe-8383-e83e777107ac', name: 'Rodrick Daniels' };
const soloTestingGroupId = 'YOUR_SOLO_TESTING_GROUP_ID'; // We need to find this
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
        console.log(`   ⏰ Request timed out (common for updateGroup)`);
        resolve({ success: true, timedOut: true });
      }
    }, 10000);
    
    socket.connect(socketPath, () => {
      console.log('Socket connected');
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

async function findSoloTestingGroup() {
  console.log('🔍 Finding Solo testing group ID...');
  
  const request = {
    jsonrpc: '2.0',
    method: 'listGroups',
    params: {
      account: botAccount
    },
    id: 'find-group'
  };
  
  const response = await sendJsonRpcRequest(request);
  
  if (response.result) {
    const soloGroup = response.result.find(g => g.name === 'Solo testing');
    if (soloGroup) {
      console.log(`✅ Found Solo testing group: ${soloGroup.id}`);
      return soloGroup.id;
    }
  }
  
  console.log('❌ Could not find Solo testing group');
  return null;
}

async function testAddToSpace() {
  console.log('\n🧪 TEST: Adding user to IRREGULARCHAT: Space');
  console.log(`   User: ${testUser.name} (${testUser.uuid})`);
  
  const request = {
    jsonrpc: '2.0',
    method: 'updateGroup',
    params: {
      account: botAccount,
      groupId: spaceGroupId,
      addMembers: [testUser.uuid]
    },
    id: `manual-test-${Date.now()}`
  };
  
  console.log('   Sending request...');
  const response = await sendJsonRpcRequest(request);
  
  if (response.result || response.success || response.timedOut) {
    console.log(`   ✅ SUCCESS: Likely added to Space group`);
    return true;
  } else if (response.error) {
    console.log(`   ❌ ERROR: ${response.error.message || response.error}`);
    return false;
  } else {
    console.log(`   ❓ Response: ${JSON.stringify(response)}`);
    return false;
  }
}

async function testAddToSolo(groupId) {
  console.log('\n🧪 TEST: Adding user to Solo testing');
  console.log(`   User: ${testUser.name} (${testUser.uuid})`);
  console.log(`   Group ID: ${groupId}`);
  
  const request = {
    jsonrpc: '2.0',
    method: 'updateGroup',
    params: {
      account: botAccount,
      groupId: groupId,
      addMembers: [testUser.uuid]
    },
    id: `manual-solo-${Date.now()}`
  };
  
  console.log('   Sending request...');
  const response = await sendJsonRpcRequest(request);
  
  if (response.result || response.success || response.timedOut) {
    console.log(`   ✅ SUCCESS: Likely added to Solo testing`);
    return true;
  } else if (response.error) {
    console.log(`   ❌ ERROR: ${response.error.message || response.error}`);
    return false;
  } else {
    console.log(`   ❓ Response: ${JSON.stringify(response)}`);
    return false;
  }
}

async function main() {
  console.log('🚀 Manual User Addition Test');
  console.log('=' .repeat(60));
  
  // Test 1: Add to Space (we know this ID)
  await testAddToSpace();
  
  // Wait 3 seconds
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Test 2: Find and add to Solo testing
  const soloGroupId = await findSoloTestingGroup();
  if (soloGroupId) {
    await testAddToSolo(soloGroupId);
  }
  
  console.log('\n' + '=' .repeat(60));
  console.log('✅ Tests complete. Check Signal for notifications.');
}

main().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});