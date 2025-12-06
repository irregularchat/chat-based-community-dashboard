/**
 * File Organizer for IrregularChat Community
 *
 * Organizes files from Signal attachments into the IrregularChat directory structure
 * which syncs via rclone to pCloud.
 *
 * Features:
 * - Signal group to directory mapping
 * - Keyword-based categorization
 * - AI-powered topic detection
 * - Filename normalization
 * - Optional virus scanning (ClamAV)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Base path for IrregularChat directory (mounted from host)
const IRREGULARCHAT_BASE = process.env.IRREGULARCHAT_PATH || '/app/irregularchat';

/**
 * Signal Group to Directory Mapping
 * Maps group names (partial match) to target directories
 */
export const GROUP_DIRECTORY_MAP: Record<string, string> = {
  // Topic-based groups
  'ai/ml': 'AI-ML',
  'ai-ml': 'AI-ML',
  'ai ml': 'AI-ML',
  'nlp': 'AI-ML',
  'machine learning': 'AI-ML',

  'space': 'Space',

  'tech': 'Tech',
  'technology': 'Tech',

  'counter uxv': 'UnmannedSystems/Counter_Unmanned_Systems',
  'counter-uxv': 'UnmannedSystems/Counter_Unmanned_Systems',
  'cuas': 'UnmannedSystems/Counter_Unmanned_Systems',
  'c-uas': 'UnmannedSystems/Counter_Unmanned_Systems',
  'counter unmanned': 'UnmannedSystems/Counter_Unmanned_Systems',

  'suas': 'UnmannedSystems',
  'unmanned': 'UnmannedSystems',
  'drone': 'UnmannedSystems',
  'uxv': 'UnmannedSystems',
  'uav': 'UnmannedSystems',
  'fpv': 'UnmannedSystems',

  'dragon': 'DragonOS',
  'dragonos': 'DragonOS',
  'rf': 'DragonOS',
  'sdr': 'DragonOS',
  'radio': 'DragonOS',

  'iwar': 'Influence',
  'influence': 'Influence',
  'information warfare': 'Influence',
  'psyop': 'Influence',
  'miso': 'Influence',

  'cyber': 'Cybersecurity',
  'cybersecurity': 'Cybersecurity',
  'infosec': 'Cybersecurity',
  'security': 'Cybersecurity',

  'red team': 'Red Teaming',
  'redteam': 'Red Teaming',
  'pentest': 'Red Teaming',
  'offensive': 'Red Teaming',

  'blue team': 'Blue Team',
  'blueteam': 'Blue Team',
  'defensive': 'Blue Team',
  'soc': 'Blue Team',

  'osint': 'Research',
  'research': 'Research',
  'intel': 'Research',
  'intelligence': 'Research',

  'business': 'Business',
  'startup': 'Business',
  'entrepreneur': 'Business',

  'fabrication': 'Fabrication',
  '3d print': 'Fabrication',
  'maker': 'Fabrication',

  'leadership': 'Leadership',
  'development': 'Leadership',

  'off topic': 'Off topic',
  'offtopic': 'Off topic',
  'general': 'Off topic',

  'bot development': 'Tech',
  'bot dev': 'Tech',

  // Regional groups - default to UNSORTED or could create regional folders
  'alabama': 'UNSORTED',
  'georgia': 'UNSORTED',
  'florida': 'UNSORTED',
  'texas': 'UNSORTED',

  // Entry/INDOC goes to general
  'entry': 'UNSORTED',
  'indoc': 'UNSORTED',
  'fbnc': 'UNSORTED',
};

/**
 * Keyword to Subdirectory Mapping
 * For more specific categorization based on content/filename
 */
export const KEYWORD_SUBDIRECTORY_MAP: Record<string, Record<string, string>> = {
  'UnmannedSystems': {
    'russia': 'Adversary/Russia',
    'russian': 'Adversary/Russia',
    'china': 'Adversary/China',
    'chinese': 'Adversary/China',
    'iran': 'Adversary',
    'report': 'Reports',
    'analysis': 'Analysis',
    'capability': 'Capability_Briefs',
    'brief': 'Capability_Briefs',
    'guide': 'Documents/Guides',
    'lesson': 'Documents/Lessons_Learned',
    'policy': 'Documents/Policy_and_Doctrine',
    'doctrine': 'Documents/Policy_and_Doctrine',
    'ground truth': 'Ground_Truth',
    'video': 'Audio_Video',
    'recording': 'Audio_Video/Recordings',
    'translation': 'pending_translation',
    'translate': 'pending_translation',
  },
  'Research': {
    'ukraine': 'Region /Ukraine_Russia',
    'russia': 'Region /Ukraine_Russia',
    'china': 'Region /China',
    'centcom': 'Region /CENTCOM',
    'latam': 'Region /LATAM',
    'colombia': 'Region /LATAM/Colombia ',
    'osint': 'Open-Source-Data',
    'guide': 'Guides',
    'automation': 'Automation',
  },
  'Influence': {
    'adversary': 'Adversary',
    'russia': 'Adversary',
    'china': 'Adversary',
    'iran': 'Adversary',
  },
};

/**
 * File type to subdirectory mapping
 */
export const FILETYPE_SUBDIRECTORY_MAP: Record<string, string> = {
  '.mp4': 'Audio_Video',
  '.mov': 'Audio_Video',
  '.avi': 'Audio_Video',
  '.mkv': 'Audio_Video',
  '.webm': 'Audio_Video',
  '.mp3': 'Audio_Video',
  '.wav': 'Audio_Video',
  '.m4a': 'Audio_Video',
  '.pdf': 'Documents',
  '.doc': 'Documents',
  '.docx': 'Documents',
  '.ppt': 'Documents',
  '.pptx': 'Documents',
  '.xls': 'Documents',
  '.xlsx': 'Documents',
  '.png': 'Images',
  '.jpg': 'Images',
  '.jpeg': 'Images',
  '.gif': 'Images',
  '.webp': 'Images',
};

export interface FileOrganizeResult {
  success: boolean;
  sourcePath: string;
  destinationPath?: string;
  normalizedFilename?: string;
  category?: string;
  subcategory?: string;
  scanResult?: 'clean' | 'infected' | 'skipped' | 'error';
  error?: string;
}

export interface OrganizeOptions {
  groupName?: string;
  groupId?: string;
  summary?: string;  // AI summary for categorization
  keywords?: string[];  // Explicit keywords for routing
  scanVirus?: boolean;
  dryRun?: boolean;
  customSubdir?: string;  // Override automatic subdirectory
}

/**
 * Normalize a filename for consistent storage
 */
export function normalizeFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  let name = path.basename(filename, ext);

  // Replace problematic characters
  name = name
    .replace(/[<>:"/\\|?*]/g, '_')  // Windows-incompatible chars
    .replace(/[\x00-\x1f\x7f]/g, '')  // Control characters
    .replace(/\s+/g, '_')  // Spaces to underscores
    .replace(/_+/g, '_')  // Multiple underscores to single
    .replace(/^[._]+/, '')  // Remove leading dots/underscores
    .replace(/[._]+$/, '')  // Remove trailing dots/underscores
    .trim();

  // Add date prefix if not already present (YYYY-MM-DD format)
  const datePattern = /^\d{4}-\d{2}-\d{2}/;
  if (!datePattern.test(name)) {
    const today = new Date().toISOString().split('T')[0];
    name = `${today}_${name}`;
  }

  // Limit length
  if (name.length > 200) {
    name = name.substring(0, 200);
  }

  return `${name}${ext}`;
}

/**
 * Determine the target directory based on group name
 */
export function getDirectoryForGroup(groupName: string): string {
  const normalizedGroup = groupName.toLowerCase();

  for (const [pattern, directory] of Object.entries(GROUP_DIRECTORY_MAP)) {
    if (normalizedGroup.includes(pattern)) {
      return directory;
    }
  }

  return 'UNSORTED';
}

/**
 * Determine subdirectory based on keywords in filename/summary
 */
export function getSubdirectoryForKeywords(
  baseDir: string,
  filename: string,
  summary?: string
): string | null {
  const searchText = `${filename} ${summary || ''}`.toLowerCase();

  // Check keyword mappings for this base directory
  const keywordMap = KEYWORD_SUBDIRECTORY_MAP[baseDir];
  if (keywordMap) {
    for (const [keyword, subdir] of Object.entries(keywordMap)) {
      if (searchText.includes(keyword.toLowerCase())) {
        return subdir;
      }
    }
  }

  // Check file type mapping
  const ext = path.extname(filename).toLowerCase();
  if (FILETYPE_SUBDIRECTORY_MAP[ext]) {
    return FILETYPE_SUBDIRECTORY_MAP[ext];
  }

  return null;
}

/**
 * Scan file with ClamAV if available
 */
async function scanWithClamAV(filePath: string): Promise<'clean' | 'infected' | 'error'> {
  try {
    const { stdout, stderr } = await execAsync(`clamscan --no-summary "${filePath}"`);
    if (stdout.includes('OK')) {
      return 'clean';
    } else if (stdout.includes('FOUND')) {
      console.warn(`⚠️ Infected file detected: ${filePath}`);
      console.warn(stdout);
      return 'infected';
    }
    return 'clean';
  } catch (error: any) {
    // Exit code 1 means virus found, other codes are errors
    if (error.code === 1 && error.stdout?.includes('FOUND')) {
      return 'infected';
    }
    // ClamAV not installed or other error
    console.log('ClamAV scan skipped (not available or error)');
    return 'error';
  }
}

/**
 * Ensure directory exists, creating if necessary
 */
async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error: any) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Organize a file into the IrregularChat directory structure
 */
export async function organizeFile(
  sourcePath: string,
  options: OrganizeOptions = {}
): Promise<FileOrganizeResult> {
  try {
    // Verify source exists
    try {
      await fs.access(sourcePath);
    } catch {
      return {
        success: false,
        sourcePath,
        error: `Source file not found: ${sourcePath}`,
      };
    }

    const originalFilename = path.basename(sourcePath);
    const normalizedFilename = normalizeFilename(originalFilename);

    // Determine base directory from group
    const baseDir = options.customSubdir || (
      options.groupName
        ? getDirectoryForGroup(options.groupName)
        : 'UNSORTED'
    );

    // Determine subdirectory from keywords
    const subDir = getSubdirectoryForKeywords(
      baseDir,
      normalizedFilename,
      options.summary
    );

    // Build full path
    const targetDir = subDir
      ? path.join(IRREGULARCHAT_BASE, baseDir, subDir)
      : path.join(IRREGULARCHAT_BASE, baseDir);

    const targetPath = path.join(targetDir, normalizedFilename);

    // Dry run - just return what would happen
    if (options.dryRun) {
      return {
        success: true,
        sourcePath,
        destinationPath: targetPath,
        normalizedFilename,
        category: baseDir,
        subcategory: subDir || undefined,
        scanResult: 'skipped',
      };
    }

    // Virus scan if requested
    let scanResult: 'clean' | 'infected' | 'skipped' | 'error' = 'skipped';
    if (options.scanVirus) {
      scanResult = await scanWithClamAV(sourcePath);
      if (scanResult === 'infected') {
        return {
          success: false,
          sourcePath,
          scanResult,
          error: 'File infected with malware - not archived',
        };
      }
    }

    // Create target directory
    await ensureDirectory(targetDir);

    // Copy file (don't move - keep original in attachments)
    await fs.copyFile(sourcePath, targetPath);
    console.log(`📁 Archived: ${originalFilename} → ${targetPath}`);

    return {
      success: true,
      sourcePath,
      destinationPath: targetPath,
      normalizedFilename,
      category: baseDir,
      subcategory: subDir || undefined,
      scanResult,
    };
  } catch (error) {
    return {
      success: false,
      sourcePath,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Use AI to suggest a category based on content summary
 */
export async function suggestCategoryWithAI(
  openai: any,
  filename: string,
  summary: string
): Promise<{ category: string; subcategory?: string; confidence: number }> {
  const categories = Object.values(GROUP_DIRECTORY_MAP).filter(
    (v, i, a) => a.indexOf(v) === i
  );

  const prompt = `Given a file named "${filename}" with this summary:
"${summary}"

Which category best fits this content?
Available categories: ${categories.join(', ')}

Respond with JSON only: {"category": "CategoryName", "subcategory": "optional/path", "confidence": 0.0-1.0}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a file categorization assistant. Respond only with valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 100,
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content || '{}';
    const result = JSON.parse(content);
    return {
      category: result.category || 'UNSORTED',
      subcategory: result.subcategory,
      confidence: result.confidence || 0.5,
    };
  } catch (error) {
    console.error('AI categorization failed:', error);
    return { category: 'UNSORTED', confidence: 0 };
  }
}

/**
 * List available categories and their paths
 */
export function listCategories(): string[] {
  const categories = new Set(Object.values(GROUP_DIRECTORY_MAP));
  return Array.from(categories).sort();
}

/**
 * Get the base path for IrregularChat
 */
export function getBasePath(): string {
  return IRREGULARCHAT_BASE;
}
