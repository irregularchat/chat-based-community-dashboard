#!/usr/bin/env python3
"""
Script Listing Utility

Lists all available utility scripts in the scripts directory with their descriptions and usage.
"""

import os
from pathlib import Path

def list_scripts():
    """List all available scripts with descriptions."""
    print("🚀 Available Utility Scripts")
    print("=" * 50)
    
    # Administrative Scripts
    print("\n📋 Administrative Scripts (admin/)")
    print("  admin_manager.py        Comprehensive admin user management")
    print("    Usage: python3 scripts/admin/admin_manager.py {check|create|test|validate|all}")
    print("    • Check admin user details and configuration")
    print("    • Create/update local admin users")
    print("    • Test authentication functionality")
    print("    • Validate environment configuration")
    
    # Development Tools
    print("\n🔧 Development Tools (tools/)")
    print("  auth_tester.py          Authentication testing and validation")
    print("    Usage: python3 scripts/tools/auth_tester.py {local|config|hash|security|all}")
    print("    • Test local admin authentication")
    print("    • Validate authentication configuration")
    print("    • Test password hashing functionality")
    print("    • Run security tests")
    
    # Database Utilities
    print("\n🗄️  Database Utilities (utils/)")
    print("  db_utilities.py         Database maintenance and diagnostics")
    print("    Usage: python3 scripts/utils/db_utilities.py {connection|users|stats|health}")
    print("    • Test database connection")
    print("    • List all users")
    print("    • Show user statistics")
    print("    • Database health check")
    
    # Application Runners
    print("\n🏃 Application Runners")
    print("  run.sh                  Main application runner")
    print("  run_local.sh           Local development server")
    print("  run_direct_auth.sh     Direct authentication mode")
    print("  run_sqlite.sh          SQLite database mode")
    
    # Quick Examples
    print("\n⚡ Quick Examples")
    print("  # Complete admin setup and verification")
    print("  python3 scripts/admin/admin_manager.py all")
    print("")
    print("  # Database health check")
    print("  python3 scripts/utils/db_utilities.py health")
    print("")
    print("  # Comprehensive authentication testing")
    print("  python3 scripts/tools/auth_tester.py all")
    print("")
    print("  # Daily maintenance routine")
    print("  python3 scripts/utils/db_utilities.py health")
    print("  python3 scripts/admin/admin_manager.py check")
    
    print("\n📖 For detailed documentation, see: scripts/README.md")

if __name__ == "__main__":
    list_scripts() 