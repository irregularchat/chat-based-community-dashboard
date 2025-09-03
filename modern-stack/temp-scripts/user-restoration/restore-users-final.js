#!/usr/bin/env node

const fs = require('fs');
const net = require('net');

async function addUserToGroup(userIdentifier, index, total) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    let responseData = '';
    let resolved = false;
    
    // We know responses come back quickly now
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log(`⚠️ [${index}/${total}] ${userIdentifier} - timeout`);
        resolve({ success: false, reason: 'timeout' });
      }
    }, 10000);
    
    socket.connect(socketPath, () => {
      const request = {
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
          account: '+19108471202',
          groupId: 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=',
          addMembers: [userIdentifier]
        },
        id: `restore-user-${index}-${Date.now()}`
      };
      
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      // Look for our specific response
      const lines = responseData.split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const response = JSON.parse(line);
          if (response.id && response.id.startsWith(`restore-user-${index}-`)) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result !== undefined) {
                console.log(`✅ [${index}/${total}] Added: ${userIdentifier}`);
                resolve({ success: true });
              } else if (response.error) {
                console.log(`❌ [${index}/${total}] Error: ${userIdentifier} - ${response.error.message}`);
                resolve({ success: false, reason: response.error.message });
              } else {
                console.log(`✅ [${index}/${total}] Added: ${userIdentifier}`);
                resolve({ success: true });
              }
            }
            return;
          }
        } catch (e) {
          // Continue parsing
        }
      }
    });
    
    socket.on('error', (error) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        console.log(`💥 [${index}/${total}] Socket error: ${userIdentifier}`);
        resolve({ success: false, reason: error.message });
      }
    });
  });
}

async function main() {
  console.log('🚀 FINAL COUNTER UXV USER RESTORATION');
  console.log('Adding all removed users back to Counter UxV group');
  console.log('');
  
  // Load user identifiers
  let userData;
  try {
    const data = fs.readFileSync('./individual-restoration-list.json', 'utf8');
    userData = JSON.parse(data);
  } catch (error) {
    console.log('❌ Could not load user list. Run the user collection script first.');
    return;
  }
  
  const users = userData.identifiers;
  console.log(`📊 Will restore ${users.length} users to Counter UxV`);
  console.log('');
  
  const results = [];
  let successful = 0;
  let failed = 0;
  
  // Process all users
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const result = await addUserToGroup(user, i + 1, users.length);
    
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
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Progress update every 10 users
    if ((i + 1) % 10 === 0) {
      console.log(`📈 Progress: ${i + 1}/${users.length} processed (${successful} successful, ${failed} failed)`);
    }
  }
  
  console.log('\\n' + '='.repeat(70));
  console.log('🏁 FINAL RESTORATION RESULTS:');
  console.log(`✅ Successfully added: ${successful}/${users.length} users`);
  console.log(`❌ Failed to add: ${failed}/${users.length} users`);
  console.log(`📊 Success rate: ${Math.round((successful/users.length)*100)}%`);
  
  // Save detailed results
  const finalResults = {
    timestamp: new Date().toISOString(),
    totalUsers: users.length,
    successful: successful,
    failed: failed,
    successRate: Math.round((successful/users.length)*100),
    results: results
  };
  
  fs.writeFileSync('./final-restoration-results.json', JSON.stringify(finalResults, null, 2));
  console.log('💾 Detailed results saved to final-restoration-results.json');
  
  if (successful > 0) {
    console.log('\\n🎉 SUCCESS! Users have been restored to Counter UxV group');
    console.log('Check your Signal app - the removed users should now be back in the group');
  }
  
  if (failed > 0) {
    console.log(`\\n⚠️ ${failed} users failed to be added. Check the results file for details.`);
  }
  
  console.log('\\n✅ Restoration process completed!');
}

main().catch(error => {
  console.error('💥 Error:', error);
  process.exit(1);
});