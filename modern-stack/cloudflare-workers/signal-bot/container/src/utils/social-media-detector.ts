/**
 * Social Media URL Detection and Processing
 *
 * Detects social media URLs (Instagram, TikTok, Twitter, etc.)
 * and provides utilities for tracker removal and metadata extraction.
 *
 * Inspired by the `dl` function in ~/Git/dotfiles/platforms/macos/config/.zsh_functions
 */

export interface SocialMediaPlatform {
  name: string;
  domain: string;
  supportsDownload: boolean;
  icon: string;
}

// Social media platforms that support downloading
export const SOCIAL_MEDIA_PLATFORMS: SocialMediaPlatform[] = [
  { name: 'Instagram', domain: 'instagram.com', supportsDownload: true, icon: '📸' },
  { name: 'TikTok', domain: 'tiktok.com', supportsDownload: true, icon: '🎵' },
  { name: 'Twitter/X', domain: 'twitter.com', supportsDownload: true, icon: '🐦' },
  { name: 'Twitter/X', domain: 'x.com', supportsDownload: true, icon: '🐦' },
  { name: 'YouTube', domain: 'youtube.com', supportsDownload: true, icon: '📺' },
  { name: 'YouTube', domain: 'youtu.be', supportsDownload: true, icon: '📺' },
  { name: 'Facebook', domain: 'facebook.com', supportsDownload: true, icon: '📘' },
  { name: 'Facebook', domain: 'fb.com', supportsDownload: true, icon: '📘' },
  { name: 'Reddit', domain: 'reddit.com', supportsDownload: true, icon: '🤖' },
  { name: 'Vimeo', domain: 'vimeo.com', supportsDownload: true, icon: '🎬' },
  { name: 'Twitch', domain: 'twitch.tv', supportsDownload: true, icon: '🎮' },
  { name: 'LinkedIn', domain: 'linkedin.com', supportsDownload: false, icon: '💼' },
  { name: 'Pinterest', domain: 'pinterest.com', supportsDownload: false, icon: '📌' },
  { name: 'Snapchat', domain: 'snapchat.com', supportsDownload: false, icon: '👻' },
];

// Common tracker parameters across social media platforms
const TRACKER_PARAMS = [
  // Instagram
  'igsh',
  'igshid',
  'ig_rid',
  'ig_web_button_share_from',

  // Facebook
  'fbclid',
  'fb_action_ids',
  'fb_action_types',
  'fb_ref',
  'fb_source',

  // Twitter/X
  's',
  't',
  'ref_src',
  'ref_url',

  // TikTok
  'is_from_webapp',
  'sender_device',
  'web_id',
  '_r',

  // YouTube
  'feature',
  'kw',
  'si',

  // Universal tracking
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'utm_cid',

  // General tracking
  'ref',
  'source',
  'campaign',
];

/**
 * Check if URL is from a social media platform
 */
export function isSocialMediaUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');

    return SOCIAL_MEDIA_PLATFORMS.some(platform =>
      hostname === platform.domain || hostname.endsWith(`.${platform.domain}`)
    );
  } catch {
    return false;
  }
}

/**
 * Get platform info for a social media URL
 */
export function getSocialMediaPlatform(url: string): SocialMediaPlatform | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase().replace(/^www\./, '');

    const platform = SOCIAL_MEDIA_PLATFORMS.find(p =>
      hostname === p.domain || hostname.endsWith(`.${p.domain}`)
    );

    return platform || null;
  } catch {
    return null;
  }
}

/**
 * Remove tracker parameters from social media URLs
 *
 * Example:
 * https://www.instagram.com/reel/DNwP6ZCwv6r/?igsh=MWJ4bG9zN2lndTRhNg==
 * becomes:
 * https://www.instagram.com/reel/DNwP6ZCwv6r/
 */
export function removeTrackers(url: string): string {
  try {
    const urlObj = new URL(url);

    // Remove all tracker parameters
    TRACKER_PARAMS.forEach(param => {
      urlObj.searchParams.delete(param);
    });

    // Return clean URL
    let cleanUrl = urlObj.toString();

    // Remove trailing ? or & if no params remain
    if (cleanUrl.endsWith('?') || cleanUrl.endsWith('&')) {
      cleanUrl = cleanUrl.slice(0, -1);
    }

    return cleanUrl;
  } catch {
    // If URL parsing fails, return original
    return url;
  }
}

/**
 * Get platform-specific content type
 */
export function getContentType(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Instagram
    if (pathname.includes('/reel/')) return 'Instagram Reel';
    if (pathname.includes('/p/')) return 'Instagram Post';
    if (pathname.includes('/tv/')) return 'Instagram TV';
    if (pathname.includes('/stories/')) return 'Instagram Story';

    // TikTok
    if (pathname.includes('/video/')) return 'TikTok Video';

    // Twitter/X
    if (pathname.includes('/status/')) return 'Tweet';
    if (pathname.includes('/video/')) return 'Twitter Video';

    // YouTube
    if (pathname.includes('/watch')) return 'YouTube Video';
    if (pathname.includes('/shorts/')) return 'YouTube Short';
    if (pathname.includes('/live/')) return 'YouTube Live';

    // Reddit
    if (pathname.includes('/comments/')) return 'Reddit Post';

    // Facebook
    if (pathname.includes('/videos/')) return 'Facebook Video';
    if (pathname.includes('/posts/')) return 'Facebook Post';

    return 'Social Media Content';
  } catch {
    return 'Social Media Content';
  }
}

/**
 * Extract clean content ID from URL
 */
export function extractContentId(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Instagram: /reel/DNwP6ZCwv6r/ -> DNwP6ZCwv6r
    const instagramMatch = pathname.match(/\/(reel|p|tv)\/([A-Za-z0-9_-]+)/);
    if (instagramMatch) return instagramMatch[2];

    // TikTok: /video/1234567890 -> 1234567890
    const tiktokMatch = pathname.match(/\/video\/(\d+)/);
    if (tiktokMatch) return tiktokMatch[1];

    // Twitter: /status/1234567890 -> 1234567890
    const twitterMatch = pathname.match(/\/status\/(\d+)/);
    if (twitterMatch) return twitterMatch[1];

    // YouTube: /watch?v=ABC123 -> ABC123
    const youtubeId = urlObj.searchParams.get('v');
    if (youtubeId) return youtubeId;

    // YouTube Shorts: /shorts/ABC123 -> ABC123
    const youtubeShortMatch = pathname.match(/\/shorts\/([A-Za-z0-9_-]+)/);
    if (youtubeShortMatch) return youtubeShortMatch[1];

    return null;
  } catch {
    return null;
  }
}

/**
 * Format social media URL for display
 * Removes trackers and shows clean URL
 */
export function formatUrlForDisplay(url: string): string {
  const cleanUrl = removeTrackers(url);
  const platform = getSocialMediaPlatform(url);
  const contentType = getContentType(url);
  const contentId = extractContentId(url);

  if (!platform) return cleanUrl;

  if (contentId) {
    return `${platform.icon} ${contentType} (ID: ${contentId})`;
  }

  return `${platform.icon} ${contentType}`;
}
