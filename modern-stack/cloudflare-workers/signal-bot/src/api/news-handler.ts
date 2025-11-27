/**
 * News Article Scraping Handler
 *
 * Handles article scraping, AI summarization, and optional Discourse posting
 */

import { Env } from '../index';

export interface ScrapeRequest {
  url: string;
  sourceNumber: string;
  sourceName: string;
  groupId?: string;
}

export interface ScrapeResponse {
  title?: string;
  summary?: string;
  content?: string;
  discourseUrl?: string;
}

/**
 * Simplified article content extraction
 * Note: Mozilla Readability requires JSDOM which isn't available in Workers
 * We'll use a simpler approach with regex and text extraction
 */
function extractArticleContent(html: string, url: string): {
  title?: string;
  content?: string;
  excerpt?: string;
} {
  try {
    // Extract title from <title> tag or <h1>
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i) ||
                       html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const title = titleMatch ? titleMatch[1].trim() : undefined;

    // Extract meta description
    const descMatch = html.match(/<meta\s+(?:name|property)=["']description["'][^>]*content=["']([^"']+)["']/i);
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

    return { title, content, excerpt };
  } catch (error) {
    console.error('Content extraction error:', error);
    return {};
  }
}

/**
 * Generate AI summary using OpenAI GPT-5-mini
 */
async function generateSummary(content: string, title: string | undefined, env: Env): Promise<string> {
  try {
    const openaiKey = env.OPENAI_API_KEY;
    if (!openaiKey) {
      console.warn('OPENAI_API_KEY not configured');
      return 'AI summarization not available (API key missing)';
    }

    // Truncate content if too long
    const truncated = content.substring(0, 3000);

    const prompt = `Summarize this article in ONE concise sentence (max 280 characters). Focus on the most important fact or development.

Title: ${title || 'Unknown'}

Article:
${truncated}`;

    console.log('Calling OpenAI for summarization...');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Using gpt-4o-mini as fallback until GPT-5 available
        messages: [
          {
            role: 'system',
            content: 'You are an expert article summarizer. Create single sentence summaries under 280 characters that capture the most important fact.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 100
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      return `AI summarization failed (${response.status})`;
    }

    const data: any = await response.json();
    const summary = data.choices?.[0]?.message?.content?.trim();

    if (!summary) {
      console.error('No summary in OpenAI response');
      return 'Failed to generate summary';
    }

    console.log('Generated summary:', summary.substring(0, 100));
    return summary;

  } catch (error) {
    console.error('Summary generation error:', error);
    return `AI summarization error: ${error instanceof Error ? error.message : 'Unknown'}`;
  }
}

/**
 * Post article to Discourse forum (optional)
 */
async function postToDiscourse(
  url: string,
  title: string | undefined,
  summary: string,
  sourceName: string,
  env: Env
): Promise<string | undefined> {
  try {
    const discourseUrl = env.DISCOURSE_URL;
    const discourseApiKey = env.DISCOURSE_API_KEY;
    const discourseUsername = env.DISCOURSE_USERNAME || 'system';

    if (!discourseUrl || !discourseApiKey) {
      console.log('Discourse not configured, skipping forum post');
      return undefined;
    }

    const category = env.DISCOURSE_NEWS_CATEGORY || 'news';
    const postTitle = title || 'News Article';

    const postContent = `${summary}

🔗 Source: ${url}
📎 Shared by: ${sourceName}

---
*Automatically posted by Signal Bot*`;

    console.log('Posting to Discourse:', postTitle);

    const response = await fetch(`${discourseUrl}/posts.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': discourseApiKey,
        'Api-Username': discourseUsername
      },
      body: JSON.stringify({
        title: postTitle,
        raw: postContent,
        category
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Discourse API error:', response.status, errorText);
      return undefined;
    }

    const data: any = await response.json();
    const topicId = data.topic_id;

    if (topicId) {
      const topicUrl = `${discourseUrl}/t/${topicId}`;
      console.log('Posted to Discourse:', topicUrl);
      return topicUrl;
    }

    return undefined;

  } catch (error) {
    console.error('Discourse posting error:', error);
    return undefined;
  }
}

/**
 * Main handler for /api/news/scrape endpoint
 */
export async function handleScrape(request: Request, env: Env): Promise<Response> {
  try {
    const body: ScrapeRequest = await request.json();
    const { url, sourceNumber, sourceName, groupId } = body;

    if (!url) {
      return new Response(JSON.stringify({
        success: false,
        error: 'URL is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`📰 Scraping article: ${url}`);

    // Fetch the article
    const articleResponse = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SignalBot/3.0; +https://signal-bot.example.com)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!articleResponse.ok) {
      console.error(`Failed to fetch article: ${articleResponse.status}`);
      return new Response(JSON.stringify({
        success: false,
        error: `Failed to fetch article: ${articleResponse.status} ${articleResponse.statusText}`
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const html = await articleResponse.text();
    console.log(`Fetched HTML: ${html.length} bytes`);

    // Extract article content
    const article = extractArticleContent(html, url);

    if (!article.content) {
      console.error('Failed to extract article content');
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to extract article content'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`Extracted article: ${article.title}`);

    // Generate AI summary
    const summary = await generateSummary(article.content, article.title, env);

    // Save to D1 database
    try {
      if (env.DB) {
        await env.DB.prepare(`
          INSERT INTO news_links (id, url, domain, title, summary, group_id, posted_by, posted_by_name, post_count, first_posted_at, last_posted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT(url, group_id) DO UPDATE SET
            post_count = post_count + 1,
            last_posted_at = ?
        `).bind(
          `news-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          url,
          new URL(url).hostname.replace(/^www\./, ''),
          article.title || 'Untitled',
          summary,
          groupId || null,
          sourceNumber,
          sourceName,
          Math.floor(Date.now() / 1000),
          Math.floor(Date.now() / 1000),
          Math.floor(Date.now() / 1000)
        ).run();

        console.log('Saved to D1 database');
      }
    } catch (dbError) {
      console.error('D1 save error (non-critical):', dbError);
    }

    // Post to Discourse (optional)
    let discourseUrl: string | undefined;
    try {
      discourseUrl = await postToDiscourse(url, article.title, summary, sourceName, env);
    } catch (discourseError) {
      console.error('Discourse posting error (non-critical):', discourseError);
    }

    // Return response
    const response: ScrapeResponse = {
      title: article.title,
      summary,
      content: article.content.substring(0, 500), // Return first 500 chars
      discourseUrl
    };

    console.log('✅ Scraping completed successfully');

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Scrape-Success': 'true'
      }
    });

  } catch (error) {
    console.error('Article scraping error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : undefined
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
