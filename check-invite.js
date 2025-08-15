#!/usr/bin/env node

// Check if the invite was created and get the correct URL format
const https = require('https');

const AUTHENTIK_API_TOKEN = 'usB6ijadk9JB7g4PwCvbbnPwtro0MqjSy3NPKSscIKe2wfv8HL2GlJrpAedU';
const INVITE_ID = '7a877339-3143-452a-b245-83dff055d8a4';

console.log('Checking invite details in Authentik...');

const options = {
  hostname: 'sso.irregularchat.com',
  port: 443,
  path: `/api/v3/stages/invitation/invitations/${INVITE_ID}/`,
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${AUTHENTIK_API_TOKEN}`,
    'Content-Type': 'application/json'
  }
};

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      
      if (res.statusCode === 200) {
        console.log('\n✅ INVITE FOUND!');
        console.log('================================================');
        console.log('Invite Details:', JSON.stringify(response, null, 2));
        console.log('================================================');
        
        // Try different URL formats
        console.log('\nPossible invite URLs to try:');
        console.log('1. https://sso.irregularchat.com/if/flow/enrollment/?itoken=' + INVITE_ID);
        console.log('2. https://sso.irregularchat.com/if/flow/enrollment/' + INVITE_ID + '/');
        console.log('3. https://sso.irregularchat.com/if/invitation/' + INVITE_ID + '/');
        console.log('4. https://sso.irregularchat.com/flows/invitation/' + INVITE_ID + '/');
        
      } else {
        console.error('❌ Failed to get invite details');
        console.error('Status:', res.statusCode);
        console.error('Response:', data);
      }
    } catch (error) {
      console.error('❌ Error parsing response:', error);
      console.error('Raw response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request error:', error);
});

req.end();