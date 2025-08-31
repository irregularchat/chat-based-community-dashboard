/**
 * Type definitions for Signal CLI Bot Integration
 */

/**
 * Signal message structure
 */
export interface SignalMessage {
  /** Unix timestamp of the message */
  timestamp: number;
  /** Source identifier */
  source: string;
  /** Source phone number */
  sourceNumber: string;
  /** Signal UUID of the sender */
  sourceUuid: string;
  /** Display name of the sender */
  sourceName: string;
  /** Message content */
  message: string;
  /** Group ID if this is a group message */
  groupId?: string;
  /** List of attachment file paths */
  attachments?: string[];
}

/**
 * Signal bot configuration
 */
export interface SignalBotConfig {
  /** Path to signal-cli executable */
  signalCliPath?: string;
  /** Path to Signal account data */
  accountPath?: string;
  /** Bot's phone number with country code */
  phoneNumber: string;
  /** Enable AI features */
  aiEnabled?: boolean;
  /** OpenAI API key for GPT-5-mini */
  openAiApiKey?: string;
}

/**
 * Signal-Matrix integration configuration
 */
export interface SignalIntegrationConfig {
  /** Bot's phone number with country code */
  phoneNumber: string;
  /** Enable AI features */
  aiEnabled?: boolean;
  /** OpenAI API key */
  openAiApiKey?: string;
  /** Mapping of Signal group IDs to Matrix room IDs */
  matrixRoomMapping?: Map<string, string>;
}

/**
 * Command handler function type
 */
export type CommandHandler = (message: SignalMessage) => Promise<void>;

/**
 * Signal bot status
 */
export interface SignalBotStatus {
  /** Whether the bot is running */
  running: boolean;
  /** Whether Signal CLI is accessible */
  cliAvailable: boolean;
  /** Signal CLI version */
  cliVersion?: string;
  /** Whether the daemon is running */
  daemonRunning: boolean;
  /** Number of registered commands */
  commandCount: number;
  /** Whether AI is enabled */
  aiEnabled: boolean;
  /** Last error message if any */
  lastError?: string;
}

/**
 * Verification result
 */
export interface VerificationResult {
  /** Whether verification was successful */
  success: boolean;
  /** User ID if successful */
  userId?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Matrix room info for Signal integration
 */
export interface MatrixRoomInfo {
  /** Matrix room ID */
  roomId: string;
  /** Room display name */
  name?: string;
  /** Number of members */
  memberCount: number;
  /** Room topic/description */
  topic?: string;
}

/**
 * Signal UUID resolution result
 */
export interface UuidResolutionResult {
  /** Phone number that was resolved */
  phoneNumber: string;
  /** Signal UUID if found */
  uuid?: string;
  /** Whether the user has Signal */
  hasSignal: boolean;
  /** Error message if resolution failed */
  error?: string;
}

/**
 * Message sending result
 */
export interface MessageResult {
  /** Whether the message was sent successfully */
  success: boolean;
  /** Message event ID if successful */
  eventId?: string;
  /** Room ID where message was sent */
  roomId?: string;
  /** Error message if failed */
  error?: string;
  /** Additional error details */
  details?: string;
}

/**
 * Bot command registration
 */
export interface BotCommand {
  /** Command trigger (e.g., "!help") */
  command: string;
  /** Command description */
  description: string;
  /** Handler function */
  handler: CommandHandler;
  /** Whether command requires AI */
  requiresAI?: boolean;
  /** Whether command requires Matrix */
  requiresMatrix?: boolean;
}

/**
 * AI response configuration
 */
export interface AIConfig {
  /** OpenAI model to use (gpt-5-mini) */
  model: string;
  /** Maximum tokens for response */
  maxTokens: number;
  /** Temperature for response generation */
  temperature: number;
  /** System prompt for context */
  systemPrompt?: string;
}

/**
 * Error types for Signal bot operations
 */
export enum SignalBotErrorType {
  /** Signal CLI not installed or not found */
  CLI_NOT_FOUND = 'CLI_NOT_FOUND',
  /** Phone number not registered */
  NOT_REGISTERED = 'NOT_REGISTERED',
  /** Verification failed */
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',
  /** Message sending failed */
  SEND_FAILED = 'SEND_FAILED',
  /** AI service unavailable */
  AI_UNAVAILABLE = 'AI_UNAVAILABLE',
  /** Matrix service unavailable */
  MATRIX_UNAVAILABLE = 'MATRIX_UNAVAILABLE',
  /** Rate limit exceeded */
  RATE_LIMITED = 'RATE_LIMITED',
  /** Unknown error */
  UNKNOWN = 'UNKNOWN'
}

/**
 * Signal bot error class
 */
export class SignalBotError extends Error {
  constructor(
    message: string,
    public type: SignalBotErrorType,
    public details?: unknown
  ) {
    super(message);
    this.name = 'SignalBotError';
  }
}