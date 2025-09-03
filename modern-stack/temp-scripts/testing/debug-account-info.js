#!/usr/bin/env node

const net = require('net');

const socketPath = '/tmp/signal-cli-socket';

function sendCommand(command, description) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let responseData = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log(`⚠️ ${description} timed out`);
        resolve({ timeout: true });
      }
    }, 15000);
    
    socket.connect(socketPath, () => {
      console.log(`📡 ${description}...`);
      socket.write(JSON.stringify(command) + '\n');
    });
    
    socket.on('data', (data) => {
      responseData += data.toString();
      
      if (responseData.includes('"jsonrpc":"2.0"') && responseData.includes(`"id":"${command.id}"`)) {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          socket.destroy();
          
          try {
            const lines = responseData.split('\n');
            for (const line of lines) {
              if (line.includes('"jsonrpc":"2.0"') && line.includes(`"id":"${command.id}"`)) {
                const response = JSON.parse(line.trim());
                resolve(response);
                return;
              }
            }
            resolve({ rawResponse: responseData });
          } catch (e) {
            resolve({ rawResponse: responseData, parseError: e.message });
          }
        }
      }
    });
    
    socket.on('error', (error) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        reject(error);
      }
    });
  });
}

async function debugAccountInfo() {
  console.log('🔍 Debugging Signal CLI Account Configuration');
  console.log('=' + '='.repeat(45));
  
  // Test 1: Try to list all accounts
  console.log('1️⃣ Listing all accounts configured in Signal CLI:');
  try {
    const result = await sendCommand({
      jsonrpc: '2.0',
      method: 'listAccounts',
      params: {},
      id: 'list-accounts-test'
    }, 'Listing all accounts');
    
    if (result.result) {
      console.log('   📱 Available accounts:');
      result.result.forEach((account, i) => {
        console.log(`      ${i + 1}. ${account}`);
      });
    } else if (result.error) {
      console.log(`   ❌ Error: ${result.error.message}`);
    } else {
      console.log(`   ⚠️ Unexpected response: ${JSON.stringify(result, null, 2)}`);
    }
  } catch (e) {
    console.log(`   ❌ Exception: ${e.message}`);
  }
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test 2: Send a message to a different group to verify account works
  console.log('\n2️⃣ Testing account by sending a message to Counter UXV:');
  
  const testAccounts = ['+19108471202', '+15623778014']; // Try both accounts we've seen
  
  for (const account of testAccounts) {
    console.log(`\n   Testing account: ${account}`);
    try {
      const result = await sendCommand({
        jsonrpc: '2.0',
        method: 'send',
        params: {
          account: account,
          groupId: 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=',
          message: `🔧 DEBUG: Testing account ${account} at ${new Date().toLocaleTimeString()}`
        },
        id: `test-account-${account.replace('+', '')}`
      }, `Sending test message with ${account}`);
      
      if (result.result !== undefined) {
        console.log(`      ✅ Account ${account} can send messages`);
      } else if (result.error) {
        console.log(`      ❌ Account ${account} error: ${result.error.message}`);
      } else {
        console.log(`      ⚠️ Account ${account} unclear response`);
      }
    } catch (e) {
      console.log(`      ❌ Account ${account} exception: ${e.message}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n📋 Analysis:');
  console.log('- Check Counter UXV for debug messages to see which account actually works');
  console.log('- We need to identify the correct account that has group admin privileges');
  console.log('- Once we have the right account, group operations should work');
}

debugAccountInfo().catch(console.error);