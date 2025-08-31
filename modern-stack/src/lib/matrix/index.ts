// Export all Matrix services for modular use
export { MatrixClientService } from './client-service';
export { MatrixMessagingService } from './messaging-service';
export { MatrixEncryptionService } from './encryption-service';
export { MatrixSignalBridgeService } from './signal-bridge-service';
export { MatrixRoomService } from './room-service';

// Export the main coordinating service
export { MatrixService } from './matrix-service';

// Export all types and interfaces
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
} from './types';

// Export matrixService singleton - import from matrix-service
export { matrixService } from './matrix-service';