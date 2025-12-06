import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

class SecretManager {
  private client: SecretManagerServiceClient;
  private projectId: string;
  private cache = new Map<string, string>();

  constructor() {
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT || '';
    
    // Initialize the Secret Manager client
    // This will use the default service account or GOOGLE_APPLICATION_CREDENTIALS
    this.client = new SecretManagerServiceClient();
  }

  /**
   * Get a secret from Google Cloud Secret Manager
   * @param secretName The name of the secret (without version)
   * @param version The version of the secret (defaults to 'latest')
   * @param useCache Whether to use cached value (defaults to true)
   */
  async getSecret(secretName: string, version: string = 'latest', useCache: boolean = true): Promise<string> {
    const cacheKey = `${secretName}:${version}`;
    
    // Check cache first
    if (useCache && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const name = `projects/${this.projectId}/secrets/${secretName}/versions/${version}`;
      const [response] = await this.client.accessSecretVersion({ name });
      
      const secretValue = response.payload?.data?.toString() || '';
      
      // Cache the value
      if (useCache) {
        this.cache.set(cacheKey, secretValue);
      }
      
      return secretValue;
    } catch (error) {
      console.error(`Failed to fetch secret ${secretName}:`, error);
      
      // Fallback to environment variable if secret fetch fails
      const envValue = process.env[secretName];
      if (envValue) {
        console.log(`Using fallback environment variable for ${secretName}`);
        return envValue;
      }
      
      throw new Error(`Could not fetch secret ${secretName} from Google Cloud or environment`);
    }
  }

  /**
   * Get Google OAuth credentials from secrets
   */
  async getGoogleOAuthCredentials() {
    const [clientId, clientSecret] = await Promise.all([
      this.getSecret('GOOGLE_CLIENT_ID'),
      this.getSecret('GOOGLE_CLIENT_SECRET')
    ]);

    return {
      clientId,
      clientSecret
    };
  }

  /**
   * Get Authentik OIDC credentials from secrets
   */
  async getAuthentikCredentials() {
    const [clientId, clientSecret, issuer] = await Promise.all([
      this.getSecret('AUTHENTIK_CLIENT_ID'),
      this.getSecret('AUTHENTIK_CLIENT_SECRET'),
      this.getSecret('AUTHENTIK_ISSUER')
    ]);

    return {
      clientId,
      clientSecret,
      issuer
    };
  }

  /**
   * Get database URL from secrets
   */
  async getDatabaseUrl(): Promise<string> {
    return this.getSecret('DATABASE_URL');
  }

  /**
   * Get OpenAI API key from secrets
   */
  async getOpenAiApiKey(): Promise<string> {
    return this.getSecret('OPENAI_API_KEY');
  }

  /**
   * Clear the secret cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Check if Secret Manager is properly configured
   */
  isConfigured(): boolean {
    return !!this.projectId;
  }
}

// Export a singleton instance
export const secretManager = new SecretManager();

// Helper function to get secrets with fallback to environment variables
export async function getSecretOrEnv(secretName: string, envName?: string): Promise<string> {
  const envKey = envName || secretName;
  
  // If Secret Manager is not configured, use environment variable
  if (!secretManager.isConfigured()) {
    const envValue = process.env[envKey];
    if (!envValue) {
      throw new Error(`Secret ${secretName} not found and Google Cloud project not configured`);
    }
    return envValue;
  }

  try {
    return await secretManager.getSecret(secretName);
  } catch (error) {
    // Fallback to environment variable
    const envValue = process.env[envKey];
    if (!envValue) {
      throw error;
    }
    console.log(`Using environment fallback for ${secretName}`);
    return envValue;
  }
}

// Specific helper functions for common secrets
export const getGoogleClientId = () => getSecretOrEnv('GOOGLE_CLIENT_ID');
export const getGoogleClientSecret = () => getSecretOrEnv('GOOGLE_CLIENT_SECRET');
export const getAuthentikClientId = () => getSecretOrEnv('AUTHENTIK_CLIENT_ID');
export const getAuthentikClientSecret = () => getSecretOrEnv('AUTHENTIK_CLIENT_SECRET');
export const getAuthentikIssuer = () => getSecretOrEnv('AUTHENTIK_ISSUER');
export const getDatabaseUrl = () => getSecretOrEnv('DATABASE_URL');
export const getOpenAiApiKey = () => getSecretOrEnv('OPENAI_API_KEY');