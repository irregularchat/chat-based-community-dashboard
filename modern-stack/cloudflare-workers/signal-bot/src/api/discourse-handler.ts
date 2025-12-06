/**
 * Discourse API Handler
 *
 * Posts solved Q&A questions to Discourse forum for knowledge management
 */

export interface Env {
  DB: D1Database;
  DISCOURSE_URL?: string;
  DISCOURSE_API_KEY?: string;
  DISCOURSE_USERNAME?: string;
  DISCOURSE_QA_CATEGORY?: string;
}

export interface PostQuestionRequest {
  questionId: number;
}

export interface PostQuestionResponse {
  success: boolean;
  topicId?: string;
  topicUrl?: string;
  error?: string;
}

/**
 * List all Q&A questions from database
 */
export async function handleListQuestions(request: Request, env: Env): Promise<Response> {
  try {
    // Get query parameters
    const url = new URL(request.url);
    const status = url.searchParams.get('status'); // 'open', 'solved', 'all'
    const limit = parseInt(url.searchParams.get('limit') || '100');
    const offset = parseInt(url.searchParams.get('offset') || '0');

    // Build query based on status filter
    let query = 'SELECT * FROM q_and_a_questions';
    const params: any[] = [];

    if (status === 'open') {
      query += ' WHERE is_solved = 0';
    } else if (status === 'solved') {
      query += ' WHERE is_solved = 1';
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    // Execute query
    const result = await env.DB.prepare(query).bind(...params).all();

    // Get answer counts for each question
    const questions = result.results || [];
    const questionsWithCounts = await Promise.all(
      questions.map(async (q: any) => {
        const answerCount = await env.DB.prepare(
          'SELECT COUNT(*) as count FROM q_and_a_answers WHERE question_id = ?'
        ).bind(q.question_id).first();

        return {
          ...q,
          answer_count: answerCount?.count || 0
        };
      })
    );

    return new Response(JSON.stringify({
      success: true,
      questions: questionsWithCounts,
      total: questionsWithCounts.length,
      offset,
      limit
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('List questions error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Post a solved question to Discourse
 */
export async function handlePostQuestion(request: Request, env: Env): Promise<Response> {
  try {
    // Check Discourse configuration
    if (!env.DISCOURSE_URL || !env.DISCOURSE_API_KEY || !env.DISCOURSE_USERNAME) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Discourse not configured (missing URL, API key, or username)'
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Parse request
    const body: PostQuestionRequest = await request.json();

    if (!body.questionId) {
      return new Response(JSON.stringify({
        success: false,
        error: 'questionId required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get question and answers from database
    const question = await env.DB.prepare(
      'SELECT * FROM q_and_a_questions WHERE question_id = ?'
    ).bind(body.questionId).first();

    if (!question) {
      return new Response(JSON.stringify({
        success: false,
        error: `Question #${body.questionId} not found`
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get all answers
    const answersResult = await env.DB.prepare(
      'SELECT * FROM q_and_a_answers WHERE question_id = ? ORDER BY is_solution DESC, timestamp ASC'
    ).bind(body.questionId).all();

    const answers = answersResult.results || [];

    // Build Discourse post content
    const title = (question.title as string) || `Question #${body.questionId}`;
    const category = env.DISCOURSE_QA_CATEGORY || '1'; // Default to category 1

    // Format post body
    let postBody = `# ${question.question}\n\n`;
    postBody += `**Asked by**: ${question.asker}\n`;
    postBody += `**Asked**: ${new Date((question.timestamp as number) * 1000).toLocaleString()}\n`;
    postBody += `**Signal Group**: ${question.group_name || question.group_id}\n\n`;
    postBody += `---\n\n`;

    if (answers.length > 0) {
      postBody += `## Answers\n\n`;

      for (const answer of answers) {
        const isSolution = answer.is_solution === 1;
        const solutionMark = isSolution ? ' ✅ **SOLUTION**' : '';

        postBody += `### Answer #${answer.answer_id}${solutionMark}\n\n`;
        postBody += `**By**: ${answer.answerer}\n`;
        postBody += `**Posted**: ${new Date((answer.timestamp as number) * 1000).toLocaleString()}\n\n`;
        postBody += `${answer.answer}\n\n`;
        postBody += `---\n\n`;
      }
    } else {
      postBody += `*No answers yet.*\n\n`;
    }

    postBody += `\n\n*This question was posted from Signal and marked as solved.*`;

    // Post to Discourse
    const discourseUrl = env.DISCOURSE_URL.replace(/\/$/, ''); // Remove trailing slash
    const createTopicUrl = `${discourseUrl}/posts.json`;

    const discourseResponse = await fetch(createTopicUrl, {
      method: 'POST',
      headers: {
        'Api-Key': env.DISCOURSE_API_KEY,
        'Api-Username': env.DISCOURSE_USERNAME,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        raw: postBody,
        category,
        tags: ['signal-qa', 'solved'],
      }),
    });

    if (!discourseResponse.ok) {
      const errorText = await discourseResponse.text();
      console.error('Discourse API error:', discourseResponse.status, errorText);

      return new Response(JSON.stringify({
        success: false,
        error: `Discourse API error: ${discourseResponse.status} ${discourseResponse.statusText}`,
        details: errorText,
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const discourseResult = await discourseResponse.json() as any;
    const topicId = discourseResult.topic_id?.toString();
    const topicUrl = topicId ? `${discourseUrl}/t/${topicId}` : undefined;

    // Update question with Discourse topic ID
    if (topicId) {
      await env.DB.prepare(
        'UPDATE q_and_a_questions SET discourse_topic_id = ?, forum_link = ? WHERE question_id = ?'
      ).bind(topicId, topicUrl, body.questionId).run();
    }

    return new Response(JSON.stringify({
      success: true,
      topicId,
      topicUrl,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Discourse handler error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
