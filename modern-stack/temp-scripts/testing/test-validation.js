#!/usr/bin/env node

// Test script to verify the validation logic for mention-aware commands

// Simulate the validation logic from native-daemon-service.js
const validation = {
  patterns: {
    safeString: /^[a-zA-Z0-9\s\-_.!?@#$%&*+=()\[\]{};:,<>|~`'"\\\/]+$/
  }
};

function testValidation(commandName, args) {
  console.log(`\n=== Testing: !${commandName} ${args.join(' ')} ===`);
  
  const mentionAwareCommands = ['addto', 'removeuser', 'mention'];
  const isMentionCommand = mentionAwareCommands.includes(commandName);
  
  const validationResults = [];
  
  for (const [index, arg] of args.entries()) {
    // For mention commands, skip validation after we've seen a mention character
    if (isMentionCommand && index > 0) {
      let foundMention = false;
      for (let i = 0; i <= index; i++) {
        if (args[i] === '￼') {
          foundMention = true;
          break;
        }
      }
      // If we found a mention, skip validation for this arg and all following args
      if (foundMention) {
        console.log(`✅ Skipping validation after mention for argument ${index + 1}: "${arg}"`);
        continue;
      }
    }
    
    // Check for phone numbers
    if (arg.startsWith('+')) {
      console.log(`📱 Argument ${index + 1} is a phone number: ${arg}`);
    }
    // General string validation
    else if (arg !== '￼') {
      const isValid = validation.patterns.safeString.test(arg);
      if (!isValid) {
        console.log(`❌ Argument ${index + 1} failed validation: "${arg}"`);
        validationResults.push(`argument ${index + 1} contains invalid characters`);
      } else {
        console.log(`✅ Argument ${index + 1} passed validation: "${arg}"`);
      }
    } else {
      console.log(`⚠️ Argument ${index + 1} is mention character ￼`);
    }
  }
  
  if (validationResults.length > 0) {
    console.log(`\n❌ VALIDATION FAILED: ${validationResults.join(', ')}`);
  } else {
    console.log(`\n✅ VALIDATION PASSED`);
  }
  
  return validationResults.length === 0;
}

// Test cases
console.log('📋 TESTING MENTION-AWARE COMMAND VALIDATION\n');
console.log('=====================================');

// Test 1: Normal addto with phone number
testValidation('addto', ['6', '+1234567890']);

// Test 2: addto with mention (as it appears after Signal processing)
testValidation('addto', ['6', '￼']);

// Test 3: addto with mention and extra text (the problematic case)
testValidation('addto', ['6', '￼', 'Possible', 'Russian', 'asset']);

// Test 4: Non-mention command with special characters (should fail)
testValidation('help', ['￼', 'test']);

// Test 5: addto with regular text (no mention) - should fail
testValidation('addto', ['6', 'Joshua', 'Possible', 'Russian', 'asset']);

// Test 6: removeuser command with mention
testValidation('removeuser', ['3', '￼', 'reason', 'for', 'removal']);

console.log('\n=====================================');
console.log('✅ All tests completed!');