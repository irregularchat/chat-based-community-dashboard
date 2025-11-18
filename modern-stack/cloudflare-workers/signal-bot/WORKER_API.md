# Signal Bot Worker API

This document describes the Worker API endpoints that the Signal bot container uses to access D1 and R2.

## Architecture

```
Container (signal-cli + bot) → Worker API → D1/R2
```

The container doesn't have direct D1/R2 bindings, so it calls these HTTP API endpoints on the Worker.

## Authentication

All API endpoints (except `/health` and `/status`) require Bearer token authentication:

```bash
Authorization: Bearer YOUR_WORKER_API_TOKEN
```

Set the token in your environment:
- Worker: `wrangler secret put WORKER_API_TOKEN`
- Container: Set `WORKER_API_TOKEN` environment variable

## Endpoints

### Health & Status

#### `GET /health`
Worker health check (public, no auth required)

**Response:**
```json
{
  "status": "healthy",
  "service": "signal-bot-worker",
  "version": "3.0.0",
  "architecture": "cloudflare-native",
  "timestamp": "2025-01-15T10:00:00.000Z",
  "components": {
    "worker": "active",
    "d1": "bound",
    "r2": "bound",
    "kv": "bound",
    "container": "bound"
  }
}
```

#### `GET /status`
Combined Worker + Container status (public, no auth required)

**Response:**
```json
{
  "worker": { ... },
  "container": { ... },
  "database": { ... },
  "storage": { ... },
  "overall": "healthy"
}
```

---

### D1 Database API

#### `POST /api/db/query`
Execute a SQL query

**Request:**
```json
{
  "sql": "SELECT * FROM signal_messages WHERE group_id = ? LIMIT 10",
  "params": ["group-id-123"]
}
```

**Response:**
```json
{
  "results": [
    {
      "id": "msg-123",
      "message": "Hello",
      "timestamp": 1705320000
    }
  ],
  "success": true,
  "meta": {
    "duration": 5,
    "rows_read": 1,
    "rows_written": 0
  }
}
```

#### `POST /api/db/batch`
Execute multiple queries in a transaction

**Request:**
```json
{
  "queries": [
    {
      "sql": "INSERT INTO signal_messages (id, message) VALUES (?, ?)",
      "params": ["msg-1", "Hello"]
    },
    {
      "sql": "UPDATE signal_groups SET last_activity = ? WHERE id = ?",
      "params": [1705320000, "group-1"]
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    {
      "results": [],
      "success": true,
      "meta": {
        "rows_read": 0,
        "rows_written": 1
      }
    }
  ],
  "meta": {
    "duration": 12,
    "total_queries": 2
  }
}
```

#### `GET /api/db/stats`
Get database statistics

**Response:**
```json
{
  "success": true,
  "tables": {
    "signal_messages": 1523,
    "signal_groups": 5,
    "signal_contacts": 42,
    "bot_command_usage": 834,
    "q_and_a_questions": 12
  },
  "timestamp": "2025-01-15T10:00:00.000Z"
}
```

---

### R2 Storage API

#### `POST /api/r2/upload`
Upload a file to R2

**Request:**
```json
{
  "key": "attachments/image-123.jpg",
  "content": "base64-encoded-data-here",
  "contentType": "image/jpeg",
  "encoding": "base64"
}
```

**Response:**
```json
{
  "key": "attachments/image-123.jpg",
  "url": "/api/r2/download/attachments%2Fimage-123.jpg",
  "size": 52341,
  "etag": "abc123def456"
}
```

#### `GET /api/r2/download/:key`
Download a file from R2

**Example:**
```bash
GET /api/r2/download/attachments%2Fimage-123.jpg
```

**Response:**
Binary file data with appropriate Content-Type header

#### `DELETE /api/r2/delete/:key`
Delete a file from R2

**Example:**
```bash
DELETE /api/r2/delete/attachments%2Fimage-123.jpg
```

**Response:**
```json
{
  "success": true,
  "key": "attachments/image-123.jpg",
  "message": "File deleted"
}
```

#### `GET /api/r2/list`
List files in R2

**Query Parameters:**
- `prefix` - Filter by key prefix (optional)
- `limit` - Max files to return (default: 1000)
- `cursor` - Pagination cursor (optional)

**Example:**
```bash
GET /api/r2/list?prefix=attachments/&limit=100
```

**Response:**
```json
{
  "success": true,
  "files": [
    {
      "key": "attachments/image-123.jpg",
      "size": 52341,
      "uploaded": "2025-01-15T10:00:00.000Z",
      "etag": "abc123"
    }
  ],
  "truncated": false,
  "cursor": null,
  "total": 1
}
```

#### `GET /api/r2/head/:key`
Get file metadata without downloading

**Example:**
```bash
GET /api/r2/head/attachments%2Fimage-123.jpg
```

**Response:**
```json
{
  "success": true,
  "key": "attachments/image-123.jpg",
  "size": 52341,
  "uploaded": "2025-01-15T10:00:00.000Z",
  "etag": "abc123",
  "httpMetadata": {
    "contentType": "image/jpeg"
  },
  "customMetadata": {}
}
```

#### `GET /api/r2/stats`
Get R2 storage statistics

**Response:**
```json
{
  "success": true,
  "totalFiles": 142,
  "totalSize": 5234523,
  "totalSizeMB": 4.99,
  "timestamp": "2025-01-15T10:00:00.000Z"
}
```

---

### Container Proxy

#### `/bot/*`
All requests to `/bot/*` are proxied directly to the container.

**Examples:**
- `POST /bot/start` - Start the bot
- `POST /bot/stop` - Stop the bot
- `GET /bot/status` - Get bot status
- `POST /bot/send` - Send a message
- `GET /bot/groups` - List groups

These endpoints are documented in the container's API documentation.

---

## Usage Example (from Container)

```typescript
import axios from 'axios';

const workerApi = axios.create({
  baseURL: process.env.WORKER_API_URL,
  headers: {
    'Authorization': `Bearer ${process.env.WORKER_API_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

// Query database
const result = await workerApi.post('/api/db/query', {
  sql: 'SELECT * FROM signal_messages WHERE group_id = ?',
  params: ['group-123'],
});

console.log(result.data.results);

// Upload file
const upload = await workerApi.post('/api/r2/upload', {
  key: 'attachments/file.jpg',
  content: Buffer.from(fileData).toString('base64'),
  contentType: 'image/jpeg',
  encoding: 'base64',
});

console.log(upload.data.url);
```

## Error Handling

All endpoints return JSON errors with appropriate HTTP status codes:

**400 Bad Request:**
```json
{
  "error": "SQL query required"
}
```

**401 Unauthorized:**
```json
{
  "error": "Unauthorized",
  "message": "Valid Bearer token required"
}
```

**404 Not Found:**
```json
{
  "error": "File not found"
}
```

**500 Internal Server Error:**
```json
{
  "error": "Database error",
  "message": "Error details here"
}
```

## Rate Limiting

Rate limiting is applied at the Worker level:
- Default: 100 requests per minute per IP
- Configure via `RATE_LIMIT_PER_MINUTE` environment variable

When rate limited, you'll receive a 429 response:
```json
{
  "error": "Rate limit exceeded",
  "limit": 100,
  "retryAfter": 60
}
```

## Security

1. **Authentication**: Always use Bearer token authentication for API endpoints
2. **Token Storage**: Store `WORKER_API_TOKEN` as a Cloudflare secret, never in code
3. **Container Access**: Only the container should have access to the Worker API token
4. **SQL Injection**: Use parameterized queries (`params` array) to prevent SQL injection
5. **Input Validation**: Worker validates all inputs before processing

## Deployment

1. **Set up Worker secrets:**
   ```bash
   wrangler secret put WORKER_API_TOKEN
   # Enter a strong random token
   ```

2. **Configure container environment:**
   ```bash
   export WORKER_API_URL="https://signal-cli-bot.your-subdomain.workers.dev"
   export WORKER_API_TOKEN="your-token-here"
   ```

3. **Deploy Worker:**
   ```bash
   cd cloudflare-workers/signal-bot
   npm install
   npm run deploy
   ```

4. **Test the API:**
   ```bash
   curl https://signal-cli-bot.your-subdomain.workers.dev/health
   ```

## Monitoring

- **Worker Logs**: `wrangler tail --format pretty`
- **Database Metrics**: Use `/api/db/stats` endpoint
- **Storage Metrics**: Use `/api/r2/stats` endpoint
- **Overall Status**: Use `/status` endpoint
