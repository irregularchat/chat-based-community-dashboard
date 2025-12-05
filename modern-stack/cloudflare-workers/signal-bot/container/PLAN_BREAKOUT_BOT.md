# Breakout Bot Implementation Plan v2

## The Philosophy: Why Breakout Rooms Matter

Breakout rooms solve fundamental problems in group communication:

1. **Signal-to-Noise** - Main channels get noisy; focused topics get lost
2. **Time-Boxing** - Open-ended discussions drift; deadlines force decisions
3. **Participation Equity** - Smaller groups = more voices heard
4. **Accountability** - Documented outcomes create follow-through
5. **Institutional Memory** - Knowledge captured, searchable, referenceable

**The goal isn't just to create temporary groups - it's to produce valuable artifacts from conversations that would otherwise evaporate.**

---

## What Makes a Breakout Valuable?

### Outputs to Capture

| Output | Why It Matters | AI Can Extract |
|--------|----------------|----------------|
| **Decisions** | The whole point of most breakouts | Yes - "let's", "agreed", "we'll do" |
| **Action Items** | Ensures follow-through | Yes - "@person will", "needs to" |
| **Key Insights** | Ideas worth preserving | Yes - with confidence scoring |
| **Open Questions** | Prevents dropped threads | Yes - unanswered questions |
| **Parking Lot** | Off-topic but valuable items | Manual via `!park` |
| **Resources Shared** | Links, docs, references | Yes - URL detection |
| **Participant Contributions** | Who said what, engagement | Yes - message counts |
| **Timeline** | When decisions happened | Yes - timestamps |

### AI Extraction Patterns

**Decisions** (look for agreement language):
```
"let's go with..."     "we'll use..."        "agreed that..."
"decided to..."        "the plan is..."      "consensus is..."
"final answer:"        "we're doing..."      [thumbs up reactions after proposal]
```

**Action Items** (look for ownership + future tense):
```
"@alice will..."       "I'll handle..."      "needs to be done by..."
"action item:"         "todo:"               "someone should..."
"assigned to..."       "owner:"              "deadline:"
```

**Open Questions** (look for uncertainty):
```
"need to figure out..."    "still unclear..."    "TBD"
"will research..."         "not sure yet..."     "?"
"depends on..."            "waiting for..."      "blocker:"
```

---

## Breakout Room Types (Templates)

Different breakout purposes need different output structures:

| Type | Purpose | Key Outputs |
|------|---------|-------------|
| **Brainstorm** | Generate ideas | Ideas list, themes, top voted |
| **Decision** | Choose between options | Options, pros/cons, final decision, rationale |
| **Planning** | Create action plan | Goals, milestones, timeline, owners |
| **Retrospective** | Reflect on past work | What worked, what didn't, improvements |
| **Problem-Solving** | Debug an issue | Problem statement, root causes, resolution |
| **Review** | Evaluate something | Items reviewed, feedback, approvals needed |
| **Sync** | Quick alignment | Status updates, blockers, next steps |

**Default: General** (captures everything, AI determines what's relevant)

---

## Phase 1: Enhanced Database Schema

### File: `container/migrations/005_breakout_rooms.sql`

```sql
-- Migration: 005_breakout_rooms
-- Description: Breakout room system with rich metadata extraction
-- Created: 2024-12-05

-- Main Breakout Rooms Table
CREATE TABLE IF NOT EXISTS breakout_rooms (
    id SERIAL PRIMARY KEY,
    signal_group_id VARCHAR(255) UNIQUE,

    -- Origin tracking
    parent_group_id VARCHAR(255) NOT NULL,
    parent_group_name VARCHAR(255),

    -- Room metadata
    topic VARCHAR(500) NOT NULL,
    room_name VARCHAR(255),
    room_type VARCHAR(50) DEFAULT 'general',  -- brainstorm, decision, planning, retro, problem, review, sync

    -- Creator info
    creator_uuid VARCHAR(255) NOT NULL,
    creator_name VARCHAR(255),
    facilitator_uuid VARCHAR(255),  -- Can be different from creator
    facilitator_name VARCHAR(255),

    -- Status: active, ending, ended, expired, archived
    status VARCHAR(50) NOT NULL DEFAULT 'active',

    -- Timing
    duration_minutes INTEGER DEFAULT 60,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    warning_15min_sent BOOLEAN DEFAULT false,
    warning_5min_sent BOOLEAN DEFAULT false,
    warning_1min_sent BOOLEAN DEFAULT false,
    ended_at TIMESTAMP,
    actual_duration_minutes INTEGER,

    -- Privacy settings
    privacy_mode VARCHAR(50) DEFAULT 'summary_only',  -- public, private, summary_only, internal

    -- Auto-generated content
    executive_summary TEXT,
    detailed_summary TEXT,
    summary_generated_at TIMESTAMP,
    summary_confidence_score DECIMAL(3,2),  -- 0.00 to 1.00

    -- Extracted structured data (JSON)
    decisions_json JSONB,           -- [{decision, rationale, confidence, decided_by}]
    action_items_json JSONB,        -- [{task, owner_uuid, owner_name, due_date, status}]
    open_questions_json JSONB,      -- [{question, raised_by, context}]
    parking_lot_json JSONB,         -- [{item, raised_by}]
    key_insights_json JSONB,        -- [{insight, context, confidence}]
    resources_shared_json JSONB,    -- [{url, title, shared_by}]

    -- Discourse integration
    discourse_topic_id INTEGER,
    discourse_topic_url VARCHAR(500),
    posted_to_discourse_at TIMESTAMP,
    discourse_post_updated_at TIMESTAMP,

    -- Settings
    auto_post_to_discourse BOOLEAN DEFAULT true,
    notify_parent_on_end BOOLEAN DEFAULT true,
    allow_late_join BOOLEAN DEFAULT true,
    record_messages BOOLEAN DEFAULT true,

    -- Metrics
    total_messages INTEGER DEFAULT 0,
    unique_participants INTEGER DEFAULT 0
);

-- Breakout Room Members
CREATE TABLE IF NOT EXISTS breakout_room_members (
    id SERIAL PRIMARY KEY,
    breakout_id INTEGER REFERENCES breakout_rooms(id) ON DELETE CASCADE,
    member_uuid VARCHAR(255) NOT NULL,
    member_name VARCHAR(255),

    -- Role: creator, facilitator, participant
    role VARCHAR(50) DEFAULT 'participant',

    -- Engagement metrics
    message_count INTEGER DEFAULT 0,
    first_message_at TIMESTAMP,
    last_message_at TIMESTAMP,

    -- Participation tracking
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP,
    was_invited BOOLEAN DEFAULT true,  -- vs joined via link

    UNIQUE(breakout_id, member_uuid)
);

-- Breakout Room Messages (for summarization)
CREATE TABLE IF NOT EXISTS breakout_room_messages (
    id SERIAL PRIMARY KEY,
    breakout_id INTEGER REFERENCES breakout_rooms(id) ON DELETE CASCADE,
    signal_message_id VARCHAR(255),

    sender_uuid VARCHAR(255) NOT NULL,
    sender_name VARCHAR(255),
    message_text TEXT NOT NULL,
    message_type VARCHAR(50) DEFAULT 'chat',  -- chat, decision, action, park, question

    timestamp BIGINT NOT NULL,

    -- Threading context
    is_reply BOOLEAN DEFAULT false,
    reply_to_message_id VARCHAR(255),
    quoted_text TEXT,

    -- AI analysis (populated during summarization)
    is_decision BOOLEAN DEFAULT false,
    is_action_item BOOLEAN DEFAULT false,
    is_question BOOLEAN DEFAULT false,
    extracted_entities JSONB,  -- {people: [], urls: [], dates: []}

    -- Reactions (if Signal provides them)
    reactions_json JSONB
);

-- Manual annotations (explicit !decision, !action, !park commands)
CREATE TABLE IF NOT EXISTS breakout_annotations (
    id SERIAL PRIMARY KEY,
    breakout_id INTEGER REFERENCES breakout_rooms(id) ON DELETE CASCADE,
    annotation_type VARCHAR(50) NOT NULL,  -- decision, action, park, question
    content TEXT NOT NULL,
    created_by_uuid VARCHAR(255),
    created_by_name VARCHAR(255),
    assigned_to_uuid VARCHAR(255),  -- For action items
    assigned_to_name VARCHAR(255),
    due_date DATE,
    status VARCHAR(50) DEFAULT 'open',  -- open, done, cancelled
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_breakout_status ON breakout_rooms(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_breakout_parent ON breakout_rooms(parent_group_id, status);
CREATE INDEX IF NOT EXISTS idx_breakout_signal ON breakout_rooms(signal_group_id);
CREATE INDEX IF NOT EXISTS idx_breakout_creator ON breakout_rooms(creator_uuid);
CREATE INDEX IF NOT EXISTS idx_breakout_discourse ON breakout_rooms(discourse_topic_id);

CREATE INDEX IF NOT EXISTS idx_breakout_members_lookup ON breakout_room_members(breakout_id, member_uuid);
CREATE INDEX IF NOT EXISTS idx_breakout_members_engagement ON breakout_room_members(breakout_id, message_count DESC);

CREATE INDEX IF NOT EXISTS idx_breakout_messages_time ON breakout_room_messages(breakout_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_breakout_messages_sender ON breakout_room_messages(breakout_id, sender_uuid);
CREATE INDEX IF NOT EXISTS idx_breakout_messages_type ON breakout_room_messages(breakout_id, message_type);

CREATE INDEX IF NOT EXISTS idx_breakout_annotations ON breakout_annotations(breakout_id, annotation_type);
```

---

## Phase 2: Discourse Integration - The Breakout Report

### Design Philosophy

The Discourse post is not just a dump of messages - it's a **professional meeting report** that:
- Serves as institutional memory
- Is searchable and referenceable
- Can be updated as action items complete
- Provides value to people who weren't in the room

### Discourse Post Template

```markdown
# {room_type_emoji} Breakout: {topic}

> **TL;DR:** {executive_summary - 2-3 sentences max}

---

## Session Overview

| Attribute | Value |
|-----------|-------|
| **Type** | {room_type} |
| **Duration** | {start_time} → {end_time} ({actual_duration} minutes) |
| **Parent Channel** | {parent_group_name} |
| **Facilitated By** | {facilitator_name} |
| **Messages** | {total_messages} |

### Participants ({participant_count})

| Participant | Contributions | Role |
|-------------|---------------|------|
| {name} | {message_count} messages | {role} |
| ... | ... | ... |

---

## Decisions Made ({decision_count})

{For each decision:}

### {decision_number}. {decision_title}

**Decision:** {decision_statement}

**Rationale:** {why_this_was_chosen}

**Alternatives Considered:** {other_options_if_any}

**Decided By:** {who_made_or_confirmed}

**Confidence:** {high/medium/low} ({confidence_percentage}%)

---

## Action Items ({action_count})

| # | Task | Owner | Due | Status |
|---|------|-------|-----|--------|
| 1 | {task_description} | @{owner} | {due_date} | :hourglass: Pending |
| 2 | {task_description} | @{owner} | {due_date} | :hourglass: Pending |

---

## Key Insights

{numbered_list_of_insights_with_context}

1. **{insight_title}** - {insight_detail}
2. **{insight_title}** - {insight_detail}

---

## Open Questions

Items needing further research or decision:

1. {question} - *raised by {name}*
2. {question} - *needs {what_to_resolve}*

---

## Parking Lot

Topics raised but deferred for later discussion:

- {item} *(raised by {name})*
- {item}

---

## Resources Shared

Links and documents referenced during discussion:

- [{title}]({url}) - shared by {name}
- {description_of_resource}

---

## Discussion Summary

{detailed_narrative_summary}

{key_turning_points_in_conversation}

{areas_of_agreement_and_disagreement}

---

## Next Steps

- [ ] {follow_up_action}
- [ ] Review action items at next sync
- [ ] Schedule follow-up breakout? Topic: {suggested_topic}

---

<small>

**Report generated:** {timestamp}
**AI Confidence Scores:** Summary {n}% | Decisions {n}% | Actions {n}%
**Privacy Mode:** {privacy_mode}

*This report was auto-generated from Signal by IrregularChat Bot*

</small>
```

### Room Type Emojis

| Type | Emoji | Tag |
|------|-------|-----|
| General | :speech_balloon: | `breakout-general` |
| Brainstorm | :bulb: | `breakout-brainstorm` |
| Decision | :ballot_box: | `breakout-decision` |
| Planning | :calendar: | `breakout-planning` |
| Retrospective | :mirror: | `breakout-retro` |
| Problem-Solving | :wrench: | `breakout-problem` |
| Review | :mag: | `breakout-review` |
| Sync | :handshake: | `breakout-sync` |

### File: `container/src/utils/breakout-discourse-poster.ts` (NEW)

```typescript
/**
 * Breakout Room Discourse Poster
 *
 * Creates rich, structured Discourse posts from breakout room data.
 * NOT the same as news article posting - this is a meeting report.
 */

export interface BreakoutReport {
  room: BreakoutRoom;
  participants: BreakoutParticipant[];
  decisions: Decision[];
  actionItems: ActionItem[];
  insights: Insight[];
  openQuestions: OpenQuestion[];
  parkingLot: ParkingLotItem[];
  resources: SharedResource[];
  executiveSummary: string;
  detailedSummary: string;
  confidenceScores: {
    summary: number;
    decisions: number;
    actions: number;
  };
}

export interface Decision {
  title: string;
  statement: string;
  rationale?: string;
  alternatives?: string[];
  decidedBy?: string;
  confidence: 'high' | 'medium' | 'low';
  confidenceScore: number;
  messageRef?: string;  // Link back to original message
}

export interface ActionItem {
  task: string;
  ownerUuid?: string;
  ownerName?: string;
  dueDate?: string;
  status: 'pending' | 'done' | 'cancelled';
  messageRef?: string;
}

// ... other interfaces

export async function postBreakoutReport(
  report: BreakoutReport,
  config: DiscourseConfig,
  dbClient: PostgresClient
): Promise<{ success: boolean; topicUrl?: string; topicId?: number; error?: string }> {
  // 1. Build markdown from template
  // 2. Determine Discourse category based on room type
  // 3. Add appropriate tags
  // 4. Post to Discourse
  // 5. Update breakout_rooms with discourse_topic_id/url
  // 6. Return result
}

export async function updateBreakoutReport(
  topicId: number,
  report: BreakoutReport,
  config: DiscourseConfig
): Promise<{ success: boolean; error?: string }> {
  // For updating action item statuses, adding follow-up notes, etc.
}
```

---

## Phase 3: AI Analysis Engine

### File: `container/src/utils/breakout-analyzer.ts` (NEW)

```typescript
/**
 * Breakout Room AI Analyzer
 *
 * Extracts structured data from conversation history using GPT.
 * Returns decisions, action items, insights, questions with confidence scores.
 */

const ANALYSIS_PROMPT = `You are analyzing a focused discussion (breakout room) from a Signal group chat.

CONTEXT:
- Topic: {topic}
- Type: {room_type}
- Duration: {duration} minutes
- Participants: {participant_count}

YOUR TASK:
Extract structured information from the conversation. For each item, provide a confidence score (0.0-1.0).

EXTRACT:

1. DECISIONS - Statements where the group agreed on something
   - Look for: "let's", "agreed", "we'll do", "decided", confirmations after proposals
   - Include: decision statement, rationale (if given), who confirmed
   - Confidence: high if explicit agreement, medium if implied, low if uncertain

2. ACTION ITEMS - Tasks assigned to specific people
   - Look for: "@person will", "I'll handle", "needs to be done", "todo"
   - Include: task description, owner (if mentioned), due date (if mentioned)
   - Confidence: high if explicit assignment, medium if volunteered, low if suggested

3. KEY INSIGHTS - Important points worth preserving
   - Novel ideas, important observations, key data points
   - Include: the insight, context for why it matters
   - Confidence: based on how central to discussion

4. OPEN QUESTIONS - Unresolved items needing follow-up
   - Questions asked but not fully answered
   - Items marked as "TBD", "need to research", "not sure"
   - Include: the question, who raised it (if known)

5. EXECUTIVE SUMMARY - 2-3 sentence TL;DR
   - What was discussed, key outcomes, next steps

6. DETAILED SUMMARY - 2-3 paragraph narrative
   - Flow of conversation, key turning points, areas of agreement/disagreement

OUTPUT FORMAT: JSON
{
  "executiveSummary": "...",
  "detailedSummary": "...",
  "decisions": [
    {"title": "...", "statement": "...", "rationale": "...", "decidedBy": "...", "confidence": 0.85}
  ],
  "actionItems": [
    {"task": "...", "owner": "...", "dueDate": "...", "confidence": 0.9}
  ],
  "insights": [
    {"insight": "...", "context": "...", "confidence": 0.75}
  ],
  "openQuestions": [
    {"question": "...", "raisedBy": "...", "confidence": 0.8}
  ],
  "overallConfidence": 0.82
}

CONVERSATION:
{messages}
`;

export async function analyzeBreakoutConversation(
  messages: BreakoutMessage[],
  room: BreakoutRoom,
  participants: BreakoutParticipant[]
): Promise<BreakoutAnalysis> {
  // 1. Format messages for prompt (with participant names, timestamps)
  // 2. Include any manual annotations (!decision, !action, !park)
  // 3. Call OpenAI with analysis prompt
  // 4. Parse JSON response
  // 5. Validate and sanitize extracted data
  // 6. Return structured analysis with confidence scores
}
```

---

## Phase 4: Command Handlers

### Core Commands

| Command | Description | Location |
|---------|-------------|----------|
| `!breakout` | Create a new breakout room | `command-handler.ts` |
| `!endbreakout` | End room and generate report | `command-handler.ts` |
| `!breakouts` | List active breakouts | `command-handler.ts` |

### In-Room Commands

| Command | Description | Purpose |
|---------|-------------|---------|
| `!decision <text>` | Mark explicit decision | Manual annotation |
| `!action @user <task>` | Create action item | Manual annotation |
| `!park <item>` | Add to parking lot | Manual annotation |
| `!question <text>` | Mark open question | Manual annotation |
| `!extend <time>` | Request more time | Time management |
| `!status` | Show room status & time remaining | Awareness |
| `!summary` | Get current AI summary (mid-session) | Preview |
| `!publish` | Post to Discourse now | Manual trigger |
| `!invite @user` | Add late participant | Membership |

### Command Handler: `!breakout`

```typescript
/**
 * !breakout [--type TYPE] [--duration TIME] [--private] <topic> @user1 @user2...
 *
 * Creates a focused discussion room with specified participants.
 *
 * Options:
 *   --type TYPE      Room type: brainstorm, decision, planning, retro, problem, review, sync
 *   --duration TIME  Duration: 15m, 30m, 1h, 2h (default: 1h)
 *   --private        Don't auto-post to Discourse
 *   --silent         Don't notify parent group
 *
 * Examples:
 *   !breakout API redesign @alice @bob
 *   !breakout --type decision --duration 30m Which database? @team
 *   !bo Quick sync @alice                    (alias)
 */
private async handleBreakout(args: string, context: CommandContext): Promise<string>
```

### Command Handler: `!endbreakout`

```typescript
/**
 * !endbreakout [--skip-publish] [--extend TIME]
 *
 * Ends the current breakout room:
 * 1. Generates AI summary with confidence scores
 * 2. Extracts decisions, action items, insights, questions
 * 3. Posts report to Discourse (unless --skip-publish)
 * 4. Notifies parent group with summary
 * 5. Marks room as ended
 *
 * Options:
 *   --skip-publish  Don't post to Discourse
 *   --extend TIME   Instead of ending, extend by TIME
 */
private async handleEndBreakout(args: string, context: CommandContext): Promise<string>
```

### Manual Annotation Commands

```typescript
/**
 * !decision <decision text>
 *
 * Explicitly marks a decision. Gets included in report with 100% confidence.
 * Example: !decision We will use PostgreSQL for the new service
 */
private async handleDecision(args: string, context: CommandContext): Promise<string>

/**
 * !action @user <task> [--due DATE]
 *
 * Creates an action item with explicit owner.
 * Example: !action @alice Set up CI pipeline --due Friday
 */
private async handleAction(args: string, context: CommandContext): Promise<string>

/**
 * !park <item>
 *
 * Adds item to parking lot for future discussion.
 * Example: !park Should we also consider MongoDB?
 */
private async handlePark(args: string, context: CommandContext): Promise<string>
```

---

## Phase 5: Time Management & Notifications

### Timer Warnings

Automatic notifications sent to breakout room:

| Time Remaining | Message |
|----------------|---------|
| 15 minutes | ":hourglass: 15 minutes remaining in this breakout. Start wrapping up key points." |
| 5 minutes | ":warning: 5 minutes remaining! Finalize decisions and action items." |
| 1 minute | ":rotating_light: 1 minute remaining. Use `!extend 15m` to continue or `!endbreakout` to wrap up." |
| 0 minutes | ":stop_sign: Time's up! Generating summary... Use `!extend` if you need more time." |

### Extension Logic

```typescript
// If no response to time's up within 2 minutes, auto-end
// If !extend called, reset timer with new duration
// Max extensions: 3 (to prevent runaway sessions)
// Max total duration: 4 hours
```

---

## Phase 6: Privacy Modes

| Mode | What's Captured | Where It Goes | Who Can See |
|------|-----------------|---------------|-------------|
| **public** | Full messages + quotes | Public Discourse post | Everyone |
| **private** | Full messages + quotes | Unlisted Discourse post | Link holders only |
| **summary_only** | AI summary only, no quotes | Public Discourse post | Everyone |
| **internal** | Everything | Database only | Admins only |

**Default: `summary_only`** - Balances transparency with privacy.

---

## Phase 7: Message Interception

### File: `container/src/bot/signal-bot-v2.ts`

```typescript
// In message handler, before command processing:
async handleMessage(envelope: SignalEnvelope): Promise<void> {
  const groupId = envelope.dataMessage?.groupInfo?.groupId;

  if (groupId) {
    // Check if this is a breakout room
    const breakout = await this.breakoutManager.getActiveBreakoutByGroupId(groupId);

    if (breakout) {
      // Record the message
      await this.breakoutManager.recordMessage({
        breakoutId: breakout.id,
        signalMessageId: envelope.timestamp?.toString(),
        senderUuid: envelope.sourceUuid,
        senderName: envelope.sourceName,
        messageText: envelope.dataMessage?.message,
        timestamp: envelope.timestamp,
        isReply: !!envelope.dataMessage?.quote,
        quotedText: envelope.dataMessage?.quote?.text
      });

      // Update participant engagement metrics
      await this.breakoutManager.updateParticipantEngagement(
        breakout.id,
        envelope.sourceUuid,
        envelope.sourceName
      );
    }
  }

  // Continue with normal command processing...
}
```

---

## Phase 8: Scheduler Integration

### File: `container/src/scheduler/breakout-scheduler.ts` (NEW)

```typescript
/**
 * Breakout Room Scheduler
 *
 * Runs every minute to:
 * 1. Send time warnings (15min, 5min, 1min)
 * 2. Handle expired rooms (auto-end after grace period)
 * 3. Clean up old archived rooms
 */

export async function runBreakoutScheduler(
  dbClient: PostgresClient,
  bot: SignalBotV2
): Promise<void> {
  // 1. Get active breakouts
  const activeBreakouts = await dbClient.query(`
    SELECT * FROM breakout_rooms
    WHERE status = 'active'
  `);

  for (const breakout of activeBreakouts.results) {
    const now = Date.now();
    const expiresAt = new Date(breakout.expires_at).getTime();
    const remaining = expiresAt - now;
    const minutesRemaining = Math.ceil(remaining / 60000);

    // Send time warnings
    if (minutesRemaining <= 15 && !breakout.warning_15min_sent) {
      await sendTimeWarning(bot, breakout, '15 minutes');
      await dbClient.update('breakout_rooms', { warning_15min_sent: true }, 'id = ?', [breakout.id]);
    }
    // ... similar for 5min, 1min

    // Handle expiration
    if (remaining <= 0) {
      // Grace period: 2 minutes to call !extend
      if (remaining < -120000) {
        await autoEndBreakout(dbClient, bot, breakout);
      }
    }
  }
}
```

---

## Implementation Roadmap

### MVP (Phase 1) - ✅ COMPLETE (tag: `breakout-phase1`)

- [x] Database migration `005_breakout_rooms.sql`
- [x] Update `postgres-client.ts` ALLOWED_TABLES
- [x] PostgresClient breakout methods (CRUD operations)
- [x] Create `breakout-manager.ts` utility class
- [x] Basic `!breakout` command (parse topic, duration, mentions)
- [x] Message recording in breakout rooms (signal-bot-v2 interception)
- [x] Time warnings infrastructure (15min, 5min, 1min)
- [x] Basic `!endbreakout` command framework
- [x] `!extend` command support
- [x] `!status` command for room status

### Phase 2 - Signal Group Creation & Discourse - ✅ COMPLETE (tag: `breakout-phase2`)

- [x] Signal group creation via `bot.createGroup()` (breakout-manager.ts:171-183)
- [x] Invite members to breakout Signal group (via createGroup members array)
- [x] Basic `!endbreakout` summary generation (breakout-manager.ts:405-448)
- [x] Notification to parent group on end (breakout-manager.ts:431-443)
- [x] Full Discourse posting with rich report (postgres-client.ts:1622-1760)
- [x] All command handlers wired up (!breakout, !endbreakout, !extend, !status, etc.)

### Core Features (Phase 3-4)

- [ ] AI analysis engine with extraction
- [ ] Rich Discourse report posting
- [ ] Manual annotation commands (`!decision`, `!action`, `!park`)
- [ ] Time warnings (15m, 5m, 1m)
- [ ] `!extend` command
- [ ] `!status` command
- [ ] Participant engagement tracking

### Polish (Phase 5-6)

- [ ] Room type templates (brainstorm, decision, etc.)
- [ ] Privacy modes
- [ ] `!breakouts` list command
- [ ] Late participant `!invite`
- [ ] Discourse report updates (action item completion)
- [ ] `!summary` mid-session preview

### Advanced (Phase 7+)

- [ ] Auto-suggested follow-up breakouts
- [ ] Integration with calendar for scheduling
- [ ] Breakout series (related discussions linked)
- [ ] Analytics dashboard

---

## Existing Code Patterns Reference

| Feature | Existing Pattern | File:Line |
|---------|-----------------|-----------|
| Group creation | `bot.createGroup()` | `command-handler.ts:6352` |
| @mention parsing | `context.mentions` | `command-handler.ts:1195-1240` |
| AI summarization | `handleSummarize()` | `command-handler.ts:1666-1800` |
| OpenAI API call | GPT integration | `discourse-poster.ts:109-173` |
| Discourse posting | `postNewsArticleToDiscourse()` | `discourse-poster.ts:213` |
| Scheduler pattern | Announcement scheduler | `announcement-scheduler.ts` |
| Time parsing | `parseTimeString()` | `time-parser.ts` |
| Admin check | `isAdmin()` | `command-handler.ts` |

---

## Environment Variables

```bash
# Breakout Configuration
BREAKOUT_DEFAULT_DURATION=60              # minutes
BREAKOUT_MAX_DURATION=240                 # 4 hours max
BREAKOUT_MAX_EXTENSIONS=3                 # max times !extend can be used
BREAKOUT_AUTO_POST_DISCOURSE=true         # default: post to Discourse
BREAKOUT_DEFAULT_PRIVACY=summary_only     # public, private, summary_only, internal

# Discourse Configuration (for breakouts)
BREAKOUT_DISCOURSE_CATEGORY=5             # Discourse category ID for breakout reports

# AI Configuration
BREAKOUT_AI_MODEL=gpt-4o-mini             # Model for analysis
BREAKOUT_MIN_MESSAGES_FOR_ANALYSIS=5      # Don't analyze if too few messages
```

---

## Testing Scenarios

### Happy Path
1. `!breakout API design @alice @bob` creates room
2. Discussion happens, messages recorded
3. `!decision We'll use REST` captured
4. `!action @alice Write API spec` captured
5. Timer warning at 15min, 5min, 1min
6. `!endbreakout` generates report
7. Report posted to Discourse with decisions, actions, summary
8. Parent group notified with TL;DR

### Edge Cases
- [ ] Empty breakout (no messages) - skip analysis
- [ ] Single participant - still allow, note in report
- [ ] Breakout in breakout - disallow (can't nest)
- [ ] Network failure during Discourse post - retry, save locally
- [ ] Massive message volume - truncate for AI, note in report
- [ ] Non-member tries to join - reject
- [ ] Creator leaves early - transfer facilitator role

---

## Example Discourse Output

```markdown
# :ballot_box: Breakout: Database Selection for User Service

> **TL;DR:** Team decided to use PostgreSQL with pgvector extension for the new user service, primarily due to existing expertise and vector search requirements. Alice will set up the infrastructure by Friday.

---

## Session Overview

| Attribute | Value |
|-----------|-------|
| **Type** | Decision |
| **Duration** | 2:15 PM → 2:52 PM (37 minutes) |
| **Parent Channel** | Engineering |
| **Facilitated By** | Bob |
| **Messages** | 47 |

### Participants (4)

| Participant | Contributions | Role |
|-------------|---------------|------|
| Alice | 18 messages | Facilitator |
| Bob | 14 messages | Participant |
| Charlie | 12 messages | Participant |
| Diana | 3 messages | Participant |

---

## Decisions Made (2)

### 1. Use PostgreSQL with pgvector

**Decision:** We will use PostgreSQL with the pgvector extension for the user service database.

**Rationale:** Team already has PostgreSQL expertise, pgvector supports our vector similarity search needs, and it avoids introducing a new database technology.

**Alternatives Considered:** MongoDB (rejected: lack of expertise), Pinecone (rejected: cost), Supabase (considered for future)

**Decided By:** Team consensus after Bob's analysis

**Confidence:** High (92%)

### 2. Infrastructure on AWS RDS

**Decision:** Host on AWS RDS PostgreSQL rather than self-managed.

**Rationale:** Reduces operational burden, automatic backups, matches existing infra.

**Confidence:** High (88%)

---

## Action Items (3)

| # | Task | Owner | Due | Status |
|---|------|-------|-----|--------|
| 1 | Set up RDS instance with pgvector | @alice | Dec 8 | :hourglass: Pending |
| 2 | Document connection pooling strategy | @bob | Dec 10 | :hourglass: Pending |
| 3 | Prototype vector search queries | @charlie | Dec 12 | :hourglass: Pending |

---

## Key Insights

1. **pgvector performance** - Bob shared benchmarks showing pgvector handles our expected 10M vectors efficiently with IVFFlat indexing
2. **Migration path** - Can start with standard PostgreSQL and add pgvector later without data migration

---

## Open Questions

1. Connection pooling approach - PgBouncer vs application-level? *needs research*
2. Backup retention policy for vector data? *check with infra team*

---

## Parking Lot

- Consider Supabase for frontend-facing APIs in Q2
- Evaluate read replicas if query load increases

---

*Report generated: Dec 5, 2024 2:55 PM*
*AI Confidence: Summary 89% | Decisions 90% | Actions 94%*

*This report was auto-generated from Signal by IrregularChat Bot*
```

---

## Security Considerations

1. **Never expose phone numbers** - Only UUIDs and display names
2. **Sanitize all user input** - Before AI processing and Discourse posting
3. **Rate limit breakout creation** - Prevent spam/abuse
4. **Validate membership** - Only invited members can participate
5. **Audit logging** - Track who created/ended/modified breakouts
