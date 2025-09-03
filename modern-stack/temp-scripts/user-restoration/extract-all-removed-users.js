#!/usr/bin/env node

const { PrismaClient } = require('./src/generated/prisma');
const fs = require('fs');
const net = require('net');

const prisma = new PrismaClient();

async function extractAllRemovedUsers() {
  console.log('🔍 EXTRACTING ALL REMOVED USERS FROM LOGS');
  console.log('=' + '='.repeat(50));
  
  const counterUxvGroupId = 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=';
  
  // First, let's get the original count from logs
  console.log('📖 Reading signal-bot.log to find removal details...');
  
  try {
    const logContent = fs.readFileSync('signal-bot.log', 'utf8');
    
    // Find all lines related to Counter UxV removal
    const lines = logContent.split('\n');
    const counterUxvLines = lines.filter(line => 
      line.includes('Counter UxV') || 
      line.includes(counterUxvGroupId) ||
      (line.includes('cached member data') && line.includes('458 members'))
    );
    
    console.log('📋 Found these Counter UxV related log entries:');
    counterUxvLines.forEach((line, i) => {
      console.log(`  ${i + 1}. ${line}`);
    });
    
    // The key insight: we had 458 members originally, now we have ~149
    // The difference is the users we need to restore
    console.log('\n🔢 Original member count from logs: 458');
    
    // Get the historical member data from our database before the sync updated it
    console.log('🗄️ Getting all possible Counter UxV members from database...');
    
    // Search for any members that might have been in Counter UxV
    // by looking at all members in our database who might belong to that group
    const allPossibleMembers = await prisma.signalGroupMember.findMany({
      where: {
        OR: [
          { groupId: counterUxvGroupId },
          // Also look for members who might have been moved to other groups
          // but were originally in Counter UxV (we can't determine this easily)
        ]
      }
    });
    
    console.log(`📊 Found ${allPossibleMembers.length} members in database for Counter UxV`);
    
    // Get current Signal group state to see who's actually there now
    console.log('📡 Getting current Counter UxV members from Signal...');
    const currentMembers = await getCurrentGroupMembers(counterUxvGroupId);
    
    if (currentMembers) {
      console.log(`👥 Current members in Signal: ${currentMembers.length}`);
      
      // Create a set of current member IDs
      const currentMemberIds = new Set([
        ...currentMembers.map(m => m.number).filter(n => n),
        ...currentMembers.map(m => m.uuid).filter(u => u)
      ]);
      
      console.log('Current member IDs:', Array.from(currentMemberIds).slice(0, 5), '...');
      
      // Find members from our database who are NOT in the current group
      const missingMembers = allPossibleMembers.filter(dbMember => 
        !currentMemberIds.has(dbMember.number) && !currentMemberIds.has(dbMember.uuid)
      );
      
      console.log(`❌ Missing members (in DB but not in Signal): ${missingMembers.length}`);
      
      if (missingMembers.length > 0) {
        console.log('\n📋 Missing members to restore:');
        missingMembers.forEach((member, i) => {
          console.log(`  ${i + 1}. ${member.name || member.profileName || 'No name'} (${member.number || member.uuid})`);
        });
        
        // Restore these missing members
        const membersToRestore = missingMembers
          .map(m => m.number || m.uuid)
          .filter(id => id);
        
        if (membersToRestore.length > 0) {
          console.log(`\n🔄 Restoring ${membersToRestore.length} missing members...`);
          await restoreUsersToGroup(counterUxvGroupId, membersToRestore);
        }
      }
      
      // Calculate still missing count
      const stillMissing = 458 - currentMembers.length - missingMembers.length;
      if (stillMissing > 0) {
        console.log(`\n⚠️ Still missing approximately ${stillMissing} users`);
        console.log('These users may need to be manually re-invited as they are not in our database cache');
      }
    }
    
  } catch (error) {
    console.error('❌ Error reading logs:', error.message);
  }
  
  await prisma.$disconnect();
}

async function getCurrentGroupMembers(groupId) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    let responseData = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log('⚠️ Request timed out');
        resolve(null);
      }
    }, 30000);
    
    socket.connect(socketPath, () => {
      const request = {
        jsonrpc: '2.0',
        method: 'listGroups',
        params: {
          account: '+19108471202',
          'group-id': groupId,
          'get-members': true
        },
        id: `get-current-members-${Date.now()}`
      };
      
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const lines = responseData.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          
          if (response.id && response.id.startsWith('get-current-members-')) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result && response.result.length > 0) {
                resolve(response.result[0].members || []);
              } else {
                resolve([]);
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
        resolve(null);
      }
    });
  });
}

async function restoreUsersToGroup(groupId, members) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    let responseData = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log('⚠️ Restoration timed out but may have succeeded');
        resolve(true);
      }
    }, 30000);
    
    socket.connect(socketPath, () => {
      const request = {
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
          account: '+19108471202',
          groupId: groupId,
          addMembers: members
        },
        id: `restore-missing-${Date.now()}`
      };
      
      console.log(`📤 Restoring ${members.length} users to Counter UxV...`);
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const lines = responseData.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          
          if (response.id && response.id.startsWith('restore-missing-')) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result !== undefined) {
                console.log('✅ Restoration request completed');
                resolve(true);
              } else if (response.error) {
                console.log('❌ Restoration error:', response.error);
                resolve(true); // Continue anyway
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
        console.log('❌ Socket error:', error.message);
        resolve(true);
      }
    });
  });
}

async function main() {
  try {
    await extractAllRemovedUsers();
    console.log('\n🎉 User extraction and restoration process completed!');
  } catch (error) {
    console.error('💥 Error:', error);
  }
}

main();