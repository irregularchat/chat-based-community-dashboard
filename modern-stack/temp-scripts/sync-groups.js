#!/usr/bin/env node

/**
 * Sync Groups Script
 * Fetches real group data from Signal CLI including members, admins, and bot status
 * Updates the groups-cache.json with accurate information
 */

require('dotenv').config({ path: '.env.local' });
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

const PHONE_NUMBER = process.env.SIGNAL_PHONE_NUMBER || process.env.SIGNAL_BOT_PHONE_NUMBER;
const DATA_DIR = process.env.SIGNAL_CLI_DATA_DIR || './signal-data';
const CACHE_FILE = path.join(DATA_DIR, 'groups-cache.json');
const BOT_UUID = 'd6292870-2d4f-43a1-89fe-d63791ca104d'; // Bot's UUID
const BOT_PHONE = '+19108471202'; // Bot's phone number

async function executeSignalCliCommand(args) {
  return new Promise((resolve, reject) => {
    const cmd = spawn('signal-cli', [
      '-a', PHONE_NUMBER,
      '--config', DATA_DIR,
      ...args
    ]);
    
    let stdout = '';
    let stderr = '';
    
    cmd.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    cmd.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    cmd.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
    
    cmd.on('error', (error) => {
      reject(error);
    });
  });
}

function parseGroupsOutput(output) {
  const groups = [];
  const lines = output.split('\n');
  let currentGroup = null;
  let inMembersSection = false;
  let inAdminsSection = false;
  let currentMembers = [];
  let currentAdmins = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Check for group ID line (start of new group)
    if (trimmedLine.startsWith('Id:')) {
      // Save previous group if exists
      if (currentGroup) {
        currentGroup.members = currentMembers;
        currentGroup.admins = currentAdmins;
        groups.push(currentGroup);
      }
      
      // Start new group
      currentGroup = {
        id: trimmedLine.replace('Id:', '').trim().split(' ')[0],
        members: [],
        admins: []
      };
      currentMembers = [];
      currentAdmins = [];
      inMembersSection = false;
      inAdminsSection = false;
      
      // Check if Name is on same line
      const nameMatch = trimmedLine.match(/Name:\s*(.+?)(?:\s+Description:|$)/);
      if (nameMatch) {
        currentGroup.name = nameMatch[1].trim();
      }
      
      // Check if Description is on same line
      const descMatch = trimmedLine.match(/Description:\s*(.+)/);
      if (descMatch) {
        currentGroup.description = descMatch[1].trim();
      }
    } else if (currentGroup) {
      // Parse group properties
      if (trimmedLine.startsWith('Name:') && !currentGroup.name) {
        currentGroup.name = trimmedLine.replace('Name:', '').trim();
      } else if (trimmedLine.startsWith('Description:')) {
        const desc = trimmedLine.replace('Description:', '').trim();
        currentGroup.description = currentGroup.description 
          ? currentGroup.description + ' ' + desc 
          : desc;
      } else if (trimmedLine.startsWith('Active:')) {
        currentGroup.active = trimmedLine.includes('true');
      } else if (trimmedLine.startsWith('Blocked:')) {
        currentGroup.blocked = trimmedLine.includes('true');
      } else if (trimmedLine.startsWith('Members:')) {
        inMembersSection = true;
        inAdminsSection = false;
        // Parse members array from the line
        const membersMatch = trimmedLine.match(/Members:\s*\[([^\]]*)\]/);
        if (membersMatch) {
          const membersList = membersMatch[1].split(',').map(m => m.trim());
          currentMembers = membersList.filter(m => m.length > 0);
        }
      } else if (trimmedLine.startsWith('Admins:')) {
        inMembersSection = false;
        inAdminsSection = true;
        // Parse admins array from the line
        const adminsMatch = trimmedLine.match(/Admins:\s*\[([^\]]*)\]/);
        if (adminsMatch) {
          const adminsList = adminsMatch[1].split(',').map(a => a.trim());
          currentAdmins = adminsList.filter(a => a.length > 0);
        }
      } else if (trimmedLine.startsWith('Pending members:') || 
                 trimmedLine.startsWith('Requesting members:') ||
                 trimmedLine.startsWith('Banned:') ||
                 trimmedLine.startsWith('Message expiration:') ||
                 trimmedLine.startsWith('Link:')) {
        inMembersSection = false;
        inAdminsSection = false;
      }
    }
  }
  
  // Add the last group
  if (currentGroup) {
    currentGroup.members = currentMembers;
    currentGroup.admins = currentAdmins;
    groups.push(currentGroup);
  }
  
  return groups;
}

async function syncGroups() {
  console.log('🔄 Starting group synchronization...\n');
  console.log('📱 Phone:', PHONE_NUMBER);
  console.log('📂 Data Dir:', DATA_DIR);
  console.log('🤖 Bot UUID:', BOT_UUID);
  console.log('');
  
  try {
    // Get detailed list of all groups with members
    console.log('📋 Fetching detailed group list with members...');
    const output = await executeSignalCliCommand(['listGroups', '-d']);
    
    const groups = parseGroupsOutput(output);
    
    if (!groups || groups.length === 0) {
      throw new Error('No groups found or failed to parse groups');
    }
    
    console.log(`✅ Found ${groups.length} groups\n`);
    
    const processedGroups = [];
    
    for (const group of groups) {
      console.log(`\n🔍 Processing: ${group.name || 'Unknown Group'}`);
      console.log(`   ID: ${group.id.substring(0, 20)}...`);
      
      // Skip test groups and non-IrregularChat groups unless they're special
      const isRelevantGroup = group.name && (
        group.name.toLowerCase().includes('irregular') ||
        group.name.toLowerCase().includes('solo test') ||
        group.name.toLowerCase().includes('ir:')
      );
      
      if (!isRelevantGroup) {
        console.log(`  ⚠️ Skipping non-IrregularChat group: ${group.name}`);
        continue;
      }
      
      // Extract member and admin information
      const memberCount = group.members.length;
      
      // Check if bot is in members and if bot is admin
      const botIsMember = group.members.includes(BOT_UUID) || group.members.includes(BOT_PHONE);
      const botIsAdmin = group.admins.includes(BOT_UUID) || group.admins.includes(BOT_PHONE);
      
      if (!botIsMember) {
        console.log(`  ⚠️ Bot is not a member of this group, skipping`);
        continue;
      }
      
      const groupData = {
        id: group.id,
        name: group.name || 'Unknown',
        type: 'GROUP',
        active: group.active !== false,
        memberCount: memberCount,
        botIsAdmin: botIsAdmin,
        adminCount: group.admins.length,
        description: group.description || null
      };
      
      console.log(`  ✅ ${groupData.name}`);
      console.log(`     👥 Members: ${memberCount}`);
      console.log(`     🤖 Bot is admin: ${botIsAdmin}`);
      console.log(`     👮 Total admins: ${group.admins.length}`);
      
      processedGroups.push(groupData);
    }
    
    // Sort groups by name
    processedGroups.sort((a, b) => a.name.localeCompare(b.name));
    
    // Save to cache file
    const cacheData = {
      groups: processedGroups,
      lastUpdated: Date.now(),
      cacheVersion: '2.0',
      botUUID: BOT_UUID,
      botPhone: BOT_PHONE
    };
    
    await fs.writeFile(CACHE_FILE, JSON.stringify(cacheData, null, 2));
    
    console.log('\n✅ Group synchronization complete!');
    console.log(`📝 Saved ${processedGroups.length} groups to ${CACHE_FILE}`);
    
    // Display summary
    console.log('\n📊 Summary:');
    console.log(`  Total groups bot is in: ${processedGroups.length}`);
    console.log(`  Bot is admin in: ${processedGroups.filter(g => g.botIsAdmin).length} groups`);
    console.log(`  Total members across all groups: ${processedGroups.reduce((sum, g) => sum + g.memberCount, 0)}`);
    
    // List all groups
    console.log('\n📋 Groups:');
    processedGroups.forEach((g, i) => {
      console.log(`  ${i + 1}. ${g.name} (👥 ${g.memberCount} members${g.botIsAdmin ? ', 🤖 Bot is admin' : ''})`);
    });
    
    return processedGroups;
    
  } catch (error) {
    console.error('\n❌ Sync failed:', error.message);
    
    if (error.message.includes('not found')) {
      console.log('\n💡 Make sure signal-cli is installed:');
      console.log('   macOS: brew install signal-cli');
      console.log('   Linux: Download from https://github.com/AsamK/signal-cli/releases');
    }
    
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  syncGroups()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { syncGroups };