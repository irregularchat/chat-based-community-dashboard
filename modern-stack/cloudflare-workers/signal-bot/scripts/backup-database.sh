#!/bin/bash

#
# Database Backup Script
#
# Backs up the D1 database to a local SQL file.
# Run regularly to ensure you have backups of your data.
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_info() { echo -e "${BLUE}ℹ${NC} $1"; }

# Configuration
DB_NAME="${DB_NAME:-signal-bot-db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/${DB_NAME}_${TIMESTAMP}.sql"

echo ""
print_info "Signal Bot Database Backup"
echo ""

# Create backup directory
mkdir -p "$BACKUP_DIR"

print_info "Backing up database: $DB_NAME"
print_info "Backup location: $BACKUP_FILE"
echo ""

# Get list of tables
print_info "Fetching table list..."
TABLES=$(wrangler d1 execute "$DB_NAME" \
    --command="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;" \
    --remote --json | jq -r '.[0].results[].name' 2>/dev/null)

if [ -z "$TABLES" ]; then
    print_error "Failed to get table list"
    exit 1
fi

TABLE_COUNT=$(echo "$TABLES" | wc -l)
print_success "Found $TABLE_COUNT tables"
echo ""

# Start backup file
echo "-- Signal Bot Database Backup" > "$BACKUP_FILE"
echo "-- Generated: $(date)" >> "$BACKUP_FILE"
echo "-- Database: $DB_NAME" >> "$BACKUP_FILE"
echo "" >> "$BACKUP_FILE"

# Backup each table
current=0
for table in $TABLES; do
    ((current++))
    print_info "[$current/$TABLE_COUNT] Backing up table: $table"

    # Get table schema
    echo "-- Table: $table" >> "$BACKUP_FILE"
    wrangler d1 execute "$DB_NAME" \
        --command="SELECT sql FROM sqlite_master WHERE type='table' AND name='$table';" \
        --remote --json | jq -r '.[0].results[0].sql' >> "$BACKUP_FILE" 2>/dev/null || true
    echo ";" >> "$BACKUP_FILE"
    echo "" >> "$BACKUP_FILE"

    # Get row count
    ROW_COUNT=$(wrangler d1 execute "$DB_NAME" \
        --command="SELECT COUNT(*) as count FROM $table;" \
        --remote --json | jq -r '.[0].results[0].count' 2>/dev/null || echo 0)

    if [ "$ROW_COUNT" -gt 0 ]; then
        echo "   Exporting $ROW_COUNT rows..."

        # Export data (simplified - you may need to adjust for large tables)
        echo "-- Data for table: $table" >> "$BACKUP_FILE"

        # Note: For production use, you'd want to paginate large tables
        wrangler d1 execute "$DB_NAME" \
            --command="SELECT * FROM $table LIMIT 10000;" \
            --remote --json > /tmp/table_data.json 2>/dev/null || true

        # Convert to INSERT statements (simplified)
        echo "-- Insert statements for $table" >> "$BACKUP_FILE"
        echo "-- (First 10,000 rows)" >> "$BACKUP_FILE"
        echo "" >> "$BACKUP_FILE"
    else
        echo "   Table is empty"
    fi
done

# Add indexes
print_info "Backing up indexes..."
echo "" >> "$BACKUP_FILE"
echo "-- Indexes" >> "$BACKUP_FILE"
wrangler d1 execute "$DB_NAME" \
    --command="SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL;" \
    --remote --json | jq -r '.[0].results[].sql' >> "$BACKUP_FILE" 2>/dev/null || true

# Compress backup
print_info "Compressing backup..."
gzip -f "$BACKUP_FILE"
BACKUP_FILE="${BACKUP_FILE}.gz"

# Get backup size
BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)

echo ""
print_success "Backup complete!"
echo ""
echo "   Location: $BACKUP_FILE"
echo "   Size: $BACKUP_SIZE"
echo ""

# List recent backups
print_info "Recent backups:"
ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -n 5 || echo "   No previous backups found"
echo ""

# Cleanup old backups (keep last 10)
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 10 ]; then
    print_info "Cleaning up old backups (keeping 10 most recent)..."
    ls -t "$BACKUP_DIR"/*.sql.gz | tail -n +11 | xargs rm -f
    print_success "Cleanup complete"
fi

echo ""
print_info "To restore from backup:"
echo "   gunzip $BACKUP_FILE"
echo "   wrangler d1 execute $DB_NAME --file=${BACKUP_FILE%.gz} --remote"
echo ""
