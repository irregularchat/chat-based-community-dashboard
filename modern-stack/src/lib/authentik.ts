interface AuthentikConfig {
  apiUrl: string;
  apiToken: string;
  mainGroupId?: string;
  flowId?: string;
  inviteFlowId?: string;
}

interface CreateUserPayload {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  password?: string;
  attributes?: Record<string, any>;
  groups?: string[];
  isActive?: boolean;
  path?: string;
}

interface CreateUserResponse {
  success: boolean;
  error?: string;
  user_id?: string;
  username?: string;
  temp_password?: string;
  password_reset_link?: string;
}

interface AuthentikUser {
  pk: string;
  username: string;
  email: string;
  name: string;
  is_active: boolean;
  groups: string[];
  attributes?: Record<string, any>;
  last_login?: string;
}

class AuthentikService {
  private config: AuthentikConfig | null = null;
  private isActive: boolean = false;

  constructor() {
    this.initializeFromEnv();
  }

  public isConfigured(): boolean {
    return this.isActive && !!this.config;
  }

  private initializeFromEnv() {
    const apiUrl = process.env.AUTHENTIK_BASE_URL || process.env.AUTHENTIK_API_URL;
    const apiToken = process.env.AUTHENTIK_API_TOKEN;
    const mainGroupId = process.env.MAIN_GROUP_ID;
    const flowId = process.env.FLOW_ID;
    const inviteFlowId = process.env.INVITE_FLOW_ID;

    if (!apiUrl || !apiToken) {
      console.warn('Authentik API not configured. Required: AUTHENTIK_BASE_URL and AUTHENTIK_API_TOKEN');
      return;
    }

    // Ensure API URL ends with /api/v3
    const baseUrl = apiUrl.replace(/\/$/, '');
    const fullApiUrl = baseUrl.includes('/api/v3') ? baseUrl : `${baseUrl}/api/v3`;

    this.config = {
      apiUrl: fullApiUrl,
      apiToken,
      mainGroupId,
      flowId,
      inviteFlowId,
    };

    this.isActive = true;
    console.log('Authentik service initialized successfully');
  }

  public getConfig() {
    return {
      isActive: this.isActive,
      apiUrl: this.config?.apiUrl || '',
      mainGroupId: this.config?.mainGroupId || '',
    };
  }

  private async makeRequest(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    data?: any,
    timeoutMs: number = 15000 // Default 15 second timeout
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
      signal: AbortSignal.timeout(timeoutMs), // Add timeout signal
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
          // Use the raw text if it's not JSON
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
      // Enhanced error handling for timeouts
      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
          console.warn(`Authentik API timeout after ${timeoutMs}ms: ${method} ${url}`);
          throw new Error(`Authentik SSO service timeout (${timeoutMs}ms)`);
        }
      }
      console.error(`Authentik API request failed: ${method} ${url}`, error);
      throw error;
    }
  }

  public async generateSecurePassphrase(): Promise<string> {
    // Generate a secure passphrase similar to the legacy system
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

  public async checkUsernameExists(username: string): Promise<boolean> {
    if (!this.isActive) return false;

    try {
      const users = await this.makeRequest(`core/users/?username=${encodeURIComponent(username)}`);
      return users.results && users.results.length > 0;
    } catch (error) {
      console.error('Error checking username existence:', error);
      return false;
    }
  }

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
      
      // Prepare user data for Authentik API
      const authentikUserData: any = {
        username: userData.username,
        name: `${userData.firstName} ${userData.lastName}`.trim(),
        email: userData.email,
        password: tempPassword,
        is_active: userData.isActive !== false,
      };

      // Add path if specified
      if (userData.path) {
        authentikUserData.path = userData.path;
      }

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

      console.log('Creating user in Authentik:', {
        username: authentikUserData.username,
        email: authentikUserData.email,
        name: authentikUserData.name,
        groups: authentikUserData.groups,
      });

      // Create user via API
      const response = await this.makeRequest('core/users/', 'POST', authentikUserData);

      // Generate password reset link if flow is configured
      let passwordResetLink = '';
      if (this.config?.flowId) {
        try {
          // In a real implementation, you might generate a proper reset link
          // For now, we'll create a basic link structure
          const baseUrl = this.config.apiUrl.replace('/api/v3', '');
          passwordResetLink = `${baseUrl}/if/flow/${this.config.flowId}/?user=${response.pk}`;
        } catch (error) {
          console.warn('Could not generate password reset link:', error);
        }
      }

      return {
        success: true,
        user_id: response.pk,
        username: response.username,
        temp_password: tempPassword,
        password_reset_link: passwordResetLink,
      };

    } catch (error) {
      console.error('Error creating user in Authentik:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  public async resetUserPassword(userId: string, newPassword?: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (!this.isActive) {
      return {
        success: false,
        error: 'Authentik service not configured',
      };
    }

    try {
      const password = newPassword || await this.generateSecurePassphrase();
      
      // Try POST first, then PUT if that fails (different Authentik versions)
      try {
        await this.makeRequest(`core/users/${userId}/set_password/`, 'POST', { password });
      } catch (error) {
        // If POST fails with 405, try PUT
        if (error instanceof Error && error.message.includes('405')) {
          await this.makeRequest(`core/users/${userId}/set_password/`, 'PUT', { password });
        } else {
          throw error;
        }
      }

      return { success: true };

    } catch (error) {
      console.error('Error resetting user password:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  public async getUser(userId: string): Promise<AuthentikUser | null> {
    if (!this.isActive) return null;

    try {
      const user = await this.makeRequest(`core/users/${userId}/`);
      return {
        pk: user.pk,
        username: user.username,
        email: user.email,
        name: user.name,
        is_active: user.is_active,
        groups: user.groups || [],
        attributes: user.attributes || {},
      };
    } catch (error) {
      console.error('Error getting user from Authentik:', error);
      return null;
    }
  }

  public async searchUsers(query: string): Promise<AuthentikUser[]> {
    if (!this.isActive) return [];

    try {
      const response = await this.makeRequest(`core/users/?search=${encodeURIComponent(query)}`);
      return response.results.map((user: any) => ({
        pk: user.pk,
        username: user.username,
        email: user.email,
        name: user.name,
        is_active: user.is_active,
        groups: user.groups || [],
        attributes: user.attributes || {},
      }));
    } catch (error) {
      console.error('Error searching users in Authentik:', error);
      return [];
    }
  }

  public async listUsers(searchTerm?: string, page: number = 1, pageSize: number = 500): Promise<{
    users: AuthentikUser[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  }> {
    if (!this.isActive) {
      return {
        users: [],
        total: 0,
        page: 1,
        pageSize: 0,
        hasMore: false,
      };
    }

    try {
      const params = new URLSearchParams({
        page_size: pageSize.toString(),
        page: page.toString(),
      });

      if (searchTerm) {
        params.append('search', searchTerm);
      }

      const response = await this.makeRequest(`core/users/?${params.toString()}`, 'GET', undefined, 30000); // 30 second timeout for user listing
      const users = response.results.map((user: any) => ({
        pk: user.pk,
        username: user.username,
        email: user.email,
        name: user.name,
        is_active: user.is_active,
        groups: user.groups || [],
        attributes: user.attributes || {},
        last_login: user.last_login,
      }));

      return {
        users,
        total: response.count || 0,
        page,
        pageSize,
        hasMore: !!response.next,
      };
    } catch (error) {
      console.error('Error listing users from Authentik:', error);
      return {
        users: [],
        total: 0,
        page: 1,
        pageSize: 0,
        hasMore: false,
      };
    }
  }

  public async listAllUsers(searchTerm?: string): Promise<AuthentikUser[]> {
    if (!this.isActive) return [];

    try {
      let allUsers: AuthentikUser[] = [];
      let page = 1;
      let hasMore = true;
      const pageSize = 500;
      const maxRetries = 3;
      const maxPages = 20; // Safety limit to prevent infinite loops

      console.log('Fetching all users from Authentik...');

      while (hasMore && page <= maxPages) {
        let retry = 0;
        let response;

        while (retry < maxRetries) {
          try {
            response = await this.listUsers(searchTerm, page, pageSize);
            break;
          } catch (error) {
            retry++;
            if (retry >= maxRetries) {
              console.error(`Failed to fetch page ${page} after ${maxRetries} attempts:`, error);
              throw error;
            }
            console.warn(`Error fetching page ${page}, retrying (${retry}/${maxRetries}):`, error);
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
          }
        }

        if (!response || !response.users || response.users.length === 0) {
          console.log(`No more users found on page ${page}, stopping pagination`);
          break;
        }

        allUsers = allUsers.concat(response.users);
        hasMore = response.hasMore && response.users.length === pageSize;
        page++;

        console.log(`Fetched page ${page - 1}: ${response.users.length} users (total: ${allUsers.length})`);
        
        // If we got fewer users than page size, we've reached the end
        if (response.users.length < pageSize) {
          console.log(`Received ${response.users.length} users (less than page size ${pageSize}), reached end`);
          hasMore = false;
        }
      }

      if (page > maxPages) {
        console.warn(`Reached maximum page limit (${maxPages}), there may be more users`);
      }

      console.log(`Fetched ${allUsers.length} total users from Authentik`);
      return allUsers;
    } catch (error) {
      console.error('Error fetching all users from Authentik:', error);
      return [];
    }
  }

  // Invite creation functionality
  public async createInvite(options: {
    label: string;
    expires: Date;
    email?: string;
    name?: string;
    groups?: string[];
    createdBy?: string;
  }): Promise<{
    success: boolean;
    error?: string;
    invite_link?: string;
    invite_id?: string;
    expiry?: string;
  }> {
    if (!this.isActive || !this.config) {
      return {
        success: false,
        error: 'Authentik service not configured',
      };
    }

    try {
      // Prepare fixed data for invitation
      const fixedData: Record<string, any> = {};
      
      if (options.email) {
        fixedData.email = options.email;
      }
      
      if (options.groups && options.groups.length > 0) {
        fixedData.groups = options.groups;
      }
      
      if (options.createdBy) {
        fixedData.created_by = options.createdBy;
      }

      // Sanitize label to ensure it's a valid slug
      const sanitizedLabel = options.label
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_-]/g, '');

      const inviteData = {
        name: sanitizedLabel,
        expires: options.expires.toISOString(),
        fixed_data: fixedData,
        single_use: true,
        flow: this.config.inviteFlowId || this.config.flowId,
      };

      console.log('Creating invite with data:', { ...inviteData, fixed_data: '...' });

      const response = await this.makeRequest(
        '/stages/invitation/invitations/',
        'POST',
        inviteData
      );

      if (!response.pk) {
        throw new Error('API response missing pk field');
      }

      // Construct the invite link
      const baseDomain = process.env.BASE_DOMAIN || 'irregularchat.com';
      const inviteLabel = process.env.INVITE_LABEL || 'invite-enrollment-flow';
      const inviteLink = `https://sso.${baseDomain}/if/flow/${inviteLabel}/?itoken=${response.pk}`;

      console.log('Successfully created invite:', response.pk);

      return {
        success: true,
        invite_link: inviteLink,
        invite_id: response.pk,
        expiry: options.expires.toISOString(),
      };

    } catch (error) {
      console.error('Error creating invite:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Get available groups for invite assignment
  public async getGroups(): Promise<Array<{ pk: string; name: string }>> {
    if (!this.isActive || !this.config) {
      return [];
    }

    try {
      const response = await this.makeRequest('/core/groups/');
      return response.results || [];
    } catch (error) {
      console.error('Error fetching groups:', error);
      return [];
    }
  }
}

// Singleton instance
export const authentikService = new AuthentikService();
export type { CreateUserPayload, CreateUserResponse, AuthentikUser };