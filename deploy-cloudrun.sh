#!/bin/bash
set -e

# Community Dashboard - Google Cloud Run Deployment Script
echo "🚀 Deploying Community Dashboard to Google Cloud Run"

# Configuration
PROJECT_ID=${1:-}
REGION=${2:-us-central1}
SERVICE_NAME="community-dashboard"
DB_INSTANCE_NAME="community-dashboard-db"
ARTIFACT_REPO="community-dashboard"

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

# Validate inputs
if [ -z "$PROJECT_ID" ]; then
    log_error "Please provide PROJECT_ID as first argument"
    echo "Usage: $0 <PROJECT_ID> [REGION]"
    exit 1
fi

# Pre-deployment checks
check_requirements() {
    log_info "Checking deployment requirements..."
    
    # Check gcloud CLI
    if ! command -v gcloud &> /dev/null; then
        log_error "gcloud CLI is not installed. Please install Google Cloud SDK first."
        exit 1
    fi
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Check if logged into gcloud
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
        log_error "Please login to gcloud: gcloud auth login"
        exit 1
    fi
    
    # Set project
    log_info "Setting project to $PROJECT_ID"
    gcloud config set project $PROJECT_ID
    
    log_success "Requirements check passed!"
}

# Enable required APIs
enable_apis() {
    log_info "Enabling required Google Cloud APIs..."
    
    gcloud services enable \
        run.googleapis.com \
        sql-component.googleapis.com \
        sqladmin.googleapis.com \
        cloudbuild.googleapis.com \
        artifactregistry.googleapis.com \
        secretmanager.googleapis.com \
        --quiet
    
    log_success "APIs enabled successfully!"
}

# Create Artifact Registry repository
create_artifact_registry() {
    log_info "Creating Artifact Registry repository..."
    
    if gcloud artifacts repositories describe $ARTIFACT_REPO --location=$REGION &>/dev/null; then
        log_warning "Artifact Registry repository already exists"
    else
        gcloud artifacts repositories create $ARTIFACT_REPO \
            --repository-format=docker \
            --location=$REGION \
            --description="Community Dashboard container images"
        log_success "Artifact Registry repository created!"
    fi
}

# Create Cloud SQL instance
create_cloud_sql() {
    log_info "Setting up Cloud SQL instance..."
    
    if gcloud sql instances describe $DB_INSTANCE_NAME --quiet &>/dev/null; then
        log_warning "Cloud SQL instance already exists"
    else
        log_info "Creating Cloud SQL PostgreSQL instance (this may take a few minutes)..."
        gcloud sql instances create $DB_INSTANCE_NAME \
            --database-version=POSTGRES_15 \
            --tier=db-f1-micro \
            --region=$REGION \
            --root-password=$(openssl rand -base64 32) \
            --storage-type=SSD \
            --storage-size=10GB \
            --backup-start-time=03:00 \
            --enable-bin-log \
            --deletion-protection
        
        log_success "Cloud SQL instance created!"
    fi
    
    # Create database
    if gcloud sql databases describe community_dashboard --instance=$DB_INSTANCE_NAME --quiet &>/dev/null; then
        log_warning "Database already exists"
    else
        gcloud sql databases create community_dashboard --instance=$DB_INSTANCE_NAME
        log_success "Database created!"
    fi
    
    # Create user
    if gcloud sql users describe dashboard_user --instance=$DB_INSTANCE_NAME --quiet &>/dev/null; then
        log_warning "Database user already exists"
    else
        USER_PASSWORD=$(openssl rand -base64 32)
        gcloud sql users create dashboard_user \
            --instance=$DB_INSTANCE_NAME \
            --password=$USER_PASSWORD
        log_success "Database user created!"
        
        # Store password in Secret Manager
        echo -n "$USER_PASSWORD" | gcloud secrets create db-user-password --data-file=-
    fi
}

# Create service account
create_service_account() {
    log_info "Creating service account for Cloud Run..."
    
    SA_EMAIL="community-dashboard-sa@$PROJECT_ID.iam.gserviceaccount.com"
    
    if gcloud iam service-accounts describe $SA_EMAIL --quiet &>/dev/null; then
        log_warning "Service account already exists"
    else
        gcloud iam service-accounts create community-dashboard-sa \
            --display-name="Community Dashboard Service Account" \
            --description="Service account for Community Dashboard Cloud Run service"
        
        # Grant necessary permissions
        gcloud projects add-iam-policy-binding $PROJECT_ID \
            --member="serviceAccount:$SA_EMAIL" \
            --role="roles/cloudsql.client"
        
        gcloud projects add-iam-policy-binding $PROJECT_ID \
            --member="serviceAccount:$SA_EMAIL" \
            --role="roles/secretmanager.secretAccessor"
        
        log_success "Service account created and configured!"
    fi
}

# Setup secrets
setup_secrets() {
    log_info "Setting up secrets in Secret Manager..."
    
    # Create secrets with placeholder values
    create_secret_if_not_exists() {
        local secret_name=$1
        local secret_value=$2
        
        if gcloud secrets describe $secret_name --quiet &>/dev/null; then
            log_warning "Secret $secret_name already exists"
        else
            echo -n "$secret_value" | gcloud secrets create $secret_name --data-file=-
            log_success "Secret $secret_name created!"
        fi
    }
    
    # Generate secure random values
    NEXTAUTH_SECRET=$(openssl rand -base64 32)
    
    create_secret_if_not_exists "nextauth-secret" "$NEXTAUTH_SECRET"
    create_secret_if_not_exists "matrix-access-token" "REPLACE_WITH_YOUR_MATRIX_TOKEN"
    create_secret_if_not_exists "smtp-password" "REPLACE_WITH_YOUR_SMTP_PASSWORD"
    create_secret_if_not_exists "authentik-client-secret" "REPLACE_WITH_YOUR_AUTHENTIK_SECRET"
}

# Build and deploy
build_and_deploy() {
    log_info "Building and deploying application..."
    
    # Configure Docker authentication
    gcloud auth configure-docker $REGION-docker.pkg.dev --quiet
    
    # Build and deploy using Cloud Build
    gcloud builds submit --config cloudbuild.yaml \
        --substitutions _PROJECT_ID=$PROJECT_ID,_REGION=$REGION
    
    log_success "Application built and deployed!"
}

# Get deployment information
show_deployment_info() {
    log_success "🎉 Deployment completed successfully!"
    echo
    
    # Get service URL
    SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")
    
    log_info "Application Information:"
    echo "  🌐 Application URL: $SERVICE_URL"
    echo "  👤 Admin URL: $SERVICE_URL/admin"
    echo "  🔑 Default admin credentials: admin / shareme314"
    echo
    
    log_info "Cloud Resources:"
    echo "  🗄️  Cloud SQL Instance: $DB_INSTANCE_NAME"
    echo "  📦 Artifact Registry: $REGION-docker.pkg.dev/$PROJECT_ID/$ARTIFACT_REPO"
    echo "  🔐 Secrets in Secret Manager: nextauth-secret, matrix-access-token, smtp-password, authentik-client-secret, db-user-password"
    echo
    
    log_info "Useful Commands:"
    echo "  📋 View logs: gcloud run services logs tail $SERVICE_NAME --region=$REGION"
    echo "  🔄 Redeploy: gcloud run services replace-traffic $SERVICE_NAME --to-latest --region=$REGION"
    echo "  🛑 Delete service: gcloud run services delete $SERVICE_NAME --region=$REGION"
    echo "  🗄️  Database shell: gcloud sql connect $DB_INSTANCE_NAME --user=dashboard_user --database=community_dashboard"
    echo
    
    log_warning "Important Next Steps:"
    echo "  1. Update secrets in Secret Manager with real values:"
    echo "     • matrix-access-token: Your Matrix bot access token"
    echo "     • smtp-password: Your SMTP password"
    echo "     • authentik-client-secret: Your Authentik client secret"
    echo "  2. Configure custom domain if needed"
    echo "  3. Set up monitoring and alerting"
    echo "  4. Update NEXTAUTH_URL environment variable to: $SERVICE_URL"
    echo "  5. Test all integrations (Matrix, email, authentication)"
}

# Main deployment process
main() {
    log_info "🎯 Community Dashboard - Cloud Run Deployment"
    echo "   Project: $PROJECT_ID"
    echo "   Region: $REGION"
    echo "   Timestamp: $(date)"
    echo
    
    check_requirements
    enable_apis
    create_artifact_registry
    create_cloud_sql
    create_service_account
    setup_secrets
    build_and_deploy
    show_deployment_info
    
    log_success "✅ Deployment script completed successfully!"
}

# Handle script arguments
case "${1:-}" in
    "")
        log_error "Please provide PROJECT_ID as first argument"
        echo "Usage: $0 <PROJECT_ID> [REGION]"
        exit 1
        ;;
    *)
        main
        ;;
esac