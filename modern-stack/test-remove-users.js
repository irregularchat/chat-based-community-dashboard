#!/usr/bin/env node

const net = require('net');

// Configuration
const SOCKET_PATH = '/tmp/signal-cli-socket';
const BOT_ACCOUNT = '+19108471202';
const SOLO_TESTING_GROUP_ID = '/cjfmI7snAAhRPLDMlvW50Ja8fE9SuslMBFukFjn9iI='; // Solo testing group

// Users to keep (bot owner and bot itself)
const USERS_TO_KEEP = [
  '+12247253276', // Sac (user)
  '+19108471202'  // Bot itself
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
    }, 15000); // 15 second timeout for remove operations
    
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

async function getCurrentMembers() {
  console.log('🔍 Getting current Solo testing group members...');
  
  const request = {
    jsonrpc: '2.0',
    method: 'listGroups',
    params: { 
      account: BOT_ACCOUNT,
      'get-members': true 
    },
    id: `list-${Date.now()}`
  };
  
  const response = await sendRequest(request);
  
  if (response.result) {
    const soloGroup = response.result.find(g => g.id === SOLO_TESTING_GROUP_ID);
    if (soloGroup && soloGroup.members) {
      console.log(`\n📊 Solo testing group currently has ${soloGroup.members.length} members:`);
      
      const membersToRemove = [];
      soloGroup.members.forEach(member => {
        const identifier = member.number || member.uuid;
        const name = member.profile?.name || member.number || member.uuid.substring(0, 8);
        
        if (USERS_TO_KEEP.includes(member.number) || USERS_TO_KEEP.includes(identifier)) {
          console.log(`   ✅ Keeping: ${name} (${identifier})`);
        } else {
          console.log(`   ❌ Will remove: ${name} (${identifier})`);
          membersToRemove.push({
            uuid: member.uuid,
            number: member.number,
            name: name,
            identifier: identifier
          });
        }
      });
      
      return membersToRemove;
    }
  }
  
  console.log('   ❌ Could not get group members');
  return [];
}

async function removeUser(user) {
  console.log(`\n🗑️ Removing ${user.name} (${user.identifier})...`);
  
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
    console.log(`   ✅ Remove request succeeded for ${user.name}`);
    return true;
  } else if (response.error) {
    console.log(`   ❌ Failed for ${user.name}: ${response.error.message || response.error}`);
    return false;
  } else {
    console.log(`   ❓ Unknown response for ${user.name}`);
    return false;
  }
}

async function verifyRemoval(expectedRemainingCount) {
  console.log(`\n🔍 Verifying removal (expecting ${expectedRemainingCount} members)...`);
  
  // Wait a moment for the change to propagate
  await new Promise(resolve => setTimeout(resolve, 3000));
  
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
      console.log(`   📊 Solo testing group now has ${soloGroup.members.length} members`);
      
      soloGroup.members.forEach(member => {
        const identifier = member.number || member.uuid;
        const name = member.profile?.name || member.number || member.uuid.substring(0, 8);
        console.log(`   👤 ${name} (${identifier})`);
      });
      
      return soloGroup.members.length;
    }
  }
  
  console.log(`   ❌ Could not verify group membership`);
  return -1;
}

async function main() {
  console.log('🧹 Solo Testing Group Cleanup Script');
  console.log('=' .repeat(50));
  console.log(`Target group: Solo testing`);
  console.log(`Keeping users: ${USERS_TO_KEEP.join(', ')}`);
  console.log('');
  
  try {
    // Step 1: Get current members and identify who to remove
    const membersToRemove = await getCurrentMembers();
    
    if (membersToRemove.length === 0) {
      console.log('\n🎉 No members to remove! Group is already clean.');
      return;
    }
    
    console.log(`\n🎯 Found ${membersToRemove.length} members to remove`);
    
    let successCount = 0;
    let failCount = 0;
    
    // Step 2: Remove users one by one
    for (let i = 0; i < membersToRemove.length; i++) {
      const user = membersToRemove[i];
      console.log(`\n[${i + 1}/${membersToRemove.length}] Processing ${user.name}`);
      
      const success = await removeUser(user);
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
      
      // Verify after each removal
      const expectedCount = USERS_TO_KEEP.length + (membersToRemove.length - i - 1);
      const actualCount = await verifyRemoval(expectedCount);
      
      if (actualCount !== -1 && actualCount !== expectedCount) {
        console.log(`   ⚠️ Expected ${expectedCount} members, but found ${actualCount}`);
      }
      
      // Wait between requests to avoid rate limiting
      if (i < membersToRemove.length - 1) {
        console.log(`   ⏳ Waiting 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Step 3: Final verification
    console.log(`\n⏳ Waiting 5 seconds for final verification...`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const finalCount = await verifyRemoval(USERS_TO_KEEP.length);
    
    console.log(`\n${'='.repeat(50)}`);
    console.log(`📊 FINAL RESULTS:`);
    console.log(`   Users to remove: ${membersToRemove.length}`);
    console.log(`   Successful removals: ${successCount}`);
    console.log(`   Failed removals: ${failCount}`);
    console.log(`   Final group size: ${finalCount}`);
    console.log(`   Expected final size: ${USERS_TO_KEEP.length}`);
    
    if (finalCount === USERS_TO_KEEP.length) {
      console.log(`\n🎉 SUCCESS! Solo testing group cleaned up perfectly!`);
    } else if (finalCount < USERS_TO_KEEP.length) {
      console.log(`\n⚠️ WARNING: Group has fewer members than expected. Check if bot/owner was accidentally removed.`);
    } else {
      console.log(`\n❌ Some users were not removed. ${finalCount - USERS_TO_KEEP.length} extra members remain.`);
    }
    
  } catch (error) {
    console.error('❌ Script error:', error);
  }
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});