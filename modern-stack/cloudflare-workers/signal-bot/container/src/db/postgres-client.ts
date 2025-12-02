/**
 * PostgreSQL Database Client - Self-hosted Architecture
 *
 * Direct PostgreSQL connection replacing Worker API HTTP calls
 * Uses connection pooling for performance
 */

import { Pool, PoolClient, QueryResult } from 'pg';

/**
 * Sanitize user input for Discourse to prevent XSS (CVE-2025-004)
 * Escapes HTML, Markdown special characters, and JavaScript
 */
function sanitizeForDiscourse(input: string): string {
  if (!input) return '';

  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/`/g, '\\`')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_');
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number;           // Max connections in pool
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export class PostgresClient {
  private pool: Pool;
  private config: DatabaseConfig;

  // Whitelist of allowed table names to prevent SQL injection
  private static readonly ALLOWED_TABLES = new Set([
    'signal_groups',
    'signal_messages',
    'signal_members',
    'signal_member_group_memberships',
    'q_and_a_questions',
    'q_and_a_answers',
    'bot_command_usage',
    'user_preferences',
    'news_links',
    'repository_links',
    'url_summaries',
    'bot_errors',
    'scheduled_announcements',
    'announcement_deliveries',
  ]);

  constructor(config: DatabaseConfig) {
    this.config = config;
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.max || 20,
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 2000,
    });

    // Handle pool errors
    this.pool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err);
    });
  }

  /**
   * Validate table name against whitelist to prevent SQL injection
   */
  private validateTableName(table: string): string {
    if (!PostgresClient.ALLOWED_TABLES.has(table)) {
      throw new Error(`Security: Invalid table name "${table}". Only whitelisted tables are allowed.`);
    }
    return table;
  }

  /**
   * Validate input data for length and type to prevent buffer overflow
   */
  private validateInput(data: Record<string, any>): Record<string, any> {
    const MAX_STRING_LENGTH = 50000; // 50KB per field
    const validated: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
        throw new Error(`Security: Input too long for field "${key}" (${value.length} > ${MAX_STRING_LENGTH})`);
      }
      validated[key] = value;
    }

    return validated;
  }

  /**
   * Execute raw SQL query
   */
  async query(sql: string, params?: any[]): Promise<{ results: any[] }> {
    try {
      const result: QueryResult = await this.pool.query(sql, params);
      return { results: result.rows };
    } catch (error) {
      console.error('PostgreSQL query error:', { sql, params, error });
      throw error;
    }
  }

  /**
   * Insert record into table
   */
  async insert(table: string, data: Record<string, any>): Promise<void> {
    const validatedTable = this.validateTableName(table);
    const validatedData = this.validateInput(data);

    const keys = Object.keys(validatedData);
    const values = Object.values(validatedData);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

    const sql = `INSERT INTO ${validatedTable} (${keys.join(', ')}) VALUES (${placeholders})`;

    await this.pool.query(sql, values);
  }

  /**
   * Update records in table
   */
  async update(
    table: string,
    data: Record<string, any>,
    where: string,
    whereParams: any[]
  ): Promise<void> {
    const validatedTable = this.validateTableName(table);
    const validatedData = this.validateInput(data);

    const keys = Object.keys(validatedData);
    const values = Object.values(validatedData);

    // Build SET clause with type casting for numeric values
    const setClause = keys.map((key, i) => {
      const value = values[i];
      // Cast integers explicitly to avoid pg text type issue
      if (typeof value === 'number' && Number.isInteger(value)) {
        return `${key} = $${i + 1}::integer`;
      }
      return `${key} = $${i + 1}`;
    }).join(', ');

    let whereParamOffset = values.length;
    const whereClause = where.replace(/\?/g, () => `$${++whereParamOffset}`);

    const sql = `UPDATE ${validatedTable} SET ${setClause} WHERE ${whereClause}`;
    const allParams = [...values, ...whereParams];

    await this.pool.query(sql, allParams);
  }

  /**
   * Delete records from table
   */
  async delete(table: string, where: string, whereParams: any[]): Promise<void> {
    const validatedTable = this.validateTableName(table);

    let paramIndex = 1;
    const whereClause = where.replace(/\?/g, () => `$${paramIndex++}`);

    const sql = `DELETE FROM ${validatedTable} WHERE ${whereClause}`;

    await this.pool.query(sql, whereParams);
  }

  /**
   * Find one record
   */
  async findOne(table: string, where: string, whereParams: any[]): Promise<any | null> {
    const validatedTable = this.validateTableName(table);

    let paramIndex = 1;
    const whereClause = where.replace(/\?/g, () => `$${paramIndex++}`);

    const sql = `SELECT * FROM ${validatedTable} WHERE ${whereClause} LIMIT 1`;

    const result = await this.pool.query(sql, whereParams);
    return result.rows[0] || null;
  }

  /**
   * Find multiple records
   */
  async find(table: string, where: string, whereParams: any[]): Promise<any[]> {
    const validatedTable = this.validateTableName(table);

    let paramIndex = 1;
    const whereClause = where.replace(/\?/g, () => `$${paramIndex++}`);

    const sql = `SELECT * FROM ${validatedTable} WHERE ${whereClause}`;

    const result = await this.pool.query(sql, whereParams);
    return result.rows;
  }

  /**
   * Find all records in table
   */
  async findAll(table: string): Promise<any[]> {
    const validatedTable = this.validateTableName(table);

    const sql = `SELECT * FROM ${validatedTable}`;
    const result = await this.pool.query(sql);
    return result.rows;
  }

  // ============================================================================
  // Q&A SPECIFIC METHODS
  // ============================================================================

  /**
   * Get next question ID for a group (sequential per group)
   */
  async getNextQuestionId(groupId: string): Promise<number> {
    const result = await this.pool.query(
      'SELECT COALESCE(MAX(question_id), 0) + 1 as next_id FROM q_and_a_questions WHERE group_id = $1',
      [groupId]
    );
    return result.rows[0]?.next_id || 1;
  }

  /**
   * Save question
   */
  async saveQuestion(question: {
    questionId: number;
    question: string;
    title?: string;
    asker: string;
    askerPhone: string;
    groupId: string;
    groupName?: string;
  }): Promise<void> {
    await this.insert('q_and_a_questions', {
      id: this.generateId(),
      question_id: question.questionId,
      question: question.question,
      title: question.title || question.question.substring(0, 100),
      asker: question.asker,
      asker_phone: question.askerPhone,
      group_id: question.groupId,
      group_name: question.groupName,
      solved: false,
      answer_count: 0,
      solution_count: 0,
      timestamp: Date.now(),
    });
  }

  /**
   * Get questions (open or all)
   */
  async getQuestions(groupId: string, includesSolved: boolean = false): Promise<any[]> {
    let sql = 'SELECT * FROM q_and_a_questions WHERE group_id = $1';

    if (!includesSolved) {
      sql += ' AND solved = false';
    }

    sql += ' ORDER BY timestamp DESC LIMIT 20';

    const result = await this.pool.query(sql, [groupId]);
    return result.rows;
  }

  /**
   * Get question with all answers
   */
  async getQuestionWithAnswers(questionId: number, groupId?: string): Promise<{
    question: any;
    answers: any[];
  } | null> {
    // Get question
    let questionResult;
    if (groupId) {
      questionResult = await this.pool.query(
        'SELECT * FROM q_and_a_questions WHERE question_id = $1 AND group_id = $2',
        [questionId, groupId]
      );
    } else {
      questionResult = await this.pool.query(
        'SELECT * FROM q_and_a_questions WHERE question_id = $1',
        [questionId]
      );
    }

    if (questionResult.rows.length === 0) {
      return null;
    }

    const question = questionResult.rows[0];

    // Get answers
    const answersResult = await this.pool.query(
      'SELECT * FROM q_and_a_answers WHERE question_id = $1 ORDER BY is_solution DESC, timestamp ASC',
      [questionId]
    );

    return {
      question,
      answers: answersResult.rows,
    };
  }

  /**
   * Save answer to question
   */
  async saveAnswer(answer: {
    questionId: number;
    answer: string;
    answerer: string;
    answererPhone: string;
    groupId: string;
    groupName?: string;
  }): Promise<number> {
    // Get next answer ID for this question
    const result = await this.pool.query(
      'SELECT COALESCE(MAX(answer_id), 0) + 1 as next_id FROM q_and_a_answers WHERE question_id = $1',
      [answer.questionId]
    );
    const answerId = result.rows[0]?.next_id || 1;

    // Insert answer
    await this.insert('q_and_a_answers', {
      id: this.generateId(),
      answer_id: answerId,
      question_id: answer.questionId,
      answer: answer.answer,
      answerer: answer.answerer,
      answerer_phone: answer.answererPhone,
      group_id: answer.groupId,
      group_name: answer.groupName,
      is_solution: false,
      timestamp: Date.now(),
      upvotes: 0,
      downvotes: 0,
      edited: false,
    });

    // Update answer count
    await this.pool.query(
      'UPDATE q_and_a_questions SET answer_count = answer_count + 1 WHERE question_id = $1',
      [answer.questionId]
    );

    return answerId;
  }

  /**
   * Mark multiple answers as solutions
   */
  async markAnswersAsSolution(questionId: number, answerIds: number[]): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Mark answers as solutions
      for (const answerId of answerIds) {
        await client.query(
          'UPDATE q_and_a_answers SET is_solution = true, marked_solution_at = NOW() WHERE question_id = $1 AND answer_id = $2',
          [questionId, answerId]
        );
      }

      // Update question as solved
      await client.query(
        'UPDATE q_and_a_questions SET solved = true, solution_count = $1, solved_at = NOW() WHERE question_id = $2',
        [answerIds.length, questionId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Post question to Discourse (for self-hosted, this will be a direct API call)
   */
  async postQuestionToDiscourse(questionId: number): Promise<{
    success: boolean;
    topicId?: string;
    topicUrl?: string;
    error?: string;
  }> {
    try {
      // Get question and answers
      const data = await this.getQuestionWithAnswers(questionId);

      if (!data) {
        return { success: false, error: 'Question not found' };
      }

      const { question, answers } = data;

      // Check Discourse configuration
      const discourseUrl = process.env.DISCOURSE_URL || process.env.DISCOURSE_API_URL;
      const discourseApiKey = process.env.DISCOURSE_API_KEY;
      const discourseUsername = process.env.DISCOURSE_USERNAME || process.env.DISCOURSE_API_USERNAME;
      const discourseCategory = process.env.DISCOURSE_QA_CATEGORY || '1';

      if (!discourseUrl || !discourseApiKey || !discourseUsername) {
        return { success: false, error: 'Discourse not configured' };
      }

      // Build post body (CVE-2025-004: Sanitize all user input)
      const title = question.title || `Question #${questionId}`;

      let postBody = `# ${sanitizeForDiscourse(question.question)}\n\n`;
      postBody += `**Asked by**: ${sanitizeForDiscourse(question.asker)}\n`;
      postBody += `**Asked**: ${new Date(question.timestamp).toLocaleString()}\n`;
      postBody += `**Signal Group**: ${sanitizeForDiscourse(question.group_name || question.group_id)}\n\n`;
      postBody += `---\n\n`;

      if (answers.length > 0) {
        postBody += `## Answers\n\n`;

        for (const answer of answers) {
          const isSolution = answer.is_solution;
          const solutionMark = isSolution ? ' ✅ **SOLUTION**' : '';

          postBody += `### Answer #${answer.answer_id}${solutionMark}\n\n`;
          postBody += `**By**: ${sanitizeForDiscourse(answer.answerer)}\n`;
          postBody += `**Posted**: ${new Date(answer.timestamp).toLocaleString()}\n\n`;
          postBody += `${sanitizeForDiscourse(answer.answer)}\n\n`;
          postBody += `---\n\n`;
        }
      }

      postBody += `\n\n*This question was posted from Signal and marked as solved.*`;

      // Post to Discourse
      const createTopicUrl = `${discourseUrl.replace(/\/$/, '')}/posts.json`;

      const response = await fetch(createTopicUrl, {
        method: 'POST',
        headers: {
          'Api-Key': discourseApiKey,
          'Api-Username': discourseUsername,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          raw: postBody,
          category: discourseCategory,
          tags: ['signal-qa', 'solved'],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Discourse API error:', response.status, errorText);
        return {
          success: false,
          error: `Discourse API error: ${response.status}`
        };
      }

      const result = await response.json() as any;
      const topicId = result.topic_id?.toString();
      const topicUrl = topicId ? `${discourseUrl.replace(/\/$/, '')}/t/${topicId}` : undefined;

      // Update question with Discourse topic ID
      if (topicId) {
        await this.pool.query(
          'UPDATE q_and_a_questions SET discourse_topic_id = $1, forum_link = $2 WHERE question_id = $3',
          [topicId, topicUrl, questionId]
        );
      }

      return {
        success: true,
        topicId,
        topicUrl,
      };

    } catch (error) {
      console.error('Discourse posting error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ============================================================================
  // MESSAGE RETRIEVAL METHODS
  // ============================================================================

  /**
   * Get recent messages from a group by count
   */
  async getRecentMessages(groupId: string, count: number): Promise<any[]> {
    const sql = `
      SELECT * FROM signal_messages
      WHERE group_id = $1
      ORDER BY timestamp DESC
      LIMIT $2
    `;

    const result = await this.pool.query(sql, [groupId, count]);
    return result.rows.reverse(); // Reverse to get chronological order
  }

  /**
   * Get messages from a group within a time period (hours)
   */
  async getMessagesByTimeRange(groupId: string, hours: number): Promise<any[]> {
    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);

    const sql = `
      SELECT * FROM signal_messages
      WHERE group_id = $1 AND timestamp >= $2
      ORDER BY timestamp ASC
    `;

    const result = await this.pool.query(sql, [groupId, cutoffTime]);
    return result.rows;
  }

  /**
   * Save a message to the database
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
    attachments?: any;
    mentions?: any;
    isReply?: boolean;
    quotedMessageId?: string;
    quotedText?: string;
  }): Promise<void> {
    const sql = `
      INSERT INTO signal_messages (
        id, group_id, group_name, source_number, source_name, source_uuid,
        message, timestamp, attachments, mentions, is_reply, quoted_message_id, quoted_text
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO NOTHING
    `;

    await this.pool.query(sql, [
      message.id,
      message.groupId || null,
      message.groupName || null,
      message.sourceNumber || null,
      message.sourceName || null,
      message.sourceUuid || null,
      message.message,
      message.timestamp,
      message.attachments ? JSON.stringify(message.attachments) : null,
      message.mentions ? JSON.stringify(message.mentions) : null,
      message.isReply || false,
      message.quotedMessageId || null,
      message.quotedText || null
    ]);
  }

  /**
   * Get messages from a group with both count and time constraints
   * Returns up to 'count' messages from the last 'hours' hours
   */
  async getMessagesWithConstraints(
    groupId: string,
    count?: number,
    hours?: number
  ): Promise<any[]> {
    let sql = 'SELECT * FROM signal_messages WHERE group_id = $1';
    const params: any[] = [groupId];
    let paramIndex = 2;

    if (hours) {
      const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
      sql += ` AND timestamp >= $${paramIndex}`;
      params.push(cutoffTime);
      paramIndex++;
    }

    sql += ' ORDER BY timestamp DESC';

    if (count) {
      sql += ` LIMIT $${paramIndex}`;
      params.push(count);
    }

    const result = await this.pool.query(sql, params);
    return result.rows.reverse(); // Reverse to get chronological order
  }

  /**
   * Log command usage to database
   */
  async logCommand(data: {
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
    const sql = `
      INSERT INTO bot_command_usage (
        id, command, args, group_id, group_name, user_id, user_name,
        success, response_time, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;

    await this.pool.query(sql, [
      this.generateId(),
      data.command,
      data.args || null,
      data.groupId || null,
      data.groupName || null,
      data.userId,
      data.userName || null,
      data.success,
      data.responseTime || null,
      data.errorMessage || null
    ]);
  }

  /**
   * Log error to database
   */
  async logError(data: {
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
    const sql = `
      INSERT INTO bot_errors (
        id, error_type, error_message, stack_trace, command,
        group_id, group_name, user_id, user_name, context
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `;

    await this.pool.query(sql, [
      this.generateId(),
      data.errorType,
      data.errorMessage,
      data.stackTrace || null,
      data.command || null,
      data.groupId || null,
      data.groupName || null,
      data.userId || null,
      data.userName || null,
      data.context ? JSON.stringify(data.context) : null
    ]);
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Generate unique ID (UUID-like)
   */
  generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Test database connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const result = await this.pool.query('SELECT NOW()');
      console.log('PostgreSQL connection successful:', result.rows[0]);
      return true;
    } catch (error) {
      console.error('PostgreSQL connection failed:', error);
      return false;
    }
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    messages: number;
    questions: number;
    answers: number;
    groups: number;
  }> {
    const [messages, questions, answers, groups] = await Promise.all([
      this.pool.query('SELECT COUNT(*) as count FROM signal_messages'),
      this.pool.query('SELECT COUNT(*) as count FROM q_and_a_questions'),
      this.pool.query('SELECT COUNT(*) as count FROM q_and_a_answers'),
      this.pool.query('SELECT COUNT(DISTINCT group_id) as count FROM signal_messages'),
    ]);

    return {
      messages: parseInt(messages.rows[0]?.count || '0'),
      questions: parseInt(questions.rows[0]?.count || '0'),
      answers: parseInt(answers.rows[0]?.count || '0'),
      groups: parseInt(groups.rows[0]?.count || '0'),
    };
  }

  // ============================================================================
  // ANNOUNCEMENT SPECIFIC METHODS
  // ============================================================================

  /**
   * Get members of a specific group
   */
  async getGroupMembers(groupId: string): Promise<{
    uuid: string;
    phone_number: string | null;
    display_name: string | null;
  }[]> {
    const result = await this.pool.query(`
      SELECT
        m.uuid,
        m.phone_number,
        COALESCE(m.display_name, m.profile_name, m.phone_number) as display_name
      FROM signal_members m
      INNER JOIN signal_member_group_memberships mgm ON m.id = mgm.member_id
      WHERE mgm.group_id = $1
        AND mgm.is_active = true
        AND (m.is_bot = false OR m.is_bot IS NULL)
      ORDER BY m.display_name
    `, [groupId]);

    return result.rows;
  }

  /**
   * Get pending scheduled announcements that are due
   */
  async getPendingAnnouncements(): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT *
      FROM scheduled_announcements
      WHERE status = 'pending'
        AND scheduled_at <= NOW()
      ORDER BY scheduled_at ASC
    `);

    return result.rows;
  }

  /**
   * Get all pending announcements for a user
   */
  async getUserPendingAnnouncements(userId: string): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT
        id,
        message,
        target_group_names,
        send_as_dm,
        scheduled_at,
        status,
        created_by_name
      FROM scheduled_announcements
      WHERE created_by = $1
        AND status = 'pending'
      ORDER BY scheduled_at ASC
      LIMIT 20
    `, [userId]);

    return result.rows;
  }

  /**
   * Mark announcement as sent
   */
  async markAnnouncementSent(id: number, recipientCount: number): Promise<void> {
    await this.pool.query(`
      UPDATE scheduled_announcements
      SET status = 'sent', sent_at = NOW(), recipient_count = $2
      WHERE id = $1
    `, [id, recipientCount]);
  }

  /**
   * Mark announcement as failed
   */
  async markAnnouncementFailed(id: number, errorMessage: string): Promise<void> {
    await this.pool.query(`
      UPDATE scheduled_announcements
      SET status = 'failed', error_message = $2
      WHERE id = $1
    `, [id, errorMessage]);
  }

  /**
   * Cancel a scheduled announcement
   */
  async cancelAnnouncement(id: number, userId: string): Promise<boolean> {
    const result = await this.pool.query(`
      UPDATE scheduled_announcements
      SET status = 'cancelled'
      WHERE id = $1 AND created_by = $2 AND status = 'pending'
      RETURNING id
    `, [id, userId]);

    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Close pool (for graceful shutdown)
   */
  async close(): Promise<void> {
    await this.pool.end();
    console.log('PostgreSQL connection pool closed');
  }
}

/**
 * Create PostgreSQL client from environment variables
 */
export function createPostgresClient(): PostgresClient {
  const config: DatabaseConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'signal_bot',
    user: process.env.DB_USER || 'signal_bot',
    password: process.env.DB_PASSWORD || '',
    max: parseInt(process.env.DB_POOL_MAX || '20'),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '30000'),
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '2000'),
  };

  return new PostgresClient(config);
}
