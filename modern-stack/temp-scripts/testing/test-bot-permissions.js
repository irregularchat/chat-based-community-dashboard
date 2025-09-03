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

async function testMessageSending() {
    const message = `🤖 Bot permission test - ${new Date().toLocaleTimeString()}`;
    
    const command = JSON.stringify({
        jsonrpc: '2.0',
        method: 'send',
        params: {
            account: '+19108471202',
            groupId: COUNTER_UXV_GROUP,
            message: message
        },
        id: `test-message-${Date.now()}`
    });
    
    console.log(`📤 Testing message sending to Counter UXV...`);
    console.log(`   Message: "${message}"`);
    
    try {
        const result = await sendSignalCommand(command);
        
        if (result.error) {
            console.log(`❌ Message send error: ${result.error.message}`);
            return false;
        } else if (result.result !== undefined) {
            console.log(`✅ Message sent successfully`);
            return true;
        } else {
            console.log(`⚠️ Unclear response to message send`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Exception during message send: ${error.message}`);
        return false;
    }
}

async function testGroupUpdate() {
    // Try to update group description as a test of admin privileges
    const command = JSON.stringify({
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
            account: '+19108471202',
            groupId: COUNTER_UXV_GROUP,
            description: 'Test description update - verifying admin permissions'
        },
        id: `test-update-${Date.now()}`
    });
    
    console.log(`🔧 Testing group update permissions...`);
    
    try {
        const result = await sendSignalCommand(command);
        
        if (result.error) {
            console.log(`❌ Group update error: ${result.error.message}`);
            if (result.error.message.includes('not admin') || result.error.message.includes('permission')) {
                console.log(`🔑 This confirms: Bot does NOT have admin privileges!`);
            }
            return false;
        } else if (result.result !== undefined) {
            console.log(`✅ Group update successful - bot has admin privileges`);
            return true;
        } else {
            console.log(`⚠️ Unclear response to group update`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Exception during group update: ${error.message}`);
        return false;
    }
}

async function main() {
    console.log('🎯 Testing Bot Permissions in Counter UXV');
    console.log('=' + '='.repeat(45));
    
    console.log('\n1️⃣ Testing message sending permissions...');
    const canSendMessages = await testMessageSending();
    
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    
    console.log('\n2️⃣ Testing group admin permissions...');
    const hasAdminRights = await testGroupUpdate();
    
    console.log('\n📊 Permission Analysis:');
    console.log(`   Can send messages: ${canSendMessages ? '✅' : '❌'}`);
    console.log(`   Has admin rights: ${hasAdminRights ? '✅' : '❌'}`);
    
    if (!hasAdminRights) {
        console.log('\n💡 SOLUTION: Bot needs admin privileges restored!');
        console.log('   Ask an admin to add the bot (+19108471202) as admin in Counter UXV');
    } else {
        console.log('\n🤔 Bot has admin rights but group updates aren\'t working');
        console.log('   This suggests a different issue with the group operations');
    }
}

main();