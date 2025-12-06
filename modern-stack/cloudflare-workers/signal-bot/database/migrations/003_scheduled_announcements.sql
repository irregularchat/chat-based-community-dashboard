-- Migration: 003_scheduled_announcements
-- Date: 2025-12-01
-- Description: Add tables for scheduled announcements feature

-- ============================================================================
-- SCHEDULED ANNOUNCEMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS scheduled_announcements (
  id SERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  target_groups JSONB,                          -- Array of group IDs (null = current group)
  target_group_names JSONB,                     -- Array of group names for display
  send_as_dm BOOLEAN DEFAULT false,             -- True = DM each member instead of group message
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255) NOT NULL,             -- Admin UUID or phone
  created_by_name TEXT,                         -- Admin display name
  status VARCHAR(20) DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed', 'cancelled')),
  sent_at TIMESTAMP WITH TIME ZONE,
  recipient_count INTEGER DEFAULT 0,
  error_message TEXT,
  metadata JSONB                                -- Additional context (source group, etc)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_announcements_scheduled ON scheduled_announcements(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_announcements_status ON scheduled_announcements(status);
CREATE INDEX IF NOT EXISTS idx_announcements_created_by ON scheduled_announcements(created_by);
CREATE INDEX IF NOT EXISTS idx_announcements_pending ON scheduled_announcements(status, scheduled_at)
  WHERE status = 'pending';

-- ============================================================================
-- ANNOUNCEMENT DELIVERY LOG
-- ============================================================================

CREATE TABLE IF NOT EXISTS announcement_deliveries (
  id SERIAL PRIMARY KEY,
  announcement_id INTEGER NOT NULL REFERENCES scheduled_announcements(id) ON DELETE CASCADE,
  recipient_type VARCHAR(20) NOT NULL CHECK(recipient_type IN ('group', 'dm')),
  recipient_id VARCHAR(255) NOT NULL,           -- Group ID or phone/UUID
  recipient_name TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
  sent_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_deliveries_announcement ON announcement_deliveries(announcement_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON announcement_deliveries(status);

-- ============================================================================
-- VIEW: Pending Announcements
-- ============================================================================

CREATE OR REPLACE VIEW pending_announcements_view AS
SELECT
  id,
  message,
  target_group_names,
  send_as_dm,
  scheduled_at,
  created_by_name,
  EXTRACT(EPOCH FROM (scheduled_at - CURRENT_TIMESTAMP)) / 60 as minutes_until
FROM scheduled_announcements
WHERE status = 'pending'
  AND scheduled_at > CURRENT_TIMESTAMP
ORDER BY scheduled_at ASC;

-- ============================================================================
-- COMMENT
-- ============================================================================

COMMENT ON TABLE scheduled_announcements IS 'Stores scheduled and sent announcements for the !announce command';
COMMENT ON TABLE announcement_deliveries IS 'Tracks individual delivery attempts for each announcement';
