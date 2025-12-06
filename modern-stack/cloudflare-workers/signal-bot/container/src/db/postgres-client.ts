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
    'verification_requests',
    // Breakout room tables
    'breakout_rooms',
    'breakout_room_members',
    'breakout_room_messages',
    'breakout_annotations',
    // TIL table
    'today_i_learned',
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
   * Can optionally link to a breakout room if the question was asked inside one
   */
  async saveQuestion(question: {
    questionId: number;
    question: string;
    title?: string;
    asker: string;
    askerPhone: string;
    groupId: string;
    groupName?: string;
    breakoutId?: number;
    annotationId?: number;
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
      breakout_id: question.breakoutId || null,
      annotation_id: question.annotationId || null,
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
   * Get the most recent unanswered question in a group
   */
  async getMostRecentUnansweredQuestion(groupId: string): Promise<any | null> {
    const result = await this.pool.query(`
      SELECT q.*
      FROM q_and_a_questions q
      WHERE q.group_id = $1
        AND q.solved = false
      ORDER BY q.timestamp DESC
      LIMIT 1
    `, [groupId]);

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Get count of unanswered questions in a group
   */
  async getUnansweredQuestionCount(groupId: string): Promise<number> {
    const result = await this.pool.query(`
      SELECT COUNT(*) as count
      FROM q_and_a_questions
      WHERE group_id = $1 AND solved = false
    `, [groupId]);

    return parseInt(result.rows[0]?.count || '0');
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
   *
   * Handles foreign key constraint gracefully - if quoted_message_id references
   * a message not in our database, we save without the foreign key reference
   * but preserve the quoted_text for context.
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

    try {
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
    } catch (error: any) {
      // Handle foreign key constraint violation for quoted_message_id
      // This happens when quoting messages not in our database (older messages)
      if (error?.code === '23503' && error?.constraint?.includes('quoted_message')) {
        // Retry without the foreign key reference, but preserve quoted_text
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
          null, // Set quoted_message_id to NULL
          message.quotedText || null // Keep quoted_text for context
        ]);
      } else {
        throw error;
      }
    }
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
   * Get a signal group by ID
   */
  async getGroupById(groupId: string): Promise<{ id: string; name: string; description?: string } | null> {
    const result = await this.pool.query(`
      SELECT id, name, description
      FROM signal_groups
      WHERE id = $1
    `, [groupId]);

    return result.rows.length > 0 ? result.rows[0] : null;
  }

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
   * Get display names for a list of member UUIDs
   * Returns a map of uuid -> display_name
   */
  async getMemberDisplayNamesByUuids(uuids: string[]): Promise<Map<string, string>> {
    if (uuids.length === 0) {
      return new Map();
    }

    // Only return actual names (display_name, profile_name, or phone_number)
    // Do NOT return UUID fallbacks - let the caller handle unknown users
    const result = await this.pool.query(`
      SELECT
        uuid,
        COALESCE(display_name, profile_name, phone_number) as display_name
      FROM signal_members
      WHERE uuid = ANY($1)
        AND (display_name IS NOT NULL OR profile_name IS NOT NULL OR phone_number IS NOT NULL)
    `, [uuids]);

    const displayNames = new Map<string, string>();
    for (const row of result.rows) {
      if (row.display_name) {
        displayNames.set(row.uuid, row.display_name);
      }
    }
    return displayNames;
  }

  /**
   * Find a member by their display name or profile name
   * Used for looking up action creators when forwarding DM replies
   * Returns the member's uuid and name info if found
   */
  async findMemberByName(name: string): Promise<{ uuid: string; display_name?: string; profile_name?: string } | null> {
    if (!name || name.trim() === '') {
      return null;
    }

    const cleanName = name.trim();

    // Search by exact match first, then fuzzy match
    const result = await this.pool.query(`
      SELECT uuid, display_name, profile_name
      FROM signal_members
      WHERE display_name = $1
         OR profile_name = $1
         OR LOWER(display_name) = LOWER($1)
         OR LOWER(profile_name) = LOWER($1)
      ORDER BY
        CASE
          WHEN display_name = $1 THEN 1
          WHEN profile_name = $1 THEN 2
          WHEN LOWER(display_name) = LOWER($1) THEN 3
          WHEN LOWER(profile_name) = LOWER($1) THEN 4
          ELSE 5
        END
      LIMIT 1
    `, [cleanName]);

    if (result.rows.length === 0) {
      return null;
    }

    return {
      uuid: result.rows[0].uuid,
      display_name: result.rows[0].display_name,
      profile_name: result.rows[0].profile_name,
    };
  }

  /**
   * Update member profile name from incoming message
   * This captures the Signal profile name (sourceName) when users send messages
   * Only updates if the member exists and doesn't already have a profile_name set
   */
  async updateMemberProfileName(uuid: string, profileName: string, phoneNumber?: string): Promise<void> {
    if (!uuid || !profileName) return;

    // Skip if profileName looks like a phone number (fallback value)
    if (profileName.startsWith('+') || /^\d+$/.test(profileName)) return;

    try {
      // Update profile_name if member exists and profile_name is null or different
      const result = await this.pool.query(`
        UPDATE signal_members
        SET
          profile_name = COALESCE(profile_name, $2),
          phone_number = COALESCE(phone_number, $3),
          updated_at = NOW()
        WHERE uuid = $1
          AND (profile_name IS NULL OR profile_name != $2)
        RETURNING uuid
      `, [uuid, profileName, phoneNumber || null]);

      if (result.rowCount && result.rowCount > 0) {
        console.log(`📝 Updated profile name for ${uuid}: ${profileName}`);
      }
    } catch (error) {
      // Silently fail - this is a best-effort update
      console.error('Failed to update member profile name:', error);
    }
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

  // ============================================================================
  // VERIFICATION REQUEST METHODS
  // ============================================================================

  /**
   * Create a new verification request
   */
  async createVerificationRequest(data: {
    userUuid: string;
    userName?: string;
    userPhone?: string;
    entryGroupId: string;
    requestedByUuid?: string;
    requestedByName?: string;
    expiresInHours?: number;
  }): Promise<{ id: number; expiresAt: Date }> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + (data.expiresInHours || 24));

    const result = await this.pool.query(`
      INSERT INTO verification_requests (
        user_uuid, user_name, user_phone, entry_group_id,
        requested_by_uuid, requested_by_name, status, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'pending_intro', $7)
      RETURNING id, expires_at
    `, [
      data.userUuid,
      data.userName || null,
      data.userPhone || null,
      data.entryGroupId,
      data.requestedByUuid || null,
      data.requestedByName || null,
      expiresAt
    ]);

    return {
      id: result.rows[0].id,
      expiresAt: result.rows[0].expires_at
    };
  }

  /**
   * Get active verification request for a user in a group
   */
  async getActiveVerificationRequest(userUuid: string, groupId?: string): Promise<any | null> {
    let sql = `
      SELECT * FROM verification_requests
      WHERE user_uuid = $1
        AND status IN ('pending_intro', 'pending_vouch')
    `;
    const params: any[] = [userUuid];

    if (groupId) {
      sql += ' AND entry_group_id = $2';
      params.push(groupId);
    }

    sql += ' ORDER BY created_at DESC LIMIT 1';

    const result = await this.pool.query(sql, params);
    return result.rows[0] || null;
  }

  /**
   * Get pending vouch requests where user is the voucher
   */
  async getPendingVouchRequests(voucherUuid: string): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT * FROM verification_requests
      WHERE voucher_uuid = $1
        AND status = 'pending_vouch'
      ORDER BY voucher_asked_at ASC
    `, [voucherUuid]);

    return result.rows;
  }

  /**
   * Update verification request status
   */
  async updateVerificationStatus(
    requestId: number,
    status: string,
    additionalData?: {
      voucherUuid?: string;
      voucherName?: string;
      introText?: string;
      voucherAskedAt?: Date;
      completedAt?: Date;
    }
  ): Promise<void> {
    let sql = 'UPDATE verification_requests SET status = $1';
    const params: any[] = [status];
    let paramIndex = 2;

    if (additionalData?.voucherUuid) {
      sql += `, voucher_uuid = $${paramIndex++}`;
      params.push(additionalData.voucherUuid);
    }
    if (additionalData?.voucherName) {
      sql += `, voucher_name = $${paramIndex++}`;
      params.push(additionalData.voucherName);
    }
    if (additionalData?.introText) {
      sql += `, intro_text = $${paramIndex++}`;
      params.push(additionalData.introText);
    }
    if (additionalData?.voucherAskedAt) {
      sql += `, voucher_asked_at = $${paramIndex++}`;
      params.push(additionalData.voucherAskedAt);
    }
    if (additionalData?.completedAt) {
      sql += `, completed_at = $${paramIndex++}`;
      params.push(additionalData.completedAt);
    }

    sql += ` WHERE id = $${paramIndex}`;
    params.push(requestId);

    await this.pool.query(sql, params);
  }

  /**
   * Get expired verification requests that need to be processed
   */
  async getExpiredVerificationRequests(): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT * FROM verification_requests
      WHERE status IN ('pending_intro', 'pending_vouch')
        AND expires_at <= NOW()
      ORDER BY expires_at ASC
    `);

    return result.rows;
  }

  /**
   * Check if user has any active verification request (prevents duplicates)
   */
  async hasActiveVerificationRequest(userUuid: string, groupId: string): Promise<boolean> {
    const result = await this.pool.query(`
      SELECT 1 FROM verification_requests
      WHERE user_uuid = $1
        AND entry_group_id = $2
        AND status IN ('pending_intro', 'pending_vouch')
      LIMIT 1
    `, [userUuid, groupId]);

    return result.rows.length > 0;
  }

  /**
   * Get verification request by ID
   */
  async getVerificationRequestById(id: number): Promise<any | null> {
    const result = await this.pool.query(
      'SELECT * FROM verification_requests WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  // ============================================================================
  // BREAKOUT ROOM METHODS
  // ============================================================================

  /**
   * Create a new breakout room
   */
  async createBreakoutRoom(data: {
    signalGroupId?: string;
    parentGroupId: string;
    parentGroupName?: string;
    topic: string;
    roomName?: string;
    roomType?: string;
    creatorUuid: string;
    creatorName?: string;
    facilitatorUuid?: string;
    facilitatorName?: string;
    durationMinutes?: number;
    privacyMode?: string;
    autoPostToDiscourse?: boolean;
    notifyParentOnEnd?: boolean;
    allowLateJoin?: boolean;
    recordMessages?: boolean;
  }): Promise<{ id: number; expiresAt: Date }> {
    const durationMinutes = data.durationMinutes || 60;
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + durationMinutes);

    const result = await this.pool.query(`
      INSERT INTO breakout_rooms (
        signal_group_id, parent_group_id, parent_group_name, topic, room_name, room_type,
        creator_uuid, creator_name, facilitator_uuid, facilitator_name,
        status, duration_minutes, expires_at, privacy_mode,
        auto_post_to_discourse, notify_parent_on_end, allow_late_join, record_messages
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $12, $13, $14, $15, $16, $17)
      RETURNING id, expires_at
    `, [
      data.signalGroupId || null,
      data.parentGroupId,
      data.parentGroupName || null,
      data.topic,
      data.roomName || null,
      data.roomType || 'general',
      data.creatorUuid,
      data.creatorName || null,
      data.facilitatorUuid || data.creatorUuid,
      data.facilitatorName || data.creatorName || null,
      durationMinutes,
      expiresAt,
      data.privacyMode || 'summary_only',
      data.autoPostToDiscourse !== false,
      data.notifyParentOnEnd !== false,
      data.allowLateJoin !== false,
      data.recordMessages !== false
    ]);

    return {
      id: result.rows[0].id,
      expiresAt: result.rows[0].expires_at
    };
  }

  /**
   * Update breakout room with Signal group ID after creation
   */
  async updateBreakoutSignalGroupId(breakoutId: number, signalGroupId: string): Promise<void> {
    await this.pool.query(
      'UPDATE breakout_rooms SET signal_group_id = $1 WHERE id = $2',
      [signalGroupId, breakoutId]
    );
  }

  /**
   * Update breakout room with announcement message info for emoji-to-join
   */
  async updateBreakoutAnnouncement(breakoutId: number, announcementGroupId: string, announcementTimestamp: number): Promise<void> {
    await this.pool.query(
      'UPDATE breakout_rooms SET announcement_group_id = $1, announcement_timestamp = $2 WHERE id = $3',
      [announcementGroupId, announcementTimestamp, breakoutId]
    );
  }

  /**
   * Find active breakout room by announcement message (for emoji-to-join)
   * @param groupId - The group where the announcement was posted
   * @param timestamp - The timestamp of the message being reacted to
   */
  async getBreakoutByAnnouncement(groupId: string, timestamp: number): Promise<any | null> {
    const result = await this.pool.query(`
      SELECT * FROM breakout_rooms
      WHERE announcement_group_id = $1
        AND announcement_timestamp = $2
        AND status = 'active'
      LIMIT 1
    `, [groupId, timestamp]);

    return result.rows[0] || null;
  }

  /**
   * Get active breakout room by Signal group ID
   */
  async getActiveBreakoutByGroupId(signalGroupId: string): Promise<any | null> {
    const result = await this.pool.query(`
      SELECT * FROM breakout_rooms
      WHERE signal_group_id = $1
        AND status IN ('active', 'ending')
      LIMIT 1
    `, [signalGroupId]);

    return result.rows[0] || null;
  }

  /**
   * Get breakout room by ID
   */
  async getBreakoutRoomById(breakoutId: number): Promise<any | null> {
    const result = await this.pool.query(
      'SELECT * FROM breakout_rooms WHERE id = $1',
      [breakoutId]
    );
    return result.rows[0] || null;
  }

  /**
   * Get active breakouts from a parent group
   */
  async getActiveBreakoutsFromParent(parentGroupId: string): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT * FROM breakout_rooms
      WHERE parent_group_id = $1
        AND status IN ('active', 'ending')
      ORDER BY created_at DESC
    `, [parentGroupId]);

    return result.rows;
  }

  /**
   * Get all breakouts from a parent group (including ended)
   */
  async getBreakoutsFromParent(parentGroupId: string, limit: number = 10): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT * FROM breakout_rooms
      WHERE parent_group_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [parentGroupId, limit]);

    return result.rows;
  }

  /**
   * Add member to breakout room
   */
  async addBreakoutMember(data: {
    breakoutId: number;
    memberUuid: string;
    memberName?: string;
    role?: string;
    wasInvited?: boolean;
  }): Promise<void> {
    await this.pool.query(`
      INSERT INTO breakout_room_members (
        breakout_id, member_uuid, member_name, role, was_invited
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (breakout_id, member_uuid) DO UPDATE SET
        member_name = COALESCE(EXCLUDED.member_name, breakout_room_members.member_name),
        role = COALESCE(EXCLUDED.role, breakout_room_members.role)
    `, [
      data.breakoutId,
      data.memberUuid,
      data.memberName || null,
      data.role || 'participant',
      data.wasInvited !== false
    ]);
  }

  /**
   * Get breakout room members
   */
  async getBreakoutMembers(breakoutId: number): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT * FROM breakout_room_members
      WHERE breakout_id = $1
      ORDER BY message_count DESC, joined_at ASC
    `, [breakoutId]);

    return result.rows;
  }

  /**
   * Get a specific member from a breakout room
   */
  async getBreakoutMember(breakoutId: number, memberUuid: string): Promise<any | null> {
    const result = await this.pool.query(`
      SELECT * FROM breakout_room_members
      WHERE breakout_id = $1 AND member_uuid = $2
    `, [breakoutId, memberUuid]);

    return result.rows[0] || null;
  }

  /**
   * Record a message in breakout room
   */
  async recordBreakoutMessage(data: {
    breakoutId: number;
    signalMessageId?: string;
    senderUuid: string;
    senderName?: string;
    messageText: string;
    messageType?: string;
    timestamp: number;
    isReply?: boolean;
    replyToMessageId?: string;
    quotedText?: string;
    urls?: string[];  // Optional URLs extracted from message
  }): Promise<number> {
    // Build extracted_entities if URLs are provided
    const extractedEntities = data.urls && data.urls.length > 0
      ? { urls: data.urls, people: [], dates: [] }
      : null;

    const result = await this.pool.query(`
      INSERT INTO breakout_room_messages (
        breakout_id, signal_message_id, sender_uuid, sender_name, message_text,
        message_type, timestamp, is_reply, reply_to_message_id, quoted_text,
        extracted_entities
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `, [
      data.breakoutId,
      data.signalMessageId || null,
      data.senderUuid,
      data.senderName || null,
      data.messageText,
      data.messageType || 'chat',
      data.timestamp,
      data.isReply || false,
      data.replyToMessageId || null,
      data.quotedText || null,
      extractedEntities ? JSON.stringify(extractedEntities) : null
    ]);

    // Update member engagement
    await this.updateBreakoutMemberEngagement(data.breakoutId, data.senderUuid, data.timestamp);

    // Update room metrics
    await this.pool.query(`
      UPDATE breakout_rooms
      SET total_messages = total_messages + 1
      WHERE id = $1::integer
    `, [data.breakoutId]);

    // If URLs were shared, add them to resources_shared_json
    if (data.urls && data.urls.length > 0) {
      await this.addBreakoutResources(data.breakoutId, data.urls, data.senderName || 'Unknown', data.messageText);
    }

    return result.rows[0].id;
  }

  /**
   * Add URLs to breakout room's resources_shared_json
   */
  async addBreakoutResources(
    breakoutId: number,
    urls: string[],
    sharedBy: string,
    context: string
  ): Promise<void> {
    // Get existing resources
    const existing = await this.pool.query(`
      SELECT resources_shared_json FROM breakout_rooms WHERE id = $1::integer
    `, [breakoutId]);

    const currentResources = existing.rows[0]?.resources_shared_json || [];

    // Add new resources (avoiding duplicates)
    const existingUrls = new Set(currentResources.map((r: any) => r.url));
    const newResources = urls
      .filter(url => !existingUrls.has(url))
      .map(url => ({
        url,
        shared_by: sharedBy,
        context: context.length > 200 ? context.substring(0, 200) + '...' : context,
        shared_at: new Date().toISOString()
      }));

    if (newResources.length > 0) {
      const updatedResources = [...currentResources, ...newResources];
      await this.pool.query(`
        UPDATE breakout_rooms
        SET resources_shared_json = $2::jsonb
        WHERE id = $1::integer
      `, [breakoutId, JSON.stringify(updatedResources)]);
    }
  }

  /**
   * Get all resources shared in a breakout room
   */
  async getBreakoutResources(breakoutId: number): Promise<Array<{
    url: string;
    shared_by: string;
    context: string;
    shared_at: string;
  }>> {
    const result = await this.pool.query(`
      SELECT resources_shared_json FROM breakout_rooms WHERE id = $1::integer
    `, [breakoutId]);

    return result.rows[0]?.resources_shared_json || [];
  }

  /**
   * Update member engagement metrics
   */
  async updateBreakoutMemberEngagement(breakoutId: number, memberUuid: string, timestamp: number): Promise<void> {
    await this.pool.query(`
      UPDATE breakout_room_members
      SET
        message_count = message_count + 1,
        first_message_at = COALESCE(first_message_at, to_timestamp($3 / 1000.0)),
        last_message_at = to_timestamp($3 / 1000.0)
      WHERE breakout_id = $1 AND member_uuid = $2
    `, [breakoutId, memberUuid, timestamp]);

    // Update unique participants count
    await this.pool.query(`
      UPDATE breakout_rooms
      SET unique_participants = (
        SELECT COUNT(DISTINCT member_uuid)
        FROM breakout_room_members
        WHERE breakout_id = $1 AND message_count > 0
      )
      WHERE id = $1
    `, [breakoutId]);
  }

  /**
   * Get messages from breakout room for summarization
   */
  async getBreakoutMessages(breakoutId: number): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT * FROM breakout_room_messages
      WHERE breakout_id = $1
      ORDER BY timestamp ASC
    `, [breakoutId]);

    return result.rows;
  }

  /**
   * Update breakout room status
   */
  async updateBreakoutStatus(breakoutId: number, status: string): Promise<void> {
    let sql = 'UPDATE breakout_rooms SET status = $1';
    const params: any[] = [status];

    if (status === 'ended' || status === 'expired' || status === 'archived') {
      sql += ', ended_at = NOW()';
      sql += ', actual_duration_minutes = EXTRACT(EPOCH FROM (NOW() - created_at)) / 60';
    }

    sql += ' WHERE id = $2';
    params.push(breakoutId);

    await this.pool.query(sql, params);
  }

  /**
   * Update warning flags
   */
  async updateBreakoutWarningFlag(breakoutId: number, warningType: '15min' | '5min' | '1min'): Promise<void> {
    const column = `warning_${warningType}_sent`;
    await this.pool.query(`
      UPDATE breakout_rooms
      SET ${column} = true
      WHERE id = $1
    `, [breakoutId]);
  }

  /**
   * Get breakouts that need warning notifications
   */
  async getBreakoutsNeedingWarnings(): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT * FROM breakout_rooms
      WHERE status = 'active'
        AND (
          (expires_at - INTERVAL '15 minutes' <= NOW() AND NOT warning_15min_sent)
          OR (expires_at - INTERVAL '5 minutes' <= NOW() AND NOT warning_5min_sent)
          OR (expires_at - INTERVAL '1 minute' <= NOW() AND NOT warning_1min_sent)
        )
      ORDER BY expires_at ASC
    `);

    return result.rows;
  }

  /**
   * Get expired breakouts that need to be closed
   */
  async getExpiredBreakouts(): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT * FROM breakout_rooms
      WHERE status = 'active'
        AND expires_at <= NOW()
      ORDER BY expires_at ASC
    `);

    return result.rows;
  }

  /**
   * Extend breakout room duration
   */
  async extendBreakoutDuration(breakoutId: number, additionalMinutes: number): Promise<{ success: boolean; newExpiresAt?: Date; error?: string }> {
    // Check if extension is allowed
    const room = await this.getBreakoutRoomById(breakoutId);
    if (!room) {
      return { success: false, error: 'Breakout room not found' };
    }

    if (room.extension_count >= room.max_extensions) {
      return { success: false, error: `Maximum extensions (${room.max_extensions}) reached` };
    }

    const result = await this.pool.query(`
      UPDATE breakout_rooms
      SET
        expires_at = expires_at + ($2::text || ' minutes')::interval,
        duration_minutes = duration_minutes + $2::integer,
        extension_count = extension_count + 1,
        warning_15min_sent = false,
        warning_5min_sent = false,
        warning_1min_sent = false
      WHERE id = $1::integer
      RETURNING expires_at
    `, [breakoutId, additionalMinutes]);

    return {
      success: true,
      newExpiresAt: result.rows[0].expires_at
    };
  }

  /**
   * Create manual annotation (!decision, !action, !park)
   */
  async createBreakoutAnnotation(data: {
    breakoutId: number;
    annotationType: string;
    content: string;
    createdByUuid?: string;
    createdByName?: string;
    assignedToUuid?: string;
    assignedToName?: string;
    dueDate?: Date;
  }): Promise<number> {
    const result = await this.pool.query(`
      INSERT INTO breakout_annotations (
        breakout_id, annotation_type, content, created_by_uuid, created_by_name,
        assigned_to_uuid, assigned_to_name, due_date, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')
      RETURNING id
    `, [
      data.breakoutId,
      data.annotationType,
      data.content,
      data.createdByUuid || null,
      data.createdByName || null,
      data.assignedToUuid || null,
      data.assignedToName || null,
      data.dueDate || null
    ]);

    return result.rows[0].id;
  }

  /**
   * Get annotations for a breakout room
   */
  async getBreakoutAnnotations(breakoutId: number, type?: string): Promise<any[]> {
    let sql = 'SELECT * FROM breakout_annotations WHERE breakout_id = $1';
    const params: any[] = [breakoutId];

    if (type) {
      sql += ' AND annotation_type = $2';
      params.push(type);
    }

    sql += ' ORDER BY created_at ASC';

    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  /**
   * Update breakout annotation status
   */
  async updateBreakoutAnnotationStatus(annotationId: number, status: 'open' | 'done' | 'cancelled'): Promise<void> {
    await this.pool.query(
      'UPDATE breakout_annotations SET status = $1 WHERE id = $2',
      [status, annotationId]
    );
  }

  /**
   * End breakout room with summary data
   */
  async endBreakoutRoom(breakoutId: number, summaryData?: {
    executiveSummary?: string;
    detailedSummary?: string;
    summaryConfidenceScore?: number;
    decisionsJson?: any[];
    actionItemsJson?: any[];
    openQuestionsJson?: any[];
    parkingLotJson?: any[];
    keyInsightsJson?: any[];
    resourcesSharedJson?: any[];
  }): Promise<void> {
    let sql = `
      UPDATE breakout_rooms
      SET
        status = 'ended',
        ended_at = NOW(),
        actual_duration_minutes = EXTRACT(EPOCH FROM (NOW() - created_at)) / 60
    `;
    const params: any[] = [];
    let paramIndex = 1;

    if (summaryData) {
      if (summaryData.executiveSummary) {
        sql += `, executive_summary = $${paramIndex++}`;
        params.push(summaryData.executiveSummary);
      }
      if (summaryData.detailedSummary) {
        sql += `, detailed_summary = $${paramIndex++}`;
        params.push(summaryData.detailedSummary);
      }
      if (summaryData.summaryConfidenceScore !== undefined) {
        sql += `, summary_confidence_score = $${paramIndex++}`;
        params.push(summaryData.summaryConfidenceScore);
      }
      if (summaryData.decisionsJson) {
        sql += `, decisions_json = $${paramIndex++}`;
        params.push(JSON.stringify(summaryData.decisionsJson));
      }
      if (summaryData.actionItemsJson) {
        sql += `, action_items_json = $${paramIndex++}`;
        params.push(JSON.stringify(summaryData.actionItemsJson));
      }
      if (summaryData.openQuestionsJson) {
        sql += `, open_questions_json = $${paramIndex++}`;
        params.push(JSON.stringify(summaryData.openQuestionsJson));
      }
      if (summaryData.parkingLotJson) {
        sql += `, parking_lot_json = $${paramIndex++}`;
        params.push(JSON.stringify(summaryData.parkingLotJson));
      }
      if (summaryData.keyInsightsJson) {
        sql += `, key_insights_json = $${paramIndex++}`;
        params.push(JSON.stringify(summaryData.keyInsightsJson));
      }
      if (summaryData.resourcesSharedJson) {
        sql += `, resources_shared_json = $${paramIndex++}`;
        params.push(JSON.stringify(summaryData.resourcesSharedJson));
      }
      sql += `, summary_generated_at = NOW()`;
    }

    sql += ` WHERE id = $${paramIndex}`;
    params.push(breakoutId);

    await this.pool.query(sql, params);
  }

  /**
   * Update Discourse integration info
   */
  async updateBreakoutDiscourse(breakoutId: number, data: {
    discourseTopicId: number;
    discourseTopicUrl: string;
  }): Promise<void> {
    await this.pool.query(`
      UPDATE breakout_rooms
      SET
        discourse_topic_id = $1,
        discourse_topic_url = $2,
        posted_to_discourse_at = NOW()
      WHERE id = $3
    `, [data.discourseTopicId, data.discourseTopicUrl, breakoutId]);
  }

  /**
   * Update Discourse post (e.g., when summary is added)
   */
  async markBreakoutDiscourseUpdated(breakoutId: number): Promise<void> {
    await this.pool.query(`
      UPDATE breakout_rooms
      SET discourse_post_updated_at = NOW()
      WHERE id = $1
    `, [breakoutId]);
  }

  /**
   * Update AI analysis on messages
   */
  async updateBreakoutMessageAnalysis(messageId: number, analysis: {
    isDecision?: boolean;
    isActionItem?: boolean;
    isQuestion?: boolean;
    extractedEntities?: any;
  }): Promise<void> {
    await this.pool.query(`
      UPDATE breakout_room_messages
      SET
        is_decision = COALESCE($2, is_decision),
        is_action_item = COALESCE($3, is_action_item),
        is_question = COALESCE($4, is_question),
        extracted_entities = COALESCE($5, extracted_entities)
      WHERE id = $1
    `, [
      messageId,
      analysis.isDecision || null,
      analysis.isActionItem || null,
      analysis.isQuestion || null,
      analysis.extractedEntities ? JSON.stringify(analysis.extractedEntities) : null
    ]);
  }

  /**
   * Post breakout summary to Discourse
   * @param breakoutId - The ID of the breakout room
   * @param richReport - Optional pre-generated rich report content (from AI analyzer)
   */
  async postBreakoutToDiscourse(breakoutId: number, richReport?: string): Promise<{
    success: boolean;
    topicId?: number;
    topicUrl?: string;
    error?: string;
  }> {
    try {
      // Get breakout room with all data
      const room = await this.getBreakoutRoomById(breakoutId);
      if (!room) {
        return { success: false, error: 'Breakout room not found' };
      }

      // Check Discourse configuration
      const discourseUrl = process.env.DISCOURSE_URL || process.env.DISCOURSE_API_URL;
      const discourseApiKey = process.env.DISCOURSE_API_KEY;
      const discourseUsername = process.env.DISCOURSE_USERNAME || process.env.DISCOURSE_API_USERNAME;
      const discourseCategory = process.env.DISCOURSE_BREAKOUT_CATEGORY || process.env.DISCOURSE_QA_CATEGORY || '1';

      if (!discourseUrl || !discourseApiKey || !discourseUsername) {
        return { success: false, error: 'Discourse not configured' };
      }

      // Use rich report if provided, otherwise build legacy post
      let postBody: string;
      if (richReport) {
        postBody = richReport;
      } else {
        // Legacy fallback: build post from database data
        const members = await this.getBreakoutMembers(breakoutId);
        const annotations = await this.getBreakoutAnnotations(breakoutId);
        postBody = this.buildBreakoutDiscoursePost(room, members, annotations);
      }

      // Build the Discourse post
      const title = `Breakout: ${sanitizeForDiscourse(room.topic)}`;

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
          category: parseInt(discourseCategory),
          tags: ['breakout', room.room_type || 'general', room.status],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Discourse API error:', response.status, errorText);
        return { success: false, error: `Discourse API error: ${response.status}` };
      }

      const result = await response.json() as any;
      const topicId = result.topic_id;
      const topicUrl = topicId ? `${discourseUrl.replace(/\/$/, '')}/t/${topicId}` : undefined;

      // Update breakout with Discourse info
      if (topicId) {
        await this.updateBreakoutDiscourse(breakoutId, {
          discourseTopicId: topicId,
          discourseTopicUrl: topicUrl!,
        });
      }

      return { success: true, topicId, topicUrl };

    } catch (error) {
      console.error('Error posting breakout to Discourse:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Build Discourse post content for breakout room
   */
  private buildBreakoutDiscoursePost(room: any, members: any[], annotations: any[]): string {
    const formatDate = (d: any) => d ? new Date(d).toLocaleString() : 'N/A';

    let post = `# ${sanitizeForDiscourse(room.topic)}\n\n`;

    // Meeting metadata
    post += `## Meeting Details\n\n`;
    post += `| Field | Value |\n`;
    post += `|-------|-------|\n`;
    post += `| **Type** | ${sanitizeForDiscourse(room.room_type || 'general')} |\n`;
    post += `| **Parent Group** | ${sanitizeForDiscourse(room.parent_group_name || room.parent_group_id)} |\n`;
    post += `| **Created By** | ${sanitizeForDiscourse(room.creator_name || 'Unknown')} |\n`;
    post += `| **Started** | ${formatDate(room.created_at)} |\n`;
    post += `| **Ended** | ${formatDate(room.ended_at)} |\n`;
    post += `| **Duration** | ${room.actual_duration_minutes || room.duration_minutes} minutes |\n`;
    post += `| **Messages** | ${room.total_messages || 0} |\n`;
    post += `| **Participants** | ${room.unique_participants || members.length} |\n\n`;

    // Executive Summary
    if (room.executive_summary) {
      post += `## Executive Summary\n\n`;
      post += `${sanitizeForDiscourse(room.executive_summary)}\n\n`;
    }

    // Participants
    if (members.length > 0) {
      post += `## Participants\n\n`;
      const activeMembers = members.filter(m => m.message_count > 0);
      const observers = members.filter(m => m.message_count === 0);

      if (activeMembers.length > 0) {
        post += `**Active Contributors:**\n`;
        for (const m of activeMembers) {
          const role = m.role !== 'participant' ? ` (${m.role})` : '';
          post += `- ${sanitizeForDiscourse(m.member_name || 'Unknown')}${role} - ${m.message_count} messages\n`;
        }
        post += `\n`;
      }

      if (observers.length > 0) {
        post += `**Observers:** ${observers.map(m => sanitizeForDiscourse(m.member_name || 'Unknown')).join(', ')}\n\n`;
      }
    }

    // Decisions
    const decisions = annotations.filter(a => a.annotation_type === 'decision');
    const decisionsJson = room.decisions_json ? JSON.parse(room.decisions_json) : [];
    if (decisions.length > 0 || decisionsJson.length > 0) {
      post += `## Decisions Made\n\n`;
      for (const d of decisions) {
        post += `- ✅ ${sanitizeForDiscourse(d.content)}`;
        if (d.created_by_name) post += ` *(by ${sanitizeForDiscourse(d.created_by_name)})*`;
        post += `\n`;
      }
      for (const d of decisionsJson) {
        post += `- ✅ ${sanitizeForDiscourse(d.decision)}`;
        if (d.confidence) post += ` [${Math.round(d.confidence * 100)}% confidence]`;
        post += `\n`;
      }
      post += `\n`;
    }

    // Action Items
    const actions = annotations.filter(a => a.annotation_type === 'action');
    const actionsJson = room.action_items_json ? JSON.parse(room.action_items_json) : [];
    if (actions.length > 0 || actionsJson.length > 0) {
      post += `## Action Items\n\n`;
      for (const a of actions) {
        const assignee = a.assigned_to_name ? ` → ${sanitizeForDiscourse(a.assigned_to_name)}` : '';
        const due = a.due_date ? ` (due: ${new Date(a.due_date).toLocaleDateString()})` : '';
        post += `- [ ] ${sanitizeForDiscourse(a.content)}${assignee}${due}\n`;
      }
      for (const a of actionsJson) {
        const assignee = a.owner_name ? ` → ${sanitizeForDiscourse(a.owner_name)}` : '';
        const due = a.due_date ? ` (due: ${a.due_date})` : '';
        post += `- [ ] ${sanitizeForDiscourse(a.task)}${assignee}${due}\n`;
      }
      post += `\n`;
    }

    // Open Questions (not yet answered)
    const openQuestions = annotations.filter(a => a.annotation_type === 'question' && a.status !== 'answered');
    const questionsJson = room.open_questions_json ? JSON.parse(room.open_questions_json) : [];
    if (openQuestions.length > 0 || questionsJson.length > 0) {
      post += `## Open Questions\n\n`;
      for (const q of openQuestions) {
        post += `- ❓ ${sanitizeForDiscourse(q.content)}`;
        if (q.created_by_name) post += ` *(asked by ${sanitizeForDiscourse(q.created_by_name)})*`;
        post += `\n`;
      }
      for (const q of questionsJson) {
        post += `- ❓ ${sanitizeForDiscourse(q.question)}\n`;
      }
      post += `\n`;
    }

    // Answered Questions
    const answeredQuestions = annotations.filter(a => a.annotation_type === 'question' && a.status === 'answered');
    if (answeredQuestions.length > 0) {
      post += `## Answered Questions\n\n`;
      for (const q of answeredQuestions) {
        post += `- ✅ ${sanitizeForDiscourse(q.content)}`;
        if (q.answered_by_name) {
          post += ` *(answered by ${sanitizeForDiscourse(q.answered_by_name)})*`;
        }
        post += `\n`;
      }
      post += `\n`;
    }

    // Parking Lot
    const parked = annotations.filter(a => a.annotation_type === 'park');
    const parkedJson = room.parking_lot_json ? JSON.parse(room.parking_lot_json) : [];
    if (parked.length > 0 || parkedJson.length > 0) {
      post += `## Parking Lot\n\n`;
      for (const p of parked) {
        post += `- 🅿️ ${sanitizeForDiscourse(p.content)}\n`;
      }
      for (const p of parkedJson) {
        post += `- 🅿️ ${sanitizeForDiscourse(p.item)}\n`;
      }
      post += `\n`;
    }

    // Key Insights
    const insightsJson = room.key_insights_json ? JSON.parse(room.key_insights_json) : [];
    if (insightsJson.length > 0) {
      post += `## Key Insights\n\n`;
      for (const i of insightsJson) {
        post += `- 💡 ${sanitizeForDiscourse(i.insight)}\n`;
      }
      post += `\n`;
    }

    // Detailed Summary
    if (room.detailed_summary) {
      post += `## Detailed Summary\n\n`;
      post += `${sanitizeForDiscourse(room.detailed_summary)}\n\n`;
    }

    // Footer
    post += `---\n\n`;
    post += `*This breakout session report was auto-generated from Signal.*\n`;
    if (room.summary_confidence_score) {
      post += `*Summary confidence: ${Math.round(room.summary_confidence_score * 100)}%*\n`;
    }

    return post;
  }

  /**
   * Update breakout annotation as answered (for questions)
   * Links the !answer command to the question annotation in breakouts
   */
  async updateBreakoutAnnotationAnswered(
    annotationId: number,
    answererUuid: string,
    answererName?: string
  ): Promise<void> {
    await this.pool.query(
      `UPDATE breakout_annotations
       SET status = 'answered',
           answered_at = NOW(),
           answered_by_uuid = $2,
           answered_by_name = $3
       WHERE id = $1`,
      [annotationId, answererUuid, answererName]
    );
  }

  /**
   * Get breakout annotation by ID
   */
  async getBreakoutAnnotationById(annotationId: number): Promise<any | null> {
    const result = await this.pool.query(
      'SELECT * FROM breakout_annotations WHERE id = $1',
      [annotationId]
    );
    return result.rows[0] || null;
  }

  /**
   * Find question by breakout annotation ID
   * Used to link !answer back to the original question
   */
  async getQuestionByAnnotationId(annotationId: number): Promise<any | null> {
    const result = await this.pool.query(
      'SELECT * FROM q_and_a_questions WHERE annotation_id = $1',
      [annotationId]
    );
    return result.rows[0] || null;
  }

  // ============================================================================
  // GLOBAL TASK METHODS
  // ============================================================================

  /**
   * Create a new task
   */
  async createTask(data: {
    content: string;
    rawContent?: string;
    breakoutId?: number;
    groupId?: string;
    groupName?: string;
    createdByUuid: string;
    createdByName?: string;
    createdByPhone?: string;
    assignedToUuid?: string;
    assignedToName?: string;
    assignedToPhone?: string;
    priority?: string;
    dueDate?: Date;
    aiExtracted?: boolean;
    aiConfidence?: number;
    sourceMessageTimestamp?: number;
  }): Promise<{ id: number; content: string }> {
    const result = await this.pool.query(`
      INSERT INTO tasks (
        content, raw_content, breakout_id, group_id, group_name,
        created_by_uuid, created_by_name, created_by_phone,
        assigned_to_uuid, assigned_to_name, assigned_to_phone,
        priority, due_date, ai_extracted, ai_confidence, source_message_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING id, content
    `, [
      data.content,
      data.rawContent || null,
      data.breakoutId || null,
      data.groupId || null,
      data.groupName || null,
      data.createdByUuid,
      data.createdByName || null,
      data.createdByPhone || null,
      data.assignedToUuid || null,
      data.assignedToName || null,
      data.assignedToPhone || null,
      data.priority || 'normal',
      data.dueDate || null,
      data.aiExtracted || false,
      data.aiConfidence || null,
      data.sourceMessageTimestamp || null,
    ]);

    return result.rows[0];
  }

  /**
   * Get task by ID
   */
  async getTaskById(id: number): Promise<any | null> {
    const result = await this.pool.query(`
      SELECT * FROM tasks WHERE id = $1
    `, [id]);

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Update task status
   */
  async updateTaskStatus(
    id: number,
    status: 'open' | 'in_progress' | 'done' | 'cancelled' | 'blocked',
    completedByUuid?: string,
    completedByName?: string,
    completionNotes?: string
  ): Promise<boolean> {
    // Use explicit ::text casts to prevent "inconsistent types deduced for parameter $2" error
    const result = await this.pool.query(`
      UPDATE tasks
      SET status = $2::text,
          completed_at = CASE WHEN $2::text = 'done' THEN NOW() ELSE NULL END,
          completed_by_uuid = CASE WHEN $2::text = 'done' THEN $3 ELSE NULL END,
          completed_by_name = CASE WHEN $2::text = 'done' THEN $4 ELSE NULL END,
          completion_notes = CASE WHEN $2::text = 'done' THEN $5 ELSE completion_notes END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id
    `, [id, status, completedByUuid || null, completedByName || null, completionNotes || null]);

    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Mark task DM as sent
   */
  async markTaskDmSent(id: number): Promise<void> {
    await this.pool.query(`
      UPDATE tasks
      SET dm_sent_to_assignee = true, dm_sent_at = NOW()
      WHERE id = $1
    `, [id]);
  }

  /**
   * Get open tasks assigned to a user
   */
  async getOpenTasksByAssignee(assigneeUuid: string): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT t.*, g.name as group_display_name, b.topic as breakout_topic
      FROM tasks t
      LEFT JOIN signal_groups g ON t.group_id = g.id
      LEFT JOIN breakout_rooms b ON t.breakout_id = b.id
      WHERE t.assigned_to_uuid = $1
        AND t.status IN ('open', 'in_progress')
      ORDER BY
        CASE t.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END,
        t.due_date NULLS LAST,
        t.created_at DESC
    `, [assigneeUuid]);

    return result.rows;
  }

  /**
   * Get tasks created by a user
   */
  async getTasksByCreator(creatorUuid: string, limit: number = 20): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT t.*, g.name as group_display_name, b.topic as breakout_topic
      FROM tasks t
      LEFT JOIN signal_groups g ON t.group_id = g.id
      LEFT JOIN breakout_rooms b ON t.breakout_id = b.id
      WHERE t.created_by_uuid = $1
      ORDER BY t.created_at DESC
      LIMIT $2
    `, [creatorUuid, limit]);

    return result.rows;
  }

  /**
   * Get open tasks in a group
   */
  async getOpenTasksByGroup(groupId: string): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT t.*, b.topic as breakout_topic
      FROM tasks t
      LEFT JOIN breakout_rooms b ON t.breakout_id = b.id
      WHERE t.group_id = $1
        AND t.status IN ('open', 'in_progress')
      ORDER BY t.created_at DESC
    `, [groupId]);

    return result.rows;
  }

  /**
   * Find task by content match (for !complete command)
   */
  async findTaskByContent(
    searchText: string,
    assigneeUuid?: string,
    groupId?: string
  ): Promise<any | null> {
    let query = `
      SELECT * FROM tasks
      WHERE status IN ('open', 'in_progress')
        AND LOWER(content) LIKE $1
    `;
    const params: any[] = [`%${searchText.toLowerCase()}%`];

    if (assigneeUuid) {
      params.push(assigneeUuid);
      query += ` AND assigned_to_uuid = $${params.length}`;
    }

    if (groupId) {
      params.push(groupId);
      query += ` AND group_id = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT 1`;

    const result = await this.pool.query(query, params);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Get most recent open task assigned to user (for !complete without args)
   */
  async getMostRecentOpenTask(assigneeUuid: string, groupId?: string): Promise<any | null> {
    let query = `
      SELECT * FROM tasks
      WHERE assigned_to_uuid = $1
        AND status IN ('open', 'in_progress')
    `;
    const params: any[] = [assigneeUuid];

    if (groupId) {
      params.push(groupId);
      query += ` AND group_id = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT 1`;

    const result = await this.pool.query(query, params);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Update task priority
   */
  async updateTaskPriority(taskId: number, priority: string): Promise<void> {
    await this.pool.query(
      `UPDATE tasks SET priority = $2, updated_at = NOW() WHERE id = $1`,
      [taskId, priority]
    );
  }

  /**
   * Update task assignment
   */
  async updateTaskAssignment(
    taskId: number,
    assigneeUuid: string | null,
    assigneeName: string | null
  ): Promise<void> {
    await this.pool.query(
      `UPDATE tasks
       SET assigned_to_uuid = $2,
           assigned_to_name = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [taskId, assigneeUuid, assigneeName]
    );
  }

  // ============================================================================
  // TODAY I LEARNED (TIL) METHODS
  // ============================================================================

  /**
   * Create a new TIL entry
   */
  async createTil(data: {
    groupId: string;
    createdByUuid: string;
    createdByName?: string;
    originalMessages: string;
    aiSummary?: string;
    messageCount: number;
    totalCharacters: number;
    tags?: string[];
  }): Promise<number> {
    const result = await this.pool.query(`
      INSERT INTO today_i_learned (
        group_id, created_by_uuid, created_by_name, original_messages,
        ai_summary, message_count, total_characters, tags
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      data.groupId,
      data.createdByUuid,
      data.createdByName || null,
      data.originalMessages,
      data.aiSummary || null,
      data.messageCount,
      data.totalCharacters,
      data.tags || null
    ]);

    return result.rows[0].id;
  }

  /**
   * Get TILs for a group
   */
  async getTilsForGroup(groupId: string, limit: number = 10): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT * FROM today_i_learned
      WHERE group_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [groupId, limit]);

    return result.rows;
  }

  /**
   * Get a specific TIL by ID
   */
  async getTilById(id: number): Promise<any | null> {
    const result = await this.pool.query(`
      SELECT * FROM today_i_learned
      WHERE id = $1
    `, [id]);

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Get TILs by user
   */
  async getTilsByUser(userUuid: string, limit: number = 10): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT * FROM today_i_learned
      WHERE created_by_uuid = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [userUuid, limit]);

    return result.rows;
  }

  /**
   * Search TILs by content
   */
  async searchTils(groupId: string, searchTerm: string, limit: number = 10): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT * FROM today_i_learned
      WHERE group_id = $1
        AND (
          original_messages ILIKE $2
          OR ai_summary ILIKE $2
          OR $3 = ANY(tags)
        )
      ORDER BY created_at DESC
      LIMIT $4
    `, [groupId, `%${searchTerm}%`, searchTerm.toLowerCase(), limit]);

    return result.rows;
  }

  /**
   * Get TIL count for a group
   */
  async getTilCount(groupId: string): Promise<number> {
    const result = await this.pool.query(`
      SELECT COUNT(*) as count FROM today_i_learned
      WHERE group_id = $1
    `, [groupId]);

    return parseInt(result.rows[0]?.count || '0');
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
