#!/usr/bin/env python3
"""
Database connection test script
This script tests the database connection using both PostgreSQL and SQLite configurations.
"""

import os
import sys
import time
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError

def test_sqlite_connection():
    """Test SQLite database connection"""
    print("\n=== Testing SQLite Connection ===")
    try:
        # Configure SQLite
        os.environ["SQLITE_DEV"] = "true"
        if "LOCAL_DEV" in os.environ:
            del os.environ["LOCAL_DEV"]
            
        # Import our database configuration
        sys.path.append(".")
        from app.db.database import engine
        
        # Test connection with a simple query
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            data = result.fetchone()
            
        print("✅ SQLite connection successful!")
        return True
    except Exception as e:
        print(f"❌ SQLite connection failed: {str(e)}")
        return False
    finally:
        # Clean up environment variable
        if "SQLITE_DEV" in os.environ:
            del os.environ["SQLITE_DEV"]

def test_postgres_connection():
    """Test PostgreSQL database connection"""
    print("\n=== Testing PostgreSQL Connection ===")
    try:
        # Configure PostgreSQL
        os.environ["LOCAL_DEV"] = "true"
        if "SQLITE_DEV" in os.environ:
            del os.environ["SQLITE_DEV"]
        
        # Load environment variables
        postgres_port = os.getenv("POSTGRES_PORT", "5432")
        postgres_user = os.getenv("POSTGRES_USER", "dashboarduser")
        postgres_password = os.getenv("POSTGRES_PASSWORD", "password_for_db")
        postgres_db = os.getenv("POSTGRES_DB", "dashboarddb")
        
        # Build connection string
        db_url = f"postgresql://{postgres_user}:{postgres_password}@localhost:{postgres_port}/{postgres_db}"
        print(f"Connecting to: {db_url}")
        
        # Create engine and test connection
        pg_engine = create_engine(db_url)
        with pg_engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            data = result.fetchone()
            
        print("✅ PostgreSQL connection successful!")
        return True
    except OperationalError as e:
        print(f"❌ PostgreSQL connection failed: {str(e)}")
        print("\nPossible reasons:")
        print("1. PostgreSQL is not running on your machine")
        print("2. Database credentials are incorrect")
        print("3. The database does not exist")
        print("\nTo create the database:")
        print(f"  createdb -U {postgres_user} {postgres_db}")
        return False
    except Exception as e:
        print(f"❌ PostgreSQL connection failed with unexpected error: {str(e)}")
        return False
    finally:
        # Clean up environment variable
        if "LOCAL_DEV" in os.environ:
            del os.environ["LOCAL_DEV"]

if __name__ == "__main__":
    print("Database Connection Test")
    print("=======================")
    
    # Test SQLite first (simpler)
    sqlite_ok = test_sqlite_connection()
    
    # Wait a moment before trying PostgreSQL
    time.sleep(1)
    
    # Test PostgreSQL
    postgres_ok = test_postgres_connection()
    
    # Summary
    print("\n=== Summary ===")
    print(f"SQLite: {'✅ Working' if sqlite_ok else '❌ Not working'}")
    print(f"PostgreSQL: {'✅ Working' if postgres_ok else '❌ Not working'}")
    
    if sqlite_ok:
        print("\nYou can run the application with SQLite using:")
        print("  ./run_sqlite.sh")
    
    if postgres_ok:
        print("\nYou can run the application with PostgreSQL using:")
        print("  ./run_local.sh")
    
    if not sqlite_ok and not postgres_ok:
        print("\n❌ Neither database configuration is working.")
        print("Please check your setup and try again.")
        sys.exit(1)
    
    print("\nTest completed successfully.") 