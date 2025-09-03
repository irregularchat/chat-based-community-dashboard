#!/usr/bin/env node

// Test script to verify other commands still work correctly

const validation = {
  patterns: {
    safeString: /^[a-zA-Z0-9\s\-_.!?@#$%&*+=()\[\]{};:,<>|~`'"\\\/]+$/,
    url: /^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/,
    phoneNumber: /^\+[1-9]\d{1,14}$/
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
      if (foundMention) {
        console.log(`✅ Skipping validation after mention for argument ${index + 1}: "${arg}"`);
        continue;
      }
    }
    
    // Check for URLs
    if (arg.startsWith('http://') || arg.startsWith('https://')) {
      const isValid = validation.patterns.url.test(arg);
      if (!isValid) {
        console.log(`❌ URL validation failed for argument ${index + 1}: "${arg}"`);
        validationResults.push(`argument ${index + 1} contains invalid URL`);
      } else {
        console.log(`✅ URL validation passed for argument ${index + 1}`);
      }
    }
    // Check for phone numbers
    else if (arg.startsWith('+')) {
      const isValid = validation.patterns.phoneNumber.test(arg);
      if (!isValid) {
        console.log(`❌ Phone validation failed for argument ${index + 1}: "${arg}"`);
        validationResults.push(`argument ${index + 1} contains invalid phone number`);
      } else {
        console.log(`✅ Phone validation passed for argument ${index + 1}`);
      }
    }
    // General string validation
    else if (arg !== '￼') {
      const isValid = validation.patterns.safeString.test(arg);
      if (!isValid) {
        console.log(`❌ String validation failed for argument ${index + 1}: "${arg}"`);
        validationResults.push(`argument ${index + 1} contains invalid characters`);
      } else {
        console.log(`✅ String validation passed for argument ${index + 1}: "${arg}"`);
      }
    } else {
      console.log(`⚠️ Argument ${index + 1} is mention character ￼`);
    }
  }
  
  if (validationResults.length > 0) {
    console.log(`\n❌ VALIDATION FAILED: ${validationResults.join(', ')}`);
    return false;
  } else {
    console.log(`\n✅ VALIDATION PASSED`);
    return true;
  }
}

console.log('📋 TESTING OTHER COMMANDS (NON-MENTION)\n');
console.log('=====================================');

// Test regular commands that should still work
console.log('\n--- Commands that should PASS ---');
testValidation('help', []);
testValidation('ping', []);
testValidation('groups', []);
testValidation('groups', ['refresh']);
testValidation('ai', ['What', 'is', 'the', 'weather', 'today?']);
testValidation('news', ['https://example.com/article']);
testValidation('tldr', ['https://www.example.com/page']);
testValidation('weather', ['New', 'York']);
testValidation('translate', ['es', 'Hello', 'world']);

// Test commands with invalid inputs that should FAIL
console.log('\n--- Commands that should FAIL ---');
testValidation('tldr', ['not-a-url']);
testValidation('news', ['http:/malformed']);
testValidation('weather', ['<script>alert("xss")</script>']);

// Test edge cases
console.log('\n--- Edge Cases ---');
testValidation('ai', ['Can', 'you', 'help', 'with', '`code`?']);
testValidation('translate', ['fr', 'L\'apostrophe', 'works!']);
testValidation('ai', ['Test', 'with', '"quotes"', 'and', "'apostrophes'"]);

console.log('\n=====================================');
console.log('✅ All command tests completed!');