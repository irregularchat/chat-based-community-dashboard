class DiscourseService {
  constructor() {
    this.config = null;
    this.initializeConfig();
  }

  initializeConfig() {
    const url = process.env.DISCOURSE_URL;
    const apiKey = process.env.DISCOURSE_API_KEY;
    const apiUsername = process.env.DISCOURSE_API_USERNAME;
    const categoryId = process.env.DISCOURSE_CATEGORY_ID;
    const introTag = process.env.DISCOURSE_INTRO_TAG;
    const active = process.env.DISCOURSE_ACTIVE === 'true';

    if (url && apiKey && apiUsername && categoryId) {
      this.config = {
        url: url.endsWith('/') ? url.slice(0, -1) : url,
        apiKey,
        apiUsername,
        categoryId: parseInt(categoryId, 10),
        introTag,
        active,
      };
      console.log('Discourse service configured:', {
        url: this.config.url,
        categoryId: this.config.categoryId,
        apiUsername: this.config.apiUsername,
        active: this.config.active,
      });
    } else {
      console.log('Discourse service not configured - missing required environment variables');
    }
  }

  isConfigured() {
    return this.config !== null && this.config.active;
  }

  getMissingConfigs() {
    const missing = [];
    if (!process.env.DISCOURSE_URL) missing.push('DISCOURSE_URL');
    if (!process.env.DISCOURSE_API_KEY) missing.push('DISCOURSE_API_KEY');
    if (!process.env.DISCOURSE_API_USERNAME) missing.push('DISCOURSE_API_USERNAME');
    if (!process.env.DISCOURSE_CATEGORY_ID) missing.push('DISCOURSE_CATEGORY_ID');
    if (process.env.DISCOURSE_ACTIVE !== 'true') missing.push('DISCOURSE_ACTIVE (set to true)');
    return missing;
  }

  async createIntroductionPost(data) {
    if (!this.isConfigured()) {
      const missing = this.getMissingConfigs();
      return {
        success: false,
        error: `Discourse integration not configured. Missing: ${missing.join(', ')}`,
      };
    }

    try {
      const { username, intro, invitedBy, organization, interests } = data;

      // Create post title
      const title = `Introduction: ${username}`;

      // Format intro text
      let introText = intro || 'No introduction provided.';
      if (introText) {
        introText = introText.trim();
        // Ensure there are no more than two consecutive line breaks
        introText = introText.replace(/\n{3,}/g, '\n\n');
      }

      // Build formatted content
      let formattedContent = `This is ${username}\n\nIntroduction:\n${introText}`;

      // Add organization and interests if available
      if (organization) {
        formattedContent += `\n\n**Organization:** ${organization}`;
      }

      if (interests) {
        formattedContent += `\n**Interests:** ${interests}`;
      }

      formattedContent += `\n\nInvited by: ${invitedBy || 'Not specified'}\n\n_Use this post to link to your introduction in the chats and have IrregularChat Members find you based on your interests or offerings._\nNotice that Login is required to view any of the Community posts. Please help maintain community privacy.`;

      // Prepare request data
      const postData = {
        title,
        raw: formattedContent,
        category: this.config.categoryId,
      };

      // Add tags if configured
      if (this.config.introTag) {
        postData.tags = [this.config.introTag];
      }

      // Create headers
      const headers = {
        'Api-Key': this.config.apiKey,
        'Api-Username': this.config.apiUsername,
        'Content-Type': 'application/json',
      };

      // Make API request
      const response = await fetch(`${this.config.url}/posts.json`, {
        method: 'POST',
        headers,
        body: JSON.stringify(postData),
      });

      if (!response.ok) {
        let errorDetail = 'Unknown error';
        try {
          const errorData = await response.json();
          errorDetail = errorData.errors?.join(', ') || response.statusText;
        } catch {
          errorDetail = response.statusText;
        }

        console.error(`Discourse API error (${response.status}):`, errorDetail);
        return {
          success: false,
          error: `Discourse API error: ${errorDetail}`,
        };
      }

      // Parse response
      const responseData = await response.json();
      console.log('Discourse API response:', responseData);

      if (responseData.topic_id) {
        const postUrl = `${this.config.url}/t/${responseData.topic_id}`;
        console.log(`Successfully created Discourse post for ${username} at: ${postUrl}`);
        return {
          success: true,
          postUrl,
        };
      } else {
        console.warn('Created post but couldn\'t get topic_id from response:', responseData);
        return {
          success: true,
          postUrl: undefined,
        };
      }
    } catch (error) {
      console.error('Error creating Discourse post:', error);
      return {
        success: false,
        error: error.message || 'Unknown error',
      };
    }
  }
}

module.exports = new DiscourseService();