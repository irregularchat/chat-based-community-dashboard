/**
 * Discourse Posting Utility
 *
 * Posts news articles and other content to Discourse forum
 * Includes article scraping and AI summarization
 */

import { sanitizeUrl } from './url-scraper.js';
import { cleanURL } from './url-security.js';

/**
 * Normalize URL for consistent duplicate detection
 * - Removes trailing slashes (except for root path)
 * - Removes www. prefix
 * - Lowercases hostname
 * - Removes fragment identifiers (#section)
 */
function normalizeUrlForDedup(url: string): string {
  try {
    const urlObj = new URL(url);

    // Lowercase hostname and remove www.
    urlObj.hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');

    // Remove fragment
    urlObj.hash = '';

    // Remove trailing slash from path (but keep root /)
    if (urlObj.pathname.length > 1 && urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }

    return urlObj.toString();
  } catch {
    // If URL parsing fails, return as-is
    return url;
  }
}

export interface DiscourseConfig {
  url: string;
  apiKey: string;
  apiUsername: string;
  categoryId: string;
}

interface ScrapedArticle {
  title?: string;
  excerpt?: string;
  content?: string;
}

/**
 * Scrape article content from HTML
 */
async function scrapeArticle(url: string): Promise<ScrapedArticle> {
  try {
    console.log(`📰 Scraping article: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      console.error(`Failed to fetch article: ${response.status}`);
      return {};
    }

    const html = await response.text();

    // Extract title from <title> tag or <h1>
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i) ||
                       html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const title = titleMatch ? titleMatch[1].trim().replace(/\s*\|.*$/, '') : undefined; // Remove site name after |

    // Extract meta description
    const descMatch = html.match(/<meta\s+(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']+)["']/i);
    const excerpt = descMatch ? descMatch[1].trim() : undefined;

    // Extract main content - remove script, style, nav, footer, etc.
    let cleaned = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
      .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
      .replace(/<[^>]+>/g, ' ') // Remove all HTML tags
      .replace(/\s+/g, ' ') // Collapse whitespace
      .trim();

    // Limit content length
    const content = cleaned.substring(0, 5000);

    console.log(`✅ Scraped: ${title?.substring(0, 50)}...`);
    return { title, content, excerpt };
  } catch (error) {
    console.error('❌ Scraping error:', error);
    return {};
  }
}

/**
 * Generate AI summary using OpenAI
 */
async function generateSummary(content: string, title?: string): Promise<string> {
  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      console.warn('⚠️  OPENAI_API_KEY not configured');
      return 'AI summarization not available (API key missing)';
    }

    // Truncate content if too long
    const truncated = content.substring(0, 3000);

    const prompt = `Summarize this article in 2-3 concise sentences (max 500 characters). Focus on the most important facts and key developments.

Title: ${title || 'Unknown'}

Article:
${truncated}`;

    console.log('🤖 Generating AI summary...');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert article summarizer. Create concise 2-3 sentence summaries under 500 characters that capture the most important facts.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 150
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ OpenAI API error:', response.status, errorText);
      return `AI summarization failed (${response.status})`;
    }

    const data: any = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim();

    if (!summary) {
      console.error('❌ No summary in OpenAI response');
      return 'Failed to generate summary';
    }

    console.log(`✅ Generated summary: ${summary.substring(0, 100)}...`);
    return summary;

  } catch (error) {
    console.error('❌ Summary generation error:', error);
    return `AI summarization error: ${error instanceof Error ? error.message : 'Unknown'}`;
  }
}

export interface PostNewsArticleParams {
  url: string;
  archiveUrl?: string;
  title?: string;
  excerpt?: string;
  domain?: string;
  sourceNumber?: string;
  sourceName?: string;
  groupId?: string;
}

export interface PostNewsArticleResult {
  success: boolean;
  discourseUrl?: string;
  topicId?: number;
  error?: string;
  isDuplicate?: boolean;
  existingPost?: {
    title?: string;
    summary?: string;
    forumUrl?: string;
    postCount?: number;
    firstPostedAt?: string;
  };
}

// Database client interface (for dependency injection)
export interface DatabaseClient {
  query(sql: string, params?: any[]): Promise<{ results: any[] }>;
  insert(table: string, data: any): Promise<any>;
  update(table: string, data: any, where: string, whereParams: any[]): Promise<any>;
}

/**
 * Post a news article to Discourse with duplicate detection
 */
export async function postNewsArticleToDiscourse(
  params: PostNewsArticleParams,
  config: DiscourseConfig,
  dbClient?: DatabaseClient
): Promise<PostNewsArticleResult> {
  try {
    const { sourceName, sourceNumber, groupId } = params;

    // Sanitize URLs to prevent XSS attacks
    const sanitizedUrl = sanitizeUrl(params.url);
    const archiveUrl = params.archiveUrl ? sanitizeUrl(params.archiveUrl) : null;

    if (!sanitizedUrl) {
      console.warn(`🚨 Blocked malicious URL: ${params.url}`);
      return {
        success: false,
        error: 'Invalid or malicious URL detected',
      };
    }

    // Clean URL by removing tracking parameters for consistent duplicate detection
    const { cleaned: cleanedUrl, hasTracking, removedParams } = cleanURL(sanitizedUrl);

    if (hasTracking) {
      console.log(`🧹 Removed tracking params from URL: ${removedParams.join(', ')}`);
    }

    // Normalize URL for consistent duplicate detection
    const url = normalizeUrlForDedup(cleanedUrl);

    console.log(`🔍 [DISCOURSE-POSTER] Called with params:`, {
      originalUrl: params.url?.substring(0, 80),
      cleanedUrl: url?.substring(0, 80),
      hasArchiveUrl: !!archiveUrl,
      sourceName,
      sourceNumber,
      groupId,
      hasDbClient: !!dbClient
    });

    // Step 1: Check for duplicates in database (if dbClient provided)
    if (dbClient && groupId) {
      console.log(`✅ Performing duplicate check for groupId: ${groupId}, url: ${url?.substring(0, 60)}...`);
      try {
        const existing = await dbClient.query(
          'SELECT url, domain, title, summary, forum_url, post_count, first_posted_at FROM news_links WHERE url = $1 AND group_id = $2 LIMIT 1',
          [url, groupId]
        );

        console.log(`🔍 Database query returned ${existing.results?.length || 0} results`);
        console.log(`🔍 DEBUG existing.results:`, JSON.stringify(existing.results?.slice(0, 2)));
        console.log(`🔍 DEBUG checking condition: existing.results=${!!existing.results}, length=${existing.results?.length}, condition=${existing.results && existing.results.length > 0}`);

        if (existing.results && existing.results.length > 0) {
          const existingPost = existing.results[0];
          console.log(`📋 Duplicate URL detected: ${url} (posted ${existingPost.post_count} times)`);
          console.log(`📋 Existing post forum_url: ${existingPost.forum_url}`);

          // Increment post count (convert to number to avoid string concatenation)
          const newPostCount = Number(existingPost.post_count) + 1;
          console.log(`🔍 DEBUG: post_count=${existingPost.post_count} (type: ${typeof existingPost.post_count}), newPostCount=${newPostCount} (type: ${typeof newPostCount})`);
          console.log(`📋 About to update post_count in database...`);
          await dbClient.update(
            'news_links',
            {
              post_count: newPostCount,
              last_posted_at: new Date().toISOString(),
            },
            'url = ? AND group_id = ?',
            [url, groupId]
          );
          console.log(`✅ Successfully updated post_count, returning duplicate response`);

          // Return existing Discourse post
          return {
            success: true,
            discourseUrl: existingPost.forum_url,
            isDuplicate: true,
            existingPost: {
              title: existingPost.title,
              summary: existingPost.summary,
              forumUrl: existingPost.forum_url,
              postCount: newPostCount,
              firstPostedAt: existingPost.first_posted_at,
            },
          };
        }
      } catch (dbError) {
        console.error('⚠️  Database check failed (non-critical):', dbError);
        // Continue with posting even if database check fails
      }
    } else {
      console.log(`⚠️  Skipping duplicate check - dbClient: ${!!dbClient}, groupId: ${groupId || 'undefined'}`);
    }

    // Step 2: Scrape the article
    const scraped = await scrapeArticle(url);
    const articleTitle = scraped.title || `News Article`;

    // Step 3: Generate AI summary
    let summary = scraped.excerpt || '';
    if (scraped.content && scraped.content.length > 100) {
      summary = await generateSummary(scraped.content, scraped.title);
    } else if (!summary) {
      summary = 'Article content could not be extracted for summarization.';
    }

    // Step 4: Build Discourse post content
    let postBody = `${summary}\n\n`;
    postBody += `---\n\n`;
    postBody += `🔗 **Original**: ${url}\n`;
    if (archiveUrl) {
      postBody += `📎 **Archive**: ${archiveUrl}\n`;
    }
    postBody += `👤 **Shared by**: ${sourceName || 'Unknown'}\n\n`;
    postBody += `*Automatically posted by Signal Bot*`;

    // Remove trailing slash from Discourse URL
    const discourseUrl = config.url.replace(/\/$/, '');
    const createTopicUrl = `${discourseUrl}/posts.json`;

    console.log(`📝 Posting to Discourse: ${articleTitle}`);

    // Make API request
    const response = await fetch(createTopicUrl, {
      method: 'POST',
      headers: {
        'Api-Key': config.apiKey,
        'Api-Username': config.apiUsername,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: articleTitle,
        raw: postBody,
        category: config.categoryId,
        tags: ['news', 'signal-share'],
      }),
    });

    if (!response.ok) {
      let errorDetail = 'Unknown error';
      try {
        const errorData: any = await response.json();
        errorDetail = errorData.errors?.join(', ') || response.statusText;
      } catch {
        errorDetail = response.statusText;
      }

      console.error(`❌ Discourse API error (${response.status}):`, errorDetail);
      return {
        success: false,
        error: `Discourse API error: ${errorDetail}`,
      };
    }

    // Parse response
    const responseData: any = await response.json();
    console.log('✅ Discourse API response:', responseData);

    if (responseData.topic_id) {
      const topicUrl = `${discourseUrl}/t/${responseData.topic_id}`;
      console.log(`✅ Successfully created Discourse post: ${topicUrl}`);

      // Step 5: Save to database (if dbClient provided)
      if (dbClient && groupId) {
        try {
          const domain = new URL(url).hostname.replace(/^www\./, '');
          await dbClient.insert('news_links', {
            id: `news-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            url,
            domain,
            title: articleTitle,
            summary,
            group_id: groupId,
            group_name: params.groupId, // Will be null if not provided
            posted_by: sourceNumber || 'unknown',
            posted_by_name: sourceName || 'Unknown',
            forum_url: topicUrl,
            post_count: 1,
            first_posted_at: new Date().toISOString(),
            last_posted_at: new Date().toISOString(),
          });
          console.log('✅ Saved news link to database');
        } catch (dbError) {
          console.error('⚠️  Database save failed (non-critical):', dbError);
          // Don't fail the request if database save fails
        }
      }

      return {
        success: true,
        discourseUrl: topicUrl,
        topicId: responseData.topic_id,
        isDuplicate: false,
      };
    } else {
      console.warn('⚠️  Created post but couldn\'t get topic_id from response:', responseData);
      return {
        success: true,
        discourseUrl: undefined,
        isDuplicate: false,
      };
    }
  } catch (error) {
    console.error('❌ Error posting to Discourse:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check if Discourse is configured
 */
export function getDiscourseConfig(): DiscourseConfig | null {
  const url = process.env.DISCOURSE_URL;
  const apiKey = process.env.DISCOURSE_API_KEY;
  const apiUsername = process.env.DISCOURSE_USERNAME;
  const categoryId = process.env.DISCOURSE_QA_CATEGORY || process.env.DISCOURSE_CATEGORY_ID;

  if (!url || !apiKey || !apiUsername || !categoryId) {
    console.log('⚠️  Discourse not configured - missing environment variables');
    return null;
  }

  return {
    url: url.endsWith('/') ? url.slice(0, -1) : url,
    apiKey,
    apiUsername,
    categoryId,
  };
}
