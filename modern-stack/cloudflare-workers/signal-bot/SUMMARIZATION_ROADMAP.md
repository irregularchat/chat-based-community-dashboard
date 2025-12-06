# Signal Bot Summarization Enhancement Roadmap

## Overview
This document outlines planned enhancements to the `!summarize` command based on research analysis frameworks from researchtoolspy project.

## Current Status (v1.0 - COMPLETED)
- ✅ Time-based summarization (`!summarize -h <hours>`)
- ✅ Message count-based summarization (`!summarize -n <count>`)
- ✅ Combined time/count constraints
- ✅ Basic AI-powered conversation summaries
- ✅ Backward compatible text/URL summarization

## Phase 1: Enhanced Analysis (Priority Features from Research)

### Feature #2: Enhanced 5W Analysis Prompt
**Status**: Planned
**Priority**: HIGH
**Description**: Implement structured 5W (Who, What, Where, When, Why) analysis for conversation summaries

**Implementation**:
```typescript
const enhanced5WPrompt = `Analyze this conversation and provide a structured summary:

## WHO
- Key participants and their roles
- Most active contributors
- Decision makers mentioned

## WHAT
- Main topics discussed
- Key decisions made
- Action items identified

## WHERE
- Location context (if relevant)
- Channel/group context

## WHEN
- Timeline of key events
- Deadlines mentioned
- Time-sensitive items

## WHY
- Motivations discussed
- Problems being solved
- Goals identified

## SUMMARY
- 2-3 sentence overview
- Sentiment: [positive/neutral/negative/mixed]
- Urgency level: [low/medium/high]

Conversation (${messages.length} messages from ${timeframe}):
${conversationText}`;
```

**Benefits**:
- Clearer, more actionable summaries
- Better understanding of context
- Helps identify who needs to follow up

**Estimated Effort**: 2-3 hours

---

### Feature #3: Participant/Actor Extraction
**Status**: Planned
**Priority**: HIGH
**Description**: Identify and analyze key participants in conversations

**Implementation**:
- Extract participant names from message metadata
- Count messages per participant
- Identify who addressed whom (mentions)
- Track participant sentiment
- Highlight key contributors

**Output Format**:
```
📊 Participation Analysis:
• John (12 messages, 45%) - Mostly positive, decision maker
• Sarah (8 messages, 30%) - Technical details, problem solver
• Mike (7 messages, 25%) - Questions and clarifications

🎯 Key Interactions:
• John → Sarah: 3 direct questions
• Sarah → Mike: 2 technical explanations
```

**Benefits**:
- Understand conversation dynamics
- Identify subject matter experts
- Track engagement levels

**Estimated Effort**: 3-4 hours

---

### Feature #5: Enhanced AI Prompt System
**Status**: Planned
**Priority**: HIGH
**Description**: Upgrade AI prompts for richer, more structured outputs

**Current Approach**:
```typescript
// Simple prompt
`Summarize this conversation...`
```

**Enhanced Approach**:
```typescript
// Multi-stage analysis
1. Extract entities (people, orgs, locations)
2. Identify themes and topics
3. Determine sentiment and urgency
4. Generate structured summary with sections
5. Include confidence scores
```

**Prompt Engineering Improvements**:
- System message with clear role definition
- Few-shot examples for consistent format
- Temperature tuning (0.3-0.5 for factual, 0.7-0.9 for creative)
- Token limit management (500 for summaries, 150 for quick takes)
- Structured output format (JSON when possible)

**Benefits**:
- More consistent output quality
- Better extraction of key information
- Reduced AI hallucinations
- Faster processing with optimized tokens

**Estimated Effort**: 4-5 hours

---

### Feature #13: Optional Verbose Flags
**Status**: Planned
**Priority**: MEDIUM
**Description**: Add optional flags for power users who want more detail

**Proposed Flags**:

```bash
# Verbose 5W analysis
!summarize -h 2 -v
!summarize -n 50 --verbose

# Focus on actors/participants
!summarize -h 4 --actors
!summarize -n 100 --participants

# Topic extraction
!summarize -h 8 --topics
!summarize -n 200 --themes

# Sentiment analysis
!summarize -h 1 --sentiment
!summarize -n 50 --emotion

# Full analysis (all flags)
!summarize -h 2 --full
!summarize -n 30 --detailed

# Quick summary (minimal, fast)
!summarize -h 1 --quick
!summarize -n 10 -q
```

**Output Examples**:

**Standard** (`!summarize -h 2`):
```
📝 Conversation Summary (last 2 hours, 45 messages):

The team discussed deployment strategies for the new API release. John raised concerns about database migrations, which Sarah addressed with a rollback plan. Mike volunteered to write integration tests. Consensus reached to deploy on Friday evening.

Key Points:
• API deployment planned for Friday 6pm
• Migration rollback plan documented
• Integration tests needed by Thursday
```

**Verbose** (`!summarize -h 2 -v`):
```
📝 Detailed Conversation Summary

WHO (4 participants):
• John (Lead, 15 msgs) - Primary decision maker
• Sarah (DevOps, 12 msgs) - Technical implementation
• Mike (QA, 10 msgs) - Testing focus
• Lisa (PM, 8 msgs) - Timeline coordination

WHAT (Main Topics):
1. API Deployment Strategy
   - Consensus: Friday 6pm deployment
   - Rollout: Blue-green deployment
   - Duration: 2-hour window

2. Database Migrations
   - Concern: Data integrity during migration
   - Solution: Rollback plan with snapshots
   - Owner: Sarah

3. Testing Requirements
   - Integration tests needed
   - Performance benchmarks
   - Owner: Mike (Due: Thursday)

WHERE:
• Channel: #engineering-team
• External refs: Jira PROJ-123, GitHub PR #456

WHEN:
• Now: Mike starts test writing
• Thursday EOD: Tests complete
• Friday 6pm: Deployment window
• Saturday 8am: Verification complete

WHY:
• Customer demand for new features
• Bug fixes in current version critical
• Competitive pressure

SENTIMENT: ✅ Positive
• Team confident in plan
• No major disagreements
• Clear ownership

URGENCY: 🔥 High
• Friday deadline firm
• Customer commitments
```

**Actor Focus** (`!summarize -h 2 --actors`):
```
👥 Participant Analysis (45 messages, 2 hours):

📊 Contribution Breakdown:
┌────────┬──────────┬─────────┬─────────────┐
│ Name   │ Messages │ Share   │ Role        │
├────────┼──────────┼─────────┼─────────────┤
│ John   │ 15       │ 33%     │ Leadership  │
│ Sarah  │ 12       │ 27%     │ Technical   │
│ Mike   │ 10       │ 22%     │ Testing     │
│ Lisa   │ 8        │ 18%     │ Coordination│
└────────┴──────────┴─────────┴─────────────┘

🎭 Communication Patterns:
• John → All: Setting direction, asking questions
• Sarah → John: Providing solutions, explaining approaches
• Mike → Sarah: Clarifying requirements
• Lisa → All: Timeline management

🔑 Key Contributions:
• John: Identified migration risks, approved final plan
• Sarah: Proposed rollback strategy, committed to ownership
• Mike: Volunteered for testing, defined test scope
• Lisa: Coordinated timeline, confirmed stakeholder approval

💬 Interaction Density:
• Highest: John ↔ Sarah (8 exchanges)
• Active: Sarah ↔ Mike (5 exchanges)
• Moderate: John ↔ Mike (3 exchanges)
```

**Benefits**:
- Power users get detailed insights
- Casual users get quick summaries
- Flexibility for different use cases
- Backward compatible (no flags = standard output)

**Estimated Effort**: 5-6 hours

---

## Phase 2: Advanced Features (Future)

### Keyword/Topic Clustering
Extract and group similar concepts across messages

### Thread Detection
Identify conversation threads and sub-topics

### Sentiment Over Time
Track how sentiment changes during conversation

### Action Item Extraction
Automatically identify tasks, assignments, deadlines

### Question/Answer Matching
Link questions to their answers in conversation

### Link/Reference Extraction
Collect all URLs, documents, tickets mentioned

### Export Summaries
Save summaries to file, database, or send to Discourse

---

## Implementation Priority

### Immediate (Next Sprint):
1. **Feature #5**: Enhanced AI Prompt System (Foundation for all others)
2. **Feature #2**: Enhanced 5W Analysis
3. **Feature #3**: Participant Extraction

### Short-term (Following Sprint):
4. **Feature #13**: Verbose Flags

### Medium-term (Next Month):
5. Advanced Features (Phase 2)

---

## Technical Considerations

### Database Requirements:
- Messages must include `source_name`, `source_number`, `message`, `timestamp`
- Indexes on `group_id` and `timestamp` for fast queries
- Consider message metadata storage (mentions, reactions, etc.)

### API Performance:
- Message retrieval should be < 200ms for typical queries
- AI summarization typically 2-5 seconds (depends on message count)
- Consider caching summaries for frequently requested timeframes

### Token Management:
- GPT-4o-mini: 16K context window
- Target: 2000-4000 tokens per summary request
- ~1 message = 50-100 tokens (average)
- Optimal batch size: 20-80 messages per summary

### Error Handling:
- Handle "no messages found" gracefully
- Fallback for AI timeouts (return basic summary)
- Rate limiting for AI API calls
- Validate time/count parameters (reasonable limits)

---

## Success Metrics

### User Engagement:
- Summarization feature usage frequency
- Average messages per summary request
- Ratio of flag usage (standard vs verbose)

### Quality Metrics:
- User feedback on summary accuracy
- Time saved vs reading full conversation
- Action items successfully identified

### Performance Metrics:
- Query response time (< 200ms goal)
- AI generation time (< 5s goal)
- Error rate (< 1% goal)

---

## Notes & References

### Inspired By:
- **researchtoolspy** Starbursting Framework: 5W analysis pattern
- **researchtoolspy** Deception Detection: Actor/entity extraction
- **researchtoolspy** Content Intelligence: Sentiment & topic analysis

### Related Documentation:
- `LESSONS_LEARNED_SIGNAL_CLI.md`: Signal CLI integration patterns
- `SIGNAL_BOT_DOCUMENTATION.md`: Overall bot architecture
- `postgres-client.ts:422-486`: Message retrieval implementation

---

## Change Log

### 2025-11-20:
- Created roadmap document
- Defined Phase 1 priorities (Features 2, 3, 5, 13)
- Added detailed implementation plans
- Included technical considerations

---

*Last Updated: 2025-11-20*
*Status: Planning Phase*
*Owner: Development Team*
