#!/bin/bash

###############################################################################
# Cloudflare D1 Database Setup Script
# Creates and initializes D1 database for Signal Bot
###############################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Cloudflare D1 Database Setup for Signal Bot       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ Error: wrangler CLI not found${NC}"
    echo "Install with: npm install -g wrangler"
    exit 1
fi

echo -e "${BLUE}📊 Step 1: Creating D1 database...${NC}"
echo ""

# Create D1 database
DB_OUTPUT=$(wrangler d1 create signal-bot-db 2>&1) || {
    echo -e "${RED}❌ Failed to create database${NC}"
    echo "$DB_OUTPUT"
    exit 1
}

echo "$DB_OUTPUT"
echo ""

# Extract database ID from output
DB_ID=$(echo "$DB_OUTPUT" | grep -o 'database_id = "[^"]*"' | cut -d'"' -f2)

if [ -z "$DB_ID" ]; then
    echo -e "${YELLOW}⚠️  Could not auto-detect database ID${NC}"
    echo "Please manually add to wrangler.toml:"
    echo ""
    echo "[[d1_databases]]"
    echo "binding = \"DB\""
    echo "database_name = \"signal-bot-db\""
    echo "database_id = \"YOUR_DATABASE_ID\""
    echo ""
else
    echo -e "${GREEN}✅ Database created with ID: $DB_ID${NC}"
    echo ""

    # Check if wrangler.toml exists and update it
    if [ -f "wrangler.toml" ]; then
        echo -e "${BLUE}📝 Step 2: Updating wrangler.toml...${NC}"

        # Check if D1 binding already exists
        if grep -q "d1_databases" wrangler.toml; then
            echo -e "${YELLOW}⚠️  D1 binding already exists in wrangler.toml${NC}"
            echo "Please manually update database_id to: $DB_ID"
        else
            # Append D1 binding to wrangler.toml
            cat >> wrangler.toml << EOF

# D1 Database binding
[[d1_databases]]
binding = "DB"
database_name = "signal-bot-db"
database_id = "$DB_ID"
EOF
            echo -e "${GREEN}✅ wrangler.toml updated${NC}"
        fi
        echo ""
    fi
fi

echo -e "${BLUE}📋 Step 3: Applying database schema...${NC}"
echo ""

# Apply schema to local D1 (for development)
echo -e "${YELLOW}Applying schema to local database (dev)...${NC}"
wrangler d1 execute signal-bot-db --file=database/schema.sql --local

echo -e "${GREEN}✅ Local database schema applied${NC}"
echo ""

# Apply schema to remote D1 (production)
read -p "Apply schema to remote database (production)? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Applying schema to remote database...${NC}"
    wrangler d1 execute signal-bot-db --file=database/schema.sql --remote
    echo -e "${GREEN}✅ Remote database schema applied${NC}"
else
    echo -e "${YELLOW}⏩ Skipped remote database setup${NC}"
    echo "Run later with: wrangler d1 execute signal-bot-db --file=database/schema.sql --remote"
fi
echo ""

echo -e "${BLUE}📊 Step 4: Verifying database setup...${NC}"
echo ""

# List tables in local database
echo -e "${YELLOW}Tables in local database:${NC}"
wrangler d1 execute signal-bot-db --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" --local

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║             ✅ Database Setup Complete! ✅              ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}📝 Next Steps:${NC}"
echo ""
echo "1. Verify wrangler.toml has D1 binding:"
echo "   ${YELLOW}cat wrangler.toml | grep -A3 'd1_databases'${NC}"
echo ""
echo "2. Test database connection:"
echo "   ${YELLOW}wrangler d1 execute signal-bot-db --command=\"SELECT 1\" --local${NC}"
echo ""
echo "3. Query tables:"
echo "   ${YELLOW}wrangler d1 execute signal-bot-db --command=\"SELECT * FROM users LIMIT 5\" --local${NC}"
echo ""
echo "4. Continue with bot deployment:"
echo "   ${YELLOW}./deploy.sh${NC}"
echo ""

