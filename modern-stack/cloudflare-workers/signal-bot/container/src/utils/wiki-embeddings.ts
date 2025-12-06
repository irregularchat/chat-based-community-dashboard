/**
 * Wiki Embeddings Service
 *
 * Generates and stores vector embeddings for wiki articles.
 * Uses OpenAI text-embedding-3-small for cost-effective semantic search.
 * Implements hybrid search combining keyword (git grep) + vector similarity.
 */

import OpenAI from 'openai';
import { createHash } from 'crypto';
import { PostgresClient } from '../db/postgres-client.js';
import { getWikiIndex, fetchArticleContent, WikiArticle } from './wiki-search.js';

// Embedding model configuration
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMENSIONS = 1536;  // Default for text-embedding-3-small
const MAX_TOKENS_PER_CHUNK = 8000;  // Safe limit for embedding API
const CHUNK_OVERLAP_CHARS = 200;    // Overlap between chunks

interface WikiEmbedding {
  id: number;
  file_path: string;
  title: string;
  url: string;
  content_hash: string;
  embedding: number[];
  chunk_index: number;
  chunk_text: string;
  metadata: Record<string, any>;
}

interface SemanticSearchResult {
  article: WikiArticle;
  similarity: number;
  chunkText?: string;
  chunkIndex?: number;
}

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Generate MD5 hash of content for change detection
 */
function hashContent(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

/**
 * Split markdown content into semantic chunks at headers
 * Preserves header context for each chunk
 */
export function chunkMarkdownByHeaders(content: string, maxChars: number = 4000): string[] {
  const chunks: string[] = [];

  // Split by ## headers (H2) which typically represent sections
  const sections = content.split(/(?=^## )/m);

  let currentChunk = '';
  let currentHeader = '';

  for (const section of sections) {
    // Extract header if present
    const headerMatch = section.match(/^(## .+?)$/m);
    if (headerMatch) {
      currentHeader = headerMatch[1];
    }

    // If adding this section exceeds max, save current and start new
    if (currentChunk.length + section.length > maxChars && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      // Start new chunk with context (previous header)
      currentChunk = currentHeader ? `${currentHeader}\n\n` : '';
    }

    currentChunk += section;

    // If single section exceeds max, split further
    if (currentChunk.length > maxChars) {
      // Split at paragraphs
      const paragraphs = currentChunk.split(/\n\n+/);
      currentChunk = '';

      for (const para of paragraphs) {
        if (currentChunk.length + para.length > maxChars && currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = currentHeader ? `${currentHeader}\n\n` : '';
        }
        currentChunk += para + '\n\n';
      }
    }
  }

  // Add final chunk
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  // If no chunks created, return whole content
  if (chunks.length === 0 && content.trim().length > 0) {
    chunks.push(content.trim());
  }

  return chunks;
}

/**
 * Wiki Embeddings Manager
 */
export class WikiEmbeddingsManager {
  private openai: OpenAI | null = null;
  private dbClient: PostgresClient;
  private embeddingsCache: Map<string, WikiEmbedding[]> = new Map();
  private cacheLoaded: boolean = false;

  constructor(dbClient: PostgresClient, openaiApiKey?: string) {
    this.dbClient = dbClient;

    if (openaiApiKey) {
      this.openai = new OpenAI({ apiKey: openaiApiKey });
      console.log('📚 WikiEmbeddings: OpenAI initialized for semantic search');
    } else {
      console.log('📚 WikiEmbeddings: No OpenAI key, semantic search disabled');
    }
  }

  /**
   * Check if embeddings are available
   */
  isEnabled(): boolean {
    return this.openai !== null;
  }

  /**
   * Generate embedding for text using OpenAI
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    if (!this.openai) return null;

    try {
      const response = await this.openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: text.substring(0, MAX_TOKENS_PER_CHUNK * 4), // Rough char limit
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error('❌ WikiEmbeddings: Failed to generate embedding:', error);
      return null;
    }
  }

  /**
   * Load all embeddings from database into memory cache
   */
  async loadEmbeddingsCache(): Promise<void> {
    if (this.cacheLoaded) return;

    try {
      const result = await this.dbClient.query(`
        SELECT id, file_path, title, url, content_hash, embedding, chunk_index, chunk_text, metadata
        FROM wiki_embeddings
        ORDER BY file_path, chunk_index
      `);

      this.embeddingsCache.clear();

      for (const row of result.results) {
        const filePath = row.file_path;
        if (!this.embeddingsCache.has(filePath)) {
          this.embeddingsCache.set(filePath, []);
        }

        this.embeddingsCache.get(filePath)!.push({
          id: row.id,
          file_path: row.file_path,
          title: row.title,
          url: row.url,
          content_hash: row.content_hash,
          embedding: row.embedding,
          chunk_index: row.chunk_index,
          chunk_text: row.chunk_text,
          metadata: row.metadata || {},
        });
      }

      this.cacheLoaded = true;
      console.log(`📚 WikiEmbeddings: Loaded ${result.results.length} embeddings for ${this.embeddingsCache.size} articles`);
    } catch (error) {
      console.error('❌ WikiEmbeddings: Failed to load cache:', error);
    }
  }

  /**
   * Index a single wiki article (generate and store embeddings)
   */
  async indexArticle(article: WikiArticle, content: string): Promise<boolean> {
    if (!this.openai || !article.filePath) return false;

    const contentHash = hashContent(content);

    // Check if already indexed with same content
    const existing = await this.dbClient.query(
      'SELECT content_hash FROM wiki_embeddings WHERE file_path = $1 LIMIT 1',
      [article.filePath]
    );

    if (existing.results.length > 0 && existing.results[0].content_hash === contentHash) {
      return true; // Already up to date
    }

    // Clean content for embedding
    const cleanContent = content
      .replace(/^---[\s\S]*?---\n*/m, '')  // Remove frontmatter
      .replace(/```[\s\S]*?```/g, '\n')     // Remove code blocks
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '') // Remove images
      .trim();

    if (cleanContent.length < 50) {
      console.log(`📚 Skipping ${article.filePath}: content too short`);
      return false;
    }

    // Chunk by headers for semantic coherence
    const chunks = chunkMarkdownByHeaders(cleanContent, 3000);

    // Delete old embeddings
    await this.dbClient.query(
      'DELETE FROM wiki_embeddings WHERE file_path = $1',
      [article.filePath]
    );

    // Generate and store embeddings for each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await this.generateEmbedding(chunk);

      if (!embedding) continue;

      await this.dbClient.query(`
        INSERT INTO wiki_embeddings (file_path, title, url, content_hash, embedding, chunk_index, chunk_text, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        article.filePath,
        article.title,
        article.url,
        contentHash,
        JSON.stringify(embedding),
        i,
        chunk.substring(0, 1000), // Store first 1000 chars of chunk
        JSON.stringify({ tags: article.tags, category: article.category }),
      ]);
    }

    console.log(`📚 Indexed ${article.filePath}: ${chunks.length} chunks`);
    return true;
  }

  /**
   * Index all wiki articles (full reindex)
   */
  async indexAllArticles(): Promise<{ indexed: number; errors: number }> {
    if (!this.openai) {
      return { indexed: 0, errors: 0 };
    }

    console.log('📚 WikiEmbeddings: Starting full index...');

    const articles = await getWikiIndex();
    let indexed = 0;
    let errors = 0;

    for (const article of articles) {
      try {
        const content = await fetchArticleContent(article.url);
        if (content?.content) {
          const success = await this.indexArticle(article, content.content);
          if (success) indexed++;
        }
      } catch (error) {
        console.error(`❌ Failed to index ${article.filePath}:`, error);
        errors++;
      }

      // Rate limit: 1 article per 500ms to avoid hitting OpenAI limits
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Update status
    await this.dbClient.query(`
      UPDATE wiki_embedding_status
      SET last_full_index = NOW(), articles_indexed = $1, last_error = NULL
    `, [indexed]);

    // Reload cache
    this.cacheLoaded = false;
    await this.loadEmbeddingsCache();

    console.log(`📚 WikiEmbeddings: Indexed ${indexed} articles, ${errors} errors`);
    return { indexed, errors };
  }

  /**
   * Semantic search using vector similarity
   */
  async semanticSearch(query: string, limit: number = 5): Promise<SemanticSearchResult[]> {
    if (!this.openai) return [];

    // Ensure cache is loaded
    await this.loadEmbeddingsCache();

    if (this.embeddingsCache.size === 0) {
      console.log('📚 WikiEmbeddings: No embeddings in cache');
      return [];
    }

    // Generate query embedding
    const queryEmbedding = await this.generateEmbedding(query);
    if (!queryEmbedding) return [];

    // Calculate similarity for all embeddings
    const results: Array<{
      embedding: WikiEmbedding;
      similarity: number;
    }> = [];

    for (const [filePath, embeddings] of this.embeddingsCache) {
      for (const emb of embeddings) {
        const similarity = cosineSimilarity(queryEmbedding, emb.embedding);
        results.push({ embedding: emb, similarity });
      }
    }

    // Sort by similarity and take top results
    results.sort((a, b) => b.similarity - a.similarity);

    // Dedupe by file path (keep highest similarity chunk per article)
    const seen = new Set<string>();
    const dedupedResults: SemanticSearchResult[] = [];

    for (const result of results) {
      if (seen.has(result.embedding.file_path)) continue;
      seen.add(result.embedding.file_path);

      const articles = await getWikiIndex();
      const article = articles.find(a => a.filePath === result.embedding.file_path);

      if (article) {
        dedupedResults.push({
          article,
          similarity: result.similarity,
          chunkText: result.embedding.chunk_text,
          chunkIndex: result.embedding.chunk_index,
        });
      }

      if (dedupedResults.length >= limit) break;
    }

    console.log(`📚 Semantic search: ${dedupedResults.length} results for "${query.substring(0, 50)}..."`);
    return dedupedResults;
  }

  /**
   * Hybrid search: combine keyword search results with semantic search
   * Uses Reciprocal Rank Fusion to merge rankings
   */
  async hybridSearch(
    keywordResults: Array<{ filePath: string; score: number }>,
    query: string,
    limit: number = 5
  ): Promise<Array<{ filePath: string; score: number; source: 'keyword' | 'semantic' | 'both' }>> {
    const RRF_K = 60; // RRF constant

    // Get semantic results
    const semanticResults = await this.semanticSearch(query, limit * 2);

    // Build score maps
    const keywordScores = new Map<string, number>();
    const semanticScores = new Map<string, number>();

    // Assign RRF scores for keyword results
    keywordResults.forEach((result, rank) => {
      const rrfScore = 1.0 / (RRF_K + rank + 1);
      keywordScores.set(result.filePath, rrfScore);
    });

    // Assign RRF scores for semantic results
    semanticResults.forEach((result, rank) => {
      if (result.article.filePath) {
        const rrfScore = 1.0 / (RRF_K + rank + 1);
        semanticScores.set(result.article.filePath, rrfScore);
      }
    });

    // Combine scores
    const allFilePaths = new Set([...keywordScores.keys(), ...semanticScores.keys()]);
    const combined: Array<{ filePath: string; score: number; source: 'keyword' | 'semantic' | 'both' }> = [];

    for (const filePath of allFilePaths) {
      const kScore = keywordScores.get(filePath) || 0;
      const sScore = semanticScores.get(filePath) || 0;

      let source: 'keyword' | 'semantic' | 'both';
      if (kScore > 0 && sScore > 0) source = 'both';
      else if (kScore > 0) source = 'keyword';
      else source = 'semantic';

      combined.push({
        filePath,
        score: kScore + sScore,  // Simple addition; could weight differently
        source,
      });
    }

    // Sort by combined score
    combined.sort((a, b) => b.score - a.score);

    console.log(`📚 Hybrid search: ${combined.length} combined results`);
    return combined.slice(0, limit);
  }

  /**
   * Get embedding stats
   */
  async getStats(): Promise<{ totalEmbeddings: number; articlesIndexed: number; lastIndex: Date | null }> {
    try {
      const countResult = await this.dbClient.query('SELECT COUNT(*) as count FROM wiki_embeddings');
      const articlesResult = await this.dbClient.query('SELECT COUNT(DISTINCT file_path) as count FROM wiki_embeddings');
      const statusResult = await this.dbClient.query('SELECT last_full_index FROM wiki_embedding_status LIMIT 1');

      return {
        totalEmbeddings: parseInt(countResult.results[0]?.count || '0'),
        articlesIndexed: parseInt(articlesResult.results[0]?.count || '0'),
        lastIndex: statusResult.results[0]?.last_full_index || null,
      };
    } catch (error) {
      return { totalEmbeddings: 0, articlesIndexed: 0, lastIndex: null };
    }
  }
}
