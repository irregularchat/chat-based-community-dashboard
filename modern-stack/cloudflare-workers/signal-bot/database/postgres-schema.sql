-- PostgreSQL Schema for Self-Hosted Signal Bot
-- Migrated from Cloudflare D1 (SQLite) with PostgreSQL enhancements
-- Date: 2025-11-19

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable full-text search
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================================
-- USERS & AUTHENTICATION
-- ============================================================================

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE,
  email VARCHAR(255),
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  password VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  is_admin BOOLEAN DEFAULT false,
  is_moderator BOOLEAN DEFAULT false,
  date_joined TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP WITH TIME ZONE,
  attributes JSONB,
  authentik_id VARCHAR(255) UNIQUE,
  signal_identity TEXT,
  signal_verified BOOLEAN DEFAULT false,
  signal_phone_number VARCHAR(50),
  matrix_username VARCHAR(255)
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_signal_phone ON users(signal_phone_number);
CREATE INDEX idx_users_is_admin ON users(is_admin);

-- ============================================================================
-- SIGNAL GROUPS
-- ============================================================================

CREATE TABLE signal_groups (
  id VARCHAR(255) PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  member_count INTEGER DEFAULT 0,
  bot_is_admin BOOLEAN DEFAULT false,
  bot_is_member BOOLEAN DEFAULT true,
  group_type VARCHAR(50),
  invite_link TEXT,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_signal_groups_member_count ON signal_groups(member_count);
CREATE INDEX idx_signal_groups_last_updated ON signal_groups(last_updated);
CREATE INDEX idx_signal_groups_bot_is_admin ON signal_groups(bot_is_admin);

-- ============================================================================
-- SIGNAL GROUP MEMBERSHIPS
-- ============================================================================

CREATE TABLE signal_group_memberships (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  group_id VARCHAR(255) NOT NULL,
  group_name TEXT,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) DEFAULT 'active' CHECK(status IN ('active', 'left', 'removed')),
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
  id SERIAL PRIMARY KEY,
  group_id VARCHAR(255) UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_public BOOLEAN DEFAULT true,
  requires_approval BOOLEAN DEFAULT false,
  max_members INTEGER,
  admin_user_id INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  FOREIGN KEY (admin_user_id) REFERENCES users(id)
);

CREATE INDEX idx_available_groups_public ON signal_available_groups(is_public);
CREATE INDEX idx_available_groups_active ON signal_available_groups(is_active);
CREATE INDEX idx_available_groups_order ON signal_available_groups(display_order);

-- ============================================================================
-- SIGNAL GROUP JOIN REQUESTS
-- ============================================================================

CREATE TABLE signal_group_join_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  group_id VARCHAR(255) NOT NULL,
  message TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'denied')),
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP WITH TIME ZONE,
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
  id VARCHAR(255) PRIMARY KEY,
  group_id VARCHAR(255),
  group_name TEXT,
  source_number VARCHAR(50),
  source_name TEXT,
  source_uuid VARCHAR(255),
  message TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  attachments JSONB,
  mentions JSONB,
  is_reply BOOLEAN DEFAULT false,
  quoted_message_id VARCHAR(255),
  quoted_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (quoted_message_id) REFERENCES signal_messages(id)
);

CREATE UNIQUE INDEX idx_messages_unique ON signal_messages(timestamp, source_number, COALESCE(group_id, ''));
CREATE INDEX idx_messages_group ON signal_messages(group_id);
CREATE INDEX idx_messages_source ON signal_messages(source_number);
CREATE INDEX idx_messages_timestamp ON signal_messages(timestamp);
CREATE INDEX idx_messages_created ON signal_messages(created_at);

-- Full-text search on messages
CREATE INDEX idx_messages_search ON signal_messages USING gin(to_tsvector('english', message));

-- ============================================================================
-- SIGNAL REACTIONS
-- ============================================================================

CREATE TABLE signal_reactions (
  id VARCHAR(255) PRIMARY KEY,
  message_id VARCHAR(255) NOT NULL,
  emoji VARCHAR(50) NOT NULL,
  reactor_number VARCHAR(50) NOT NULL,
  reactor_name TEXT,
  reactor_uuid VARCHAR(255),
  timestamp BIGINT NOT NULL,
  is_remove BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
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
  id VARCHAR(255) PRIMARY KEY,
  uuid VARCHAR(255) UNIQUE,
  phone_number VARCHAR(50),
  display_name TEXT,
  first_name TEXT,
  last_name TEXT,
  profile_name TEXT,
  profile_picture TEXT,
  is_bot BOOLEAN DEFAULT false,
  last_seen_at TIMESTAMP WITH TIME ZONE,
  first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  total_groups INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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
  id VARCHAR(255) PRIMARY KEY,
  member_id VARCHAR(255) NOT NULL,
  group_id VARCHAR(255) NOT NULL,
  group_name TEXT,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_active_at TIMESTAMP WITH TIME ZONE,
  message_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  left_at TIMESTAMP WITH TIME ZONE,
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
  id VARCHAR(255) PRIMARY KEY,
  url TEXT NOT NULL,
  domain VARCHAR(255),
  title TEXT,
  summary TEXT,
  group_id VARCHAR(255) NOT NULL,
  group_name TEXT,
  posted_by VARCHAR(50) NOT NULL,
  posted_by_name TEXT,
  forum_url TEXT,
  post_count INTEGER DEFAULT 1,
  reaction_count INTEGER DEFAULT 0,
  thumbs_up INTEGER DEFAULT 0,
  thumbs_down INTEGER DEFAULT 0,
  first_posted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_posted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
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
  id VARCHAR(255) PRIMARY KEY,
  url TEXT NOT NULL,
  platform VARCHAR(50) NOT NULL,
  repository_name TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  language VARCHAR(100),
  stars INTEGER DEFAULT 0,
  forks INTEGER DEFAULT 0,
  open_issues INTEGER DEFAULT 0,
  license VARCHAR(100),
  topics JSONB,
  is_private BOOLEAN DEFAULT false,
  is_fork BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  last_updated TIMESTAMP WITH TIME ZONE,
  group_id VARCHAR(255) NOT NULL,
  group_name TEXT,
  posted_by VARCHAR(50) NOT NULL,
  posted_by_name TEXT,
  post_count INTEGER DEFAULT 1,
  first_posted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  last_posted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
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
  id VARCHAR(255) PRIMARY KEY,
  url TEXT NOT NULL,
  group_id VARCHAR(255),
  group_name TEXT,
  requested_by VARCHAR(50) NOT NULL,
  requested_by_name TEXT,
  summary TEXT NOT NULL,
  ai_provider VARCHAR(50),
  processing_time INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_summaries_url ON url_summaries(url);
CREATE INDEX idx_summaries_group ON url_summaries(group_id);
CREATE INDEX idx_summaries_requester ON url_summaries(requested_by);
CREATE INDEX idx_summaries_created ON url_summaries(created_at);

-- ============================================================================
-- BOT COMMAND USAGE (Analytics)
-- ============================================================================

CREATE TABLE bot_command_usage (
  id VARCHAR(255) PRIMARY KEY,
  command VARCHAR(100) NOT NULL,
  args TEXT,
  group_id VARCHAR(255),
  group_name TEXT,
  user_id VARCHAR(50) NOT NULL,
  user_name TEXT,
  success BOOLEAN DEFAULT true,
  response_time INTEGER,
  error_message TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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
  id VARCHAR(255) PRIMARY KEY,
  bot_message_id VARCHAR(255),
  bot_message TEXT NOT NULL,
  group_id VARCHAR(255),
  group_name TEXT,
  reactor_id VARCHAR(50) NOT NULL,
  reactor_name TEXT,
  reaction VARCHAR(50) NOT NULL,
  is_positive BOOLEAN,
  command VARCHAR(100),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
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
  id VARCHAR(255) PRIMARY KEY,
  error_type VARCHAR(100) NOT NULL,
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  command VARCHAR(100),
  group_id VARCHAR(255),
  group_name TEXT,
  user_id VARCHAR(50),
  user_name TEXT,
  context JSONB,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_errors_type ON bot_errors(error_type);
CREATE INDEX idx_errors_command ON bot_errors(command);
CREATE INDEX idx_errors_group ON bot_errors(group_id);
CREATE INDEX idx_errors_timestamp ON bot_errors(timestamp);

-- ============================================================================
-- Q&A SYSTEM - QUESTIONS
-- ============================================================================

CREATE TABLE q_and_a_questions (
  id VARCHAR(255) PRIMARY KEY,
  question_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  title TEXT,
  asker TEXT NOT NULL,
  asker_phone VARCHAR(50) NOT NULL,
  group_id VARCHAR(255) NOT NULL,
  group_name TEXT,
  solved BOOLEAN DEFAULT false,
  solved_by VARCHAR(50),
  solved_at TIMESTAMP WITH TIME ZONE,
  discourse_topic_id VARCHAR(255),
  forum_link TEXT,
  timestamp BIGINT NOT NULL,
  answer_count INTEGER DEFAULT 0,
  solution_count INTEGER DEFAULT 0,
  answers JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, question_id)
);

CREATE INDEX idx_questions_id ON q_and_a_questions(question_id);
CREATE INDEX idx_questions_group ON q_and_a_questions(group_id);
CREATE INDEX idx_questions_asker ON q_and_a_questions(asker_phone);
CREATE INDEX idx_questions_solved ON q_and_a_questions(solved);
CREATE INDEX idx_questions_timestamp ON q_and_a_questions(timestamp);

-- Full-text search on questions
CREATE INDEX idx_questions_search ON q_and_a_questions USING gin(to_tsvector('english', question));

-- ============================================================================
-- Q&A SYSTEM - ANSWERS
-- ============================================================================

CREATE TABLE q_and_a_answers (
  id VARCHAR(255) PRIMARY KEY,
  answer_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  answer TEXT NOT NULL,
  answerer TEXT NOT NULL,
  answerer_phone VARCHAR(50) NOT NULL,
  group_id VARCHAR(255) NOT NULL,
  group_name TEXT,
  is_solution BOOLEAN DEFAULT false,
  marked_solution_at TIMESTAMP WITH TIME ZONE,
  upvotes INTEGER DEFAULT 0,
  downvotes INTEGER DEFAULT 0,
  edited BOOLEAN DEFAULT false,
  edited_at TIMESTAMP WITH TIME ZONE,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(question_id, answer_id, group_id)
);

CREATE INDEX idx_answers_question ON q_and_a_answers(question_id);
CREATE INDEX idx_answers_answerer ON q_and_a_answers(answerer_phone);
CREATE INDEX idx_answers_group ON q_and_a_answers(group_id);
CREATE INDEX idx_answers_solution ON q_and_a_answers(is_solution);
CREATE INDEX idx_answers_timestamp ON q_and_a_answers(timestamp);

-- Full-text search on answers
CREATE INDEX idx_answers_search ON q_and_a_answers USING gin(to_tsvector('english', answer));

-- ============================================================================
-- SIGNAL VERIFICATION CODES
-- ============================================================================

CREATE TABLE signal_verification_codes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  phone_number VARCHAR(50) NOT NULL,
  code VARCHAR(20) NOT NULL,
  salt VARCHAR(255) NOT NULL,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  verified BOOLEAN DEFAULT false,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
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
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  username VARCHAR(255) NOT NULL,
  details TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  is_public BOOLEAN DEFAULT true,
  category VARCHAR(100)
);

CREATE INDEX idx_events_timestamp ON community_events(timestamp);
CREATE INDEX idx_events_type ON community_events(event_type);
CREATE INDEX idx_events_public ON community_events(is_public);

-- ============================================================================
-- ADMIN EVENTS
-- ============================================================================

CREATE TABLE admin_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  username VARCHAR(255),
  details TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_admin_events_type ON admin_events(event_type);
CREATE INDEX idx_admin_events_timestamp ON admin_events(timestamp);

-- ============================================================================
-- DASHBOARD SETTINGS
-- ============================================================================

CREATE TABLE dashboard_settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) UNIQUE NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_settings_key ON dashboard_settings(key);

-- ============================================================================
-- SIGNAL EVENTS (Calendar)
-- ============================================================================

CREATE TABLE signal_events (
  id SERIAL PRIMARY KEY,
  discourse_topic_id INTEGER UNIQUE,
  discourse_post_id INTEGER,
  event_name TEXT NOT NULL,
  event_start TIMESTAMP WITH TIME ZONE NOT NULL,
  event_end TIMESTAMP WITH TIME ZONE,
  location TEXT,
  timezone VARCHAR(100) DEFAULT 'America/New_York',
  status VARCHAR(50) DEFAULT 'public',
  description TEXT,
  discourse_url TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
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
LEFT JOIN signal_member_group_memberships m ON g.id = m.group_id AND m.is_active = true
GROUP BY g.id;

-- Recent messages by group
CREATE VIEW recent_messages_view AS
SELECT
  group_id,
  group_name,
  COUNT(*) as message_count,
  MAX(timestamp) as last_message_at
FROM signal_messages
WHERE timestamp > EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - INTERVAL '30 days'))
GROUP BY group_id, group_name;

-- Command usage statistics
CREATE VIEW command_stats_view AS
SELECT
  command,
  COUNT(*) as total_uses,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) as successful_uses,
  AVG(response_time) as avg_response_time,
  MAX(timestamp) as last_used
FROM bot_command_usage
GROUP BY command;

-- Q&A with answers
CREATE VIEW q_and_a_full_view AS
SELECT
  q.*,
  COUNT(DISTINCT a.id) as total_answers,
  COUNT(DISTINCT CASE WHEN a.is_solution THEN a.id END) as total_solutions,
  MAX(a.timestamp) as last_answer_at
FROM q_and_a_questions q
LEFT JOIN q_and_a_answers a ON q.question_id = a.question_id AND q.group_id = a.group_id
GROUP BY q.id;

-- ============================================================================
-- TRIGGERS FOR AUTO-UPDATING TIMESTAMPS
-- ============================================================================

-- Update signal_members.updated_at on UPDATE
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_signal_members_updated_at BEFORE UPDATE ON signal_members
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_dashboard_settings_updated_at BEFORE UPDATE ON dashboard_settings
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_signal_events_updated_at BEFORE UPDATE ON signal_events
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
