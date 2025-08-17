// Simple test to check environment variables are loading
require('dotenv').config({ path: '.env' });

console.log('Environment Test Results:');
console.log('========================');
console.log('');
console.log('Signal CLI Configuration:');
console.log('  SIGNAL_CLI_REST_API_BASE_URL:', process.env.SIGNAL_CLI_REST_API_BASE_URL || 'NOT SET');
console.log('  SIGNAL_BOT_PHONE_NUMBER:', process.env.SIGNAL_BOT_PHONE_NUMBER || 'NOT SET');
console.log('  SIGNAL_ACTIVE:', process.env.SIGNAL_ACTIVE || 'NOT SET');
console.log('');
console.log('Matrix Configuration:');
console.log('  MATRIX_HOMESERVER:', process.env.MATRIX_HOMESERVER || 'NOT SET');
console.log('  MATRIX_ACCESS_TOKEN:', process.env.MATRIX_ACCESS_TOKEN ? 'SET' : 'NOT SET');
console.log('  MATRIX_USER_ID:', process.env.MATRIX_USER_ID || 'NOT SET');
console.log('  MATRIX_ACTIVE:', process.env.MATRIX_ACTIVE || 'NOT SET');
console.log('  MATRIX_ENABLE_ENCRYPTION:', process.env.MATRIX_ENABLE_ENCRYPTION || 'NOT SET');
console.log('');
console.log('Database Configuration:');
console.log('  DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
console.log('');

// Test Signal CLI connection
if (process.env.SIGNAL_CLI_REST_API_BASE_URL) {
  const url = `${process.env.SIGNAL_CLI_REST_API_BASE_URL}/v1/health`;
  console.log(`Testing Signal CLI at ${url}...`);
  
  fetch(url)
    .then(res => {
      console.log(`  ✅ Signal CLI responded with status: ${res.status}`);
    })
    .catch(err => {
      console.log(`  ❌ Signal CLI connection failed: ${err.message}`);
    });
}