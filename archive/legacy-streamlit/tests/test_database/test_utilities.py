"""
Database utility tests for the application.
"""
import os
import sys
import logging
from unittest import TestCase, mock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Add project root to path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from app.db.session import Base, get_db
from scripts.utils.db_utilities import DatabaseUtilities

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class TestDatabaseUtilities(TestCase):
    """Test cases for database utilities."""
    
    @classmethod
    def setUpClass(cls):
        """Set up test database and session."""
        # Create an in-memory SQLite database for testing
        cls.engine = create_engine('sqlite:///:memory:')
        cls.TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=cls.engine)
        
        # Create tables
        Base.metadata.create_all(bind=cls.engine)
        
        # Create a test user
        db = cls.TestingSessionLocal()
        try:
            from app.db.models import User
            from app.auth.utils import hash_password
            
            test_user = User(
                username="testuser",
                email="test@example.com",
                hashed_password=hash_password("testpass"),
                is_active=True,
                is_admin=False
            )
            db.add(test_user)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"Error setting up test user: {e}")
            raise
        finally:
            db.close()
    
    def setUp(self):
        """Set up test database session."""
        self.db = self.TestingSessionLocal()
        self.db_utils = DatabaseUtilities()
        
        # Patch get_db to use our test session
        self.get_db_patcher = mock.patch('app.db.session.get_db', return_value=self.db)
        self.mock_get_db = self.get_db_patcher.start()
    
    def tearDown(self):
        """Clean up after each test."""
        self.db.rollback()
        self.get_db_patcher.stop()
        self.db.close()
    
    def test_connection(self):
        """Test database connection."""
        result = self.db_utils.test_connection()
        self.assertTrue(result)
    
    def test_list_users(self):
        """Test listing users."""
        result = self.db_utils.list_users()
        self.assertTrue(result)
    
    def test_show_statistics(self):
        """Test showing user statistics."""
        result = self.db_utils.show_statistics()
        self.assertTrue(result)
    
    def test_health_check(self):
        """Test database health check."""
        result = self.db_utils.health_check()
        self.assertTrue(result)

if __name__ == "__main__":
    import unittest
    unittest.main()
