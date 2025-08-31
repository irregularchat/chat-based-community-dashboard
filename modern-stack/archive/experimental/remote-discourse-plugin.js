// Discourse Forum Integration Plugin for Signal Bot
import BasePlugin from '../base.js';

class DiscoursePlugin extends BasePlugin {
  constructor() {
    super('discourse');
    this.apiUrl = process.env.DISCOURSEURL;
    this.apiKey = process.env.DISCOURSEAPIKEY;
    this.apiUsername = process.env.DISCOURSEAPIUSERNAME;
    this.defaultCategory = process.env.DISCOURSEDEFAULTCATEGORY || 'general';
    this.fallbackCategoryId = parseInt(process.env.DISCOURSEFALLBACKCATEGORYID) || 9;
    this.requiredTag = process.env.DISCOURSEREQUIREDTAG || 'posted-link';
    this.postQueue = [];
    this.processing = false;
    this.categories = new Map(); // Cache for category name -> ID mapping
    this.categoriesLoaded = false;
  }

  async init() {
    await super.init();
    
    if (!this.apiUrl || !this.apiKey || !this.apiUsername) {
      this.error('Discourse configuration missing');
      this.enabled = false;
      return;
    }
    
    // Register commands
    this.registerCommand('fpost', this.handleForumPost, {
      description: 'Post article to forum',
      usage: 'fpost [options] <url> [title]',
      rateLimit: 30
    });
    
    this.registerCommand('fsearch', this.handleForumSearch, {
      description: 'Search forum posts',
      usage: 'fsearch <query>',
      rateLimit: 10
    });
    
    this.registerCommand('flatest', this.handleLatestPosts, {
      description: 'Show latest forum posts',
      usage: 'flatest [count]',
      rateLimit: 10
    });
    
    this.registerCommand('fnew', this.handleNewTopics, {
      description: 'Show newest topics',
      usage: 'fnew [count]',
      rateLimit: 10
    });
    
    this.registerCommand('fcategories', this.handleCategories, {
      description: 'List forum categories',
      usage: 'fcategories',
      rateLimit: 30
    });
    
    this.registerCommand('fstatus', this.handleStatus, {
      description: 'Check forum connection',
      usage: 'fstatus',
      adminOnly: true
    });
    
    this.registerCommand('aggregate', this.handleAggregate, {
      description: 'Aggregate and post messages',
      usage: 'aggregate [options]',
      rateLimit: 60
    });
    
    // Admin commands for category management
    this.registerCommand('freload', this.handleReloadCategories, {
      description: 'Reload categories and tags from Discourse API',
      usage: 'freload',
      adminOnly: true
    });
    
    this.registerCommand('ftags', this.handleTags, {
      description: 'List available forum tags',
      usage: 'ftags',
      rateLimit: 30
    });
    
    // Register hooks for auto-posting
    this.registerHook('news-detected', this.autoPostNews.bind(this));
    
    // Load categories and tags on init
    await this.loadCategoriesAndTags();
  }

  async loadCategoriesAndTags() {
    try {
      this.log('Loading categories and tags from Discourse...');
      
      // Load categories
      const categoriesResponse = await fetch(`${this.apiUrl}/categories.json`, {
        headers: {
          'Api-Key': this.apiKey,
          'Api-Username': this.apiUsername
        }
      });
      
      if (categoriesResponse.ok) {
        const categoriesData = await categoriesResponse.json();
        const categories = categoriesData.category_list?.categories || [];
        
        // Build category mapping
        this.categories.clear();
        categories.forEach(cat => {
          this.categories.set(cat.name.toLowerCase(), {
            id: cat.id,
            name: cat.name,
            slug: cat.slug,
            description: cat.description || '',
            topiccount: cat.topic_count || 0
          });
        });
        
        this.log(`Loaded ${categories.length} categories`);
        this.categoriesLoaded = true;
      } else {
        this.error('Failed to load categories:', categoriesResponse.status);
      }
      
      // Load tags
      const tagsResponse = await fetch(`${this.apiUrl}/tags.json`, {
        headers: {
          'Api-Key': this.apiKey,
          'Api-Username': this.apiUsername
        }
      });
      
      if (tagsResponse.ok) {
        const tagsData = await tagsResponse.json();
        const tags = tagsData.tags || [];
        
        // Store tags with metadata
        this.data.availableTags = tags.map(tag => ({
          id: tag.id,
          name: tag.name || tag.text || tag,
          count: tag.count || 0
        }));
        
        this.log(`Loaded ${tags.length} tags`);
      } else {
        this.error('Failed to load tags:', tagsResponse.status);
      }
      
      // Store categories in persistent data
      this.data.categories = Array.from(this.categories.entries()).map(([name, data]) => ({
        name,
        ...data
      }));
      
      // Set a safe default category (first available category that's not reserved)
      this.safeCategoryId = this.findSafeDefaultCategory();
      
      this.data.lastCategoryUpdate = Date.now();
      await this.saveData();
      
    } catch (error) {
      this.error('Failed to load categories and tags:', error);
    }
  }

  findSafeDefaultCategory() {
    // First, try to find "unsorted" since that's our target category (ID 9)
    const unsortedCategory = this.categories.get('unsorted');
    if (unsortedCategory) {
      this.log(`Using safe default category: ${unsortedCategory.name} (ID: ${unsortedCategory.id})`);
      return unsortedCategory.id;
    }
    
    // Try general safe category patterns that might exist
    const safeCategoryPatterns = ['general', 'uncategorized', 'misc', 'other', 'discussion', 'community', 'off topic'];
    
    for (const pattern of safeCategoryPatterns) {
      const categoryData = this.categories.get(pattern.toLowerCase());
      if (categoryData) {
        this.log(`Using safe default category: ${categoryData.name} (ID: ${categoryData.id})`);
        return categoryData.id;
      }
    }
    
    // Log all available categories for debugging
    const availableCategories = Array.from(this.categories.entries()).map(([name, data]) => `${data.name} (ID: ${data.id})`);
    this.log(`Available categories: ${availableCategories.join(', ')}`);
    
    // Use the first available category as a last resort
    const firstCategory = this.categories.values().next().value;
    if (firstCategory) {
      this.log(`Using first available category as default: ${firstCategory.name} (ID: ${firstCategory.id})`);
      return firstCategory.id;
    }
    
    // Ultimate fallback to environment variable (category ID 9 - unsorted)
    this.log(`No categories found, using env fallback category ID: ${this.fallbackCategoryId} (unsorted)`);
    return this.fallbackCategoryId;
  }

  async analyzeContentForCategorization(content) {
    try {
      // Get available categories and tags
      const availableCategories = Array.from(this.categories.values()).map(cat => 
        `${cat.name} (${cat.description})`
      ).join(', ');
      
      const availableTags = this.data.availableTags?.map(tag => tag.name).join(', ') || '';
      
      // Use AI to analyze content
      const aiPlugin = this.getPlugin('ai');
      if (!aiPlugin) {
        return this.getDomainBasedCategorization(content.url);
      }
      
      const analysisPrompt = `Analyze this article and recommend the best category and tags:

Article Title: ${content.title || 'No title'}
URL: ${content.url}
Content Preview: ${(content.body || content.excerpt || '').substring(0, 500)}

Available Categories: ${availableCategories}

Available Tags: ${availableTags}

Please respond in this exact format:
CATEGORY: [category name from available list]
TAGS: [2-4 most relevant tags from available list, comma-separated]
REASONING: [brief explanation]`;

      const aiResponse = await aiPlugin.handleAIQuery(
        analysisPrompt,
        'categorization',
        'You are an expert content categorizer for forum management. Analyze article content and provide accurate category and tag recommendations.'
      );
      
      if (aiResponse) {
        return this.parseAICategorizationResponse(aiResponse, content.url);
      }
      
      // Fallback to domain-based
      return this.getDomainBasedCategorization(content.url);
      
    } catch (error) {
      this.error('Content analysis failed:', error);
      return this.getDomainBasedCategorization(content.url);
    }
  }

  parseAICategorizationResponse(aiResponse, url) {
    try {
      const lines = aiResponse.split('\n');
      let category = null;
      let tags = [];
      
      for (const line of lines) {
        if (line.startsWith('CATEGORY:')) {
          const categoryName = line.replace('CATEGORY:', '').trim();
          category = this.categories.get(categoryName.toLowerCase());
        } else if (line.startsWith('TAGS:')) {
          const tagNames = line.replace('TAGS:', '').trim().split(',');
          tags = tagNames.map(tag => tag.trim()).filter(tag => 
            this.data.availableTags?.some(availableTag => 
              availableTag.name.toLowerCase() === tag.toLowerCase()
            )
          );
        }
      }
      
      // Fallback if parsing failed
      if (!category) {
        category = this.getDomainBasedCategorization(url).category;
      }
      
      return {
        category: category || this.categories.get(this.defaultCategory.toLowerCase()),
        tags: tags.slice(0, 4), // Limit to 4 tags
        source: 'ai-analysis'
      };
      
    } catch (error) {
      this.error('Failed to parse AI response:', error);
      return this.getDomainBasedCategorization(url);
    }
  }

  getDomainBasedCategorization(url) {
    try {
      const domain = new URL(url).hostname.toLowerCase();
      
      // Domain-based category mapping
      const domainRules = {
        // Technology
        'techcrunch.com': { category: 'technology', tags: ['tech', 'startup', 'news'] },
        'arstechnica.com': { category: 'technology', tags: ['tech', 'science', 'analysis'] },
        'theverge.com': { category: 'technology', tags: ['tech', 'consumer', 'review'] },
        'wired.com': { category: 'technology', tags: ['tech', 'innovation', 'future'] },
        'engadget.com': { category: 'technology', tags: ['tech', 'gadgets', 'consumer'] },
        
        // Business/Finance
        'bloomberg.com': { category: 'business', tags: ['finance', 'markets', 'economy'] },
        'cnbc.com': { category: 'business', tags: ['finance', 'business', 'markets'] },
        'forbes.com': { category: 'business', tags: ['business', 'entrepreneur', 'finance'] },
        'wsj.com': { category: 'business', tags: ['finance', 'business', 'news'] },
        
        // Security
        'krebsonsecurity.com': { category: 'security', tags: ['cybersecurity', 'hacking', 'privacy'] },
        'thehackernews.com': { category: 'security', tags: ['cybersecurity', 'malware', 'threats'] },
        'bleepingcomputer.com': { category: 'security', tags: ['cybersecurity', 'malware', 'tech'] },
        
        // Science
        'nature.com': { category: 'science', tags: ['research', 'science', 'academic'] },
        'scientificamerican.com': { category: 'science', tags: ['science', 'research', 'discovery'] },
        
        // General News
        'bbc.com': { category: 'news', tags: ['world', 'news', 'current-events'] },
        'cnn.com': { category: 'news', tags: ['news', 'politics', 'world'] },
        'reuters.com': { category: 'news', tags: ['news', 'breaking', 'world'] }
      };
      
      const rule = domainRules[domain];
      if (rule) {
        const category = this.categories.get(rule.category.toLowerCase());
        return {
          categoryId: category ? category.id : (this.safeCategoryId || this.findSafeDefaultCategory()),
          tags: rule.tags,
          source: 'domain-based'
        };
      }
      
      // Default fallback
      return {
        categoryId: this.safeCategoryId || this.findSafeDefaultCategory(),
        tags: ['auto-posted'],
        source: 'default'
      };
      
    } catch (error) {
      this.error('Domain-based categorization failed:', error);
      return {
        categoryId: this.safeCategoryId || this.findSafeDefaultCategory(),
        tags: ['auto-posted'],
        source: 'error-fallback'
      };
    }
  }

  async handleForumPost(ctx) {
    const { args, sender, groupId } = ctx;
    
    if (!args) {
      return '❌ Usage: !fpost [options] <url> [title]\n' +
             'Options: -n <count> (messages), -h <hours>, -m <minutes>, -d <days>';
    }
    
    try {
      // Parse options and arguments
      const parsed = this.parsePostOptions(args);
      
      if (!parsed.url) {
        return '❌ Please provide a URL to post';
      }
      
      // Get context messages if requested
      let contextMessages = [];
      if (parsed.options.messageCount > 0) {
        contextMessages = this.getRecentMessages(parsed.options.messageCount, { groupId });
      } else if (parsed.options.timeRange) {
        const afterTime = Date.now() - parsed.options.timeRange;
        contextMessages = this.getRecentMessages(100, { groupId, afterTime });
      }
      
      // Check for duplicate
      const isDuplicate = await this.checkDuplicate(parsed.url);
      if (isDuplicate) {
        return '⚠️ This article has already been posted to the forum';
      }
      
      // Get article content (integrate with scraper plugin)
      const scraperPlugin = this.getPlugin('scraper');
      let articleContent = null;
      
      if (scraperPlugin) {
        try {
          articleContent = await scraperPlugin.scrapeDirectly(parsed.url);
          this.debug('Scraped article content:', articleContent?.title || 'No title');
        } catch (error) {
          this.debug('Article scraping failed:', error.message);
        }
      }
      
      // Get group name if available
      let groupName = null;
      if (groupId) {
        // For now, use a simple identifier - in the future we could cache group names
        groupName = `Group-${groupId.slice(-8)}`; // Use last 8 chars of group ID
      }
      
      // Generate post content
      const postContent = await this.generatePostContent({
        url: parsed.url,
        title: parsed.title,
        articleContent,
        contextMessages,
        sender,
        groupName
      });
      
      // Create forum post
      const result = await this.createForumPost(postContent);
      
      if (result.success) {
        // Save to prevent duplicates
        await this.setData(`posted${this.hashUrl(parsed.url)}`, {
          url: parsed.url,
          topicId: result.topicId,
          postedAt: Date.now()
        });
        
        // Enhanced response format with headline and bypass links (no markdown)
        const headline = postContent.title || 'Article Posted';
        const bypassLinks = this.generateBypassLinks(parsed.url);
        
        return `✅ Posted to forum! ${headline}\n🔗 ${this.apiUrl}/t/${result.topicId}\n🔍 Bypass: ${bypassLinks.twelve}`;
      } else {
        return `❌ Failed to post: ${result.error}`;
      }
    } catch (error) {
      this.error('Forum post failed:', error);
      return `❌ Failed to post: ${error.message}`;
    }
  }

  async handleForumSearch(ctx) {
    const { args } = ctx;
    
    if (!args) {
      return '❌ Please provide a search query';
    }
    
    try {
      const results = await this.searchForum(args);
      
      if (results.length === 0) {
        return '❌ No results found';
      }
      
      const formatted = results.slice(0, 5).map((post, i) => 
        `${i + 1}. ${post.title}\n   ${this.apiUrl}/t/${post.id}`
      ).join('\n\n');
      
      return `🔍 Search Results:\n\n${formatted}`;
    } catch (error) {
      this.error('Forum search failed:', error);
      return `❌ Search failed: ${error.message}`;
    }
  }

  async handleLatestPosts(ctx) {
    const { argsList } = ctx;
    const count = parseInt(argsList[0]) || 5;
    
    try {
      const posts = await this.getLatestPosts(count);
      
      if (posts.length === 0) {
        return '❌ No posts found';
      }
      
      const formatted = posts.map((post, i) => 
        `${i + 1}. ${post.title}\n   👤 ${post.username} | 💬 ${post.posts_count}\n   ${this.apiUrl}/t/${post.id}`
      ).join('\n\n');
      
      return `📰 Latest Posts:\n\n${formatted}`;
    } catch (error) {
      this.error('Failed to get latest posts:', error);
      return `❌ Failed to get posts: ${error.message}`;
    }
  }

  async handleNewTopics(ctx) {
    const { argsList } = ctx;
    const count = parseInt(argsList[0]) || 5;
    
    try {
      const topics = await this.getNewTopics(count);
      
      if (topics.length === 0) {
        return '❌ No topics found';
      }
      
      // Compact format for new topics
      const formatted = topics.map((topic, i) => 
        `${i + 1}. ${this.truncateText(topic.title, 50)} - ${topic.username}`
      ).join('\n');
      
      return `🆕 New Topics:\n${formatted}`;
    } catch (error) {
      this.error('Failed to get new topics:', error);
      return `❌ Failed to get topics: ${error.message}`;
    }
  }

  async handleCategories(ctx) {
    try {
      const categories = await this.getCategories();
      
      const formatted = categories.map(cat => 
        `• ${cat.name} (ID: ${cat.id})`
      ).join('\n');
      
      return `📁 Forum Categories:\n${formatted}`;
    } catch (error) {
      this.error('Failed to get categories:', error);
      return `❌ Failed to get categories: ${error.message}`;
    }
  }

  async handleStatus(ctx) {
    try {
      const status = await this.checkConnection();
      
      if (status.connected) {
        return `✅ Forum Connection Active\n               Site: ${this.apiUrl}\n               User: ${this.apiUsername}\n               Posts in queue: ${this.postQueue.length}`;
      } else {
        return `❌ Forum Connection Failed\n${status.error}`;
      }
    } catch (error) {
      return `❌ Connection check failed: ${error.message}`;
    }
  }

  async handleAggregate(ctx) {
    const { args, groupId } = ctx;
    
    try {
      // Parse options
      const parsed = this.parseAggregateOptions(args);
      
      // Get messages based on options
      let messages = [];
      if (parsed.messageCount) {
        messages = this.getRecentMessages(parsed.messageCount, { groupId });
      } else if (parsed.timeRange) {
        const afterTime = Date.now() - parsed.timeRange;
        messages = this.getRecentMessages(1000, { groupId, afterTime });
      } else {
        messages = this.getRecentMessages(10, { groupId });
      }
      
      if (messages.length === 0) {
        return '❌ No messages to aggregate';
      }
      
      // Generate aggregated content
      const content = await this.generateAggregatedContent(messages, parsed.title);
      
      // Post to forum
      const result = await this.createForumPost(content);
      
      if (result.success) {
        return `✅ Aggregated ${messages.length} messages to forum!\n🔗 ${this.apiUrl}/t/${result.topicId}`;
      } else {
        return `❌ Failed to post: ${result.error}`;
      }
    } catch (error) {
      this.error('Aggregation failed:', error);
      return `❌ Aggregation failed: ${error.message}`;
    }
  }

  async handleReloadCategories(ctx) {
    try {
      await this.loadCategoriesAndTags();
      const categoryCount = this.categories.size;
      const tagCount = this.data.availableTags ? this.data.availableTags.length : 0;
      
      return `✅ Categories and tags reloaded from Discourse API\n             📁 Categories: ${categoryCount}\n             🏷️ Tags: ${tagCount}`;
    } catch (error) {
      this.error('Failed to reload categories:', error);
      return `❌ Failed to reload categories: ${error.message}`;
    }
  }

  async handleTags(ctx) {
    try {
      if (!this.data.availableTags || this.data.availableTags.length === 0) {
        await this.loadCategoriesAndTags();
      }
      
      if (!this.data.availableTags || this.data.availableTags.length === 0) {
        return '❌ No tags found';
      }
      
      // Group tags by first letter for better organization
      const tagsByLetter = {};
      this.data.availableTags.forEach(tagObj => {
        const tag = tagObj.name || tagObj;
        const letter = tag.charAt(0).toUpperCase();
        if (!tagsByLetter[letter]) {
          tagsByLetter[letter] = [];
        }
        tagsByLetter[letter].push(tag);
      });
      
      const lines = ['🏷️ Available Forum Tags:', ''];
      Object.keys(tagsByLetter).sort().forEach(letter => {
        lines.push(`${letter}: ${tagsByLetter[letter].join(', ')}`);
      });
      
      return lines.join('\n');
    } catch (error) {
      this.error('Failed to get tags:', error);
      return `❌ Failed to get tags: ${error.message}`;
    }
  }

  async autoPostNews(data) {
    const { url, bypassLinks, sender, groupId } = data;
    
    if (process.env.DISCOURSEAUTOPOST !== 'true') return;
    
    try {
      // Add to post queue
      this.postQueue.push({
        url,
        bypassLinks,
        sender,
        groupId,
        timestamp: Date.now()
      });
      
      // Process queue
      if (!this.processing) {
        await this.processPostQueue();
      }
    } catch (error) {
      this.error('Auto-post failed:', error);
    }
  }

  async processPostQueue() {
    this.processing = true;
    
    while (this.postQueue.length > 0) {
      const item = this.postQueue.shift();
      
      try {
        // Add delay between posts
        const delay = parseInt(process.env.DISCOURSEPOSTDELAY || '5000');
        await this.sleep(delay);
        
        // Check for duplicate
        const isDuplicate = await this.checkDuplicate(item.url);
        if (!isDuplicate) {
          // Generate and create post
          const content = await this.generatePostContent({
            url: item.url,
            bypassLinks: item.bypassLinks,
            sender: item.sender,
            autoPost: true
          });
          
          await this.createForumPost(content);
        }
      } catch (error) {
        this.error('Queue processing error:', error);
      }
    }
    
    this.processing = false;
  }

  async createForumPost(content) {
    try {
      // Ensure categories and tags are loaded
      if (!this.categories || Object.keys(this.categories).length === 0) {
        await this.loadCategoriesAndTags();
      }
      
      // Use smart categorization for new posts
      let categoryId = content.category || this.defaultCategory;
      let postTags = content.tags || [];
      
      // Always add required tag if not already present
      if (!postTags.includes(this.requiredTag)) {
        postTags.push(this.requiredTag);
      }
      
      // Only run categorization for articles/news content (not manual posts with explicit categories)
      if (!content.category && content.url) {
        try {
          const categorization = await this.analyzeContentForCategorization(content);
          if (categorization.categoryId) {
            categoryId = categorization.categoryId;
          }
          if (categorization.tags && categorization.tags.length > 0) {
            postTags = categorization.tags;
          }
        } catch (error) {
          this.debug('Categorization failed, using defaults:', error.message);
        }
      }
      
      // Ensure categoryId is numeric (required by Discourse API)
      if (typeof categoryId === 'string') {
        const categoryData = this.categories.get(categoryId.toLowerCase());
        if (categoryData) {
          categoryId = categoryData.id;
        } else {
          this.debug(`Unknown category "${categoryId}", using default`);
          // Use safe default category instead of hardcoded fallback
          categoryId = this.safeCategoryId || this.findSafeDefaultCategory();
        }
      }
      
      const response = await fetch(`${this.apiUrl}/posts.json`, {
        method: 'POST',
        headers: {
          'Api-Key': this.apiKey,
          'Api-Username': this.apiUsername,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: content.title,
          raw: content.body,
          category: categoryId,
          tags: postTags
        })
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${error}`);
      }
      
      const data = await response.json();
      
      return {
        success: true,
        topicId: data.topic_id,
        postId: data.id
      };
    } catch (error) {
      this.error('Create post failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async searchForum(query) {
    try {
      const response = await fetch(`${this.apiUrl}/search.json?q=${encodeURIComponent(query)}`, {
        headers: {
          'Api-Key': this.apiKey,
          'Api-Username': this.apiUsername
        }
      });
      
      if (!response.ok) {
        throw new Error('Search failed');
      }
      
      const data = await response.json();
      return data.topics || [];
    } catch (error) {
      this.error('Search failed:', error);
      return [];
    }
  }

  async getLatestPosts(count = 5) {
    try {
      const response = await fetch(`${this.apiUrl}/latest.json`, {
        headers: {
          'Api-Key': this.apiKey,
          'Api-Username': this.apiUsername
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to get latest posts');
      }
      
      const data = await response.json();
      return (data.topic_list?.topics || []).slice(0, count);
    } catch (error) {
      this.error('Get latest failed:', error);
      return [];
    }
  }

  async getNewTopics(count = 5) {
    try {
      const response = await fetch(`${this.apiUrl}/new.json`, {
        headers: {
          'Api-Key': this.apiKey,
          'Api-Username': this.apiUsername
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to get new topics');
      }
      
      const data = await response.json();
      return (data.topic_list?.topics || []).slice(0, count);
    } catch (error) {
      this.error('Get new topics failed:', error);
      return [];
    }
  }

  async getCategories() {
    try {
      const response = await fetch(`${this.apiUrl}/categories.json`, {
        headers: {
          'Api-Key': this.apiKey,
          'Api-Username': this.apiUsername
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to get categories');
      }
      
      const data = await response.json();
      return data.category_list?.categories || [];
    } catch (error) {
      this.error('Get categories failed:', error);
      return [];
    }
  }

  async checkConnection() {
    try {
      const response = await fetch(`${this.apiUrl}/about.json`, {
        headers: {
          'Api-Key': this.apiKey,
          'Api-Username': this.apiUsername
        }
      });
      
      return {
        connected: response.ok,
        error: response.ok ? null : `Status: ${response.status}`
      };
    } catch (error) {
      return {
        connected: false,
        error: error.message
      };
    }
  }

  async checkDuplicate(url) {
    const hash = this.hashUrl(url);
    const existing = await this.getData(`posted${hash}`);
    
    if (existing) {
      // Check if post is recent (within 24 hours)
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      return existing.postedAt > dayAgo;
    }
    
    return false;
  }

  async generatePostContent(options) {
    const { url, title, articleContent, contextMessages, bypassLinks, sender, autoPost, groupName } = options;
    
    const lines = [];
    let postTitle = title || articleContent?.title || 'Shared Article';
    let summary = '';
    let authorInfo = '';
    
    // Enhanced content scraping if not provided
    let scrapedContent = articleContent;
    if (!scrapedContent) {
      const scraperPlugin = this.getPlugin('scraper');
      if (scraperPlugin) {
        try {
          scrapedContent = await scraperPlugin.scrapeDirectly(url);
          this.debug('Enhanced scraping completed:', scrapedContent?.title || 'No title');
        } catch (error) {
          this.debug('Enhanced scraping failed:', error.message);
        }
      }
    }
    
    // Update title if we got better content
    if (scrapedContent?.title) {
      postTitle = scrapedContent.title;
    }
    
    // Extract author information
    if (scrapedContent?.byline) {
      authorInfo = `Author: ${scrapedContent.byline}\n\n`;
    }
    
    // Generate AI summary of main points
    if (scrapedContent?.content) {
      const aiPlugin = this.getPlugin('ai');
      if (aiPlugin) {
        try {
          const summaryPrompt = `Summarize this article into 3-4 main bullet points. Focus on the key facts and implications:\n\n${this.truncateText(scrapedContent.content, 3000)}`;
          const aiResponse = await aiPlugin.handleAIQuery(
            summaryPrompt,
            'summarization',
            'You are a content summarization expert. Provide clear, concise summaries in bullet points that highlight the main facts and key implications.'
          );
          if (aiResponse && !aiResponse.includes('❌')) {
            summary = aiResponse;
          }
        } catch (error) {
          this.debug('AI summarization failed:', error.message);
        }
      }
      
      // Fallback to excerpt if AI summary failed
      if (!summary && scrapedContent.excerpt) {
        summary = scrapedContent.excerpt;
      }
    }
    
    // Add author at the top
    if (authorInfo) {
      lines.push(authorInfo);
    }
    
    // Add AI-generated summary of main points
    if (summary) {
      lines.push('## Key Points');
      lines.push(summary);
      lines.push('');
    }
    
    // Add Signal group context if provided
    if (groupName && autoPost) {
      lines.push(`Originally shared in ${groupName}`);
      lines.push('');
    }
    
    // Add context messages if provided
    if (contextMessages && contextMessages.length > 0) {
      lines.push('## Discussion Context');
      lines.push('Recent messages leading to this post:');
      lines.push('');
      contextMessages.slice(-5).forEach(msg => {
        lines.push(`• ${this.truncateText(msg.text, 100)}`);
      });
      lines.push('');
      lines.push('');
    }
    
    // Add links section
    lines.push('## Links');
    lines.push(`🔗 [Original Article](${url})`);
    
    // Add bypass links
    if (bypassLinks || process.env.ENABLEPAYWALLBYPASS === 'true') {
      lines.push(`📚 [Archive.org](https://web.archive.org/web/${url})`);
      lines.push(`📖 [12ft.io](https://12ft.io/${url})`);
    }
    
    // Add metadata footer
    lines.push('');
    lines.push('---');
    if (groupName) {
      lines.push(`Posted from ${groupName} via Signal Bot`);
    } else {
      lines.push(`Posted via Signal Bot`);
    }
    
    // Perform smart categorization with enhanced content
    let categorization;
    try {
      categorization = await this.analyzeContentForCategorization({
        url,
        title: postTitle,
        body: scrapedContent?.content || '',
        excerpt: scrapedContent?.excerpt || summary
      });
    } catch (error) {
      this.debug('Smart categorization failed:', error.message);
      categorization = this.getDomainBasedCategorization(url);
    }
    
    return {
      title: postTitle,
      body: lines.join('\n'),
      category: categorization.category?.id || this.safeCategoryId || 9,
      tags: [...(categorization.tags || []), process.env.DISCOURSEREQUIREDTAG || 'posted-link'].filter(Boolean),
      url: url // Include URL for reference
    };
  }

  async generateAggregatedContent(messages, customTitle) {
    const lines = [];
    
    // Title
    const title = customTitle || `Discussion Summary - ${new Date().toLocaleDateString()}`;
    
    // Participants count (without revealing identities)
    const participantCount = [...new Set(messages.map(m => m.sender))].length;
    lines.push('## Participants');
    lines.push(`${participantCount} participant${participantCount !== 1 ? 's' : ''}`);
    lines.push('');
    
    // Message count and timeframe
    const firstMsg = messages[0];
    const lastMsg = messages[messages.length - 1];
    const duration = lastMsg.timestamp - firstMsg.timestamp;
    
    lines.push('## Overview');
    lines.push(`- Messages: ${messages.length}`);
    lines.push(`- Duration: ${this.formatDuration(duration)}`);
    lines.push('');
    
    // Key messages
    lines.push('## Discussion');
    messages.forEach(msg => {
      lines.push(`• ${msg.text}`);
      lines.push('');
    });
    
    // AI summary if available
    if (process.env.AI_PROVIDER) {
      lines.push('## AI Summary');
      lines.push('Summary generation pending AI integration');
      lines.push('');
    }
    
    lines.push('---');
    lines.push('Aggregated from Signal group discussion');
    
    return {
      title,
      body: lines.join('\n'),
      category: this.defaultCategory
    };
  }

  parsePostOptions(args) {
    const parts = args.split(' ');
    const options = {
      messageCount: 0,
      timeRange: null
    };
    
    let url = null;
    let title = [];
    let i = 0;
    
    while (i < parts.length) {
      const part = parts[i];
      
      if (part === '-n' && parts[i + 1]) {
        options.messageCount = parseInt(parts[i + 1]);
        i += 2;
      } else if (part === '-h' && parts[i + 1]) {
        options.timeRange = parseInt(parts[i + 1]) * 60 * 60 * 1000;
        i += 2;
      } else if (part === '-m' && parts[i + 1]) {
        options.timeRange = parseInt(parts[i + 1]) * 60 * 1000;
        i += 2;
      } else if (part === '-d' && parts[i + 1]) {
        options.timeRange = parseInt(parts[i + 1]) * 24 * 60 * 60 * 1000;
        i += 2;
      } else if (part.startsWith('http')) {
        url = part;
        i++;
      } else {
        title.push(part);
        i++;
      }
    }
    
    return {
      url,
      title: title.join(' ') || null,
      options
    };
  }

  parseAggregateOptions(args) {
    if (!args) {
      return { messageCount: 10 };
    }
    
    const parts = args.split(' ');
    const options = {};
    let title = [];
    let i = 0;
    
    while (i < parts.length) {
      const part = parts[i];
      
      if (part === '-n' && parts[i + 1]) {
        options.messageCount = parseInt(parts[i + 1]);
        i += 2;
      } else if (part === '-h' && parts[i + 1]) {
        options.timeRange = parseInt(parts[i + 1]) * 60 * 60 * 1000;
        i += 2;
      } else if (part === '-m' && parts[i + 1]) {
        options.timeRange = parseInt(parts[i + 1]) * 60 * 1000;
        i += 2;
      } else if (part === '-d' && parts[i + 1]) {
        options.timeRange = parseInt(parts[i + 1]) * 24 * 60 * 60 * 1000;
        i += 2;
      } else if (part === '-u' && parts[i + 1]) {
        options.user = parts[i + 1];
        i += 2;
      } else {
        title.push(part);
        i++;
      }
    }
    
    options.title = title.join(' ') || null;
    return options;
  }

  hashUrl(url) {
    // Simple hash function for URL deduplication
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  extractTags(text) {
    // Extract potential tags from text
    const commonTags = ['tech', 'news', 'discussion', 'article', 'tutorial'];
    const tags = [];
    
    commonTags.forEach(tag => {
      if (text.toLowerCase().includes(tag)) {
        tags.push(tag);
      }
    });
    
    return tags.slice(0, 5); // Discourse usually limits tags
  }

  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    return `${seconds} second${seconds > 1 ? 's' : ''}`;
  }
  
  // Generate bypass links for paywall circumvention
  generateBypassLinks(url) {
    const bypassMethods = {
      'archive.org': 'https://web.archive.org/web/*/',
      '12ft.io': 'https://12ft.io/',
      'outline.com': 'https://outline.com/'
    };
    
    return {
      archive: `${bypassMethods['archive.org']}${url}`,
      twelve: `${bypassMethods['12ft.io']}${url}`,
      outline: `${bypassMethods['outline.com']}${url}`
    };
  }
}

export default DiscoursePlugin;