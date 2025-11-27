/**
 * URL Security Utility
 *
 * Provides URL parsing, tracking parameter removal, and security alerts
 * for suspicious TLDs and domains.
 */

export interface URLSecurityResult {
  url: string;
  cleaned: string;
  hasTracking: boolean;
  removedParams: string[];
  tld: string;
  isSuspicious: boolean;
  suspiciousReason?: string;
  country?: string;
}

/**
 * Bad actor TLDs and country-specific domains
 * Based on security concerns and geopolitical considerations
 */
const SUSPICIOUS_TLDS: Record<string, string> = {
  // China
  '.cn': 'China',
  '.com.cn': 'China',
  '.net.cn': 'China',
  '.org.cn': 'China',
  '.gov.cn': 'China',
  '.edu.cn': 'China',
  '.hk': 'Hong Kong (China)',
  '.mo': 'Macau (China)',

  // Russia
  '.ru': 'Russia',
  '.su': 'Russia (Soviet Union legacy)',
  '.рф': 'Russia (Cyrillic)',

  // Iran
  '.ir': 'Iran',

  // North Korea
  '.kp': 'North Korea',

  // Other concerning TLDs
  '.tk': 'Tokelau (commonly abused for phishing)',
  '.ml': 'Mali (commonly abused for phishing)',
  '.ga': 'Gabon (commonly abused for phishing)',
  '.cf': 'Central African Republic (commonly abused)',
  '.gq': 'Equatorial Guinea (commonly abused)',
};

/**
 * Common tracking parameters to remove
 */
const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'yclid',
  '_openstat',
  'fb_action_ids',
  'fb_action_types',
  'fb_ref',
  'fb_source',
  'action_object_map',
  'action_type_map',
  'action_ref_map',
  'ref',
  'source',
  'campaign',
  'medium',
  'rcm', // LinkedIn tracking parameter
];

/**
 * Extract all URLs from text
 */
export function extractURLs(text: string): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const matches = text.match(urlRegex);
  return matches || [];
}

/**
 * Clean tracking parameters from a URL
 */
export function cleanURL(url: string): { cleaned: string; hasTracking: boolean; removedParams: string[] } {
  try {
    const urlObj = new URL(url);
    const removedParams: string[] = [];
    let hasTracking = false;

    // Check each tracking parameter
    TRACKING_PARAMS.forEach(param => {
      if (urlObj.searchParams.has(param)) {
        urlObj.searchParams.delete(param);
        removedParams.push(param);
        hasTracking = true;
      }
    });

    // Also check for parameters that start with utm_ or similar patterns
    const allParams = Array.from(urlObj.searchParams.keys());
    allParams.forEach(param => {
      if (param.startsWith('utm_') || param.startsWith('mc_') || param.includes('tracking')) {
        if (!removedParams.includes(param)) {
          urlObj.searchParams.delete(param);
          removedParams.push(param);
          hasTracking = true;
        }
      }
    });

    return {
      cleaned: urlObj.toString(),
      hasTracking,
      removedParams,
    };
  } catch (error) {
    // If URL parsing fails, return original
    return {
      cleaned: url,
      hasTracking: false,
      removedParams: [],
    };
  }
}

/**
 * Check if a URL has a suspicious TLD
 */
export function checkSuspiciousTLD(url: string): { isSuspicious: boolean; country?: string; tld: string } {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Check each suspicious TLD
    for (const [tld, country] of Object.entries(SUSPICIOUS_TLDS)) {
      if (hostname.endsWith(tld)) {
        return {
          isSuspicious: true,
          country,
          tld,
        };
      }
    }

    // Extract the TLD anyway
    const tldMatch = hostname.match(/\.([a-z]{2,})$/i);
    const tld = tldMatch ? `.${tldMatch[1]}` : '';

    return {
      isSuspicious: false,
      tld,
    };
  } catch (error) {
    return {
      isSuspicious: false,
      tld: '',
    };
  }
}

/**
 * Analyze a URL for security concerns
 */
export function analyzeURL(url: string): URLSecurityResult {
  const cleaned = cleanURL(url);
  const tldCheck = checkSuspiciousTLD(url);

  return {
    url,
    cleaned: cleaned.cleaned,
    hasTracking: cleaned.hasTracking,
    removedParams: cleaned.removedParams,
    tld: tldCheck.tld,
    isSuspicious: tldCheck.isSuspicious,
    suspiciousReason: tldCheck.isSuspicious ? `Hosted in ${tldCheck.country}` : undefined,
    country: tldCheck.country,
  };
}

/**
 * Format a security alert message for Signal
 */
export function formatSecurityAlert(analysis: URLSecurityResult): string {
  let message = '';

  if (analysis.isSuspicious) {
    message += `👀 Security Notice\n\n`;
    message += `⚠️ This link is ${analysis.suspiciousReason}\n`;
    message += `🔗 TLD: ${analysis.tld}\n\n`;
    message += `Please exercise caution when clicking links from this region.\n`;
  }

  if (analysis.hasTracking) {
    if (!message) {
      message += `🔒 Privacy Notice\n\n`;
    }
    message += `🧹 This URL contains tracking parameters\n`;
    message += `📊 Removed: ${analysis.removedParams.join(', ')}\n\n`;
    message += `✨ Cleaned URL:\n${analysis.cleaned}\n`;
  }

  return message.trim();
}

/**
 * Process all URLs in a message and return security alerts
 */
export function processMessageURLs(text: string): string[] {
  const urls = extractURLs(text);
  const alerts: string[] = [];

  urls.forEach(url => {
    const analysis = analyzeURL(url);

    // Only alert if suspicious or has tracking
    if (analysis.isSuspicious || analysis.hasTracking) {
      const alert = formatSecurityAlert(analysis);
      if (alert) {
        alerts.push(alert);
      }
    }
  });

  return alerts;
}
