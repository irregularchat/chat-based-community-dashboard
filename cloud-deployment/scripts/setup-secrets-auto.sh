#!/bin/bash
set -e

# Community Dashboard - Quick Secret Setup Script
echo "🔐 Setting up secrets automatically for Community Dashboard"

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

create_or_update_secret() {
    local secret_name="$1"
    local secret_value="$2"
    
    if gcloud secrets describe "$secret_name" --quiet 2>/dev/null; then
        log_warning "Secret '$secret_name' already exists, updating..."
        echo -n "$secret_value" | gcloud secrets versions add "$secret_name" --data-file=-
    else
        log_info "Creating secret '$secret_name'..."
        echo -n "$secret_value" | gcloud secrets create "$secret_name" --data-file=-
    fi
    log_success "Secret '$secret_name' configured successfully"
}

# Set the active project
log_info "Setting project to $PROJECT_ID"
gcloud config set project $PROJECT_ID

echo ""
echo "🔐 Community Dashboard Secret Configuration"
echo "==========================================="
echo ""

# Generate default values
NEXTAUTH_SECRET=$(openssl rand -base64 32)
ADMIN_PASSWORD="Dashboard_Admin123!"

# Configure required secrets
log_info "Configuring application secrets..."

# NextAuth Secret
create_or_update_secret "nextauth-secret" "$NEXTAUTH_SECRET"

# Admin Password  
create_or_update_secret "admin-password" "$ADMIN_PASSWORD"

# Matrix Configuration (using placeholder values for now)
create_or_update_secret "matrix-homeserver-url" "https://matrix.example.com"
create_or_update_secret "matrix-access-token" "placeholder-token"

# Redis URL (placeholder for now, will use in-memory storage)
create_or_update_secret "redis-url" "redis://localhost:6379"

# Grant Cloud Run service access to secrets
log_info "Configuring Cloud Run service account access to secrets..."

# Get the default Cloud Run service account
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
CLOUD_RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

secrets=(
    "database-url"
    "nextauth-secret" 
    "admin-password"
    "matrix-homeserver-url"
    "matrix-access-token"
    "redis-url"
)

for secret in "${secrets[@]}"; do
    if gcloud secrets describe "$secret" --quiet 2>/dev/null; then
        log_info "Granting access to secret '$secret'..."
        gcloud secrets add-iam-policy-binding "$secret" \
            --member="serviceAccount:$CLOUD_RUN_SA" \
            --role="roles/secretmanager.secretAccessor" \
            --quiet
    fi
done

log_success "Secret Manager setup completed!"

echo ""
echo "📋 Secrets Configuration Summary:"
echo "================================"
echo "✅ nextauth-secret: NextAuth.js session encryption"
echo "✅ admin-password: Default admin user password ($ADMIN_PASSWORD)"
echo "✅ matrix-homeserver-url: Matrix homeserver URL (placeholder)"
echo "✅ matrix-access-token: Matrix bot access token (placeholder)"
echo "✅ redis-url: Redis connection string (empty - using in-memory)"
echo "✅ database-url: PostgreSQL connection string (from database setup)"
echo ""
echo "🔐 All secrets are accessible by Cloud Run service account:"
echo "   $CLOUD_RUN_SA"
echo ""
echo "📋 Next steps:"
echo "1. Run ./cloud-deployment/scripts/deploy.sh to deploy the application"
echo "2. Access your application at the Cloud Run service URL"
echo "3. Login with admin credentials:"
echo "   - Username: admin"
echo "   - Password: $ADMIN_PASSWORD"
echo ""
echo "⚠️  Note: Matrix integration uses placeholder values."
echo "   Update the matrix-* secrets with real values for Matrix functionality."
