#!/usr/bin/env python3
"""
Test script to verify database connection and user loading functionality.
Run this script to diagnose issues with the database connection and user loading.
"""
import os
import sys
import logging
from pathlib import Path

# Add project root to Python path
project_root = str(Path(__file__).parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('user_loading_test.log')
    ]
)
logger = logging.getLogger(__name__)

def test_database_connection():
    """Test database connection and basic operations."""
    from sqlalchemy import create_engine, inspect, text
    from app.db.database import DATABASE_URL
    
    try:
        logger.info("Testing database connection...")
        logger.info(f"Using database URL: {DATABASE_URL}")
        
        # Create engine and connect
        engine = create_engine(DATABASE_URL)
        with engine.connect() as conn:
            # Test connection
            result = conn.execute(text("SELECT 1"))
            logger.info(f"Connection test successful. Result: {result.scalar()}")
            
            # Check if users table exists
            inspector = inspect(engine)
            table_names = inspector.get_table_names()
            logger.info(f"Tables in database: {table_names}")
            
            if 'users' in table_names:
                logger.info("✅ Users table exists")
                
                # Count users
                result = conn.execute(text("SELECT COUNT(*) FROM users"))
                count = result.scalar()
                logger.info(f"Found {count} users in the database")
                
                # Get sample users
                result = conn.execute(text("SELECT id, username, email FROM users LIMIT 5"))
                logger.info("Sample users:")
                for row in result:
                    logger.info(f"  - ID: {row[0]}, Username: {row[1]}, Email: {row[2]}")
                
                return True
            else:
                logger.error("❌ Users table does not exist in the database")
                return False
                
    except Exception as e:
        logger.error(f"❌ Database connection failed: {str(e)}", exc_info=True)
        return False

def test_user_loading():
    """Test loading users using the application's function."""
    try:
        from app.ui.forms import get_users_from_db
        
        logger.info("Testing user loading function...")
        users = get_users_from_db()
        
        if users:
            logger.info(f"✅ Successfully loaded {len(users)} users")
            logger.info("Sample users:")
            for i, user in enumerate(users[:5]):
                logger.info(f"  {i+1}. {user.username} ({user.email})")
            return True
        else:
            logger.warning("⚠️ No users were loaded")
            return False
            
    except Exception as e:
        logger.error(f"❌ Error in user loading function: {str(e)}", exc_info=True)
        return False

if __name__ == "__main__":
    logger.info("=" * 80)
    logger.info("DATABASE CONNECTION TEST")
    logger.info("=" * 80)
    
    connection_ok = test_database_connection()
    
    logger.info("\n" + "=" * 80)
    logger.info("USER LOADING TEST")
    logger.info("=" * 80)
    
    if connection_ok:
        loading_ok = test_user_loading()
    
    logger.info("\n" + "=" * 80)
    logger.info("TEST SUMMARY")
    logger.info("=" * 80)
    logger.info(f"Database Connection: {'✅ SUCCESS' if connection_ok else '❌ FAILED'}")
    if connection_ok:
        logger.info(f"User Loading: {'✅ SUCCESS' if loading_ok else '⚠️ COMPLETED WITH ISSUES'}")
    
    logger.info("\nCheck user_loading_test.log for detailed logs.")
