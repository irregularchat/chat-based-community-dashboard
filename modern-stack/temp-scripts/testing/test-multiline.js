#!/usr/bin/env node

// Test script to verify multi-line message handling

const validation = {
  patterns: {
    safeString: /^[a-zA-Z0-9\s\-_.!?@#$%&*+=()\[\]{};:,<>|~`'"\\\\/]+$/,
    url: /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/,
    phoneNumber: /^\+[1-9]\d{1,14}$/
  }
};

function processCommand(messageText) {
  console.log('\n=== Testing Multi-line Message ===');
  console.log('Original message:');
  console.log('---');
  console.log(messageText);
  console.log('---\n');
  
  // Only parse the first line for command and arguments
  const lines = messageText.split('\n');
  const firstLine = lines[0];
  const parts = firstLine.slice(1).split(' ');
  const commandName = parts[0].toLowerCase();
  const args = parts.slice(1);
  
  console.log(`Command: !${commandName}`);
  console.log(`Arguments: [${args.map(a => `"${a}"`).join(', ')}]`);
  console.log(`Number of args: ${args.length}`);
  
  // Validate based on command type
  if (commandName === 'tldr' && args.length > 0) {
    const url = args[0];
    const isValidUrl = validation.patterns.url.test(url);
    console.log(`\nURL validation for "${url}": ${isValidUrl ? '✅ PASSED' : '❌ FAILED'}`);
    return isValidUrl;
  }
  
  return true;
}

console.log('📋 TESTING MULTI-LINE MESSAGE HANDLING\n');
console.log('=====================================');

// Test 1: Simple !tldr with URL only
console.log('\n--- Test 1: Simple URL ---');
processCommand('!tldr https://example.com/article');

// Test 2: Multi-line !tldr (common user pattern)
console.log('\n--- Test 2: Multi-line with description ---');
processCommand(`!tldr https://example.com/article
This is an interesting article about technology
It has multiple paragraphs`);

// Test 3: Multi-line with extra spaces
console.log('\n--- Test 3: URL with trailing spaces ---');
processCommand(`!tldr https://example.com/article   
Extra description here`);

// Test 4: Invalid URL (should fail)
console.log('\n--- Test 4: Invalid URL ---');
processCommand('!tldr not-a-valid-url');

// Test 5: Complex real-world example
console.log('\n--- Test 5: Real-world example ---');
processCommand(`!tldr https://www.nytimes.com/2024/01/15/technology/ai-article.html
AI Development Accelerates in 2024

New breakthroughs in artificial intelligence are reshaping industries across the globe.`);

console.log('\n=====================================');
console.log('✅ All multi-line tests completed!');