#!/bin/bash
#
# Signal Bot Data Backup Script
#
# Syncs signal-data from server to local machine
# Run regularly to maintain local backup of Signal account
#
# Usage:
#   ./backup-signal-data.sh           # Normal backup
#   ./backup-signal-data.sh --restore # Restore from local to server
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROXMOX_HOST="${PROXMOX_HOST:-root@proxmox-main}"
LOCAL_BACKUP="/Users/sac/Git/chat-based-community-dashboard/modern-stack/signal-data"
REMOTE_DATA="/home/signal-bot-selfhosted/data/signal-data"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Signal Bot Data Backup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ "$1" = "--restore" ]; then
    echo "⚠️  RESTORE MODE - This will overwrite server data!"
    echo "    Source: $LOCAL_BACKUP"
    echo "    Destination: $PROXMOX_HOST:$REMOTE_DATA"
    echo ""
    read -p "Are you sure? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        echo "Aborted."
        exit 1
    fi

    echo "📤 Restoring from local to server..."
    rsync -avz --progress "$LOCAL_BACKUP/" "$PROXMOX_HOST:$REMOTE_DATA/"

    echo ""
    echo "✅ Restore complete!"
    echo "   You may need to restart the container:"
    echo "   ssh $PROXMOX_HOST 'cd /home/signal-bot-selfhosted && docker compose restart signal-bot'"
else
    echo "📥 Backing up from server to local..."
    echo "    Source: $PROXMOX_HOST:$REMOTE_DATA"
    echo "    Destination: $LOCAL_BACKUP"
    echo ""

    # Create local backup dir if needed
    mkdir -p "$LOCAL_BACKUP"

    # Sync from server to local (NO --delete to prevent accidents)
    rsync -avz --progress "$PROXMOX_HOST:$REMOTE_DATA/" "$LOCAL_BACKUP/"

    echo ""
    echo "✅ Backup complete!"
    echo ""
    echo "📊 Backup summary:"
    echo "   Account DB: $(ls -lh "$LOCAL_BACKUP/data/"*"/account.db" 2>/dev/null | awk '{print $5}' || echo 'Not found')"
    echo "   Groups: $(cat "$LOCAL_BACKUP/groups-cache.json" 2>/dev/null | grep -c '"id"' || echo '0')"

    # Show last modified time
    if [ -f "$LOCAL_BACKUP/data/"*"/account.db" ]; then
        echo "   Last modified: $(stat -f '%Sm' "$LOCAL_BACKUP/data/"*"/account.db" 2>/dev/null || stat -c '%y' "$LOCAL_BACKUP/data/"*"/account.db" 2>/dev/null)"
    fi
fi
