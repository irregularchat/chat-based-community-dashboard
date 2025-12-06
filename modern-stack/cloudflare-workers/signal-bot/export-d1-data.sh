#!/bin/bash
# ============================================================================
# Export Data from Cloudflare D1 Database
# ============================================================================

set -e

echo "📥 Exporting data from Cloudflare D1..."
echo ""

DB_NAME="signal-bot-db"
EXPORT_DIR="./d1-exports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create export directory
mkdir -p "$EXPORT_DIR"

# ============================================================================
# Export Tables
# ============================================================================

TABLES=(
  "signal_messages"
  "signal_groups"
  "signal_accounts"
  "command_history"
  "bot_usage_stats"
  "rate_limits"
  "conversation_contexts"
  "scheduled_tasks"
  "message_reactions"
  "message_edits"
  "media_attachments"
  "group_members"
  "group_invites"
  "blocked_users"
  "blocked_groups"
  "user_preferences"
  "conversation_memory"
  "news_articles"
  "q_and_a_questions"
  "q_and_a_answers"
  "social_media_downloads"
  "url_security_cache"
)

echo "📊 Exporting ${#TABLES[@]} tables..."
echo ""

for TABLE in "${TABLES[@]}"; do
  echo "  Exporting $TABLE..."

  # Export as JSON
  npx wrangler d1 execute "$DB_NAME" \
    --remote \
    --command="SELECT * FROM $TABLE" \
    --json > "$EXPORT_DIR/${TABLE}_${TIMESTAMP}.json" 2>&1 || {
      echo "    ⚠️  Warning: Failed to export $TABLE (table may not exist)"
      rm -f "$EXPORT_DIR/${TABLE}_${TIMESTAMP}.json"
    }
done

echo ""
echo "✅ Export complete!"
echo ""
echo "📁 Exported files are in: $EXPORT_DIR"
echo ""
echo "📋 Next steps:"
echo ""
echo "1. Review exported data:"
echo "   ls -lh $EXPORT_DIR/*_${TIMESTAMP}.json"
echo ""
echo "2. Create import script for PostgreSQL:"
echo "   ./create-import-script.sh"
echo ""
echo "3. Copy export files to Proxmox:"
echo "   rsync -avz $EXPORT_DIR/ root@proxmox-main:/home/signal-bot-selfhosted/imports/"
echo ""
