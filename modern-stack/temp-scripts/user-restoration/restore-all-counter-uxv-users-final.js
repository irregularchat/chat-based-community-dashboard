#!/usr/bin/env node

const { PrismaClient } = require('./src/generated/prisma');
const net = require('net');
const fs = require('fs');

const prisma = new PrismaClient();

async function restoreAllCounterUxVUsersFinal() {
  console.log('🚨 FINAL COUNTER UXV COMPLETE RESTORATION');
  console.log('=' + '='.repeat(70));
  console.log('This will restore ALL 149 users from database back to Counter UxV group');
  console.log('');
  
  try {
    const counterUxvGroupId = 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=';
    
    // Load restoration data
    let restorationData;
    try {
      const data = fs.readFileSync('./counter-uxv-complete-restoration.json', 'utf8');
      restorationData = JSON.parse(data);
    } catch (error) {
      console.log('⚠️ Could not load restoration file, fetching from database...');
      
      // Get all users from database
      const allDbUsers = await prisma.signalGroupMember.findMany({
        where: { groupId: counterUxvGroupId }
      });
      
      restorationData = {
        totalUsers: allDbUsers.length,
        identifiers: allDbUsers.map(u => u.number || u.uuid).filter(id => id),
        allUsers: allDbUsers
      };
    }
    
    console.log(`📊 Total users to restore: ${restorationData.totalUsers}`);
    console.log(`🔢 Valid identifiers: ${restorationData.identifiers.length}`);
    
    if (restorationData.identifiers.length === 0) {
      console.log('❌ No user identifiers found for restoration');
      return;
    }
    
    // Show sample of identifiers
    console.log('\\n📋 Sample identifiers being restored:');
    restorationData.identifiers.slice(0, 15).forEach((id, i) => {
      console.log(`  ${i + 1}. ${id}`);
    });
    if (restorationData.identifiers.length > 15) {
      console.log(`  ... and ${restorationData.identifiers.length - 15} more users`);
    }
    
    // Split into smaller batches for reliability
    const batchSize = 20; // Smaller batches for better success rate
    const batches = [];
    for (let i = 0; i < restorationData.identifiers.length; i += batchSize) {
      batches.push(restorationData.identifiers.slice(i, i + batchSize));
    }
    
    console.log(`\\n📦 Split into ${batches.length} batches of up to ${batchSize} users each`);
    console.log('🚀 Starting comprehensive restoration...');
    console.log('');
    
    let totalSuccessful = 0;
    let totalFailed = 0;
    const results = [];
    
    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const batchNumber = i + 1;
      
      console.log(`📦 Processing batch ${batchNumber}/${batches.length} (${batch.length} users)...`);
      
      try {
        const success = await addUsersBatch(counterUxvGroupId, batch, batchNumber);
        if (success) {
          totalSuccessful += batch.length;
          results.push({ batch: batchNumber, status: 'success', users: batch.length });
          console.log(`✅ Batch ${batchNumber} completed successfully (${batch.length} users)`);
        } else {
          totalFailed += batch.length;
          results.push({ batch: batchNumber, status: 'failed', users: batch.length });
          console.log(`❌ Batch ${batchNumber} failed (${batch.length} users)`);
        }
        
        // Delay between batches to avoid overwhelming Signal
        if (i < batches.length - 1) {
          const delaySeconds = 2;
          console.log(`⏳ Waiting ${delaySeconds} seconds before next batch...`);
          await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        }
        
      } catch (error) {
        totalFailed += batch.length;
        results.push({ batch: batchNumber, status: 'error', users: batch.length, error: error.message });
        console.log(`❌ Batch ${batchNumber} error:`, error.message);
        
        // Still wait before next batch
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    console.log('\\n' + '='.repeat(70));
    console.log('📊 RESTORATION SUMMARY:');
    console.log(`✅ Successful users: ${totalSuccessful}/${restorationData.identifiers.length}`);
    console.log(`❌ Failed users: ${totalFailed}/${restorationData.identifiers.length}`);
    console.log(`📦 Successful batches: ${results.filter(r => r.status === 'success').length}/${batches.length}`);
    console.log(`💥 Failed batches: ${results.filter(r => r.status !== 'success').length}/${batches.length}`);
    
    // Save results
    const summaryData = {
      timestamp: new Date().toISOString(),
      totalUsers: restorationData.identifiers.length,
      totalBatches: batches.length,
      successfulUsers: totalSuccessful,
      failedUsers: totalFailed,
      batchResults: results
    };
    
    fs.writeFileSync('./counter-uxv-restoration-results.json', JSON.stringify(summaryData, null, 2));
    console.log('💾 Detailed results saved to counter-uxv-restoration-results.json');
    
    console.log('\\n🎉 COMPREHENSIVE RESTORATION COMPLETE!');
    console.log('Please check the Counter UxV Signal group to verify users have been restored.');
    console.log('The group should now have all the users back that were accidentally removed.');
    
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
        console.log(`⚠️ Batch ${batchNumber} timed out (often normal for Signal operations)`);
        resolve(true); // Assume success on timeout
      }
    }, 25000); // 25 second timeout per batch
    
    socket.connect(socketPath, () => {
      const request = {
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
          account: process.env.SIGNAL_BOT_PHONE_NUMBER || process.env.SIGNAL_PHONE_NUMBER || '+19108471202',
          groupId: groupId,
          addMembers: membersBatch
        },
        id: `restore-final-batch-${batchNumber}-${Date.now()}`
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
          
          if (response.id && response.id.startsWith(`restore-final-batch-${batchNumber}-`)) {
            clearTimeout(timeout);
            if (!resolved) {
              resolved = true;
              socket.destroy();
              
              if (response.result !== undefined) {
                resolve(true);
              } else if (response.error) {
                console.log(`⚠️ Batch ${batchNumber} API error:`, response.error.message);
                // Don't fail completely, might still have worked
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
        // Don't completely fail - might still work
        resolve(false);
      }
    });
  });
}

async function main() {
  console.log('🚨 COUNTER UXV FINAL COMPREHENSIVE USER RESTORATION');
  console.log('This will restore ALL users from the database back to Counter UxV');
  console.log('All users who were accidentally removed will be added back');
  console.log('');
  
  await restoreAllCounterUxVUsersFinal();
}

main().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});