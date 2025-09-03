const net = require('net');
const fs = require('fs');

// Read one user from our cleaned list
const cleanedData = JSON.parse(fs.readFileSync('cleaned-removed-users.json', 'utf8'));
const testUser = cleanedData.users[0]; // First user: "John K"

console.log(`🧪 Testing manual addition of single user: ${testUser.name} (${testUser.identifier})`);

const COUNTER_UXV_GROUP = 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=';
const SOCKET_PATH = '/tmp/signal-cli-socket';

function sendSignalCommand(command, timeout = 30000) {
    return new Promise((resolve, reject) => {
        const client = net.createConnection(SOCKET_PATH);
        
        const timer = setTimeout(() => {
            client.destroy();
            reject(new Error(`Timeout after ${timeout}ms`));
        }, timeout);
        
        let responseData = '';
        
        client.on('connect', () => {
            console.log(`📡 Sending: ${command.substring(0, 100)}...`);
            client.write(command + '\n');
        });
        
        client.on('data', (data) => {
            responseData += data.toString();
            console.log(`📥 Raw response: ${responseData}`);
            
            // Look for complete JSON response
            if (responseData.includes('"jsonrpc":"2.0"') && responseData.includes('"id"')) {
                clearTimeout(timer);
                client.end();
                
                try {
                    // Extract the actual response
                    const lines = responseData.split('\n');
                    for (const line of lines) {
                        if (line.includes('"jsonrpc":"2.0"') && line.includes('"id"')) {
                            const response = JSON.parse(line.trim());
                            resolve(response);
                            return;
                        }
                    }
                    resolve({ rawResponse: responseData });
                } catch (e) {
                    console.log(`❌ Parse error: ${e.message}`);
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

async function testSingleUserAdd() {
    const command = JSON.stringify({
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
            account: '+19108471202',
            groupId: COUNTER_UXV_GROUP,
            addMembers: [testUser.identifier]
        },
        id: `test-add-${Date.now()}`
    });
    
    try {
        console.log(`\n🔄 Adding ${testUser.name} to Counter UXV...`);
        const result = await sendSignalCommand(command);
        
        console.log(`\n📊 Result:`, JSON.stringify(result, null, 2));
        
        if (result.error) {
            console.log(`❌ Error: ${result.error.message}`);
            return false;
        } else if (result.result !== undefined) {
            console.log(`✅ Successfully sent add request for ${testUser.name}`);
            return true;
        } else {
            console.log(`⚠️ Unclear response - check logs manually`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Exception: ${error.message}`);
        return false;
    }
}

async function main() {
    console.log('\n🎯 Manual Single User Addition Test');
    console.log('=' + '='.repeat(40));
    
    const success = await testSingleUserAdd();
    
    console.log('\n📋 Next steps:');
    console.log('1. Check the Counter UXV room to see if the user appeared');
    console.log('2. Check Signal daemon logs for any group update operations');
    console.log('3. If not working, investigate group permissions or IDs');
    
    process.exit(success ? 0 : 1);
}

main();