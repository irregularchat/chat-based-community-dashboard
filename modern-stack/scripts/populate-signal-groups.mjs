#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function populateSignalGroups() {
  console.log('🔄 Starting Signal Groups population...');

  try {
    // Sample Signal Groups data
    const signalGroups = [
      {
        groupId: 'group_1_tech_discussion',
        name: '💻 Tech Discussion',
        description: 'General technology discussion and news',
        isPublic: true,
        requiresApproval: false,
        displayOrder: 1,
        maxMembers: 100
      },
      {
        groupId: 'group_2_project_announcements',
        name: '📢 Project Announcements',
        description: 'Important project updates and announcements',
        isPublic: true,
        requiresApproval: false,
        displayOrder: 2,
        maxMembers: 250
      },
      {
        groupId: 'group_3_dev_team',
        name: '🛠️ Development Team',
        description: 'Core development team collaboration',
        isPublic: true,
        requiresApproval: true,
        displayOrder: 3,
        maxMembers: 25
      },
      {
        groupId: 'group_4_community_chat',
        name: '💬 Community Chat',
        description: 'General community discussion and socializing',
        isPublic: true,
        requiresApproval: false,
        displayOrder: 4,
        maxMembers: 500
      },
      {
        groupId: 'group_5_moderators',
        name: '🛡️ Moderators',
        description: 'Private moderator coordination channel',
        isPublic: false,
        requiresApproval: true,
        displayOrder: 5,
        maxMembers: 10
      },
      {
        groupId: 'group_6_beta_testing',
        name: '🧪 Beta Testing',
        description: 'Beta feature testing and feedback',
        isPublic: true,
        requiresApproval: true,
        displayOrder: 6,
        maxMembers: 50
      }
    ];

    // Get first admin user to assign as group admin
    const firstAdmin = await prisma.user.findFirst({
      where: { isAdmin: true }
    });

    console.log(`👤 Found admin user: ${firstAdmin ? firstAdmin.username || firstAdmin.id : 'None'}`);

    // Insert or update groups
    for (const group of signalGroups) {
      const existingGroup = await prisma.signalAvailableGroup.findUnique({
        where: { groupId: group.groupId }
      });

      if (existingGroup) {
        console.log(`⚠️  Group ${group.name} already exists, skipping...`);
        continue;
      }

      const createdGroup = await prisma.signalAvailableGroup.create({
        data: {
          ...group,
          adminUserId: firstAdmin?.id || null
        }
      });

      console.log(`✅ Created Signal group: ${createdGroup.name} (ID: ${createdGroup.groupId})`);
    }

    // Summary
    const totalGroups = await prisma.signalAvailableGroup.count();
    const publicGroups = await prisma.signalAvailableGroup.count({
      where: { isPublic: true, isActive: true }
    });
    const approvalRequiredGroups = await prisma.signalAvailableGroup.count({
      where: { requiresApproval: true, isActive: true }
    });

    console.log('\n📊 Signal Groups Summary:');
    console.log(`   Total Groups: ${totalGroups}`);
    console.log(`   Public Groups: ${publicGroups}`);
    console.log(`   Approval Required: ${approvalRequiredGroups}`);
    console.log(`   Private Groups: ${totalGroups - publicGroups}`);

    console.log('\n🎯 Signal Groups Setup Complete!');
    console.log('Users can now discover and join Signal groups through the dashboard.');

  } catch (error) {
    console.error('❌ Error populating Signal groups:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the population script
populateSignalGroups();