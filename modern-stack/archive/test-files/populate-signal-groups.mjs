#!/usr/bin/env node

/**
 * Populate Signal Available Groups for testing
 * Run with: node populate-signal-groups.mjs
 */

import { PrismaClient } from './src/generated/prisma/index.js';

const prisma = new PrismaClient();

const sampleGroups = [
  {
    groupId: 'group.L2NqZm1JN3NuQUFoUlBMRE1sdlc1MEphOG',
    groupName: 'Solo testing',
    description: 'Test group for solo testing Signal functionality',
    isPublic: true,
    requiresApproval: false,
    memberCount: 3,
    displayOrder: 1
  },
  {
    groupId: 'group.NlBQL2kwSkJsWHBBZStka3h2SDY0WkttT1',
    groupName: 'IrregularChat Bot Development',
    description: 'Development and testing group for IrregularChat bots and automation',
    isPublic: true,
    requiresApproval: true,
    memberCount: 20,
    displayOrder: 2
  },
  {
    groupId: 'group.community-general',
    groupName: 'Community General',
    description: 'Main community group for general discussions and announcements',
    isPublic: true,
    requiresApproval: false,
    memberCount: 45,
    displayOrder: 3
  },
  {
    groupId: 'group.tech-talk',
    groupName: 'Tech Talk',
    description: 'Technology discussions, programming, and development topics',
    isPublic: true,
    requiresApproval: false,
    memberCount: 28,
    displayOrder: 4
  },
  {
    groupId: 'group.veterans-support',
    groupName: 'Veterans Support',
    description: 'Support group for veterans and service members',
    isPublic: true,
    requiresApproval: true,
    memberCount: 15,
    displayOrder: 5
  },
  {
    groupId: 'group.moderation-team',
    groupName: 'Moderation Team',
    description: 'Private group for community moderators',
    isPublic: false,
    requiresApproval: true,
    memberCount: 8,
    displayOrder: 10
  }
];

async function populateGroups() {
  console.log('🔄 Populating Signal available groups...');
  
  try {
    // Use upsert to avoid duplicates
    for (const group of sampleGroups) {
      await prisma.signalAvailableGroup.upsert({
        where: { groupId: group.groupId },
        update: {
          groupName: group.groupName,
          description: group.description,
          memberCount: group.memberCount,
          displayOrder: group.displayOrder
        },
        create: group
      });
      
      console.log(`✅ Added/Updated: ${group.groupName}`);
    }
    
    console.log(`\n🎉 Successfully populated ${sampleGroups.length} Signal groups!`);
    
    // Display current groups
    const allGroups = await prisma.signalAvailableGroup.findMany({
      orderBy: [{ displayOrder: 'asc' }, { groupName: 'asc' }]
    });
    
    console.log('\n📋 Current Signal Groups:');
    allGroups.forEach(group => {
      const status = group.isPublic ? '🌐 Public' : '🔒 Private';
      const approval = group.requiresApproval ? '✋ Requires Approval' : '🚀 Auto-Join';
      console.log(`  ${group.groupName} (${group.memberCount} members) - ${status}, ${approval}`);
    });
    
  } catch (error) {
    console.error('❌ Error populating groups:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

populateGroups();