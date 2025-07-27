#!/bin/bash
set -e

# Community Dashboard - Secret Manager Setup Script
echo "🔐 Setting up secrets in Google Secret Manager"

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

prompt_secret() {
    local secret_name="$1"
    local description="$2"
    local default_value="$3"
    
    echo ""
    echo "📝 Setting up secret: $secret_name"
    echo "Description: $description"
    
    if [ -n "$default_value" ]; then
        echo "Default value available: [hidden]"
        read -p "Use default value? (y/n): " use_default
        if [ "$use_default" = "y" ] || [ "$use_default" = "Y" ]; then
            echo "$default_value"
            return
        fi
    fi
    
    read -s -p "Enter value for $secret_name: " secret_value
    echo ""
    echo "$secret_value"
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
echo "This script will help you configure the required secrets for the Community Dashboard."
echo "You can either enter new values or use generated defaults where appropriate."
echo ""

# Generate default values
NEXTAUTH_SECRET_DEFAULT=$(openssl rand -base64 32)
ADMIN_PASSWORD_DEFAULT="Dashboard_Admin123!"

# Configure secrets
log_info "Configuring application secrets..."

# NextAuth Secret
nextauth_secret=$(prompt_secret "nextauth-secret" "Secret key for NextAuth.js session encryption" "$NEXTAUTH_SECRET_DEFAULT")
create_or_update_secret "nextauth-secret" "$nextauth_secret"

# Admin Password
admin_password=$(prompt_secret "admin-password" "Default admin user password" "$ADMIN_PASSWORD_DEFAULT")
create_or_update_secret "admin-password" "$admin_password"

# Matrix Configuration
echo ""
log_info "Matrix homeserver configuration..."
echo "Enter your Matrix homeserver details (e.g., https://matrix.irregularchat.com)"
matrix_homeserver=$(prompt_secret "matrix-homeserver-url" "Matrix homeserver URL (e.g., https://matrix.example.com)" "")
create_or_update_secret "matrix-homeserver-url" "$matrix_homeserver"

matrix_token=$(prompt_secret "matrix-access-token" "Matrix bot access token" "")
create_or_update_secret "matrix-access-token" "$matrix_token"

# Redis URL (optional)
echo ""
log_info "Redis configuration (optional)..."
echo "Redis is optional but recommended for session storage and caching."
read -p "Do you want to configure Redis? (y/n): " configure_redis

if [ "$configure_redis" = "y" ] || [ "$configure_redis" = "Y" ]; then
    redis_url=$(prompt_secret "redis-url" "Redis connection URL (e.g., redis://localhost:6379)" "redis://localhost:6379")
    create_or_update_secret "redis-url" "$redis_url"
else
    # Create empty Redis URL secret
    create_or_update_secret "redis-url" ""
    log_info "Redis not configured, using in-memory storage"
fi

# OAuth Configuration (optional)
echo ""
log_info "OAuth/SSO configuration (optional)..."
echo "Configure OAuth providers for single sign-on."
read -p "Do you want to configure OAuth providers? (y/n): " configure_oauth

if [ "$configure_oauth" = "y" ] || [ "$configure_oauth" = "Y" ]; then
    oauth_client_id=$(prompt_secret "oauth-client-id" "OAuth client ID" "")
    create_or_update_secret "oauth-client-id" "$oauth_client_id"
    
    oauth_client_secret=$(prompt_secret "oauth-client-secret" "OAuth client secret" "")
    create_or_update_secret "oauth-client-secret" "$oauth_client_secret"
    
    oauth_issuer=$(prompt_secret "oauth-issuer" "OAuth issuer URL" "")
    create_or_update_secret "oauth-issuer" "$oauth_issuer"
else
    log_info "OAuth not configured, using local authentication only"
fi

# Grant Cloud Run service access to secrets
log_info "Configuring Cloud Run service account access to secrets..."

# Get the default Cloud Run service account
CLOUD_RUN_SA="${PROJECT_ID}-compute@developer.gserviceaccount.com"

secrets=(
    "database-url"
    "nextauth-secret" 
    "admin-password"
    "matrix-homeserver-url"
    "matrix-access-token"
    "redis-url"
)

# Add optional secrets if they were configured
if [ "$configure_oauth" = "y" ] || [ "$configure_oauth" = "Y" ]; then
    secrets+=("oauth-client-id" "oauth-client-secret" "oauth-issuer")
fi

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
echo "✅ admin-password: Default admin user password"
echo "✅ matrix-homeserver-url: Matrix homeserver URL"
echo "✅ matrix-access-token: Matrix bot access token"
echo "✅ redis-url: Redis connection string"
if [ "$configure_oauth" = "y" ] || [ "$configure_oauth" = "Y" ]; then
    echo "✅ oauth-client-id: OAuth client ID"
    echo "✅ oauth-client-secret: OAuth client secret"
    echo "✅ oauth-issuer: OAuth issuer URL"
fi
echo ""
echo "🔐 All secrets are accessible by Cloud Run service account:"
echo "   $CLOUD_RUN_SA"
echo ""
echo "📋 Next steps:"
echo "1. Run ./cloud-deployment/scripts/deploy.sh to deploy the application"
echo "2. Access your application at the Cloud Run service URL"
echo "3. Login with admin credentials:"
echo "   - Username: admin"
echo "   - Password: [configured in admin-password secret]"
echo ""
echo "⚠️  Security Note: Store these credentials securely and consider rotating them regularly."
