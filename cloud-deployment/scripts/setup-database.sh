#!/bin/bash
set -e

# Community Dashboard - Cloud SQL Database Setup Script
echo "🗄️ Setting up Cloud SQL database for Community Dashboard"

# Configuration
PROJECT_ID=${1:-serverless-test-12345}
REGION=${2:-us-central1}
DB_INSTANCE_NAME="community-dashboard-db"
DB_NAME="dashboarddb"
DB_USER="dashboard_user"

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

# Generate a secure password for the database user
DB_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)

# Create Cloud SQL instance
log_info "Creating Cloud SQL PostgreSQL instance..."
if gcloud sql instances describe $DB_INSTANCE_NAME --quiet 2>/dev/null; then
    log_warning "Cloud SQL instance '$DB_INSTANCE_NAME' already exists"
else
    log_info "Creating new Cloud SQL instance..."
    gcloud sql instances create $DB_INSTANCE_NAME \
        --database-version=POSTGRES_15 \
        --tier=db-f1-micro \
        --region=$REGION \
        --storage-auto-increase \
        --storage-size=10GB \
        --storage-type=SSD \
        --backup-start-time=03:00 \
        --maintenance-window-day=SUN \
        --maintenance-window-hour=04 \
        --database-flags=max_connections=100 \
        --deletion-protection \
        --availability-type=zonal \
        --assign-ip \
        --authorized-networks=0.0.0.0/0
    
    log_success "Cloud SQL instance created successfully!"
fi

# Set root password
log_info "Setting root password for Cloud SQL instance..."
ROOT_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-25)
gcloud sql users set-password postgres \
    --instance=$DB_INSTANCE_NAME \
    --password=$ROOT_PASSWORD

# Create database
log_info "Creating database '$DB_NAME'..."
if gcloud sql databases describe $DB_NAME --instance=$DB_INSTANCE_NAME --quiet 2>/dev/null; then
    log_warning "Database '$DB_NAME' already exists"
else
    gcloud sql databases create $DB_NAME --instance=$DB_INSTANCE_NAME
    log_success "Database '$DB_NAME' created successfully!"
fi

# Create database user
log_info "Creating database user '$DB_USER'..."
if gcloud sql users describe $DB_USER --instance=$DB_INSTANCE_NAME --quiet 2>/dev/null; then
    log_warning "User '$DB_USER' already exists, updating password..."
    gcloud sql users set-password $DB_USER \
        --instance=$DB_INSTANCE_NAME \
        --password=$DB_PASSWORD
else
    gcloud sql users create $DB_USER \
        --instance=$DB_INSTANCE_NAME \
        --password=$DB_PASSWORD \
        --type=built_in
    log_success "Database user created successfully!"
fi

# Get connection details
log_info "Getting connection details..."
CONNECTION_NAME=$(gcloud sql instances describe $DB_INSTANCE_NAME --format="value(connectionName)")
PUBLIC_IP=$(gcloud sql instances describe $DB_INSTANCE_NAME --format="value(ipAddresses[0].ipAddress)")

# Construct DATABASE_URL
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${PUBLIC_IP}:5432/${DB_NAME}"

# Store credentials in Secret Manager
log_info "Storing database credentials in Secret Manager..."

# Store DATABASE_URL
if gcloud secrets describe database-url --quiet 2>/dev/null; then
    log_warning "Secret 'database-url' already exists, updating..."
    echo -n "$DATABASE_URL" | gcloud secrets versions add database-url --data-file=-
else
    echo -n "$DATABASE_URL" | gcloud secrets create database-url --data-file=-
fi

# Store root password
if gcloud secrets describe db-root-password --quiet 2>/dev/null; then
    log_warning "Secret 'db-root-password' already exists, updating..."
    echo -n "$ROOT_PASSWORD" | gcloud secrets versions add db-root-password --data-file=-
else
    echo -n "$ROOT_PASSWORD" | gcloud secrets create db-root-password --data-file=-
fi

# Create VPC connector for private connection (optional but recommended)
log_info "Creating VPC connector for private database access..."
VPC_CONNECTOR="dashboard-connector"

if gcloud compute networks vpc-access connectors describe $VPC_CONNECTOR --region=$REGION --quiet 2>/dev/null; then
    log_warning "VPC connector '$VPC_CONNECTOR' already exists"
else
    gcloud compute networks vpc-access connectors create $VPC_CONNECTOR \
        --region=$REGION \
        --range=10.8.0.0/28 \
        --network=default \
        --min-instances=2 \
        --max-instances=3 \
        --machine-type=f1-micro
    log_success "VPC connector created successfully!"
fi

log_success "Database setup completed!"

echo ""
echo "📋 Database Configuration Summary:"
echo "=================================="
echo "Instance Name: $DB_INSTANCE_NAME"
echo "Database Name: $DB_NAME"
echo "Database User: $DB_USER"
echo "Connection Name: $CONNECTION_NAME"
echo "Public IP: $PUBLIC_IP"
echo "VPC Connector: $VPC_CONNECTOR"
echo ""
echo "🔐 Credentials stored in Secret Manager:"
echo "- database-url: DATABASE_URL connection string"
echo "- db-root-password: PostgreSQL root password"
echo ""
echo "📋 Next steps:"
echo "1. Run ./cloud-deployment/scripts/setup-secrets.sh to configure other secrets"
echo "2. Run ./cloud-deployment/scripts/deploy.sh to deploy the application"
echo ""
echo "⚠️  Note: The database is configured with public IP access for initial setup."
echo "   Consider configuring private IP after deployment for enhanced security."
