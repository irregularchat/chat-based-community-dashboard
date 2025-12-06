# Social Media Content Downloader with yt-dlp

### Problem: Instagram/TikTok URL Sharing in Signal

**User Request**:
Users wanted to share Instagram Reels and TikTok videos in Signal groups, but:
- URLs included tracking parameters (`?igsh=...`, `?utm_source=...`)
- Signal doesn't auto-preview social media content
- Manual downloading and re-uploading was tedious

**Goal**:
Automatically detect social media URLs, remove trackers, download content, and send it as an attachment in Signal-compatible format.

### Implementation: yt-dlp Integration

**Inspired by** `dl` function from `~/Git/dotfiles/platforms/macos/config/.zsh_functions`

**Architecture**:
```
User posts Instagram URL
    ↓
Bot detects platform (Instagram, TikTok, etc.)
    ↓
Bot removes tracker parameters
    ↓
Bot downloads with yt-dlp (Signal-compatible format)
    ↓
Bot sanitizes filename
    ↓
Bot sends file as Signal attachment
    ↓
Clean URL included in message
```

**Key Components**:

1. **Social Media Detector** (`src/utils/social-media-detector.ts`):
   - 12 platform support (Instagram, TikTok, Twitter/X, YouTube, Facebook, Reddit, Vimeo, Twitch, LinkedIn, Pinterest, Snapchat)
   - 50+ tracker parameter removal (igsh, fbclid, utm_*, etc.)
   - Content type detection (Reel, Post, Video, Short, etc.)

2. **Social Media Downloader** (`src/utils/social-media-downloader.ts`):
   - yt-dlp integration for universal downloading
   - Signal-compatible video format:
     - Video: H.264 Main profile, level 3.1, yuv420p
     - Audio: AAC at 128kbps, stereo
     - Container: MP4 with faststart
   - Quality selection (1080p, 720p, 480p, 360p, best, worst)
   - 95 MB file size limit (Signal cross-platform maximum)
   - Automatic filename sanitization (lowercase, underscores)

3. **Bot Integration** (`src/bot/signal-bot-v2.ts`):
   - `checkForSocialMediaUrls()` method processes messages
   - Attachment support in `sendMessage()`
   - Non-blocking (doesn't stop other features)

### Critical Bug Fix #1: Shell Redirection Operators

**Problem**:
```
/bin/sh: 1: cannot open =720]+bestaudio/best[height: No such file
```

**Root Cause**:
yt-dlp format selector `bestvideo[height<=720]+bestaudio/best[height<=720]/best` contains `<` and `>` characters that `/bin/sh` interprets as file redirection operators when passed through `execAsync()`.

**Failed Command**:
```typescript
const command = `yt-dlp -f bestvideo[height<=720]+bestaudio/best[height<=720]/best ...`;
await execAsync(command);  // Shell interprets < as redirection!
```

**Fix**:
```typescript
// Quote arguments containing shell special characters
const quotedArgs = ytdlArgs.map(arg => {
  if (arg.includes(' ') || arg.includes('<') || arg.includes('>') ||
      arg.includes('[') || arg.includes(']')) {
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }
  return arg;
});
const command = `yt-dlp ${quotedArgs.join(' ')}`;
```

**File**: `container/src/utils/social-media-downloader.ts:185-186`

### Critical Bug Fix #2: Instagram Format Selection

**Problem**:
```
❌ Download failed: Requested format is not available
```

**Root Cause**:
Instagram videos come as a single combined MP4 file (format ID 0) with video and audio already muxed. The format selector `bestvideo[height<=720]+bestaudio` expects separate streams that can be combined, which Instagram doesn't provide.

**Instagram Format Structure**:
```
ID EXT RESOLUTION | PROTO | VCODEC  ACODEC
------------------------------------------- 
0  mp4 750x1000   | https | unknown unknown
```

**Fix**:
```typescript
// Before (fails for Instagram)
'-f', 'bestvideo[height<=720]+bestaudio'

// After (works for Instagram AND YouTube)
'-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best'
```

The fallback chain:
1. Try: `bestvideo[height<=720]+bestaudio` (YouTube, etc.)
2. Fallback: `best[height<=720]` (single format with height limit)
3. Final fallback: `best` (best available regardless of height)

**File**: `container/src/utils/social-media-downloader.ts:140-142`

### Dockerfile Updates

**Dependencies Added**:
```dockerfile
RUN apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp
```

**File**: `container/Dockerfile:49-57`

### Testing & Verification

**Manual Testing** (confirmed working):
```bash
# Test yt-dlp with full command
docker exec signal-bot yt-dlp \
  -f 'bestvideo[height<=720]+bestaudio/best[height<=720]/best' \
  --merge-output-format mp4 \
  --postprocessor-args 'ffmpeg:-c:v libx264 -profile:v main...' \
  -o '/tmp/test.%(ext)s' \
  'https://www.instagram.com/reel/DNwP6ZCwv6r/'

# Result: ✅ Downloaded 1.92 MiB in 00:00:00
```

**Live Bot Testing**:
- User posts: `https://www.instagram.com/reel/DNwP6ZCwv6r/?igsh=MWJ4bG9zN2lndTRhNg==`
- Bot responds:
  ```
  📸 Instagram Reel detected. Processing...

  📸 Instagram Reel
  📎 Downloaded: video_title.mp4
  📊 Size: 1.92 MB

  🧹 Clean URL:
  https://www.instagram.com/reel/DNwP6ZCwv6r/
  ```
- Video plays in Signal without issues

### Lesson

✅ **Shell special characters must be quoted** when building commands
✅ **Test yt-dlp commands manually first** before integrating
✅ **Instagram requires fallback format selectors** (single format)
✅ **Signal has specific codec requirements** (H.264 Main + AAC + yuv420p)
✅ **yt-dlp is extremely versatile** - handles 1000+ sites
✅ **Filename sanitization prevents issues** with special characters
✅ **95 MB limit enforcement** prevents Signal upload failures

**Shell Escape Characters to Quote**:
- `<`, `>` - Redirection operators
- `[`, `]` - Glob patterns
- `(`, `)` - Subshells
- `$` - Variable expansion
- Spaces - Argument splitting

**Files**:
- `container/src/utils/social-media-detector.ts` - Platform detection
- `container/src/utils/social-media-downloader.ts` - yt-dlp integration
- `container/src/bot/signal-bot-v2.ts` - Bot integration
- `container/Dockerfile` - Dependencies
