const net = require('net');

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

async function listGroups() {
    const command = JSON.stringify({
        jsonrpc: '2.0',
        method: 'listGroups',
        params: {
            account: '+19108471202'
        },
        id: `list-groups-${Date.now()}`
    });
    
    try {
        console.log(`\n🔍 Listing all Signal groups...`);
        const result = await sendSignalCommand(command);
        
        console.log(`\n📊 Raw result:`, JSON.stringify(result, null, 2));
        
        if (result.result && Array.isArray(result.result)) {
            console.log(`\n📋 Found ${result.result.length} groups:`);
            result.result.forEach((group, i) => {
                console.log(`\n${i + 1}. ${group.name || 'Unnamed Group'}`);
                console.log(`   ID: ${group.id}`);
                console.log(`   Members: ${group.members?.length || 0}`);
                console.log(`   Active: ${group.active}`);
                console.log(`   Admin: ${group.admin}`);
                console.log(`   Blocked: ${group.blocked}`);
                
                if (group.name && group.name.toLowerCase().includes('counter')) {
                    console.log(`   🎯 THIS IS COUNTER UXV GROUP!`);
                }
            });
        } else if (result.error) {
            console.log(`❌ Error: ${result.error.message}`);
        } else {
            console.log(`⚠️ Unexpected response format`);
        }
    } catch (error) {
        console.log(`❌ Exception: ${error.message}`);
    }
}

async function main() {
    console.log('🎯 Signal Groups List');
    console.log('=' + '='.repeat(20));
    
    await listGroups();
}

main();