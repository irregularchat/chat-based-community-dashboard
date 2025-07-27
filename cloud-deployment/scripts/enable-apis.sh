#!/bin/bash
set -e

# Community Dashboard - Google Cloud APIs Setup Script
echo "🚀 Enabling Google Cloud APIs for Community Dashboard"

# Configuration
PROJECT_ID=${1:-serverless-test-12345}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Set the active project
log_info "Setting project to $PROJECT_ID"
gcloud config set project $PROJECT_ID

# Enable required APIs
log_info "Enabling required Google Cloud APIs..."

apis=(
    "run.googleapis.com"
    "sql-component.googleapis.com"
    "sqladmin.googleapis.com"
    "cloudbuild.googleapis.com"
    "artifactregistry.googleapis.com"
    "secretmanager.googleapis.com"
    "storage-component.googleapis.com"
    "storage.googleapis.com"
    "compute.googleapis.com"
    "vpcaccess.googleapis.com"
    "servicenetworking.googleapis.com"
    "redis.googleapis.com"
    "monitoring.googleapis.com"
    "logging.googleapis.com"
    "cloudtrace.googleapis.com"
    "clouderrorreporting.googleapis.com"
)

for api in "${apis[@]}"; do
    log_info "Enabling $api..."
    if gcloud services enable "$api" --quiet; then
        log_success "$api enabled successfully"
    else
        log_error "Failed to enable $api"
        exit 1
    fi
done

log_success "All APIs enabled successfully!"

# Verify APIs are enabled
log_info "Verifying enabled APIs..."
enabled_apis=$(gcloud services list --enabled --format="value(config.name)")

for api in "${apis[@]}"; do
    if echo "$enabled_apis" | grep -q "$api"; then
        log_success "✅ $api is enabled"
    else
        log_warning "⚠️ $api may not be enabled yet (propagation delay)"
    fi
done

log_success "API setup completed!"

echo ""
echo "📋 Next steps:"
echo "1. Run ./cloud-deployment/scripts/setup-database.sh to create Cloud SQL instance"
echo "2. Run ./cloud-deployment/scripts/setup-secrets.sh to configure secrets"
echo "3. Run ./cloud-deployment/scripts/deploy.sh to deploy the application"
