# News Article Scraping Feature - Implementation Status

## ✅ Completed - Container Side

### 1. News Domain Detection
**File**: `container/src/utils/news-detector.ts`
- ✅ 55+ news domains (CNN, BBC, Reuters, etc.)
- ✅ `isNewsDomain()` function
- ✅ `detectNewsUrls()` function
- ✅ Domain extraction utility

### 2. Bot Integration
**File**: `container/src/bot/signal-bot-v2.ts`
- ✅ Imports news detector utilities
- ✅ `checkForNewsUrls()` method (lines 626-704)
- ✅ Integrated into message handler (line 441-449)
- ✅ Sends acknowledgment message
- ✅ Calls Worker API for scraping
- ✅ Sends summary back to group
- ✅ Handles Discourse URL if provided

### 3. Worker API Client
**File**: `container/src/api/worker-api-client.ts`
- ✅ `scrapeAndSummarize()` method (lines 467-485)
- ✅ Posts to `/api/news/scrape`
- ✅ Returns title, summary, content, discourseUrl

### 4. Build Status
- ✅ TypeScript compiles successfully
- ✅ Ready to deploy

## ⏳ Pending - Worker Side

### Worker Endpoint Needed
**Endpoint**: `POST /api/news/scrape`

**Request**:
```typescript
{
  url: string;
  sourceNumber: string;
  sourceName: string;
  groupId?: string;
}
```

**Response**:
```typescript
{
  title?: string;
  summary?: string;
  content?: string;
  discourseUrl?: string;
}
```

**Implementation Steps**:

1. Create `/worker/src/routes/news.ts`:
   - Fetch URL content
   - Use Mozilla Readability or similar
   - Call OpenAI GPT-5-mini for summarization
   - Optionally post to Discourse
   - Save to D1 via existing `saveNewsLink()`

2. Register route in `/worker/src/index.ts`:
   ```typescript
   import { newsRouter } from './routes/news';
   app.route('/api/news', newsRouter);
   ```

3. Environment variables needed:
   ```bash
   OPENAI_API_KEY=...
   DISCOURSE_URL=...
   DISCOURSE_API_KEY=...
   ```

## 🧪 Testing Plan

### Test 1: News Detection
**Input**: Post `https://www.cnn.com/2025/11/19/politics/...` to Signal
**Expected**:
- Bot logs: `📰 Detected 1 news URL(s)`
- Bot logs: `📰 Processing news URL: https://www.cnn.com/... (cnn.com)`
- Bot sends: `📰 News article detected from cnn.com. Processing...`

### Test 2: Worker API Call (will fail until Worker endpoint exists)
**Expected**:
- Bot calls `POST /api/news/scrape`
- Returns 404 or error until Worker endpoint is created

### Test 3: Full Workflow (after Worker endpoint)
**Expected**:
1. Bot detects CNN URL
2. Sends acknowledgment
3. Worker scrapes article
4. Worker generates summary via GPT-5-mini
5. Bot sends summary to group
6. Optionally posts to Discourse
7. Bot sends Discourse URL

## 📂 Files Modified/Created This Session

### Created:
1. `container/src/utils/news-detector.ts` - News domain detection
2. `SALVAGED_FEATURES_PLAN.md` - Complete salvage documentation
3. `NEWS_FEATURE_STATUS.md` - This file

### Modified:
1. `container/src/bot/signal-bot-v2.ts` - Added news URL handling
2. `container/src/api/worker-api-client.ts` - Added scrapeAndSummarize method

### Built:
- ✅ `dist/` folder updated with new code

## 🚀 Next Steps

1. **Deploy Container** (can deploy now, will log attempts to call Worker)
   ```bash
   ./deploy-to-proxmox.sh
   ```

2. **Test News Detection** (send CNN URL, check logs)
   ```bash
   # Check logs for: "📰 Detected 1 news URL(s)"
   docker logs --tail=100 signal-bot | grep "📰"
   ```

3. **Create Worker Endpoint** (separate task)
   - Implement `/api/news/scrape`
   - Use GPT-5-mini for summarization
   - Integrate Discourse posting

4. **Full End-to-End Test**
   - Send CNN URL
   - Verify summary appears
   - Check Discourse post created

## 💡 Notes

- Bot code is **production-ready** for news detection
- Will gracefully handle Worker endpoint not existing (logs error, continues)
- Silent failure for news processing - doesn't interrupt normal bot operation
- Rate limiting can be added later if needed

## 🔄 Current Workflow

```
User posts CNN URL
    ↓
Bot detects as news domain (✅ DONE)
    ↓
Bot sends acknowledgment (✅ DONE)
    ↓
Bot calls Worker API (✅ DONE)
    ↓
Worker scrapes article (⏳ TODO)
    ↓
Worker generates summary (⏳ TODO)
    ↓
Worker posts to Discourse (⏳ TODO)
    ↓
Bot sends summary to group (✅ DONE)
    ↓
Bot sends Discourse URL (✅ DONE)
```

---

**Status**: Container implementation complete. Ready to deploy and test detection. Worker endpoint needed for full functionality.
