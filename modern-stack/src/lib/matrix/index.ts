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

// Export matrixService singleton with defensive initialization
export const matrixService = (() => {
  try {
    const { matrixService: service } = require('./matrix-service');
    return service;
  } catch (error) {
    console.error('Failed to load MatrixService:', error);
    // Return a minimal mock object to prevent crashes
    return {
      isConfigured: () => false,
      getConfig: () => null,
      initialize: async () => {},
      cleanup: async () => {},
      sendDirectMessage: async () => ({ success: false, error: 'Service not available' }),
    };
  }
})();

// Default export for backward compatibility with existing imports
export default matrixService;