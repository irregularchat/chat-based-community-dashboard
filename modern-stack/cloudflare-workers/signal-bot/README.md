# Signal CLI Bot - Cloudflare Native

A production-grade Signal bot running entirely on Cloudflare's global network.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                  Cloudflare Global Network (300+ cities)        │
│                                                                  │
│  ┌──────────────┐       ┌──────────────┐       ┌─────────────┐ │
│  │   Worker     │◄─────►│  Container   │◄─────►│ signal-cli  │ │
│  │ (API Layer)  │ HTTP  │ (Bot Logic)  │       │   (Java)    │ │
│  └──────┬───────┘       └──────────────┘       └─────────────┘ │
│         │                                                        │
│         ├──► D1 (SQLite database at edge)                       │
│         ├──► R2 (Object storage, zero egress)                   │
│         ├──► KV (Key-value cache)                               │
│         └──► Durable Objects (State management)                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why Cloudflare Native?

- **Global**: Bot runs in 300+ cities worldwide, <50ms latency
- **Scalable**: Auto-scales from 0 to millions of requests
- **Affordable**: Pay-per-use, ~$20-30/month for moderate usage
- **Reliable**: 100% uptime SLA, automatic failover
- **Secure**: Built-in DDoS protection, WAF, rate limiting

## 🚀 Features

### Bot Commands

| Command | Description | Example |
|---------|-------------|---------|
| `!help` | Show all commands | `!help` |
| `!ping` | Test responsiveness | `!ping` |
| `!ai <question>` | Ask AI (OpenAI) | `!ai What is Cloudflare?` |
| `!ask <question>` | Post a question | `!ask How do I deploy?` |
| `!questions` | List open questions | `!questions` |
| `!answer <id> <answer>` | Answer a question | `!answer 5 You need to...` |
| `!solve <id>` | Mark solved | `!solve 5` |
| `!whoami` | Show your info | `!whoami` |
| `!version` | Bot version | `!version` |
| `!stats` | Bot statistics | `!stats` |

### Technical Features

- **Message Processing**: Real-time message handling with deduplication
- **Q&A System**: Community-driven Q&A with answers and solved status
- **AI Integration**: OpenAI GPT-4 for intelligent responses
- **Database**: Full message history, commands, and analytics
- **Storage**: R2 for attachments and avatars
- **State Management**: Durable Objects for coordination and queuing
- **Health Monitoring**: Comprehensive health checks and status
- **Rate Limiting**: KV-based rate limiting to prevent abuse
- **Authentication**: Bearer token auth for API security

## 📦 Project Structure

```
signal-bot/
├── src/                          # Worker code (TypeScript)
│   ├── index.ts                  # Main Worker entry point
│   ├── api/
│   │   ├── db-handler.ts         # D1 database operations
│   │   └── r2-handler.ts         # R2 storage operations
│   └── durable-objects/
│       ├── bot-coordinator.ts    # Bot lifecycle management
│       ├── message-queue.ts      # Message queue with retry
│       └── websocket-manager.ts  # WebSocket connections
│
├── container/                    # Container code (TypeScript)
│   ├── Dockerfile                # Multi-stage Docker build
│   ├── src/
│   │   ├── index.ts              # Express server
│   │   ├── bot/
│   │   │   ├── signal-bot.ts     # Main bot class
│   │   │   └── command-handler.ts # Command processing
│   │   ├── api/
│   │   │   └── worker-api-client.ts # Worker API client
│   │   └── lib/
│   │       └── health-monitor.ts # Health monitoring
│   └── package.json
│
├── database/                     # Database setup
│   ├── schema.sql                # D1 schema (20+ tables)
│   └── setup.sh                  # Automated setup script
│
├── wrangler.toml                 # Cloudflare configuration
├── package.json                  # Worker dependencies
├── tsconfig.json                 # TypeScript config
│
├── DEPLOYMENT.md                 # Deployment guide
├── WORKER_API.md                 # API documentation
└── README.md                     # This file
```

## 🗄️ Database Schema

### Core Tables

- **signal_messages**: All Signal messages (with full history)
- **signal_groups**: Group information and metadata
- **signal_contacts**: Contact directory and profiles
- **signal_members**: Group membership tracking

### Bot Tables

- **bot_command_usage**: Command usage statistics
- **bot_errors**: Error logging and debugging
- **bot_sessions**: Bot session tracking

### Feature Tables

- **q_and_a_questions**: Community Q&A questions
- **q_and_a_answers**: Answers to questions
- **news_links**: Shared news links with deduplication
- **community_repos**: GitHub repositories shared in groups
- **group_analytics**: Group activity analytics
- **user_analytics**: User engagement metrics

## 🔧 Technology Stack

### Cloudflare Services

- **Workers**: Serverless JavaScript/TypeScript execution
- **D1**: SQLite database at the edge (ultra-fast)
- **R2**: S3-compatible object storage (zero egress fees)
- **KV**: Key-value store for caching
- **Durable Objects**: Stateful coordination
- **Containers**: Docker containers globally distributed

### Application Stack

- **TypeScript**: Type-safe code throughout
- **signal-cli**: Java-based Signal protocol implementation
- **Express**: HTTP server in container
- **OpenAI**: AI-powered responses
- **Axios**: HTTP client for Worker API calls

## 🚀 Quick Start

### Prerequisites

```bash
# Install required tools
npm install -g wrangler
docker --version

# Cloudflare account with Workers Paid plan ($5/month)
wrangler login
```

### 1. Set Up Infrastructure

```bash
cd cloudflare-workers/signal-bot

# Create D1 database and apply schema
./database/setup.sh

# Create R2 bucket
wrangler r2 bucket create signal-cli-data

# Create KV namespace
wrangler kv:namespace create SIGNAL_CACHE
```

### 2. Configure Secrets

```bash
# Set Signal phone number
wrangler secret put SIGNAL_PHONE_NUMBER
# Enter: +1XXXXXXXXXX

# Set Worker API token
wrangler secret put WORKER_API_TOKEN
# Generate: openssl rand -base64 32

# Optional: OpenAI API key
wrangler secret put OPENAI_API_KEY
```

### 3. Deploy Worker

```bash
npm install
npm run deploy
```

### 4. Build & Deploy Container

```bash
cd container

# Build image
docker build -t signal-cli-bot:latest .

# Register Signal account (first time only)
docker run -it --rm \
  -v $(pwd)/signal-data:/app/signal-data \
  signal-cli-bot:latest \
  signal-cli -a +1XXXXXXXXXX register

# Verify with SMS code
docker run -it --rm \
  -v $(pwd)/signal-data:/app/signal-data \
  signal-cli-bot:latest \
  signal-cli -a +1XXXXXXXXXX verify CODE_HERE

# Deploy to Cloudflare
wrangler deploy --container
```

### 5. Start the Bot

```bash
# Set Worker API URL
wrangler secret put WORKER_API_URL
# Enter: https://signal-cli-bot.YOUR-SUBDOMAIN.workers.dev

# Start bot
curl -X POST "https://signal-cli-bot.YOUR-SUBDOMAIN.workers.dev/bot/start" \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

For detailed instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md).

## 📖 API Documentation

### Worker Endpoints

#### Health & Status
- `GET /health` - Worker health check
- `GET /status` - Combined Worker + Container status

#### Database API (requires auth)
- `POST /api/db/query` - Execute SQL query
- `POST /api/db/batch` - Execute batch queries
- `GET /api/db/stats` - Database statistics

#### Storage API (requires auth)
- `POST /api/r2/upload` - Upload file
- `GET /api/r2/download/:key` - Download file
- `DELETE /api/r2/delete/:key` - Delete file
- `GET /api/r2/list` - List files
- `GET /api/r2/stats` - Storage statistics

#### Container Proxy
- `POST /bot/start` - Start bot
- `POST /bot/stop` - Stop bot
- `GET /bot/status` - Bot status
- `POST /bot/send` - Send message
- `GET /bot/groups` - List groups

For full API documentation, see [WORKER_API.md](./WORKER_API.md).

## 🔐 Security

### Authentication

All API endpoints require Bearer token authentication:

```bash
Authorization: Bearer YOUR_WORKER_API_TOKEN
```

### Best Practices

1. **Use strong tokens**: Generate with `openssl rand -base64 32`
2. **Rotate secrets regularly**: Update `WORKER_API_TOKEN` monthly
3. **Enable rate limiting**: Configured via `RATE_LIMIT_PER_MINUTE`
4. **Backup registration data**: Store signal-cli data securely
5. **Monitor logs**: Use `wrangler tail` for real-time monitoring

## 📊 Monitoring

### View Logs

```bash
# Real-time logs
wrangler tail --format pretty

# Filter by status
wrangler tail --status error
```

### Check Health

```bash
# Overall status
curl https://signal-cli-bot.YOUR-SUBDOMAIN.workers.dev/status

# Database stats
curl https://signal-cli-bot.YOUR-SUBDOMAIN.workers.dev/api/db/stats \
  -H "Authorization: Bearer YOUR_TOKEN"

# Bot status
curl https://signal-cli-bot.YOUR-SUBDOMAIN.workers.dev/bot/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Metrics

- **Response time**: Available in `X-Response-Time` header
- **Database queries**: Use `/api/db/stats` endpoint
- **Storage usage**: Use `/api/r2/stats` endpoint
- **Command usage**: Logged in `bot_command_usage` table

## 💰 Cost Estimates

**Monthly costs** (moderate usage, ~10k messages/day):

| Service | Cost |
|---------|------|
| Workers Paid Plan | $5.00 |
| D1 Database | $0.38 |
| R2 Storage (10GB) | $0.15 |
| KV | $0.50 |
| Container (2GiB, 24/7) | $15-20 |
| **Total** | **~$21-26/month** |

**Cost optimizations:**
- Set `sleepAfter: "10m"` to reduce container costs
- Use KV caching to reduce D1 reads
- Most services have generous free tiers

Compare to traditional VPS: $40-80/month for similar specs, but without global distribution.

## 🔄 Updates & Maintenance

### Update Worker

```bash
git pull
npm install
npm run deploy
```

### Update Container

```bash
cd container
git pull
docker build -t signal-cli-bot:latest .
docker push registry.cloudflare.com/YOUR_ACCOUNT/signal-cli-bot:latest
wrangler deploy --container

# Restart bot
curl -X POST "https://YOUR-WORKER.workers.dev/bot/stop"
curl -X POST "https://YOUR-WORKER.workers.dev/bot/start"
```

### Database Migrations

```bash
# Create new migration
# Edit database/schema.sql

# Apply to remote
wrangler d1 execute signal-bot-db --file=database/migration.sql --remote
```

## 🐛 Troubleshooting

### Common Issues

**Bot not receiving messages**
```bash
# Check bot status
curl https://YOUR-WORKER.workers.dev/bot/status

# Restart bot
curl -X POST https://YOUR-WORKER.workers.dev/bot/stop
curl -X POST https://YOUR-WORKER.workers.dev/bot/start
```

**Database errors**
```bash
# Verify D1 binding
wrangler d1 list

# Check schema
wrangler d1 execute signal-bot-db \
  --command="SELECT name FROM sqlite_master WHERE type='table';" \
  --remote
```

**Container issues**
```bash
# View container logs
wrangler tail --format pretty

# Check Worker can reach container
curl https://YOUR-WORKER.workers.dev/status
```

For more troubleshooting, see [DEPLOYMENT.md](./DEPLOYMENT.md#troubleshooting).

## 🤝 Contributing

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes
3. Test thoroughly
4. Commit: `git commit -m "feat: add my feature"`
5. Push: `git push origin feature/my-feature`
6. Create a pull request

## 📝 License

[Your License Here]

## 🙏 Acknowledgments

- [signal-cli](https://github.com/AsamK/signal-cli) - Signal protocol implementation
- [Cloudflare](https://www.cloudflare.com/) - Infrastructure platform
- [OpenAI](https://openai.com/) - AI integration

---

**Built with ❤️ using Cloudflare's global network**

*Running in 300+ cities worldwide, <50ms from every user*
