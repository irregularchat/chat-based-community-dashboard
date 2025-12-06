-- Migration: 008_global_tasks
-- Description: Global task tracking system that works both inside and outside breakout rooms
-- Created: 2024-12-05

-- Global Tasks Table
-- Similar to breakout_annotations but works globally across all groups
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,

    -- Task content
    content TEXT NOT NULL,
    raw_content TEXT,  -- Original text before AI extraction

    -- Context (optional links to breakout or group)
    breakout_id INTEGER REFERENCES breakout_rooms(id) ON DELETE SET NULL,
    group_id VARCHAR(255),
    group_name VARCHAR(255),

    -- Creator info
    created_by_uuid VARCHAR(255) NOT NULL,
    created_by_name VARCHAR(255),
    created_by_phone VARCHAR(50),

    -- Assignee info
    assigned_to_uuid VARCHAR(255),
    assigned_to_name VARCHAR(255),
    assigned_to_phone VARCHAR(50),

    -- Status: open, in_progress, done, cancelled, blocked
    status VARCHAR(50) DEFAULT 'open',
    priority VARCHAR(50) DEFAULT 'normal',  -- low, normal, high, urgent

    -- Due date (optional)
    due_date DATE,
    due_reminder_sent BOOLEAN DEFAULT false,

    -- Completion tracking
    completed_at TIMESTAMP,
    completed_by_uuid VARCHAR(255),
    completed_by_name VARCHAR(255),
    completion_notes TEXT,

    -- AI extraction metadata
    ai_extracted BOOLEAN DEFAULT false,
    ai_confidence DECIMAL(3,2),

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Message reference (for linking back to original message)
    source_message_timestamp BIGINT,

    -- Notification tracking
    dm_sent_to_assignee BOOLEAN DEFAULT false,
    dm_sent_at TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assigned_to_uuid, status);
CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(created_by_uuid);
CREATE INDEX IF NOT EXISTS idx_tasks_group ON tasks(group_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_breakout ON tasks(breakout_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date, status) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);

-- Comments for documentation
COMMENT ON TABLE tasks IS 'Global task tracking system for !action and !task commands';
COMMENT ON COLUMN tasks.breakout_id IS 'Optional link to breakout room if task was created in one';
COMMENT ON COLUMN tasks.raw_content IS 'Original message text before AI extraction';
COMMENT ON COLUMN tasks.ai_extracted IS 'True if task content was cleaned up by AI';
