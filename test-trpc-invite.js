#!/usr/bin/env node

// Test tRPC invite creation using the correct endpoint format
const https = require('https');

// Test data for creating an invite via tRPC
const testData = {
  label: 'test_unmanned_pause_trpc',
  expiryDays: 4,
  groups: []
};

const postData = JSON.stringify(testData);

console.log('Testing tRPC invite creation...');
console.log('Endpoint: /api/trpc/invite.createInvite');
console.log('Data:', testData);

const options = {
  hostname: 'community-dashboard-496146455129.us-central1.run.app',
  port: 443,
  path: '/api/trpc/invite.createInvite',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('\nResponse Status:', res.statusCode);
    console.log('Response Headers:', res.headers);
    console.log('Response Body:', data);
    
    try {
      const response = JSON.parse(data);
      console.log('\nParsed Response:', JSON.stringify(response, null, 2));
      
      if (response.result?.data?.inviteLink) {
        console.log('\n✅ INVITE LINK GENERATED:');
        console.log(response.result.data.inviteLink);
      }
    } catch (error) {
      console.log('Could not parse JSON response');
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request error:', error);
});

req.write(postData);
req.end();