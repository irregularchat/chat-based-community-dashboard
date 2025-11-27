-- Migration 002: Add Q&A Answers Table
-- Date: 2025-11-19
-- Purpose: Store individual answers with full metadata for better knowledge management

-- ============================================================================
-- Q&A ANSWERS (individual answers with metadata)
-- ============================================================================

CREATE TABLE IF NOT EXISTS q_and_a_answers (
  id TEXT PRIMARY KEY,
  answer_id INTEGER NOT NULL,              -- Sequential ID per question (1, 2, 3...)
  question_id INTEGER NOT NULL,            -- References q_and_a_questions.question_id
  answer TEXT NOT NULL,                    -- The answer content
  answerer TEXT NOT NULL,                  -- Display name of answerer
  answerer_phone TEXT NOT NULL,            -- Phone number of answerer
  group_id TEXT NOT NULL,                  -- Group where answer was posted
  group_name TEXT,                         -- Group display name
  is_solution INTEGER DEFAULT 0,           -- 1 if marked as solution by question author
  marked_solution_at INTEGER,              -- When marked as solution
  upvotes INTEGER DEFAULT 0,               -- Future: voting system
  downvotes INTEGER DEFAULT 0,             -- Future: voting system
  edited INTEGER DEFAULT 0,                -- 1 if answer was edited
  edited_at INTEGER,                       -- When answer was last edited
  timestamp INTEGER NOT NULL,              -- When answer was posted
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (question_id) REFERENCES q_and_a_questions(question_id) ON DELETE CASCADE,
  UNIQUE(question_id, answer_id)
);

CREATE INDEX idx_answers_question ON q_and_a_answers(question_id);
CREATE INDEX idx_answers_answerer ON q_and_a_answers(answerer_phone);
CREATE INDEX idx_answers_group ON q_and_a_answers(group_id);
CREATE INDEX idx_answers_solution ON q_and_a_answers(is_solution);
CREATE INDEX idx_answers_timestamp ON q_and_a_answers(timestamp);

-- ============================================================================
-- Update existing q_and_a_questions table to remove JSON answers field
-- (keep it for backward compatibility but use new table going forward)
-- ============================================================================

-- Add new fields to track solutions
ALTER TABLE q_and_a_questions ADD COLUMN solution_count INTEGER DEFAULT 0;
ALTER TABLE q_and_a_questions ADD COLUMN answer_count INTEGER DEFAULT 0;

-- ============================================================================
-- Create view for easy querying of questions with their answers
-- ============================================================================

CREATE VIEW IF NOT EXISTS q_and_a_full_view AS
SELECT
  q.*,
  COUNT(DISTINCT a.id) as total_answers,
  COUNT(DISTINCT CASE WHEN a.is_solution = 1 THEN a.id END) as total_solutions,
  MAX(a.timestamp) as last_answer_at
FROM q_and_a_questions q
LEFT JOIN q_and_a_answers a ON q.question_id = a.question_id
GROUP BY q.id;

-- ============================================================================
-- END OF MIGRATION 002
-- ============================================================================
