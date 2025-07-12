#!/usr/bin/env python3
"""
Comprehensive Admin User Management Script

This script provides a unified interface for admin user management tasks:
- Check admin user details
- Create/update local admin users  
- Test admin login functionality
- Verify environment configuration

Usage:
    python3 scripts/admin/admin_manager.py check          # Check admin user details
    python3 scripts/admin/admin_manager.py create         # Create/update local admin
    python3 scripts/admin/admin_manager.py test           # Test admin login
    python3 scripts/admin/admin_manager.py all            # Run all operations
"""

import argparse
import hashlib
import json
import logging
import sys
from pathlib import Path

# Add project root to path for imports
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from app.db.session import get_db
from app.db.models import User
from app.utils.config import Config
from app.auth.local_auth import verify_local_admin
from sqlalchemy.orm.attributes import flag_modified

# Configure logging
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class AdminManager:
    """Comprehensive admin user management class."""
    
    def __init__(self):
        self.admin_username = Config.DEFAULT_ADMIN_USERNAME
        self.admin_password = Config.DEFAULT_ADMIN_PASSWORD
        
    def hash_password(self, password: str) -> str:
        """Hash a password using SHA-256."""
        return hashlib.sha256(password.encode()).hexdigest()
    
    def check_admin_user(self):
        """Check admin user details in the database."""
        logger.info("=== CHECKING ADMIN USER DETAILS ===")
        
        db = next(get_db())
        try:
            admin_user = db.query(User).filter(User.username == self.admin_username).first()
            
            if admin_user:
                logger.info('✅ Found admin user:')
                logger.info(f'  Username: {admin_user.username}')
                logger.info(f'  Email: {admin_user.email}')
                logger.info(f'  Is Active: {admin_user.is_active}')
                logger.info(f'  Is Admin: {admin_user.is_admin}')
                logger.info(f'  Is Moderator: {admin_user.is_moderator}')
                
                if admin_user.attributes:
                    logger.info(f'  Attributes: {json.dumps(admin_user.attributes, indent=4)}')
                else:
                    logger.info('  Attributes: None')
                    
                # Check for local account configuration
                if admin_user.attributes:
                    has_local = admin_user.attributes.get('local_account', False)
                    has_password = bool(admin_user.attributes.get('hashed_password'))
                    logger.info(f'  Local Account: {has_local}')
                    logger.info(f'  Has Password Hash: {has_password}')
                else:
                    logger.warning('  ⚠️ No attributes found - may not be configured for local login')
                    
            else:
                logger.error(f'❌ No admin user found with username: {self.admin_username}')
                
            # Check for all admin users
            all_admins = db.query(User).filter(User.is_admin == True).all()
            logger.info(f'\n📊 Found {len(all_admins)} total admin users in database:')
            for user in all_admins:
                local_account = user.attributes.get('local_account', False) if user.attributes else False
                logger.info(f'  - {user.username} (email: {user.email}, local: {local_account})')
                
            return admin_user is not None
            
        except Exception as e:
            logger.error(f"❌ Error checking admin user: {e}")
            return False
        finally:
            db.close()
    
    def create_local_admin(self):
        """Create or update the local admin user."""
        logger.info("=== CREATING/UPDATING LOCAL ADMIN USER ===")
        
        logger.info(f"Admin username: {self.admin_username}")
        logger.info(f"Admin password: {'***' + self.admin_password[-3:] if self.admin_password else 'None'}")
        
        if not self.admin_password:
            logger.error("❌ No admin password configured in environment")
            return False
            
        db = next(get_db())
        try:
            # Check if admin user already exists
            existing_admin = db.query(User).filter(User.username == self.admin_username).first()
            
            if existing_admin:
                logger.info(f"📝 Admin user '{self.admin_username}' already exists - updating attributes")
                
                # Update admin privileges
                existing_admin.is_admin = True
                existing_admin.is_active = True
                
                # Update or create attributes for local authentication
                if not existing_admin.attributes:
                    existing_admin.attributes = {}
                
                existing_admin.attributes["local_account"] = True
                existing_admin.attributes["hashed_password"] = self.hash_password(self.admin_password)
                existing_admin.attributes["created_by"] = "admin_manager_script"
                existing_admin.attributes["updated_at"] = str(logging.Formatter().formatTime(logging.LogRecord("", 0, "", 0, "", (), None)))
                
                # Mark attributes as modified (required for JSON fields)
                flag_modified(existing_admin, "attributes")
                
                db.commit()
                logger.info(f"✅ Updated admin user '{self.admin_username}' with local authentication attributes")
                
            else:
                logger.info(f"🆕 Creating new admin user '{self.admin_username}'")
                
                # Create new admin user
                new_admin = User(
                    username=self.admin_username,
                    email=f"{self.admin_username}@local.admin",  # Local admin email
                    is_active=True,
                    is_admin=True,
                    is_moderator=True,
                    attributes={
                        "local_account": True,
                        "hashed_password": self.hash_password(self.admin_password),
                        "created_by": "admin_manager_script",
                        "created_at": str(logging.Formatter().formatTime(logging.LogRecord("", 0, "", 0, "", (), None)))
                    }
                )
                
                db.add(new_admin)
                db.commit()
                logger.info(f"✅ Created new admin user '{self.admin_username}' with local authentication")
                
            # Verify the user was created/updated correctly
            verify_admin = db.query(User).filter(User.username == self.admin_username).first()
            if verify_admin:
                logger.info("🔍 Admin user verification:")
                logger.info(f"  Username: {verify_admin.username}")
                logger.info(f"  Is Admin: {verify_admin.is_admin}")
                logger.info(f"  Is Active: {verify_admin.is_active}")
                logger.info(f"  Has local_account: {verify_admin.attributes.get('local_account', False) if verify_admin.attributes else False}")
                logger.info(f"  Has hashed_password: {'Yes' if verify_admin.attributes and verify_admin.attributes.get('hashed_password') else 'No'}")
                return True
            else:
                logger.error("❌ Failed to verify admin user creation")
                return False
                
        except Exception as e:
            logger.error(f"❌ Error creating/updating admin user: {e}")
            db.rollback()
            return False
        finally:
            db.close()
    
    def test_admin_login(self):
        """Test the admin login with credentials from .env file."""
        logger.info("=== TESTING ADMIN LOGIN ===")
        
        logger.info(f"Testing username: {self.admin_username}")
        logger.info(f"Testing password: {'***' + self.admin_password[-3:] if self.admin_password else 'None'}")
        
        if not self.admin_password:
            logger.error("❌ No admin password configured in environment")
            return False
        
        success = True
        
        # Test correct credentials
        try:
            is_valid, is_admin = verify_local_admin(self.admin_username, self.admin_password)
            
            if is_valid and is_admin:
                logger.info("✅ SUCCESS: Admin login test passed!")
                logger.info(f"  - Authentication: Valid")
                logger.info(f"  - Admin privileges: Yes")
            elif is_valid and not is_admin:
                logger.warning("⚠️ PARTIAL SUCCESS: User authenticated but not admin")
                logger.info(f"  - Authentication: Valid") 
                logger.info(f"  - Admin privileges: No")
                success = False
            else:
                logger.error("❌ FAILED: Admin login test failed")
                logger.error(f"  - Authentication: Invalid")
                logger.error(f"  - Admin privileges: No")
                success = False
                
        except Exception as e:
            logger.error(f"❌ ERROR during login test: {e}")
            success = False
            
        # Test wrong password
        logger.info("\n🔐 Testing with wrong password...")
        try:
            is_valid, is_admin = verify_local_admin(self.admin_username, "wrongpassword")
            if not is_valid:
                logger.info("✅ SUCCESS: Wrong password correctly rejected")
            else:
                logger.error("❌ SECURITY ISSUE: Wrong password was accepted!")
                success = False
        except Exception as e:
            logger.error(f"❌ ERROR during wrong password test: {e}")
            success = False
            
        return success
    
    def validate_environment(self):
        """Validate environment configuration."""
        logger.info("=== VALIDATING ENVIRONMENT CONFIGURATION ===")
        
        issues = []
        
        if not self.admin_username:
            issues.append("DEFAULT_ADMIN_USERNAME not configured")
        else:
            logger.info(f"✅ Admin username: {self.admin_username}")
            
        if not self.admin_password:
            issues.append("DEFAULT_ADMIN_PASSWORD not configured")
        else:
            logger.info(f"✅ Admin password: configured ({'***' + self.admin_password[-3:]})")
            
        if issues:
            logger.error("❌ Environment configuration issues:")
            for issue in issues:
                logger.error(f"  - {issue}")
            return False
        else:
            logger.info("✅ Environment configuration is valid")
            return True
    
    def run_all(self):
        """Run all admin management operations."""
        logger.info("🚀 RUNNING COMPREHENSIVE ADMIN MANAGEMENT")
        
        results = {
            'environment': self.validate_environment(),
            'check': self.check_admin_user(),
            'create': False,
            'test': False
        }
        
        if results['environment']:
            results['create'] = self.create_local_admin()
            if results['create']:
                results['test'] = self.test_admin_login()
        
        logger.info("\n📋 SUMMARY:")
        logger.info(f"  Environment Validation: {'✅' if results['environment'] else '❌'}")
        logger.info(f"  Admin User Check: {'✅' if results['check'] else '❌'}")
        logger.info(f"  Admin User Create/Update: {'✅' if results['create'] else '❌'}")
        logger.info(f"  Admin Login Test: {'✅' if results['test'] else '❌'}")
        
        all_success = all(results.values())
        logger.info(f"\n🎯 OVERALL RESULT: {'✅ SUCCESS' if all_success else '❌ SOME ISSUES FOUND'}")
        
        return all_success

def main():
    """Main function with command-line interface."""
    parser = argparse.ArgumentParser(
        description="Admin User Management Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 scripts/admin/admin_manager.py check    # Check admin user details
  python3 scripts/admin/admin_manager.py create   # Create/update local admin
  python3 scripts/admin/admin_manager.py test     # Test admin login
  python3 scripts/admin/admin_manager.py all      # Run all operations
        """
    )
    
    parser.add_argument(
        'command',
        choices=['check', 'create', 'test', 'all', 'validate'],
        help='Operation to perform'
    )
    
    args = parser.parse_args()
    
    manager = AdminManager()
    
    try:
        if args.command == 'check':
            success = manager.check_admin_user()
        elif args.command == 'create':
            success = manager.create_local_admin()
        elif args.command == 'test':
            success = manager.test_admin_login()
        elif args.command == 'validate':
            success = manager.validate_environment()
        elif args.command == 'all':
            success = manager.run_all()
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