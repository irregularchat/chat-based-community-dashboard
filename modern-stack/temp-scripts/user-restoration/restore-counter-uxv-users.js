#!/usr/bin/env node

const { PrismaClient } = require('./src/generated/prisma');
const net = require('net');

const prisma = new PrismaClient();

async function restoreCounterUxVUsers() {
  console.log('🔄 Starting Counter UxV user restoration...');
  
  try {
    // Find the Counter UxV group
    const groups = await prisma.signalGroup.findMany();
    console.log('📊 Available groups:');
    groups.forEach((group, index) => {
      console.log(`  ${index + 1}. ${group.name} (${group.memberCount} members)`);
    });
    
    // Find Counter UxV group (should be the one that had 458 members before)
    const counterUxvGroup = groups.find(g => 
      g.name.toLowerCase().includes('counter') && g.name.toLowerCase().includes('uxv')
    );
    
    if (!counterUxvGroup) {
      console.log('❌ Could not find Counter UxV group');
      console.log('Available group names:', groups.map(g => g.name));
      return;
    }
    
    console.log(`🎯 Found Counter UxV group: ${counterUxvGroup.name}`);
    console.log(`📍 Group ID: ${counterUxvGroup.groupId}`);
    console.log(`👥 Current member count: ${counterUxvGroup.memberCount}`);
    
    // Get all members who were in this group (they should still be in the database)
    const allMembers = await prisma.signalGroupMember.findMany({
      where: {
        groupId: counterUxvGroup.groupId
      }
    });
    
    console.log(`📋 Found ${allMembers.length} members in database for this group`);
    
    // Get non-admin members (these are the ones that were likely removed)
    const nonAdminMembers = allMembers.filter(member => !member.isAdmin);
    const adminMembers = allMembers.filter(member => member.isAdmin);
    
    console.log(`👑 Admins: ${adminMembers.length}`);
    console.log(`👤 Non-admins: ${nonAdminMembers.length}`);
    
    if (nonAdminMembers.length === 0) {
      console.log('✅ No non-admin members to restore');
      return;
    }
    
    console.log('🔄 Preparing to restore non-admin users...');
    
    // Prepare member list for restoration
    const membersToRestore = nonAdminMembers
      .map(member => member.number || member.uuid)
      .filter(identifier => identifier); // Remove any null/undefined values
    
    console.log(`📤 Will restore ${membersToRestore.length} users to Counter UxV group`);
    
    // Send restoration request via Signal CLI
    await restoreUsersViaSignalCli(counterUxvGroup.groupId, membersToRestore);
    
  } catch (error) {
    console.error('❌ Error during restoration:', error);
  } finally {
    await prisma.$disconnect();
  }
}

async function restoreUsersViaSignalCli(groupId, members) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    let responseData = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log('⚠️ Request timed out but restoration may have been initiated');
        resolve(true);
      }
    }, 30000); // 30 second timeout
    
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
        id: 'restore-counter-uxv-' + Date.now()
      };
      
      console.log('📤 Sending restoration request...');
      console.log(`📊 Adding ${members.length} users to group ${groupId}`);
      
      socket.write(JSON.stringify(request) + '\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      try {
        const lines = responseData.split('\n').filter(line => line.trim());
        for (const line of lines) {
          const response = JSON.parse(line);
          console.log('📥 Received response:', JSON.stringify(response, null, 2));
          
          if (response.id && response.id.startsWith('restore-counter-uxv-')) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result !== undefined) {
                console.log('✅ Restoration request sent successfully!');
                resolve(true);
              } else if (response.error) {
                console.log('❌ Error in restoration:', response.error);
                reject(new Error(response.error.message || 'Unknown error'));
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
        reject(error);
      }
    });
  });
}

async function main() {
  console.log('🚨 EMERGENCY: Counter UxV User Restoration');
  console.log('=' + '='.repeat(50));
  console.log('This script will restore all non-admin users to the Counter UxV group');
  console.log('that were mistakenly removed by the !removeuser 4 nonadmin command');
  console.log('');
  
  await restoreCounterUxVUsers();
  
  console.log('');
  console.log('🎉 Restoration process completed!');
  console.log('Check the Signal group to verify users have been restored.');
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});