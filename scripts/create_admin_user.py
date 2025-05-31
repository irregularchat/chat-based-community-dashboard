#!/usr/bin/env python3
"""
Script to create a default admin user in the database.
This script should be run when the database is fresh and no admin user exists.
"""

import os
import sys
import logging
import hashlib
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.attributes import flag_modified
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Load environment variables from .env file
load_dotenv()

# Import models - adjust the import path if needed
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
try:
    from app.db.models import User
    from app.utils.config import Config
except ImportError as e:
    logger.error(f"Error importing required modules: {e}")
    logger.error("Make sure you're running this script from the project root directory")
    sys.exit(1)

def hash_password(password: str) -> str:
    """Hash a password using SHA-256."""
    return hashlib.sha256(password.encode()).hexdigest()

def create_admin_user():
    """Create a default admin user in the database."""
    try:
        # Get database connection parameters from environment
        db_user = os.environ.get("POSTGRES_USER", "postgres")
        db_password = os.environ.get("POSTGRES_PASSWORD", "")
        db_name = os.environ.get("POSTGRES_DB", "dashboarddb")
        db_host = os.environ.get("DB_HOST", "localhost")
        db_port = os.environ.get("POSTGRES_PORT", "5436")
        
        # For Docker, use the internal port 5432
        if os.environ.get("IN_DOCKER", "").lower() == "true":
            db_port = "5432"
            db_host = "db"
        
        # Get admin credentials from environment or use defaults
        admin_username = os.environ.get("DEFAULT_ADMIN_USERNAME", "admin")
        admin_password = os.environ.get("DEFAULT_ADMIN_PASSWORD", "Admin_Password123!")
        
        # Create database URL
        db_url = f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
        logger.info(f"Connecting to database at {db_host}:{db_port}/{db_name} as {db_user}")
        
        # Create engine and session
        engine = create_engine(db_url)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        db = SessionLocal()
        
        try:
            # Check if admin user already exists
            existing_admin = db.query(User).filter(User.username == admin_username).first()
            
            if existing_admin:
                logger.info(f"Admin user '{admin_username}' already exists")
                
                # Update admin attributes if needed
                if not existing_admin.is_admin:
                    existing_admin.is_admin = True
                    logger.info(f"Updated '{admin_username}' to have admin privileges")
                
                # Update admin attributes for local authentication
                if not existing_admin.attributes:
                    existing_admin.attributes = {}
                
                existing_admin.attributes["local_account"] = True
                existing_admin.attributes["hashed_password"] = hash_password(admin_password)
                existing_admin.attributes["created_by"] = "system"
                
                # Mark attributes as modified (required for JSON fields)
                flag_modified(existing_admin, "attributes")
                
                db.commit()
                logger.info(f"Updated admin user '{admin_username}' with local authentication attributes")
                return
            
            # Create new admin user
            new_admin = User(
                username=admin_username,
                email=f"{admin_username}@example.com",  # Placeholder email
                is_active=True,
                is_admin=True,
                is_moderator=True,
                attributes={
                    "local_account": True,
                    "hashed_password": hash_password(admin_password),
                    "created_by": "system"
                }
            )
            
            db.add(new_admin)
            db.commit()
            logger.info(f"Created new admin user '{admin_username}' with local authentication")
            
        finally:
            db.close()
            
    except Exception as e:
        logger.error(f"Error creating admin user: {e}")
        sys.exit(1)

if __name__ == "__main__":
    logger.info("Starting admin user creation script")
    create_admin_user()
    logger.info("Admin user creation completed")
