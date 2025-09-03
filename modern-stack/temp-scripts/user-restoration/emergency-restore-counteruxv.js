#!/usr/bin/env node

const { PrismaClient } = require('./src/generated/prisma');
const net = require('net');

const prisma = new PrismaClient();

async function emergencyRestoreCounterUxV() {
  console.log('🚨 EMERGENCY RESTORATION: Counter UxV Room');
  console.log('=' + '='.repeat(50));
  
  try {
    // Find the Counter UxV group by ID from logs
    const counterUxvGroupId = 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=';
    
    // Get all members that were in this group from our database cache
    const allMembers = await prisma.signalGroupMember.findMany({
      where: {
        groupId: counterUxvGroupId
      }
    });
    
    console.log(`📋 Found ${allMembers.length} total members in database for Counter UxV group`);
    
    // Get the group info
    const groupInfo = await prisma.signalGroup.findUnique({
      where: { groupId: counterUxvGroupId }
    });
    
    if (!groupInfo) {
      console.log('❌ Could not find group info in database');
      return;
    }
    
    console.log(`🎯 Group: ${groupInfo.name}`);
    console.log(`📊 Database shows ${allMembers.length} members should be in this group`);
    
    // Separate admins and non-admins
    const adminMembers = allMembers.filter(m => m.isAdmin);
    const nonAdminMembers = allMembers.filter(m => !m.isAdmin);
    
    console.log(`👑 Admins: ${adminMembers.length}`);
    console.log(`👤 Non-admins: ${nonAdminMembers.length}`);
    
    // Create list of all members to restore (we'll add everyone back to be safe)
    const membersToRestore = allMembers
      .map(member => member.number || member.uuid)
      .filter(id => id && id.trim() !== ''); // Remove any empty/null values
    
    console.log(`🔄 Preparing to restore ${membersToRestore.length} users to Counter UxV room`);
    
    if (membersToRestore.length === 0) {
      console.log('❌ No valid member identifiers found');
      return;
    }
    
    // Show some sample members being restored
    console.log('📋 Sample members being restored:');
    membersToRestore.slice(0, 10).forEach((member, i) => {
      console.log(`  ${i + 1}. ${member}`);
    });
    if (membersToRestore.length > 10) {
      console.log(`  ... and ${membersToRestore.length - 10} more`);
    }
    
    // Split into batches to avoid overwhelming Signal
    const batchSize = 50;
    const batches = [];
    for (let i = 0; i < membersToRestore.length; i += batchSize) {
      batches.push(membersToRestore.slice(i, i + batchSize));
    }
    
    console.log(`📦 Split into ${batches.length} batches of ${batchSize} users each`);
    
    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`🔄 Processing batch ${i + 1}/${batches.length} (${batch.length} users)...`);
      
      try {
        await addUsersBatch(counterUxvGroupId, batch, i + 1);
        console.log(`✅ Batch ${i + 1} completed`);
        
        // Small delay between batches
        if (i < batches.length - 1) {
          console.log('⏳ Waiting 2 seconds before next batch...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.log(`❌ Batch ${i + 1} failed:`, error.message);
        // Continue with next batch
      }
    }
    
    console.log('🎉 All batches processed!');
    console.log('📊 Triggering group sync to update database...');
    
    // Trigger a group sync to refresh the database
    await triggerGroupSync();
    
  } catch (error) {
    console.error('💥 Emergency restoration failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

async function addUsersBatch(groupId, membersBatch, batchNumber) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    let responseData = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log(`⚠️ Batch ${batchNumber} timed out but may have succeeded`);
        resolve(true); // Resolve anyway since timeouts are expected
      }
    }, 15000); // 15 second timeout per batch
    
    socket.connect(socketPath, () => {
      const request = {
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
          account: process.env.SIGNAL_BOT_PHONE_NUMBER || process.env.SIGNAL_PHONE_NUMBER || '+19108471202',
          groupId: groupId,
          addMembers: membersBatch
        },
        id: `restore-batch-${batchNumber}-${Date.now()}`
      };
      
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const lines = responseData.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          
          if (response.id && response.id.startsWith(`restore-batch-${batchNumber}-`)) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result !== undefined) {
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

async function triggerGroupSync() {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    let responseData = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log('⚠️ Group sync request timed out');
        resolve(true);
      }
    }, 30000);
    
    socket.connect(socketPath, () => {
      const request = {
        jsonrpc: '2.0',
        method: 'listGroups',
        params: {
          account: process.env.SIGNAL_BOT_PHONE_NUMBER || process.env.SIGNAL_PHONE_NUMBER || '+19108471202',
          'get-members': true
        },
        id: `sync-after-restore-${Date.now()}`
      };
      
      console.log('📡 Requesting fresh group sync...');
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const lines = responseData.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          
          if (response.id && response.id.startsWith('sync-after-restore-')) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              console.log('✅ Group sync completed');
              resolve(true);
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
        console.log('⚠️ Group sync error:', error.message);
        resolve(true);
      }
    });
  });
}

async function main() {
  await emergencyRestoreCounterUxV();
  
  console.log('');
  console.log('🎯 RESTORATION COMPLETE!');
  console.log('Please check the Counter UxV Signal group to verify all users have been restored.');
  console.log('The bot will also automatically sync the group data in the next periodic update.');
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});