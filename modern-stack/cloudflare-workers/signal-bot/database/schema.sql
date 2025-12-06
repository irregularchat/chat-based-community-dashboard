-- Cloudflare D1 Schema for Signal Bot
-- Converted from PostgreSQL schema
-- SQLite-compatible (D1 is built on SQLite)

-- ============================================================================
-- USERS & AUTHENTICATION
-- ============================================================================

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  password TEXT,
  is_active INTEGER DEFAULT 1,
  is_admin INTEGER DEFAULT 0,
  is_moderator INTEGER DEFAULT 0,
  date_joined INTEGER DEFAULT (strftime('%s', 'now')),
  last_login INTEGER,
  attributes TEXT, -- JSON
  authentik_id TEXT UNIQUE,
  signal_identity TEXT,
  signal_verified INTEGER DEFAULT 0,
  signal_phone_number TEXT,
  matrix_username TEXT
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_signal_phone ON users(signal_phone_number);
CREATE INDEX idx_users_is_admin ON users(is_admin);

-- ============================================================================
-- SIGNAL GROUPS
-- ============================================================================

CREATE TABLE signal_groups (
  id TEXT PRIMARY KEY, -- Signal group ID
  name TEXT NOT NULL,
  description TEXT,
  member_count INTEGER DEFAULT 0,
  bot_is_admin INTEGER DEFAULT 0,
  bot_is_member INTEGER DEFAULT 1,
  group_type TEXT, -- "normal", "announcement", etc.
  invite_link TEXT,
  last_updated INTEGER DEFAULT (strftime('%s', 'now')),
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_signal_groups_member_count ON signal_groups(member_count);
CREATE INDEX idx_signal_groups_last_updated ON signal_groups(last_updated);
CREATE INDEX idx_signal_groups_bot_is_admin ON signal_groups(bot_is_admin);

-- ============================================================================
-- SIGNAL GROUP MEMBERSHIPS
-- ============================================================================

CREATE TABLE signal_group_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  group_id TEXT NOT NULL,
  group_name TEXT,
  joined_at INTEGER DEFAULT (strftime('%s', 'now')),
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'left', 'removed')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, group_id)
);

CREATE INDEX idx_signal_memberships_user ON signal_group_memberships(user_id);
CREATE INDEX idx_signal_memberships_group ON signal_group_memberships(group_id);
CREATE INDEX idx_signal_memberships_status ON signal_group_memberships(status);

-- ============================================================================
-- SIGNAL AVAILABLE GROUPS (Discovery)
-- ============================================================================

CREATE TABLE signal_available_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_public INTEGER DEFAULT 1,
  requires_approval INTEGER DEFAULT 0,
  max_members INTEGER,
  admin_user_id INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  display_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (admin_user_id) REFERENCES users(id)
);

CREATE INDEX idx_available_groups_public ON signal_available_groups(is_public);
CREATE INDEX idx_available_groups_active ON signal_available_groups(is_active);
CREATE INDEX idx_available_groups_order ON signal_available_groups(display_order);

-- ============================================================================
-- SIGNAL GROUP JOIN REQUESTS
-- ============================================================================

CREATE TABLE signal_group_join_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  group_id TEXT NOT NULL,
  message TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'denied')),
  requested_at INTEGER DEFAULT (strftime('%s', 'now')),
  processed_at INTEGER,
  processed_by INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (processed_by) REFERENCES users(id),
  FOREIGN KEY (group_id) REFERENCES signal_available_groups(group_id),
  UNIQUE(user_id, group_id)
);

CREATE INDEX idx_join_requests_user ON signal_group_join_requests(user_id);
CREATE INDEX idx_join_requests_group ON signal_group_join_requests(group_id);
CREATE INDEX idx_join_requests_status ON signal_group_join_requests(status);
CREATE INDEX idx_join_requests_requested ON signal_group_join_requests(requested_at);

-- ============================================================================
-- SIGNAL MESSAGES
-- ============================================================================

CREATE TABLE signal_messages (
  id TEXT PRIMARY KEY,
  group_id TEXT,
  group_name TEXT,
  source_number TEXT,
  source_name TEXT,
  source_uuid TEXT,
  message TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  attachments TEXT, -- JSON
  mentions TEXT, -- JSON
  is_reply INTEGER DEFAULT 0,
  quoted_message_id TEXT,
  quoted_text TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (quoted_message_id) REFERENCES signal_messages(id)
);

CREATE UNIQUE INDEX idx_messages_unique ON signal_messages(timestamp, source_number, group_id);
CREATE INDEX idx_messages_group ON signal_messages(group_id);
CREATE INDEX idx_messages_source ON signal_messages(source_number);
CREATE INDEX idx_messages_timestamp ON signal_messages(timestamp);
CREATE INDEX idx_messages_created ON signal_messages(created_at);

-- ============================================================================
-- SIGNAL REACTIONS
-- ============================================================================

CREATE TABLE signal_reactions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  reactor_number TEXT NOT NULL,
  reactor_name TEXT,
  reactor_uuid TEXT,
  timestamp INTEGER NOT NULL,
  is_remove INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (message_id) REFERENCES signal_messages(id) ON DELETE CASCADE,
  UNIQUE(message_id, emoji, reactor_number)
);

CREATE INDEX idx_reactions_message ON signal_reactions(message_id);
CREATE INDEX idx_reactions_reactor ON signal_reactions(reactor_number);
CREATE INDEX idx_reactions_timestamp ON signal_reactions(timestamp);

-- ============================================================================
-- SIGNAL MEMBERS (Deduplicated)
-- ============================================================================

CREATE TABLE signal_members (
  id TEXT PRIMARY KEY,
  uuid TEXT UNIQUE,
  phone_number TEXT,
  display_name TEXT,
  first_name TEXT,
  last_name TEXT,
  profile_name TEXT,
  profile_picture TEXT,
  is_bot INTEGER DEFAULT 0,
  last_seen_at INTEGER,
  first_seen_at INTEGER DEFAULT (strftime('%s', 'now')),
  total_groups INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_members_uuid ON signal_members(uuid);
CREATE INDEX idx_members_phone ON signal_members(phone_number);
CREATE INDEX idx_members_last_seen ON signal_members(last_seen_at);
CREATE INDEX idx_members_total_groups ON signal_members(total_groups);
CREATE INDEX idx_members_total_messages ON signal_members(total_messages);

-- ============================================================================
-- SIGNAL MEMBER GROUP MEMBERSHIPS
-- ============================================================================

CREATE TABLE signal_member_group_memberships (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  group_name TEXT,
  joined_at INTEGER DEFAULT (strftime('%s', 'now')),
  last_active_at INTEGER,
  message_count INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  left_at INTEGER,
  FOREIGN KEY (member_id) REFERENCES signal_members(id) ON DELETE CASCADE,
  UNIQUE(member_id, group_id)
);

CREATE INDEX idx_member_groups_member ON signal_member_group_memberships(member_id);
CREATE INDEX idx_member_groups_group ON signal_member_group_memberships(group_id);
CREATE INDEX idx_member_groups_active ON signal_member_group_memberships(last_active_at);
CREATE INDEX idx_member_groups_is_active ON signal_member_group_memberships(is_active);

-- ============================================================================
-- NEWS LINKS
-- ============================================================================

CREATE TABLE news_links (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  domain TEXT,
  title TEXT,
  summary TEXT,
  group_id TEXT NOT NULL,
  group_name TEXT,
  posted_by TEXT NOT NULL,
  posted_by_name TEXT,
  forum_url TEXT,
  post_count INTEGER DEFAULT 1,
  reaction_count INTEGER DEFAULT 0,
  thumbs_up INTEGER DEFAULT 0,
  thumbs_down INTEGER DEFAULT 0,
  first_posted_at INTEGER DEFAULT (strftime('%s', 'now')),
  last_posted_at INTEGER DEFAULT (strftime('%s', 'now')),
  UNIQUE(url, group_id)
);

CREATE INDEX idx_news_group ON news_links(group_id);
CREATE INDEX idx_news_domain ON news_links(domain);
CREATE INDEX idx_news_poster ON news_links(posted_by);
CREATE INDEX idx_news_first_posted ON news_links(first_posted_at);

-- ============================================================================
-- REPOSITORY LINKS (GitHub/GitLab)
-- ============================================================================

CREATE TABLE repository_links (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  platform TEXT NOT NULL,
  repository_name TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  language TEXT,
  stars INTEGER DEFAULT 0,
  forks INTEGER DEFAULT 0,
  open_issues INTEGER DEFAULT 0,
  license TEXT,
  topics TEXT, -- JSON
  is_private INTEGER DEFAULT 0,
  is_fork INTEGER DEFAULT 0,
  is_archived INTEGER DEFAULT 0,
  last_updated INTEGER,
  group_id TEXT NOT NULL,
  group_name TEXT,
  posted_by TEXT NOT NULL,
  posted_by_name TEXT,
  post_count INTEGER DEFAULT 1,
  first_posted_at INTEGER DEFAULT (strftime('%s', 'now')),
  last_posted_at INTEGER DEFAULT (strftime('%s', 'now')),
  UNIQUE(url, group_id)
);

CREATE INDEX idx_repos_group ON repository_links(group_id);
CREATE INDEX idx_repos_platform ON repository_links(platform);
CREATE INDEX idx_repos_language ON repository_links(language);
CREATE INDEX idx_repos_owner ON repository_links(owner);
CREATE INDEX idx_repos_poster ON repository_links(posted_by);
CREATE INDEX idx_repos_first_posted ON repository_links(first_posted_at);
CREATE INDEX idx_repos_stars ON repository_links(stars);

-- ============================================================================
-- URL SUMMARIES (!tldr command)
-- ============================================================================

CREATE TABLE url_summaries (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  group_id TEXT,
  group_name TEXT,
  requested_by TEXT NOT NULL,
  requested_by_name TEXT,
  summary TEXT NOT NULL,
  ai_provider TEXT,
  processing_time INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_summaries_url ON url_summaries(url);
CREATE INDEX idx_summaries_group ON url_summaries(group_id);
CREATE INDEX idx_summaries_requester ON url_summaries(requested_by);
CREATE INDEX idx_summaries_created ON url_summaries(created_at);

-- ============================================================================
-- BOT COMMAND USAGE (Analytics)
-- ============================================================================

CREATE TABLE bot_command_usage (
  id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  args TEXT,
  group_id TEXT,
  group_name TEXT,
  user_id TEXT NOT NULL,
  user_name TEXT,
  success INTEGER DEFAULT 1,
  response_time INTEGER,
  error_message TEXT,
  timestamp INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_commands_command ON bot_command_usage(command);
CREATE INDEX idx_commands_group ON bot_command_usage(group_id);
CREATE INDEX idx_commands_user ON bot_command_usage(user_id);
CREATE INDEX idx_commands_timestamp ON bot_command_usage(timestamp);
CREATE INDEX idx_commands_success ON bot_command_usage(success);

-- ============================================================================
-- BOT MESSAGE REACTIONS
-- ============================================================================

CREATE TABLE bot_message_reactions (
  id TEXT PRIMARY KEY,
  bot_message_id TEXT,
  bot_message TEXT NOT NULL,
  group_id TEXT,
  group_name TEXT,
  reactor_id TEXT NOT NULL,
  reactor_name TEXT,
  reaction TEXT NOT NULL,
  is_positive INTEGER, -- 1 for 👍, 0 for 👎, NULL for others
  command TEXT,
  timestamp INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_bot_reactions_group ON bot_message_reactions(group_id);
CREATE INDEX idx_bot_reactions_reactor ON bot_message_reactions(reactor_id);
CREATE INDEX idx_bot_reactions_reaction ON bot_message_reactions(reaction);
CREATE INDEX idx_bot_reactions_positive ON bot_message_reactions(is_positive);
CREATE INDEX idx_bot_reactions_command ON bot_message_reactions(command);
CREATE INDEX idx_bot_reactions_timestamp ON bot_message_reactions(timestamp);

-- ============================================================================
-- BOT ERRORS
-- ============================================================================

CREATE TABLE bot_errors (
  id TEXT PRIMARY KEY,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  command TEXT,
  group_id TEXT,
  group_name TEXT,
  user_id TEXT,
  user_name TEXT,
  context TEXT, -- JSON
  timestamp INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_errors_type ON bot_errors(error_type);
CREATE INDEX idx_errors_command ON bot_errors(command);
CREATE INDEX idx_errors_group ON bot_errors(group_id);
CREATE INDEX idx_errors_timestamp ON bot_errors(timestamp);

-- ============================================================================
-- Q&A SYSTEM
-- ============================================================================

CREATE TABLE q_and_a_questions (
  id TEXT PRIMARY KEY,
  question_id INTEGER UNIQUE NOT NULL,
  question TEXT NOT NULL,
  title TEXT,
  asker TEXT NOT NULL,
  asker_phone TEXT NOT NULL,
  group_id TEXT NOT NULL,
  group_name TEXT,
  solved INTEGER DEFAULT 0,
  solved_by TEXT,
  solved_at INTEGER,
  discourse_topic_id TEXT,
  forum_link TEXT,
  timestamp INTEGER DEFAULT (strftime('%s', 'now')),
  answers TEXT -- JSON array
);

CREATE INDEX idx_questions_id ON q_and_a_questions(question_id);
CREATE INDEX idx_questions_group ON q_and_a_questions(group_id);
CREATE INDEX idx_questions_asker ON q_and_a_questions(asker_phone);
CREATE INDEX idx_questions_solved ON q_and_a_questions(solved);
CREATE INDEX idx_questions_timestamp ON q_and_a_questions(timestamp);

-- ============================================================================
-- SIGNAL VERIFICATION CODES
-- ============================================================================

CREATE TABLE signal_verification_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  phone_number TEXT NOT NULL,
  code TEXT NOT NULL,
  salt TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  verified INTEGER DEFAULT 0,
  expires_at INTEGER NOT NULL,
  verified_at INTEGER,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_verification_user ON signal_verification_codes(user_id);
CREATE INDEX idx_verification_phone ON signal_verification_codes(phone_number);
CREATE INDEX idx_verification_expires ON signal_verification_codes(expires_at);
CREATE INDEX idx_verification_verified ON signal_verification_codes(verified);

-- ============================================================================
-- COMMUNITY EVENTS
-- ============================================================================

CREATE TABLE community_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  username TEXT NOT NULL,
  details TEXT NOT NULL,
  timestamp INTEGER DEFAULT (strftime('%s', 'now')),
  is_public INTEGER DEFAULT 1,
  category TEXT
);

CREATE INDEX idx_events_timestamp ON community_events(timestamp);
CREATE INDEX idx_events_type ON community_events(event_type);
CREATE INDEX idx_events_public ON community_events(is_public);

-- ============================================================================
-- ADMIN EVENTS
-- ============================================================================

CREATE TABLE admin_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  username TEXT,
  details TEXT,
  timestamp INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_admin_events_type ON admin_events(event_type);
CREATE INDEX idx_admin_events_timestamp ON admin_events(timestamp);

-- ============================================================================
-- DASHBOARD SETTINGS
-- ============================================================================

CREATE TABLE dashboard_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL, -- JSON
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_settings_key ON dashboard_settings(key);

-- ============================================================================
-- SIGNAL EVENTS (Calendar)
-- ============================================================================

CREATE TABLE signal_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discourse_topic_id INTEGER UNIQUE,
  discourse_post_id INTEGER,
  event_name TEXT NOT NULL,
  event_start INTEGER NOT NULL,
  event_end INTEGER,
  location TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  status TEXT DEFAULT 'public',
  description TEXT,
  discourse_url TEXT,
  created_by TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now')),
  is_active INTEGER DEFAULT 1,
  allowed_groups TEXT DEFAULT 'trust_level_0',
  reminders TEXT DEFAULT 'notification.3.days,bumpTopic.1.days',
  raw_discourse_syntax TEXT
);

CREATE INDEX idx_signal_events_start ON signal_events(event_start);
CREATE INDEX idx_signal_events_active ON signal_events(is_active);
CREATE INDEX idx_signal_events_creator ON signal_events(created_by);

-- ============================================================================
-- VIEWS FOR COMMON QUERIES
-- ============================================================================

-- Active groups with member counts
CREATE VIEW active_groups_view AS
SELECT
  g.*,
  COUNT(DISTINCT m.member_id) as actual_member_count
FROM signal_groups g
LEFT JOIN signal_member_group_memberships m ON g.id = m.group_id AND m.is_active = 1
GROUP BY g.id;

-- Recent messages by group
CREATE VIEW recent_messages_view AS
SELECT
  group_id,
  group_name,
  COUNT(*) as message_count,
  MAX(timestamp) as last_message_at
FROM signal_messages
WHERE timestamp > strftime('%s', 'now', '-30 days')
GROUP BY group_id;

-- Command usage statistics
CREATE VIEW command_stats_view AS
SELECT
  command,
  COUNT(*) as total_uses,
  SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_uses,
  AVG(response_time) as avg_response_time,
  MAX(timestamp) as last_used
FROM bot_command_usage
GROUP BY command;

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
