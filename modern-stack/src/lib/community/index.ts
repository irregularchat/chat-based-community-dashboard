/**
 * Community Management System
 * Unified interface for Signal CLI and Matrix operations
 */

// Core interfaces and types
export * from './types';
export * from './community-service';

// Service implementations
export { SignalCommunityService } from './signal-community-service';
export { MatrixCommunityService } from './matrix-community-service';

// Manager and factory
export * from './community-manager';

// Re-export singletons for easy access
export { communityServiceFactory, communityManager } from './community-manager';