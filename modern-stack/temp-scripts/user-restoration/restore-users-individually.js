const fs = require('fs');
const net = require('net');

const COUNTER_UXV_GROUP = 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=';
const SOCKET_PATH = '/tmp/signal-cli-socket';
const DELAY_BETWEEN_USERS = 3000; // 3 seconds between each user

// Read the cleaned removed users
const cleanedData = JSON.parse(fs.readFileSync('cleaned-removed-users.json', 'utf8'));

console.log(`🎯 Individual user restoration for Counter UXV group`);
console.log(`⏰ Original removal time: ${cleanedData.removalTime}`);
console.log(`👥 Users to restore: ${cleanedData.users.length}`);

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
            client.write(command + '\n');
        });
        
        client.on('data', (data) => {
            responseData += data.toString();
            
            // Look for complete JSON response with matching id
            if (responseData.includes('"jsonrpc":"2.0"') && responseData.includes('"id"')) {
                clearTimeout(timer);
                client.end();
                
                try {
                    // Extract the actual response
                    const lines = responseData.split('\n');
                    for (const line of lines) {
                        if (line.includes('"jsonrpc":"2.0"') && line.includes('"id"')) {
                            const response = JSON.parse(line.trim());
                            resolve({ response, rawData: responseData });
                            return;
                        }
                    }
                    resolve({ rawData: responseData });
                } catch (e) {
                    resolve({ rawData: responseData, parseError: e.message });
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

// Function to add a single user
async function addSingleUser(user, userIndex) {
    const command = JSON.stringify({
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
            account: '+19108471202',
            groupId: COUNTER_UXV_GROUP,
            addMembers: [user.identifier]
        },
        id: `individual-add-${userIndex}-${Date.now()}`
    });
    
    console.log(`\n${userIndex + 1}/${cleanedData.users.length} 👤 Adding: ${user.name}`);
    console.log(`   Identifier: ${user.identifier}`);
    console.log(`   Type: ${user.type}`);
    
    try {
        const result = await sendSignalCommand(command);
        
        if (result.response) {
            if (result.response.error) {
                console.log(`   ❌ Error: ${result.response.error.message}`);
                return { success: false, user, error: result.response.error.message };
            } else if (result.response.result !== undefined) {
                console.log(`   ✅ Signal CLI success (check logs for actual group update)`);
                return { success: true, user };
            }
        }
        
        console.log(`   ⚠️ Unclear response`);
        console.log(`   Raw: ${result.rawData?.substring(0, 200)}...`);
        return { success: false, user, error: 'Unclear response' };
        
    } catch (error) {
        console.log(`   ❌ Exception: ${error.message}`);
        return { success: false, user, error: error.message };
    }
}

// Main restoration function
async function restoreUsersIndividually() {
    const results = {
        total: cleanedData.users.length,
        successful: 0,
        failed: 0,
        errors: []
    };
    
    // Start with first 10 users as a test
    const testUsers = cleanedData.users.slice(0, 10);
    console.log(`\n📊 Testing with first ${testUsers.length} users:`);
    testUsers.forEach((user, i) => {
        console.log(`   ${i + 1}. ${user.name} (${user.identifier})`);
    });
    
    console.log(`\n🚀 Starting individual restoration...`);
    console.log(`⏰ Delay between users: ${DELAY_BETWEEN_USERS}ms`);
    
    for (let i = 0; i < testUsers.length; i++) {
        const user = testUsers[i];
        
        const result = await addSingleUser(user, i);
        
        if (result.success) {
            results.successful++;
        } else {
            results.failed++;
            results.errors.push({
                user: result.user,
                error: result.error
            });
        }
        
        // Delay between users (except for the last one)
        if (i < testUsers.length - 1) {
            console.log(`   ⏳ Waiting ${DELAY_BETWEEN_USERS/1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_USERS));
        }
    }
    
    console.log(`\n🏁 Test restoration complete!`);
    console.log(`📊 Results:`);
    console.log(`   Successful: ${results.successful}/${testUsers.length}`);
    console.log(`   Failed: ${results.failed}/${testUsers.length}`);
    console.log(`   Success rate: ${((results.successful / testUsers.length) * 100).toFixed(1)}%`);
    
    if (results.errors.length > 0) {
        console.log(`\n⚠️ Errors:`);
        results.errors.forEach((error, i) => {
            console.log(`   ${i + 1}. ${error.user.name}: ${error.error}`);
        });
    }
    
    console.log(`\n📋 Next Steps:`);
    console.log(`1. Check Counter UXV room - do you see any of these 10 users?`);
    console.log(`2. Check Signal daemon logs for actual group updates`);
    console.log(`3. If successful, run full restoration of all 321 users`);
    
    // Save test results
    const timestamp = new Date().toISOString();
    fs.writeFileSync(`individual-test-results-${timestamp.split('T')[0]}.json`, JSON.stringify({
        ...results,
        timestamp,
        testedUsers: testUsers
    }, null, 2));
    
    return results;
}

// Start the individual restoration
restoreUsersIndividually().catch(error => {
    console.error('💥 Fatal error during individual restoration:', error);
    process.exit(1);
});