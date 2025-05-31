#!/usr/bin/env python3
"""
Database Utilities Script

Common database maintenance and diagnostic tasks:
- Check database connection
- List all users
- Show user statistics
- Database health check

Usage:
    python3 scripts/utils/db_utilities.py connection     # Test database connection
    python3 scripts/utils/db_utilities.py users          # List all users
    python3 scripts/utils/db_utilities.py stats          # Show user statistics
    python3 scripts/utils/db_utilities.py health         # Database health check
"""

import argparse
import logging
import sys
from pathlib import Path

# Add project root to path for imports
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from app.db.session import get_db
from app.db.models import User
from sqlalchemy import text

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class DatabaseUtilities:
    """Database utility functions."""
    
    def test_connection(self):
        """Test database connection."""
        logger.info("=== TESTING DATABASE CONNECTION ===")
        
        try:
            db = next(get_db())
            try:
                # Simple query to test connection
                result = db.execute(text("SELECT 1 as test"))
                test_value = result.scalar()
                
                if test_value == 1:
                    logger.info("✅ Database connection successful")
                    
                    # Test basic table access
                    user_count = db.query(User).count()
                    logger.info(f"✅ User table accessible - {user_count} users found")
                    return True
                else:
                    logger.error("❌ Database connection test failed")
                    return False
                    
            finally:
                db.close()
                
        except Exception as e:
            logger.error(f"❌ Database connection error: {e}")
            return False
    
    def list_users(self):
        """List all users in the database."""
        logger.info("=== LISTING ALL USERS ===")
        
        try:
            db = next(get_db())
            try:
                users = db.query(User).all()
                
                if not users:
                    logger.info("📭 No users found in database")
                    return True
                
                logger.info(f"📊 Found {len(users)} users:")
                logger.info(f"{'Username':<20} {'Email':<30} {'Admin':<6} {'Mod':<6} {'Active':<6} {'Local':<6}")
                logger.info("-" * 80)
                
                for user in users:
                    local_account = False
                    if user.attributes and isinstance(user.attributes, dict):
                        local_account = user.attributes.get('local_account', False)
                    
                    logger.info(
                        f"{user.username:<20} "
                        f"{user.email or 'N/A':<30} "
                        f"{'Yes' if user.is_admin else 'No':<6} "
                        f"{'Yes' if user.is_moderator else 'No':<6} "
                        f"{'Yes' if user.is_active else 'No':<6} "
                        f"{'Yes' if local_account else 'No':<6}"
                    )
                
                return True
                
            finally:
                db.close()
                
        except Exception as e:
            logger.error(f"❌ Error listing users: {e}")
            return False
    
    def show_statistics(self):
        """Show user statistics."""
        logger.info("=== USER STATISTICS ===")
        
        try:
            db = next(get_db())
            try:
                total_users = db.query(User).count()
                active_users = db.query(User).filter(User.is_active == True).count()
                admin_users = db.query(User).filter(User.is_admin == True).count()
                moderator_users = db.query(User).filter(User.is_moderator == True).count()
                
                # Count local accounts
                local_accounts = 0
                all_users = db.query(User).all()
                for user in all_users:
                    if (user.attributes and isinstance(user.attributes, dict) 
                        and user.attributes.get('local_account', False)):
                        local_accounts += 1
                
                logger.info(f"📊 Database Statistics:")
                logger.info(f"  Total Users: {total_users}")
                logger.info(f"  Active Users: {active_users}")
                logger.info(f"  Admin Users: {admin_users}")
                logger.info(f"  Moderator Users: {moderator_users}")
                logger.info(f"  Local Accounts: {local_accounts}")
                logger.info(f"  SSO Accounts: {total_users - local_accounts}")
                
                if total_users > 0:
                    logger.info(f"\n📈 Percentages:")
                    logger.info(f"  Active: {(active_users/total_users)*100:.1f}%")
                    logger.info(f"  Admin: {(admin_users/total_users)*100:.1f}%")
                    logger.info(f"  Moderator: {(moderator_users/total_users)*100:.1f}%")
                    logger.info(f"  Local: {(local_accounts/total_users)*100:.1f}%")
                
                return True
                
            finally:
                db.close()
                
        except Exception as e:
            logger.error(f"❌ Error generating statistics: {e}")
            return False
    
    def health_check(self):
        """Perform database health check."""
        logger.info("=== DATABASE HEALTH CHECK ===")
        
        checks = {
            'connection': self.test_connection(),
            'user_access': False,
            'admin_exists': False,
            'data_integrity': False
        }
        
        if checks['connection']:
            try:
                db = next(get_db())
                try:
                    # Check user table access
                    user_count = db.query(User).count()
                    checks['user_access'] = True
                    logger.info(f"✅ User table access: {user_count} users")
                    
                    # Check if at least one admin exists
                    admin_count = db.query(User).filter(User.is_admin == True).count()
                    checks['admin_exists'] = admin_count > 0
                    logger.info(f"{'✅' if checks['admin_exists'] else '❌'} Admin users: {admin_count}")
                    
                    # Basic data integrity check
                    users_with_attributes = db.query(User).filter(User.attributes.isnot(None)).count()
                    checks['data_integrity'] = True
                    logger.info(f"✅ Data integrity: {users_with_attributes} users have attributes")
                    
                finally:
                    db.close()
                    
            except Exception as e:
                logger.error(f"❌ Health check error: {e}")
        
        # Summary
        passed = sum(checks.values())
        total = len(checks)
        
        logger.info(f"\n🏥 HEALTH CHECK SUMMARY:")
        logger.info(f"  Passed: {passed}/{total} checks")
        for check, status in checks.items():
            logger.info(f"  {check.replace('_', ' ').title()}: {'✅' if status else '❌'}")
        
        overall_health = passed == total
        logger.info(f"\n🎯 OVERALL HEALTH: {'✅ HEALTHY' if overall_health else '❌ ISSUES DETECTED'}")
        
        return overall_health

def main():
    """Main function with command-line interface."""
    parser = argparse.ArgumentParser(
        description="Database Utilities Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 scripts/utils/db_utilities.py connection   # Test database connection
  python3 scripts/utils/db_utilities.py users        # List all users
  python3 scripts/utils/db_utilities.py stats        # Show user statistics
  python3 scripts/utils/db_utilities.py health       # Database health check
        """
    )
    
    parser.add_argument(
        'command',
        choices=['connection', 'users', 'stats', 'health'],
        help='Operation to perform'
    )
    
    args = parser.parse_args()
    
    db_utils = DatabaseUtilities()
    
    try:
        if args.command == 'connection':
            success = db_utils.test_connection()
        elif args.command == 'users':
            success = db_utils.list_users()
        elif args.command == 'stats':
            success = db_utils.show_statistics()
        elif args.command == 'health':
            success = db_utils.health_check()
        else:
            logger.error(f"Unknown command: {args.command}")
            success = False
            
        sys.exit(0 if success else 1)
        
    except KeyboardInterrupt:
        logger.info("\n🛑 Operation cancelled by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"❌ Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 