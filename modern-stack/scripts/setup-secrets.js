#!/usr/bin/env node

/**
 * Script to set up Google Cloud Secret Manager secrets from environment variables
 * Usage: node scripts/setup-secrets.js
 */

const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const client = new SecretManagerServiceClient();
const projectId = process.env.GOOGLE_CLOUD_PROJECT;

if (!projectId) {
  console.error('❌ GOOGLE_CLOUD_PROJECT environment variable is required');
  process.exit(1);
}

// Secrets to create/update from environment variables
const secretMappings = [
  { secretName: 'GOOGLE_CLIENT_ID', envVar: 'GOOGLE_CLIENT_ID' },
  { secretName: 'GOOGLE_CLIENT_SECRET', envVar: 'GOOGLE_CLIENT_SECRET' },
  { secretName: 'AUTHENTIK_CLIENT_ID', envVar: 'AUTHENTIK_CLIENT_ID' },
  { secretName: 'AUTHENTIK_CLIENT_SECRET', envVar: 'AUTHENTIK_CLIENT_SECRET' },
  { secretName: 'AUTHENTIK_ISSUER', envVar: 'AUTHENTIK_ISSUER' },
  { secretName: 'DATABASE_URL', envVar: 'DATABASE_URL' },
  { secretName: 'OPENAI_API_KEY', envVar: 'OPENAI_API_KEY' },
  { secretName: 'NEXTAUTH_SECRET', envVar: 'NEXTAUTH_SECRET' },
];

async function createSecret(secretName) {
  try {
    const parent = `projects/${projectId}`;
    const [secret] = await client.createSecret({
      parent,
      secretId: secretName,
      secret: {
        replication: {
          automatic: {},
        },
      },
    });
    console.log(`✅ Created secret: ${secret.name}`);
    return true;
  } catch (error) {
    if (error.code === 6) { // ALREADY_EXISTS
      console.log(`ℹ️  Secret ${secretName} already exists`);
      return true;
    }
    console.error(`❌ Failed to create secret ${secretName}:`, error.message);
    return false;
  }
}

async function addSecretVersion(secretName, data) {
  try {
    const parent = `projects/${projectId}/secrets/${secretName}`;
    const [version] = await client.addSecretVersion({
      parent,
      payload: {
        data: Buffer.from(data),
      },
    });
    console.log(`✅ Added version to secret: ${version.name}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to add version to secret ${secretName}:`, error.message);
    return false;
  }
}

async function setupSecrets() {
  console.log(`🔐 Setting up secrets for project: ${projectId}\n`);

  for (const { secretName, envVar } of secretMappings) {
    const value = process.env[envVar];
    
    if (!value) {
      console.log(`⚠️  Skipping ${secretName} - environment variable ${envVar} not set`);
      continue;
    }

    console.log(`📝 Processing ${secretName}...`);
    
    // Create the secret if it doesn't exist
    const secretCreated = await createSecret(secretName);
    if (!secretCreated) {
      continue;
    }

    // Add the secret version with the environment variable value
    await addSecretVersion(secretName, value);
  }

  console.log('\n🎉 Secret setup complete!');
  console.log('\n📋 Next steps:');
  console.log('1. Verify secrets are created: gcloud secrets list');
  console.log('2. Test secret access: gcloud secrets versions access latest --secret="GOOGLE_CLIENT_ID"');
  console.log('3. Set up IAM permissions for your service account');
  console.log('4. Update your application to use Secret Manager');
}

async function listSecrets() {
  try {
    console.log(`🔍 Current secrets in project ${projectId}:\n`);
    const parent = `projects/${projectId}`;
    const [secrets] = await client.listSecrets({ parent });
    
    if (secrets.length === 0) {
      console.log('No secrets found.');
    } else {
      secrets.forEach(secret => {
        const secretName = secret.name.split('/').pop();
        console.log(`• ${secretName}`);
      });
    }
    console.log();
  } catch (error) {
    console.error('❌ Failed to list secrets:', error.message);
  }
}

// Main execution
async function main() {
  const command = process.argv[2];
  
  if (command === 'list') {
    await listSecrets();
  } else if (command === 'setup') {
    await setupSecrets();
  } else {
    console.log('Google Cloud Secret Manager Setup Tool\n');
    console.log('Usage:');
    console.log('  node scripts/setup-secrets.js setup  - Create/update secrets from .env.local');
    console.log('  node scripts/setup-secrets.js list   - List existing secrets');
    console.log('\nMake sure to set GOOGLE_CLOUD_PROJECT in your .env.local file');
    process.exit(1);
  }
}

main().catch(console.error);