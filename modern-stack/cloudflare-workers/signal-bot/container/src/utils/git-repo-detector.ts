/**
 * Git Repository Detection Utility
 *
 * Detects GitHub, GitLab, and generic git URLs in messages.
 * Extracts repository metadata using public APIs.
 * Fetches README and generates AI summaries.
 *
 * Inspired by news-detector.ts pattern for URL detection.
 */

import OpenAI from 'openai';

// Patterns for git hosting platforms
export const GIT_PLATFORMS = [
  {
    name: 'GitHub',
    domain: 'github.com',
    apiBase: 'https://api.github.com',
    icon: '🐙',
    supportsApi: true,
  },
  {
    name: 'GitLab',
    domain: 'gitlab.com',
    apiBase: 'https://gitlab.com/api/v4',
    icon: '🦊',
    supportsApi: true,
  },
  {
    name: 'Gitea',
    domain: 'gitea.com',
    apiBase: null,
    icon: '🫖',
    supportsApi: false,
  },
  {
    name: 'Codeberg',
    domain: 'codeberg.org',
    apiBase: 'https://codeberg.org/api/v1',
    icon: '🏔️',
    supportsApi: true,
  },
  {
    name: 'Bitbucket',
    domain: 'bitbucket.org',
    apiBase: 'https://api.bitbucket.org/2.0',
    icon: '🪣',
    supportsApi: true,
  },
  {
    name: 'SourceHut',
    domain: 'sr.ht',
    apiBase: null,
    icon: '📦',
    supportsApi: false,
  },
];

// Generic git domain patterns (self-hosted instances)
const GIT_DOMAIN_PATTERNS = [
  /git\./i,       // git.example.com
  /gitlab\./i,    // gitlab.company.com
  /gitea\./i,     // gitea.company.com
  /gogs\./i,      // gogs.company.com
  /forgejo\./i,   // forgejo.instance.org
];

export interface GitPlatform {
  name: string;
  domain: string;
  apiBase: string | null;
  icon: string;
  supportsApi: boolean;
}

export interface ParsedRepoUrl {
  platform: GitPlatform;
  owner: string;
  repo: string;
  fullName: string;
  cleanUrl: string;
  isOrganization: boolean;
  isUser: boolean;
  branch?: string;
  path?: string;
}

export interface RepoMetadata {
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  license: string | null;
  topics: string[];
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  pushedAt: string; // Last commit
  defaultBranch: string;
  htmlUrl: string;
  latestRelease?: {
    tagName: string;
    name: string;
    publishedAt: string;
    prerelease: boolean;
  };
}

/**
 * Check if a URL is from a known git hosting platform
 */
export function isGitRepoUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Check known platforms
    for (const platform of GIT_PLATFORMS) {
      if (hostname === platform.domain || hostname.endsWith('.' + platform.domain)) {
        return true;
      }
    }

    // Check generic git domain patterns
    for (const pattern of GIT_DOMAIN_PATTERNS) {
      if (pattern.test(hostname)) {
        return true;
      }
    }

    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Get the git platform for a URL
 */
export function getGitPlatform(url: string): GitPlatform | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    // Check known platforms first
    for (const platform of GIT_PLATFORMS) {
      if (hostname === platform.domain || hostname.endsWith('.' + platform.domain)) {
        return platform;
      }
    }

    // Check generic git domain patterns
    for (const pattern of GIT_DOMAIN_PATTERNS) {
      if (pattern.test(hostname)) {
        return {
          name: 'Git',
          domain: hostname,
          apiBase: null,
          icon: '📁',
          supportsApi: false,
        };
      }
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Parse a git repository URL to extract owner/repo info
 */
export function parseGitRepoUrl(url: string): ParsedRepoUrl | null {
  try {
    const platform = getGitPlatform(url);
    if (!platform) return null;

    const urlObj = new URL(url);
    const pathname = urlObj.pathname.replace(/^\/+|\/+$/g, ''); // Trim slashes
    const parts = pathname.split('/').filter(p => p);

    // Need at least owner (could be just user/org profile)
    if (parts.length < 1) return null;

    const owner = parts[0];
    const repo = parts.length > 1 ? parts[1].replace(/\.git$/, '') : '';

    // Check for special paths that aren't repos
    const nonRepoPaths = ['settings', 'dashboard', 'explore', 'issues', 'pulls', 'trending', 'topics', 'collections'];
    if (nonRepoPaths.includes(owner.toLowerCase())) {
      return null;
    }

    // Detect if this is just a user/org profile (no repo)
    const isUser = parts.length === 1 ||
                   (parts.length === 2 && ['tab', 'repositories', 'projects', 'packages', 'stars'].includes(parts[1]));
    const isOrganization = !isUser && parts.length >= 2;

    // Extract branch/path if present
    let branch: string | undefined;
    let path: string | undefined;

    if (parts.length > 2) {
      // Handle /tree/branch or /blob/branch/path
      if (parts[2] === 'tree' || parts[2] === 'blob') {
        branch = parts[3];
        path = parts.slice(4).join('/');
      } else if (parts[2] === 'releases' || parts[2] === 'issues' || parts[2] === 'pull') {
        // These are repo sub-pages, not file paths
      }
    }

    // Build clean URL (just owner/repo)
    const cleanUrl = repo
      ? `https://${platform.domain}/${owner}/${repo}`
      : `https://${platform.domain}/${owner}`;

    return {
      platform,
      owner,
      repo,
      fullName: repo ? `${owner}/${repo}` : owner,
      cleanUrl,
      isOrganization,
      isUser,
      branch,
      path,
    };
  } catch (error) {
    console.error('Error parsing git URL:', error);
    return null;
  }
}

/**
 * Fetch repository metadata from GitHub API
 */
async function fetchGitHubMetadata(owner: string, repo: string, token?: string): Promise<RepoMetadata | null> {
  try {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'SignalBot/3.0',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Fetch repo info
    const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!repoResponse.ok) {
      console.error(`GitHub API error: ${repoResponse.status}`);
      return null;
    }

    const repoData = await repoResponse.json() as any;

    // Try to fetch latest release (optional, don't fail if missing)
    let latestRelease: RepoMetadata['latestRelease'] | undefined;
    try {
      const releaseResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      if (releaseResponse.ok) {
        const releaseData = await releaseResponse.json() as any;
        latestRelease = {
          tagName: releaseData.tag_name,
          name: releaseData.name || releaseData.tag_name,
          publishedAt: releaseData.published_at,
          prerelease: releaseData.prerelease,
        };
      }
    } catch (e) {
      // No release, that's okay
    }

    return {
      name: repoData.name,
      fullName: repoData.full_name,
      description: repoData.description,
      language: repoData.language,
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      openIssues: repoData.open_issues_count || 0,
      license: repoData.license?.spdx_id || repoData.license?.name || null,
      topics: repoData.topics || [],
      isPrivate: repoData.private || false,
      isFork: repoData.fork || false,
      isArchived: repoData.archived || false,
      createdAt: repoData.created_at,
      updatedAt: repoData.updated_at,
      pushedAt: repoData.pushed_at,
      defaultBranch: repoData.default_branch,
      htmlUrl: repoData.html_url,
      latestRelease,
    };
  } catch (error) {
    console.error('Error fetching GitHub metadata:', error);
    return null;
  }
}

/**
 * Fetch repository metadata from GitLab API
 */
async function fetchGitLabMetadata(owner: string, repo: string, apiBase: string = 'https://gitlab.com/api/v4'): Promise<RepoMetadata | null> {
  try {
    const projectPath = encodeURIComponent(`${owner}/${repo}`);

    const repoResponse = await fetch(`${apiBase}/projects/${projectPath}`, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SignalBot/3.0',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!repoResponse.ok) {
      console.error(`GitLab API error: ${repoResponse.status}`);
      return null;
    }

    const repoData = await repoResponse.json() as any;

    // Try to fetch latest release
    let latestRelease: RepoMetadata['latestRelease'] | undefined;
    try {
      const releaseResponse = await fetch(`${apiBase}/projects/${projectPath}/releases?per_page=1`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SignalBot/3.0',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (releaseResponse.ok) {
        const releases = await releaseResponse.json() as any[];
        if (releases.length > 0) {
          latestRelease = {
            tagName: releases[0].tag_name,
            name: releases[0].name || releases[0].tag_name,
            publishedAt: releases[0].released_at,
            prerelease: false, // GitLab doesn't have prerelease concept
          };
        }
      }
    } catch (e) {
      // No release, that's okay
    }

    return {
      name: repoData.name,
      fullName: repoData.path_with_namespace,
      description: repoData.description,
      language: null, // GitLab API doesn't return primary language directly
      stars: repoData.star_count || 0,
      forks: repoData.forks_count || 0,
      openIssues: repoData.open_issues_count || 0,
      license: null, // GitLab API structure different
      topics: repoData.topics || repoData.tag_list || [],
      isPrivate: repoData.visibility !== 'public',
      isFork: repoData.forked_from_project !== undefined,
      isArchived: repoData.archived || false,
      createdAt: repoData.created_at,
      updatedAt: repoData.last_activity_at,
      pushedAt: repoData.last_activity_at,
      defaultBranch: repoData.default_branch,
      htmlUrl: repoData.web_url,
      latestRelease,
    };
  } catch (error) {
    console.error('Error fetching GitLab metadata:', error);
    return null;
  }
}

/**
 * Fetch repository metadata for any supported platform
 */
export async function fetchRepoMetadata(
  parsedUrl: ParsedRepoUrl,
  githubToken?: string
): Promise<RepoMetadata | null> {
  // Can't fetch metadata without a repo name
  if (!parsedUrl.repo) {
    return null;
  }

  const { platform, owner, repo } = parsedUrl;

  if (platform.domain === 'github.com') {
    return fetchGitHubMetadata(owner, repo, githubToken);
  }

  if (platform.domain === 'gitlab.com' || platform.apiBase?.includes('gitlab')) {
    return fetchGitLabMetadata(owner, repo, platform.apiBase || undefined);
  }

  // Codeberg uses Gitea API (similar to GitHub)
  if (platform.domain === 'codeberg.org') {
    try {
      const response = await fetch(`https://codeberg.org/api/v1/repos/${owner}/${repo}`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SignalBot/3.0',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return null;

      const data = await response.json() as any;

      return {
        name: data.name,
        fullName: data.full_name,
        description: data.description,
        language: data.language,
        stars: data.stars_count || 0,
        forks: data.forks_count || 0,
        openIssues: data.open_issues_count || 0,
        license: data.license?.spdx_id || null,
        topics: [],
        isPrivate: data.private || false,
        isFork: data.fork || false,
        isArchived: data.archived || false,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        pushedAt: data.updated_at,
        defaultBranch: data.default_branch,
        htmlUrl: data.html_url,
      };
    } catch (error) {
      console.error('Error fetching Codeberg metadata:', error);
      return null;
    }
  }

  // Platform doesn't support API
  return null;
}

/**
 * Format repository metadata for display in Signal
 */
export function formatRepoForSignal(
  parsedUrl: ParsedRepoUrl,
  metadata: RepoMetadata | null
): string {
  const { platform, owner, repo, cleanUrl } = parsedUrl;

  let response = `${platform.icon} ${platform.name} Repository\n\n`;

  if (!metadata) {
    // No metadata available, show what we can
    response += `📂 ${parsedUrl.fullName}\n`;
    response += `🔗 ${cleanUrl}\n`;
    return response;
  }

  // Repository name and description
  response += `📂 ${metadata.fullName}\n`;

  if (metadata.description) {
    response += `📝 ${metadata.description}\n`;
  }

  response += '\n';

  // Stats line
  const stats: string[] = [];
  if (metadata.stars > 0) stats.push(`⭐ ${formatNumber(metadata.stars)}`);
  if (metadata.forks > 0) stats.push(`🍴 ${formatNumber(metadata.forks)}`);
  if (metadata.openIssues > 0) stats.push(`🔓 ${metadata.openIssues} issues`);

  if (stats.length > 0) {
    response += stats.join(' • ') + '\n';
  }

  // Language and license
  const meta: string[] = [];
  if (metadata.language) meta.push(`💻 ${metadata.language}`);
  if (metadata.license) meta.push(`📜 ${metadata.license}`);

  if (meta.length > 0) {
    response += meta.join(' • ') + '\n';
  }

  // Latest release
  if (metadata.latestRelease) {
    const releaseDate = new Date(metadata.latestRelease.publishedAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    response += `📦 ${metadata.latestRelease.tagName} (${releaseDate})\n`;
  }

  // Last commit/update
  if (metadata.pushedAt) {
    const lastCommit = formatRelativeTime(new Date(metadata.pushedAt));
    response += `🕐 Last commit: ${lastCommit}\n`;
  }

  // Creation date
  if (metadata.createdAt) {
    const created = new Date(metadata.createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    response += `📅 Created: ${created}\n`;
  }

  // Status badges
  const badges: string[] = [];
  if (metadata.isArchived) badges.push('🗄️ Archived');
  if (metadata.isFork) badges.push('🍴 Fork');
  if (metadata.isPrivate) badges.push('🔒 Private');

  if (badges.length > 0) {
    response += badges.join(' ') + '\n';
  }

  // Topics (if any, limit to 5)
  if (metadata.topics.length > 0) {
    const topicList = metadata.topics.slice(0, 5).join(', ');
    response += `🏷️ ${topicList}\n`;
  }

  response += `\n🔗 ${cleanUrl}`;

  return response;
}

/**
 * Format large numbers with K/M suffixes
 */
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
}

/**
 * Format a date as relative time (e.g., "2 days ago")
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years} year${years > 1 ? 's' : ''} ago`;
  if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`;
  if (weeks > 0) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}

/**
 * Fetch README content from a GitHub repository
 */
export async function fetchReadmeContent(
  owner: string,
  repo: string,
  githubToken?: string
): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3.raw',
      'User-Agent': 'SignalBot/3.0',
    };

    if (githubToken) {
      headers['Authorization'] = `Bearer ${githubToken}`;
    }

    // Try common README filenames
    const readmeFiles = ['README.md', 'readme.md', 'README', 'Readme.md', 'README.txt'];

    for (const filename of readmeFiles) {
      try {
        const response = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/${filename}`,
          {
            headers,
            signal: AbortSignal.timeout(10000),
          }
        );

        if (response.ok) {
          const content = await response.text();
          // Limit to first 4000 chars to avoid token limits
          return content.substring(0, 4000);
        }
      } catch {
        // Try next filename
      }
    }

    return null;
  } catch (error) {
    console.error('Error fetching README:', error);
    return null;
  }
}

/**
 * Generate a concise summary of a repository using OpenAI
 * Focuses on WHAT the repo does, not installation steps
 */
export async function summarizeReadme(
  openai: OpenAI,
  readmeContent: string,
  repoName: string,
  repoDescription?: string | null
): Promise<string | null> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a technical documentation summarizer for a tech-literate audience.
Given a GitHub README, create a 1-2 sentence summary that:
- Focuses ONLY on WHAT the project does and its core PURPOSE
- Mentions key capabilities or unique features
- Does NOT mention installation, setup, or usage instructions
- Does NOT use phrases like "This repo" or "This project"
- Is written in a concise, informative style

Example good summaries:
- "MCP server enabling code execution within Binary Ninja for reverse engineering automation."
- "Cross-platform CLI tool for mass-renaming files using regex patterns and templates."
- "Real-time collaborative whiteboard with vector graphics support and multi-user sync."`,
        },
        {
          role: 'user',
          content: `Repository: ${repoName}
${repoDescription ? `Description: ${repoDescription}` : ''}

README content:
${readmeContent.substring(0, 3000)}`,
        },
      ],
      max_tokens: 100,
      temperature: 0.3,
    });

    const summary = response.choices[0]?.message?.content?.trim();
    return summary || null;
  } catch (error) {
    console.error('Error summarizing README:', error);
    return null;
  }
}

/**
 * Format repository metadata for display in Signal (with optional AI summary)
 */
export async function formatRepoForSignalWithSummary(
  parsedUrl: ParsedRepoUrl,
  metadata: RepoMetadata | null,
  openai?: OpenAI,
  githubToken?: string
): Promise<string> {
  const { platform, owner, repo, cleanUrl } = parsedUrl;

  let response = `${platform.icon} ${platform.name} Repository\n\n`;

  if (!metadata) {
    // No metadata available, show what we can
    response += `📂 ${parsedUrl.fullName}\n`;
    response += `🔗 ${cleanUrl}\n`;
    return response;
  }

  // Repository name
  response += `📂 ${metadata.fullName}\n`;

  // Try to fetch and summarize README if OpenAI is available
  let aiSummary: string | null = null;
  if (openai && platform.domain === 'github.com') {
    try {
      const readmeContent = await fetchReadmeContent(owner, repo, githubToken);
      if (readmeContent && readmeContent.length > 100) {
        aiSummary = await summarizeReadme(openai, readmeContent, metadata.fullName, metadata.description);
      }
    } catch (error) {
      console.error('Failed to get README summary:', error);
    }
  }

  // Show AI summary if available, otherwise fall back to repo description
  if (aiSummary) {
    response += `📝 ${aiSummary}\n`;
  } else if (metadata.description) {
    response += `📝 ${metadata.description}\n`;
  }

  response += '\n';

  // Language and license
  const meta: string[] = [];
  if (metadata.language) meta.push(`💻 ${metadata.language}`);
  if (metadata.license) meta.push(`📜 ${metadata.license}`);

  if (meta.length > 0) {
    response += meta.join(' • ') + '\n';
  }

  // Last commit/update
  if (metadata.pushedAt) {
    const lastCommit = formatRelativeTime(new Date(metadata.pushedAt));
    response += `🕐 Last commit: ${lastCommit}\n`;
  }

  // Creation date
  if (metadata.createdAt) {
    const created = new Date(metadata.createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    response += `📅 Created: ${created}\n`;
  }

  // Status badges (only show if meaningful)
  const badges: string[] = [];
  if (metadata.isArchived) badges.push('🗄️ Archived');
  if (metadata.isFork) badges.push('🍴 Fork');

  if (badges.length > 0) {
    response += badges.join(' ') + '\n';
  }

  response += `\n🔗 ${cleanUrl}`;

  return response;
}

/**
 * Detect all git repository URLs in a message
 */
export function detectGitRepoUrls(urls: string[]): ParsedRepoUrl[] {
  const repoUrls: ParsedRepoUrl[] = [];

  for (const url of urls) {
    if (isGitRepoUrl(url)) {
      const parsed = parseGitRepoUrl(url);
      if (parsed && parsed.repo) { // Only include if there's an actual repo
        repoUrls.push(parsed);
      }
    }
  }

  return repoUrls;
}
