const fs = require('fs');
const net = require('net');

const COUNTER_UXV_GROUP = 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=';
const SOCKET_PATH = '/tmp/signal-cli-socket';
const BATCH_SIZE = 30;
const BATCH_DELAY = 5000; // 5 seconds between batches

// Read the cleaned removed users
const cleanedData = JSON.parse(fs.readFileSync('cleaned-removed-users.json', 'utf8'));
const usersToRestore = cleanedData.users;

console.log(`🎯 Starting restoration of ${usersToRestore.length} actual removed users to Counter UXV group`);
console.log(`⏰ Removal timestamp: ${cleanedData.removalTime}`);

// Helper function to send commands to Signal CLI
function sendSignalCommand(command, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const client = net.createConnection(SOCKET_PATH);
        
        const timer = setTimeout(() => {
            client.destroy();
            reject(new Error(`Timeout after ${timeout}ms`));
        }, timeout);
        
        let responseData = '';
        
        client.on('connect', () => {
            console.log(`📡 Sending command: ${command.substring(0, 100)}...`);
            client.write(command + '\n');
        });
        
        client.on('data', (data) => {
            responseData += data.toString();
            
            // Look for complete JSON response
            if (responseData.includes('"jsonrpc":"2.0"')) {
                clearTimeout(timer);
                client.end();
                
                try {
                    const response = JSON.parse(responseData.trim());
                    resolve(response);
                } catch (e) {
                    console.log(`Raw response: ${responseData}`);
                    resolve({ rawResponse: responseData });
                }
            }
        });
        
        client.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
        
        client.on('close', () => {
            clearTimeout(timer);
            if (!responseData) {
                reject(new Error('Connection closed without response'));
            }
        });
    });
}

// Function to add a batch of users
async function addUserBatch(users, batchNumber) {
    const identifiers = users.map(u => u.identifier);
    
    console.log(`\n📦 Batch ${batchNumber}: Adding ${users.length} users`);
    console.log(`   Users: ${users.map(u => u.name).join(', ')}`);
    
    const command = JSON.stringify({
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
            account: '+19108471202',
            groupId: COUNTER_UXV_GROUP,
            addMembers: identifiers
        },
        id: `batch-${batchNumber}-${Date.now()}`
    });
    
    try {
        const result = await sendSignalCommand(command);
        
        if (result.error) {
            console.log(`❌ Batch ${batchNumber} error:`, result.error);
            return { success: false, error: result.error, users };
        } else {
            console.log(`✅ Batch ${batchNumber} completed successfully`);
            return { success: true, users };
        }
    } catch (error) {
        console.log(`❌ Batch ${batchNumber} exception:`, error.message);
        return { success: false, error: error.message, users };
    }
}

// Main restoration function
async function restoreUsers() {
    const results = {
        total: usersToRestore.length,
        successful: 0,
        failed: 0,
        errors: []
    };
    
    // Split users into batches
    const batches = [];
    for (let i = 0; i < usersToRestore.length; i += BATCH_SIZE) {
        batches.push(usersToRestore.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`\n📊 Processing ${usersToRestore.length} users in ${batches.length} batches of ${BATCH_SIZE}`);
    
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNumber = i + 1;
        
        const result = await addUserBatch(batch, batchNumber);
        
        if (result.success) {
            results.successful += batch.length;
            console.log(`✅ Batch ${batchNumber}/${batches.length}: ${batch.length} users added successfully`);
        } else {
            results.failed += batch.length;
            results.errors.push({
                batch: batchNumber,
                users: result.users,
                error: result.error
            });
            console.log(`❌ Batch ${batchNumber}/${batches.length}: Failed to add ${batch.length} users`);
        }
        
        // Delay between batches (except for the last one)
        if (i < batches.length - 1) {
            console.log(`⏳ Waiting ${BATCH_DELAY/1000} seconds before next batch...`);
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
    }
    
    // Save detailed results
    const finalResults = {
        ...results,
        timestamp: new Date().toISOString(),
        removalTimestamp: cleanedData.removalTimestamp,
        removalTime: cleanedData.removalTime,
        restorationSummary: {
            totalUsers: usersToRestore.length,
            phoneNumbers: usersToRestore.filter(u => u.type === 'phone').length,
            uuids: usersToRestore.filter(u => u.type === 'uuid').length,
            successfullyRestored: results.successful,
            failedToRestore: results.failed,
            successRate: `${((results.successful / usersToRestore.length) * 100).toFixed(1)}%`
        }
    };
    
    fs.writeFileSync('restoration-results.json', JSON.stringify(finalResults, null, 2));
    
    console.log(`\n🏁 RESTORATION COMPLETE!`);
    console.log(`📊 Summary:`);
    console.log(`   Total users: ${results.total}`);
    console.log(`   Successfully restored: ${results.successful}`);
    console.log(`   Failed to restore: ${results.failed}`);
    console.log(`   Success rate: ${finalResults.restorationSummary.successRate}`);
    console.log(`\n📄 Detailed results saved to: restoration-results.json`);
    
    if (results.errors.length > 0) {
        console.log(`\n⚠️  Errors encountered:`);
        results.errors.forEach(error => {
            console.log(`   Batch ${error.batch}: ${error.error}`);
        });
    }
    
    return finalResults;
}

// Start the restoration
restoreUsers().catch(error => {
    console.error('💥 Fatal error during restoration:', error);
    process.exit(1);
});