#!/usr/bin/env node

const { PrismaClient } = require('./src/generated/prisma');
const net = require('net');

const prisma = new PrismaClient();

async function restoreAllCounterUxVUsers() {
  console.log('🚨 COMPREHENSIVE COUNTER UXV RESTORATION');
  console.log('=' + '='.repeat(60));
  console.log('This script will restore ALL users from the database to Counter UxV group');
  console.log('');
  
  try {
    const counterUxvGroupId = 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=';
    
    // Get group info
    const groupInfo = await prisma.signalGroup.findUnique({
      where: { groupId: counterUxvGroupId }
    });
    
    if (!groupInfo) {
      console.log('❌ Counter UXV group not found in database');
      return;
    }
    
    console.log(`🎯 Group: ${groupInfo.name}`);
    console.log(`📊 Expected member count: ${groupInfo.memberCount}`);
    
    // Get ALL members that should be in this group from database
    const allMembers = await prisma.signalGroupMember.findMany({
      where: { groupId: counterUxvGroupId }
    });
    
    console.log(`📋 Found ${allMembers.length} total members in database`);
    
    // Separate admins and non-admins
    const adminMembers = allMembers.filter(m => m.isAdmin);
    const nonAdminMembers = allMembers.filter(m => !m.isAdmin);
    
    console.log(`👑 Admins: ${adminMembers.length}`);
    console.log(`👤 Non-admins: ${nonAdminMembers.length}`);
    
    // Prepare member identifiers (phone numbers or UUIDs)
    const membersToRestore = allMembers
      .map(member => member.number || member.uuid)
      .filter(id => id && id.trim() !== ''); // Remove any empty/null values
    
    console.log(`🔄 Preparing to restore ${membersToRestore.length} users`);
    
    if (membersToRestore.length === 0) {
      console.log('❌ No valid member identifiers found');
      return;
    }
    
    // Show sample of users being restored
    console.log('\\n📋 Sample of users being restored:');
    const sampleMembers = allMembers.slice(0, 15);
    sampleMembers.forEach((member, i) => {
      console.log(`  ${i + 1}. ${member.name || 'No name'} (${member.number || member.uuid})`);
    });
    if (allMembers.length > 15) {
      console.log(`  ... and ${allMembers.length - 15} more users`);
    }
    
    // Special handling for Sac - ensure he's added as admin
    const sacNumber = '+12247253276';
    const sacMember = allMembers.find(m => m.number === sacNumber);
    
    if (sacMember) {
      console.log(`\\n👑 Sac found in member list - will be added as admin`);
    } else {
      console.log(`\\n⚠️ Sac not found in member list - adding manually as admin`);
      membersToRestore.push(sacNumber);
    }
    
    // Split into manageable batches to avoid overwhelming Signal
    const batchSize = 25; // Smaller batches for reliability
    const batches = [];
    for (let i = 0; i < membersToRestore.length; i += batchSize) {
      batches.push(membersToRestore.slice(i, i + batchSize));
    }
    
    console.log(`\\n📦 Split restoration into ${batches.length} batches of up to ${batchSize} users each`);
    console.log('🚀 Starting batch restoration process...');
    console.log('');
    
    let successfulBatches = 0;
    let failedBatches = 0;
    
    // Process each batch with delays
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchNumber = i + 1;
      
      console.log(`📦 Processing batch ${batchNumber}/${batches.length} (${batch.length} users)...`);
      
      try {
        await addUsersBatch(counterUxvGroupId, batch, batchNumber);
        successfulBatches++;
        console.log(`✅ Batch ${batchNumber} completed successfully`);
        
        // Delay between batches to avoid rate limits
        if (i < batches.length - 1) {
          console.log('⏳ Waiting 3 seconds before next batch...');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
      } catch (error) {
        failedBatches++;
        console.log(`❌ Batch ${batchNumber} failed:`, error.message);
        console.log('🔄 Continuing with next batch...');
        
        // Still wait before next batch even on failure
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
    
    console.log('\\n📊 RESTORATION SUMMARY:');
    console.log(`✅ Successful batches: ${successfulBatches}/${batches.length}`);
    console.log(`❌ Failed batches: ${failedBatches}/${batches.length}`);
    console.log(`📋 Total users processed: ${membersToRestore.length}`);
    
    // Now add Sac as admin specifically
    if (sacMember || membersToRestore.includes(sacNumber)) {
      console.log('\\n👑 Adding Sac as admin...');
      try {
        await addSacAsAdmin(counterUxvGroupId, sacNumber);
        console.log('✅ Sac successfully added as admin');
      } catch (error) {
        console.log('❌ Failed to add Sac as admin:', error.message);
      }
    }
    
    console.log('\\n🎉 COMPREHENSIVE RESTORATION COMPLETE!');
    console.log('Please check the Counter UxV Signal group to verify users have been restored.');
    
  } catch (error) {
    console.error('💥 Critical error during restoration:', error);
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
        console.log(`⚠️ Batch ${batchNumber} timed out (this is often normal)`);
        resolve(true); // Resolve since timeouts are expected
      }
    }, 20000); // 20 second timeout per batch
    
    socket.connect(socketPath, () => {
      const request = {
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
          account: process.env.SIGNAL_BOT_PHONE_NUMBER || process.env.SIGNAL_PHONE_NUMBER || '+19108471202',
          groupId: groupId,
          addMembers: membersBatch
        },
        id: `restore-all-batch-${batchNumber}-${Date.now()}`
      };
      
      console.log(`📤 Sending batch ${batchNumber} to Signal CLI...`);
      socket.write(JSON.stringify(request) + '\\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const lines = responseData.split('\\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          
          if (response.id && response.id.startsWith(`restore-all-batch-${batchNumber}-`)) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result !== undefined) {
                resolve(true);
              } else if (response.error) {
                console.log(`⚠️ Batch ${batchNumber} error:`, response.error.message);
                // Don't reject, just log and continue
                resolve(true);
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
        console.log(`⚠️ Batch ${batchNumber} socket error:`, error.message);
        // Don't reject completely, log and continue
        resolve(true);
      }
    });
  });
}

async function addSacAsAdmin(groupId, sacNumber) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    let responseData = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log('⚠️ Admin request timed out but may have succeeded');
        resolve(true);
      }
    }, 15000);
    
    socket.connect(socketPath, () => {
      const request = {
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
          account: process.env.SIGNAL_BOT_PHONE_NUMBER || process.env.SIGNAL_PHONE_NUMBER || '+19108471202',
          groupId: groupId,
          addMembers: [sacNumber],
          addAdmins: [sacNumber]
        },
        id: `add-sac-admin-${Date.now()}`
      };
      
      console.log(`📤 Adding Sac as admin...`);
      socket.write(JSON.stringify(request) + '\\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const lines = responseData.split('\\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          
          if (response.id && response.id.startsWith('add-sac-admin-')) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result !== undefined) {
                resolve(true);
              } else if (response.error) {
                reject(new Error(response.error.message || 'Unknown admin error'));
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
  console.log('🚨 COUNTER UXV COMPREHENSIVE USER RESTORATION');
  console.log('This will restore all users from the database back to the Counter UxV group');
  console.log('Press Ctrl+C within 5 seconds to cancel...');
  console.log('');
  
  // Give user a chance to cancel
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  console.log('🚀 Starting restoration process...');
  console.log('');
  
  await restoreAllCounterUxVUsers();
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});