#!/bin/bash

#
# Signal Bot Deployment Test Script
#
# This script tests the deployed Signal bot to ensure all components are working.
# Run this after deploying to Cloudflare to validate the deployment.
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
WORKER_URL="${WORKER_URL:-}"
API_TOKEN="${API_TOKEN:-}"

# Print colored output
print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_section() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# Get configuration
get_config() {
    if [ -z "$WORKER_URL" ]; then
        read -p "Enter your Worker URL (e.g., https://signal-cli-bot.YOUR-SUBDOMAIN.workers.dev): " WORKER_URL
    fi

    if [ -z "$API_TOKEN" ]; then
        read -sp "Enter your WORKER_API_TOKEN: " API_TOKEN
        echo ""
    fi

    # Remove trailing slash from URL
    WORKER_URL="${WORKER_URL%/}"
}

# Test function
test_endpoint() {
    local name="$1"
    local method="$2"
    local endpoint="$3"
    local expect_status="${4:-200}"
    local auth="${5:-false}"

    local url="${WORKER_URL}${endpoint}"

    if [ "$auth" = "true" ]; then
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$url" \
            -H "Authorization: Bearer $API_TOKEN" \
            -H "Content-Type: application/json")
    else
        response=$(curl -s -w "\n%{http_code}" -X "$method" "$url")
    fi

    body=$(echo "$response" | head -n -1)
    status=$(echo "$response" | tail -n 1)

    if [ "$status" = "$expect_status" ]; then
        print_success "$name (HTTP $status)"
        echo "    Response: $(echo "$body" | jq -r '.status // .success // "OK"' 2>/dev/null || echo "OK")"
        return 0
    else
        print_error "$name (Expected $expect_status, got $status)"
        echo "    Response: $body" | head -c 200
        return 1
    fi
}

# Main test sequence
main() {
    print_section "Signal Bot Deployment Test"

    get_config

    print_info "Testing Worker: $WORKER_URL"
    echo ""

    local tests_passed=0
    local tests_failed=0

    # Test 1: Worker Health
    print_section "1. Public Endpoints (No Auth)"

    if test_endpoint "Worker Health Check" "GET" "/health" "200" "false"; then
        ((tests_passed++))
    else
        ((tests_failed++))
    fi

    sleep 1

    if test_endpoint "Combined Status" "GET" "/status" "200" "false"; then
        ((tests_passed++))
    else
        ((tests_failed++))
    fi

    # Test 2: API Endpoints (With Auth)
    print_section "2. API Endpoints (With Auth)"

    # Test database stats
    if test_endpoint "Database Stats" "GET" "/api/db/stats" "200" "true"; then
        ((tests_passed++))
    else
        ((tests_failed++))
    fi

    sleep 1

    # Test R2 stats
    if test_endpoint "R2 Storage Stats" "GET" "/api/r2/stats" "200" "true"; then
        ((tests_passed++))
    else
        ((tests_failed++))
    fi

    sleep 1

    # Test R2 list
    if test_endpoint "R2 List Files" "GET" "/api/r2/list" "200" "true"; then
        ((tests_passed++))
    else
        ((tests_failed++))
    fi

    # Test 3: Container Proxy
    print_section "3. Container Endpoints (With Auth)"

    if test_endpoint "Bot Status" "GET" "/bot/status" "200" "true"; then
        ((tests_passed++))
    else
        ((tests_failed++))
    fi

    sleep 1

    if test_endpoint "Bot Groups" "GET" "/bot/groups" "200" "true"; then
        ((tests_passed++))
    else
        ((tests_failed++))
    fi

    # Test 4: Authentication
    print_section "4. Authentication Tests"

    print_info "Testing endpoint without auth (should fail)..."
    response=$(curl -s -w "\n%{http_code}" -X GET "${WORKER_URL}/api/db/stats")
    status=$(echo "$response" | tail -n 1)

    if [ "$status" = "401" ]; then
        print_success "Auth required (correctly rejected)"
        ((tests_passed++))
    else
        print_error "Auth not enforced (got $status instead of 401)"
        ((tests_failed++))
    fi

    # Summary
    print_section "Test Summary"

    local total=$((tests_passed + tests_failed))
    echo "Total tests: $total"
    echo -e "Passed: ${GREEN}$tests_passed${NC}"
    echo -e "Failed: ${RED}$tests_failed${NC}"
    echo ""

    if [ $tests_failed -eq 0 ]; then
        print_success "All tests passed! 🎉"
        echo ""
        print_info "Your Signal bot is deployed and working correctly."
        echo ""
        echo "Next steps:"
        echo "  1. Send a test message to your bot: !help"
        echo "  2. Check the logs: wrangler tail"
        echo "  3. Monitor status: curl $WORKER_URL/status"
        exit 0
    else
        print_error "Some tests failed!"
        echo ""
        print_warning "Troubleshooting:"
        echo "  1. Check Worker logs: wrangler tail"
        echo "  2. Verify D1 database: wrangler d1 list"
        echo "  3. Verify R2 bucket: wrangler r2 bucket list"
        echo "  4. Check container status: curl $WORKER_URL/status"
        exit 1
    fi
}

# Run tests
main
