#!/bin/bash

#
# Pre-Deployment Check Script
#
# Validates that everything is ready before deploying to Cloudflare.
# Run this before deploying to catch configuration issues early.
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
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_section() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

checks_passed=0
checks_failed=0
checks_warning=0

check_pass() {
    print_success "$1"
    ((checks_passed++))
}

check_fail() {
    print_error "$1"
    ((checks_failed++))
}

check_warn() {
    print_warning "$1"
    ((checks_warning++))
}

print_section "Pre-Deployment Validation"

# Check 1: Required tools
print_section "1. Required Tools"

if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    check_pass "Node.js installed ($NODE_VERSION)"
else
    check_fail "Node.js not found (install Node.js 20+)"
fi

if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    check_pass "npm installed ($NPM_VERSION)"
else
    check_fail "npm not found"
fi

if command -v wrangler &> /dev/null; then
    WRANGLER_VERSION=$(wrangler --version)
    check_pass "wrangler installed ($WRANGLER_VERSION)"
else
    check_fail "wrangler not found (run: npm install -g wrangler)"
fi

if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version | cut -d' ' -f3 | cut -d',' -f1)
    check_pass "Docker installed ($DOCKER_VERSION)"
else
    check_fail "Docker not found (required for container build)"
fi

if command -v jq &> /dev/null; then
    check_pass "jq installed (for JSON parsing)"
else
    check_warn "jq not found (optional, but helpful for testing)"
fi

# Check 2: Wrangler authentication
print_section "2. Wrangler Authentication"

if wrangler whoami &> /dev/null; then
    ACCOUNT_EMAIL=$(wrangler whoami 2>/dev/null | grep "Email" | cut -d':' -f2 | xargs)
    check_pass "Authenticated with Cloudflare ($ACCOUNT_EMAIL)"
else
    check_fail "Not authenticated (run: wrangler login)"
fi

# Check 3: TypeScript compilation
print_section "3. Code Validation"

cd "$(dirname "$0")/.."

print_info "Checking Worker TypeScript..."
if npm run type-check &> /dev/null; then
    check_pass "Worker TypeScript compiles"
else
    check_fail "Worker TypeScript has errors (run: npm run type-check)"
fi

print_info "Checking Container TypeScript..."
if cd container && npm run build &> /dev/null; then
    check_pass "Container TypeScript compiles"
    cd ..
else
    check_fail "Container TypeScript has errors (run: cd container && npm run build)"
    cd ..
fi

# Check 4: Dependencies
print_section "4. Dependencies"

if [ -d "node_modules" ]; then
    check_pass "Worker dependencies installed"
else
    check_fail "Worker dependencies missing (run: npm install)"
fi

if [ -d "container/node_modules" ]; then
    check_pass "Container dependencies installed"
else
    check_fail "Container dependencies missing (run: cd container && npm install)"
fi

# Check 5: Configuration files
print_section "5. Configuration Files"

if [ -f "wrangler.toml" ]; then
    check_pass "wrangler.toml exists"

    # Check if D1 database ID is set
    if grep -q 'database_id = ""' wrangler.toml; then
        check_warn "D1 database_id not set (run: ./database/setup.sh)"
    else
        check_pass "D1 database configured"
    fi

    # Check if KV namespace ID is set
    if grep -q 'id = ""' wrangler.toml; then
        check_warn "KV namespace id not set (run: wrangler kv:namespace create SIGNAL_CACHE)"
    else
        check_pass "KV namespace configured"
    fi
else
    check_fail "wrangler.toml not found"
fi

if [ -f "database/schema.sql" ]; then
    check_pass "Database schema exists"
else
    check_fail "Database schema missing"
fi

if [ -f "container/Dockerfile" ]; then
    check_pass "Container Dockerfile exists"
else
    check_fail "Dockerfile missing"
fi

# Check 6: Environment secrets
print_section "6. Environment Secrets"

print_info "Checking required secrets..."
print_warning "Note: Cannot validate secrets directly, checking if they're documented"

if grep -q "SIGNAL_PHONE_NUMBER" wrangler.toml; then
    check_pass "SIGNAL_PHONE_NUMBER documented"
else
    check_warn "SIGNAL_PHONE_NUMBER not documented in wrangler.toml"
fi

if grep -q "WORKER_API_TOKEN" wrangler.toml; then
    check_pass "WORKER_API_TOKEN documented"
else
    check_warn "WORKER_API_TOKEN not documented in wrangler.toml"
fi

print_info "Remember to set secrets with: wrangler secret put SECRET_NAME"

# Check 7: Documentation
print_section "7. Documentation"

docs=("README.md" "DEPLOYMENT.md" "WORKER_API.md")
for doc in "${docs[@]}"; do
    if [ -f "$doc" ]; then
        check_pass "$doc exists"
    else
        check_warn "$doc missing"
    fi
done

# Check 8: Database schema
print_section "8. Database Schema"

if [ -f "database/schema.sql" ]; then
    TABLE_COUNT=$(grep -c "CREATE TABLE" database/schema.sql || echo 0)
    if [ "$TABLE_COUNT" -gt 0 ]; then
        check_pass "Database schema has $TABLE_COUNT tables"
    else
        check_fail "Database schema has no tables"
    fi

    INDEX_COUNT=$(grep -c "CREATE INDEX" database/schema.sql || echo 0)
    if [ "$INDEX_COUNT" -gt 0 ]; then
        check_pass "Database schema has $INDEX_COUNT indexes"
    else
        check_warn "Database schema has no indexes (performance may suffer)"
    fi
fi

# Summary
print_section "Validation Summary"

total=$((checks_passed + checks_failed + checks_warning))
echo "Total checks: $total"
echo -e "Passed: ${GREEN}$checks_passed${NC}"
echo -e "Failed: ${RED}$checks_failed${NC}"
echo -e "Warnings: ${YELLOW}$checks_warning${NC}"
echo ""

if [ $checks_failed -eq 0 ]; then
    print_success "All critical checks passed!"
    echo ""

    if [ $checks_warning -gt 0 ]; then
        print_warning "There are $checks_warning warnings. Review them before deploying."
        echo ""
    fi

    print_info "You're ready to deploy! Next steps:"
    echo ""
    echo "1. Set up infrastructure:"
    echo "   ./database/setup.sh"
    echo "   wrangler r2 bucket create signal-cli-data"
    echo "   wrangler kv:namespace create SIGNAL_CACHE"
    echo ""
    echo "2. Configure secrets:"
    echo "   wrangler secret put SIGNAL_PHONE_NUMBER"
    echo "   wrangler secret put WORKER_API_TOKEN"
    echo ""
    echo "3. Deploy:"
    echo "   npm run deploy"
    echo ""
    echo "4. Build container:"
    echo "   cd container && docker build -t signal-cli-bot:latest ."
    echo ""
    echo "See DEPLOYMENT.md for detailed instructions."

    exit 0
else
    print_error "Some critical checks failed!"
    echo ""
    print_warning "Fix the errors above before deploying."
    echo ""
    echo "Common fixes:"
    echo "  - Install missing tools (Node.js, wrangler, Docker)"
    echo "  - Run: wrangler login"
    echo "  - Run: npm install (in both root and container/)"
    echo "  - Fix TypeScript errors"
    echo ""

    exit 1
fi
