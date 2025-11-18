/**
 * Worker API Client
 *
 * Client for calling Cloudflare Worker API to access D1 database and R2 storage.
 * The container doesn't have direct access to D1/R2, so it calls the Worker.
 */

import axios, { AxiosInstance } from 'axios';

export interface QueryResult {
  results: any[];
  success: boolean;
  meta?: {
    duration: number;
    rows_read: number;
    rows_written: number;
  };
}

export interface R2UploadResult {
  key: string;
  url: string;
  size: number;
}

export class WorkerAPIClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(baseUrl: string, apiToken?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(apiToken && { 'Authorization': `Bearer ${apiToken}` }),
      },
    });

    // Request logging
    this.client.interceptors.request.use((config) => {
      console.log(`→ ${config.method?.toUpperCase()} ${config.url}`);
      return config;
    });

    // Response logging
    this.client.interceptors.response.use(
      (response) => {
        console.log(`← ${response.status} ${response.config.url} (${response.headers['x-response-time'] || '?'})`);
        return response;
      },
      (error) => {
        console.error(`← ERROR ${error.config?.url}:`, error.message);
        throw error;
      }
    );
  }

  // ============================================================================
  // DATABASE OPERATIONS (D1 via Worker)
  // ============================================================================

  /**
   * Execute a raw SQL query
   */
  async query(sql: string, params: any[] = []): Promise<QueryResult> {
    try {
      const response = await this.client.post('/api/db/query', {
        sql,
        params,
      });
      return response.data;
    } catch (error) {
      console.error('Database query error:', error);
      throw new Error(`Database query failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Insert a record
   */
  async insert(table: string, data: Record<string, any>): Promise<number> {
    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = values.map(() => '?').join(', ');

    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;

    const result = await this.query(sql, values);
    return result.results[0]?.id || 0;
  }

  /**
   * Update records
   */
  async update(table: string, data: Record<string, any>, where: string, whereParams: any[] = []): Promise<number> {
    const sets = Object.keys(data).map(key => `${key} = ?`).join(', ');
    const values = [...Object.values(data), ...whereParams];

    const sql = `UPDATE ${table} SET ${sets} WHERE ${where}`;

    const result = await this.query(sql, values);
    return result.meta?.rows_written || 0;
  }

  /**
   * Delete records
   */
  async delete(table: string, where: string, whereParams: any[] = []): Promise<number> {
    const sql = `DELETE FROM ${table} WHERE ${where}`;

    const result = await this.query(sql, whereParams);
    return result.meta?.rows_written || 0;
  }

  /**
   * Find records
   */
  async find(table: string, where?: string, params: any[] = [], limit?: number): Promise<any[]> {
    let sql = `SELECT * FROM ${table}`;

    if (where) {
      sql += ` WHERE ${where}`;
    }

    if (limit) {
      sql += ` LIMIT ${limit}`;
    }

    const result = await this.query(sql, params);
    return result.results || [];
  }

  /**
   * Find one record
   */
  async findOne(table: string, where: string, params: any[] = []): Promise<any | null> {
    const results = await this.find(table, where, params, 1);
    return results[0] || null;
  }

  /**
   * Count records
   */
  async count(table: string, where?: string, params: any[] = []): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM ${table}`;

    if (where) {
      sql += ` WHERE ${where}`;
    }

    const result = await this.query(sql, params);
    return result.results[0]?.count || 0;
  }

  // ============================================================================
  // SIGNAL-SPECIFIC DATABASE OPERATIONS
  // ============================================================================

  /**
   * Save a message to database
   */
  async saveMessage(message: {
    id: string;
    groupId?: string;
    groupName?: string;
    sourceNumber?: string;
    sourceName?: string;
    sourceUuid?: string;
    message: string;
    timestamp: number;
    attachments?: any[];
    mentions?: any[];
    isReply?: boolean;
    quotedMessageId?: string;
    quotedText?: string;
  }): Promise<void> {
    await this.insert('signal_messages', {
      id: message.id,
      group_id: message.groupId,
      group_name: message.groupName,
      source_number: message.sourceNumber,
      source_name: message.sourceName,
      source_uuid: message.sourceUuid,
      message: message.message,
      timestamp: message.timestamp,
      attachments: message.attachments ? JSON.stringify(message.attachments) : null,
      mentions: message.mentions ? JSON.stringify(message.mentions) : null,
      is_reply: message.isReply ? 1 : 0,
      quoted_message_id: message.quotedMessageId,
      quoted_text: message.quotedText,
      created_at: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * Log bot command usage
   */
  async logCommand(command: {
    command: string;
    args?: string;
    groupId?: string;
    groupName?: string;
    userId: string;
    userName?: string;
    success: boolean;
    responseTime?: number;
    errorMessage?: string;
  }): Promise<void> {
    await this.insert('bot_command_usage', {
      id: this.generateId(),
      command: command.command,
      args: command.args,
      group_id: command.groupId,
      group_name: command.groupName,
      user_id: command.userId,
      user_name: command.userName,
      success: command.success ? 1 : 0,
      response_time: command.responseTime,
      error_message: command.errorMessage,
      timestamp: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * Log bot error
   */
  async logError(error: {
    errorType: string;
    errorMessage: string;
    stackTrace?: string;
    command?: string;
    groupId?: string;
    groupName?: string;
    userId?: string;
    userName?: string;
    context?: any;
  }): Promise<void> {
    await this.insert('bot_errors', {
      id: this.generateId(),
      error_type: error.errorType,
      error_message: error.errorMessage,
      stack_trace: error.stackTrace,
      command: error.command,
      group_id: error.groupId,
      group_name: error.groupName,
      user_id: error.userId,
      user_name: error.userName,
      context: error.context ? JSON.stringify(error.context) : null,
      timestamp: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * Get Q&A questions
   */
  async getQuestions(groupId?: string, solved?: boolean): Promise<any[]> {
    let where = '';
    const params: any[] = [];

    if (groupId) {
      where = 'group_id = ?';
      params.push(groupId);
    }

    if (solved !== undefined) {
      where += (where ? ' AND ' : '') + 'solved = ?';
      params.push(solved ? 1 : 0);
    }

    return this.find('q_and_a_questions', where || undefined, params);
  }

  /**
   * Save Q&A question
   */
  async saveQuestion(question: {
    questionId: number;
    question: string;
    title?: string;
    asker: string;
    askerPhone: string;
    groupId: string;
    groupName?: string;
    answers?: any[];
  }): Promise<void> {
    await this.insert('q_and_a_questions', {
      id: this.generateId(),
      question_id: question.questionId,
      question: question.question,
      title: question.title,
      asker: question.asker,
      asker_phone: question.askerPhone,
      group_id: question.groupId,
      group_name: question.groupName,
      solved: 0,
      timestamp: Math.floor(Date.now() / 1000),
      answers: question.answers ? JSON.stringify(question.answers) : null,
    });
  }

  /**
   * Update question status
   */
  async updateQuestion(questionId: number, updates: {
    solved?: boolean;
    solvedBy?: string;
    solvedAt?: number;
    answers?: any[];
    forumLink?: string;
  }): Promise<void> {
    const data: Record<string, any> = {};

    if (updates.solved !== undefined) data.solved = updates.solved ? 1 : 0;
    if (updates.solvedBy) data.solved_by = updates.solvedBy;
    if (updates.solvedAt) data.solved_at = updates.solvedAt;
    if (updates.answers) data.answers = JSON.stringify(updates.answers);
    if (updates.forumLink) data.forum_link = updates.forumLink;

    await this.update('q_and_a_questions', data, 'question_id = ?', [questionId]);
  }

  /**
   * Save news link
   */
  async saveNewsLink(news: {
    url: string;
    domain?: string;
    title?: string;
    summary?: string;
    groupId: string;
    groupName?: string;
    postedBy: string;
    postedByName?: string;
    forumUrl?: string;
  }): Promise<void> {
    // Check if exists
    const existing = await this.findOne('news_links', 'url = ? AND group_id = ?', [news.url, news.groupId]);

    if (existing) {
      // Update post count
      await this.update(
        'news_links',
        {
          post_count: existing.post_count + 1,
          last_posted_at: Math.floor(Date.now() / 1000),
        },
        'url = ? AND group_id = ?',
        [news.url, news.groupId]
      );
    } else {
      // Insert new
      await this.insert('news_links', {
        id: this.generateId(),
        url: news.url,
        domain: news.domain,
        title: news.title,
        summary: news.summary,
        group_id: news.groupId,
        group_name: news.groupName,
        posted_by: news.postedBy,
        posted_by_name: news.postedByName,
        forum_url: news.forumUrl,
        post_count: 1,
        first_posted_at: Math.floor(Date.now() / 1000),
        last_posted_at: Math.floor(Date.now() / 1000),
      });
    }
  }

  // ============================================================================
  // R2 STORAGE OPERATIONS (via Worker)
  // ============================================================================

  /**
   * Upload file to R2
   */
  async uploadFile(key: string, content: Buffer | string, contentType?: string): Promise<R2UploadResult> {
    try {
      const response = await this.client.post('/api/r2/upload', {
        key,
        content: content instanceof Buffer ? content.toString('base64') : content,
        contentType,
        encoding: content instanceof Buffer ? 'base64' : 'utf8',
      });
      return response.data;
    } catch (error) {
      console.error('R2 upload error:', error);
      throw new Error(`R2 upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Download file from R2
   */
  async downloadFile(key: string): Promise<Buffer> {
    try {
      const response = await this.client.get(`/api/r2/download/${encodeURIComponent(key)}`, {
        responseType: 'arraybuffer',
      });
      return Buffer.from(response.data);
    } catch (error) {
      console.error('R2 download error:', error);
      throw new Error(`R2 download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete file from R2
   */
  async deleteFile(key: string): Promise<void> {
    try {
      await this.client.delete(`/api/r2/delete/${encodeURIComponent(key)}`);
    } catch (error) {
      console.error('R2 delete error:', error);
      throw new Error(`R2 delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List files in R2
   */
  async listFiles(prefix?: string): Promise<string[]> {
    try {
      const response = await this.client.get('/api/r2/list', {
        params: { prefix },
      });
      return response.data.files || [];
    } catch (error) {
      console.error('R2 list error:', error);
      throw new Error(`R2 list failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  /**
   * Generate unique ID (simple implementation)
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
