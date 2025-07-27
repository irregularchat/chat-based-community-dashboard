#!/bin/bash

# Chat-Based Community Dashboard - Google Cloud Run Deployment Script
set -e

# Configuration
PROJECT_ID="${GOOGLE_CLOUD_PROJECT_ID:-speech-memorization}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="community-dashboard"
DATABASE_INSTANCE_NAME="community-dashboard-db"
REDIS_INSTANCE_NAME="community-dashboard-redis"

echo "🚀 Deploying Chat-Based Community Dashboard to Google Cloud Run"
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"

# Set the active project
gcloud config set project $PROJECT_ID

# Enable required APIs
echo "📋 Enabling required Google Cloud APIs..."
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    sql-component.googleapis.com \
    sqladmin.googleapis.com \
    redis.googleapis.com \
    storage-component.googleapis.com \
    storage.googleapis.com \
    secretmanager.googleapis.com \
    cloudresourcemanager.googleapis.com

# Create Cloud SQL instance for PostgreSQL
echo "🗄️ Creating Cloud SQL PostgreSQL instance..."
if ! gcloud sql instances describe $DATABASE_INSTANCE_NAME --quiet 2>/dev/null; then
    gcloud sql instances create $DATABASE_INSTANCE_NAME \
        --database-version=POSTGRES_15 \
        --tier=db-f1-micro \
        --region=$REGION \
        --storage-auto-increase \
        --storage-size=10GB \
        --storage-type=SSD \
        --backup-start-time=03:00 \
        --maintenance-window-day=SUN \
        --maintenance-window-hour=04 \
        --deletion-protection
        
    echo "✅ Cloud SQL instance created"
else
    echo "✅ Cloud SQL instance already exists"
fi

# Create database and user
echo "📊 Setting up database and user..."
gcloud sql databases create community_dashboard --instance=$DATABASE_INSTANCE_NAME || true
gcloud sql users create dashboard_user --instance=$DATABASE_INSTANCE_NAME --password=dashboard_password || true

# Create Redis instance
echo "🔴 Creating Redis instance..."
if ! gcloud redis instances describe $REDIS_INSTANCE_NAME --region=$REGION --quiet 2>/dev/null; then
    gcloud redis instances create $REDIS_INSTANCE_NAME \
        --size=1 \
        --region=$REGION \
        --redis-version=redis_6_x \
        --tier=basic \
        --network=default
        
    echo "✅ Redis instance created"
else
    echo "✅ Redis instance already exists"
fi

# Create storage bucket for media files
echo "📦 Creating storage bucket..."
BUCKET_NAME="${PROJECT_ID}-community-dashboard-media"
gsutil mb -p $PROJECT_ID -c STANDARD -l $REGION gs://$BUCKET_NAME/ || true
gsutil iam ch allUsers:objectViewer gs://$BUCKET_NAME || true

# Create secrets
echo "🔐 Creating secrets..."

# Generate NextAuth secret
NEXTAUTH_SECRET=$(openssl rand -base64 32)
echo $NEXTAUTH_SECRET | gcloud secrets create nextauth-secret --data-file=- || \
echo $NEXTAUTH_SECRET | gcloud secrets versions add nextauth-secret --data-file=-

# Database URL
DB_CONNECTION_NAME=$(gcloud sql instances describe $DATABASE_INSTANCE_NAME --format="value(connectionName)")
DATABASE_URL="postgresql://dashboard_user:dashboard_password@/$DATABASE_INSTANCE_NAME?host=/cloudsql/$DB_CONNECTION_NAME"
echo $DATABASE_URL | gcloud secrets create database-url --data-file=- || \
echo $DATABASE_URL | gcloud secrets versions add database-url --data-file=-

# Redis URL
REDIS_IP=$(gcloud redis instances describe $REDIS_INSTANCE_NAME --region=$REGION --format="value(host)")
REDIS_URL="redis://$REDIS_IP:6379/0"
echo $REDIS_URL | gcloud secrets create redis-url --data-file=- || \
echo $REDIS_URL | gcloud secrets versions add redis-url --data-file=-

# Matrix credentials (you'll need to set these manually)
if [ ! -z "$MATRIX_HOMESERVER_URL" ]; then
    echo $MATRIX_HOMESERVER_URL | gcloud secrets create matrix-homeserver-url --data-file=- || \
    echo $MATRIX_HOMESERVER_URL | gcloud secrets versions add matrix-homeserver-url --data-file=-
fi

if [ ! -z "$MATRIX_USERNAME" ]; then
    echo $MATRIX_USERNAME | gcloud secrets create matrix-username --data-file=- || \
    echo $MATRIX_USERNAME | gcloud secrets versions add matrix-username --data-file=-
fi

if [ ! -z "$MATRIX_PASSWORD" ]; then
    echo $MATRIX_PASSWORD | gcloud secrets create matrix-password --data-file=- || \
    echo $MATRIX_PASSWORD | gcloud secrets versions add matrix-password --data-file=-
fi

# Email configuration
if [ ! -z "$EMAIL_SERVER" ]; then
    echo $EMAIL_SERVER | gcloud secrets create email-server --data-file=- || \
    echo $EMAIL_SERVER | gcloud secrets versions add email-server --data-file=-
fi

if [ ! -z "$EMAIL_USER" ]; then
    echo $EMAIL_USER | gcloud secrets create email-user --data-file=- || \
    echo $EMAIL_USER | gcloud secrets versions add email-user --data-file=-
fi

if [ ! -z "$EMAIL_PASSWORD" ]; then
    echo $EMAIL_PASSWORD | gcloud secrets create email-password --data-file=- || \
    echo $EMAIL_PASSWORD | gcloud secrets versions add email-password --data-file=-
fi

echo "✅ Secrets created/updated"

# Build and deploy the application
echo "🔨 Building and deploying application..."

# Navigate to the modern-stack directory
cd modern-stack

# Build the Docker image
echo "📦 Building Docker image..."
docker build -t gcr.io/$PROJECT_ID/$SERVICE_NAME:latest .

# Push to Google Container Registry
echo "🚀 Pushing to Container Registry..."
docker push gcr.io/$PROJECT_ID/$SERVICE_NAME:latest

# Deploy to Cloud Run
echo "🌐 Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
    --image gcr.io/$PROJECT_ID/$SERVICE_NAME:latest \
    --platform managed \
    --region $REGION \
    --allow-unauthenticated \
    --port 3000 \
    --memory 2Gi \
    --cpu 2 \
    --max-instances 10 \
    --min-instances 0 \
    --timeout 300 \
    --concurrency 80 \
    --set-env-vars NODE_ENV=production \
    --set-env-vars PORT=3000 \
    --add-cloudsql-instances $DB_CONNECTION_NAME \
    --update-secrets DATABASE_URL=database-url:latest \
    --update-secrets NEXTAUTH_SECRET=nextauth-secret:latest \
    --update-secrets REDIS_URL=redis-url:latest \
    --update-secrets MATRIX_HOMESERVER_URL=matrix-homeserver-url:latest \
    --update-secrets MATRIX_USERNAME=matrix-username:latest \
    --update-secrets MATRIX_PASSWORD=matrix-password:latest \
    --update-secrets EMAIL_SERVER=email-server:latest \
    --update-secrets EMAIL_USER=email-user:latest \
    --update-secrets EMAIL_PASSWORD=email-password:latest

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")

echo "✅ Deployment complete!"
echo "🌐 Service URL: $SERVICE_URL"
echo ""
echo "📋 Next steps:"
echo "1. Set up your environment variables in Google Cloud Secrets Manager"
echo "2. Run database migrations: gcloud run jobs create migrate --image gcr.io/$PROJECT_ID/$SERVICE_NAME:latest"
echo "3. Create admin user: gcloud run jobs create create-admin --image gcr.io/$PROJECT_ID/$SERVICE_NAME:latest"
echo ""
echo "🔧 Useful commands:"
echo "- View logs: gcloud run services logs read $SERVICE_NAME --region=$REGION"
echo "- Update service: gcloud run services update $SERVICE_NAME --region=$REGION"
echo "- Delete service: gcloud run services delete $SERVICE_NAME --region=$REGION" 