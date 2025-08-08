#!/usr/bin/env bash
set -euo pipefail

# Deploy the app to Google Cloud Run using Cloud Build + Artifact Registry.
# Requirements: gcloud CLI authenticated and a GCP project set.
#
# Usage:
#   scripts/deploy_cloud_run.sh \
#     -p <PROJECT_ID> \
#     -r <REGION> \
#     -s <SERVICE_NAME> \
#     [-R <REPOSITORY>] \
#     [-e <ENV_FILE>] \
#     [--allow-unauthenticated]
#
# Defaults:
#   REGION: us-central1
#   SERVICE_NAME: community-dashboard
#   REPOSITORY: app-images
#   PORT (Cloud Run): 8080

PROJECT_ID=""
REGION="us-central1"
SERVICE_NAME="community-dashboard"
REPOSITORY="app-images"
ENV_FILE=""
ALLOW_FLAG="--no-allow-unauthenticated"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--project)
      PROJECT_ID="$2"; shift 2;;
    -r|--region)
      REGION="$2"; shift 2;;
    -s|--service)
      SERVICE_NAME="$2"; shift 2;;
    -R|--repository)
      REPOSITORY="$2"; shift 2;;
    -e|--env-file)
      ENV_FILE="$2"; shift 2;;
    --allow-unauthenticated)
      ALLOW_FLAG="--allow-unauthenticated"; shift;;
    *)
      echo "Unknown argument: $1"; exit 1;;
  esac
done

# Check for gcloud
if ! command -v gcloud >/dev/null 2>&1; then
  echo "Error: gcloud CLI not found. Install the Google Cloud SDK and authenticate: https://cloud.google.com/sdk/docs/install" >&2
  exit 2
fi

# Determine project
if [[ -z "$PROJECT_ID" ]]; then
  PROJECT_ID=$(gcloud config get-value project 2>/dev/null || true)
fi
if [[ -z "$PROJECT_ID" ]]; then
  echo "Error: No GCP project provided and none set in gcloud config. Use -p <PROJECT_ID> or run 'gcloud config set project <PROJECT_ID>'." >&2
  exit 2
fi

# Ensure auth present
ACTIVE_ACCT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" || true)
if [[ -z "$ACTIVE_ACCT" ]]; then
  echo "Error: No active gcloud account. Run 'gcloud auth login' (and 'gcloud auth application-default login' if needed)." >&2
  exit 2
fi

echo "Project: $PROJECT_ID"
echo "Region:  $REGION"
echo "Service: $SERVICE_NAME"
echo "Repo:    $REPOSITORY"

# Enable required services
REQUIRED_APIS=(
  run.googleapis.com
  artifactregistry.googleapis.com
  cloudbuild.googleapis.com
  logging.googleapis.com
)
echo "Enabling required services (idempotent)..."
gcloud services enable "${REQUIRED_APIS[@]}" --project "$PROJECT_ID" >/dev/null

# Create Artifact Registry repo if missing (idempotent)
if ! gcloud artifacts repositories describe "$REPOSITORY" --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "Creating Artifact Registry repo '$REPOSITORY' in $REGION..."
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Container images for $SERVICE_NAME" \
    --project="$PROJECT_ID"
fi

# Build image
GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)
IMAGE_URI="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/$SERVICE_NAME:$GIT_SHA"

echo "Building and pushing image via Cloud Build: $IMAGE_URI"
gcloud builds submit --tag "$IMAGE_URI" --project "$PROJECT_ID"

## Prepare environment variables for deployment
# Prefer an env-vars file (YAML) to safely handle commas, spaces, etc.
ENV_VARS_ARGS=()
REMOVE_SECRETS_ARGS=()
# Ensure arrays are defined to avoid set -u issues
KEYS_TO_SET=()
if [[ -n "$ENV_FILE" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Env file not found: $ENV_FILE" >&2; exit 2
  fi
  echo "Processing env file: $ENV_FILE"
  TMP_DIR="$(mktemp -d)"
  YAML_FILE="$TMP_DIR/env.yaml"
  # Start a fresh YAML file. Do NOT set PORT; Cloud Run sets it.
  : > "$YAML_FILE"
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip comments and empty lines
    [[ "$line" =~ ^[[:space:]]*#.*$ || -z "$line" ]] && continue
    if [[ "$line" =~ ^[[:space:]]*([A-Za-z0-9_]+)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      # Skip PORT from file to avoid duplicates; Cloud Run must use 8080
      [[ "$key" == "PORT" ]] && continue
      # Strip surrounding quotes if present
      val="${val#\"}"; val="${val%\"}"
      # Escape backslashes and double quotes for YAML safety
      val_escaped="${val//\\/\\\\}"
      val_escaped="${val_escaped//\"/\\\"}"
      # Deduplicate keys when building both YAML and removal list (Bash 3 compatible)
      already_added="false"
      for existing_key in "${KEYS_TO_SET[@]-}"; do
        if [[ "$existing_key" == "$key" ]]; then
          already_added="true"
          break
        fi
      done
      if [[ "$already_added" == "false" ]]; then
        echo "$key: \"$val_escaped\"" >> "$YAML_FILE"
        KEYS_TO_SET+=("$key")
      fi
    fi
  done < "$ENV_FILE"
  ENV_VARS_ARGS=(--env-vars-file "$YAML_FILE")
  # Proactively remove any existing secrets with the same keys to avoid type conflicts
  if [[ ${#KEYS_TO_SET[@]-0} -gt 0 ]]; then
    REMOVE_KEYS_CSV=""
    for k in "${KEYS_TO_SET[@]-}"; do
      if [[ -z "$REMOVE_KEYS_CSV" ]]; then
        REMOVE_KEYS_CSV="$k"
      else
        REMOVE_KEYS_CSV="$REMOVE_KEYS_CSV,$k"
      fi
    done
    REMOVE_SECRETS_ARGS=(--remove-secrets "$REMOVE_KEYS_CSV")
    # Pre-clear any conflicting secret mappings on the existing service (if present)
    echo "Pre-clearing secret mappings for keys (if any exist): $REMOVE_KEYS_CSV"
    gcloud run services update "$SERVICE_NAME" \
      --region="$REGION" \
      --project="$PROJECT_ID" \
      --remove-secrets "$REMOVE_KEYS_CSV" || true
  fi
else
  # No env file provided; do not set env vars here. Cloud Run sets PORT automatically.
  ENV_VARS_ARGS=()
fi

# Deploy to Cloud Run
echo "Deploying to Cloud Run service: $SERVICE_NAME"
DEPLOY_CMD=(
  gcloud run deploy "$SERVICE_NAME"
  --image="$IMAGE_URI"
  --platform=managed
  --region="$REGION"
  --project="$PROJECT_ID"
  $ALLOW_FLAG
  "${ENV_VARS_ARGS[@]}"
  "${REMOVE_SECRETS_ARGS[@]}"
  --port=8080
  --timeout=1800
  --memory=1Gi
  --max-instances=3
)
"${DEPLOY_CMD[@]}"

# Get URL
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')
echo "Service URL: $SERVICE_URL"

# Show recent logs
echo "Fetching recent logs (last 100 lines) for service: $SERVICE_NAME"
gcloud logs read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --limit=100 \
  --format='value(textPayload)' || true

echo "Done."