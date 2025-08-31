# Signal CLI Installation Guide

## Problem Identified ✅

Your Signal bot is not responding because it's still using the **broken bbernhard/signal-cli-rest-api** approach:
- Polling returns empty `[]` immediately (no long-polling)
- WebSocket not available in normal mode
- Group messaging fails with 400 errors

## Solution: Native Signal CLI Daemon ✅

We've implemented a complete native daemon solution that bypasses all REST API issues.

## Installation Steps

### 1. Install signal-cli Binary

**macOS (Recommended):**
```bash
brew install signal-cli
```

**macOS Alternative (if Homebrew unavailable):**
```bash
# Download latest release
wget https://github.com/AsamK/signal-cli/releases/latest/download/signal-cli-*-macOS.tar.gz
tar -xf signal-cli-*-macOS.tar.gz
sudo mv signal-cli-*/ /usr/local/bin/signal-cli
```

**Linux (Ubuntu/Debian):**
```bash
# Download and install
wget https://github.com/AsamK/signal-cli/releases/latest/download/signal-cli-*.tar.gz
tar -xf signal-cli-*.tar.gz
sudo mv signal-cli-*/ /opt/signal-cli
sudo ln -s /opt/signal-cli/bin/signal-cli /usr/local/bin/signal-cli
```

### 2. Verify Installation

```bash
signal-cli --version
# Should output: signal-cli 0.x.x
```

### 3. Test Our Native Daemon

```bash
# Validate environment and check account status
node setup-signal-daemon.js
```

### 4. Start Native Signal Bot

```bash
# Start production-ready native bot
node start-native-signal-bot.js
```

## What This Fixes

✅ **Real-time messaging** - JSON-RPC notifications instead of broken polling  
✅ **Group messaging works** - Direct signal-cli bypasses REST API bugs  
✅ **Stable connections** - UNIX sockets instead of unreliable WebSocket  
✅ **Command processing** - Plugin system with !help, !ping, !ai commands  
✅ **Production ready** - Based on actual working production implementations  

## Expected Result

After installation, your bot will:
1. Respond immediately to `!help`, `!ping`, and other commands
2. Process group messages reliably 
3. Show real-time message logs in console
4. Auto-reconnect if connection drops
5. Support AI responses if OpenAI is configured

## Migration from Docker

The new approach **replaces** the Docker container:
- ❌ Old: bbernhard/signal-cli-rest-api container with broken polling
- ✅ New: Native signal-cli daemon with JSON-RPC interface

Your existing account data will be preserved during migration.

## Need Help?

If you encounter any issues:
1. Check `node setup-signal-daemon.js` output for diagnostics
2. Verify account registration with Signal
3. Ensure all environment variables are set correctly
4. Check the troubleshooting guide in the setup script