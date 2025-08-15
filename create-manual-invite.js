#!/usr/bin/env node

// Manual invite creation using Authentik API
// Creates "unmanned_pause" invite valid for 4 days, not single use

const https = require('https');

// Configuration from deploy.env
const AUTHENTIK_API_URL = 'https://sso.irregularchat.com/api/v3';
const AUTHENTIK_API_TOKEN = 'usB6ijadk9JB7g4PwCvbbnPwtro0MqjSy3NPKSscIKe2wfv8HL2GlJrpAedU';

// Calculate expiry date (4 days from now)
const expiryDate = new Date();
expiryDate.setDate(expiryDate.getDate() + 4);

const inviteData = {
  name: 'unmanned_pause',
  expires: expiryDate.toISOString(),
  fixed_data: {},
  single_use: false, // Set to false for reusable invite
  flow: '5618f121-1270-4d09-81ff-59fbf00a8c0d' // Invite flow ID
};

const postData = JSON.stringify(inviteData);

const options = {
  hostname: 'sso.irregularchat.com',
  port: 443,
  path: '/api/v3/stages/invitation/invitations/',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${AUTHENTIK_API_TOKEN}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log('Creating invite with Authentik API...');
console.log('Label: unmanned_pause');
console.log('Valid for: 4 days');
console.log('Single use: false (reusable)');
console.log('Expires:', expiryDate.toISOString());

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      
      if (res.statusCode === 201) {
        console.log('\n✅ INVITE CREATED SUCCESSFULLY!');
        console.log('================================================');
        console.log('INVITE LINK:', `https://sso.irregularchat.com/if/flow/enrollment/${response.pk}/`);
        console.log('Invite ID:', response.pk);
        console.log('Label:', response.name);
        console.log('Expires:', response.expires);
        console.log('Single Use:', response.single_use);
        console.log('================================================');
        console.log('\nYou can test this invite link in a browser!');
      } else {
        console.error('❌ Failed to create invite');
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

req.write(postData);
req.end();