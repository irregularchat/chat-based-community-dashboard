-- Create signal_groups table for Signal bot
-- This table stores information about Signal groups the bot is part of

CREATE TABLE IF NOT EXISTS signal_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  member_count INTEGER DEFAULT 0,
  bot_is_admin BOOLEAN DEFAULT false,
  bot_is_member BOOLEAN DEFAULT false,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on name for faster lookups
CREATE INDEX IF NOT EXISTS idx_signal_groups_name ON signal_groups(name);

-- Create index on last_updated for temporal queries
CREATE INDEX IF NOT EXISTS idx_signal_groups_last_updated ON signal_groups(last_updated);
