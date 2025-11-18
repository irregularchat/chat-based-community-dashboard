# Cloudflare-Native Signal Bot Architecture

## Vision: Fully Integrated Cloudflare Solution

Move **everything** to Cloudflare for optimal performance, cost, and scalability.

## Full Cloudflare Stack

```
┌──────────────────────────────────────────────────────────┐
│  CLOUDFLARE PAGES (Frontend)                             │
│  - React/Next.js SSG/SSR                                 │
│  - Admin dashboard                                       │
│  - User interfaces                                       │
│  - Real-time updates via WebSockets                      │
└─────────────────┬────────────────────────────────────────┘
                  │ HTTPS
                  ▼
┌──────────────────────────────────────────────────────────┐
│  CLOUDFLARE WORKERS (API Layer)                          │
│  - tRPC/REST API endpoints                               │
│  - Authentication & authorization                        │
│  - Rate limiting                                         │
│  - Request validation                                    │
│  - Orchestration layer                                   │
└────┬────────────┬──────────────┬────────────────────────┘
     │            │              │
     ▼            ▼              ▼
┌─────────┐  ┌─────────┐  ┌──────────────────────────────┐
│ D1      │  │ R2      │  │ DURABLE OBJECTS              │
│ Database│  │ Storage │  │ - Bot state management       │
│         │  │         │  │ - WebSocket connections      │
│         │  │         │  │ - Real-time coordination     │
│         │  │         │  │ - Message queuing            │
└─────────┘  └─────────┘  └──────────┬───────────────────┘
                                      │
                                      ▼
                        ┌─────────────────────────────────┐
                        │ CLOUDFLARE CONTAINER            │
                        │ - Signal CLI daemon             │
                        │ - Message send/receive          │
                        │ - Bot command processing        │
                        │ - AI integration                │
                        └────────────┬────────────────────┘
                                     │ Signal Protocol
                                     ▼
                        ┌─────────────────────────────────┐
                        │ SIGNAL MESSENGER NETWORK        │
                        └─────────────────────────────────┘
```

## Component Breakdown

### 1. **Cloudflare Pages** (Frontend)
- **Framework**: Next.js with static generation + server-side rendering
- **Purpose**: Admin dashboard, user interfaces
- **Features**:
  - Signal group management UI
  - Bot control panel
  - Analytics dashboards
  - Join request moderation
  - Real-time message monitoring
- **Deployment**: `wrangler pages deploy`

### 2. **Cloudflare Workers** (API Layer)
- **Framework**: Hono + tRPC for type-safe APIs
- **Purpose**: Business logic orchestration
- **Endpoints**:
  - User authentication (Cloudflare Access or custom)
  - Signal bot operations (start/stop/status)
  - Group management
  - Join request approval/denial
  - Analytics queries
  - Health checks
- **Bindings**:
  - D1 database
  - R2 buckets
  - Durable Objects
  - KV namespaces
  - Container

### 3. **Cloudflare D1** (Database)
- **Purpose**: Persistent data storage
- **Migration Strategy**: Convert PostgreSQL schema to D1-compatible SQLite
- **Tables** (adapted from current schema):
  - `users` - User accounts
  - `signal_groups` - Group cache
  - `signal_messages` - Message history
  - `signal_members` - Member tracking
  - `bot_command_usage` - Analytics
  - `news_links` - News tracking
  - `q_and_a_questions` - Q&A system
  - And more...

**D1 Adaptations Needed**:
- Remove ENUM types → Use TEXT with CHECK constraints
- Simplify complex relationships
- Use JSON columns for complex data
- Add indexes for performance

### 4. **Cloudflare R2** (Object Storage)
- **Purpose**: File and media storage
- **Contents**:
  - Signal avatars
  - Message attachments
  - Bot backups
  - Logs and exports
- **Access**: Pre-signed URLs for secure access

### 5. **Cloudflare KV** (Key-Value Store)
- **Purpose**: Fast caching and ephemeral data
- **Uses**:
  - Rate limiting counters
  - Session tokens
  - Cached API responses
  - Recent message cache
  - Feature flags

### 6. **Durable Objects** (Stateful Coordination)
- **Purpose**: Manage stateful, real-time operations
- **Use Cases**:

**BotCoordinator Object**:
- Manages bot lifecycle (start/stop)
- Coordinates message processing
- Handles duplicate detection
- Maintains bot state

**MessageQueue Object**:
- Queues outgoing messages
- Handles retries
- Rate limiting per group
- Message deduplication

**WebSocketManager Object**:
- Real-time dashboard updates
- Live message streaming
- Bot status notifications
- Admin alerts

**GroupState Object** (one per group):
- Recent message history
- Active users
- Command context
- Conversation threads

### 7. **Cloudflare Container** (Bot Runtime)
- **Purpose**: Run Signal CLI and bot logic
- **Language**: Node.js/TypeScript or Python
- **Contains**:
  - Signal CLI daemon
  - Command handlers
  - AI integration (OpenAI/local)
  - Discourse integration
  - PDF processing
  - URL cleaning
  - News processing
  - Repository analysis

**Communication**:
- Receives commands from Durable Objects via HTTP
- Sends events to Durable Objects
- Queries D1 via Worker API (HTTP)
- Stores files in R2 via HTTP

## Data Flow Examples

### Example 1: User Sends Message to Bot

```
1. User sends Signal message
   ↓
2. Container (signal-cli) receives message
   ↓
3. Container calls Worker API: POST /api/bot/message
   ↓
4. Worker validates, saves to D1
   ↓
5. Worker routes to appropriate Durable Object
   ↓
6. Durable Object processes command
   ↓
7. Durable Object calls Container: POST /bot/send
   ↓
8. Container sends Signal message
   ↓
9. Durable Object updates D1 via Worker
   ↓
10. WebSocket notifies admin dashboard
```

### Example 2: Admin Approves Join Request

```
1. Admin clicks "Approve" in dashboard
   ↓
2. Pages calls Worker: POST /api/join-requests/approve
   ↓
3. Worker checks admin permissions
   ↓
4. Worker updates D1 (set status = 'approved')
   ↓
5. Worker calls Container: POST /bot/invite-to-group
   ↓
6. Container sends Signal invite
   ↓
7. Worker logs event to D1
   ↓
8. WebSocket updates dashboard
```

## Database Migration: PostgreSQL → D1

### Schema Conversion Strategy

**Current PostgreSQL Schema Issues for D1:**
1. ❌ ENUM types (D1 doesn't support)
2. ❌ Complex foreign key cascades (D1 limited support)
3. ❌ BIGINT for timestamps (use INTEGER for Unix timestamp)
4. ❌ Complex JOINs (D1 slower, use denormalization)

**Conversion Approach:**

```sql
-- PostgreSQL (Current)
CREATE TABLE signal_group_join_requests (
  id SERIAL PRIMARY KEY,
  status VARCHAR(20) DEFAULT 'pending',  -- Would be ENUM
  ...
);

-- D1 (Converted)
CREATE TABLE signal_group_join_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'denied')),
  ...
);
```

**Key Changes:**
1. `SERIAL` → `INTEGER PRIMARY KEY AUTOINCREMENT`
2. `VARCHAR(n)` → `TEXT`
3. `BIGINT` → `INTEGER` (or TEXT for very large numbers)
4. `ENUM` → `TEXT` with `CHECK` constraint
5. `JSONB` → `TEXT` (store JSON as string, parse in app)
6. Complex relationships → Denormalize where needed
7. Timestamps: Store as INTEGER (Unix epoch) or TEXT (ISO 8601)

### Migration Script Strategy

**Phase 1: Export from PostgreSQL**
```bash
# Export all tables to JSON
node scripts/export-postgres-to-json.js
```

**Phase 2: Create D1 Schema**
```bash
# Generate D1-compatible schema
node scripts/generate-d1-schema.js

# Create D1 database
wrangler d1 create signal-bot-db

# Run migrations
wrangler d1 execute signal-bot-db --file=migrations/schema.sql --remote
```

**Phase 3: Import Data to D1**
```bash
# Import JSON data to D1
node scripts/import-json-to-d1.js
```

## Bot Service Architecture

### Option 1: Container with Full Bot Logic (Recommended)

**Container Contents:**
```
container/
├── src/
│   ├── bot/
│   │   ├── signal-cli-wrapper.ts      # Signal CLI interface
│   │   ├── command-handler.ts         # Command routing
│   │   ├── commands/
│   │   │   ├── help.ts
│   │   │   ├── ping.ts
│   │   │   ├── ai.ts
│   │   │   ├── ask.ts (Q&A)
│   │   │   ├── news.ts
│   │   │   └── ...
│   │   └── integrations/
│   │       ├── openai.ts
│   │       ├── discourse.ts
│   │       ├── pdf-processor.ts
│   │       └── url-cleaner.ts
│   ├── api/
│   │   ├── server.ts                   # Express/Hono server
│   │   ├── routes/
│   │   │   ├── messages.ts
│   │   │   ├── groups.ts
│   │   │   └── health.ts
│   │   └── clients/
│   │       ├── d1-client.ts            # D1 API client
│   │       ├── r2-client.ts            # R2 API client
│   │       └── worker-api.ts           # Call Worker endpoints
│   └── main.ts                         # Entry point
├── Dockerfile
└── package.json
```

**Advantages:**
- All bot logic in one place
- Can use any language/framework
- Full control over dependencies
- Easier to develop and test locally

### Option 2: Worker + Durable Objects for Bot Logic

**Alternative**: Move bot command processing to Workers/Durable Objects

**Advantages:**
- Faster cold starts
- Lower latency
- Auto-scaling
- No container management

**Disadvantages:**
- 5-minute CPU limit per request
- More complex for long-running operations
- Signal CLI still needs container

**Recommendation**: Use Container for bot, Workers for API orchestration

## Technology Stack

### Frontend (Cloudflare Pages)
- **Framework**: Next.js 15
- **UI**: React 19 + Tailwind CSS
- **Data Fetching**: tRPC client
- **State**: TanStack Query
- **Build**: Static export or hybrid (SSR functions)

### API Layer (Workers)
- **Framework**: Hono (fast, lightweight)
- **API**: tRPC for type safety
- **Language**: TypeScript
- **Database**: D1 via official client
- **File Storage**: R2 via official client

### Bot Runtime (Container)
- **Language**: TypeScript (Node.js) or Python
- **Signal**: signal-cli (Java-based)
- **Server**: Express/Fastify or Python Flask/FastAPI
- **AI**: OpenAI SDK
- **PDF**: pdf-parse or PyPDF2
- **HTTP Client**: axios or httpx

### Database
- **Primary**: Cloudflare D1 (SQLite)
- **ORM**: Drizzle ORM (D1-compatible) or raw SQL
- **Migrations**: Wrangler D1 migrations

### State Management
- **Durable Objects** for:
  - Bot coordinator
  - Message queue
  - WebSocket manager
  - Group state

## Deployment Architecture

### Development
```bash
# Frontend
npm run dev          # Next.js dev server

# Worker
wrangler dev         # Local worker dev

# Container
docker compose up    # Local container

# Database
wrangler d1 execute --local  # Local D1
```

### Production
```bash
# Frontend
wrangler pages deploy

# Worker
wrangler deploy

# Container
wrangler deploy --container

# Database
wrangler d1 execute --remote
```

## Implementation Phases

### Phase 1: Infrastructure Setup (Week 1)
- [x] Create Cloudflare account setup
- [ ] Create D1 database
- [ ] Create R2 buckets
- [ ] Create KV namespaces
- [ ] Set up Durable Objects
- [ ] Configure Workers
- [ ] Set up Container

### Phase 2: Database Migration (Week 1-2)
- [ ] Export PostgreSQL data
- [ ] Convert schema to D1-compatible
- [ ] Create migration scripts
- [ ] Import data to D1
- [ ] Verify data integrity
- [ ] Create indexes for performance

### Phase 3: Bot Service Rewrite (Week 2-3)
- [ ] Set up container project structure
- [ ] Implement Signal CLI wrapper
- [ ] Port command handlers
- [ ] Integrate with D1 (via Worker API)
- [ ] Integrate with R2
- [ ] Port AI integration
- [ ] Port Discourse integration
- [ ] Implement all bot commands

### Phase 4: API Layer (Week 3)
- [ ] Set up Hono + tRPC
- [ ] Implement authentication
- [ ] Create API endpoints
- [ ] Set up Durable Objects
- [ ] Implement WebSocket support
- [ ] Add rate limiting

### Phase 5: Frontend Migration (Week 4)
- [ ] Migrate Next.js app to Pages-compatible
- [ ] Update API calls to use new endpoints
- [ ] Implement real-time updates
- [ ] Migrate admin panel
- [ ] Update authentication

### Phase 6: Testing & Deployment (Week 4-5)
- [ ] End-to-end testing
- [ ] Load testing
- [ ] Security audit
- [ ] Production deployment
- [ ] Monitor and optimize

## Cost Comparison

### Current Stack (Hybrid)
| Service | Cost/Month |
|---------|-----------|
| VPS/Server | $20-50 |
| PostgreSQL | $10-25 |
| Next.js hosting | $0-20 |
| **Total** | **$30-95** |

### Cloudflare Native
| Service | Cost/Month |
|---------|-----------|
| Workers Paid | $5 |
| D1 | $0.75 (5GB) |
| R2 | $0.15 (10GB) |
| KV | $0.50 |
| Pages | $0 (included) |
| Container | $10-20 (est.) |
| Durable Objects | $5-10 (est.) |
| **Total** | **$20-40** |

**Savings**: ~40-60% cost reduction + better performance

## Performance Benefits

| Metric | Current | Cloudflare Native | Improvement |
|--------|---------|-------------------|-------------|
| Bot response time | 200-500ms | 50-150ms | 3-4x faster |
| Admin panel load | 1-2s | 200-400ms | 3-5x faster |
| API latency | 100-300ms | 20-50ms | 5-10x faster |
| Database query | 50-100ms | 10-20ms (cached) | 3-5x faster |
| Global availability | Single region | 300+ locations | Worldwide |

## Next Steps

1. **Review this architecture** - Confirm approach
2. **Choose implementation path**:
   - Option A: Full rewrite (4-5 weeks, optimal)
   - Option B: Incremental migration (6-8 weeks, safer)
3. **Start with Phase 1** - Infrastructure setup
4. **Proceed to database migration**
5. **Build bot service in container**
6. **Deploy and test**

## Questions to Answer

1. **Timeline**: How quickly do you need this done?
2. **Risk tolerance**: Full rewrite vs incremental migration?
3. **Features**: Any features we can drop/simplify?
4. **Data**: Can we start fresh DB or must migrate all data?
5. **Testing**: Do you have users that need uninterrupted service?

**Ready to start building the Cloudflare-native version?** 🚀
