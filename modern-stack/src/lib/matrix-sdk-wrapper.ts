/**
 * Matrix SDK Wrapper - Single point of import for matrix-js-sdk
 * This prevents the "Multiple matrix-js-sdk entrypoints detected!" error
 */

let matrixSdk: any = null;
let loadPromise: Promise<any> | null = null;

export async function getMatrixSdk() {
  if (!loadPromise) {
    loadPromise = (async () => {
      if (typeof window === 'undefined') {
        // Server-side import
        matrixSdk = await import('matrix-js-sdk');
      } else {
        // Client-side import (if needed)
        matrixSdk = await import('matrix-js-sdk');
      }
      return matrixSdk;
    })();
  }
  return loadPromise;
}

// Export commonly used items through getter functions
export async function createClient(options: any) {
  const sdk = await getMatrixSdk();
  return sdk.createClient(options);
}

export async function getMsgType() {
  const sdk = await getMatrixSdk();
  return sdk.MsgType;
}

export async function getClientEvent() {
  const sdk = await getMatrixSdk();
  return sdk.ClientEvent;
}

export async function getRoomEvent() {
  const sdk = await getMatrixSdk();
  return sdk.RoomEvent;
}

// Re-export types (these are compile-time only, no runtime impact)
export type { MatrixClient, Room, User, EventType, MsgType, ClientEvent, RoomEvent } from 'matrix-js-sdk';