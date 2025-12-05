import OpenAI from 'openai';

// =================================================================================
// Interfaces
// =================================================================================

/**
 * Raw message data from the database.
 */
interface RawMessage {
  id: number;
  sender_name: string;
  message_text: string;
  timestamp: string;
}

/**
 * Raw annotation data from the database.
 */
interface RawAnnotation {
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
  answered: boolean; // True if an answer was provided during the session
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
 * Structured analysis of the breakout session.
 */
export interface BreakoutAnalysis {
  executive_summary: string;
  detailed_summary: string;
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
 * @returns A promise that resolves to a BreakoutAnalysis object.
 */
export async function analyzeTranscript(
  transcript: string,
  openai: OpenAI
): Promise<BreakoutAnalysis> {
  const systemPrompt = `
You are an expert meeting analyst. Your task is to analyze the provided meeting transcript and extract key information in a structured JSON format.

The JSON output should strictly adhere to the following schema:
{
  "executive_summary": "A 1-2 sentence summary of the entire meeting.",
  "detailed_summary": "A 3-5 sentence paragraph detailing the main discussion points.",
  "decisions": [
    {
      "decision": "A specific decision that was made.",
      "confidence": 0.9,
      "made_by": "Name of the person who made the decision."
    }
  ],
  "action_items": [
    {
      "task": "A specific task to be done.",
      "owner_name": "Name of the person responsible.",
      "due_date": "YYYY-MM-DD (if mentioned)",
      "confidence": 0.85
    }
  ],
  "open_questions": [
    {
      "question": "A question that was asked but not answered.",
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
    { "insight": "A key takeaway or important realization." }
  ],
  "summary_confidence_score": 0.95
}

IMPORTANT RULES:
1.  **Strict JSON:** The output must be a single, valid JSON object. Do not include any text before or after the JSON.
2.  **Schema Adherence:** Every key and data type must match the schema exactly.
3.  **Content Extraction:** Fill the JSON fields by extracting relevant information from the transcript. If no information is found for a field (e.g., no decisions were made), return an empty array for that field.
4.  **Confidence Score:** For \`decisions\` and \`action_items\`, provide a confidence score (0.0 to 1.0) indicating how certain you are about the extraction.
5.  **Summaries:** The \`executive_summary\` should be very brief. The \`detailed_summary\` should be more comprehensive.
6.  **Attribution:** Attribute items to the person who spoke them, using their name as it appears in the transcript.
7.  **\`summary_confidence_score\`:** Provide an overall confidence score for the entire analysis.
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Analyze the following transcript:\n\n${transcript}` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const jsonContent = response.choices[0]?.message?.content;

  if (!jsonContent) {
    throw new Error('AI returned no content.');
  }

  try {
    const analysis: BreakoutAnalysis = JSON.parse(jsonContent);
    // Basic validation to ensure the parsed object looks correct
    if (!analysis.executive_summary || !Array.isArray(analysis.decisions)) {
      throw new Error('Parsed JSON does not match the expected schema.');
    }
    return analysis;
  } catch (e) {
    console.error('Failed to parse AI response as JSON:', e);
    console.error('Raw AI response:', jsonContent);
    throw new Error('Could not parse the analysis from the AI response.');
  }
}

/**
 * Creates a minimal analysis object from raw annotations, to be used when AI analysis fails.
 * @param annotations - Array of raw annotation data from the database.
 * @returns A partial BreakoutAnalysis object.
 */
export function createMinimalAnalysis(annotations: RawAnnotation[]): Partial<BreakoutAnalysis> {
  const analysis: Partial<BreakoutAnalysis> = {
    decisions: [],
    action_items: [],
    open_questions: [],
    parking_lot: [],
  };

  for (const anno of annotations) {
    switch (anno.annotation_type) {
      case 'decision':
        analysis.decisions?.push({
          decision: anno.content,
          made_by: anno.created_by_name,
          confidence: 1.0, // Manually added, so confidence is 100%
        });
        break;
      case 'action':
        analysis.action_items?.push({
          task: anno.content,
          owner_name: anno.assigned_to_name || anno.created_by_name,
          confidence: 1.0,
        });
        break;
      case 'question':
        analysis.open_questions?.push({
          question: anno.content,
          asked_by: anno.created_by_name,
          answered: anno.status === 'answered',
        });
        break;
      case 'park':
        analysis.parking_lot?.push({
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
 * Manual annotations are treated as the source of truth.
 * @param aiAnalysis - The analysis object generated by the AI.
 * @param manualAnnotations - Raw annotations from the database.
 * @returns A merged and enriched BreakoutAnalysis object.
 */
export function mergeWithManualAnnotations(
  aiAnalysis: BreakoutAnalysis,
  manualAnnotations: RawAnnotation[]
): BreakoutAnalysis {
  // Create a Set for quick lookups of manually annotated content
  const manualContent = new Set(manualAnnotations.map(a => a.content.toLowerCase()));

  // Filter out any AI-generated items that are already covered by manual annotations
  aiAnalysis.decisions = aiAnalysis.decisions.filter(
    d => !manualContent.has(d.decision.toLowerCase())
  );
  aiAnalysis.action_items = aiAnalysis.action_items.filter(
    a => !manualContent.has(a.task.toLowerCase())
  );
  aiAnalysis.open_questions = aiAnalysis.open_questions.filter(
    q => !manualContent.has(q.question.toLowerCase())
  );
  aiAnalysis.parking_lot = aiAnalysis.parking_lot.filter(
    p => !manualContent.has(p.item.toLowerCase())
  );

  // Add the manual annotations to the analysis
  for (const anno of manualAnnotations) {
    switch (anno.annotation_type) {
      case 'decision':
        aiAnalysis.decisions.push({
          decision: anno.content,
          made_by: anno.created_by_name,
          confidence: 1.0,
        });
        break;
      case 'action':
        aiAnalysis.action_items.push({
          task: anno.content,
          owner_name: anno.assigned_to_name || 'Unassigned',
          confidence: 1.0,
        });
        break;
      case 'question':
        aiAnalysis.open_questions.push({
          question: anno.content,
          asked_by: anno.created_by_name,
          answered: anno.status === 'answered',
        });
        break;
      case 'park':
        aiAnalysis.parking_lot.push({
          item: anno.content,
          suggested_by: anno.created_by_name,
        });
        break;
    }
  }

  return aiAnalysis;
}

/**
 * Converts a transcript from raw messages to a simple string format.
 * @param messages - An array of RawMessage objects.
 * @returns A formatted string transcript.
 */
export function convertTranscriptToString(messages: RawMessage[]): string {
  return messages
    .map(msg => `${msg.sender_name}: ${msg.message_text}`)
    .join('\n');
}