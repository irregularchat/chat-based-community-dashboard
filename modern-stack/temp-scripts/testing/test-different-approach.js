#!/usr/bin/env node

const net = require('net');
const fs = require('fs');

const cleanedData = JSON.parse(fs.readFileSync('cleaned-removed-users.json', 'utf8'));
const testUser = cleanedData.users[0]; // "John K"

const counterUxvGroupId = 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=';
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

async function testDifferentMethods() {
  console.log('🔬 Testing Different Signal CLI Methods');
  console.log('=' + '='.repeat(40));
  console.log(`Test user: ${testUser.name} (${testUser.identifier})`);
  
  // Method 1: Try with both addMembers and addAdmins (like the working Sac example)
  console.log('\n1️⃣ Method 1: addMembers + addAdmins');
  try {
    const result1 = await sendCommand({
      jsonrpc: '2.0',
      method: 'updateGroup',
      params: {
        account: '+19108471202',
        groupId: counterUxvGroupId,
        addMembers: [testUser.identifier],
        addAdmins: [testUser.identifier] // Also add as admin like Sac
      },
      id: 'test-method-1'
    }, 'Adding user as member + admin');
    
    console.log(`   Result: ${result1.error ? '❌ ' + result1.error.message : result1.result !== undefined ? '✅ Success' : '⚠️ Unknown'}`);
  } catch (e) {
    console.log(`   ❌ Exception: ${e.message}`);
  }
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Method 2: Try with a different user (second from list)
  const testUser2 = cleanedData.users[1];
  console.log(`\n2️⃣ Method 2: Different user - ${testUser2.name}`);
  try {
    const result2 = await sendCommand({
      jsonrpc: '2.0',
      method: 'updateGroup',
      params: {
        account: '+19108471202',
        groupId: counterUxvGroupId,
        addMembers: [testUser2.identifier]
      },
      id: 'test-method-2'
    }, 'Adding different user as member only');
    
    console.log(`   Result: ${result2.error ? '❌ ' + result2.error.message : result2.result !== undefined ? '✅ Success' : '⚠️ Unknown'}`);
  } catch (e) {
    console.log(`   ❌ Exception: ${e.message}`);
  }
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // Method 3: Try sending a test message to verify group access
  console.log(`\n3️⃣ Method 3: Send test message to verify group access`);
  try {
    const result3 = await sendCommand({
      jsonrpc: '2.0',
      method: 'send',
      params: {
        account: '+19108471202',
        groupId: counterUxvGroupId,
        message: `🧪 Testing group access at ${new Date().toLocaleTimeString()}\nTrying to add users but they're not appearing. Admin verified.`
      },
      id: 'test-method-3'
    }, 'Sending test message to group');
    
    console.log(`   Result: ${result3.error ? '❌ ' + result3.error.message : result3.result !== undefined ? '✅ Message sent' : '⚠️ Unknown'}`);
  } catch (e) {
    console.log(`   ❌ Exception: ${e.message}`);
  }
  
  console.log(`\n📋 Next Steps:`);
  console.log(`1. Check Counter UXV group for both test users and the test message`);
  console.log(`2. If message appears but users don't, there's an issue with addMembers`);
  console.log(`3. If nothing appears, there may be a group ID or permissions issue`);
}

testDifferentMethods().catch(console.error);