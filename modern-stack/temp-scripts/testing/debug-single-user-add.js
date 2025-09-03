#!/usr/bin/env node

const net = require('net');

function debugSingleUserAdd() {
  return new Promise((resolve, reject) => {
    console.log('🔍 DEBUG: Adding a single user with full logging');
    
    const testUser = 'f1e2003a-db1d-4c6e-8d54-902c0c6af0ae';
    console.log('👤 Test user:', testUser);
    
    const socket = new net.Socket();
    const socketPath = '/tmp/signal-cli-socket';
    
    let responseData = '';
    let resolved = false;
    let responseCount = 0;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        console.log('\n⏰ Timeout reached after 45 seconds');
        console.log('📊 Total responses received:', responseCount);
        console.log('📏 Total data length:', responseData.length);
        resolve({ timeout: true, responses: responseCount });
      }
    }, 45000); // 45 second timeout
    
    socket.connect(socketPath, () => {
      console.log('✅ Socket connected');
      
      const request = {
        jsonrpc: '2.0',
        method: 'updateGroup',
        params: {
          account: '+19108471202',
          groupId: 'hBnM2KMgzgUp7J9VoKSMBkfxkCE8eSh+K8FjM07Lt+U=',
          addMembers: [testUser]
        },
        id: 'debug-add-single-' + Date.now()
      };
      
      console.log('📤 Sending request:', JSON.stringify(request, null, 2));
      socket.write(JSON.stringify(request) + '\n');
      console.log('✅ Request sent, waiting for response...');
    });
    
    socket.on('data', (data) => {
      responseCount++;
      const chunk = data.toString();
      responseData += chunk;
      
      console.log(`\n📥 Response ${responseCount}:`);
      console.log(`📏 Chunk length: ${chunk.length}`);
      console.log(`📊 Total data length: ${responseData.length}`);
      
      // Show first 500 chars of this chunk
      if (chunk.length > 500) {
        console.log(`📝 Chunk preview: ${chunk.substring(0, 500)}...`);
      } else {
        console.log(`📝 Full chunk: ${chunk}`);
      }
      
      // Try to find our response ID in the data
      if (chunk.includes('debug-add-single-')) {
        console.log('🎯 Found our response ID in this chunk!');
        
        // Try to extract the JSON response
        const lines = responseData.split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const response = JSON.parse(line);
            if (response.id && response.id.startsWith('debug-add-single-')) {
              console.log('\n✅ FOUND COMPLETE RESPONSE:');
              console.log(JSON.stringify(response, null, 2));
              
              clearTimeout(timeout);
              if (!resolved) {
                resolved = true;
                socket.destroy();
                resolve({ success: true, response: response });
              }
              return;
            }
          } catch (e) {
            // Not complete JSON yet
          }
        }
      }
      
      // If we've received a lot of data, show some stats
      if (responseCount % 10 === 0) {
        console.log(`📈 Progress: ${responseCount} responses, ${responseData.length} total chars`);
      }
    });
    
    socket.on('error', (error) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        console.log('💥 Socket error:', error.message);
        resolve({ error: error.message });
      }
    });
    
    socket.on('close', () => {
      console.log('\n🔌 Socket connection closed');
      if (!resolved) {
        console.log('⚠️ Socket closed without finding response');
        resolved = true;
        resolve({ closed: true, responses: responseCount });
      }
    });
  });
}

async function main() {
  console.log('🐛 DEBUG MODE: Single User Addition');
  console.log('This will add one user and log everything Signal CLI sends back');
  console.log('');
  
  const result = await debugSingleUserAdd();
  
  console.log('\n' + '='.repeat(60));
  console.log('🔍 DEBUG RESULTS:');
  
  if (result.success) {
    console.log('✅ Successfully received response from Signal CLI');
    if (result.response.result !== undefined) {
      console.log('✅ Signal CLI reported success');
    } else if (result.response.error) {
      console.log('❌ Signal CLI reported error:', result.response.error.message);
    }
  } else if (result.timeout) {
    console.log('⏰ Request timed out - Signal CLI may be processing slowly');
    console.log('📊 Received', result.responses, 'data chunks before timeout');
  } else if (result.error) {
    console.log('💥 Socket error occurred:', result.error);
  } else if (result.closed) {
    console.log('🔌 Socket closed unexpectedly');
    console.log('📊 Received', result.responses, 'data chunks before closing');
  }
  
  console.log('\n💡 This debug info will help us understand how Signal CLI responds');
}

main().catch(error => {
  console.error('💥 Error:', error);
  process.exit(1);
});