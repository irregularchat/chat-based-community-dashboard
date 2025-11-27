# Self-Hosted Signal Bot Deployment Guide

This guide covers deploying the Signal Bot on a self-hosted infrastructure using PostgreSQL, Redis, and Docker Compose.

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Proxmox Server                     │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │         Docker Compose Stack              │  │
│  │                                            │  │
│  │  ┌─────────────┐  ┌──────────────────┐   │  │
│  │  │ PostgreSQL  │  │  Signal Bot      │   │  │
│  │  │   (DB)      │◄─┤  Container       │   │  │
│  │  └─────────────┘  └──────────────────┘   │  │
│  │                            ▲              │  │
│  │  ┌─────────────┐           │              │  │
│  │  │   Redis     │◄──────────┘              │  │
│  │  │  (Cache)    │                          │  │
│  │  └─────────────┘                          │  │
│  │                                            │  │
│  │  ┌─────────────┐  ┌──────────────────┐   │  │
│  │  │  Backups    │  │   pgAdmin        │   │  │
│  │  │  (Daily)    │  │  (Optional)      │   │  │
│  │  └─────────────┘  └──────────────────┘   │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Why Self-Hosted?

**Advantages:**
- ✅ Full control over data and infrastructure
- ✅ No cloud service dependencies or outages
- ✅ Sub-millisecond database queries (<1ms vs 50-200ms)
- ✅ Predictable costs (no usage-based pricing)
- ✅ Advanced PostgreSQL features (full-text search, JSONB, triggers)
- ✅ Easier debugging and monitoring
- ✅ Direct database access for queries and backups

**Migration from Cloudflare:**
- Replaces Cloudflare Worker → Direct Express.js server
- Replaces D1 (SQLite) → PostgreSQL 16
- Replaces R2 (Object Storage) → Local file storage
- Replaces HTTP API calls → Direct database connections

## Prerequisites

- Proxmox server (or any Linux server with Docker)
- Docker and Docker Compose installed
- At least 2GB RAM available
- 10GB storage for database and Signal data

## Directory Structure

```
/home/signal-bot-selfhosted/
├── docker-compose.yml          # Docker Compose stack definition
├── .env                        # Environment variables (sensitive)
├── bot/                        # Bot application code
│   ├── src/                    # TypeScript source
│   │   ├── index-selfhosted.ts # Self-hosted entry point
│   │   ├── db/                 # PostgreSQL client
│   │   ├── bot/                # Bot logic
│   │   ├── api/                # API clients
│   │   ├── lib/                # Libraries
│   │   └── utils/              # Utilities
│   ├── Dockerfile              # Self-hosted Dockerfile
│   ├── package.json            # Dependencies
│   └── tsconfig.json           # TypeScript config
├── database/                   # Database schema
│   └── postgres-schema.sql     # PostgreSQL schema
├── data/                       # Persistent data volumes
│   ├── postgres/               # PostgreSQL data
│   ├── redis/                  # Redis data
│   ├── signal-data/            # Signal CLI data
│   ├── downloads/              # Downloaded media
│   └── backups/                # Database backups
└── config/                     # Configuration files
```

## Quick Start

### 1. Deploy Files to Proxmox

From your local machine:

```bash
cd /path/to/signal-bot
./deploy-selfhosted.sh
```

This will sync all necessary files to `/home/signal-bot-selfhosted/` on Proxmox.

### 2. Configure Environment

SSH to Proxmox and edit the environment file:

```bash
ssh root@proxmox-main
cd /home/signal-bot-selfhosted
nano .env
```

Update these critical values:

```env
# Signal phone number
SIGNAL_PHONE_NUMBER=+19108471202

# Database password (CHANGE THIS!)
DB_PASSWORD=your_secure_password_here

# Optional: OpenAI API key
OPENAI_API_KEY=sk-...
OPENAI_ACTIVE=true

# Optional: Discourse forum
DISCOURSE_URL=https://forum.example.com
DISCOURSE_API_KEY=your_discourse_api_key
DISCOURSE_USERNAME=system
DISCOURSE_QA_CATEGORY=5
```

### 3. Start the Stack

```bash
docker-compose up -d
```

This will start:
- PostgreSQL database with automatic schema initialization
- Redis cache
- Signal bot container
- Postgres backup service

### 4. Verify Deployment

Check container status:

```bash
docker-compose ps
```

View logs:

```bash
docker-compose logs -f signal-bot
```

Check health:

```bash
curl http://localhost:8080/health
```

Expected response:

```json
{
  "status": "healthy",
  "container": "signal-bot",
  "version": "3.0.0",
  "architecture": "self-hosted",
  "database": "connected",
  "bot": {
    "running": true,
    "phoneNumber": "+19108471202",
    "uptime": 3600
  }
}
```

### 5. Link Signal Account

If this is a fresh installation, link your Signal account:

```bash
docker exec -it signal-bot signal-cli -a +19108471202 register
docker exec -it signal-bot signal-cli -a +19108471202 verify CODE_FROM_SMS
```

If migrating from Cloudflare, copy Signal data from R2:

```bash
# TODO: Add migration steps
```

## Data Migration from Cloudflare

### Export Data from D1

On your local machine:

```bash
cd /path/to/signal-bot
./export-d1-data.sh
```

This exports all tables from Cloudflare D1 to JSON files.

### Import Data to PostgreSQL

Copy exports to Proxmox:

```bash
rsync -avz d1-exports/ root@proxmox-main:/home/signal-bot-selfhosted/imports/
```

Import into PostgreSQL:

```bash
ssh root@proxmox-main
cd /home/signal-bot-selfhosted

# TODO: Create import script
# For now, the database starts fresh
```

## Management Commands

### View Logs

All services:
```bash
docker-compose logs -f
```

Signal bot only:
```bash
docker-compose logs -f signal-bot
```

### Restart Services

All services:
```bash
docker-compose restart
```

Signal bot only:
```bash
docker-compose restart signal-bot
```

### Stop Services

```bash
docker-compose down
```

To also remove volumes (CAUTION - deletes all data):
```bash
docker-compose down -v
```

### Database Access

Via PostgreSQL client:
```bash
docker exec -it signal-bot-postgres psql -U signal_bot -d signal_bot
```

Common queries:

```sql
-- Q&A statistics
SELECT
  COUNT(*) as total_questions,
  COUNT(*) FILTER (WHERE solved = true) as solved_questions,
  COUNT(*) FILTER (WHERE solved = false) as unsolved_questions
FROM q_and_a_questions;

-- Recent questions
SELECT question_id, question, asker, timestamp, solved
FROM q_and_a_questions
ORDER BY timestamp DESC
LIMIT 10;

-- Answer statistics
SELECT
  question_id,
  COUNT(*) as answer_count,
  COUNT(*) FILTER (WHERE is_solution = true) as solutions
FROM q_and_a_answers
GROUP BY question_id;

-- Full-text search
SELECT question_id, question, asker
FROM q_and_a_questions
WHERE to_tsvector('english', question) @@ to_tsquery('english', 'kubernetes');
```

### Database Backup

Automatic backups run daily and are stored in `/home/signal-bot-selfhosted/data/backups/`.

Manual backup:

```bash
docker exec signal-bot-postgres pg_dump -U signal_bot signal_bot > backup_$(date +%Y%m%d).sql
```

Restore from backup:

```bash
docker exec -i signal-bot-postgres psql -U signal_bot signal_bot < backup_20250119.sql
```

### pgAdmin Web Interface

For debugging and database management, start pgAdmin:

```bash
docker-compose --profile debug up -d pgadmin
```

Access at: `http://proxmox-ip:5050`

Default credentials:
- Email: `admin@signal-bot.local`
- Password: `admin` (or value from .env)

Add server connection:
- Host: `postgres`
- Port: `5432`
- Database: `signal_bot`
- Username: `signal_bot`
- Password: (from .env)

## Q&A System Usage

The self-hosted version includes the full Q&A system with Discourse integration:

### Ask a Question

```
!ask How do I configure Kubernetes ingress?
```

Response:
```
✅ Question #1 recorded!

Question: How do I configure Kubernetes ingress?

📝 Others can answer with: !answer 1 <answer>
   Or reply to this message with: !a <answer>

✔️  Mark answer(s) as solved: !solved 1 <answer_ids>
```

### Answer a Question

```
!answer 1 You need to create an Ingress resource with proper annotations...
```

Response:
```
✅ Answer #1 added to question #1!

❓ Question: How do I configure Kubernetes ingress?

💬 Your answer: You need to create an Ingress resource...

📊 Total answers: 1

To mark this as the solution: !solved 1 1
```

### Mark as Solved

```
!solved 1 1
```

Response:
```
✅ Question #1 marked as solved!

✔️  Answer #1 marked as the solution.

📤 Posting to Discourse forum...

✅ Posted to forum:
https://forum.example.com/t/123
```

### Multiple Solutions

```
!solved 1 1 3
```

Marks answers #1 and #3 as both being solutions.

## Troubleshooting

### Database Connection Failed

Check PostgreSQL is running:
```bash
docker-compose ps postgres
```

Check logs:
```bash
docker-compose logs postgres
```

Test connection:
```bash
docker exec signal-bot-postgres pg_isready -U signal_bot
```

### Bot Not Starting

Check bot logs:
```bash
docker-compose logs signal-bot
```

Common issues:
- Missing SIGNAL_PHONE_NUMBER in .env
- Database not ready (check health checks)
- Signal account not linked

### Discourse Integration Not Working

Check configuration:
```bash
docker exec signal-bot-postgres psql -U signal_bot signal_bot -c "SELECT * FROM q_and_a_questions WHERE discourse_topic_id IS NOT NULL;"
```

Verify environment variables:
```bash
docker-compose exec signal-bot env | grep DISCOURSE
```

Test API key:
```bash
curl -H "Api-Key: YOUR_KEY" \
     -H "Api-Username: system" \
     https://forum.example.com/latest.json
```

### Performance Issues

Check database stats:
```bash
curl http://localhost:8080/stats
```

Check connection pool:
```sql
SELECT count(*) as connections, state
FROM pg_stat_activity
WHERE datname = 'signal_bot'
GROUP BY state;
```

Monitor Redis:
```bash
docker exec signal-bot-redis redis-cli INFO stats
```

## Performance Comparison

| Metric | Cloudflare D1 | Self-Hosted PostgreSQL |
|--------|---------------|------------------------|
| Query latency | 50-200ms | <1ms |
| Connection overhead | HTTP request each time | Connection pooling |
| Full-text search | Limited | Native PostgreSQL |
| JSONB queries | No | Yes |
| Triggers/functions | No | Yes |
| Concurrent connections | Limited | 20+ pool |
| Geographic latency | Depends on edge | Local |

## Security Considerations

1. **Database Password**: Change default password in `.env`
2. **Firewall**: Only expose ports 8080, 5050 (pgAdmin) if needed
3. **Backups**: Ensure backups are encrypted and stored securely
4. **Updates**: Keep Docker images updated
5. **SSL/TLS**: Consider reverse proxy (nginx) with Let's Encrypt for HTTPS

## Next Steps

1. ✅ Deploy self-hosted stack
2. ⏳ Test Q&A workflow
3. ⏳ Migrate Signal account data from R2
4. ⏳ Export and import D1 data
5. ⏳ Update production Signal group to use self-hosted
6. ⏳ Monitor performance and logs
7. ⏳ Cleanup Cloudflare resources (Worker, D1, R2)

## Support

For issues or questions:
- Check logs: `docker-compose logs -f signal-bot`
- Check database: Connect via psql or pgAdmin
- Check health: `curl http://localhost:8080/health`
- Check container status: `docker-compose ps`
