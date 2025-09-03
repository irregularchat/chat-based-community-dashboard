#!/usr/bin/env node

// Simple test to show group ordering

const fsPromises = require('fs').promises;
const path = require('path');

async function main() {
  console.log('🔍 Testing Group Ordering\n');
  console.log('=====================================\n');
  
  const cacheFile = path.join('./signal-data', 'groups-cache.json');
  
  try {
    const cacheData = await fsPromises.readFile(cacheFile, 'utf8');
    const cache = JSON.parse(cacheData);
    const groups = cache.groups || [];
    
    console.log('📦 Groups from cache (ORIGINAL order - what !addto used to use):');
    console.log('----------------------------------------------------------------');
    groups.forEach((group, index) => {
      const num = index + 1;
      const marker = group.name.includes('Bot Development') ? ' ⬅️ Bot Dev was #6' :
                     group.name.includes('Space') ? ' ⬅️ Space was #5' : '';
      console.log(`  ${num}. ${group.name} (${group.memberCount} members)${marker}`);
    });
    
    // Sort by member count
    const sortedGroups = [...groups].sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));
    
    console.log('\n✅ Groups SORTED by member count (what !groups shows and !addto NOW uses):');
    console.log('--------------------------------------------------------------------------');
    sortedGroups.forEach((group, index) => {
      const num = index + 1;
      const marker = group.name.includes('Bot Development') ? ' ⬅️ Bot Dev is now #5' :
                     group.name.includes('Space') ? ' ⬅️ Space is now #6' : '';
      console.log(`  ${num}. ${group.name} (${group.memberCount} members)${marker}`);
    });
    
    console.log('\n📋 Summary:');
    console.log('===========');
    console.log('The issue was that:');
    console.log('- !groups displayed groups sorted by member count');
    console.log('- !addto used the unsorted cache order');
    console.log('- This caused group #6 to map to different groups!');
    console.log('\nThe fix:');
    console.log('- !addto now sorts groups by member count (same as !groups)');
    console.log('- Group numbers are now consistent between commands');
    console.log('- Using !addto 6 will now correctly target "IRREGULARCHAT: Space"');
    
  } catch (error) {
    console.error('Error reading cache:', error);
  }
}

main().catch(console.error);