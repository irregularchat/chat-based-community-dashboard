const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const pdf = require('pdf-parse');

class PDFProcessor {
  constructor() {
    this.ocrmypdfPath = '/opt/homebrew/bin/ocrmypdf';
  }

  /**
   * Process a PDF file with OCR fallback
   * @param {string} pdfPath - Path to the PDF file
   * @returns {Promise<{text: string, pages: number, info: object}>}
   */
  async processPDF(pdfPath) {
    console.log('📄 Processing PDF:', pdfPath);
    
    try {
      // First try regular PDF text extraction
      const result = await this.extractText(pdfPath);
      
      // Check if we got meaningful text
      if (result.text && result.text.trim().length > 100) {
        console.log('✅ Extracted text directly from PDF');
        return result;
      }
      
      // If little/no text, it might be a scanned PDF - try OCR
      console.log('⚠️ PDF has little/no text, attempting OCR...');
      const ocrPath = await this.performOCR(pdfPath);
      
      if (ocrPath) {
        const ocrResult = await this.extractText(ocrPath);
        // Clean up temp file
        if (ocrPath !== pdfPath) {
          fs.unlinkSync(ocrPath);
        }
        console.log('✅ Extracted text using OCR');
        return ocrResult;
      }
      
      // Return whatever we got
      return result;
      
    } catch (error) {
      console.error('PDF processing error:', error);
      throw error;
    }
  }

  /**
   * Extract text from PDF using pdf-parse
   */
  async extractText(pdfPath) {
    const dataBuffer = fs.readFileSync(pdfPath);
    const data = await pdf(dataBuffer);
    
    return {
      text: data.text || '',
      pages: data.numpages || 0,
      info: data.info || {}
    };
  }

  /**
   * Perform OCR on a PDF using ocrmypdf
   */
  async performOCR(inputPath) {
    return new Promise((resolve, reject) => {
      const outputPath = inputPath.replace('.pdf', '_ocr.pdf');
      
      const ocr = spawn(this.ocrmypdfPath, [
        '--force-ocr',  // Force OCR even if text exists
        '--optimize', '1',  // Optimize for size
        '--skip-text',  // Skip pages that already have text
        '--language', 'eng',  // English language
        inputPath,
        outputPath
      ]);
      
      let stderr = '';
      
      ocr.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ocr.on('close', (code) => {
        if (code === 0) {
          resolve(outputPath);
        } else {
          console.error('OCR failed:', stderr);
          resolve(null);
        }
      });
      
      ocr.on('error', (err) => {
        console.error('OCR process error:', err);
        resolve(null);
      });
    });
  }

  /**
   * Extract key sections from PDF text for efficient summarization
   */
  extractKeyContent(fullText, maxLength = 4000) {
    const lines = fullText.split('\n');
    const sections = {
      title: '',
      abstract: '',
      executive_summary: '',
      introduction: '',
      toc: '',
      chapters: [],
      conclusion: '',
      keyPoints: []
    };
    
    let currentSection = '';
    let captureLines = 0;
    
    // Enhanced patterns for section detection
    const patterns = {
      title: /^[A-Z][A-Z\s\-:]{10,100}$/,
      abstract: /^(abstract|summary|executive\s+summary|overview)\s*$/i,
      toc: /^(table\s+of\s+contents?|contents?|toc)\s*$/i,
      introduction: /^(introduction|1\.\s*introduction|chapter\s+1|background|preface)\s*$/i,
      chapter: /^(chapter\s+\d+|\d+\.\s+[A-Z]|section\s+\d+)/i,
      conclusion: /^(conclusion|summary|final\s+thoughts?|closing|recommendations?)\s*$/i,
      appendix: /^(appendix|appendices|references?|bibliography|citations?|glossary)\s*$/i,
      keyPoint: /^[\s]*[•·▪▫◦‣⁃]\s+|^[\s]*\d+\.\s+|^[\s]*[a-z]\)\s+/i
    };
    
    // First pass: identify document structure
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // Capture title (usually in first 20 lines)
      if (i < 20 && !sections.title && line.length > 10 && line.length < 150) {
        if (patterns.title.test(line) || (line === line.toUpperCase() && !line.match(/^\d+$/))) {
          sections.title = line;
        }
      }
      
      // Stop at appendix
      if (patterns.appendix.test(line)) {
        console.log('📚 Reached appendix, stopping main content extraction');
        break;
      }
      
      // Detect sections
      for (const [sectionName, pattern] of Object.entries(patterns)) {
        if (sectionName === 'title' || sectionName === 'appendix' || sectionName === 'keyPoint') continue;
        
        if (pattern.test(line)) {
          currentSection = sectionName;
          captureLines = sectionName === 'toc' ? 50 : 30;
          
          if (sectionName === 'chapter') {
            sections.chapters.push({ title: line, content: [] });
          }
          break;
        }
      }
      
      // Capture content for current section
      if (captureLines > 0 && currentSection) {
        captureLines--;
        
        switch(currentSection) {
          case 'abstract':
          case 'executive_summary':
            sections[currentSection] += line + '\n';
            break;
          case 'introduction':
            sections.introduction += line + '\n';
            break;
          case 'toc':
            if (line.match(/\.{3,}|\d+$/) || line.match(/^\d+\./)) {
              sections.toc += line + '\n';
            }
            break;
          case 'chapter':
            if (sections.chapters.length > 0) {
              sections.chapters[sections.chapters.length - 1].content.push(line);
            }
            break;
          case 'conclusion':
            sections.conclusion += line + '\n';
            break;
        }
      }
      
      // Capture key points (bullet points, numbered lists)
      if (patterns.keyPoint.test(line)) {
        sections.keyPoints.push(line);
      }
    }
    
    // Build optimized content for AI processing
    let optimizedContent = '';
    
    // Add title
    if (sections.title) {
      optimizedContent += `TITLE: ${sections.title}\n\n`;
    }
    
    // Add abstract or executive summary (prefer exec summary)
    if (sections.executive_summary) {
      optimizedContent += `EXECUTIVE SUMMARY:\n${sections.executive_summary.substring(0, 600)}\n\n`;
    } else if (sections.abstract) {
      optimizedContent += `ABSTRACT:\n${sections.abstract.substring(0, 500)}\n\n`;
    }
    
    // Add table of contents for structure understanding
    if (sections.toc) {
      optimizedContent += `TABLE OF CONTENTS:\n${sections.toc.substring(0, 400)}\n\n`;
    }
    
    // Add introduction
    if (sections.introduction) {
      optimizedContent += `INTRODUCTION:\n${sections.introduction.substring(0, 600)}\n\n`;
    }
    
    // Add chapter summaries
    if (sections.chapters.length > 0) {
      optimizedContent += 'KEY CHAPTERS:\n';
      sections.chapters.slice(0, 5).forEach(ch => {
        optimizedContent += `${ch.title}\n`;
        const chapterContent = ch.content.slice(0, 10).join(' ');
        if (chapterContent) {
          optimizedContent += `${chapterContent.substring(0, 200)}...\n`;
        }
      });
      optimizedContent += '\n';
    }
    
    // Add key points
    if (sections.keyPoints.length > 0) {
      optimizedContent += 'KEY POINTS:\n';
      sections.keyPoints.slice(0, 15).forEach(point => {
        optimizedContent += `${point}\n`;
      });
      optimizedContent += '\n';
    }
    
    // Add conclusion
    if (sections.conclusion) {
      optimizedContent += `CONCLUSION:\n${sections.conclusion.substring(0, 500)}\n`;
    }
    
    // If we didn't extract enough structured content, fall back to sampling
    if (optimizedContent.length < 500) {
      console.log('📄 Insufficient structured content, using sampling approach');
      
      // Take beginning, middle, and end samples
      const totalLines = lines.length;
      const sampleSize = Math.min(30, Math.floor(totalLines / 10));
      
      optimizedContent = 'DOCUMENT SAMPLE:\n\n';
      
      // Beginning
      optimizedContent += 'Beginning:\n';
      optimizedContent += lines.slice(0, sampleSize).join('\n').substring(0, 1000) + '\n\n';
      
      // Middle
      const middleStart = Math.floor(totalLines / 2) - Math.floor(sampleSize / 2);
      optimizedContent += 'Middle:\n';
      optimizedContent += lines.slice(middleStart, middleStart + sampleSize).join('\n').substring(0, 1000) + '\n\n';
      
      // End (avoiding references)
      let endStart = totalLines - sampleSize;
      // Try to avoid references section
      for (let i = endStart; i < totalLines; i++) {
        if (patterns.appendix.test(lines[i])) {
          endStart = Math.max(0, i - sampleSize);
          break;
        }
      }
      optimizedContent += 'End:\n';
      optimizedContent += lines.slice(endStart, endStart + sampleSize).join('\n').substring(0, 1000);
    }
    
    // Ensure we don't exceed max length
    if (optimizedContent.length > maxLength) {
      optimizedContent = optimizedContent.substring(0, maxLength) + '\n\n[Content truncated]';
    }
    
    const compressionRatio = Math.round((optimizedContent.length / fullText.length) * 100);
    console.log(`📊 Compressed ${fullText.length} chars to ${optimizedContent.length} chars (${compressionRatio}% of original)`);
    
    return optimizedContent;
  }
}

module.exports = PDFProcessor;