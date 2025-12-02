/**
 * Wiki Search Utility for Irregularpedia (VitePress)
 *
 * Uses local git repo for fast, reliable search.
 * Falls back to HTTP if git repo not available.
 * Supports both keyword search and AI-enriched queries.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execAsync = promisify(exec);

const WIKI_BASE_URL = 'https://irregularpedia.org';
const WIKI_REPO_PATH = '/app/wiki-repo';  // Mounted bare git repo

// Cache for wiki index
let wikiIndexCache: WikiArticle[] | null = null;
let wikiIndexCacheTime = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Common typo corrections
const TYPO_CORRECTIONS: Record<string, string> = {
  'linx': 'linux',
  'linus': 'linux',
  'linnux': 'linux',
  'ubunut': 'ubuntu',
  'ubunto': 'ubuntu',
  'andriod': 'android',
  'andoid': 'android',
  'widows': 'windows',
  'windwos': 'windows',
  'securty': 'security',
  'secuirty': 'security',
  'encyrption': 'encryption',
  'encrption': 'encryption',
  'vpnn': 'vpn',
  'wiregurad': 'wireguard',
  'singal': 'signal',
  'matirx': 'matrix',
  'phoen': 'phone',
  'moible': 'mobile',
  'netowrk': 'network',
  'netwrok': 'network',
  'firwall': 'firewall',
  'firewal': 'firewall',
  'hardenning': 'hardening',
  'instalation': 'installation',
  'configuartion': 'configuration',
  'configration': 'configuration',
};

export interface WikiArticle {
  title: string;
  url: string;
  tags: string[];
  category?: string;
  filePath?: string;  // Local file path in repo
}

export interface WikiSearchResult {
  article: WikiArticle;
  relevance: number;
  matchedTerms: string[];
  matchedLines?: string[];  // Context from git grep
}

export interface WikiContent {
  title: string;
  url: string;
  content: string;
  excerpt: string;
}

/**
 * Check if local wiki repo is available
 */
async function isRepoAvailable(): Promise<boolean> {
  try {
    await fs.access(WIKI_REPO_PATH);
    // Test git command
    await execAsync(`GIT_DIR="${WIKI_REPO_PATH}" git rev-parse HEAD`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute git command on wiki repo
 */
async function gitExec(args: string, timeout = 10000): Promise<string> {
  const { stdout } = await execAsync(`GIT_DIR="${WIKI_REPO_PATH}" git ${args}`, { timeout });
  return stdout.trim();
}

/**
 * Get list of all markdown files from local repo
 */
async function getMarkdownFiles(): Promise<string[]> {
  try {
    const output = await gitExec('ls-tree --name-only -r HEAD');
    const files = output.split('\n')
      .filter(f => f.endsWith('.md') && f.startsWith('docs/'))
      .filter(f => !f.includes('node_modules'));
    return files;
  } catch (error) {
    console.error('Error listing markdown files:', error);
    return [];
  }
}

/**
 * Read file content from git repo
 */
async function readFileFromRepo(filePath: string): Promise<string> {
  try {
    const content = await gitExec(`show HEAD:"${filePath}"`, 30000);
    return content;
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return '';
  }
}

/**
 * Extract title from markdown content
 */
function extractTitle(content: string, filePath: string): string {
  // Try to find frontmatter title
  const frontmatterMatch = content.match(/^---[\s\S]*?title:\s*['"]?([^'"\n]+)['"]?[\s\S]*?---/m);
  if (frontmatterMatch) return frontmatterMatch[1].trim();

  // Try to find first H1
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();

  // Fall back to filename
  const basename = path.basename(filePath, '.md');
  return basename.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Convert file path to web URL
 */
function filePathToUrl(filePath: string): string {
  // docs/general/mobile-hardening.md -> /general/mobile-hardening.html
  let urlPath = filePath
    .replace(/^docs\//, '/')
    .replace(/\.md$/, '.html')
    .replace(/\/index\.html$/, '/');
  return `${WIKI_BASE_URL}${urlPath}`;
}

/**
 * Build wiki index from local git repo
 */
async function buildIndexFromRepo(): Promise<WikiArticle[]> {
  console.log('📚 Building wiki index from local git repo...');
  const files = await getMarkdownFiles();
  const articles: WikiArticle[] = [];

  for (const filePath of files) {
    try {
      const content = await readFileFromRepo(filePath);
      const title = extractTitle(content, filePath);

      // Extract category from path
      const pathParts = filePath.split('/');
      const category = pathParts.length > 2 ? pathParts[1] : 'general';

      // Extract tags from frontmatter
      const tags: string[] = [category];
      const tagsMatch = content.match(/^---[\s\S]*?tags:\s*\[([^\]]+)\][\s\S]*?---/m);
      if (tagsMatch) {
        const parsedTags = tagsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, '').toLowerCase());
        tags.push(...parsedTags);
      }

      articles.push({
        title,
        url: filePathToUrl(filePath),
        tags: [...new Set(tags)],
        category,
        filePath,
      });
    } catch (error) {
      // Skip files that fail to process
    }
  }

  console.log(`📚 Built index with ${articles.length} articles from local repo`);
  return articles;
}

/**
 * Get wiki article index (cached)
 */
export async function getWikiIndex(): Promise<WikiArticle[]> {
  const now = Date.now();

  // Return cached if valid
  if (wikiIndexCache && (now - wikiIndexCacheTime) < CACHE_TTL_MS) {
    return wikiIndexCache;
  }

  try {
    const repoAvailable = await isRepoAvailable();
    if (repoAvailable) {
      wikiIndexCache = await buildIndexFromRepo();
    } else {
      console.log('📚 Local repo not available, returning empty index');
      wikiIndexCache = [];
    }
    wikiIndexCacheTime = now;
    return wikiIndexCache;
  } catch (error) {
    console.error('Error building wiki index:', error);
    return wikiIndexCache || [];
  }
}

/**
 * Correct common typos in search terms
 */
function correctTypos(term: string): string[] {
  const corrected = TYPO_CORRECTIONS[term.toLowerCase()];
  if (corrected) {
    return [term, corrected];  // Return both original and corrected
  }
  return [term];
}

/**
 * Search wiki using git grep (fast full-text search)
 */
export async function searchWiki(query: string, limit = 10): Promise<WikiSearchResult[]> {
  const repoAvailable = await isRepoAvailable();
  if (!repoAvailable) {
    console.log('📚 Wiki repo not available for search');
    return [];
  }

  // Split and correct typos
  let terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  // Expand terms with typo corrections
  const expandedTerms: string[] = [];
  for (const term of terms) {
    expandedTerms.push(...correctTypos(term));
  }
  terms = [...new Set(expandedTerms)];  // Dedupe

  console.log(`📚 Searching wiki for terms: ${terms.join(', ')}`);

  if (terms.length === 0) return [];

  const results: Map<string, WikiSearchResult> = new Map();

  // Run git grep for each term in parallel
  // Use -- ':docs/' pattern for recursive search in bare repo
  const grepPromises = terms.map(async (term) => {
    try {
      // Case-insensitive grep, recursive in docs/ folder
      const output = await gitExec(
        `grep -i -l --max-count=50 "${term}" HEAD -- docs/ 2>/dev/null || true`,
        15000
      );
      const files = output.split('\n').filter(f => f.startsWith('HEAD:docs/') && f.endsWith('.md'));
      return { term, files };
    } catch (err) {
      console.error(`📚 Git grep error for "${term}":`, err);
      return { term, files: [] };
    }
  });

  const grepResults = await Promise.all(grepPromises);

  // Score results based on term matches
  const articles = await getWikiIndex();
  const articleMap = new Map(articles.map(a => [a.filePath, a]));

  // Also build a content cache for header matching
  const contentCache: Map<string, string> = new Map();

  for (const { term, files } of grepResults) {
    for (const file of files) {
      const filePath = file.replace('HEAD:', '');
      const article = articleMap.get(filePath);
      if (!article) continue;

      // Get content for header matching (cache it)
      let content = contentCache.get(filePath);
      if (!content) {
        try {
          content = await readFileFromRepo(filePath);
          contentCache.set(filePath, content);
        } catch {
          content = '';
        }
      }

      if (results.has(filePath)) {
        const existing = results.get(filePath)!;
        existing.relevance += 2;
        if (!existing.matchedTerms.includes(term)) {
          existing.matchedTerms.push(term);
        }
      } else {
        // Calculate relevance with better scoring
        let relevance = 2;
        const titleLower = article.title.toLowerCase();
        const contentLower = content.toLowerCase();

        // Title match (highest priority)
        if (titleLower.includes(term)) relevance += 10;

        // H1/H2 header match (very high priority)
        const h1Match = contentLower.match(/^#\s+(.+)$/m);
        const h2Matches = contentLower.match(/^##\s+(.+)$/gm) || [];
        if (h1Match && h1Match[1].includes(term)) relevance += 8;
        for (const h2 of h2Matches) {
          if (h2.toLowerCase().includes(term)) {
            relevance += 6;
            break;
          }
        }

        // Tag match
        if (article.tags.some(t => t.includes(term))) relevance += 4;

        // Category match
        if (article.category?.toLowerCase().includes(term)) relevance += 3;

        // Filename match (e.g., "booting-os-from-usb" for "usb")
        if (filePath.toLowerCase().includes(term)) relevance += 5;

        results.set(filePath, {
          article,
          relevance,
          matchedTerms: [term],
        });
      }
    }
  }

  // Also search by title/tags/filename in index (for terms that git grep might miss)
  for (const article of articles) {
    const searchText = `${article.title} ${article.tags.join(' ')} ${article.filePath || ''}`.toLowerCase();
    const matchedTerms: string[] = [];
    let relevance = 0;

    for (const term of terms) {
      if (searchText.includes(term)) {
        matchedTerms.push(term);
        if (article.title.toLowerCase().includes(term)) relevance += 10;
        if (article.tags.some(t => t.includes(term))) relevance += 4;
        if (article.filePath?.toLowerCase().includes(term)) relevance += 5;
      }
    }

    if (matchedTerms.length > 0 && article.filePath) {
      if (results.has(article.filePath)) {
        const existing = results.get(article.filePath)!;
        existing.relevance += relevance;
        for (const t of matchedTerms) {
          if (!existing.matchedTerms.includes(t)) existing.matchedTerms.push(t);
        }
      } else {
        results.set(article.filePath, { article, relevance, matchedTerms });
      }
    }
  }

  // Sort by relevance and return top results
  const sorted = Array.from(results.values()).sort((a, b) => b.relevance - a.relevance);
  console.log(`📚 Found ${sorted.length} results, returning top ${limit}`);
  return sorted.slice(0, limit);
}

/**
 * Advanced search with context lines from git grep
 */
async function searchWithContext(term: string, maxFiles = 20): Promise<Map<string, string[]>> {
  const results: Map<string, string[]> = new Map();
  try {
    // Get matching files with context lines
    const output = await gitExec(
      `grep -i -n -C 1 --max-count=3 "${term}" HEAD -- docs/ 2>/dev/null || true`,
      20000
    );

    // Parse output: HEAD:filepath:linenum:content
    const lines = output.split('\n').filter(l => l.startsWith('HEAD:docs/'));
    for (const line of lines) {
      const match = line.match(/^HEAD:(docs\/[^:]+):\d+[:-](.*)$/);
      if (match) {
        const [, filePath, content] = match;
        if (!results.has(filePath)) {
          results.set(filePath, []);
        }
        const existing = results.get(filePath)!;
        if (existing.length < 5) {  // Limit context per file
          existing.push(content.trim());
        }
      }
    }
  } catch (err) {
    console.error(`📚 Context grep error for "${term}":`, err);
  }
  return results;
}

/**
 * Parallel search with multiple query variations and strategies
 */
export async function parallelSearch(queries: string[], limit = 10): Promise<WikiSearchResult[]> {
  const repoAvailable = await isRepoAvailable();
  if (!repoAvailable) {
    return [];
  }

  // Collect and correct all terms
  const allTerms = new Set<string>();
  for (const q of queries) {
    const words = q.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    for (const word of words) {
      // Add original and corrected versions
      correctTypos(word).forEach(t => allTerms.add(t));
    }
  }

  const terms = Array.from(allTerms);
  console.log(`📚 Parallel search with ${terms.length} terms: ${terms.slice(0, 5).join(', ')}${terms.length > 5 ? '...' : ''}`);

  if (terms.length === 0) return [];

  const results: Map<string, WikiSearchResult> = new Map();
  const articles = await getWikiIndex();
  const articleMap = new Map(articles.map(a => [a.filePath, a]));

  // Strategy 1: Git grep for each term in parallel
  const grepPromises = terms.slice(0, 8).map(async (term) => {
    try {
      const output = await gitExec(
        `grep -i -l --max-count=50 "${term}" HEAD -- docs/ 2>/dev/null || true`,
        15000
      );
      const files = output.split('\n').filter(f => f.startsWith('HEAD:docs/') && f.endsWith('.md'));
      return { term, files };
    } catch {
      return { term, files: [] };
    }
  });

  // Strategy 2: Context search for primary terms (get matching lines)
  const contextPromises = terms.slice(0, 3).map(term => searchWithContext(term));

  // Run all strategies in parallel
  const [grepResults, ...contextResults] = await Promise.all([
    Promise.all(grepPromises),
    ...contextPromises
  ]);

  // Merge context results
  const contextByFile: Map<string, string[]> = new Map();
  for (const ctx of contextResults) {
    if (ctx instanceof Map) {
      for (const [file, lines] of ctx) {
        if (!contextByFile.has(file)) {
          contextByFile.set(file, []);
        }
        contextByFile.get(file)!.push(...lines);
      }
    }
  }

  // Process grep results
  for (const { term, files } of grepResults) {
    for (const file of files) {
      const filePath = file.replace('HEAD:', '');
      const article = articleMap.get(filePath);
      if (!article) continue;

      if (results.has(filePath)) {
        const existing = results.get(filePath)!;
        existing.relevance += 3;  // Multiple term matches
        if (!existing.matchedTerms.includes(term)) {
          existing.matchedTerms.push(term);
        }
      } else {
        let relevance = 2;
        const titleLower = article.title.toLowerCase();

        // Boost for title matches
        if (titleLower.includes(term)) relevance += 10;

        // Boost for filename matches
        if (filePath.toLowerCase().includes(term)) relevance += 6;

        // Boost for tag matches
        if (article.tags.some(t => t.includes(term))) relevance += 4;

        // Boost for context matches (H1/H2 likely)
        const context = contextByFile.get(filePath);
        if (context) {
          const contextText = context.join(' ').toLowerCase();
          if (contextText.includes(term)) relevance += 3;
        }

        results.set(filePath, {
          article,
          relevance,
          matchedTerms: [term],
          matchedLines: context?.slice(0, 3),
        });
      }
    }
  }

  // Strategy 3: Index-based search (title, tags, filename)
  for (const article of articles) {
    const searchText = `${article.title} ${article.tags.join(' ')} ${article.filePath || ''}`.toLowerCase();
    const matchedTerms: string[] = [];
    let relevance = 0;

    for (const term of terms) {
      if (searchText.includes(term)) {
        matchedTerms.push(term);
        if (article.title.toLowerCase().includes(term)) relevance += 10;
        if (article.tags.some(t => t.includes(term))) relevance += 4;
        if (article.filePath?.toLowerCase().includes(term)) relevance += 6;
      }
    }

    if (matchedTerms.length > 0 && article.filePath) {
      if (results.has(article.filePath)) {
        const existing = results.get(article.filePath)!;
        existing.relevance += relevance;
        for (const t of matchedTerms) {
          if (!existing.matchedTerms.includes(t)) existing.matchedTerms.push(t);
        }
      } else {
        results.set(article.filePath, { article, relevance, matchedTerms });
      }
    }
  }

  // Sort by relevance and number of matched terms
  const sorted = Array.from(results.values()).sort((a, b) => {
    // Primary: relevance score
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    // Secondary: number of matched terms
    return b.matchedTerms.length - a.matchedTerms.length;
  });

  console.log(`📚 Parallel search found ${sorted.length} results`);
  return sorted.slice(0, limit);
}

/**
 * Fetch article content from local repo
 */
export async function fetchArticleContent(url: string): Promise<WikiContent | null> {
  const articles = await getWikiIndex();
  const article = articles.find(a => a.url === url);

  if (!article?.filePath) {
    console.log(`📄 Article not found in index: ${url}`);
    return null;
  }

  try {
    const content = await readFileFromRepo(article.filePath);

    // Strip frontmatter
    let cleanContent = content.replace(/^---[\s\S]*?---\n*/m, '');

    // Convert markdown to plain text (simple)
    cleanContent = cleanContent
      .replace(/```[\s\S]*?```/g, ' [code block] ')  // Code blocks
      .replace(/`[^`]+`/g, ' ')  // Inline code
      .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')  // Images
      .replace(/\[[^\]]+\]\([^)]+\)/g, (m) => m.match(/\[([^\]]+)\]/)?.[1] || '')  // Links -> text
      .replace(/#{1,6}\s+/g, '\n')  // Headers
      .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1')  // Bold/italic
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const excerpt = cleanContent.substring(0, 800) + (cleanContent.length > 800 ? '...' : '');

    return {
      title: article.title,
      url: article.url,
      content: cleanContent,
      excerpt,
    };
  } catch (error) {
    console.error(`Error fetching article ${url}:`, error);
    return null;
  }
}

/**
 * Fetch multiple articles in parallel
 */
export async function fetchArticles(urls: string[]): Promise<WikiContent[]> {
  const promises = urls.map(url => fetchArticleContent(url));
  const results = await Promise.all(promises);
  return results.filter((r): r is WikiContent => r !== null);
}

/**
 * Semantic query expansion - maps user intent to wiki topics
 * This is the key to finding relevant content from natural language questions
 */
const INTENT_TO_TOPICS: Record<string, string[]> = {
  // Security incidents
  'hacked': ['incident', 'response', 'cyber', 'security', 'breach', 'compromise'],
  'compromised': ['incident', 'response', 'cyber', 'security', 'breach', 'hacked'],
  'breach': ['incident', 'response', 'cyber', 'security', 'hacked', 'compromise'],
  'attacked': ['incident', 'response', 'cyber', 'security', 'breach', 'ddos'],
  'malware': ['incident', 'response', 'security', 'virus', 'ransomware', 'antivirus'],
  'virus': ['malware', 'incident', 'security', 'antivirus', 'response'],
  'ransomware': ['malware', 'incident', 'response', 'backup', 'security'],
  'phishing': ['incident', 'security', 'email', 'scam', 'social engineering'],
  'scam': ['phishing', 'security', 'fraud', 'social engineering'],

  // Security hardening
  'secure': ['hardening', 'security', 'privacy', 'protection', 'dfp'],
  'protect': ['hardening', 'security', 'privacy', 'dfp', 'secure'],
  'harden': ['hardening', 'security', 'configuration', 'secure'],
  'lock': ['hardening', 'security', 'privacy', 'secure', 'encrypt'],
  'safe': ['security', 'privacy', 'hardening', 'secure', 'protection'],

  // Privacy
  'privacy': ['dfp', 'hardening', 'opsec', 'security', 'tracking', 'fingerprint'],
  'tracking': ['privacy', 'dfp', 'fingerprint', 'browser', 'opsec'],
  'anonymous': ['privacy', 'opsec', 'vpn', 'tor', 'dfp'],
  'fingerprint': ['dfp', 'privacy', 'browser', 'tracking'],

  // Devices
  'phone': ['mobile', 'android', 'ios', 'device', 'hardening'],
  'mobile': ['phone', 'android', 'ios', 'device', 'hardening'],
  'android': ['mobile', 'phone', 'device', 'graphene', 'hardening'],
  'iphone': ['ios', 'mobile', 'phone', 'apple', 'device'],
  'laptop': ['computer', 'device', 'hardening', 'linux', 'boot'],
  'computer': ['laptop', 'desktop', 'device', 'linux', 'hardening'],

  // Operating systems
  'linux': ['ubuntu', 'debian', 'fedora', 'boot', 'install', 'operating system'],
  'windows': ['computer', 'operating system', 'hardening', 'security'],
  'flash': ['install', 'boot', 'usb', 'linux', 'operating system'],
  'install': ['flash', 'boot', 'setup', 'linux', 'operating system'],
  'boot': ['usb', 'flash', 'install', 'linux', 'bios'],

  // Networking
  'vpn': ['wireguard', 'openvpn', 'mullvad', 'proton', 'privacy', 'network'],
  'network': ['router', 'firewall', 'vpn', 'wifi', 'security'],
  'router': ['network', 'firewall', 'hardening', 'wifi'],
  'wifi': ['network', 'router', 'wireless', 'security'],
  'firewall': ['network', 'security', 'router', 'hardening'],

  // Communications
  'signal': ['messaging', 'chat', 'communication', 'privacy', 'encrypted'],
  'matrix': ['messaging', 'chat', 'communication', 'element'],
  'chat': ['messaging', 'signal', 'matrix', 'communication'],
  'email': ['protonmail', 'communication', 'privacy', 'security'],
  'encrypted': ['encryption', 'privacy', 'security', 'veracrypt'],

  // Encryption
  'encrypt': ['encryption', 'veracrypt', 'luks', 'cryptsetup', 'security'],
  'encryption': ['encrypt', 'veracrypt', 'luks', 'security', 'privacy'],
  'password': ['passwords', 'manager', 'security', 'authentication', 'bitwarden'],
  'passwords': ['password', 'manager', 'security', 'bitwarden', 'authentication'],
  '2fa': ['mfa', 'authentication', 'security', 'totp', 'yubikey'],
  'mfa': ['2fa', 'authentication', 'security', 'totp', 'yubikey'],

  // Research & OSINT
  'osint': ['research', 'investigation', 'intelligence', 'reconnaissance'],
  'research': ['osint', 'investigation', 'tools', 'methodology'],
  'investigate': ['osint', 'research', 'investigation', 'tools'],

  // Drones & UAS
  'drone': ['uas', 'suas', 'unmanned', 'fpv', 'part107'],
  'uas': ['drone', 'suas', 'unmanned', 'part107'],
  'fpv': ['drone', 'uas', 'flying', 'remote'],

  // AI & ML
  'ai': ['artificial intelligence', 'machine learning', 'ml', 'llm', 'gpt'],
  'llm': ['ai', 'gpt', 'chatgpt', 'language model'],
  'gpt': ['ai', 'llm', 'chatgpt', 'openai'],

  // Servers & Infrastructure
  'server': ['selfhost', 'docker', 'infrastructure', 'hosting', 'linux'],
  'docker': ['container', 'selfhost', 'server', 'infrastructure'],
  'selfhost': ['server', 'docker', 'hosting', 'infrastructure'],
  'hosting': ['server', 'selfhost', 'docker', 'infrastructure'],

  // Radio
  'radio': ['rf', 'sdr', 'ham', 'communications', 'antenna'],
  'ham': ['radio', 'amateur', 'license', 'communications'],
  'sdr': ['radio', 'software defined', 'rf', 'scanner'],
};

/**
 * Common question patterns that indicate specific topics
 */
const QUESTION_PATTERNS: Array<{ pattern: RegExp; topics: string[] }> = [
  // Security incidents
  { pattern: /\b(been|got|was|getting)\s+(hacked|compromised|breached|attacked)/i, topics: ['incident', 'response', 'cyber', 'security'] },
  { pattern: /\b(think|believe|suspect)\s+.*(hacked|compromised|breach)/i, topics: ['incident', 'response', 'cyber', 'security'] },
  { pattern: /\b(what|how)\s+.*(do|should)\s+.*(hacked|compromised|breach|incident)/i, topics: ['incident', 'response', 'cyber', 'security', 'guide'] },
  { pattern: /\bincident\s+response/i, topics: ['incident', 'response', 'cyber', 'guide'] },
  { pattern: /\bresponse\s+plan/i, topics: ['incident', 'response', 'cyber', 'guide'] },

  // Setup & Installation
  { pattern: /\b(how|want)\s+.*(install|setup|flash|boot)\s+.*(linux|ubuntu|debian)/i, topics: ['boot', 'usb', 'linux', 'install', 'flash'] },
  { pattern: /\b(install|flash|boot)\s+.*(os|operating|linux|ubuntu)/i, topics: ['boot', 'usb', 'linux', 'install'] },

  // Security hardening
  { pattern: /\b(how|want)\s+.*(secure|harden|protect|lock)/i, topics: ['hardening', 'security', 'guide'] },
  { pattern: /\b(secure|harden|protect)\s+.*(phone|mobile|computer|laptop|device)/i, topics: ['hardening', 'mobile', 'device', 'security'] },

  // Privacy
  { pattern: /\b(stop|prevent|avoid)\s+.*(tracking|fingerprint)/i, topics: ['dfp', 'privacy', 'fingerprint', 'browser'] },
  { pattern: /\bprivacy\s+(guide|tips|best)/i, topics: ['privacy', 'dfp', 'opsec', 'guide'] },

  // Passwords
  { pattern: /\bpassword\s+(manager|vault|safe)/i, topics: ['password', 'manager', 'bitwarden', 'security'] },
  { pattern: /\b(best|recommend)\s+.*(password|2fa|mfa)/i, topics: ['password', 'manager', 'authentication', 'security'] },

  // VPN
  { pattern: /\b(best|recommend|which)\s+.*(vpn)/i, topics: ['vpn', 'wireguard', 'mullvad', 'proton', 'privacy'] },
  { pattern: /\b(setup|configure|install)\s+.*(vpn|wireguard)/i, topics: ['vpn', 'wireguard', 'setup', 'guide'] },

  // Encryption
  { pattern: /\b(encrypt|encryption)\s+.*(drive|disk|file)/i, topics: ['encryption', 'veracrypt', 'luks', 'security'] },

  // Communications
  { pattern: /\b(secure|private|encrypted)\s+.*(messaging|chat|communication)/i, topics: ['signal', 'matrix', 'messaging', 'privacy'] },

  // Drones
  { pattern: /\b(drone|uas|part\s*107)\s+.*(certif|license|test)/i, topics: ['drone', 'uas', 'part107', 'certification'] },
  { pattern: /\b(fly|flying)\s+.*(drone|uas)/i, topics: ['drone', 'uas', 'regulations', 'airspace'] },
];

/**
 * Generate AI-enriched search queries from a question
 */
export function generateSearchQueries(question: string): string[] {
  const queries: string[] = [question];
  const questionLower = question.toLowerCase();

  // Extract words
  const words = questionLower
    .replace(/[?!.,'"]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2);

  const stopWords = ['what', 'where', 'when', 'which', 'how', 'does', 'about', 'should', 'would', 'could', 'this', 'that', 'there', 'have', 'with', 'from', 'they', 'been', 'were', 'being', 'think', 'know', 'want', 'need', 'help', 'please', 'can', 'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our', 'out'];
  const keywords = words.filter(w => !stopWords.includes(w));

  // Add individual keywords
  for (const kw of keywords.slice(0, 5)) {
    queries.push(kw);
  }

  // Check question patterns first (highest priority)
  for (const { pattern, topics } of QUESTION_PATTERNS) {
    if (pattern.test(questionLower)) {
      queries.push(...topics);
    }
  }

  // Expand keywords using intent mapping
  for (const keyword of keywords) {
    const topics = INTENT_TO_TOPICS[keyword];
    if (topics) {
      queries.push(...topics);
    }
  }

  // Add keyword combinations
  if (keywords.length >= 2) {
    queries.push(keywords.slice(0, 3).join(' '));
  }

  // Dedupe and limit
  const uniqueQueries = [...new Set(queries)];
  console.log(`📚 Generated ${uniqueQueries.length} search queries from: "${question.substring(0, 50)}..."`);

  return uniqueQueries.slice(0, 15);
}
