#!/usr/bin/env node

const { spawn } = require('child_process');
const net = require('net');

// Function to send JSON-RPC request and get response
function sendJsonRpcRequest(request) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    socket.connect(socketPath, () => {
      socket.write(JSON.stringify(request) + '\n');
    });
    
    let responseData = '';
    socket.on('data', (data) => {
      responseData += data.toString();
    });
    
    socket.on('end', () => {
      try {
        const response = JSON.parse(responseData);
        resolve(response);
      } catch (error) {
        reject(error);
      }
    });
    
    socket.on('error', reject);
    
    // Timeout after 30 seconds
    setTimeout(() => {
      socket.destroy();
      reject(new Error('Request timeout'));
    }, 30000);
  });
}

async function compareGroups() {
  try {
    console.log('🔍 Fetching group data...');
    
    const request = {
      jsonrpc: '2.0',
      method: 'listGroups',
      params: {
        account: '+19108471202',
        'get-members': true
      },
      id: 'compare-groups'
    };
    
    const response = await sendJsonRpcRequest(request);
    
    if (!response.result) {
      console.error('❌ No groups data received');
      return;
    }
    
    // Find the groups
    const botDevGroup = response.result.find(g => g.name === 'IrregularChat Bot Development');
    const spaceGroup = response.result.find(g => g.name === 'IRREGULARCHAT: Space');
    
    if (!botDevGroup) {
      console.error('❌ Bot Development group not found');
      return;
    }
    
    if (!spaceGroup) {
      console.error('❌ Space group not found');
      return;
    }
    
    console.log(`📊 Bot Development: ${botDevGroup.members.length} members`);
    console.log(`📊 Space: ${spaceGroup.members.length} members`);
    
    // Create sets for comparison
    const spaceUuids = new Set(spaceGroup.members.map(m => m.uuid));
    const botDevMembers = botDevGroup.members;
    
    // Find users in Bot Development but NOT in Space
    const usersNotInSpace = botDevMembers.filter(member => !spaceUuids.has(member.uuid));
    
    // Exclude the bot itself
    const usersToAdd = usersNotInSpace.filter(member => member.uuid !== 'd6292870-2d4f-43a1-89fe-d63791ca104d');
    
    console.log(`\n🎯 Found ${usersToAdd.length} users in Bot Development who are NOT in Space:`);
    console.log('='*60);
    
    // Take first 10 for testing
    const testUsers = usersToAdd.slice(0, 10);
    
    testUsers.forEach((user, index) => {
      console.log(`${index + 1}. UUID: ${user.uuid}`);
      if (user.number) {
        console.log(`   Phone: ${user.number}`);
      }
      console.log('');
    });
    
    // Save results for testing
    const testData = {
      botDevGroupId: botDevGroup.id,
      spaceGroupId: spaceGroup.id,
      testUsers: testUsers.map(u => ({
        uuid: u.uuid,
        number: u.number
      }))
    };
    
    require('fs').writeFileSync('./test-users.json', JSON.stringify(testData, null, 2));
    console.log('💾 Test data saved to test-users.json');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

compareGroups();