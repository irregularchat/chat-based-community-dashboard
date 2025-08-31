// Use the legacy service to avoid the Multiple matrix-js-sdk entrypoints issue
// TODO: Fix the bundling issue with modular services
import { matrixService } from './matrix-legacy';
export { matrixService };
export default matrixService;

// Re-export types from the new modular services
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