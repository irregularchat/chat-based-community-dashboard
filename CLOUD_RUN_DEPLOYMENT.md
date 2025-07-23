# Google Cloud Run Deployment Guide

Based on the `exampleOnly/` directory analysis, here's a comprehensive guide for deploying the Community Dashboard to Google Cloud Run.

## Overview

The `exampleOnly/` directory demonstrates a production-ready Docker deployment pattern that can be adapted for Google Cloud Run. This guide leverages the Docker containerization approach with Cloud Run-specific optimizations.

## Prerequisites

- Google Cloud SDK installed (`gcloud` CLI)
- Docker installed locally
- Google Cloud project with billing enabled
- Required APIs enabled:
  - Cloud Run API
  - Cloud SQL API
  - Cloud Build API
  - Artifact Registry API

## Architecture

```
Cloud Run Service (Community Dashboard)
├── Container: Node.js Next.js Application
├── Database: Cloud SQL PostgreSQL
├── Static Files: Cloud Storage
└── Secrets: Secret Manager
```

## Step 1: Cloud Infrastructure Setup

### 1.1 Enable Required APIs
```bash
gcloud services enable \
  run.googleapis.com \
  sql-component.googleapis.com \
  sqladmin.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

### 1.2 Create Artifact Registry Repository
```bash
# Create repository for container images
gcloud artifacts repositories create community-dashboard \
  --repository-format=docker \
  --location=us-central1 \
  --description="Community Dashboard container images"
```

### 1.3 Create Cloud SQL Instance
```bash
# Create PostgreSQL instance
gcloud sql instances create community-dashboard-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --root-password=your-secure-password

# Create database
gcloud sql databases create community_dashboard \
  --instance=community-dashboard-db

# Create user
gcloud sql users create dashboard_user \
  --instance=community-dashboard-db \
  --password=your-user-password
```

## Step 2: Environment Configuration

### 2.1 Create Cloud Run Environment File
Create `cloud-run.env` based on the `exampleOnly/` pattern:

```bash
# Database Configuration
DATABASE_URL=postgresql://dashboard_user:password@/community_dashboard?host=/cloudsql/PROJECT_ID:us-central1:community-dashboard-db

# Application Configuration
NODE_ENV=production
PORT=8080
NEXTAUTH_URL=https://your-app-url.run.app
NEXTAUTH_SECRET=your-secure-nextauth-secret

# Matrix Configuration (from legacy .env)
MATRIX_HOMESERVER=https://matrix.org
MATRIX_ACCESS_TOKEN=your-matrix-token
MATRIX_USER_ID=@bot:matrix.org
MATRIX_DOMAIN=irregularchat.com

# Email Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Authentik Configuration
AUTHENTIK_CLIENT_ID=your-client-id
AUTHENTIK_CLIENT_SECRET=your-client-secret
AUTHENTIK_ISSUER=https://your-authentik-instance.com
```

### 2.2 Store Secrets in Secret Manager
```bash
# Store sensitive environment variables
gcloud secrets create nextauth-secret --data-file=- <<< "your-secure-nextauth-secret"
gcloud secrets create matrix-access-token --data-file=- <<< "your-matrix-token"
gcloud secrets create smtp-password --data-file=- <<< "your-smtp-password"
gcloud secrets create authentik-client-secret --data-file=- <<< "your-authentik-secret"
```

## Step 3: Dockerfile Optimization for Cloud Run

Create `Dockerfile.cloudrun` based on the existing pattern:

```dockerfile
# Multi-stage build optimized for Cloud Run
FROM node:18-alpine AS base

# Dependencies stage
FROM base AS deps
RUN apk add --no-cache libc6-compat curl
WORKDIR /app
COPY modern-stack/package*.json ./
RUN npm ci --only=production

# Builder stage
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY modern-stack/ .

# Generate Prisma client
RUN npx prisma generate

# Build application
RUN npm run build

# Production stage optimized for Cloud Run
FROM node:18-alpine AS runner
WORKDIR /app

# Install netcat for database connectivity checks
RUN apk add --no-cache curl netcat-openbsd

# Create nextjs user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy Cloud Run optimized entrypoint
COPY cloud-run-entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Set ownership
RUN chown -R nextjs:nodejs /app

# Cloud Run uses PORT environment variable
EXPOSE $PORT

# Use Cloud Run optimized entrypoint
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]
```

## Step 4: Cloud Run Entrypoint Script

Create `cloud-run-entrypoint.sh`:

```bash
#!/bin/sh
set -e

echo "🚀 Starting Community Dashboard on Cloud Run"

# Wait for Cloud SQL connection
echo "⏳ Waiting for Cloud SQL connection..."
if [ -n "$INSTANCE_CONNECTION_NAME" ]; then
  echo "Using Cloud SQL connection: $INSTANCE_CONNECTION_NAME"
fi

# Deploy database schema
echo "📋 Deploying database schema..."
npx prisma db push --accept-data-loss || {
  echo "❌ Prisma schema deployment failed"
  exit 1
}

# Seed database if needed
if [ "$SEED_DATABASE" = "true" ]; then
  echo "🌱 Seeding database..."
  npm run db:seed || echo "⚠️ Database seeding failed, continuing..."
fi

echo "✅ Database setup complete"
echo "🌟 Starting application on port ${PORT:-8080}"

# Start the application
exec "$@"
```

## Step 5: Cloud Build Configuration

Create `cloudbuild.yaml`:

```yaml
steps:
  # Build container image
  - name: 'gcr.io/cloud-builders/docker'
    args: [
      'build',
      '-f', 'Dockerfile.cloudrun',
      '-t', 'us-central1-docker.pkg.dev/$PROJECT_ID/community-dashboard/app:$COMMIT_SHA',
      '-t', 'us-central1-docker.pkg.dev/$PROJECT_ID/community-dashboard/app:latest',
      '.'
    ]

  # Push to Artifact Registry
  - name: 'gcr.io/cloud-builders/docker'
    args: [
      'push',
      '--all-tags',
      'us-central1-docker.pkg.dev/$PROJECT_ID/community-dashboard/app'
    ]

  # Deploy to Cloud Run
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    entrypoint: 'gcloud'
    args: [
      'run', 'deploy', 'community-dashboard',
      '--image', 'us-central1-docker.pkg.dev/$PROJECT_ID/community-dashboard/app:$COMMIT_SHA',
      '--region', 'us-central1',
      '--platform', 'managed',
      '--allow-unauthenticated',
      '--add-cloudsql-instances', '$PROJECT_ID:us-central1:community-dashboard-db',
      '--set-env-vars', 'NODE_ENV=production,PORT=8080',
      '--set-secrets', 'NEXTAUTH_SECRET=nextauth-secret:latest,MATRIX_ACCESS_TOKEN=matrix-access-token:latest',
      '--max-instances', '10',
      '--memory', '2Gi',
      '--cpu', '2',
      '--timeout', '300'
    ]

options:
  machineType: 'E2_HIGHCPU_8'
  substitution_option: 'ALLOW_LOOSE'
```

## Step 6: Deployment Script

Create `deploy-cloudrun.sh`:

```bash
#!/bin/bash
set -e

echo "🚀 Deploying Community Dashboard to Google Cloud Run"

# Configuration
PROJECT_ID=${1:-your-project-id}
REGION=${2:-us-central1}
SERVICE_NAME="community-dashboard"

# Set project
gcloud config set project $PROJECT_ID

# Build and deploy
echo "📦 Building and deploying..."
gcloud builds submit --config cloudbuild.yaml

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")

echo "✅ Deployment completed!"
echo "🌐 Service URL: $SERVICE_URL"
echo "🔑 Don't forget to:"
echo "   • Update NEXTAUTH_URL to: $SERVICE_URL"
echo "   • Configure custom domain if needed"
echo "   • Set up Cloud CDN for static assets"
echo "   • Configure Cloud Armor for security"
```

## Step 7: Cloud Run Service Configuration

For production deployment with optimal settings:

```bash
gcloud run deploy community-dashboard \
  --image us-central1-docker.pkg.dev/PROJECT_ID/community-dashboard/app:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --add-cloudsql-instances PROJECT_ID:us-central1:community-dashboard-db \
  --set-env-vars "NODE_ENV=production,PORT=8080,INSTANCE_CONNECTION_NAME=PROJECT_ID:us-central1:community-dashboard-db" \
  --set-secrets "NEXTAUTH_SECRET=nextauth-secret:latest,MATRIX_ACCESS_TOKEN=matrix-access-token:latest,SMTP_PASS=smtp-password:latest,AUTHENTIK_CLIENT_SECRET=authentik-client-secret:latest" \
  --max-instances 10 \
  --min-instances 1 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --concurrency 80 \
  --execution-environment gen2
```

## Step 8: Production Optimizations

### 8.1 Custom Domain
```bash
# Map custom domain
gcloud run domain-mappings create \
  --service community-dashboard \
  --domain dashboard.yourdomain.com \
  --region us-central1
```

### 8.2 Cloud CDN for Static Assets
```bash
# Create Cloud Storage bucket for static assets
gsutil mb gs://your-project-dashboard-static

# Configure Cloud CDN
gcloud compute backend-buckets create dashboard-static-backend \
  --gcs-bucket-name=your-project-dashboard-static
```

### 8.3 Monitoring and Logging
```bash
# Enable Cloud Monitoring
gcloud services enable monitoring.googleapis.com

# Create custom metrics for Matrix operations
gcloud logging metrics create matrix_messages_sent \
  --description="Matrix messages sent" \
  --log-filter='resource.type="cloud_run_revision" AND textPayload:"Matrix message sent"'
```

## Comparison with exampleOnly/ Pattern

| exampleOnly/ Feature | Cloud Run Equivalent |
|---------------------|---------------------|
| docker-compose.yml | Cloud Run service |
| PostgreSQL container | Cloud SQL PostgreSQL |
| Redis container | Cloud Memorystore (optional) |
| Nginx container | Cloud Load Balancer |
| SSL certificates | Google-managed SSL |
| Environment variables | Secret Manager + env vars |
| Health checks | Cloud Run health checks |
| Monitoring | Cloud Monitoring |
| Backup system | Cloud SQL automated backups |

## Cost Optimization

- **Minimum instances**: Set to 1 for consistent performance
- **Maximum instances**: Limit to control costs
- **CPU allocation**: Use 2 vCPU for Matrix operations
- **Memory**: 2GB sufficient for typical usage
- **Request timeout**: 300 seconds for long Matrix operations

## Security Best Practices

1. **Secrets Management**: All sensitive data in Secret Manager
2. **Cloud SQL**: Private IP with authorized networks
3. **IAM**: Service account with minimal permissions
4. **Cloud Armor**: WAF protection for external traffic
5. **VPC**: Deploy in private subnet if needed

## Monitoring and Alerting

```bash
# Create alerting policy for high error rate
gcloud alpha monitoring policies create \
  --policy-from-file=monitoring-policy.yaml
```

This deployment approach leverages the proven Docker patterns from `exampleOnly/` while optimizing for Cloud Run's serverless architecture and Google Cloud's managed services.