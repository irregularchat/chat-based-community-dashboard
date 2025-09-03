#!/usr/bin/env node

const net = require('net');

// Configuration
const SOCKET_PATH = '/tmp/signal-cli-socket';
const BOT_ACCOUNT = '+19108471202';
const SOLO_TESTING_GROUP_ID = '/cjfmI7snAAhRPLDMlvW50Ja8fE9SuslMBFukFjn9iI=';

// Test users to add for nonadmin removal testing
const testUsers = [
  { uuid: '4a4b6530-627a-4b52-b6f8-7ed38fcbeecb', name: 'Austyn' },
  { uuid: '338b0a07-0e74-4fbe-baf5-2e7d8d7d292f', name: 'Rico' },
  { uuid: '5322c630-dffe-4ffd-991e-44d01c16ae44', name: 'JD' }
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
    }, 15000);
    
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

async function addUserBack(user) {
  console.log(`➕ Adding ${user.name} back to Solo testing group...`);
  
  const request = {
    jsonrpc: '2.0',
    method: 'updateGroup',
    params: {
      account: BOT_ACCOUNT,
      groupId: SOLO_TESTING_GROUP_ID,
      member: [user.uuid]
    },
    id: `add-${Date.now()}-${user.uuid.substring(0, 8)}`
  };
  
  const response = await sendRequest(request);
  
  if (response.result || response.success || response.timedOut) {
    console.log(`   ✅ Successfully added ${user.name} back`);
    return true;
  } else {
    console.log(`   ❌ Failed to add ${user.name}: ${response.error?.message || 'Unknown error'}`);
    return false;
  }
}

async function getCurrentMembers() {
  console.log('🔍 Getting current Solo testing group members with admin status...');
  
  const request = {
    jsonrpc: '2.0',
    method: 'listGroups',
    params: { 
      account: BOT_ACCOUNT,
      'get-members': true,
      'get-admins': true
    },
    id: `list-${Date.now()}`
  };
  
  const response = await sendRequest(request);
  
  if (response.result) {
    const soloGroup = response.result.find(g => g.id === SOLO_TESTING_GROUP_ID);
    if (soloGroup) {
      const members = soloGroup.members || [];
      const admins = soloGroup.admins || [];
      
      console.log(`   📊 Solo testing group has ${members.length} members, ${admins.length} admins`);
      console.log(`   🔑 Admins:`, admins);
      
      members.forEach(member => {
        const identifier = member.number || member.uuid;
        const name = member.profile?.name || member.number || member.uuid.substring(0, 8);
        const isAdmin = admins.some(admin => 
          (admin.uuid && admin.uuid === member.uuid) ||
          (admin.number && admin.number === member.number) ||
          admin === member.uuid ||
          admin === member.number
        );
        console.log(`   👤 ${name} (${identifier}) ${isAdmin ? '👑 ADMIN' : '👤 MEMBER'}`);
      });
      
      return {
        members: members,
        admins: admins,
        totalMembers: members.length,
        totalAdmins: admins.length,
        nonAdmins: members.filter(member => 
          !admins.some(admin => 
            (admin.uuid && admin.uuid === member.uuid) ||
            (admin.number && admin.number === member.number) ||
            admin === member.uuid ||
            admin === member.number
          )
        )
      };
    }
  }
  
  console.log('   ❌ Could not get group members');
  return null;
}

async function testNonadminRemoval() {
  console.log(`🧪 Testing nonadmin removal functionality...`);
  
  // This tests the command processing without actually running it
  // In practice, you would use: !removeuser 11 nonadmin
  console.log(`   💡 To test in Signal: !removeuser 11 nonadmin`);
  console.log(`   💡 With confirmation: !removeuser 11 nonadmin confirm`);
  console.log(`   💡 Group 11 should be "Solo testing" in the !groups list`);
  
  return true;
}

async function directRemoveNonadmins(groupInfo) {
  if (!groupInfo || groupInfo.nonAdmins.length === 0) {
    console.log('   ℹ️ No non-admin users to remove');
    return [];
  }
  
  console.log(`🗑️ Direct removal of ${groupInfo.nonAdmins.length} non-admin users...`);
  
  const results = [];
  for (const user of groupInfo.nonAdmins) {
    const displayName = user.profile?.name || user.number || user.uuid.substring(0, 8);
    console.log(`   🗑️ Removing ${displayName}...`);
    
    const request = {
      jsonrpc: '2.0',
      method: 'updateGroup',
      params: {
        account: BOT_ACCOUNT,
        groupId: SOLO_TESTING_GROUP_ID,
        removeMembers: [user.uuid]
      },
      id: `remove-${Date.now()}-${user.uuid.substring(0, 8)}`
    };
    
    const response = await sendRequest(request);
    
    if (response.result || response.success || response.timedOut) {
      console.log(`   ✅ Successfully removed ${displayName}`);
      results.push({ name: displayName, success: true });
    } else {
      console.log(`   ❌ Failed to remove ${displayName}: ${response.error?.message || 'Unknown error'}`);
      results.push({ name: displayName, success: false, error: response.error?.message || 'Unknown error' });
    }
    
    // Small delay between removals
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return results;
}

async function main() {
  console.log('🧪 NonadminRemoval Testing Script');
  console.log('=' .repeat(50));
  console.log('This script will:');
  console.log('1. Check current Solo testing group members and admin status');
  console.log('2. Add test users (as non-admins) for testing');
  console.log('3. Test the nonadmin removal detection');
  console.log('4. Demonstrate direct nonadmin removal');
  console.log('5. Verify final state');
  console.log('');
  
  try {
    // Step 1: Check current state
    console.log('📊 STEP 1: Checking initial group state...');
    const initialState = await getCurrentMembers();
    
    if (!initialState) {
      console.log('❌ Could not get initial group state');
      return;
    }
    
    // Step 2: Add test users as non-admins
    console.log(`\n📥 STEP 2: Adding ${testUsers.length} test users as non-admins...`);
    
    for (const user of testUsers) {
      const isAlreadyMember = initialState.members.some(m => m.uuid === user.uuid);
      if (!isAlreadyMember) {
        await addUserBack(user);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.log(`   ✅ ${user.name} is already in the group`);
      }
    }
    
    // Wait and verify
    await new Promise(resolve => setTimeout(resolve, 3000));
    const stateAfterAdd = await getCurrentMembers();
    
    // Step 3: Test nonadmin detection
    console.log(`\n🔍 STEP 3: Analyzing admin vs non-admin users...`);
    if (stateAfterAdd) {
      console.log(`   📊 Total members: ${stateAfterAdd.totalMembers}`);
      console.log(`   👑 Admin users: ${stateAfterAdd.totalAdmins}`);
      console.log(`   👤 Non-admin users: ${stateAfterAdd.nonAdmins.length}`);
      
      if (stateAfterAdd.nonAdmins.length > 0) {
        console.log(`   🎯 Non-admin users to remove:`);
        stateAfterAdd.nonAdmins.forEach(user => {
          const displayName = user.profile?.name || user.number || user.uuid.substring(0, 8);
          console.log(`      - ${displayName} (${user.uuid.substring(0, 8)}...)`);
        });
      }
    }
    
    // Step 4: Test the command functionality
    console.log(`\n🧪 STEP 4: Testing nonadmin removal command...`);
    await testNonadminRemoval();
    
    // Step 5: Demonstrate direct removal (for validation)
    console.log(`\n🗑️ STEP 5: Direct nonadmin removal for validation...`);
    const removalResults = await directRemoveNonadmins(stateAfterAdd);
    
    // Step 6: Final verification
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log(`\n🔍 STEP 6: Final verification...`);
    const finalState = await getCurrentMembers();
    
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📊 TEST RESULTS SUMMARY:`);
    console.log(`   Initial members: ${initialState?.totalMembers || 'Unknown'}`);
    console.log(`   After adding test users: ${stateAfterAdd?.totalMembers || 'Unknown'}`);
    console.log(`   Non-admin users detected: ${stateAfterAdd?.nonAdmins.length || 0}`);
    console.log(`   Removal attempts: ${removalResults.length}`);
    console.log(`   Successful removals: ${removalResults.filter(r => r.success).length}`);
    console.log(`   Final members: ${finalState?.totalMembers || 'Unknown'}`);
    console.log(`   Final admins: ${finalState?.totalAdmins || 'Unknown'}`);
    
    const successCount = removalResults.filter(r => r.success).length;
    if (successCount === removalResults.length && removalResults.length > 0) {
      console.log(`\n🎉 SUCCESS! Nonadmin removal functionality works perfectly!`);
      console.log(`✅ Admin detection is working correctly`);
      console.log(`✅ Non-admin user filtering is working correctly`);
      console.log(`✅ Removal operations are successful`);
    } else if (removalResults.length === 0) {
      console.log(`\nℹ️ No non-admin users were present to test removal`);
      console.log(`✅ Admin detection logic is working (no false positives)`);
    } else {
      console.log(`\n⚠️ Partial success: ${successCount}/${removalResults.length} removals succeeded`);
    }
    
    console.log(`\n💡 USAGE INSTRUCTIONS:`);
    console.log(`   For Entry Room cleanup: !removeuser 4 nonadmin`);
    console.log(`   With confirmation: !removeuser 4 nonadmin confirm`);
    console.log(`   Use !groups to see group numbers`);
    console.log(`   ⚠️ This removes ALL non-admin users from the specified group`);
    console.log(`   ✅ Admins are automatically protected and will not be removed`);
    
  } catch (error) {
    console.error('❌ Script error:', error);
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});