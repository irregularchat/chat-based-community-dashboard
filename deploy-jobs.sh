#!/bin/bash

# Chat-Based Community Dashboard - Google Cloud Run Jobs Script
set -e

# Configuration
PROJECT_ID="${GOOGLE_CLOUD_PROJECT_ID:-speech-memorization}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="community-dashboard"

echo "🔧 Setting up Google Cloud Run Jobs for Community Dashboard"
echo "Project: $PROJECT_ID"
echo "Region: $REGION"

# Set the active project
gcloud config set project $PROJECT_ID

# Create migration job
echo "📊 Creating database migration job..."
gcloud run jobs create migrate-database \
    --image gcr.io/$PROJECT_ID/$SERVICE_NAME:latest \
    --region $REGION \
    --memory 1Gi \
    --cpu 1 \
    --timeout 600 \
    --set-env-vars NODE_ENV=production \
    --set-env-vars COMMAND=migrate \
    --add-cloudsql-instances $PROJECT_ID:$REGION:community-dashboard-db \
    --update-secrets DATABASE_URL=database-url:latest \
    --update-secrets NEXTAUTH_SECRET=nextauth-secret:latest

# Create admin user job
echo "👤 Creating admin user job..."
gcloud run jobs create create-admin \
    --image gcr.io/$PROJECT_ID/$SERVICE_NAME:latest \
    --region $REGION \
    --memory 1Gi \
    --cpu 1 \
    --timeout 300 \
    --set-env-vars NODE_ENV=production \
    --set-env-vars COMMAND=create-admin \
    --add-cloudsql-instances $PROJECT_ID:$REGION:community-dashboard-db \
    --update-secrets DATABASE_URL=database-url:latest \
    --update-secrets NEXTAUTH_SECRET=nextauth-secret:latest

# Create seed database job
echo "🌱 Creating database seed job..."
gcloud run jobs create seed-database \
    --image gcr.io/$PROJECT_ID/$SERVICE_NAME:latest \
    --region $REGION \
    --memory 1Gi \
    --cpu 1 \
    --timeout 600 \
    --set-env-vars NODE_ENV=production \
    --set-env-vars COMMAND=seed \
    --add-cloudsql-instances $PROJECT_ID:$REGION:community-dashboard-db \
    --update-secrets DATABASE_URL=database-url:latest \
    --update-secrets NEXTAUTH_SECRET=nextauth-secret:latest

echo "✅ Jobs created successfully!"
echo ""
echo "📋 Available jobs:"
echo "- migrate-database: Run database migrations"
echo "- create-admin: Create admin user"
echo "- seed-database: Seed database with initial data"
echo ""
echo "🔧 To run a job:"
echo "gcloud run jobs execute JOB_NAME --region=$REGION"
echo ""
echo "📊 To view job logs:"
echo "gcloud run jobs logs JOB_NAME --region=$REGION" 