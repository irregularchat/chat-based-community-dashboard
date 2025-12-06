# Salvaged Features Integration Plan

## Discovery Summary

Found comprehensive implementations in `/modern-stack/archive/experimental/`:

### 1. **remote-scraper-plugin.js**
Complete web scraping system with:
- ✅ **Automatic news domain detection** (55+ major news sites including CNN, BBC, Reuters, etc.)
- ✅ **Mozilla Readability integration** for clean article extraction
- ✅ **Paywall bypass methods** (Archive.org, 12ft.io, Outline.com, etc.)
- ✅ **AI-powered summarization** via AI plugin
- ✅ **Auto-detection hook** (`detectNewsUrls`) - commented out but fully implemented
- ✅ **Rate limiting** for auto-posts (1 per minute)
- ✅ **Statistics tracking** (detected, posted, failed counts)

### 2. **remote-discourse-plugin.js**
Complete Discourse forum integration with:
- ✅ **Auto-posting to Discourse** via `autoPostNews` hook
- ✅ **Smart categorization** using AI to analyze content
- ✅ **Tag management** with required tags
- ✅ **Duplicate detection** to prevent re-posting same URLs
- ✅ **Post queue system** with delays between posts
- ✅ **Category/tag loading** from Discourse API
- ✅ **Full CRUD operations** for forum posts

## Current Bot Architecture

**Location**: `/cloudflare-workers/signal-bot/container/src/`

**Key Files**:
- `bot/signal-bot-v2.ts` - Main bot with JSON-RPC
- `api/worker-api-client.ts` - Has `saveNewsLink()` method (unused)
- `utils/url-security.ts` - URL extraction (already working)

**Missing**:
- Article scraping logic
- AI summarization integration
- Discourse posting
- Automatic URL detection for news domains

## Integration Plan

### Phase 1: Port URL Detection & Scraping

**Add to `signal-bot-v2.ts` in handleMessage():**

```typescript
// After URL security checks (line ~425)
if (urlAlerts.length === 0) {
  // No security issues, check if it's a news URL
  const newsUrls = this.detectNewsUrls(messageText);
  if (newsUrls.length > 0) {
    for (const url of newsUrls) {
      await this.handleNewsUrl(url, {
        sourceNumber,
        sourceName,
        groupId,
        timestamp
      });
    }
  }
}
```

**Add methods from scraper plugin:**
- `detectNewsUrls()` - Check against news domains list
- `isNewsDomain()` - Domain matching logic
- `scrapeArticle()` - Fetch and parse article using Readability
- `generateSummary()` - Call Worker API for AI summarization

### Phase 2: Discourse Integration

**Use existing Worker API pattern:**

```typescript
// In worker-api-client.ts, add:
async postToDiscourse(post: {
  title: string;
  content: string;
  url: string;
  category?: string;
  tags?: string[];
}): Promise<{ topicId: number; url: string }> {
  return this.request('/api/discourse/post', {
    method: 'POST',
    body: JSON.stringify(post)
  });
}
```

**Worker needs new endpoint:**
- `/api/discourse/post` - Creates Discourse topic
- Uses environment variables for Discourse credentials
- Returns topic ID and URL

### Phase 3: Complete Workflow

**Flow**:
1. User posts CNN URL → Bot receives message
2. URL security check (already working) → No issues
3. `detectNewsUrls()` → CNN.com is a news domain
4. `scrapeArticle()` → Fetch article content via Worker
5. Worker calls GPT-5-mini → Generate summary
6. Worker posts to Discourse → Returns topic URL
7. `saveNewsLink()` → Save to D1 database
8. Bot replies → "📰 Article posted to forum: [link]"

## Files to Create/Modify

### New Files:
1. `container/src/utils/news-detector.ts` - News domain detection
2. `container/src/utils/article-scraper.ts` - Scraping logic
3. `worker/src/routes/discourse.ts` - Discourse API endpoints
4. `worker/src/services/scraper.ts` - Article fetching service

### Modified Files:
1. `container/src/bot/signal-bot-v2.ts` - Add news URL handling
2. `container/src/api/worker-api-client.ts` - Add Discourse methods
3. `worker/src/index.ts` - Register Discourse routes

## Dependencies Needed

### Container:
```json
{
  "jsdom": "^23.0.0",
  "@mozilla/readability": "^0.5.0"
}
```

### Worker:
Already has:
- OpenAI client (for GPT-5-mini summarization)
- Fetch API (for Discourse posting)

## Environment Variables

```bash
# Discourse Configuration
DISCOURSE_URL=https://your-discourse-site.com
DISCOURSE_API_KEY=your_api_key
DISCOURSE_API_USERNAME=system
DISCOURSE_DEFAULT_CATEGORY=general
DISCOURSE_REQUIRED_TAG=posted-link

# Feature Flags
SCRAPER_AUTO_POST=true
DISCOURSE_AUTO_POST=true
DISCOURSE_POST_DELAY=5000
```

## Testing Strategy

### Test 1: URL Detection
Input: `https://www.cnn.com/2025/11/19/politics/...`
Expected: Detected as news URL → triggers scraping

### Test 2: Article Scraping
Expected: Clean article text extracted, bypasses paywalls if needed

### Test 3: AI Summarization
Expected: GPT-5-mini generates 2-3 paragraph summary

### Test 4: Discourse Posting
Expected: Topic created in correct category with tags

### Test 5: Bot Response
Expected: "📰 Article posted to forum: [discourse-url]"

### Test 6: Database Logging
Expected: Entry in `news_links` table with URL, title, summary, forum_url

## Implementation Priority

1. **HIGH**: URL detection + scraping (core functionality)
2. **HIGH**: AI summarization (content quality)
3. **MEDIUM**: Discourse posting (nice-to-have)
4. **LOW**: Statistics tracking (analytics)

## Code Salvage Locations

**From**: `/modern-stack/archive/experimental/`

- **News domains list** (lines 18-56 of remote-scraper-plugin.js)
- **detectNewsUrls method** (lines 327-367 of remote-scraper-plugin.js)
- **scrapeDirectly method** (search for it in scraper plugin)
- **Readability integration** (JSDOM + Readability pattern)
- **autoPostToDiscourse flow** (lines 369-407 of remote-scraper-plugin.js)
- **createForumPost method** (lines 674-750 of remote-discourse-plugin.js)

## Next Steps

1. ✅ Document salvaged features (this file)
2. ⏳ Create `news-detector.ts` with domain list
3. ⏳ Create `article-scraper.ts` with Readability
4. ⏳ Add Worker endpoints for scraping/Discourse
5. ⏳ Integrate into `signal-bot-v2.ts` message handler
6. ⏳ Test with your CNN URL
7. ⏳ Deploy and verify end-to-end workflow

---

**Status**: Ready to implement based on fully-functional archived code
