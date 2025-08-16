// Re-export everything from the new modular Matrix services
// This maintains backward compatibility with existing imports

export {
  MatrixClientService,
  MatrixMessagingService,
  MatrixEncryptionService,
  MatrixSignalBridgeService,
  MatrixRoomService,
  MatrixService,
  matrixService,
} from './matrix/index';

export type {
  MatrixConfig,
  DirectMessageResult,
  BulkOperationResult,
  CacheStats,
  MatrixUser,
  MatrixRoom,
  PowerLevelEvent,
  MatrixServiceError,
  MatrixConnectionError,
  MatrixEncryptionError,
  MatrixSignalBridgeError,
} from './matrix/index';

// Default export for backward compatibility
export { matrixService as default } from './matrix/index';