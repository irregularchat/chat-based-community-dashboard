# Scripts Directory

This directory contains utility scripts for managing and testing the Chat-Based Community Dashboard.

## Directory Structure

```
scripts/
├── admin/           # Administrative and user management scripts
├── tools/           # Development and testing tools
├── utils/           # Database and system utilities
└── run_*.sh         # Application runner scripts
```

## Administrative Scripts (`admin/`)

### admin_manager.py
Comprehensive admin user management tool that combines functionality for checking, creating, updating, and testing admin users.

**Usage:**
```bash
# Check admin user details
python3 scripts/admin/admin_manager.py check

# Create or update local admin user
python3 scripts/admin/admin_manager.py create

# Test admin login functionality
python3 scripts/admin/admin_manager.py test

# Validate environment configuration
python3 scripts/admin/admin_manager.py validate

# Run all operations
python3 scripts/admin/admin_manager.py all
```

**Features:**
- ✅ Check admin user details and configuration
- ✅ Create/update local admin users with proper attributes
- ✅ Test authentication with environment credentials
- ✅ Validate environment configuration
- ✅ Comprehensive error handling and logging
- ✅ Database verification and consistency checks

## Development Tools (`tools/`)

### auth_tester.py
Authentication testing tool for validating auth configurations and security.

**Usage:**
```bash
# Test local admin authentication
python3 scripts/tools/auth_tester.py local

# Test authentication configuration
python3 scripts/tools/auth_tester.py config

# Test password hashing functionality
python3 scripts/tools/auth_tester.py hash

# Run security tests
python3 scripts/tools/auth_tester.py security

# Run all authentication tests
python3 scripts/tools/auth_tester.py all
```

**Features:**
- ✅ Local admin authentication testing
- ✅ Environment configuration validation
- ✅ Password hashing verification
- ✅ Security testing (SQL injection, timing attacks)
- ✅ Comprehensive test reporting

## Database Utilities (`utils/`)

### db_utilities.py
Database maintenance and diagnostic tools.

**Usage:**
```bash
# Test database connection
python3 scripts/utils/db_utilities.py connection

# List all users
python3 scripts/utils/db_utilities.py users

# Show user statistics
python3 scripts/utils/db_utilities.py stats

# Database health check
python3 scripts/utils/db_utilities.py health
```

**Features:**
- ✅ Database connection testing
- ✅ User listing with detailed information
- ✅ User statistics and analytics
- ✅ Database health monitoring
- ✅ Formatted output with tables and percentages

## Application Runners

### run.sh
Main application runner with various modes and configurations.

### run_local.sh
Local development server runner.

### run_direct_auth.sh
Direct authentication mode runner.

### run_sqlite.sh
SQLite database mode runner.

## Migration from Old Scripts

The following standalone scripts have been **moved and consolidated**:

| Old Script | New Location | Notes |
|------------|--------------|-------|
| `check_admin_user.py` | `scripts/admin/admin_manager.py check` | Combined into admin manager |
| `create_local_admin.py` | `scripts/admin/admin_manager.py create` | Combined into admin manager |
| `test_admin_login.py` | `scripts/admin/admin_manager.py test` | Combined into admin manager |

**Benefits of consolidation:**
- 🎯 **Single source of truth** for admin management
- 🔧 **Consistent interface** across all admin operations
- 📊 **Comprehensive reporting** with unified output
- 🛠️ **Better error handling** and logging
- 📦 **Easier maintenance** with centralized code

## Usage Examples

### Quick Admin Setup
```bash
# Complete admin setup and verification
python3 scripts/admin/admin_manager.py all
```

### Database Health Check
```bash
# Check database health and get user statistics
python3 scripts/utils/db_utilities.py health
python3 scripts/utils/db_utilities.py stats
```

### Authentication Testing
```bash
# Comprehensive authentication testing
python3 scripts/tools/auth_tester.py all
```

### Daily Maintenance
```bash
# Daily health check routine
python3 scripts/utils/db_utilities.py health
python3 scripts/admin/admin_manager.py check
```

## Environment Requirements

All scripts require:
- Python 3.11+
- Project dependencies installed
- Database connection available
- Environment variables configured (`.env` file)

## Error Handling

All scripts include:
- ✅ Comprehensive error handling
- ✅ Detailed logging with timestamps
- ✅ Clear success/failure indicators
- ✅ Proper exit codes for automation
- ✅ Graceful handling of interruptions

## Script Development Guidelines

When creating new scripts:

1. **Location**: Choose appropriate subdirectory (`admin/`, `tools/`, `utils/`)
2. **CLI Interface**: Use `argparse` for consistent command-line interfaces
3. **Logging**: Include comprehensive logging with appropriate levels
4. **Error Handling**: Handle exceptions gracefully with specific error messages
5. **Documentation**: Include docstrings and usage examples
6. **Testing**: Include test modes and validation functions
7. **Permissions**: Make scripts executable with `chmod +x`

## Integration with Main Application

These scripts are designed to work with the main application's:
- Database models and sessions
- Configuration system
- Authentication mechanisms
- Logging infrastructure

They can be used for:
- 🔧 **Development**: Testing and debugging
- 🚀 **Deployment**: Initial setup and configuration
- 🔍 **Monitoring**: Health checks and diagnostics
- 🛠️ **Maintenance**: User management and database tasks

## Future Enhancements

Planned additions:
- **Backup/Restore Scripts**: Database backup and restoration tools
- **Migration Scripts**: Database schema migration utilities
- **Performance Scripts**: Performance testing and monitoring tools
- **Integration Scripts**: External service integration helpers 