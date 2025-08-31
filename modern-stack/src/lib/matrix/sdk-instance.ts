/**
 * Shared Matrix SDK instance to avoid "Multiple matrix-js-sdk entrypoints detected!" error
 * This ensures only one import/instance of the SDK exists across all Matrix services
 */

let matrixSdk: any = null;

export async function getMatrixSdk() {
  if (!matrixSdk) {
    try {
      console.log('📦 SDK: Importing matrix-js-sdk...');
      // Import matrix-js-sdk only once and cache it
      matrixSdk = await import('matrix-js-sdk');
      console.log('✅ SDK: matrix-js-sdk imported successfully');
    } catch (error) {
      console.error('❌ SDK: Failed to import matrix-js-sdk:', error);
      throw error;
    }
  }
  return matrixSdk;
}

// Re-export commonly used types and functions through this single instance
export async function createMatrixClient(options: any) {
  try {
    console.log('🏗️ SDK: Starting createMatrixClient with options:', options);
    const sdk = await getMatrixSdk();
    console.log('✅ SDK: Got Matrix SDK instance');
    
    // Check if encryption is enabled and configure accordingly
    const enableEncryption = process.env.MATRIX_ENABLE_ENCRYPTION === 'true';
    console.log('🔐 SDK: Encryption check:', enableEncryption);
  
  if (enableEncryption) {
    console.log('🔐 SDK: Encryption enabled, configuring client with crypto support');
    console.log('🔐 SDK: Environment check - MATRIX_ENABLE_ENCRYPTION:', process.env.MATRIX_ENABLE_ENCRYPTION);
    
    // Import crypto dependencies for encryption
    try {
      console.log('📦 SDK: Loading Olm library for encryption...');
      console.log('📦 SDK: Checking if @matrix-org/olm is available...');
      const Olm = await import('@matrix-org/olm');
      console.log('📦 SDK: Olm library imported successfully:', !!Olm);
      
      // Initialize Olm with the WASM file location
      if (typeof window !== 'undefined') {
        // Browser environment - Olm should load automatically from public/olm/
        await Olm.init({
          locateFile: () => '/olm/olm.wasm'
        });
      } else {
        // Node.js environment
        await Olm.init();
      }
      
      console.log('✅ SDK: Olm library loaded successfully');
      
      // Create client with crypto support
      const client = sdk.createClient({
        ...options,
        // Enable crypto for end-to-end encryption
        useE2eForGroupCall: true,
        cryptoStore: new sdk.MemoryCryptoStore(),
        deviceId: options.deviceId || process.env.MATRIX_DEVICE_ID || 'DASHBOARD_BOT_001',
        sessionStore: new sdk.MemoryStore(),
      });
      
      console.log('✅ SDK: Matrix client created with encryption support');
      return client;
      
    } catch (olmError) {
      console.error('❌ SDK: Failed to initialize encryption:', olmError);
      console.log('⚠️ SDK: Falling back to client without encryption');
      
      // Fallback to non-encrypted client if Olm fails
      return sdk.createClient(options);
    }
  } else {
    console.log('🔓 SDK: Encryption disabled, creating standard client');
    const client = sdk.createClient(options);
    console.log('✅ SDK: Standard Matrix client created successfully');
    return client;
  }
  } catch (error) {
    console.error('❌ SDK: Error in createMatrixClient:', error);
    throw error;
  }
}

export async function getMsgType() {
  const sdk = await getMatrixSdk();
  return sdk.MsgType;
}