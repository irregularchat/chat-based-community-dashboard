# Signal Bot Feature Checklist

## Research Summary

Based on git history analysis (commit `010bc502`), the Signal bot previously had **81 commands** across multiple categories. The old implementation used Signal CLI REST API on port 50240.

---

## Currently Implemented ✅ (10 commands)

- [x] `!help` - Show available commands
- [x] `!ping` - Test bot responsiveness
- [x] `!ai` - Ask AI (OpenAI gpt-4o-mini)
- [x] `!ask` - Ask a question (Q&A system)
- [x] `!questions` - List recent questions
- [x] `!answer` - Answer a question
- [x] `!solve` - Mark question as solved
- [x] `!whoami` - Show user info
- [x] `!version` - Bot version
- [x] `!stats` - Bot statistics

---

## Priority 1: Group Management 🔥

### !groups Command
- [ ] List all Signal groups
- [ ] Show member counts
- [ ] Indicate bot admin status (👑 icon)
- [ ] Sort by member count (largest first)
- [ ] Show group IDs for reference
- [ ] Format: Numbered list for easy reference
- **API Available**: `SignalBot.getGroups()` exists at line 487

### !addto Command
- [ ] Add mentioned users to specified group
- [ ] Parse group number from command
- [ ] Extract mentioned users (@username or phone number)
- [ ] Call JSON-RPC `updateGroup` with addMember
- [ ] Show success/failure for each user
- [ ] Admin-only command
- **Depends on**: signal-cli JSON-RPC updateGroup method

---

## Priority 2: URL Security Alerts 🛡️

### Automatic URL Detection
- [ ] Detect all URLs in messages (regex: `https?:\/\/[^\s]+`)
- [ ] Check TLDs against security watchlist
- [ ] Alert on suspicious domains:
  - China: `.cn`, `.com.cn`, `baidu.com`, `qq.com`, `weibo.com`
  - Russia: `.ru`, `.su`, `vk.com`, `yandex.ru`
  - Iran: `.ir`
  - North Korea: `.kp`
- [ ] Send warning message: "👀 Security Notice: This link is hosted in [Country]"
- [ ] User confirmation prompt: "Are you sure this is what you wanted to post?"

### URL Processing Features
- [ ] Detect news URLs (BBC, CNN, Reuters, etc.)
- [ ] Detect repository URLs (GitHub, GitLab, Bitbucket)
- [ ] Detect tracking parameters (utm_, fbclid, ref=)
- [ ] Offer to clean URLs

---

## Priority 3: Core Commands Extension

### !summarize / !tldr
- [ ] Summarize last N messages in group
- [ ] Summarize URL content
- [ ] Use AI (gpt-4o-mini or local AI)
- [ ] Format summary for Signal (no markdown)

### !lai (Local AI)
- [ ] Query local AI instance
- [ ] Fallback to OpenAI if local AI unavailable
- [ ] Support custom localAiUrl from config

### !zeroeth
- [ ] Display Asimov's Zeroeth Law of Robotics
- [ ] Simple static response

### !cleaner
- [ ] Remove tracking parameters from URLs
- [ ] Clean markdown formatting
- [ ] Remove excessive whitespace

---

## Priority 4: Utility Commands

### Time & Random
- [ ] `!time` - Show current time (EST and UTC)
- [ ] `!flip` - Flip a coin (Heads/Tails)
- [ ] `!8ball` - Magic 8-ball responses
- [ ] `!random` - Generate random number
- [ ] `!calc` - Simple calculator

### Fun Commands
- [ ] `!joke` - Random joke
- [ ] `!quote` - Inspirational quote
- [ ] `!fact` - Random fact

---

## Priority 5: Information Commands

### Community Resources
- [ ] `!wiki` - Link to IrregularChat wiki
- [ ] `!forum` - Link to community forum
- [ ] `!links` - Show important links
- [ ] `!faq` - Frequently asked questions
- [ ] `!docs` - Search documentation
- [ ] `!events` - Show upcoming events

---

## Priority 6: Forum Integration (Discourse API)

### Discourse Commands
- [ ] `!fpost <title> <content>` - Create forum post
- [ ] `!flatest` - Show latest forum posts
- [ ] `!fsearch <query>` - Search forum
- [ ] `!categories` - List forum categories
- **Requires**: Discourse API URL, API key, username from config

---

## Priority 7: News Management

### News Commands
- [ ] `!news` - Show recent news items
- [ ] `!newsadd <url>` - Add news item (admin)
- [ ] `!newslist` - List all saved news
- [ ] `!newsremove <id>` - Remove news item (admin)
- **Storage**: Cloudflare D1 table `news_links`

---

## Priority 8: Advanced Admin Commands

### User Management
- [ ] `!gtg @user` - Approve user (Good To Go)
- [ ] `!sngtg @user` - Safety Number Good To Go
- [ ] `!pending` - Show pending user requests
- [ ] `!removeuser @user` - Remove user from group
- **Requires**: Member tracking system in D1

### Analytics Commands
- [ ] `!topcommands` - Most used commands
- [ ] `!topusers` - Most active users
- [ ] `!errors` - Recent bot errors
- [ ] `!newsstats` - News link statistics
- [ ] `!feedback` - Bot feedback sentiment
- [ ] `!watchdomain <domain>` - Manage watched domains

---

## Priority 9: PDF Processing

- [ ] `!pdf <attachment>` - Process PDF attachments
- [ ] Extract text from PDF
- [ ] Summarize PDF content
- [ ] Store in D1 for reference
- **Requires**: PDF parsing library (pdf-parse npm package)

---

## Priority 10: Additional Utility Commands

### Advanced Utilities
- [ ] `!weather <location>` - Weather information
- [ ] `!translate <lang> <text>` - Translate text
- [ ] `!shorten <url>` - Shorten URL
- [ ] `!qr <text>` - Generate QR code
- [ ] `!hash <text>` - SHA256 hash
- [ ] `!base64 <encode|decode> <text>` - Base64 encoding

---

## Technical Implementation Notes

### JSON-RPC Client Extensions Needed
- `updateGroup(groupId, members)` - Add/remove members
- Support for group member management

### Database Tables Needed
```sql
-- News links tracking
CREATE TABLE news_links (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT,
  added_by TEXT,
  added_at TIMESTAMP,
  category TEXT
);

-- URL security tracking
CREATE TABLE suspicious_urls (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  tld TEXT,
  country TEXT,
  reporter TEXT,
  reported_at TIMESTAMP
);

-- Forum posts cache
CREATE TABLE forum_posts_cache (
  id INTEGER PRIMARY KEY,
  post_id INTEGER,
  title TEXT,
  author TEXT,
  created_at TIMESTAMP,
  cached_at TIMESTAMP
);
```

### Configuration Required
```env
# Forum Integration
DISCOURSE_API_URL=https://forum.irregularchat.com
DISCOURSE_API_KEY=your_key_here
DISCOURSE_API_USERNAME=bot_user

# Local AI
LOCAL_AI_URL=http://localhost:8080
LOCAL_AI_API_KEY=optional

# Admin Users
ADMIN_PHONE_NUMBERS=+19108471202,+12247253276

# Security Monitoring
WATCHED_TLDS=.cn,.ru,.ir,.kp
WATCHED_DOMAINS=baidu.com,qq.com,vk.com,yandex.ru
```

---

## Implementation Order

1. **Start with what we know works**: !groups (API exists)
2. **High-value, low-complexity**: Utility commands (time, flip, joke, etc.)
3. **Core functionality**: !summarize, !lai, !zeroeth, !cleaner
4. **Security features**: URL alerts (automatic detection)
5. **Group management**: !addto (requires JSON-RPC extension)
6. **Integration features**: Forum, news management
7. **Advanced admin**: Member tracking, analytics

---

## Testing Strategy

- [ ] Test each command in DM context
- [ ] Test each command in group context
- [ ] Test admin commands with non-admin users (should fail)
- [ ] Test URL detection with various formats
- [ ] Test error handling and edge cases
- [ ] Verify database persistence
- [ ] Performance test with high message volume

---

## Deployment Checklist

- [ ] Update command-handler.ts with new commands
- [ ] Update help text to reflect all commands
- [ ] Run database migrations for new tables
- [ ] Update .env.example with new config options
- [ ] Update SIGNAL_BOT_DOCUMENTATION.md
- [ ] Test in development environment
- [ ] Deploy to production
- [ ] Verify all commands work in production
- [ ] Update LESSONS_LEARNED with any issues

---

**Total Commands Target**: 78-81 commands
**Current Progress**: 10/81 (12%)
**Next Milestone**: Priority 1-3 (30+ commands)
