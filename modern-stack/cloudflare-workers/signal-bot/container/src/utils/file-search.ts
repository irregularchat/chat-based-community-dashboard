/**
 * File Search Utility for IrregularChat Archive
 *
 * Provides file search capabilities within the IrregularChat directory structure.
 * Features:
 * - Filename search with glob patterns
 * - Smart grep with AI-generated keywords
 * - Content search within files
 * - pCloud public URL generation
 *
 * SECURITY: This module uses PURE NODE.JS FILESYSTEM APIs.
 * NO shell commands are executed. User input never touches a shell.
 * This completely eliminates command injection as an attack vector.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createReadStream } from 'fs';
import * as readline from 'readline';
import OpenAI from 'openai';

// Base path for IrregularChat directory (mounted from host)
const IRREGULARCHAT_BASE = process.env.IRREGULARCHAT_PATH || '/app/irregularchat';

// pCloud public folder base URL
const PCLOUD_PUBLIC_URL = process.env.PCLOUD_PUBLIC_URL || 'https://u.pcloud.link/publink/show?code=kZ8boiVZ2peBXyioGY8yJSqlMyacwHfa6RLV';

// ============================================================================
// FILE INDEX - Pre-built index refreshed periodically (no shell commands)
// ============================================================================

interface FileIndexEntry {
  name: string;
  nameLower: string;  // Pre-computed lowercase for fast searching
  path: string;
  relativePath: string;
  size: number;
  modified: Date;
  category: string;
}

interface FileIndex {
  entries: FileIndexEntry[];
  lastUpdated: Date;
  totalFiles: number;
}

// Global file index - built once, refreshed periodically
let fileIndex: FileIndex | null = null;
let indexBuildPromise: Promise<FileIndex> | null = null;
const INDEX_REFRESH_INTERVAL = 60 * 60 * 1000; // 1 hour (configurable)
const INDEX_MAX_FILES = 50000;

/**
 * Build or refresh the file index using pure Node.js APIs
 * No shell commands - uses fs.readdir recursively
 */
async function buildFileIndex(): Promise<FileIndex> {
  console.log('📂 Building file index (pure Node.js)...');
  const startTime = Date.now();
  const entries: FileIndexEntry[] = [];

  async function walkDir(dir: string): Promise<void> {
    if (entries.length >= INDEX_MAX_FILES) return;

    try {
      const items = await fs.readdir(dir, { withFileTypes: true });

      for (const item of items) {
        if (entries.length >= INDEX_MAX_FILES) break;

        // Skip hidden files/dirs and node_modules
        if (item.name.startsWith('.') || item.name === 'node_modules') {
          continue;
        }

        const fullPath = path.join(dir, item.name);

        if (item.isDirectory()) {
          await walkDir(fullPath);
        } else if (item.isFile()) {
          try {
            const stat = await fs.stat(fullPath);
            const relativePath = path.relative(IRREGULARCHAT_BASE, fullPath);
            const category = relativePath.split(path.sep)[0] || 'UNSORTED';

            entries.push({
              name: item.name,
              nameLower: item.name.toLowerCase(),
              path: fullPath,
              relativePath,
              size: stat.size,
              modified: stat.mtime,
              category,
            });
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await walkDir(IRREGULARCHAT_BASE);

  const elapsed = Date.now() - startTime;
  console.log(`✅ File index built: ${entries.length} files in ${elapsed}ms`);

  return {
    entries,
    lastUpdated: new Date(),
    totalFiles: entries.length,
  };
}

/**
 * Get the file index, building it if necessary
 * Thread-safe: only one build runs at a time
 */
async function getFileIndex(): Promise<FileIndex> {
  const now = Date.now();

  // Check if index needs refresh
  if (fileIndex && (now - fileIndex.lastUpdated.getTime()) < INDEX_REFRESH_INTERVAL) {
    return fileIndex;
  }

  // If already building, wait for that
  if (indexBuildPromise) {
    return indexBuildPromise;
  }

  // Build new index
  indexBuildPromise = buildFileIndex();
  try {
    fileIndex = await indexBuildPromise;
    return fileIndex;
  } finally {
    indexBuildPromise = null;
  }
}

/**
 * Force refresh the file index
 */
export async function refreshFileIndex(): Promise<void> {
  fileIndex = null;
  await getFileIndex();
}

// ============================================================================
// INTERFACES
// ============================================================================

export interface FileInfo {
  name: string;
  path: string;
  relativePath: string;
  size: number;
  modified: Date;
  isDirectory: boolean;
  category?: string;
}

export interface SearchResult {
  files: FileInfo[];
  totalCount: number;
  truncated: boolean;
  query: string;
  searchType: 'filename' | 'content' | 'smart';
}

export interface GrepMatch {
  file: FileInfo;
  lineNumber: number;
  lineContent: string;
  matchedText: string;
}

export interface GrepResult {
  matches: GrepMatch[];
  totalMatches: number;
  truncated: boolean;
  query: string;
  keywords?: string[];
}

export interface DirInfo {
  name: string;
  path: string;
  relativePath: string;
}

// ============================================================================
// SEARCH FUNCTIONS - Pure JavaScript, no shell commands
// ============================================================================

/**
 * Parsed search query with support for:
 * - OR: matches if any term matches
 * - "quoted phrases": exact phrase match
 * - NOT or -term: exclusion
 * - Implicit AND: space-separated terms all must match
 */
interface ParsedQuery {
  mustMatch: string[];      // AND terms (all must match)
  shouldMatch: string[];    // OR terms (any can match)
  mustNotMatch: string[];   // NOT terms (none can match)
}

/**
 * Parse a search query with support for operators
 * Examples:
 *   "drone attack" -> mustMatch: ["drone attack"]
 *   drone OR uav -> shouldMatch: ["drone", "uav"]
 *   drone -toy -> mustMatch: ["drone"], mustNotMatch: ["toy"]
 *   drone NOT toy -> mustMatch: ["drone"], mustNotMatch: ["toy"]
 *   "drone strike" OR "uav attack" -> shouldMatch: ["drone strike", "uav attack"]
 */
function parseSearchQuery(query: string): ParsedQuery {
  const result: ParsedQuery = {
    mustMatch: [],
    shouldMatch: [],
    mustNotMatch: [],
  };

  // Normalize quotes: convert curly/smart quotes to straight quotes
  let normalizedQuery = query
    .replace(/[""„‟]/g, '"')  // Various double quote styles to straight double
    .replace(/[''‚‛]/g, "'"); // Various single quote styles to straight single

  // Extract quoted phrases first (handles both double and single quotes)
  const quotedPhrases: string[] = [];
  let processedQuery = normalizedQuery.replace(/"([^"]+)"/g, (_, phrase) => {
    quotedPhrases.push(phrase.trim());
    return `__QUOTED_${quotedPhrases.length - 1}__`;
  });

  // Check if query contains OR (case-insensitive)
  const hasOr = /\bOR\b/i.test(processedQuery);

  if (hasOr) {
    // Split by OR and treat each part as "should match"
    const orParts = processedQuery.split(/\bOR\b/i);
    for (const part of orParts) {
      const term = part.trim();
      if (!term) continue;

      // Restore quoted phrases
      const restored = term.replace(/__QUOTED_(\d+)__/g, (_, idx) => quotedPhrases[parseInt(idx)]);
      if (restored) {
        result.shouldMatch.push(restored.toLowerCase());
      }
    }
  } else {
    // Split by spaces for AND logic
    const tokens = processedQuery.split(/\s+/);

    for (let i = 0; i < tokens.length; i++) {
      let token = tokens[i].trim();
      if (!token) continue;

      // Check for NOT operator
      if (token.toUpperCase() === 'NOT' && i + 1 < tokens.length) {
        const nextToken = tokens[++i].trim();
        const restored = nextToken.replace(/__QUOTED_(\d+)__/g, (_, idx) => quotedPhrases[parseInt(idx)]);
        if (restored) {
          result.mustNotMatch.push(restored.toLowerCase());
        }
        continue;
      }

      // Check for -prefix exclusion
      if (token.startsWith('-') && token.length > 1) {
        const term = token.substring(1);
        const restored = term.replace(/__QUOTED_(\d+)__/g, (_, idx) => quotedPhrases[parseInt(idx)]);
        if (restored) {
          result.mustNotMatch.push(restored.toLowerCase());
        }
        continue;
      }

      // Regular term (must match)
      const restored = token.replace(/__QUOTED_(\d+)__/g, (_, idx) => quotedPhrases[parseInt(idx)]);
      if (restored) {
        result.mustMatch.push(restored.toLowerCase());
      }
    }
  }

  return result;
}

/**
 * Check if a string matches a parsed query
 */
function matchesQuery(text: string, query: ParsedQuery): boolean {
  const textLower = text.toLowerCase();

  // Check must NOT match (exclusions)
  for (const term of query.mustNotMatch) {
    if (textLower.includes(term)) {
      return false;  // Excluded term found
    }
  }

  // Check OR logic (should match - any one is sufficient)
  if (query.shouldMatch.length > 0) {
    const anyMatch = query.shouldMatch.some(term => textLower.includes(term));
    if (!anyMatch) {
      return false;
    }
  }

  // Check AND logic (must match - all required)
  for (const term of query.mustMatch) {
    if (!textLower.includes(term)) {
      return false;  // Required term not found
    }
  }

  return true;
}

/**
 * Convert a glob-like pattern to a regex
 * Supports: * (any chars), ? (single char)
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
    .replace(/\*/g, '.*')                    // * -> .*
    .replace(/\?/g, '.');                    // ? -> .

  return new RegExp(escaped, 'i');  // Case-insensitive
}

/**
 * List all files in the IrregularChat directory
 * Uses pre-built index - no shell commands
 */
export async function listAllFiles(maxFiles = 5000): Promise<FileInfo[]> {
  const index = await getFileIndex();
  const safeMax = Math.min(Math.max(1, Math.floor(maxFiles)), INDEX_MAX_FILES);

  return index.entries.slice(0, safeMax).map(entry => ({
    name: entry.name,
    path: entry.path,
    relativePath: entry.relativePath,
    size: entry.size,
    modified: entry.modified,
    isDirectory: false,
    category: entry.category,
  }));
}

/**
 * Search for directories matching a pattern
 * Uses pure Node.js - no shell commands
 */
export async function searchDirectories(pattern: string, maxResults = 10): Promise<DirInfo[]> {
  const dirs: DirInfo[] = [];
  const regex = globToRegex(pattern.includes('*') ? pattern : `*${pattern}*`);

  async function walkDir(dir: string, depth = 0): Promise<void> {
    if (dirs.length >= maxResults || depth > 10) return;

    try {
      const items = await fs.readdir(dir, { withFileTypes: true });

      for (const item of items) {
        if (dirs.length >= maxResults) break;

        if (item.isDirectory() && !item.name.startsWith('.')) {
          const fullPath = path.join(dir, item.name);
          const relativePath = path.relative(IRREGULARCHAT_BASE, fullPath);

          if (regex.test(item.name)) {
            dirs.push({
              name: item.name,
              path: fullPath,
              relativePath,
            });
          }

          await walkDir(fullPath, depth + 1);
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  await walkDir(IRREGULARCHAT_BASE);
  return dirs;
}

/**
 * Search files by filename pattern
 * Uses pre-built index and query parser - no shell commands
 *
 * Supports search operators:
 *   - OR: "drone OR uav" matches files with either term
 *   - "quoted phrases": "drone strike" matches exact phrase
 *   - NOT: "drone NOT toy" excludes files with "toy"
 *   - -term: "drone -toy" excludes files with "toy"
 *   - Implicit AND: "drone attack" matches files with both terms
 */
export async function searchByFilename(
  pattern: string,
  maxResults = 100
): Promise<SearchResult> {
  const index = await getFileIndex();

  // Check if pattern uses operators (OR, NOT, -, or quotes)
  const hasOperators = /\bOR\b|\bNOT\b|"[^"]+"|\s-\w/i.test(pattern);

  // Search the index in JavaScript - no shell
  const matches: FileIndexEntry[] = [];

  if (hasOperators) {
    // Use advanced query parser for operator-based searches
    const parsedQuery = parseSearchQuery(pattern);
    console.log(`🔍 Parsed query: must=${parsedQuery.mustMatch.join(',')} should=${parsedQuery.shouldMatch.join(',')} not=${parsedQuery.mustNotMatch.join(',')}`);

    for (const entry of index.entries) {
      // Combine filename and path for searching
      const searchText = `${entry.name} ${entry.relativePath}`;
      if (matchesQuery(searchText, parsedQuery)) {
        matches.push(entry);
        if (matches.length >= maxResults * 2) break;  // Get extra for sorting
      }
    }
  } else {
    // Use simple glob/substring matching for basic searches
    const searchPattern = pattern.includes('*') || pattern.includes('?')
      ? pattern
      : `*${pattern}*`;
    const regex = globToRegex(searchPattern);

    for (const entry of index.entries) {
      // Search both filename and relative path
      if (regex.test(entry.nameLower) || regex.test(entry.relativePath.toLowerCase())) {
        matches.push(entry);
        if (matches.length >= maxResults * 2) break;  // Get extra for sorting
      }
    }
  }

  // Sort by modified date (newest first)
  matches.sort((a, b) => b.modified.getTime() - a.modified.getTime());

  const files = matches.slice(0, maxResults).map(entry => ({
    name: entry.name,
    path: entry.path,
    relativePath: entry.relativePath,
    size: entry.size,
    modified: entry.modified,
    isDirectory: false,
    category: entry.category,
  }));

  return {
    files,
    totalCount: matches.length,
    truncated: matches.length > maxResults,
    query: pattern,
    searchType: 'filename',
  };
}

/**
 * Search file contents using pure Node.js
 * Reads files line by line with streams - no grep command
 */
export async function grepFiles(
  pattern: string,
  options: {
    maxMatches?: number;
    caseInsensitive?: boolean;
    filePattern?: string;  // e.g., "*.pdf" to only search PDFs
    contextLines?: number;
  } = {}
): Promise<GrepResult> {
  const {
    maxMatches = 30,
    caseInsensitive = true,
    filePattern,
    contextLines = 0,
  } = options;

  const matches: GrepMatch[] = [];
  const index = await getFileIndex();

  // Build search regex
  const flags = caseInsensitive ? 'gi' : 'g';
  let searchRegex: RegExp;
  try {
    searchRegex = new RegExp(pattern, flags);
  } catch {
    // If pattern isn't valid regex, escape it
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    searchRegex = new RegExp(escaped, flags);
  }

  // Build file filter regex if specified
  let fileRegex: RegExp | null = null;
  if (filePattern) {
    fileRegex = globToRegex(filePattern);
  }

  // Text file extensions to search
  const textExtensions = new Set([
    '.txt', '.md', '.log', '.json', '.xml', '.html', '.htm',
    '.csv', '.py', '.js', '.ts', '.sh', '.yml', '.yaml',
    '.cfg', '.conf', '.ini', '.env', '.bat', '.ps1',
  ]);

  // Search files
  for (const entry of index.entries) {
    if (matches.length >= maxMatches) break;

    // Filter by file pattern if specified
    if (fileRegex && !fileRegex.test(entry.name)) {
      continue;
    }

    // Only search text files
    const ext = path.extname(entry.name).toLowerCase();
    if (!textExtensions.has(ext)) {
      continue;
    }

    // Skip large files (> 10MB)
    if (entry.size > 10 * 1024 * 1024) {
      continue;
    }

    // Search file contents
    try {
      const fileMatches = await searchFileContents(entry, searchRegex, 5);
      for (const match of fileMatches) {
        matches.push(match);
        if (matches.length >= maxMatches) break;
      }
    } catch {
      // Skip files we can't read
    }
  }

  return {
    matches,
    totalMatches: matches.length,
    truncated: matches.length >= maxMatches,
    query: pattern,
  };
}

/**
 * Search a single file's contents line by line
 * Uses streams for memory efficiency - no shell commands
 */
async function searchFileContents(
  entry: FileIndexEntry,
  regex: RegExp,
  maxMatchesPerFile: number
): Promise<GrepMatch[]> {
  return new Promise((resolve) => {
    const matches: GrepMatch[] = [];
    let lineNumber = 0;

    const fileStream = createReadStream(entry.path, { encoding: 'utf-8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      lineNumber++;

      // Reset regex lastIndex for each line
      regex.lastIndex = 0;

      if (regex.test(line)) {
        matches.push({
          file: {
            name: entry.name,
            path: entry.path,
            relativePath: entry.relativePath,
            size: entry.size,
            modified: entry.modified,
            isDirectory: false,
            category: entry.category,
          },
          lineNumber,
          lineContent: line.substring(0, 200),  // Truncate long lines
          matchedText: regex.source,
        });

        if (matches.length >= maxMatchesPerFile) {
          rl.close();
          fileStream.destroy();
        }
      }
    });

    rl.on('close', () => {
      resolve(matches);
    });

    rl.on('error', () => {
      resolve(matches);
    });

    // Timeout after 5 seconds per file
    setTimeout(() => {
      rl.close();
      fileStream.destroy();
      resolve(matches);
    }, 5000);
  });
}

/**
 * Generate smart search keywords using OpenAI
 */
export async function generateSearchKeywords(
  openai: OpenAI,
  query: string
): Promise<string[]> {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a search query optimizer. Given a natural language search query, generate 3-5 alternative search terms/keywords that could help find relevant files or content.

Output format: Return ONLY a JSON array of strings, no other text.
Example: ["drone strike", "UAV attack", "UAS engagement", "aerial assault"]

Focus on:
- Technical synonyms
- Related acronyms (e.g., UAV, UAS, sUAS for drones)
- Different phrasings
- Domain-specific terms for military, technology, cybersecurity topics`,
        },
        { role: 'user', content: query },
      ],
      max_tokens: 150,
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content || '[]';
    const keywords = JSON.parse(content);
    return Array.isArray(keywords) ? keywords : [query];
  } catch (error) {
    console.error('Failed to generate keywords:', error);
    return [query];
  }
}

/**
 * Smart search: Uses AI to generate keywords, then searches both filenames and content
 */
export async function smartSearch(
  openai: OpenAI,
  query: string,
  maxResults = 20
): Promise<{
  filenameResults: SearchResult;
  contentResults: GrepResult;
  keywords: string[];
}> {
  // Generate smart keywords
  const keywords = await generateSearchKeywords(openai, query);
  console.log(`🔍 Smart search keywords for "${query}": ${keywords.join(', ')}`);

  // Search filenames with all keywords
  const allFileMatches: FileInfo[] = [];
  const seenPaths = new Set<string>();

  for (const keyword of [query, ...keywords]) {
    const result = await searchByFilename(keyword, 50);
    for (const file of result.files) {
      if (!seenPaths.has(file.path)) {
        seenPaths.add(file.path);
        allFileMatches.push(file);
      }
    }
  }

  // Sort by relevance
  const queryLower = query.toLowerCase();
  allFileMatches.sort((a, b) => {
    const aMatchesQuery = a.name.toLowerCase().includes(queryLower) ? 1 : 0;
    const bMatchesQuery = b.name.toLowerCase().includes(queryLower) ? 1 : 0;
    if (aMatchesQuery !== bMatchesQuery) return bMatchesQuery - aMatchesQuery;
    return b.modified.getTime() - a.modified.getTime();
  });

  const filenameResults: SearchResult = {
    files: allFileMatches.slice(0, maxResults),
    totalCount: allFileMatches.length,
    truncated: allFileMatches.length > maxResults,
    query,
    searchType: 'smart',
  };

  // Search content with keywords (for text files)
  const allGrepMatches: GrepMatch[] = [];
  const seenGrepPaths = new Set<string>();

  for (const keyword of [query, ...keywords]) {
    const result = await grepFiles(keyword, {
      maxMatches: 20,
      filePattern: '*.{txt,md,log,json,xml,html,csv,py,js,ts,sh,yml,yaml}',
    });

    for (const match of result.matches) {
      if (!seenGrepPaths.has(`${match.file.path}:${match.lineNumber}`)) {
        seenGrepPaths.add(`${match.file.path}:${match.lineNumber}`);
        allGrepMatches.push(match);
      }
    }
  }

  const contentResults: GrepResult = {
    matches: allGrepMatches.slice(0, maxResults),
    totalMatches: allGrepMatches.length,
    truncated: allGrepMatches.length > maxResults,
    query,
    keywords,
  };

  return { filenameResults, contentResults, keywords };
}

// ============================================================================
// PCLOUD URL GENERATION
// ============================================================================

/**
 * Get the pCloud public URL for a file or directory (browse view)
 */
export function getPCloudUrl(relativePath: string, isDirectory = false): string {
  const cleanPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');

  if (!cleanPath) {
    return PCLOUD_PUBLIC_URL;
  }

  if (isDirectory) {
    return `${PCLOUD_PUBLIC_URL}#folder=${encodeURIComponent(cleanPath)}`;
  }

  const dirPath = path.dirname(cleanPath);
  const fileName = path.basename(cleanPath);
  if (dirPath && dirPath !== '.') {
    return `${PCLOUD_PUBLIC_URL}#folder=${encodeURIComponent(dirPath)}&file=${encodeURIComponent(fileName)}`;
  }
  return `${PCLOUD_PUBLIC_URL}#file=${encodeURIComponent(fileName)}`;
}

// Extract the public folder code from the URL
const PCLOUD_PUBLIC_CODE = (() => {
  const match = PCLOUD_PUBLIC_URL.match(/code=([^&]+)/);
  return match ? match[1] : 'kZ8boiVZ2peBXyioGY8yJSqlMyacwHfa6RLV';
})();

// pCloud API host (use api.pcloud.com for US, eapi.pcloud.com for EU)
const PCLOUD_API_HOST = process.env.PCLOUD_API_HOST || 'api.pcloud.com';

// ============================================================================
// PCLOUD FILE INDEX - Maps file paths to fileids for download links
// ============================================================================

interface PCloudFileEntry {
  fileid: number;
  parentfolderid: number;  // Parent folder ID for web viewer URL
  name: string;
  path: string;  // Full path from root of public folder
  size: number;
}

interface PCloudFolderIndex {
  files: Map<string, PCloudFileEntry>;  // path -> entry
  lastUpdated: Date;
}

let pcloudIndex: PCloudFolderIndex | null = null;
let pcloudIndexPromise: Promise<PCloudFolderIndex> | null = null;
const PCLOUD_INDEX_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Recursively build file index from pCloud showpublink response
 */
function indexPCloudContents(
  contents: any[],
  currentPath: string,
  parentFolderId: number,
  files: Map<string, PCloudFileEntry>
): void {
  for (const item of contents) {
    const itemPath = currentPath ? `${currentPath}/${item.name}` : item.name;

    if (item.isfolder) {
      // Recurse into folders, passing this folder's ID as parent
      if (item.contents && Array.isArray(item.contents)) {
        indexPCloudContents(item.contents, itemPath, item.folderid || parentFolderId, files);
      }
    } else {
      // It's a file - store it with its fileid and parent folder ID
      if (item.fileid) {
        files.set(itemPath.toLowerCase(), {
          fileid: item.fileid,
          parentfolderid: item.parentfolderid || parentFolderId,
          name: item.name,
          path: itemPath,
          size: item.size || 0,
        });
      }
    }
  }
}

/**
 * Fetch and cache the pCloud public folder structure
 * This gives us fileids for all files in the public folder
 */
async function buildPCloudIndex(): Promise<PCloudFolderIndex> {
  console.log('📂 Building pCloud file index...');
  const startTime = Date.now();
  const files = new Map<string, PCloudFileEntry>();

  try {
    const response = await fetch(
      `https://${PCLOUD_API_HOST}/showpublink?code=${PCLOUD_PUBLIC_CODE}`
    );
    const data = await response.json() as any;

    if (data.result === 0 && data.metadata) {
      // Get the root folder ID for use as parent
      const rootFolderId = data.metadata.folderid || 0;

      // Start indexing from the root folder's contents
      if (data.metadata.contents && Array.isArray(data.metadata.contents)) {
        indexPCloudContents(data.metadata.contents, '', rootFolderId, files);
      }

      const elapsed = Date.now() - startTime;
      console.log(`✅ pCloud index built: ${files.size} files in ${elapsed}ms`);
    } else {
      console.error('❌ Failed to fetch pCloud folder structure:', data.error || data.result);
    }
  } catch (error) {
    console.error('❌ Error fetching pCloud folder structure:', error);
  }

  return {
    files,
    lastUpdated: new Date(),
  };
}

/**
 * Get the pCloud file index, building it if necessary
 */
async function getPCloudIndex(): Promise<PCloudFolderIndex> {
  const now = Date.now();

  // Check if index needs refresh
  if (pcloudIndex && (now - pcloudIndex.lastUpdated.getTime()) < PCLOUD_INDEX_TTL) {
    return pcloudIndex;
  }

  // If already building, wait for that
  if (pcloudIndexPromise) {
    return pcloudIndexPromise;
  }

  // Build new index
  pcloudIndexPromise = buildPCloudIndex();
  try {
    pcloudIndex = await pcloudIndexPromise;
    return pcloudIndex;
  } finally {
    pcloudIndexPromise = null;
  }
}

/**
 * Look up a fileid from the pCloud index by path
 */
async function getFileIdByPath(relativePath: string): Promise<number | null> {
  const index = await getPCloudIndex();
  const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();

  const entry = index.files.get(normalizedPath);
  return entry ? entry.fileid : null;
}

/**
 * Get a shareable link for a file in the public folder
 *
 * IMPORTANT: pCloud's getpublinkdownload returns temporary IP-bound URLs that
 * only work from the same IP that generated them. Since the server generates
 * links but users access them from different IPs, those links don't work.
 *
 * Instead, we return a web viewer URL with folder and file parameters.
 * Users click the link, see the pCloud web interface, and can download
 * from there (generating a download link from their own IP).
 *
 * URL format: https://u.pcloud.link/publink/show?code=XXX#folder=FOLDER_ID&file=FILE_ID
 */
export async function getDirectDownloadLink(relativePath: string): Promise<{
  success: boolean;
  link?: string;
  error?: string;
}> {
  const cleanPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');

  if (!cleanPath) {
    return { success: false, error: 'No file path provided' };
  }

  try {
    // Look up the file entry from our cached index
    const index = await getPCloudIndex();
    const normalizedPath = cleanPath.toLowerCase();
    const entry = index.files.get(normalizedPath);

    if (!entry) {
      console.log(`pCloud: No entry found for path: ${cleanPath}`);
      // Fall back to folder browse URL
      const dirPath = cleanPath.split('/').slice(0, -1).join('/');
      return {
        success: true,
        link: dirPath
          ? `${PCLOUD_PUBLIC_URL}#folder=${encodeURIComponent(dirPath)}`
          : PCLOUD_PUBLIC_URL,
      };
    }

    // Construct web viewer URL with folder and file IDs
    // This takes users directly to the file in the pCloud web interface
    const viewerUrl = `${PCLOUD_PUBLIC_URL}#folder=${entry.parentfolderid}&file=${entry.fileid}`;
    console.log(`✅ pCloud viewer link generated for ${cleanPath} (folder=${entry.parentfolderid}, file=${entry.fileid})`);

    return { success: true, link: viewerUrl };
  } catch (error) {
    console.error('Error getting pCloud link:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// SEARCH SESSION MANAGEMENT
// ============================================================================

export interface SearchSession {
  id: string;
  query: string;
  files: FileInfo[];
  createdAt: number;
  expiresAt: number;
}

const searchSessions = new Map<string, SearchSession>();
const SESSION_TTL = 10 * 60 * 1000;
const lastSessionByContext = new Map<string, string>();

function generateSessionId(): string {
  return Math.random().toString(36).substring(2, 8);
}

function deduplicateFiles(files: FileInfo[]): FileInfo[] {
  const seen = new Map<string, FileInfo>();

  for (const file of files) {
    const key = `${file.name.toLowerCase()}:${file.size}`;
    if (!seen.has(key)) {
      seen.set(key, file);
    }
  }

  return Array.from(seen.values());
}

export function createSearchSession(query: string, files: FileInfo[], contextId?: string): SearchSession {
  const now = Date.now();
  for (const [id, session] of searchSessions) {
    if (session.expiresAt < now) {
      searchSessions.delete(id);
    }
  }

  const dedupedFiles = deduplicateFiles(files);

  const session: SearchSession = {
    id: generateSessionId(),
    query,
    files: dedupedFiles.slice(0, 20),
    createdAt: now,
    expiresAt: now + SESSION_TTL,
  };

  searchSessions.set(session.id, session);

  if (contextId) {
    lastSessionByContext.set(contextId, session.id);
  }

  return session;
}

export function getLastSession(contextId: string): SearchSession | null {
  const sessionId = lastSessionByContext.get(contextId);
  if (!sessionId) return null;
  return getSearchSession(sessionId);
}

export function getSearchSession(id: string): SearchSession | null {
  const session = searchSessions.get(id);
  if (!session || session.expiresAt < Date.now()) {
    searchSessions.delete(id);
    return null;
  }
  return session;
}

export function getFileFromSession(sessionId: string, fileNumber: number): FileInfo | null {
  const session = getSearchSession(sessionId);
  if (!session) return null;

  const index = fileNumber - 1;
  if (index < 0 || index >= session.files.length) return null;

  return session.files[index];
}

// ============================================================================
// RESULT FORMATTING
// ============================================================================

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatSearchResults(
  results: SearchResult,
  contentResults?: GrepResult,
  contextId?: string
): { message: string; sessionId?: string } {
  const lines: string[] = [];

  if (results.files.length === 0 && (!contentResults || contentResults.matches.length === 0)) {
    return { message: `🔍 No files found matching "${results.query}"` };
  }

  if (results.files.length > 0) {
    const dedupedFiles = deduplicateFiles(results.files);
    const totalUnique = dedupedFiles.length;

    lines.push(`📁 Found ${totalUnique} file${totalUnique !== 1 ? 's' : ''} matching "${results.query}"`);
    lines.push('');

    const session = createSearchSession(results.query, dedupedFiles, contextId);
    const filesToShow = Math.min(session.files.length, 20);

    if (session.files.length <= 3) {
      for (let i = 0; i < filesToShow; i++) {
        const file = session.files[i];
        const size = formatFileSize(file.size);
        const date = file.modified.toISOString().split('T')[0];
        const url = getPCloudUrl(file.relativePath, false);
        lines.push(`${i + 1}. ${file.name}`);
        lines.push(`   ${file.category} • ${size} • ${date}`);
        lines.push(`   ${url}`);
        lines.push('');
      }
    } else {
      const categories = [...new Set(session.files.map(f => f.category))];
      lines.push(`Categories: ${categories.slice(0, 5).join(', ')}${categories.length > 5 ? '...' : ''}`);
      lines.push('');

      for (let i = 0; i < filesToShow; i++) {
        const file = session.files[i];
        const size = formatFileSize(file.size);
        lines.push(`${i + 1}. ${file.name} (${file.category}, ${size})`);
      }

      if (session.files.length > 20) {
        lines.push(`   ... and ${session.files.length - 20} more`);
      }

      lines.push('');
      lines.push(`Reply: number for link, "tldr N" to summarize PDF`);
    }

    lines.push('');
    lines.push(`📂 Browse: ${PCLOUD_PUBLIC_URL}`);

    return { message: lines.join('\n'), sessionId: session.id };
  }

  if (contentResults && contentResults.matches.length > 0) {
    lines.push(`📝 Found ${contentResults.totalMatches} content match${contentResults.totalMatches !== 1 ? 'es' : ''}`);

    if (contentResults.keywords && contentResults.keywords.length > 0) {
      lines.push(`Keywords: ${contentResults.keywords.join(', ')}`);
    }

    lines.push('');

    const fileGroups = new Map<string, GrepMatch[]>();
    for (const match of contentResults.matches) {
      const existing = fileGroups.get(match.file.path) || [];
      existing.push(match);
      fileGroups.set(match.file.path, existing);
    }

    const fileGroupsArray = Array.from(fileGroups.entries()).slice(0, 5);
    const contentFiles = fileGroupsArray.map(([, matches]) => matches[0].file);
    const session = createSearchSession(results.query || contentResults.query, contentFiles);

    let fileNum = 1;
    for (const [, matches] of fileGroupsArray) {
      const file = matches[0].file;
      lines.push(`${fileNum}. ${file.name} (${file.category})`);

      for (const match of matches.slice(0, 2)) {
        const preview = match.lineContent.length > 60
          ? match.lineContent.substring(0, 57) + '...'
          : match.lineContent;
        lines.push(`   L${match.lineNumber}: ${preview}`);
      }

      if (matches.length > 2) {
        lines.push(`   ... ${matches.length - 2} more matches`);
      }
      fileNum++;
    }

    if (fileGroups.size > 5) {
      lines.push(`... and ${fileGroups.size - 5} more files with matches`);
    }

    lines.push('');
    lines.push(`Reply with number(s) for direct links`);
    lines.push(`Session: ${session.id}`);
    lines.push('');
    lines.push(`📂 Browse: ${PCLOUD_PUBLIC_URL}`);

    return { message: lines.join('\n'), sessionId: session.id };
  }

  return { message: lines.join('\n') };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function getIrregularChatBase(): string {
  return IRREGULARCHAT_BASE;
}

export async function listCategories(): Promise<string[]> {
  try {
    const entries = await fs.readdir(IRREGULARCHAT_BASE, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort();
  } catch {
    return [];
  }
}

export async function getFilesInCategory(
  category: string,
  maxFiles = 100
): Promise<FileInfo[]> {
  const index = await getFileIndex();

  const files = index.entries
    .filter(entry => entry.category === category)
    .slice(0, maxFiles)
    .map(entry => ({
      name: entry.name,
      path: entry.path,
      relativePath: entry.relativePath,
      size: entry.size,
      modified: entry.modified,
      isDirectory: false,
      category: entry.category,
    }));

  files.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return files;
}
