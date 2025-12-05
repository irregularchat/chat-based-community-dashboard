-- Migration: 005_breakout_rooms
-- Description: Breakout room system with rich metadata extraction for focused discussions
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
    unique_participants INTEGER DEFAULT 0,

    -- Extension tracking
    extension_count INTEGER DEFAULT 0,
    max_extensions INTEGER DEFAULT 3
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
