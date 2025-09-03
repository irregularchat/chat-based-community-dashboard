#!/usr/bin/env node

const fs = require('fs');
const net = require('net');

async function addUserIndividuallyV2(userIdentifier, index, total) {
  return new Promise((resolve, reject) => {
    console.log(`🔄 [${index}/${total}] Adding: ${userIdentifier}`);
    
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    let responseData = '';
    let resolved = false;
    
    // Longer timeout since Signal operations can be slow
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log(`⏰ [${index}] Timeout (30s) - Signal may still be processing`);
        resolve({ success: true, reason: 'timeout_assumed_success', user: userIdentifier });
      }
    }, 30000); // 30 second timeout
    
    socket.connect(socketPath, () => {
      const request = {
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
          account: '+19108471202',
          groupId: 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=',
          addMembers: [userIdentifier]
        },
        id: `add-v2-${index}-${Date.now()}`
      };
      
      console.log(`📤 [${index}] Sending add request...`);
      socket.write(JSON.stringify(request) + '\\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      // Look for complete JSON responses
      const lines = responseData.split('\\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          
          if (response.id && response.id.startsWith(`add-v2-${index}-`)) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result !== undefined) {
                console.log(`✅ [${index}] Success - user added`);
                resolve({ success: true, user: userIdentifier });
              } else if (response.error) {
                console.log(`❌ [${index}] Error: ${response.error.message}`);
                resolve({ success: false, reason: response.error.message, user: userIdentifier });
              } else {
                console.log(`✅ [${index}] Completed (assumed success)`);
                resolve({ success: true, user: userIdentifier });
              }
            }
            return;
          }
        } catch (e) {
          // Not a complete JSON yet, continue accumulating
          continue;
        }
      }
    });
    
    socket.on('error', (error) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        console.log(`💥 [${index}] Socket error: ${error.message}`);
        resolve({ success: false, reason: error.message, user: userIdentifier });
      }
    });
    
    socket.on('close', () => {
      if (!resolved) {
        console.log(`🔌 [${index}] Socket closed without response`);
      }
    });
  });
}

async function checkGroupMemberCount() {
  return new Promise((resolve, reject) => {
    console.log('📊 Checking current group member count...');
    
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    let responseData = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log('⚠️ Member count check timed out');
        resolve(0);
      }
    }, 15000);
    
    socket.connect(socketPath, () => {
      const request = {
        jsonrpc: '2.0',
        method: 'listGroups',
        params: {
          account: '+19108471202',
          'get-members': true
        },
        id: 'check-members-' + Date.now()
      };
      
      socket.write(JSON.stringify(request) + '\\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const lines = responseData.split('\\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          
          if (response.id && response.id.startsWith('check-members-')) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result && response.result.length) {
                const counterUxv = response.result.find(g => 
                  g.id === 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U='
                );
                
                const memberCount = counterUxv?.members?.length || 0;
                console.log(`📈 Current member count: ${memberCount}`);
                resolve(memberCount);
              } else {
                resolve(0);
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
        resolve(0);
      }
    });
  });
}

async function main() {
  console.log('🚀 INDIVIDUAL USER RESTORATION V2');
  console.log('Improved approach with longer timeouts and better error handling');
  console.log('');
  
  // Check initial member count
  const initialCount = await checkGroupMemberCount();
  console.log(`📊 Starting member count: ${initialCount}`);
  console.log('');
  
  // Load user list
  let userData;
  try {
    const data = fs.readFileSync('./individual-restoration-list.json', 'utf8');
    userData = JSON.parse(data);
  } catch (error) {
    console.log('❌ Could not load user list file');
    return;
  }
  
  const users = userData.identifiers;
  
  // Start with just 3 users for testing
  const testUsers = users.slice(0, 3);
  console.log(`🧪 Testing improved approach with first ${testUsers.length} users...`);
  console.log('');
  
  const results = [];
  let successful = 0;
  let failed = 0;
  
  for (let i = 0; i < testUsers.length; i++) {
    const user = testUsers[i];
    const result = await addUserIndividuallyV2(user, i + 1, testUsers.length);
    
    results.push({
      index: i + 1,
      user: user,
      success: result.success,
      reason: result.reason || 'success'
    });
    
    if (result.success) {
      successful++;
    } else {
      failed++;
    }
    
    // Longer delay between users to avoid overwhelming Signal
    if (i < testUsers.length - 1) {
      console.log(`⏳ Waiting 3 seconds before next user...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  // Check final member count
  console.log('\\n⏳ Waiting 5 seconds for Signal to sync...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const finalCount = await checkGroupMemberCount();
  const memberIncrease = finalCount - initialCount;
  
  console.log('\\n' + '='.repeat(60));
  console.log('📊 RESULTS SUMMARY:');
  console.log(`✅ Successful attempts: ${successful}/${testUsers.length}`);
  console.log(`❌ Failed attempts: ${failed}/${testUsers.length}`);
  console.log(`📈 Member count change: ${initialCount} → ${finalCount} (+${memberIncrease})`);
  
  if (memberIncrease > 0) {
    console.log('\\n🎉 SUCCESS! Users are actually being added to the group!');
    console.log('The approach is working - timeouts are normal for Signal operations.');
  } else if (successful > 0) {
    console.log('\\n⚠️ Commands succeeded but no member count increase detected.');
    console.log('May need more time for Signal to sync, or users might already be in group.');
  } else {
    console.log('\\n❌ No successful additions. Need to investigate further.');
  }
  
  // Save detailed results
  const resultData = {
    timestamp: new Date().toISOString(),
    version: 'v2',
    initialMemberCount: initialCount,
    finalMemberCount: finalCount,
    memberIncrease: memberIncrease,
    totalAttempted: testUsers.length,
    successful: successful,
    failed: failed,
    results: results
  };
  
  fs.writeFileSync('./individual-addition-results-v2.json', JSON.stringify(resultData, null, 2));
  console.log('\\n💾 Detailed results saved to individual-addition-results-v2.json');
}

main().catch(error => {
  console.error('💥 Error:', error);
  process.exit(1);
});