-- Migration: 006_qna_breakout_integration
-- Description: Link Q&A questions to breakout rooms and track answered status
-- Created: 2024-12-05

-- =============================================================================
-- 1. Add answered tracking columns to breakout_annotations
-- =============================================================================
-- These columns allow us to track when a question annotation was answered
-- and by whom, enabling separate "Open Questions" vs "Answered Questions"
-- sections in the Discourse report.

ALTER TABLE breakout_annotations
ADD COLUMN IF NOT EXISTS answered_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS answered_by_uuid VARCHAR(255),
ADD COLUMN IF NOT EXISTS answered_by_name VARCHAR(255);

-- =============================================================================
-- 2. Link Q&A questions to breakout rooms
-- =============================================================================
-- When !question is used inside a breakout room, we can link the question
-- to that breakout for context and reporting.

ALTER TABLE q_and_a_questions
ADD COLUMN IF NOT EXISTS breakout_id INTEGER,
ADD COLUMN IF NOT EXISTS annotation_id INTEGER;

-- =============================================================================
-- 3. Indexes for efficient lookups
-- =============================================================================

-- Find all questions for a specific breakout room
CREATE INDEX IF NOT EXISTS idx_qna_breakout
ON q_and_a_questions(breakout_id);

-- Find annotations by status (for filtering open vs answered)
CREATE INDEX IF NOT EXISTS idx_breakout_annotations_status
ON breakout_annotations(breakout_id, status);

-- =============================================================================
-- 4. Update status enum to include 'answered' for questions
-- =============================================================================
-- The status column already exists with 'open', 'done', 'cancelled'
-- We're adding 'answered' as a valid status for question annotations.
-- PostgreSQL doesn't have ENUM constraints by default on VARCHAR, so this
-- is just a documentation note - the application will use 'answered' status.

COMMENT ON COLUMN breakout_annotations.status IS
'Status values: open (default), done, cancelled, answered (for questions)';
