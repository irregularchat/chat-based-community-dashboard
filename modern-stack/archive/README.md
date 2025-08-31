# Archive Directory

This directory contains historical files from the development of the IrregularChat Community Bot. These files are preserved for reference but are no longer actively used in production.

## Directory Structure

### `/obsolete-bots/`
Legacy Signal bot implementations that have been superseded by the native Signal CLI daemon architecture:

- `signal-ai-bot.js` - Early prototype with basic AI integration
- `signal-websocket-bot.js` - Failed WebSocket implementation (REST API limitations)
- `signal-comprehensive-bot.js` - Comprehensive bot attempt (performance issues)
- `signal-efficient-bot.js` - Efficiency-focused bot (still had limitations)
- `signal-hybrid-bot.js` - Hybrid approach attempt
- `signal-production-bot.js` - Previous production version
- `signal-debug-bot.js` - Debug utilities and testing bot
- `comprehensive-signal-bot.js` - Duplicate comprehensive implementation
- `simple-signal-bot.js` - Minimal implementation for testing

**Current Production Bot**: `start-native-signal-bot.js` (in root directory)

### `/test-files/`
Testing utilities and development scripts:

- `test-signal-*.js/mjs` - Signal CLI testing utilities
- `test-auth.js` - Authentication testing
- `test-email-*.js/mjs` - Email service testing
- `group-id-normalizer.js` - Group ID format testing
- `populate-signal-groups.mjs` - Group population utilities
- `*.log` files - Historical bot startup and testing logs

### `/experimental/`
Experimental plugin implementations and proof-of-concepts:

- `remote-*-plugin.js` - Remote plugin prototypes
- Early AI integration experiments

### `/old-docs/`
Deprecated documentation that may contain outdated information but preserves development history.

## Why These Were Archived

### Signal Bot Evolution
The bot architecture evolved through several phases:

1. **REST API Phase** (archived bots) - Relied on signal-cli-rest-api Docker container
   - **Problems**: WebSocket instability, polling failures, group messaging bugs
   - **Status**: Archived due to fundamental REST API limitations

2. **Native Daemon Phase** (current) - Direct signal-cli daemon with JSON-RPC
   - **Benefits**: Real-time messaging, reliable group communication, no REST API overhead
   - **Implementation**: `NativeSignalBotService` with UNIX socket communication
   - **Status**: ✅ Production ready with 72 commands and GPT-5 integration

### Key Lessons Learned
- REST API approach fundamentally flawed for production use
- Native daemon provides superior reliability and performance  
- Plugin architecture essential for maintainability
- Comprehensive error handling and self-recovery critical for 24/7 operation

## Current Production Status

**Active Components:**
- ✅ `start-native-signal-bot.js` - Production bot launcher
- ✅ `src/lib/signal-cli/native-daemon-service.js` - Core bot service
- ✅ 72 total commands (6 core + 66 plugin-based)
- ✅ GPT-5 + Local AI (`irregularbot:latest`) integration
- ✅ Real-time messaging with JSON-RPC interface
- ✅ Auto-recovery and health monitoring

## Recovery Instructions

If you need to reference or restore any archived functionality:

1. **Check Git History**: Full development history preserved in git commits
2. **Review Architecture**: Lessons learned documented in `LESSONS_LEARNED.md`
3. **Test Approach**: Use current test files in `archive/test-files/` as templates
4. **Plugin Development**: Follow current plugin system in `/plugins/` directory

**⚠️ Warning**: Archived bots may not work with current environment configurations. Always test thoroughly before any restoration attempts.

---

*Last Updated: August 31, 2025*
*Archive Created: v0.3.0 cleanup phase*