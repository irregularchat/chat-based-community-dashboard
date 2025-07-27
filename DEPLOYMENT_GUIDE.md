# Google Cloud Run Deployment Guide

This guide provides step-by-step instructions for deploying the Chat-Based Community Dashboard to Google Cloud Run.

## Prerequisites

1. **Google Cloud CLI** installed and authenticated
2. **Docker** installed and running
3. **Node.js** and **npm** installed
4. **Git** for version control

## Quick Start

### 1. Initial Setup

```bash
# Clone the repository
git clone <your-repo-url>
cd chat-based-community-dashboard

# Make deployment scripts executable
chmod +x deploy-google-cloud.sh
chmod +x deploy-jobs.sh
```

### 2. Configure Environment Variables

Set up your environment variables in Google Cloud Secrets Manager:

```bash
# Matrix credentials
export MATRIX_HOMESERVER_URL="https://your-matrix-server.com"
export MATRIX_USERNAME="your-matrix-username"
export MATRIX_PASSWORD="your-matrix-password"

# Email configuration
export EMAIL_SERVER="smtp://your-smtp-server:587"
export EMAIL_USER="your-email@example.com"
export EMAIL_PASSWORD="your-email-password"
```

### 3. Deploy the Application

```bash
# Run the deployment script
./deploy-google-cloud.sh
```

### 4. Set Up Database

```bash
# Run database migrations
gcloud run jobs execute migrate-database --region=us-central1

# Create admin user
gcloud run jobs execute create-admin --region=us-central1

# Seed database (optional)
gcloud run jobs execute seed-database --region=us-central1
```

## Detailed Configuration

### Project Configuration

The deployment script uses the following configuration:

- **Project ID**: `speech-memorization` (default)
- **Region**: `us-central1` (default)
- **Service Name**: `community-dashboard`
- **Database**: PostgreSQL on Cloud SQL
- **Cache**: Redis on Cloud Memorystore
- **Storage**: Cloud Storage bucket

### Environment Variables

The application requires the following environment variables:

| Variable | Description | Source |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Cloud SQL |
| `NEXTAUTH_SECRET` | NextAuth.js secret | Auto-generated |
| `REDIS_URL` | Redis connection string | Cloud Memorystore |
| `MATRIX_HOMESERVER_URL` | Matrix homeserver URL | Manual |
| `MATRIX_USERNAME` | Matrix username | Manual |
| `MATRIX_PASSWORD` | Matrix password | Manual |
| `EMAIL_SERVER` | SMTP server configuration | Manual |
| `EMAIL_USER` | Email username | Manual |
| `EMAIL_PASSWORD` | Email password | Manual |

### Infrastructure Components

#### Cloud SQL (PostgreSQL)
- **Instance**: `community-dashboard-db`
- **Version**: PostgreSQL 15
- **Tier**: `db-f1-micro` (free tier)
- **Storage**: 10GB SSD with auto-increase
- **Backup**: Daily at 3:00 AM

#### Cloud Memorystore (Redis)
- **Instance**: `community-dashboard-redis`
- **Version**: Redis 6.x
- **Tier**: Basic
- **Size**: 1GB

#### Cloud Storage
- **Bucket**: `{project-id}-community-dashboard-media`
- **Class**: Standard
- **Location**: Same as Cloud Run service

#### Cloud Run Service
- **Memory**: 2Gi
- **CPU**: 2
- **Max Instances**: 10
- **Min Instances**: 0
- **Timeout**: 300 seconds
- **Concurrency**: 80

## Deployment Scripts

### Main Deployment Script (`deploy-google-cloud.sh`)

This script:
1. Enables required Google Cloud APIs
2. Creates Cloud SQL instance
3. Creates Redis instance
4. Creates Cloud Storage bucket
5. Sets up secrets in Secret Manager
6. Builds and pushes Docker image
7. Deploys to Cloud Run

### Jobs Script (`deploy-jobs.sh`)

This script creates Cloud Run jobs for:
- Database migrations
- Admin user creation
- Database seeding

## Manual Deployment Steps

If you prefer to deploy manually:

### 1. Enable APIs

```bash
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    sql-component.googleapis.com \
    sqladmin.googleapis.com \
    redis.googleapis.com \
    storage-component.googleapis.com \
    storage.googleapis.com \
    secretmanager.googleapis.com
```

### 2. Create Cloud SQL Instance

```bash
gcloud sql instances create community-dashboard-db \
    --database-version=POSTGRES_15 \
    --tier=db-f1-micro \
    --region=us-central1 \
    --storage-auto-increase \
    --storage-size=10GB \
    --storage-type=SSD
```

### 3. Create Database and User

```bash
gcloud sql databases create community_dashboard --instance=community-dashboard-db
gcloud sql users create dashboard_user --instance=community-dashboard-db --password=dashboard_password
```

### 4. Create Redis Instance

```bash
gcloud redis instances create community-dashboard-redis \
    --size=1 \
    --region=us-central1 \
    --redis-version=redis_6_x \
    --tier=basic
```

### 5. Build and Deploy

```bash
# Navigate to modern-stack directory
cd modern-stack

# Build Docker image
docker build -f ../Dockerfile.cloud -t gcr.io/speech-memorization/community-dashboard:latest .

# Push to Container Registry
docker push gcr.io/speech-memorization/community-dashboard:latest

# Deploy to Cloud Run
gcloud run deploy community-dashboard \
    --image gcr.io/speech-memorization/community-dashboard:latest \
    --platform managed \
    --region us-central1 \
    --allow-unauthenticated \
    --port 3000 \
    --memory 2Gi \
    --cpu 2 \
    --max-instances 10 \
    --min-instances 0 \
    --timeout 300 \
    --concurrency 80
```

## Monitoring and Logs

### View Service Logs

```bash
gcloud run services logs read community-dashboard --region=us-central1
```

### View Job Logs

```bash
gcloud run jobs logs migrate-database --region=us-central1
gcloud run jobs logs create-admin --region=us-central1
gcloud run jobs logs seed-database --region=us-central1
```

### Monitor Performance

```bash
# View service metrics
gcloud run services describe community-dashboard --region=us-central1

# View database metrics
gcloud sql instances describe community-dashboard-db
```

## Troubleshooting

### Common Issues

1. **Database Connection Issues**
   - Verify Cloud SQL instance is running
   - Check connection string format
   - Ensure Cloud Run has access to Cloud SQL

2. **Memory Issues**
   - Increase memory allocation in Cloud Run
   - Check for memory leaks in application

3. **Timeout Issues**
   - Increase timeout in Cloud Run configuration
   - Optimize database queries
   - Use connection pooling

4. **Build Issues**
   - Check Docker build logs
   - Verify all dependencies are included
   - Ensure proper Dockerfile configuration

### Debug Commands

```bash
# Test database connection
gcloud sql connect community-dashboard-db --user=dashboard_user

# Check Redis connection
gcloud redis instances describe community-dashboard-redis --region=us-central1

# View service configuration
gcloud run services describe community-dashboard --region=us-central1

# Check secrets
gcloud secrets list
```

## Cost Optimization

### Free Tier Usage

- Cloud SQL: `db-f1-micro` instance
- Cloud Run: 2 million requests per month
- Cloud Storage: 5GB per month
- Cloud Memorystore: Not available in free tier

### Cost Monitoring

```bash
# View billing information
gcloud billing accounts list

# Set up billing alerts
gcloud alpha billing budgets create
```

## Security Best Practices

1. **Secrets Management**
   - Use Google Secret Manager for sensitive data
   - Rotate secrets regularly
   - Limit access to secrets

2. **Network Security**
   - Use private Cloud SQL instances
   - Configure firewall rules
   - Enable Cloud Armor for DDoS protection

3. **Access Control**
   - Use service accounts with minimal permissions
   - Enable audit logging
   - Regular access reviews

## Updates and Maintenance

### Updating the Application

```bash
# Build new image
docker build -f ../Dockerfile.cloud -t gcr.io/speech-memorization/community-dashboard:latest .

# Push to registry
docker push gcr.io/speech-memorization/community-dashboard:latest

# Update service
gcloud run services update community-dashboard \
    --image gcr.io/speech-memorization/community-dashboard:latest \
    --region=us-central1
```

### Database Migrations

```bash
# Run migrations
gcloud run jobs execute migrate-database --region=us-central1
```

### Backup and Recovery

```bash
# Create database backup
gcloud sql backups create --instance=community-dashboard-db

# List backups
gcloud sql backups list --instance=community-dashboard-db

# Restore from backup
gcloud sql instances restore-backup community-dashboard-db BACKUP_ID
```

## Support and Resources

- [Google Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Cloud SQL Documentation](https://cloud.google.com/sql/docs)
- [Cloud Memorystore Documentation](https://cloud.google.com/memorystore/docs)
- [Secret Manager Documentation](https://cloud.google.com/secret-manager/docs) 