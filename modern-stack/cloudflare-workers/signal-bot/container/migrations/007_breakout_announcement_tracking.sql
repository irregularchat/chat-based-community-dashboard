-- Migration: 007_breakout_announcement_tracking
-- Description: Track announcement message timestamp for emoji-to-join feature
-- Created: 2024-12-05

-- Add column to store the announcement message timestamp
-- This allows us to match incoming reactions to breakout announcements
ALTER TABLE breakout_rooms
ADD COLUMN IF NOT EXISTS announcement_timestamp BIGINT,
ADD COLUMN IF NOT EXISTS announcement_group_id VARCHAR(255);

-- Index for efficient lookup when reactions come in
CREATE INDEX IF NOT EXISTS idx_breakout_announcement
ON breakout_rooms(announcement_group_id, announcement_timestamp)
WHERE status = 'active';

COMMENT ON COLUMN breakout_rooms.announcement_timestamp IS
'Timestamp of the announcement message in the parent group, used for emoji-to-join matching';

COMMENT ON COLUMN breakout_rooms.announcement_group_id IS
'Group ID where the announcement was posted (parent group)';
