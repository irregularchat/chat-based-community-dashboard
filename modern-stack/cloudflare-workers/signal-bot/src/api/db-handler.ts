/**
 * D1 Database Handler
 *
 * Provides database operations for the Signal bot container.
 * The container doesn't have direct D1 bindings, so it calls these endpoints.
 */

export interface Env {
  DB: D1Database;
}

export interface QueryRequest {
  sql: string;
  params?: any[];
}

export interface QueryResult {
  results: any[];
  success: boolean;
  meta?: {
    duration: number;
    rows_read: number;
    rows_written: number;
  };
}

/**
 * Execute a D1 query
 */
export async function handleQuery(request: Request, env: Env): Promise<Response> {
  try {
    // Parse request body
    const body: QueryRequest = await request.json();

    if (!body.sql) {
      return new Response(JSON.stringify({
        success: false,
        error: 'SQL query required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Execute query
    const startTime = Date.now();
    const stmt = env.DB.prepare(body.sql);

    // Bind parameters if provided
    if (body.params && body.params.length > 0) {
      stmt.bind(...body.params);
    }

    const result = await stmt.all();
    const duration = Date.now() - startTime;

    // Return results
    const response: QueryResult = {
      results: result.results || [],
      success: result.success,
      meta: {
        duration,
        rows_read: result.results?.length || 0,
        rows_written: result.meta?.changes || 0,
      }
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Response-Time': `${duration}ms`,
        'X-Rows-Read': String(response.meta?.rows_read || 0),
      }
    });

  } catch (error) {
    console.error('Database query error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Database error',
      details: error instanceof Error ? error.stack : undefined
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Execute a batch of D1 queries
 */
export async function handleBatch(request: Request, env: Env): Promise<Response> {
  try {
    // Parse request body
    const body: { queries: QueryRequest[] } = await request.json();

    if (!body.queries || !Array.isArray(body.queries)) {
      return new Response(JSON.stringify({
        success: false,
        error: 'queries array required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Execute batch
    const startTime = Date.now();
    const statements = body.queries.map(q => {
      const stmt = env.DB.prepare(q.sql);
      if (q.params && q.params.length > 0) {
        return stmt.bind(...q.params);
      }
      return stmt;
    });

    const results = await env.DB.batch(statements);
    const duration = Date.now() - startTime;

    // Return results
    return new Response(JSON.stringify({
      success: true,
      results: results.map((r, i) => ({
        results: r.results || [],
        success: r.success,
        meta: {
          rows_read: r.results?.length || 0,
          rows_written: r.meta?.changes || 0,
        }
      })),
      meta: {
        duration,
        total_queries: body.queries.length,
      }
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Response-Time': `${duration}ms`,
      }
    });

  } catch (error) {
    console.error('Database batch error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Database error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Get database stats
 */
export async function handleStats(request: Request, env: Env): Promise<Response> {
  try {
    // Get table counts
    const tables = [
      'signal_messages',
      'signal_groups',
      'signal_contacts',
      'bot_command_usage',
      'bot_errors',
      'q_and_a_questions',
      'news_links',
    ];

    const counts: Record<string, number> = {};

    for (const table of tables) {
      try {
        const result = await env.DB.prepare(
          `SELECT COUNT(*) as count FROM ${table}`
        ).first();
        counts[table] = result?.count as number || 0;
      } catch (e) {
        counts[table] = -1; // Table doesn't exist or error
      }
    }

    return new Response(JSON.stringify({
      success: true,
      tables: counts,
      timestamp: new Date().toISOString(),
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Database stats error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Database error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
