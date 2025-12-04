/**
 * PDF Content Scraper
 *
 * Fetches and extracts text content from PDF URLs or local files for summarization.
 * Handles large PDFs smartly by extracting TOC, chapter structure, and key sections.
 */

import axios from 'axios';
import pdf from 'pdf-parse';
import fs from 'fs/promises';

export interface PDFScrapedContent {
  success: boolean;
  title?: string;
  content?: string;
  pageCount?: number;
  isLargePdf?: boolean;
  extractionMethod?: 'full' | 'smart';
  url: string;
  error?: string;
}

// Thresholds for smart extraction
const MAX_PAGES_FOR_FULL_EXTRACTION = 20;
const MAX_CHARS_FOR_LLM = 15000; // ~3-4k tokens

/**
 * Check if a URL points to a PDF
 */
export function isPdfUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();

    // Check file extension
    if (pathname.endsWith('.pdf')) {
      return true;
    }

    // Some URLs have PDF in query params
    if (urlObj.searchParams.get('format') === 'pdf') {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Extract table of contents / chapter structure from PDF text
 */
function extractTOCAndStructure(text: string): {
  toc: string[];
  chapters: { title: string; startIndex: number }[];
} {
  const lines = text.split('\n');
  const toc: string[] = [];
  const chapters: { title: string; startIndex: number }[] = [];

  // Common TOC/chapter patterns
  const tocPatterns = [
    /^(table of contents|contents|toc)$/i,
    /^(chapter|section|part)\s+\d+/i,
    /^\d+\.\s+[A-Z]/,  // "1. Introduction"
    /^[IVXLC]+\.\s+/i, // Roman numerals "I. Introduction"
    /^(introduction|conclusion|summary|executive summary|abstract|appendix)/i,
  ];

  const chapterPatterns = [
    /^(chapter|section)\s+(\d+|[IVXLC]+)[:\s]/i,
    /^(\d+)\.\s+([A-Z][^.]+)$/,
    /^(introduction|conclusion|summary|executive summary|abstract|recommendations|methodology|background|overview|findings|analysis)/i,
  ];

  let inTOC = false;
  let tocEndIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) continue;

    // Detect TOC section
    if (/^(table of contents|contents)$/i.test(line)) {
      inTOC = true;
      continue;
    }

    // Collect TOC entries
    if (inTOC) {
      // TOC usually ends when we hit a chapter/section or many empty lines
      if (chapterPatterns.some(p => p.test(line)) && toc.length > 3) {
        inTOC = false;
        tocEndIndex = i;
      } else if (line.length > 5 && line.length < 100) {
        toc.push(line);
      }
    }

    // Detect chapter/section headers
    for (const pattern of chapterPatterns) {
      if (pattern.test(line)) {
        chapters.push({
          title: line.substring(0, 100),
          startIndex: text.indexOf(line),
        });
        break;
      }
    }
  }

  return { toc, chapters };
}

/**
 * Smart extraction for large PDFs
 * Extracts: TOC, first pages, chapter beginnings, conclusion
 */
function smartExtract(text: string, pageCount: number): string {
  const { toc, chapters } = extractTOCAndStructure(text);

  const sections: string[] = [];

  // 1. Add document overview
  sections.push(`[PDF Document - ${pageCount} pages]`);

  // 2. Add TOC if found
  if (toc.length > 0) {
    sections.push('\n--- TABLE OF CONTENTS ---');
    sections.push(toc.slice(0, 30).join('\n')); // Limit TOC entries
  }

  // 3. Extract first portion (usually intro/executive summary)
  const firstPortion = text.substring(0, 3000);
  sections.push('\n--- BEGINNING OF DOCUMENT ---');
  sections.push(firstPortion);

  // 4. Extract chapter/section beginnings
  if (chapters.length > 0) {
    sections.push('\n--- KEY SECTIONS ---');

    for (const chapter of chapters.slice(0, 10)) { // Limit to 10 chapters
      const startIdx = chapter.startIndex;
      if (startIdx > 0) {
        // Extract ~500 chars from each chapter start
        const chapterText = text.substring(startIdx, startIdx + 500);
        sections.push(`\n[${chapter.title}]`);
        sections.push(chapterText.trim());
      }
    }
  }

  // 5. Look for conclusion/summary/recommendations at the end
  const lastPortion = text.substring(Math.max(0, text.length - 3000));
  const conclusionMatch = lastPortion.match(/(conclusion|summary|recommendations|key findings|final thoughts)[:\s]/i);

  if (conclusionMatch) {
    const conclusionStart = lastPortion.indexOf(conclusionMatch[0]);
    sections.push('\n--- CONCLUSION/SUMMARY ---');
    sections.push(lastPortion.substring(conclusionStart).trim());
  } else {
    sections.push('\n--- END OF DOCUMENT ---');
    sections.push(lastPortion.substring(lastPortion.length - 1500).trim());
  }

  // Combine and truncate if needed
  let result = sections.join('\n');

  if (result.length > MAX_CHARS_FOR_LLM) {
    result = result.substring(0, MAX_CHARS_FOR_LLM) + '\n...[content truncated for length]';
  }

  return result;
}

/**
 * Scrape content from a PDF URL
 */
export async function scrapePdf(url: string): Promise<PDFScrapedContent> {
  try {
    console.log(`📄 Fetching PDF: ${url}`);

    // Fetch PDF as buffer
    const response = await axios.get(url, {
      timeout: 30000, // 30 second timeout for PDFs (they can be large)
      responseType: 'arraybuffer',
      maxContentLength: 50 * 1024 * 1024, // 50MB max
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SignalBot/3.0; +https://signal.org)',
        'Accept': 'application/pdf,*/*',
      },
      validateStatus: (status) => status >= 200 && status < 400,
    });

    // Check content type
    const contentType = response.headers['content-type'] || '';
    if (!contentType.includes('pdf') && !url.toLowerCase().endsWith('.pdf')) {
      return {
        success: false,
        url,
        error: 'URL does not appear to be a PDF',
      };
    }

    // Parse PDF
    const buffer = Buffer.from(response.data);
    const data = await pdf(buffer);

    const pageCount = data.numpages || 0;
    const text = data.text || '';

    console.log(`📄 PDF parsed: ${pageCount} pages, ${text.length} chars`);

    if (!text || text.trim().length < 50) {
      return {
        success: false,
        url,
        pageCount,
        error: 'PDF appears to be empty or image-only (no extractable text)',
      };
    }

    // Determine extraction method based on size
    const isLargePdf = pageCount > MAX_PAGES_FOR_FULL_EXTRACTION;
    let content: string;
    let extractionMethod: 'full' | 'smart';

    if (isLargePdf) {
      console.log(`📄 Large PDF detected (${pageCount} pages), using smart extraction`);
      content = smartExtract(text, pageCount);
      extractionMethod = 'smart';
    } else {
      // Full extraction for small PDFs
      content = text;
      if (content.length > MAX_CHARS_FOR_LLM) {
        content = content.substring(0, MAX_CHARS_FOR_LLM) + '\n...[content truncated for length]';
      }
      extractionMethod = 'full';
    }

    // Clean up whitespace
    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    // Try to extract title from PDF metadata or first lines
    let title = data.info?.Title || '';
    if (!title) {
      // Try to get title from first line
      const firstLine = text.split('\n').find(line => line.trim().length > 10);
      if (firstLine && firstLine.length < 200) {
        title = firstLine.trim();
      }
    }

    console.log(`✅ PDF processed: ${content.length} chars (${extractionMethod} extraction)`);

    return {
      success: true,
      title,
      content,
      pageCount,
      isLargePdf,
      extractionMethod,
      url,
    };
  } catch (error: any) {
    console.error(`❌ Failed to scrape PDF: ${url}`, error.message);

    let errorMsg = 'Failed to fetch PDF';
    if (error.code === 'ENOTFOUND') {
      errorMsg = 'Domain not found or unreachable';
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      errorMsg = 'Request timed out (PDF may be too large)';
    } else if (error.response) {
      errorMsg = `HTTP ${error.response.status}: ${error.response.statusText}`;
    } else if (error.message?.includes('Invalid PDF')) {
      errorMsg = 'Invalid or corrupted PDF file';
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
 * Scrape content from a local PDF file path
 * Used for Signal attachments stored in /app/signal-data/attachments/
 */
export async function scrapePdfFromPath(filePath: string, originalFilename?: string): Promise<PDFScrapedContent> {
  try {
    console.log(`📄 Reading local PDF: ${filePath}`);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return {
        success: false,
        url: filePath,
        error: `PDF file not found: ${filePath}`,
      };
    }

    // Read PDF file
    const buffer = await fs.readFile(filePath);

    // Sanity check - file should not be empty
    if (buffer.length === 0) {
      return {
        success: false,
        url: filePath,
        error: 'PDF file is empty',
      };
    }

    // Parse PDF
    const data = await pdf(buffer);

    const pageCount = data.numpages || 0;
    const text = data.text || '';

    console.log(`📄 PDF parsed: ${pageCount} pages, ${text.length} chars`);

    if (!text || text.trim().length < 50) {
      return {
        success: false,
        url: filePath,
        pageCount,
        error: 'PDF appears to be empty or image-only (no extractable text)',
      };
    }

    // Determine extraction method based on size
    const isLargePdf = pageCount > MAX_PAGES_FOR_FULL_EXTRACTION;
    let content: string;
    let extractionMethod: 'full' | 'smart';

    if (isLargePdf) {
      console.log(`📄 Large PDF detected (${pageCount} pages), using smart extraction`);
      content = smartExtract(text, pageCount);
      extractionMethod = 'smart';
    } else {
      // Full extraction for small PDFs
      content = text;
      if (content.length > MAX_CHARS_FOR_LLM) {
        content = content.substring(0, MAX_CHARS_FOR_LLM) + '\n...[content truncated for length]';
      }
      extractionMethod = 'full';
    }

    // Clean up whitespace
    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    // Try to extract title from PDF metadata or first lines
    let title = data.info?.Title || '';
    if (!title && originalFilename) {
      // Use original filename without extension as title
      title = originalFilename.replace(/\.pdf$/i, '');
    }
    if (!title) {
      // Try to get title from first line
      const firstLine = text.split('\n').find(line => line.trim().length > 10);
      if (firstLine && firstLine.length < 200) {
        title = firstLine.trim();
      }
    }

    console.log(`✅ PDF processed: ${content.length} chars (${extractionMethod} extraction)`);

    return {
      success: true,
      title,
      content,
      pageCount,
      isLargePdf,
      extractionMethod,
      url: filePath,
    };
  } catch (error: any) {
    console.error(`❌ Failed to read PDF: ${filePath}`, error.message);

    let errorMsg = 'Failed to read PDF file';
    if (error.message?.includes('Invalid PDF')) {
      errorMsg = 'Invalid or corrupted PDF file';
    } else if (error.code === 'ENOENT') {
      errorMsg = 'PDF file not found';
    } else if (error.code === 'EACCES') {
      errorMsg = 'Permission denied to read PDF file';
    } else if (error.message) {
      errorMsg = error.message;
    }

    return {
      success: false,
      url: filePath,
      error: errorMsg,
    };
  }
}
