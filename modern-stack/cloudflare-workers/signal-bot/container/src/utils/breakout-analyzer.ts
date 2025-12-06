/**
 * Breakout Room AI Analyzer
 *
 * Extracts structured data from conversation history using GPT.
 * Returns decisions, action items, insights, questions with confidence scores.
 *
 * Phase 3 of Breakout Room Implementation
 */

import OpenAI from 'openai';

// =================================================================================
// Interfaces
// =================================================================================

/**
 * Raw message data from the database.
 */
export interface RawMessage {
  id: number;
  sender_name: string;
  message_text: string;
  timestamp: string;
}

/**
 * Raw annotation data from the database.
 */
export interface RawAnnotation {
  id: number;
  annotation_type: 'decision' | 'action' | 'question' | 'park';
  content: string;
  created_by_name: string;
  assigned_to_name?: string;
  status?: 'open' | 'answered';
}

/**
 * Represents a decision made during the session.
 */
export interface Decision {
  decision: string;
  confidence: number;
  made_by: string;
}

/**
 * Represents an action item to be completed.
 */
export interface ActionItem {
  task: string;
  owner_name: string;
  due_date?: string;
  confidence: number;
}

/**
 * Represents an open question that was not answered.
 */
export interface OpenQuestion {
  question: string;
  asked_by: string;
  answered: boolean;
}

/**
 * Represents a topic for future discussion.
 */
export interface ParkingLotItem {
  item: string;
  suggested_by: string;
}

/**
 * Represents a key insight or takeaway.
 */
export interface KeyInsight {
  insight: string;
}

/**
 * Notable quote from the discussion
 */
export interface NotableQuote {
  quote: string;
  speaker: string;
}

/**
 * Structured analysis of the breakout session.
 */
export interface BreakoutAnalysis {
  executive_summary: string;
  detailed_summary: string;
  discussion_topics?: string[];
  notable_quotes?: NotableQuote[];
  decisions: Decision[];
  action_items: ActionItem[];
  open_questions: OpenQuestion[];
  parking_lot: ParkingLotItem[];
  key_insights: KeyInsight[];
  summary_confidence_score: number;
}

// =================================================================================
// Analysis Functions
// =================================================================================

/**
 * Analyzes a transcript of messages to produce a structured summary.
 * @param transcript - A string containing the conversation transcript.
 * @param openai - An initialized OpenAI client.
 * @param roomContext - Optional context about the room (topic, type, etc.)
 * @returns A promise that resolves to a BreakoutAnalysis object.
 */
export async function analyzeTranscript(
  transcript: string,
  openai: OpenAI,
  roomContext?: { topic?: string; roomType?: string; participantCount?: number }
): Promise<BreakoutAnalysis> {
  const contextInfo = roomContext
    ? `\nContext:\n- Topic: ${roomContext.topic || 'General Discussion'}\n- Type: ${roomContext.roomType || 'general'}\n- Participants: ${roomContext.participantCount || 'unknown'}`
    : '';

  const systemPrompt = `You are an expert meeting analyst. Your task is to analyze the provided meeting transcript and extract key information in a structured JSON format.
${contextInfo}

The JSON output should strictly adhere to the following schema:
{
  "executive_summary": "A 1-2 sentence summary capturing the MAIN PURPOSE and OUTCOME of the meeting.",
  "detailed_summary": "A 3-5 sentence narrative paragraph describing: (1) what the group discussed, (2) any conclusions or agreements reached, (3) how the conversation progressed. Write this as a readable story, not a list of metadata.",
  "discussion_topics": [
    "Topic 1 that was discussed",
    "Topic 2 that was discussed"
  ],
  "notable_quotes": [
    {
      "quote": "An interesting or important quote from the discussion",
      "speaker": "Name of who said it"
    }
  ],
  "decisions": [
    {
      "decision": "A specific decision that was made.",
      "confidence": 0.9,
      "made_by": "Name of the person who made or confirmed the decision."
    }
  ],
  "action_items": [
    {
      "task": "A specific task to be done.",
      "owner_name": "Name of the person responsible.",
      "due_date": "YYYY-MM-DD (if mentioned, otherwise null)",
      "confidence": 0.85
    }
  ],
  "open_questions": [
    {
      "question": "A question that was asked but not fully answered.",
      "asked_by": "Name of the person who asked.",
      "answered": false
    }
  ],
  "parking_lot": [
    {
      "item": "A topic to be discussed later.",
      "suggested_by": "Name of the person who suggested it."
    }
  ],
  "key_insights": [
    { "insight": "A key takeaway, realization, or important point made during the discussion." }
  ],
  "summary_confidence_score": 0.95
}

IMPORTANT RULES:
1. **Strict JSON:** The output must be a single, valid JSON object. Do not include any text before or after the JSON.
2. **Schema Adherence:** Every key and data type must match the schema exactly.
3. **Content Extraction:** Fill the JSON fields by extracting relevant information from the transcript. If no information is found for a field, return an empty array.
4. **Summaries are CRITICAL:** The detailed_summary should read like a short meeting report - describe WHAT was discussed, not just statistics. Example: "The team discussed implementing a new authentication system. Sac proposed using OAuth2 while Jon suggested JWT tokens. After some debate, they agreed to prototype both approaches."
5. **Discussion Topics:** Extract 3-5 main topics that were actually discussed, even in casual conversation.
6. **Notable Quotes:** Include 1-3 interesting, insightful, or important quotes that capture the essence of the discussion.
7. **Key Insights:** Extract any important realizations, observations, or learnings shared during the conversation.
8. **Attribution:** Attribute items to the person who spoke them, using their name as it appears in the transcript.
9. **Confidence Score:** Provide scores (0.0 to 1.0) indicating how certain you are about extractions.

DETECTION PATTERNS:
- Decisions: Look for "let's", "we decided", "agreed", "we'll do", "final answer", consensus statements
- Action Items: Look for "@person will", "I'll handle", "needs to be done", "todo:", ownership statements
- Open Questions: Look for "?", "not sure", "need to figure out", "TBD", unresolved items
- Key Insights: Look for important observations, novel ideas, key data points, "the key thing is", "importantly", "I learned", "TIL"
- Discussion Topics: Identify the main subjects being talked about, even casual topics`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze the following transcript:\n\n${transcript}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 2000,
    });

    const jsonContent = response.choices[0]?.message?.content;

    if (!jsonContent) {
      throw new Error('AI returned no content.');
    }

    const analysis: BreakoutAnalysis = JSON.parse(jsonContent);

    // Basic validation to ensure the parsed object looks correct
    if (!analysis.executive_summary || !Array.isArray(analysis.decisions)) {
      throw new Error('Parsed JSON does not match the expected schema.');
    }

    return analysis;
  } catch (error) {
    console.error('Failed to analyze transcript:', error);
    throw error;
  }
}

/**
 * Creates a minimal analysis object from raw annotations, to be used when AI analysis fails.
 * @param annotations - Array of raw annotation data from the database.
 * @returns A partial BreakoutAnalysis object.
 */
export function createMinimalAnalysis(annotations: RawAnnotation[]): BreakoutAnalysis {
  const analysis: BreakoutAnalysis = {
    executive_summary: 'Summary could not be generated automatically.',
    detailed_summary: 'AI analysis was not available. Manual annotations are shown below.',
    decisions: [],
    action_items: [],
    open_questions: [],
    parking_lot: [],
    key_insights: [],
    summary_confidence_score: 0.0,
  };

  for (const anno of annotations) {
    switch (anno.annotation_type) {
      case 'decision':
        analysis.decisions.push({
          decision: anno.content,
          made_by: anno.created_by_name,
          confidence: 1.0, // Manually added, so confidence is 100%
        });
        break;
      case 'action':
        analysis.action_items.push({
          task: anno.content,
          owner_name: anno.assigned_to_name || anno.created_by_name,
          confidence: 1.0,
        });
        break;
      case 'question':
        analysis.open_questions.push({
          question: anno.content,
          asked_by: anno.created_by_name,
          answered: anno.status === 'answered',
        });
        break;
      case 'park':
        analysis.parking_lot.push({
          item: anno.content,
          suggested_by: anno.created_by_name,
        });
        break;
    }
  }

  return analysis;
}

/**
 * Merges the AI-generated analysis with manual annotations to ensure nothing is missed.
 * Manual annotations are treated as the source of truth (100% confidence).
 * @param aiAnalysis - The analysis object generated by the AI.
 * @param manualAnnotations - Raw annotations from the database.
 * @returns A merged and enriched BreakoutAnalysis object.
 */
export function mergeWithManualAnnotations(
  aiAnalysis: BreakoutAnalysis,
  manualAnnotations: RawAnnotation[]
): BreakoutAnalysis {
  // Create a Set for quick lookups of manually annotated content (lowercase for comparison)
  const manualContent = new Set(manualAnnotations.map(a => a.content.toLowerCase().trim()));

  // Filter out any AI-generated items that are duplicates of manual annotations
  aiAnalysis.decisions = aiAnalysis.decisions.filter(
    d => !manualContent.has(d.decision.toLowerCase().trim())
  );
  aiAnalysis.action_items = aiAnalysis.action_items.filter(
    a => !manualContent.has(a.task.toLowerCase().trim())
  );
  aiAnalysis.open_questions = aiAnalysis.open_questions.filter(
    q => !manualContent.has(q.question.toLowerCase().trim())
  );
  aiAnalysis.parking_lot = aiAnalysis.parking_lot.filter(
    p => !manualContent.has(p.item.toLowerCase().trim())
  );

  // Add the manual annotations (they take priority with 100% confidence)
  for (const anno of manualAnnotations) {
    switch (anno.annotation_type) {
      case 'decision':
        aiAnalysis.decisions.unshift({
          decision: anno.content,
          made_by: anno.created_by_name,
          confidence: 1.0,
        });
        break;
      case 'action':
        aiAnalysis.action_items.unshift({
          task: anno.content,
          owner_name: anno.assigned_to_name || anno.created_by_name || 'Unassigned',
          confidence: 1.0,
        });
        break;
      case 'question':
        aiAnalysis.open_questions.unshift({
          question: anno.content,
          asked_by: anno.created_by_name,
          answered: anno.status === 'answered',
        });
        break;
      case 'park':
        aiAnalysis.parking_lot.unshift({
          item: anno.content,
          suggested_by: anno.created_by_name,
        });
        break;
    }
  }

  return aiAnalysis;
}

/**
 * Converts raw messages from database to a transcript string for AI analysis.
 * @param messages - An array of RawMessage objects.
 * @returns A formatted string transcript.
 */
export function convertMessagesToTranscript(messages: RawMessage[]): string {
  if (messages.length === 0) {
    return '';
  }

  return messages
    .map(msg => `${msg.sender_name || 'Unknown'}: ${msg.message_text}`)
    .join('\n');
}

/**
 * Generates a rich Discourse-formatted report from the analysis.
 * @param analysis - The BreakoutAnalysis object.
 * @param roomInfo - Information about the breakout room.
 * @param participants - List of participants with their message counts.
 * @returns A markdown-formatted string for Discourse posting.
 */
export function generateDiscourseReport(
  analysis: BreakoutAnalysis,
  roomInfo: {
    topic: string;
    roomType: string;
    roomTypeIcon: string;
    roomTypeName: string;
    parentGroupName?: string;
    facilitatorName?: string;
    duration: number;
    actualDuration?: number;
    startTime: Date;
    endTime: Date;
    totalMessages: number;
  },
  participants: Array<{ name: string; messageCount: number; role: string }>,
  conversationHighlights?: string[],
  resources?: Array<{ url: string; shared_by: string; context: string; shared_at: string }>
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${roomInfo.roomTypeIcon} Breakout: ${roomInfo.topic}`);
  lines.push('');
  lines.push(`> **TL;DR:** ${analysis.executive_summary}`);
  lines.push('');

  // Discussion Summary - RIGHT AFTER TL;DR for prominence
  if (analysis.detailed_summary && !analysis.detailed_summary.includes('AI analysis was not available')) {
    lines.push('## Discussion Summary');
    lines.push('');
    lines.push(analysis.detailed_summary);
    lines.push('');
  }

  // Topics Discussed (from AI analysis)
  if (analysis.discussion_topics && analysis.discussion_topics.length > 0) {
    lines.push('## Topics Discussed');
    lines.push('');
    for (const topic of analysis.discussion_topics) {
      lines.push(`- ${topic}`);
    }
    lines.push('');
  }

  // Key Insights - Show early if available
  if (analysis.key_insights.length > 0) {
    lines.push('## Key Takeaways');
    lines.push('');
    for (let i = 0; i < analysis.key_insights.length; i++) {
      lines.push(`${i + 1}. ${analysis.key_insights[i].insight}`);
    }
    lines.push('');
  }

  // Notable Quotes (from AI analysis)
  if (analysis.notable_quotes && analysis.notable_quotes.length > 0) {
    lines.push('## Notable Quotes');
    lines.push('');
    for (const q of analysis.notable_quotes) {
      lines.push(`> "${q.quote}"`);
      lines.push(`> — *${q.speaker}*`);
      lines.push('');
    }
  }

  // Conversation Highlights (if provided)
  if (conversationHighlights && conversationHighlights.length > 0) {
    lines.push('## Discussion Highlights');
    lines.push('');
    for (const highlight of conversationHighlights) {
      lines.push(`> ${highlight}`);
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');

  // Session Overview
  lines.push('## Session Overview');
  lines.push('');
  lines.push('| Attribute | Value |');
  lines.push('|-----------|-------|');
  lines.push(`| **Type** | ${roomInfo.roomTypeName} |`);
  lines.push(`| **Duration** | ${roomInfo.startTime.toLocaleTimeString()} → ${roomInfo.endTime.toLocaleTimeString()} (${roomInfo.actualDuration || roomInfo.duration} minutes) |`);
  if (roomInfo.parentGroupName) {
    lines.push(`| **Parent Channel** | ${roomInfo.parentGroupName} |`);
  }
  if (roomInfo.facilitatorName) {
    lines.push(`| **Facilitated By** | ${roomInfo.facilitatorName} |`);
  }
  lines.push(`| **Messages** | ${roomInfo.totalMessages} |`);
  lines.push('');

  // Participants
  if (participants.length > 0) {
    lines.push(`### Participants (${participants.length})`);
    lines.push('');
    lines.push('| Participant | Contributions | Role |');
    lines.push('|-------------|---------------|------|');
    for (const p of participants.sort((a, b) => b.messageCount - a.messageCount)) {
      const roleIcon = p.role === 'creator' ? ' :crown:' : p.role === 'facilitator' ? ' :handshake:' : '';
      lines.push(`| ${p.name}${roleIcon} | ${p.messageCount} messages | ${p.role} |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Decisions
  if (analysis.decisions.length > 0) {
    lines.push(`## Decisions Made (${analysis.decisions.length})`);
    lines.push('');
    for (let i = 0; i < analysis.decisions.length; i++) {
      const d = analysis.decisions[i];
      const confidencePercent = Math.round(d.confidence * 100);
      const confidenceLabel = d.confidence >= 0.8 ? 'High' : d.confidence >= 0.5 ? 'Medium' : 'Low';
      lines.push(`### ${i + 1}. ${d.decision.substring(0, 80)}${d.decision.length > 80 ? '...' : ''}`);
      lines.push('');
      lines.push(`**Decision:** ${d.decision}`);
      lines.push('');
      lines.push(`**Decided By:** ${d.made_by}`);
      lines.push('');
      lines.push(`**Confidence:** ${confidenceLabel} (${confidencePercent}%)`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  // Action Items
  if (analysis.action_items.length > 0) {
    lines.push(`## Action Items (${analysis.action_items.length})`);
    lines.push('');
    lines.push('| # | Task | Owner | Due | Status |');
    lines.push('|---|------|-------|-----|--------|');
    for (let i = 0; i < analysis.action_items.length; i++) {
      const a = analysis.action_items[i];
      const status = ':hourglass: Pending';
      lines.push(`| ${i + 1} | ${a.task} | @${a.owner_name} | ${a.due_date || 'TBD'} | ${status} |`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Open Questions
  if (analysis.open_questions.length > 0) {
    lines.push('## Open Questions');
    lines.push('');
    lines.push('Items needing further research or decision:');
    lines.push('');
    for (const q of analysis.open_questions) {
      const status = q.answered ? ':white_check_mark:' : ':question:';
      lines.push(`- ${status} ${q.question} - *asked by ${q.asked_by}*`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Parking Lot
  if (analysis.parking_lot.length > 0) {
    lines.push('## Parking Lot');
    lines.push('');
    lines.push('Topics raised but deferred for later discussion:');
    lines.push('');
    for (const p of analysis.parking_lot) {
      lines.push(`- ${p.item} *(raised by ${p.suggested_by})*`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Resources Shared
  if (resources && resources.length > 0) {
    lines.push('## Resources Shared');
    lines.push('');
    lines.push('Links and references shared during the discussion:');
    lines.push('');
    lines.push('| Link | Shared By | Context |');
    lines.push('|------|-----------|---------|');
    for (const r of resources) {
      const contextSnippet = r.context.length > 60 ? r.context.substring(0, 60) + '...' : r.context;
      lines.push(`| [${r.url}](${r.url}) | ${r.shared_by} | "${contextSnippet}" |`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Footer
  lines.push('<small>');
  lines.push('');
  lines.push(`**Report generated:** ${new Date().toLocaleString()}`);
  lines.push(`**AI Confidence Score:** ${Math.round(analysis.summary_confidence_score * 100)}%`);
  lines.push('');
  lines.push('*This report was auto-generated from Signal by IrregularChat Bot*');
  lines.push('');
  lines.push('</small>');

  return lines.join('\n');
}
