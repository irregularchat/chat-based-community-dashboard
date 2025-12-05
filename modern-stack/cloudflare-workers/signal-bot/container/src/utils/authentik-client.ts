/**
 * Authentik API Client for Signal Bot
 *
 * Provides user management capabilities for Authentik SSO.
 * Ported from the dashboard's src/lib/authentik.ts for use in Signal bot.
 *
 * Features:
 * - Create users in Authentik SSO
 * - Generate unique usernames (firstName + randomWord + number)
 * - Generate secure passphrases (3 words + number + special char)
 * - Check username existence
 */

interface AuthentikConfig {
  apiUrl: string;
  apiToken: string;
  mainGroupId?: string;
}

interface CreateUserPayload {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  password?: string;
  attributes?: Record<string, any>;
  groups?: string[];
}

export interface CreateUserResponse {
  success: boolean;
  error?: string;
  user_id?: string;
  username?: string;
  temp_password?: string;
}

export interface CreateInviteResponse {
  success: boolean;
  inviteUrl?: string;
  inviteId?: string;
  expiresAt?: string;
  error?: string;
}

class AuthentikClient {
  private config: AuthentikConfig | null = null;
  private isActive: boolean = false;

  constructor() {
    this.initializeFromEnv();
  }

  /**
   * Check if Authentik is configured
   */
  public isConfigured(): boolean {
    return this.isActive && !!this.config;
  }

  /**
   * Initialize from environment variables
   */
  private initializeFromEnv() {
    const apiUrl = process.env.AUTHENTIK_BASE_URL || process.env.AUTHENTIK_API_URL;
    const apiToken = process.env.AUTHENTIK_API_TOKEN;
    const mainGroupId = process.env.MAIN_GROUP_ID;

    if (!apiUrl || !apiToken) {
      console.warn('⚠️  Authentik API not configured. Required: AUTHENTIK_BASE_URL and AUTHENTIK_API_TOKEN');
      return;
    }

    // Ensure API URL ends with /api/v3
    const baseUrl = apiUrl.replace(/\/$/, '');
    const fullApiUrl = baseUrl.includes('/api/v3') ? baseUrl : `${baseUrl}/api/v3`;

    this.config = {
      apiUrl: fullApiUrl,
      apiToken,
      mainGroupId,
    };

    this.isActive = true;
    console.log('✅ Authentik service initialized successfully');
  }

  /**
   * Make API request to Authentik
   */
  private async makeRequest(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    data?: any,
    timeoutMs: number = 15000
  ) {
    if (!this.config) {
      throw new Error('Authentik service not configured');
    }

    const url = `${this.config.apiUrl}/${endpoint}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.config.apiToken}`,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    };

    if (data && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.detail || errorJson.message || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }

        throw new Error(errorMessage);
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }

      return {};
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
          console.warn(`⏱️ Authentik API timeout after ${timeoutMs}ms: ${method} ${url}`);
          throw new Error(`Authentik SSO service timeout (${timeoutMs}ms)`);
        }
      }
      console.error(`❌ Authentik API request failed: ${method} ${url}`, error);
      throw error;
    }
  }

  /**
   * Generate a secure passphrase
   * Format: 3 capitalized words + random number (1-99) + special character
   * Example: "CorrectHorseBattery42!"
   */
  public async generateSecurePassphrase(): Promise<string> {
    const words = [
      'correct', 'horse', 'battery', 'staple', 'purple', 'monkey', 'dishwasher',
      'rainbow', 'keyboard', 'elephant', 'butterfly', 'mountain', 'ocean', 'thunder',
      'crystal', 'golden', 'silver', 'diamond', 'emerald', 'sapphire', 'ruby',
      'phoenix', 'dragon', 'unicorn', 'wizard', 'castle', 'forest', 'meadow'
    ];

    const selectedWords = [];
    for (let i = 0; i < 3; i++) {
      const randomWord = words[Math.floor(Math.random() * words.length)];
      selectedWords.push(randomWord.charAt(0).toUpperCase() + randomWord.slice(1));
    }

    const randomNumber = Math.floor(Math.random() * 99) + 1;
    const specialChar = '!@#$%^&*'[Math.floor(Math.random() * 8)];

    return `${selectedWords.join('')}${randomNumber}${specialChar}`;
  }

  /**
   * Generate a unique username
   * Format: firstName (lowercase, alphanumeric only) + random word + number (1-99)
   * Example: "johnswift42"
   */
  public async generateUsername(firstName: string): Promise<string> {
    const randomWords = [
      'swift', 'bright', 'clever', 'quick', 'smart', 'wise', 'bold', 'brave',
      'calm', 'cool', 'fresh', 'green', 'blue', 'red', 'gold', 'silver',
      'star', 'moon', 'sun', 'sky', 'ocean', 'river', 'mountain', 'forest'
    ];

    const baseUsername = firstName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const randomWord = randomWords[Math.floor(Math.random() * randomWords.length)];
    const randomNumber = Math.floor(Math.random() * 99) + 1;

    return `${baseUsername}${randomWord}${randomNumber}`;
  }

  /**
   * Check if username already exists in Authentik
   */
  public async checkUsernameExists(username: string): Promise<boolean> {
    if (!this.isActive) return false;

    try {
      const users = await this.makeRequest(`core/users/?username=${encodeURIComponent(username)}`);
      return users.results && users.results.length > 0;
    } catch (error) {
      console.error('❌ Error checking username existence:', error);
      return false;
    }
  }

  /**
   * Set password for an existing user
   * Uses the dedicated set_password endpoint which is more reliable than
   * passing password during user creation
   */
  private async setUserPassword(userId: string | number, password: string): Promise<boolean> {
    try {
      console.log(`🔑 Setting password for user ${userId}...`);
      await this.makeRequest(`core/users/${userId}/set_password/`, 'POST', { password });
      console.log(`✅ Password set successfully for user ${userId}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to set password for user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Create a new user in Authentik
   * NOTE: Password is set separately after user creation because Authentik's
   * user creation endpoint doesn't reliably apply the password field.
   */
  public async createUser(userData: CreateUserPayload): Promise<CreateUserResponse> {
    if (!this.isActive) {
      return {
        success: false,
        error: 'Authentik service not configured',
      };
    }

    try {
      // Generate secure password if not provided
      const tempPassword = userData.password || await this.generateSecurePassphrase();

      // Prepare user data for Authentik API (without password - set separately)
      const authentikUserData: any = {
        username: userData.username,
        name: `${userData.firstName} ${userData.lastName}`.trim(),
        email: userData.email,
        is_active: true,
      };

      // Add attributes if provided
      if (userData.attributes) {
        authentikUserData.attributes = userData.attributes;
      }

      // Add main group if configured
      const groups = [...(userData.groups || [])];
      if (this.config?.mainGroupId && !groups.includes(this.config.mainGroupId)) {
        groups.push(this.config.mainGroupId);
      }

      if (groups.length > 0) {
        authentikUserData.groups = groups.map(g => String(g));
      }

      console.log('🔐 Creating user in Authentik:', {
        username: authentikUserData.username,
        email: authentikUserData.email,
        name: authentikUserData.name,
        groups: authentikUserData.groups,
      });

      // Step 1: Create user via API (without password)
      const response = await this.makeRequest('core/users/', 'POST', authentikUserData);
      console.log('✅ User created in Authentik:', response.pk);

      // Step 2: Set password separately (more reliable)
      const passwordSet = await this.setUserPassword(response.pk, tempPassword);
      if (!passwordSet) {
        console.warn('⚠️ User created but password may not be set correctly');
      }

      return {
        success: true,
        user_id: response.pk,
        username: response.username,
        temp_password: tempPassword,
      };

    } catch (error) {
      console.error('❌ Error creating user in Authentik:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Create an invite link for SSO registration
   *
   * @param label - Optional label for the invite (for tracking in Authentik admin)
   * @param expiresInHours - Hours until invite expires (default: 4)
   * @param singleUse - Whether invite can only be used once (default: false - unlimited uses)
   * @returns CreateInviteResponse with invite URL or error
   */
  public async createInvite(
    label?: string,
    expiresInHours: number = 4,
    singleUse: boolean = false
  ): Promise<CreateInviteResponse> {
    if (!this.isActive) {
      return { success: false, error: 'Authentik service not configured' };
    }

    try {
      const flowId = process.env.AUTHENTIK_INVITE_FLOW_ID;
      const flowSlug = process.env.AUTHENTIK_INVITE_FLOW_SLUG || 'invite-enrollment-flow';

      if (!flowId) {
        return { success: false, error: 'AUTHENTIK_INVITE_FLOW_ID not configured' };
      }

      // Calculate expiry date
      const expiryDate = new Date();
      expiryDate.setHours(expiryDate.getHours() + expiresInHours);

      const inviteData = {
        name: label || `signal_invite_${Date.now()}`,
        expires: expiryDate.toISOString(),
        fixed_data: {},
        single_use: singleUse,
        flow: flowId,
      };

      console.log('🎟️ Creating Authentik invite:', {
        label: inviteData.name,
        expires: inviteData.expires,
        singleUse: inviteData.single_use,
      });

      const response = await this.makeRequest(
        'stages/invitation/invitations/',
        'POST',
        inviteData
      );

      // Build correct invite URL using flow slug + itoken parameter
      // Format: https://sso.irregularchat.com/if/flow/{flow_slug}/?itoken={invite_id}
      const baseUrl = this.config!.apiUrl.replace('/api/v3', '');
      const inviteUrl = `${baseUrl}/if/flow/${flowSlug}/?itoken=${response.pk}`;

      console.log('✅ Invite created successfully:', {
        inviteId: response.pk,
        inviteUrl,
        expiresAt: expiryDate.toISOString(),
      });

      return {
        success: true,
        inviteUrl,
        inviteId: response.pk,
        expiresAt: expiryDate.toISOString(),
      };

    } catch (error) {
      console.error('❌ Error creating invite:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// Singleton instance
export const authentikClient = new AuthentikClient();

/**
 * Generate the welcome message for a new user
 * This matches the format from src/lib/message-templates.ts
 */
export function generateWelcomeMessage(username: string, tempPassword: string): string {
  return `🌟 Your First Step Into the IrregularChat! 🌟
You've just joined a community focused on breaking down silos, fostering innovation, and supporting service members and veterans.
---
Use This Username and Temporary Password ⬇️
Username: ${username}
Temporary Password: ${tempPassword}
Exactly as shown above 👆🏼

1️⃣ Step 1:
- Use the username and temporary password to log in to https://sso.irregularchat.com

2️⃣ Step 2:
- Update your email, important to be able to recover your account and verify your identity
- Save your Login Username and New Password to a Password Manager
- Visit the welcome page while logged in https://forum.irregularchat.com/t/84

Please take a moment to learn about the community before you jump in.

If you have any questions or need assistance, feel free to reach out to the community admins.

Welcome aboard!`;
}
