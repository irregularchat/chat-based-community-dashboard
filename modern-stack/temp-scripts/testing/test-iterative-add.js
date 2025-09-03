#!/usr/bin/env node

const net = require('net');
const fs = require('fs');

// Configuration
const MAX_ITERATIONS = 10;
const SOCKET_PATH = '/tmp/signal-cli-socket';
const BOT_ACCOUNT = '+19108471202';

// Test users from Bot Development group
const testUsers = [
  { uuid: '4a4b6530-627a-4b52-b6f8-7ed38fcbeecb', name: 'Austyn' },
  { uuid: '338b0a07-0e74-4fbe-baf5-2e7d8d7d292f', name: 'Rico' },
  { uuid: '5322c630-dffe-4ffd-991e-44d01c16ae44', name: 'JD' },
  { uuid: '6cc74bbd-8837-4897-8bc6-22a01d9c2030', name: 'John' }
];

// Learning state
let learningState = {
  iteration: 0,
  successfulMethods: [],
  failedMethods: [],
  currentTimeout: 10000,
  currentDelay: 0,
  useMultipleAttempts: false,
  soloTestingGroupId: null,
  logs: []
};

// Log function
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level}] ${message}`;
  console.log(logEntry);
  learningState.logs.push(logEntry);
}

// Send JSON-RPC request with current learned parameters
function sendJsonRpcRequest(request, iteration) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    
    log(`Iteration ${iteration}: Sending ${request.method} with timeout ${learningState.currentTimeout}ms`);
    
    // Apply learned delay if any
    if (learningState.currentDelay > 0) {
      log(`Applying learned delay of ${learningState.currentDelay}ms before request`);
    }
    
    setTimeout(() => {
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          log(`Request timed out after ${learningState.currentTimeout}ms - treating as potential success`);
          resolve({ success: true, timedOut: true, iteration });
        }
      }, learningState.currentTimeout);
      
      socket.connect(SOCKET_PATH, () => {
        log(`Socket connected, sending request`);
        socket.write(JSON.stringify(request) + '\n');
      });
      
      socket.on('data', (data) => {
        if (resolved) return;
        try {
          const response = JSON.parse(data.toString());
          if (response.id === request.id) {
            resolved = true;
            clearTimeout(timeout);
            socket.destroy();
            log(`Received response: ${JSON.stringify(response).substring(0, 200)}`);
            resolve({ ...response, iteration });
          }
        } catch (e) {
          log(`Failed to parse response: ${e.message}`, 'WARN');
        }
      });
      
      socket.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          socket.destroy();
          log(`Socket error: ${error.message}`, 'ERROR');
          resolve({ error: error.message, iteration });
        }
      });
    }, learningState.currentDelay);
  });
}

// Find Solo testing group
async function findSoloTestingGroup(iteration) {
  log(`Looking for Solo testing group...`);
  
  const request = {
    jsonrpc: '2.0',
    method: 'listGroups',
    params: { account: BOT_ACCOUNT },
    id: `find-solo-${iteration}-${Date.now()}`
  };
  
  const response = await sendJsonRpcRequest(request, iteration);
  
  if (response.result) {
    const soloGroup = response.result.find(g => 
      g.name && g.name.toLowerCase().includes('solo') && 
      g.name.toLowerCase().includes('test')
    );
    
    if (soloGroup) {
      log(`Found Solo testing group: ${soloGroup.name} (${soloGroup.id})`, 'SUCCESS');
      learningState.soloTestingGroupId = soloGroup.id;
      return soloGroup.id;
    }
  }
  
  log(`Could not find Solo testing group`, 'ERROR');
  return null;
}

// Attempt to add user with current learned parameters
async function attemptAddUser(user, groupId, iteration, methodVariation = 1) {
  log(`Attempting to add ${user.name} using method variation ${methodVariation}`);
  
  let params = {
    account: BOT_ACCOUNT,
    groupId: groupId
  };
  
  // Try different parameter variations based on what we've learned
  switch (methodVariation) {
    case 1:
      params.addMembers = [user.uuid];
      break;
    case 2:
      params['add-members'] = [user.uuid];
      break;
    case 3:
      params.member = [user.uuid];
      break;
    case 4:
      params.members = [user.uuid];
      break;
  }
  
  const request = {
    jsonrpc: '2.0',
    method: 'updateGroup',
    params: params,
    id: `add-${iteration}-${methodVariation}-${Date.now()}`
  };
  
  const response = await sendJsonRpcRequest(request, iteration);
  
  if (response.result || response.success || response.timedOut) {
    log(`Method variation ${methodVariation} appears successful`, 'SUCCESS');
    return { success: true, method: methodVariation, response };
  } else if (response.error) {
    log(`Method variation ${methodVariation} failed: ${response.error.message || response.error}`, 'ERROR');
    return { success: false, method: methodVariation, error: response.error };
  } else {
    log(`Method variation ${methodVariation} returned unknown response`, 'WARN');
    return { success: false, method: methodVariation, response };
  }
}

// Verify if user was added
async function verifyUserInGroup(userUuid, groupId, iteration) {
  log(`Verifying if user ${userUuid} is in group ${groupId}`);
  
  const request = {
    jsonrpc: '2.0',
    method: 'listGroups',
    params: { 
      account: BOT_ACCOUNT,
      'get-members': true 
    },
    id: `verify-${iteration}-${Date.now()}`
  };
  
  const response = await sendJsonRpcRequest(request, iteration);
  
  if (response.result) {
    const targetGroup = response.result.find(g => g.id === groupId);
    if (targetGroup && targetGroup.members) {
      const userInGroup = targetGroup.members.some(m => m.uuid === userUuid);
      log(`User ${userInGroup ? 'IS' : 'IS NOT'} in group`, userInGroup ? 'SUCCESS' : 'INFO');
      return userInGroup;
    }
  }
  
  log(`Could not verify membership`, 'WARN');
  return false;
}

// Learn from results and adjust parameters
function learnFromResults(results) {
  log(`\nLearning from iteration ${learningState.iteration} results...`);
  
  // Analyze successes
  const successes = results.filter(r => r.verified);
  if (successes.length > 0) {
    successes.forEach(s => {
      if (!learningState.successfulMethods.includes(s.method)) {
        learningState.successfulMethods.push(s.method);
        log(`Added method ${s.method} to successful methods`);
      }
    });
  }
  
  // Analyze failures
  const failures = results.filter(r => !r.verified);
  failures.forEach(f => {
    if (!learningState.failedMethods.includes(f.method)) {
      learningState.failedMethods.push(f.method);
    }
    
    // Learn from specific error patterns
    if (f.error && f.error.includes('timeout')) {
      learningState.currentTimeout = Math.min(learningState.currentTimeout + 5000, 30000);
      log(`Increased timeout to ${learningState.currentTimeout}ms`);
    }
    
    if (f.error && f.error.includes('rate')) {
      learningState.currentDelay = Math.min(learningState.currentDelay + 1000, 5000);
      log(`Increased delay to ${learningState.currentDelay}ms`);
    }
  });
  
  // If nothing worked, try more aggressive strategies
  if (successes.length === 0 && learningState.iteration > 3) {
    learningState.useMultipleAttempts = true;
    log(`Enabling multiple attempt strategy`);
  }
}

// Main iteration function
async function runIteration() {
  learningState.iteration++;
  log(`\n${'='.repeat(60)}`);
  log(`ITERATION ${learningState.iteration} OF ${MAX_ITERATIONS}`);
  log(`${'='.repeat(60)}`);
  
  // Step 1: Find Solo testing group if we haven't already
  if (!learningState.soloTestingGroupId) {
    learningState.soloTestingGroupId = await findSoloTestingGroup(learningState.iteration);
    if (!learningState.soloTestingGroupId) {
      log(`Cannot proceed without Solo testing group ID`, 'ERROR');
      return false;
    }
  }
  
  // Step 2: Select test user (rotate through users)
  const userIndex = (learningState.iteration - 1) % testUsers.length;
  const testUser = testUsers[userIndex];
  log(`Testing with user: ${testUser.name} (${testUser.uuid})`);
  
  // Step 3: Try adding user with different methods
  const results = [];
  
  // If we have successful methods from previous iterations, try those first
  if (learningState.successfulMethods.length > 0) {
    for (const method of learningState.successfulMethods) {
      log(`Trying previously successful method ${method}`);
      const result = await attemptAddUser(testUser, learningState.soloTestingGroupId, learningState.iteration, method);
      results.push(result);
      
      // Verify immediately
      await new Promise(resolve => setTimeout(resolve, 2000));
      const verified = await verifyUserInGroup(testUser.uuid, learningState.soloTestingGroupId, learningState.iteration);
      result.verified = verified;
      
      if (verified) {
        log(`Method ${method} confirmed working!`, 'SUCCESS');
        return true;
      }
    }
  }
  
  // Try new methods if previous ones didn't work
  const methodsToTry = [1, 2, 3, 4].filter(m => !learningState.failedMethods.includes(m));
  
  for (const method of methodsToTry) {
    if (learningState.successfulMethods.includes(method)) continue;
    
    const result = await attemptAddUser(testUser, learningState.soloTestingGroupId, learningState.iteration, method);
    results.push(result);
    
    // Wait before verification
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify if user was added
    const verified = await verifyUserInGroup(testUser.uuid, learningState.soloTestingGroupId, learningState.iteration);
    result.verified = verified;
    
    if (verified) {
      log(`Method ${method} successfully added user!`, 'SUCCESS');
      learningState.successfulMethods.push(method);
      return true;
    }
    
    // If we're using multiple attempts, try again
    if (learningState.useMultipleAttempts && !verified) {
      log(`Retrying method ${method} with longer delay`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const retryResult = await attemptAddUser(testUser, learningState.soloTestingGroupId, learningState.iteration, method);
      results.push(retryResult);
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      const retryVerified = await verifyUserInGroup(testUser.uuid, learningState.soloTestingGroupId, learningState.iteration);
      retryResult.verified = retryVerified;
      
      if (retryVerified) {
        log(`Method ${method} worked on retry!`, 'SUCCESS');
        learningState.successfulMethods.push(method);
        return true;
      }
    }
  }
  
  // Learn from this iteration
  learnFromResults(results);
  
  // Save state after each iteration
  fs.writeFileSync(
    './learning-state.json', 
    JSON.stringify(learningState, null, 2)
  );
  
  return false;
}

// Main execution
async function main() {
  log(`🚀 Starting Iterative User Addition Learning Script`);
  log(`Target: Add users from Bot Development to Solo testing group`);
  log(`Maximum iterations: ${MAX_ITERATIONS}`);
  
  // Load previous learning state if exists
  try {
    const savedState = fs.readFileSync('./learning-state.json', 'utf8');
    const loaded = JSON.parse(savedState);
    learningState = { ...learningState, ...loaded, logs: [] };
    log(`Loaded previous learning state from iteration ${loaded.iteration}`);
  } catch (e) {
    log(`Starting fresh learning session`);
  }
  
  let success = false;
  
  while (learningState.iteration < MAX_ITERATIONS && !success) {
    success = await runIteration();
    
    if (!success) {
      log(`Iteration ${learningState.iteration} did not achieve success, continuing...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  // Final report
  log(`\n${'='.repeat(60)}`);
  log(`FINAL REPORT AFTER ${learningState.iteration} ITERATIONS`);
  log(`${'='.repeat(60)}`);
  
  if (learningState.successfulMethods.length > 0) {
    log(`✅ SUCCESSFUL METHODS FOUND:`, 'SUCCESS');
    learningState.successfulMethods.forEach(m => {
      log(`  - Method variation ${m}`, 'SUCCESS');
    });
    
    log(`\n📝 RECOMMENDATIONS:`);
    log(`  - Use method variation ${learningState.successfulMethods[0]} as primary`);
    log(`  - Timeout should be at least ${learningState.currentTimeout}ms`);
    if (learningState.currentDelay > 0) {
      log(`  - Add ${learningState.currentDelay}ms delay before requests`);
    }
  } else {
    log(`❌ No consistently working method found after ${learningState.iteration} iterations`, 'ERROR');
    log(`\n📝 DEBUGGING SUGGESTIONS:`);
    log(`  - Check if bot has admin permissions in Solo testing group`);
    log(`  - Verify Signal CLI daemon is running properly`);
    log(`  - Check Signal CLI logs for more details`);
  }
  
  // Save final logs
  fs.writeFileSync(
    './iteration-logs.txt',
    learningState.logs.join('\n')
  );
  
  log(`\n💾 Full logs saved to iteration-logs.txt`);
  log(`💾 Learning state saved to learning-state.json`);
}

// Run the script
main().catch(error => {
  log(`❌ Fatal error: ${error.message}`, 'ERROR');
  console.error(error);
  process.exit(1);
});