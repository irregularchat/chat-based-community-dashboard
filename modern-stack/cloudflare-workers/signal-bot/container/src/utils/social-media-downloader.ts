/**
 * Social Media Content Downloader
 *
 * Downloads videos and images from social media platforms using yt-dlp.
 * Inspired by the `download_video` function in ~/Git/dotfiles/platforms/macos/config/.zsh_functions
 *
 * Requirements:
 * - yt-dlp must be installed in the container
 * - ffmpeg must be installed for video processing
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { removeTrackers, getSocialMediaPlatform, getContentType } from './social-media-detector.js';

const execAsync = promisify(exec);

export interface DownloadOptions {
  quality?: '1080p' | '720p' | '480p' | '360p' | 'best' | 'worst';
  audioOnly?: boolean;
  outputDir?: string;
  maxFileSizeMB?: number; // Signal has 95 MB cross-platform limit
}

export interface DownloadResult {
  success: boolean;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  contentType?: string;
  cleanUrl: string;
  error?: string;
}

/**
 * Check if yt-dlp is installed
 */
export async function isYtDlpInstalled(): Promise<boolean> {
  try {
    await execAsync('which yt-dlp');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if ffmpeg is installed
 */
export async function isFfmpegInstalled(): Promise<boolean> {
  try {
    await execAsync('which ffmpeg');
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize filename - remove spaces and special characters
 * Matches sanitize_filename() from dotfiles
 */
function sanitizeFilename(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_.-]/g, '');
}

/**
 * Download social media content
 *
 * Inspired by download_video() function from dotfiles:
 * - Uses yt-dlp for downloading
 * - Outputs Signal/iOS/Android-compatible MP4 (H.264 Main + AAC + yuv420p)
 * - Saves to /tmp/ by default (with fallback to ./ or ~/)
 * - Sanitizes filenames
 * - Enforces 95 MB size limit for Signal compatibility
 */
export async function downloadContent(
  url: string,
  options: DownloadOptions = {}
): Promise<DownloadResult> {
  const {
    quality = 'best',
    audioOnly = false,
    outputDir = '/tmp',
    maxFileSizeMB = 95, // Signal's cross-platform limit
  } = options;

  // Remove trackers from URL
  const cleanUrl = removeTrackers(url);
  const platform = getSocialMediaPlatform(cleanUrl);
  const contentType = getContentType(cleanUrl);

  console.log(`📥 Downloading ${contentType} from ${platform?.name || 'unknown platform'}`);
  console.log(`🔗 Clean URL: ${cleanUrl}`);

  // Check if yt-dlp is installed
  if (!(await isYtDlpInstalled())) {
    return {
      success: false,
      cleanUrl,
      error: 'yt-dlp not installed. Install with: apt-get install yt-dlp',
    };
  }

  // Check if ffmpeg is installed (needed for format conversion)
  if (!(await isFfmpegInstalled())) {
    console.warn('⚠️  ffmpeg not installed. Video format conversion may fail.');
  }

  // Ensure output directory exists and is writable
  try {
    await fs.access(outputDir, fs.constants.W_OK);
  } catch {
    return {
      success: false,
      cleanUrl,
      error: `Output directory not writable: ${outputDir}`,
    };
  }

  // Build yt-dlp arguments (matching download_video function logic)
  const ytdlArgs: string[] = [];

  if (audioOnly) {
    // Audio-only download (extract audio as MP3)
    ytdlArgs.push('-x', '--audio-format', 'mp3');
  } else {
    // Video download with quality selection
    // Instagram and some platforms don't have separate video+audio streams
    // So we need to fall back to single-format selection
    switch (quality) {
      case '1080p':
        ytdlArgs.push('-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best');
        break;
      case '720p':
        ytdlArgs.push('-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best');
        break;
      case '480p':
        ytdlArgs.push('-f', 'bestvideo[height<=480]+bestaudio/best[height<=480]/best');
        break;
      case '360p':
        ytdlArgs.push('-f', 'bestvideo[height<=360]+bestaudio/best[height<=360]/best');
        break;
      case 'worst':
        ytdlArgs.push('-f', 'worstvideo+worstaudio/worst');
        break;
      case 'best':
      default:
        ytdlArgs.push('-f', 'bestvideo+bestaudio/best');
        break;
    }

    // Signal-compatible format (H.264 Main + AAC + yuv420p + MP4)
    // Matches the download_video function's Signal optimization
    ytdlArgs.push(
      '--merge-output-format', 'mp4',
      '--postprocessor-args',
      'ffmpeg:-c:v libx264 -profile:v main -level 3.1 -pix_fmt yuv420p -preset medium -crf 23 -c:a aac -b:a 128k -ac 2 -movflags +faststart'
    );
  }

  // Check for Instagram cookies file (for age-restricted content and authentication)
  const cookiesPath = '/app/config/instagram-cookies.txt';
  try {
    await fs.access(cookiesPath, fs.constants.R_OK);
    ytdlArgs.push('--cookies', cookiesPath);
    console.log('🍪 Using Instagram cookies for authentication');
  } catch {
    // Cookies file not found or not readable - continue without authentication
    console.log('ℹ️  No Instagram cookies found (optional)');
  }

  // Output template: auto-generate sanitized filename from title
  const outputTemplate = path.join(outputDir, '%(title)s.%(ext)s');
  ytdlArgs.push('-o', outputTemplate);

  // Prevent .part files to avoid cross-device rename issues on bind mounts
  ytdlArgs.push('--no-part');

  // Quiet output (only errors)
  ytdlArgs.push('--quiet', '--no-warnings');

  // Add URL
  ytdlArgs.push(cleanUrl);

  console.log(`⚙️  Quality: ${quality}, Audio-only: ${audioOnly}`);

  try {
    // Execute yt-dlp download
    // Build command with proper quoting for shell execution
    const quotedArgs = ytdlArgs.map(arg => {
      // Quote arguments that contain spaces or special shell characters
      // < and > are shell redirection operators and must be quoted
      if (arg.includes(' ') || arg.includes('$') || arg.includes('(') || arg.includes(')') ||
          arg.includes('<') || arg.includes('>') || arg.includes('[') || arg.includes(']')) {
        return `'${arg.replace(/'/g, "'\\''")}'`;
      }
      return arg;
    });
    const command = `yt-dlp ${quotedArgs.join(' ')}`;
    console.log(`🔧 Running: yt-dlp [args omitted]`);

    const { stdout, stderr } = await execAsync(command, {
      timeout: 120000, // 2 minute timeout
    });

    if (stderr && stderr.length > 0) {
      console.warn('⚠️  yt-dlp warnings:', stderr);
    }

    // Get the downloaded filename
    const getFilenameCommand = `yt-dlp --get-filename -o "%(title)s.%(ext)s" "${cleanUrl}"`;
    const { stdout: filenameOutput } = await execAsync(getFilenameCommand);
    const rawFilename = filenameOutput.trim();
    const downloadedFile = path.join(outputDir, rawFilename);

    // Check if file exists
    try {
      await fs.access(downloadedFile);
    } catch {
      return {
        success: false,
        cleanUrl,
        error: 'Download completed but file not found',
      };
    }

    // Sanitize filename
    const fileExt = path.extname(downloadedFile);
    const fileBase = path.basename(downloadedFile, fileExt);
    const sanitizedName = sanitizeFilename(fileBase);
    const newFilePath = path.join(outputDir, `${sanitizedName}${fileExt}`);

    if (downloadedFile !== newFilePath) {
      console.log(`📝 Sanitizing filename: ${path.basename(downloadedFile)} -> ${path.basename(newFilePath)}`);
      await fs.rename(downloadedFile, newFilePath);
    }

    // Get file size
    const stats = await fs.stat(newFilePath);
    const fileSizeMB = stats.size / (1024 * 1024);

    console.log(`✅ Download complete: ${path.basename(newFilePath)} (${fileSizeMB.toFixed(2)} MB)`);

    // Check Signal size limit
    if (fileSizeMB > maxFileSizeMB) {
      console.warn(`⚠️  File size (${fileSizeMB.toFixed(2)} MB) exceeds Signal limit (${maxFileSizeMB} MB)`);
      console.warn('   Signal may compress or reject this file.');
    }

    return {
      success: true,
      filePath: newFilePath,
      fileName: path.basename(newFilePath),
      fileSize: stats.size,
      contentType,
      cleanUrl,
    };
  } catch (error: any) {
    console.error('❌ Download failed:', error.message);

    // Parse yt-dlp error messages
    // Concise error messages - no verbose explanations
    let errorMsg = 'Download failed';

    if (error.message.includes('No video could be found')) {
      errorMsg = 'No video found (text/image post?)';
    } else if (error.message.includes('Unsupported URL')) {
      errorMsg = 'Unsupported platform/URL format';
    } else if (error.message.includes('Private video') || error.message.includes('This video is private')) {
      errorMsg = 'Private content';
    } else if (error.message.includes('Video unavailable')) {
      errorMsg = 'Content unavailable';
    } else if (error.message.includes('inappropriate') || error.message.includes('unavailable for certain audiences')) {
      errorMsg = 'Age-restricted content';
    } else if (error.message.includes('timed out')) {
      errorMsg = 'Timed out (file too large?)';
    } else if (error.message.includes('HTTP Error 403') || error.message.includes('Forbidden')) {
      errorMsg = 'Access forbidden';
    } else if (error.message.includes('HTTP Error 404') || error.message.includes('Not Found')) {
      errorMsg = 'Not found (deleted?)';
    } else if (error.message.includes('Login required') || error.message.includes('Sign in')) {
      errorMsg = 'Login required - platform needs authentication';
    } else {
      // Short, concise error messages
      if (platform?.name === 'Instagram') {
        errorMsg = 'Unavailable (private/restricted/rate-limited)';
      } else if (platform?.name === 'TikTok') {
        errorMsg = 'Unavailable (private/restricted/region-blocked)';
      } else {
        errorMsg = 'Unavailable (private or restricted content)';
      }
    }

    return {
      success: false,
      cleanUrl,
      error: errorMsg,
    };
  }
}

/**
 * Get video/post metadata without downloading
 */
export async function getMetadata(url: string): Promise<{
  title?: string;
  description?: string;
  duration?: number;
  thumbnail?: string;
  uploader?: string;
}> {
  const cleanUrl = removeTrackers(url);

  try {
    const command = `yt-dlp --dump-json "${cleanUrl}"`;
    const { stdout } = await execAsync(command, { timeout: 30000 });
    const metadata = JSON.parse(stdout);

    return {
      title: metadata.title,
      description: metadata.description,
      duration: metadata.duration,
      thumbnail: metadata.thumbnail,
      uploader: metadata.uploader,
    };
  } catch (error: any) {
    console.error('Failed to fetch metadata:', error.message);
    return {};
  }
}
