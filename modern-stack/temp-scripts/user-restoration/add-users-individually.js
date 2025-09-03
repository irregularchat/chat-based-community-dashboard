#!/usr/bin/env node

const fs = require('fs');
const net = require('net');

async function addUserIndividually(userIdentifier, index, total) {
  return new Promise((resolve, reject) => {
    console.log(`🔄 Adding user ${index}/${total}: ${userIdentifier}`);
    
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    let responseData = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log(`⚠️ User ${index} timed out - continuing...`);
        resolve({ success: false, reason: 'timeout' });
      }
    }, 10000); // 10 second timeout per user
    
    socket.connect(socketPath, () => {
      const request = {
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
          account: '+19108471202',
          groupId: 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=',
          addMembers: [userIdentifier]
        },
        id: `add-individual-${index}-${Date.now()}`
      };
      
      socket.write(JSON.stringify(request) + '\\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const lines = responseData.split('\\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          
          if (response.id && response.id.startsWith(`add-individual-${index}-`)) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result !== undefined) {
                console.log(`✅ User ${index} added successfully`);
                resolve({ success: true, user: userIdentifier });
              } else if (response.error) {
                console.log(`❌ User ${index} failed: ${response.error.message}`);
                resolve({ success: false, reason: response.error.message });
              } else {
                console.log(`✅ User ${index} completed (assumed success)`);
                resolve({ success: true, user: userIdentifier });
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
        console.log(`❌ User ${index} socket error: ${error.message}`);
        resolve({ success: false, reason: error.message });
      }
    });
  });
}

async function main() {
  console.log('🚀 INDIVIDUAL USER RESTORATION');
  console.log('Adding users one at a time to Counter UxV group');
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
  console.log(`📊 Will add ${users.length} users individually`);
  console.log('');
  
  // Start with first 10 users for testing
  const testUsers = users.slice(0, 10);
  console.log(`🧪 Testing with first ${testUsers.length} users...`);
  console.log('');
  
  const results = [];
  let successful = 0;
  let failed = 0;
  
  for (let i = 0; i < testUsers.length; i++) {
    const user = testUsers[i];
    const result = await addUserIndividually(user, i + 1, testUsers.length);
    
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
    
    // Small delay between users
    if (i < testUsers.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  console.log('\\n' + '='.repeat(50));
  console.log('📊 INDIVIDUAL ADDITION RESULTS (First 10):');
  console.log(`✅ Successful: ${successful}/${testUsers.length}`);
  console.log(`❌ Failed: ${failed}/${testUsers.length}`);
  
  // Save results
  const resultData = {
    timestamp: new Date().toISOString(),
    testRun: true,
    totalAttempted: testUsers.length,
    successful: successful,
    failed: failed,
    results: results
  };
  
  fs.writeFileSync('./individual-addition-results.json', JSON.stringify(resultData, null, 2));
  console.log('💾 Results saved to individual-addition-results.json');
  
  if (successful > 0) {
    console.log('\\n🎉 Individual additions are working!');
    console.log('Run this script again to continue with all remaining users.');
  } else {
    console.log('\\n⚠️ No successful additions. May need to check permissions or approach.');
  }
}

main().catch(error => {
  console.error('💥 Error:', error);
  process.exit(1);
});