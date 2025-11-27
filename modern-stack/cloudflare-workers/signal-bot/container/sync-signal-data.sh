#!/bin/bash

#
# Signal Data R2 Sync Script
#
# This script syncs the signal-cli data directory with R2 storage
# to persist Signal account data across container restarts.
#

set -e

SIGNAL_DATA_DIR="${SIGNAL_CLI_CONFIG_DIR:-/app/signal-data}"
R2_BACKUP_KEY="signal-data-backup.tar.gz"

echo "🔄 Signal Data R2 Sync Script"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Function to download signal-data from R2
download_from_r2() {
    echo "📥 Checking for existing Signal data in R2..."

    # Try to download existing backup from R2
    HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/signal-data-backup.tar.gz \
        -H "Authorization: Bearer ${WORKER_API_TOKEN}" \
        "${WORKER_API_URL}/api/r2/download/${R2_BACKUP_KEY}")

    if [ "$HTTP_CODE" = "200" ] && [ -f /tmp/signal-data-backup.tar.gz ] && [ -s /tmp/signal-data-backup.tar.gz ]; then
        echo "✅ Found existing Signal data in R2"
        echo "📦 Extracting to ${SIGNAL_DATA_DIR}..."

        mkdir -p "${SIGNAL_DATA_DIR}"
        tar -xzf /tmp/signal-data-backup.tar.gz -C "${SIGNAL_DATA_DIR}"
        rm /tmp/signal-data-backup.tar.gz

        # Regenerate account.db from SQL dump if it exists
        ACCOUNT_DIR="${SIGNAL_DATA_DIR}/data/813876.d"
        if [ -f "${ACCOUNT_DIR}/account_dump.sql" ]; then
            echo "🔧 Regenerating account.db from SQL dump..."
            rm -f "${ACCOUNT_DIR}"/account.db*
            cd "${ACCOUNT_DIR}"
            sqlite3 account.db < account_dump.sql 2>&1 | grep -v "UNIQUE constraint" || true
            echo "✅ account.db regenerated successfully"
        fi

        echo "✅ Signal data restored from R2"
        return 0
    else
        echo "ℹ️  No existing Signal data found in R2 (HTTP $HTTP_CODE - normal for first run)"
        mkdir -p "${SIGNAL_DATA_DIR}"
        rm -f /tmp/signal-data-backup.tar.gz
        return 1
    fi
}

# Function to upload signal-data to R2
upload_to_r2() {
    echo "📤 Backing up Signal data to R2..."

    if [ ! -d "${SIGNAL_DATA_DIR}" ] || [ -z "$(ls -A ${SIGNAL_DATA_DIR})" ]; then
        echo "⚠️  Signal data directory is empty, skipping backup"
        return 1
    fi

    # Create tarball - EXCLUDE account.db* files to prevent corruption
    # account.db will be regenerated from account_dump.sql on restore
    cd "$(dirname ${SIGNAL_DATA_DIR})"
    tar -czf /tmp/signal-data-backup.tar.gz \
        --exclude='*/813876.d/account.db*' \
        --exclude='*/data/*/account.db*' \
        "$(basename ${SIGNAL_DATA_DIR})"
    echo "ℹ️  Excluded account.db* from backup (will regenerate from SQL dump)"

    # Encode to base64
    BASE64_CONTENT=$(base64 -i /tmp/signal-data-backup.tar.gz | tr -d '\n')

    # Create JSON payload
    JSON_PAYLOAD=$(cat <<EOF
{
  "key": "${R2_BACKUP_KEY}",
  "content": "${BASE64_CONTENT}",
  "contentType": "application/gzip",
  "encoding": "base64"
}
EOF
)

    # Upload to R2 via Worker API
    HTTP_CODE=$(curl -s -w "%{http_code}" -o /tmp/upload-response.json -X POST \
        -H "Authorization: Bearer ${WORKER_API_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "${JSON_PAYLOAD}" \
        "${WORKER_API_URL}/api/r2/upload")

    # Clean up
    rm /tmp/signal-data-backup.tar.gz

    if [ "$HTTP_CODE" = "200" ]; then
        SIZE=$(cat /tmp/upload-response.json | grep -o '"size":[0-9]*' | cut -d':' -f2)
        echo "✅ Signal data backed up to R2 successfully (${SIZE} bytes)"
        rm /tmp/upload-response.json
        return 0
    else
        echo "❌ Failed to backup to R2 (HTTP $HTTP_CODE)"
        cat /tmp/upload-response.json 2>/dev/null || echo "(no response body)"
        rm -f /tmp/upload-response.json
        return 1
    fi
}

# Main logic
case "${1:-download}" in
    download)
        download_from_r2
        ;;
    upload)
        upload_to_r2
        ;;
    *)
        echo "Usage: $0 {download|upload}"
        exit 1
        ;;
esac
