// PDF Handler Plugin for Signal Bot
import BasePlugin from '../base.js';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { PDFExtractor } from './pdf-extractor.js';

const execAsync = promisify(exec);

class PDFPlugin extends BasePlugin {
  constructor() {
    super('pdf');
    this.attachmentsDir = null;
    this.processingPDFs = new Set(); // Track PDFs being processed
    this.pdfExtractor = new PDFExtractor(this.log.bind(this));
  }

  async init() {
    await super.init();
    
    // Set up attachments directory based on Docker volume mapping
    // The signal-cli stores attachments in /home/.local/share/signal-cli/attachments
    // Which maps to ./data/signal-cli/attachments on host
    this.attachmentsDir = path.join(
      process.cwd(), 
      'data', 
      'signal-cli', 
      'attachments'
    );
    
    // Ensure directory exists
    try {
      await fs.access(this.attachmentsDir);
      this.log(`Attachments directory: ${this.attachmentsDir}`);
    } catch {
      this.log(`Creating attachments directory: ${this.attachmentsDir}`);
      await fs.mkdir(this.attachmentsDir, { recursive: true });
    }
    
    // Track recent PDFs by filename for reply processing
    if (!this.data.recentPDFs) {
      this.data.recentPDFs = {};
    }
    
    // Register commands
    this.registerCommand('pdf', this.handlePDFCommand, {
      description: 'Process and summarize PDF files',
      usage: 'pdf (when replying to a PDF or in response to PDF upload)',
      rateLimit: 30
    });
    
    this.registerCommand('pdfsummary', this.handlePDFSummary, {
      description: 'Get AI summary of last PDF',
      usage: 'pdfsummary',
      rateLimit: 30
    });
    
    // Register message interceptor for automatic PDF detection if available
    if (typeof this.registerMessageInterceptor === 'function') {
      this.registerMessageInterceptor(this.detectPDFAttachment.bind(this));
    }
    
    this.log('PDF plugin initialized');
  }
  
  // Intercept messages to detect PDF attachments
  async detectPDFAttachment(message) {
    const { envelope } = message;
    if (!envelope?.dataMessage?.attachments) return null;
    
    const attachments = envelope.dataMessage.attachments;
    const pdfAttachments = attachments.filter(att => 
      att.contentType === 'application/pdf'
    );
    
    if (pdfAttachments.length === 0) return null;
    
    // Process first PDF attachment
    const pdf = pdfAttachments[0];
    const pdfId = pdf.id;
    
    // Store this PDF for potential reply processing
    this.data.recentPDFs[pdf.filename] = {
      ...pdf,
      timestamp: Date.now()
    };
    
    // Clean up old PDFs (older than 1 hour)
    const oneHourAgo = Date.now() - 3600000;
    for (const [filename, pdfData] of Object.entries(this.data.recentPDFs)) {
      if (pdfData.timestamp < oneHourAgo) {
        delete this.data.recentPDFs[filename];
      }
    }
    
    // Save data
    await this.saveData();
    
    // Check if we're already processing this PDF
    if (this.processingPDFs.has(pdfId)) {
      return null; // Already processing
    }
    
    this.processingPDFs.add(pdfId);
    
    try {
      this.log(`Detected PDF: ${pdf.filename} (${pdf.size} bytes)`);
      
      // Auto-process the PDF
      const result = await this.processPDF(pdf);
      
      // Return response for auto-reply
      return {
        message: result,
        groupId: envelope.dataMessage.groupInfo?.groupId,
        recipient: envelope.source || envelope.sourceNumber
      };
    } catch (error) {
      this.error('Failed to process PDF:', error);
      return {
        message: `❌ Failed to process PDF: ${error.message}`,
        groupId: envelope.dataMessage.groupInfo?.groupId,
        recipient: envelope.source || envelope.sourceNumber
      };
    } finally {
      // Remove from processing set after delay
      setTimeout(() => {
        this.processingPDFs.delete(pdfId);
      }, 60000); // 1 minute cooldown
    }
  }
  
  async handlePDFCommand(ctx) {
    const { message } = ctx;
    
    // First check if this is a reply to a message with a PDF
    const quoteAttachments = message.envelope?.dataMessage?.quote?.attachments;
    
    if (quoteAttachments && quoteAttachments.length > 0) {
      // This is a reply to a message, check if it had a PDF
      const quotedPDF = quoteAttachments.find(att => att.contentType === 'application/pdf');
      
      if (quotedPDF) {
        // Try to find the stored PDF by filename
        const storedPDF = this.data.recentPDFs[quotedPDF.filename];
        
        if (storedPDF) {
          try {
            return await this.processPDF(storedPDF);
          } catch (error) {
            this.error('Failed to process quoted PDF:', error);
            return `❌ Failed to process PDF: ${error.message}`;
          }
        } else {
          return '❌ Could not find the referenced PDF. It may have been uploaded too long ago or not yet processed. Please upload the PDF again.';
        }
      }
    }
    
    // Check if message itself has PDF attachment
    const attachments = message.envelope?.dataMessage?.attachments;
    
    if (!attachments || attachments.length === 0) {
      return '❌ No PDF attachment found. Please upload a PDF file or reply to a message with a PDF.';
    }
    
    const pdfAttachments = attachments.filter(att => 
      att.contentType === 'application/pdf'
    );
    
    if (pdfAttachments.length === 0) {
      return '❌ No PDF attachment found. Please upload a PDF file or reply to a message with a PDF.';
    }
    
    try {
      const pdf = pdfAttachments[0];
      return await this.processPDF(pdf);
    } catch (error) {
      this.error('PDF command failed:', error);
      return `❌ Failed to process PDF: ${error.message}`;
    }
  }
  
  async handlePDFSummary(ctx) {
    // Get the last processed PDF summary from data
    const lastPDF = this.data.lastProcessedPDF;
    
    if (!lastPDF) {
      return '❌ No PDF has been processed yet. Upload a PDF to get started.';
    }
    
    return `📄 Last PDF Summary:\n\nFile: ${lastPDF.filename}\nSize: ${this.formatBytes(lastPDF.size)}\nPages: ${lastPDF.pageCount || 'Unknown'}\n\nSummary:\n${lastPDF.summary}`;
  }
  
  async processPDF(pdfAttachment) {
    const { id, filename, size } = pdfAttachment;
    
    // Construct path to the downloaded attachment
    const pdfPath = path.join(this.attachmentsDir, id);
    
    try {
      // Check if file exists
      await fs.access(pdfPath);
      this.log(`Found PDF file: ${pdfPath}`);
      
      // Use smart extraction
      let extractedContent;
      let summary = '';
      
      try {
        // Extract content using smart strategy
        extractedContent = await this.pdfExtractor.extractSmartContent(pdfPath);
        const pageCount = extractedContent.metadata.pageCount || 0;
        
        // Prepare text for AI summarization
        const summaryText = this.pdfExtractor.prepareSummaryText(extractedContent);
        
        // Use AI to summarize if we have the AI plugin
        const aiPlugin = this.getPlugin('ai');
        if (aiPlugin && aiPlugin.handleAIQuery) {
          // Adjust prompt based on extraction strategy
          let prompt = '';
          
          if (extractedContent.strategy === 'full') {
            prompt = `Please provide a comprehensive summary of this PDF document (${pageCount} pages). Include:
1. Main topic/purpose
2. Key points (3-5 bullet points)
3. Important findings or conclusions
4. Any actionable items or recommendations

${summaryText}`;
          } else if (extractedContent.strategy === 'strategic') {
            prompt = `Please provide a comprehensive summary of this ${pageCount}-page PDF based on the strategic extraction below. Include:
1. Main topic/purpose (from title/abstract if available)
2. Document structure (from TOC if available)
3. Key points (3-5 bullet points from the content samples)
4. Conclusions or recommendations (from conclusion section if available)

${summaryText}`;
          } else {
            // selective strategy for large PDFs
            prompt = `Please provide a comprehensive summary of this large PDF (${pageCount} pages) based on selective extraction. Focus on:
1. Document purpose (from title/abstract)
2. Overall structure (from TOC and samples)
3. Main findings (from content samples and conclusion)
4. Key takeaways

Note: This is a large document, so summary is based on strategic sampling of key sections.

${summaryText}`;
          }
          
          try {
            summary = await aiPlugin.handleAIQuery(prompt, 'summarization');
          } catch (error) {
            this.error('AI summarization failed:', error);
            summary = this.getFallbackSummary(extractedContent);
          }
        } else {
          // No AI plugin, provide structured summary from extraction
          summary = this.getFallbackSummary(extractedContent);
        }
      } catch (error) {
        // Extraction failed, try basic method
        this.log('Smart extraction failed, falling back to basic method:', error.message);
        
        try {
          // Try basic full text extraction
          const { stdout: text } = await execAsync(`pdftotext "${pdfPath}" -`, {
            maxBuffer: 10 * 1024 * 1024 // 10MB buffer
          });
          
          if (text && text.length > 50) {
            // Use first portion for basic summary
            const aiPlugin = this.getPlugin('ai');
            if (aiPlugin && aiPlugin.handleAIQuery) {
              const prompt = `Provide a brief summary of this PDF content:\n\n${text.substring(0, 8000)}`;
              summary = await aiPlugin.handleAIQuery(prompt, 'summarization');
            } else {
              const words = text.split(/\s+/);
              summary = `Preview (first 100 words):\n${words.slice(0, 100).join(' ')}...`;
            }
          } else {
            summary = 'Could not extract meaningful text from PDF.';
          }
        } catch (fallbackError) {
          this.error('Fallback extraction also failed:', fallbackError.message);
          summary = 'Unable to extract text from PDF. The file may be image-based, encrypted, or corrupted.';
        }
      }
      
      // Get page count for response
      const pageCount = extractedContent?.metadata?.pageCount || 0;
      
      // Store in data for later retrieval
      this.data.lastProcessedPDF = {
        id,
        filename,
        size,
        pageCount,
        summary,
        timestamp: new Date().toISOString()
      };
      await this.saveData();
      
      // Format response
      const response = [
        `📄 PDF Processed: ${filename}`,
        `📊 Size: ${this.formatBytes(size)}`,
        pageCount ? `📑 Pages: ${pageCount}` : '',
        '',
        '📝 Summary:',
        summary,
        '',
        '💡 Use !pdfsummary to view this summary again'
      ].filter(line => line !== '').join('\n');
      
      return response;
      
    } catch (error) {
      this.error(`Failed to process PDF ${filename}:`, error);
      
      // Check if file exists in attachments directory
      try {
        const files = await fs.readdir(this.attachmentsDir);
        this.log(`Files in attachments directory: ${files.join(', ')}`);
        
        if (!files.includes(id)) {
          return `❌ PDF file not found. The attachment may still be downloading. Please try again in a moment.\n\nLooking for: ${id}\nFilename: ${filename}`;
        }
      } catch (dirError) {
        this.error('Could not read attachments directory:', dirError);
      }
      
      throw error;
    }
  }
  
  getFallbackSummary(extractedContent) {
    const parts = [];
    const { sections, metadata } = extractedContent;
    
    if (metadata.title) {
      parts.push(`Title: ${metadata.title}`);
    }
    
    if (sections.abstract) {
      parts.push('\nAbstract found - document appears to be an academic or research paper.');
    }
    
    if (sections.tableOfContents) {
      const tocLines = sections.tableOfContents.split('\n').slice(0, 10);
      parts.push('\nTable of Contents (first items):');
      parts.push(tocLines.join('\n'));
    }
    
    if (sections.conclusion) {
      parts.push('\nConclusion section found - document has formal structure.');
    }
    
    if (sections.fullText) {
      const words = sections.fullText.split(/\s+/).slice(0, 150);
      parts.push('\nFirst 150 words:');
      parts.push(words.join(' ') + '...');
    } else if (sections.firstPages) {
      const words = sections.firstPages.split(/\s+/).slice(0, 100);
      parts.push('\nBeginning excerpt:');
      parts.push(words.join(' ') + '...');
    }
    
    parts.push('\n(AI summarization not available - showing extracted structure)');
    
    return parts.join('\n');
  }
  
  formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' bytes';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
  
  // Override handleMessage to auto-process PDF attachments
  async handleMessage(message) {
    const { text, message: dataMessage, envelope } = message;
    
    // If there's text, let the base class handle commands normally
    if (text) {
      return super.handleMessage(message);
    }
    
    // Check for PDF attachments when no text is present
    const attachments = dataMessage?.attachments || envelope?.dataMessage?.attachments;
    if (attachments && attachments.length > 0) {
      const pdfAttachments = attachments.filter(att => 
        att.contentType === 'application/pdf'
      );
      
      if (pdfAttachments.length > 0) {
        this.log('Auto-processing PDF attachment without command');
        
        // Process the first PDF
        const pdf = pdfAttachments[0];
        
        // Store for later reference
        if (pdf.filename) {
          this.data.recentPDFs[pdf.filename] = {
            ...pdf,
            timestamp: Date.now()
          };
          await this.saveData();
        }
        
        try {
          const result = await this.processPDF(pdf);
          return result;
        } catch (error) {
          this.error('Failed to auto-process PDF:', error);
          return `❌ Failed to process PDF: ${error.message}`;
        }
      }
    }
    
    // No PDF found, let base class handle
    return super.handleMessage(message);
  }
  
  async destroy() {
    this.processingPDFs.clear();
    await super.destroy();
  }
}

export default PDFPlugin;