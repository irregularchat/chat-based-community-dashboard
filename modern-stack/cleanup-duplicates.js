require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('./src/generated/prisma');

const prisma = new PrismaClient();

async function cleanupDuplicates() {
  try {
    console.log('🔍 Finding duplicate messages...');
    
    // Get all messages and group by the composite key
    const messages = await prisma.signalMessage.findMany({
      orderBy: { createdAt: 'asc' }
    });
    
    console.log(`Found ${messages.length} total messages`);
    
    // Group by timestamp, sourceNumber, groupId
    const grouped = {};
    const duplicatesToDelete = [];
    
    messages.forEach(msg => {
      const key = `${msg.timestamp}_${msg.sourceNumber}_${msg.groupId}`;
      
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(msg);
    });
    
    // Find duplicates (keep the first one, delete the rest)
    Object.entries(grouped).forEach(([key, msgs]) => {
      if (msgs.length > 1) {
        console.log(`Found ${msgs.length} duplicates for key: ${key}`);
        // Keep the first one, delete the rest
        duplicatesToDelete.push(...msgs.slice(1));
      }
    });
    
    console.log(`Found ${duplicatesToDelete.length} duplicates to delete`);
    
    if (duplicatesToDelete.length > 0) {
      console.log('🗑️ Deleting duplicates...');
      const deleteIds = duplicatesToDelete.map(msg => msg.id);
      
      await prisma.signalMessage.deleteMany({
        where: {
          id: {
            in: deleteIds
          }
        }
      });
      
      console.log(`✅ Deleted ${duplicatesToDelete.length} duplicate messages`);
    } else {
      console.log('✅ No duplicates found');
    }
    
  } catch (error) {
    console.error('❌ Error cleaning up duplicates:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupDuplicates();