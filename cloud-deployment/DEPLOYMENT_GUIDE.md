# Chat-Based Community Dashboard - Google Cloud Run Deployment Guide

## Overview

This guide walks you through deploying the Chat-Based Community Dashboard to Google Cloud Run. The application is a modern Next.js web service that provides community management features including user management, Matrix chat integration, and administrative dashboards.

## Prerequisites

### 1. Google Cloud Account
- Active Google Cloud account with billing enabled
- Google Cloud CLI (`gcloud`) installed and configured
- Docker installed locally

### 2. Local Setup
```bash
# Clone the repository (if not already done)
cd /Users/admin/Documents/Git/chat-based-community-dashboard

# Install Google Cloud CLI (if not already installed)
# macOS: brew install google-cloud-sdk
# Linux: Follow https://cloud.google.com/sdk/docs/install

# Authenticate with Google Cloud (already done)
gcloud auth login
gcloud auth configure-docker
```

### 3. Required APIs
Enable these Google Cloud APIs in your project:
- Cloud Run API
- Cloud SQL API
- Cloud Build API
- Secret Manager API
- Artifact Registry API

## Step-by-Step Deployment

### Step 1: Project Setup

```bash
# Use existing project (already configured)
gcloud config set project serverless-test-12345

# Enable billing (should already be enabled)
# Go to: https://console.cloud.google.com/billing/linkedaccount?project=serverless-test-12345
```

### Step 2: Enable Required APIs

```bash
# Run the API enablement script
./cloud-deployment/scripts/enable-apis.sh
```

### Step 3: Set Up Environment Variables

```bash
# Copy environment template
cp cloud-deployment/env/.env.cloud.template cloud-deployment/env/.env.cloud

# Edit the environment file with your specific values
vim cloud-deployment/env/.env.cloud
```

Required environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- `NEXTAUTH_SECRET`: Random secret for NextAuth.js
- `MATRIX_HOMESERVER_URL`: Matrix homeserver URL
- `MATRIX_ACCESS_TOKEN`: Matrix bot access token
- `REDIS_URL`: Redis connection string (optional)

### Step 4: Create Cloud SQL Database

```bash
# Run the database setup script
./cloud-deployment/scripts/setup-database.sh
```

### Step 5: Store Secrets in Secret Manager

```bash
# Run the secrets setup script
./cloud-deployment/scripts/setup-secrets.sh
```

### Step 6: Build and Deploy

```bash
# Run the complete deployment script
./cloud-deployment/scripts/deploy.sh
```

### Step 7: Verify Deployment

```bash
# Check deployment status
gcloud run services describe community-dashboard --region=us-central1

# Get the service URL
gcloud run services describe community-dashboard --region=us-central1 --format="value(status.url)"
```

## Configuration Files

### Docker Configuration
- `cloud-deployment/docker/Dockerfile.cloudrun`: Optimized for Cloud Run
- `cloud-deployment/docker/docker-entrypoint.sh`: Cloud Run entrypoint script

### Cloud Build
- `cloud-deployment/cloudbuild.yaml`: Build and deployment pipeline
- `cloud-deployment/cloudbuild-staging.yaml`: Staging environment pipeline

### Scripts
- `cloud-deployment/scripts/deploy.sh`: Main deployment script
- `cloud-deployment/scripts/setup-database.sh`: Database setup
- `cloud-deployment/scripts/setup-secrets.sh`: Secret management
- `cloud-deployment/scripts/enable-apis.sh`: API enablement

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Cloud Run     │    │   Cloud SQL     │    │ Secret Manager  │
│  (Next.js App)  │◄──►│  (PostgreSQL)   │    │   (Secrets)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                        │                       │
         │              ┌─────────────────┐              │
         └─────────────►│ Artifact Registry│◄─────────────┘
                        │   (Images)      │
                        └─────────────────┘
```

## Environment-Specific Configurations

### Production
- **Memory**: 2 GiB
- **CPU**: 2 vCPU
- **Max Instances**: 10
- **Min Instances**: 1 (to reduce cold starts)
- **Concurrency**: 80

### Staging
- **Memory**: 1 GiB
- **CPU**: 1 vCPU
- **Max Instances**: 3
- **Min Instances**: 0
- **Concurrency**: 40

## Cost Optimization

1. **Instance Scaling**: Configure min instances to 0 for staging, 1 for production
2. **Resource Limits**: Use appropriate CPU/memory limits
3. **Cold Start Mitigation**: Use warming requests for production
4. **Database**: Use Cloud SQL with automatic scaling

## Security Best Practices

1. **Secret Management**: All secrets stored in Secret Manager
2. **IAM**: Least privilege access
3. **Network**: VPC connector for private communication
4. **SSL**: Automatic HTTPS termination
5. **Authentication**: OAuth2/OIDC integration

## Monitoring and Logging

- **Cloud Logging**: Centralized log aggregation
- **Cloud Monitoring**: Performance and health metrics
- **Error Reporting**: Automatic error tracking
- **Uptime Checks**: Health monitoring

## Troubleshooting

### Common Issues

1. **Cold Start Timeouts**
   - Increase timeout settings
   - Use min instances > 0
   - Optimize Docker image size

2. **Database Connection Issues**
   - Check Cloud SQL instance status
   - Verify connection string in secrets
   - Check VPC connector configuration

3. **Build Failures**
   - Check Cloud Build logs
   - Verify Docker configuration
   - Check resource limits

### Useful Commands

```bash
# View logs
gcloud run services logs tail community-dashboard --region=us-central1

# Check service status
gcloud run services describe community-dashboard --region=us-central1

# Update environment variables
gcloud run services update community-dashboard --region=us-central1 --set-env-vars="KEY=value"

# Scale service
gcloud run services update community-dashboard --region=us-central1 --min-instances=1 --max-instances=10
```

## Next Steps

1. Set up monitoring dashboards
2. Configure custom domains
3. Implement CI/CD pipeline
4. Set up staging environment
5. Configure backup strategy

## Support

For issues and questions:
- Check the troubleshooting section above
- Review Cloud Run documentation
- Check application logs in Cloud Logging
