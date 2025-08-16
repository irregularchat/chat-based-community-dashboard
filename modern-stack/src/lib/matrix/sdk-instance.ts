/**
 * Shared Matrix SDK instance to avoid "Multiple matrix-js-sdk entrypoints detected!" error
 * This ensures only one import/instance of the SDK exists across all Matrix services
 */

let matrixSdk: any = null;

export async function getMatrixSdk() {
  if (!matrixSdk) {
    // Import matrix-js-sdk only once and cache it
    matrixSdk = await import('matrix-js-sdk');
  }
  return matrixSdk;
}

// Re-export commonly used types and functions through this single instance
export async function createMatrixClient(options: any) {
  const sdk = await getMatrixSdk();
  return sdk.createClient(options);
}

export async function getMsgType() {
  const sdk = await getMatrixSdk();
  return sdk.MsgType;
}