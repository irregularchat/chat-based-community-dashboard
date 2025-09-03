#!/usr/bin/env node

/**
 * Signal CLI Native Daemon Setup Script
 * Replaces broken Docker REST API approach with native signal-cli daemon
 */

require('dotenv').config({ path: '.env.local' });
const { NativeSignalBotService } = require('./src/lib/signal-cli/native-daemon-service');
const fs = require('fs');
const path = require('path');

console.log('🚀 Signal CLI Native Daemon Setup\n');

const phoneNumber = process.env.SIGNAL_PHONE_NUMBER || process.env.SIGNAL_BOT_PHONE_NUMBER;
const dataDir = process.env.SIGNAL_CLI_DATA_DIR || './signal-data';

console.log('📋 Configuration:');
console.log(`   Phone: ${phoneNumber || '❌ NOT SET'}`);
console.log(`   Data Dir: ${dataDir}`);
console.log('');

if (!phoneNumber) {
  console.error('❌ SIGNAL_PHONE_NUMBER not set in .env.local');
  console.log('💡 Please add SIGNAL_PHONE_NUMBER=+1234567890 to your .env.local file');
  process.exit(1);
}

const config = {
  phoneNumber,
  dataDir,
  aiEnabled: process.env.OPENAI_ACTIVE === 'true',
  openAiApiKey: process.env.OPENAI_API_KEY
};

const bot = new NativeSignalBotService(config);

async function checkSignalCliInstalled() {
  const { spawn } = require('child_process');
  
  return new Promise((resolve) => {
    const check = spawn('signal-cli', ['--version']);
    
    check.on('close', (code) => {
      resolve(code === 0);
    });
    
    check.on('error', () => {
      resolve(false);
    });
  });
}

async function installInstructions() {
  console.log('📦 Signal CLI Installation Required\n');
  console.log('Please install signal-cli first:');
  console.log('');
  console.log('🍎 macOS (via Homebrew):');
  console.log('   brew install signal-cli');
  console.log('');
  console.log('🐧 Ubuntu/Debian:');
  console.log('   # Install from GitHub releases');
  console.log('   wget https://github.com/AsamK/signal-cli/releases/latest/download/signal-cli-*.tar.gz');
  console.log('   tar -xf signal-cli-*.tar.gz');
  console.log('   sudo mv signal-cli-*/ /opt/signal-cli');
  console.log('   sudo ln -s /opt/signal-cli/bin/signal-cli /usr/local/bin/signal-cli');
  console.log('');
  console.log('🐋 Docker (Alternative):');
  console.log('   docker run --rm -it -v signal-cli-config:/home/.local/share/signal-cli AsamK/signal-cli:latest');
  console.log('');
  console.log('After installation, run this script again.');
}

async function setupDaemon() {
  console.log('🔧 Setting up Signal CLI daemon...\n');
  
  // Check if signal-cli is installed
  const signalCliInstalled = await checkSignalCliInstalled();
  if (!signalCliInstalled) {
    await installInstructions();
    return;
  }
  
  console.log('✅ signal-cli is installed');
  
  // Check if account is registered
  const accountRegistered = await bot.checkAccountRegistered();
  if (!accountRegistered) {
    console.log('❌ Account not registered');
    console.log('');
    console.log('📱 Registration Required:');
    console.log('   1. Get captcha: https://signalcaptchas.org/registration/generate.html');
    console.log('   2. Use admin interface at /admin/signal');
    console.log('   3. Or run: node register-signal-account.js');
    return;
  }
  
  console.log('✅ Account is registered');
  
  // Test daemon startup
  console.log('🧪 Testing daemon startup...');
  try {
    await bot.startListening();
    console.log('✅ Daemon started successfully');
    
    // Test basic functionality
    const health = await bot.getHealth();
    console.log('📊 Health check:', health);
    
    // Test group listing
    const groups = await bot.getGroups();
    console.log(`📱 Found ${groups.length} groups:`, groups.map(g => g.name).join(', '));
    
    console.log('');
    console.log('🎉 Signal CLI daemon is working!');
    console.log('💡 Use the admin interface to start/stop the bot');
    console.log('💬 Send !help to any group to test bot commands');
    
    await bot.stopListening();
    
  } catch (error) {
    console.error('❌ Daemon test failed:', error);
    console.log('');
    console.log('🔧 Troubleshooting:');
    console.log('   1. Check signal-cli installation: signal-cli --version');
    console.log('   2. Check account registration status');
    console.log('   3. Check data directory permissions');
    console.log('   4. Check socket path is writable');
  }
}

setupDaemon().catch(console.error);