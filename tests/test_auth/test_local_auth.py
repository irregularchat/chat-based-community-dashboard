"""
Local authentication tests for the application.
"""
import os
import sys
import unittest
from unittest import mock
import bcrypt

# Add project root to path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

class TestLocalAuthentication(unittest.TestCase):
    """Test cases for local authentication."""
    
    def setUp(self):
        """Set up test data."""
        self.test_username = "testuser"
        self.test_password = "testpass123"
        self.test_email = "test@example.com"
        
        # Create a test user in the database
        self._create_test_user()
    
    def _create_test_user(self):
        """Create a test user in the database."""
        from app.db.session import get_db
        from app.db.models import User
        from app.auth.utils import hash_password
        
        db = next(get_db())
        try:
            # Check if user already exists
            user = db.query(User).filter(User.username == self.test_username).first()
            if not user:
                user = User(
                    username=self.test_username,
                    email=self.test_email,
                    hashed_password=hash_password(self.test_password),
                    is_active=True,
                    is_admin=False
                )
                db.add(user)
                db.commit()
        except Exception as e:
            db.rollback()
            raise
        finally:
            db.close()
    
    def test_valid_credentials(self):
        """Test authentication with valid credentials."""
        from app.auth.local_auth import verify_local_admin
        
        is_valid, is_admin = verify_local_admin(self.test_username, self.test_password)
        self.assertTrue(is_valid)
        self.assertFalse(is_admin)  # User is not an admin
    
    def test_invalid_username(self):
        """Test authentication with invalid username."""
        from app.auth.local_auth import verify_local_admin
        
        is_valid, _ = verify_local_admin("nonexistent", self.test_password)
        self.assertFalse(is_valid)
    
    def test_invalid_password(self):
        """Test authentication with invalid password."""
        from app.auth.local_auth import verify_local_admin
        
        is_valid, _ = verify_local_admin(self.test_username, "wrongpassword")
        self.assertFalse(is_valid)
    
    def test_inactive_user(self):
        """Test authentication with inactive user."""
        from app.db.session import get_db
        from app.db.models import User
        from app.auth.local_auth import verify_local_admin
        
        # Make user inactive
        db = next(get_db())
        try:
            user = db.query(User).filter(User.username == self.test_username).first()
            user.is_active = False
            db.commit()
            
            # Test login
            is_valid, _ = verify_local_admin(self.test_username, self.test_password)
            self.assertFalse(is_valid)
            
            # Reactivate user
            user.is_active = True
            db.commit()
        except Exception as e:
            db.rollback()
            raise
        finally:
            db.close()

if __name__ == "__main__":
    unittest.main()
