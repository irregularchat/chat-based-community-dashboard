#!/usr/bin/env node

const { PrismaClient } = require('./src/generated/prisma');
const net = require('net');

const prisma = new PrismaClient();

async function restoreSpecificUsers() {
  console.log('🎯 TARGETED RESTORATION: Adding specific users back to Counter UxV');
  console.log('=' + '='.repeat(60));
  
  // Users visible in the Signal screenshot that were removed
  const removedUsernames = [
    'Kevin Cap.',
    'Ronnie Ankner.',
    'Nick Rivera.',
    'Greg (Nashoba) Gardner.',
    'Robert Dodson.',
    'Brien Rocha.',
    'Neil Mooney.',
    'michael brilla.',
    'Greg.',
    'Tim M.',
    'Cameron Matthews.',
    'William Jones.',
    'Stan O.',
    'Adam Cooper.',
    'Scott Wirth.'
  ];
  
  console.log(`📋 Searching for ${removedUsernames.length} specific users in our database...`);
  
  const counterUxvGroupId = 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=';
  
  // Search across ALL groups to find these users by name
  const allMembers = await prisma.signalGroupMember.findMany({
    where: {
      OR: removedUsernames.map(username => ({
        OR: [
          { name: { contains: username.replace('.', ''), mode: 'insensitive' } },
          { profileName: { contains: username.replace('.', ''), mode: 'insensitive' } }
        ]
      }))
    }
  });
  
  console.log(`🔍 Found ${allMembers.length} potential matches in database`);
  
  // Also search by partial name matches
  const nameSearches = removedUsernames.map(name => name.replace('.', '').toLowerCase());
  const potentialMatches = await prisma.signalGroupMember.findMany({
    where: {
      OR: nameSearches.flatMap(searchName => [
        { name: { contains: searchName, mode: 'insensitive' } },
        { profileName: { contains: searchName, mode: 'insensitive' } }
      ])
    }
  });
  
  console.log(`🔍 Found ${potentialMatches.length} potential name matches`);
  
  // Combine and deduplicate
  const allPotentialUsers = [...allMembers, ...potentialMatches];
  const uniqueUsers = allPotentialUsers.filter((user, index, self) => 
    index === self.findIndex(u => u.uuid === user.uuid || (u.number && user.number && u.number === user.number))
  );
  
  console.log(`📊 Total unique potential users: ${uniqueUsers.length}`);
  
  if (uniqueUsers.length > 0) {
    console.log('\n👥 Found these potential matches:');
    uniqueUsers.forEach((user, i) => {
      console.log(`  ${i + 1}. ${user.name || user.profileName || 'No name'} (${user.number || user.uuid})`);
    });
  }
  
  // Get all members currently in Counter UxV to avoid duplicates
  const currentCounterUxvMembers = await prisma.signalGroupMember.findMany({
    where: { groupId: counterUxvGroupId }
  });
  
  const currentMemberIds = new Set([
    ...currentCounterUxvMembers.map(m => m.number).filter(n => n),
    ...currentCounterUxvMembers.map(m => m.uuid).filter(u => u)
  ]);
  
  // Filter out users already in the group
  const usersToAdd = uniqueUsers.filter(user => 
    !currentMemberIds.has(user.number) && !currentMemberIds.has(user.uuid)
  );
  
  console.log(`\n🎯 Users to add (not already in Counter UxV): ${usersToAdd.length}`);
  
  if (usersToAdd.length === 0) {
    console.log('✅ All found users are already in the Counter UxV group');
    return;
  }
  
  // Prepare member identifiers for Signal CLI
  const membersToAdd = usersToAdd
    .map(user => user.number || user.uuid)
    .filter(id => id);
  
  if (membersToAdd.length === 0) {
    console.log('❌ No valid member identifiers found');
    return;
  }
  
  console.log(`🔄 Adding ${membersToAdd.length} users to Counter UxV room...`);
  
  // Add users to Counter UxV
  try {
    await addUsersToGroup(counterUxvGroupId, membersToAdd);
    console.log('✅ Successfully added users to Counter UxV room');
  } catch (error) {
    console.log('❌ Failed to add users:', error.message);
  }
  
  await prisma.$disconnect();
}

async function addUsersToGroup(groupId, members) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    let responseData = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log('⚠️ Request timed out but may have succeeded');
        resolve(true);
      }
    }, 20000);
    
    socket.connect(socketPath, () => {
      console.log('✅ Connected to Signal CLI socket');
      
      const request = {
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
          account: process.env.SIGNAL_BOT_PHONE_NUMBER || process.env.SIGNAL_PHONE_NUMBER || '+19108471202',
          groupId: groupId,
          addMembers: members
        },
        id: `add-specific-users-${Date.now()}`
      };
      
      console.log(`📤 Adding ${members.length} specific users...`);
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const lines = responseData.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          
          if (response.id && response.id.startsWith('add-specific-users-')) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result !== undefined) {
                console.log('📥 Signal CLI responded successfully');
                resolve(true);
              } else if (response.error) {
                reject(new Error(response.error.message || 'Unknown error'));
              } else {
                resolve(true);
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
        reject(error);
      }
    });
  });
}

async function main() {
  try {
    await restoreSpecificUsers();
    console.log('\n🎉 Specific user restoration process completed!');
    console.log('Check the Counter UxV Signal group to verify the users have been added back.');
  } catch (error) {
    console.error('💥 Error:', error);
  }
}

main();