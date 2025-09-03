const crypto = require('crypto');

class AuthentikService {
  constructor() {
    this.config = null;
    this.isActive = false;
    this.initializeFromEnv();
  }

  initializeFromEnv() {
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

  isConfigured() {
    return this.isActive && !!this.config;
  }

  async makeRequest(endpoint, method = 'GET', data = null) {
    if (!this.config) {
      throw new Error('Authentik service not configured');
    }

    const url = `${this.config.apiUrl}/${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.config.apiToken}`,
      'Content-Type': 'application/json',
    };

    const options = {
      method,
      headers,
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
      console.error(`Authentik API request failed: ${method} ${url}`, error);
      throw error;
    }
  }

  generateSecurePassphrase() {
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
    const specialChars = ['!', '@', '#', '$', '%', '^', '&', '*'];
    const specialChar = specialChars[Math.floor(Math.random() * specialChars.length)];
    
    return `${selectedWords.join('')}${randomNumber}${specialChar}`;
  }

  async generateUsername(firstName) {
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

  async checkUsernameExists(username) {
    if (!this.isActive) return false;

    try {
      const users = await this.makeRequest(`core/users/?username=${encodeURIComponent(username)}`);
      return users.results && users.results.length > 0;
    } catch (error) {
      console.error('Error checking username existence:', error);
      return false;
    }
  }

  async createUser(userData) {
    if (!this.isActive) {
      return {
        success: false,
        error: 'Authentik service not configured',
      };
    }

    try {
      // Generate secure password if not provided
      const tempPassword = userData.password || this.generateSecurePassphrase();
      
      // Prepare user data for Authentik API
      const authentikUserData = {
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
        error: error.message || 'Unknown error occurred',
      };
    }
  }

  async createInvite(email, firstName, lastName, invitedBy) {
    if (!this.isActive || !this.config?.inviteFlowId) {
      return {
        success: false,
        error: 'Authentik invite service not configured',
      };
    }

    try {
      const inviteData = {
        email,
        flow: this.config.inviteFlowId,
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
        fixed_data: {
          attributes: {
            invited_by: invitedBy,
            first_name: firstName,
            last_name: lastName,
          }
        }
      };

      const response = await this.makeRequest('stages/invitation/invitations/', 'POST', inviteData);

      return {
        success: true,
        invite_id: response.pk,
        invite_link: `${this.config.apiUrl.replace('/api/v3', '')}/if/flow/${this.config.inviteFlowId}/?invitation=${response.pk}`,
      };
    } catch (error) {
      console.error('Error creating invite:', error);
      return {
        success: false,
        error: error.message || 'Unknown error occurred',
      };
    }
  }
}

module.exports = new AuthentikService();