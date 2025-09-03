const net = require('net');

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
            console.log(`📡 Sending command...`);
            client.write(command + '\n');
        });
        
        client.on('data', (data) => {
            responseData += data.toString();
            
            // Look for complete JSON response
            if (responseData.includes('"jsonrpc":"2.0"') && responseData.includes('"id"')) {
                clearTimeout(timer);
                client.end();
                
                try {
                    // Try to parse the response
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
                    console.log(`Parse error: ${e.message}`);
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

async function checkGroupInfo() {
    const command = JSON.stringify({
        jsonrpc: '2.0',
        method: 'getGroup',
        params: {
            account: '+19108471202',
            groupId: COUNTER_UXV_GROUP
        },
        id: `check-group-${Date.now()}`
    });
    
    try {
        console.log(`🔍 Checking Counter UXV group information...`);
        const result = await sendSignalCommand(command);
        
        console.log(`\n📊 Group Information:`);
        
        if (result.result) {
            const group = result.result;
            console.log(`   Name: ${group.name || 'Unknown'}`);
            console.log(`   ID: ${group.id}`);
            console.log(`   Active: ${group.active}`);
            console.log(`   Blocked: ${group.blocked}`);
            console.log(`   Member count: ${group.members ? group.members.length : 'Unknown'}`);
            
            // Check if bot is admin
            const botAccount = '+19108471202';
            if (group.admins && Array.isArray(group.admins)) {
                const isBotAdmin = group.admins.some(admin => 
                    admin === botAccount || admin.number === botAccount
                );
                console.log(`   🤖 Bot is admin: ${isBotAdmin ? '✅ YES' : '❌ NO'}`);
                
                if (group.admins.length > 0) {
                    console.log(`   👑 Admins (${group.admins.length}):`)
                    group.admins.forEach((admin, i) => {
                        const adminId = typeof admin === 'string' ? admin : (admin.number || admin.uuid || admin);
                        console.log(`      ${i + 1}. ${adminId}`);
                    });
                }
            } else {
                console.log(`   ⚠️ Admin information not available`);
            }
            
            return group;
            
        } else if (result.error) {
            console.log(`❌ Error: ${result.error.message}`);
        } else {
            console.log(`⚠️ Unexpected response format`);
            console.log(`Raw response: ${result.rawResponse?.substring(0, 500)}...`);
        }
        
    } catch (error) {
        console.log(`❌ Exception: ${error.message}`);
    }
}

async function main() {
    console.log('🎯 Checking Bot Admin Status in Counter UXV');
    console.log('=' + '='.repeat(45));
    
    await checkGroupInfo();
    
    console.log('\n📋 Analysis:');
    console.log('If bot is NOT admin, that explains why users aren\'t being added');
    console.log('If bot IS admin, there may be another issue with the group operations');
}

main();