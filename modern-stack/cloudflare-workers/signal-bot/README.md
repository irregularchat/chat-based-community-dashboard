# Signal CLI Bot on Cloudflare Containers

This directory contains the Cloudflare Workers + Containers deployment for the Signal CLI bot.

## Architecture

```
┌─────────────────────────────────────────┐
│  Cloudflare Worker (API Gateway)        │
│  - Authentication & Rate Limiting        │
│  - Health Monitoring                     │
│  - Request Routing                       │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  Container: signal-cli-rest-api         │
│  - Signal CLI Bot                        │
│  - Message Processing                    │
│  - REST API Endpoints                    │
└─────────────────┬───────────────────────┘
                  │
         ┌────────┴────────┐
         ▼                 ▼
    ┌─────────┐      ┌──────────┐
    │ R2      │      │ KV Cache │
    │ Storage │      │          │
    └─────────┘      └──────────┘
```

## Prerequisites

1. **Cloudflare Account** with Workers Paid plan ($5/month minimum)
2. **Wrangler CLI** installed:
   ```bash
   npm install -g wrangler
   ```
3. **Docker** installed (for building container image)
4. **Authenticated with Cloudflare**:
   ```bash
   wrangler login
   ```

## Initial Setup

### 1. Install Dependencies

```bash
cd cloudflare-workers/signal-bot
npm install
```

### 2. Create R2 Bucket for Signal Data

```bash
npm run r2:create
# or
wrangler r2 bucket create signal-cli-data
```

### 3. Create KV Namespace for Caching

```bash
npm run kv:create
# or
wrangler kv:namespace create SIGNAL_CACHE
```

Copy the namespace ID from the output and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "SIGNAL_CACHE"
id = "your-namespace-id-here"
```

### 4. Set Secrets

```bash
# Set Signal phone number
npm run secret:set-phone
# Enter: +19108471202 (or your number)

# Set OpenAI API key (optional, for AI features)
npm run secret:set-openai
# Enter your OpenAI API key
```

### 5. Upload Existing Signal Data to R2 (Optional)

If you have existing signal-data from your local setup:

```bash
# Install AWS CLI or use wrangler
# Using wrangler:
wrangler r2 object put signal-cli-data/accounts.json --file=../../signal-data/data/accounts.json

# Or bulk upload with AWS CLI (configured for R2):
aws s3 sync ../../signal-data/ r2://signal-cli-data/ \
  --endpoint-url=https://<account-id>.r2.cloudflarestorage.com
```

## Building and Deploying

### Option 1: Quick Deploy (Recommended)

```bash
# Build Docker image and deploy everything in one command
npm run container:push
```

### Option 2: Step-by-Step Deploy

```bash
# 1. Build the Docker image
npm run container:build

# 2. Deploy to Cloudflare
npm run deploy
```

### For Production

```bash
npm run deploy:production
```

## Development

### Local Development

```bash
# Start local development server
npm run dev
```

This will start:
- Worker at `http://localhost:8787`
- Container running locally via Docker

### View Logs

```bash
# Stream real-time logs
npm run logs

# Or with wrangler directly
npm run tail
```

## API Endpoints

Once deployed, your Signal bot will be available at:

```
https://signal-cli-bot.<your-subdomain>.workers.dev
```

### Worker Endpoints

- `GET /health` - Worker health check
- `GET /status` - Worker + Container status

### Signal CLI API Endpoints (proxied)

All Signal CLI REST API endpoints are available:

- `GET /v1/health` - Container health
- `GET /v1/accounts` - List registered accounts
- `POST /v1/register/{phoneNumber}` - Register new number
- `POST /v1/register/{phoneNumber}/verify/{code}` - Verify registration
- `POST /v1/send` - Send message
- `GET /v1/receive/{phoneNumber}` - Receive messages
- `GET /v1/groups/{phoneNumber}` - List groups

Full API documentation: https://bbernhard.github.io/signal-cli-rest-api/

## Configuration

### Environment Variables (Secrets)

Set via `wrangler secret put VARIABLE_NAME`:

| Variable | Required | Description |
|----------|----------|-------------|
| `SIGNAL_PHONE_NUMBER` | Yes | Bot's phone number (e.g., +19108471202) |
| `OPENAI_API_KEY` | No | OpenAI API key for AI features |

### Container Configuration

Edit `wrangler.toml` to adjust:

```toml
[[containers]]
memory = "2GiB"        # Increase if needed
cpu = 2                 # Number of CPU cores
sleep_after = "10m"     # Idle timeout before shutdown
```

### Rate Limiting

Default: 100 requests per minute per IP

Adjust in `src/index.js`:

```javascript
const limit = 100; // requests per minute
const window = 60; // seconds
```

## Monitoring

### Check Status

```bash
curl https://signal-cli-bot.<your-subdomain>.workers.dev/status
```

Response:
```json
{
  "worker": {
    "status": "healthy",
    "version": "1.0.0",
    "timestamp": "2025-01-18T12:00:00.000Z"
  },
  "container": {
    "status": "healthy",
    "instance": "primary-bot",
    "lastChecked": "2025-01-18T12:00:00.000Z"
  }
}
```

### View Logs in Dashboard

1. Go to https://dash.cloudflare.com
2. Select "Workers & Pages"
3. Click on "signal-cli-bot"
4. View "Logs" tab for real-time logs

### Metrics

Cloudflare automatically provides:
- Request count
- Error rate
- CPU time usage
- Container uptime

View in the Cloudflare Dashboard under your Worker.

## Registering Signal Account

If you need to register a new Signal account:

### 1. Get Captcha Token

Visit: https://signalcaptchas.org/registration/generate.html

### 2. Register via API

```bash
curl -X POST "https://signal-cli-bot.<your-subdomain>.workers.dev/v1/register/+19108471202" \
  -H "Content-Type: application/json" \
  -d '{
    "captcha": "YOUR_CAPTCHA_TOKEN"
  }'
```

### 3. Verify with SMS Code

```bash
curl -X POST "https://signal-cli-bot.<your-subdomain>.workers.dev/v1/register/+19108471202/verify/123456"
```

## Troubleshooting

### Container Not Starting

Check logs:
```bash
npm run tail
```

Common issues:
- Insufficient memory (increase in wrangler.toml)
- Missing secrets (set SIGNAL_PHONE_NUMBER)
- Docker build failed (check Dockerfile)

### Account Not Registered

The container needs an active Signal account. If you have existing signal-data:

1. Upload to R2 (see setup step 5)
2. Restart container
3. Or register new account via API (see above)

### Rate Limit Issues

If legitimate traffic is being rate limited:

1. Increase limits in `src/index.js`
2. Or implement IP whitelisting
3. Or use API keys for authentication

### Container Cold Starts

First request after idle may be slow (5-10 seconds). To keep warm:

1. Reduce `sleep_after` in wrangler.toml
2. Set up health check ping every 5 minutes
3. Or set `min_instances = 1` (costs more)

## Cost Estimation

### Workers Paid Plan
- $5/month base (includes 10M requests)
- $0.50 per additional million requests

### Containers (Beta - pricing TBD)
- Currently in public beta
- Estimated: Pay per GB-second of active runtime
- `sleep_after` setting helps reduce costs

### R2 Storage
- $0.015/GB/month storage
- $4.50/million Class A operations (writes)
- $0.36/million Class B operations (reads)
- **FREE egress** 🎉

### KV
- $0.50/million reads
- $5.00/million writes
- First 100k reads/day free

**Estimated Total: $10-30/month** (depending on usage)

## Migration from Local Setup

To migrate from your local signal-cli setup:

1. ✅ Backup your signal-data directory
   ```bash
   rsync -av signal-data/ signal-data-backup/
   ```

2. ✅ Upload to R2 (see setup step 5)

3. ✅ Deploy container (see deployment section)

4. ✅ Test with health check:
   ```bash
   curl https://signal-cli-bot.<your-subdomain>.workers.dev/health
   ```

5. ✅ Update your app to use new Worker URL

6. ✅ Keep local bot as backup until stable

## Rollback Plan

If you need to rollback:

1. Stop the Worker:
   ```bash
   wrangler delete signal-cli-bot
   ```

2. Restart local bot:
   ```bash
   cd ../..
   node start-native-signal-bot.js
   ```

3. Your local signal-data is unchanged (we didn't delete it)

## Next Steps

After successful deployment:

- [ ] Update app API endpoints to use Worker URL
- [ ] Set up monitoring alerts in Cloudflare
- [ ] Implement additional authentication (API keys, JWT)
- [ ] Add custom domain (optional)
- [ ] Set up automated backups of R2 data
- [ ] Integrate with your existing tRPC endpoints

## Support

- Cloudflare Docs: https://developers.cloudflare.com/containers/
- Signal CLI API: https://bbernhard.github.io/signal-cli-rest-api/
- Cloudflare Discord: https://discord.gg/cloudflaredev

## License

Same as parent project
