#!/bin/bash
set -e

# Community Dashboard - Complete Google Cloud Deployment Script
echo "🚀 Deploying Community Dashboard to Google Cloud Run"

# Configuration
PROJECT_ID=${1:-serverless-test-12345}
REGION=${2:-us-central1}
SERVICE_NAME="community-dashboard"
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
    
    # Configure Docker for Artifact Registry
    gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet
    
    log_success "Requirements check passed!"
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

# Build and push Docker image
build_and_push_image() {
    log_info "Building Docker image for Cloud Run..."
    
    # Get current git commit SHA for tagging
    COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
    IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}/community-dashboard"
    
    # Build the image
    log_info "Building image with tag: ${IMAGE_TAG}:${COMMIT_SHA}"
    docker build -f cloud-deployment/docker/Dockerfile.cloudrun \
        -t "${IMAGE_TAG}:${COMMIT_SHA}" \
        -t "${IMAGE_TAG}:latest" \
        .
    
    # Push the image
    log_info "Pushing image to Artifact Registry..."
    docker push "${IMAGE_TAG}:${COMMIT_SHA}"
    docker push "${IMAGE_TAG}:latest"
    
    log_success "Image built and pushed successfully!"
    echo "📦 Image: ${IMAGE_TAG}:${COMMIT_SHA}"
}

# Deploy to Cloud Run
deploy_to_cloud_run() {
    log_info "Deploying to Cloud Run..."
    
    COMMIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
    IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}/community-dashboard:${COMMIT_SHA}"
    
    # Deploy the service
    gcloud run deploy $SERVICE_NAME \
        --image="$IMAGE_TAG" \
        --region=$REGION \
        --platform=managed \
        --allow-unauthenticated \
        --port=8080 \
        --memory=2Gi \
        --cpu=2 \
        --max-instances=10 \
        --min-instances=1 \
        --timeout=300 \
        --concurrency=80 \
        --set-env-vars="NODE_ENV=production,PORT=8080,SEED_DATABASE=true,CREATE_ADMIN=true" \
        --add-cloudsql-instances="${PROJECT_ID}:${REGION}:community-dashboard-db" \
        --update-secrets="DATABASE_URL=database-url:latest" \
        --update-secrets="NEXTAUTH_SECRET=nextauth-secret:latest" \
        --update-secrets="DEFAULT_ADMIN_PASSWORD=admin-password:latest" \
        --update-secrets="MATRIX_HOMESERVER_URL=matrix-homeserver-url:latest" \
        --update-secrets="MATRIX_ACCESS_TOKEN=matrix-access-token:latest" \
        --update-secrets="REDIS_URL=redis-url:latest" \
        --vpc-connector="projects/${PROJECT_ID}/locations/${REGION}/connectors/dashboard-connector" \
        --ingress=all \
        --execution-environment=gen2 \
        --quiet
    
    log_success "Deployment to Cloud Run completed!"
}

# Get service information
get_service_info() {
    log_info "Getting service information..."
    
    SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format="value(status.url)")
    
    echo ""
    echo "🎉 Deployment completed successfully!"
    echo "=================================="
    echo "Service Name: $SERVICE_NAME"
    echo "Region: $REGION"
    echo "Service URL: $SERVICE_URL"
    echo ""
    echo "📱 Access your application:"
    echo "🌐 Web Interface: $SERVICE_URL"
    echo "🔐 Admin Login: $SERVICE_URL (username: admin)"
    echo ""
    echo "📋 Useful commands:"
    echo "📊 View logs: gcloud run services logs tail $SERVICE_NAME --region=$REGION"
    echo "📈 Service status: gcloud run services describe $SERVICE_NAME --region=$REGION"
    echo "⚙️  Update service: gcloud run services update $SERVICE_NAME --region=$REGION"
    echo ""
    echo "🔧 Management:"
    echo "• Admin password is stored in Secret Manager (admin-password)"
    echo "• Database is automatically seeded on first startup"
    echo "• Health checks are available at: $SERVICE_URL/api/health"
}

# Main deployment sequence
main() {
    echo "🎯 Starting Cloud Run deployment sequence..."
    echo "Project: $PROJECT_ID"
    echo "Region: $REGION"
    echo "Service: $SERVICE_NAME"
    echo ""
    
    # Run deployment steps
    check_requirements
    create_artifact_registry
    build_and_push_image
    deploy_to_cloud_run
    get_service_info
    
    log_success "Community Dashboard deployed successfully! 🎉"
}

# Handle command line arguments
case "${1:-deploy}" in
    "help"|"-h"|"--help")
        echo "Community Dashboard Deployment Script"
        echo ""
        echo "Usage: $0 [PROJECT_ID] [REGION]"
        echo ""
        echo "Arguments:"
        echo "  PROJECT_ID   Google Cloud project ID (default: serverless-test-12345)"
        echo "  REGION       Google Cloud region (default: us-central1)"
        echo ""
        echo "Examples:"
        echo "  $0                              # Use defaults"
        echo "  $0 my-project                   # Use custom project"
        echo "  $0 my-project us-west1          # Use custom project and region"
        echo ""
        echo "Prerequisites:"
        echo "1. Run ./cloud-deployment/scripts/enable-apis.sh"
        echo "2. Run ./cloud-deployment/scripts/setup-database.sh"
        echo "3. Run ./cloud-deployment/scripts/setup-secrets.sh"
        ;;
    *)
        # Run deployment
        main
        ;;
esac
