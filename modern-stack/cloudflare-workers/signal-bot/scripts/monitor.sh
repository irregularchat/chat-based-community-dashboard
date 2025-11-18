#!/bin/bash

#
# Signal Bot Monitoring Script
#
# Continuously monitors the deployed Signal bot and reports status.
# Useful for keeping an eye on production deployment.
#

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_info() { echo -e "${BLUE}ℹ${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }

# Configuration
WORKER_URL="${WORKER_URL:-}"
API_TOKEN="${API_TOKEN:-}"
INTERVAL="${INTERVAL:-30}"

# Get configuration
if [ -z "$WORKER_URL" ]; then
    read -p "Enter your Worker URL: " WORKER_URL
fi

if [ -z "$API_TOKEN" ]; then
    read -sp "Enter your WORKER_API_TOKEN: " API_TOKEN
    echo ""
fi

WORKER_URL="${WORKER_URL%/}"

echo ""
print_info "Monitoring Signal Bot at: $WORKER_URL"
print_info "Update interval: ${INTERVAL} seconds"
print_info "Press Ctrl+C to stop"
echo ""

# Function to get status
get_status() {
    local response=$(curl -s "${WORKER_URL}/status")
    echo "$response"
}

# Function to get bot status
get_bot_status() {
    local response=$(curl -s -H "Authorization: Bearer $API_TOKEN" "${WORKER_URL}/bot/status")
    echo "$response"
}

# Function to get database stats
get_db_stats() {
    local response=$(curl -s -H "Authorization: Bearer $API_TOKEN" "${WORKER_URL}/api/db/stats")
    echo "$response"
}

# Monitor loop
iteration=0
while true; do
    clear
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Signal Bot Monitor - $(date '+%Y-%m-%d %H:%M:%S')"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # Get overall status
    status_response=$(get_status)

    # Parse status
    overall_status=$(echo "$status_response" | jq -r '.overall // "unknown"' 2>/dev/null)
    worker_status=$(echo "$status_response" | jq -r '.worker.status // "unknown"' 2>/dev/null)
    container_status=$(echo "$status_response" | jq -r '.container.status // "unknown"' 2>/dev/null)

    # Display status
    echo "📊 SYSTEM STATUS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    case "$overall_status" in
        "healthy")
            print_success "Overall Status: HEALTHY"
            ;;
        "degraded")
            print_warning "Overall Status: DEGRADED"
            ;;
        "unhealthy")
            print_error "Overall Status: UNHEALTHY"
            ;;
        *)
            print_info "Overall Status: $overall_status"
            ;;
    esac

    case "$worker_status" in
        "healthy")
            print_success "Worker: HEALTHY"
            ;;
        *)
            print_error "Worker: $worker_status"
            ;;
    esac

    case "$container_status" in
        "healthy")
            print_success "Container: HEALTHY"
            ;;
        *)
            print_error "Container: $container_status"
            ;;
    esac

    # Get bot status
    echo ""
    echo "🤖 BOT STATUS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    bot_response=$(get_bot_status)
    bot_running=$(echo "$bot_response" | jq -r '.running // false' 2>/dev/null)
    bot_uptime=$(echo "$bot_response" | jq -r '.uptime // 0' 2>/dev/null)

    if [ "$bot_running" = "true" ]; then
        print_success "Bot Running: YES"
        echo "   Uptime: ${bot_uptime}s"

        # Get stats if available
        messages_received=$(echo "$bot_response" | jq -r '.stats.messagesReceived // 0' 2>/dev/null)
        messages_sent=$(echo "$bot_response" | jq -r '.stats.messagesSent // 0' 2>/dev/null)
        commands_processed=$(echo "$bot_response" | jq -r '.stats.commandsProcessed // 0' 2>/dev/null)
        errors=$(echo "$bot_response" | jq -r '.stats.errors // 0' 2>/dev/null)

        echo "   Messages Received: $messages_received"
        echo "   Messages Sent: $messages_sent"
        echo "   Commands Processed: $commands_processed"
        echo "   Errors: $errors"
    else
        print_error "Bot Running: NO"
    fi

    # Get database stats
    echo ""
    echo "🗄️  DATABASE STATS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    db_response=$(get_db_stats)

    if echo "$db_response" | jq -e '.success' >/dev/null 2>&1; then
        # Show key table counts
        messages=$(echo "$db_response" | jq -r '.tables.signal_messages // 0' 2>/dev/null)
        groups=$(echo "$db_response" | jq -r '.tables.signal_groups // 0' 2>/dev/null)
        commands=$(echo "$db_response" | jq -r '.tables.bot_command_usage // 0' 2>/dev/null)
        questions=$(echo "$db_response" | jq -r '.tables.q_and_a_questions // 0' 2>/dev/null)

        echo "   Messages: $messages"
        echo "   Groups: $groups"
        echo "   Commands: $commands"
        echo "   Questions: $questions"
    else
        print_warning "Database stats unavailable"
    fi

    # Footer
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Refresh #$((++iteration)) - Next update in ${INTERVAL}s"
    echo "  Press Ctrl+C to exit"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    sleep $INTERVAL
done
