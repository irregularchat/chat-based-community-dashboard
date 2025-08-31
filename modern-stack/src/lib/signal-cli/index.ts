/**
 * Signal CLI Bot Integration
 * 
 * This module provides comprehensive Signal CLI bot functionality including:
 * - Command processing with extensible command registration
 * - AI integration using GPT-5-mini for !phelp and !ai commands
 * - Matrix integration for cross-platform messaging
 * - Phone number verification and user management
 * - Comprehensive error handling and recovery
 * 
 * @module signal-cli
 */

export { SignalBotService, SignalMessage, SignalBotConfig } from './bot-service';
export { SignalMatrixIntegration, SignalIntegrationConfig } from './integration';

// Re-export types
export type { SignalMessage, SignalBotConfig, SignalIntegrationConfig } from './types';

/**
 * Quick start example:
 * 
 * ```typescript
 * import { SignalMatrixIntegration } from '@/lib/signal-cli';
 * 
 * const integration = new SignalMatrixIntegration({
 *   phoneNumber: '+1234567890',
 *   aiEnabled: true,
 *   openAiApiKey: process.env.OPENAI_API_KEY
 * });
 * 
 * await integration.start();
 * ```
 */

/**
 * Available commands:
 * - !help - Show all available commands
 * - !phelp - Get personalized AI help (uses GPT-5-mini)
 * - !info - Bot information and status
 * - !status - Check bot operational status
 * - !ping - Test bot responsiveness
 * - !whoami - Display Signal account info
 * - !ai <question> - Ask AI assistant
 * - !rooms - List available Matrix rooms
 * - !join <room> - Join a Matrix room
 * - !leave <room> - Leave a Matrix room
 * - !verify <code> - Verify Signal account
 * - !matrix status|sync|search - Matrix commands
 */

/**
 * Environment variables required:
 * - SIGNAL_BOT_PHONE_NUMBER - Bot's phone number with country code
 * - SIGNAL_BOT_ENABLED - Enable/disable bot (true/false)
 * - OPENAI_ACTIVE - Enable AI features (true/false)
 * - OPENAI_API_KEY - OpenAI API key for GPT-5-mini
 * - MATRIX_HOMESERVER - Matrix server URL (optional)
 * - MATRIX_ACCESS_TOKEN - Matrix bot access token (optional)
 * - MATRIX_SIGNAL_BRIDGE_ROOM_ID - Signal bridge room ID (optional)
 */

/**
 * Setup instructions:
 * 1. Run setup script: ./scripts/setup-signal-bot.sh
 * 2. Configure environment variables in .env.local
 * 3. Start bot via API: POST /api/signal-bot {"action": "start"}
 * 4. Test with !help command
 * 
 * For detailed instructions, see SIGNAL_BOT_README.md
 * For lessons learned, see src/lib/signal-cli/LESSONS_LEARNED.md
 */