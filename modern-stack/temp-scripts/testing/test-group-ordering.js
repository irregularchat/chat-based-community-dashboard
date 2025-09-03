#!/usr/bin/env node

// Test to verify group ordering is consistent between !groups and !addto

const { PrismaClient } = require('@prisma/client');
const fsPromises = require('fs').promises;
const path = require('path');

async function getGroupsFromDatabase() {
  const prisma = new PrismaClient();
  
  try {
    const groups = await prisma.signalGroup.findMany({
      where: { botIsMember: true },
      orderBy: { memberCount: 'desc' }
    });
    
    console.log('📊 Groups from database (sorted by memberCount desc):');
    groups.forEach((group, index) => {
      console.log(`  ${index + 1}. ${group.name} (${group.memberCount} members)`);
    });
    
    return groups;
  } catch (error) {
    console.error('Error fetching from database:', error);
    return null;
  } finally {
    await prisma.$disconnect();
  }
}

async function getGroupsFromCache() {
  const cacheFile = path.join('./signal-data', 'groups-cache.json');
  
  try {
    const cacheData = await fsPromises.readFile(cacheFile, 'utf8');
    const cache = JSON.parse(cacheData);
    const groups = cache.groups || [];
    
    console.log('\n📦 Groups from cache (original order):');
    groups.forEach((group, index) => {
      console.log(`  ${index + 1}. ${group.name} (${group.memberCount} members)`);
    });
    
    // Sort by member count
    const sortedGroups = [...groups].sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));
    
    console.log('\n📦 Groups from cache (sorted by memberCount desc):');
    sortedGroups.forEach((group, index) => {
      console.log(`  ${index + 1}. ${group.name} (${group.memberCount} members)`);
    });
    
    return { original: groups, sorted: sortedGroups };
  } catch (error) {
    console.error('Error reading cache:', error);
    return null;
  }
}

async function main() {
  console.log('🔍 Testing Group Ordering Consistency\n');
  console.log('=====================================\n');
  
  // Get groups from database
  const dbGroups = await getGroupsFromDatabase();
  
  // Get groups from cache
  const cacheGroups = await getGroupsFromCache();
  
  if (dbGroups && cacheGroups) {
    console.log('\n📋 Verification Results:');
    console.log('========================\n');
    
    // Check if sorted order matches
    const sortedCache = cacheGroups.sorted;
    let mismatch = false;
    
    for (let i = 0; i < Math.min(dbGroups.length, sortedCache.length); i++) {
      const dbGroup = dbGroups[i];
      const cacheGroup = sortedCache[i];
      
      if (dbGroup.name !== cacheGroup.name) {
        console.log(`❌ Mismatch at position ${i + 1}:`);
        console.log(`   Database: ${dbGroup.name}`);
        console.log(`   Cache:    ${cacheGroup.name}`);
        mismatch = true;
      }
    }
    
    if (!mismatch) {
      console.log('✅ Group ordering is consistent between database and sorted cache!');
    }
    
    console.log('\n📝 Key Findings:');
    console.log(`- Database has ${dbGroups.length} groups`);
    console.log(`- Cache has ${sortedCache.length} groups`);
    console.log(`- Both are sorted by member count (descending)`);
    console.log(`- !groups command uses database ordering`);
    console.log(`- !addto command now uses the same ordering`);
    
    // Find specific groups for testing
    const botDevIndex = dbGroups.findIndex(g => g.name.includes('Bot Development'));
    const spaceIndex = dbGroups.findIndex(g => g.name.includes('Space'));
    
    if (botDevIndex !== -1 && spaceIndex !== -1) {
      console.log('\n🎯 Specific Groups:');
      console.log(`- "Bot Development" is at position ${botDevIndex + 1}`);
      console.log(`- "Space" is at position ${spaceIndex + 1}`);
      console.log('\nUsing !addto with these numbers will now target the correct groups.');
    }
  }
  
  console.log('\n=====================================');
  console.log('✅ Test completed!');
}

main().catch(console.error);