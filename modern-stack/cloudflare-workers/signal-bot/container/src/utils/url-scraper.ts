/**
 * URL Content Scraper
 *
 * Fetches and extracts text content from URLs for summarization.
 * Uses axios for HTTP requests and cheerio for HTML parsing.
 */

import axios from 'axios';
import * as cheerio from 'cheerio';

export interface ScrapedContent {
  success: boolean;
  title?: string;
  content?: string;
  description?: string;
  url: string;
  error?: string;
}

/**
 * Blocklist of services that expose infrastructure information
 * These services should be blocked to prevent reconnaissance attacks
 */
const BLOCKED_IP_DISCLOSURE_SERVICES = new Set([
  // IP disclosure services
  'ifconfig.me',
  'ifconfig.co',
  'ifconfig.io',
  'ipinfo.io',
  'api.ipify.org',
  'ipify.org',
  'icanhazip.com',
  'whatismyip.com',
  'myip.com',
  'checkip.amazonaws.com',
  'ipecho.net',
  'ident.me',
  'wtfismyip.com',
  'ip.seeip.org',
  'api.myip.com',
  'ipapi.co',
  'ip-api.com',

  // Port scanners and reconnaissance tools
  'pentest-tools.com',
  'hackertarget.com',
  'nmap.online',
  'portscanner.online',
  't1.daumcdn.net',
  'webscan.cc',
  'spyse.com',
  'shodan.io',
  'censys.io',
  'zoomeye.org',

  // Directory enumeration / vulnerability scanners
  'securityheaders.com',
  'observatory.mozilla.org',
  'ssllabs.com',
  'testssl.sh',
  'wpscan.com',
  'nikto.cirt.net',
  'w3af.org',

  // DNS/subdomain enumeration
  'dnsdumpster.com',
  'subdomainfinder.c99.nl',
  'crt.sh',
  'threatcrowd.org',
]);

/**
 * Check if hostname is an internal/private IP address or localhost
 * Protects against SSRF attacks
 */
function isInternalHost(hostname: string): boolean {
  // Normalize hostname (remove brackets for IPv6)
  const normalizedHost = hostname.replace(/^\[|\]$/g, '');

  // Check for localhost variants
  if (normalizedHost === 'localhost' || normalizedHost === '0.0.0.0' || normalizedHost.startsWith('127.')) {
    return true;
  }

  // Check for private IP ranges (RFC 1918)
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = normalizedHost.match(ipv4Regex);

  if (match) {
    const [, a, b, c, d] = match.map(Number);

    // 10.0.0.0/8
    if (a === 10) return true;

    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;

    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return true;

    // 0.0.0.0/8
    if (a === 0) return true;
  }

  // Check for IPv6 localhost and private addresses
  if (
    normalizedHost === '::1' ||
    normalizedHost === '::' ||
    normalizedHost.startsWith('fe80:') ||
    normalizedHost.startsWith('fc00:') ||
    normalizedHost.startsWith('fd00:')
  ) {
    return true;
  }

  return false;
}

/**
 * Check if hostname is a blocked IP disclosure service
 * Prevents infrastructure reconnaissance
 */
function isBlockedService(hostname: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  return BLOCKED_IP_DISCLOSURE_SERVICES.has(normalizedHost);
}

/**
 * Redact IP addresses from content to prevent information disclosure
 * Replaces IPv4 and IPv6 addresses with [REDACTED]
 */
function redactIPAddresses(content: string): string {
  // IPv4 pattern: matches standard IPv4 addresses
  const ipv4Pattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

  // IPv6 pattern: matches full and compressed IPv6 addresses
  const ipv6Pattern = /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b|\b(?:[0-9a-fA-F]{1,4}:){1,7}:\b|\b::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}\b/g;

  // Replace all IP addresses with [REDACTED]
  let redacted = content.replace(ipv4Pattern, '[IP_REDACTED]');
  redacted = redacted.replace(ipv6Pattern, '[IP_REDACTED]');

  return redacted;
}

/**
 * Scrape content from a URL
 */
export async function scrapeUrl(url: string): Promise<ScrapedContent> {
  try {
    // Validate URL
    const urlObj = new URL(url);

    // Protocol validation: Block dangerous protocols (file://, ftp://, etc.)
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      console.warn(`🚨 Blocked dangerous protocol: ${urlObj.protocol}`);
      return {
        success: false,
        url,
        error: 'Only HTTP and HTTPS URLs are supported',
      };
    }

    // SSRF Protection: Block internal/private IPs
    if (isInternalHost(urlObj.hostname)) {
      console.warn(`🚨 SSRF attempt blocked: ${url}`);
      return {
        success: false,
        url,
        error: 'Access to internal/private network addresses is not allowed',
      };
    }

    // Information Disclosure Protection: Block IP disclosure services
    if (isBlockedService(urlObj.hostname)) {
      console.warn(`🚨 Blocked IP disclosure service: ${urlObj.hostname}`);
      return {
        success: false,
        url,
        error: 'Access to IP disclosure services is not allowed',
      };
    }

    console.log(`📥 Scraping URL: ${url}`);

    // Fetch content with timeout
    const response = await axios.get(url, {
      timeout: 10000, // 10 second timeout
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SignalBot/3.0; +https://signal.org)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      validateStatus: (status) => status >= 200 && status < 400,
    });

    // Parse HTML
    const $ = cheerio.load(response.data);

    // Extract title
    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text() ||
      '';

    // Extract description
    const description =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      '';

    // Remove unwanted elements
    $('script, style, nav, header, footer, iframe, noscript, .ad, .advertisement, .social-share').remove();

    // Extract main content
    // Try to find the main content area
    let content = '';
    const mainSelectors = [
      'article',
      'main',
      '[role="main"]',
      '.article-content',
      '.post-content',
      '.entry-content',
      '.content',
      '#content',
      '.story-body',
      '.article-body',
    ];

    for (const selector of mainSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        content = element.text();
        break;
      }
    }

    // Fallback to body if no main content found
    if (!content || content.trim().length < 100) {
      content = $('body').text();
    }

    // Clean up whitespace
    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim();

    // Limit content length (for LLM context window)
    const maxLength = 15000; // ~3-4k tokens
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '...[truncated]';
    }

    // Security: Redact IP addresses from all content to prevent information disclosure
    const redactedTitle = redactIPAddresses(title.trim());
    const redactedDescription = redactIPAddresses(description.trim());
    const redactedContent = redactIPAddresses(content);

    console.log(`✅ Scraped ${content.length} chars from ${url}`);

    return {
      success: true,
      title: redactedTitle,
      description: redactedDescription,
      content: redactedContent,
      url,
    };
  } catch (error: any) {
    console.error(`❌ Failed to scrape URL: ${url}`, error.message);

    let errorMsg = 'Failed to fetch URL';
    if (error.code === 'ENOTFOUND') {
      errorMsg = 'Domain not found or unreachable';
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      errorMsg = 'Request timed out';
    } else if (error.response) {
      errorMsg = `HTTP ${error.response.status}: ${error.response.statusText}`;
    } else if (error.message) {
      errorMsg = error.message;
    }

    return {
      success: false,
      url,
      error: errorMsg,
    };
  }
}

/**
 * Extract URLs from text
 * Supports:
 * - Standard URLs with TLDs (http://example.com)
 * - localhost URLs (http://localhost, http://localhost:8080)
 * - IP addresses (http://127.0.0.1, http://192.168.1.1:3000)
 */
export function extractUrls(text: string): string[] {
  // Match URLs with TLDs OR localhost OR IP addresses
  // Pattern breakdown:
  // 1. https?:// - protocol
  // 2. (?:www\.)? - optional www
  // 3. ([-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}|localhost|(?:\d{1,3}\.){3}\d{1,3}) - hostname:
  //    - Standard domain with TLD
  //    - OR "localhost"
  //    - OR IP address (xxx.xxx.xxx.xxx)
  // 4. (?::\d+)? - optional port
  // 5. \b - word boundary
  // 6. (?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)? - optional path/query
  const urlRegex = /https?:\/\/(?:www\.)?([-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}|localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?\b(?:[-a-zA-Z0-9()@:%_\+.~#?&\/=]*)?/g;
  const matches = text.match(urlRegex);
  return matches || [];
}

/**
 * Check if text contains a URL
 */
export function containsUrl(text: string): boolean {
  return extractUrls(text).length > 0;
}
