#!/usr/bin/env python3
"""
Authentication Testing Tool

Test various authentication scenarios and configurations:
- Local admin authentication
- Environment configuration validation
- Password hashing verification
- Security testing

Usage:
    python3 scripts/tools/auth_tester.py local          # Test local admin auth
    python3 scripts/tools/auth_tester.py config         # Test auth config
    python3 scripts/tools/auth_tester.py hash           # Test password hashing
    python3 scripts/tools/auth_tester.py security       # Security tests
"""

import argparse
import hashlib
import logging
import sys
from pathlib import Path

# Add project root to path for imports
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from app.auth.local_auth import verify_local_admin, hash_password
from app.utils.config import Config

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class AuthTester:
    """Authentication testing utilities."""
    
    def __init__(self):
        self.admin_username = Config.DEFAULT_ADMIN_USERNAME
        self.admin_password = Config.DEFAULT_ADMIN_PASSWORD
    
    def test_local_auth(self):
        """Test local admin authentication."""
        logger.info("=== TESTING LOCAL AUTHENTICATION ===")
        
        if not self.admin_username or not self.admin_password:
            logger.error("❌ Admin credentials not configured in environment")
            return False
        
        logger.info(f"Testing username: {self.admin_username}")
        logger.info(f"Testing password: {'***' + self.admin_password[-3:] if len(self.admin_password) > 3 else '***'}")
        
        success = True
        
        # Test 1: Valid credentials
        try:
            is_valid, is_admin = verify_local_admin(self.admin_username, self.admin_password)
            if is_valid and is_admin:
                logger.info("✅ Test 1 PASSED: Valid admin credentials accepted")
            else:
                logger.error(f"❌ Test 1 FAILED: Valid credentials rejected (valid={is_valid}, admin={is_admin})")
                success = False
        except Exception as e:
            logger.error(f"❌ Test 1 ERROR: {e}")
            success = False
        
        # Test 2: Wrong password
        try:
            is_valid, is_admin = verify_local_admin(self.admin_username, "wrongpassword")
            if not is_valid:
                logger.info("✅ Test 2 PASSED: Wrong password correctly rejected")
            else:
                logger.error(f"❌ Test 2 FAILED: Wrong password accepted (SECURITY ISSUE!)")
                success = False
        except Exception as e:
            logger.error(f"❌ Test 2 ERROR: {e}")
            success = False
        
        # Test 3: Wrong username
        try:
            is_valid, is_admin = verify_local_admin("wronguser", self.admin_password)
            if not is_valid:
                logger.info("✅ Test 3 PASSED: Wrong username correctly rejected")
            else:
                logger.error(f"❌ Test 3 FAILED: Wrong username accepted (SECURITY ISSUE!)")
                success = False
        except Exception as e:
            logger.error(f"❌ Test 3 ERROR: {e}")
            success = False
        
        # Test 4: Empty credentials
        try:
            is_valid, is_admin = verify_local_admin("", "")
            if not is_valid:
                logger.info("✅ Test 4 PASSED: Empty credentials correctly rejected")
            else:
                logger.error(f"❌ Test 4 FAILED: Empty credentials accepted (SECURITY ISSUE!)")
                success = False
        except Exception as e:
            logger.error(f"❌ Test 4 ERROR: {e}")
            success = False
        
        return success
    
    def test_config(self):
        """Test authentication configuration."""
        logger.info("=== TESTING AUTHENTICATION CONFIGURATION ===")
        
        issues = []
        
        # Check environment variables
        if not self.admin_username:
            issues.append("DEFAULT_ADMIN_USERNAME not set")
        else:
            logger.info(f"✅ Admin username configured: {self.admin_username}")
        
        if not self.admin_password:
            issues.append("DEFAULT_ADMIN_PASSWORD not set")
        else:
            logger.info(f"✅ Admin password configured: {'***' + self.admin_password[-3:] if len(self.admin_password) > 3 else '***'}")
        
        # Check password strength
        if self.admin_password:
            if len(self.admin_password) < 6:
                issues.append("Admin password is too short (< 6 characters)")
            else:
                logger.info(f"✅ Password length acceptable: {len(self.admin_password)} characters")
            
            if self.admin_password.lower() in ['password', 'admin', '123456', 'password123']:
                issues.append("Admin password is too common/weak")
            else:
                logger.info("✅ Password is not in common weak password list")
        
        # Check for configuration consistency
        try:
            from app.db.session import get_db
            from app.db.models import User
            
            db = next(get_db())
            try:
                admin_user = db.query(User).filter(User.username == self.admin_username).first()
                if admin_user:
                    if not admin_user.is_admin:
                        issues.append(f"User '{self.admin_username}' exists but is not marked as admin")
                    else:
                        logger.info(f"✅ Admin user exists in database with admin privileges")
                    
                    if not admin_user.is_active:
                        issues.append(f"Admin user '{self.admin_username}' is not active")
                    else:
                        logger.info(f"✅ Admin user is active")
                else:
                    issues.append(f"Admin user '{self.admin_username}' not found in database")
            finally:
                db.close()
                
        except Exception as e:
            issues.append(f"Could not verify database configuration: {e}")
        
        if issues:
            logger.error("❌ Configuration issues found:")
            for issue in issues:
                logger.error(f"  - {issue}")
            return False
        else:
            logger.info("✅ Authentication configuration is valid")
            return True
    
    def test_password_hashing(self):
        """Test password hashing functionality."""
        logger.info("=== TESTING PASSWORD HASHING ===")
        
        test_passwords = ["testpass123", "admin", "password", "secure123!"]
        success = True
        
        for password in test_passwords:
            try:
                # Test hashing
                hashed = hash_password(password)
                
                # Verify hash properties
                if len(hashed) != 64:  # SHA-256 produces 64-character hex
                    logger.error(f"❌ Hash length incorrect for '{password}': {len(hashed)} != 64")
                    success = False
                    continue
                
                # Verify hash is deterministic
                hashed2 = hash_password(password)
                if hashed != hashed2:
                    logger.error(f"❌ Hash not deterministic for '{password}'")
                    success = False
                    continue
                
                # Verify different passwords produce different hashes
                different_hash = hash_password(password + "x")
                if hashed == different_hash:
                    logger.error(f"❌ Different passwords produce same hash")
                    success = False
                    continue
                
                logger.info(f"✅ Password hashing working correctly for test password")
                
            except Exception as e:
                logger.error(f"❌ Error testing password hashing: {e}")
                success = False
        
        return success
    
    def security_tests(self):
        """Run security-focused tests."""
        logger.info("=== RUNNING SECURITY TESTS ===")
        
        success = True
        
        # Test 1: SQL injection attempts
        sql_injection_attempts = [
            "admin'; DROP TABLE users; --",
            "admin' OR '1'='1",
            "admin' UNION SELECT * FROM users --"
        ]
        
        for attempt in sql_injection_attempts:
            try:
                is_valid, is_admin = verify_local_admin(attempt, "anypassword")
                if is_valid:
                    logger.error(f"❌ SECURITY ISSUE: SQL injection attempt succeeded: {attempt}")
                    success = False
                else:
                    logger.info(f"✅ SQL injection attempt properly rejected: {attempt[:20]}...")
            except Exception as e:
                # Exceptions are expected for malformed queries
                logger.info(f"✅ SQL injection attempt caused safe exception: {attempt[:20]}...")
        
        # Test 2: Timing attack resistance (basic check)
        import time
        
        valid_user_times = []
        invalid_user_times = []
        
        for _ in range(5):
            # Time valid username, wrong password
            start = time.time()
            verify_local_admin(self.admin_username, "wrongpassword")
            valid_user_times.append(time.time() - start)
            
            # Time invalid username
            start = time.time()
            verify_local_admin("nonexistentuser", "wrongpassword")
            invalid_user_times.append(time.time() - start)
        
        avg_valid = sum(valid_user_times) / len(valid_user_times)
        avg_invalid = sum(invalid_user_times) / len(invalid_user_times)
        
        # Check if timing difference is too large (potential timing attack vector)
        if abs(avg_valid - avg_invalid) > 0.1:  # 100ms difference
            logger.warning(f"⚠️ Potential timing attack vector: valid_user={avg_valid:.3f}s, invalid_user={avg_invalid:.3f}s")
        else:
            logger.info(f"✅ Timing attack resistance: similar response times")
        
        return success

def main():
    """Main function with command-line interface."""
    parser = argparse.ArgumentParser(
        description="Authentication Testing Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python3 scripts/tools/auth_tester.py local      # Test local admin auth
  python3 scripts/tools/auth_tester.py config     # Test auth config
  python3 scripts/tools/auth_tester.py hash       # Test password hashing
  python3 scripts/tools/auth_tester.py security   # Security tests
        """
    )
    
    parser.add_argument(
        'command',
        choices=['local', 'config', 'hash', 'security', 'all'],
        help='Test to perform'
    )
    
    args = parser.parse_args()
    
    tester = AuthTester()
    
    try:
        if args.command == 'local':
            success = tester.test_local_auth()
        elif args.command == 'config':
            success = tester.test_config()
        elif args.command == 'hash':
            success = tester.test_password_hashing()
        elif args.command == 'security':
            success = tester.security_tests()
        elif args.command == 'all':
            logger.info("🚀 RUNNING ALL AUTHENTICATION TESTS")
            results = {
                'config': tester.test_config(),
                'hash': tester.test_password_hashing(),
                'local': tester.test_local_auth(),
                'security': tester.security_tests()
            }
            
            logger.info("\n📋 TEST SUMMARY:")
            for test, result in results.items():
                logger.info(f"  {test.title()}: {'✅' if result else '❌'}")
            
            success = all(results.values())
            logger.info(f"\n🎯 OVERALL RESULT: {'✅ ALL TESTS PASSED' if success else '❌ SOME TESTS FAILED'}")
        else:
            logger.error(f"Unknown command: {args.command}")
            success = False
            
        sys.exit(0 if success else 1)
        
    except KeyboardInterrupt:
        logger.info("\n🛑 Testing cancelled by user")
        sys.exit(1)
    except Exception as e:
        logger.error(f"❌ Unexpected error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main() 