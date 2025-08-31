// Advanced Web Scraper Plugin for Signal Bot
import BasePlugin from '../base.js';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

class ScraperPlugin extends BasePlugin {
  constructor() {
    super('scraper');
    this.bypassMethods = {
      'archive.org': 'https://web.archive.org/web/',
      'archive.today': 'https://archive.today/',
      '12ft.io': 'https://12ft.io/',
      'outline.com': 'https://outline.com/',
      'scribe.rip': 'https://scribe.rip/'
    };
    
    // Comprehensive news domains for auto-detection
    this.newsDomains = [
      // Major News Networks
      'nytimes.com', 'washingtonpost.com', 'wsj.com', 'ft.com', 'economist.com',
      'reuters.com', 'apnews.com', 'bbc.com', 'cnn.com', 'foxnews.com',
      'npr.org', 'guardian.com', 'independent.co.uk', 'telegraph.co.uk',
      'usatoday.com', 'abcnews.go.com', 'cbsnews.com', 'nbcnews.com',
      'pbs.org', 'axios.com', 'politico.com', 'thehill.com', 'vox.com',
      
      // Business & Finance
      'bloomberg.com', 'forbes.com', 'fortune.com', 'marketwatch.com',
      'cnbc.com', 'businessinsider.com', 'barrons.com', 'fool.com',
      'seekingalpha.com', 'thestreet.com',
      
      // Technology
      'techcrunch.com', 'arstechnica.com', 'theverge.com', 'wired.com',
      'engadget.com', 'gizmodo.com', 'zdnet.com', 'cnet.com', 'mashable.com',
      'recode.net', 'venturebeat.com', 'theinformation.com', 'protocol.com',
      
      // International
      'aljazeera.com', 'dw.com', 'france24.com', 'rt.com', 'sputniknews.com',
      'scmp.com', 'japantimes.co.jp', 'theage.com.au', 'smh.com.au',
      'stuff.co.nz', 'cbc.ca', 'globeandmail.com', 'thestar.com',
      
      // Alternative & Independent
      'propublica.org', 'intercept.com', 'motherjones.com', 'thenation.com',
      'theatlantic.com', 'newyorker.com', 'harpers.org', 'newrepublic.com',
      'slate.com', 'salon.com', 'huffpost.com', 'dailybeast.com',
      
      // Science & Health
      'nature.com', 'sciencemag.org', 'newscientist.com', 'nationalgeographic.com',
      'scientificamerican.com', 'statnews.com', 'healthline.com',
      
      // Specialized
      'thehackernews.com', 'krebsonsecurity.com', 'darkreading.com',
      'bleepingcomputer.com', 'securityweek.com', 'threatpost.com',
      
      // Blogging Platforms (for news content)
      'medium.com', 'substack.com', 'ghost.org'
    ];
  }

  async init() {
    await super.init();
    
    // Initialize custom domains and stats
    if (!this.data.customDomains) {
      this.data.customDomains = [];
    }
    if (!this.data.newsStats) {
      this.data.newsStats = {
        detected: 0,
        posted: 0,
        failed: 0,
        lastReset: Date.now(),
        recentDetections: []
      };
    }
    
    // Register commands
    this.registerCommand('scrape', this.handleScrape, {
      description: 'Advanced article scraping with AI summary',
      usage: 'scrape <url>',
      rateLimit: 10
    });
    
    this.registerCommand('wayback', this.handleWayback, {
      description: 'Get Wayback Machine archive link',
      usage: 'wayback <url>',
      rateLimit: 5
    });
    
    this.registerCommand('outline', this.handleOutline, {
      description: 'Get Outline.com reader link',
      usage: 'outline <url>',
      rateLimit: 5
    });
    
    this.registerCommand('bypass', this.handleBypass, {
      description: 'Get paywall bypass links',
      usage: 'bypass <url>',
      rateLimit: 5
    });
    
    this.registerCommand('tldr', this.handleTLDR, {
      description: 'Get article summary',
      usage: 'tldr <url>',
      aliases: ['summary'],
      rateLimit: 10
    });

    // Admin commands for news domain management
    this.registerCommand('newsadd', this.handleNewsAdd, {
      description: 'Add a domain to news detection list',
      usage: 'newsadd <domain>',
      adminOnly: true
    });

    this.registerCommand('newsremove', this.handleNewsRemove, {
      description: 'Remove a domain from news detection list',
      usage: 'newsremove <domain>',
      adminOnly: true
    });

    this.registerCommand('newslist', this.handleNewsList, {
      description: 'Show current news domains',
      usage: 'newslist [filter]',
      rateLimit: 10
    });

    this.registerCommand('newsstats', this.handleNewsStats, {
      description: 'Show news detection statistics',
      usage: 'newsstats',
      rateLimit: 10
    });
    
    // Register hooks for auto-detection (disabled for now to prevent duplicate responses)
    // this.registerHook('message', this.detectNewsUrls.bind(this));
  }

  async handleScrape(ctx) {
    const { args, replyContext } = ctx;
    
    // Get URLs from args or reply context
    let urls = [];
    if (args) {
      urls = this.extractAllUrls(args);
    } else if (replyContext?.urls?.length > 0) {
      urls = replyContext.urls;
    } else if (replyContext?.quotedText) {
      urls = this.extractAllUrls(replyContext.quotedText);
    }
    
    if (urls.length === 0) {
      return '❌ Please provide a URL to scrape or reply to a message with URLs';
    }
    
    // Process first URL (can be extended for multiple URLs)
    const url = urls[0];
    
    try {
      this.log(`Scraping URL: ${url}`);
      
      // Try direct scraping first
      let content = await this.scrapeDirectly(url);
      
      // If direct scraping fails or is paywalled, try bypass methods
      if (!content || this.isPaywalled(content)) {
        this.log('Direct scraping failed or paywalled, trying bypass methods...');
        content = await this.scrapeWithBypass(url);
      }
      
      if (!content) {
        return '❌ Failed to scrape article content';
      }
      
      // Generate summary using AI plugin
      let summary = '';
      const summaryResult = await this.generateSummary(content);
      if (summaryResult?.summary) {
        summary = summaryResult.summary;
      }
      
      // Format response
      const response = this.formatScrapedContent(url, content, summary);
      
      return response;
    } catch (error) {
      this.error('Scraping failed:', error);
      return `❌ Failed to scrape: ${error.message}`;
    }
  }

  async handleWayback(ctx) {
    const { args, replyContext } = ctx;
    
    // Use reply context if no direct args provided
    let targetUrl = args;
    if (!args && replyContext?.urls?.length > 0) {
      targetUrl = replyContext.urls[0];
    }
    
    if (!targetUrl) {
      return '❌ Please provide a URL or reply to a message with a URL';
    }
    
    const url = this.extractUrl(targetUrl);
    if (!url) {
      return '❌ Invalid URL provided';
    }
    
    return `📚 Wayback Machine:\n${this.bypassMethods['archive.org']}${url}`;
  }

  async handleOutline(ctx) {
    const { args, replyContext } = ctx;
    
    // Use reply context if no direct args provided
    let targetUrl = args;
    if (!args && replyContext?.urls?.length > 0) {
      targetUrl = replyContext.urls[0];
    }
    
    if (!targetUrl) {
      return '❌ Please provide a URL or reply to a message with a URL';
    }
    
    const url = this.extractUrl(targetUrl);
    if (!url) {
      return '❌ Invalid URL provided';
    }
    
    return `📖 Outline Reader:\n${this.bypassMethods['outline.com']}${url}`;
  }

  async handleBypass(ctx) {
    const { args, replyContext } = ctx;
    
    // Get URLs from args or reply context
    let urls = [];
    if (args) {
      urls = this.extractAllUrls(args);
    } else if (replyContext?.urls?.length > 0) {
      urls = replyContext.urls;
    } else if (replyContext?.quotedText) {
      urls = this.extractAllUrls(replyContext.quotedText);
    }
    
    if (urls.length === 0) {
      return '❌ Please provide a URL or reply to a message with URLs';
    }
    
    const url = urls[0];
    
    const links = [];
    links.push('🔓 Bypass Links:');
    links.push(`• Archive.org: ${this.bypassMethods['archive.org']}${url}`);
    links.push(`• Archive.today: ${this.bypassMethods['archive.today']}${url}`);
    links.push(`• 12ft.io: ${this.bypassMethods['12ft.io']}${url}`);
    
    if (url.includes('medium.com')) {
      links.push(`• Scribe.rip: ${url.replace('medium.com', 'scribe.rip')}`);
    }
    
    return links.join('\n');
  }

  async handleTLDR(ctx) {
    const { args, replyContext } = ctx;
    
    this.log('TLDR command received with args:', args);
    
    // Get URLs from args or reply context
    let urls = [];
    if (args) {
      urls = this.extractAllUrls(args);
    } else if (replyContext?.urls?.length > 0) {
      urls = replyContext.urls;
    } else if (replyContext?.quotedText) {
      urls = this.extractAllUrls(replyContext.quotedText);
    }
    
    this.log('Extracted URLs:', urls);
    
    if (urls.length === 0) {
      return '❌ Please provide a URL or reply to a message with URLs';
    }
    
    const url = urls[0];
    this.log('Processing URL:', url);
    
    try {
      // Scrape content
      this.log('Starting direct scrape...');
      let content = await this.scrapeDirectly(url);
      
      this.log('Direct scrape result:', content ? 'Success' : 'Failed');
      
      if (!content || this.isPaywalled(content)) {
        this.log('Trying bypass methods...');
        content = await this.scrapeWithBypass(url);
        this.log('Bypass scrape result:', content ? 'Success' : 'Failed');
      }
      
      if (!content) {
        this.error('No content retrieved from URL');
        return '❌ Failed to get article content';
      }
      
      this.log('Content retrieved, generating summary...');
      
      // Generate summary
      const summary = await this.generateSummary(content);
      
      this.log('Summary result:', summary);
      
      // Ensure summary is under 300 chars
      let summaryText = summary.summary || 'Unable to generate summary';
      if (summaryText.length > 300) {
        summaryText = summaryText.substring(0, 297) + '...';
      }
      
      return `📝 TL;DR:\n${summaryText}\n\n🔗 Original: ${url}`;
    } catch (error) {
      this.error('TLDR generation failed - Full error:', error);
      this.error('Error stack:', error.stack);
      return `❌ Failed to generate summary: ${error.message}`;
    }
  }

  async detectNewsUrls(message) {
    const { text, sender, groupId, isGroup } = message;
    
    // Check if auto-posting is enabled
    if (process.env.SCRAPERAUTOPOST !== 'true') return;
    
    // Extract URLs from message
    const urls = this.extractAllUrls(text);
    
    for (const url of urls) {
      // Check if it's a news domain
      if (this.isNewsDomain(url)) {
        this.log(`Detected news URL: ${url}`);
        
        // Update statistics
        this.data.newsStats.detected++;
        this.data.newsStats.recentDetections.push({
          url,
          timestamp: Date.now(),
          sender,
          groupId
        });
        
        // Keep only last 50 detections
        if (this.data.newsStats.recentDetections.length > 50) {
          this.data.newsStats.recentDetections = this.data.newsStats.recentDetections.slice(-50);
        }
        
        try {
          // Auto-scrape and post to discourse
          await this.autoPostToDiscourse(url, { sender, groupId, isGroup });
          this.data.newsStats.posted++;
        } catch (error) {
          this.error('Auto-posting failed:', error);
          this.data.newsStats.failed++;
        }
        
        await this.saveData();
      }
    }
  }

  async autoPostToDiscourse(url, context) {
    // Rate limiting: don't auto-post more than 1 per minute
    const lastPost = this.data.lastAutoPost || 0;
    const now = Date.now();
    if (now - lastPost < 60000) { // 1 minute
      this.log('Auto-post rate limited, skipping');
      return;
    }

    try {
      // Scrape the article
      let content = await this.scrapeDirectly(url);
      
      if (!content || this.isPaywalled(content)) {
        content = await this.scrapeWithBypass(url);
      }
      
      if (!content) {
        throw new Error('Failed to scrape article content');
      }

      // Generate AI summary
      const summaryResult = await this.generateSummary(content);
      const summary = summaryResult?.summary || 'Unable to generate summary';

      // Get discourse plugin
      const discoursePlugin = this.getPlugin('discourse');
      if (!discoursePlugin) {
        throw new Error('Discourse plugin not available');
      }

      // Get group name if available
      let groupName = null;
      if (context.isGroup && context.groupId) {
        groupName = `Group-${context.groupId.slice(-8)}`; // Use last 8 chars of group ID
      }
      
      // Generate enhanced post content using discourse plugin's method
      const postContent = await discoursePlugin.generatePostContent({
        url,
        title: content.title,
        articleContent: content,
        sender: 'news-detector',
        autoPost: true,
        groupName
      });
      
      // Create the forum post
      const result = await discoursePlugin.createForumPost(postContent);
      
      if (!result.success) {
        throw new Error(`Failed to create forum post: ${result.error}`);
      }
      
      // Send enhanced notification to the chat where news was detected (no markdown`)
      const headline = postContent.title || content.title || 'News Article';
      const bypassLinks = this.generateBypassLinks(url);
      const responseMessage = `✅ Posted to forum! ${headline}\n🔗 ${process.env.DISCOURSEURL ? process.env.DISCOURSEURL + '/t/' + result.topicId : 'forum'}\n🔍 Bypass: ${bypassLinks.twelve}`;
      
      this.log(`Auto-posted article: ${headline} (Topic ID: ${result.topicId})`);

      // Send the response back to the original chat
      this.emit('send-response', {
        message: responseMessage,
        groupId: context.isGroup ? context.groupId : null,
        recipient: context.isGroup ? null : context.sender
      });
      
      // Save duplicate prevention data
      await discoursePlugin.setData(`posted${discoursePlugin.hashUrl(url)}`, {
        url,
        topicId: result.topicId,
        postedAt: Date.now()
      });

      this.data.lastAutoPost = now;
      await this.saveData();
      
    } catch (error) {
      this.error('Auto-posting to discourse failed:', error);
      throw error;
    }
  }

  async scrapeDirectly(url) {
    try {
      const timeout = parseInt(process.env.SCRAPERTIMEOUT || '30000');
      const userAgent = process.env.SCRAPERUSERAGENT || 'Mozilla/5.0 (Compatible) SignalBot/1.0';
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const html = await response.text();
      
      // Parse with JSDOM and Readability
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      
      if (!article) {
        return null;
      }
      
      return {
        title: article.title,
        content: article.textContent,
        excerpt: article.excerpt,
        byline: article.byline,
        siteName: article.siteName,
        publishedTime: this.extractPublishedTime(dom.window.document)
      };
    } catch (error) {
      this.error('Direct scraping failed:', error);
      return null;
    }
  }

  async scrapeWithBypass(url) {
    // Try different bypass methods
    const methods = [
      { name: 'archive.org', fn: () => this.scrapeArchiveOrg(url) },
      { name: '12ft.io', fn: () => this.scrape12ft(url) },
      { name: 'archive.today', fn: () => this.scrapeArchiveToday(url) }
    ];
    
    for (const method of methods) {
      try {
        this.log(`Trying bypass method: ${method.name}`);
        const content = await method.fn();
        if (content) {
          return content;
        }
      } catch (error) {
        this.debug(`${method.name} failed:`, error);
      }
    }
    
    return null;
  }

  async scrapeArchiveOrg(url) {
    try {
      // Check if URL is already archived
      const checkUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
      const response = await fetch(checkUrl);
      const data = await response.json();
      
      if (data.archivedsnapshots?.closest?.url) {
        // Scrape the archived version
        return await this.scrapeDirectly(data.archivedsnapshots.closest.url);
      }
      
      return null;
    } catch (error) {
      this.error('Archive.org scraping failed:', error);
      return null;
    }
  }

  async scrape12ft(url) {
    try {
      const bypassUrl = `https://12ft.io/proxy?q=${encodeURIComponent(url)}`;
      return await this.scrapeDirectly(bypassUrl);
    } catch (error) {
      this.error('12ft.io scraping failed:', error);
      return null;
    }
  }

  async scrapeArchiveToday(url) {
    try {
      // Archive.today requires a different approach
      // This is a simplified version
      const checkUrl = `https://archive.today/${url}`;
      return await this.scrapeDirectly(checkUrl);
    } catch (error) {
      this.error('Archive.today scraping failed:', error);
      return null;
    }
  }

  async generateSummary(content) {
    try {
      // Use AI plugin if available
      const aiPlugin = this.getPlugin('ai');
      this.log('AI Plugin lookup:', aiPlugin ? 'Found' : 'Not found');
      
      if (!aiPlugin) {
        this.error('AI plugin not available');
        return { summary: 'AI plugin not available for summarization' };
      }
      
      const text = typeof content === 'string' ? content : content.content;
      this.log('Content length:', text ? text.length : 0);
      
      const truncated = this.truncateText(text, 3000);
      this.log('Truncated content length:', truncated.length);
      
      const prompt = `Summarize this article in ONE sentence (max 280 characters):\n\n${truncated}`;
      
      this.log('Calling AI plugin for summarization...');
      
      // Use AI plugin with optimized model for summarization
      const aiResponse = await aiPlugin.handleAIQuery(
        prompt,
        'summarization',
        'You are an expert article summarizer. Create a single sentence summary under 280 characters that captures the most important fact or development.'
      );
      
      this.log('AI Response received:', aiResponse ? aiResponse.substring(0, 100) : 'No response');
      
      return {
        summary: aiResponse || 'Failed to generate summary',
        keyPoints: []
      };
    } catch (error) {
      this.error('Summary generation failed - Full error:', error);
      this.error('Error stack:', error.stack);
      return { summary: `Failed to generate summary: ${error.message}` };
    }
  }

  formatScrapedContent(url, content, summary) {
    const lines = [];
    
    lines.push(`📰 ${content.title || 'Article'}`);
    
    if (content.byline) {
      lines.push(`Author: ${content.byline}`);
    }
    
    if (content.publishedTime) {
      lines.push(`📅 Published: ${content.publishedTime}`);
    }
    
    lines.push('');
    
    if (summary?.summary) {
      lines.push('Summary:');
      lines.push(summary.summary);
      lines.push('');
    }
    
    if (content.excerpt) {
      lines.push('Excerpt:');
      lines.push(this.truncateText(content.excerpt, 500));
      lines.push('');
    }
    
    // Add bypass links
    lines.push('🔗 Access Links:');
    lines.push(`• Original: ${url}`);
    lines.push(`• Archive: ${this.bypassMethods['archive.org']}${url}`);
    
    if (this.isPaywalled(content)) {
      lines.push(`• 12ft: ${this.bypassMethods['12ft.io']}${url}`);
    }
    
    return lines.join('\n');
  }

  extractUrl(text) {
    // Extract URL from text, handling various formats
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const matches = text.match(urlRegex);
    return matches ? matches[0].replace(/[<>]/g, '') : null;
  }

  extractAllUrls(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const matches = text.match(urlRegex) || [];
    return matches.map(url => url.replace(/[<>]/g, ''));
  }

  extractPublishedTime(document) {
    // Try various meta tags for published time
    const selectors = [
      'meta[property="article:publishedtime"]',
      'meta[name="publishdate"]',
      'meta[name="publishdate"]',
      'time[datetime]',
      '.published-date',
      '.post-date'
    ];
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.getAttribute('content') || 
               element.getAttribute('datetime') || 
               element.textContent;
      }
    }
    
    return null;
  }

  isNewsDomain(url) {
    // Check built-in domains
    const builtInMatch = this.newsDomains.some(domain => url.includes(domain));
    
    // Check custom domains
    const customMatch = this.data.customDomains && 
      this.data.customDomains.some(domain => url.includes(domain));
    
    return builtInMatch || customMatch;
  }

  getAllNewsDomains() {
    return [...this.newsDomains, ...(this.data.customDomains || [])];
  }

  isPaywalled(content) {
    if (!content) return false;
    
    const paywallIndicators = [
      'subscribe to read',
      'subscription required',
      'members only',
      'premium content',
      'sign in to continue',
      'create a free account'
    ];
    
    const text = (typeof content === 'string' ? content : content.content || '').toLowerCase();
    return paywallIndicators.some(indicator => text.includes(indicator));
  }

  generateBypassLinks(url) {
    const links = {
      archive: `${this.bypassMethods['archive.org']}${url}`,
      twelve: `${this.bypassMethods['12ft.io']}${url}`,
      outline: `${this.bypassMethods['outline.com']}${url}`
    };
    
    if (url.includes('medium.com')) {
      links.scribe = url.replace('medium.com', 'scribe.rip');
    }
    
    return links;
  }

  // Admin command handlers for news domain management
  async handleNewsAdd(ctx) {
    const { args } = ctx;
    
    if (!args) {
      return '❌ Please provide a domain or URL to add\nUsage: !newsadd example.com or !newsadd https://example.com/article';
    }
    
    let domain = args.toLowerCase().trim();
    
    // Extract domain from URL if a full URL was provided
    if (domain.startsWith('http://') || domain.startsWith('https://')) {
      try {
        const url = new URL(domain);
        domain = url.hostname;
        // Remove www. prefix if present
        if (domain.startsWith('www.')) {
          domain = domain.substring(4);
        }
      } catch (error) {
        return '❌ Invalid URL format. Please provide a valid URL or domain.';
      }
    } else {
      // If just a domain, clean it up
      // Remove www. prefix if present
      if (domain.startsWith('www.')) {
        domain = domain.substring(4);
      }
      // Remove any path if accidentally included
      if (domain.includes('/')) {
        domain = domain.split('/')[0];
      }
    }
    
    // Validate domain format
    if (!domain.includes('.') || domain.includes(' ')) {
      return '❌ Invalid domain format. Use: example.com';
    }
    
    // Check if already exists
    const allDomains = this.getAllNewsDomains();
    if (allDomains.includes(domain)) {
      return `❌ Domain "${domain}" is already in the news detection list`;
    }
    
    // Add to custom domains
    this.data.customDomains.push(domain);
    await this.saveData();
    
    return `✅ Added "${domain}" to news detection list\nTotal domains: ${this.getAllNewsDomains().length}`;
  }

  async handleNewsRemove(ctx) {
    const { args } = ctx;
    
    if (!args) {
      return '❌ Please provide a domain to remove\nUsage: !newsremove example.com';
    }
    
    const domain = args.toLowerCase().trim();
    
    // Check if it's a built-in domain
    if (this.newsDomains.includes(domain)) {
      return `❌ Cannot remove built-in domain "${domain}". Only custom domains can be removed.`;
    }
    
    // Check if exists in custom domains
    const index = this.data.customDomains.indexOf(domain);
    if (index === -1) {
      return `❌ Domain "${domain}" not found in custom domains list`;
    }
    
    // Remove from custom domains
    this.data.customDomains.splice(index, 1);
    await this.saveData();
    
    return `✅ Removed "${domain}" from news detection list\nTotal domains: ${this.getAllNewsDomains().length}`;
  }

  async handleNewsList(ctx) {
    const { args } = ctx;
    const filter = args ? args.toLowerCase() : '';
    
    const allDomains = this.getAllNewsDomains();
    const filteredDomains = filter 
      ? allDomains.filter(domain => domain.includes(filter))
      : allDomains;
    
    if (filteredDomains.length === 0) {
      return filter 
        ? `❌ No domains found matching "${filter}"`
        : '❌ No domains configured';
    }
    
    const lines = [];
    lines.push(`📰 News Domains ${filter ? `(filtered: "${filter}")` : ''}`);
    lines.push(`Total: ${filteredDomains.length} domains`);
    lines.push('');
    
    // Group by categories
    const builtin = filteredDomains.filter(d => this.newsDomains.includes(d));
    const custom = filteredDomains.filter(d => this.data.customDomains.includes(d));
    
    if (builtin.length > 0) {
      lines.push('Built-in Domains:');
      builtin.slice(0, 20).forEach(domain => lines.push(`• ${domain}`));
      if (builtin.length > 20) {
        lines.push(`• ... and ${builtin.length - 20} more`);
      }
      lines.push('');
    }
    
    if (custom.length > 0) {
      lines.push('Custom Domains:');
      custom.forEach(domain => lines.push(`• ${domain}`));
      lines.push('');
    }
    
    lines.push('Use !newsadd <domain> to add or !newsremove <domain> to remove custom domains');
    
    return lines.join('\n');
  }

  async handleNewsStats(ctx) {
    const stats = this.data.newsStats;
    const uptime = Date.now() - stats.lastReset;
    const days = Math.floor(uptime / (24 * 60 * 60 * 1000));
    const hours = Math.floor((uptime % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    
    const lines = [];
    lines.push('📊 News Detection Statistics');
    lines.push('');
    lines.push(`⏱️ Tracking Period: ${days}d ${hours}h`);
    lines.push(`🔍 URLs Detected: ${stats.detected}`);
    lines.push(`✅ Successfully Posted: ${stats.posted}`);
    lines.push(`❌ Failed Posts: ${stats.failed}`);
    
    if (stats.detected > 0) {
      const successRate = Math.round((stats.posted / stats.detected) * 100);
      lines.push(`📈 Success Rate: ${successRate}%`);
    }
    
    lines.push('');
    lines.push(`📚 Domains Monitored: ${this.getAllNewsDomains().length}`);
    lines.push(`🔧 Auto-posting: ${process.env.SCRAPERAUTOPOST === 'true' ? 'Enabled' : 'Disabled'}`);
    
    // Show recent detections
    if (stats.recentDetections && stats.recentDetections.length > 0) {
      lines.push('');
      lines.push('Recent Detections:');
      stats.recentDetections.slice(-5).forEach(detection => {
        const time = new Date(detection.timestamp).toLocaleString();
        const domain = new URL(detection.url).hostname;
        lines.push(`• ${domain} - ${time}`);
      });
    }
    
    return lines.join('\n');
  }
}

export default ScraperPlugin;