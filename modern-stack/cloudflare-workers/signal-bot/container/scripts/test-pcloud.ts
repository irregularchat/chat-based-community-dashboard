#!/usr/bin/env npx tsx
/**
 * Test script for pCloud authentication and folder listing
 *
 * Usage:
 *   PCLOUD_USERNAME=email@example.com PCLOUD_PASSWORD=yourpass npx tsx scripts/test-pcloud.ts
 *
 * Or set credentials in .env file and run:
 *   npx tsx scripts/test-pcloud.ts
 */

import { config } from 'dotenv';
config(); // Load .env file

import { PCloudClient } from '../src/utils/pcloud-client.js';

async function main() {
  console.log('=== pCloud Test Script ===\n');

  // Get credentials from environment
  const username = process.env.PCLOUD_USERNAME;
  const password = process.env.PCLOUD_PASSWORD;
  const authToken = process.env.PCLOUD_AUTH_TOKEN;
  const apiHost = process.env.PCLOUD_API_HOST || 'eapi.pcloud.com';

  console.log(`API Host: ${apiHost}`);
  console.log(`Username: ${username || '(not set)'}`);
  console.log(`Password: ${password ? '********' : '(not set)'}`);
  console.log(`Auth Token: ${authToken ? authToken.substring(0, 10) + '...' : '(not set)'}`);
  console.log('');

  if (!username && !authToken) {
    console.error('ERROR: Set PCLOUD_USERNAME and PCLOUD_PASSWORD, or PCLOUD_AUTH_TOKEN');
    process.exit(1);
  }

  const client = new PCloudClient({
    username,
    password,
    authToken,
    apiHost,
  });

  // Step 1: Login
  console.log('Step 1: Authenticating...');
  const loginResult = await client.login();

  if (!loginResult.success) {
    console.error(`Login failed: ${loginResult.error}`);
    process.exit(1);
  }

  console.log(`Login successful!`);
  console.log(`Auth Token: ${loginResult.authToken}`);
  console.log(`User ID: ${loginResult.userid}`);
  console.log('');
  console.log('Save this auth token to your .env as PCLOUD_AUTH_TOKEN for future use.');
  console.log('');

  // Step 2: List root folder
  console.log('Step 2: Listing root folder...');
  const rootResult = await client.listFolder(0);

  if (!rootResult.success) {
    console.error(`Failed to list root: ${rootResult.error}`);
    process.exit(1);
  }

  console.log(`\nRoot folder contents:`);
  console.log('=====================');

  if (rootResult.folder?.contents) {
    for (const item of rootResult.folder.contents) {
      const type = item.isfolder ? '📁' : '📄';
      const size = item.size ? ` (${formatSize(item.size)})` : '';
      console.log(`${type} ${item.name}${size} [ID: ${item.folderid || item.fileid}]`);
    }
  }

  // Step 3: Look for Signal-related folders
  console.log('\n\nStep 3: Looking for Signal-related folders...');
  const signalFolders = rootResult.folder?.contents?.filter(
    item => item.isfolder && item.name.toLowerCase().includes('signal')
  );

  if (signalFolders && signalFolders.length > 0) {
    for (const folder of signalFolders) {
      console.log(`\nFound Signal folder: ${folder.name} [ID: ${folder.folderid}]`);

      // List its contents
      const subResult = await client.listFolder(folder.folderid!);
      if (subResult.success && subResult.folder?.contents) {
        console.log('Contents:');
        for (const item of subResult.folder.contents) {
          const type = item.isfolder ? '📁' : '📄';
          console.log(`  ${type} ${item.name} [ID: ${item.folderid || item.fileid}]`);
        }
      }
    }
  } else {
    console.log('No Signal-related folders found in root.');
    console.log('Looking in all top-level folders...');

    // Check all folders for Signal content
    const folders = rootResult.folder?.contents?.filter(item => item.isfolder) || [];
    for (const folder of folders) {
      const subResult = await client.listFolder(folder.folderid!, true);
      if (subResult.success && subResult.folder?.contents) {
        const signalContent = findSignalContent(subResult.folder.contents, folder.name);
        if (signalContent.length > 0) {
          console.log(`\nFound in "${folder.name}":`);
          for (const item of signalContent) {
            console.log(`  ${item}`);
          }
        }
      }
    }
  }

  console.log('\n=== Test Complete ===');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function findSignalContent(contents: any[], path: string): string[] {
  const results: string[] = [];

  for (const item of contents) {
    const fullPath = `${path}/${item.name}`;

    if (item.name.toLowerCase().includes('signal') ||
        item.name.toLowerCase().includes('chat') ||
        item.name.toLowerCase().includes('group')) {
      results.push(`📁 ${fullPath} [ID: ${item.folderid || item.fileid}]`);
    }

    if (item.isfolder && item.contents) {
      results.push(...findSignalContent(item.contents, fullPath));
    }
  }

  return results;
}

main().catch(console.error);
