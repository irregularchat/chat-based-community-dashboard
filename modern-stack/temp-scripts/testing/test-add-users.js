#!/usr/bin/env node

const { spawn } = require('child_process');
const net = require('net');

// Test users identified from Bot Development who are NOT in Space
const testUsers = [
  { uuid: '4a4b6530-627a-4b52-b6f8-7ed38fcbeecb', name: 'User1' }, // Austyn
  { uuid: 'b950644d-4568-4667-8bc6-0f25f216868e', name: 'User2' }, // Joshua "Octal" Stinson
  { uuid: '01383f13-1479-4058-b51b-d39244b679f4', name: 'User3' }, // Joshua
  { uuid: '5322c630-dffe-4ffd-991e-44d01c16ae44', name: 'User4' }, // JD
  { uuid: '338b0a07-0e74-4fbe-baf5-2e7d8d7d292f', name: 'User5' }, // Rico
];

// Group IDs
const spaceGroupId = 'sXo1i+q2bjKUOpZfczzkyAO0VglsGlalOL/MWTzQX2w='; // IRREGULARCHAT: Space
const botAccount = '+19108471202';

// Function to send JSON-RPC request via socket
function sendJsonRpcRequest(request, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    let resolved = false;
    let timeoutId;
    
    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      socket.removeAllListeners();
      socket.destroy();
    };
    
    const responseHandler = (data) => {
      if (resolved) return;
      
      try {
        const responses = data.toString().trim().split('\n');
        for (const responseStr of responses) {
          if (!responseStr.trim()) continue;
          
          const response = JSON.parse(responseStr);
          if (response.id === request.id) {
            resolved = true;
            cleanup();
            resolve(response);
            return;
          }
        }
      } catch (error) {
        // Continue parsing other responses
      }
    };
    
    socket.connect(socketPath, () => {
      console.log(`📤 Sending request: ${request.method}`);
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', responseHandler);
    
    socket.on('error', (error) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(error);
      }
    });
    
    // Set timeout
    timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        
        // For updateGroup, consider timeout as potentially successful
        if (request.method === 'updateGroup') {
          console.log(`⚠️ updateGroup request timed out but may have succeeded`);
          resolve({ success: true, timedOut: true });
        } else {
          reject(new Error('Request timeout'));
        }
      }
    }, timeoutMs);
  });
}

async function testMethod1_DirectUpdateGroup(userUuid, userName) {
  console.log(`\n🧪 TEST 1: Direct updateGroup with addMembers`);
  console.log(`   User: ${userName} (${userUuid})`);
  
  try {
    const request = {
      jsonrpc: '2.0',
      method: 'updateGroup',
      params: {
        account: botAccount,
        groupId: spaceGroupId,
        addMembers: [userUuid]
      },
      id: `test1-${Date.now()}`
    };
    
    console.log(`   Request: ${JSON.stringify(request, null, 2)}`);
    
    const response = await sendJsonRpcRequest(request, 20000);
    
    if (response.result || response.success) {
      console.log(`   ✅ SUCCESS: User ${userName} likely added`);
      if (response.timedOut) {
        console.log(`   ⏰ Response timed out, but updateGroup often succeeds silently`);
      }
      return { success: true, method: 'Direct updateGroup', response };
    } else if (response.error) {
      console.log(`   ❌ ERROR: ${response.error.message || response.error}`);
      return { success: false, method: 'Direct updateGroup', error: response.error };
    } else {
      console.log(`   ❓ UNKNOWN: ${JSON.stringify(response)}`);
      return { success: false, method: 'Direct updateGroup', response };
    }
    
  } catch (error) {
    console.log(`   ❌ EXCEPTION: ${error.message}`);
    return { success: false, method: 'Direct updateGroup', error: error.message };
  }
}

async function testMethod2_UpdateGroupWithMember(userUuid, userName) {
  console.log(`\n🧪 TEST 2: updateGroup with -m parameter (command line style)`);
  console.log(`   User: ${userName} (${userUuid})`);
  
  try {
    // This mimics the command line: signal-cli updateGroup -g GROUP_ID -m USER_UUID
    const request = {
      jsonrpc: '2.0',
      method: 'updateGroup',
      params: {
        account: botAccount,
        groupId: spaceGroupId,
        member: [userUuid] // Alternative parameter name
      },
      id: `test2-${Date.now()}`
    };
    
    console.log(`   Request: ${JSON.stringify(request, null, 2)}`);
    
    const response = await sendJsonRpcRequest(request, 20000);
    
    if (response.result || response.success) {
      console.log(`   ✅ SUCCESS: User ${userName} likely added`);
      return { success: true, method: 'updateGroup with member param', response };
    } else if (response.error) {
      console.log(`   ❌ ERROR: ${response.error.message || response.error}`);
      return { success: false, method: 'updateGroup with member param', error: response.error };
    } else {
      console.log(`   ❓ UNKNOWN: ${JSON.stringify(response)}`);
      return { success: false, method: 'updateGroup with member param', response };
    }
    
  } catch (error) {
    console.log(`   ❌ EXCEPTION: ${error.message}`);
    return { success: false, method: 'updateGroup with member param', error: error.message };
  }
}

async function testMethod3_UpdateGroupAddMembers(userUuid, userName) {
  console.log(`\n🧪 TEST 3: updateGroup with add-members parameter`);
  console.log(`   User: ${userName} (${userUuid})`);
  
  try {
    const request = {
      jsonrpc: '2.0',
      method: 'updateGroup',
      params: {
        account: botAccount,
        groupId: spaceGroupId,
        'add-members': [userUuid] // Hyphenated parameter name
      },
      id: `test3-${Date.now()}`
    };
    
    console.log(`   Request: ${JSON.stringify(request, null, 2)}`);
    
    const response = await sendJsonRpcRequest(request, 20000);
    
    if (response.result || response.success) {
      console.log(`   ✅ SUCCESS: User ${userName} likely added`);
      return { success: true, method: 'updateGroup with add-members', response };
    } else if (response.error) {
      console.log(`   ❌ ERROR: ${response.error.message || response.error}`);
      return { success: false, method: 'updateGroup with add-members', error: response.error };
    } else {
      console.log(`   ❓ UNKNOWN: ${JSON.stringify(response)}`);
      return { success: false, method: 'updateGroup with add-members', response };
    }
    
  } catch (error) {
    console.log(`   ❌ EXCEPTION: ${error.message}`);
    return { success: false, method: 'updateGroup with add-members', error: error.message };
  }
}

async function verifyUserInGroup(userUuid) {
  console.log(`\n🔍 VERIFICATION: Checking if user ${userUuid} is now in Space group`);
  
  try {
    const request = {
      jsonrpc: '2.0',
      method: 'listGroups',
      params: {
        account: botAccount,
        'get-members': true
      },
      id: `verify-${Date.now()}`
    };
    
    const response = await sendJsonRpcRequest(request, 30000);
    
    if (response.result) {
      const spaceGroup = response.result.find(g => g.name === 'IRREGULARCHAT: Space');
      if (spaceGroup) {
        const userInGroup = spaceGroup.members.some(m => m.uuid === userUuid);
        console.log(`   ${userInGroup ? '✅' : '❌'} User ${userInGroup ? 'IS' : 'IS NOT'} in Space group`);
        return userInGroup;
      }
    }
    
    console.log(`   ❓ Could not verify - group data unavailable`);
    return false;
    
  } catch (error) {
    console.log(`   ❌ Verification failed: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Starting Signal Group User Addition Tests');
  console.log('=' * 60);
  
  const results = [];
  
  // Test with just the first user to avoid spam
  const testUser = testUsers[0];
  
  console.log(`\nTarget Group: IRREGULARCHAT: Space`);
  console.log(`Target User: ${testUser.name} (${testUser.uuid})`);
  
  // Test Method 1: Direct addMembers
  const result1 = await testMethod1_DirectUpdateGroup(testUser.uuid, testUser.name);
  results.push(result1);
  
  await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
  
  // Check if user was added
  const inGroup1 = await verifyUserInGroup(testUser.uuid);
  result1.verified = inGroup1;
  
  if (!inGroup1) {
    // Test Method 2: Different parameter name
    const result2 = await testMethod2_UpdateGroupWithMember(testUser.uuid, testUser.name);
    results.push(result2);
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const inGroup2 = await verifyUserInGroup(testUser.uuid);
    result2.verified = inGroup2;
    
    if (!inGroup2) {
      // Test Method 3: Hyphenated parameter
      const result3 = await testMethod3_UpdateGroupAddMembers(testUser.uuid, testUser.name);
      results.push(result3);
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const inGroup3 = await verifyUserInGroup(testUser.uuid);
      result3.verified = inGroup3;
    }
  }
  
  // Print results
  console.log('\n📊 TEST RESULTS SUMMARY');
  console.log('=' * 60);
  
  results.forEach((result, index) => {
    console.log(`\nMethod ${index + 1}: ${result.method}`);
    console.log(`Success: ${result.success ? '✅' : '❌'}`);
    console.log(`Verified: ${result.verified ? '✅' : '❌'}`);
    if (result.error) {
      console.log(`Error: ${JSON.stringify(result.error)}`);
    }
  });
  
  // Save detailed results
  const detailedResults = {
    testDate: new Date().toISOString(),
    targetGroup: 'IRREGULARCHAT: Space',
    targetUser: testUser,
    results: results
  };
  
  require('fs').writeFileSync('./test-results.json', JSON.stringify(detailedResults, null, 2));
  console.log('\n💾 Detailed results saved to test-results.json');
  
  const workingMethods = results.filter(r => r.verified);
  
  console.log(`\n🎯 CONCLUSION:`);
  if (workingMethods.length > 0) {
    console.log(`Found ${workingMethods.length} working method(s):`);
    workingMethods.forEach(method => {
      console.log(`  ✅ ${method.method}`);
    });
  } else {
    console.log(`❌ No working methods found. Further investigation needed.`);
  }
}

// Run tests if called directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  });
}

module.exports = { runTests, testUsers, spaceGroupId };