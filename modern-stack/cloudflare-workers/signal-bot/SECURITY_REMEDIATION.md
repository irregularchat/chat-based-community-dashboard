# Security Remediation and Key Rotation Guide

**Date**: 2025-11-23  
**Severity**: CRITICAL  
**Status**: Immediate Action Required

## Executive Summary

This document details critical security vulnerabilities that were identified and remediated in the Signal bot codebase, along with required follow-up actions for exposed credentials.

## Critical Vulnerabilities Fixed

### 1. SQL Injection (CRITICAL) - ✅ FIXED

**Location**: `container/src/db/postgres-client.ts`

**Vulnerability**: Table names were concatenated directly into SQL queries without validation, allowing SQL injection attacks.

**Attack Vector**:
```typescript
// BEFORE (vulnerable):
async insert(table: string, data: Record<string, any>) {
  const query = `INSERT INTO ${table} ...`; // Direct concatenation
}
```

**Remediation**:
- Added whitelist-based table name validation
- Implemented input length limits (50KB per field)
- All database methods now validate inputs before query execution

**Files Modified**:
- `container/src/db/postgres-client.ts:14-28` - Added ALLOWED_TABLES whitelist
- `container/src/db/postgres-client.ts:30-54` - Added validation methods
- All CRUD methods updated to use validation

### 2. Code Execution via Function() (CRITICAL) - ✅ FIXED

**Location**: `container/src/bot/command-handler.ts`

**Vulnerability**: Calculator command used `new Function()` constructor which allows arbitrary JavaScript code execution.

**Attack Vector**:
```javascript
!calc process.exit() // Would terminate the bot
!calc require('fs').readFileSync('/etc/passwd') // Would read sensitive files
```

**Remediation**:
- Replaced `Function()` constructor with safe recursive descent parser
- Implemented whitelist-based expression validation
- Added DoS protection (200 character limit)
- Validates only mathematical operators: `+ - * / ( ) .` and digits

**Files Modified**:
- `container/src/bot/command-handler.ts:1347-1405` - Completely rewrote calculator implementation

### 3. Exposed API Keys in Deployment Script (CRITICAL) - ✅ FIXED

**Location**: `deploy-selfhosted.sh`

**Vulnerability**: Hardcoded API keys and database passwords in deployment script committed to version control.

**Exposed Credentials** (REQUIRES IMMEDIATE ROTATION):
```bash
# ⚠️ THESE KEYS WERE EXPOSED AND MUST BE ROTATED:
OPENAI_API_KEY=sk-proj-fg1e1xPRqt9dS6R9ISzaDjTB1cn52Jf5...
DISCOURSE_API_KEY=ac01ad65b919e8a3e0a2f2564febf1ed43a649e9...
DB_PASSWORD=signal_secure_pass_2024
```

**Remediation**:
- Refactored script to use environment variables
- Added validation to ensure required vars are set before deployment
- Created `.env.example` template for safe credential management
- Updated `.gitignore` to prevent accidental commits

**Files Modified**:
- `deploy-selfhosted.sh:12-34` - Added environment variable validation
- `deploy-selfhosted.sh:49-59` - Changed to use variables instead of hardcoded values
- `.env.example` - Created comprehensive template
- `.gitignore:15-18` - Enhanced to block all `.env` variants

---

## IMMEDIATE ACTIONS REQUIRED

### Step 1: Rotate OpenAI API Key (CRITICAL - Do Immediately)

The exposed key starts with: `sk-proj-fg1e1xPRqt...`

**Actions**:
1. Go to https://platform.openai.com/api-keys
2. **Revoke** the exposed key immediately
3. Create a new API key
4. Update the key in your environment:
   ```bash
   export OPENAI_API_KEY="sk-proj-NEW_KEY_HERE"
   ```
5. Deploy with the new key using the updated deployment script

### Step 2: Rotate Discourse API Key (CRITICAL - Do Immediately)

The exposed key is: `ac01ad65b919e8a3e0a2f2564febf1ed43a649e9...`

**Actions**:
1. Go to https://forum.irregularchat.com/admin/api/keys
2. **Revoke** the exposed key
3. Create a new API key for user `bot.irregularchat`
4. Update the key in your environment:
   ```bash
   export DISCOURSE_API_KEY="NEW_KEY_HERE"
   ```

### Step 3: Change Database Password (HIGH PRIORITY)

Current password: `signal_secure_pass_2024` (weak and exposed)

**Actions**:
1. Generate a strong password:
   ```bash
   openssl rand -base64 32
   ```
2. Update PostgreSQL password:
   ```bash
   ssh root@proxmox-main
   docker exec -it postgres psql -U signal_bot_user
   ALTER USER signal_bot_user PASSWORD 'NEW_STRONG_PASSWORD_HERE';
   ```
3. Update environment variable:
   ```bash
   export DB_PASSWORD="NEW_STRONG_PASSWORD_HERE"
   ```

### Step 4: Remove Secrets from Git History (REQUIRED)

**WARNING**: The exposed secrets are still in git history and can be retrieved by anyone with repository access.

**Option A: Using BFG Repo-Cleaner (Recommended)**:
```bash
# Install BFG
brew install bfg  # macOS
# or download from: https://rtyley.github.io/bfg-repo-cleaner/

# Backup your repository first!
cp -r signal-bot signal-bot-backup

# Remove secrets from history
cd signal-bot
bfg --replace-text passwords.txt  # Create file with: deploy-selfhosted.sh
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Force push (CAUTION: Coordinate with team)
git push --force
```

**Option B: Using git-filter-repo**:
```bash
pip install git-filter-repo

# Backup first!
cp -r signal-bot signal-bot-backup

cd signal-bot
git filter-repo --invert-paths --path deploy-selfhosted.sh --force
```

**Option C: If repository is private and you have few collaborators**:
1. Create a fresh repository
2. Copy only the current code (not history)
3. Commit and push to new repo
4. Update team with new repository URL

### Step 5: Deploy Securely Going Forward

**Using the Updated Deployment Script**:
```bash
# 1. Set environment variables (one time setup)
export DB_PASSWORD="$(openssl rand -base64 32)"
export SIGNAL_PHONE="+19108471202"
export OPENAI_API_KEY="sk-proj-NEW_KEY"
export DISCOURSE_API_KEY="NEW_KEY"
export DISCOURSE_URL="https://forum.irregularchat.com"
export DISCOURSE_USERNAME="bot.irregularchat"

# 2. Optionally save to local .env file (NEVER commit!)
cat > .env << EOF
DB_PASSWORD=${DB_PASSWORD}
SIGNAL_PHONE=${SIGNAL_PHONE}
OPENAI_API_KEY=${OPENAI_API_KEY}
DISCOURSE_API_KEY=${DISCOURSE_API_KEY}
DISCOURSE_URL=${DISCOURSE_URL}
DISCOURSE_USERNAME=${DISCOURSE_USERNAME}
EOF

# 3. Source the file and deploy
source .env
./deploy-selfhosted.sh
```

---

## Security Posture Improvements

### Completed ✅

1. **SQL Injection Protection**: Whitelist validation + parameterized queries
2. **Code Execution Prevention**: Replaced `Function()` with safe parser
3. **Secrets Management**: Environment-based configuration
4. **Input Validation**: Length limits and sanitization
5. **SSRF Protection**: Already in place (verified secure)

### Still Recommended (Non-Critical)

1. **Rate Limiting**: Implement per-user and global rate limits
2. **Admin Authorization**: Move admin phone numbers to environment variables
3. **Audit Logging**: Add logging for all admin actions
4. **DoS Protection**: Add concurrent operation limits for resource-intensive operations
5. **Response Size Limits**: Cap web scraping response sizes

---

## Verification Checklist

Use this checklist to verify the security fixes are properly deployed:

- [ ] OpenAI API key has been rotated
- [ ] Discourse API key has been rotated
- [ ] Database password has been changed
- [ ] Secrets removed from git history
- [ ] New deployment uses environment variables
- [ ] `.env` file is in `.gitignore`
- [ ] Tested SQL injection protection (attempt to inject malicious table names)
- [ ] Tested calculator with malicious inputs (verify they're rejected)
- [ ] Verified no secrets in latest git commit
- [ ] Team members have been notified of changes
- [ ] Documentation updated with new deployment process

---

## Security Contacts

**For Security Issues**:
- Create a private issue in the repository
- Email: security@irregularchat.com (if applicable)
- Never publicly disclose vulnerabilities before they're fixed

**For Questions About This Document**:
- Contact the development team lead
- Reference this document: `SECURITY_REMEDIATION.md`

---

## Appendix: Technical Details

### A. SQL Injection Test Cases

The following inputs are now safely rejected:

```sql
users; DROP TABLE users--
' OR '1'='1
users' UNION SELECT * FROM passwords--
```

### B. Code Execution Test Cases

The following inputs are now safely rejected by the calculator:

```javascript
!calc process.exit()
!calc require('fs')
!calc eval('malicious code')
!calc Function('return process')()
```

Only valid mathematical expressions are accepted:
```javascript
!calc 2 + 2          // ✅ Allowed
!calc (10 * 5) / 2   // ✅ Allowed
!calc 2.5 + 3.14     // ✅ Allowed
```

### C. SSRF Protection Layers

The URL scraper has three layers of defense:

1. **Regex filtering**: Only HTTP/HTTPS URLs with valid TLDs
2. **Protocol validation**: Blocks all protocols except HTTP/HTTPS
3. **Internal host blocking**: Blocks RFC 1918 private IPs, localhost, link-local addresses

### D. References

- OWASP Top 10: https://owasp.org/www-project-top-ten/
- CWE-89 (SQL Injection): https://cwe.mitre.org/data/definitions/89.html
- CWE-94 (Code Injection): https://cwe.mitre.org/data/definitions/94.html
- CWE-918 (SSRF): https://cwe.mitre.org/data/definitions/918.html

---

**Last Updated**: 2025-11-23  
**Next Review**: 2025-12-23 (Monthly security review recommended)
